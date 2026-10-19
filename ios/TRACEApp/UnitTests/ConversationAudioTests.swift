import XCTest
import AVFoundation
import CryptoKit
import Opus
import TRACECore
@testable import TRACE

final class ConversationAudioTests: XCTestCase {
    private func chunk(start: Date, directory: URL) throws -> LocalChunkRecord {
        let id = UUID().uuidString.lowercased()
        let format = AVAudioFormat(opusPCMFormat: .int16, sampleRate: 16000, channels: 1)!
        let encoder = try Opus.Encoder(format: format)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 320)!
        buffer.frameLength = 320
        for i in 0..<320 { buffer.int16ChannelData![0][i] = Int16(sin(Double(i) / 10) * 3000) }
        var data = Data([0x54,0x52,0x43,0x48,1,0x15,0,0])
        let ms = UInt64(start.timeIntervalSince1970 * 1000)
        for n in 0..<8 { data.append(UInt8(truncatingIfNeeded: ms >> (n*8))) }
        for _ in 0..<50 {
            var frame = Data(count: 4000)
            _ = try encoder.encode(buffer, to: &frame)
            data.append(UInt8(truncatingIfNeeded: frame.count)); data.append(UInt8(truncatingIfNeeded: frame.count >> 8)); data.append(frame)
        }
        let url = directory.appendingPathComponent("\(id).trch")
        try data.write(to: url)
        return try LocalChunkRecord.read(from: url)
    }
    private func manifest(_ id: String, start: Date, end: Date, records: [LocalChunkRecord]) throws -> ConversationAudioManifest {
        func iso(_ date: Date) -> String { ISO8601DateFormatter.withFractionalSeconds.string(from: date) }
        return ConversationAudioManifest(conversationId: id, startedAt: iso(start), finishedAt: iso(end), chunks: try records.map { record in
            let hash = SHA256.hash(data: try Data(contentsOf: record.fileURL)).map { String(format: "%02x", $0) }.joined()
            return .init(id: record.id, startedAt: iso(record.startedAt), durationMs: record.duration * 1000, sha256: hash)
        })
    }
    func testStreamingExportTrimsBoundariesAndKeepsOriginals() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let start = Date(timeIntervalSince1970: 1791028800)
        let records = try [chunk(start: start, directory: dir), chunk(start: start.addingTimeInterval(1), directory: dir)]
        let id = UUID().uuidString
        let m = try manifest(id, start: start.addingTimeInterval(0.25), end: start.addingTimeInterval(1.75), records: records)
        let url = try await ConversationAudioAssembler.shared.assemble(m, records: records)
        defer { try? FileManager.default.removeItem(at: url) }
        let audio = try AVAudioFile(forReading: url)
        XCTAssertEqual(Double(audio.length) / audio.processingFormat.sampleRate, 1.5, accuracy: 0.03)
        XCTAssertTrue(records.allSatisfy { FileManager.default.fileExists(atPath: $0.fileURL.path) })
    }
    func testSmallTimestampGapPreservesConversationDuration() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let start = Date(timeIntervalSince1970: 1791028800)
        let records = try [chunk(start: start, directory: dir), chunk(start: start.addingTimeInterval(1.1), directory: dir)]
        let m = try manifest(UUID().uuidString, start: start, end: start.addingTimeInterval(2.1), records: records)
        let url = try await ConversationAudioAssembler.shared.assemble(m, records: records)
        defer { try? FileManager.default.removeItem(at: url) }
        let audio = try AVAudioFile(forReading: url)
        XCTAssertEqual(Double(audio.length) / audio.processingFormat.sampleRate, 2.1, accuracy: 0.001)
        XCTAssertTrue(records.allSatisfy { FileManager.default.fileExists(atPath: $0.fileURL.path) })
    }
    func testMissingChunkAndReceiveGapCannotProduceCompleteExport() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let start = Date(timeIntervalSince1970: 1791028800)
        let records = try [chunk(start: start, directory: dir), chunk(start: start.addingTimeInterval(2), directory: dir)]
        let m = try manifest(UUID().uuidString, start: start, end: start.addingTimeInterval(3), records: records)
        do { _ = try await ConversationAudioAssembler.shared.assemble(m, records: [records[0]]); XCTFail("Missing chunk accepted") } catch { XCTAssertTrue(error.localizedDescription.contains("missing")) }
        do { _ = try await ConversationAudioAssembler.shared.assemble(m, records: records); XCTFail("Gap accepted") } catch { XCTAssertTrue(error.localizedDescription.contains("gap")) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: ConversationAudioAssembler.output(m.conversationId).path))
    }
    func testCorruptOriginalRejected() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let start = Date(timeIntervalSince1970: 1791028800)
        let record = try chunk(start: start, directory: dir)
        let m = try manifest(UUID().uuidString, start: start, end: start.addingTimeInterval(1), records: [record])
        try Data("changed".utf8).write(to: record.fileURL)
        do { _ = try await ConversationAudioAssembler.shared.assemble(m, records: [record]); XCTFail("Corrupt chunk accepted") } catch { XCTAssertTrue(error.localizedDescription.contains("integrity")) }
    }
    func testSelectiveCleanupKeepsOtherOriginals() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let writer = try ChunkFileWriter(directory: dir)
        defer { try? FileManager.default.removeItem(at: dir) }
        let a = try chunk(start: Date(), directory: dir), b = try chunk(start: Date(), directory: dir)
        try await writer.removeCompletedChunks(ids: [a.id])
        XCTAssertFalse(FileManager.default.fileExists(atPath: a.fileURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: b.fileURL.path))
    }
    func testAcceptedTrailingTimestampGapPreservesDuration() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
        defer {try? FileManager.default.removeItem(at:dir)}
        let start=Date(timeIntervalSince1970:1791028800)
        let record=try chunk(start:start,directory:dir)
        let m=try manifest(UUID().uuidString,start:start,end:start.addingTimeInterval(1.3),records:[record])
        let url=try await ConversationAudioAssembler.shared.assemble(m,records:[record])
        defer {try? FileManager.default.removeItem(at:url)}
        let audio=try AVAudioFile(forReading:url)
        XCTAssertEqual(Double(audio.length)/audio.processingFormat.sampleRate,1.3,accuracy:0.001)
    }

    func testDuplicateChunksAreRejectedWithoutCrashingOrRemovingOriginals() async throws {
        let dir=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
        defer {try? FileManager.default.removeItem(at:dir)}
        let start=Date(timeIntervalSince1970:1791028800)
        let record=try chunk(start:start,directory:dir)
        let valid=try manifest(UUID().uuidString,start:start,end:start.addingTimeInterval(1),records:[record])
        do { _ = try await ConversationAudioAssembler.shared.assemble(valid,records:[record,record]); XCTFail("Duplicate index accepted") }
        catch { XCTAssertTrue(error.localizedDescription.contains("duplicate")) }
        let invalid=try manifest(UUID().uuidString,start:start,end:start.addingTimeInterval(1),records:[record,record])
        do { _ = try await ConversationAudioAssembler.shared.assemble(invalid,records:[record]); XCTFail("Duplicate manifest accepted") }
        catch { XCTAssertTrue(error.localizedDescription.contains("duplicate")) }
        XCTAssertTrue(FileManager.default.fileExists(atPath:record.fileURL.path))
    }

}
