import Foundation
import XCTest
@testable import TRACECore

final class RecoveryAuthorizationTests: XCTestCase {
    func testRecoveryRetainsOnlyMatchingAuthorization() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let writer = try ChunkFileWriter(directory: directory)
        let packet = Data([1, 2, 3, 0x11])
        try await writer.append(notification: packet, codec: .opusDevKit, uploadScope: "server-A#installation-A")
        let finished = try await writer.finish()
        let completed = try XCTUnwrap(finished)
        let partial = completed.deletingPathExtension().appendingPathExtension("partial")
        try FileManager.default.moveItem(at: completed, to: partial)
        let recovery = try ChunkFileWriter(directory: directory)
        let recovered = try await recovery.recoverInterruptedChunks()
        XCTAssertEqual(recovered.count, 1)
        let eligible = try await recovery.authorizedCompletedChunks(scope: "server-A#installation-A")
        XCTAssertEqual(eligible, recovered)
        let otherServer = try await recovery.authorizedCompletedChunks(scope: "server-B#installation-A")
        XCTAssertTrue(otherServer.isEmpty)
        let otherInstallation = try await recovery.authorizedCompletedChunks(scope: "server-A#installation-B")
        XCTAssertTrue(otherInstallation.isEmpty)
    }

    func testOlderLocalOnlyAudioDoesNotBecomeAuthorized() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let writer = try ChunkFileWriter(directory: directory)
        try await writer.append(notification: Data([1, 2, 3, 0x11]), codec: .opusDevKit)
        let finished = try await writer.finish()
        let completed = try XCTUnwrap(finished)
        XCTAssertNil(ChunkFileWriter.uploadScope(for: completed))
        let eligible = try await writer.authorizedCompletedChunks(scope: "server#installation")
        XCTAssertTrue(eligible.isEmpty)
    }

    func testCorruptAuthorizationDoesNotGrantUpload() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let writer = try ChunkFileWriter(directory: directory)
        try await writer.append(notification: Data([1, 2, 3, 0x11]), codec: .opusDevKit, uploadScope: "server#installation")
        let finished = try await writer.finish()
        let completed = try XCTUnwrap(finished)
        try Data("invalid metadata".utf8).write(to: completed.deletingPathExtension().appendingPathExtension("upload"))
        XCTAssertNil(ChunkFileWriter.uploadScope(for: completed))
        let eligible = try await writer.authorizedCompletedChunks(scope: "server#installation")
        XCTAssertTrue(eligible.isEmpty)
    }
}
