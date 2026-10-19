import XCTest
@testable import TRACECore

final class CaptureCompletionTests: XCTestCase {
    func testFinishRefreshesAlreadyCompletedConversation() {
        XCTAssertEqual(CaptureCompletionPolicy.sessionsToRefresh(pending: [], lastSession: "completed"), ["completed"])
    }
    func testCurrentPendingSessionTakesPriority() {
        XCTAssertEqual(CaptureCompletionPolicy.sessionsToRefresh(pending: ["current"], lastSession: "previous"), ["current"])
    }
    func testNoSpeechDoesNotReuseAnUnrelatedConversation() {
        XCTAssertTrue(CaptureCompletionPolicy.sessionsToRefresh(pending: [], lastSession: nil).isEmpty)
    }
    func testCloseWaitsForFinalLocalWritesAndUploads() {
        XCTAssertFalse(CaptureCompletionPolicy.canClose(requested:true,queuedUploads:0,localWrites:1,generationMatches:true))
        XCTAssertFalse(CaptureCompletionPolicy.canClose(requested:true,queuedUploads:1,localWrites:0,generationMatches:true))
        XCTAssertFalse(CaptureCompletionPolicy.canClose(requested:true,queuedUploads:0,localWrites:0,generationMatches:false))
        XCTAssertTrue(CaptureCompletionPolicy.canClose(requested:true,queuedUploads:0,localWrites:0,generationMatches:true))
    }

}
