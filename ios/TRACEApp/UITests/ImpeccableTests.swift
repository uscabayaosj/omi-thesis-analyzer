import XCTest

final class ImpeccableTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }
    private func launch(large: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        if large { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL", "-AppleInterfaceStyle", "Dark"] }
        if !large { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL", "-AppleInterfaceStyle", "Light"] }
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Conversations"].firstMatch.waitForExistence(timeout: 25))
        return app
    }
    private func proof(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func tap(_ app: XCUIApplication, _ item: XCUIElement) {
        for _ in 0..<15 { if item.exists && item.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(item.waitForExistence(timeout: 10)); item.tap()
    }
    func testProtectedActionsAndDrafts() {
        let app = launch()
        app.buttons["trace.settings"].coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)).tap()
        tap(app, app.buttons["Revoke this iPhone"])
        XCTAssertTrue(app.buttons["Revoke server access"].waitForExistence(timeout: 10))
        proof(app, "Revocation explains consequences before any mutation")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["Revoke this iPhone"].exists)
        app.buttons["Done"].tap()
        app.tabBars.buttons["People"].firstMatch.tap()
        app.buttons["Add person"].tap()
        let name = app.textFields["Name"]
        XCTAssertTrue(name.waitForExistence(timeout: 10)); name.tap(); name.typeText("Unsaved draft check")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["Discard changes"].waitForExistence(timeout: 10))
        proof(app, "Unsaved draft protected by explicit discard choice")
        app.buttons["Keep editing"].tap()
        XCTAssertEqual(name.value as? String, "Unsaved draft check")
        let cancelEditor = app.navigationBars.buttons["Cancel"].firstMatch
        XCTAssertTrue(cancelEditor.waitForExistence(timeout: 5))
        cancelEditor.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)).tap()
        XCTAssertTrue(app.buttons["Discard changes"].waitForExistence(timeout: 10))
        app.buttons["Discard changes"].tap()
        XCTAssertTrue(app.buttons["Add person"].waitForExistence(timeout: 10))
    }
    func testLargeTextPatternsAndCapture() {
        let app = launch(large: true)
        app.tabBars.buttons["Research"].firstMatch.tap()
        tap(app, app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Patterns")).firstMatch)
        XCTAssertTrue(app.staticTexts["Days reviewed · 8 weeks"].waitForExistence(timeout: 20))
        tap(app, app.buttons["Weekly review history"])
        let week = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Week of ")).firstMatch
        XCTAssertTrue(week.waitForExistence(timeout: 15))
        proof(app, "Populated Patterns with largest accessibility text")
        app.swipeUp(); proof(app, "Patterns weekly metrics wrap at largest text")
        app.tabBars.buttons["Capture"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Resume capture"].waitForExistence(timeout: 10))
        let resume = app.buttons["Resume capture"]
        for _ in 0..<8 { if resume.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(resume.isHittable)
        proof(app, "Paused capture remains usable at largest text")
    }
    func testSimulatorLargeCapture() throws {
        #if targetEnvironment(simulator)
        let app = launch(large: true)
        app.tabBars.buttons["Capture"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Resume capture"].waitForExistence(timeout: 10))
        proof(app, "Simulator Capture header at largest text")
        let resume = app.buttons["Resume capture"]
        for _ in 0..<8 { if resume.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(resume.isHittable)
        proof(app, "Simulator Capture action at largest text")
        #else
        throw XCTSkip("Simulator breadth check")
        #endif
    }

}
