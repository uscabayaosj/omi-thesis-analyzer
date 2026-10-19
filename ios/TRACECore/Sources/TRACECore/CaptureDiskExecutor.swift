import Dispatch

/// FileHandle writes/fsync must not occupy Swift's cooperative executor pool.
final class CaptureDiskExecutor: SerialExecutor, @unchecked Sendable {
    private let queue = DispatchQueue(label: "TRACE.capture.disk", qos: .userInitiated)

    func enqueue(_ job: consuming ExecutorJob) {
        let job = UnownedJob(job)
        queue.async { job.runSynchronously(on: self.asUnownedSerialExecutor()) }
    }
}
