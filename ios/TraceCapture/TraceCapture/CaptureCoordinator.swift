import Foundation
import Observation

/// The one object that knows all the parts: frames in from the pendant, chunk
/// files out to the uploader, status out to the screen.
@Observable
final class CaptureCoordinator {
    static let shared = CaptureCoordinator()

    var connection = "Starting…"
    var battery: Int?
    var pending = 0
    var lastUpload: Date?
    var lastError: String?
    var framesThisChunk = 0
    var endNote: String?

    private let writer = ChunkWriter(directory: UploadQueue.directory)
    private var started = false

    func start() {
        guard !started else { return }
        started = true
        let pendant = PendantConnection.shared
        let uploads = UploadQueue.shared

        pendant.onState = { [weak self] s in DispatchQueue.main.async { self?.connection = s } }
        pendant.onBattery = { [weak self] b in DispatchQueue.main.async { self?.battery = b } }
        pendant.onCodec = { [weak self] c in self?.writer.codec = c }
        pendant.onFrame = { [weak self] frame in
            guard let self else { return }
            if let rolled = self.writer.append(frame: frame) { uploads.enqueue(file: rolled) }
            self.framesThisChunk = self.writer.pendingFrames
        }
        pendant.onDisconnect = { [weak self] in
            guard let self else { return }
            if let file = self.writer.flush() { uploads.enqueue(file: file) }
            self.requestSweep()
        }
        uploads.onChange = { [weak self] in
            DispatchQueue.main.async {
                self?.pending = uploads.pendingCount
                self?.lastUpload = uploads.lastSuccess
                self?.lastError = uploads.lastError
            }
        }
        pending = uploads.pendingCount
        uploads.retryPending()
        pendant.start()
    }

    /// "I'm done — transcribe it": flushes the current chunk, then asks TRACE
    /// to close the open session now instead of after three quiet minutes.
    func endConversation() {
        if let file = writer.flush() { UploadQueue.shared.enqueue(file: file) }
        guard let base = CaptureSettings.baseURL else { return }
        endNote = "Ending…"
        var req = URLRequest(url: base.appendingPathComponent("api/capture/close"))
        req.httpMethod = "POST"
        if let token = CaptureSettings.ingestToken { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        URLSession.shared.dataTask(with: req) { [weak self] _, response, error in
            let ok = error == nil && (200..<300).contains((response as? HTTPURLResponse)?.statusCode ?? 0)
            DispatchQueue.main.async { self?.endNote = ok ? "Ended — it will appear in TRACE in a moment." : "Could not end it — check the connection." }
        }.resume()
    }

    /// Tells TRACE the stream stopped so a quiet session closes promptly.
    private func requestSweep() {
        guard let base = CaptureSettings.baseURL, let token = CaptureSettings.ingestToken else { return }
        var req = URLRequest(url: base.appendingPathComponent("api/capture/sweep"))
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: req).resume()
    }
}
