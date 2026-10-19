import XCTest

@MainActor
final class ResearchReadbackTests: XCTestCase {
    private func launch() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication(); app.terminate(); app.launch()
        XCTAssertTrue(app.tabBars.buttons["Conversations"].firstMatch.waitForExistence(timeout: 25))
        return app
    }
    private func reveal(_ app: XCUIApplication, _ element: XCUIElement) {
        for _ in 0..<14 {
            if element.exists && element.isHittable { return }
            app.swipeUp()
        }
    }
    private func proof(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }
    func testSavedConversationTranscriptAndAnalyses() throws {
        guard let id = ProcessInfo.processInfo.environment["TRACE_TEST_CONVERSATION_ID"] else { throw XCTSkip("Controlled conversation required") }
        let app = launch()
        app.buttons["trace.conversations.refresh"].tap()
        let row = app.buttons["trace.conversation.\(id)"]
        XCTAssertTrue(row.waitForExistence(timeout: 20)); row.tap()
        XCTAssertTrue(app.staticTexts["Overview"].waitForExistence(timeout: 20))
        proof(app, "Saved conversation summary")
        let research = app.staticTexts["Documentary record"]
        reveal(app, research); XCTAssertTrue(research.exists)
        proof(app, "Saved research analysis readback")
        let commitments = app.staticTexts["Commitments"]
        reveal(app, commitments); XCTAssertTrue(commitments.exists)
        proof(app, "Saved ADHD Aid and commitments readback")
        for _ in 0..<14 { if app.segmentedControls.buttons["Transcript"].isHittable { break }; app.swipeDown() }
        app.segmentedControls.buttons["Transcript"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Maria")).firstMatch.waitForExistence(timeout: 15))
        proof(app, "Saved transcript readback")
    }
    func testAskAnswerAndCodebookExport() {
        let app = launch()
        app.tabBars.buttons["Research"].tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Ask saved analyses")).firstMatch.tap()
        let question = app.textFields["Question across thesis and group analyses"]
        XCTAssertTrue(question.waitForExistence(timeout: 15)); question.tap(); question.typeText("What recruitment and proposal commitments involve Maria?")
        app.buttons["Ask"].firstMatch.tap()
        let answer = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Answer ·")).firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 90))
        let sources = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Sources ·")).firstMatch
        reveal(app, sources); XCTAssertTrue(sources.exists)
        proof(app, "Real corpus answer and source citations")
        app.navigationBars.buttons.firstMatch.tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Codebook")).firstMatch.tap()
        app.buttons["Create a code"].tap()
        XCTAssertTrue(app.textFields["New code name"].waitForExistence(timeout: 20))
        let name = "TRACE UI Audit " + String(UUID().uuidString.prefix(6))
        app.textFields["New code name"].tap(); app.textFields["New code name"].typeText(name)
        app.buttons["Add code"].tap()
        app.navigationBars.buttons.firstMatch.tap()
        let code = app.staticTexts[name]; reveal(app, code); XCTAssertTrue(code.waitForExistence(timeout: 20))
        app.buttons["Export codebook as Markdown"].tap()
        XCTAssertTrue(app.navigationBars["Export Codebook"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Share Markdown file"].exists)
        proof(app, "Codebook creation and Markdown export")
        // Test record is removed through the authenticated API after the run.
    }
}
