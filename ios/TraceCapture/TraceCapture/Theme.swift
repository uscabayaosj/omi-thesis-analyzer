import SwiftUI

/// The web app's field-journal palette (DESIGN.md), so the relay reads as the
/// same object: one dark surface family, one copper accent, warmth only where
/// it is earned.
enum Theme {
    static let leather = Color(hex: 0x2a1c10)      // brand-leather
    static let night = Color(hex: 0x161311)        // night-pasture
    static let panel = Color(hex: 0x221c17)        // ink-panel
    static let panelRaised = Color(hex: 0x2e261e)  // ink-panel-raised
    static let copper = Color(hex: 0xb96d33)
    static let copperLight = Color(hex: 0xd99a5e)
    static let paper = Color(hex: 0xf6f1e7)        // lamp-paper
    static let graphite = Color(hex: 0xa89a88)
    static let sage = Color(hex: 0xa9bd8f)
    static let clay = Color(hex: 0xe98d72)
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255
        )
    }
}
