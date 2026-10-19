import Foundation
import Observation
import SwiftUI

struct NativeSearchResponse: Decodable {
    let configured: Bool
    let conversationResults: [NativeConversationSearchResult]
    let groupResults: [NativeGroupSearchResult]
}

struct NativeSearchMatch: Decodable, Identifiable {
    let field: String
    let label: String
    let snippet: String
    var id: String { field }
}

struct NativeConversationSearchResult: Decodable, Identifiable {
    let conversationId: String
    let title: String
    let date: String?
    let matches: [NativeSearchMatch]
    var id: String { conversationId }
}

struct NativeGroupSearchResult: Decodable, Identifiable {
    let conversationIds: [String]
    let conversationTitles: [String]
    let timestamp: String
    let matches: [NativeSearchMatch]
    var id: String { conversationIds.sorted().joined(separator: ",") }
}

@MainActor
@Observable
final class NativeSearchModel {
    var query = ""
    var conversationResults: [NativeConversationSearchResult] = []
    var groupResults: [NativeGroupSearchResult] = []
    var configured = true
    var isLoading = false
    private var searchGeneration = UUID()
    var error: String?

    func clear() {
        searchGeneration = UUID(); isLoading = false
        conversationResults = []
        groupResults = []
        configured = true
        error = nil
    }

    func search() async {
        let searchText = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !searchText.isEmpty else { clear(); return }
        guard searchText.count <= 200 else { error = "Search queries must be 200 characters or fewer."; return }
        let run = UUID(); searchGeneration = run
        isLoading = true
        defer { if searchGeneration == run { isLoading = false } }
        do {
            let data = try await NativeConnection.shared.authenticatedData(
                path: "/api/native/v1/search",
                queryItems: [URLQueryItem(name: "q", value: searchText)]
            )
            guard searchGeneration == run, !Task.isCancelled, query.trimmingCharacters(in: .whitespacesAndNewlines) == searchText else { return }
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let response = try decoder.decode(NativeSearchResponse.self, from: data)
            configured = response.configured
            conversationResults = response.conversationResults
            groupResults = response.groupResults
            error = nil
        } catch {
            if searchGeneration == run, !Task.isCancelled, query.trimmingCharacters(in: .whitespacesAndNewlines) == searchText { self.error = error.localizedDescription }
        }
    }
}

struct NativeSearchView: View {
    @State private var model = NativeSearchModel()
    @State private var connection = NativeConnection.shared

    private var hasResults: Bool { !model.conversationResults.isEmpty || !model.groupResults.isEmpty }

    var body: some View {
        Group {
                if !connection.enrolled {
                    ContentUnavailableView("Connect TRACE", systemImage: "lock.shield", description: Text("Enroll this iPhone before searching saved analyses."))
                } else {
            List {
                Section {
                    HStack {
                        Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                        TextField("Search thesis and group analyses", text: $model.query)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .accessibilityLabel("Search thesis and group analyses")
                        if model.isLoading { ProgressView() }
                        if !model.query.isEmpty {
                            Button { model.query = ""; model.clear() } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary).frame(minWidth: 44, minHeight: 44).contentShape(Rectangle()) }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Clear search")
                        }
                    }
                }
                if let error = model.error {
                    Section { Text(error).foregroundStyle(.red) }
                } else if !model.configured && !model.query.isEmpty {
                    Section { Text("Search is unavailable because workspace search has not been configured. Check connection settings or ask the workspace operator to enable it.").foregroundStyle(.secondary) }
                } else if !model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.isLoading && !hasResults {
                    Section { ContentUnavailableView("No matches", systemImage: "text.magnifyingglass", description: Text("No analysis text matched ‘\(model.query)’")) }
                } else if model.query.isEmpty {
                    Section { Text("Search across stored thesis and group analyses.").foregroundStyle(.secondary) }
                }
                if !model.conversationResults.isEmpty {
                    Section("Conversations") {
                        ForEach(model.conversationResults) { result in
                            NavigationLink(value: result.conversationId) {
                                VStack(alignment: .leading, spacing: 7) {
                                    HStack(alignment: .firstTextBaseline) {
                                        Text(result.title).font(.headline).lineLimit(2)
                                        Spacer(minLength: 4)
                                        if let date = result.date { Text(date).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                                    }
                                    ForEach(result.matches) { match in searchMatch(match) }
                                }.padding(.vertical, 3)
                            }
                        }
                    }
                }
                if !model.groupResults.isEmpty {
                    Section("Groups") {
                        ForEach(model.groupResults) { result in
                            DisclosureGroup {
                                ForEach(result.matches) { match in searchMatch(match) }
                            } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(result.conversationTitles.isEmpty ? "\(result.conversationIds.count) conversations" : result.conversationTitles.joined(separator: ", "))
                                        .font(.subheadline.weight(.medium)).lineLimit(2)
                                    Text("\(result.conversationIds.count) conversations · \(result.matches.count) matching dimensions")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Search")
            .navigationDestination(for: String.self) { id in NativeConversationDetailView(id: id) }
            .task(id: model.query) {
                guard connection.enrolled, !model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { model.clear(); return }
                do { try await Task.sleep(nanoseconds: 300_000_000) } catch { return }
                guard !Task.isCancelled else { return }
                await model.search()
            }
                }
            }
            .traceWorkspace()
            .navigationTitle("Search analyses")
            .navigationBarTitleDisplayMode(.inline)
    }

    private func searchMatch(_ match: NativeSearchMatch) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(match.label.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(.tint)
            Text(match.snippet).font(.caption).foregroundStyle(.secondary).lineLimit(4).textSelection(.enabled)
        }.padding(.vertical, 2)
    }
}
