import XCTest

/// Run only with a powered DevKit nearby and the paired physical iPhone.
/// The recording stays local: an enrolled installation deliberately skips this test.
@MainActor
final class PhysicalCaptureTests: XCTestCase {
    func testPhysicalBLECaptureFinishAndPausedRelaunch() throws {
        try exerciseCapture(minimumFrames: 200, frameTimeout: 15)
    }

    func testSustainedBLECaptureFinishAndPausedRelaunch() throws {
        try exerciseCapture(minimumFrames: 3_000, frameTimeout: 45)
    }

    private func exerciseCapture(minimumFrames: Int, frameTimeout: TimeInterval) throws {
        let app = XCUIApplication()
        continueAfterFailure = false
        app.launch()
        app.tabBars.buttons["Capture"].firstMatch.tap()
        let localDisclosure = app.staticTexts["Audio stays on this iPhone until you enroll. Capture starts paused whenever TRACE launches."]
        if !localDisclosure.waitForExistence(timeout: 3) {
            app.swipeUp()
        }
        guard localDisclosure.waitForExistence(timeout: 10) else {
            let diagnostic = XCTAttachment(string: app.debugDescription)
            diagnostic.name = "Local capture gate unavailable"
            diagnostic.lifetime = .keepAlways
            add(diagnostic)
            throw XCTSkip("This physical capture test requires an unenrolled installation so audio stays local.")
        }
        app.swipeDown()
        let connection = element(app, "trace.capture.connection")
        if !connection.label.contains("Connected") {
            app.buttons["Find DevKit2"].tap()
            let candidate = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "trace.capture.device.")).firstMatch
            if candidate.waitForExistence(timeout: 15) {
                candidate.tap()
            }
        }
        let connected = NSPredicate { _, _ in connection.exists && connection.label.contains("Connected") }
        let connectionWait = XCTNSPredicateExpectation(predicate: connected, object: nil)
        let connectionResult = XCTWaiter.wait(for: [connectionWait], timeout: 40)
        if connectionResult != .completed {
            let diagnostic = XCTAttachment(string: app.debugDescription)
            diagnostic.name = "BLE connection failure UI"
            diagnostic.lifetime = .keepAlways
            add(diagnostic)
        }
        XCTAssertEqual(connectionResult, .completed, "DevKit must reconnect over BLE: \(connection.label)")
        XCTAssertTrue(element(app, "trace.capture.mode").label.contains("Paused"))
        let originalChunks = count(element(app, "trace.capture.chunks"))
        let originalFrames = count(element(app, "trace.capture.frames"))
        app.buttons["Resume capture"].tap()
        let framesReceived = NSPredicate { _, _ in self.count(self.element(app, "trace.capture.frames")) >= originalFrames + minimumFrames }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: framesReceived, object: nil)], timeout: frameTimeout), .completed, "Real BLE audio frames must reach TRACE")
        app.buttons["Finish conversation"].tap()
        let finished = NSPredicate { _, _ in
            self.element(app, "trace.capture.mode").label.contains("Paused") &&
            self.count(self.element(app, "trace.capture.chunks")) > originalChunks
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: finished, object: nil)], timeout: 10), .completed, "Finish must flush a durable local chunk and pause")
        let localSaved = NSPredicate { _, _ in
            self.element(app, "trace.capture.status").label.contains("Audio saved on this iPhone. Enroll to create a transcript and summary.")
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: localSaved, object: nil)], timeout: 5), .completed)
        Thread.sleep(forTimeInterval: 2)
        let pausedFrames = count(element(app, "trace.capture.frames"))
        Thread.sleep(forTimeInterval: 3)
        XCTAssertEqual(count(element(app, "trace.capture.frames")), pausedFrames, "Frames must stop increasing while paused")
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Physical DevKit capture finished and paused"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.terminate()
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15), "TRACE must finish relaunching")
        XCTAssertTrue(app.tabBars.buttons["Capture"].firstMatch.waitForExistence(timeout: 10))
        app.tabBars.buttons["Capture"].firstMatch.tap()
        XCTAssertTrue(element(app, "trace.capture.mode").waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "trace.capture.mode").label.contains("Paused"), "Relaunch must require explicit capture resume")
        let recovered = NSPredicate { _, _ in self.count(self.element(app, "trace.capture.chunks")) > originalChunks }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: recovered, object: nil)], timeout: 10), .completed)
    }

    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func count(_ element: XCUIElement) -> Int {
        let value = element.label.split(separator: ",", maxSplits: 1).last.map(String.init) ?? ""
        return Int(value.filter(\.isNumber)) ?? -1
    }
}
