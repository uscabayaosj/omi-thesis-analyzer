import Foundation

public enum UploadRetryPolicy {
    public static func delay(attempt: Int, httpStatus: Int? = nil, networkCode: URLError.Code? = nil) -> TimeInterval? {
        guard (0..<6).contains(attempt) else { return nil }
        let transientHTTP = httpStatus.map { $0 == 408 || $0 == 429 || (500...599).contains($0) } ?? false
        let transientNetwork: Set<URLError.Code> = [.timedOut, .cannotFindHost, .cannotConnectToHost, .networkConnectionLost, .dnsLookupFailed, .notConnectedToInternet, .resourceUnavailable]
        guard transientHTTP || networkCode.map({ transientNetwork.contains($0) }) == true else { return nil }
        return min(60, 5 * pow(2, Double(attempt)))
    }

    public static func orderedIDs(_ ids: Set<String>, startedAt: [String: Date]) -> [String] {
        ids.sorted {
            let lhs = startedAt[$0] ?? .distantFuture
            let rhs = startedAt[$1] ?? .distantFuture
            return lhs == rhs ? $0 < $1 : lhs < rhs
        }
    }
}
