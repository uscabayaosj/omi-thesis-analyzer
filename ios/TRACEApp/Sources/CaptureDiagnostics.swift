import Foundation
import TRACECore

/// Local aggregate metadata only: no audio, transcript, or credentials.
/// No observable properties and no packet-level disk synchronization.
@MainActor
final class CaptureDiagnostics {
    private(set) var sessionID = UUID()
    private var tracker = AudioSequenceTracker()
    private var handle: DiagnosticFileSink?
    private var lastReceive: TimeInterval?
    private var lastFlush: TimeInterval = 0
    private var maxReceiveGap: TimeInterval = 0
    private var maxWriteDelay: TimeInterval = 0
    private var written = 0
    private var writeFailures = 0
    private var loggingFailed = false
    private let transportEpoch = UUID().uuidString
    private var raw = AudioSequenceTracker()
    private var pausedDiscarded = 0
    private var drainingNotifications = 0
    private var codecUnavailable = 0
    private var firstSequence: Int?
    private var lastSequence: Int?
    private var lastTransportFlush: TimeInterval = 0

    func observedNotification(_ data: Data, paused: Bool, draining: Bool, codecAvailable: Bool) {
        raw.record(data)
        if data.count > 3 {
            let sequence = Int(data[0]) | Int(data[1]) << 8
            firstSequence = firstSequence ?? sequence; lastSequence = sequence
            if !codecAvailable { codecUnavailable += 1 }
            else if draining { drainingNotifications += 1 }
            else if paused { pausedDiscarded += 1 }
        }
        let now = ProcessInfo.processInfo.systemUptime
        if now - lastTransportFlush >= 5 { recordBoundary("transport-progress"); lastTransportFlush = now }
    }
    private var transportCounters: [String: Any] {
        ["epoch": transportEpoch, "rawNotifications": raw.notifications,
         "pausedDiscardedNotifications": pausedDiscarded, "drainNotifications": drainingNotifications,
         "codecUnavailableNotifications": codecUnavailable, "fragmentNotifications": raw.fragments,
         "missingNotifications": raw.missingNotifications, "duplicates": raw.duplicates,
         "firstSequence": firstSequence ?? -1, "lastSequence": lastSequence ?? -1]
    }
    func recordPrompt(_ event: PromptPlaybackEvent, paused: Bool, device: UUID?) {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        DiagnosticFileSink.append(url: support.appendingPathComponent("TRACE/Diagnostics/spoken-prompts.jsonl"), row: [
            "atMilliseconds": Int64(Date.now.timeIntervalSince1970 * 1000),
            "device": device?.uuidString ?? "", "phase": event.phase,
            "prompt": event.prompt?.phrase ?? "", "id": event.prompt?.rawValue ?? 0,
            "sequence": event.sequence, "deviceUptimeMilliseconds": event.deviceUptimeMilliseconds,
            "result": event.result, "preview": event.preview, "capturePaused": paused,
            "captureSession": sessionID.uuidString, "writtenFramesAtReceipt": written,
            "note": "Speaker playback window; originals remain continuous and may contain this prompt"
        ])
    }

    func recordBoundary(_ event: String) {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        DiagnosticFileSink.append(url: support.appendingPathComponent("TRACE/Diagnostics/transport-boundaries.jsonl"),
            row: ["atMilliseconds": Int64(Date.now.timeIntervalSince1970 * 1000), "event": event, "transport": transportCounters])
    }

