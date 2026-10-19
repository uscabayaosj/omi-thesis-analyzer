import AVFoundation
import CryptoKit
import Foundation
import Observation
import SwiftUI
import UIKit

struct ConversationAudioManifest: Codable, Sendable {
    struct Chunk: Codable, Sendable {
        let id: String
        let startedAt: String
        let durationMs: Double
        let sha256: String
    }
    let conversationId: String
    let startedAt: String
    let finishedAt: String
    let chunks: [Chunk]
}

enum ConversationAudioError: LocalizedError {
    case unavailable(String)
    var errorDescription: String? { if case .unavailable(let reason) = self { return reason }; return nil }
}

actor ConversationAudioAssembler {
    static let shared = ConversationAudioAssembler()
    static var directory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("TRACE/ConversationAudio", isDirectory: true)
    }
    static func output(_ id: String) -> URL {
        // IDs may originate with Omi: hash them instead of treating them as paths.
        // Separate the corrected timeline from exports cached by earlier builds.
        let key = SHA256.hash(data: Data(("timeline-v2:" + id).utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent("\(key).m4a")
    }
    func assemble(_ manifest: ConversationAudioManifest, records: [LocalChunkRecord]) throws -> URL {
        let fm = FileManager.default
        try fm.createDirectory(at: Self.directory, withIntermediateDirectories: true)
        let output = Self.output(manifest.conversationId)
        if fm.fileExists(atPath: output.path) { return output }
        let partial = output.deletingPathExtension().appendingPathExtension("partial.m4a")
        defer { try? fm.removeItem(at: partial) }
        func date(_ text: String) throws -> Date {
            guard let date = ISO8601DateFormatter.withFractionalSeconds.date(from: text) ?? ISO8601DateFormatter().date(from: text) else { throw ConversationAudioError.unavailable("Invalid recording time.") }
            return date
        }
        let start = try date(manifest.startedAt), end = try date(manifest.finishedAt)
        guard end > start, !manifest.chunks.isEmpty else { throw ConversationAudioError.unavailable("No saved recording is available.") }
        var local: [String: LocalChunkRecord] = [:]
        for record in records {
            guard local.updateValue(record, forKey: record.id.lowercased()) == nil else {
                throw ConversationAudioError.unavailable("The local audio index contains duplicate chunks. The originals have been retained.")
            }
        }
        guard Set(manifest.chunks.map { $0.id.lowercased() }).count == manifest.chunks.count else {
            throw ConversationAudioError.unavailable("The recording manifest contains duplicate chunks.")
        }
        // Validate originals before creating an export, and reject material receive gaps.
        var covered = start
        var ordered: [(ConversationAudioManifest.Chunk, LocalChunkRecord, Date)] = []
        for chunk in manifest.chunks.sorted(by: { $0.startedAt < $1.startedAt }) {
            guard let record = local[chunk.id.lowercased()], fm.fileExists(atPath: record.fileURL.path) else {
                throw ConversationAudioError.unavailable("The complete backup is unavailable: one or more original chunks are missing or were cleared from this iPhone.")
            }
            let hash = SHA256.hash(data: try Data(contentsOf: record.fileURL)).map { String(format: "%02x", $0) }.joined()
            guard hash == chunk.sha256.lowercased() else { throw ConversationAudioError.unavailable("An original audio chunk failed its integrity check.") }
            let chunkStart = try date(chunk.startedAt)
            guard chunkStart.timeIntervalSince(covered) <= 0.5 else { throw ConversationAudioError.unavailable("This recording contains a gap. A continuous backup cannot be created.") }
            covered = max(covered, chunkStart.addingTimeInterval(record.duration))
            ordered.append((chunk, record, chunkStart))
        }
        guard end.timeIntervalSince(covered) <= 0.5 else { throw ConversationAudioError.unavailable("The final part of this recording is unavailable.") }
        // Stream one decoded chunk at a time into AAC; memory does not grow with conversation length.
        var audio: AVAudioFile? = try AVAudioFile(forWriting: partial, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 32000], commonFormat: .pcmFormatInt16, interleaved: false)
        func appendSilence(_ frames: Int) throws {
            guard frames > 0 else { return }
            guard frames <= 8001, let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: false),
                  let silence = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)),
                  let samples = silence.int16ChannelData?[0] else { throw ConversationAudioError.unavailable("Unable to preserve the recording timeline.") }
            samples.initialize(repeating: 0, count: frames); silence.frameLength = AVAudioFrameCount(frames)
            try audio?.write(from: silence)
        }
        var writtenUntil = start
        for (_, record, chunkStart) in ordered {
            try Task.checkCancellation()
            let from = max(start, max(writtenUntil, chunkStart)), to = min(end, chunkStart.addingTimeInterval(record.duration))
            guard to > from else { continue }
            // Preserve the wall-time span across small accepted timestamp gaps.
            // Larger gaps have already been rejected during original validation.
            let gapFrames = Int((from.timeIntervalSince(writtenUntil) * 16000).rounded())
            try appendSilence(gapFrames)
            let pcm = try TRCHAudioDecoder.decodePCM(record.fileURL)
            let offset = Int(max(0, from.timeIntervalSince(chunkStart) * 16000))
            let count = min(pcm.count / 2 - offset, Int(to.timeIntervalSince(from) * 16000))
            guard count > 0, let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: false),
                  let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)),
                  let samples = buffer.int16ChannelData?[0] else { throw ConversationAudioError.unavailable("Unable to decode conversation audio.") }
            buffer.frameLength = AVAudioFrameCount(count)
            pcm.withUnsafeBytes { bytes in
                for i in 0..<count { samples[i] = bytes.loadUnaligned(fromByteOffset: (offset + i) * 2, as: Int16.self) }
            }
            try audio?.write(from: buffer)
            writtenUntil = to
        }
        try appendSilence(Int((end.timeIntervalSince(writtenUntil) * 16000).rounded()))
        audio = nil // Close and finalize the container before publishing it.
        try fm.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: partial.path)
        try fm.moveItem(at: partial, to: output)
        return output
    }
    func clearExports() throws {
        if FileManager.default.fileExists(atPath: Self.directory.path) { try FileManager.default.removeItem(at: Self.directory) }
    }
}

