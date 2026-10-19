import Foundation
import Observation
import SwiftUI

private struct NativeAskResponse: Decodable {
    let id: String?
    let question: String?
    let askedAt: String?
    let answer: String
    let sources: [NativeAskSource]
    let passageCount: Int
    let skipped: Bool?
}

private struct NativeAskHistory: Decodable {
    let inquiries: [NativeSavedInquiry]
}

struct NativeSavedInquiry: Decodable, Identifiable {
    let id: String
    let question: String
    let answer: String
    let askedAt: String?
    let sources: [NativeAskSource]
    let passageCount: Int
}

struct NativeAskSource: Decodable, Identifiable {
    let tag: String
    let kind: String
    let conversationId: String?
    let conversationIds: [String]?
    let title: String
    let date: String?
    let label: String
    var id: String { tag }
}

@MainActor
@Observable
final class NativeAskModel {
    var question = ""
    var answer: String?
    var sources: [NativeAskSource] = []
    var passageCount = 0
    var isAsking = false
    var error: String?
    var history: [NativeSavedInquiry] = []
    private let request: (String, String, Data?) async throws -> Data
    init(request: @escaping (String, String, Data?) async throws -> Data = { path, method, body in
        try await NativeConnection.shared.authenticatedRequest(path: path, method: method, body: body)
    }) { self.request = request }

    func ask() async {
        let submittedQuestion = question
        let trimmed = submittedQuestion.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 1_000, !isAsking else { return }
        isAsking = true
        error = nil
        defer { isAsking = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["question": trimmed])
            let data = try await request("/api/native/v1/ask", "POST", body)
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let response = try decoder.decode(NativeAskResponse.self, from: data)
            answer = response.answer
            sources = response.sources
            passageCount = response.passageCount
            if response.skipped == true { error = response.answer; answer = nil }
            if question == submittedQuestion { question = "" }
            await loadHistory()
        } catch let requestError { error = requestError.localizedDescription }
    }

    func loadHistory() async {
        do {
            let data = try await request("/api/native/v1/ask", "GET", nil)
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            history = try decoder.decode(NativeAskHistory.self, from: data).inquiries
        } catch { self.error = error.localizedDescription }
    }

    func show(_ inquiry: NativeSavedInquiry) {
        question = inquiry.question
        answer = inquiry.answer
        sources = inquiry.sources
        passageCount = inquiry.passageCount
    }
}

struct NativeAskView: View {
    @State private var model = NativeAskModel()
    @State private var connection = NativeConnection.shared
    @FocusState private var questionFocused: Bool

    var body: some View {
        Group {
                if !connection.enrolled {
                    ContentUnavailableView("Connect TRACE", systemImage: "lock.shield", description: Text("Enroll this iPhone before asking saved research analyses."))
                } else {
                    List {
                        Section("Ask saved analyses") {
                            TextField("Question across thesis and group analyses", text: $model.question, axis: .vertical)
                                .lineLimit(3...6)
                                .focused($questionFocused)
                                .textFieldStyle(.roundedBorder)
                                .accessibilityLabel("Question across thesis and group analyses")
                            Text("Up to 1,000 characters. Answers use matching saved analysis passages and cite their source tags.")
                                .font(.caption).foregroundStyle(.secondary)
                            Button {
                                questionFocused = false
                                Task { await model.ask() }
                            } label: {
                                if model.isAsking { HStack { ProgressView(); Text("Finding an answer…") } }
                                else { Label("Ask", systemImage: "sparkles") }
                            }
                            .disabled(model.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.question.count > 1_000 || model.isAsking)
                        }
                        if let error = model.error { Section("Ask") { Text(error).foregroundStyle(.red) } }
                        if let answer = model.answer {
                            Section("Answer · \(model.passageCount) passages") {
                                Text(answer).textSelection(.enabled)
                            }
                            if !model.sources.isEmpty {
                                Section("Sources · \(model.sources.count)") {
                                    ForEach(model.sources) { source in
                                        if source.kind == "conversation", let id = source.conversationId {
                                            NavigationLink(value: id) { sourceLabel(source) }
                                        } else if let ids = source.conversationIds, !ids.isEmpty {
                                            NavigationLink { NativeSavedGroupView(conversationIDs: ids) } label: { sourceLabel(source) }
                                        } else { sourceLabel(source) }
                                    }.disabled(model.isAsking)
                                }
                            }
                        }
                        if !model.history.isEmpty {
                            Section("Saved questions") {
                                ForEach(model.history) { inquiry in
                                    Button { model.show(inquiry) } label: {
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(inquiry.question).foregroundStyle(.primary).multilineTextAlignment(.leading)
                                            Text(inquiry.askedAt ?? "Saved question").font(.caption).foregroundStyle(.secondary)
                                        }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 2)
                                    }
                                }
                            }
                        }
                    }
                    .navigationDestination(for: String.self) { id in NativeConversationDetailView(id: id) }
                    .task { await model.loadHistory() }
                }
            }
            .navigationTitle("Ask saved analyses")
            .navigationBarTitleDisplayMode(.inline)
            .traceWorkspace()
    }

    private func sourceLabel(_ source: NativeAskSource) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("[\(source.tag)] \(source.title)").font(.subheadline.weight(.medium))
            Text(source.label + (source.date.map { " · \(String($0.prefix(10)))" } ?? ""))
                .font(.caption).foregroundStyle(.secondary)
        }
    }
}
