import CoreBluetooth
import Foundation
import TRACECore

enum SDTransferError: LocalizedError {
    case disconnected, busy, timeout, device(UInt8), inconsistent
    var errorDescription: String? {
        switch self {
        case .disconnected: "Reconnect the DevKit to use its SD card."
        case .busy: "Pause capture and wait for the DevKit to finish saving before importing."
        case .timeout: "The SD card did not reply. Reconnect and retry; saved files remain on the card."
        case .device(let status): "The DevKit could not read its SD card (status \(status))."
        case .inconsistent: "The SD transfer changed or failed verification. The original remains on the card."
        }
    }
}

/// Pull requests carry IDs and exact offsets. A dropped response is retried from
/// the last persisted byte, never treated as completion. There is no erase API.
@MainActor
final class SDCardTransfer {
    var onStatus: ((String) -> Void)?
    private var peripheral: CBPeripheral?
    private var command: CBCharacteristic?
    private var response: CBCharacteristic?
    private var continuation: CheckedContinuation<SDProtocol.Response, Error>?
    private var requestID = UInt32.random(in: 1...UInt32.max)
    private var expectedOp: UInt8 = 0
    private var timer: Timer?
    private var readInFlight = false
    private var awaitingWrite = false
    private var deadline = Date.distantPast
    var available: Bool { peripheral?.state == .connected && command != nil && response != nil }

    func attach(_ peripheral: CBPeripheral, command: CBCharacteristic, response: CBCharacteristic) {
        disconnect(); self.peripheral = peripheral; self.command = command; self.response = response
        onStatus?("SD firmware available; checking card…")
    }
    func disconnect() {
        finish(.failure(SDTransferError.disconnected)); peripheral = nil; command = nil; response = nil
        readInFlight = false; awaitingWrite = false
        onStatus?("Reconnect to check the SD card")
    }
    func didWrite(_ error: Error?) {
        awaitingWrite = false
        if let error { finish(.failure(error)) }
        else { readIfIdle() }
    }
    func didRead(_ data: Data?, error: Error?) {
        readInFlight = false
        guard continuation != nil else { return }
        if let error { finish(.failure(error)); return }
        guard let data else { return }
        do {
            let reply = try SDProtocol.Response(data: data)
            guard reply.requestID == requestID, reply.op == expectedOp else { return }
            if reply.status == 1 { return }
            finish(.success(reply))
        } catch { finish(.failure(error)) }
    }
    private func readIfIdle() {
        guard continuation != nil, !readInFlight, !awaitingWrite,
              let peripheral, let response else { return }
        readInFlight = true
        peripheral.readValue(for: response)
    }
    private func finish(_ result: Result<SDProtocol.Response, Error>) {
        timer?.invalidate(); timer = nil
        let saved = continuation; continuation = nil; saved?.resume(with: result)
    }
    @MainActor
    func exchange(op: UInt8, fileID: UInt64 = 0, offset: UInt32 = 0) async throws -> SDProtocol.Response {
        guard available, let peripheral, let command else { throw SDTransferError.disconnected }
        guard continuation == nil else { throw SDTransferError.busy }
        try Task.checkCancellation()
        requestID &+= 1; expectedOp = op; deadline = Date().addingTimeInterval(8)
        let cancellationID = requestID
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                awaitingWrite = true
                peripheral.writeValue(SDProtocol.request(op: op, id: requestID, fileID: fileID, offset: offset), for: command, type: .withResponse)
                timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                    MainActor.assumeIsolated {
                        guard let self else { return }
                        guard Date() < self.deadline else { self.finish(.failure(SDTransferError.timeout)); return }
                        self.readIfIdle()
                    }
                }
            }
        } onCancel: {
            Task { @MainActor [weak self] in
                guard self?.requestID == cancellationID else { return }
                self?.finish(.failure(CancellationError()))
            }
        }
    }
    @MainActor
    func configure(enabled: Bool) async throws {
        let time = UInt64(Date().timeIntervalSince1970 * 1_000)
        let result = try await exchange(op: 4, fileID: time, offset: enabled ? 1 : 0)
        guard result.status == 0 else { throw SDTransferError.device(result.status) }
        let status = try await exchange(op: 0)
        guard status.status == 0, status.payload.count == 12 else { throw SDTransferError.inconsistent }
        UserDefaults.standard.set([
            "checkedAtMilliseconds": Int64(Date().timeIntervalSince1970 * 1_000),
            "ready": Int64(status.payload[0]), "recording": Int64(status.payload[1]),
            "armed": Int64(status.payload[2]), "failed": Int64(status.payload[3]),
            "drops": Int64(readWord(status.payload, 4)), "writeErrors": Int64(readWord(status.payload, 8)),
        ], forKey: "trace.native.sd.lastStatus")
        if status.payload[0] == 0 {
            let detail = try? await exchange(op: 5)
            if let detail, detail.status == 0, detail.payload.count == 12 {
                let code = Int32(bitPattern: readWord(detail.payload, 0)), stage = readWord(detail.payload, 4)
                UserDefaults.standard.set(["code": Int64(code), "stage": Int64(stage)], forKey: "trace.native.sd.mountDiagnostic")
                if stage == 2 { onStatus?("SD card did not respond. Power off the DevKit and check that the card is seated. Live capture still works.") }
                else if stage == 3 { onStatus?("SD card filesystem could not be mounted. Live capture still works.") }
                else { onStatus?("SD card unavailable; live capture still works") }
            } else { onStatus?("SD card unavailable; live capture still works") }
        }
        else if status.payload[3] != 0 { onStatus?("SD write failed; recordings retained. Restart the DevKit after checking the card.") }
        else { onStatus?(enabled ? "SD fallback enabled; starts when recording loses Bluetooth" : "SD card ready; fallback disabled") }
    }
    private func readWord(_ data: Data, _ offset: Int) -> UInt32 {
        (0..<4).reduce(UInt32(0)) { $0 | UInt32(data[offset+$1]) << ($1*8) }
    }
}