@MainActor @Observable final class ConversationAudioLibrary {
    static let shared = ConversationAudioLibrary()
    var busy = false
    var errors: [String: String] = [:]
    var exports: [String: URL] = [:]
    private var pending = Set(UserDefaults.standard.stringArray(forKey: "trace.audio.pendingConversations") ?? [])
    private var task: Task<Void, Never>?
    private func persist() { UserDefaults.standard.set(pending.sorted(), forKey: "trace.audio.pendingConversations") }
    func enqueue(_ id: String) { pending.insert(id); persist(); resume() }
    func existing(_ id: String) -> URL? {
        let url = ConversationAudioAssembler.output(id)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }
    func resume() {
        guard CaptureModel.shared.audioIndexReady, task == nil, !pending.isEmpty else { return }
        busy = true
        task = Task {
            let background = UIApplication.shared.beginBackgroundTask(withName: "Conversation audio export") { [weak self] in self?.task?.cancel() }
            defer {
                if background != .invalid { UIApplication.shared.endBackgroundTask(background) }
                busy = false; task = nil
            }
            var attempted = Set<String>()
            while let id = pending.sorted().first(where: { !attempted.contains($0) }) {
                if Task.isCancelled { break }
                attempted.insert(id)
                do {
                    let pathID = id.addingPercentEncoding(withAllowedCharacters: CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/%?#"))) ?? id
                    let data = try await NativeConnection.shared.authenticatedData(path: "/api/native/v1/conversations/\(pathID)/audio")
                    let manifest = try JSONDecoder().decode(ConversationAudioManifest.self, from: data)
                    guard manifest.conversationId == id else { throw ConversationAudioError.unavailable("Audio manifest did not match this conversation.") }
                    let url = try await ConversationAudioAssembler.shared.assemble(manifest, records: CaptureModel.shared.completedChunks)
                    exports[id] = url; errors[id] = nil; pending.remove(id); persist()
                } catch { errors[id] = error.localizedDescription }
            }
        }
    }
    func clearExports() async throws {
        guard !busy else { throw ConversationAudioError.unavailable("Please wait for the audio export to finish.") }
        try await ConversationAudioAssembler.shared.clearExports()
        exports = [:]; errors = [:]; pending = []; persist()
    }
}

@MainActor @Observable final class ConversationAudioPlayback: NSObject, AVAudioPlayerDelegate {
    var isPlaying = false
    var elapsed: TimeInterval = 0
    var duration: TimeInterval = 0
    var error: String?
    var isSeeking = false
    private var player: AVAudioPlayer?
    private var loadedURL: URL?
    private var progressTask: Task<Void, Never>?

