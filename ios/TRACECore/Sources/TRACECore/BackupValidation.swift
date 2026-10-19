import Foundation
import CoreFoundation

public struct ValidatedTRACEBackup {
    public let namespaces: [String: Any]
    public let recordCount: Int
}

public enum TRACEBackupError: LocalizedError {
    case invalidFile, unsupportedVersion, noData, fileTooLarge, recordTooLarge
    case wrongNamespaceShape(String)

    public var errorDescription: String? {
        switch self {
        case .invalidFile: return "That file is not a valid TRACE backup."
        case .unsupportedVersion: return "This backup version is not supported by this version of TRACE."
        case .noData: return "The file contains no backup namespaces this server supports."
        case .fileTooLarge: return "The backup file is larger than 100 MB."
        case .recordTooLarge: return "A backup record exceeds the server’s restore page limit."
        case .wrongNamespaceShape(let namespace): return "The backup data for \(namespace) has the wrong format. No records were restored."
        }
    }
}

public enum TRACEBackupValidation {
    public static let maximumFileBytes = 100_000_000
    public static let maximumRecordBytes = 1_650_000

    /// Versionless browser exports remain supported. Unknown namespaces and unused local null values are ignored.
    public static func parse(_ data: Data, arrayNamespaces: [String: Bool]) throws -> ValidatedTRACEBackup {
        guard data.count <= maximumFileBytes else { throw TRACEBackupError.fileTooLarge }
        let decoded: Any
        do { decoded = try JSONSerialization.jsonObject(with: data) }
        catch { throw TRACEBackupError.invalidFile }
        guard let file = decoded as? [String: Any],
              let namespaces = file["namespaces"] as? [String: Any] else { throw TRACEBackupError.invalidFile }
        if let version = file["schemaVersion"] {
            guard let number = version as? NSNumber,
                  CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue == 1 else {
                throw TRACEBackupError.unsupportedVersion
            }
        }
        var valid: [String: Any] = [:]
        var count = 0
        for (namespace, value) in namespaces {
            guard let isArray = arrayNamespaces[namespace], !(value is NSNull) else { continue }
            if isArray {
                guard let list = value as? [Any] else { throw TRACEBackupError.wrongNamespaceShape(namespace) }
                for record in list { try checkRecord(["list": [record]]) }
                valid[namespace] = list
                count += list.count
            } else {
                guard let records = value as? [String: Any] else { throw TRACEBackupError.wrongNamespaceShape(namespace) }
                for (key, record) in records { try checkRecord(["records": [key: record]]) }
                valid[namespace] = records
                count += records.count
            }
        }
        guard !valid.isEmpty else { throw TRACEBackupError.noData }
        return ValidatedTRACEBackup(namespaces: valid, recordCount: count)
    }

    private static func checkRecord(_ envelope: [String: Any]) throws {
        let bytes = try JSONSerialization.data(withJSONObject: envelope).count
        guard bytes <= maximumRecordBytes else { throw TRACEBackupError.recordTooLarge }
    }
}
