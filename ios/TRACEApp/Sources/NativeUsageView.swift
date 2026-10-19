import Foundation
import SwiftUI

private struct NativeUsagePeriod: Decodable {
    let costUsd: Double?
    let callCount: Int
    let promptTokens: Int
    let completionTokens: Int
    let unpricedCallCount: Int?
    let cacheDetailMissingCallCount: Int?
}

private struct NativeUsageBreakdown: Decodable, Identifiable {
    let key: String
    let costUsd: Double?
    let callCount: Int
    let unpricedCallCount: Int?
    var id: String { key }
}

private struct NativePricingSource: Decodable, Identifiable {
    let name: String
    let url: String
    var id: String { url }
}
private struct NativePricingInfo: Decodable {
    let checkedAt: String
    let note: String
    let sources: [NativePricingSource]
}

private struct NativeUsageSummary: Decodable {
    let pricing: NativePricingInfo?
    let configured: Bool
    let today: NativeUsagePeriod
    let thisWeek: NativeUsagePeriod
    let thisMonth: NativeUsagePeriod
    let byLabel: [NativeUsageBreakdown]
    let byModel: [NativeUsageBreakdown]
}

struct NativeUsageView: View {
    @State private var timezone = UserDefaults.standard.string(forKey: "trace.usageTimezone") ?? "manila"
    @State private var summary: NativeUsageSummary?
    @State private var isLoading = false
    @State private var loadGeneration = UUID()
    @State private var error: String?

    var body: some View {
        List {
            Section("Reporting time zone") {
                Picker("Time zone", selection: $timezone) {
                    Text("Manila").tag("manila")
                    Text("London").tag("london")
                    Text("Phoenix").tag("phoenix")
                }
                .pickerStyle(.segmented)
                .onChange(of: timezone) { _, value in UserDefaults.standard.set(value, forKey: "trace.usageTimezone") }
            }
            if let summary {
                Section("Estimated AI spend and calls") {
                    periodRow("Today", summary.today)
                    periodRow("This week", summary.thisWeek)
                    periodRow("This month", summary.thisMonth)
                    if !summary.configured { Text("Server usage storage is not configured.").font(.footnote).foregroundStyle(.secondary) }
                }
                if !summary.byLabel.isEmpty {
                    Section("By feature this month") {
                        ForEach(summary.byLabel) { breakdown($0, feature: true) }
                    }
                }
                if !summary.byModel.isEmpty {
                    Section("By model this month") {
                        ForEach(summary.byModel) { breakdown($0) }
                    }
                }
                if let pricing = summary.pricing {
                    Section("Pricing sources") {
                        Text("Rates checked \(pricing.checkedAt)").font(.subheadline)
                        Text(pricing.note).font(.footnote).foregroundStyle(.secondary)
                        ForEach(pricing.sources) { source in
                            if let url = URL(string: source.url) { Link(source.name, destination: url) }
                        }
                    }
                }
            } else if isLoading {
                ProgressView("Loading usage…")
            }
            if let error { Text(error).foregroundStyle(.red) }
        }
        .navigationTitle("Usage")
        .navigationBarTitleDisplayMode(.inline)
        .traceWorkspace()
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { Task { await load() } } label: { Image(systemName: "arrow.clockwise").accessibilityLabel("Refresh") }.disabled(isLoading) } }
        .task(id: timezone) { await load() }
        .refreshable { await load() }
    }

    @ViewBuilder
    private func periodRow(_ title: String, _ value: NativeUsagePeriod) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(title)
                Spacer()
                Text(value.costUsd.map { costLabel($0) } ?? "Price unavailable")
                    .fontWeight(.semibold).monospacedDigit()
            }
            Text("\(value.callCount) \(value.callCount == 1 ? "call" : "calls") · \(value.promptTokens.formatted()) input · \(value.completionTokens.formatted()) output tokens")
                .font(.caption).foregroundStyle(.secondary)
            if let count = value.unpricedCallCount, count > 0 {
                Text("\(count) calls could not be priced; excluded from this estimate.").font(.caption).foregroundStyle(.secondary)
            }
            if let count = value.cacheDetailMissingCallCount, count > 0 {
                Text("\(count) older calls lack cache detail; priced at uncached rates.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func breakdown(_ value: NativeUsageBreakdown, feature: Bool = false) -> some View {
        HStack {
            Text(feature ? featureName(value.key) : value.key)
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(value.costUsd.map { costLabel($0) } ?? "Price unavailable").monospacedDigit()
                Text("\(value.callCount) \(value.callCount == 1 ? "call" : "calls")").font(.caption).foregroundStyle(.secondary)
                if let count = value.unpricedCallCount, count > 0 {
                    Text("\(count) unpriced").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func costLabel(_ cost: Double) -> String {
        if cost > 0 && cost < 0.0001 { return "< US$0.0001" }
        return cost.formatted(.currency(code: "USD").precision(.fractionLength(2...4)))
    }

    private func featureName(_ key: String) -> String {
        ["adhd": "ADHD Aid", "thesis": "Research analysis", "thesis-ask": "Ask saved analyses", "group-custom": "Custom group question", "group": "Group analysis", "custom": "Custom research question", "conversation-summary": "Conversation summary", "daily-rollup": "Daily review", "weekly-rollup": "Weekly review" ][key] ?? key.replacingOccurrences(of: "-", with: " ").capitalized
    }

    private func load() async {
        let requestedTimezone = timezone
        let run = UUID(); loadGeneration = run
        isLoading = true
        defer { if loadGeneration == run { isLoading = false } }
        do {
            let data = try await NativeConnection.shared.authenticatedData(
                path: "/api/native/v1/usage", queryItems: [URLQueryItem(name: "tz", value: requestedTimezone)]
            )
            guard loadGeneration == run, timezone == requestedTimezone, !Task.isCancelled else { return }
            summary = try JSONDecoder().decode(NativeUsageSummary.self, from: data)
            error = nil
        } catch { if loadGeneration == run, !Task.isCancelled { self.error = error.localizedDescription } }
    }
}
