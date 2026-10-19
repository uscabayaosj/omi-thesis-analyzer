import Foundation
import Observation
import SwiftUI

struct NativeTranscriptSegment: Decodable {
    let id: String?
    let text: String
    let speakerID: Int?
    let speakerName: String?
    var speakerPersonID: String? = nil
    var speakerConfirmed: Bool? = nil
    var speakerStatus: String? = nil
    var speakerConfidence: Double? = nil
    var speakerIDScope: String? = nil
    var voiceMatchStatus: String? = nil
    var voiceProfileID: String? = nil
    var diarizerModel: String? = nil
    var diarizerVersion: String? = nil
    var diarizerProvider: String? = nil
    var voiceRecognitionNote: String? = nil
    var speakerConfidenceMin: Double? = nil
    let start: Double?
    let end: Double?

    enum CodingKeys: String, CodingKey {
        case id, text, speakerName, speakerConfirmed, speakerStatus, speakerConfidence, start, end
        case speakerPersonID = "speakerPersonId"
        case speakerID = "speakerId"
        case speakerIDScope = "speakerIdScope"
        case voiceProfileID = "voiceProfileId"
        case voiceMatchStatus, diarizerModel, diarizerVersion, diarizerProvider, voiceRecognitionNote, speakerConfidenceMin
    }

    var stableID: String { id ?? "\(speakerID ?? 0)-\(start ?? 0)-\(text.hashValue)" }
}

struct NativeStructuredSummary: Decodable {
    let title: String?
    let overview: String?
    let emoji: String?
    let category: String?
    let actionItems: [NativeActionItem]?
}

struct NativeActionItem: Decodable, Identifiable {
    let description: String
    let completed: Bool?
    let createdAt: String?
    let dueAt: String?

    var id: String { "\(createdAt ?? "")-\(description)" }

    var dueDateLabel: String? {
        guard let dueAt, !dueAt.isEmpty else { return nil }
        let date = ISO8601DateFormatter.withFractionalSeconds.date(from: dueAt)
            ?? ISO8601DateFormatter().date(from: dueAt)
        return date?.formatted(date: .abbreviated, time: .omitted) ?? dueAt
    }
}

struct NativeConversation: Decodable, Identifiable {
    let id: String
    let createdAt: String
    let startedAt: String?
    let finishedAt: String?
    let language: String?
    let source: String?
    let structured: NativeStructuredSummary?
    let transcriptSegments: [NativeTranscriptSegment]?
    let geolocation: ConversationPin?
    var transcriptRevision: String? = nil
    var summaryProcessing: NativeSummaryProcessing? = nil

    var displayTitle: String {
        guard let title = structured?.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else {
            return "Untitled conversation"
        }
        return title
    }

    var displayDate: Date? {
        let value = startedAt ?? createdAt
        return ISO8601DateFormatter().date(from: value) ?? ISO8601DateFormatter.withFractionalSeconds.date(from: value)
    }

    var duration: String? {
        guard let start = startedAt.flatMap({ ISO8601DateFormatter.withFractionalSeconds.date(from: $0) ?? ISO8601DateFormatter().date(from: $0) }),
              let end = finishedAt.flatMap({ ISO8601DateFormatter.withFractionalSeconds.date(from: $0) ?? ISO8601DateFormatter().date(from: $0) }) else { return nil }
        let seconds = max(0, Int(end.timeIntervalSince(start)))
        return seconds >= 3600 ? "\(seconds / 3600)h \((seconds % 3600) / 60)m" : "\(seconds / 60)m"
    }
}

struct NativeSummaryProcessing: Decodable {
    let status: String
    let error: String?
    var isWorking: Bool { status == "pending" || status == "processing" }
}