    func load(_ url: URL) {
        guard loadedURL != url || player == nil else { return }
        stop()
        player = nil
        loadedURL = nil
        duration = 0
        error = nil
        do {
            let audio = try AVAudioPlayer(contentsOf: url)
            audio.delegate = self
            guard audio.prepareToPlay() else {
                throw ConversationAudioError.unavailable("Unable to prepare conversation audio.")
            }
            player = audio
            loadedURL = url
            duration = audio.duration
        } catch { self.error = error.localizedDescription }
    }

    func seek(to position: TimeInterval) {
        guard position.isFinite, let player, duration > 0 else { return }
        elapsed = min(max(position, 0), duration)
        player.currentTime = elapsed
    }

    func play(_ url: URL) {
        load(url)
        guard let audio = player else { return }
        error = nil
        do {
            // Playback must remain audible when the iPhone's silent switch is on.
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
            if elapsed >= duration { seek(to: 0) }
            guard audio.play() else {
                throw ConversationAudioError.unavailable("Unable to start audio playback. Please try again.")
            }
            isPlaying = true
            progressTask = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(250))
                    guard !Task.isCancelled, let self, let player = self.player else { return }
                    if !self.isSeeking { self.elapsed = player.currentTime }
                    self.isPlaying = player.isPlaying
                    if !player.isPlaying { self.stop(resetPosition: false); return }
                }
            }
        } catch {
            stop()
            self.error = error.localizedDescription
        }
    }

    func stop(resetPosition: Bool = true) {
        progressTask?.cancel()
        progressTask = nil
        player?.stop()
        isPlaying = false
        isSeeking = false
        if resetPosition { elapsed = 0; player?.currentTime = 0 }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor [weak self] in
            guard let self, self.player === player else { return }
            self.elapsed = self.duration
            self.stop(resetPosition: false)
            if !flag { self.error = "Audio playback could not finish. Please try again." }
        }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        let message = error?.localizedDescription ?? "Unable to decode conversation audio."
        Task { @MainActor [weak self] in
            guard let self, self.player === player else { return }
            self.stop()
            self.error = message
        }
    }
}

