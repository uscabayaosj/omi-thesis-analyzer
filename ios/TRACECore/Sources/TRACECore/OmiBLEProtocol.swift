import Foundation

/// BLE identifiers and wire framing shared by the DevKit2 firmware and Omi SDKs.
public enum OmiBLEProtocol {
    public static let serviceUUID = "19b10000-e8f2-537e-4f6c-d104768a1214"
    public static let audioDataCharacteristicUUID = "19b10001-e8f2-537e-4f6c-d104768a1214"
    public static let audioCodecCharacteristicUUID = "19b10002-e8f2-537e-4f6c-d104768a1214"
    public static let batteryServiceUUID = "180f"
    public static let batteryLevelCharacteristicUUID = "2a19"
    /// Optional TRACE indicator protocol: one byte, 0 paused / 1 capture active.
    public static let traceControlServiceUUID = "a71c0000-6b8d-4e75-a1b2-7d0e6f545243"
    public static let traceCaptureStateCharacteristicUUID = "a71c0001-6b8d-4e75-a1b2-7d0e6f545243"
    public static let traceStatsCharacteristicUUID = "a71c0002-6b8d-4e75-a1b2-7d0e6f545243"
    public static let liveAudioHeaderLength = 3

    /// Codec IDs currently documented by the Omi device protocol.
    public enum Codec: UInt8, CaseIterable, Sendable {
        case pcm16 = 0
        case pcm8 = 1
        case opusDevKit = 0x14
        case opusFS320 = 0x15

        public var frameDurationMilliseconds: Int? {
            switch self {
            case .opusDevKit: 10
            case .opusFS320: 20
            case .pcm16, .pcm8: nil
            }
        }

        public var isSupportedForOpusCapture: Bool {
            self == .opusDevKit || self == .opusFS320
        }

        public static func characteristicValue(_ data: Data) -> Self? {
            data.first.flatMap(Self.init(rawValue:))
        }
    }

    /// A live audio notification has an undocumented three-byte firmware header.
    /// Keep it available for diagnostics while separating the codec payload.
    public struct AudioNotification: Sendable, Equatable {
        public let firmwareHeader: Data
        public let encodedAudio: Data

        public init?(notification: Data) {
            guard notification.count > OmiBLEProtocol.liveAudioHeaderLength else { return nil }
            firmwareHeader = notification.prefix(OmiBLEProtocol.liveAudioHeaderLength)
            encodedAudio = notification.dropFirst(OmiBLEProtocol.liveAudioHeaderLength)
        }
    }
}
