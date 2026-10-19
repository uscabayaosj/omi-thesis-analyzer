import SwiftUI

struct NativeSpeakerCorrectionView: View {
    let conversationId: String
    let revision: String?
    let indices: [Int]
    let segments: [NativeTranscriptSegment]
    let saved: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var voices = NativeVoicesModel()
    @State private var selected = "unknown"
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        Form {
            Section("This passage only") {
                Text(indices.filter {segments.indices.contains($0)}.map {segments[$0].text}.joined(separator: " "))
                Picker("Speaker", selection: $selected) {
                    Text("Unknown — reject suggestion").tag("unknown")
                    ForEach(voices.settings?.profiles ?? []) { Text($0.name).tag($0.id) }
                }
                Text("This correction names only this passage. It does not change the voice reference, other passages, or an already generated summary.").font(.footnote).foregroundStyle(.secondary)
                Button("Save speaker correction") { Task { await save() } }.disabled(busy || voices.settings == nil || revision == nil)
                if voices.settings?.profiles.isEmpty == true {
                    NavigationLink { NativeVoiceProfilesView() } label: { Text("Set up reference voices") }
                }
            }
            if let error = error ?? voices.error { Section { Text(error).foregroundStyle(.red) } }
        }
        .traceWorkspace().navigationTitle("Correct speaker")
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        .task { await voices.load() }
    }
    private func save() async {
        busy = true; defer { busy = false }
        do {
            let passages: [[String: Any]] = indices.filter {segments.indices.contains($0)}.map { index in
                let s = segments[index]; var item: [String: Any] = ["index": index, "text": s.text]
                if let start = s.start { item["start"] = start }; if let end = s.end { item["end"] = end }
                return item
            }
            guard let revision else { throw NativeConnectionError.server("Refresh the conversation before correcting its speaker.") }
            let body: [String: Any] = ["revision": revision, "profileId": selected == "unknown" ? NSNull() : selected as Any, "segments": passages]
            let id = conversationId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/%?#"))) ?? conversationId
            _ = try await NativeConnection.shared.authenticatedRequest(path: "/api/native/v1/conversations/\(id)/speakers", method: "PATCH", body: JSONSerialization.data(withJSONObject: body))
            await saved(); dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
