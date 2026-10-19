import Foundation
import SwiftUI
import UIKit

private struct NativeCommitmentsEnvelope: Decodable {
    let analyses: [String: NativeStoredADHD]
}

private struct NativeRollupsEnvelope: Decodable {
    let day: String
    let weekStart: String
    var daily: NativeStoredRollup?
    let weekly: NativeStoredWeeklyRollup?
}

private struct NativeStoredRollup: Decodable {
    let rollup: NativeRollupContent
    var planDoneKeys: [String]?
}

private struct NativeRollupContent: Decodable {
    let todayParagraph: String
    let tomorrowPlan: String
    let planSteps: [NativeRollupPlanStep]?
    let agingCommitments: String
    let conflictsAtRisk: String
    let socialLedger: String
    let tomorrowEvents: String
    let dropped: String
}

private struct NativeRollupPlanStep: Decodable, Identifiable {
    let key: String
    let what: String
    let when: String?
    let minutes: Int?
    let deadline: String?
    let why: String?
    var id: String { key }
}

private struct NativeStoredWeeklyRollup: Decodable {
    let rollup: NativeWeeklyRollupContent
}

private struct NativeWeeklyRollupContent: Decodable {
    let weekSummary: String
    let completionPattern: String
    let chronicallyAging: String
    let droppedThisWeek: String
    let socialPattern: String
    let nextWeekSetup: String
}

@MainActor
@Observable
private final class NativeRollupsModel {
    var value: NativeRollupsEnvelope?
    var isLoading = false
    var error: String?
    var updatingPlanSteps = Set<String>()
    var generating: String?
    private enum FailedAction { case load, daily, weekly, step(String, Bool) }
    private var failedAction: FailedAction = .load
    func retry() async {
        switch failedAction {
        case .load: await load()
        case .daily: await generateDaily()
        case .weekly: await generateWeekly()
        case .step(let key, let done): await setPlanStep(key, done: done)
        }
    }


    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let dayFormatter = DateFormatter()
            dayFormatter.calendar = Calendar(identifier: .gregorian)
            dayFormatter.locale = Locale(identifier: "en_US_POSIX")
            dayFormatter.timeZone = .current
            dayFormatter.dateFormat = "yyyy-MM-dd"
            let today = dayFormatter.string(from: .now)
            let weekday = Calendar.current.component(.weekday, from: .now)
            let daysSinceMonday = (weekday + 5) % 7
            let monday = Calendar.current.date(byAdding: .day, value: -daysSinceMonday, to: Calendar.current.startOfDay(for: .now)) ?? .now
            let weekStart = dayFormatter.string(from: monday)
            let data = try await NativeConnection.shared.authenticatedData(
                path: "/api/native/v1/rollups",
                queryItems: [URLQueryItem(name: "day", value: today), URLQueryItem(name: "weekStart", value: weekStart)]
            )
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            value = try decoder.decode(NativeRollupsEnvelope.self, from: data)
            error = nil
        } catch {
            failedAction = .load
            self.error = "Could not load your daily and weekly review. " + error.localizedDescription
        }
    }

    func setPlanStep(_ key: String, done: Bool) async {
        guard let current = value, current.daily != nil,
              updatingPlanSteps.insert(key).inserted else { return }
        defer { updatingPlanSteps.remove(key) }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["day": current.day, "key": key, "done": done])
            _ = try await NativeConnection.shared.authenticatedRequest(
                path: "/api/native/v1/rollups",
                method: "PATCH",
                body: body
            )
            guard var updated = value, updated.day == current.day, var updatedDaily = updated.daily else { return }
            var keys = Set(updatedDaily.planDoneKeys ?? [])
            if done { keys.insert(key) } else { keys.remove(key) }
            updatedDaily.planDoneKeys = Array(keys).sorted()
            updated.daily = updatedDaily
            value = updated
            error = nil
        } catch {
            failedAction = .step(key, done)
            self.error = "The plan step was not updated. " + error.localizedDescription
        }
    }

    func generateDaily() async {
        guard let day = value?.day, generating == nil else { return }
        generating = "daily"
        defer { generating = nil }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["day": day, "timeZone": TimeZone.current.identifier])
            _ = try await NativeConnection.shared.authenticatedRequest(path: "/api/native/v1/rollups/generate", method: "POST", body: body)
            await load()
        } catch { failedAction = .daily; self.error = "Your daily review was not created. " + error.localizedDescription }
    }

    func generateWeekly() async {
        guard let weekStart = value?.weekStart, generating == nil else { return }
        generating = "weekly"
        defer { generating = nil }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["weekStart": weekStart])
            _ = try await NativeConnection.shared.authenticatedRequest(path: "/api/native/v1/rollups/generate-weekly", method: "POST", body: body)
            await load()
        } catch { failedAction = .weekly; self.error = "Your weekly review was not created. " + error.localizedDescription }
    }
}

