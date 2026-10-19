import SwiftUI

/// Shared, semantic styling keeps every workspace readable in light and dark mode.
enum TRACEStyle {
    static let accent = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.48, green: 0.76, blue: 0.85, alpha: 1)
            : UIColor(red: 0.13, green: 0.37, blue: 0.43, alpha: 1)
    })
    static let canvas = Color(uiColor: .systemGroupedBackground)
}

extension View {
    func traceWorkspace() -> some View {
        self.listStyle(.insetGrouped)
            .listSectionSpacing(18)
            .scrollContentBackground(.hidden)
            .background(TRACEStyle.canvas)
            .environment(\.defaultMinListRowHeight, 52)
    }
}

struct TRACEIntroduction: View {
    let eyebrow: String
    let title: String
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(eyebrow.uppercased())
                .font(.caption.weight(.semibold)).tracking(1.5)
                .foregroundStyle(TRACEStyle.accent)
            Text(title).font(.title2.weight(.semibold))
            Text(message).font(.subheadline).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 8)
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }
}

struct TRACEToolRow: View {
    let title: String
    let subtitle: String
    let symbol: String
    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: symbol).font(.title3)
                .foregroundStyle(TRACEStyle.accent)
                .frame(width: 42, height: 42)
                .background(TRACEStyle.accent.opacity(0.09), in: RoundedRectangle(cornerRadius: 12))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.body.weight(.medium))
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
            .padding(.vertical, 5)
        }
    }
}

struct TRACEPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.headline)
            .frame(maxWidth: .infinity, minHeight: 52)
            .foregroundStyle(Color(uiColor: .systemBackground))
            .background(TRACEStyle.accent, in: RoundedRectangle(cornerRadius: 16))
            .opacity(configuration.isPressed ? 0.75 : 1)
    }
}
