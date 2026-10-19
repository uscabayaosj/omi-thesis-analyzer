import XCTest

/// Live-backend checks use only three explicitly seeded temporary conversations.
final class PhysicalConversationFeatureTests: XCTestCase {
    private let ids = (1...3).map { "00000000-0017-4000-8000-00000000000\($0)" }
    override func setUp() { continueAfterFailure = false }
    private func launch() -> XCUIApplication {
        let app = XCUIApplication(); app.launch()
        XCTAssertTrue(app.buttons["trace.conversations.select"].waitForExistence(timeout: 30))
        return app
    }
    private func row(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.cells.containing(.any, identifier: "trace.conversation.\(id)").firstMatch
    }
    func testLiveTemporarySwipeAndBulkDeletion() {
        let app = launch(); let first = row(app, ids[0])
        XCTAssertTrue(first.waitForExistence(timeout: 20))
        first.swipeLeft(); app.buttons["Delete"].firstMatch.tap()
        XCTAssertTrue(app.alerts["Delete conversation?"].waitForExistence(timeout: 5))
        app.alerts.buttons["Cancel"].tap(); XCTAssertTrue(first.exists)
        first.swipeLeft(); app.buttons["Delete"].firstMatch.tap(); app.alerts.buttons["Delete"].tap()
        XCTAssertTrue(first.waitForNonExistence(timeout: 20))
        app.buttons["trace.conversations.select"].tap()
        row(app, ids[1]).tap(); row(app, ids[2]).tap()
        app.buttons["trace.conversations.deleteSelected"].tap(); app.alerts.buttons["Delete"].tap()
        XCTAssertTrue(row(app, ids[1]).waitForNonExistence(timeout: 20))
        XCTAssertTrue(row(app, ids[2]).waitForNonExistence(timeout: 20))
    }
    func testLivePlacesAndManualPin() {
        let app = launch(); app.buttons["trace.conversations.places"].tap()
        XCTAssertTrue(app.navigationBars["Places"].waitForExistence(timeout: 20))
        app.descendants(matching: .any)["trace.place.\(ids[0])"].firstMatch.tap()
        let conversation = app.descendants(matching: .any)["trace.place.conversation.\(ids[0])"].firstMatch
        XCTAssertTrue(conversation.waitForExistence(timeout: 20)); conversation.tap()
        let edit = app.buttons["Edit location"]
        for _ in 0..<10 { if edit.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(edit.isHittable); edit.tap()
        XCTAssertTrue(app.navigationBars["Conversation location"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 10))
        for _ in 0..<6 { if app.textFields["Latitude"].isHittable { break }; app.swipeUp() }
        app.textFields["Latitude"].tap(); app.textFields["Latitude"].typeText("0")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.navigationBars["Conversation location"].waitForNonExistence(timeout: 20))
    }
    func testLiveUsageAndAudioClearCancel() {
        let app = launch(); app.buttons["Settings"].tap(); app.buttons["Usage"].tap()
        XCTAssertTrue(app.staticTexts["Estimated AI spend and calls"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "US$")).firstMatch.exists)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.lifetime = .keepAlways; add(attachment)
        app.terminate(); app.launch(); app.tabBars.buttons["Capture"].tap()
        let clear = app.buttons["trace.capture.clearAudio"]
        for _ in 0..<15 { if clear.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(clear.isHittable); clear.tap()
        XCTAssertTrue(app.alerts["Clear saved audio?"].waitForExistence(timeout: 10))
        app.alerts.buttons["Cancel"].tap()
    }
    func testLiveWholeConversationAudio() {
        let app = launch()
        let conversation = row(app, "603edff8-f5ae-4fab-b6b0-12bf8a3086bb")
        for _ in 0..<12 { if conversation.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(conversation.isHittable)
        app.buttons["trace.conversation.603edff8-f5ae-4fab-b6b0-12bf8a3086bb"].tap()
        XCTAssertTrue(app.segmentedControls.firstMatch.waitForExistence(timeout: 20))
        let initial = XCTAttachment(screenshot: app.screenshot()); initial.lifetime = .keepAlways; add(initial)
        let prepare = app.buttons["Prepare whole conversation audio"]
        let export = app.buttons["Export whole conversation"]
        for _ in 0..<5 { if prepare.isHittable || export.isHittable { break }; app.swipeUp() }
        if prepare.isHittable { prepare.tap() }
        XCTAssertTrue(export.waitForExistence(timeout: 90))
        let play = app.buttons["Play conversation"]
        XCTAssertTrue(play.isHittable); play.tap()
        app.buttons["Stop playback"].tap()
        export.tap()
        XCTAssertTrue(app.cells["Save to Files"].waitForExistence(timeout: 15))
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.lifetime = .keepAlways; add(attachment)
    }

}
