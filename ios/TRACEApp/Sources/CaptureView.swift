import SwiftUI
import TRACECore
import UIKit

struct CaptureView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Bindable var model: CaptureModel
    @State private var showingConnection = false
    @State private var showingDiagnostics = false
    @State private var showingAudio = false
    @State private var showingClearAudio = false
    @State private var location = CaptureLocation.shared
    @State private var connection = NativeConnection.shared
    @State private var navigation = TRACEAppNavigation.shared

    private var deviceLabel: some View {
        Label("DEVKIT2", systemImage: "waveform").labelStyle(.titleAndIcon)
            .font(.caption.weight(.semibold)).tracking(1.2)
            .foregroundStyle(TRACEStyle.accent)
            .fixedSize(horizontal: true, vertical: false)
    }
    private func captureBadge(_ state: CaptureRecordingState) -> some View {
        Text(state.rawValue.uppercased())
            .font(.caption2.weight(.bold)).tracking(1)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("trace.capture.recordingState")
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(TRACEStyle.accent.opacity(0.10), in: Capsule())
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 18) {
                        TimelineView(.periodic(from: .now, by: scenePhase == .active ? 1 : 60)) { _ in
                            // A write can be newer than the scheduled timeline
                            // tick. Resolve against the actual render time.
                            let state = model.recordingState()
                            ViewThatFits(in: .horizontal) {
                                HStack { deviceLabel; Spacer(); captureBadge(state) }
                                VStack(alignment: .leading, spacing: 8) { deviceLabel; captureBadge(state) }
                            }
                            .onChange(of: state) { _, value in
                                if navigation.selectedTab == .capture && UIAccessibility.isVoiceOverRunning {
                                    UIAccessibility.post(notification: .announcement, argument: value.rawValue + ". " + value.message)
                                }
                            }
                        }
                        Button(model.isFinishingCapture ? "Finishing capture…" : model.capturePaused ? "Resume capture" : "Pause capture",
                               systemImage: model.capturePaused ? "mic.fill" : "pause.fill") {
                            model.toggleCapturePause()
                        }
                        .buttonStyle(TRACEPrimaryButtonStyle())
                        .disabled(model.sdBusy || model.isFinishingCapture || model.isClearingAudio || model.isClosingServerSession)
                        TimelineView(.periodic(from: .now, by: 1)) { _ in
                            Text(model.recordingState().message)
                                .font(.subheadline).foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if let action = model.lastDevKitAction {
                            Text(action).font(.footnote).foregroundStyle(.secondary)
                                .accessibilityIdentifier("trace.capture.devKitAction")
                        }
                        if let error = model.lastError {
                            Text(error).font(.footnote).foregroundStyle(.red)
                                .accessibilityIdentifier("trace.capture.error")
                        }

                        if !model.capturePaused {
                            Button("Finish conversation", systemImage: "checkmark.bubble") {
                                model.finishConversation()
                            }
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .buttonStyle(.bordered)
                        }
                    }.padding(.vertical, 8)
                }
                if connection.enrolled {
                    Section("Live transcript") {
                        Text(model.liveTranscript.status).font(.footnote).foregroundStyle(.secondary)
                            .accessibilityIdentifier("trace.capture.live.status")
                        #if DEBUG
                        if ProcessInfo.processInfo.arguments.contains("--trace-live-reconnect-test") {
                            Button("Interrupt live stream for device test") {
                                model.liveTranscript.interruptStreamForDeviceTest()
                            }
                        }
                        #endif
                        if scenePhase == .active {
                        if !model.liveTranscript.text.isEmpty {
                            Text(model.liveTranscript.text).textSelection(.enabled)
                                .accessibilityIdentifier("trace.capture.live.final")
                        }
                        if !model.liveTranscript.interim.isEmpty {
                            Text(model.liveTranscript.interim).foregroundStyle(.secondary)
                                .accessibilityIdentifier("trace.capture.live.interim")
                        }
                        }
                        if model.liveTranscript.missedAudio {
                            Text("Live text may have gaps. TRACE uses your local recording for the complete saved transcript.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        if !model.capturePaused {
                            Button("Retry live transcript") { model.retryLiveTranscript() }
                        }
                        Text("Live text can change while you speak. The final transcript and summary appear in Conversations after processing.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }

                Section("Pendant") {
                    LabeledContent("Connection", value: model.connectionStatus.contains("Connected") ? "Connected · DevKit2" : model.connectionStatus)
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("trace.capture.connection")
                    LabeledContent("Battery", value: model.batteryLevel.map { "\($0)%" } ?? "—")
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("trace.capture.battery")
                    #if DEBUG
                    if ProcessInfo.processInfo.arguments.contains("--trace-ble-reconnect-test") || ProcessInfo.processInfo.arguments.contains("--trace-sd-test") {
                        LabeledContent("Test disconnects", value: String(model.deviceTestDisconnects))
                            .accessibilityElement(children: .combine)
                            .accessibilityIdentifier("trace.capture.test.disconnects")
                        Button("Interrupt BLE for device test") { model.interruptLinkForDeviceTest() }
                    }
                    #endif
                    #if DEBUG
                    if ProcessInfo.processInfo.arguments.contains("--trace-prompts-test") {
                        Text(model.spokenPromptsStatus).accessibilityIdentifier("trace.prompts.status")
                        ForEach(SpokenPrompt.allCases, id: \.rawValue) { prompt in
                            Button("Preview: " + prompt.phrase) { model.previewSpokenPrompt(prompt) }
                                .accessibilityIdentifier("trace.prompts.preview.\(prompt.rawValue)")
                        }
                        Button("Interrupt BLE for prompt test") { model.interruptLinkForDeviceTest() }
                            .accessibilityIdentifier("trace.prompts.disconnect")
                    }
                    #endif
                    Button("Find DevKit2", systemImage: "antenna.radiowaves.left.and.right") {
                        model.scanForPendant()
                    }
                }

                if !model.discoveredDevices.isEmpty {
                    Section("Nearby devices") {
                        ForEach(model.discoveredDevices) { device in
                            Button {
                                model.pair(device)
                            } label: {
                                Label(device.name, systemImage: "mic.circle")
                            }
                            .accessibilityIdentifier("trace.capture.device.\(device.id.uuidString)")
                        }
                    }
                }

                Section("Conversation location") {
                    Toggle("Automatically attach location", isOn: $location.enabled)
                    Text(location.status).font(.footnote).foregroundStyle(.secondary)
                    Text("Only reliable fixes collected during recording are used. The place with the most observed recording time becomes the conversation pin.").font(.footnote).foregroundStyle(.secondary)
                }
                Section("DevKit SD card") {
                    Toggle("Record onto SD when Bluetooth disconnects", isOn: Binding(
                        get: { model.sdFallbackEnabled }, set: { model.setSDFallback($0) }))
                        .disabled(!model.capturePaused || model.sdBusy || !model.sdAvailable)
                        .accessibilityIdentifier("trace.capture.sd.fallback")
                    Text(model.sdStatus).font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("trace.capture.sd.status")
                    Text("Enable while connected, then Resume capture. The DevKit continues onto SD if the phone disconnects. Reconnect and Pause before importing. Turning the DevKit off stops recording; after reboot, Resume again. If out of range, Pause on the phone cannot stop the DevKit.")
                        .font(.footnote).foregroundStyle(.secondary)
                    Button(model.sdBusy ? "Working with SD card…" : "Import SD recordings", systemImage: "square.and.arrow.down") {
                        model.importSDRecordings()
                    }.disabled(!model.capturePaused || model.isFinishingCapture || model.sdBusy || model.isClosingServerSession || !model.sdAvailable || !model.audioIndexReady)
                    .accessibilityIdentifier("trace.capture.sd.import")
                    Text("Imported audio uses the usual transcript and whole-conversation audio path. Files stay on the card. Offline recordings have no automatic GPS pin.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("Audio storage") {
                    Button("Clear saved audio…", role: .destructive) { showingClearAudio = true }
                        .disabled(!model.canClearSavedAudio)
                        .accessibilityIdentifier("trace.capture.clearAudio")
                        .alert("Clear saved audio?", isPresented: $showingClearAudio) {
                            Button("Cancel", role: .cancel) {}
                            Button("Clear audio", role: .destructive) { Task { await model.clearSavedAudio() } }
                        } message: { Text("Uploaded original audio and whole conversation exports will be permanently removed from this iPhone. Text stays saved. Pending uploads are protected.") }
                    Text("Clears uploaded originals and assembled exports from this iPhone. Conversation text, transcripts and summaries remain. Pause capture first; audio waiting to upload is kept. Export recordings you want to keep before clearing.").font(.footnote).foregroundStyle(.secondary)
                }
                Section("Conversation capture") {
                    LabeledContent("Capture mode", value: model.captureMode)
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("trace.capture.mode")
                    LabeledContent("Waiting to upload", value: model.pendingUploadCount.formatted())
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("trace.capture.uploads")
                    if let id = model.latestSavedConversationID {
                        NavigationLink("Open saved conversation", destination: NativeConversationDetailView(id: id))
                    }
                    Text(model.serverCaptureStatus)
                        .font(.subheadline.weight(.medium))
                        .accessibilityIdentifier("trace.capture.status")
                    Text(connection.enrolled
                         ? "Audio streams to Deepgram for live text and uploads to TRACE for the complete transcript and summary. Local originals stay on this iPhone. Conversations finish after 90 seconds of silence, or when you choose Finish conversation."
                         : "Audio stays on this iPhone until you enroll. Capture starts paused whenever TRACE launches.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if connection.enrolled && model.needsTranscriptionRetry {
                        Button("Retry processing", systemImage: "arrow.clockwise") {
                            model.retryFailedTranscription()
                        }
                    }
                }


                Section {
                    DisclosureGroup("Saved audio · \(model.completedChunks.count)", isExpanded: $showingAudio) {
                    if showingAudio && scenePhase == .active {
                    if model.completedChunks.isEmpty {
                        Text("Completed audio chunks will appear here.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(model.completedChunks) { chunk in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(chunk.startedAt.formatted(date: .abbreviated, time: .shortened))
                                            .font(.subheadline.weight(.medium))
                                        Text("\(chunk.duration.formatted(.number.precision(.fractionLength(0...1)))) sec · \(chunk.byteCount.formatted(.byteCount(style: .file))) · Opus \(chunk.codec.frameDurationMilliseconds ?? 0) ms")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Button {
                                        model.togglePlayback(of: chunk)
                                    } label: {
                                        Label(
                                            model.activePlaybackID == chunk.id ? "Stop" : "Play",
                                            systemImage: model.activePlaybackID == chunk.id ? "stop.fill" : "play.fill"
                                        )
                                        .frame(minWidth: 44, minHeight: 44)
                                        .contentShape(Rectangle())
                                    }
                                    .labelStyle(.iconOnly)
                                    .disabled(model.preparingChunkID != nil && model.preparingChunkID != chunk.id)
                                }
                                HStack(spacing: 8) {
                                    if model.chunkWasUploaded(chunk.id) {
                                        Label("Accepted by TRACE", systemImage: "checkmark.icloud")
                                            .foregroundStyle(.secondary)
                                    } else if model.chunkIsQueuedForUpload(chunk.id) {
                                        Label(model.uploadInProgressID == chunk.id ? "Uploading…" : "Queued for upload", systemImage: "arrow.up.icloud")
                                            .foregroundStyle(.secondary)
                                        Button { model.uploadForTranscription(chunk) } label: { Text("Retry").frame(minWidth: 44, minHeight: 44) }
                                            .disabled(model.uploadInProgressID != nil)
                                    } else if connection.enrolled {
                                        Button { model.uploadForTranscription(chunk) } label: { Label("Upload for transcription", systemImage: "text.bubble").frame(minHeight: 44) }
                                        .disabled(model.uploadInProgressID != nil)
                                    } else {
                                        Label("Local only · enrollment required", systemImage: "iphone")
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                .font(.footnote)
                                if let wavURL = model.wavExportURLs[chunk.id] {
                                    ShareLink(item: wavURL) {
                                        Label("Share WAV", systemImage: "square.and.arrow.up").frame(minHeight: 44)
                                    }
                                    .font(.footnote)
                                } else if model.preparingChunkID == chunk.id {
                                    Label("Preparing WAV…", systemImage: "waveform")
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                } else {
                                    Button { model.exportWAV(for: chunk) } label: { Label("Prepare WAV to share", systemImage: "square.and.arrow.up").frame(minHeight: 44) }
                                    .font(.footnote)
                                }
                            }
                            .padding(.vertical, 4)
                            .buttonStyle(.borderless)
                        }
                    }
                    }
                    }
                } header: {
                    Text("Saved audio")
                } footer: {
                    Text("Protected originals stay on this iPhone. Expand Saved audio to play, upload, or share a recording.")
                }

                Section {
                    DisclosureGroup("Recording details", isExpanded: $showingDiagnostics) {
                    LabeledContent("Audio format", value: model.codecLabel)
                    #if DEBUG
                    LabeledContent("Recovered interrupted chunks", value: model.deviceTestRecoveredChunks.formatted())
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("trace.capture.test.recovered")
                    if ProcessInfo.processInfo.arguments.contains("--trace-network-outage-test") {
                        LabeledContent("Test network path", value: model.deviceTestNetworkAvailable.map { $0 ? "Available" : "Unavailable" } ?? "Starting")
                            .accessibilityElement(children: .combine)
                            .accessibilityIdentifier("trace.capture.test.network")
                    }
                    #endif
                    LabeledContent("Frames this run", value: model.capturedFrames.formatted())
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("trace.capture.frames")
                    LabeledContent("Completed local chunks", value: model.pendingChunks.formatted())
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("trace.capture.chunks")
                    }
                }

                Section("TRACE server") {
                    LabeledContent("Connection", value: connection.status)
                    Button("Connection settings", systemImage: "network") {
                        showingConnection = true
                    }
                }

            }
            .traceWorkspace()
            .navigationTitle("Capture")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Settings", systemImage: "gearshape") { showingConnection = true }
                }
            }
            .sheet(isPresented: $showingConnection) {
                NativeSettingsView()
            }
            .task(id: connection.enrolled) {
                await connection.refreshStatus()
                model.refreshProcessing()
            }
        }
    }
}
