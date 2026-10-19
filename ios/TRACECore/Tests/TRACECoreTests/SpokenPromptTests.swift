import XCTest
@testable import TRACECore
final class SpokenPromptTests: XCTestCase {
    func testExactPlaybackLayoutIncludingSignedFailureAnd64BitClock() {
        var data = Data([1, 3, 6, 3])
        for word: UInt32 in [7, 0x12345678, 2, UInt32(bitPattern: -5)] {
            data.append(contentsOf: (0..<4).map { UInt8(truncatingIfNeeded: word >> ($0 * 8)) })
        }
        let event = PromptPlaybackEvent(data: data)
        XCTAssertEqual(event?.prompt, .summaryCompleted)
        XCTAssertEqual(event?.phase, 3); XCTAssertEqual(event?.result, -5)
        XCTAssertEqual(event?.sequence, 7)
        XCTAssertEqual(event?.deviceUptimeMilliseconds, 0x212345678)
        XCTAssertEqual(event?.preview, true)
    }
    func testRejectsMalformedEventsAndAcceptsInitialStatus() {
        let initial = Data([1] + Array(repeating: UInt8(0), count: 19))
        XCTAssertNotNil(PromptPlaybackEvent(data: initial))
        XCTAssertNil(PromptPlaybackEvent(data: initial.dropLast()))
        for (offset, value): (Int, UInt8) in [(0,2),(1,4),(2,7),(3,4)] {
            var bad = initial; bad[offset] = value
            XCTAssertNil(PromptPlaybackEvent(data: bad))
        }
        var bad = initial; bad[1] = 1
        XCTAssertNil(PromptPlaybackEvent(data: bad))
    }
    func testOnlyRealCompletedSummariesAreQueuedAndRepeatedPollsCoalesce() {
        var q = SummaryPromptQueue(); let now = Date()
        for status in [nil, "pending", "processing", "failed", "skipped"] as [String?] {
            XCTAssertFalse(q.completed(scope: "owner", conversationID: "a", summaryStatus: status, now: now))
        }
        XCTAssertFalse(q.completed(scope: nil, conversationID: "a", summaryStatus: "done", now: now))
        XCTAssertFalse(q.completed(scope: "owner", conversationID: nil, summaryStatus: "done", now: now))
        XCTAssertTrue(q.completed(scope: "owner", conversationID: "a", summaryStatus: "done", now: now))
        XCTAssertFalse(q.completed(scope: "owner", conversationID: "a", summaryStatus: "done", now: now))
        XCTAssertEqual(q.pending.count, 1)
        let item = q.next(scope: "owner", now: now)!
        // No acknowledgement means it stays queued, e.g. a disconnected write.
        XCTAssertEqual(q.next(scope: "owner", now: now), item)
        q.accepted(item)
        XCTAssertNil(q.next(scope: "owner", now: now))
        XCTAssertFalse(q.completed(scope: "owner", conversationID: "a", summaryStatus: "done", now: now))
    }
    func testWorkspaceIsolationExpiryAndPersistence() throws {
        var q = SummaryPromptQueue(); let now = Date()
        q.completed(scope: "owner", conversationID: "a", summaryStatus: "done", now: now)
        XCTAssertNil(q.next(scope: "friend", now: now))
        q = try JSONDecoder().decode(SummaryPromptQueue.self, from: JSONEncoder().encode(q))
        XCTAssertNotNil(q.next(scope: "owner", now: now.addingTimeInterval(299)))
        XCTAssertNil(q.next(scope: "owner", now: now.addingTimeInterval(301)))
        XCTAssertEqual(q.pending.count, 0)
    }
}
