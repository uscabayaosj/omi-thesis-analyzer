import XCTest

final class TranscriptPresentationUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }
    func testReadableDefaultAndOptionalEstimatedTurns() {
        let app = XCUIApplication()
        app.launchArguments = ["--trace-ui-fixtures", "--trace-ui-speakers"]
        app.launch()
        let conversation = app.buttons["trace.conversation.fixture-conversation"]
        XCTAssertTrue(conversation.waitForExistence(timeout: 20)); conversation.tap()
        let transcript = app.segmentedControls.buttons["Transcript"]
        XCTAssertTrue(transcript.waitForExistence(timeout: 10)); transcript.tap()
        let toggle = app.switches["trace.transcript.estimatedSpeakers"]
        for _ in 0..<8 { if toggle.isHittable { break }; app.swipeUp() }
        app.swipeUp() // Bring the whole switch clear of the floating tab bar.
        XCTAssertTrue(toggle.isHittable); XCTAssertEqual(toggle.value as? String, "0")
        let text = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "We should call tomorrow.")).firstMatch
        XCTAssertTrue(text.exists)
        XCTAssertFalse(app.staticTexts["Estimated speaker 1"].exists)
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        XCTAssertEqual(toggle.value as? String, "1")
        let firstSpeaker = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Estimated speaker 1")).firstMatch
        for _ in 0..<4 { if firstSpeaker.exists { break }; app.swipeUp() }
        XCTAssertTrue(firstSpeaker.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Estimated speaker 2")).firstMatch.exists)
        let image = XCTAttachment(screenshot: app.screenshot()); image.lifetime = .keepAlways; add(image)
        for _ in 0..<4 { if toggle.isHittable { break }; app.swipeDown() }
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        XCTAssertTrue(firstSpeaker.waitForNonExistence(timeout: 5))
        XCTAssertTrue(text.exists)
    }
}
