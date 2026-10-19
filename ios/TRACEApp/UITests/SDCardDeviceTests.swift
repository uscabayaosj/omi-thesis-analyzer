import XCTest
@MainActor
final class SDCardDeviceTests:XCTestCase {
    func testPauseBoundaryDrainRetainsFinalFrames() throws {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launch()
        XCTAssertTrue(app.tabBars.buttons["Capture"].firstMatch.waitForExistence(timeout: 15))
        app.tabBars.buttons["Capture"].firstMatch.tap()
        let connection = app.descendants(matching: .any).matching(identifier: "trace.capture.connection").firstMatch
        let connected = NSPredicate { _,_ in connection.exists && connection.label.contains("Connected") }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: connected, object: nil)], timeout: 30), .completed)
        for cycle in 1...2 {
            let resume = app.buttons["Resume capture"]
            let ready = NSPredicate { _,_ in resume.exists && resume.isEnabled }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: nil)], timeout: 60), .completed)
            resume.tap(); print("TRACE_BOUNDARY_RECORDING_\(cycle)")
            Thread.sleep(forTimeInterval: 5)
            let pause = app.buttons["Pause capture"]
            XCTAssertTrue(pause.exists); pause.tap()
            print("TRACE_BOUNDARY_PAUSE_\(cycle)")
            XCTAssertTrue(resume.waitForExistence(timeout: 6), "Pause must wait for drain and final writes")
            let error = app.descendants(matching: .any).matching(identifier: "trace.capture.error").firstMatch
            XCTAssertFalse(error.exists && error.label.contains("settlement could not be verified"), error.label)
            let attachment = XCTAttachment(string: app.debugDescription)
            attachment.name = "Pause boundary cycle \(cycle)"; attachment.lifetime = .keepAlways; add(attachment)
        }
    }
    func testRetryRetainedTranscriptAndWholeAudio() throws {
        continueAfterFailure=false
        let app=XCUIApplication();app.launch();XCTAssertTrue(app.tabBars.buttons["Capture"].firstMatch.waitForExistence(timeout:15));app.tabBars.buttons["Capture"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Resume capture"].waitForExistence(timeout:10))
        let retry=app.buttons["Retry processing"]
        for _ in 0..<10{if retry.isHittable{break};app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.75)).press(forDuration:0.05,thenDragTo:app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.45)))}
        XCTAssertTrue(retry.waitForExistence(timeout:15));retry.tap()
        let status=app.descendants(matching:.any).matching(identifier:"trace.capture.status").firstMatch
        let saved=NSPredicate{_,_ in status.label.contains("Conversation and summary saved")}
        XCTAssertEqual(XCTWaiter.wait(for:[XCTNSPredicateExpectation(predicate:saved,object:nil)],timeout:300),.completed,status.label)
        app.buttons["Open saved conversation"].tap()
        XCTAssertTrue(app.segmentedControls.firstMatch.waitForExistence(timeout:20))
        let export=app.buttons["Export whole conversation"],prepare=app.buttons["Prepare whole conversation audio"]
        for _ in 0..<8{if export.isHittable || prepare.isHittable{break};app.swipeUp()}
        if prepare.isHittable{prepare.tap()}
        XCTAssertTrue(export.waitForExistence(timeout:90))
        let a=XCTAttachment(string:app.debugDescription);a.name="Recovered SD conversation and audio";a.lifetime = .keepAlways;add(a)
        app.buttons["Play conversation"].tap();XCTAssertTrue(app.buttons["Stop playback"].waitForExistence(timeout:5));app.buttons["Stop playback"].tap();export.tap()
        XCTAssertTrue(app.cells["Save to Files"].waitForExistence(timeout:15))
    }
    func testResumeRetainedSDImport() throws {
        continueAfterFailure=false
        let app=XCUIApplication();app.launch()
        XCTAssertTrue(app.tabBars.buttons["Capture"].firstMatch.waitForExistence(timeout:15));app.tabBars.buttons["Capture"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Resume capture"].waitForExistence(timeout:10),"Import-only verification must remain paused")
        let status=app.descendants(matching:.any).matching(identifier:"trace.capture.sd.status").firstMatch
        let button=app.buttons["trace.capture.sd.import"]
        for _ in 0..<10 {if button.isHittable{break};app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.75)).press(forDuration:0.05,thenDragTo:app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.45)))}
        func wait(_ seconds:TimeInterval,_ condition:@escaping ()->Bool)->Bool {XCTWaiter.wait(for:[XCTNSPredicateExpectation(predicate:NSPredicate{_,_ in condition()},object:nil)],timeout:seconds) == .completed}
        XCTAssertTrue(wait(20){button.isEnabled});button.tap();print("TRACE_SD_RETAINED_IMPORT_STARTED")
        XCTAssertTrue(wait(600){button.isEnabled && status.label.hasPrefix("Imported ") && !status.label.contains("remaining files retained")},status.label)
        let first=status.label;XCTAssertFalse(first.contains("Imported 0 "));print("TRACE_SD_RETAINED_IMPORT_FINISHED: \(first)")
        let a=XCTAttachment(string:app.debugDescription);a.name="Retained SD import completion";a.lifetime = .keepAlways;add(a)
        button.tap();XCTAssertTrue(wait(90){button.isEnabled && status.label.hasPrefix("Imported ") && !status.label.contains("remaining files retained")},status.label);XCTAssertEqual(first,status.label)
        let toggle=app.switches["trace.capture.sd.fallback"]
        for _ in 0..<5{if toggle.isHittable{break};app.swipeDown()}
        if (toggle.value as? String)=="1"{toggle.coordinate(withNormalizedOffset:CGVector(dx:0.92,dy:0.5)).tap()}
        XCTAssertTrue(wait(10){status.label.contains("fallback disabled")},status.label)
    }
    func testPausedCardReadback() throws {
        continueAfterFailure=false
        let app=XCUIApplication();app.launch();XCTAssertTrue(app.tabBars.buttons["Capture"].firstMatch.waitForExistence(timeout:15));app.tabBars.buttons["Capture"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Resume capture"].waitForExistence(timeout:10),"Physical readback requires paused capture")
        let connection=app.descendants(matching:.any).matching(identifier:"trace.capture.connection").firstMatch
        if !connection.label.contains("Connected") {
            app.buttons["Find DevKit2"].tap()
            let candidate=app.buttons.matching(NSPredicate(format:"identifier BEGINSWITH %@","trace.capture.device.")).firstMatch
            if candidate.waitForExistence(timeout:15){candidate.tap()}
        }
        let connected=NSPredicate{_,_ in connection.exists && connection.label.contains("Connected")}
        XCTAssertEqual(XCTWaiter.wait(for:[XCTNSPredicateExpectation(predicate:connected,object:nil)],timeout:30),.completed)
        let status=app.descendants(matching:.any).matching(identifier:"trace.capture.sd.status").firstMatch
        for _ in 0..<8 {if status.isHittable{break};app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.75)).press(forDuration:0.05,thenDragTo:app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.45)))}
        let inspection=NSPredicate{_,_ in status.exists && (status.label.contains("SD card ready") || status.label.contains("SD card unavailable"))}
        _=XCTWaiter.wait(for:[XCTNSPredicateExpectation(predicate:inspection,object:nil)],timeout:12)
        let a=XCTAttachment(string:app.debugDescription);a.name="Physical SD card status";a.lifetime = .keepAlways;add(a)
        let shot=XCTAttachment(screenshot:app.screenshot());shot.name="Physical SD card status screenshot";shot.lifetime = .keepAlways;add(shot)
        XCTAssertTrue(status.label.contains("SD card ready"),"Card status: \(status.label)")
    }
    func testPhysicalOfflineRecordingAndIdempotentImport() throws {
        continueAfterFailure=false
        let app=XCUIApplication();app.launchArguments=["--trace-sd-test"];app.launch()
        XCTAssertTrue(app.tabBars.buttons["Capture"].firstMatch.waitForExistence(timeout:15));app.tabBars.buttons["Capture"].firstMatch.tap()
        defer {
            for _ in 0..<6 { if app.buttons["Pause capture"].isHittable {app.buttons["Pause capture"].tap();break};app.swipeDown() }
        }
        func element(_ id:String)->XCUIElement {app.descendants(matching:.any).matching(identifier:id).firstMatch}
        func reveal(_ e:XCUIElement, up:Bool=true) {for _ in 0..<7 {if e.isHittable{return};if up{app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.75)).press(forDuration:0.05,thenDragTo:app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.45)))}else{app.swipeDown()}}}
        func wait(_ seconds:TimeInterval,_ condition:@escaping ()->Bool)->Bool {XCTWaiter.wait(for:[XCTNSPredicateExpectation(predicate:NSPredicate{_,_ in condition()},object:nil)],timeout:seconds) == .completed}
        let status=element("trace.capture.sd.status");reveal(status)
        XCTAssertTrue(wait(20){status.label.contains("SD card ready") || status.label.contains("SD fallback enabled")},status.label)
        let toggle=app.switches["trace.capture.sd.fallback"];reveal(toggle)
        XCTAssertTrue(wait(10){toggle.isEnabled},"SD toggle must be enabled before tapping")
        if (toggle.value as? String)=="0"{toggle.coordinate(withNormalizedOffset:CGVector(dx:0.92,dy:0.5)).tap()}
        XCTAssertTrue(wait(10){status.label.contains("SD fallback enabled")},status.label)
        let resume=app.buttons["Resume capture"];reveal(resume,up:false);XCTAssertTrue(resume.isEnabled);resume.tap()
        print("TRACE_SD_LIVE_STARTED")
        Thread.sleep(forTimeInterval:6)
        let interrupt=app.buttons["Interrupt BLE for device test"];reveal(interrupt);XCTAssertTrue(interrupt.isHittable);interrupt.tap()
        let connection=element("trace.capture.connection")
        XCTAssertTrue(wait(10){!connection.label.contains("Connected")},"Real BLE disconnect required")
        print("TRACE_SD_OFFLINE_STARTED")
        XCTAssertTrue(wait(60){connection.label.contains("Connected")},"Real BLE reconnect required")
        print("TRACE_SD_RECONNECTED")
        let pause=app.buttons["Pause capture"];reveal(pause,up:false);XCTAssertTrue(pause.isEnabled);pause.tap()
        let importButton=app.buttons["trace.capture.sd.import"];reveal(importButton)
        XCTAssertTrue(wait(15){importButton.isEnabled});importButton.tap()
        XCTAssertTrue(wait(300){importButton.isEnabled && status.label.hasPrefix("Imported ") && !status.label.contains("remaining files retained")},status.label)
        let first=status.label
        XCTAssertFalse(first.contains("Imported 0 "),first)
        // Earlier interrupted originals are intentionally retained on the card.
        // Independently inspect new files to qualify this run's sealed recordings.
        let a=XCTAttachment(string:app.debugDescription);a.name="Physical SD import completion";a.lifetime = .keepAlways;add(a)
        print("TRACE_SD_IMPORTED: \(first)")
        XCTAssertTrue(importButton.isEnabled);importButton.tap()
        XCTAssertTrue(wait(60){importButton.isEnabled && status.label.hasPrefix("Imported ") && !status.label.contains("remaining files retained")},status.label)
        XCTAssertEqual(status.label,first,"Repeat import must preserve originals and reuse chunk identities")
        let a2=XCTAttachment(string:app.debugDescription);a2.name="Repeated SD import completion";a2.lifetime = .keepAlways;add(a2)
        if (toggle.value as? String)=="1"{reveal(toggle);toggle.coordinate(withNormalizedOffset:CGVector(dx:0.92,dy:0.5)).tap()}
        XCTAssertTrue(wait(10){status.label.contains("fallback disabled")},status.label)
    }

    func testPausedSDServiceRediscovery() throws {
        continueAfterFailure=false
        let app=XCUIApplication();app.launchArguments=["--trace-sd-test"];app.launch();XCTAssertTrue(app.tabBars.buttons["Capture"].firstMatch.waitForExistence(timeout:15));app.tabBars.buttons["Capture"].firstMatch.tap();XCTAssertTrue(app.buttons["Resume capture"].waitForExistence(timeout:10))
        let b=app.buttons["Interrupt BLE for device test"]
        for _ in 0..<6{if b.isHittable{break};app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.75)).press(forDuration:0.05,thenDragTo:app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.45)))}
        XCTAssertTrue(b.isHittable);b.tap();print("TRACE_SD_STATUS_DISCONNECTED_WHILE_PAUSED")
        Thread.sleep(forTimeInterval:45)
        let status=app.descendants(matching:.any).matching(identifier:"trace.capture.sd.status").firstMatch
        for _ in 0..<6{if status.isHittable{break};app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.75)).press(forDuration:0.05,thenDragTo:app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.45)))}
        let a=XCTAttachment(string:app.debugDescription);a.name="SD rediscovery after paused connection reset";a.lifetime = .keepAlways;add(a)
        XCTAssertTrue(status.label.contains("SD card ready"),status.label)
    }

}
