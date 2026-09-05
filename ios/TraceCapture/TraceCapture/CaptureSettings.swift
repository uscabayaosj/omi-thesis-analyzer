import Foundation
import Security

/// Where the app points and how it proves itself. The token lives in the
/// Keychain; everything else is a plain default. The device id sent to TRACE
/// is the pendant's peripheral identifier, so a second pendant would be a
/// second stream.
enum CaptureSettings {
    private static let defaults = UserDefaults.standard
    private static let tokenAccount = "capture.ingest.token"

    static var baseURL: URL? {
        get { defaults.string(forKey: "baseURL").flatMap(URL.init(string:)) }
        set { defaults.set(newValue?.absoluteString, forKey: "baseURL") }
    }

    static var peripheralId: UUID? {
        get { defaults.string(forKey: "peripheralId").flatMap(UUID.init(uuidString:)) }
        set { defaults.set(newValue?.uuidString, forKey: "peripheralId") }
    }

    static var deviceIdString: String { peripheralId?.uuidString.lowercased() ?? "unpaired" }

    static var ingestToken: String? {
        get {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrAccount as String: tokenAccount,
                kSecReturnData as String: true,
                kSecMatchLimit as String: kSecMatchLimitOne,
            ]
            var item: CFTypeRef?
            guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
                  let data = item as? Data else { return nil }
            return String(data: data, encoding: .utf8)
        }
        set {
            let base: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrAccount as String: tokenAccount,
            ]
            SecItemDelete(base as CFDictionary)
            guard let value = newValue, let data = value.data(using: .utf8) else { return }
            var add = base
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock // background uploads need it
            SecItemAdd(add as CFDictionary, nil)
        }
    }

    static var isConfigured: Bool { baseURL != nil && !(ingestToken ?? "").isEmpty }
}
