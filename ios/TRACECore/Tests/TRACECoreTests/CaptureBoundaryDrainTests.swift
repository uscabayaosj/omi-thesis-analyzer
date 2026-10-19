import XCTest
@testable import TRACECore

final class CaptureBoundaryDrainTests: XCTestCase {
    func testPauseRetainsNineAlreadyInFlightFrames() {
        var drain = CaptureBoundaryDrain()
        drain.requestPause(at: 10)
        var saved = 0
        for _ in 0..<9 { if drain.mayAcceptAudio { saved += 1 } }
        XCTAssertEqual(saved, 9, "Pause must not discard the firmware's in-flight tail")
    }
    private func stats(_ sent: UInt32, queued: UInt32? = nil) -> FirmwareCaptureStats {
        var words: [UInt32] = [1,1000,16000,0,16000,0,sent,0,queued ?? sent,0,sent,0]
        return FirmwareCaptureStats(data: words.withUnsafeMutableBytes { Data($0) })!
    }
    func testWaitsForAcknowledgementAndFreshSettledCounters() {
        var d = CaptureBoundaryDrain(); d.requestPause(at: 0)
        d.observe(stats(9), at: 0.7); d.observe(stats(9), at: 1.05)
        XCTAssertNil(d.poll(at: 1.05))
        d.acknowledgePause()
        XCTAssertEqual(d.poll(at: 1.05), .sampledSettled)
        XCTAssertFalse(d.mayAcceptAudio)
    }
    func testCounterGrowthAndNewAudioExtendTheDrain() {
        var d = CaptureBoundaryDrain(); d.requestPause(at: 0); d.acknowledgePause()
        d.observe(stats(8), at: 0.6); d.observe(stats(9), at: 0.9)
        d.receivedAudio(at: 1.1); d.observe(stats(9), at: 1.21)
        XCTAssertNil(d.poll(at: 1.21))
        d.observe(stats(9), at: 1.3)
        XCTAssertEqual(d.poll(at: 1.3), .sampledSettled)
    }
    func testQueuedFramesPreventEarlyCompletion() {
        var d = CaptureBoundaryDrain(); d.requestPause(at: 0); d.acknowledgePause()
        d.observe(stats(8,queued:9), at: 0.6); d.observe(stats(8,queued:9), at: 1.1)
        XCTAssertNil(d.poll(at: 1.1))
        XCTAssertTrue(d.mayAcceptAudio)
    }
    func testMissingOrStaleReadIsAnUnconfirmedTimeout() {
        var d = CaptureBoundaryDrain(); d.requestPause(at: 0); d.acknowledgePause()
        d.observe(stats(9), at: 0.6)
        XCTAssertNil(d.poll(at: 1.2))
        XCTAssertEqual(d.poll(at: 3), .timedOut)
        XCTAssertFalse(d.mayAcceptAudio)
    }
    func testDisconnectClosesTheDrainWithoutClaimingSettlement() {
        var d = CaptureBoundaryDrain(); d.requestPause(at: 0); d.disconnected()
        XCTAssertEqual(d.poll(at: 0.1), .disconnected)
        XCTAssertFalse(d.mayAcceptAudio)
    }
}
