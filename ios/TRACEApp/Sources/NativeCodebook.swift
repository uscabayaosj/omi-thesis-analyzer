import Foundation
import Observation
import SwiftUI

struct NativeCode: Decodable, Identifiable {
    let id: String
    let name: String
    let description: String
    let timestamp: String
}

struct NativeCodeEvidence: Decodable, Identifiable {
    let id: String
    let codeId: String
    let conversationId: String
    let conversationTitle: String
    let date: String?
    let field: String
    let excerpt: String
    let source: String
    let timestamp: String
}

private struct NativeCodebookResponse: Decodable {
    let codes: [NativeCode]
    let evidence: [NativeCodeEvidence]
    let analyses: [NativeCodebookConversation]?
}

struct NativeCodebookConversation: Decodable, Identifiable {
    let conversationId: String
    let title: String
    let date: String?
    var id: String { conversationId }
}

private struct NativeCodebookField: Identifiable {
    let key: String
    let label: String
    var id: String { key }
    static let all: [NativeCodebookField] = [
        .init(key: "rq1_documentary_record", label: "RQ1 — Documentary Record"),
        .init(key: "rq2_everyday_practices", label: "RQ2 — Everyday Practices"),
        .init(key: "rq3_cskt_intersection", label: "RQ3 — CSKT Intersection"),
        .init(key: "rq4_wildness_imaginary", label: "RQ4 — Wildness Imaginary"),
        .init(key: "conditions_check", label: "Orienting Conditions"),
        .init(key: "rival_hypothesis_test", label: "Rival Hypothesis Test"),
        .init(key: "refutation_signals", label: "Refutation Signals"),
        .init(key: "forward_thinking", label: "Forward Thinking"),
    ]
}

struct NativeCodebookApplication: Decodable, Identifiable {
    let codeId: String
    let field: String
    let excerpt: String
    var id: String { "\(codeId)|\(field)|\(excerpt)" }
}

struct NativeProposedCode: Decodable, Identifiable {
    let name: String
    let description: String
    let field: String
    let excerpt: String
    var id: String { "\(name)|\(field)|\(excerpt)" }
}

struct NativeCodebookSuggestion: Decodable {
    let applications: [NativeCodebookApplication]
    let proposed: [NativeProposedCode]
}

