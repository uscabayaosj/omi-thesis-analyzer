import Foundation

public enum ChunkFileWriterError: Error, Equatable {
    case invalidNotification
    case unsupportedCodec(UInt8)
    case conflictingImport
}

/// Appends framed Opus packets to disk as they arrive instead of retaining a
/// whole rolling interval in memory. A returned URL is complete and immutable.
public actor ChunkFileWriter {
    private nonisolated let diskExecutor = CaptureDiskExecutor()
    public nonisolated var unownedExecutor: UnownedSerialExecutor {
        diskExecutor.asUnownedSerialExecutor()
    }
    private let directory: URL
    private let rollAfter: TimeInterval
    private var handle: FileHandle?
    private var partialURL: URL?
    private var startedAt: Date?
    private var codec: OmiBLEProtocol.Codec?
    private var frameCount = 0
    private var encodedBytes = TRCHChunk.headerLength
    private var lastSyncAt: Date?
    private var currentUploadScope: String?

    public init(directory: URL, rollAfter: TimeInterval = 30) throws {
        self.directory = directory
        self.rollAfter = max(1, rollAfter)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// Writes a notification's Opus payload, excluding its three-byte BLE header.
    /// If the interval rolls, returns the finished file for a future uploader.
    @discardableResult
    public func append(
        notification: Data,
        codec newCodec: OmiBLEProtocol.Codec,
        receivedAt: Date = .now,
        uploadScope: String? = nil
    ) throws -> URL? {
        guard newCodec.isSupportedForOpusCapture else {
            throw ChunkFileWriterError.unsupportedCodec(newCodec.rawValue)
        }
        guard let packet = OmiBLEProtocol.AudioNotification(notification: notification),
              packet.encodedAudio.count <= TRCHChunk.maximumFrameLength else {
            throw ChunkFileWriterError.invalidNotification
        }

        var completed: URL?
        if let startedAt {
            let codecChanged = codec != newCodec
            let scopeChanged = currentUploadScope != uploadScope
            let intervalElapsed = receivedAt.timeIntervalSince(startedAt) >= rollAfter
            // Queued BLE frames can be written faster than wall time after unlock.
            // Bound encoded duration independently of the write/arrival clock.
            let frameMilliseconds = newCodec.frameDurationMilliseconds ?? 10
            let encodedDurationReached = Double(frameCount * frameMilliseconds) >= min(rollAfter, 120) * 1_000
            let chunkWouldOverflow = encodedBytes + 2 + packet.encodedAudio.count > TRCHChunk.maximumEncodedLength
            if scopeChanged || codecChanged || intervalElapsed || encodedDurationReached || chunkWouldOverflow {
                completed = try finish()
            }
        }

        if handle == nil {
            try begin(codec: newCodec, at: receivedAt, uploadScope: uploadScope)
        }

        try handle?.write(contentsOf: TRCHChunk.frameRecordData(packet.encodedAudio))
        frameCount += 1
        encodedBytes += 2 + packet.encodedAudio.count

        if lastSyncAt.map({ receivedAt.timeIntervalSince($0) >= 1 }) ?? true {
            try handle?.synchronize()
            lastSyncAt = receivedAt
        }
        return completed
    }

    /// Closes and names the current file as a completed TRCH chunk.
    public func finish() throws -> URL? {
        guard let handle, let partialURL else { return nil }
        try handle.synchronize()
        try handle.close()
        self.handle = nil

        guard frameCount > 0 else {
            try FileManager.default.removeItem(at: partialURL)
            clearCurrentChunk()
            return nil
        }

        let completedURL = partialURL.deletingPathExtension().appendingPathExtension("trch")
        try FileManager.default.moveItem(at: partialURL, to: completedURL)
        clearCurrentChunk()
        return completedURL
    }

    /// Repairs a torn final frame after process termination, then finalizes each
    /// recoverable chunk. Invalid headers are quarantined for inspection.
    public func recoverInterruptedChunks() throws -> [URL] {
        let files = try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil
        ).filter { $0.pathExtension == "partial" }

        var recovered: [URL] = []
        for file in files {
            let bytes = try Data(contentsOf: file)
            guard Self.hasValidHeader(bytes) else {
                try quarantine(file)
                continue
            }

            var offset = TRCHChunk.headerLength
            var frameCount = 0
            while offset < bytes.count {
                guard bytes.count - offset >= 2 else { break }
                let frameLength = Int(bytes[offset]) | (Int(bytes[offset + 1]) << 8)
                guard frameLength > 0, bytes.count - offset - 2 >= frameLength else { break }
                offset += 2 + frameLength
                frameCount += 1
            }

            guard frameCount > 0 else {
                try FileManager.default.removeItem(at: file)
                continue
            }
            guard offset <= TRCHChunk.maximumEncodedLength else {
                try quarantine(file)
                continue
            }
            if offset != bytes.count {
                try Data(bytes.prefix(offset)).write(to: file, options: .atomic)
            }

            let destination = file.deletingPathExtension().appendingPathExtension("trch")
            if FileManager.default.fileExists(atPath: destination.path) {
                try quarantine(file)
            } else {
                try FileManager.default.moveItem(at: file, to: destination)
                recovered.append(destination)
            }
        }
        return recovered
    }

    public func completedChunks() throws -> [URL] {
        try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "trch" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    /// A stable ID makes a resumed/repeated SD import idempotent. Existing
    /// contents must match exactly before reuse; the upload scope is never changed.
    public func importSD(_ chunk: TRCHChunk, id: UUID, uploadScope: String?) throws -> URL {
        let name = id.uuidString.lowercased()
        let destination = directory.appendingPathComponent(name).appendingPathExtension("trch")
        let bytes = chunk.encodedData
        if FileManager.default.fileExists(atPath: destination.path) {
            guard try Data(contentsOf: destination) == bytes else { throw ChunkFileWriterError.conflictingImport }
            return destination
        }
        if let uploadScope, !uploadScope.isEmpty {
            let intent = UploadIntent(version: 1, chunkId: name, scope: uploadScope)
            try JSONEncoder().encode(intent).write(to: destination.deletingPathExtension().appendingPathExtension("upload"), options: .atomic)
        }
        try bytes.write(to: destination, options: .atomic)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: destination.path)
        #endif
        return destination
    }

    /// Only completed files are eligible; the current partial recording is never touched.
    public func removeCompletedChunks(ids: Set<String>) throws {
        for url in try completedChunks() where ids.contains(url.deletingPathExtension().lastPathComponent) {
            try FileManager.default.removeItem(at: url)
            try? FileManager.default.removeItem(at: url.deletingPathExtension().appendingPathExtension("upload"))
        }
    }

    /// Authorization is bound to the server/installation at chunk creation.
    /// Untagged older recordings remain available only for explicit upload.
    public func authorizedCompletedChunks(scope: String) throws -> [URL] {
        try completedChunks().filter { Self.uploadScope(for: $0) == scope }
    }

    public nonisolated static func uploadScope(for url: URL) -> String? {
        let id = url.deletingPathExtension().lastPathComponent
        let metadata = url.deletingPathExtension().appendingPathExtension("upload")
        guard let data = try? Data(contentsOf: metadata),
              let intent = try? JSONDecoder().decode(UploadIntent.self, from: data),
              intent.version == 1, intent.chunkId == id, !intent.scope.isEmpty else { return nil }
        return intent.scope
    }

    private struct UploadIntent: Codable {
        let version: Int
        let chunkId: String
        let scope: String
    }

    private func begin(codec: OmiBLEProtocol.Codec, at date: Date, uploadScope: String?) throws {
        let milliseconds = date.timeIntervalSince1970 * 1_000
        guard milliseconds.isFinite,
              milliseconds >= Double(Int64.min),
              milliseconds < Double(Int64.max) else {
            throw TRCHChunkError.invalidTimestamp
        }
        let id = UUID().uuidString.lowercased()
        let url = directory.appendingPathComponent("\(id).partial")
        #if os(iOS)
        let attributes: [FileAttributeKey: Any] = [
            .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication,
        ]
        #else
        let attributes: [FileAttributeKey: Any]? = nil
        #endif
        // Persist intent before audio exists, including the rename-to-complete
        // crash window. The marker contains no provider/installation token.
        if let uploadScope, !uploadScope.isEmpty {
            let metadata = url.deletingPathExtension().appendingPathExtension("upload")
            let data = try JSONEncoder().encode(UploadIntent(version: 1, chunkId: id, scope: uploadScope))
            try data.write(to: metadata, options: .atomic)
            #if os(iOS)
            try FileManager.default.setAttributes(attributes, ofItemAtPath: metadata.path)
            #endif
        }
        guard FileManager.default.createFile(atPath: url.path, contents: nil, attributes: attributes) else {
            throw CocoaError(.fileWriteUnknown)
        }
        let newHandle = try FileHandle(forWritingTo: url)
        do {
            try newHandle.write(contentsOf: TRCHChunk.headerData(
                codec: codec,
                startedAtMilliseconds: Int64(milliseconds.rounded(.towardZero))
            ))
        } catch {
            try? newHandle.close()
            throw error
        }

        handle = newHandle
        partialURL = url
        startedAt = date
        self.codec = codec
        self.currentUploadScope = uploadScope
        frameCount = 0
        encodedBytes = TRCHChunk.headerLength
        lastSyncAt = nil
    }

    private func quarantine(_ file: URL) throws {
        let id = file.deletingPathExtension().lastPathComponent
        let suffix = UUID().uuidString.lowercased()
        let destination = file.deletingLastPathComponent()
            .appendingPathComponent("\(id)-\(suffix).quarantine")
        try FileManager.default.moveItem(at: file, to: destination)
    }

    private static func hasValidHeader(_ data: Data) -> Bool {
        guard data.count >= TRCHChunk.headerLength,
              data.prefix(4) == TRCHChunk.magic,
              data[4] == TRCHChunk.version,
              data[6] == 0,
              data[7] == 0,
              let codec = OmiBLEProtocol.Codec(rawValue: data[5]) else {
            return false
        }
        return codec.isSupportedForOpusCapture
    }

    private func clearCurrentChunk() {
        currentUploadScope = nil
        partialURL = nil
        startedAt = nil
        codec = nil
        frameCount = 0
        encodedBytes = TRCHChunk.headerLength
        lastSyncAt = nil
    }
}