extension ISO8601DateFormatter {
    static let withFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

private struct NativeConversationPage: Decodable {
    let conversations: [NativeConversation]
    let hasMore: Bool
}

private struct NativeConversationEnvelope: Decodable {
    let conversation: NativeConversation
}

struct NativeAnalysisBundle: Decodable {
    let thesis: NativeStoredThesis?
    let adhd: NativeStoredADHD?
}

struct NativeStoredThesis: Decodable {
    let current: NativeThesisAnalysis?
}

struct NativeThesisAnalysis: Decodable {
    let title: String
    let category: String?
    let rq1DocumentaryRecord: String
    let rq2EverydayPractices: String
    let rq3CsktIntersection: String
    let rq4WildnessImaginary: String
    let conditionsCheck: String
    let rivalHypothesisTest: String
    let refutationSignals: String
    let forwardThinking: String
    let custom: NativeCustomAnalysis?
}

struct NativeCustomAnalysis: Decodable {
    let prompt: String
    let result: String
    let timestamp: String
}

struct NativeStoredADHD: Decodable {
    let conversationId: String?
    let timestamp: String?
    let date: String?
    let title: String
    let analysis: NativeADHDAnalysis
    let doneKeys: [String]?
    let letGoKeys: [String]?
}

struct NativeADHDAnalysis: Decodable {
    let summary: String
    let doToday: [String]
    let commitments: [NativeCommitment]
    let remember: [String]
    let openLoops: [String]
    let ahead: [NativeAheadItem]
}

struct NativeCommitment: Decodable, Identifiable {
    let key: String
    let direction: String
    let who: String
    let what: String
    let deadline: String
    let confidence: String
    let quote: String
    var id: String { key }
}

struct NativeAheadItem: Decodable, Identifiable {
    let event: String
    let date: String
    let prep: String
    let startWhen: String
    let conflict: String
    var id: String { "\(event)-\(date)" }
}

@MainActor
@Observable
final class NativeConversationsModel {
    var conversations: [NativeConversation] = []
    var isLoading = false
    var error: String?
    var isDeleting = false
    private var offset = 0
    private var hasMore = true
    private let pageSize = 25

    func load(refresh: Bool = false) async {
        guard !isLoading, !isDeleting else { return }
        if refresh {
            offset = 0
            hasMore = true
        }
        guard hasMore else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let data = try await NativeConnection.shared.authenticatedData(
                path: "/api/native/v1/conversations",
                queryItems: [URLQueryItem(name: "limit", value: String(pageSize)), URLQueryItem(name: "offset", value: String(offset))]
            )
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let page = try decoder.decode(NativeConversationPage.self, from: data)
            if refresh { conversations = page.conversations }
            else {
                let existing = Set(conversations.map(\.id))
                conversations.append(contentsOf: page.conversations.filter { !existing.contains($0.id) })
            }
            offset += page.conversations.count
            hasMore = page.hasMore && !page.conversations.isEmpty
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func delete(ids: Set<String>) async -> Bool {
        guard !ids.isEmpty, !isLoading, !isDeleting else { return false }
        isDeleting = true
        defer { isDeleting = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["ids": ids.sorted()])
            let data = try await NativeConnection.shared.authenticatedRequest(
                path: "/api/native/v1/conversations", method: "DELETE", body: body
            )
            struct DeletionResponse: Decodable { let deletedIDs: [String] }
            let response = try JSONDecoder().decode(DeletionResponse.self, from: data)
            guard Set(response.deletedIDs) == ids else {
                throw NSError(domain: "TRACE", code: 1, userInfo: [NSLocalizedDescriptionKey: "Deletion was not confirmed. Please refresh and try again."])
            }
            NotificationCenter.default.post(name: .traceConversationUpdated, object: nil)
            let removed = conversations.filter { ids.contains($0.id) }.count
            conversations.removeAll { ids.contains($0.id) }
            offset = max(0, offset - removed)
            error = nil
            return true
        } catch {
            self.error = "Could not delete conversations. \(error.localizedDescription)"
            return false
        }
    }

}

@MainActor
@Observable
final class NativeConversationDetailModel {
    var conversation: NativeConversation?
    var analyses: NativeAnalysisBundle?
    var isLoading = false
    var isGenerating: String?
    var error: String?
    var isRetryingSummary = false
    var summaryRetryError: String?

    func retrySummary(id: String) async {
        guard !isRetryingSummary else { return }
        isRetryingSummary = true
        summaryRetryError = nil
        defer { isRetryingSummary = false }
        do {
            _ = try await NativeConnection.shared.authenticatedRequest(
                path: "/api/native/v1/conversations/\(encodedID(id))/summary", method: "POST", body: Data("{}".utf8)
            )
            await load(id: id)
            if conversation?.summaryProcessing?.status == "done" {
                CaptureModel.shared.summaryCompleted(conversationID: id, status: "done")
            }
        } catch { summaryRetryError = error.localizedDescription }
    }

