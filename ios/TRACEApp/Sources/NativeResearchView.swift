import SwiftUI

struct NativeResearchView: View {
    var body: some View {
        NavigationStack {
            List {
                Text("Explore saved analyses and inspect the sources behind your research.").font(.subheadline).foregroundStyle(.secondary).listRowBackground(Color.clear)
                Section("Explore") {
                    NavigationLink { NativeSearchView() } label: {
                        TRACEToolRow(title: "Search", subtitle: "Find text in saved analyses", symbol: "magnifyingglass")
                    }
                    NavigationLink { NativeAskView() } label: {
                        TRACEToolRow(title: "Ask saved analyses", subtitle: "Get answers grounded in your research", symbol: "bubble.left.and.bubble.right")
                    }
                    NavigationLink { NativeGroupAnalysisView() } label: {
                        TRACEToolRow(title: "Group analysis", subtitle: "Bring related conversations together", symbol: "square.stack.3d.up")
                    }
                }
                Section("Qualitative research") {
                    NavigationLink { NativeCodebookView() } label: {
                        TRACEToolRow(title: "Codebook", subtitle: "Organize your research themes", symbol: "books.vertical")
                    }
                }
                Section("Personal planning") {
                    NavigationLink { NativePatternsView() } label: {
                        TRACEToolRow(title: "Patterns", subtitle: "Review commitments and daily plans", symbol: "chart.bar")
                    }
                }
            }
            .traceWorkspace()
            .navigationTitle("Research")
        }
    }
}
