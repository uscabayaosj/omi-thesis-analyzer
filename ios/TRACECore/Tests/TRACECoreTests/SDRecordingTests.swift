import Foundation
import XCTest
@testable import TRACECore

final class SDRecordingTests: XCTestCase {
    private func le(_ value: UInt64, _ bytes: Int) -> Data { Data((0..<bytes).map { UInt8(truncatingIfNeeded: value >> ($0*8)) }) }
    private func fixture(count: Int = 2, sealed: Bool = true, drops: UInt32 = 0, sequences: [UInt32]? = nil) -> Data {
        var d = Data("TRSD".utf8);d.append(contentsOf:[1,0x14,32,0]);d.append(le(0x1234567800000001,8));d.append(le(1_791_108_000_000,8));d.append(le(1234,4));d.append(le(UInt64(SDChecksum.crc32(d)),4))
        for i in 0..<count {
            let payload=Data([0x11,UInt8(truncatingIfNeeded:i)])
            var r=le(UInt64(payload.count),2);r.append(le(10,2));r.append(le(UInt64(sequences?[i] ?? UInt32(i)),4))
            var checked=r;checked.append(payload);r.append(le(UInt64(SDChecksum.crc32(checked)),4));r.append(payload);d.append(r)
        }
        if sealed {var f=Data("TEND".utf8);f.append(le(UInt64(count),4));f.append(le(UInt64(d.count),4));f.append(le(UInt64(SDChecksum.crc32(d)),4));f.append(le(UInt64(drops),4));f.append(le(UInt64(SDChecksum.crc32(f)),4));d.append(f)}
        return d
    }
    func testCRCMatchesPublishedIEEEVector() { XCTAssertEqual(SDChecksum.crc32(Data("123456789".utf8)),0xcbf43926) }
    func testSealedContainerPreservesEveryFrameAndTimestamp() throws {
        let r=try SDRecording(data:fixture());XCTAssertEqual(r.fileID,0x1234567800000001);XCTAssertEqual(r.chunk.frames,[Data([0x11,0]),Data([0x11,1])]);XCTAssertEqual(r.chunk.startedAtMilliseconds,1_791_108_000_000);XCTAssertFalse(r.interrupted)
    }
    func testThirtySecondLimitAndRejectLongerRecording() throws {
        XCTAssertEqual(try SDRecording(data:fixture(count:3000)).chunk.frames.count,3000)
        XCTAssertThrowsError(try SDRecording(data:fixture(count:3001)))
    }
    func testPartialRequiresExplicitAuthorizationAndRetainsCompletePrefix() throws {
        var d=fixture(sealed:false);d.append(contentsOf:[2,0,10,0]);XCTAssertThrowsError(try SDRecording(data:d));let r=try SDRecording(data:d,allowInterrupted:true);XCTAssertTrue(r.interrupted);XCTAssertEqual(r.discardedTailBytes,4);XCTAssertEqual(r.chunk.frames.count,2)
    }
    func testCorruptCompleteFrameIsNeverSalvaged() {var d=fixture(sealed:false);d[44] ^= 1;XCTAssertThrowsError(try SDRecording(data:d,allowInterrupted:true))}
    func testBadHeaderAndBadFooterRejected() {var h=fixture();h[16] ^= 1;XCTAssertThrowsError(try SDRecording(data:h));var f=fixture();f[f.count-1] ^= 1;XCTAssertThrowsError(try SDRecording(data:f))}
    func testSequenceGapFailsAndUInt32WrapWorks() throws {XCTAssertThrowsError(try SDRecording(data:fixture(sequences:[5,7])));XCTAssertEqual(try SDRecording(data:fixture(sequences:[UInt32.max,0])).chunk.frames.count,2)}
    func testDropEvidenceSurvivesImport() throws {XCTAssertEqual(try SDRecording(data:fixture(drops:7)).reportedDrops,7)}
    func testRequestLayoutUsesExactFields() {let d=SDProtocol.request(op:2,id:0x12345678,fileID:0x0102030405060708,offset:192);XCTAssertEqual(d.count,24);XCTAssertEqual(Array(d[8..<12]),[0x78,0x56,0x34,0x12]);XCTAssertEqual(Array(d[12..<20]),[8,7,6,5,4,3,2,1]);XCTAssertEqual(Array(d[20..<24]),[192,0,0,0])}
    func testResponseLengthAndChecksumRejectCorruption() throws {
        var d=Data("TSRP".utf8);d.append(contentsOf:[1,2,0,0]);d.append(le(17,4));d.append(le(19,8));d.append(le(192,4));d.append(le(194,4));d.append(contentsOf:[2,0,0,0,0xaa,0xbb]);d.append(le(UInt64(SDChecksum.crc32(d)),4));let r=try SDProtocol.Response(data:d);XCTAssertEqual(r.payload,Data([0xaa,0xbb]));XCTAssertEqual(r.offset,192);var bad=d;bad[32] ^= 1;XCTAssertThrowsError(try SDProtocol.Response(data:bad));XCTAssertThrowsError(try SDProtocol.Response(data:d+Data([0])))
    }
    func testRepeatedImportIsIdempotentAndScopeCannotChange() async throws {
        let dir=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString);defer{try? FileManager.default.removeItem(at:dir)};let writer=try ChunkFileWriter(directory:dir);let chunk=try SDRecording(data:fixture()).chunk;let id=UUID();let first=try await writer.importSD(chunk,id:id,uploadScope:"first#installation");let second=try await writer.importSD(chunk,id:id,uploadScope:"second#installation");XCTAssertEqual(first,second);XCTAssertEqual(ChunkFileWriter.uploadScope(for:second),"first#installation");let files=try await writer.completedChunks();XCTAssertEqual(files.count,1);XCTAssertEqual(try Data(contentsOf:first),chunk.encodedData)
        let changed=try SDRecording(data:fixture(count:3)).chunk
        do {_=try await writer.importSD(changed,id:id,uploadScope:"first#installation");XCTFail("Must reject mismatched bytes")}catch{XCTAssertEqual(error as? ChunkFileWriterError,.conflictingImport)}
        XCTAssertEqual(try Data(contentsOf:first),chunk.encodedData)
    }
}
