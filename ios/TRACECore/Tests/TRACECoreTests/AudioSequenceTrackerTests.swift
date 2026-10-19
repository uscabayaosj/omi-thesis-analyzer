import XCTest
@testable import TRACECore

final class AudioSequenceTrackerTests: XCTestCase {
    func packet(_ sequence: UInt16, fragment: UInt8 = 0) -> Data {
        Data([UInt8(truncatingIfNeeded: sequence), UInt8(sequence >> 8), fragment, 42])
    }
    func testWrapAndMissingAndDuplicate() {
        var tracker = AudioSequenceTracker()
        for value: UInt16 in [65534, 65535, 0, 3, 3] { tracker.record(packet(value)) }
        XCTAssertEqual(tracker.notifications, 5)
        XCTAssertEqual(tracker.missingNotifications, 2)
        XCTAssertEqual(tracker.duplicates, 1)
        XCTAssertEqual(tracker.discontinuities, 0)
    }
    func testResetDoesNotInventHugeLoss() {
        var tracker = AudioSequenceTracker()
        tracker.record(packet(1000)); tracker.record(packet(0))
        XCTAssertEqual(tracker.discontinuities, 1)
        tracker.resetBoundary(); tracker.record(packet(500))
        XCTAssertEqual(tracker.missingNotifications, 0)
    }
    func testFragmentsAndInvalidNotifications() {
        var tracker = AudioSequenceTracker()
        tracker.record(Data([1, 2, 3])); tracker.record(packet(1, fragment: 1))
        XCTAssertEqual(tracker.notifications, 1)
        XCTAssertEqual(tracker.fragments, 1)
    }
}
