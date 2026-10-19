import AVFoundation
import Foundation
import Observation
import SwiftUI

struct NativeVoiceProfile: Decodable, Identifiable {
    let id: String
    let personId: String
    let name: String
    let durationSeconds: Double
    let updatedAt: String
}
struct NativeVoiceSettings: Decodable {
    let enabled: Bool
    let revision: Int
    let configured: Bool
    let model: String
    let profiles: [NativeVoiceProfile]
}
@MainActor @Observable final class NativeVoicesModel {
    var settings: NativeVoiceSettings?
    var error: String?
    var busy = false
    private var requestGeneration = UUID()
    func load() async {
        guard !busy else { return }
        let run = UUID(); requestGeneration = run
        do {
            let loaded = try JSONDecoder().decode(NativeVoiceSettings.self, from: await NativeConnection.shared.authenticatedData(path: "/api/native/v1/voices"))
            guard requestGeneration == run, !Task.isCancelled else { return }
            settings = loaded; error = nil
        } catch { if requestGeneration == run, !Task.isCancelled { self.error = error.localizedDescription } }
    }
    func mutate(_ payload: [String: Any]) async -> Bool {
        guard !busy, let settings else { return false }
        requestGeneration = UUID()
        busy = true; defer { busy = false }
        do {
            var body = payload; body["revision"] = settings.revision
            let data = try await NativeConnection.shared.authenticatedRequest(path: "/api/native/v1/voices", method: "POST", body: JSONSerialization.data(withJSONObject: body))
            self.settings = try JSONDecoder().decode(NativeVoiceSettings.self, from: data); error = nil
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
}

struct VoiceCandidate: Identifiable {
    let index: Int
    let start: Double
    let end: Double
    let text: String
    var id: Int { index }
    /// Offer one clear passage per scoped voice, never assume its identity.
    static func suggestions(_ segments: [NativeTranscriptSegment]) -> [VoiceCandidate] {
        var seen = Set<String>()
        let ranked = segments.enumerated().sorted { ($0.element.speakerConfidence ?? 0) > ($1.element.speakerConfidence ?? 0) }
        var out: [VoiceCandidate] = []
        for (index, s) in ranked {
            guard let start = s.start, let end = s.end, start.isFinite, end.isFinite, start >= 0, end - start >= 2.1, start < Double(Int.max / 32000),
                  s.speakerStatus != "uncertain", s.speakerStatus != "unknown", let speaker = s.speakerID, speaker >= 0,
                  !segments.enumerated().contains(where: { other in
                      other.offset != index && (other.element.start ?? .infinity) < end && (other.element.end ?? -.infinity) > start
                  }) else { continue }
            let key = s.voiceProfileID.map { "reference:\($0)" } ?? "\(s.speakerIDScope ?? "legacy"):\(speaker)"
            guard seen.insert(key).inserted else { continue }
            out.append(VoiceCandidate(index: index, start: start, end: min(end, start + 8), text: s.text))
            if out.count == 4 { break }
        }
        return out
    }
}

enum VoiceSampleAudio {
    /// Read only a short passage. Conversation exports preserve wall time at 16 kHz mono.
    static func extract(_ source: URL, start: Double = 0, end: Double = 8) throws -> URL {
        let audio = try AVAudioFile(forReading: source, commonFormat: .pcmFormatInt16, interleaved: true)
        guard audio.processingFormat.sampleRate == 16000, audio.processingFormat.channelCount == 1,
              start.isFinite, end.isFinite, start >= 0, end > start,
              start < Double(audio.length) / 16000 else { throw ConversationAudioError.unavailable("This sample needs mono 16 kHz audio.") }
        let first = AVAudioFramePosition((start * 16000).rounded())
        let last = min(audio.length, AVAudioFramePosition((min(end, Double(audio.length) / 16000) * 16000).rounded()))
        let count = last - first
        guard count >= 32000, count <= 160000 else { throw ConversationAudioError.unavailable("Choose 2–10 seconds of clear speech.") }
        audio.framePosition = first
        guard let buffer = AVAudioPCMBuffer(pcmFormat: audio.processingFormat, frameCapacity: AVAudioFrameCount(count)) else { throw ConversationAudioError.unavailable("Could not read the voice sample.") }
        try audio.read(into: buffer, frameCount: AVAudioFrameCount(count))
        // AVAudioFile may return fewer frames during format conversion. Preserve only
        // the frames actually read; never pad a voice reference or read beyond its passage.
        let readCount = Int64(buffer.frameLength)
        guard readCount >= 32000, readCount <= count, let samples = buffer.int16ChannelData?[0] else { throw ConversationAudioError.unavailable("The sample contains less than two seconds of usable audio.") }
        var bytes = Data()
        func u16(_ n: UInt16) { var value = n.littleEndian; withUnsafeBytes(of: &value) { bytes.append(contentsOf: $0) } }
        func u32(_ n: UInt32) { var value = n.littleEndian; withUnsafeBytes(of: &value) { bytes.append(contentsOf: $0) } }
        bytes.append(Data("RIFF".utf8)); u32(UInt32(readCount * 2 + 36)); bytes.append(Data("WAVEfmt ".utf8)); u32(16)
        u16(1); u16(1); u32(16000); u32(32000); u16(2); u16(16); bytes.append(Data("data".utf8)); u32(UInt32(readCount * 2))
        for i in 0..<Int(readCount) { u16(UInt16(bitPattern: samples[i])) }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("trace-voice-\(UUID().uuidString).wav")
        try bytes.write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
        return url
    }
}

@MainActor @Observable final class VoiceSampleRecorder {
    var recording = false
    private(set) var starting = false
    private var generation = UUID()
    private let permission: @MainActor () async -> Bool
    init(permission: @escaping @MainActor () async -> Bool = {
        await withCheckedContinuation { continuation in AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) } }
    }) { self.permission = permission }
    var sample: URL?
    var error: String?
    private var recorder: AVAudioRecorder?
    private var task: Task<Void, Never>?
    private var raw: URL?
    func record() async {
        guard !recording, !starting else { return }
        guard CaptureModel.shared.capturePaused else { error = "Pause Capture before recording a voice sample."; return }
        cleanup(); error = nil
        starting = true
        let run = generation
        defer { if generation == run { starting = false } }
        let granted = await permission()
        guard generation == run, !Task.isCancelled else { return }
        guard granted else { error = "Allow microphone access in iPhone Settings to record your voice."; return }
        guard CaptureModel.shared.capturePaused else { error = "Pause Capture first."; return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .default); try session.setActive(true)
            let raw = FileManager.default.temporaryDirectory.appendingPathComponent("trace-voice-raw-\(UUID().uuidString).wav"); self.raw = raw
            let recorder = try AVAudioRecorder(url: raw, settings: [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false])
            guard recorder.record(forDuration: 8) else { throw ConversationAudioError.unavailable("Could not start voice recording.") }
            self.recorder = recorder; recording = true
            task = Task {
                try? await Task.sleep(for: .milliseconds(8300))
                guard !Task.isCancelled else { return }
                recorder.stop(); self.recording = false; self.recorder = nil
                try? session.setActive(false, options: .notifyOthersOnDeactivation)
                do { self.sample = try VoiceSampleAudio.extract(raw) }
                catch { self.error = error.localizedDescription }
                try? FileManager.default.removeItem(at: raw); self.raw = nil
            }
        } catch { self.error = error.localizedDescription; cleanup(); try? AVAudioSession.sharedInstance().setActive(false) }
    }
    func cleanup() {
        generation = UUID(); starting = false
        let wasRecording = recording
        task?.cancel(); task = nil; recorder?.stop(); recorder = nil; recording = false
        if let raw { try? FileManager.default.removeItem(at: raw) }; raw = nil
        if let sample { try? FileManager.default.removeItem(at: sample) }; sample = nil
        if wasRecording { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    }
}

