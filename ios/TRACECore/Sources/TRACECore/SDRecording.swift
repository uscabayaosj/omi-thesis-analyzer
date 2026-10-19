import Foundation

public enum SDRecordingError: Error, Equatable {
    case invalidHeader, invalidFrame, checksum, sequence, incomplete, excessiveSize, invalidTime
}

/// Versioned SD recordings retain the original checksummed bytes alongside
/// their converted TRCH chunk. Incomplete recordings never silently pass as sealed.
public struct SDRecording: Sendable {
    public let fileID: UInt64
    public let chunk: TRCHChunk
    public let interrupted: Bool
    public let discardedTailBytes: Int
    public let reportedDrops: UInt32

    public init(data: Data, allowInterrupted: Bool = false) throws {
        guard data.count >= 32, data.count <= 1_100_000 else { throw SDRecordingError.excessiveSize }
        guard data.prefix(4) == Data("TRSD".utf8), data[4] == 1, data[5] == 0x14,
              data.sdUInt16(6) == 32 else { throw SDRecordingError.invalidHeader }
        guard SDChecksum.crc32(data.prefix(28)) == data.sdUInt32(28) else { throw SDRecordingError.checksum }
        fileID = data.sdUInt64(8)
        let time = Int64(bitPattern: data.sdUInt64(16))
        guard time >= 1_577_836_800_000, time <= 4_102_444_800_000 else { throw SDRecordingError.invalidTime }
        var offset = 32, frames: [Data] = [], lastSequence: UInt32?, sealed = false, drops: UInt32 = 0
        while offset < data.count {
            if data.count - offset >= 4, data.subdata(in: offset..<offset+4) == Data("TEND".utf8) {
                guard data.count - offset == 24,
                      data.sdUInt32(offset+4) == UInt32(frames.count),
                      data.sdUInt32(offset+8) == UInt32(offset),
                      SDChecksum.crc32(data.prefix(offset)) == data.sdUInt32(offset+12),
                      SDChecksum.crc32(data.subdata(in: offset..<offset+20)) == data.sdUInt32(offset+20)
                else { throw SDRecordingError.checksum }
                drops = data.sdUInt32(offset+16); offset += 24; sealed = true; break
            }
            guard data.count-offset >= 12 else { break }
            let length = Int(data.sdUInt16(offset)), duration = data.sdUInt16(offset+2)
            guard length > 0, length <= 320, duration == 10, frames.count < 3_000 else { throw SDRecordingError.invalidFrame }
            guard data.count-offset-12 >= length else { break }
            let sequence = data.sdUInt32(offset+4)
            if let lastSequence, sequence != lastSequence &+ 1 { throw SDRecordingError.sequence }
            let payload = data.subdata(in: offset+12..<offset+12+length)
            var checked = data.subdata(in: offset..<offset+8); checked.append(payload)
            guard SDChecksum.crc32(checked) == data.sdUInt32(offset+8) else { throw SDRecordingError.checksum }
            frames.append(payload); lastSequence = sequence; offset += 12+length
        }
        guard !frames.isEmpty else { throw SDRecordingError.invalidFrame }
        guard sealed || allowInterrupted else { throw SDRecordingError.incomplete }
        interrupted = !sealed; discardedTailBytes = data.count-offset; reportedDrops = drops
        chunk = try TRCHChunk(codec: .opusDevKit, startedAtMilliseconds: time, frames: frames)
    }
}

public enum SDChecksum {
    public static func crc32(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xffff_ffff
        for byte in data {
            crc ^= UInt32(byte)
            for _ in 0..<8 { crc = (crc >> 1) ^ ((crc & 1) == 0 ? 0 : 0xedb8_8320) }
        }
        return crc ^ 0xffff_ffff
    }
}

public enum SDProtocol {
    public static let serviceUUID = "a71d0000-6b8d-4e75-a1b2-7d0e6f545243"
    public static let commandUUID = "a71d0001-6b8d-4e75-a1b2-7d0e6f545243"
    public static let responseUUID = "a71d0002-6b8d-4e75-a1b2-7d0e6f545243"

    public static func request(op: UInt8, id: UInt32, fileID: UInt64 = 0, offset: UInt32 = 0) -> Data {
        var data = Data("TSRQ".utf8); data.append(contentsOf: [1, op, 0, 0])
        for value in [UInt64(id), fileID, UInt64(offset)].enumerated() {
            let length = value.offset == 1 ? 8 : 4
            for shift in 0..<length { data.append(UInt8(truncatingIfNeeded: value.element >> (shift*8))) }
        }
        return data
    }

    public struct Response: Sendable {
        public let op: UInt8, status: UInt8
        public let requestID: UInt32, offset: UInt32, total: UInt32
        public let fileID: UInt64
        public let partial: Bool
        public let payload: Data
        public init(data: Data) throws {
            guard data.count >= 36, data.prefix(4) == Data("TSRP".utf8), data[4] == 1,
                  data[7] <= 1, data[30] == 0, data[31] == 0,
                  data.count == 36 + Int(data.sdUInt16(28)) else { throw SDRecordingError.invalidHeader }
            guard SDChecksum.crc32(data.dropLast(4)) == data.sdUInt32(data.count-4) else { throw SDRecordingError.checksum }
            op = data[5]; status = data[6]; partial = data[7] == 1; requestID = data.sdUInt32(8)
            fileID = data.sdUInt64(12); offset = data.sdUInt32(20); total = data.sdUInt32(24)
            payload = data.subdata(in: 32..<data.count-4)
        }
    }
}

private extension Data {
    func sdUInt16(_ offset: Int) -> UInt16 { UInt16(self[offset]) | UInt16(self[offset+1]) << 8 }
    func sdUInt32(_ offset: Int) -> UInt32 {
        (0..<4).reduce(UInt32(0)) { $0 | UInt32(self[offset+$1]) << ($1*8) }
    }
    func sdUInt64(_ offset: Int) -> UInt64 {
        (0..<8).reduce(UInt64(0)) { $0 | UInt64(self[offset+$1]) << ($1*8) }
    }
}
