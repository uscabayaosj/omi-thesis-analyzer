import XCTest

/// Opt-in real provider test. Runtime credentials come from a private local xctestrun file.
@MainActor
final class PhysicalProviderTests: XCTestCase {
    private var diagnosticsExpanded = false
    func testPoweredOffPendantDeliversNoAudio() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        diagnosticsExpanded = false
        defer { app.terminate(); app.launch() }
        XCTAssertTrue(app.tabBars.buttons["Capture"].firstMatch.waitForExistence(timeout: 20))
        app.tabBars.buttons["Capture"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let disconnected = NSPredicate { _, _ in
            let connection = self.element(app, "trace.capture.connection")
            return connection.exists && !connection.label.contains("Connected")
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: disconnected, object: nil)], timeout: 20), .completed)
        tapCaptureControl("Resume capture", app: app)
        XCTAssertEqual(count(element(app, "trace.capture.frames")), 0)
        Thread.sleep(forTimeInterval: 20)
        XCTAssertEqual(count(element(app, "trace.capture.frames")), 0, "A powered-off pendant must deliver no BLE audio")
        XCTAssertFalse(element(app, "trace.capture.connection").label.contains("Connected"))
        tapCaptureControl("Pause capture", app: app)
        XCTAssertTrue(element(app, "trace.capture.mode").label.contains("Paused"))
        let proof = XCTAttachment(screenshot: app.screenshot())
        proof.name = "TRACE powered-off pendant with no audio"
        proof.lifetime = .keepAlways
        add(proof)
    }

    func testPrivacyDisclosure() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        diagnosticsExpanded = false
        XCTAssertTrue(app.buttons["trace.settings"].waitForExistence(timeout: 20))
        app.buttons["trace.settings"].tap()
        let privacy = app.buttons["trace.settings.privacy"]
        XCTAssertTrue(privacy.waitForExistence(timeout: 10))
        privacy.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Capture starts paused")).firstMatch.waitForExistence(timeout: 10))
        let proof = XCTAttachment(screenshot: app.screenshot())
        proof.name = "TRACE privacy and recording"
        proof.lifetime = .keepAlways
        add(proof)
        let shared = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "one shared personal workspace")).firstMatch
        for _ in 0..<8 {
            if shared.exists && shared.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(shared.exists)
        XCTAssertTrue(shared.isHittable)
    }

    func testWorkspaceRedesign() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        diagnosticsExpanded = false
        XCTAssertTrue(app.tabBars.buttons["Conversations"].firstMatch.waitForExistence(timeout: 20))
        func snapshot(_ name: String) {
            let image = XCTAttachment(screenshot: app.screenshot())
            image.name = name
            image.lifetime = .keepAlways
            add(image)
        }
        snapshot("TRACE conversation library")
        if let id = ProcessInfo.processInfo.environment["TRACE_TEST_CONVERSATION_ID"] {
            let row = element(app, "trace.conversation.\(id)")
            XCTAssertTrue(row.waitForExistence(timeout: 20))
            row.tap()
            XCTAssertTrue(app.staticTexts["Overview"].waitForExistence(timeout: 15))
            snapshot("TRACE conversation summary")
            app.segmentedControls.buttons["Transcript"].tap()
            XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Maria")).firstMatch.waitForExistence(timeout: 10))
            snapshot("TRACE conversation transcript")
        }
        app.tabBars.buttons["Capture"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.buttons["Resume capture"].waitForExistence(timeout: 10))
        snapshot("TRACE capture paused")
        app.swipeUp()
        app.swipeUp()
        let details = app.buttons["Recording details"]
        for _ in 0..<8 {
            if details.exists && details.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(details.waitForExistence(timeout: 10))
        details.tap()
        app.swipeUp()
        // The simulator has no recorded chunks; its collapsed counter section still exposes zero.
        let frames = element(app, "trace.capture.frames")
        XCTAssertTrue(frames.waitForExistence(timeout: 10))
        snapshot("TRACE recording details")
        let savedAudio = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Saved audio ·")).firstMatch
        for _ in 0..<8 {
            if savedAudio.exists && savedAudio.isHittable { break }
            app.swipeDown()
        }
        XCTAssertTrue(savedAudio.exists)
        savedAudio.tap()
        #if !targetEnvironment(simulator)
        XCTAssertTrue(app.buttons["Play"].firstMatch.waitForExistence(timeout: 10))
        #endif
        snapshot("TRACE saved audio controls")
        savedAudio.tap()
        app.tabBars.buttons["Research"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.staticTexts["From conversation to insight."].waitForExistence(timeout: 10))
        snapshot("TRACE research")
        app.tabBars.buttons["Today"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        snapshot("TRACE today")
        app.tabBars.buttons["People"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        snapshot("TRACE people")
        app.tabBars.buttons["Capture"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        for _ in 0..<8 {
            if app.buttons["Resume capture"].exists && app.buttons["Resume capture"].isHittable { break }
            app.swipeDown()
        }
        XCTAssertTrue(app.buttons["Resume capture"].exists, "Walkthrough must leave capture paused")
    }

    func testSavedAutomaticConversationSummary() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let id = environment["TRACE_TEST_CONVERSATION_ID"] else {
            throw XCTSkip("Provide a verified saved conversation id for this readback test.")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        diagnosticsExpanded = false
        XCTAssertTrue(app.tabBars.buttons["Conversations"].firstMatch.waitForExistence(timeout: 15))
        app.tabBars.buttons["Conversations"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        app.buttons["trace.conversations.refresh"].tap()
        let row = element(app, "trace.conversation.\(id)")
        XCTAssertTrue(row.waitForExistence(timeout: 20))
        row.tap()
        XCTAssertTrue(app.staticTexts["Overview"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Maria")).firstMatch.exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Verified automatic conversation summary"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testPhysicalLiveTranscriptAndDurableConversation() throws {
        try exerciseCapture(backgroundSeconds: 0)
    }

    func testPersonalReleaseLiveCapture() throws {
        try exerciseCapture(backgroundSeconds: 0, releaseInstallation: true)
    }

    func testPersonalReleaseLockedFiveMinuteCapture() throws {
        try exerciseCapture(backgroundSeconds: 300, releaseInstallation: true)
    }

    func testPersonalReleasePowerCycle() throws {
        try exerciseCapture(backgroundSeconds: 0, powerCycle: true, releaseInstallation: true)
    }

    func testPersonalReleaseNetworkRecovery() throws {
        try exerciseCapture(backgroundSeconds: 0, networkOutage: true, releaseInstallation: true)
    }

    /// Host independently verifies local chunk growth, process identity, queue drain,
    /// and provider readback. Keep controls visible; avoid counters below long text.
    func testPersonalReleaseContinuousNetworkRecovery() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Capture"].firstMatch.waitForExistence(timeout: 20))
        app.tabBars.buttons["Capture"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.buttons["Resume capture"].waitForExistence(timeout: 15))
        app.buttons["Resume capture"].tap()
        Thread.sleep(forTimeInterval: 25)
        print("TRACE DEVICE CHECK: READY FOR INTERNET OFF")
        let offline = NSPredicate { _, _ in
            let error = app.staticTexts["trace.capture.error"]
            return error.exists && error.label.hasPrefix("Audio upload is queued for retry:")
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: offline, object: nil)], timeout: 600), .completed)
        print("TRACE DEVICE CHECK: OFFLINE SPEECH")
        Thread.sleep(forTimeInterval: 40)
        // Scroll to the top independent of the accumulated transcript length.
        for _ in 0..<30 {
            if app.buttons["Finish conversation"].exists && app.buttons["Finish conversation"].isHittable { break }
            app.swipeDown(velocity: .fast)
        }
        XCTAssertTrue(app.buttons["Finish conversation"].isHittable)
        app.buttons["Finish conversation"].tap()
        XCTAssertTrue(app.buttons["Resume capture"].waitForExistence(timeout: 10))
        print("TRACE DEVICE CHECK: READY FOR INTERNET ON")
        let recovered = NSPredicate { _, _ in
            let error = app.staticTexts["trace.capture.error"]
            return !error.exists
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: recovered, object: nil)], timeout: 600), .completed)
        print("TRACE DEVICE CHECK: NETWORK RECOVERED SAME RUN")
        // Allow the host to verify the same live app process and durable summary
        // before XCTest teardown, which may relaunch the target application.
        Thread.sleep(forTimeInterval: 120)
        XCTAssertTrue(app.buttons["Resume capture"].exists)
    }

    func testPersonalReleaseReadLockedRecording() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.activate()
        diagnosticsExpanded = false
        XCTAssertTrue(app.tabBars.buttons["Capture"].firstMatch.waitForExistence(timeout: 20))
        app.tabBars.buttons["Capture"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let frames = count(element(app, "trace.capture.frames"))
        print("TRACE DEVICE CHECK: LOCKED READBACK frames=\(frames)")
        XCTAssertGreaterThanOrEqual(frames, 25_520, "The original run must retain at least 21,000 frames after its 4,520-frame background baseline")
        let live = element(app, "trace.capture.live.final")
        XCTAssertTrue(live.exists && live.label.localizedCaseInsensitiveContains("Maria"))
        let evidence = XCTAttachment(screenshot: app.screenshot())
        evidence.name = "Release locked recording retained live text and audio"
        evidence.lifetime = .keepAlways; add(evidence)
        tapCaptureControl("Finish conversation", app: app)
        let saved = NSPredicate { _, _ in self.element(app, "trace.capture.status").label.contains("Conversation and summary saved") }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: saved, object: nil)], timeout: 120), .completed)
        XCTAssertTrue(element(app, "trace.capture.mode").label.contains("Paused"))
        let drained = NSPredicate { _, _ in self.count(self.element(app, "trace.capture.uploads")) == 0 }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: drained, object: nil)], timeout: 30), .completed)
        let summary = XCTAttachment(screenshot: app.screenshot())
        summary.name = "Release background recording transcript and summary saved"
        summary.lifetime = .keepAlways; add(summary)
    }

    func testPersonalIconOnHomeScreen() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        XCUIDevice.shared.press(.home)
        XCUIDevice.shared.press(.home)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let icons = springboard.icons.matching(identifier: "TRACE")
        XCTAssertTrue(icons.firstMatch.waitForExistence(timeout: 15))
        var sawVisibleTRACE = false
        for _ in 0..<5 {
            if icons.allElementsBoundByIndex.contains(where: { $0.isHittable }) {
                sawVisibleTRACE = true
                let proof = XCTAttachment(screenshot: springboard.screenshot())
                proof.name = "TRACE Home screen candidate page"
                proof.lifetime = .keepAlways
                add(proof)
            }
            springboard.swipeLeft()
        }
        XCTAssertTrue(sawVisibleTRACE, "Capture every visible TRACE candidate; a web shortcut may have the same label")
        app.activate()
    }

    func testBackgroundCaptureAndDurableConversation() throws {
        try exerciseCapture(backgroundSeconds: 45)
    }

    func testUnattendedCaptureAndDurableConversation() throws {
        try exerciseCapture(backgroundSeconds: 300)
    }

    func testTenMinuteUnattendedCapture() throws {
        try exerciseCapture(backgroundSeconds: 600)
    }

    func testPowerOffAndReconnectDuringCapture() throws {
        try exerciseCapture(backgroundSeconds: 0, powerCycle: true)
    }

    func testBLEReconnectRestoresLiveCaptions() throws {
        try exerciseCapture(backgroundSeconds: 0, interruptBLE: true)
    }

    func testLiveStreamRecoveryPreservesDurableAudio() throws {
        try exerciseCapture(backgroundSeconds: 0, interruptLive: true)
    }

    func testNetworkRestorationDrainsPausedQueue() throws {
        try exerciseCapture(backgroundSeconds: 0, networkOutage: true)
    }

    func testTerminationRecoversAuthorizedAudioWhilePaused() throws {
        try exerciseCapture(backgroundSeconds: 0, terminateDuringCapture: true)
    }

    func testFinishAfterAutomaticConversationCompletion() throws {
        try exerciseCapture(backgroundSeconds: 0, waitBeforeFinish: 140)
    }

    func testAutomaticSilenceCompletesConversation() throws {
        try exerciseCapture(backgroundSeconds: 0, automaticFinish: true)
    }

    private func exerciseCapture(backgroundSeconds: TimeInterval, automaticFinish: Bool = false, powerCycle: Bool = false, interruptBLE: Bool = false, interruptLive: Bool = false, networkOutage: Bool = false, terminateDuringCapture: Bool = false, waitBeforeFinish: TimeInterval = 0, releaseInstallation: Bool = false) throws {
        let environment = ProcessInfo.processInfo.environment
        let server = environment["TRACE_TEST_SERVER"] ?? ""
        let secret = environment["TRACE_TEST_ENROLLMENT_SECRET"] ?? ""
        guard releaseInstallation || (!server.isEmpty && !secret.isEmpty) else {
            throw XCTSkip("Provide private runtime configuration to run the physical provider test.")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = releaseInstallation ? [] : ["--trace-provider-test"]
        if terminateDuringCapture { app.launchArguments.append("--trace-termination-test") }
        if interruptBLE { app.launchArguments.append("--trace-ble-reconnect-test") }
        if interruptLive { app.launchArguments.append("--trace-live-reconnect-test") }
        if networkOutage && !releaseInstallation { app.launchArguments.append("--trace-network-outage-test") }
        if !releaseInstallation {
            app.launchEnvironment = ["TRACE_TEST_SERVER": server, "TRACE_TEST_ENROLLMENT_SECRET": secret]
        }
        if releaseInstallation { app.terminate() }
        app.launch()
        diagnosticsExpanded = false
        XCTAssertTrue(app.tabBars.buttons["Capture"].firstMatch.waitForExistence(timeout: 20))
        app.tabBars.buttons["Capture"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        app.swipeUp()
        let disclosure = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Audio streams to Deepgram for live text")).firstMatch
        for _ in 0..<5 {
            if disclosure.exists { break }
            app.swipeUp()
        }
        XCTAssertTrue(disclosure.waitForExistence(timeout: 30), "Installation enrollment must succeed before recording")
        app.swipeDown()
        let connection = element(app, "trace.capture.connection")
        if !connection.label.contains("Connected") {
            app.buttons["Find DevKit2"].tap()
            let candidate = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "trace.capture.device.")).firstMatch
            XCTAssertTrue(candidate.waitForExistence(timeout: 20))
            candidate.tap()
        }
        let connected = NSPredicate { _, _ in
            let current = self.element(app, "trace.capture.connection")
            return current.exists && current.label.contains("Connected")
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: connected, object: nil)], timeout: 40), .completed)
        XCTAssertTrue(element(app, "trace.capture.mode").label.contains("Paused"))
        let recoveredBefore = terminateDuringCapture ? count(element(app, "trace.capture.test.recovered")) : 0
        tapCaptureControl("Resume capture", app: app)
        let beforeBackground = count(element(app, "trace.capture.frames"))
        // The host plays the controlled speech fixture while this test records.
        Thread.sleep(forTimeInterval: 25)
        if waitBeforeFinish > 0 { Thread.sleep(forTimeInterval: waitBeforeFinish) }
        if terminateDuringCapture {
            XCTAssertGreaterThan(count(element(app, "trace.capture.frames")), 1_500)
            print("TRACE DEVICE CHECK: TERMINATING OPEN RECORDING")
            app.terminate()
            app.launchArguments = ["--trace-provider-test", "--trace-termination-test"]
            app.launchEnvironment = ["TRACE_TEST_SERVER": server, "TRACE_TEST_ENROLLMENT_SECRET": secret]
            app.launch()
        diagnosticsExpanded = false
            XCTAssertTrue(app.tabBars.buttons["Capture"].firstMatch.waitForExistence(timeout: 20))
            app.tabBars.buttons["Capture"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            app.swipeDown()
            let recovered = NSPredicate { _, _ in
                let item = self.element(app, "trace.capture.test.recovered")
                return item.exists && self.count(item) > recoveredBefore
            }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: recovered, object: nil)], timeout: 20), .completed, "A partial file must be repaired on relaunch")
            XCTAssertTrue(element(app, "trace.capture.mode").label.contains("Paused"))
            Thread.sleep(forTimeInterval: 5)
            XCTAssertEqual(count(element(app, "trace.capture.frames")), 0, "Relaunch must not resume recording")
        }
        if networkOutage {
            app.swipeDown()
            app.swipeDown()
            app.swipeDown()
            print("TRACE DEVICE CHECK: READY FOR INTERNET OFF")
            let offline = NSPredicate { _, _ in
                if releaseInstallation {
                    let error = app.staticTexts["trace.capture.error"]
                    return error.exists && error.label.hasPrefix("Audio upload is queued for retry:")
                }
                let network = self.element(app, "trace.capture.test.network")
                return network.exists && network.label.contains("Unavailable")
            }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: offline, object: nil)], timeout: 600), .completed)
            let beforeFrames = count(element(app, "trace.capture.frames"))
            print("TRACE DEVICE CHECK: OFFLINE SPEECH")
            Thread.sleep(forTimeInterval: 40)
            XCTAssertGreaterThanOrEqual(count(element(app, "trace.capture.frames")) - beforeFrames, 2_500, "Bluetooth audio must continue without internet")
            if !app.buttons["Finish conversation"].exists { app.swipeUp() }
            tapCaptureControl("Finish conversation", app: app)
            let queued = NSPredicate { _, _ in self.element(app, "trace.capture.uploads").exists && self.count(self.element(app, "trace.capture.uploads")) > 0 }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: queued, object: nil)], timeout: 20), .completed)
            // The mode row can exist offscreen with an empty label on iOS 27.
            // Resume capture is the direct user-facing evidence that Finish paused capture.
            for _ in 0..<5 {
                if app.buttons["Resume capture"].exists && app.buttons["Resume capture"].isHittable { break }
                app.swipeDown()
            }
            XCTAssertTrue(app.buttons["Resume capture"].waitForExistence(timeout: 10))
            let pausedFrames = count(element(app, "trace.capture.frames"))
            let evidence = XCTAttachment(screenshot: app.screenshot())
            evidence.name = "Offline recording paused with queued audio"
            evidence.lifetime = .keepAlways
            add(evidence)
            app.swipeDown()
            app.swipeDown()
            print("TRACE DEVICE CHECK: READY FOR INTERNET ON")
            if !releaseInstallation {
                let online = NSPredicate { _, _ in
                    let network = self.element(app, "trace.capture.test.network")
                    return network.exists && network.label.contains("Available")
                }
                XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: online, object: nil)], timeout: 600), .completed)
            }
            let drained = NSPredicate { _, _ in self.count(self.element(app, "trace.capture.uploads")) == 0 }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: drained, object: nil)], timeout: 180), .completed, "Restoring the network must drain queued audio without Resume or manual Retry")
            XCTAssertEqual(count(element(app, "trace.capture.frames")), pausedFrames)
        }
        if interruptLive {
            app.swipeUp()
            let initialText = NSPredicate { _, _ in self.element(app, "trace.capture.live.final").exists && self.element(app, "trace.capture.live.final").label.localizedCaseInsensitiveContains("Maria") }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: initialText, object: nil)], timeout: 30), .completed)
            let textBeforeFailure = element(app, "trace.capture.live.final").label
            app.buttons["Interrupt live stream for device test"].tap()
            let lost = NSPredicate { _, _ in self.element(app, "trace.capture.live.status").label.contains("Live connection lost") }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: lost, object: nil)], timeout: 15), .completed)
            app.swipeDown()
            let beforeFrames = count(element(app, "trace.capture.frames"))
            print("TRACE DEVICE CHECK: LIVE STREAM INTERRUPTED")
            Thread.sleep(forTimeInterval: 15)
            XCTAssertGreaterThanOrEqual(count(element(app, "trace.capture.frames")) - beforeFrames, 1_000, "Pendant audio must continue locally while live transcription is disconnected")
            app.swipeUp()
            for _ in 0..<3 {
                if app.buttons["Retry live transcript"].exists { break }
                app.swipeUp()
            }
            app.buttons["Retry live transcript"].tap()
            print("TRACE DEVICE CHECK: RECONNECTED FOR SPEECH")
            Thread.sleep(forTimeInterval: 25)
            let recovered = NSPredicate { _, _ in self.element(app, "trace.capture.live.final").label.localizedCaseInsensitiveContains("Alex") }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: recovered, object: nil)], timeout: 20), .completed)
            XCTAssertTrue(element(app, "trace.capture.live.final").label.hasPrefix(textBeforeFailure))
            app.swipeDown()
        }
        if interruptBLE {
            app.swipeUp()
            let initialText = NSPredicate { _, _ in self.element(app, "trace.capture.live.final").exists && self.element(app, "trace.capture.live.final").label.localizedCaseInsensitiveContains("Maria") }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: initialText, object: nil)], timeout: 30), .completed)
            let textBeforeDisconnect = element(app, "trace.capture.live.final").label
            app.swipeDown()
            app.swipeDown()
            XCTAssertTrue(element(app, "trace.capture.test.disconnects").waitForExistence(timeout: 5))
            let beforeDisconnects = count(element(app, "trace.capture.test.disconnects"))
            let beforeFrames = count(element(app, "trace.capture.frames"))
            tapCaptureControl("Interrupt BLE for device test", app: app)
            let disconnected = NSPredicate { _, _ in self.count(self.element(app, "trace.capture.test.disconnects")) > beforeDisconnects }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: disconnected, object: nil)], timeout: 20), .completed, "A real CoreBluetooth disconnect callback must occur")
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: connected, object: nil)], timeout: 40), .completed)
            let resumedFrames = NSPredicate { _, _ in self.count(self.element(app, "trace.capture.frames")) >= beforeFrames + 500 }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: resumedFrames, object: nil)], timeout: 20), .completed)
            print("TRACE DEVICE CHECK: RECONNECTED FOR SPEECH")
            Thread.sleep(forTimeInterval: 25)
            app.swipeUp()
            let recoveredText = NSPredicate { _, _ in self.element(app, "trace.capture.live.final").label.localizedCaseInsensitiveContains("Alex") }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: recoveredText, object: nil)], timeout: 20), .completed)
            XCTAssertTrue(element(app, "trace.capture.live.final").label.hasPrefix(textBeforeDisconnect), "Text from before the disconnect must remain visible")
            app.swipeDown()
        }
        if powerCycle {
            let textBeforePowerOff = element(app, "trace.capture.live.final").label
            print("TRACE DEVICE CHECK: READY FOR POWER OFF")
            let disconnected = NSPredicate { _, _ in self.element(app, "trace.capture.connection").label.contains("Disconnected") }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: disconnected, object: nil)], timeout: 120), .completed, "The center button must stop the BLE connection")
            Thread.sleep(forTimeInterval: 2)
            let stoppedFrames = count(element(app, "trace.capture.frames"))
            Thread.sleep(forTimeInterval: 10)
            XCTAssertEqual(count(element(app, "trace.capture.frames")), stoppedFrames, "Powered-off pendant must stop delivering audio")
            print("TRACE DEVICE CHECK: READY FOR POWER ON")
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: connected, object: nil)], timeout: 180), .completed, "Paired pendant must reconnect without another scan")
            let resumedFrames = NSPredicate { _, _ in self.count(self.element(app, "trace.capture.frames")) >= stoppedFrames + 500 }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: resumedFrames, object: nil)], timeout: 20), .completed)
            print("TRACE DEVICE CHECK: RECONNECTED FOR SPEECH")
            Thread.sleep(forTimeInterval: 25)
            let recoveredText = NSPredicate { _, _ in
                let text = self.element(app, "trace.capture.live.final").label
                let addedText = text.hasPrefix(textBeforePowerOff) ? String(text.dropFirst(textBeforePowerOff.count)) : text
                return addedText.localizedCaseInsensitiveContains(releaseInstallation ? "research proposal" : "Alex")
            }
            app.swipeUp()
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: recoveredText, object: nil)], timeout: 20), .completed, "Live captions must recover after pendant reconnect")
            app.swipeDown()
        }
        if backgroundSeconds > 0 {
            app.swipeDown()
            app.swipeDown()
            let battery = element(app, "trace.capture.battery")
            XCTAssertTrue(battery.exists)
            let batteryBefore = count(battery)
            XCTAssertTrue((0...100).contains(batteryBefore), "Pendant must report a valid battery level")
            print("TRACE DEVICE CHECK: BACKGROUND BASELINE frames=\(count(element(app, "trace.capture.frames"))) battery=\(batteryBefore)")
            XCUIDevice.shared.press(.home)
            Thread.sleep(forTimeInterval: backgroundSeconds)
            app.activate()
            XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15))
            let after = count(element(app, "trace.capture.frames"))
            print("TRACE DEVICE CHECK: BACKGROUND END frames=\(after) battery=\(count(element(app, "trace.capture.battery")))")
            XCTAssertGreaterThanOrEqual(after - beforeBackground, Int((backgroundSeconds + 25) * 70), "BLE audio must continue reaching local capture while TRACE is backgrounded")
        }
        if !terminateDuringCapture {
        app.tabBars.buttons["Capture"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        app.swipeUp()
        let live = element(app, "trace.capture.live.final")
        XCTAssertTrue(live.waitForExistence(timeout: 15), "Deepgram must deliver final live text on the physical iPhone")
        XCTAssertFalse(live.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        let liveScreenshot = XCTAttachment(screenshot: app.screenshot())
        liveScreenshot.name = "Physical DevKit live captions"
        liveScreenshot.lifetime = .keepAlways
        add(liveScreenshot)
        app.swipeDown()
        }
        if !automaticFinish && !networkOutage && !terminateDuringCapture {
            if !app.buttons["Finish conversation"].exists { app.swipeUp() }
            tapCaptureControl("Finish conversation", app: app)
        }
        let saved = NSPredicate { _, _ in
            let status = self.element(app, "trace.capture.status").label
            return status.contains("Conversation and summary saved") || status.contains("Summary needs retry") || status.contains("Transcript saved in TRACE")
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: saved, object: nil)], timeout: automaticFinish ? 160 : 120), .completed, "Device audio must produce a durably saved transcript")
        if automaticFinish {
            XCTAssertTrue(element(app, "trace.capture.status").label.contains("Conversation and summary saved"), "Silence must complete and summarize a conversation without Finish")
            tapCaptureControl("Pause capture", app: app)
        }
        XCTAssertTrue(element(app, "trace.capture.mode").label.contains("Paused"))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Physical live transcription and saved conversation"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        if environment["TRACE_TEST_REQUIRE_SUMMARY"] == "1" {
            if !automaticFinish {
                XCTAssertTrue(element(app, "trace.capture.status").label.contains("Conversation and summary saved"), "A fresh recording must generate its summary automatically")
            }
            app.tabBars.buttons["Conversations"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            let refresh = app.buttons["trace.conversations.refresh"]
            XCTAssertTrue(refresh.waitForExistence(timeout: 10))
            refresh.tap()
            let newest = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "trace.conversation.")).firstMatch
            XCTAssertTrue(newest.waitForExistence(timeout: 20))
            newest.tap()
            XCTAssertTrue(app.staticTexts["Overview"].waitForExistence(timeout: 15))
            let overview = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Maria")).firstMatch
            XCTAssertTrue(overview.waitForExistence(timeout: 10))
            let summaryScreenshot = XCTAttachment(screenshot: app.screenshot())
            summaryScreenshot.name = "Physical conversation automatic summary"
            summaryScreenshot.lifetime = .keepAlways
            add(summaryScreenshot)
        }
    }

    private func tapCaptureControl(_ title: String, app: XCUIApplication) {
        let button = app.buttons[title]
        for _ in 0..<5 {
            if button.exists && button.isHittable { break }
            app.swipeDown()
        }
        XCTAssertTrue(button.waitForExistence(timeout: 10))
        button.tap()
    }

    private func count(_ element: XCUIElement) -> Int {
        let value = element.label.split(separator: ",", maxSplits: 1).last.map(String.init) ?? ""
        return Int(value.filter(\.isNumber)) ?? -1
    }

    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        let item = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        if item.exists { return item }
        let diagnosticIDs = ["trace.capture.frames", "trace.capture.chunks", "trace.capture.test.recovered", "trace.capture.test.network"]
        if diagnosticIDs.contains(identifier) {
            for _ in 0..<5 {
                if item.exists { return item }
                let details = app.buttons["Recording details"]
                if !diagnosticsExpanded && details.exists && details.isHittable {
                    details.tap()
                    diagnosticsExpanded = true
                    if item.exists { return item }
                }
                app.swipeUp()
            }
        }
        if !item.exists {
            app.swipeDown()
            app.swipeDown()
            app.swipeDown()
            for _ in 0..<5 {
                if item.exists { break }
                app.swipeUp()
            }
        }
        return item
    }
}
