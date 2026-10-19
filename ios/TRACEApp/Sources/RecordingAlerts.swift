import SwiftUI
import UserNotifications

@MainActor
@Observable
final class RecordingAlertPreferences {
    static let shared = RecordingAlertPreferences()
    private let defaults = UserDefaults.standard
    var enabled = UserDefaults.standard.bool(forKey: "trace.recordingAlerts.enabled")
    var interruption = UserDefaults.standard.object(forKey: "trace.recordingAlerts.interruption") as? Bool ?? true
    var storage = UserDefaults.standard.object(forKey: "trace.recordingAlerts.storage") as? Bool ?? true
    var battery = UserDefaults.standard.object(forKey: "trace.recordingAlerts.battery") as? Bool ?? true
    var permissionMessage = ""
    var requestingPermission = false
    private var permissionGeneration = UUID()

    func setEnabled(_ value: Bool) async {
        let generation = UUID()
        permissionGeneration = generation
        if !value {
            enabled = false
            defaults.set(false, forKey: "trace.recordingAlerts.enabled")
            CaptureModel.shared.refreshRecordingAlerts()
            return
        }
        requestingPermission = true
        defer { if permissionGeneration == generation { requestingPermission = false } }
        do {
            let allowed = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
            guard permissionGeneration == generation else { return }
            enabled = allowed
            defaults.set(allowed, forKey: "trace.recordingAlerts.enabled")
            CaptureModel.shared.refreshRecordingAlerts()
            await refreshPermission()
        } catch {
            guard permissionGeneration == generation else { return }
            permissionMessage = "Notification permission could not be requested: \(error.localizedDescription)"
        }
    }

    func saveChoices() {
        defaults.set(interruption, forKey: "trace.recordingAlerts.interruption")
        defaults.set(storage, forKey: "trace.recordingAlerts.storage")
        defaults.set(battery, forKey: "trace.recordingAlerts.battery")
        CaptureModel.shared.refreshRecordingAlerts()
    }

    func refreshPermission() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            permissionMessage = settings.alertSetting == .enabled
                ? "Notifications are allowed. Focus, Silent Mode and your iPhone notification settings control presentation and sound."
                : "Notifications are allowed, but banners are disabled in iPhone Settings."
        case .denied:
            permissionMessage = "Notifications are blocked. Allow TRACE notifications in iPhone Settings."
        case .notDetermined:
            permissionMessage = "Turn on recording alerts to allow notifications on this iPhone."
        @unknown default:
            permissionMessage = "Check TRACE notification permission in iPhone Settings."
        }
    }
}

/// Uses a renewable system notification deadline, rather than depending on a
/// foreground timer continuing to run while the phone is locked.
@MainActor
final class RecordingAlerts {
    static let shared = RecordingAlerts()
    private let center = UNUserNotificationCenter.current()
    private let interruptionID = "trace.recording-alert.interruption"
    private let storageID = "trace.recording-alert.storage"
    private let batteryID = "trace.recording-alert.battery"
    private var operations: Task<Void, Never>?
    private var lastRenewal: TimeInterval?
    private var storageIncident = false
    private var healthyWritesSince: TimeInterval?
    private var recording = false
    private var watchdogEnabled = false
    private var hasSavedAudio = false
    private var sdFallback = false
    private var batteryPending: Set<String> = []
    private var batteryReadings: [String: Int] = [:]
    private var generation = UUID()
    private var deviceID: String { UserDefaults.standard.string(forKey: "trace.native.pairedPeripheral") ?? "unpaired" }
    private var lowBatteryKey: String { "trace.recordingAlerts.lowBatteryIncident.\(deviceID)" }

    // Serialize asynchronous adds and removals so a late add cannot resurrect
    // an interruption notification after an intentional Pause or opt-out.
    private func enqueue(_ operation: @escaping @MainActor () async -> Void) {
        let previous = operations
        operations = Task { @MainActor in
            await previous?.value
            await operation()
        }
    }

    func configure(paused: Bool, sdFallback: Bool, batteryLevel: Int?) {
        if !paused && !recording { hasSavedAudio = false }
        recording = !paused
        self.sdFallback = sdFallback
        let preferences = RecordingAlertPreferences.shared
        if !preferences.enabled || !preferences.interruption || paused || storageIncident {
            generation = UUID()
            watchdogEnabled = false
            cancelInterruption()
        } else if !watchdogEnabled {
            watchdogEnabled = true
            renewInterruption(after: 20) // Startup allowance; no recording is inferred.
        }
        if !preferences.enabled || !preferences.storage {
            enqueue { [center, storageID] in center.removePendingNotificationRequests(withIdentifiers: [storageID]) }
        }
        if !preferences.enabled || !preferences.battery {
            enqueue { [center, batteryID] in center.removePendingNotificationRequests(withIdentifiers: [batteryID]) }
        }
        if let batteryLevel { batteryChanged(batteryLevel) }
    }

    func savedAudio() {
        hasSavedAudio = true
        let uptime = ProcessInfo.processInfo.systemUptime
        if storageIncident {
            if healthyWritesSince == nil { healthyWritesSince = uptime }
            if uptime - (healthyWritesSince ?? uptime) >= 30 { storageIncident = false }
        }
        guard recording, !storageIncident else { return }
        let preferences = RecordingAlertPreferences.shared
        guard preferences.enabled, preferences.interruption else { return }
        watchdogEnabled = true
        // At most one notification-center update per five seconds, independent
        // of the foreground telemetry gate and the 100 Hz audio packet stream.
        guard lastRenewal.map({ uptime - $0 >= 5 }) ?? true else { return }
        renewInterruption(after: 15)
    }

