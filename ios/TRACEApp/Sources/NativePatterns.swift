import Foundation
import Observation
import SwiftUI

private struct NativePatternsResponse: Decodable {
    let patterns: NativePatterns
}

struct NativeCoverageWeek: Decodable, Identifiable {
    let week: String
    let activeDays: Int
    let rolledDays: Int
    var id: String { week }
}

struct NativeWeekRow: Decodable, Identifiable {
    let week: String
    let created: Int
    let done: Int
    let letGo: Int
    let open: Int
    var id: String { week }
}

struct NativePersonPattern: Decodable, Identifiable {
    let who: String
    let open: Int
    let oldestOpenDays: Int
    let done: Int
    var id: String { who }
}

struct NativeRecurringLoop: Decodable, Identifiable {
    struct Conversation: Decodable, Identifiable {
        let id: String
        let title: String
    }
    let text: String
    let count: Int
    let conversations: [Conversation]
    var id: String { text }
}

struct NativePlanDay: Decodable, Identifiable {
    let day: String
    let done: Int
    let total: Int
    var id: String { day }
}

struct NativePatterns: Decodable {
    let coverage: [NativeCoverageWeek]
    let rollupStreak: Int
    let weeks: [NativeWeekRow]
    let completionRate: Double?
    let openCount: Int
    let openMedianAgeDays: Int?
    let openOver14: Int
    let people: [NativePersonPattern]
    let loops: [NativeRecurringLoop]
    let planRate: Double?
    let planDays: [NativePlanDay]

    var isEmpty: Bool {
        weeks.allSatisfy { $0.created == 0 } && coverage.allSatisfy { $0.activeDays == 0 } && planDays.isEmpty
    }
}

@MainActor
@Observable
final class NativePatternsModel {
    var patterns: NativePatterns?
    var isLoading = false
    var error: String?

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            var calendar = Calendar.current
            calendar.timeZone = .current
            let components = calendar.dateComponents([.year, .month, .day], from: Date())
            guard let date = calendar.date(from: components) else { throw URLError(.badServerResponse) }
            let formatter = DateFormatter()
            formatter.calendar = calendar
            formatter.timeZone = .current
            formatter.dateFormat = "yyyy-MM-dd"
            let today = formatter.string(from: date)
            let data = try await NativeConnection.shared.authenticatedData(
                path: "/api/native/v1/patterns",
                queryItems: [URLQueryItem(name: "today", value: today), URLQueryItem(name: "timeZone", value: TimeZone.current.identifier)]
            )
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            patterns = try decoder.decode(NativePatternsResponse.self, from: data).patterns
            error = nil
        } catch let requestError { error = requestError.localizedDescription }
    }
}

struct NativePatternsView: View {
    @State private var model = NativePatternsModel()
    @State private var connection = NativeConnection.shared
    @State private var navigation = TRACEAppNavigation.shared

    var body: some View {
        Group {
                if !connection.enrolled {
                    ContentUnavailableView("Connect TRACE", systemImage: "lock.shield", description: Text("Enroll this iPhone before loading Patterns."))
                } else if model.isLoading && model.patterns == nil {
                    ProgressView("Reading your patterns…")
                } else if let patterns = model.patterns, patterns.isEmpty {
                    ContentUnavailableView {
                        Label("No planning patterns yet", systemImage: "chart.bar")
                    } description: { Text("Run ADHD Aid on saved conversations and create a daily review in Today.") }
                    actions: { Button("Open Today") { navigation.selectedTab = .today } }
                } else if let patterns = model.patterns {
                    List {
                        if let error = model.error { Section { Text(error).foregroundStyle(.red) } }
                        Section("Daily reviews") {
                            LabeledContent("Review streak", value: days(patterns.rollupStreak))
                            let active = patterns.coverage.reduce(0) { $0 + $1.activeDays }
                            let rolled = patterns.coverage.reduce(0) { $0 + $1.rolledDays }
                            LabeledContent("Days reviewed · 8 weeks", value: active == 0 ? "—" : "\(rolled) / \(active)")
                            DisclosureGroup("Weekly review history") {
                            ForEach(patterns.coverage) { week in
                                VStack(alignment: .leading, spacing: 6) {
                                    Text("Week of \(weekLabel(week.week))").font(.subheadline)
                                    Text("\(days(week.rolledDays)) reviewed · \(days(week.activeDays)) active")
                                        .font(.caption).foregroundStyle(.secondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                .accessibilityElement(children: .ignore)
                                .accessibilityLabel("Week of \(weekLabel(week.week))")
                                .accessibilityValue("\(days(week.rolledDays)) reviewed, \(days(week.activeDays)) active")
                            }
                        }
                        }
                        Section("Commitment progress") {
                            LabeledContent("Done rate", value: percent(patterns.completionRate))
                            LabeledContent("Open now", value: String(patterns.openCount))
                            LabeledContent("Median age", value: patterns.openMedianAgeDays.map { days($0) } ?? "—")
                            LabeledContent("Over 14 days", value: String(patterns.openOver14))
                            DisclosureGroup("Weekly commitment history") {
                            ForEach(patterns.weeks) { week in
                                VStack(alignment: .leading, spacing: 6) {
                                    Text("Week of \(weekLabel(week.week))").font(.subheadline)
                                    Text("\(week.done) done · \(week.letGo) let go · \(week.open) open")
                                        .font(.caption).foregroundStyle(.secondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                }.accessibilityElement(children: .combine)
                            }
                        }
                        }
                        if !patterns.people.isEmpty {
                            Section("People and commitments") {
                                ForEach(patterns.people) { person in
                                    LabeledContent(person.who, value: "\(person.open) open · oldest \(days(person.oldestOpenDays)) · \(person.done) done")
                                }
                            }
                        }
                        if !patterns.loops.isEmpty {
                            Section("Recurring themes") {
                                ForEach(patterns.loops) { loop in
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(loop.text).textSelection(.enabled)
                                        Text("Repeated in \(loop.count) conversations: \(loop.conversations.map(\.title).joined(separator: ", "))")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }.padding(.vertical, 3)
                                }
                            }
                        }
                        Section("Plan progress") {
                            LabeledContent("Plan-step rate", value: percent(patterns.planRate))
                            ForEach(patterns.planDays) { day in
                                HStack { Text(day.day); Spacer(); Text("\(day.done) / \(day.total)").foregroundStyle(.secondary) }
                            }
                        }
                    }
                    .refreshable { await model.load() }
                } else if let error = model.error {
                    ContentUnavailableView {
                        Label("Patterns unavailable", systemImage: "exclamationmark.triangle")
                    } description: { Text(error) }
                    actions: { Button("Retry patterns") { Task { await model.load() } } }
                } else {
                    ProgressView("Reading your patterns…")
                }
            }
            .navigationTitle("Patterns")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await model.load() } } label: { Image(systemName: "arrow.clockwise").accessibilityLabel("Refresh") }
                        .disabled(model.isLoading || !connection.enrolled)
                }
            }
            .task { await model.load() }
            .traceWorkspace()
            .navigationBarTitleDisplayMode(.inline)
    }

    private func days(_ count: Int) -> String { "\(count.formatted()) \(count == 1 ? "day" : "days")" }

    private func percent(_ value: Double?) -> String {
        guard let value else { return "—" }
        return "\(Int((value * 100).rounded()))%"
    }

    private func weekLabel(_ value: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: value) else { return value }
        return date.formatted(.dateTime.day().month(.wide).year())
    }
}