    private func encodedID(_ id: String) -> String {
        let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/%?#"))
        return id.addingPercentEncoding(withAllowedCharacters: allowed) ?? id
    }

    func generate(_ kind: String, id: String, prompt: String? = nil) async {
        guard isGenerating == nil else { return }
        isGenerating = kind
        defer { isGenerating = nil }
        error = nil
        do {
            let pathID = encodedID(id)
            let path: String
            var body: Data?
            switch kind {
            case "thesis": path = "/api/native/v1/conversations/\(pathID)/thesis-analysis"
            case "adhd": path = "/api/native/v1/conversations/\(pathID)/adhd-analysis"
            default:
                path = "/api/native/v1/conversations/\(pathID)/custom-analysis"
                body = try JSONSerialization.data(withJSONObject: ["prompt": prompt ?? ""])
            }
            _ = try await NativeConnection.shared.authenticatedRequest(path: path, method: "POST", body: body)
            await load(id: id)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func load(id: String) async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let pathID = encodedID(id)
            let data = try await NativeConnection.shared.authenticatedData(path: "/api/native/v1/conversations/\(pathID)")
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            conversation = try decoder.decode(NativeConversationEnvelope.self, from: data).conversation
            let analysisData = try await NativeConnection.shared.authenticatedData(
                path: "/api/native/v1/conversations/\(pathID)/analyses"
            )
            analyses = try decoder.decode(NativeAnalysisBundle.self, from: analysisData)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct NativeConversationsView: View {
    @State private var model = NativeConversationsModel()
    @State private var connection = NativeConnection.shared
    @State private var search = ""
    @State private var navigation = TRACEAppNavigation.shared
    @State private var showingSettings = false
    @State private var isSelecting = false
    @State private var selectedIDs = Set<String>()
    @State private var pendingDeleteIDs = Set<String>()
    @State private var showingDeleteConfirmation = false
    @State private var showingPlaces = false

    var body: some View {
        NavigationStack {
            Group {
                if !connection.enrolled {
                    ContentUnavailableView("Connect TRACE", systemImage: "lock.shield", description: Text("Enroll this iPhone in Settings to load your conversations."))
                } else if model.conversations.isEmpty && model.isLoading {
                    ProgressView("Loading conversations…")
                } else if model.conversations.isEmpty && model.error == nil {
                    ContentUnavailableView {
                        Label("No conversations yet", systemImage: "text.bubble")
                    } description: {
                        Text("Capture audio with your DevKit2. Its transcript and summary will appear here after processing.")
                    } actions: {
                        Button("Start a recording") { navigation.selectedTab = .capture }
                    }
                } else {
                    List(selection: isSelecting ? $selectedIDs : nil) {
                        if let error = model.error {
                            Section { Text(error).foregroundStyle(.red) }
                        }
                        if groupedConversations.isEmpty && !search.isEmpty {
                            ContentUnavailableView.search(text: search)
                                .listRowBackground(Color.clear)
                        }
                        ForEach(groupedConversations, id: \.day) { group in
                            Section(group.day.formatted(date: .complete, time: .omitted)) {
                                ForEach(group.items) { conversation in
                                    Group {
                                        if isSelecting {
                                            conversationRow(conversation)
                                        } else {
                                            NavigationLink(value: conversation.id) { conversationRow(conversation) }
                                        }
                                    }
                                    .tag(conversation.id)
                                    .accessibilityIdentifier("trace.conversation.\(conversation.id)")
                                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                        if !isSelecting {
                                            Button(role: .destructive) {
                                                requestDeletion([conversation.id])
                                            } label: { Label("Delete", systemImage: "trash") }
                                            .disabled(model.isLoading || model.isDeleting)
                                        }
                                    }
                                }.padding(.vertical, 3)
                            }
                        }
                        if model.hasMoreForView {
                            HStack { Spacer(); if model.isLoading { ProgressView() } else { Button("Load more") { Task { await model.load() } } }; Spacer() }
                        }
                    }
                    .environment(\.editMode, .constant(isSelecting ? .active : .inactive))
                    .disabled(model.isDeleting)
                    .searchable(text: $search, prompt: "Search loaded conversations")
                    .refreshable { await model.load(refresh: true) }
                    .navigationDestination(for: String.self) { id in NativeConversationDetailView(id: id) }
                }
            }
            .traceWorkspace()
            .navigationTitle("Conversations")
            .sheet(isPresented: $showingSettings) { NativeSettingsView() }
            .sheet(isPresented: $showingPlaces) { NativePlacesView() }
            .alert(pendingDeleteIDs.count == 1 ? "Delete conversation?" : "Delete \(pendingDeleteIDs.count) conversations?", isPresented: $showingDeleteConfirmation) {
                Button("Cancel", role: .cancel) { pendingDeleteIDs = [] }
                Button("Delete", role: .destructive) {
                    let ids = pendingDeleteIDs
                    Task {
                        if await model.delete(ids: ids) {
                            selectedIDs.subtract(ids)
                            if selectedIDs.isEmpty { isSelecting = false }
                        }
                        pendingDeleteIDs = []
                    }
                }
            } message: {
                Text("The conversations, transcripts and summaries will be removed from TRACE. Saved analyses and originals in Omi will remain. This cannot be undone.")
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingPlaces = true } label: { Image(systemName: "mappin.and.ellipse").accessibilityLabel("Places") }
                        .accessibilityIdentifier("trace.conversations.places")
                        .disabled(!connection.enrolled)
                }
                ToolbarItem(placement: .topBarLeading) {
                    if connection.enrolled && !model.conversations.isEmpty {
                        Button(isSelecting ? "Done" : "Select") {
                            isSelecting.toggle()
                            selectedIDs = []
                        }
                        .disabled(model.isLoading || model.isDeleting)
                        .accessibilityIdentifier("trace.conversations.select")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if isSelecting {
                        Button(role: .destructive) { requestDeletion(selectedIDs) } label: {
                            Label(model.isDeleting ? "Deleting…" : "Delete (\(selectedIDs.count))", systemImage: "trash")
                        }
                        .disabled(selectedIDs.isEmpty || model.isLoading || model.isDeleting)
                        .accessibilityIdentifier("trace.conversations.deleteSelected")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingSettings = true } label: { Image(systemName: "gearshape").accessibilityLabel("Settings") }
                        .accessibilityIdentifier("trace.settings")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await model.load(refresh: true) } } label: { Image(systemName: "arrow.clockwise").accessibilityLabel("Refresh") }
                        .accessibilityIdentifier("trace.conversations.refresh")
                        .disabled(model.isLoading || model.isDeleting || !connection.enrolled)
                }
            }
            .onChange(of: model.conversations.map(\.id)) { _, ids in
                selectedIDs.formIntersection(Set(ids))
            }
            .task(id: connection.enrolled) { await model.load() }
            .onReceive(NotificationCenter.default.publisher(for: .traceConversationUpdated)) { _ in
                Task { await model.load(refresh: true) }
            }
        }
    }

