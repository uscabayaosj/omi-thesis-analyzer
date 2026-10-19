import XCTest

final class CritiqueReleaseTests: XCTestCase {
    func testPersonalReleaseNavigation() {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launch()
        XCTAssertTrue(app.tabBars.buttons["Conversations"].firstMatch.waitForExistence(timeout: 25))
        let conversation = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "trace.conversation.")).firstMatch
        XCTAssertTrue(conversation.waitForExistence(timeout: 25)); conversation.tap()
        XCTAssertTrue(app.segmentedControls.buttons["Summary"].waitForExistence(timeout: 20))
        app.navigationBars.buttons.firstMatch.tap()
        app.tabBars.buttons["Today"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.staticTexts["Open commitments"].waitForExistence(timeout: 20))
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "Private Release current commitments before reviews"; attachment.lifetime = .keepAlways; add(attachment)
        app.tabBars.buttons["Capture"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.buttons["Resume capture"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts["trace.capture.recordingState"].label, "PAUSED")
        app.tabBars.buttons["Research"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let codebook = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Codebook")).firstMatch
        XCTAssertTrue(codebook.exists); codebook.tap()
        let excerpt = app.buttons["Add a verified excerpt"]
        for _ in 0..<8 { if excerpt.exists && excerpt.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(excerpt.exists); excerpt.tap()
        let loadedSource = app.staticTexts["trace.codebook.source"]
        let prerequisite = app.staticTexts["Add a code and save a thesis analysis before adding evidence."]
        let ready = NSPredicate { _, _ in loadedSource.exists || prerequisite.exists }
        expectation(for: ready, evaluatedWith: app)
        waitForExpectations(timeout: 25)
        let source = XCTAttachment(screenshot: app.screenshot()); source.name = "Private Release coding source or existing-data prerequisite"; source.lifetime = .keepAlways; add(source)
        app.tabBars.buttons["Capture"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.buttons["Resume capture"].exists)
    }
}
