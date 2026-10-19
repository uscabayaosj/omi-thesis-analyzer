import Foundation

/// trace-live-stats5 counters. Cumulative since boot, uint32 wrap is possible.
/// Fields are atomically read individually; snapshot is not globally frozen.
public struct FirmwareCaptureStats: Sendable, Equatable {
    public static let names = ["uptimeMilliseconds", "pdmSamples", "pdmErrors", "pcmAcceptedSamples", "pcmDroppedSamples", "encodedFrames", "encoderFailures", "txQueuedFrames", "txDroppedFrames", "bleSentFrames", "bleNotifyFailures"]
    public let counters: [String: UInt32]
    public init?(data: Data) {
        guard data.count == 48 else { return nil }
        let bytes = Array(data)
        func word(_ offset: Int) -> UInt32 {
            (0..<4).reduce(UInt32(0)) { $0 | UInt32(bytes[offset + $1]) << ($1 * 8) }
        }
        guard word(0) == 1 else { return nil }
        counters = Dictionary(uniqueKeysWithValues: Self.names.enumerated().map { ($0.element, word(4 + $0.offset * 4)) })
    }
}