    func begin() {
        close()
        sessionID = UUID()
        tracker = AudioSequenceTracker(); written = 0; writeFailures = 0
        lastReceive = nil; maxReceiveGap = 0; maxWriteDelay = 0
        lastFlush = 0; loggingFailed = false
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let directory = support.appendingPathComponent("TRACE/Diagnostics", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent("\(UUID().uuidString).jsonl")
            guard FileManager.default.createFile(atPath: url.path, contents: nil) else { return }
            handle = DiagnosticFileSink(url: url)
            flush(event: "start", force: true)
        } catch { loggingFailed = true }
    }
    func recordFirmware(_ stats: FirmwareCaptureStats) {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let url = support.appendingPathComponent("TRACE/Diagnostics/firmware-snapshots.jsonl")
        DiagnosticFileSink.append(url: url, row: ["atMilliseconds": Int64(Date.now.timeIntervalSince1970 * 1000), "counters": stats.counters, "transport": transportCounters])
    }
    func received(_ data: Data) -> TimeInterval {
        let now = ProcessInfo.processInfo.systemUptime
        if let previous = lastReceive { maxReceiveGap = max(maxReceiveGap, now - previous) }
        lastReceive = now
        tracker.record(data)
        flush(event: "progress")
        return now
    }
    func wrote(receivedAt: TimeInterval, session: UUID, success: Bool) {
        guard session == sessionID else { return }
        if success { written += 1 } else { writeFailures += 1 }
        maxWriteDelay = max(maxWriteDelay, ProcessInfo.processInfo.systemUptime - receivedAt)
        flush(event: "progress")
    }
    func disconnected() {
        recordBoundary("disconnect")
        raw.resetBoundary()
        flush(event: "disconnect", force: true)
        tracker.resetBoundary(); lastReceive = nil
    }
    func close(session: UUID? = nil) {
        if let session, session != sessionID { return }
        flush(event: "finish", force: true)
        handle?.close(); handle = nil
    }
    private func flush(event: String, force: Bool = false) {
        let now = ProcessInfo.processInfo.systemUptime
        guard let handle, !loggingFailed, force || now - lastFlush >= 5 else { return }
        let row: [String: Any] = [
            "atMilliseconds": Int64(Date.now.timeIntervalSince1970 * 1000),
            "uptime": now, "event": event, "build": Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown",
            "receivedNotifications": tracker.notifications, "writtenFrames": written,
            "missingNotifications": tracker.missingNotifications,
            "duplicateNotifications": tracker.duplicates,
            "sequenceDiscontinuities": tracker.discontinuities,
            "fragmentNotifications": tracker.fragments, "writeFailures": writeFailures,
            "pendingWrites": max(0, tracker.notifications - written - writeFailures),
            "maximumReceiveGapSeconds": maxReceiveGap,
            "maximumWriteDelaySeconds": maxWriteDelay
        ]
        handle.write(row)
        lastFlush = now; maxReceiveGap = 0; maxWriteDelay = 0
    }
}

/// All diagnostic encoding and fsync run on an ordered utility queue, never
/// inside CoreBluetooth delivery or the durable audio completion callback.
private final class DiagnosticFileSink: @unchecked Sendable {
    private static let queue = DispatchQueue(label: "TRACE.capture.diagnostics", qos: .utility)
    private var file: FileHandle?
    private var failed = false

    init(url: URL) {
        Self.queue.async { self.file = try? FileHandle(forWritingTo: url) }
    }
    func write(_ row: [String: Any]) {
        Self.queue.async {
            guard let file = self.file, !self.failed else { return }
            do {
                var data = try JSONSerialization.data(withJSONObject: row, options: [.sortedKeys])
                data.append(10)
                try file.write(contentsOf: data)
                try file.synchronize()
            } catch { self.failed = true }
        }
    }
    func close() {
        Self.queue.async { try? self.file?.close(); self.file = nil }
    }
    static func append(url: URL, row: [String: Any]) {
        queue.async {
            do {
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                if !FileManager.default.fileExists(atPath: url.path) {
                    guard FileManager.default.createFile(atPath: url.path, contents: nil) else { return }
                }
                let file = try FileHandle(forWritingTo: url)
                defer { try? file.close() }
                try file.seekToEnd()
                var data = try JSONSerialization.data(withJSONObject: row, options: [.sortedKeys])
                data.append(10)
                try file.write(contentsOf: data)
                try file.synchronize()
            } catch { /* Diagnostic failure must not block capture. */ }
        }
    }
}
