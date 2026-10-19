import Foundation

/// Controls admission of the final Bluetooth frames when Pause is requested.
public struct CaptureBoundaryDrain: Sendable {
    public enum Outcome: String, Sendable { case sampledSettled, timedOut, disconnected }
    public private(set) var mayAcceptAudio = true
    public private(set) var outcome: Outcome?
    private var requestedAt: TimeInterval?
    private var acknowledged = false
    private var lastAudioAt: TimeInterval?
    private var stableSince: TimeInterval?
    private var lastSignature: [UInt32]?
    private var lastFirmwareAt: TimeInterval?
    private var queueDrained = false
    public init() {}
    public mutating func requestPause(at: TimeInterval) { requestedAt = at }
    public mutating func acknowledgePause() { acknowledged = true }
    public mutating func receivedAudio(at: TimeInterval) { lastAudioAt = at }
    public mutating func observe(_ stats: FirmwareCaptureStats, at: TimeInterval) {
        guard requestedAt != nil, outcome == nil else { return }
        let names = ["pdmSamples", "pcmAcceptedSamples", "encodedFrames", "txQueuedFrames", "bleSentFrames"]
        let signature = names.map { stats.counters[$0] ?? 0 }
        if signature != lastSignature { stableSince = at; lastSignature = signature }
        lastFirmwareAt = at
        queueDrained = stats.counters["txQueuedFrames"] == stats.counters["bleSentFrames"]
    }
    public mutating func poll(at: TimeInterval) -> Outcome? {
        if let outcome { return outcome }
        guard let requestedAt else { return nil }
        // stats8's main microphone loop runs every 500 ms. Allow a full loop
        // plus encoder/notification tail, then require fresh stable samples.
        // This is sampled quiescence, not an end-to-end delivery acknowledgement.
        if acknowledged, at - requestedAt >= 1,
           let stableSince, at - stableSince >= 0.3,
           let lastFirmwareAt, at - lastFirmwareAt <= 0.25,
           at - (lastAudioAt ?? requestedAt) >= 0.15, queueDrained {
            finish(.sampledSettled)
        } else if at - requestedAt >= 3 { finish(.timedOut) }
        return outcome
    }
    public mutating func disconnected() { finish(.disconnected) }
    private mutating func finish(_ result: Outcome) { outcome = result; mayAcceptAudio = false }
}
