import SwiftUI
import UserNotifications

@MainActor
@Observable
final class NativeReminderPreferences {
    static let shared = NativeReminderPreferences()
    private let enabledKey = "trace.dailyReminder.enabled"
    private let hourKey = "trace.dailyReminder.hour"
    private let minuteKey = "trace.dailyReminder.minute"

    var isEnabled = UserDefaults.standard.bool(forKey: "trace.dailyReminder.enabled")
    var time: Date = {
        var components = DateComponents()
        components.hour = UserDefaults.standard.object(forKey: "trace.dailyReminder.hour") as? Int ?? 21
        components.minute = UserDefaults.standard.object(forKey: "trace.dailyReminder.minute") as? Int ?? 0
        return Calendar.current.date(from: components) ?? .now
    }()
    var message: String?
    private var permissionGeneration = UUID()
    private let permission: () async throws -> Bool
    init(permission: @escaping () async throws -> Bool = {
        try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
    }) { self.permission = permission }

    func setTime(_ value: Date) {
        time = value
        let parts = Calendar.current.dateComponents([.hour, .minute], from: value)
        UserDefaults.standard.set(parts.hour ?? 21, forKey: hourKey)
        UserDefaults.standard.set(parts.minute ?? 0, forKey: minuteKey)
        if isEnabled { schedule() }
    }

    func setEnabled(_ enabled: Bool) async {
        let generation = UUID(); permissionGeneration = generation
        message = nil
        isEnabled = enabled
        if !enabled { UserDefaults.standard.set(false, forKey: enabledKey) }
        if enabled {
            do {
                let accepted = try await permission()
                guard generation == permissionGeneration else { return }
                guard accepted else {
                    isEnabled = false
                    UserDefaults.standard.set(false, forKey: enabledKey)
                    message = "Allow notifications for TRACE in iOS Settings to turn on this reminder."
                    return
                }
            } catch {
                guard generation == permissionGeneration else { return }
                isEnabled = false
                UserDefaults.standard.set(false, forKey: enabledKey)
                message = error.localizedDescription
                return
            }
        }
        isEnabled = enabled
        UserDefaults.standard.set(enabled, forKey: enabledKey)
        if enabled { schedule() }
        else { UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [Self.identifier]) }
    }

    func scheduleNextDay() {
        guard isEnabled else { return }
        schedule()
    }

    private static let identifier = "trace.daily-rollup-reminder"

    private func schedule() {
        let components = Calendar.current.dateComponents([.hour, .minute], from: time)
        let content = UNMutableNotificationContent()
        content.title = "TRACE · Daily review"
        content.body = "Take a moment for your daily TRACE review."
        content.sound = .default
        content.userInfo = ["route": "today"]
        let trigger = UNCalendarNotificationTrigger(dateMatching: DateComponents(hour: components.hour, minute: components.minute), repeats: true)
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [Self.identifier])
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: Self.identifier, content: content, trigger: trigger)) { [weak self] error in
            guard let error else { return }
            Task { @MainActor in self?.message = error.localizedDescription }
        }
    }
}

struct NativeReminderView: View {
    @State private var preferences = NativeReminderPreferences.shared

    var body: some View {
        Form {
            Section {
                Toggle("Remind me each day", isOn: Binding(
                    get: { preferences.isEnabled },
                    set: { enabled in Task { await preferences.setEnabled(enabled) } }
                ))
                DatePicker("Reminder time", selection: Binding(
                    get: { preferences.time },
                    set: { preferences.setTime($0) }
                ), displayedComponents: .hourAndMinute)
                    .disabled(!preferences.isEnabled)
            } header: {
                Text("Daily reminder")
            } footer: {
                Text("Open Today to review your commitments. This private reminder runs on this iPhone at the selected time each day.")
            }
            if let message = preferences.message {
                Section("Notification setting") { Text(message).foregroundStyle(.secondary) }
            }
        }
        .navigationTitle("Reminders")
        .navigationBarTitleDisplayMode(.inline)
        .task { preferences.scheduleNextDay() }
    }
}
