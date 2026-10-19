import AVFoundation
import Foundation
import Opus

enum TRCHAudioDecoderError: LocalizedError {
    case invalidChunk
    case unsupportedCodec(UInt8)
    case invalidFrame
    case decodedAudioTooLarge

    var errorDescription: String? {
        switch self {
        case .invalidChunk: return "This local audio chunk has an invalid TRCH header or frame data."
        case .unsupportedCodec(let id): return "This audio chunk uses unsupported codec 0x\(String(id, radix: 16))."
        case .invalidFrame: return "An Opus frame in this audio chunk could not be decoded."
        case .decodedAudioTooLarge: return "This chunk decodes beyond the local safety limit."
        }
    }
}

/// Decodes the app's framed TRCH v1 Opus queue format into a standard PCM WAV
/// for upload/transcription APIs that do not accept raw DevKit Opus packets.
enum TRCHAudioDecoder {
    private static let headerLength = 16
    private static let maximumTRCHBytes = 4 * 1024 * 1024
    private static let maximumDecodedBytes = 8 * 1024 * 1024
    private static let sampleRate = 16_000.0

    static func decodePCM(_ source: URL) throws -> Data {
        let input = try Data(contentsOf: source, options: .mappedIfSafe)
        guard input.count >= headerLength,
              input.count <= maximumTRCHBytes,
              input.prefix(4) == Data([0x54, 0x52, 0x43, 0x48]),
              input[4] == 1,
              input[6] == 0, input[7] == 0 else {
            throw TRCHAudioDecoderError.invalidChunk
        }
        let codecID = input[5]
        guard codecID == 0x14 || codecID == 0x15 else {
            throw TRCHAudioDecoderError.unsupportedCodec(codecID)
        }
        guard let format = AVAudioFormat(
            opusPCMFormat: .int16,
            sampleRate: sampleRate,
            channels: 1
        ) else {
            throw TRCHAudioDecoderError.invalidChunk
        }
        let decoder = try Opus.Decoder(format: format)
        var pcm = Data()
        var offset = headerLength
        var frameCount = 0

        while offset < input.count {
            guard input.count - offset >= 2 else { throw TRCHAudioDecoderError.invalidFrame }
            let frameLength = Int(input[offset]) | (Int(input[offset + 1]) << 8)
            offset += 2
            guard frameLength > 0, frameLength <= input.count - offset else {
                throw TRCHAudioDecoderError.invalidFrame
            }
            let frame = input.subdata(in: offset..<(offset + frameLength))
            offset += frameLength

            let decoded: AVAudioPCMBuffer
            do {
                decoded = try decoder.decode(frame)
            } catch {
                throw TRCHAudioDecoderError.invalidFrame
            }
            let byteCount = Int(decoded.frameLength) * MemoryLayout<Int16>.size
            guard byteCount > 0,
                  pcm.count <= maximumDecodedBytes - byteCount,
                  let samples = decoded.int16ChannelData?.pointee else {
                throw TRCHAudioDecoderError.decodedAudioTooLarge
            }
            pcm.append(Data(bytes: samples, count: byteCount))
            frameCount += 1
        }

        guard frameCount > 0, pcm.count <= maximumDecodedBytes else {
            throw TRCHAudioDecoderError.invalidChunk
        }
        return pcm
    }

    static func decodeToWAV(_ source: URL, destination: URL) throws {
        let pcm = try decodePCM(source)
        var wav = Self.wavHeader(dataLength: UInt32(pcm.count))
        wav.append(pcm)
        try wav.write(to: destination, options: .atomic)
        #if os(iOS)
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: destination.path
        )
        #endif
    }

    private static func wavHeader(dataLength: UInt32) -> Data {
        var data = Data()
        data.append(contentsOf: Array("RIFF".utf8))
        data.appendLE(36 + dataLength)
        data.append(contentsOf: Array("WAVE".utf8))
        data.append(contentsOf: Array("fmt ".utf8))
        data.appendLE(UInt32(16))
        data.appendLE(UInt16(1))
        data.appendLE(UInt16(1))
        data.appendLE(UInt32(sampleRate))
        data.appendLE(UInt32(sampleRate) * 2)
        data.appendLE(UInt16(2))
        data.appendLE(UInt16(16))
        data.append(contentsOf: Array("data".utf8))
        data.appendLE(dataLength)
        return data
    }
}

private extension Data {
    mutating func appendLE<T: FixedWidthInteger>(_ value: T) {
        var littleEndian = value.littleEndian
        Swift.withUnsafeBytes(of: &littleEndian) { append(contentsOf: $0) }
    }
}
