import Foundation

public enum SpokenPrompt: UInt8, CaseIterable, Sendable {
    case connected = 1, disconnected, recordingStarted, paused, lowBattery, summaryCompleted
    public var phrase: String {
        switch self {
        case .connected: "Connected"
        case .disconnected: "Disconnected"
        case .recordingStarted: "Recording started"
        case .paused: "Paused"
        case .lowBattery: "Low battery"
        case .summaryCompleted: "Conversation summary completed"
        }
    }
}

public struct PromptPlaybackEvent: Sendable, Equatable {
    public let phase: UInt8
    public let prompt: SpokenPrompt?
    public let enabled: Bool
    public let preview: Bool
    public let sequence: UInt32
    public let deviceUptimeMilliseconds: UInt64
    public let result: Int32
    public init?(data: Data) {
        let b = Array(data)
        guard b.count == 20, b[0] == 1, b[1] <= 3, b[3] & ~3 == 0 else { return nil }
        let id = SpokenPrompt(rawValue: b[2])
        guard b[1] == 0 ? b[2] == 0 : id != nil else { return nil }
        func word(_ offset: Int) -> UInt32 { (0..<4).reduce(0) { $0 | UInt32(b[offset + $1]) << ($1 * 8) } }
        phase = b[1]; prompt = id; enabled = b[3] & 1 != 0; preview = b[3] & 2 != 0
        sequence = word(4)
        deviceUptimeMilliseconds = UInt64(word(8)) | UInt64(word(12)) << 32
        result = Int32(bitPattern: word(16))
    }
}

/// A completed summary may be announced once while connected, or on reconnect
/// within five minutes. Never replay across installations/workspaces.
public struct SummaryPromptQueue: Codable, Sendable {
    public struct Item: Codable, Sendable, Equatable {
        public let scope: String
        public let conversationID: String
        public let completedAt: Date
        public var key: String { scope + ":" + conversationID }
    }
    public private(set) var pending: [Item] = []
    public private(set) var acknowledged: [String] = []
    public init() {}
    @discardableResult public mutating func completed(scope: String?, conversationID: String?, summaryStatus: String?, now: Date) -> Bool {
        guard summaryStatus == "done", let scope, !scope.isEmpty,
              let id = conversationID, !id.isEmpty else { return false }
        let item = Item(scope: scope, conversationID: id, completedAt: now)
        guard !acknowledged.contains(item.key), !pending.contains(where: { $0.key == item.key }) else { return false }
        pending.append(item); pending = Array(pending.suffix(32)); return true
    }
    public mutating func next(scope: String?, now: Date) -> Item? {
        pending.removeAll { now.timeIntervalSince($0.completedAt) > 300 || now < $0.completedAt.addingTimeInterval(-5) }
        return pending.first { $0.scope == scope }
    }
    public mutating func accepted(_ item: Item) {
        pending.removeAll { $0.key == item.key }
        acknowledged.append(item.key); acknowledged = Array(acknowledged.suffix(512))
    }
}