    private func requestDeletion(_ ids: Set<String>) {
        guard !ids.isEmpty else { return }
        pendingDeleteIDs = ids
        showingDeleteConfirmation = true
    }

    private func conversationRow(_ conversation: NativeConversation) -> some View {
        HStack(alignment: .top, spacing: 14) {
                                            Image(systemName: "text.bubble.fill")
                                                .font(.title3).foregroundStyle(TRACEStyle.accent)
                                                .frame(width: 42, height: 42)
                                                .background(TRACEStyle.accent.opacity(0.09), in: RoundedRectangle(cornerRadius: 12))
                                                .accessibilityHidden(true)
                                            VStack(alignment: .leading, spacing: 7) {
                                                Text(conversation.displayTitle).font(.headline).lineLimit(2)
                                                if let overview = conversation.structured?.overview, !overview.isEmpty {
                                                    Text(overview).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                                                }
                                                HStack(spacing: 8) {
                                                    Text(conversation.displayDate?.formatted(date: .omitted, time: .shortened) ?? conversation.createdAt)
                                                    if conversation.source == "trace-recovered" { Text("· Recovered · Time approximate") }
                                                    else if let duration = conversation.duration { Text("·"); Text(duration) }
                                                }.font(.caption).foregroundStyle(.secondary)
                                            }
                                        }.padding(.vertical, 8)
    }

