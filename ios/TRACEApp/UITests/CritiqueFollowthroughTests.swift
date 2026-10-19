import XCTest

final class CritiqueFollowthroughTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }
    private func launch(_ arguments: [String] = [], large: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--trace-ui-fixtures"] + (large ? ["--trace-ui-dark"] : []) + arguments + ["-AppleInterfaceStyle", large ? "Dark" : "Light", "-UIPreferredContentSizeCategoryName", large ? "UICTContentSizeCategoryAccessibilityXXXL" : "UICTContentSizeCategoryL"]
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Conversations"].firstMatch.waitForExistence(timeout: 15))
        return app
    }
    private func tap(_ app: XCUIApplication, _ element: XCUIElement) {
        for _ in 0..<12 { if element.exists && element.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(element.waitForExistence(timeout: 5)); XCTAssertTrue(element.isHittable); element.tap()
    }
    private func proof(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }
    func testCaptureTruthAtLargestText() {
        let app = launch(large: true)
        app.tabBars.buttons["Capture"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let badge = app.staticTexts["trace.capture.recordingState"]
        XCTAssertTrue(badge.waitForExistence(timeout: 5)); XCTAssertEqual(badge.label, "PAUSED")
        XCTAssertTrue(app.buttons["Resume capture"].isHittable)
        proof(app, "Largest text primary capture action before explanation")
        app.buttons["Resume capture"].tap()
        XCTAssertTrue(app.buttons["Pause capture"].waitForExistence(timeout: 5))
        XCTAssertEqual(badge.label, "WAITING FOR DEVKIT2")
        proof(app, "Armed capture never claims recording without device audio")
        app.buttons["Pause capture"].tap()
    }
    func testTodayLoadAndStepFailureRecovery() {
        let app = launch(["--trace-ui-rollup-error", "--trace-ui-step-error"])
        app.tabBars.buttons["Today"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let error = app.staticTexts["trace.today.rollupError"]
        XCTAssertTrue(error.waitForExistence(timeout: 10))
        proof(app, "Planning load failure is visible with retry")
        tap(app, app.buttons["Retry planning action"])
        XCTAssertTrue(app.buttons["Mark plan step done"].waitForExistence(timeout: 10))
        XCTAssertFalse(error.exists)
        let commitment = app.staticTexts["Review the interview guide"].firstMatch
        XCTAssertTrue(commitment.isHittable)
        proof(app, "Open commitment leads before collapsed reviews")
        tap(app, app.buttons["Mark plan step done"])
        XCTAssertTrue(error.waitForExistence(timeout: 5))
        proof(app, "Failed plan change keeps the step and explains recovery")
        tap(app, app.buttons["Retry planning action"])
        XCTAssertTrue(app.buttons["Mark plan step open"].waitForExistence(timeout: 5))
        XCTAssertFalse(error.exists)
    }
    func testDailyGenerationRetryPreservesCommitment() {
        let app = launch(["--trace-ui-generate-error"])
        app.tabBars.buttons["Today"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        tap(app, app.buttons["Create daily review"])
        let error = app.staticTexts["trace.today.rollupError"]
        XCTAssertTrue(error.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Review the interview guide"].firstMatch.exists)
        tap(app, app.buttons["Retry planning action"])
        XCTAssertTrue(app.buttons["Mark plan step done"].waitForExistence(timeout: 5))
        XCTAssertFalse(error.exists)
    }
    func testEmptyStatesConnectTheWorkflow() {
        let app = launch(["--trace-ui-empty"])
        tap(app, app.buttons["Start a recording"])
        XCTAssertTrue(app.buttons["Resume capture"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Today"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        tap(app, app.buttons["Choose a conversation"])
        XCTAssertTrue(app.buttons["Start a recording"].waitForExistence(timeout: 5))
        proof(app, "Empty workflow provides direct next actions")
    }
    func testCodebookSourceInContextAndGroupCitation() {
        let app = launch()
        app.tabBars.buttons["Research"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        tap(app, app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Codebook")).firstMatch)
        tap(app, app.buttons["Add a verified excerpt"])
        XCTAssertTrue(app.staticTexts["trace.codebook.source"].waitForExistence(timeout: 10))
        proof(app, "Verified excerpt keeps selected saved source beside coding")
        tap(app, app.buttons["Use this whole passage"])
        let excerpt = app.descendants(matching: .any).matching(identifier: "trace.codebook.excerpt").firstMatch
        XCTAssertTrue(excerpt.waitForExistence(timeout: 5))
        XCTAssertTrue((excerpt.value as? String ?? "").contains("field team agreed"))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        tap(app, app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Ask saved analyses")).firstMatch)
        tap(app, app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "What preparation is needed?")).firstMatch)
        tap(app, app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Interview planning group")).firstMatch)
        XCTAssertTrue(app.navigationBars["Group source"].waitForExistence(timeout: 10))
        proof(app, "Group citation opens its saved analysis and source conversations")
    }
    func testLargeTextPlanningPatternsAndPeopleSearch() {
        let app = launch(large: true)
        app.tabBars.buttons["Today"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.staticTexts["Review the interview guide"].firstMatch.waitForExistence(timeout: 10))
        proof(app, "Largest text Today leads with an open commitment")
        tap(app, app.buttons["Planning patterns"])
        XCTAssertTrue(app.navigationBars["Patterns"].waitForExistence(timeout: 5))
        proof(app, "Largest text Patterns keeps history secondary")
        tap(app, app.buttons["Weekly review history"])
        let week = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Week of ")).firstMatch
        XCTAssertTrue(week.waitForExistence(timeout: 5))
        XCTAssertTrue((week.value as? String ?? "").contains("1 day reviewed"))
        app.tabBars.buttons["People"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let search = app.searchFields.firstMatch
        for _ in 0..<3 { if search.exists { break }; app.swipeDown() }
        XCTAssertTrue(search.waitForExistence(timeout: 5)); search.tap(); search.typeText("No matching colleague")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "No Results")).firstMatch.waitForExistence(timeout: 5))
        proof(app, "People explicitly explains filtered zero matches")
    }

    func testSettingsScopeAndPlacesSafety() {
        let app = launch()
        app.buttons["trace.settings"].coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)).tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
        tap(app, app.buttons["Backup and restore"])
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Native capture conversations, conversation pins and deletion markers, reference voices, and local audio recordings are not included.")).firstMatch.waitForExistence(timeout: 5))
        proof(app, "Backup scope is explicit at the action")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        tap(app, app.buttons["Usage"])
        XCTAssertTrue(app.staticTexts["Ask saved analyses"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["1 call"].firstMatch.exists)
        proof(app, "Usage translates feature names and unavailable prices")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["Done"].tap()
        app.tabBars.buttons["People"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        tap(app, app.buttons["Named places"])
        let place = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Field office")).firstMatch
        XCTAssertTrue(place.waitForExistence(timeout: 5)); place.swipeLeft()
        app.buttons["Delete"].tap()
        XCTAssertTrue(app.buttons["Delete place"].waitForExistence(timeout: 5))
        proof(app, "Saved place deletion requires explicit confirmation")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(place.exists)
    }
}
