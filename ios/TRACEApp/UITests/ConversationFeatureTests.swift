import XCTest

final class ConversationFeatureTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }
    private func launch(_ extra: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--trace-ui-fixtures", "--trace-ui-delete", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"]
        if let extra { app.launchArguments.append(extra) }
        app.launch()
        XCTAssertTrue(app.buttons["trace.conversations.select"].waitForExistence(timeout: 20))
        return app
    }
    func testSwipeCancelThenDelete() {
        let app = launch()
        let row = app.cells.containing(.any, identifier: "trace.conversation.fixture-conversation").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.swipeLeft(); app.buttons["Delete"].firstMatch.tap()
        XCTAssertTrue(app.alerts["Delete conversation?"].waitForExistence(timeout: 5))
        app.alerts.buttons["Cancel"].tap(); XCTAssertTrue(row.exists)
        row.swipeLeft(); app.buttons["Delete"].firstMatch.tap(); app.alerts.buttons["Delete"].tap()
        XCTAssertTrue(row.waitForNonExistence(timeout: 10))
    }
    func testSelectMultipleDelete() {
        let app = launch(); app.buttons["trace.conversations.select"].tap()
        app.cells.containing(.any, identifier: "trace.conversation.fixture-second").firstMatch.tap()
        app.cells.containing(.any, identifier: "trace.conversation.fixture-third").firstMatch.tap()
        app.buttons["trace.conversations.deleteSelected"].tap(); XCTAssertTrue(app.alerts.firstMatch.waitForExistence(timeout: 5)); app.alerts.buttons["Delete"].tap()
        XCTAssertTrue(app.cells.containing(.any, identifier: "trace.conversation.fixture-second").firstMatch.waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.cells.containing(.any, identifier: "trace.conversation.fixture-conversation").firstMatch.exists)
    }
    func testDeleteFailureRetainsContent() {
        let app = launch("--trace-ui-delete-error")
        let row = app.cells.containing(.any, identifier: "trace.conversation.fixture-conversation").firstMatch
        row.swipeLeft(); app.buttons["Delete"].firstMatch.tap(); app.alerts.buttons["Delete"].tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Deletion unavailable")).firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(row.exists)
    }
    func testAudioCleanupConfirmationAndCancelKeepsText() {
        let app = launch()
        app.tabBars.buttons["Capture"].tap()
        let clear = app.buttons["trace.capture.clearAudio"]
        for _ in 0..<12 { if clear.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(clear.exists); clear.tap()
        XCTAssertTrue(app.alerts["Clear saved audio?"].waitForExistence(timeout: 10))
        app.alerts.buttons["Cancel"].tap()
        app.tabBars.buttons["Conversations"].tap()
        XCTAssertTrue(app.cells.containing(.any, identifier: "trace.conversation.fixture-conversation").firstMatch.exists)
    }
    func testPlacesLinksAndEditableCoordinates() {
        let app = launch()
        app.buttons["trace.conversations.places"].tap()
        XCTAssertTrue(app.navigationBars["Places"].waitForExistence(timeout: 10))
        app.descendants(matching: .any)["trace.place.fixture-conversation"].firstMatch.tap()
        let conversation = app.descendants(matching: .any)["trace.place.conversation.fixture-conversation"].firstMatch
        XCTAssertTrue(conversation.waitForExistence(timeout: 10)); conversation.tap()
        let edit = app.buttons["Edit location"]
        for _ in 0..<8 { if edit.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(edit.exists); edit.tap()
        XCTAssertTrue(app.navigationBars["Conversation location"].waitForExistence(timeout: 10))
        for _ in 0..<5 { if app.textFields["Latitude"].isHittable { break }; app.swipeUp() }
        XCTAssertTrue(app.textFields["Latitude"].waitForExistence(timeout: 10))
        app.textFields["Latitude"].tap(); app.textFields["Latitude"].typeText("0")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.navigationBars["Conversation location"].waitForNonExistence(timeout: 10))
    }
}
