import AVFoundation
import XCTest
@testable import TRACE

final class VoiceRecognitionTests: XCTestCase {
    private func decode(_ json: String) throws -> [NativeTranscriptSegment] {
        let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode([NativeTranscriptSegment].self, from: Data(json.utf8))
    }
    func testSuggestionIsNotAConfirmedIdentityAndDecodesProvider() throws {
        let segments = try decode(#"[{"text":"Hello","speaker_id":0,"speaker_status":"estimated","speaker_name":"You","speaker_person_id":"self","speaker_confirmed":false,"voice_match_status":"suggested","voice_profile_id":"ref","diarizer_model":"gpt-4o-transcribe-diarize","diarizer_provider":"openai"}]"#)
        XCTAssertEqual(segments[0].voiceProfileID,"ref"); XCTAssertEqual(segments[0].diarizerProvider,"openai")
        XCTAssertNil(segments[0].speakerConfidence)
        XCTAssertEqual(TranscriptPresentation.blocks(segments,estimatedSpeakers:true)[0].speakerLabel,"Possibly you")
        XCTAssertNil(TranscriptPresentation.blocks(segments,estimatedSpeakers:false)[0].speakerLabel)
    }
    func testRejectedVoiceRemainsUnknown() throws {
        let segments = try decode(#"[{"text":"Hello","speaker_id":0,"speaker_status":"estimated","speaker_name":"Alex","speaker_confirmed":false,"voice_match_status":"rejected"}]"#)
        XCTAssertEqual(TranscriptPresentation.blocks(segments,estimatedSpeakers:true)[0].speakerLabel,"Unknown speaker")
    }
    func testProjectionKeepsExactIndicesForPassageCorrection() throws {
        let segments = try decode(#"[{"text":"One","speaker_id":0,"speaker_status":"estimated"},{"text":"Two","speaker_id":0,"speaker_status":"estimated"},{"text":"Three","speaker_id":1,"speaker_status":"estimated"}]"#)
        XCTAssertEqual(TranscriptPresentation.blocks(segments,estimatedSpeakers:true).map(\.segmentIndices),[[0,1],[2]])
    }
    func testCandidatesExcludeOverlappingShortAndUncertainSpeech() throws {
        let segments = try decode(#"[{"text":"A","speaker_id":0,"speaker_status":"estimated","start":0,"end":5},{"text":"Overlap","speaker_id":1,"speaker_status":"estimated","start":4,"end":8},{"text":"Short","speaker_id":2,"start":10,"end":11},{"text":"Uncertain","speaker_id":3,"speaker_status":"uncertain","start":12,"end":18},{"text":"Clear","speaker_id":4,"speaker_status":"estimated","start":20,"end":35}]"#)
        let suggestions = VoiceCandidate.suggestions(segments)
        XCTAssertEqual(suggestions.count,1);XCTAssertEqual(suggestions[0].index,4);XCTAssertEqual(suggestions[0].end,28)
    }
    func testCanonicalSampleExtractionDoesNotChangeOriginal() throws {
        let source = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString+".wav")
        defer {try? FileManager.default.removeItem(at:source)}
        let format = AVAudioFormat(commonFormat:.pcmFormatInt16,sampleRate:16000,channels:1,interleaved:false)!
        var file: AVAudioFile? = try AVAudioFile(forWriting:source,settings:format.settings,commonFormat:.pcmFormatInt16,interleaved:false)
        let buffer = AVAudioPCMBuffer(pcmFormat:format,frameCapacity:192000)!;buffer.frameLength=192000
        for i in 0..<192000 {buffer.int16ChannelData![0][i]=Int16(sin(Double(i)/10)*3000)}
        try file!.write(from:buffer);file=nil
        let original = try Data(contentsOf:source)
        let sample = try VoiceSampleAudio.extract(source,start:2,end:10);defer {try? FileManager.default.removeItem(at:sample)}
        let bytes = try Data(contentsOf:sample)
        XCTAssertGreaterThanOrEqual(bytes.count,64044);XCTAssertLessThanOrEqual(bytes.count,256044)
        XCTAssertEqual(try AVAudioFile(forReading:sample).length,Int64((bytes.count-44)/2))
        XCTAssertEqual(String(data:bytes.prefix(4),encoding:.ascii),"RIFF")
        XCTAssertEqual(try Data(contentsOf:source),original)
        XCTAssertThrowsError(try VoiceSampleAudio.extract(source,start:0,end:1))
    }
    func testReferenceCanBeExtractedFromActualAACConversationFormat() throws {
        let source = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString+".m4a")
        defer {try? FileManager.default.removeItem(at:source)}
        let format = AVAudioFormat(commonFormat:.pcmFormatInt16,sampleRate:16000,channels:1,interleaved:false)!
        var file: AVAudioFile? = try AVAudioFile(forWriting:source,settings:[AVFormatIDKey:kAudioFormatMPEG4AAC,AVSampleRateKey:16000,AVNumberOfChannelsKey:1,AVEncoderBitRateKey:32000],commonFormat:.pcmFormatInt16,interleaved:false)
        let buffer = AVAudioPCMBuffer(pcmFormat:format,frameCapacity:192000)!;buffer.frameLength=192000
        for i in 0..<192000 {buffer.int16ChannelData![0][i]=Int16(sin(Double(i)/10)*3000)}
        try file!.write(from:buffer);file=nil
        let original = try Data(contentsOf:source)
        let sample = try VoiceSampleAudio.extract(source,start:2,end:10);defer {try? FileManager.default.removeItem(at:sample)}
        let bytes = try Data(contentsOf:sample)
        XCTAssertGreaterThanOrEqual(bytes.count,64044);XCTAssertLessThanOrEqual(bytes.count,256044)
        XCTAssertEqual(try Data(contentsOf:source),original)
    }
    func testCandidatesLeaveConversionHeadroomAndDeduplicateReferences() throws {
        let segments = try decode(#"[{"text":"Too short","speaker_id":0,"start":0,"end":2},{"text":"Me first","speaker_id":0,"speaker_id_scope":"a","voice_profile_id":"me","start":3,"end":8},{"text":"Me again","speaker_id":1,"speaker_id_scope":"b","voice_profile_id":"me","start":9,"end":14},{"text":"Alex","speaker_id":0,"speaker_id_scope":"c","voice_profile_id":"alex","start":15,"end":20},{"text":"Invalid speaker","speaker_id":-1,"start":21,"end":26}]"#)
        XCTAssertEqual(VoiceCandidate.suggestions(segments).map(\.index), [1, 3])
    }
    func testPersonNamedYouIsNotMistakenForTheOwner() throws {
        let segments = try decode(#"[{"text":"Hello","speaker_id":0,"speaker_status":"estimated","speaker_name":"You","speaker_person_id":"another-person","voice_match_status":"suggested"}]"#)
        XCTAssertEqual(TranscriptPresentation.blocks(segments,estimatedSpeakers:true)[0].speakerLabel,"Possibly You")
    }
    func testCorrectionBlocksStayWithinServerLimit() throws {
        let segments = try decode("[" + Array(repeating:#"{"text":"a","speaker_id":0,"speaker_status":"estimated"}"#,count:150).joined(separator:",") + "]")
        XCTAssertTrue(TranscriptPresentation.blocks(segments,estimatedSpeakers:true).allSatisfy {$0.segmentIndices.count <= 100})
    }

    @MainActor func testDismissInvalidatesAnOutstandingMicrophonePermission() async {
        var permissionReply: CheckedContinuation<Bool, Never>?
        let recorder = VoiceSampleRecorder(permission: { await withCheckedContinuation { permissionReply = $0 } })
        let attempt = Task { await recorder.record() }
        while permissionReply == nil { await Task.yield() }
        XCTAssertTrue(recorder.starting)
        recorder.cleanup(); permissionReply?.resume(returning:true); await attempt.value
        XCTAssertFalse(recorder.starting); XCTAssertFalse(recorder.recording); XCTAssertNil(recorder.sample)
    }
    @MainActor func testRepeatedRecordTapCannotStartTwoPermissionRequests() async {
        var permissionReply: CheckedContinuation<Bool, Never>?
        var requests=0
        let recorder = VoiceSampleRecorder(permission: { requests += 1; return await withCheckedContinuation { permissionReply = $0 } })
        let first = Task { await recorder.record() }
        while permissionReply == nil { await Task.yield() }
        await recorder.record(); XCTAssertEqual(requests,1)
        recorder.cleanup(); permissionReply?.resume(returning:false); await first.value
    }
    func testHugeFiniteExtractionTimestampFailsWithoutIntegerOverflow() throws {
        let source=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString+".wav")
        defer {try? FileManager.default.removeItem(at:source)}
        let format=AVAudioFormat(commonFormat:.pcmFormatInt16,sampleRate:16000,channels:1,interleaved:false)!
        let file=try AVAudioFile(forWriting:source,settings:format.settings)
        _ = file
        XCTAssertThrowsError(try VoiceSampleAudio.extract(source,start:Double.greatestFiniteMagnitude/2,end:Double.greatestFiniteMagnitude))
    }

    @MainActor func testAnswerDoesNotEraseANewerQuestionDraft() async throws {
        var reply: CheckedContinuation<Data, Error>?
        let model = NativeAskModel(request: { _, method, _ in
            if method == "GET" { return Data(#"{"inquiries":[]}"#.utf8) }
            return try await withCheckedThrowingContinuation { reply = $0 }
        })
        model.question = "Original question"
        let ask = Task { await model.ask() }
        while reply == nil { await Task.yield() }
        model.question = "Next question draft"
        reply?.resume(returning: Data(#"{"answer":"Answer","sources":[],"passage_count":0}"#.utf8))
        await ask.value
        XCTAssertEqual(model.answer,"Answer"); XCTAssertEqual(model.question,"Next question draft")
    }
    @MainActor func testCodeSuggestionsCannotFollowAnotherConversation() {
        let model = NativeCodebookModel()
        let suggestion = NativeCodebookSuggestion(applications: [], proposed: [.init(name:"Theme",description:"",field:"rq1_documentary_record",excerpt:"Excerpt")])
        model.selectedConversationID = "first"
        model.applySuggestion(suggestion,conversationID:"first")
        XCTAssertEqual(model.suggestionConversationID,"first")
        model.selectedConversationID = "second"
        XCTAssertNil(model.suggestion); XCTAssertTrue(model.selectedSuggestions.isEmpty)
        model.applySuggestion(suggestion,conversationID:"first")
        XCTAssertNil(model.suggestion)
    }
    @MainActor func testTurningReminderOffInvalidatesPendingPermission() async {
        var reply: CheckedContinuation<Bool, Error>?
        let prefs = NativeReminderPreferences(permission: { try await withCheckedThrowingContinuation {reply = $0} })
        let turnOn = Task { await prefs.setEnabled(true) }
        while reply == nil { await Task.yield() }
        await prefs.setEnabled(false); reply?.resume(returning:true); await turnOn.value
        XCTAssertFalse(prefs.isEnabled)
        XCTAssertFalse(UserDefaults.standard.bool(forKey:"trace.dailyReminder.enabled"))
    }

}
