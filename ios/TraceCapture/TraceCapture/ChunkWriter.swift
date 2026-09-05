import Foundation

/// Accumulates stripped Opus frames and rolls them into a TRCH file every
/// `rollAfter` seconds. The file name is the chunk id, so the uploader needs
/// nothing but the URL.
final class ChunkWriter {
    var codec: UInt8 = 0x15
    private(set) var pendingFrames = 0
    private let directory: URL
    private let rollAfter: TimeInterval
    private var frames: [Data] = []
    private var startedAt: Date?

    init(directory: URL, rollAfter: TimeInterval = 30) {
        self.directory = directory
        self.rollAfter = rollAfter
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// Returns a finished chunk file when this frame caused a roll.
    func append(frame: Data, now: Date = .now) -> URL? {
        var rolled: URL? = nil
        if let started = startedAt, now.timeIntervalSince(started) >= rollAfter {
            rolled = write()
        }
        if startedAt == nil { startedAt = now }
        frames.append(frame)
        pendingFrames = frames.count
        return rolled
    }

    func flush(now: Date = .now) -> URL? {
        guard !frames.isEmpty else { return nil }
        return write()
    }

    private func write() -> URL? {
        guard let started = startedAt, !frames.isEmpty else { return nil }
        let data = ChunkContainer.encode(codec: codec, startedAtMs: Int64(started.timeIntervalSince1970 * 1000), frames: frames)
        let url = directory.appendingPathComponent("\(UUID().uuidString.lowercased()).trch")
        frames.removeAll(keepingCapacity: true)
        pendingFrames = 0
        startedAt = nil
        do {
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }
}
