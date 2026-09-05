import SwiftUI
import CoreBluetooth

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var baseURL = CaptureSettings.baseURL?.absoluteString ?? "https://omi-thesis-analyzer.vercel.app"
    @State private var token = CaptureSettings.ingestToken ?? ""
    @State private var found: [CBPeripheral] = []
    @State private var scanning = false

    var body: some View {
        NavigationStack {
            Form {
                Section("TRACE") {
                    TextField("Base URL", text: $baseURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Ingest token", text: $token)
                }
                Section("Pendant") {
                    if let id = CaptureSettings.peripheralId {
                        Text("Paired: \(id.uuidString.prefix(8))…").font(.footnote.monospaced())
                    }
                    Button(scanning ? "Looking…" : "Find pendant") {
                        scanning = true
                        found = []
                        PendantConnection.shared.startScan { p in
                            if !found.contains(where: { $0.identifier == p.identifier }) { found.append(p) }
                        }
                    }
                    ForEach(found, id: \.identifier) { p in
                        Button(p.name ?? p.identifier.uuidString) {
                            PendantConnection.shared.pair(p)
                            scanning = false
                        }
                    }
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        CaptureSettings.baseURL = URL(string: baseURL.trimmingCharacters(in: .whitespaces))
                        CaptureSettings.ingestToken = token.trimmingCharacters(in: .whitespaces)
                        UploadQueue.shared.retryPending()
                        dismiss()
                    }
                }
            }
        }
    }
}
