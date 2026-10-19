#if DEBUG
import Foundation

/// Deterministic UI scenarios. Never contacts a server or changes enrollment.
@MainActor
enum NativeUIFixtures {
    static var isActive: Bool { ProcessInfo.processInfo.arguments.contains("--trace-ui-fixtures") }
    private static var failedRollupLoad = false
    private static var failedGeneration = false
    private static var generated = false
    private static var failedStep = false
    private static var deletedConversationIDs = Set<String>()
    static let source = "The field team agreed to review the interview guide before the next session. Participants asked for clearer consent language and a quieter interview location."
    private static let date = "2026-10-01T07:00:00Z"
    private static var location: [String: Any] = ["latitude": 51.5, "longitude": -0.1, "source": "manual"]
    private static var voiceEnabled = false
    private static var conversation: [String: Any] {
        var value: [String: Any] = ["id": "fixture-conversation", "geolocation": location, "createdAt": date, "startedAt": date, "finishedAt": "2026-10-01T07:03:00Z",
         "structured": ["title": "Review the interview guide", "overview": source, "actionItems": [["description": "Review the interview guide", "completed": false]]],
         "transcriptSegments": [["id": "segment-1", "text": source, "speakerName": "Fixture speaker"]]]
        if ProcessInfo.processInfo.arguments.contains("--trace-ui-speakers") {
            value["transcriptSegments"] = [
                ["id": "a", "text": "We should call tomorrow.", "speakerId": 0, "speakerStatus": "estimated", "start": 0.0, "end": 2.0],
                ["id": "b", "text": "After breakfast.", "speakerId": 0, "speakerStatus": "estimated", "start": 2.0, "end": 3.0],
                ["id": "c", "text": "I agree.", "speakerId": 1, "speakerStatus": "estimated", "start": 3.0, "end": 4.0],
                ["id": "d", "text": "A quiet voice.", "speakerId": 0, "speakerStatus": "uncertain", "start": 4.0, "end": 5.0],
                ["id": "e", "text": "No speaker evidence.", "speakerStatus": "unknown", "start": 5.0, "end": 6.0],
            ]
        }
        if ProcessInfo.processInfo.arguments.contains("--trace-ui-voices") {
            value["transcriptRevision"] = "fixture-revision"
            value["transcriptSegments"] = [["text": "This is my reference suggestion.", "speakerId": 0, "speakerStatus": "estimated", "start": 0.0, "end": 8.0, "speakerName": "You", "speakerPersonId": "self", "voiceMatchStatus": "suggested", "voiceProfileId": "fixture-voice", "diarizerModel": "gpt-4o-transcribe-diarize", "diarizerProvider": "openai"]]
        }
        return value
    }
    private static var thesis: [String: Any] {
        ["title": "Interview planning", "rq1_documentary_record": source, "rq2_everyday_practices": "The team prepares together.", "rq3_cskt_intersection": "No intersection stated.", "rq4_wildness_imaginary": "No imaginary stated.", "conditions_check": "Consent and quiet space matter.", "rival_hypothesis_test": "No rival hypothesis stated.", "refutation_signals": "No refutation stated.", "forward_thinking": "Review the guide."]
    }
    private static var group: [String: Any] {
        ["id": "fixture-group", "conversationIds": ["fixture-conversation", "fixture-second"],
         "conversations": [["id": "fixture-conversation", "title": "Review the interview guide", "date": date, "emoji": ""], ["id": "fixture-second", "title": "Prepare the next session", "date": date, "emoji": ""]],
         "timestamp": date, "analysis": ["cross_conversation_themes": source, "contradictions_and_tensions": "No contradiction stated.", "evolution_and_patterns": "Planning became more specific.", "synthesis": "The team needs a clear interview guide.", "forward_thinking": "Review before the next session."]]
    }
    static func response(path: String, method: String, body: Data? = nil) throws -> Data {
        let arguments = ProcessInfo.processInfo.arguments
        var value: [String: Any]
        switch path {
        case "/api/native/v1/voices":
            if method == "POST", let body, let action = try JSONSerialization.jsonObject(with: body) as? [String: Any], let enabled = action["enabled"] as? Bool { voiceEnabled = enabled }
            value = ["enabled": voiceEnabled, "revision": 0, "configured": true, "model": "gpt-4o-transcribe-diarize", "profiles": []]
        case "/api/native/v1/conversations":
            if method == "DELETE" {
                if arguments.contains("--trace-ui-delete-error") { throw NativeConnectionError.server("Deletion unavailable. Try again.") }
                let object = try JSONSerialization.jsonObject(with: body ?? Data()) as? [String: Any]
                let ids = object?["ids"] as? [String] ?? []
                deletedConversationIDs.formUnion(ids)
                value = ["deletedIDs": ids]
            } else {
                var rows = [conversation]
                if arguments.contains("--trace-ui-delete") {
                    for id in ["fixture-second", "fixture-third"] {
                        var row = conversation; row["id"] = id; rows.append(row)
                    }
                }
                value = ["conversations": arguments.contains("--trace-ui-empty") ? [] : rows.filter { !deletedConversationIDs.contains($0["id"] as? String ?? "") }, "hasMore": false]
            }
        case "/api/native/v1/conversations/fixture-conversation/analyses": value = ["thesis": ["current": thesis]]
        case "/api/native/v1/conversations/fixture-conversation":
            if method == "PATCH", let body, let object = try JSONSerialization.jsonObject(with: body) as? [String: Any], let pin = object["geolocation"] as? [String: Any] { location = pin; value = ["geolocation": pin] }
            else { value = ["conversation": conversation] }
        case "/api/native/v1/commitments":
            let commitment: [String: Any] = ["key": "guide", "who": "You", "what": "Review the interview guide", "direction": "user_to_other", "deadline": "Today", "confidence": "high", "quote": source]
            let analysis: [String: Any] = ["summary": source, "doToday": ["Review the interview guide"], "commitments": [commitment], "remember": [], "openLoops": [], "ahead": []]
            value = ["analyses": arguments.contains("--trace-ui-empty") ? [:] : ["fixture-conversation": ["conversationId": "fixture-conversation", "title": "Review the interview guide", "date": date, "analysis": analysis]]]
        case "/api/native/v1/rollups":
            if method == "GET", arguments.contains("--trace-ui-rollup-error"), !failedRollupLoad {
                failedRollupLoad = true; throw NativeConnectionError.server("Fixture outage: planning service is unavailable.")
            }
            if method == "PATCH", arguments.contains("--trace-ui-step-error"), !failedStep {
                failedStep = true; throw NativeConnectionError.server("Fixture outage: step update did not save.")
            }
            value = ["day": "2026-10-01", "weekStart": "2026-09-28"]
            if !arguments.contains("--trace-ui-empty") && (!arguments.contains("--trace-ui-generate-error") || generated) {
                value["daily"] = ["planDoneKeys": [], "rollup": ["todayParagraph": source, "tomorrowPlan": "Prepare the session.", "planSteps": [["key": "session", "what": "Prepare the next session"]], "agingCommitments": "Revisit the guide.", "conflictsAtRisk": "No conflict stated.", "socialLedger": "The team is preparing.", "tomorrowEvents": "Next session.", "dropped": "Nothing let go."]]
                value["weekly"] = ["rollup": ["weekSummary": source, "completionPattern": "Preparation continues.", "chronicallyAging": "Review the guide.", "droppedThisWeek": "None.", "socialPattern": "Team planning.", "nextWeekSetup": "Prepare the session."]]
            }
        case "/api/native/v1/rollups/generate":
            if arguments.contains("--trace-ui-generate-error"), !failedGeneration {
                failedGeneration = true; throw NativeConnectionError.server("Fixture outage: review generation failed.")
            }
            generated = true; value = ["ok": true]
        case "/api/native/v1/group-analyses": value = ["groups": [group]]
        case "/api/native/v1/codebook":
            value = ["codes": [["id": "fixture-code", "name": "Preparation", "description": "Planning before fieldwork", "timestamp": date]], "evidence": [], "analyses": [["conversationId": "fixture-conversation", "title": "Review the interview guide", "date": date]]]
        case "/api/native/v1/ask":
            let source: [String: Any] = ["tag": "G1", "kind": "group", "conversationIds": ["fixture-conversation", "fixture-second"], "title": "Interview planning group", "label": "Synthesis"]
            value = ["inquiries": [["id": "fixture-inquiry", "question": "What preparation is needed?", "askedAt": date, "answer": "Review the interview guide [G1].", "sources": [source], "passageCount": 1]]]
        case "/api/native/v1/people":
            value = ["people": [["id": "fixture-person", "name": "Fixture colleague", "notes": "", "aliases": [], "facts": [], "meetings": []]], "relationships": [], "meetingLocations": [], "places": [["id": "fixture-place", "name": "Field office", "lat": 7.0731, "lng": 125.6128, "notes": "Quiet meeting space"]]]
        case "/api/native/v1/usage":
            let period: [String: Any] = ["costUsd": NSNull(), "callCount": 1, "promptTokens": 120, "completionTokens": 40]
            value = ["configured": true, "today": period, "thisWeek": period, "thisMonth": period, "byLabel": [["key": "thesis-ask", "costUsd": NSNull(), "callCount": 1]], "byModel": []]
        case "/api/native/v1/patterns":
            value = ["patterns": ["coverage": [["week": "2026-09-28", "activeDays": 1, "rolledDays": 1]], "rollupStreak": 1, "weeks": [["week": "2026-09-28", "created": 1, "done": 0, "letGo": 0, "open": 1]], "completionRate": 0, "openCount": 1, "openMedianAgeDays": 1, "openOver14": 0, "people": [], "loops": [], "planRate": 0, "planDays": []]]
        default: throw NativeConnectionError.server("UI fixture does not support this action. No network request was sent.")
        }
        return try JSONSerialization.data(withJSONObject: value)
    }
}
#endif
