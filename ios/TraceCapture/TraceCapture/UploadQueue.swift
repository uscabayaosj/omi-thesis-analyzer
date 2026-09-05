import Foundation

/// Background-session uploads: iOS finishes these even while the app is
/// suspended. One task per chunk file; the file is deleted on 2xx, kept and
/// retried on anything else, and dropped after three 400s (a malformed chunk
/// will never succeed). The chunk id is the file name, so a retry is
/// idempotent on the server.
final class UploadQueue: NSObject, URLSessionDataDelegate {
    static let shared = UploadQueue()

    var onChange: (() -> Void)?
    private(set) var lastSuccess: Date?
    private(set) var lastError: String?

    static let directory: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("chunks", isDirectory: true)
    }()

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: "trace.capture.upload")
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.waitsForConnectivity = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    private var inFlight: Set<String> = []
    private var badCount: [String: Int] = [:]

    var pendingCount: Int {
        (try? FileManager.default.contentsOfDirectory(at: Self.directory, includingPropertiesForKeys: nil))?
            .filter { $0.pathExtension == "trch" }.count ?? 0
    }

    func enqueue(file: URL) {
        guard let base = CaptureSettings.baseURL, let token = CaptureSettings.ingestToken else { return }
        let chunkId = file.deletingPathExtension().lastPathComponent
        guard !inFlight.contains(chunkId) else { return }
        var req = URLRequest(url: base.appendingPathComponent("api/capture/chunks"))
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        req.setValue(chunkId, forHTTPHeaderField: "X-Chunk-Id")
        req.setValue(CaptureSettings.deviceIdString, forHTTPHeaderField: "X-Device-Id")
        req.setValue(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev", forHTTPHeaderField: "X-App-Version")
        let task = session.uploadTask(with: req, fromFile: file)
        task.taskDescription = file.path
        inFlight.insert(chunkId)
        task.resume()
        onChange?()
    }

    /// Re-queues everything on disk — on launch, on reconnect, and after settings change.
    func retryPending() {
        session.getAllTasks { [weak self] tasks in
            guard let self else { return }
            let active = Set(tasks.compactMap { $0.taskDescription })
            let files = (try? FileManager.default.contentsOfDirectory(at: Self.directory, includingPropertiesForKeys: nil)) ?? []
            for f in files where f.pathExtension == "trch" && !active.contains(f.path) {
                self.enqueue(file: f)
            }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let path = task.taskDescription else { return }
        let file = URL(fileURLWithPath: path)
        let chunkId = file.deletingPathExtension().lastPathComponent
        inFlight.remove(chunkId)
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        if error == nil, (200..<300).contains(status) {
            try? FileManager.default.removeItem(at: file)
            lastSuccess = .now
            lastError = nil
        } else if status == 400 {
            badCount[chunkId, default: 0] += 1
            lastError = "TRACE rejected a chunk (\(badCount[chunkId]!)×)"
            if badCount[chunkId]! >= 3 { try? FileManager.default.removeItem(at: file) }
        } else {
            lastError = error?.localizedDescription ?? "Upload failed (\(status))"
        }
        onChange?()
    }

    /// Called by the app delegate when iOS relaunches us to finish background uploads.
    var backgroundCompletion: (() -> Void)?
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            self.backgroundCompletion?()
            self.backgroundCompletion = nil
        }
    }
}
