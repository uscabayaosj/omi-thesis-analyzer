/// Finish must read back a conversation even if silence already completed it.
/// A current pending session takes priority over a previously completed one.
public enum CaptureCompletionPolicy {
    public static func canClose(requested: Bool, queuedUploads: Int, localWrites: Int, generationMatches: Bool) -> Bool {
        requested && queuedUploads == 0 && localWrites == 0 && generationMatches
    }

    public static func sessionsToRefresh(pending: Set<String>, lastSession: String?) -> Set<String> {
        if !pending.isEmpty { return pending }
        if let lastSession { return [lastSession] }
        return []
    }
}
