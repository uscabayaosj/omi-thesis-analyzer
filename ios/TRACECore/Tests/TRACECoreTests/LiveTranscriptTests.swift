import XCTest
@testable import TRACECore

final class LiveTranscriptTests: XCTestCase {
    private func result(_ text: String, final: Bool, start: Double = 0, duration: Double = 1) throws -> Data {
        try JSONSerialization.data(withJSONObject: ["type": "Results", "is_final": final, "start": start, "duration": duration,
            "channel": ["alternatives": [["transcript": text]]]])
    }

    func testInterimHypothesesReplaceRatherThanDuplicateWords() throws {
        var transcript = LiveTranscriptAccumulator()
        try transcript.receive(result("Hello", final: false))
        try transcript.receive(result("Hello there", final: false))
        XCTAssertEqual(transcript.text, "")
        XCTAssertEqual(transcript.interim, "Hello there")
        try transcript.receive(result("Hello there.", final: true))
        XCTAssertEqual(transcript.text, "Hello there.")
        XCTAssertEqual(transcript.interim, "")
    }

    func testRepeatedFinalResultIsIdempotent() throws {
        var transcript = LiveTranscriptAccumulator()
        let event = try result("Send the notes.", final: true)
        try transcript.receive(event)
        try transcript.receive(event)
        try transcript.receive(result("Tomorrow.", final: true, start: 1))
        XCTAssertEqual(transcript.text, "Send the notes.\nTomorrow.")
    }

    func testNonResultEventsDoNotChangeText() throws {
        var transcript = LiveTranscriptAccumulator()
        try transcript.receive(result("Hello", final: false))
        try transcript.receive(Data("{\"type\":\"Metadata\"}".utf8))
        XCTAssertEqual(transcript.interim, "Hello")
    }
}