    private var groupedConversations: [(day: Date, items: [NativeConversation])] {
        let calendar = Calendar.current
        let grouped = Dictionary(grouping: model.conversations.filter {
            search.isEmpty || $0.displayTitle.localizedCaseInsensitiveContains(search)
                || ($0.structured?.overview?.localizedCaseInsensitiveContains(search) ?? false)
        }) { conversation in
            calendar.startOfDay(for: conversation.displayDate ?? .distantPast)
        }
        return grouped.keys.sorted(by: >).map { day in
            (day: day, items: grouped[day] ?? [])
        }
    }
}

struct NativeConversationDetailView: View {
    let id: String
    @State private var model = NativeConversationDetailModel()
    @State private var customPrompt = ""
    @State private var showingFullTitle = false
    @State private var selectedTab: ConversationDetailTab = .summary
    @State private var showEstimatedSpeakers = false
    @State private var correctingSpeaker: TranscriptPresentation.Block?
    @State private var exportFile: ConversationExportFile?
    @State private var exportDirectory: URL?
    @State private var isExporting = false
    @State private var exportError: String?

    private func export(_ conversation: NativeConversation, content: ConversationTextExport.Content, format: ConversationTextExport.Format) {
        guard !isExporting, ConversationTextExport.available(content, in: conversation) else { return }
        isExporting = true
        let document = ConversationTextExport(conversation: conversation, content: content)
        Task {
            defer { isExporting = false }
            do {
                let url = try await Task.detached(priority: .userInitiated) { try document.write(format: format) }.value
                exportDirectory = url.deletingLastPathComponent()
                exportFile = ConversationExportFile(url: url)
            } catch {
                exportError = "TRACE couldn’t prepare the file. Please try again."
            }
        }
    }

    private enum ConversationDetailTab: String, CaseIterable, Identifiable {
        case summary = "Summary"
        case transcript = "Transcript"
        var id: String { rawValue }
    }

