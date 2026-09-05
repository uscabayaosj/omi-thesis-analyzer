import Foundation

/// The TRCH chunk container, byte-for-byte the layout in the spec and in
/// src/lib/capture/container.ts. The phone only ever writes it.
enum ChunkContainer {
    static let headerBytes = 16
    static let version: UInt8 = 1

    static func encode(codec: UInt8, startedAtMs: Int64, frames: [Data]) -> Data {
        var out = Data(capacity: headerBytes + frames.reduce(0) { $0 + 2 + $1.count })
        out.append(contentsOf: [0x54, 0x52, 0x43, 0x48]) // "TRCH"
        out.append(version)
        out.append(codec)
        out.append(contentsOf: [0, 0]) // reserved
        var started = startedAtMs.littleEndian
        withUnsafeBytes(of: &started) { out.append(contentsOf: $0) }
        for frame in frames {
            var len = UInt16(frame.count).littleEndian
            withUnsafeBytes(of: &len) { out.append(contentsOf: $0) }
            out.append(frame)
        }
        return out
    }
}
