import Foundation

/// TRACE led4 numbers BLE notifications, not microphone frames. Device-side
/// drops before numbering cannot be detected with this sequence alone.
public struct AudioSequenceTracker: Sendable {
    public private(set) var notifications = 0
    public private(set) var missingNotifications = 0
    public private(set) var duplicates = 0
    public private(set) var discontinuities = 0
    public private(set) var fragments = 0
    private var previous: UInt16?

    public init() {}
    public mutating func resetBoundary() { previous = nil }
    public mutating func record(_ data: Data) {
        guard data.count > 3 else { return }
        let bytes = Array(data.prefix(3))
        let sequence = UInt16(bytes[0]) | UInt16(bytes[1]) << 8
        notifications += 1
        if bytes[2] != 0 { fragments += 1 }
        if let previous {
            let distance = sequence &- previous
            if distance == 0 { duplicates += 1 }
            else if distance < 32768 { missingNotifications += Int(distance) - 1 }
            else { discontinuities += 1 }
        }
        previous = sequence
    }
}
