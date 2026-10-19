import Foundation
import XCTest
@testable import TRACECore

final class ChunkDurationTests: XCTestCase {
    private func verifyBurst(codec: OmiBLEProtocol.Codec, rollAfter: TimeInterval, frames: Int, expectedFirstFrames: Int) async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let writer = try ChunkFileWriter(directory: directory, rollAfter: rollAfter)
        let now = Date()
        var completed: [URL] = []
        for _ in 0..<frames {
            if let url = try await writer.append(notification: Data([1, 2, 3, 0x11]), codec: codec, receivedAt: now, uploadScope: "server#installation") {
                completed.append(url)
            }
        }
        if let last = try await writer.finish() { completed.append(last) }
        XCTAssertEqual(completed.count, 2)
        let bytes = try Data(contentsOf: completed[0])
        // This fixture has a one-byte payload plus a two-byte frame length.
        XCTAssertEqual((bytes.count - 16) / 3, expectedFirstFrames)
        XCTAssertEqual(ChunkFileWriter.uploadScope(for: completed[0]), "server#installation")
        XCTAssertEqual(try completed.reduce(0) { $0 + ((try Data(contentsOf: $1)).count - 16) / 3 }, frames)
    }

    func testLargeQueuedBurstPreservesEveryFrameAndScope() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let writer = try ChunkFileWriter(directory: directory)
        let now = Date()
        var urls = [URL]()
        for index in 0..<26_574 {
            let payload = UInt16(truncatingIfNeeded: index)
            let notification = Data([0, 0, 0, UInt8(payload & 255), UInt8(payload >> 8)])
            if let url = try await writer.append(notification: notification, codec: .opusDevKit, receivedAt: now, uploadScope: "test#capture") { urls.append(url) }
        }
        if let url = try await writer.finish() { urls.append(url) }
        XCTAssertEqual(urls.count, 9)
        var frame = 0
        for url in urls {
            XCTAssertEqual(ChunkFileWriter.uploadScope(for: url), "test#capture")
            let bytes = try Data(contentsOf: url)
            XCTAssertLessThanOrEqual((bytes.count - 16) / 4, 3_000)
            for offset in stride(from: 16, to: bytes.count, by: 4) {
                XCTAssertEqual(bytes[offset], 2)
                XCTAssertEqual(bytes[offset + 1], 0)
                XCTAssertEqual(Int(bytes[offset + 2]) | (Int(bytes[offset + 3]) << 8), frame)
                frame += 1
            }
        }
        XCTAssertEqual(frame, 26_574)
    }

    func testTenMillisecondBurstRollsAfterThirtySeconds() async throws {
        try await verifyBurst(codec: .opusDevKit, rollAfter: 30, frames: 3_010, expectedFirstFrames: 3_000)
    }

    func testTwentyMillisecondBurstRollsAfterThirtySeconds() async throws {
        try await verifyBurst(codec: .opusFS320, rollAfter: 30, frames: 1_510, expectedFirstFrames: 1_500)
    }

    func testLongConfiguredIntervalStillHonorsBackendDurationLimit() async throws {
        try await verifyBurst(codec: .opusDevKit, rollAfter: 600, frames: 12_010, expectedFirstFrames: 12_000)
    }
    func testConnectionChangesNeverMixUploadScopesInOneChunk() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let writer = try ChunkFileWriter(directory:directory)
        let packet = Data([0,0,0,0x11])
        _ = try await writer.append(notification:packet,codec:.opusDevKit,uploadScope:"first#installation")
        let first = try await writer.append(notification:packet,codec:.opusDevKit,uploadScope:nil)
        let second = try await writer.append(notification:packet,codec:.opusDevKit,uploadScope:"second#installation")
        let third = try await writer.finish()
        XCTAssertEqual(ChunkFileWriter.uploadScope(for:try XCTUnwrap(first)),"first#installation")
        XCTAssertNil(ChunkFileWriter.uploadScope(for:try XCTUnwrap(second)))
        XCTAssertEqual(ChunkFileWriter.uploadScope(for:try XCTUnwrap(third)),"second#installation")
        for url in [first,second,third] { XCTAssertEqual(try Data(contentsOf:XCTUnwrap(url)).count,19) }
    }

}
