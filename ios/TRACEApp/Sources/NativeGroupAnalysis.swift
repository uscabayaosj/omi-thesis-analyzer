import Foundation
import Observation
import SwiftUI

private struct NativeGroupConversationPage: Decodable {
    let conversations: [NativeConversation]
    let hasMore: Bool
}

struct NativeGroupListResponse: Decodable {
    let groups: [NativeStoredGroup]
}

private struct NativeGroupResponse: Decodable {
    let group: NativeStoredGroup
    let skipped: Int
}

private struct NativeGroupCustomResponse: Decodable {
    let result: String
}

struct NativeGroupConversation: Decodable, Identifiable {
    let id: String
    let title: String
    let date: String
    let emoji: String
}

struct NativeGroupResult: Decodable {
    let crossConversationThemes: String
    let contradictionsAndTensions: String
    let evolutionAndPatterns: String
    let synthesis: String
    let forwardThinking: String
}

struct NativeStoredGroup: Decodable, Identifiable {
    let id: String
    let conversationIds: [String]
    let conversations: [NativeGroupConversation]
    let timestamp: String
    let analysis: NativeGroupResult
    let custom: NativeCustomAnalysis?
}

@MainActor
@Observable
final class NativeGroupAnalysisModel {
    var conversations: [NativeConversation] = []
    var groups: [NativeStoredGroup] = []
    var selectedIDs: Set<String> = []
    var activeGroupID: String?
    var customPrompt = ""
    var error: String?
    var isLoading = false
    var isGenerating: String?
    private var offset = 0
    private var hasMore = true

    var activeGroup: NativeStoredGroup? { groups.first { $0.id == activeGroupID } }
    var orderedSelection: [String] {
        let loaded = conversations.map(\.id).filter { selectedIDs.contains($0) }
        let remaining = selectedIDs.subtracting(Set(loaded)).sorted()
        return loaded + remaining
    }

    func load(refresh: Bool = false) async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            if refresh {
                let groupData = try await NativeConnection.shared.authenticatedData(path: "/api/native/v1/group-analyses")
                groups = try decoder.decode(NativeGroupListResponse.self, from: groupData).groups
                conversations = []
                offset = 0
                hasMore = true
            }
            if groups.isEmpty {
                let groupData = try await NativeConnection.shared.authenticatedData(path: "/api/native/v1/group-analyses")
                groups = try decoder.decode(NativeGroupListResponse.self, from: groupData).groups
            }
            if conversations.isEmpty || hasMore {
                let pageData = try await NativeConnection.shared.authenticatedData(
                    path: "/api/native/v1/conversations",
                    queryItems: [URLQueryItem(name: "limit", value: "100"), URLQueryItem(name: "offset", value: String(offset))]
                )
                let page = try decoder.decode(NativeGroupConversationPage.self, from: pageData)
                conversations.append(contentsOf: page.conversations)
                offset += page.conversations.count
                hasMore = page.hasMore && !page.conversations.isEmpty
            }
            if activeGroupID == nil { activeGroupID = groups.first?.id }
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    func toggle(_ id: String) {
        if selectedIDs.contains(id) { selectedIDs.remove(id) }
        else if selectedIDs.count < 20 { selectedIDs.insert(id) }
    }

    func runAnalysis() async {
        let ids = orderedSelection
        guard ids.count >= 2, ids.count <= 20, isGenerating == nil else { return }
        isGenerating = "group"
        error = nil
        defer { isGenerating = nil }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["conversationIds": ids])
            let data = try await NativeConnection.shared.authenticatedRequest(path: "/api/native/v1/group-analyses", method: "POST", body: body)
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let response = try decoder.decode(NativeGroupResponse.self, from: data)
            replace(response.group)
            activeGroupID = response.group.id
            if response.skipped > 0 { error = "Analysis used the available transcripts; \(response.skipped) selected conversation(s) were skipped." }
        } catch { self.error = error.localizedDescription }
    }

    func runCustom() async {
        let ids = orderedSelection
        let prompt = customPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard ids.count >= 2, !prompt.isEmpty, isGenerating == nil else { return }
        isGenerating = "custom"
        error = nil
        defer { isGenerating = nil }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["conversationIds": ids, "prompt": prompt])
            _ = try await NativeConnection.shared.authenticatedRequest(path: "/api/native/v1/group-analyses/custom", method: "POST", body: body)
            let data = try await NativeConnection.shared.authenticatedData(path: "/api/native/v1/group-analyses")
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            groups = try decoder.decode(NativeGroupListResponse.self, from: data).groups
            activeGroupID = groups.first { Set($0.conversationIds) == Set(ids) }?.id
        } catch { self.error = error.localizedDescription }
    }

    func show(_ group: NativeStoredGroup) {
        activeGroupID = group.id
        selectedIDs = Set(group.conversationIds)
    }

    private func replace(_ group: NativeStoredGroup) {
        groups.removeAll { $0.id == group.id }
        groups.insert(group, at: 0)
    }
}

struct NativeGroupAnalysisView: View {
    @State private var model = NativeGroupAnalysisModel()
    @State private var connection = NativeConnection.shared
    @State private var selectionSearch = ""

