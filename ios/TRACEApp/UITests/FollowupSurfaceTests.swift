import XCTest

@MainActor
final class FollowupSurfaceTests: XCTestCase {
    private func settings(_ app: XCUIApplication, _ title: String) {
        continueAfterFailure = false
        app.terminate(); XCUIDevice.shared.press(.home); app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
        XCTAssertTrue(app.buttons["trace.settings"].waitForExistence(timeout: 25))
        app.buttons["trace.settings"].coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)).tap()
        if !app.navigationBars["Settings"].waitForExistence(timeout: 4) { app.buttons["trace.settings"].coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)).tap() }
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons[title].waitForExistence(timeout: 20)); app.buttons[title].tap()
    }
    private func proof(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }

    private func setReminderTime(_ app: XCUIApplication, hour: Int, minute: Int) {
        app.datePickers.firstMatch.tap()
        XCTAssertTrue(app.pickerWheels.firstMatch.waitForExistence(timeout: 10))
        app.pickerWheels.element(boundBy: 0).adjust(toPickerWheelValue: String(format: "%02d", hour))
        app.pickerWheels.element(boundBy: 1).adjust(toPickerWheelValue: String(format: "%02d", minute))
        app.buttons["dismiss popup"].tap()
    }
    func testScheduledReminderDeliveryAndOpen() { scheduledReminder(coldLaunch: false) }
    func testScheduledReminderAfterTermination() { scheduledReminder(coldLaunch: true) }
    func testScheduledReminderInForeground() { scheduledReminder(coldLaunch: false, background: false) }
    private func scheduledReminder(coldLaunch: Bool, background: Bool = true) {
        let app = XCUIApplication(); settings(app, "Reminders")
        let toggle = app.switches["Remind me each day"]
        if toggle.value as? String == "0" { toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap() }
        let board = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if board.buttons["Allow"].waitForExistence(timeout: 2) { board.buttons["Allow"].tap() }
        XCTAssertEqual(toggle.value as? String, "1")
        defer {
            settings(app, "Reminders")
            setReminderTime(app, hour: 21, minute: 0)
            let enabled = app.switches["Remind me each day"]
            if enabled.value as? String == "1" { enabled.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap() }
        }
        let target = Date().addingTimeInterval(130)
        let parts = Calendar.current.dateComponents([.hour, .minute], from: target)
        setReminderTime(app, hour: parts.hour!, minute: parts.minute!)
        proof(app, "Temporary reminder scheduled through settings")
        if background { XCUIDevice.shared.press(.home) }
        else { XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15)) }
        if coldLaunch {
            app.terminate()
            XCTAssertTrue(app.wait(for: .notRunning, timeout: 15))
            print("TRACE REMINDER CHECK: APP TERMINATED BEFORE DELIVERY")
        }
        print("TRACE REMINDER CHECK: WAITING FOR SCHEDULED DELIVERY")
        let reminder = board.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "TRACE · Daily review")).firstMatch
        if !reminder.waitForExistence(timeout: 160) && background {
            board.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.01)).press(forDuration: 0.1, thenDragTo: board.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.75)))
        }
        XCTAssertTrue(reminder.waitForExistence(timeout: 15))
        proof(board, "Scheduled TRACE reminder delivered")
        reminder.tap()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
        XCTAssertTrue(app.tabBars.buttons["Today"].isSelected, "Daily-review notification must open Today")
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 15))
        proof(app, "Daily reminder opens Today")
    }
    func testBackupSaveToFilesAndRestore() {
        let app = XCUIApplication(); settings(app, "Backup and restore")
        app.buttons["Create backup file"].tap()
        XCTAssertTrue(app.buttons["Share backup…"].waitForExistence(timeout: 90)); app.buttons["Share backup…"].tap()
        let save = app.cells["Save to Files"].firstMatch
        for _ in 0..<5 { if save.exists && save.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(save.waitForExistence(timeout: 15)); save.tap()
        XCTAssertTrue(app.buttons["Browse"].waitForExistence(timeout: 20)); app.buttons["Browse"].tap()
        let local = app.cells.matching(NSPredicate(format: "label CONTAINS %@", "On My iPhone")).firstMatch
        XCTAssertTrue(local.waitForExistence(timeout: 15)); local.tap()
        let downloads = app.cells["Downloads, Folder"]
        for _ in 0..<8 { if downloads.exists && downloads.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(downloads.exists); downloads.tap()
        XCTAssertTrue(app.staticTexts["Downloads"].firstMatch.waitForExistence(timeout: 15))
        let filename = app.textFields["DOCPicker.filenameTextField"].value as! String
        XCTAssertTrue(app.buttons["Save"].waitForExistence(timeout: 15)); app.buttons["Save"].tap()
        XCTAssertTrue(app.buttons["Choose backup file"].waitForExistence(timeout: 20))
        print("TRACE BACKUP CHECK: FILE SAVED " + filename)
        app.buttons["Choose backup file"].tap()
        let file = app.cells.matching(NSPredicate(format: "label BEGINSWITH %@", filename)).firstMatch
        if !file.waitForExistence(timeout: 5) {
            if app.buttons["Browse"].firstMatch.exists { app.buttons["Browse"].firstMatch.tap() }
            let localFolder = app.cells.matching(NSPredicate(format: "label CONTAINS %@", "On My iPhone")).firstMatch
            if localFolder.waitForExistence(timeout: 5) { localFolder.tap() }
            let downloadsFolder = app.cells["Downloads, Folder"]
            for _ in 0..<8 { if downloadsFolder.exists && downloadsFolder.isHittable { break }; app.swipeUp() }
            if downloadsFolder.exists { downloadsFolder.tap() }
        }
        XCTAssertTrue(file.waitForExistence(timeout: 15)); file.tap()
        XCTAssertTrue(app.alerts.buttons["Restore"].waitForExistence(timeout: 15))
        proof(app, "Full backup import confirmation")
        app.alerts.buttons["Restore"].tap()
        let restored = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Restore merged into the server.")).firstMatch
        XCTAssertTrue(restored.waitForExistence(timeout: 90))
        proof(app, "Full Files backup restore completed")
    }
    @discardableResult
    private func saveExportToDownloads(_ app: XCUIApplication, extension suffix: String) -> String {
        let save = app.cells["Save to Files"].firstMatch
        for _ in 0..<5 { if save.exists && save.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(save.waitForExistence(timeout: 15)); save.tap()
        // Files remembers the last destination. A picker already in local Downloads has no Browse button.
        XCTAssertTrue(app.textFields["DOCPicker.filenameTextField"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["Save"].firstMatch.waitForExistence(timeout: 20))
        proof(app, "Files export destination picker")
        if app.buttons["Browse"].firstMatch.waitForExistence(timeout: 2) {
            XCTAssertTrue(app.buttons["Browse"].firstMatch.waitForExistence(timeout: 20)); app.buttons["Browse"].firstMatch.tap()
            let local = app.cells.matching(NSPredicate(format: "label CONTAINS %@", "On My iPhone")).firstMatch
            XCTAssertTrue(local.waitForExistence(timeout: 15)); local.tap()
            let downloads = app.cells["Downloads, Folder"].firstMatch
            for _ in 0..<8 { if downloads.exists && downloads.isHittable { break }; app.swipeUp() }
            XCTAssertTrue(downloads.exists); downloads.tap()
        }
        // Otherwise the picker retains the local Downloads destination established earlier in this pass.
        // Keep its screenshot for visual location verification; iOS exposes the title as a menu, not static text.
        let filename = app.textFields["DOCPicker.filenameTextField"]
        XCTAssertTrue(filename.waitForExistence(timeout: 15))
        // Files hides known extensions in its filename editor. The app supplies the typed export URL.
        XCTAssertFalse((filename.value as? String)?.isEmpty ?? true)
        let savedName = filename.value as! String
        proof(app, "Export ready in local Downloads " + suffix)
        XCTAssertTrue(app.buttons["Save"].waitForExistence(timeout: 15)); app.buttons["Save"].tap()
        XCTAssertFalse(app.textFields["DOCPicker.filenameTextField"].waitForExistence(timeout: 3))
        proof(app, "Export saved to local Files " + suffix)
        return savedName
    }
    func testCodebookMarkdownSavedToFiles() {
        continueAfterFailure = false
        let app = XCUIApplication(); app.terminate(); XCUIDevice.shared.press(.home); app.launch()
        XCTAssertTrue(app.tabBars.buttons["Research"].firstMatch.waitForExistence(timeout: 25)); app.tabBars.buttons["Research"].firstMatch.tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Codebook")).firstMatch.tap()
        app.buttons["Suggest codes from an analysis"].tap()
        XCTAssertTrue(app.buttons["Suggest codes and excerpts"].waitForExistence(timeout: 20), "Saved thesis analyses must reload through the Codebook API")
        app.navigationBars.buttons.firstMatch.tap()
        app.buttons["Create a code"].tap()
        XCTAssertTrue(app.textFields["New code name"].waitForExistence(timeout: 20))
        let temporaryName = "TRACE Files Export " + String(UUID().uuidString.prefix(6))
        app.textFields["New code name"].tap(); app.textFields["New code name"].typeText(temporaryName); app.buttons["Add code"].tap()
        app.navigationBars.buttons.firstMatch.tap()
        let export = app.buttons["Export codebook as Markdown"]
        XCTAssertTrue(export.waitForExistence(timeout: 20))
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: export)], timeout: 20), .completed)
        export.tap()
        XCTAssertTrue(app.buttons["Share Markdown file"].waitForExistence(timeout: 20)); app.buttons["Share Markdown file"].tap()
        saveExportToDownloads(app, extension: ".md")
        app.terminate(); XCUIDevice.shared.press(.home); app.launch()
        XCTAssertTrue(app.tabBars.buttons["Research"].firstMatch.waitForExistence(timeout: 25)); app.tabBars.buttons["Research"].firstMatch.tap()
        let codebook = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Codebook")).firstMatch
        XCTAssertTrue(codebook.waitForExistence(timeout: 20)); codebook.tap()
        if !app.navigationBars["Codebook"].waitForExistence(timeout: 3) { codebook.tap() }
        XCTAssertTrue(app.navigationBars["Codebook"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["Create a code"].waitForExistence(timeout: 20))
        let delete = app.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@ AND label CONTAINS[c] %@", "Delete code", String(temporaryName.suffix(6)))).firstMatch
        _ = delete.waitForExistence(timeout: 15)
        for _ in 0..<12 { if delete.exists && delete.isHittable { break }; app.swipeUp() }
        proof(app, "Saved Codebook record reloaded after app restart")
        print("TRACE EXPORT CLEANUP: " + app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Files Export")).allElementsBoundByIndex.map(\.label).joined(separator: " | "))
        XCTAssertTrue(delete.exists); delete.tap()
        XCTAssertTrue(app.buttons["Delete code and excerpts"].waitForExistence(timeout: 10)); app.buttons["Delete code and excerpts"].tap()
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: delete)], timeout: 20), .completed)
    }
    func testSavedRecordingWAVSavedToFiles() {
        continueAfterFailure = false
        let app = XCUIApplication(); app.terminate(); XCUIDevice.shared.press(.home); app.launch()
        XCTAssertTrue(app.tabBars.buttons["Capture"].firstMatch.waitForExistence(timeout: 25)); app.tabBars.buttons["Capture"].firstMatch.tap()
        let audio = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Saved audio ·")).firstMatch
        for _ in 0..<10 { if audio.exists && audio.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(audio.exists); audio.tap()
        let prepare = app.buttons["Prepare WAV to share"].firstMatch
        for _ in 0..<10 { if prepare.exists && prepare.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(prepare.exists); prepare.tap()
        XCTAssertTrue(app.buttons["Share WAV"].firstMatch.waitForExistence(timeout: 25)); app.buttons["Share WAV"].firstMatch.tap()
        saveExportToDownloads(app, extension: ".wav")
    }

    func testRemovePreviousTemporaryExportCode() {
        continueAfterFailure = false
        let app = XCUIApplication(); app.terminate(); XCUIDevice.shared.press(.home); app.launch()
        XCTAssertTrue(app.tabBars.buttons["Research"].firstMatch.waitForExistence(timeout: 25)); app.tabBars.buttons["Research"].firstMatch.tap()
        let codebook = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Codebook")).firstMatch
        XCTAssertTrue(codebook.waitForExistence(timeout: 20)); codebook.tap()
        XCTAssertTrue(app.buttons["Suggest codes and excerpts"].waitForExistence(timeout: 20))
        for _ in 0..<5 {
            let temporary = app.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", "Delete code TRACE Files Export")).firstMatch
            for _ in 0..<12 { if temporary.exists && temporary.isHittable { break }; app.swipeUp() }
            if !temporary.exists { break }
            let exact = app.buttons[temporary.label].firstMatch
            exact.tap()
            XCTAssertTrue(app.buttons["Delete code and excerpts"].firstMatch.waitForExistence(timeout: 10)); app.buttons["Delete code and excerpts"].firstMatch.tap()
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: exact)], timeout: 20), .completed)
        }
    }
    func testBackupImportRejectsWrongNamespaceShape() {
        let app = XCUIApplication(); settings(app, "Backup and restore")
        app.buttons["Create backup file"].tap()
        XCTAssertTrue(app.buttons["Share backup…"].waitForExistence(timeout: 90))
        // The host replaces this newly generated temporary export with a controlled malformed fixture.
        // The original server data is only read; this test never confirms a restore.
        print("TRACE IMPORT VALIDATION: EXPORT READY FOR FIXTURE")
        Thread.sleep(forTimeInterval: 35)
        app.buttons["Share backup…"].tap()
        let filename = saveExportToDownloads(app, extension: ".json")
        XCTAssertTrue(app.buttons["Choose backup file"].waitForExistence(timeout: 20)); app.buttons["Choose backup file"].tap()
        let file = app.cells.matching(NSPredicate(format: "label BEGINSWITH %@", filename)).firstMatch
        XCTAssertTrue(file.waitForExistence(timeout: 20)); file.tap()
        let rejected = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "has the wrong format. No records were restored.")).firstMatch
        XCTAssertTrue(rejected.waitForExistence(timeout: 30))
        XCTAssertFalse(app.alerts.buttons["Restore"].exists)
        proof(app, "Malformed backup rejected before restore confirmation")
    }
    func testPrepareLockedScreenReminder() {
        let app = XCUIApplication(); settings(app, "Reminders")
        let toggle = app.switches["Remind me each day"]
        if toggle.value as? String == "0" { toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap() }
        XCTAssertEqual(toggle.value as? String, "1")
        let parts = Calendar.current.dateComponents([.hour, .minute], from: Date().addingTimeInterval(180))
        setReminderTime(app, hour: parts.hour!, minute: parts.minute!)
        proof(app, "Reminder scheduled for manual locked-screen check")
        XCUIDevice.shared.press(.home)
        print("TRACE LOCKED REMINDER: READY TO LOCK")
    }
    func testOpenLockedScreenReminderAndRestoreDefaults() {
        continueAfterFailure = false
        let app = XCUIApplication()
        let board = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        XCUIDevice.shared.press(.home)
        board.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.01)).press(forDuration: 0.1, thenDragTo: board.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.75)))
        let reminder = board.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "TRACE · Daily review")).firstMatch
        XCTAssertTrue(reminder.waitForExistence(timeout: 20))
        proof(board, "Notification retained after manual locked-screen interval")
        reminder.tap()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
        XCTAssertTrue(app.tabBars.buttons["Today"].firstMatch.isSelected)
        proof(app, "Locked-screen reminder opens Today after unlocking")
        settings(app, "Reminders")
        setReminderTime(app, hour: 21, minute: 0)
        let toggle = app.switches["Remind me each day"]
        if toggle.value as? String == "1" { toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap() }
    }

    func testRestoreReminderDefaults() {
        continueAfterFailure = false
        let app = XCUIApplication(); settings(app, "Reminders")
        setReminderTime(app, hour: 21, minute: 0)
        let toggle = app.switches["Remind me each day"]
        if toggle.value as? String == "1" { toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap() }
        XCTAssertEqual(toggle.value as? String, "0")
        proof(app, "Reminder defaults restored after locked-screen check")
    }

    func testDeleteControlledMalformedBackupFile() throws {
        continueAfterFailure = false
        guard let filename = ProcessInfo.processInfo.environment["TRACE_TEST_BAD_BACKUP_FILENAME"] else { throw XCTSkip("Controlled fixture filename required") }
        let app = XCUIApplication(bundleIdentifier: "com.apple.DocumentsApp")
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15))
        let close = app.buttons.matching(NSPredicate(format: "label == %@ OR label == %@", "Close", "Done")).firstMatch
        if close.exists && close.isHittable { close.tap() }
        else { app.coordinate(withNormalizedOffset: CGVector(dx: 0.075, dy: 0.085)).tap() }
        let recents = app.buttons["Recents"].firstMatch
        if recents.exists { recents.tap() }
        let candidate = app.cells.matching(NSPredicate(format: "label BEGINSWITH %@", filename)).firstMatch
        if !candidate.waitForExistence(timeout: 5) {
            if app.tabBars.buttons["Browse"].firstMatch.exists { app.tabBars.buttons["Browse"].firstMatch.tap() }
            else if app.buttons["Browse"].firstMatch.exists { app.buttons["Browse"].firstMatch.tap() }
            let local = app.cells.matching(NSPredicate(format: "label CONTAINS %@", "On My iPhone")).firstMatch
            if local.waitForExistence(timeout: 5) { local.tap() }
            let downloads = app.cells["Downloads, Folder"].firstMatch
            for _ in 0..<8 { if downloads.exists && downloads.isHittable { break }; app.swipeUp() }
            if downloads.exists { downloads.tap() }
        }
        let file = app.cells.matching(NSPredicate(format: "label BEGINSWITH %@", filename)).firstMatch
        XCTAssertTrue(file.waitForExistence(timeout: 20))
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: file)], timeout: 15), .completed)
        file.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.5)).press(forDuration: 1.5)
        let delete = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Delete")).firstMatch
        XCTAssertTrue(delete.waitForExistence(timeout: 10)); delete.tap()
        if app.alerts.buttons["Delete"].firstMatch.waitForExistence(timeout: 3) { app.alerts.buttons["Delete"].firstMatch.tap() }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: file)], timeout: 20), .completed)
        XCUIDevice.shared.press(.home)
    }

    func testExistingValidBackupStillOffersRestoreAndCancel() {
        let app = XCUIApplication(); settings(app, "Backup and restore")
        app.buttons["Choose backup file"].tap()
        let file = app.cells.matching(NSPredicate(format: "label BEGINSWITH %@", "trace-backup-2026-10-01-0330")).firstMatch
        for _ in 0..<10 { if file.exists && file.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(file.waitForExistence(timeout: 15)); file.tap()
        XCTAssertTrue(app.alerts["Restore 26 records?"].waitForExistence(timeout: 30))
        proof(app, "Existing complete backup remains valid with new import checks")
        app.alerts.buttons["Cancel"].tap()
        XCTAssertFalse(app.alerts.buttons["Restore"].exists)
    }

}
