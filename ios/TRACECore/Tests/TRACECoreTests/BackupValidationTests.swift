import XCTest
@testable import TRACECore

final class BackupValidationTests: XCTestCase {
    private let shapes = ["analyses": true, "people": false]
    private func data(_ file: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: file) }

    func testCurrentExportCountsRecordsAndPreservesTombstones() throws {
        let file: [String: Any] = ["schemaVersion": 1, "namespaces": ["analyses": [["id": "a"]], "people": ["p": ["deleted": true]]]]
        let backup = try TRACEBackupValidation.parse(data(file), arrayNamespaces: shapes)
        XCTAssertEqual(backup.recordCount, 2)
        XCTAssertEqual(((backup.namespaces["people"] as? [String: Any])?["p"] as? [String: Any])?["deleted"] as? Bool, true)
    }
    func testLegacyBrowserExportNullAndUnknownNamespaces() throws {
        let file: [String: Any] = ["source": "local", "namespaces": ["analyses": NSNull(), "people": [:], "future": ["ignored": true]]]
        let backup = try TRACEBackupValidation.parse(data(file), arrayNamespaces: shapes)
        XCTAssertEqual(backup.recordCount, 0)
        XCTAssertEqual(Set(backup.namespaces.keys), ["people"])
    }
    func testUnsupportedAndBooleanVersionsAreRejected() throws {
        for version: Any in [2, true, "1", 1.5] {
            XCTAssertThrowsError(try TRACEBackupValidation.parse(data(["schemaVersion": version, "namespaces": ["people": [:]]]), arrayNamespaces: shapes))
        }
    }
    func testWrongKnownNamespaceShapesAreRejectedEvenWithOtherValidData() throws {
        for namespaces: [String: Any] in [["analyses": [:], "people": [:]], ["analyses": [], "people": []], ["people": "bad"]] {
            XCTAssertThrowsError(try TRACEBackupValidation.parse(data(["namespaces": namespaces]), arrayNamespaces: shapes))
        }
    }
    func testMalformedEnvelopeAndUnrecognizedDataAreRejected() throws {
        for raw in ["{", "[]", "{\"namespaces\":[]}", "{\"namespaces\":{\"unknown\":{}}}", "{\"namespaces\":{\"people\":null}}"] {
            XCTAssertThrowsError(try TRACEBackupValidation.parse(Data(raw.utf8), arrayNamespaces: shapes))
        }
    }
    func testOversizedRecordRejectedBeforeAnyRestoreCanStart() throws {
        let value = String(repeating: "x", count: TRACEBackupValidation.maximumRecordBytes)
        for namespaces: [String: Any] in [["people": ["p": value]], ["analyses": [value]]] {
            XCTAssertThrowsError(try TRACEBackupValidation.parse(data(["namespaces": namespaces]), arrayNamespaces: shapes))
        }
    }
    func testOversizedFileRejectedBeforeJSONParsing() {
        XCTAssertThrowsError(try TRACEBackupValidation.parse(Data(count: TRACEBackupValidation.maximumFileBytes + 1), arrayNamespaces: shapes))
    }
}
