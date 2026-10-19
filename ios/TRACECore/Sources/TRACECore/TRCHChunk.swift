import Foundation

public enum TRCHChunkError: Error, Equatable {
    case unsupportedCodec(UInt8)
    case invalidTimestamp
    case emptyChunk
    case emptyFrame
    case frameTooLarge(Int)
    case chunkTooLarge(Int)
}

/// Version 1 chunk container consumed by TRACE's prior capture pipeline.
/// Header and fields are little-endian; each record is [u16 payload length][Opus].
public struct TRCHChunk: Sendable, Equatable {
    public static let magic = Data([0x54, 0x52, 0x43, 0x48]) // TRCH
    public static let version: UInt8 = 1
    public static let headerLength = 16
    public static let maximumFrameLength = Int(UInt16.max)
    public static let maximumEncodedLength = 4 * 1024 * 1024

    public let codec: OmiBLEProtocol.Codec
    public let startedAtMilliseconds: Int64
    public let frames: [Data]

    public init(codec: OmiBLEProtocol.Codec, startedAt: Date, frames: [Data]) throws {
        guard codec.isSupportedForOpusCapture else {
            throw TRCHChunkError.unsupportedCodec(codec.rawValue)
        }
        let milliseconds = startedAt.timeIntervalSince1970 * 1_000
        guard milliseconds.isFinite,
              milliseconds >= Double(Int64.min),
              milliseconds < Double(Int64.max) else {
            throw TRCHChunkError.invalidTimestamp
        }
        try Self.validate(frames)
        self.codec = codec
        startedAtMilliseconds = Int64(milliseconds.rounded(.towardZero))
        self.frames = frames
    }

    public init(codec: OmiBLEProtocol.Codec, startedAtMilliseconds: Int64, frames: [Data]) throws {
        guard codec.isSupportedForOpusCapture else {
            throw TRCHChunkError.unsupportedCodec(codec.rawValue)
        }
        try Self.validate(frames)
        self.codec = codec
        self.startedAtMilliseconds = startedAtMilliseconds
        self.frames = frames
    }

    public var encodedData: Data {
        var output = Self.headerData(codec: codec, startedAtMilliseconds: startedAtMilliseconds)

        for frame in frames {
            output.append(Self.frameRecordData(frame))
        }
        return output
    }

    public static func headerData(codec: OmiBLEProtocol.Codec, startedAtMilliseconds: Int64) -> Data {
        var output = Data(capacity: headerLength)
        output.append(magic)
        output.append(version)
        output.append(codec.rawValue)
        output.append(contentsOf: [0, 0])
        output.appendLittleEndian(startedAtMilliseconds)
        return output
    }

    public static func frameRecordData(_ frame: Data) -> Data {
        var output = Data(capacity: 2 + frame.count)
        output.appendLittleEndian(UInt16(frame.count))
        output.append(frame)
        return output
    }

    private static func validate(_ frames: [Data]) throws {
        guard !frames.isEmpty else { throw TRCHChunkError.emptyChunk }
        var encodedLength = headerLength
        for frame in frames {
            guard !frame.isEmpty else { throw TRCHChunkError.emptyFrame }
            guard frame.count <= maximumFrameLength else {
                throw TRCHChunkError.frameTooLarge(frame.count)
            }
            let (recordLength, recordOverflow) = frame.count.addingReportingOverflow(2)
            let (newLength, totalOverflow) = encodedLength.addingReportingOverflow(recordLength)
            guard !recordOverflow, !totalOverflow, newLength <= maximumEncodedLength else {
                throw TRCHChunkError.chunkTooLarge(newLength)
            }
            encodedLength = newLength
        }
    }
}

private extension Data {
    mutating func appendLittleEndian<T: FixedWidthInteger>(_ value: T) {
        var littleEndian = value.littleEndian
        Swift.withUnsafeBytes(of: &littleEndian) { bytes in
            append(contentsOf: bytes)
        }
    }
}