actor SDArchive {
    private let directory: URL
    init(directory: URL? = nil) {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        self.directory = directory ?? support.appendingPathComponent("TRACE/SDImports", isDirectory: true)
    }
    private func url(device: UUID, file: UInt64) -> URL {
        directory.appendingPathComponent("\(device.uuidString.lowercased())-\(String(file, radix: 16)).sdpart")
    }
    func savedOffset(device: UUID, file: UInt64, total: UInt32) throws -> UInt32 {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let path = url(device: device, file: file)
        guard FileManager.default.fileExists(atPath: path.path) else { return 0 }
        let bytes = try Data(contentsOf: path)
        guard bytes.count <= Int(total), bytes.count <= 1_100_000 else { throw SDTransferError.inconsistent }
        return UInt32(bytes.count)
    }
    func append(_ data: Data, device: UUID, file: UInt64, offset: UInt32) throws {
        let path = url(device: device, file: file)
        if !FileManager.default.fileExists(atPath: path.path) {
            guard offset == 0 else { throw SDTransferError.inconsistent }
            try Data().write(to: path, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
        let handle = try FileHandle(forWritingTo: path)
        defer { try? handle.close() }
        let length = try handle.seekToEnd()
        guard length == UInt64(offset), length + UInt64(data.count) <= 1_100_000 else { throw SDTransferError.inconsistent }
        try handle.write(contentsOf: data)
        try handle.synchronize()
    }
    func validate(device: UUID, file: UInt64, total: UInt32, partial: Bool) throws -> SDRecording {
        let data = try Data(contentsOf: url(device: device, file: file))
        guard data.count == Int(total) else { throw SDTransferError.inconsistent }
        let recording = try SDRecording(data: data, allowInterrupted: partial)
        guard recording.fileID == file else { throw SDTransferError.inconsistent }
        return recording
    }
    /// Only the transfer cache is removed. Verified TRCH originals follow the
    /// existing pending-upload protection and SD originals remain on the card.
    func clearCache() throws {
        if FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.removeItem(at: directory)
        }
    }
}
