import Foundation
import Observation
import Security

private enum NativeCredentialStore {
    private static let service = "com.uscabayaosj.trace.native"
    static func read(_ account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ value: String, account: String) throws {
        guard let data = value.data(using: .utf8) else { throw NativeConnectionError.keychain }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var insert = query
            attributes.forEach { insert[$0.key] = $0.value }
            guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else {
                throw NativeConnectionError.keychain
            }
        } else if status != errSecSuccess {
            throw NativeConnectionError.keychain
        }
    }

    static func delete(_ account: String) {
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ] as CFDictionary)
    }
}

enum NativeConnectionError: LocalizedError {
    case invalidServer
    case invalidResponse
    case keychain
    case server(String)
    case http(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidServer: return "Enter a valid HTTPS server URL. HTTP is allowed only for localhost."
        case .invalidResponse: return "The TRACE server returned an unreadable response."
        case .keychain: return "iOS could not securely save this installation."
        case .server(let message): return message
        case .http(_, let message): return message
        }
    }
}

@MainActor
@Observable
final class NativeConnection {
    static let shared = NativeConnection()

    var serverURL = UserDefaults.standard.string(forKey: "trace.native.serverURL") ?? ""
    var status = "Not connected"
    var installationLabel = ""
    var isBusy = false
    var errorMessage: String?
    private(set) var enrolled = NativeCredentialStore.read("access-token") != nil

    init() {
        #if DEBUG
        if NativeUIFixtures.isActive { enrolled = true; serverURL = "https://fixture.invalid"; status = "Fixture workspace"; installationLabel = "UI fixture" }
        #endif
    }

    var captureUploadScope: String? {
        guard enrolled, !serverURL.isEmpty,
              let id = NativeCredentialStore.read("installation-id") else { return nil }
        return serverURL + "#" + id
    }

    private func installationID() throws -> String {
        if let existing = NativeCredentialStore.read("installation-id") { return existing }
        let created = UUID().uuidString.lowercased()
        try NativeCredentialStore.write(created, account: "installation-id")
        return created
    }

    /// Operator-installed, device-bound setup file. Never replaces an enrolled
    /// workspace. The bootstrap administrator secret is not sent to this phone.
    func importOperatorInstallationIfPresent() async {
        let file = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("TRACE/installation-setup.json")
        guard FileManager.default.fileExists(atPath: file.path) else { return }
        guard !enrolled else {
            try? FileManager.default.removeItem(at: file)
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            let data = try Data(contentsOf: file)
            // Delete the temporary plaintext token before doing network work.
            try FileManager.default.removeItem(at: file)
            guard data.count <= 8192 else { throw NativeConnectionError.invalidResponse }
            let setup = try JSONDecoder().decode(OperatorInstallation.self, from: data)
            guard UUID(uuidString: setup.installationId) != nil,
                  setup.token.count == 43,
                  setup.token.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
                  setup.expiresAt > Date(),
                  setup.expiresAt.timeIntervalSinceNow <= 3600 else {
                throw NativeConnectionError.server("The installation setup has expired or is invalid. Ask the operator to prepare it again.")
            }
            let root = try normalizedRoot(setup.serverURL)
            var request = URLRequest(url: root.appending(path: "/api/native/v1/me"), cachePolicy: .reloadIgnoringLocalCacheData)
            request.setValue("Bearer \(setup.token)", forHTTPHeaderField: "Authorization")
            let (profileData, response) = try await URLSession.shared.data(for: request)
            try Self.requireSuccess(response, data: profileData)
            let profile = try JSONDecoder().decode(OperatorProfile.self, from: profileData)
            guard profile.installationId.lowercased() == setup.installationId.lowercased() else {
                throw NativeConnectionError.invalidResponse
            }
            try NativeCredentialStore.write(setup.installationId.lowercased(), account: "installation-id")
            try saveServerURL(root.absoluteString)
            try NativeCredentialStore.write(setup.token, account: "access-token")
            enrolled = true
            installationLabel = profile.label
            status = "Connected to TRACE"
            errorMessage = nil
        } catch {
            // Never log the setup payload or token.
            errorMessage = "Couldn’t complete the private installation setup. Ask the operator to prepare it again."
        }
    }

    func saveServerURL(_ value: String) throws {
        let root = try normalizedRoot(value)
        UserDefaults.standard.set(root.absoluteString, forKey: "trace.native.serverURL")
        serverURL = root.absoluteString
    }