private struct NativeCommitmentRow: Identifiable {
    enum Status: Equatable { case open, done, letGo }

    let conversationID: String
    let conversationTitle: String
    let date: Date
    let commitment: NativeCommitment
    var status: Status

    var id: String { "\(conversationID):\(commitment.key)" }
    var ageDays: Int { max(0, Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: date), to: Calendar.current.startOfDay(for: .now)).day ?? 0) }
}

@MainActor
@Observable
private final class NativeCommitmentsModel {
    var rows: [NativeCommitmentRow] = []
    var isLoading = false
    var updating = Set<String>()
    var error: String?

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let data = try await NativeConnection.shared.authenticatedData(path: "/api/native/v1/commitments")
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let envelope = try decoder.decode(NativeCommitmentsEnvelope.self, from: data)
            let now = Date()
            rows = envelope.analyses.flatMap { conversationID, stored -> [NativeCommitmentRow] in
                let sourceDate = stored.date ?? stored.timestamp ?? ""
                let date = ISO8601DateFormatter.withFractionalSeconds.date(from: sourceDate)
                    ?? ISO8601DateFormatter().date(from: sourceDate)
                    ?? now
                let done = Set(stored.doneKeys ?? [])
                let letGo = Set(stored.letGoKeys ?? [])
                return stored.analysis.commitments.map { commitment in
                    NativeCommitmentRow(
                        conversationID: conversationID,
                        conversationTitle: stored.title,
                        date: date,
                        commitment: commitment,
                        status: done.contains(commitment.key) ? .done : (letGo.contains(commitment.key) ? .letGo : .open)
                    )
                }
            }.sorted {
                if $0.status != $1.status { return Self.rank($0.status) < Self.rank($1.status) }
                if $0.ageDays != $1.ageDays { return $0.ageDays > $1.ageDays }
                return $0.commitment.who.localizedCaseInsensitiveCompare($1.commitment.who) == .orderedAscending
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func setStatus(_ status: NativeCommitmentRow.Status, for row: NativeCommitmentRow) async {
        guard updating.insert(row.id).inserted else { return }
        defer { updating.remove(row.id) }
        let statusValue: String
        switch status {
        case .open: statusValue = "open"
        case .done: statusValue = "done"
        case .letGo: statusValue = "let_go"
        }
        do {
            let body = try JSONSerialization.data(withJSONObject: [
                "conversationId": row.conversationID,
                "key": row.commitment.key,
                "status": statusValue
            ])
            _ = try await NativeConnection.shared.authenticatedRequest(
                path: "/api/native/v1/commitments",
                method: "PATCH",
                body: body
            )
            guard let index = rows.firstIndex(where: { $0.id == row.id }) else { return }
            rows[index].status = status
            rows.sort {
                if $0.status != $1.status { return Self.rank($0.status) < Self.rank($1.status) }
                if $0.ageDays != $1.ageDays { return $0.ageDays > $1.ageDays }
                return $0.commitment.who.localizedCaseInsensitiveCompare($1.commitment.who) == .orderedAscending
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private static func rank(_ status: NativeCommitmentRow.Status) -> Int {
        switch status { case .open: 0; case .done: 1; case .letGo: 2 }
    }
}

struct NativeCommitmentsView: View {
    @State private var model = NativeCommitmentsModel()
    @State private var rollups = NativeRollupsModel()
    @State private var connection = NativeConnection.shared
    @State private var showResolved = false
    @State private var navigation = TRACEAppNavigation.shared
    @State private var showingSettings = false

    private var visibleRows: [NativeCommitmentRow] {
        showResolved ? model.rows : model.rows.filter { $0.status == .open }
    }

    var body: some View {
        NavigationStack {
            Group {
                if !connection.enrolled {
                    ContentUnavailableView("Connect TRACE", systemImage: "lock.shield", description: Text("Enroll this iPhone in Settings to load your commitments."))
                } else if model.isLoading && model.rows.isEmpty {
                    ProgressView("Loading commitments…")
                } else if model.rows.isEmpty && model.error == nil && rollups.error == nil && rollups.value?.daily == nil && rollups.value?.weekly == nil && !rollups.isLoading {
                    ContentUnavailableView {
                        Label("No commitments yet", systemImage: "checklist")
                    } description: {
                        Text("Open a saved conversation and run ADHD Aid to bring its commitments into Today.")
                    } actions: {
                        Button("Choose a conversation") { navigation.selectedTab = .conversations }
                    }
                } else {
                    List {
                        Section("Open commitments") {
                            if let error = model.error {
                                Text("Could not update commitments. " + error).foregroundStyle(.red)
                                Button("Retry commitments") { Task { await model.load() } }
                            }
                            if visibleRows.isEmpty {
                                Text("No open commitments. You can review completed commitments below.").foregroundStyle(.secondary)
                            }
                            ForEach(visibleRows) { row in commitmentRow(row) }
                        }
                        if let error = rollups.error {
                            Section("Planning needs attention") {
                                Text(error).foregroundStyle(.red).accessibilityIdentifier("trace.today.rollupError")
                                Button("Retry planning action") { Task { await rollups.retry() } }
                                    .disabled(rollups.isLoading || rollups.generating != nil || !rollups.updatingPlanSteps.isEmpty)
                            }
                        }
                        if rollups.value == nil && !rollups.isLoading {
                            Section { Text("Load your planning data before creating a review.").foregroundStyle(.secondary) }
                        }
                        if let daily = rollups.value?.daily {
                            tomorrowPlan(daily)
                            dailyRollup(daily)
                        } else if !rollups.isLoading {
                            Section("Review today and plan tomorrow") {
                                Text("Create a review from your saved conversations and commitments.").foregroundStyle(.secondary)
                                Button { Task { await rollups.generateDaily() } } label: {
                                    if rollups.generating == "daily" { Label("Creating daily review…", systemImage: "hourglass") }
                                    else { Label("Create daily review", systemImage: "sparkles") }
                                }.disabled(rollups.generating != nil || rollups.value == nil)
                            }
                        }
                        Section("Weekly review") {
                            DisclosureGroup("Review this week") {
                                if let weekly = rollups.value?.weekly {
                                    weeklyRollup(weekly)
                                } else {
                                    Text("No weekly review saved yet.").foregroundStyle(.secondary)
                                    Button { Task { await rollups.generateWeekly() } } label: {
                                        if rollups.generating == "weekly" { Label("Creating weekly review…", systemImage: "hourglass") }
                                        else { Label("Create weekly review", systemImage: "sparkles") }
                                    }.disabled(rollups.generating != nil || rollups.value == nil || rollups.isLoading)
                                }
                            }
                        }
                        Section {
                            DisclosureGroup("Commitment history") {
                                Toggle("Include completed and let go", isOn: $showResolved)
                            }
                            NavigationLink { NativePatternsView() } label: { Label("Planning patterns", systemImage: "chart.bar") }
                        } footer: {
                            Text("Commitment changes sync across your enrolled devices.")
                        }

                    }
                    .refreshable {
                        await model.load()
                        await rollups.load()
                    }
                    .navigationDestination(for: String.self) { id in NativeConversationDetailView(id: id) }
                }
            }
            .traceWorkspace()
            .onChange(of: rollups.error) { _, error in
                if let error, navigation.selectedTab == .today && UIAccessibility.isVoiceOverRunning { UIAccessibility.post(notification: .announcement, argument: error) }
            }
            .navigationTitle("Today")
            .sheet(isPresented: $showingSettings) { NativeSettingsView() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingSettings = true } label: { Image(systemName: "gearshape").accessibilityLabel("Settings") }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task {
                            await model.load()
                            await rollups.load()
                        }
                    } label: { Image(systemName: "arrow.clockwise").accessibilityLabel("Refresh") }
                        .disabled(model.isLoading || rollups.isLoading || !connection.enrolled)
                }
            }
            .task {
                await model.load()
                await rollups.load()
            }
        }
    }

    @ViewBuilder
    private func tomorrowPlan(_ value: NativeStoredRollup) -> some View {
        Section("Plan tomorrow") {
            if let steps = value.rollup.planSteps, !steps.isEmpty {
                VStack(alignment: .leading, spacing: 8) {

                    ForEach(steps) { step in
                        HStack(alignment: .top, spacing: 8) {
                            Button {
                                Task { await rollups.setPlanStep(step.key, done: !(value.planDoneKeys ?? []).contains(step.key)) }
                            } label: {
                                Image(systemName: (value.planDoneKeys ?? []).contains(step.key) ? "checkmark.circle.fill" : "circle")
                                    .frame(minWidth: 44, minHeight: 44)
                                    .contentShape(Rectangle())
                                    .foregroundStyle((value.planDoneKeys ?? []).contains(step.key) ? .green : .secondary)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel((value.planDoneKeys ?? []).contains(step.key) ? "Mark plan step open" : "Mark plan step done")
                            .accessibilityValue((value.planDoneKeys ?? []).contains(step.key) ? "Done" : "Open")
                            .accessibilityHint(step.what)
                            .disabled(rollups.updatingPlanSteps.contains(step.key))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(step.what)
                                let details = [step.when, step.deadline, step.minutes.map { "\($0) min" }].compactMap { $0 }.filter { !$0.isEmpty }
                                if !details.isEmpty { Text(details.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary) }
                            }
                        }
                    }
                }
            } else {
                RollupParagraph(title: "Plan", text: value.rollup.tomorrowPlan)
            }
        }
    }

    private func dailyRollup(_ value: NativeStoredRollup) -> some View {
        Section("Daily review") {
            DisclosureGroup("Review today") {
                RollupParagraph(title: "Today in one paragraph", text: value.rollup.todayParagraph)
                RollupParagraph(title: "Commitments to revisit", text: value.rollup.agingCommitments)
                RollupParagraph(title: "Potential conflicts", text: value.rollup.conflictsAtRisk)
                RollupParagraph(title: "People and commitments", text: value.rollup.socialLedger)
                RollupParagraph(title: "Coming up", text: value.rollup.tomorrowEvents)
                RollupParagraph(title: "Let go today", text: value.rollup.dropped)
            }
        }
    }

    private func weeklyRollup(_ value: NativeStoredWeeklyRollup) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            RollupParagraph(title: "Week summary", text: value.rollup.weekSummary)
            RollupParagraph(title: "Completion pattern", text: value.rollup.completionPattern)
            RollupParagraph(title: "Commitments to revisit", text: value.rollup.chronicallyAging)
            RollupParagraph(title: "Let go this week", text: value.rollup.droppedThisWeek)
            RollupParagraph(title: "People and commitments", text: value.rollup.socialPattern)
            RollupParagraph(title: "Next week setup", text: value.rollup.nextWeekSetup)
        }
    }

    @ViewBuilder
    private func commitmentRow(_ row: NativeCommitmentRow) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(row.commitment.who).font(.headline)
                    Text(row.commitment.what).textSelection(.enabled)
                }
                Spacer(minLength: 8)
                if model.updating.contains(row.id) { ProgressView() }
            }
            Text("\(row.commitment.direction == "other_to_user" ? "Owed to you" : "You owe") · \(row.commitment.deadline)")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Text("\(row.ageDays) day\(row.ageDays == 1 ? "" : "s") old")
                Spacer()
                Menu {
                    Button("Leave open", systemImage: "circle") { Task { await model.setStatus(.open, for: row) } }
                    Button("Mark done", systemImage: "checkmark.circle") { Task { await model.setStatus(.done, for: row) } }
                    Button("Let go", systemImage: "arrow.uturn.backward.circle") { Task { await model.setStatus(.letGo, for: row) } }
                } label: {
                    Label(statusTitle(row.status), systemImage: statusIcon(row.status)).frame(minWidth: 44, minHeight: 44)
                }
                .disabled(model.updating.contains(row.id))
            }
            .font(.caption)
            NavigationLink(value: row.conversationID) {
                Label(row.conversationTitle, systemImage: "text.bubble")
                    .font(.caption).lineLimit(2).frame(minHeight: 44)
            }
        }
        .padding(.vertical, 5)
    }

    private func statusTitle(_ status: NativeCommitmentRow.Status) -> String {
        switch status { case .open: "Open"; case .done: "Done"; case .letGo: "Let go" }
    }

    private func statusIcon(_ status: NativeCommitmentRow.Status) -> String {
        switch status { case .open: "circle"; case .done: "checkmark.circle.fill"; case .letGo: "arrow.uturn.backward.circle" }
    }
}

private struct RollupParagraph: View {
    let title: String
    let text: String
    var body: some View {
        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(text).textSelection(.enabled)
            }.padding(.vertical, 3)
        }
    }
}
