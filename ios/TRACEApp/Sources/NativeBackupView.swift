import Foundation
import TRACECore
import SwiftUI
import UniformTypeIdentifiers

private struct NativeBackupNamespace: Decodable, Identifiable {
    let namespace: String
    let isArray: Bool
    let count: Int
    var id: String { namespace }
}
private struct NativeBackupManifest: Decodable {
    let exportedAt: String
    let namespaces: [NativeBackupNamespace]
}

struct NativeBackupView: View {
    @State private var worker = NativeBackupWorker()
    @State private var isExporting = false
    @State private var isImporting = false
    @State private var isValidating = false
    @State private var isRestoring = false
    @State private var validationTask: Task<Void, Never>?
    @State private var backupURL: URL?
    @State private var pendingCount = 0
    @State private var pendingNamespaceCount = 0
    @State private var showRestoreConfirm = false
    @State private var status: String?
    @State private var error: String?
    private var busy: Bool { isExporting || isValidating || isRestoring }

    var body: some View {
        Form {
            Section("Server backup") {
                Text("Export and restore shared People, analyses, codes, planning records, and their deletion history. Restore merges records by timestamp and keeps newer server data.")
                    .font(.footnote).foregroundStyle(.secondary)
                Text("Native capture conversations, conversation pins and deletion markers, reference voices, and local audio recordings are not included. Export whole recordings separately from each conversation.").font(.footnote).foregroundStyle(.secondary)
                Button { Task { await exportBackup() } } label: {
                    if isExporting { Label("Preparing backup…", systemImage: "arrow.down.doc") }
                    else { Label("Create backup file", systemImage: "arrow.down.doc") }
                }.disabled(busy)
                if let backupURL { ShareLink(item: backupURL) { Label("Share backup…", systemImage: "square.and.arrow.up") }.disabled(busy) }
            }
            Section("Restore a TRACE backup") {
                Button { isImporting = true } label: {
                    if isRestoring { Label("Restoring…", systemImage: "arrow.clockwise") }
                    else { Label("Choose backup file", systemImage: "arrow.up.doc") }
                }.disabled(busy)
                if isValidating { ProgressView("Checking backup…") }
            }
            if let status { Section { Label(status, systemImage: "checkmark.circle.fill").foregroundStyle(.green) } }
            if let error { Section("Could not complete") { Text(error).foregroundStyle(.red) } }
        }
        .navigationTitle("Backup and restore")
        .navigationBarTitleDisplayMode(.inline)
        .fileImporter(isPresented: $isImporting, allowedContentTypes: [.json], allowsMultipleSelection: false) { result in
            guard !busy else { return }
            isValidating = true
            validationTask = Task { await prepareImport(result) }
        }
        .alert("Restore \(pendingCount) records?", isPresented: $showRestoreConfirm) {
            Button("Restore", role: .destructive) { Task { await restoreBackup() } }
            Button("Cancel", role: .cancel) { Task { await worker.clear() } }
        } message: {
            Text("This backup contains \(pendingNamespaceCount) types of saved data. TRACE merges imported records by timestamp, retains newer server data, and preserves deletion history.")
        }
        .onDisappear { validationTask?.cancel() }
    }

    private func exportBackup() async {
        guard !busy else { return }
        isExporting = true; status = nil; error = nil
        defer { isExporting = false }
        do {
            let result = try await worker.export()
            backupURL = result.url
            status = "Backup ready · \(result.namespaces) data types · \(ByteCountFormatter.string(fromByteCount: Int64(result.bytes), countStyle: .file))"
        } catch { self.error = error.localizedDescription }
    }
    private func prepareImport(_ result: Result<[URL], Error>) async {
        status = nil; error = nil; showRestoreConfirm = false
        defer { isValidating = false; validationTask = nil }
        do {
            guard let url = try result.get().first else { return }
            let counts = try await worker.validate(url)
            try Task.checkCancellation()
            pendingCount = counts.records; pendingNamespaceCount = counts.namespaces
            showRestoreConfirm = true
        } catch is CancellationError { await worker.clear() }
        catch { self.error = error.localizedDescription }
    }
    private func restoreBackup() async {
        guard !busy else { return }
        isRestoring = true; status = nil; error = nil
        defer { isRestoring = false }
        do {
            try await worker.restore()
            status = "Restore merged into the server. Refresh People and analysis screens to see imported data."
        } catch { self.error = error.localizedDescription }
    }
}

