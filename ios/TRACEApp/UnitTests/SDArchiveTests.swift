import XCTest
import Foundation
import AVFoundation
import CryptoKit
import Opus
import TRACECore
@testable import TRACE

final class SDArchiveTests:XCTestCase {
    private func le(_ v:UInt64,_ n:Int)->Data{Data((0..<n).map{UInt8(truncatingIfNeeded:v >> ($0*8))})}
    private func recording(_ frames:[Data], time:UInt64=1_791_110_000_000)->Data{
        var d=Data("TRSD".utf8);d.append(contentsOf:[1,0x14,32,0]);d.append(le(17,8));d.append(le(time,8));d.append(le(1234,4));d.append(le(UInt64(SDChecksum.crc32(d)),4))
        for (i,p) in frames.enumerated(){var r=le(UInt64(p.count),2);r.append(le(10,2));r.append(le(UInt64(i),4));var check=r;check.append(p);r.append(le(UInt64(SDChecksum.crc32(check)),4));r.append(p);d.append(r)}
        var f=Data("TEND".utf8);f.append(le(UInt64(frames.count),4));f.append(le(UInt64(d.count),4));f.append(le(UInt64(SDChecksum.crc32(d)),4));f.append(le(0,4));f.append(le(UInt64(SDChecksum.crc32(f)),4));d.append(f);return d
    }
    func testResumeFromSavedBytesRejectWrongOffsetsAndClearOnlyCache() async throws {
        let dir=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString);defer{try? FileManager.default.removeItem(at:dir)};let device=UUID(),data=recording([Data([0x11])]);let total=UInt32(data.count)
        let archive=SDArchive(directory:dir);let zero=try await archive.savedOffset(device:device,file:17,total:total);XCTAssertEqual(zero,0)
        try await archive.append(Data(data.prefix(20)),device:device,file:17,offset:0)
        let reopened=SDArchive(directory:dir);let saved=try await reopened.savedOffset(device:device,file:17,total:total);XCTAssertEqual(saved,20)
        do{try await reopened.append(Data([1]),device:device,file:17,offset:0);XCTFail("Wrong offset accepted")}catch{XCTAssertTrue(error is SDTransferError)}
        try await reopened.append(Data(data.dropFirst(20)),device:device,file:17,offset:20)
        let r=try await reopened.validate(device:device,file:17,total:total,partial:false);XCTAssertEqual(r.fileID,17)
        do{_ = try await reopened.validate(device:device,file:19,total:total,partial:false);XCTFail("Missing identity accepted")}catch{}
        try await reopened.clearCache();let cleared=try await reopened.savedOffset(device:device,file:17,total:total);XCTAssertEqual(cleared,0)
    }
    func testActualOpusSDImportProducesWholeAudioAtExpectedDuration() async throws {
        let dir=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString);try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true);defer{try? FileManager.default.removeItem(at:dir)}
        let format=AVAudioFormat(opusPCMFormat:.int16,sampleRate:16000,channels:1)!,encoder=try Opus.Encoder(format:format);let buffer=AVAudioPCMBuffer(pcmFormat:format,frameCapacity:160)!;buffer.frameLength=160
        for i in 0..<160{buffer.int16ChannelData![0][i]=Int16(sin(Double(i)/10)*3000)}
        var frames=[Data]();for _ in 0..<80{var p=Data(count:320);_=try encoder.encode(buffer,to:&p);frames.append(p)}
        let r=try SDRecording(data:recording(frames));let writer=try ChunkFileWriter(directory:dir);let id=UUID();let url=try await writer.importSD(r.chunk,id:id,uploadScope:nil);let original=try Data(contentsOf:url);let record=try LocalChunkRecord.read(from:url)
        let hash=SHA256.hash(data:original).map{String(format:"%02x",$0)}.joined();let conversationID=UUID().uuidString;let start=record.startedAt;let iso=ISO8601DateFormatter();iso.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        let manifest=ConversationAudioManifest(conversationId:conversationID,startedAt:iso.string(from:start),finishedAt:iso.string(from:start.addingTimeInterval(0.8)),chunks:[.init(id:record.id,startedAt:iso.string(from:start),durationMs:800,sha256:hash)])
        let output=try await ConversationAudioAssembler.shared.assemble(manifest,records:[record]);defer{try? FileManager.default.removeItem(at:output)};let audio=try AVAudioFile(forReading:output);XCTAssertEqual(Double(audio.length)/audio.processingFormat.sampleRate,0.8,accuracy:0.025);XCTAssertEqual(try Data(contentsOf:url),original)
    }
}
