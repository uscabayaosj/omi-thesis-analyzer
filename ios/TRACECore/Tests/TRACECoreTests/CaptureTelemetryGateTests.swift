import XCTest
@testable import TRACECore

final class CaptureTelemetryGateTests: XCTestCase {
    func testHundredPacketsPerSecondPublishOncePerSecond() {
        var gate = CaptureTelemetryGate()
        let start = Date(timeIntervalSince1970: 100)
        var updates = 0
        for i in 0..<1000 {
            if gate.recordFrame(at: start.addingTimeInterval(Double(i) / 100), foreground: true) { updates += 1 }
        }
        XCTAssertEqual(gate.frames, 1000)
        XCTAssertEqual(updates, 10)
    }
    func testBackgroundCountsWithoutUIUpdatesAndForegroundCatchesUp() {
        var gate = CaptureTelemetryGate()
        let start = Date(timeIntervalSince1970: 100)
        for i in 0..<360000 {
            XCTAssertFalse(gate.recordFrame(at: start.addingTimeInterval(Double(i) / 100), foreground: false))
        }
        XCTAssertEqual(gate.foregroundSnapshot(at: start.addingTimeInterval(3600)), 360000)
        XCTAssertFalse(gate.recordFrame(at: start.addingTimeInterval(3600.01), foreground: true))
        XCTAssertTrue(gate.recordFrame(at: start.addingTimeInterval(3601), foreground: true))
    }
}
