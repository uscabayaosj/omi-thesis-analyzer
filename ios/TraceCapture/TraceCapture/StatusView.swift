import SwiftUI

struct StatusView: View {
    @State private var coordinator = CaptureCoordinator.shared
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            List {
                Section("Pendant") {
                    LabeledContent("Connection", value: coordinator.connection)
                    if let b = coordinator.battery { LabeledContent("Battery", value: "\(b)%") }
                    LabeledContent("This chunk", value: "\(coordinator.framesThisChunk) frames")
                }
                Section("Uploads") {
                    LabeledContent("Waiting to upload", value: coordinator.pending == 0 ? "none" : "\(coordinator.pending) chunks")
                    LabeledContent("Last upload", value: coordinator.lastUpload.map { $0.formatted(date: .omitted, time: .shortened) } ?? "not yet")
                    if let e = coordinator.lastError { Text(e).foregroundStyle(.orange) }
                }
                if !CaptureSettings.isConfigured {
                    Section { Text("Add the TRACE address and token in Settings to start uploading.") }
                }
            }
            .navigationTitle("TRACE Capture")
            .toolbar { Button("Settings") { showSettings = true } }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .onAppear { coordinator.start() }
        }
    }
}
