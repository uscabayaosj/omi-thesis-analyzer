import Foundation
import Observation
import AVFoundation
import TRACECore
import Network
import CryptoKit

extension Notification.Name {
    static let traceConversationUpdated = Notification.Name("trace.conversation.updated")
}

@MainActor
@Observable
final class CaptureModel {
    static let shared = CaptureModel()

    var devKitControlsStatus = "Connect a DevKit with TRACE controls firmware"
    var lastDevKitAction: String?
    @ObservationIgnored private let healthFeedback = DevKitHealthFeedback()
    @ObservationIgnored private var pendingControlFeedback: Bool?

    var sdStatus = "SD support requires the new TRACE SD firmware"
    var sdBusy = false
    var sdFallbackEnabled = UserDefaults.standard.bool(forKey: "trace.native.sd.fallback")
    @ObservationIgnored private var sdTask: Task<Void, Never>?
    @ObservationIgnored private let sdArchive = SDArchive()
    var sdAvailable: Bool { transport.sd.available }

    var connectionStatus = "Starting Bluetooth…"
    var codecLabel = "Not connected"
    var batteryLevel: Int?
    var capturedFrames = 0
    @ObservationIgnored private var telemetry = CaptureTelemetryGate()
    @ObservationIgnored private let diagnostics = CaptureDiagnostics()
    @ObservationIgnored private var foregroundUI = false
    @ObservationIgnored private var latestAudioWrittenAt: Date?

    func setForegroundUI(_ foreground: Bool) {
        foregroundUI = foreground
        if foreground {
            capturedFrames = telemetry.foregroundSnapshot(at: .now)
            lastSavedAudioAt = latestAudioWrittenAt
        }
    }
    #if DEBUG
    var deviceTestDisconnects = 0
    var deviceTestRecoveredChunks = UserDefaults.standard.integer(forKey: "trace.debug.recoveredChunks")
    var deviceTestNetworkAvailable: Bool?
    func interruptLinkForDeviceTest() { transport.interruptLinkForDeviceTest() }
    #endif
    var pendingChunks = 0
    var pendingUploadCount = 0
    var uploadInProgressID: String?
    var serverCaptureStatus = "No capture sent"
    let liveTranscript = LiveTranscription()
    // A restored BLE connection must never start a new recording implicitly.
    // Capture can be resumed from the UI after the app has launched.
    var capturePaused = true {
        didSet {
            transport.setCapturePaused(capturePaused)
            CaptureLocation.shared.setRecording(!capturePaused)
            refreshRecordingAlerts()
        }
    }

    func refreshRecordingAlerts() {
        RecordingAlerts.shared.configure(paused: capturePaused, sdFallback: sdFallbackEnabled, batteryLevel: batteryLevel)
        healthFeedback.configure(paused: capturePaused)
    }
    var lastError: String?
    var discoveredDevices: [DiscoveredPendant] = []
    var completedChunks: [LocalChunkRecord] = []
    var activePlaybackID: String?
    var wavExportURLs: [String: URL] = [:]
    var preparingChunkID: String?

    private var lastSavedAudioAt: Date?
    private var localWriteFailed = false
    var latestSavedConversationID: String?

    func recordingState(at now: Date = .now) -> CaptureRecordingState {
        .resolve(paused: capturePaused,
                 connected: connectionStatus == "Connected; capturing to this iPhone",
                 lastSavedAudioAt: lastSavedAudioAt, now: now,
                 storageAvailable: writer != nil && !localWriteFailed)
    }
    var captureMode: String { recordingState().rawValue }

    var needsTranscriptionRetry: Bool {
        serverCaptureStatus.hasPrefix("Transcription needs retry") || serverCaptureStatus.hasPrefix("Summary needs retry")
    }

