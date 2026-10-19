import CoreBluetooth
import Foundation
import TRACECore

struct DiscoveredPendant: Identifiable {
    let peripheral: CBPeripheral
    let name: String
    let advertisesOmiAudio: Bool

    var id: UUID { peripheral.identifier }
}

@MainActor
final class PendantTransport: NSObject, @preconcurrency CBCentralManagerDelegate, @preconcurrency CBPeripheralDelegate {
    let sd = SDCardTransfer()
    var onSDReady: (() -> Void)?
    var pairedDeviceID: UUID? { peripheral?.identifier }
    private var sdCommand: CBCharacteristic?
    private var sdResponse: CBCharacteristic?

    var onState: ((String) -> Void)?
    var onScanStarted: (@MainActor () -> Void)?
    var onDeviceFound: (@MainActor (DiscoveredPendant) -> Void)?
    var onCodec: ((OmiBLEProtocol.Codec?) -> Void)?
    var onBattery: ((Int?) -> Void)?
    var onAudioNotification: (@MainActor (Data, OmiBLEProtocol.Codec) -> Void)?
    var onRawAudioNotification: (@MainActor (Data, Bool) -> Void)?
    var onPauseAcknowledged: (@MainActor () -> Void)?
    var onFirmwareStats: (@MainActor (FirmwareCaptureStats) -> Void)?
    var onDisconnect: (@MainActor () -> Void)?
    var onControlEvent: (@MainActor (UInt8) -> Void)?
    var onControlsStatus: (@MainActor (String) -> Void)?
    var onCaptureAcknowledged: (@MainActor (Bool) -> Void)?
    private var controlEvents: CBCharacteristic?
    private var controlCommand: CBCharacteristic?
    private var controlObserver: NSObjectProtocol?
    private var lastControlSequence: UInt32?
    private var lastControlAction = Date.distantPast

    var controlsConnected: Bool { peripheral?.state == .connected && controlEvents?.isNotifying == true && controlCommand != nil }
    func synchronizeControls() {
        guard controlsConnected, let peripheral, let command = controlCommand else { return }
        peripheral.writeValue(Data([1, DevKitControlPreferences.shared.mask]), for: command, type: .withResponse)
    }
    func feedback(_ pattern: UInt8) {
        guard controlsConnected, DevKitControlPreferences.shared.enabled, DevKitControlPreferences.shared.feedback,
              let peripheral, let command = controlCommand else { return }
        peripheral.writeValue(Data([2, pattern]), for: command, type: .withResponse)
    }

    var onPromptEvent: ((PromptPlaybackEvent) -> Void)?
    var onPromptReady: (() -> Void)?
    var onPromptStatus: ((String) -> Void)?
    private var promptCommand: CBCharacteristic?
    private var promptEvents: CBCharacteristic?
    private var promptObserver: NSObjectProtocol?
    private var promptSequence: UInt32?
    private var promptConfigured = false
    private var promptWrites: [((Bool) -> Void)?] = []
    var promptsAvailable: Bool { promptConfigured && peripheral?.state == .connected && promptEvents?.isNotifying == true }
    private func resetPrompts() {
        let callbacks = promptWrites; promptWrites.removeAll()
        promptCommand = nil; promptEvents = nil; promptSequence = nil; promptConfigured = false
        onPromptStatus?("DevKit spoken prompts disconnected")
        for callback in callbacks { callback?(false) }
    }
    func synchronizePrompts() {
        guard let peripheral, peripheral.state == .connected, let command = promptCommand,
              promptEvents?.isNotifying == true, promptWrites.count < 8 else { return }
        promptConfigured = false
        promptWrites.append { [weak self] success in
            guard let self else { return }
            self.promptConfigured = success
            self.onPromptStatus?(success ? "Spoken prompts connected" : "Could not configure spoken prompts")
            if success { self.onPromptReady?() }
        }
        peripheral.writeValue(Data([1, SpokenPromptPreferences.shared.enabled ? 1 : 0]), for: command, type: .withResponse)
    }
    @discardableResult func speakPrompt(_ prompt: SpokenPrompt, preview: Bool = false, completion: ((Bool) -> Void)? = nil) -> Bool {
        guard promptsAvailable, SpokenPromptPreferences.shared.enabled,
              let peripheral, let command = promptCommand, promptWrites.count < 8 else { return false }
        promptWrites.append(completion)
        peripheral.writeValue(Data([preview ? 3 : 2, prompt.rawValue]), for: command, type: .withResponse)
        return true
    }

