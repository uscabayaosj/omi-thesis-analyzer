import XCTest
@testable import TRACE

final class TranscriptPresentationTests: XCTestCase {
    private func decode(_ json: String) throws -> [NativeTranscriptSegment] {
        let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode([NativeTranscriptSegment].self, from: Data(json.utf8))
    }
    func testActualAPISpeakerKeysDecodeAndMissingSpeakerStaysNil() throws {
        let segments = try decode(#"[{"text":"Hello","speaker_id":0,"speaker_id_scope":"a","speaker_status":"estimated","speaker_confidence":0.9},{"text":"Unknown"}]"#)
        XCTAssertEqual(segments[0].speakerID, 0)
        XCTAssertEqual(segments[0].speakerIDScope, "a")
        XCTAssertEqual(segments[0].speakerConfidence, 0.9)
        XCTAssertNil(segments[1].speakerID)
    }
    func testReadableDefaultKeepsWordsAndHidesEvenConfirmedNames() throws {
        let segments = try decode(#"[{"text":"First sentence.","speaker_id":0,"speaker_name":"Alex","speaker_confirmed":true,"start":0,"end":2},{"text":"Second sentence.","speaker_id":1,"start":2,"end":4}]"#)
        let blocks = TranscriptPresentation.blocks(segments, estimatedSpeakers: false)
        XCTAssertEqual(blocks.map(\.text), ["First sentence. Second sentence."])
        XCTAssertNil(blocks[0].speakerLabel)
        XCTAssertEqual(blocks[0].timestamp, "0:00")
        XCTAssertEqual(segments[0].text, "First sentence.")
    }
    func testSpeakerTurnsGroupConsecutiveVoiceOnly() throws {
        let segments = try decode(#"[{"text":"A.","speaker_id":0,"speaker_status":"estimated"},{"text":"Again.","speaker_id":0,"speaker_status":"estimated"},{"text":"B.","speaker_id":1,"speaker_status":"estimated"},{"text":"A returns.","speaker_id":0,"speaker_status":"estimated"}]"#)
        let blocks = TranscriptPresentation.blocks(segments, estimatedSpeakers: true)
        XCTAssertEqual(blocks.map(\.text), ["A. Again.", "B.", "A returns."])
        XCTAssertEqual(blocks.map(\.speakerLabel), ["Estimated speaker 1", "Estimated speaker 2", "Estimated speaker 1"])
    }
    func testUnknownAndLowConfidenceNeverReceiveIdentities() throws {
        let segments = try decode(#"[{"text":"Quiet.","speaker_id":0,"speaker_status":"uncertain","speaker_name":"Guessed Alex"},{"text":"Unknown.","speaker_status":"unknown"},{"text":"Legacy.","speaker_id":7},{"text":"Confirmed.","speaker_id":1,"speaker_name":"Alex","speaker_confirmed":true}]"#)
        let blocks = TranscriptPresentation.blocks(segments, estimatedSpeakers: true)
        XCTAssertEqual(blocks.map(\.speakerLabel), ["Speaker uncertain", "Unknown speaker", "Estimated speaker 1 (unverified)", "Alex"])
    }
    func testScopesCannotAccidentallyMergeTheSameProviderNumber() throws {
        let segments = try decode(#"[{"text":"A.","speaker_id":0,"speaker_id_scope":"a","speaker_status":"estimated"},{"text":"B.","speaker_id":0,"speaker_id_scope":"b","speaker_status":"estimated"}]"#)
        XCTAssertEqual(TranscriptPresentation.blocks(segments, estimatedSpeakers: true).map(\.speakerLabel), ["Estimated speaker 1", "Estimated speaker 2"])
    }
    func testParagraphBreaksAtPauseWithoutRemovingWords() throws {
        let segments = try decode(#"[{"text":"Before.","start":0,"end":1},{"text":"After.","start":12,"end":13}]"#)
        let blocks = TranscriptPresentation.blocks(segments, estimatedSpeakers: false)
        XCTAssertEqual(blocks.map(\.text), ["Before.", "After."])
        XCTAssertEqual(blocks.map(\.timestamp), ["0:00", "0:12"])
    }
}
