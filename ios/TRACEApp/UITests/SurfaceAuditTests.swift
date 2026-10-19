import XCTest

/// Runs against the enrolled personal installation. No secrets or destructive resets.
@MainActor
final class SurfaceAuditTests: XCTestCase {
    private func launch() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate(); XCUIDevice.shared.press(.home); app.launch()
        XCTAssertTrue(app.tabBars.buttons["Conversations"].firstMatch.waitForExistence(timeout: 25))
        return app
    }
    private func proof(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func reveal(_ app: XCUIApplication, _ item: XCUIElement) {
        for _ in 0..<8 {
            if item.exists && item.isHittable { return }
            app.swipeUp()
        }
    }
    private func research(_ app: XCUIApplication, _ title: String) {
        app.tabBars.buttons["Research"].firstMatch.tap()
        let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
        reveal(app, row); XCTAssertTrue(row.waitForExistence(timeout: 15)); row.tap()
    }
    func testResearchSurfacesAndSearch() {
        let app = launch()
        research(app, "Search")
        let query = app.textFields["Search thesis and group analyses"]
        XCTAssertTrue(query.waitForExistence(timeout: 15)); query.tap(); query.typeText("surfaceauditnomatch9z7")
        XCTAssertTrue(app.staticTexts["No matches"].waitForExistence(timeout: 20))
        app.buttons["Clear search"].tap()
        XCTAssertTrue(app.staticTexts["Search across stored thesis and group analyses."].waitForExistence(timeout: 10))
        proof(app, "Search clear and no-match verified")
        app.navigationBars.buttons.firstMatch.tap()
        research(app, "Ask saved analyses")
        XCTAssertTrue(app.textFields["Question across thesis and group analyses"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Ask"].firstMatch.isEnabled)
        proof(app, "Ask empty-input guard")
        app.navigationBars.buttons.firstMatch.tap()
        research(app, "Group analysis")
        XCTAssertTrue(app.buttons["Run group analysis"].waitForExistence(timeout: 20))
        XCTAssertFalse(app.buttons["Run group analysis"].isEnabled)
        proof(app, "Group selection guard and saved groups")
        app.navigationBars.buttons.firstMatch.tap()
        research(app, "Codebook")
        app.buttons["Create a code"].tap()
        XCTAssertTrue(app.textFields["New code name"].waitForExistence(timeout: 20))
        XCTAssertFalse(app.buttons["Add code"].isEnabled)
        proof(app, "Codebook loaded and empty-input guard")
        app.navigationBars.buttons.firstMatch.tap()
        app.navigationBars.buttons.firstMatch.tap()
        research(app, "Patterns")
        XCTAssertTrue(app.navigationBars["Patterns"].waitForExistence(timeout: 20))
        XCTAssertFalse(app.staticTexts["Patterns unavailable"].exists)
        proof(app, "Patterns loaded")
    }
    func testSettingsUsageBackupAndHelp() {
        let app = launch()
        app.buttons["trace.settings"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Connected to TRACE")).firstMatch.waitForExistence(timeout: 20))
        app.buttons["How this works"].tap()
        XCTAssertTrue(app.navigationBars["How TRACE works"].waitForExistence(timeout: 10))
        app.buttons["What is the basic TRACE workflow?"].tap()
        proof(app, "Expanded workflow help")
        app.navigationBars.buttons.firstMatch.tap()
        app.buttons["trace.settings.privacy"].tap()
        XCTAssertTrue(app.navigationBars["Privacy and recording"].waitForExistence(timeout: 10))
        proof(app, "Privacy disclosure")
        app.navigationBars.buttons.firstMatch.tap()
        app.buttons["Usage"].tap()
        XCTAssertTrue(app.staticTexts["Spend and calls"].waitForExistence(timeout: 25))
        let zones = app.segmentedControls.firstMatch
        let original = zones.buttons.allElementsBoundByIndex.first { $0.isSelected }?.label
        for zone in ["Manila", "London", "Phoenix"] {
            zones.buttons[zone].tap()
            XCTAssertTrue(app.staticTexts["Spend and calls"].waitForExistence(timeout: 20))
        }
        if let original { zones.buttons[original].tap() }
        proof(app, "Usage reporting zones")
        app.navigationBars.buttons.firstMatch.tap()
        app.buttons["Reminders"].tap()
        XCTAssertTrue(app.switches["Remind me each day"].waitForExistence(timeout: 10))
        proof(app, "Reminder preferences")
        app.navigationBars.buttons.firstMatch.tap()
        app.buttons["Backup and restore"].tap()
        app.buttons["Create backup file"].tap()
        XCTAssertTrue(app.buttons["Share backup…"].waitForExistence(timeout: 90))
        XCTAssertFalse(app.staticTexts["Could not complete"].exists)
        proof(app, "Server backup export completed")
        app.buttons["Choose backup file"].tap()
        XCTAssertTrue(app.buttons["Cancel"].firstMatch.waitForExistence(timeout: 15))
        app.buttons["Cancel"].firstMatch.tap()
        proof(app, "Backup import picker cancelled without changing data")
    }
    func testPeopleCreateEditDeleteAndPlaceEditor() {
        let app = launch()
        let name = "TRACE Audit " + String(UUID().uuidString.prefix(6))
        app.tabBars.buttons["People"].firstMatch.tap()
        app.buttons["Add person"].tap()
        if !app.navigationBars["New person"].waitForExistence(timeout: 3) { app.buttons["Add person"].tap() }
        XCTAssertTrue(app.navigationBars["New person"].waitForExistence(timeout: 10))
        app.textFields["Name"].tap(); app.textFields["Name"].typeText(name)
        app.textFields["Role"].tap(); app.textFields["Role"].typeText("Temporary surface audit")
        app.buttons["Save"].tap()
        let person = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
        XCTAssertTrue(person.waitForExistence(timeout: 20)); reveal(app, person); person.tap()
        XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 10)); app.buttons["Edit"].tap()
        let role = app.textFields["Role"]
        XCTAssertTrue(role.waitForExistence(timeout: 10)); role.tap(); role.typeText(" verified")
        app.buttons["Save"].tap()
        let updated = app.buttons.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", name, "verified")).firstMatch
        XCTAssertTrue(updated.waitForExistence(timeout: 20)); updated.tap()
        proof(app, "Person create and edit persisted")
        let delete = app.buttons["Delete person"]
        reveal(app, delete); delete.tap(); app.buttons["Delete"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Places"].waitForExistence(timeout: 20))
        XCTAssertFalse(person.exists)
        app.buttons["Places"].tap()
        XCTAssertTrue(app.buttons["Add place"].waitForExistence(timeout: 10)); app.buttons["Add place"].tap()
        XCTAssertTrue(app.navigationBars["New place"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.textFields["Latitude"].exists); XCTAssertTrue(app.textFields["Longitude"].exists)
        proof(app, "Place editor and corrected add label")
        app.buttons["Cancel"].tap()
    }
    func testTodayAndPausedCapture() {
        let app = launch()
        app.tabBars.buttons["Today"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 20))
        XCTAssertFalse(app.staticTexts["Connection issue"].exists)
        proof(app, "Today loaded")
        app.tabBars.buttons["Capture"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Resume capture"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.otherElements["trace.capture.mode"].exists || app.staticTexts["trace.capture.mode"].exists)
        proof(app, "Capture paused and device state")
    }
    func testQueuedRecordingRecoversAndLocalAudioPlays() {
        let app = launch()
        app.tabBars.buttons["Capture"].tap()
        let status = app.descendants(matching: .any).matching(identifier: "trace.capture.uploads").firstMatch
        reveal(app, status)
        let saved = NSPredicate { _, _ in status.exists && status.label.filter(\.isNumber) == "0" }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: saved, object: nil)], timeout: 180), .completed)
        let mode = app.descendants(matching: .any).matching(identifier: "trace.capture.mode").firstMatch
        XCTAssertTrue(mode.label.contains("Paused"))
        proof(app, "Queued recording recovered after storage configuration fix")
        let audio = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Saved audio ·")).firstMatch
        reveal(app, audio); XCTAssertTrue(audio.exists); audio.tap()
        let play = app.buttons["Play"].firstMatch
        reveal(app, play); XCTAssertTrue(play.waitForExistence(timeout: 15)); play.tap()
        let stop = app.buttons["Stop"].firstMatch
        XCTAssertTrue(stop.waitForExistence(timeout: 15)); stop.tap()
        proof(app, "Local Opus audio decoded and playback stopped")
        let prepare = app.buttons["Prepare WAV to share"].firstMatch
        reveal(app, prepare); XCTAssertTrue(prepare.exists); prepare.tap()
        XCTAssertTrue(app.buttons["Share WAV"].firstMatch.waitForExistence(timeout: 25))
        proof(app, "WAV export prepared")
    }

}