    private let pairedPeripheralKey = "trace.native.pairedPeripheral"
    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var audioCharacteristic: CBCharacteristic?
    private var captureStateCharacteristic: CBCharacteristic?
    private var statsCharacteristic: CBCharacteristic?
    private var statsTimer: Timer?
    private var capturePaused = true
    private var pendingCaptureWrites: [Bool] = []

    func readFirmwareStats() {
        if let peripheral, peripheral.state == .connected, let statsCharacteristic {
            peripheral.readValue(for: statsCharacteristic)
        }
    }

    func setCapturePaused(_ paused: Bool) {
        capturePaused = paused
        synchronizeCaptureIndicator()
        if let peripheral, let statsCharacteristic { peripheral.readValue(for: statsCharacteristic) }
    }

    private func synchronizeCaptureIndicator() {
        guard let peripheral, peripheral.state == .connected,
              let characteristic = captureStateCharacteristic,
              characteristic.properties.contains(.write) else { return }
        pendingCaptureWrites.append(capturePaused)
        peripheral.writeValue(Data([capturePaused ? 0 : 1]), for: characteristic, type: .withResponse)
    }

    private var currentCodec: OmiBLEProtocol.Codec?

    #if DEBUG
    private var testReconnectAfter = Date.distantPast
    func interruptLinkForDeviceTest() {
        guard let peripheral, peripheral.state == .connected else { return }
        if ProcessInfo.processInfo.arguments.contains("--trace-prompts-test") {
            testReconnectAfter = Date().addingTimeInterval(5)
        } else if ProcessInfo.processInfo.arguments.contains("--trace-sd-test") {
            testReconnectAfter = Date().addingTimeInterval(38)
        }
        central?.cancelPeripheralConnection(peripheral)
    }
    #endif

