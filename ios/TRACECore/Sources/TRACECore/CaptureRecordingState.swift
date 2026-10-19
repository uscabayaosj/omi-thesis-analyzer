import Foundation

/// Recording is reported only after a recent successful local audio write.
public enum CaptureRecordingState: String, Sendable {
    case paused = "Paused"
    case waitingForDevice = "Waiting for DevKit2"
    case waitingForAudio = "Waiting for audio"
    case recording = "Recording"
    case interrupted = "Audio interrupted"
    case storageFailure = "Recording unavailable"

    public static func resolve(paused: Bool, connected: Bool, lastSavedAudioAt: Date?, now: Date, storageAvailable: Bool) -> Self {
        if paused { return .paused }
        if !storageAvailable { return .storageFailure }
        guard connected else { return lastSavedAudioAt == nil ? .waitingForDevice : .interrupted }
        guard let lastSavedAudioAt else { return .waitingForAudio }
        let age = now.timeIntervalSince(lastSavedAudioAt)
        return age >= 0 && age <= 3 ? .recording : .interrupted
    }

    public var message: String {
        switch self {
        case .paused: "Resume to save audio from your DevKit2."
        case .waitingForDevice: "Capture is ready, but no audio is being saved. Connect your DevKit2 below."
        case .waitingForAudio: "DevKit2 is connected. Recording starts when audio arrives."
        case .recording: "Audio is being saved on this iPhone. Live text and the saved conversation appear as processing completes."
        case .interrupted: "No new audio is being saved right now. Earlier audio remains on this iPhone. Check your DevKit2 connection."
        case .storageFailure: "Audio could not be saved locally. Pause capture and check the recording error below before resuming."
        }
    }
}
