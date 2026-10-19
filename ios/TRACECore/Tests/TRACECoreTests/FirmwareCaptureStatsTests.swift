import XCTest
@testable import TRACECore
final class FirmwareCaptureStatsTests: XCTestCase {
    func testExactWireLayoutAndLittleEndian() {
        var data = Data()
        for word: UInt32 in [1, 12345, 16000, 2, 15000, 1000, 100, 3, 90, 10, 85, 4] {
            data.append(contentsOf: (0..<4).map { UInt8(truncatingIfNeeded: word >> ($0 * 8)) })
        }
        let stats = FirmwareCaptureStats(data: data)
        XCTAssertEqual(stats?.counters["uptimeMilliseconds"], 12345)
        XCTAssertEqual(stats?.counters["pdmSamples"], 16000)
        XCTAssertEqual(stats?.counters["txDroppedFrames"], 10)
        XCTAssertEqual(stats?.counters["bleNotifyFailures"], 4)
    }
    func testRejectsUnknownVersionAndTruncatedOrTrailingBytes() {
        XCTAssertNil(FirmwareCaptureStats(data: Data(repeating: 0, count: 48)))
        XCTAssertNil(FirmwareCaptureStats(data: Data(repeating: 1, count: 47)))
        XCTAssertNil(FirmwareCaptureStats(data: Data(repeating: 1, count: 49)))
    }
}