    var body: some View {
        Group {
            if model.isLoading && model.conversation == nil {
                ProgressView("Loading conversation…")
            } else if let conversation = model.conversation {
                List {
                    Section {
                        VStack(alignment: .leading, spacing: 5) {
                            if let category = conversation.structured?.category, !category.isEmpty {
                                Text(category.capitalized)
                                    .font(.caption.weight(.semibold)).tracking(1)
                                    .foregroundStyle(TRACEStyle.accent)
                            }
                            Text(conversation.displayTitle).font(.title3.weight(.semibold))
                                .lineLimit(showingFullTitle ? nil : 3)
                            if conversation.displayTitle.count > 100 {
                                Button(showingFullTitle ? "Show less" : "Show full title") {
                                    showingFullTitle.toggle()
                                }.font(.caption.weight(.medium)).buttonStyle(.borderless)
                            }
                            if let date = conversation.displayDate {
                                Text(date.formatted(date: .abbreviated, time: .shortened))
                                    .font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                    }
                    Section {
                        Picker("Conversation content", selection: $selectedTab) {
                            ForEach(ConversationDetailTab.allCases) { tab in
                                Text(tab.rawValue).tag(tab)
                            }
                        }
                        .pickerStyle(.segmented)
                        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                    }

                    ConversationLocationSection(id: id, original: conversation.geolocation) { await model.load(id: id) }
                    ConversationAudioSection(id: id, conversation: conversation)

                    if (conversation.source == "trace" || conversation.source == "trace-recovered"),
                       conversation.structured?.overview?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true {
                        Section("Summary") {
                            if conversation.summaryProcessing?.isWorking == true || model.isRetryingSummary {
                                HStack { ProgressView(); Text("Preparing your summary…") }
                                Text("Your transcript is saved. You can keep using TRACE while the summary finishes.")
                                    .font(.subheadline).foregroundStyle(.secondary)
                            } else {
                                Text(conversation.summaryProcessing?.error ?? "Your transcript is saved, but the summary is not ready.")
                                    .font(.subheadline).foregroundStyle(.secondary)
                                Button {
                                    Task { await model.retrySummary(id: id) }
                                } label: { Label("Retry summary", systemImage: "arrow.clockwise") }
                                .disabled(model.isRetryingSummary)
                            }
                            if let retryError = model.summaryRetryError { Text(retryError).foregroundStyle(.red) }
                        }
                    }

                    if conversation.source == "trace-recovered" {
                        Section("Recovered recording") {
                            Text("Audio recovered from a delayed upload. The displayed date and time are approximate; this file may contain part of a longer conversation.")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                    }

                    if selectedTab == .summary {
                        if let analysisError = model.error {
                            Section("Analysis") { Text(analysisError).foregroundStyle(.red) }
                        }
                        if let overview = conversation.structured?.overview, !overview.isEmpty {
                            Section("Overview") {
                                Text(overview).font(.body).lineSpacing(5)
                                    .textSelection(.enabled).padding(.vertical, 6)
                            }
                        } else {
                            Section("Overview") {
                                Text("No summary is available for this conversation yet.")
                                    .foregroundStyle(.secondary)
                            }
                        }

                        if let actionItems = conversation.structured?.actionItems, !actionItems.isEmpty {
                            Section {
                                ForEach(actionItems) { item in
                                    let isComplete = item.completed == true
                                    HStack(alignment: .top, spacing: 10) {
                                        Image(systemName: "text.badge.checkmark")
                                            .foregroundColor(isComplete ? Color.secondary : Color.accentColor)
                                            .accessibilityHidden(true)
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(item.description)
                                                .strikethrough(isComplete)
                                                .foregroundColor(isComplete ? Color.secondary : Color.primary)
                                                .textSelection(.enabled)
                                            Text(isComplete ? "Reported complete" : "Extracted action").font(.caption).foregroundStyle(.secondary)
                                            if let dueDateLabel = item.dueDateLabel {
                                                Text("Due \(dueDateLabel)")
                                                    .font(.caption).foregroundStyle(.secondary)
                                            }
                                        }
                                    }
                                    .padding(.vertical, 3)
                                }
                            } header: { Text("Extracted actions") }
                            footer: { Text("These are notes from the conversation. Run ADHD Aid below to manage commitments in Today.") }
                        }

                        Section("Optional analyses") {
                            DisclosureGroup("Research and ADHD Aid") {
                            Text("Run ADHD Aid to turn extracted commitments into items you can manage in Today.").font(.footnote).foregroundStyle(.secondary)

                            Button {
                                Task { await model.generate("thesis", id: id) }
                            } label: {
                                generationLabel("Research analysis", kind: "thesis")
                            }.disabled(model.isGenerating != nil || conversation.transcriptSegments?.isEmpty != false)
                            Button {
                                Task { await model.generate("adhd", id: id) }
                            } label: {
                                generationLabel("ADHD Aid", kind: "adhd")
                            }.disabled(model.isGenerating != nil || conversation.transcriptSegments?.isEmpty != false)
                            VStack(alignment: .leading, spacing: 8) {
                                TextField("Ask a custom thesis question", text: $customPrompt, axis: .vertical)
                                    .lineLimit(2...5)
                                    .textFieldStyle(.roundedBorder)
                                Button {
                                    Task { await model.generate("custom", id: id, prompt: customPrompt) }
                                } label: {
                                    generationLabel("Run custom analysis", kind: "custom")
                                }
                                .disabled(model.isGenerating != nil || customPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || conversation.transcriptSegments?.isEmpty != false)
                            }
                        }
                        }
                        if let thesis = model.analyses?.thesis?.current {
                            Section("Thesis · \(thesis.title)") {
                                AnalysisParagraph(title: "Documentary record", text: thesis.rq1DocumentaryRecord)
                                AnalysisParagraph(title: "Everyday practices", text: thesis.rq2EverydayPractices)
                                AnalysisParagraph(title: "CSKT intersection", text: thesis.rq3CsktIntersection)
                                AnalysisParagraph(title: "Wildness imaginary", text: thesis.rq4WildnessImaginary)
                                AnalysisParagraph(title: "Conditions check", text: thesis.conditionsCheck)
                                AnalysisParagraph(title: "Rival hypothesis", text: thesis.rivalHypothesisTest)
                                AnalysisParagraph(title: "Refutation signals", text: thesis.refutationSignals)
                                AnalysisParagraph(title: "Forward thinking", text: thesis.forwardThinking)
                                if let custom = thesis.custom {
                                    AnalysisParagraph(title: "Custom · \(custom.prompt)", text: custom.result)
                                }
                            }
                        }
                        if let adhd = model.analyses?.adhd {
                            Section("ADHD Aid · \(adhd.title)") {
                                Text(adhd.analysis.summary).textSelection(.enabled)
                                AnalysisList(title: "Do today", values: adhd.analysis.doToday)
                                AnalysisList(title: "Remember", values: adhd.analysis.remember)
                                AnalysisList(title: "Open loops", values: adhd.analysis.openLoops)
                                if !adhd.analysis.commitments.isEmpty {
                                    VStack(alignment: .leading, spacing: 10) {
                                        Text("Commitments").font(.subheadline.weight(.semibold))
                                        ForEach(adhd.analysis.commitments) { commitment in
                                            VStack(alignment: .leading, spacing: 3) {
                                                Text("\(commitment.who): \(commitment.what)")
                                                Text("\(commitment.direction == "other_to_user" ? "Owed to you" : "You owe") · \(commitment.confidence.capitalized) · \(commitment.deadline)")
                                                    .font(.caption).foregroundStyle(.secondary)
                                            }
                                        }
                                    }
                                }
                                if !adhd.analysis.ahead.isEmpty {
                                    VStack(alignment: .leading, spacing: 8) {
                                        Text("Coming up").font(.subheadline.weight(.semibold))
                                        ForEach(adhd.analysis.ahead) { item in
                                            VStack(alignment: .leading, spacing: 3) {
                                                Text("\(item.event) · \(item.date)")
                                                if !item.prep.isEmpty { Text(item.prep).font(.caption).foregroundStyle(.secondary) }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        Section("Transcript") {
                            if let segments = conversation.transcriptSegments, !segments.isEmpty {
                                Toggle("Estimated speakers", isOn: $showEstimatedSpeakers)
                                    .accessibilityIdentifier("trace.transcript.estimatedSpeakers")
                                if showEstimatedSpeakers {
                                    Text("Speaker separation and reference matches may be wrong. ‘Possibly’ is a suggestion, not a confirmed identity. Numbers apply only within a transcription window. Correct individual passages after listening.")
                                        .font(.footnote).foregroundStyle(.secondary)
                                }
                                NavigationLink { NativeVoiceReviewView(conversationId: id, segments: segments) } label: {
                                    Label("Review voice samples", systemImage: "waveform.badge.magnifyingglass")
                                }.accessibilityIdentifier("trace.transcript.voiceSamples")
                                DisclosureGroup("Speaker details") {
                                    let models = Set(segments.compactMap(\.diarizerModel)).sorted()
                                    let versions = Set(segments.compactMap(\.diarizerVersion)).sorted()
                                    Text(models.isEmpty ? "Diarizer model: not retained in this older transcript." : "Model: \(models.joined(separator: ", "))")
                                    if !versions.isEmpty { Text("Version: \(versions.joined(separator: ", "))").font(.caption) }
                                    ForEach(Array(Set(segments.compactMap(\.voiceRecognitionNote))).sorted(), id: \.self) { Text($0).font(.footnote) }
                                    Text("Deepgram word confidence concerns speaker separation, not a person's identity. OpenAI reference matches have no numeric speaker confidence. Only your explicit corrections are confirmed.").font(.footnote).foregroundStyle(.secondary)
                                }
                                ForEach(TranscriptPresentation.blocks(segments, estimatedSpeakers: showEstimatedSpeakers)) { block in
                                    VStack(alignment: .leading, spacing: 4) {
                                        HStack {
                                            if let label = block.speakerLabel {
                                                Text(label)
                                            }
                                            if let time = block.timestamp { Text(time) }
                                        }.font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                        Text(block.text).textSelection(.enabled)
                                        if showEstimatedSpeakers {
                                            if conversation.transcriptRevision != nil {
                                                Button("Identify or correct speaker") { correctingSpeaker = block }
                                                    .font(.caption).buttonStyle(.borderless)
                                            }
                                            if let minimum = block.segmentIndices.compactMap({segments[$0].speakerConfidenceMin}).min() {
                                                Text("Separation confidence, lowest word: \(minimum, specifier: "%.2f")").font(.caption2).foregroundStyle(.secondary)
                                            }
                                        }
                                    }.padding(.vertical, 4)
                                }
                            } else if conversation.transcriptSegments == nil {
                                Label("Transcript hasn’t been loaded.", systemImage: "arrow.clockwise")
                                    .foregroundStyle(.secondary)
                            }
                            else {
                                Text("No transcript is available.").foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            } else {
                ContentUnavailableView {
                    Label("Could not load conversation", systemImage: "exclamationmark.bubble")
                } description: { Text(model.error ?? "Try again when the server is available.") }
                actions: { Button("Retry conversation") { Task { await model.load(id: id) } } }
            }
        }
        .traceWorkspace()
        .navigationTitle("Conversation")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if isExporting {
                    ProgressView().accessibilityLabel("Preparing export")
                } else if let conversation = model.conversation {
                    Menu {
                        Section("Summary") {
                            Button("Export summary as PDF") { export(conversation, content: .summary, format: .pdf) }
                            Button("Export summary as TXT") { export(conversation, content: .summary, format: .txt) }
                        }.disabled(!ConversationTextExport.available(.summary, in: conversation))
                        Section("Transcript") {
                            Button("Export transcript as PDF") { export(conversation, content: .transcript, format: .pdf) }
                            Button("Export transcript as TXT") { export(conversation, content: .transcript, format: .txt) }
                        }.disabled(!ConversationTextExport.available(.transcript, in: conversation))
                    } label: { Image(systemName: "square.and.arrow.up").accessibilityLabel("Export transcript or summary") }
                }
            }
        }
        .sheet(item: $exportFile, onDismiss: {
            if let exportDirectory { try? FileManager.default.removeItem(at: exportDirectory) }
            exportDirectory = nil
            exportFile = nil
        }) { file in ConversationExportShareSheet(file: file) }
        .alert("Could not export", isPresented: Binding(get: { exportError != nil }, set: { if !$0 { exportError = nil } })) {
            Button("OK", role: .cancel) { exportError = nil }
        } message: { Text(exportError ?? "Please try again.") }
        .sheet(item: $correctingSpeaker) { block in
            NavigationStack {
                NativeSpeakerCorrectionView(conversationId: id, revision: model.conversation?.transcriptRevision, indices: block.segmentIndices, segments: model.conversation?.transcriptSegments ?? []) { await model.load(id: id) }
            }
        }
        .task {
            await model.load(id: id)
            if let conversation = model.conversation,
               conversation.transcriptSegments?.isEmpty == false,
               (conversation.structured?.overview?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) {
                selectedTab = .transcript
            }
        }
        .task(id: model.conversation?.summaryProcessing?.status) {
            guard model.conversation?.summaryProcessing?.isWorking == true else { return }
            // Poll only while this detail is visible; background processing stays on the server.
            for _ in 0..<90 {
                do { try await Task.sleep(nanoseconds: 3_000_000_000) }
                catch { return }
                guard !Task.isCancelled else { return }
                await model.load(id: id)
                if model.conversation?.summaryProcessing?.isWorking != true { return }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .traceConversationUpdated)) { event in
            guard event.object as? String == id else { return }
            Task { await model.load(id: id) }
        }
    }

    @ViewBuilder
    private func generationLabel(_ title: String, kind: String) -> some View {
        if model.isGenerating == kind {
            HStack { ProgressView(); Text("Generating \(title.lowercased())…") }
        } else {
            Label(title, systemImage: "sparkles")
        }
    }
}

private struct AnalysisParagraph: View {
    let title: String
    let text: String
    var body: some View {
        if !text.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(text).textSelection(.enabled)
            }.padding(.vertical, 3)
        }
    }
}

private struct AnalysisList: View {
    let title: String
    let values: [String]
    var body: some View {
        if !values.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.subheadline.weight(.semibold))
                ForEach(Array(values.enumerated()), id: \.offset) { item in
                    Label(item.element, systemImage: "circle")
                        .labelStyle(.titleOnly)
                        .textSelection(.enabled)
                }
            }.padding(.vertical, 3)
        }
    }
}

private extension NativeConversationsModel {
    var hasMoreForView: Bool { hasMore }
}
