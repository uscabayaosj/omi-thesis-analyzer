import Foundation
import TRACECore

struct LocalChunkRecord: Identifiable, Sendable {
    let id: String
    let fileURL: URL
    let startedAt: Date
    let codec: OmiBLEProtocol.Codec
    let frameCount: Int
    let byteCount: Int

    var duration: TimeInterval {
        Double(frameCount * (codec.frameDurationMilliseconds ?? 0)) / 1_000
    }

    static func read(from fileURL: URL) throws -> LocalChunkRecord {
        let attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
        let byteCount = (attributes[.size] as? NSNumber)?.intValue ?? 0
        guard byteCount >= TRCHChunk.headerLength,
              byteCount <= TRCHChunk.maximumEncodedLength else {
            throw TRCHChunkError.chunkTooLarge(byteCount)
        }
        let data = try Data(contentsOf: fileURL, options: .mappedIfSafe)
        guard data.prefix(4) == TRCHChunk.magic,
              data[4] == TRCHChunk.version,
              data[6] == 0, data[7] == 0,
              let codec = OmiBLEProtocol.Codec(rawValue: data[5]),
              codec.isSupportedForOpusCapture else {
            throw TRCHChunkError.unsupportedCodec(data.count > 5 ? data[5] : 0)
        }

        var timestampBits: UInt64 = 0
        for index in 0..<8 {
            timestampBits |= UInt64(data[8 + index]) << (index * 8)
        }
        let timestamp = Int64(bitPattern: timestampBits)
        var offset = TRCHChunk.headerLength
        var frameCount = 0
        while offset < data.count {
            guard data.count - offset >= 2 else { throw TRCHChunkError.emptyFrame }
            let frameLength = Int(data[offset]) | (Int(data[offset + 1]) << 8)
            offset += 2
            guard frameLength > 0, frameLength <= data.count - offset else {
                throw TRCHChunkError.emptyFrame
            }
            offset += frameLength
            frameCount += 1
        }
        guard frameCount > 0 else { throw TRCHChunkError.emptyChunk }

        return LocalChunkRecord(
            id: fileURL.deletingPathExtension().lastPathComponent,
            fileURL: fileURL,
            startedAt: Date(timeIntervalSince1970: Double(timestamp) / 1_000),
            codec: codec,
            frameCount: frameCount,
            byteCount: byteCount
        )
    }
}

/// Audio metadata is parsed off MainActor once at recovery, then only for new chunks.
actor LocalChunkIndex {
    struct Scan: Sendable {
        let records: [LocalChunkRecord]
        let errors: [String]
    }
    func scan(_ urls: [URL]) -> Scan {
        var records: [LocalChunkRecord] = []
        var errors: [String] = []
        for url in urls {
            do { records.append(try LocalChunkRecord.read(from: url)) }
            catch { errors.append(error.localizedDescription) }
        }
        return Scan(records: records.sorted { $0.startedAt > $1.startedAt }, errors: errors)
    }
    func read(_ url: URL) throws -> LocalChunkRecord { try LocalChunkRecord.read(from: url) }
}
