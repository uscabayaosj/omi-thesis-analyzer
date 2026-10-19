import Foundation

/// Counts every saved packet while limiting foreground UI publication. Disk
/// writing must remain independent of whether this gate allows an update.
public struct CaptureTelemetryGate: Sendable {
    public private(set) var frames = 0
    private var lastPublication: Date?
    public init() {}
    public mutating func recordFrame(at date: Date, foreground: Bool) -> Bool {
        frames += 1
        guard foreground else { return false }
        guard lastPublication.map({ date.timeIntervalSince($0) >= 1 }) ?? true else { return false }
        lastPublication = date
        return true
    }
    public mutating func foregroundSnapshot(at date: Date) -> Int {
        lastPublication = date
        return frames
    }
}