struct NativeVoiceProfilesView: View {
    @State private var model = NativeVoicesModel()
    @State private var enrolling = false
    @State private var deleteProfile: NativeVoiceProfile?
    var body: some View {
        List {
            Section {
                Text("Start with your own voice. Add reference samples for up to four people in total, including you. Matches remain suggestions until you confirm them.")
                Button("Record my voice", systemImage: "mic") { enrolling = true }
                    .accessibilityIdentifier("trace.voices.recordSelf")
            }
            if let settings = model.settings {
                Section {
                    Toggle("Recognize reference voices", isOn: Binding(get: {model.settings?.enabled ?? false}, set: { value in Task { _ = await model.mutate(["action": "enable", "enabled": value]) } }))
                        .disabled(model.busy || !settings.configured || settings.profiles.isEmpty)
                    if !settings.configured { Text("OpenAI audio recognition is not configured on this server.").foregroundStyle(.secondary) }
                } footer: {
                    Text("When enabled, new completed conversations and these reference clips are sent to OpenAI for transcription and speaker suggestions. Deepgram still supplies live text and fallback transcription. Existing conversations are unchanged.")
                }
                Section("Reference voices") {
                    ForEach(settings.profiles) { profile in
                        HStack { Text(profile.name); Spacer(); Text("\(profile.durationSeconds, specifier: "%.1f") s").foregroundStyle(.secondary) }
                            .swipeActions { Button("Delete", role: .destructive) { deleteProfile = profile } }
                    }
                    if settings.profiles.isEmpty { Text("No reference voices saved.").foregroundStyle(.secondary) }
                }
                Section("Improve references from real recordings") {
                    Text("In a saved conversation, open Transcript → Review voice samples. Listen to a suggested passage, identify its speaker, and explicitly save or replace their reference. Choose clear speech without overlap. Guesses never update references automatically.")
                }
            }
            if let error = model.error { Section { Text(error).foregroundStyle(.red); Button("Reload") { Task { await model.load() } } } }
        }
        .traceWorkspace().navigationTitle("Voice recognition")
        .task { await model.load() }
        .sheet(isPresented: $enrolling, onDismiss: {Task { await model.load() }}) { NavigationStack { NativeVoiceEnrollmentView(personId: "self") } }
        .confirmationDialog("Delete this reference voice?", isPresented: Binding(get: {deleteProfile != nil}, set: {if !$0 { deleteProfile = nil }}), titleVisibility: .visible) {
            Button("Delete reference", role: .destructive) { if let profile = deleteProfile {Task { _ = await model.mutate(["action": "delete", "id": profile.id]); deleteProfile = nil }} }
        } message: { Text("Its stored sample will be removed. Saved transcripts and speaker corrections remain.") }
    }
}