    func start() {
        guard central == nil else { return }
        controlObserver = NotificationCenter.default.addObserver(forName: .traceControlsChanged, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.synchronizeControls() }
        }
        promptObserver = NotificationCenter.default.addObserver(forName: .traceSpokenPromptsChanged, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.synchronizePrompts() }
        }
        central = CBCentralManager(
            delegate: self,
            queue: .main,
            options: [CBCentralManagerOptionRestoreIdentifierKey: "com.uscabayaosj.trace.central"]
        )
    }

    func scan() {
        guard let central, central.state == .poweredOn else {
            onState?("Bluetooth is unavailable")
            return
        }
        if let peripheral, peripheral.state == .connected {
            connect(peripheral)
            return
        }
        MainActor.assumeIsolated { onScanStarted?() }
        let services: [CBUUID]? = [CBUUID(string: OmiBLEProtocol.serviceUUID)]
        central.scanForPeripherals(
            withServices: services,
            options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
        )
        onState?("Searching for DevKit2…")
    }

    func pair(_ candidate: DiscoveredPendant) {
        guard candidate.advertisesOmiAudio else {
            onState?("This device does not advertise TRACE-compatible audio")
            return
        }
        guard let central else { return }
        central.stopScan()
        UserDefaults.standard.set(candidate.id.uuidString, forKey: pairedPeripheralKey)
        connect(candidate.peripheral)
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            reconnectPairedPeripheral()
        case .poweredOff, .unauthorized, .unsupported, .resetting:
            onState?("Bluetooth is off or unavailable")
        case .unknown:
            onState?("Starting Bluetooth…")
        @unknown default:
            onState?("Bluetooth state is unknown")
        }
    }

    func centralManager(_ central: CBCentralManager, willRestoreState state: [String: Any]) {
        guard let restored = (state[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral])?.first else {
            return
        }
        peripheral = restored
        restored.delegate = self
        onState?("Restoring pendant connection…")
        if restored.state == .connected {
            restored.discoverServices([
                CBUUID(string: OmiBLEProtocol.serviceUUID),
                CBUUID(string: OmiBLEProtocol.batteryServiceUUID),
                CBUUID(string: OmiBLEProtocol.traceControlServiceUUID),
                CBUUID(string: DevKitControlProtocol.service),
                CBUUID(string: SDProtocol.serviceUUID),
                CBUUID(string: SpokenPromptProtocol.service),
            ])
        }
    }

    func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        let localName = peripheral.name ?? advertisementData[CBAdvertisementDataLocalNameKey] as? String
        let serviceUUIDs = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []
        let advertisesOmiAudio = serviceUUIDs.contains(CBUUID(string: OmiBLEProtocol.serviceUUID))
        let name = localName ?? "Unknown Bluetooth device"
        let candidate = DiscoveredPendant(peripheral: peripheral, name: name, advertisesOmiAudio: advertisesOmiAudio)
        MainActor.assumeIsolated { onDeviceFound?(candidate) }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        self.peripheral = peripheral
        peripheral.delegate = self
        onState?("Connected; discovering audio service…")
        let requestedServices: [CBUUID] = [
            CBUUID(string: OmiBLEProtocol.serviceUUID),
            CBUUID(string: OmiBLEProtocol.batteryServiceUUID),
                CBUUID(string: OmiBLEProtocol.traceControlServiceUUID),
                CBUUID(string: DevKitControlProtocol.service),
                CBUUID(string: SDProtocol.serviceUUID),
                CBUUID(string: SpokenPromptProtocol.service),
        ]
        peripheral.discoverServices(requestedServices)
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        guard self.peripheral?.identifier == peripheral.identifier else { return }
        guard isPaired(peripheral) else {
            onState?("Connection failed")
            return
        }
        onState?("Connection failed; retrying")
        central.connect(peripheral)
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        guard self.peripheral?.identifier == peripheral.identifier else { return }
        resetPrompts()
        sd.disconnect(); sdCommand = nil; sdResponse = nil
        audioCharacteristic = nil
        controlEvents = nil; controlCommand = nil; lastControlSequence = nil
        onControlsStatus?("DevKit disconnected")
        pendingCaptureWrites.removeAll()
        captureStateCharacteristic = nil
        statsCharacteristic = nil
        statsTimer?.invalidate(); statsTimer = nil
        currentCodec = nil
        onCodec?(nil)
        onBattery?(nil)
        let shouldReconnect = isPaired(peripheral)
        onState?(shouldReconnect ? "Disconnected; waiting to reconnect" : "Disconnected")
        MainActor.assumeIsolated { onDisconnect?() }
        if shouldReconnect {
            #if DEBUG
            if testReconnectAfter > Date() {
                let delay = testReconnectAfter.timeIntervalSinceNow
                testReconnectAfter = .distantPast
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self, weak peripheral] in
                    guard let self, let peripheral, self.isPaired(peripheral) else { return }
                    self.central?.connect(peripheral)
                }
                return
            }
            #endif
            central.connect(peripheral)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard error == nil else {
            onState?("Could not discover pendant services")
            return
        }
        let services = peripheral.services ?? []
        if !services.contains(where: { $0.uuid == CBUUID(string: SpokenPromptProtocol.service) }) { onPromptStatus?("Spoken prompts require TRACE controls v5 firmware") }
        if !services.contains(where: { $0.uuid == CBUUID(string: DevKitControlProtocol.service) }) { onControlsStatus?("Button controls require TRACE controls firmware") }
        guard services.contains(where: { $0.uuid == CBUUID(string: OmiBLEProtocol.serviceUUID) }) else {
            UserDefaults.standard.removeObject(forKey: pairedPeripheralKey)
            onState?("Connected to a device without TRACE audio service")
            central?.cancelPeripheralConnection(peripheral)
            return
        }
        for service in services {
            if service.uuid == CBUUID(string: OmiBLEProtocol.serviceUUID) {
                peripheral.discoverCharacteristics([
                    CBUUID(string: OmiBLEProtocol.audioDataCharacteristicUUID),
                    CBUUID(string: OmiBLEProtocol.audioCodecCharacteristicUUID),
                ], for: service)
            } else if service.uuid == CBUUID(string: SpokenPromptProtocol.service) {
                peripheral.discoverCharacteristics([CBUUID(string: SpokenPromptProtocol.command), CBUUID(string: SpokenPromptProtocol.events)], for: service)
            } else if service.uuid == CBUUID(string: DevKitControlProtocol.service) {
                peripheral.discoverCharacteristics([CBUUID(string: DevKitControlProtocol.events), CBUUID(string: DevKitControlProtocol.command)], for: service)
            } else if service.uuid == CBUUID(string: SDProtocol.serviceUUID) {
                peripheral.discoverCharacteristics([CBUUID(string: SDProtocol.commandUUID), CBUUID(string: SDProtocol.responseUUID)], for: service)
            } else if service.uuid == CBUUID(string: OmiBLEProtocol.traceControlServiceUUID) {
                peripheral.discoverCharacteristics([CBUUID(string: OmiBLEProtocol.traceCaptureStateCharacteristicUUID), CBUUID(string: OmiBLEProtocol.traceStatsCharacteristicUUID)], for: service)
            } else if service.uuid == CBUUID(string: OmiBLEProtocol.batteryServiceUUID) {
                peripheral.discoverCharacteristics([
                    CBUUID(string: OmiBLEProtocol.batteryLevelCharacteristicUUID),
                ], for: service)
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard error == nil else {
            onState?("Could not discover pendant characteristics")
            return
        }
        if service.uuid == CBUUID(string: SpokenPromptProtocol.service) {
            promptCommand = service.characteristics?.first { $0.uuid == CBUUID(string: SpokenPromptProtocol.command) }
            promptEvents = service.characteristics?.first { $0.uuid == CBUUID(string: SpokenPromptProtocol.events) }
            if let events = promptEvents {
                peripheral.readValue(for: events)
                if events.isNotifying { synchronizePrompts() }
                else { peripheral.setNotifyValue(true, for: events) }
            }
            return
        }
        if service.uuid == CBUUID(string: SDProtocol.serviceUUID) {
            sdCommand = service.characteristics?.first { $0.uuid == CBUUID(string: SDProtocol.commandUUID) }
            sdResponse = service.characteristics?.first { $0.uuid == CBUUID(string: SDProtocol.responseUUID) }
            if let sdCommand, let sdResponse { sd.attach(peripheral, command: sdCommand, response: sdResponse); onSDReady?() }
            return
        }
        if service.uuid == CBUUID(string: DevKitControlProtocol.service) {
            controlCommand = service.characteristics?.first { $0.uuid == CBUUID(string: DevKitControlProtocol.command) }
            controlEvents = service.characteristics?.first { $0.uuid == CBUUID(string: DevKitControlProtocol.events) }
            if let events = controlEvents {
                if events.isNotifying { synchronizeControls() }
                else { peripheral.setNotifyValue(true, for: events) }
            }
            if let command = controlCommand { peripheral.readValue(for: command) }
            return
        }
        for characteristic in service.characteristics ?? [] {
            if characteristic.uuid == CBUUID(string: OmiBLEProtocol.traceStatsCharacteristicUUID) {
                statsCharacteristic = characteristic
                peripheral.readValue(for: characteristic)
                statsTimer?.invalidate()
                statsTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
                    MainActor.assumeIsolated {
                        guard let self, let peripheral = self.peripheral, peripheral.state == .connected, let stats = self.statsCharacteristic else { return }
                        peripheral.readValue(for: stats)
                    }
                }
            } else if characteristic.uuid == CBUUID(string: OmiBLEProtocol.traceCaptureStateCharacteristicUUID) {
                captureStateCharacteristic = characteristic
                synchronizeCaptureIndicator()
            } else if characteristic.uuid == CBUUID(string: OmiBLEProtocol.audioCodecCharacteristicUUID) {
                peripheral.readValue(for: characteristic)
            } else if characteristic.uuid == CBUUID(string: OmiBLEProtocol.audioDataCharacteristicUUID) {
                audioCharacteristic = characteristic
            } else if characteristic.uuid == CBUUID(string: OmiBLEProtocol.batteryLevelCharacteristicUUID) {
                peripheral.readValue(for: characteristic)
                peripheral.setNotifyValue(true, for: characteristic)
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        if characteristic.uuid == CBUUID(string: SpokenPromptProtocol.events) {
            guard error == nil, let value = characteristic.value, let event = PromptPlaybackEvent(data: value) else { return }
            if event.phase > 0, event.sequence != promptSequence {
                promptSequence = event.sequence; onPromptEvent?(event)
            }
            return
        }
        if characteristic.uuid == CBUUID(string: SDProtocol.responseUUID) { sd.didRead(characteristic.value, error: error); return }
        guard error == nil, let value = characteristic.value else { return }
        if characteristic.uuid == CBUUID(string: DevKitControlProtocol.command) {
            guard value.count == 3, value[0] == 1 else { onControlsStatus?("Unsupported controls firmware"); return }
            let haptic = value[1] & 1 != 0
            onControlsStatus?("Button connected · vibration \(haptic ? "available" : "unavailable")")
        } else if characteristic.uuid == CBUUID(string: DevKitControlProtocol.events) {
            guard value.count == 14, value[0] == 1, DevKitControlPreferences.shared.enabled else { return }
            let sequence = (0..<4).reduce(UInt32(0)) { $0 | UInt32(value[2 + $1]) << ($1 * 8) }
            guard sequence != lastControlSequence else { return }
            lastControlSequence = sequence
            let kind = value[1]
            // Ignore retired motion requests from older controls firmware.
            guard kind == 1 || kind == 2 || kind == 4 else { return }
            if kind == 2 {
                guard Date.now.timeIntervalSince(lastControlAction) > 2 else { return }
                lastControlAction = .now
            }
            onControlEvent?(kind)
        } else if characteristic.uuid == CBUUID(string: OmiBLEProtocol.traceStatsCharacteristicUUID) {
            if let stats = FirmwareCaptureStats(data: value) { MainActor.assumeIsolated { onFirmwareStats?(stats) } }
        } else if characteristic.uuid == CBUUID(string: OmiBLEProtocol.audioCodecCharacteristicUUID) {
            let codec = OmiBLEProtocol.Codec.characteristicValue(value)
            currentCodec = codec
            onCodec?(codec)
            guard codec?.isSupportedForOpusCapture == true, let audioCharacteristic else {
                onState?("Unsupported or missing audio codec")
                return
            }
            if audioCharacteristic.isNotifying {
                // Restored subscriptions may already be active, so no new
                // notification-state callback is needed to become ready.
                onState?("Connected; capturing to this iPhone")
            } else {
                peripheral.setNotifyValue(true, for: audioCharacteristic)
            }
        } else if characteristic.uuid == CBUUID(string: OmiBLEProtocol.audioDataCharacteristicUUID) {
            onRawAudioNotification?(value, currentCodec?.isSupportedForOpusCapture == true)
            guard let currentCodec, currentCodec.isSupportedForOpusCapture else { return }
            MainActor.assumeIsolated { onAudioNotification?(value, currentCodec) }
        } else if characteristic.uuid == CBUUID(string: OmiBLEProtocol.batteryLevelCharacteristicUUID) {
            onBattery?(value.first.map(Int.init))
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        if characteristic.uuid == CBUUID(string: SpokenPromptProtocol.command), !promptWrites.isEmpty {
            let callback = promptWrites.removeFirst(); callback?(error == nil); return
        }
        if characteristic.uuid == CBUUID(string: SDProtocol.commandUUID) { sd.didWrite(error) }
        if characteristic.uuid == CBUUID(string: OmiBLEProtocol.traceCaptureStateCharacteristicUUID), !pendingCaptureWrites.isEmpty {
            let paused = pendingCaptureWrites.removeFirst()
            if error == nil {
                if paused { onPauseAcknowledged?() }
                onCaptureAcknowledged?(paused)
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        if characteristic.uuid == CBUUID(string: SpokenPromptProtocol.events) {
            if error == nil, characteristic.isNotifying { synchronizePrompts() }
            else { onPromptStatus?("Spoken prompt subscription failed") }
            return
        }
        if characteristic.uuid == CBUUID(string: DevKitControlProtocol.events) {
            if error == nil, characteristic.isNotifying { synchronizeControls() }
            else { onControlsStatus?("DevKit control subscription failed") }
            return
        }
        if characteristic.uuid == CBUUID(string: OmiBLEProtocol.audioDataCharacteristicUUID) {
            if error == nil, characteristic.isNotifying {
                onState?("Connected; capturing to this iPhone")
            } else {
                onState?("Audio notification subscription failed")
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didModifyServices invalidatedServices: [CBService]) {
        resetPrompts()
        sd.disconnect(); sdCommand = nil; sdResponse = nil
        audioCharacteristic = nil
        controlEvents = nil; controlCommand = nil; lastControlSequence = nil
        onControlsStatus?("DevKit disconnected")
        pendingCaptureWrites.removeAll()
        captureStateCharacteristic = nil
        statsCharacteristic = nil
        statsTimer?.invalidate(); statsTimer = nil
        currentCodec = nil
        peripheral.discoverServices([
            CBUUID(string: OmiBLEProtocol.serviceUUID),
            CBUUID(string: OmiBLEProtocol.batteryServiceUUID),
            CBUUID(string: OmiBLEProtocol.traceControlServiceUUID),
                CBUUID(string: DevKitControlProtocol.service),
            CBUUID(string: SDProtocol.serviceUUID),
                CBUUID(string: SpokenPromptProtocol.service),
        ])
    }

    private func connect(_ peripheral: CBPeripheral) {
        let previous = self.peripheral
        self.peripheral = peripheral
        if let previous, previous.identifier != peripheral.identifier {
            central?.cancelPeripheralConnection(previous)
            resetPrompts()
        sd.disconnect(); sdCommand = nil; sdResponse = nil
            audioCharacteristic = nil
        controlEvents = nil; controlCommand = nil; lastControlSequence = nil
        onControlsStatus?("DevKit disconnected")
            pendingCaptureWrites.removeAll()
            statsCharacteristic = nil
            statsTimer?.invalidate(); statsTimer = nil
            captureStateCharacteristic = nil
            currentCodec = nil
        }
        peripheral.delegate = self
        if peripheral.state == .connected {
            onState?("Connected; discovering audio service…")
            peripheral.discoverServices([
                CBUUID(string: OmiBLEProtocol.serviceUUID),
                CBUUID(string: OmiBLEProtocol.batteryServiceUUID),
                CBUUID(string: OmiBLEProtocol.traceControlServiceUUID),
                CBUUID(string: DevKitControlProtocol.service),
                CBUUID(string: SDProtocol.serviceUUID),
                CBUUID(string: SpokenPromptProtocol.service),
            ])
            return
        }
        onState?("Connecting…")
        central?.connect(peripheral)
    }

    private func isPaired(_ peripheral: CBPeripheral) -> Bool {
        UserDefaults.standard.string(forKey: pairedPeripheralKey) == peripheral.identifier.uuidString
    }

    private func reconnectPairedPeripheral() {
        guard let raw = UserDefaults.standard.string(forKey: pairedPeripheralKey),
              let id = UUID(uuidString: raw),
              let central else {
            onState?("Pair an Omi DevKit2 to begin")
            return
        }
        if let saved = central.retrievePeripherals(withIdentifiers: [id]).first {
            connect(saved)
        } else {
            onState?("Paired pendant not found; scan to reconnect")
        }
    }
}