/// File parsing, serialization and restore batching remain isolated from MainActor.
private actor NativeBackupWorker {
    private var pending: [String: Any]?
    struct Export: Sendable { let url: URL; let namespaces: Int; let bytes: Int }
    func clear() { pending = nil }
    private func authenticatedData(path: String, queryItems: [URLQueryItem] = []) async throws -> Data {
        try await NativeConnection.shared.authenticatedData(path: path, queryItems: queryItems)
    }
    private func manifest() async throws -> NativeBackupManifest {
        try JSONDecoder().decode(NativeBackupManifest.self, from: await authenticatedData(path: "/api/native/v1/backup"))
    }
    func validate(_ url: URL) async throws -> (records: Int, namespaces: Int) {
        pending = nil
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        if let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
           size > TRACEBackupValidation.maximumFileBytes { throw TRACEBackupError.fileTooLarge }
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        let manifest = try await manifest()
        try Task.checkCancellation()
        let shapes = Dictionary(uniqueKeysWithValues: manifest.namespaces.map { ($0.namespace, $0.isArray) })
        let validated = try TRACEBackupValidation.parse(data, arrayNamespaces: shapes)
        try Task.checkCancellation()
        pending = validated.namespaces
        return (validated.recordCount, validated.namespaces.count)
    }
    func export() async throws -> Export {
        let manifest = try await manifest()
        var namespaces: [String: Any] = [:]
        for item in manifest.namespaces {
            var cursor = 0
            var list: [Any] = []; var records: [String: Any] = [:]
            repeat {
                try Task.checkCancellation()
                let data = try await authenticatedData(path: "/api/native/v1/backup/\(item.namespace)", queryItems: [URLQueryItem(name: "cursor", value: String(cursor))])
                let page = try JSONDecoder().decode(BackupPage.self, from: data)
                if item.isArray { list.append(contentsOf: page.listValues) }
                else { records.merge(page.recordValues) { _, new in new } }
                cursor = page.nextCursor ?? -1
            } while cursor >= 0
            namespaces[item.namespace] = item.isArray ? list : records
        }
        let completed = try await self.manifest()
        let file: [String: Any] = ["schemaVersion": 1, "source": "server", "exportedAt": manifest.exportedAt, "completedAt": completed.exportedAt, "namespaces": namespaces]
        let data = try JSONSerialization.data(withJSONObject: file, options: [.prettyPrinted, .sortedKeys, .fragmentsAllowed])
        let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd-HHmm"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("trace-backup-\(formatter.string(from: Date())).json")
        try data.write(to: url, options: .atomic)
        return Export(url: url, namespaces: namespaces.count, bytes: data.count)
    }
    func restore() async throws {
        guard let pending else { throw BackupError.noData }
        let manifest = try await manifest()
        for item in manifest.namespaces {
            try Task.checkCancellation()
            guard let value = pending[item.namespace] else { continue }
            if item.isArray, let values = value as? [Any] {
                try await importValues(item.namespace, values: values.map { ("", $0) }, isArray: true)
            } else if let values = value as? [String: Any] {
                let entries = values.keys.sorted().compactMap { key in values[key].map { (key, $0) } }
                try await importValues(item.namespace, values: entries, isArray: false)
            }
        }
        self.pending = nil
    }
    private func importValues(_ namespace: String, values: [(String, Any)], isArray: Bool) async throws {
        var map: [String: Any] = [:]
        var list: [Any] = []
        for (key, value) in values {
            if (isArray ? list.count : map.count) >= 250 {
                try await importPage(namespace, payload: isArray ? ["list": list] : ["records": map])
                list = []
                map = [:]
            }
            if isArray { list.append(value) } else { map[key] = value }
            let payload: [String: Any] = isArray ? ["list": list] : ["records": map]
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.fragmentsAllowed])
            if data.count > 1_650_000 {
                if isArray { _ = list.popLast() } else { map.removeValue(forKey: key) }
                guard !list.isEmpty || !map.isEmpty else { throw BackupError.recordTooLarge }
                try await importPage(namespace, payload: isArray ? ["list": list] : ["records": map])
                list = isArray ? [value] : []
                map = isArray ? [:] : [key: value]
                let single = try JSONSerialization.data(withJSONObject: isArray ? ["list": list] : ["records": map], options: [.fragmentsAllowed])
                guard single.count <= 1_650_000 else { throw BackupError.recordTooLarge }
            }
        }
        if !list.isEmpty || !map.isEmpty {
            try await importPage(namespace, payload: isArray ? ["list": list] : ["records": map])
        }
    }

    private func importPage(_ namespace: String, payload: [String: Any]) async throws {
        let body = try JSONSerialization.data(withJSONObject: payload, options: [.fragmentsAllowed])
        guard body.count <= 1_700_000 else { throw BackupError.recordTooLarge }
        _ = try await NativeConnection.shared.authenticatedRequest(path: "/api/native/v1/backup/\(namespace)", method: "PUT", body: body)
    }
}

private struct BackupPage: Decodable {
    let records: [String: AnyCodable]?
    let list: [AnyCodable]?
    let nextCursor: Int?

    enum CodingKeys: String, CodingKey { case records, list, nextCursor }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        records = try values.decodeIfPresent([String: AnyCodable].self, forKey: .records)
        list = try values.decodeIfPresent([AnyCodable].self, forKey: .list)
        nextCursor = try values.decodeIfPresent(Int.self, forKey: .nextCursor)
    }

    var recordValues: [String: Any] { (records ?? [:]).mapValues(\.value) }
    var listValues: [Any] { (list ?? []).map(\.value) }
}

private struct AnyCodable: Decodable {
    let value: Any
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { value = NSNull() }
        else if let x = try? c.decode(Bool.self) { value = x }
        else if let x = try? c.decode(Int.self) { value = x }
        else if let x = try? c.decode(Double.self) { value = x }
        else if let x = try? c.decode(String.self) { value = x }
        else if let x = try? c.decode([AnyCodable].self) { value = x.map(\.value) }
        else if let x = try? c.decode([String: AnyCodable].self) { value = x.mapValues(\.value) }
        else { throw BackupError.invalidFile }
    }
}

private enum BackupError: LocalizedError {
    case invalidFile, noData, fileTooLarge, recordTooLarge
    var errorDescription: String? {
        switch self {
        case .invalidFile: return "That file is not a valid TRACE backup."
        case .noData: return "The file contains no backup namespaces this server supports."
        case .fileTooLarge: return "The backup file is larger than 100 MB."
        case .recordTooLarge: return "A backup record exceeds the server’s restore page limit."
        }
    }
}
