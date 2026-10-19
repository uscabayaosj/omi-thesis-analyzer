import SwiftUI

struct NativeSavedGroupView: View {
    let conversationIDs: [String]
    @State private var group: NativeStoredGroup?
    @State private var error: String?
    @State private var loading = false
    var body: some View {
        List {
            if let group {
                Section("Source conversations") {
                    ForEach(group.conversations) { conversation in
                        NavigationLink(conversation.title) { NativeConversationDetailView(id: conversation.id) }
                    }
                }
                Section("Saved group analysis") {
                    paragraph("Cross-conversation themes", group.analysis.crossConversationThemes)
                    paragraph("Contradictions and tensions", group.analysis.contradictionsAndTensions)
                    paragraph("Evolution and patterns", group.analysis.evolutionAndPatterns)
                    paragraph("Synthesis", group.analysis.synthesis)
                    paragraph("Forward thinking", group.analysis.forwardThinking)
                    if let custom = group.custom { paragraph(custom.prompt, custom.result) }
                }
            } else if loading { ProgressView("Loading cited group…") }
            if let error { Text(error).foregroundStyle(.red); Button("Retry group source") { Task { await load() } }.disabled(loading) }
        }
        .traceWorkspace().navigationTitle("Group source").navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }
    private func paragraph(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 6) { Text(title).font(.headline); Text(text).textSelection(.enabled) }.padding(.vertical, 4)
    }
    private func load() async {
        guard !loading else { return }
        loading = true; defer { loading = false }
        do {
            let data = try await NativeConnection.shared.authenticatedData(path: "/api/native/v1/group-analyses")
            let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
            let groups = try decoder.decode(NativeGroupListResponse.self, from: data).groups
            group = groups.first { Set($0.conversationIds) == Set(conversationIDs) }
            error = group == nil ? "This cited group is no longer available. Its conversations may still be in your library." : nil
        } catch { self.error = "Could not load the cited group. " + error.localizedDescription }
    }
}
