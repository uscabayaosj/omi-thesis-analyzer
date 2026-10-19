import XCTest
@testable import TRACECore

final class CaptureRecordingStateTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 100)
    func testPausedOverridesConnectionAndStorage() {
        XCTAssertEqual(CaptureRecordingState.resolve(paused: true, connected: true, lastSavedAudioAt: now, now: now, storageAvailable: false), .paused)
    }
    func testArmedWithoutDeviceNeverClaimsRecording() {
        XCTAssertEqual(CaptureRecordingState.resolve(paused: false, connected: false, lastSavedAudioAt: nil, now: now, storageAvailable: true), .waitingForDevice)
    }
    func testConnectedWithoutSuccessfulWriteWaitsForAudio() {
        XCTAssertEqual(CaptureRecordingState.resolve(paused: false, connected: true, lastSavedAudioAt: nil, now: now, storageAvailable: true), .waitingForAudio)
    }
    func testRecentSavedAudioPermitsRecording() {
        XCTAssertEqual(CaptureRecordingState.resolve(paused: false, connected: true, lastSavedAudioAt: now.addingTimeInterval(-1), now: now, storageAvailable: true), .recording)
    }
    func testStaleAudioAndDisconnectAreInterrupted() {
        XCTAssertEqual(CaptureRecordingState.resolve(paused: false, connected: true, lastSavedAudioAt: now.addingTimeInterval(-4), now: now, storageAvailable: true), .interrupted)
        XCTAssertEqual(CaptureRecordingState.resolve(paused: false, connected: false, lastSavedAudioAt: now, now: now, storageAvailable: true), .interrupted)
    }
    func testFailedStorageNeverClaimsRecording() {
        XCTAssertEqual(CaptureRecordingState.resolve(paused: false, connected: true, lastSavedAudioAt: now, now: now, storageAvailable: false), .storageFailure)
    }
    func testClockRollbackDoesNotPermitRecording() {
        XCTAssertEqual(CaptureRecordingState.resolve(paused: false, connected: true, lastSavedAudioAt: now.addingTimeInterval(1), now: now, storageAvailable: true), .interrupted)
    }
}
