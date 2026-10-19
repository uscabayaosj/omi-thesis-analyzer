import Foundation

/// Interim results replace the current hypothesis; only final results become
/// stable text. A repeated final result must not duplicate a spoken passage.
public struct LiveTranscriptAccumulator: Sendable {
    public private(set) var text = ""
    public private(set) var interim = ""
    private var finalizedRanges = Set<String>()
    private var rangeOrder: [String] = []

    public init() {}

    public mutating func receive(_ data: Data) throws {
        let event = try JSONDecoder().decode(Event.self, from: data)
        guard event.type == "Results", let transcript = event.channel?.alternatives.first?.transcript else { return }
        if event.isFinal == true {
            guard let start = event.start, let duration = event.duration, start.isFinite, duration.isFinite,
                  start >= 0, duration >= 0 else { return }
            let key = "\(start):\(duration)"
            guard finalizedRanges.insert(key).inserted else { return }
            rangeOrder.append(key)
            if rangeOrder.count > 3000 { finalizedRanges.remove(rangeOrder.removeFirst()) }
            let words = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
            if !words.isEmpty { text += (text.isEmpty ? "" : "\n") + words }
            if text.count > 50_000 { text = String(text.suffix(50_000)) }
            interim = ""
        } else { interim = String(transcript.prefix(10_000)) }
    }

    private struct Event: Decodable {
        let type: String
        let start: Double?
        let duration: Double?
        let isFinal: Bool?
        let channel: Channel?
        enum CodingKeys: String, CodingKey {
            case type, start, duration, channel
            case isFinal = "is_final"
        }
    }
    private struct Channel: Decodable { let alternatives: [Alternative] }
    private struct Alternative: Decodable { let transcript: String }
}