    var body: some View {
        Group {
                if !connection.enrolled {
                    ContentUnavailableView("Connect TRACE", systemImage: "lock.shield", description: Text("Enroll this iPhone in Settings before running group analysis."))
                } else {
                    List {
                        if let error = model.error {
                            Section { Text(error).foregroundStyle(.secondary) }
                        }
                        Section("Selected · \(model.selectedIDs.count) of 20") {
                            Button { Task { await model.runAnalysis() } } label: {
                                actionLabel("Run group analysis", kind: "group")
                            }
                            .disabled(model.selectedIDs.count < 2 || model.isGenerating != nil)
                            if model.selectedIDs.count >= 2 {
                                TextField("Ask a custom group question", text: $model.customPrompt, axis: .vertical)
                                    .lineLimit(2...4)
                                    .textFieldStyle(.roundedBorder)
                                Button { Task { await model.runCustom() } } label: {
                                    actionLabel("Run custom question", kind: "custom")
                                }
                                .disabled(model.customPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isGenerating != nil || !hasSavedSelectedGroup)
                                if !hasSavedSelectedGroup { Text("Run group analysis for this selection before asking a custom question.").font(.footnote).foregroundStyle(.secondary) }
                            }
                        }
                        if let group = model.activeGroup {
                            Section("Group results · \(group.conversations.count) conversations") {
                                ForEach(group.conversations) { item in
                                    Label("\(item.emoji) \(item.title)", systemImage: "text.bubble")
                                }
                                groupParagraph("Cross-conversation themes", group.analysis.crossConversationThemes)
                                groupParagraph("Contradictions and tensions", group.analysis.contradictionsAndTensions)
                                groupParagraph("Evolution and patterns", group.analysis.evolutionAndPatterns)
                                groupParagraph("Synthesis", group.analysis.synthesis)
                                groupParagraph("Forward thinking", group.analysis.forwardThinking)
                                if let custom = group.custom {
                                    groupParagraph("Custom · \(custom.prompt)", custom.result)
                                }
                            }
                        }
                        if !model.groups.isEmpty {
                            Section("Saved groups") {
                                ForEach(model.groups) { group in
                                    Button { model.show(group) } label: {
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(group.conversations.map(\.title).joined(separator: " · "))
                                                .font(.subheadline.weight(.medium)).lineLimit(2)
                                            Text("\(group.conversationIds.count) conversations · \(group.timestamp)")
                                                .font(.caption).foregroundStyle(.secondary)
                                        }
                                    }.buttonStyle(.plain)
                                }
                            }
                        }
                        Section("Choose conversations · \(model.conversations.count) loaded") {
                            TextField("Find a loaded conversation", text: $selectionSearch).autocorrectionDisabled()
                            let matches = model.conversations.filter { selectionSearch.isEmpty || $0.displayTitle.localizedCaseInsensitiveContains(selectionSearch) }
                            if matches.isEmpty && !selectionSearch.isEmpty { Text("No loaded conversation matches. Load more conversations below or change your search.").foregroundStyle(.secondary) }
                            ForEach(matches) { conversation in
                                Button { model.toggle(conversation.id) } label: {
                                    HStack(spacing: 12) {
                                        Image(systemName: model.selectedIDs.contains(conversation.id) ? "checkmark.circle.fill" : "circle")
                                            .foregroundStyle(model.selectedIDs.contains(conversation.id) ? Color.accentColor : Color.secondary)
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(conversation.displayTitle).font(.subheadline.weight(.medium)).lineLimit(2)
                                            Text(conversation.displayDate?.formatted(date: .abbreviated, time: .shortened) ?? conversation.createdAt)
                                                .font(.caption).foregroundStyle(.secondary)
                                        }
                                    }
                                }
                                .buttonStyle(.plain)
                                .disabled(!model.selectedIDs.contains(conversation.id) && model.selectedIDs.count >= 20)
                                .accessibilityLabel("\(model.selectedIDs.contains(conversation.id) ? "Deselect" : "Select") \(conversation.displayTitle)")
                            }
                            if model.hasMoreForView {
                                HStack { Spacer(); if model.isLoading { ProgressView() } else { Button("Load more conversations") { Task { await model.loadMore() } } }; Spacer() }
                            }
                        }
                    }
                    .refreshable { await model.load(refresh: true) }
                }
            }
            .navigationTitle("Group analysis")
            .navigationBarTitleDisplayMode(.inline)
            .traceWorkspace()
            .task { await model.load() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await model.load(refresh: true) } } label: { Image(systemName: "arrow.clockwise").accessibilityLabel("Refresh") }
                        .disabled(model.isLoading || !connection.enrolled)
                }
            }
    }

    private var hasSavedSelectedGroup: Bool {
        guard model.selectedIDs.count >= 2 else { return false }
        return model.groups.contains { Set($0.conversationIds) == model.selectedIDs }
    }

    @ViewBuilder
    private func actionLabel(_ title: String, kind: String) -> some View {
        if model.isGenerating == kind {
            HStack { ProgressView(); Text("Generating…") }
        } else { Label(title, systemImage: "sparkles") }
    }

    private func groupParagraph(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.subheadline.weight(.semibold))
            Text(text).textSelection(.enabled)
        }.padding(.vertical, 4)
    }
}

private extension NativeGroupAnalysisModel {
    var hasMoreForView: Bool { hasMore }

    func loadMore() async {
        guard !isLoading, hasMore else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let data = try await NativeConnection.shared.authenticatedData(
                path: "/api/native/v1/conversations",
                queryItems: [URLQueryItem(name: "limit", value: "100"), URLQueryItem(name: "offset", value: String(offset))]
            )
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let page = try decoder.decode(NativeGroupConversationPage.self, from: data)
            conversations.append(contentsOf: page.conversations)
            offset += page.conversations.count
            hasMore = page.hasMore && !page.conversations.isEmpty
            error = nil
        } catch let requestError { error = requestError.localizedDescription }
    }
}