    @ObservationIgnored private let transport = PendantTransport()
    @ObservationIgnored private let chunkIndex = LocalChunkIndex()
    @ObservationIgnored private let writer: ChunkFileWriter?
    @ObservationIgnored private var localWritesInFlight = 0
    private(set) var isFinishingCapture = false
    @ObservationIgnored private var boundaryDrain: CaptureBoundaryDrain?
    @ObservationIgnored private var boundaryDrainTask: Task<Void, Never>?
    @ObservationIgnored private var captureGeneration = UUID()
    @ObservationIgnored private var pendingWrite: Task<Void, Never>?
    @ObservationIgnored private var recoveryTask: Task<Void, Never>?
    @ObservationIgnored private var recoveryFinished = false
    @ObservationIgnored private var lastSessionForCapture: String?
    @ObservationIgnored private var uploadTask: Task<Void, Never>?
    @ObservationIgnored private var uploadRetryTask: Task<Void, Never>?
    @ObservationIgnored private var uploadRetryAttempt = 0
    @ObservationIgnored private let networkMonitor = NWPathMonitor()
    @ObservationIgnored private var manuallyAuthorizedUploadScopes = UserDefaults.standard.dictionary(forKey: "trace.native.capture.manualScopes") as? [String: String] ?? [:]
    private var manuallyAuthorizedUploads: Set<String> { Set(manuallyAuthorizedUploadScopes.filter { $0.value == NativeConnection.shared.captureUploadScope }.map(\.key)) }
    @ObservationIgnored private var started = false
    @ObservationIgnored private var recordingChunkOpen = false
    @ObservationIgnored private var liveTranscriptInterrupted = false
    @ObservationIgnored private var closeCaptureAfterUpload = false
    @ObservationIgnored private var queuedUploadIDs = Set(UserDefaults.standard.stringArray(forKey: "trace.native.capture.uploadQueue") ?? [])
    @ObservationIgnored private var uploadedChunkIDs = Set(UserDefaults.standard.stringArray(forKey: "trace.native.capture.uploadedChunks") ?? [])
    @ObservationIgnored private var serverSessionIDs = Set(UserDefaults.standard.stringArray(forKey: "trace.native.capture.serverSessions") ?? [])
    @ObservationIgnored private var serverSessionStatusTask: Task<Void, Never>?
    @ObservationIgnored private var announcedTranscriptIDs = Set<String>()
    var spokenPromptsStatus = "Waiting for DevKit audio alerts"
    @ObservationIgnored private var summaryPrompts = (UserDefaults.standard.data(forKey: "trace.prompts.summaries").flatMap { try? JSONDecoder().decode(SummaryPromptQueue.self, from: $0) }) ?? SummaryPromptQueue()
    @ObservationIgnored private var summaryPromptInFlight = false
    func summaryCompleted(conversationID: String?, status: String?) {
        guard SpokenPromptPreferences.shared.enabled else { return }
        if summaryPrompts.completed(scope: NativeConnection.shared.captureUploadScope, conversationID: conversationID, summaryStatus: status, now: .now) {
            persistSummaryPrompts(); flushSummaryPrompts()
        }
    }
    private func persistSummaryPrompts() {
        if let data = try? JSONEncoder().encode(summaryPrompts) { UserDefaults.standard.set(data, forKey: "trace.prompts.summaries") }
    }
    private func flushSummaryPrompts() {
        guard !summaryPromptInFlight, SpokenPromptPreferences.shared.enabled, transport.promptsAvailable,
              let item = summaryPrompts.next(scope: NativeConnection.shared.captureUploadScope, now: .now) else { return }
        summaryPromptInFlight = true
        let sent = transport.speakPrompt(.summaryCompleted) { [weak self] accepted in
            guard let self else { return }
            self.summaryPromptInFlight = false
            if accepted { self.summaryPrompts.accepted(item); self.persistSummaryPrompts(); self.flushSummaryPrompts() }
        }
        if !sent { summaryPromptInFlight = false }
    }
    #if DEBUG
    func previewSpokenPrompt(_ prompt: SpokenPrompt) { _ = transport.speakPrompt(prompt, preview: true) }
    #endif

    @ObservationIgnored private var audioPlayer: AVAudioPlayer?