struct NativeVoiceEnrollmentView: View {
    var personId: String = "self"
    var source: URL? = nil
    var candidate: VoiceCandidate? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var model = NativeVoicesModel()
    @State private var people = NativePeopleModel()
    @State private var recorder = VoiceSampleRecorder()
    @State private var playback = ConversationAudioPlayback()
    @State private var selectedPerson = "self"
    @State private var confirmed = false
    @State private var listened = false
    @State private var saved = false
    var body: some View {
        Form {
            Section {
                if source == nil {
                    Text("Record eight seconds in a quiet place, speaking naturally. Only your voice should be present. Pause Capture first.")
                    Button(recorder.recording ? "Recording eight seconds…" : "Record eight seconds", systemImage: "mic") { confirmed = false; listened = false; playback.stop(); Task { await recorder.record() } }
                        .disabled(recorder.recording || recorder.starting || saved || model.busy || !CaptureModel.shared.capturePaused)
                        .accessibilityIdentifier("trace.voices.record")
                } else {
                    Text("Listen before identifying this sample. Use it only if one person speaks clearly throughout.")
                    if let candidate { Text(candidate.text).foregroundStyle(.secondary) }
                    Button("Not suitable — skip") { dismiss() }
                }
                if let sample = recorder.sample {
                    Button(playback.isPlaying ? "Stop sample" : "Listen to sample", systemImage: playback.isPlaying ? "stop" : "play") {
                        if playback.isPlaying { playback.stop() } else { playback.play(sample) }
                    }.accessibilityIdentifier("trace.voices.listen")
                    Picker("Whose voice?", selection: $selectedPerson) {
                        Text("Me").tag("self")
                        ForEach(people.people) { Text($0.name).tag($0.id) }
                    }
                    .disabled(saved || model.busy)
                    .onChange(of: selectedPerson) { confirmed = false }
                    Toggle("I confirm this is only this person's voice", isOn: $confirmed)
                        .disabled(!listened || saved || model.busy)
                    Button(model.settings?.profiles.contains(where: {$0.personId == selectedPerson}) == true ? "Replace reference voice" : "Save reference voice") {
                        Task {
                            do {
                                let wav = try Data(contentsOf: sample)
                                saved = await model.mutate(["action": "save", "personId": selectedPerson, "wavBase64": wav.base64EncodedString(), "confirmedSingleSpeaker": true])
                            } catch { model.error = error.localizedDescription }
                        }
                    }.disabled(!confirmed || !listened || model.busy || saved || model.settings == nil)
                        .accessibilityIdentifier("trace.voices.save")
                }
            } footer: { Text("Saving uploads this short sample to your private TRACE server. Recognition sends it to OpenAI only after you enable the feature. No identity is learned from model guesses.") }
            if saved { Section { Text("Reference saved. Enable Voice recognition in Settings to use it on new conversations."); Button("Done") { dismiss() } } }
            if let error = recorder.error ?? playback.error ?? model.error ?? people.error { Section { Text(error).foregroundStyle(.red); if model.error != nil { Button("Reload voice settings") { confirmed = false; Task { await model.load() } } } } }
        }
        .traceWorkspace().navigationTitle(source == nil ? "Record a reference voice" : "Identify a voice sample")
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        .task {
            selectedPerson = personId
            await model.load(); guard !Task.isCancelled else { return }; await people.load()
            guard !Task.isCancelled else { return }
            if let source, let candidate {
                do { recorder.sample = try VoiceSampleAudio.extract(source, start: candidate.start, end: candidate.end) }
                catch { recorder.error = error.localizedDescription }
            }
        }
        .onChange(of: scenePhase) { if scenePhase != .active && recorder.recording { recorder.cleanup() } }
        .onChange(of: CaptureModel.shared.capturePaused) { if !CaptureModel.shared.capturePaused && (recorder.recording || recorder.starting) { recorder.cleanup(); recorder.error = "Voice recording stopped because Capture resumed." } }
        .onChange(of: playback.elapsed) { if playback.error == nil && playback.duration > 0 && playback.elapsed >= playback.duration - 0.3 { listened = true } }
        .onDisappear { playback.stop(); recorder.cleanup() }
    }
}

