import Foundation
import Observation
import SwiftUI

enum DevKitControlProtocol {
    static let service = "A71C0010-6B8D-4E75-A1B2-7D0E6F545243"
    static let events = "A71C0011-6B8D-4E75-A1B2-7D0E6F545243"
    static let command = "A71C0012-6B8D-4E75-A1B2-7D0E6F545243"
}

@MainActor @Observable final class DevKitControlPreferences {
    static let shared = DevKitControlPreferences()
    var enabled: Bool { didSet { save() } }
    var feedback: Bool { didSet { save() } }
    init() {
        let d = UserDefaults.standard
        enabled = d.object(forKey: "trace.controls.enabled") as? Bool ?? true
        // Retire the saved opt-in when upgrading from build 31.
        d.removeObject(forKey: "trace.controls.motion")
        feedback = d.object(forKey: "trace.controls.feedback") as? Bool ?? true
    }
    var mask: UInt8 { enabled ? (1 | (feedback ? 4 : 0)) : 0 }
    private func save() {
        let d = UserDefaults.standard
        d.set(enabled, forKey: "trace.controls.enabled")
        d.set(feedback, forKey: "trace.controls.feedback")
        NotificationCenter.default.post(name: .traceControlsChanged, object: nil)
    }
}
extension Notification.Name {
    static let traceControlsChanged = Notification.Name("trace.controls.changed")
}

struct ConversationBookmark: Codable, Identifiable {
    let id: UUID
    let recordedAt: Date
    let scope: String?
    var title: String
}

/// Local markers never upload text/audio or enrol a new backend implicitly.
@MainActor @Observable final class ConversationBookmarks {
    static let shared = ConversationBookmarks()
    private(set) var items: [ConversationBookmark] = []
    private(set) var error: String?
    private let url: URL
    private var loadFailed = false
    init() {
        url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("TRACE/Bookmarks.json")
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        do { items = try JSONDecoder().decode([ConversationBookmark].self, from: Data(contentsOf: url)) }
        catch { loadFailed = true; self.error = "Saved bookmarks could not be read. Their original file has been retained." }
    }
    @discardableResult func add(at date: Date) -> Bool {
        let item = ConversationBookmark(id: UUID(), recordedAt: date,
            scope: NativeConnection.shared.captureUploadScope, title: "Important moment")
        return persist(items + [item])
    }
    func remove(_ id: UUID) { _ = persist(items.filter { $0.id != id }) }
    func rename(_ id: UUID, title: String) {
        var changed = items
        guard let index = changed.firstIndex(where: { $0.id == id }) else { return }
        changed[index].title = String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(120))
        if changed[index].title.isEmpty { changed[index].title = "Important moment" }
        _ = persist(changed)
    }
    func within(start: Date, end: Date) -> [ConversationBookmark] {
        items.filter { $0.scope == NativeConnection.shared.captureUploadScope && $0.recordedAt >= start && $0.recordedAt < end }
            .sorted { $0.recordedAt < $1.recordedAt }
    }
    private func persist(_ changed: [ConversationBookmark]) -> Bool {
        guard !loadFailed else { return false }
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(changed).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            items = changed; error = nil; return true
        } catch { self.error = "Bookmark could not be saved: \(error.localizedDescription)"; return false }
    }
}

/// Runtime phone-side health feedback complements firmware SD/transport faults.
/// Timers cannot promise delivery after iOS suspends or terminates TRACE.
@MainActor final class DevKitHealthFeedback {
    var send: ((UInt8) -> Void)?
    private var timer: Timer?
    private var recording = false
    private var lastWrite = Date.now
    private var deadline = Date.distantFuture
    private var gapIncident = false
    private var storageIncident = false
    private var healthySince: Date?
    private var device: UUID?
    private var batteryIncident = false
    func configure(paused: Bool) {
        if !paused && !recording { lastWrite = .now; deadline = Date.now.addingTimeInterval(20); gapIncident = false }
        recording = !paused
        if paused { timer?.invalidate(); timer = nil; gapIncident = false }
        else if timer == nil {
            timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.poll() }
            }
        }
    }
    private func poll() {
        guard recording, !storageIncident, !gapIncident, Date.now >= deadline else { return }
        gapIncident = true; send?(4)
    }
    func savedAudio() {
        lastWrite = .now; deadline = lastWrite.addingTimeInterval(15); gapIncident = false
        if storageIncident {
            if healthySince == nil { healthySince = .now }
            if Date.now.timeIntervalSince(healthySince ?? .now) >= 30 { storageIncident = false }
        }
    }
    func storageFailed() {
        healthySince = nil
        guard !storageIncident else { return }
        storageIncident = true; send?(4)
    }
    func battery(_ level: Int?, device: UUID?) {
        if self.device != device { self.device = device; batteryIncident = false }
        guard let level, device != nil, (0...100).contains(level) else { return }
        if level > 25 { batteryIncident = false }
        else if level <= 20 && !batteryIncident { batteryIncident = true; send?(4) }
    }
}

struct DevKitControlsView: View {
    @State private var preferences = DevKitControlPreferences.shared
    @State private var capture = CaptureModel.shared
    @State private var speech = SpokenPromptPreferences.shared
    var body: some View {
        Form {
            Section {
                Text(capture.devKitControlsStatus).foregroundStyle(.secondary)
                Toggle("Button controls", isOn: $preferences.enabled)
                Toggle("Quiet vibration feedback", isOn: $preferences.feedback).disabled(!preferences.enabled)
            } header: { Text("DevKit controls") }
            footer: { Text("Requires TRACE controls firmware and an active Bluetooth connection.") }
            Section("Tone alerts") {
                Toggle("DevKit tone alerts", isOn: $speech.enabled)
                Text(capture.spokenPromptsStatus).font(.footnote).foregroundStyle(.secondary)
                Text("Short tones at the selected 100% digital signal level. Requires controls-v6 firmware; older firmware may still speak. Summary alerts require the app and wait up to five minutes when disconnected.")
                    .font(.footnote).foregroundStyle(.secondary)
                Text("The microphone keeps recording during tones. Brief beeps may be audible in saved audio; playback windows are logged locally.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("Tone patterns") {
                LabeledContent("Connected", value: "Two rising notes")
                LabeledContent("Disconnected", value: "Two falling notes")
                LabeledContent("Recording started", value: "Two high beeps")
                LabeledContent("Paused", value: "One low beep")
                LabeledContent("Low battery", value: "Three low beeps")
                LabeledContent("Summary completed", value: "Three rising notes")
            }
            Section("Button actions") {
                Label("One button press: bookmark", systemImage: "bookmark")
                Label("Two button presses: pause or resume", systemImage: "pause.circle")
                Text("Hold the button for three seconds to power off. The small RST button is for reset and firmware installation.").font(.footnote)
            }
            Section("Vibration patterns") {
                Text("One short pulse: bookmark saved\nOne longer pulse: pause acknowledged\nTwo short pulses: resume acknowledged\nThree longer pulses: check Capture for a problem")
                Text("Fault feedback covers sampled device audio/SD errors, missing audio on the phone, phone storage errors, and low reported DevKit battery. It does not stop capture automatically. Phone-side monitoring depends on TRACE running.").font(.footnote).foregroundStyle(.secondary)
            }
            Section("Bookmarks") {
                Text("Bookmarks appear with conversation audio after wrap-up. They stay on this iPhone and are retained when audio is cleared. Their timestamp is when TRACE receives the button event.").font(.footnote)
            }
        }.navigationTitle("DevKit controls")
    }
}
