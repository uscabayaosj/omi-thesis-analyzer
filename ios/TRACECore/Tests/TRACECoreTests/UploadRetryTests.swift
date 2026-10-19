import Foundation
import XCTest
@testable import TRACECore

final class UploadRetryTests: XCTestCase {
    func testTransientFailuresUseBoundedBackoff() {
        XCTAssertEqual((0..<6).map { UploadRetryPolicy.delay(attempt: $0, networkCode: .notConnectedToInternet)! }, [5, 10, 20, 40, 60, 60])
        XCTAssertNil(UploadRetryPolicy.delay(attempt: 6, httpStatus: 503))
        XCTAssertNil(UploadRetryPolicy.delay(attempt: -1, httpStatus: 503))
        for status in [408, 429, 500, 503, 599] { XCTAssertEqual(UploadRetryPolicy.delay(attempt: 0, httpStatus: status), 5) }
    }

    func testPermanentFailuresNeedExplicitCorrection() {
        for status in [400, 401, 403, 404, 413, 422] { XCTAssertNil(UploadRetryPolicy.delay(attempt: 0, httpStatus: status)) }
        XCTAssertNil(UploadRetryPolicy.delay(attempt: 0, networkCode: .serverCertificateUntrusted))
        XCTAssertNil(UploadRetryPolicy.delay(attempt: 0))
    }

    func testRecoveredChunksUploadChronologically() {
        let dates = ["z": Date(timeIntervalSince1970: 1), "a": Date(timeIntervalSince1970: 2)]
        XCTAssertEqual(UploadRetryPolicy.orderedIDs(["a", "z", "missing"], startedAt: dates), ["z", "a", "missing"])
    }
}