    init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let chunkDirectory = support.appendingPathComponent("TRACE/Chunks", isDirectory: true)
        writer = try? ChunkFileWriter(directory: chunkDirectory)
        #if DEBUG
        if NativeUIFixtures.isActive { recoveryFinished = true }
        #endif
        installCallbacks()
        healthFeedback.send = { [weak self] pattern in self?.transport.feedback(pattern) }
        transport.onPromptStatus = { [weak self] status in self?.spokenPromptsStatus = status }
        transport.onPromptReady = { [weak self] in self?.flushSummaryPrompts() }
        transport.onPromptEvent = { [weak self] event in
            guard let self else { return }
            self.diagnostics.recordPrompt(event, paused: self.capturePaused, device: self.transport.pairedDeviceID)
        }
    }

    func start() {
        guard !started else { return }
        started = true
        // A previous process may have been recording when iOS suspended or
        // terminated it. Require an explicit Resume capture action each time
        // TRACE starts, including Bluetooth state restoration.
        capturePaused = true
        UserDefaults.standard.set(true, forKey: "trace.native.capturePaused")
        closeCaptureAfterUpload = true
        UserDefaults.standard.set(true, forKey: "trace.native.capture.closeAfterUpload")
        pendingUploadCount = queuedUploadIDs.count
        guard let writer else {
            lastError = "Could not create local capture storage"
            RecordingAlerts.shared.storageFailed()
            self.healthFeedback.storageFailed()
            return
        }
        transport.start()
        networkMonitor.pathUpdateHandler = { [weak self] path in
            let available = path.status == .satisfied
            Task { @MainActor [weak self] in
                #if DEBUG
                self?.deviceTestNetworkAvailable = available
                #endif
                guard available else { return }
                self?.uploadRetryAttempt = 0
                self?.scheduleUploadDrain()
            }
        }
        networkMonitor.start(queue: DispatchQueue(label: "trace.capture.network"))
        recoveryTask = Task { [weak self, writer] in
            do {
                let recovered = try await writer.recoverInterruptedChunks()
                #if DEBUG
                if let self {
                    self.deviceTestRecoveredChunks += recovered.count
                    UserDefaults.standard.set(self.deviceTestRecoveredChunks, forKey: "trace.debug.recoveredChunks")
                }
                #endif
                if let scope = NativeConnection.shared.captureUploadScope {
                    let authorized = try await writer.authorizedCompletedChunks(scope: scope)
                    for url in authorized {
                        self?.enqueueForUpload(url.deletingPathExtension().lastPathComponent)
                    }
                }
                await self?.reloadCompletedChunks(using: writer)
                self?.recoveryFinished = true
                ConversationAudioLibrary.shared.resume()
                self?.scheduleUploadDrain()
            } catch {
                self?.lastError = "Could not recover queued audio: \(error.localizedDescription)"
            }
        }
    }

    func scanForPendant() {
        discoveredDevices.removeAll()
        transport.scan()
    }

    func pair(_ pendant: DiscoveredPendant) {
        batteryLevel = nil // Do not attribute the previous device's reading.
        transport.pair(pendant)
        refreshRecordingAlerts()
    }

    func toggleCapturePause() {
        guard !sdBusy, !isClearingAudio, !isClosingServerSession, !isFinishingCapture else { return }
        captureGeneration = UUID()
        if !capturePaused { startBoundaryDrain() }
        capturePaused.toggle()
        UserDefaults.standard.set(capturePaused, forKey: "trace.native.capturePaused")
        if capturePaused {
            liveTranscriptInterrupted = false
            liveTranscript.stop()
            closeCaptureAfterUpload = true
            UserDefaults.standard.set(true, forKey: "trace.native.capture.closeAfterUpload")
            // Final in-flight frames are admitted until the stop drain finishes.
        } else {
            diagnostics.begin()
            diagnostics.recordBoundary("resume")
            lastSessionForCapture = nil
            latestSavedConversationID = nil
            lastSavedAudioAt = nil
            latestAudioWrittenAt = nil
            localWriteFailed = false
            liveTranscriptInterrupted = false
            liveTranscript.start()
            closeCaptureAfterUpload = false
            UserDefaults.standard.set(false, forKey: "trace.native.capture.closeAfterUpload")
        }
    }

    func retryLiveTranscript() {
        guard !capturePaused else { return }
        liveTranscript.resumeAfterInterruption()
    }

    private func startBoundaryDrain() {
        isFinishingCapture = true
        boundaryDrain = CaptureBoundaryDrain()
        boundaryDrain?.requestPause(at: ProcessInfo.processInfo.systemUptime)
        diagnostics.recordBoundary("pause-requested")
        boundaryDrainTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                self.transport.readFirmwareStats()
                do { try await Task.sleep(for: .milliseconds(100)) } catch { return }
                if let outcome = self.boundaryDrain?.poll(at: ProcessInfo.processInfo.systemUptime) {
                    self.finishBoundaryDrain(outcome)
                    return
                }
            }
        }
    }

    private func finishBoundaryDrain(_ outcome: CaptureBoundaryDrain.Outcome) {
        guard isFinishingCapture, boundaryDrainTask != nil else { return }
        boundaryDrainTask?.cancel(); boundaryDrainTask = nil
        diagnostics.recordBoundary("pause-drain-\(outcome.rawValue)")
        if outcome != .sampledSettled {
            lastError = "Pause requested; device settlement could not be verified (\(outcome.rawValue)). Received audio has been retained."
        }
        finishCurrentChunk(closeServerSession: true)
    }

    func refreshProcessing() {
        scheduleUploadDrain()
        scheduleServerSessionStatusCheck()
    }

    func finishConversation() {
        guard !sdBusy, !isClearingAudio, !isClosingServerSession, !isFinishingCapture else { return }
        captureGeneration = UUID()
        let wasRecording = !capturePaused
        if wasRecording { startBoundaryDrain() }
        capturePaused = true
        UserDefaults.standard.set(true, forKey: "trace.native.capturePaused")
        liveTranscript.stop()
        if !wasRecording { finishCurrentChunk(closeServerSession: true) }
        serverCaptureStatus = NativeConnection.shared.enrolled
            ? "Finishing conversation; saving transcript and summary…"
            : "Finishing conversation; saving audio on this iPhone…"
    }

    func uploadForTranscription(_ chunk: LocalChunkRecord) {
        guard NativeConnection.shared.enrolled else {
            lastError = "Enroll this iPhone before uploading audio for transcription."
            return
        }
        if let scope = NativeConnection.shared.captureUploadScope {
            manuallyAuthorizedUploadScopes[chunk.id] = scope
            UserDefaults.standard.set(manuallyAuthorizedUploadScopes, forKey: "trace.native.capture.manualScopes")
        }
        enqueueForUpload(chunk.id)
        scheduleUploadDrain()
    }

    func chunkWasUploaded(_ id: String) -> Bool {
        uploadedChunkIDs.contains(id)
    }

    func chunkIsQueuedForUpload(_ id: String) -> Bool {
        queuedUploadIDs.contains(id)
    }

    private func enqueueForUpload(_ id: String) {
        guard !uploadedChunkIDs.contains(id) else { return }
        queuedUploadIDs.insert(id)
        persistUploadQueue()
        pendingUploadCount = queuedUploadIDs.count
    }

    private func persistUploadQueue() {
        UserDefaults.standard.set(queuedUploadIDs.sorted(), forKey: "trace.native.capture.uploadQueue")
        UserDefaults.standard.set(uploadedChunkIDs.sorted(), forKey: "trace.native.capture.uploadedChunks")
    }

    private func scheduleUploadDrain() {
        guard recoveryFinished, uploadTask == nil, NativeConnection.shared.enrolled,
              !queuedUploadIDs.isEmpty || closeCaptureAfterUpload else { return }
        uploadRetryTask?.cancel()
        uploadRetryTask = nil
        uploadTask = Task { [weak self] in
            guard let self else { return }
            var finishedPass = false
            defer {
                self.uploadTask = nil
                if finishedPass, !self.queuedUploadIDs.isEmpty {
                    self.scheduleUploadDrain()
                }
            }
            finishedPass = await self.drainUploads()
        }
    }

    private func drainUploads() async -> Bool {
        guard let writer else { return false }
        let uploadScope = NativeConnection.shared.captureUploadScope
        let records = completedChunks
        let dates = Dictionary(uniqueKeysWithValues: records.map { ($0.id, $0.startedAt) })
        let ids = UploadRetryPolicy.orderedIDs(queuedUploadIDs, startedAt: dates)
        for id in ids {
            guard !Task.isCancelled, NativeConnection.shared.captureUploadScope == uploadScope else { return false }
            guard let urls = try? await writer.completedChunks(),
                  let url = urls.first(where: { $0.deletingPathExtension().lastPathComponent == id }) else {
                queuedUploadIDs.remove(id)
                persistUploadQueue()
                pendingUploadCount = queuedUploadIDs.count
                lastError = "A queued audio chunk is missing from local storage and cannot be uploaded."
                continue
            }
            guard NativeConnection.shared.captureUploadScope == uploadScope else { return false }
            guard ChunkFileWriter.uploadScope(for: url) == uploadScope || manuallyAuthorizedUploads.contains(id) else {
                lastError = "A queued recording belongs to a different TRACE connection. Reconnect to its original server or explicitly upload this chunk."; return false
            }
            uploadInProgressID = id
            do {
                let payload = try Data(contentsOf: url, options: .mappedIfSafe)
                let record = try LocalChunkRecord.read(from: url)
                var headers = ["X-Chunk-Id": id]
                if let location = try? Data(contentsOf: record.fileURL.deletingPathExtension().appendingPathExtension("location")), let text = String(data: location, encoding: .utf8) { headers["X-TRACE-Location"] = text }
                if record.duration > 120 { headers["X-TRACE-Recovery"] = "oversized-v1" }
                let response = try await NativeConnection.shared.authenticatedRequest(
                    path: "/api/native/v1/capture/chunks",
                    method: "POST",
                    body: payload,
                    contentType: "application/octet-stream",
                    additionalHeaders: headers
                )
                guard let receipt = try JSONSerialization.jsonObject(with: response) as? [String: Any],
                      receipt["accepted"] as? Bool == true,
                      receipt["chunkId"] as? String == id else {
                    throw UploadError.invalidReceipt
                }
                if let sessionID = receipt["sessionId"] as? String {
                    lastSessionForCapture = sessionID
                    serverSessionIDs.insert(sessionID)
                    UserDefaults.standard.set(serverSessionIDs.sorted(), forKey: "trace.native.capture.serverSessions")
                    serverCaptureStatus = "Audio accepted; conversation will process when capture ends."
                    scheduleServerSessionStatusCheck()
                } else if (receipt["voicedMs"] as? Int ?? 0) == 0 {
                    serverCaptureStatus = "Audio accepted; no speech detected in the chunk."
                }
                queuedUploadIDs.remove(id)
                uploadedChunkIDs.insert(id)
                persistUploadQueue()
                pendingUploadCount = queuedUploadIDs.count
                lastError = nil
                uploadRetryAttempt = 0
            } catch {
                lastError = "Audio upload is queued for retry: \(error.localizedDescription)"
                uploadInProgressID = nil
                scheduleUploadRetry(after: error)
                return false
            }
            uploadInProgressID = nil
        }
        if queuedUploadIDs.isEmpty, closeCaptureAfterUpload {
            // A Pause can arrive while an upload awaits its receipt. Finish the local
            // write chain first; its final chunk must be acknowledged before close.
            let generation = captureGeneration
            await pendingWrite?.value
            guard CaptureCompletionPolicy.canClose(requested: closeCaptureAfterUpload, queuedUploads: queuedUploadIDs.count,
                localWrites: localWritesInFlight + (isFinishingCapture ? 1 : 0), generationMatches: generation == captureGeneration) else { return true }

            isClosingServerSession = true
            defer { isClosingServerSession = false }
            do {
                _ = try await NativeConnection.shared.authenticatedRequest(
                    path: "/api/native/v1/capture/close", method: "POST", body: Data("{}".utf8)
                )
                guard captureGeneration == generation else { return true }
                closeCaptureAfterUpload = false
                UserDefaults.standard.set(false, forKey: "trace.native.capture.closeAfterUpload")
                // Silence may have already completed every session in this
                // recording run. Finish still reads that result back instead
                // of waiting forever for an open session that no longer exists.
                serverSessionIDs = CaptureCompletionPolicy.sessionsToRefresh(pending: serverSessionIDs, lastSession: lastSessionForCapture)
                UserDefaults.standard.set(serverSessionIDs.sorted(), forKey: "trace.native.capture.serverSessions")
                if serverSessionIDs.isEmpty {
                    serverCaptureStatus = "Capture saved; no speech detected."
                }
                scheduleServerSessionStatusCheck()
                uploadRetryAttempt = 0
                lastError = nil
            } catch {
                lastError = "The saved transcript session will close when TRACE reconnects: \(error.localizedDescription)"
                scheduleUploadRetry(after: error)
                return false
            }
        }
        return true
    }

    private func scheduleUploadRetry(after error: Error) {
        var httpStatus: Int?
        if case .http(let status, _) = error as? NativeConnectionError { httpStatus = status }
        guard uploadRetryTask == nil,
              let delay = UploadRetryPolicy.delay(attempt: uploadRetryAttempt, httpStatus: httpStatus, networkCode: (error as? URLError)?.code) else { return }
        uploadRetryAttempt += 1
        uploadRetryTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(delay)) } catch { return }
            guard let self else { return }
            self.uploadRetryTask = nil
            self.scheduleUploadDrain()
        }
    }

    private enum UploadError: LocalizedError {
        case invalidReceipt
        var errorDescription: String? {
            "The server did not confirm durable audio acceptance. The local chunk is still queued."
        }
    }

    func retryFailedTranscription() {
        guard NativeConnection.shared.enrolled else { return }
        Task {
            do {
                _ = try await NativeConnection.shared.authenticatedRequest(
                    path: "/api/native/v1/capture/retry", method: "POST", body: Data("{}".utf8)
                )
                serverCaptureStatus = "Retry requested; checking transcript status."
                scheduleServerSessionStatusCheck()
            } catch {
                lastError = "Could not request transcription retry: \(error.localizedDescription)"
            }
        }
    }

    private struct ServerSessionStatus: Decodable {
        let status: String
        let attempts: Int
        let conversationId: String?
        let error: String?
        let summaryStatus: String?
    }

    private func scheduleServerSessionStatusCheck() {
        guard serverSessionStatusTask == nil, !serverSessionIDs.isEmpty,
              NativeConnection.shared.enrolled else { return }
        serverSessionStatusTask = Task { [weak self] in
            guard let self else { return }
            defer { self.serverSessionStatusTask = nil }
            try? await Task.sleep(for: .seconds(1))
            for _ in 0..<45 {
                guard !Task.isCancelled else { return }
                var hasFailedSession = false
                for id in self.serverSessionIDs.sorted() {
                    do {
                        let data = try await NativeConnection.shared.authenticatedData(
                            path: "/api/native/v1/capture/status",
                            queryItems: [URLQueryItem(name: "sessionId", value: id)]
                        )
                        let status = try JSONDecoder().decode(ServerSessionStatus.self, from: data)
                        switch status.status {
                        case "open": self.serverCaptureStatus = "Conversation open; finish now or allow a silence gap."
                        case "transcribing", "cleanup_pending": self.serverCaptureStatus = "Saving transcript and cleaning up raw audio…"
                        case "done":
                            if self.announcedTranscriptIDs.insert(id).inserted {
                                if let conversationID = status.conversationId { ConversationAudioLibrary.shared.enqueue(conversationID) }
                                NotificationCenter.default.post(name: .traceConversationUpdated, object: id)
                            }
                            if status.summaryStatus == "pending" || status.summaryStatus == "processing" {
                                self.serverCaptureStatus = "Transcript saved; creating conversation summary…"
                                continue
                            }
                            if status.summaryStatus == "failed" {
                                hasFailedSession = true
                                self.serverCaptureStatus = "Summary needs retry. Your transcript is saved."
                                continue
                            }
                            self.summaryCompleted(conversationID: status.conversationId, status: status.summaryStatus)
                            self.latestSavedConversationID = status.conversationId
                            self.serverSessionIDs.remove(id)
                            UserDefaults.standard.set(self.serverSessionIDs.sorted(), forKey: "trace.native.capture.serverSessions")
                            self.serverCaptureStatus = status.summaryStatus == "done" ? "Conversation and summary saved in TRACE." : "Transcript saved in TRACE conversations."
                            NotificationCenter.default.post(name: .traceConversationUpdated, object: id)
                        case "discarded":
                            self.serverSessionIDs.remove(id)
                            UserDefaults.standard.set(self.serverSessionIDs.sorted(), forKey: "trace.native.capture.serverSessions")
                            self.serverCaptureStatus = "Session ended; no conversation was saved."
                        case "failed":
                            hasFailedSession = true
                            self.serverCaptureStatus = "Transcription needs retry (\(status.attempts) of 3 attempts)."
                        default: self.serverCaptureStatus = "Checking server processing…"
                        }
                    } catch {
                        self.lastError = "Could not refresh server capture status: \(error.localizedDescription)"
                    }
                }
                if self.serverSessionIDs.isEmpty || hasFailedSession { return }
                try? await Task.sleep(for: .seconds(2))
            }
            self.serverCaptureStatus = "Processing continues on TRACE; reopen Capture to refresh."
        }
    }

    private func enqueueCompletedRecording(at url: URL) {
        // Audio captured before enrollment remains local. Only an explicit
        // per-chunk action can upload those older files.
        guard NativeConnection.shared.enrolled else { return }
        guard let scope = NativeConnection.shared.captureUploadScope,
              ChunkFileWriter.uploadScope(for: url) == scope else { return }
        guard let chunk = completedChunks.first(where: { $0.fileURL == url }) else { return }
        enqueueForUpload(chunk.id)
        scheduleUploadDrain()
    }

    func togglePlayback(of chunk: LocalChunkRecord) {
        if activePlaybackID == chunk.id {
            audioPlayer?.stop()
            audioPlayer = nil
            activePlaybackID = nil
            return
        }
        prepareWAV(for: chunk) { [weak self] wavURL in
            guard let self else { return }
            do {
                let player = try AVAudioPlayer(contentsOf: wavURL)
                player.prepareToPlay()
                guard player.play() else {
                    self.lastError = "Could not play this local audio chunk."
                    return
                }
                self.audioPlayer?.stop()
                self.audioPlayer = player
                self.activePlaybackID = chunk.id
                Task { @MainActor [weak self] in
                    while let self, self.activePlaybackID == chunk.id, self.audioPlayer?.isPlaying == true {
                        try? await Task.sleep(for: .milliseconds(250))
                    }
                    if self?.activePlaybackID == chunk.id {
                        self?.activePlaybackID = nil
                        self?.audioPlayer = nil
                    }
                }
            } catch {
                self.lastError = "Could not play local audio: \(error.localizedDescription)"
            }
        }
    }

    func exportWAV(for chunk: LocalChunkRecord) {
        prepareWAV(for: chunk) { _ in }
    }

    private func prepareWAV(for chunk: LocalChunkRecord, completion: @escaping (URL) -> Void) {
        if let existing = wavExportURLs[chunk.id], FileManager.default.fileExists(atPath: existing.path) {
            completion(existing)
            return
        }
        guard preparingChunkID == nil else { return }
        preparingChunkID = chunk.id
        lastError = nil
        let exportDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("TRACE-Audio-Exports", isDirectory: true)
        let destination = exportDirectory.appendingPathComponent("\(chunk.id).wav")
        Task {
            do {
                try FileManager.default.createDirectory(at: exportDirectory, withIntermediateDirectories: true)
                let source = chunk.fileURL
                try await Task.detached(priority: .utility) {
                    try TRCHAudioDecoder.decodeToWAV(source, destination: destination)
                }.value
                wavExportURLs[chunk.id] = destination
                completion(destination)
            } catch {
                lastError = "Could not decode \(chunk.id.prefix(8)) audio chunk: \(error.localizedDescription)"
            }
            preparingChunkID = nil
        }
    }

    private func reloadCompletedChunks(using writer: ChunkFileWriter) async {
        do {
            let urls = try await writer.completedChunks()
            let scan = await chunkIndex.scan(urls)
            completedChunks = scan.records
            pendingChunks = scan.records.count
            if let error = scan.errors.first { lastError = "A saved audio chunk could not be read: \(error)" }
        } catch {
            lastError = "Could not list local audio chunks: \(error.localizedDescription)"
        }
    }

    private func registerCompletedChunk(_ url: URL) async {
        do {
            let record = try await chunkIndex.read(url)
            if let pin = CaptureLocation.shared.pin(start: record.startedAt, duration: record.duration) {
                try JSONEncoder().encode(pin).write(to: url.deletingPathExtension().appendingPathExtension("location"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            }
            completedChunks.removeAll { $0.id == record.id }
            completedChunks.insert(record, at: 0)
            completedChunks.sort { $0.startedAt > $1.startedAt }
            pendingChunks = completedChunks.count
        } catch {
            lastError = "A saved audio chunk could not be read: \(error.localizedDescription)"
        }
    }

    var audioIndexReady: Bool { recoveryFinished }
    private(set) var isClearingAudio = false
    private(set) var isClosingServerSession = false
    var canClearSavedAudio: Bool {
        !sdBusy && !isFinishingCapture && !isClearingAudio && localWritesInFlight == 0 && recoveryFinished && capturePaused && serverSessionIDs.isEmpty && uploadInProgressID == nil && preparingChunkID == nil && !ConversationAudioLibrary.shared.busy
    }
    func clearSavedAudio() async {
        guard canClearSavedAudio, let writer else { return }
        isClearingAudio = true; defer { isClearingAudio = false }
        audioPlayer?.stop(); audioPlayer = nil; activePlaybackID = nil
        let removable = completedChunks.filter { uploadedChunkIDs.contains($0.id) && !queuedUploadIDs.contains($0.id) }
        do {
            try await writer.removeCompletedChunks(ids: Set(removable.map(\.id)))
            try await ConversationAudioLibrary.shared.clearExports()
            try await sdArchive.clearCache()
            for chunk in removable {
                try? FileManager.default.removeItem(at: chunk.fileURL.deletingPathExtension().appendingPathExtension("location"))
                if let wav = wavExportURLs[chunk.id] { try? FileManager.default.removeItem(at: wav) }
                wavExportURLs[chunk.id] = nil
            }
            try? FileManager.default.removeItem(at: FileManager.default.temporaryDirectory.appendingPathComponent("TRACE-Audio-Exports"))
            wavExportURLs = [:]
            await reloadCompletedChunks(using: writer)
        } catch { lastError = "Could not clear saved audio: \(error.localizedDescription)" }
    }

    func setSDFallback(_ enabled: Bool) {
        guard !sdBusy, !isFinishingCapture, capturePaused, sdAvailable else { return }
        sdFallbackEnabled = enabled
        UserDefaults.standard.set(enabled, forKey: "trace.native.sd.fallback")
        configureSD()
    }

    private func configureSD() {
        guard !sdBusy, sdAvailable else { return }
        sdTask?.cancel()
        let enabled = sdFallbackEnabled
        sdBusy = true
        sdTask = Task { [weak self] in
            guard let self else { return }
            defer { self.sdBusy = false; self.sdTask = nil }
            do { try await self.transport.sd.configure(enabled: enabled) }
            catch { self.sdStatus = error.localizedDescription }
        }
    }

    func importSDRecordings() {
        guard capturePaused, !isFinishingCapture, !sdBusy, !isClosingServerSession, recoveryFinished, sdAvailable, let device = transport.pairedDeviceID, let writer else { return }
        sdBusy = true
        closeCaptureAfterUpload = false
        UserDefaults.standard.set(false, forKey: "trace.native.capture.closeAfterUpload")
        let scope = NativeConnection.shared.captureUploadScope
        sdTask = Task { [weak self] in
            guard let self else { return }
            var imported = 0, interrupted = 0
            defer {
                self.sdBusy = false; self.sdTask = nil
                self.closeCaptureAfterUpload = true
                UserDefaults.standard.set(true, forKey: "trace.native.capture.closeAfterUpload")
                self.scheduleUploadDrain()
            }
            do {
                var cursor: UInt64 = 0
                // The writer drains its final microphone queue after Pause.
                try await Task.sleep(for: .milliseconds(500))
                while true {
                    try Task.checkCancellation()
                    guard self.transport.pairedDeviceID == device, NativeConnection.shared.captureUploadScope == scope else { throw SDTransferError.disconnected }
                    let item = try await self.transport.sd.exchange(op: 1, fileID: cursor)
                    if item.status == 3 { break }
                    guard item.status == 0 else { throw item.status == 5 ? SDTransferError.busy : SDTransferError.device(item.status) }
                    guard item.fileID > cursor, item.total >= 32, item.total <= 1_100_000 else { throw SDTransferError.inconsistent }
                    cursor = item.fileID
                    var offset = try await self.sdArchive.savedOffset(device: device, file: cursor, total: item.total)
                    self.sdStatus = "Importing SD recording \(imported+1)…"
                    var shownPercent = -1
                    while offset < item.total {
                        try Task.checkCancellation()
                        guard self.transport.pairedDeviceID == device, NativeConnection.shared.captureUploadScope == scope else { throw SDTransferError.disconnected }
                        let block = try await self.transport.sd.exchange(op: 2, fileID: cursor, offset: offset)
                        guard block.status == 0, block.fileID == cursor, block.offset == offset, block.total == item.total,
                              block.partial == item.partial, !block.payload.isEmpty,
                              block.payload.count <= Int(item.total-offset) else { throw SDTransferError.inconsistent }
                        try await self.sdArchive.append(block.payload, device: device, file: cursor, offset: offset)
                        offset += UInt32(block.payload.count)
                        let percent = Int(UInt64(offset) * 100 / UInt64(item.total))
                        if percent != shownPercent {
                            shownPercent = percent
                            self.sdStatus = "Importing SD recording \(imported+1): \(percent)%…"
                        }
                    }
                    let recording = try await self.sdArchive.validate(device: device, file: cursor, total: item.total, partial: item.partial)
                    let key = "\(device.uuidString.lowercased())-\(String(cursor, radix: 16))"
                    var identity = Array(SHA256.hash(data: Data(key.utf8)).prefix(16))
                    identity[6] = (identity[6] & 0x0f) | 0x40
                    identity[8] = (identity[8] & 0x3f) | 0x80
                    let hex = identity.map { String(format: "%02x", $0) }.joined()
                    let parts = [String(hex.prefix(8)), String(hex.dropFirst(8).prefix(4)), String(hex.dropFirst(12).prefix(4)), String(hex.dropFirst(16).prefix(4)), String(hex.suffix(12))]
                    guard let id = UUID(uuidString: parts.joined(separator: "-")) else { throw SDTransferError.inconsistent }
                    guard NativeConnection.shared.captureUploadScope == scope else { throw SDTransferError.disconnected }
                    let url = try await writer.importSD(recording.chunk, id: id, uploadScope: scope)
                    if let scope, ChunkFileWriter.uploadScope(for: url) == scope { self.enqueueForUpload(id.uuidString.lowercased()) }
                    imported += 1
                    if recording.interrupted || recording.reportedDrops != 0 { interrupted += 1 }
                    await self.reloadCompletedChunks(using: writer)
                }
                self.sdStatus = "Imported \(imported) SD recordings. Originals remain on the card." + (interrupted > 0 ? " \(interrupted) report interrupted capture or dropped frames." : "")
            } catch {
                self.sdStatus = "Imported \(imported); remaining files retained for retry. " + error.localizedDescription
                await self.reloadCompletedChunks(using: writer)
            }
        }
    }

    private func installCallbacks() {
        transport.sd.onStatus = { [weak self] value in Task { @MainActor in self?.sdStatus = value } }
        transport.onSDReady = { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                let previous = self.sdTask
                previous?.cancel()
                await previous?.value
                self.configureSD()
            }
        }
        transport.onState = { [weak self] value in
            Task { @MainActor in self?.connectionStatus = value }
        }
        transport.onScanStarted = { [weak self] in
            self?.discoveredDevices.removeAll()
        }
        transport.onDeviceFound = { [weak self] value in
            guard let self,
                  !self.discoveredDevices.contains(where: { $0.id == value.id }) else { return }
            self.discoveredDevices.append(value)
            self.discoveredDevices.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        }
        transport.onCodec = { [weak self] codec in
            Task { @MainActor in
                self?.codecLabel = codec.map { "Opus \($0.rawValue == 0x14 ? "10 ms" : "20 ms")" } ?? "Not connected"
            }
        }
        transport.onControlsStatus = { [weak self] in self?.devKitControlsStatus = $0 }
        transport.onControlEvent = { [weak self] kind in
            guard let self else { return }
            if kind == 4 {
                self.lastDevKitAction = "DevKit reported an audio or SD fault. Check Capture and retained recordings."
                self.lastError = self.lastDevKitAction
                return
            }
            guard !self.sdBusy, !self.isClearingAudio, !self.isClosingServerSession, !self.isFinishingCapture else {
                self.lastDevKitAction = "DevKit button ignored while TRACE finishes saving or importing audio."
                return
            }
            if kind == 1 {
                guard !self.capturePaused, let saved = self.latestAudioWrittenAt, Date.now.timeIntervalSince(saved) < 3 else {
                    self.lastDevKitAction = "Bookmark unavailable: no recent saved audio."
                    return
                }
                if ConversationBookmarks.shared.add(at: .now) {
                    self.lastDevKitAction = "Bookmark saved"
                    self.transport.feedback(1)
                } else { self.lastError = ConversationBookmarks.shared.error }
            } else if kind == 2 {
                guard self.writer != nil, self.recoveryFinished, self.transport.controlsConnected else { return }
                self.pendingControlFeedback = !self.capturePaused
                self.toggleCapturePause()
                self.lastDevKitAction = self.capturePaused ? "Pause requested from DevKit" : "Resume requested from DevKit"
            }
        }
        transport.onCaptureAcknowledged = { [weak self] paused in
            guard let self, self.pendingControlFeedback == paused else { return }
            self.pendingControlFeedback = nil
            self.transport.feedback(paused ? 2 : 3)
            self.lastDevKitAction = paused ? "DevKit acknowledged Pause" : "DevKit acknowledged Resume"
        }
        transport.onFirmwareStats = { [weak self] stats in
            self?.diagnostics.recordFirmware(stats)
            self?.boundaryDrain?.observe(stats, at: ProcessInfo.processInfo.systemUptime)
        }
        transport.onPauseAcknowledged = { [weak self] in
            self?.boundaryDrain?.acknowledgePause()
            self?.diagnostics.recordBoundary("pause-acknowledged")
        }
        transport.onRawAudioNotification = { [weak self] data, codecAvailable in
            guard let self else { return }
            self.diagnostics.observedNotification(data, paused: self.capturePaused,
                draining: self.capturePaused && self.boundaryDrain?.mayAcceptAudio == true, codecAvailable: codecAvailable)
        }
        transport.onBattery = { [weak self] value in
            Task { @MainActor in
                self?.batteryLevel = value
                RecordingAlerts.shared.batteryChanged(value)
                self?.healthFeedback.battery(value, device: self?.transport.pairedDeviceID)
            }
        }
        transport.onAudioNotification = { [weak self] notification, codec in
            self?.append(notification, codec: codec)
        }
        transport.onDisconnect = { [weak self] in
            #if DEBUG
            self?.deviceTestDisconnects += 1
            #endif
            self?.pendingControlFeedback = nil
            self?.diagnostics.disconnected()
            self?.liveTranscriptInterrupted = self?.capturePaused == false
            self?.liveTranscript.stop()
            if let self, self.isFinishingCapture {
                self.boundaryDrain?.disconnected()
                self.finishBoundaryDrain(.disconnected)
            } else { self?.finishCurrentChunk(closeServerSession: true) }
        }
    }

    private func append(_ notification: Data, codec: OmiBLEProtocol.Codec) {
        guard !capturePaused || boundaryDrain?.mayAcceptAudio == true else { return }
        guard let writer else { return }
        boundaryDrain?.receivedAudio(at: ProcessInfo.processInfo.systemUptime)
        if liveTranscriptInterrupted {
            liveTranscriptInterrupted = false
            if NativeConnection.shared.enrolled {
                liveTranscript.resumeAfterInterruption()
            }
        }
        let receivedAt = Date.now
        let scope = NativeConnection.shared.captureUploadScope
        let receivedUptime = diagnostics.received(notification)
        let diagnosticSession = diagnostics.sessionID
        let previousWrite = pendingWrite
        let recovery = recoveryTask
        localWritesInFlight += 1
        pendingWrite = Task { [weak self, writer] in
            defer { self?.localWritesInFlight -= 1 }
            await recovery?.value
            await previousWrite?.value
            do {
                let completed = try await writer.append(notification: notification, codec: codec, receivedAt: receivedAt, uploadScope: scope)
                guard let self else { return }
                self.diagnostics.wrote(receivedAt: receivedUptime, session: diagnosticSession, success: true)
                let savedAt = Date.now
                self.latestAudioWrittenAt = savedAt
                RecordingAlerts.shared.savedAudio()
                self.healthFeedback.savedAudio()
                if self.telemetry.recordFrame(at: savedAt, foreground: self.foregroundUI) {
                    self.lastSavedAudioAt = savedAt
                    self.capturedFrames = self.telemetry.frames
                }
                if self.localWriteFailed { self.localWriteFailed = false }
                if !self.capturePaused, NativeConnection.shared.enrolled, NativeConnection.shared.captureUploadScope == scope {
                    self.liveTranscript.append(notification: notification, codec: codec)
                } else { self.liveTranscript.stop() }
                self.recordingChunkOpen = true
                if let completed {
                    await self.registerCompletedChunk(completed)
                    self.enqueueCompletedRecording(at: completed)
                }
            } catch {
                self?.diagnostics.wrote(receivedAt: receivedUptime, session: diagnosticSession, success: false)
                self?.localWriteFailed = true
                RecordingAlerts.shared.storageFailed()
                self?.healthFeedback.storageFailed()
                self?.lastError = "Local audio write failed: \(error.localizedDescription)"
            }
        }
    }

    private func finishCurrentChunk(closeServerSession: Bool = false) {
        guard let writer else { return }
        if closeServerSession && NativeConnection.shared.enrolled {
            closeCaptureAfterUpload = true
            UserDefaults.standard.set(true, forKey: "trace.native.capture.closeAfterUpload")
        }
        let previousWrite = pendingWrite
        let diagnosticSession = diagnostics.sessionID
        localWritesInFlight += 1
        pendingWrite = Task { [weak self, writer] in
            defer { self?.localWritesInFlight -= 1 }
            await previousWrite?.value
            do {
                let completed = try await writer.finish()
                guard let self else { return }
                if self.recordingChunkOpen, let completed {
                    await self.registerCompletedChunk(completed)
                    self.enqueueCompletedRecording(at: completed)
                }
                if self.capturePaused {
                    self.diagnostics.close(session: diagnosticSession)
                    self.isFinishingCapture = false
                    self.diagnostics.recordBoundary("pause-file-finished")
                }
                self.recordingChunkOpen = false
                if self.foregroundUI {
                    self.capturedFrames = self.telemetry.foregroundSnapshot(at: .now)
                    self.lastSavedAudioAt = self.latestAudioWrittenAt
                }
                if closeServerSession && !NativeConnection.shared.enrolled {
                    self.serverCaptureStatus = "Audio saved on this iPhone. Enroll to create a transcript and summary."
                }
                self.scheduleUploadDrain()
            } catch {
                self?.isFinishingCapture = false
                self?.lastError = "Could not finish local audio chunk: \(error.localizedDescription)"
                RecordingAlerts.shared.storageFailed()
                self?.healthFeedback.storageFailed()
            }
        }
    }
}