    func storageFailed() {
        healthyWritesSince = nil
        generation = UUID()
        watchdogEnabled = false
        cancelInterruption() // Report the concrete storage fault, not two alerts.
        guard !storageIncident else { return }
        storageIncident = true
        let preferences = RecordingAlertPreferences.shared
        guard preferences.enabled, preferences.storage else { return }
        notify(id: storageID, title: "TRACE · Audio could not be saved",
               body: "Pause capture and check the recording error and free space on this iPhone. Earlier saved audio remains available.")
    }

    func batteryChanged(_ level: Int?) {
        guard let level, (0...100).contains(level) else { return }
        let device = deviceID
        batteryReadings[device] = level
        let defaults = UserDefaults.standard
        if level > 25 { defaults.set(false, forKey: lowBatteryKey); return }
        let preferences = RecordingAlertPreferences.shared
        guard preferences.enabled, preferences.battery, level <= 20,
              !defaults.bool(forKey: lowBatteryKey), !batteryPending.contains(device) else { return }
        let key = lowBatteryKey
        batteryPending.insert(device)
        notify(id: batteryID, title: "TRACE · DevKit battery is low",
               body: "Your DevKit reports \(level)% battery. Charge it soon to keep recording.", shouldSend: { [weak self] in
                   self?.deviceID == device && (self?.batteryReadings[device] ?? 100) <= 20
               }, completion: { [weak self] sent in
                   self?.batteryPending.remove(device)
                   if sent { defaults.set(true, forKey: key) }
               })
    }

    private func cancelInterruption() {
        lastRenewal = nil
        enqueue { [center, interruptionID] in
            center.removePendingNotificationRequests(withIdentifiers: [interruptionID])
        }
    }

    private func renewInterruption(after seconds: TimeInterval) {
        lastRenewal = ProcessInfo.processInfo.systemUptime
        let currentGeneration = generation
        let content = UNMutableNotificationContent()
        content.title = "TRACE · No audio reaching this iPhone"
        content.body = sdFallback
            ? "TRACE has stopped saving new audio on this iPhone. Check Capture and your DevKit connection. SD fallback may still be recording on the DevKit."
            : "TRACE has stopped saving new audio on this iPhone. Open Capture and check your DevKit connection. Earlier saved audio remains available."
        if !hasSavedAudio {
            content.body = "TRACE has not saved audio since you resumed capture. Open Capture and check your DevKit connection."
        }
        content.sound = .default
        content.userInfo = ["route": "capture"]
        let request = UNNotificationRequest(identifier: interruptionID, content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: false))
        enqueue { [weak self, center] in
            guard let self, self.generation == currentGeneration, self.recording else { return }
            do { try await center.add(request) }
            catch { RecordingAlertPreferences.shared.permissionMessage = "Could not schedule a recording alert: \(error.localizedDescription)" }
        }
    }

    private func notify(id: String, title: String, body: String,
                        shouldSend: @escaping @MainActor () -> Bool = { true },
                        completion: (@MainActor (Bool) -> Void)? = nil) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = ["route": "capture"]
        let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
        enqueue { [center, storageID] in
            let settings = await center.notificationSettings()
            let preferences = RecordingAlertPreferences.shared
            guard preferences.enabled, id == storageID ? preferences.storage : preferences.battery,
                  settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional || settings.authorizationStatus == .ephemeral,
                  shouldSend() else { completion?(false); return }
            do { try await center.add(request); completion?(true) }
            catch {
                completion?(false)
                preferences.permissionMessage = "Could not send a recording alert: \(error.localizedDescription)"
            }
        }
    }
}

struct RecordingAlertsView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var preferences = RecordingAlertPreferences.shared
    var body: some View {
        Form {
            Section {
                Toggle("Recording alerts", isOn: Binding(get: { preferences.enabled }, set: { value in
                    Task { await preferences.setEnabled(value) }
                })).disabled(preferences.requestingPermission)
                if preferences.requestingPermission { ProgressView("Checking notification permission…") }
            } footer: { Text("Local alerts on this iPhone. Tapping an alert opens Capture.") }
            Section {
                Toggle("Audio interruption", isOn: Binding(get: { preferences.interruption }, set: {
                    preferences.interruption = $0; preferences.saveChoices()
                }))
                Toggle("Audio storage failure", isOn: Binding(get: { preferences.storage }, set: {
                    preferences.storage = $0; preferences.saveChoices()
                }))
                Toggle("Low DevKit battery", isOn: Binding(get: { preferences.battery }, set: {
                    preferences.battery = $0; preferences.saveChoices()
                }))
            } header: { Text("Notify me about") } footer: {
                Text("Audio interruption waits about 15 seconds without saved audio, with a startup allowance. Intentional Pause cancels it. Storage failure alerts once until writes have recovered for 30 seconds. Battery alerts at 20% and rearms above 25%; the DevKit percentage is an estimate.")
            }.disabled(!preferences.enabled)
            Section {
                Text(preferences.permissionMessage).foregroundStyle(.secondary)
                Button("Open iPhone Settings", systemImage: "gearshape") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }
            } header: { Text("Notification permission") } footer: {
                Text("Alerts need notification permission. iOS must receive the relevant device or storage events; Force Quit prevents further monitoring. These alerts cannot guarantee uninterrupted recording.")
            }
        }
        .navigationTitle("Recording alerts")
        .navigationBarTitleDisplayMode(.inline)
        .task { await preferences.refreshPermission() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await preferences.refreshPermission() } }
        }
    }
}
