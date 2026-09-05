import CoreBluetooth
import Foundation

/// Keeps the pendant connected and hands its audio frames upward. State
/// restoration + the bluetooth-central background mode are what let iOS
/// relaunch this object to deliver packets after the app was suspended.
/// UUIDs and framing: sdks/device/PROTOCOL.md in BasedHardware/omi.
final class PendantConnection: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    static let shared = PendantConnection()

    static let omiService = CBUUID(string: "19b10000-e8f2-537e-4f6c-d104768a1214")
    static let audioData = CBUUID(string: "19b10001-e8f2-537e-4f6c-d104768a1214")
    static let audioCodec = CBUUID(string: "19b10002-e8f2-537e-4f6c-d104768a1214")
    static let batteryService = CBUUID(string: "180f")
    static let batteryLevel = CBUUID(string: "2a19")
    private static let packetHeaderBytes = 3

    var onFrame: ((Data) -> Void)?
    var onCodec: ((UInt8) -> Void)?
    var onBattery: ((Int) -> Void)?
    var onState: ((String) -> Void)?
    var onDisconnect: (() -> Void)?

    private var central: CBCentralManager!
    private var peripheral: CBPeripheral?
    private var scanHandler: ((CBPeripheral) -> Void)?

    func start() {
        guard central == nil else { reconnectIfPaired(); return }
        central = CBCentralManager(delegate: self, queue: nil,
                                   options: [CBCentralManagerOptionRestoreIdentifierKey: "trace.capture.central"])
    }

    func startScan(found: @escaping (CBPeripheral) -> Void) {
        scanHandler = found
        guard let central, central.state == .poweredOn else { return }
        central.scanForPeripherals(withServices: [Self.omiService])
        onState?("Looking for a pendant…")
    }

    func pair(_ p: CBPeripheral) {
        central?.stopScan()
        scanHandler = nil
        CaptureSettings.peripheralId = p.identifier
        connect(p)
    }

    private func reconnectIfPaired() {
        guard let central, central.state == .poweredOn, let id = CaptureSettings.peripheralId else {
            onState?(CaptureSettings.peripheralId == nil ? "No pendant paired" : "Bluetooth is off")
            return
        }
        if let p = central.retrievePeripherals(withIdentifiers: [id]).first {
            connect(p)
        } else {
            onState?("Pendant not found — scanning")
            startScan { [weak self] p in if p.identifier == id { self?.pair(p) } }
        }
    }

    private func connect(_ p: CBPeripheral) {
        peripheral = p
        p.delegate = self
        onState?("Connecting…")
        central?.connect(p) // pending connects survive out-of-range and suspension
    }

    // MARK: CBCentralManagerDelegate

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn { reconnectIfPaired() } else { onState?("Bluetooth is off") }
    }

    func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        if let restored = (dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral])?.first {
            peripheral = restored
            restored.delegate = self
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        scanHandler?(peripheral)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        onState?("Connected")
        peripheral.discoverServices([Self.omiService, Self.batteryService])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        onState?("Could not connect — retrying")
        central.connect(peripheral)
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        onState?("Disconnected — reconnecting")
        onDisconnect?()
        central.connect(peripheral)
    }

    // MARK: CBPeripheralDelegate

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        for s in peripheral.services ?? [] {
            if s.uuid == Self.omiService { peripheral.discoverCharacteristics([Self.audioData, Self.audioCodec], for: s) }
            if s.uuid == Self.batteryService { peripheral.discoverCharacteristics([Self.batteryLevel], for: s) }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        for c in service.characteristics ?? [] {
            switch c.uuid {
            case Self.audioCodec: peripheral.readValue(for: c)
            case Self.audioData: peripheral.setNotifyValue(true, for: c)
            case Self.batteryLevel:
                peripheral.readValue(for: c)
                peripheral.setNotifyValue(true, for: c)
            default: break
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let value = characteristic.value else { return }
        switch characteristic.uuid {
        case Self.audioCodec:
            if let codec = value.first { onCodec?(codec) }
        case Self.audioData:
            guard value.count > Self.packetHeaderBytes else { return }
            onFrame?(value.subdata(in: Self.packetHeaderBytes..<value.count))
        case Self.batteryLevel:
            if let level = value.first { onBattery?(Int(level)) }
        default: break
        }
    }
}
