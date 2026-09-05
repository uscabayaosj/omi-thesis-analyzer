import XCTest
@testable import TraceCapture

final class ChunkWriterTests: XCTestCase {
    private func tempDir() -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try! FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    func testRollsAfterIntervalAndWritesAValidContainer() throws {
        let w = ChunkWriter(directory: tempDir(), rollAfter: 30)
        w.codec = 0x15
        let t0 = Date(timeIntervalSince1970: 1_757_000_000)
        XCTAssertNil(w.append(frame: Data([1, 2]), now: t0))
        XCTAssertNil(w.append(frame: Data([3]), now: t0.addingTimeInterval(29.9)))
        let rolled = w.append(frame: Data([4]), now: t0.addingTimeInterval(30.1))
        let file = try XCTUnwrap(rolled)
        let bytes = try Data(contentsOf: file)
        XCTAssertEqual(Array(bytes.prefix(4)), [0x54, 0x52, 0x43, 0x48])
        XCTAssertEqual(bytes[5], 0x15)
        XCTAssertEqual(Array(bytes[16...]), [2, 0, 1, 2, 1, 0, 3]) // the two frames before the roll
        XCTAssertEqual(w.pendingFrames, 1, "the frame that triggered the roll starts the next chunk")
        XCTAssertNotNil(UUID(uuidString: file.deletingPathExtension().lastPathComponent))
    }

    func testFlushWritesWhateverIsPendingAndNothingWhenEmpty() throws {
        let w = ChunkWriter(directory: tempDir())
        XCTAssertNil(w.flush())
        _ = w.append(frame: Data([9]))
        let file = try XCTUnwrap(w.flush())
        XCTAssertEqual(try Data(contentsOf: file).count, 16 + 3)
        XCTAssertEqual(w.pendingFrames, 0)
    }
}