@MainActor
@Observable
final class NativeCodebookModel {
    var codes: [NativeCode] = []
    var evidence: [NativeCodeEvidence] = []
    var conversations: [NativeCodebookConversation] = []
    var selectedConversationID = "" {
        didSet { if oldValue != selectedConversationID { suggestion = nil; suggestionConversationID = nil; selectedSuggestions = [] } }
    }
    private(set) var suggestionConversationID: String?
    var selectedSuggestions: Set<String> = []
    var suggestion: NativeCodebookSuggestion?
    var newName = ""
    var newDescription = ""
    var manualCodeID = ""
    var manualConversationID = ""
    var manualField = NativeCodebookField.all[0].key
    var manualExcerpt = ""
    var sourceAnalysis: NativeThesisAnalysis?
    var sourceError: String?
    var isLoadingSource = false
    var sourceText: String {
        guard let a = sourceAnalysis else { return "" }
        switch manualField {
        case "rq1_documentary_record": return a.rq1DocumentaryRecord
        case "rq2_everyday_practices": return a.rq2EverydayPractices
        case "rq3_cskt_intersection": return a.rq3CsktIntersection
        case "rq4_wildness_imaginary": return a.rq4WildnessImaginary
        case "conditions_check": return a.conditionsCheck
        case "rival_hypothesis_test": return a.rivalHypothesisTest
        case "refutation_signals": return a.refutationSignals
        default: return a.forwardThinking
        }
    }
    func loadSource(_ id: String) async {
        sourceAnalysis = nil; sourceError = nil; isLoadingSource = false
        guard !id.isEmpty else { return }
        isLoadingSource = true
        defer { if manualConversationID == id { isLoadingSource = false } }
        do {
            let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/%?#"))
            let encoded = id.addingPercentEncoding(withAllowedCharacters: allowed) ?? id
            let data = try await NativeConnection.shared.authenticatedData(path: "/api/native/v1/conversations/\(encoded)/analyses")
            try Task.checkCancellation()
            let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
            let bundle = try decoder.decode(NativeAnalysisBundle.self, from: data)
            guard manualConversationID == id else { return }
            sourceAnalysis = bundle.thesis?.current
            if sourceAnalysis == nil { sourceError = "This conversation has no saved research analysis. Choose another conversation." }
        } catch is CancellationError { }
        catch { if manualConversationID == id { sourceError = "Could not load the selected source. " + error.localizedDescription } }
    }
    var deletedItem: NativeDeletedCodebookItem?
    var isLoading = false
    var action: String?
    var error: String?

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let stateData = try await NativeConnection.shared.authenticatedData(path: "/api/native/v1/codebook", queryItems: [URLQueryItem(name: "includeAnalyses", value: "1")])
            let state = try decoder.decode(NativeCodebookResponse.self, from: stateData)
            codes = state.codes
            evidence = state.evidence
            conversations = state.analyses ?? []
            let eligible = Set(conversations.map(\.conversationId))
            if selectedConversationID.isEmpty || !eligible.contains(selectedConversationID) { selectedConversationID = conversations.first?.conversationId ?? "" }
            if manualConversationID.isEmpty || !eligible.contains(manualConversationID) { manualConversationID = conversations.first?.conversationId ?? "" }
            if manualCodeID.isEmpty || !codes.contains(where: { $0.id == manualCodeID }) { manualCodeID = codes.first?.id ?? "" }
            error = nil
        } catch let requestError { error = requestError.localizedDescription }
    }

    func createCode() async {
        await perform(action: "create-code", fields: ["name": newName, "description": newDescription])
        if error == nil { newName = ""; newDescription = "" }
    }

    func deleteCode(_ item: NativeCode) async {
        await perform(action: "delete-code", fields: ["id": item.id])
        if error == nil { deletedItem = NativeDeletedCodebookItem(kind: "code", id: item.id, title: item.name) }
    }
    func deleteEvidence(_ item: NativeCodeEvidence) async {
        await perform(action: "delete-evidence", fields: ["id": item.id])
        if error == nil { deletedItem = NativeDeletedCodebookItem(kind: "evidence", id: item.id, title: item.excerpt) }
    }

    func restoreLastDeletion() async {
        guard let deletedItem else { return }
        await perform(action: deletedItem.kind == "code" ? "restore-code" : "restore-evidence", fields: ["id": deletedItem.id])
        if error == nil { self.deletedItem = nil }
    }

    func addManualEvidence() async {
        await perform(action: "add-manual-evidence", fields: [
            "codeId": manualCodeID, "conversationId": manualConversationID,
            "field": manualField, "excerpt": manualExcerpt,
        ])
        if error == nil { manualExcerpt = "" }
    }

    func suggest() async {
        guard !selectedConversationID.isEmpty, action == nil else { return }
        let conversationID = selectedConversationID
        action = "suggest"
        error = nil
        defer { action = nil }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["conversationId": conversationID])
            let data = try await NativeConnection.shared.authenticatedRequest(path: "/api/native/v1/codebook/suggest", method: "POST", body: body)
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let result = try decoder.decode(NativeCodebookSuggestion.self, from: data)
            applySuggestion(result, conversationID: conversationID)
        } catch let requestError { error = requestError.localizedDescription }
    }

    func applySuggestion(_ value: NativeCodebookSuggestion, conversationID: String) {
        guard selectedConversationID == conversationID else { return }
        suggestion = value; suggestionConversationID = conversationID
        selectedSuggestions = Set(value.applications.map(\.id) + value.proposed.map(\.id))
    }
    func acceptSuggestions() async {
        guard let suggestion, let conversationID = suggestionConversationID, conversationID == selectedConversationID,
              !selectedSuggestions.isEmpty, action == nil else { return }
        var items: [[String: String]] = []
        for item in suggestion.applications where selectedSuggestions.contains(item.id) {
            items.append(["codeId": item.codeId, "field": item.field, "excerpt": item.excerpt])
        }
        for item in suggestion.proposed where selectedSuggestions.contains(item.id) {
            items.append(["name": item.name, "description": item.description, "field": item.field, "excerpt": item.excerpt])
        }
        await perform(action: "accept-suggestions", fields: ["conversationId": conversationID, "items": items])
        if error == nil { self.suggestion = nil; selectedSuggestions = [] }
    }

    func toggle(_ id: String) {
        if !selectedSuggestions.insert(id).inserted { selectedSuggestions.remove(id) }
    }

    private func perform(action name: String, fields: [String: Any]) async {
        guard action == nil else { return }
        action = name
        error = nil
        defer { action = nil }
        do {
            var payload = fields
            payload["action"] = name
            let body = try JSONSerialization.data(withJSONObject: payload)
            let data = try await NativeConnection.shared.authenticatedRequest(path: "/api/native/v1/codebook", method: "POST", body: body)
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let state = try decoder.decode(NativeCodebookResponse.self, from: data)
            codes = state.codes
            evidence = state.evidence
        } catch let requestError { error = requestError.localizedDescription }
    }
}

