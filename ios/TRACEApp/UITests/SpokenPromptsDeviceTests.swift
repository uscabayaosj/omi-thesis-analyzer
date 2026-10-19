import XCTest
@MainActor final class SpokenPromptsDeviceTests: XCTestCase {
    /// Read-only inspection after an attended capture; never starts recording.
    func testInspectLatestSavedConversation() throws {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launch()
        XCTAssertTrue(app.tabBars.buttons["Conversations"].waitForExistence(timeout: 15))
        app.tabBars.buttons["Conversations"].tap()
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "trace.conversation.")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 30)); row.tap()
        XCTAssertTrue(app.segmentedControls.firstMatch.waitForExistence(timeout: 20))
        let summary = XCTAttachment(string: app.debugDescription)
        summary.name = "Latest summary readback"; summary.lifetime = .keepAlways; add(summary)
        app.segmentedControls.buttons["Transcript"].tap()
        for page in 0..<4 {
            let snapshot = XCTAttachment(string: app.debugDescription)
            snapshot.name = "Latest transcript readback \(page)"; snapshot.lifetime = .keepAlways; add(snapshot)
            app.swipeUp()
        }
        app.tabBars.buttons["Capture"].tap()
    }

    func testPromptsWhileRecordingAndSummaryCompletion() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--trace-prompts-test"]
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Capture"].firstMatch.waitForExistence(timeout: 15))
        app.tabBars.buttons["Capture"].firstMatch.tap()
        let promptStatus = app.descendants(matching: .any).matching(identifier: "trace.prompts.status").firstMatch
        let connected = NSPredicate { _,_ in promptStatus.exists && promptStatus.label == "DevKit audio alerts connected" }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: connected, object: nil)], timeout: 40), .completed)
        tap(app, "trace.prompts.disconnect")
        Thread.sleep(forTimeInterval: 2)
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: connected, object: nil)], timeout: 40), .completed)
        tap(app, "Resume capture")
        print("TRACE_PROMPTS_RECORDING_STARTED")
        let started = Date()
        Thread.sleep(forTimeInterval: 8)
        for id in 1...6 {
            tap(app, "trace.prompts.preview.\(id)")
            Thread.sleep(forTimeInterval: 3)
        }
        while Date().timeIntervalSince(started) < 80 { Thread.sleep(forTimeInterval: 2) }
        tap(app, "Finish conversation")
        print("TRACE_PROMPTS_FINISH_REQUESTED")
        let paused = app.buttons["Resume capture"]
        XCTAssertTrue(paused.waitForExistence(timeout: 15))
        // Leave the app running to observe the actual server completion and
        // resulting prompt; a preview does not prove this backend event path.
        let status = app.descendants(matching: .any).matching(identifier: "trace.capture.status").firstMatch
        for _ in 0..<8 { if status.isHittable { break }; app.swipeUp() }
        let summary = NSPredicate { _,_ in status.exists && status.label.contains("Conversation and summary saved in TRACE.") }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: summary, object: nil)], timeout: 120), .completed)
        Thread.sleep(forTimeInterval: 6)
        let attachment = XCTAttachment(string: app.debugDescription)
        attachment.name = "Spoken prompts capture and summary final state"; attachment.lifetime = .keepAlways; add(attachment)
        // Capture uses a lazy scroll view: an offscreen button may not exist in
        // the accessibility tree even though capture is correctly paused.
        for _ in 0..<8 { if paused.isHittable { break }; app.swipeDown() }
        XCTAssertTrue(paused.exists)
    }
    private func tap(_ app: XCUIApplication, _ id: String) {
        let button = app.buttons[id].firstMatch
        for _ in 0..<4 { if button.isHittable { button.tap(); return }; app.swipeDown() }
        for _ in 0..<10 { if button.isHittable { button.tap(); return }; app.swipeUp() }
        XCTFail("Could not reach button: \(id)")
    }
}
