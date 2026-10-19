import XCTest

@MainActor
final class RecoveryReleaseTests: XCTestCase {
    func testPausedOversizedQueueRecovery() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.activate()
        XCTAssertTrue(app.tabBars.buttons["Capture"].waitForExistence(timeout: 20))
        app.tabBars.buttons["Capture"].tap()
        let proof = XCTAttachment(screenshot: app.screenshot())
        proof.name = "Recovery Capture initial state"
        proof.lifetime = .keepAlways
        add(proof)
        let uploads = app.descendants(matching: .any).matching(identifier: "trace.capture.uploads").firstMatch
        let mode = app.descendants(matching: .any).matching(identifier: "trace.capture.mode").firstMatch
        for _ in 0..<4 {
            if uploads.exists && uploads.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(mode.label.contains("Paused"), mode.label)
        let drained = NSPredicate { _, _ in uploads.exists && Int(uploads.label.filter { $0.isNumber }) == 0 }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: drained, object: nil)], timeout: 180), .completed, app.debugDescription)
        XCTAssertTrue(mode.label.contains("Paused"))
        let final = XCTAttachment(screenshot: app.screenshot())
        final.name = "Recovery queue drained while paused"
        final.lifetime = .keepAlways
        add(final)
    }
}
