import Foundation
import Testing
@testable import TRACECore

@Suite("DevKit2 protocol framing")
struct DevKitProtocolTests {
    @Test("recognizes supported Opus codec characteristic values")
    func codecCharacteristic() {
        #expect(OmiBLEProtocol.Codec.characteristicValue(Data([0x14])) == .opusDevKit)
        #expect(OmiBLEProtocol.Codec.characteristicValue(Data([0x15])) == .opusFS320)
        #expect(OmiBLEProtocol.Codec.characteristicValue(Data([0xff])) == nil)
        #expect(OmiBLEProtocol.Codec.characteristicValue(Data()) == nil)
        #expect(OmiBLEProtocol.Codec.opusDevKit.frameDurationMilliseconds == 10)
        #expect(OmiBLEProtocol.Codec.opusFS320.frameDurationMilliseconds == 20)
    }

    @Test("splits the three-byte live notification header from Opus bytes")
    func liveNotificationFraming() throws {
        let notification = Data([0xa1, 0xb2, 0xc3, 0x08, 0x19, 0x2a])
        let frame = try #require(OmiBLEProtocol.AudioNotification(notification: notification))
        #expect(frame.firmwareHeader == Data([0xa1, 0xb2, 0xc3]))
        #expect(frame.encodedAudio == Data([0x08, 0x19, 0x2a]))
        #expect(OmiBLEProtocol.AudioNotification(notification: Data([1, 2, 3])) == nil)
        #expect(OmiBLEProtocol.AudioNotification(notification: Data([1, 2])) == nil)
    }

    @Test("serializes TRCH v1 header and little-endian frame lengths")
    func chunkSerialization() throws {
        let chunk = try TRCHChunk(codec: .opusDevKit, startedAtMilliseconds: 0x0102_0304_0506_0708, frames: [Data([0xaa, 0xbb]), Data([0xcc])])
        let bytes = chunk.encodedData
        #expect(Array(bytes.prefix(8)) == [0x54, 0x52, 0x43, 0x48, 1, 0x14, 0, 0])
        #expect(Array(bytes[8..<16]) == [0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01])
        #expect(Array(bytes[16...]) == [2, 0, 0xaa, 0xbb, 1, 0, 0xcc])
        #expect(chunk.frames == [Data([0xaa, 0xbb]), Data([0xcc])])
    }

    @Test("rejects non-Opus codecs and malformed empty frames")
    func rejectsUnsupportedChunks() {
        #expect(throws: TRCHChunkError.unsupportedCodec(0)) {
            try TRCHChunk(codec: .pcm16, startedAtMilliseconds: 1, frames: [Data([1])])
        }
        #expect(throws: TRCHChunkError.emptyChunk) {
            try TRCHChunk(codec: .opusDevKit, startedAtMilliseconds: 1, frames: [])
        }
        #expect(throws: TRCHChunkError.emptyFrame) {
            try TRCHChunk(codec: .opusDevKit, startedAtMilliseconds: 1, frames: [Data()])
        }
    }

    @Test("recovers complete frames and discards a torn final frame")
    func recoversTornChunk() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("TRACECoreTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let stamp: Int64 = 1_700_000_000_123
        let partial = directory.appendingPathComponent("interrupted.partial")
        var bytes = TRCHChunk.headerData(codec: .opusDevKit, startedAtMilliseconds: stamp)
        bytes.append(TRCHChunk.frameRecordData(Data([0x10, 0x20, 0x30])))
        bytes.append(contentsOf: [0x05, 0x00, 0x40]) // Declares five bytes; only one survived.
        try bytes.write(to: partial)

        let writer = try ChunkFileWriter(directory: directory)
        let recovered = try await writer.recoverInterruptedChunks()
        #expect(recovered.count == 1)
        let repaired = try #require(recovered.first)
        #expect(repaired.pathExtension == "trch")
        let repairedBytes = try Data(contentsOf: repaired)
        #expect(repairedBytes == TRCHChunk.headerData(codec: .opusDevKit, startedAtMilliseconds: stamp) + TRCHChunk.frameRecordData(Data([0x10, 0x20, 0x30])))
    }
}