struct NativeVoiceReviewView: View {
    let conversationId: String
    let segments: [NativeTranscriptSegment]
    @State private var source: URL?
    @State private var error: String?
    @State private var selected: VoiceCandidate?
    var body: some View {
        List {
            Section {
                Text("Suggested clips come from the saved audio on this iPhone. They are candidates for you to identify, not confirmed identities. Listen for overlap or a wrong speaker boundary.")
                ForEach(VoiceCandidate.suggestions(segments)) { candidate in
                    Button { selected = candidate } label: {
                        VStack(alignment: .leading) { Text("Sample at \(Int(candidate.start) / 60):\(String(format: "%02d", Int(candidate.start) % 60))"); Text(candidate.text).font(.caption).lineLimit(3).foregroundStyle(.secondary) }
                    }.disabled(source == nil)
                }
                if VoiceCandidate.suggestions(segments).isEmpty { Text("No clear single-speaker passage of at least two seconds was found. Record a reference voice in Settings instead.") }
                if source == nil && error == nil { ProgressView("Preparing saved audio…") }
                if let error { Text(error).foregroundStyle(.red) }
            }
        }
        .traceWorkspace().navigationTitle("Review voice samples")
        .task {
            if let url = ConversationAudioLibrary.shared.existing(conversationId) { source = url; return }
            do {
                let escaped = conversationId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/%?#"))) ?? conversationId
                let data = try await NativeConnection.shared.authenticatedData(path: "/api/native/v1/conversations/\(escaped)/audio")
                let manifest = try JSONDecoder().decode(ConversationAudioManifest.self, from: data)
                guard manifest.conversationId == conversationId else { throw ConversationAudioError.unavailable("Wrong audio manifest.") }
                source = try await ConversationAudioAssembler.shared.assemble(manifest, records: CaptureModel.shared.completedChunks)
            } catch { self.error = error.localizedDescription }
        }
        .sheet(item: $selected) { candidate in NavigationStack { NativeVoiceEnrollmentView(source: source, candidate: candidate) } }
    }
}