struct ConversationAudioSection: View {
    let id: String
    var conversation: NativeConversation? = nil
    @State private var bookmarks = ConversationBookmarks.shared
    @State private var editingBookmark: ConversationBookmark?
    @State private var bookmarkTitle = ""
    private var recordingStart: Date? { conversation?.displayDate }
    private var recordingEnd: Date? {
        guard let value = conversation?.finishedAt else { return nil }
        return ISO8601DateFormatter.withFractionalSeconds.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
    private var savedBookmarks: [ConversationBookmark] {
        guard let start = recordingStart, let end = recordingEnd else { return [] }
        return bookmarks.within(start: start, end: end)
    }
    @State private var library = ConversationAudioLibrary.shared
    @State private var playback = ConversationAudioPlayback()
    var body: some View {
        Section("Conversation audio") {
            if let url = library.existing(id) {
                Button("Play conversation", systemImage: "play.fill") {
                    playback.play(url)
                }
                .buttonStyle(.borderless)
                .disabled(playback.isPlaying)
                Button("Stop playback", systemImage: "stop.fill") { playback.stop() }
                    .buttonStyle(.borderless)
                    .disabled(!playback.isPlaying)
                if playback.duration > 0 {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(playback.isPlaying ? "Playing conversation" : "Playback stopped")
                        Slider(value: Binding(
                            get: { min(playback.elapsed, playback.duration) },
                            set: { playback.seek(to: $0) }
                        ), in: 0...playback.duration, onEditingChanged: { playback.isSeeking = $0 })
                            .accessibilityLabel("Conversation playback position")
                            .accessibilityValue("\(Int(playback.elapsed)) seconds of \(Int(playback.duration)) seconds")
                        Text("\(Int(playback.elapsed) / 60):\(String(format: "%02d", Int(playback.elapsed) % 60)) / \(Int(playback.duration) / 60):\(String(format: "%02d", Int(playback.duration) % 60))")
                            .monospacedDigit()
                    }.font(.caption).foregroundStyle(.secondary)
                }
                ShareLink(item: url) { Label("Export whole conversation", systemImage: "square.and.arrow.up") }
                    .buttonStyle(.borderless)
            } else {
                Button("Prepare whole conversation audio", systemImage: "waveform") { library.enqueue(id) }.disabled(library.busy)
                if library.busy { ProgressView("Preparing audio…") }
            }
            ForEach(savedBookmarks) { bookmark in
                let offset = max(0, bookmark.recordedAt.timeIntervalSince(recordingStart ?? bookmark.recordedAt))
                HStack {
                    Button {
                        guard let url = library.existing(id) else { return }
                        playback.play(url)
                        playback.seek(to: offset)
                    } label: {
                        Label("\(Int(offset) / 60):\(String(format: "%02d", Int(offset) % 60)) · \(bookmark.title)", systemImage: "bookmark.fill")
                    }.buttonStyle(.borderless).disabled(library.existing(id) == nil)
                    Menu {
                        Button("Rename bookmark") { editingBookmark = bookmark; bookmarkTitle = bookmark.title }
                        Button("Delete bookmark", role: .destructive) { bookmarks.remove(bookmark.id) }
                    } label: { Image(systemName: "ellipsis.circle") }.accessibilityLabel("Bookmark options")
                }
            }
            if !savedBookmarks.isEmpty {
                Text("Bookmarks are saved on this iPhone. Tap one to play from that moment.").font(.footnote).foregroundStyle(.secondary)
            }
            if let error = bookmarks.error { Text(error).foregroundStyle(.red) }
            if let error = library.errors[id] { Text(error).foregroundStyle(.secondary) }
            if let error = playback.error { Text(error).foregroundStyle(.red) }
            Text("Saved TRACE audio is assembled automatically after wrap-up. Exports include silence between speech and are saved as one M4A file. Originals must still be on this iPhone. Clear saved audio in Capture to reclaim storage without deleting text.").font(.footnote).foregroundStyle(.secondary)
        }
        .task(id: library.existing(id)) {
            if let url = library.existing(id) { playback.load(url) }
        }
        .alert("Rename bookmark", isPresented: Binding(get: { editingBookmark != nil }, set: { if !$0 { editingBookmark = nil } })) {
            TextField("Bookmark title", text: $bookmarkTitle)
            Button("Save") { if let mark = editingBookmark { bookmarks.rename(mark.id, title: bookmarkTitle) }; editingBookmark = nil }
            Button("Cancel", role: .cancel) { editingBookmark = nil }
        }
        .onDisappear { playback.stop() }
    }
}