    func refreshStatus() async {
        #if DEBUG
        if NativeUIFixtures.isActive { status = "Fixture workspace"; return }
        #endif
        guard enrolled else { status = "Not enrolled"; return }
        do {
            let profile = try await requestProfile()
            installationLabel = profile.label
            status = "Connected to TRACE"
        } catch {
            status = "Connection unavailable"
            errorMessage = error.localizedDescription
        }
    }

    func authenticatedData(path: String, queryItems: [URLQueryItem] = []) async throws -> Data {
        try await authenticatedRequest(path: path, method: "GET", queryItems: queryItems)
    }

    func authenticatedRequest(
        path: String,
        method: String,
        queryItems: [URLQueryItem] = [],
        body: Data? = nil,
        contentType: String = "application/json",
        additionalHeaders: [String: String] = [:]
    ) async throws -> Data {
        #if DEBUG
        if NativeUIFixtures.isActive { return try NativeUIFixtures.response(path: path, method: method, body: body) }
        #endif
        guard enrolled else { throw NativeConnectionError.server("Enroll this iPhone to load TRACE data.") }
        let root = try normalizedRoot(serverURL)
        let token = try accessToken()
        var components = URLComponents(url: root.appending(path: path), resolvingAgainstBaseURL: false)
        components?.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let url = components?.url else { throw NativeConnectionError.invalidServer }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        for (name, value) in additionalHeaders {
            request.setValue(value, forHTTPHeaderField: name)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.requireSuccess(response, data: data)
        return data
    }

    func enroll(server: String, label: String, bootstrapSecret: String) async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        errorMessage = nil
        do {
            let root = try normalizedRoot(server)
            let token = try Self.newToken()
            let id = try installationID()
            var request = URLRequest(url: root.appending(path: "/api/native/v1/enroll"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(bootstrapSecret)", forHTTPHeaderField: "Authorization")
            request.httpBody = try JSONSerialization.data(withJSONObject: [
                "installationId": id,
                "token": token,
                "label": label.trimmingCharacters(in: .whitespacesAndNewlines)
            ])
            let (_, response) = try await URLSession.shared.data(for: request)
            try Self.requireSuccess(response)
            try NativeCredentialStore.write(id, account: "installation-id")
            try NativeCredentialStore.write(token, account: "access-token")
            try saveServerURL(root.absoluteString)
            enrolled = true
            await refreshStatus()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func revokeThisInstallation() async {
        guard !isBusy, enrolled else { return }
        isBusy = true
        defer { isBusy = false }
        errorMessage = nil
        do {
            let root = try normalizedRoot(serverURL)
            let token = try accessToken()
            let id = try installationID()
            var request = URLRequest(url: root.appending(path: "/api/native/v1/devices/\(id)"))
            request.httpMethod = "DELETE"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let (_, response) = try await URLSession.shared.data(for: request)
            try Self.requireSuccess(response)
            NativeCredentialStore.delete("access-token")
            enrolled = false
            installationLabel = ""
            status = "Not enrolled"
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func requestProfile() async throws -> ProfileResponse {
        let root = try normalizedRoot(serverURL)
        let token = try accessToken()
        var request = URLRequest(url: root.appending(path: "/api/native/v1/me"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.requireSuccess(response, data: data)
        return try JSONDecoder().decode(ProfileResponse.self, from: data)
    }

    private func accessToken() throws -> String {
        guard let token = NativeCredentialStore.read("access-token") else { throw NativeConnectionError.keychain }
        return token
    }

    private func normalizedRoot(_ value: String) throws -> URL {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard var components = URLComponents(string: trimmed),
              let scheme = components.scheme?.lowercased(),
              let host = components.host?.lowercased(),
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              scheme == "https" || (scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(host)) else {
            throw NativeConnectionError.invalidServer
        }
        components.path = ""
        guard let url = components.url else { throw NativeConnectionError.invalidServer }
        return url
    }

    private static func newToken() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw NativeConnectionError.keychain
        }
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func requireSuccess(_ response: URLResponse, data: Data? = nil) throws {
        guard let response = response as? HTTPURLResponse else { throw NativeConnectionError.invalidResponse }
        guard (200..<300).contains(response.statusCode) else {
            let message = data.flatMap { try? JSONDecoder().decode(ErrorResponse.self, from: $0).error }
            throw NativeConnectionError.http(response.statusCode, message ?? "TRACE server returned HTTP \(response.statusCode).")
        }
    }
}

private struct ProfileResponse: Decodable {
    let label: String
}

private struct ErrorResponse: Decodable {
    let error: String
}

private struct OperatorInstallation: Decodable {
    let serverURL: String
    let installationId: String
    let token: String
    let expiresAt: Date
}

private struct OperatorProfile: Decodable {
    let installationId: String
    let label: String
}
