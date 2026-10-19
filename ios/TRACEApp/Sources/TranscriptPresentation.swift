import Foundation

/// A reversible display projection. Stored words, times and speaker evidence
/// are never edited by paragraph layout or the Estimated speakers toggle.
enum TranscriptPresentation {
    struct Block: Identifiable {
        let id: Int
        var text: String
        let speakerLabel: String?
        let start: Double?
        var end: Double?
        var segmentIndices: [Int] = []
        var timestamp: String? {
            guard let start, start.isFinite, start >= 0 else { return nil }
            let seconds = Int(min(start, Double(Int.max / 2)))
            return String(format: "%d:%02d", seconds / 60, seconds % 60)
        }
    }

    static func blocks(_ segments: [NativeTranscriptSegment], estimatedSpeakers: Bool) -> [Block] {
        var result: [Block] = []
        var ordinals: [String: Int] = [:]
        var previousKey: String?
        for (index, segment) in segments.enumerated() {
            let text = segment.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { continue }
            let scope = segment.speakerIDScope ?? "legacy"
            let voice = segment.speakerID.flatMap { $0 >= 0 ? "\(scope):\($0)" : nil }
            let confirmedName = segment.speakerConfirmed == true ? segment.speakerName?.trimmingCharacters(in: .whitespacesAndNewlines) : nil
            let label: String?
            let key: String?
            if !estimatedSpeakers { label = nil; key = nil }
            else if let name = confirmedName, !name.isEmpty {
                label = name; key = "confirmed:\(voice ?? String(index)):\(name)"
            } else if segment.speakerStatus == "unknown" || voice == nil {
                if segment.voiceMatchStatus == "rejected" { label = "Unknown speaker"; key = "rejected:\(index)" }
                else { label = "Unknown speaker"; key = "unknown:\(index)" }
            } else if segment.voiceMatchStatus == "rejected" {
                label = "Unknown speaker"; key = "rejected:\(index)"
            } else if segment.voiceMatchStatus == "suggested", let name = segment.speakerName, !name.isEmpty {
                label = segment.speakerPersonID == "self" ? "Possibly you" : "Possibly \(name)"; key = "suggested:\(segment.voiceProfileID ?? name)"
            } else if segment.speakerStatus == "uncertain" {
                label = "Speaker uncertain"; key = "uncertain:\(index)"
            } else if let voice {
                if ordinals[voice] == nil { ordinals[voice] = ordinals.count + 1 }
                let suffix = segment.speakerStatus == "estimated" ? "" : " (unverified)"
                label = "Estimated speaker \(ordinals[voice]!)\(suffix)"; key = voice
            } else { label = "Unknown speaker"; key = "unknown:\(index)" }
            let gap: Double = {
                guard let start = segment.start, let end = result.last?.end,
                      start.isFinite, end.isFinite else { return 0 }
                return start - end
            }()
            // Bound paragraph length and preserve pause/turn boundaries.
            if let last = result.last, last.text.count + text.count < 600, last.segmentIndices.count < 100, gap <= 8,
               !estimatedSpeakers || previousKey == key {
                result[result.count - 1].text += " " + text
                result[result.count - 1].end = segment.end
                result[result.count - 1].segmentIndices.append(index)
            } else {
                result.append(Block(id: index, text: text, speakerLabel: label, start: segment.start, end: segment.end, segmentIndices: [index]))
            }
            previousKey = key
        }
        return result
    }
}
