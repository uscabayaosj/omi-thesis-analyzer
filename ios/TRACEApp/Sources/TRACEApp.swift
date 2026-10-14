import SwiftUI
import UIKit
import UserNotifications

enum TRACETab: Hashable {
    case conversations, capture, today, research, people
}

@MainActor
@Observable
final class TRACEAppNavigation {
    static let shared = TRACEAppNavigation()
    var selectedTab: TRACETab = .conversations
}


@MainActor
final class TRACEAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        #if DEBUG
        if !NativeUIFixtures.isActive { CaptureModel.shared.start() }
        #else
        Task { @MainActor in
            await NativeConnection.shared.importOperatorInstallationIfPresent()
            CaptureModel.shared.start()
        }
        #endif
        #if DEBUG
        // Physical provider tests supply credentials at runtime; none are bundled.
        let environment = ProcessInfo.processInfo.environment
        if ProcessInfo.processInfo.arguments.contains("--trace-provider-test"),
           let server = environment["TRACE_TEST_SERVER"],
           let secret = environment["TRACE_TEST_ENROLLMENT_SECRET"] {
            Task { @MainActor in
                if NativeConnection.shared.enrolled {
                    do {
                        try NativeConnection.shared.saveServerURL(server)
                        await NativeConnection.shared.refreshStatus()
                    } catch {
                        NativeConnection.shared.errorMessage = error.localizedDescription
                    }
                    return
                }
                await NativeConnection.shared.enroll(server: server, label: "Physical TRACE provider test", bootstrapSecret: secret)
            }
        }
        #endif
        return true
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
              let route = response.notification.request.content.userInfo["route"] as? String,
              route == "today" || route == "capture" else { return }
        await MainActor.run {
            TRACEAppNavigation.shared.selectedTab = route == "capture" ? .capture : .today
        }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

}

@main
struct TRACEApp: App {
    @UIApplicationDelegateAdaptor(TRACEAppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var model = CaptureModel.shared
    @State private var navigation = TRACEAppNavigation.shared

    var body: some Scene {
        WindowGroup {
            #if DEBUG
            if NativeUIFixtures.isActive {
                mainTabs.tint(TRACEStyle.accent).preferredColorScheme(ProcessInfo.processInfo.arguments.contains("--trace-ui-dark") ? .dark : .light)
            } else { mainTabs.tint(TRACEStyle.accent) }
            #else
            mainTabs.tint(TRACEStyle.accent)
            #endif
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            // SwiftUI owns the scene lifecycle. App-delegate active callbacks
            // do not reliably run for scene-based apps, leaving telemetry muted.
            model.setForegroundUI(phase == .active)
            if phase == .active { ConversationAudioLibrary.shared.resume() }
        }
    }

    private var mainTabs: some View {
            TabView(selection: $navigation.selectedTab) {
                NativeConversationsView()
                    .tabItem { Label("Conversations", systemImage: "text.bubble") }
                    .tag(TRACETab.conversations)
                CaptureView(model: model)
                    .tabItem { Label("Capture", systemImage: "waveform") }
                    .tag(TRACETab.capture)
                NativeCommitmentsView()
                    .tabItem { Label("Today", systemImage: "checklist") }
                    .tag(TRACETab.today)
                NativeResearchView()
                    .tabItem { Label("Research", systemImage: "books.vertical") }
                    .tag(TRACETab.research)
                NativePeopleView()
                    .tabItem { Label("People", systemImage: "person.2") }
                    .tag(TRACETab.people)
            }
        }
}