struct NativeDeletedCodebookItem {
    let kind: String
    let id: String
    let title: String
}

struct NativeCodebookView: View {
    @State private var model = NativeCodebookModel()
    @State private var connection = NativeConnection.shared
    @State private var codeToDelete: NativeCode?
    @State private var evidenceToDelete: NativeCodeEvidence?
    @State private var exportURL: URL?

    private var evidenceByCode: [String: [NativeCodeEvidence]] { Dictionary(grouping: model.evidence, by: \.codeId) }

    var body: some View {
        Group {
                if !connection.enrolled {
                    ContentUnavailableView("Connect TRACE", systemImage: "lock.shield", description: Text("Enroll this iPhone before opening the codebook."))
                } else {
                    List {
                        if let error = model.error { Section("Codebook") { Text(error).foregroundStyle(.red) } }
                        Section("Codebook") {
                            Text("\(model.codes.count) \(model.codes.count == 1 ? "code" : "codes") · \(model.evidence.count) \(model.evidence.count == 1 ? "excerpt" : "excerpts")").font(.subheadline)
                            Text("\(Set(model.evidence.map(\.conversationId)).count) conversations coded").font(.caption).foregroundStyle(.secondary)
                        }
                        if let deleted = model.deletedItem {
                            Section("Recently removed") {
                                Text(deleted.kind == "code" ? "Code: \(deleted.title)" : "Excerpt: \(deleted.title)").lineLimit(2)
                                Button { Task { await model.restoreLastDeletion() } } label: { Label("Undo deletion", systemImage: "arrow.uturn.backward") }
                                    .disabled(model.action != nil)
                            }
                        }
                        if model.codes.isEmpty {
                            Section { ContentUnavailableView("No codes yet", systemImage: "books.vertical", description: Text("Add a code or accept a verified suggestion.")) }
                        }
                        ForEach(model.codes) { code in
                            Section {
                                if let entries = evidenceByCode[code.id], !entries.isEmpty {
                                    ForEach(entries) { item in
                                        VStack(alignment: .leading, spacing: 5) {
                                            Text(item.excerpt).textSelection(.enabled)
                                            Text("\(item.conversationTitle) · \(fieldLabel(item.field)) · \(item.source == "manual" ? "Verified excerpt" : "Accepted suggestion")")
                                                .font(.caption).foregroundStyle(.secondary)
                                            HStack {
                                                Spacer()
                                                Button("Remove excerpt", role: .destructive) { evidenceToDelete = item }
                                                    .font(.caption).frame(minHeight: 44)
                                            }
                                        }.padding(.vertical, 3)
                                    }
                                } else {
                                    Text("No excerpts yet.").foregroundStyle(.secondary)
                                }
                            } header: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(code.name)
                                        if !code.description.isEmpty { Text(code.description).font(.caption).textCase(nil) }
                                    }
                                    Spacer()
                                    Button(role: .destructive) { codeToDelete = code } label: { Image(systemName: "trash").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle()) }
                                        .accessibilityLabel("Delete code \(code.name)")
                                }
                            }
                        }
                        Section("Coding tools") {
                            NavigationLink("Create a code") { Form { createCodeFields }.traceWorkspace().navigationTitle("Create code").navigationBarTitleDisplayMode(.inline) }
                            NavigationLink("Suggest codes from an analysis") { Form { suggestionFields }.traceWorkspace().navigationTitle("Code suggestions").navigationBarTitleDisplayMode(.inline) }
                            NavigationLink("Add a verified excerpt") {
                                Form { evidenceFields }.traceWorkspace().navigationTitle("Verified excerpt").navigationBarTitleDisplayMode(.inline)
                                    .task(id: model.manualConversationID) { await model.loadSource(model.manualConversationID) }
                                    .onChange(of: model.manualConversationID) { _, _ in model.manualExcerpt = "" }
                                    .onChange(of: model.manualField) { _, _ in model.manualExcerpt = "" }
                            }
                        }
                    }
                    .refreshable { await model.load() }
                }
            }
            .navigationTitle("Codebook")
            .navigationBarTitleDisplayMode(.inline)
            .traceWorkspace()
            .task { await model.load() }
            .confirmationDialog("Delete this code and its excerpts?", isPresented: Binding(get: { codeToDelete != nil }, set: { if !$0 { codeToDelete = nil } }), titleVisibility: .visible) {
                Button("Delete code and excerpts", role: .destructive) {
                    if let item = codeToDelete { Task { await model.deleteCode(item) } }
                    codeToDelete = nil
                }
                Button("Cancel", role: .cancel) { codeToDelete = nil }
            }
            .confirmationDialog("Remove this excerpt?", isPresented: Binding(get: { evidenceToDelete != nil }, set: { if !$0 { evidenceToDelete = nil } }), titleVisibility: .visible) {
                Button("Remove excerpt", role: .destructive) {
                    if let item = evidenceToDelete { Task { await model.deleteEvidence(item) } }
                    evidenceToDelete = nil
                }
                Button("Cancel", role: .cancel) { evidenceToDelete = nil }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { exportCodebook() } label: { Image(systemName: "square.and.arrow.up") }
                        .accessibilityLabel("Export codebook as Markdown")
                        .disabled(model.codes.isEmpty || !connection.enrolled)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await model.load() } } label: { Image(systemName: "arrow.clockwise").accessibilityLabel("Refresh") }
                        .disabled(model.isLoading || !connection.enrolled)
                }
            }
            .sheet(isPresented: Binding(get: { exportURL != nil }, set: { if !$0 { exportURL = nil } })) {
                if let exportURL { ShareSheet(fileURL: exportURL) }
            }
    }

    @ViewBuilder private var createCodeFields: some View {
        if let error = model.error { Text(error).foregroundStyle(.red) }
                            TextField("New code name", text: $model.newName).textInputAutocapitalization(.words)
                            TextField("Description (optional)", text: $model.newDescription, axis: .vertical).lineLimit(2...3)
                            Button { Task { await model.createCode() } } label: { codebookActionLabel("Add code") }
                                .disabled(model.newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.action != nil)
    }
    @ViewBuilder private var suggestionFields: some View {
        if let error = model.error { Text(error).foregroundStyle(.red) }
                        Section("Suggest from a thesis analysis") {
                            if model.conversations.isEmpty {
                                Text("Run a thesis analysis first; code suggestions use its saved dimensions.").foregroundStyle(.secondary)
                            } else {
                                Picker("Conversation", selection: $model.selectedConversationID) {
                                    ForEach(model.conversations) { item in Text(item.title).tag(item.conversationId) }
                                }
                                Button { Task { await model.suggest() } } label: { codebookActionLabel("Suggest codes and excerpts") }
                                    .disabled(model.selectedConversationID.isEmpty || model.action != nil)
                            }
                            if let suggestion = model.suggestion {
                                ForEach(suggestion.applications) { item in
                                    suggestionToggle(id: item.id, heading: model.codes.first { $0.id == item.codeId }?.name ?? "Existing code", field: item.field, excerpt: item.excerpt)
                                }
                                ForEach(suggestion.proposed) { item in
                                    suggestionToggle(id: item.id, heading: "New · \(item.name)", field: item.field, excerpt: item.excerpt)
                                }
                                Button { Task { await model.acceptSuggestions() } } label: { codebookActionLabel("Accept selected excerpts") }
                                    .disabled(model.selectedSuggestions.isEmpty || model.action != nil)
                            }
                        }
    }
    @ViewBuilder private var evidenceFields: some View {
        if let error = model.error { Text(error).foregroundStyle(.red) }
                        Section("Add a verified excerpt") {
                            if model.codes.isEmpty || model.conversations.isEmpty {
                                Text("Add a code and save a thesis analysis before adding evidence.").foregroundStyle(.secondary)
                            } else {
                                Picker("Code", selection: $model.manualCodeID) {
                                    ForEach(model.codes) { Text($0.name).tag($0.id) }
                                }
                                Picker("Conversation", selection: $model.manualConversationID) {
                                    ForEach(model.conversations) { Text($0.title).tag($0.conversationId) }
                                }
                                Picker("Thesis dimension", selection: $model.manualField) {
                                    ForEach(NativeCodebookField.all) { Text($0.label).tag($0.key) }
                                }
                                if model.isLoadingSource { ProgressView("Loading saved source…") }
                                if let error = model.sourceError {
                                    Text(error).foregroundStyle(.red)
                                    Button("Retry source") { Task { await model.loadSource(model.manualConversationID) } }
                                }
                                if !model.sourceText.isEmpty {
                                    Text("Selected saved source").font(.headline)
                                    Text(model.sourceText).textSelection(.enabled)
                                        .accessibilityIdentifier("trace.codebook.source")
                                    Text("Select and copy a passage here, then paste it below. Your excerpt is checked against this source.").font(.footnote).foregroundStyle(.secondary)
                                    if (12...600).contains(model.sourceText.trimmingCharacters(in: .whitespacesAndNewlines).count) {
                                        Button("Use this whole passage") { model.manualExcerpt = model.sourceText }
                                    }
                                }
                                TextField("Excerpt from the source above", text: $model.manualExcerpt, axis: .vertical)
                                    .accessibilityIdentifier("trace.codebook.excerpt")
                                    .lineLimit(3...7)
                                Text("TRACE checks that the excerpt appears in the selected saved analysis. Maximum 600 characters.")
                                    .font(.caption).foregroundStyle(.secondary)
                                Button { Task { await model.addManualEvidence() } } label: { codebookActionLabel("Add excerpt") }
                                    .disabled(model.manualExcerpt.trimmingCharacters(in: .whitespacesAndNewlines).count < 12 || model.manualExcerpt.count > 600 || model.action != nil || model.isLoadingSource || model.sourceAnalysis == nil)
                            }
                        }
    }

    @ViewBuilder private func codebookActionLabel(_ title: String) -> some View {
        if model.action != nil { HStack { ProgressView(); Text("Working…") } }
        else { Label(title, systemImage: "sparkles") }
    }

    private func fieldLabel(_ key: String) -> String { NativeCodebookField.all.first { $0.key == key }?.label ?? key }

    private func suggestionToggle(id: String, heading: String, field: String, excerpt: String) -> some View {
        Button { model.toggle(id) } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: model.selectedSuggestions.contains(id) ? "checkmark.square.fill" : "square")
                    .foregroundStyle(model.selectedSuggestions.contains(id) ? Color.accentColor : Color.secondary)
                VStack(alignment: .leading, spacing: 4) {
                    Text(heading).font(.subheadline.weight(.semibold))
                    Text(fieldLabel(field)).font(.caption).foregroundStyle(.secondary)
                    Text(excerpt).font(.caption).textSelection(.enabled)
                }
            }
        }.buttonStyle(.plain)
    }

    private func exportCodebook() {
        let entries = model.evidence
        let day = String(ISO8601DateFormatter().string(from: Date()).prefix(10))
        let lines = ["# Codebook", "", "Exported \(day) · \(model.codes.count) codes · \(entries.count) excerpts", ""]
        let body = model.codes.map { code -> String in
            let codeEntries = entries.filter { $0.codeId == code.id }.sorted { ($0.date ?? $0.timestamp) < ($1.date ?? $1.timestamp) }
            var section = ["## \(code.name)", ""]
            if !code.description.isEmpty { section.append(contentsOf: [code.description, ""]) }
            section.append("\(codeEntries.count) excerpt\(codeEntries.count == 1 ? "" : "s")")
            section.append("")
            for item in codeEntries {
                let label = NativeCodebookField.all.first(where: { $0.key == item.field })?.label ?? item.field
                section.append(contentsOf: ["> \(item.excerpt)", "> — *\(item.conversationTitle)*\(item.date.map { " (\($0))" } ?? ""), \(label)", ""])
            }
            return section.joined(separator: "\n")
        }.joined(separator: "\n")
        let markdown = (lines + [body]).joined(separator: "\n")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("trace-codebook-\(Int(Date().timeIntervalSince1970)).md")
        do {
            try Data(markdown.utf8).write(to: url, options: .atomic)
            exportURL = url
        } catch { model.error = error.localizedDescription }
    }
}

private struct ShareSheet: View {
    let fileURL: URL
    var body: some View {
        NavigationStack {
            ShareLink(item: fileURL) { Label("Share Markdown file", systemImage: "square.and.arrow.up") }
                .padding()
                .navigationTitle("Export Codebook")
                .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium])
    }
}
