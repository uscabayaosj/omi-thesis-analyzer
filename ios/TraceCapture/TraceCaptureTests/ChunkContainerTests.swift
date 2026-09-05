import XCTest
@testable import TraceCapture

final class ChunkContainerTests: XCTestCase {
    func testHeaderMatchesSpecByteLayout() {
        let data = ChunkContainer.encode(codec: 0x14, startedAtMs: 256, frames: [Data([7])])
        XCTAssertEqual(Array(data.prefix(4)), [0x54, 0x52, 0x43, 0x48])      // "TRCH"
        XCTAssertEqual(data[4], 1)                                            // version
        XCTAssertEqual(data[5], 0x14)                                         // codec
        XCTAssertEqual(Array(data[6..<8]), [0, 0])                            // reserved
        XCTAssertEqual(Array(data[8..<16]), [0, 1, 0, 0, 0, 0, 0, 0])         // 256 LE int64
        XCTAssertEqual(Array(data[16...]), [1, 0, 7])                         // len=1 LE, frame
    }

    func testEmptyChunkIsHeaderOnly() {
        XCTAssertEqual(ChunkContainer.encode(codec: 0x15, startedAtMs: 0, frames: []).count, 16)
    }

    func testMultipleFramesAreLengthPrefixedInOrder() {
        let data = ChunkContainer.encode(codec: 0x15, startedAtMs: 1, frames: [Data([1, 2, 3]), Data([9])])
        XCTAssertEqual(Array(data[16...]), [3, 0, 1, 2, 3, 1, 0, 9])
    }
}
