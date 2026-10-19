import AVFoundation
import Foundation
import Observation
import Opus
import TRACECore

/// Live captions are a bounded view of capture. Durable local audio remains the
/// source for the complete saved conversation when the connection misses audio.
@MainActor
@Observable
final class LiveTranscription {
    private(set) var text = ""
    private(set) var interim = ""
    private(set) var status = "Starts when you resume capture"
    private(set) var missedAudio = false

    @ObservationIgnored private var capturing = false
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var socket: URLSessionWebSocketTask?
    @ObservationIgnored private var connectionTask: Task<Void, Never>?
    @ObservationIgnored private var sender: Task<Void, Never>?
    @ObservationIgnored private var receiver: Task<Void, Never>?
    @ObservationIgnored private var shutdown: Task<Void, Never>?
    @ObservationIgnored private var audio = LivePCMBuffer()
    @ObservationIgnored private var transcript = LiveTranscriptAccumulator()
    @ObservationIgnored private var previousText = ""
    @ObservationIgnored private let session = URLSession(configuration: .ephemeral)

    #if DEBUG
    func interruptStreamForDeviceTest() {
        socket?.cancel(with: .goingAway, reason: nil)
    }
    #endif

    func start() {
        guard !capturing, NativeConnection.shared.enrolled else { return }
        cancelConnection()
        generation = UUID()
        capturing = true
        text = ""
        interim = ""
        transcript = LiveTranscriptAccumulator()
        previousText = ""
        missedAudio = false
        audio = LivePCMBuffer()
        connect(generation)
    }

    /// A new provider stream has its own result timestamps. Keep the visible
    /// text, but reset result deduplication for the replacement stream.
    func resumeAfterInterruption() {
        guard !capturing, NativeConnection.shared.enrolled else { return }
        let savedText = text
        start()
        previousText = savedText
        text = savedText
        markMissedAudio()
    }

    private func markMissedAudio() {
        if !missedAudio { missedAudio = true }
    }

    func append(notification: Data, codec: OmiBLEProtocol.Codec) {
        guard capturing, codec.isSupportedForOpusCapture,
              let packet = OmiBLEProtocol.AudioNotification(notification: notification) else { return }
        let result = audio.enqueue(packet.encodedAudio)
        if result { markMissedAudio() }
    }

    func stop() {
        guard capturing else { return }
        capturing = false
        status = "Finishing live transcript…"
        let run = generation
        // CloseStream flushes the final provider result. Bound shutdown in case
        // the network disappears, without delaying local capture or its upload.
        shutdown = Task { [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard let self, self.generation == run, !self.capturing else { return }
            self.cancelConnection()
            self.status = "Live transcript ended"
        }
    }

    private struct Grant: Decodable {
        let accessToken: String
        let listenURL: URL
    }

    private func connect(_ run: UUID) {
        status = "Connecting live transcription…"
        connectionTask = Task { [weak self] in
            guard let self else { return }
            do {
                let response = try await NativeConnection.shared.authenticatedRequest(
                    path: "/api/native/v1/capture/deepgram-token", method: "POST", body: Data("{}".utf8)
                )
                let grant = try JSONDecoder().decode(Grant.self, from: response)
                guard self.generation == run, self.capturing, !Task.isCancelled else { return }
                guard grant.listenURL.scheme == "wss", grant.listenURL.host == "api.deepgram.com" else {
                    throw URLError(.badURL)
                }
                var request = URLRequest(url: grant.listenURL)
                request.setValue("Bearer \(grant.accessToken)", forHTTPHeaderField: "Authorization")
                let socket = self.session.webSocketTask(with: request)
                self.socket = socket
                socket.resume()
                self.status = "Live transcription connected"
                self.receive(socket, run: run)
                self.send(socket, run: run)
            } catch {
                guard self.generation == run, !Task.isCancelled else { return }
                self.status = "Live transcription unavailable; your recording stays queued"
                self.markMissedAudio()
                // Authentication/configuration failures are shown to the user.
                // A new capture or explicit retry starts a fresh token request.
                self.capturing = false
            }
        }
    }

    private func send(_ socket: URLSessionWebSocketTask, run: UUID) {
        sender = Task { [weak self] in
            guard let self else { return }
            var lastSent = Date.now
            do {
                while self.generation == run, !Task.isCancelled {
                    let data = self.audio.take(upTo: 6400)
                    guard self.generation == run, !Task.isCancelled else { return }
                    if !data.isEmpty {
                        try await socket.send(.data(data))
                        lastSent = .now
                    } else if !self.capturing {
                        try await socket.send(.string("{\"type\":\"CloseStream\"}"))
                        return
                    } else if Date.now.timeIntervalSince(lastSent) >= 3 {
                        try await socket.send(.string("{\"type\":\"KeepAlive\"}"))
                        lastSent = .now
                    }
                    try await Task.sleep(for: .milliseconds(100))
                }
            } catch {
                self.connectionFailed(run)
            }
        }
    }

    private func receive(_ socket: URLSessionWebSocketTask, run: UUID) {
        receiver = Task { [weak self] in
            guard let self else { return }
            do {
                while self.generation == run, !Task.isCancelled {
                    let message = try await socket.receive()
                    guard self.generation == run else { return }
                    let data: Data
                    switch message {
                    case .data(let value): data = value
                    case .string(let value): data = Data(value.utf8)
                    @unknown default: continue
                    }
                    guard let row = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                    if row["type"] as? String == "Results" {
                        try self.transcript.receive(data)
                        let current = self.transcript.text
                        self.text = String((self.previousText + (self.previousText.isEmpty || current.isEmpty ? "" : "\n") + current).suffix(50_000))
                        self.interim = self.transcript.interim
                    } else if row["type"] as? String == "Metadata", !self.capturing {
                        self.cancelConnection()
                        self.status = "Live transcript ended"
                        return
                    } else if row["type"] as? String == "Error" {
                        self.connectionFailed(run)
                        return
                    }
                }
            } catch { self.connectionFailed(run) }
        }
    }

    private func connectionFailed(_ run: UUID) {
        guard generation == run else { return }
        // Sender and receiver can both report the same broken socket. Retire
        // this stream before cancelling so a second callback cannot overwrite
        // the recoverable failure state with "ended".
        generation = UUID()
        let wasCapturing = capturing
        cancelConnection()
        missedAudio = missedAudio || wasCapturing
        status = wasCapturing ? "Live connection lost; tap Retry live transcript" : "Live transcript ended"
        capturing = false
    }

    private func cancelConnection() {
        connectionTask?.cancel()
        sender?.cancel()
        receiver?.cancel()
        shutdown?.cancel()
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
    }
}
