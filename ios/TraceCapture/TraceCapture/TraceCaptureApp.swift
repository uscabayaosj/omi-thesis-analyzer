import SwiftUI
import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Both relaunch paths (BLE restoration, background session events) need the
        // coordinator alive before any delegate callback arrives.
        CaptureCoordinator.shared.start()
        return true
    }

    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        UploadQueue.shared.backgroundCompletion = completionHandler
        UploadQueue.shared.retryPending()
    }
}

@main
struct TraceCaptureApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup { StatusView() }
    }
}
