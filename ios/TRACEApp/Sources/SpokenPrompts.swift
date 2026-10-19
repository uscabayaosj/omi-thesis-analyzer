import Foundation
import Observation

@MainActor @Observable final class SpokenPromptPreferences {
    static let shared = SpokenPromptPreferences()
    var enabled: Bool {
        didSet {
            UserDefaults.standard.set(enabled, forKey: "trace.prompts.enabled")
            NotificationCenter.default.post(name: .traceSpokenPromptsChanged, object: nil)
        }
    }
    private init() { enabled = UserDefaults.standard.object(forKey: "trace.prompts.enabled") as? Bool ?? true }
}
extension Notification.Name {
    static let traceSpokenPromptsChanged = Notification.Name("trace.prompts.changed")
}
enum SpokenPromptProtocol {
    static let service = "A71C0020-6B8D-4E75-A1B2-7D0E6F545243"
    static let command = "A71C0021-6B8D-4E75-A1B2-7D0E6F545243"
    static let events = "A71C0022-6B8D-4E75-A1B2-7D0E6F545243"
}
