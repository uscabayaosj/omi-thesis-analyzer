import XCTest
import CoreLocation
@testable import TRACE

/// Inject fixes through the real location delegate; no device GPS or recording is started.
@MainActor final class CaptureLocationTests: XCTestCase {
    private func fix(_ latitude: Double, at date: Date, accuracy: Double = 10) -> CLLocation {
        CLLocation(coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: -0.1), altitude: 0, horizontalAccuracy: accuracy, verticalAccuracy: 10, timestamp: date)
    }
    private func withLocation(_ body: (CaptureLocation) throws -> Void) rethrows {
        let previous = UserDefaults.standard.object(forKey: "trace.location.enabled")
        let location = CaptureLocation(); location.enabled = true
        defer {
            location.enabled = false
            if let previous { UserDefaults.standard.set(previous, forKey: "trace.location.enabled") }
            else { UserDefaults.standard.removeObject(forKey: "trace.location.enabled") }
        }
        try body(location)
    }
    func testDominantObservedPlaceWinsOverDistantShortStop() throws {
        try withLocation { location in
            let start = Date().addingTimeInterval(-40)
            location.locationManager(CLLocationManager(), didUpdateLocations: [fix(51.5, at: start), fix(51.5001, at: start.addingTimeInterval(20)), fix(52, at: start.addingTimeInterval(30))])
            let pin = try XCTUnwrap(location.pin(start: start, duration: 40))
            XCTAssertLessThan(abs(pin.latitude - 51.5), 0.001)
            XCTAssertEqual(try XCTUnwrap(pin.observedSeconds), 30, accuracy: 0.001)
            XCTAssertEqual(pin.source, "automatic")
        }
    }
    func testStaleAndInaccurateFixesProduceNoPin() {
        withLocation { location in
            location.locationManager(CLLocationManager(), didUpdateLocations: [fix(51.5, at: Date().addingTimeInterval(-120)), fix(52, at: Date().addingTimeInterval(-10), accuracy: 101)])
            XCTAssertNil(location.pin(start: Date().addingTimeInterval(-30), duration: 30))
        }
    }
    func testSingleFixExpiresAfterSixtyObservedSeconds() throws {
        try withLocation { location in
            let start = Date().addingTimeInterval(-50)
            location.locationManager(CLLocationManager(), didUpdateLocations: [fix(51.5, at: start)])
            let pin = try XCTUnwrap(location.pin(start: start, duration: 80))
            XCTAssertEqual(try XCTUnwrap(pin.observedSeconds), 60, accuracy: 0.001)
        }
    }
    func testOptOutDoesNotAttachStoredLocation() {
        withLocation { location in
            let start = Date().addingTimeInterval(-10)
            location.locationManager(CLLocationManager(), didUpdateLocations: [fix(51.5, at: start)])
            location.enabled = false
            XCTAssertNil(location.pin(start: start, duration: 10))
        }
    }
}
