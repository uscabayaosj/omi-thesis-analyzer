import AVFoundation
import Foundation
import Opus

/// Live captions can skip stale audio; they must never block durable recording.
/// A single decoder worker preserves order with bounded encoded and PCM queues.
final class LivePCMBuffer: @unchecked Sendable {
    private let lock = NSLock()
    private let worker = DispatchQueue(label: "TRACE.capture.live-decoder", qos: .utility)
    private var decoder: Opus.Decoder? // Accessed only by worker.
    private var encodedQueue = [Data]()
    private var buffer = Data()
    private var draining = false
    private var missed = false
    private let maximumQueuedFrames = 300
    private let maximumBufferedBytes = 96_000

    /// Returns accumulated live-stream loss, independently of original audio.
    func enqueue(_ encoded: Data) -> Bool {
        lock.lock()
        if encodedQueue.count >= maximumQueuedFrames {
            encodedQueue.removeFirst()
            missed = true
        }
        encodedQueue.append(encoded)
        let result = missed
        missed = false
        let startWorker = !draining
        draining = true
        lock.unlock()
        if startWorker { worker.async { self.drain() } }
        return result
    }

    private func drain() {
        while true {
            lock.lock()
            guard !encodedQueue.isEmpty else {
                draining = false
                lock.unlock()
                return
            }
            let encoded = encodedQueue.removeFirst()
            lock.unlock()
            do {
                if decoder == nil {
                    guard let format = AVAudioFormat(opusPCMFormat: .int16, sampleRate: 16_000, channels: 1) else {
                        throw CocoaError(.coderInvalidValue)
                    }
                    decoder = try Opus.Decoder(format: format)
                }
                guard let decoded = try decoder?.decode(encoded), let samples = decoded.int16ChannelData?[0] else {
                    throw CocoaError(.coderInvalidValue)
                }
                let pcm = Data(bytes: samples, count: Int(decoded.frameLength) * 2)
                lock.lock()
                buffer.append(pcm)
                if buffer.count > maximumBufferedBytes {
                    buffer.removeFirst(buffer.count - maximumBufferedBytes)
                    missed = true
                }
                lock.unlock()
            } catch {
                lock.lock(); missed = true; lock.unlock()
            }
        }
    }

    func take(upTo count: Int) -> Data {
        lock.lock()
        defer { lock.unlock() }
        let length = min(count, buffer.count)
        let result = Data(buffer.prefix(length))
        buffer.removeFirst(length)
        return result
    }
}
