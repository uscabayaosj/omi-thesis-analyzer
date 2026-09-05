import SwiftUI

struct StatusView: View {
    @State private var coordinator = CaptureCoordinator.shared
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    heroCard
                    muteButton
                    Text("The pendant keeps transmitting; while muted, its audio is dropped here and never written or uploaded.")
                        .font(.footnote)
                        .foregroundStyle(Theme.graphite)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 4)
                    conversationCard
                    uploadsCard
                    if !CaptureSettings.isConfigured { setupCard }
                }
                .padding(16)
            }
            .background(Theme.night.ignoresSafeArea())
            .navigationTitle("TRACE Capture")
            .toolbar {
                Button("Settings", systemImage: "gearshape") { showSettings = true }
            }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .onAppear { coordinator.start() }
        }
        .tint(Theme.copper)
        .preferredColorScheme(.dark)
    }

    // MARK: Hero

    /// What the screen is *for*: one line that answers "is it listening?"
    /// Mute wins over everything — a muted relay is muted whatever the radio
    /// is doing — then the pendant's connection text maps onto four states.
    private enum Hero {
        case listening, muted, disconnected, noPendant, bluetoothOff

        var title: String {
            switch self {
            case .listening: "Listening"
            case .muted: "Muted"
            case .disconnected: "Disconnected"
            case .noPendant: "No pendant"
            case .bluetoothOff: "Bluetooth off"
            }
        }

        var dot: Color {
            switch self {
            case .listening: Theme.sage
            case .muted: Theme.copperLight
            case .disconnected, .noPendant, .bluetoothOff: Theme.clay
            }
        }
    }

    private var hero: Hero {
        if coordinator.muted { return .muted }
        let c = coordinator.connection
        if c == "Connected" { return .listening }
        if c.contains("No pendant") { return .noPendant }
        if c.contains("Bluetooth") { return .bluetoothOff }
        return .disconnected
    }

    private var heroDetail: String {
        switch hero {
        case .listening: "\(coordinator.framesThisChunk) frames in this chunk"
        case .muted: "Nothing is being recorded · pendant: \(coordinator.connection)"
        case .noPendant: "Pair your Omi pendant in Settings."
        case .bluetoothOff: "Turn Bluetooth on to reach the pendant."
        case .disconnected: coordinator.connection
        }
    }

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Circle()
                    .fill(hero.dot)
                    .frame(width: 12, height: 12)
                    .offset(y: -2)
                Text(hero.title)
                    .font(.system(.largeTitle, design: .serif, weight: .bold))
                    .foregroundStyle(Theme.paper)
                Spacer()
                if let b = coordinator.battery {
                    Label("\(b)%", systemImage: batterySymbol(b))
                        .font(.system(.subheadline, design: .monospaced))
                        .foregroundStyle(b <= 15 ? Theme.clay : Theme.graphite)
                }
            }
            Text(heroDetail)
                .font(.subheadline)
                .foregroundStyle(Theme.graphite)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 12))
    }

    private func batterySymbol(_ level: Int) -> String {
        switch level {
        case ..<10: "battery.0percent"
        case ..<35: "battery.25percent"
        case ..<60: "battery.50percent"
        case ..<85: "battery.75percent"
        default: "battery.100percent"
        }
    }

    // MARK: Mute

    /// The primary control. Two treatments that can't be confused at a
    /// pocket-glance: copper fill to mute, hollow copper outline while muted.
    private var muteButton: some View {
        let muted = coordinator.muted
        return Button {
            coordinator.setMuted(!muted)
        } label: {
            Label(muted ? "Muted — tap to resume" : "Mute",
                  systemImage: muted ? "mic.slash.fill" : "mic.fill")
                .font(.headline)
                .frame(maxWidth: .infinity)
                .frame(minHeight: 52)
        }
        .foregroundStyle(muted ? Theme.copperLight : Color(hex: 0x020617))
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(muted ? Theme.panel : Theme.copper)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Theme.copper, lineWidth: muted ? 2 : 0)
        )
        .disabled(hero == .noPendant)
        .accessibilityLabel(muted ? "Muted. Double-tap to resume recording." : "Mute recording")
    }

    // MARK: Cards

    private var conversationCard: some View {
        card("Conversation") {
            Text("A conversation ends on its own after ninety quiet seconds. End it now to transcribe what you have.")
                .font(.footnote)
                .foregroundStyle(Theme.graphite)
            Button("End conversation now") { coordinator.endConversation() }
                .frame(minHeight: 44)
                .disabled(coordinator.muted)
            if let n = coordinator.endNote {
                Text(n).font(.footnote).foregroundStyle(Theme.graphite)
            }
        }
    }

    private var uploadsCard: some View {
        card("Uploads") {
            row("Waiting to upload", coordinator.pending == 0 ? "none" : "\(coordinator.pending) chunks")
            row("Last upload", coordinator.lastUpload.map { $0.formatted(date: .omitted, time: .shortened) } ?? "not yet")
            if let e = coordinator.lastError {
                Text(e).font(.footnote).foregroundStyle(Theme.clay)
            }
        }
    }

    private var setupCard: some View {
        card("Set up") {
            Text("Add the TRACE address and token to start uploading.")
                .font(.footnote)
                .foregroundStyle(Theme.graphite)
            Button("Open Settings") { showSettings = true }
                .frame(minHeight: 44)
        }
    }

    private func card<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title.uppercased())
                .font(.system(.caption2, design: .monospaced, weight: .medium))
                .tracking(1.5)
                .foregroundStyle(Theme.graphite)
            content()
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 12))
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(Theme.paper)
            Spacer()
            Text(value)
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(Theme.graphite)
        }
        .font(.subheadline)
        .frame(minHeight: 28)
    }
}
