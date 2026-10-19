import XCTest

final class VoiceRecognitionUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }
    func testVoiceSetupRequiresAConfirmedSampleBeforeEnabling() {
        let app = XCUIApplication(); app.launchArguments = ["--trace-ui-fixtures"]; app.launch()
        XCTAssertTrue(app.buttons["trace.settings"].waitForExistence(timeout:20));app.buttons["trace.settings"].tap()
        let voices = app.buttons["trace.settings.voices"]
        XCTAssertTrue(voices.waitForExistence(timeout:10));voices.tap()
        XCTAssertTrue(app.staticTexts["No reference voices saved."].waitForExistence(timeout:10))
        XCTAssertFalse(app.switches["Recognize reference voices"].isEnabled)
        app.buttons["trace.voices.recordSelf"].tap()
        XCTAssertTrue(app.buttons["trace.voices.record"].waitForExistence(timeout:10))
        XCTAssertFalse(app.buttons["trace.voices.save"].exists)
    }
    func testSuggestedIdentityAndReferenceReviewStayOptional() {
        let app = XCUIApplication();app.launchArguments=["--trace-ui-fixtures","--trace-ui-voices"];app.launch()
        let row = app.buttons["trace.conversation.fixture-conversation"]
        XCTAssertTrue(row.waitForExistence(timeout:20));row.tap();app.segmentedControls.buttons["Transcript"].tap()
        let toggle = app.switches["trace.transcript.estimatedSpeakers"]
        for _ in 0..<8 {if toggle.isHittable {break}; app.swipeUp()}
        app.swipeUp()
        XCTAssertFalse(app.staticTexts["Possibly you"].exists)
        toggle.coordinate(withNormalizedOffset:CGVector(dx:0.9,dy:0.5)).tap()
        for _ in 0..<4 {if app.staticTexts["Possibly you"].exists {break};app.swipeUp()}
        XCTAssertTrue(app.staticTexts["Possibly you"].waitForExistence(timeout:5))
        XCTAssertTrue(app.buttons["Identify or correct speaker"].exists)
        let review = app.buttons["trace.transcript.voiceSamples"]
        for _ in 0..<4 {if review.isHittable {break};app.swipeDown()}
        XCTAssertTrue(review.exists)
    }
}
