/**
 * The cross-device conflict rule, kept pure and dependency-free so it can be
 * tested directly rather than only through the browser.
 *
 * Extracted from sync.ts after a bug that lived exactly here: a ticked promise
 * could be silently reverted by a merge, which is the one outcome the
 * product's third principle forbids.
 */

/**
 * Order-independent structural comparison.
 *
 * `sync.ts` decides whether to push by comparing `JSON.stringify(merged)` with
 * `JSON.stringify(remote)`. That comparison is unsound across this app's
 * storage boundary: the browser writes objects in source order, while the
 * server stores them as Postgres `jsonb`, which normalises keys by length then
 * bytewise. A record written as
 *   conversationId, timestamp, title, date, analysis, doneKeys
 * comes back as
 *   date, title, analysis, doneKeys, timestamp, conversationId
 * — identical content, different string. So the inequality was permanently
 * true and every page load scheduled a PUT of the entire namespace, whether or
 * not anything had changed. Comparing with sorted keys makes the check mean
 * what it was always meant to mean.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export type TimestampedRecord = { timestamp?: string } & Record<string, unknown>;
export type RecordMap = Record<string, TimestampedRecord>;
export type ArrayRecord = Record<string, unknown>;

/**
 * Done-state fields that carry their own clock.
 *
 * Ticking a commitment or a plan step deliberately does NOT restamp the
 * record's `timestamp` — that field means "when this analysis was produced",
 * and bumping it on a tick would make a three-week-old analysis report as
 * freshly run. But that left the tick with no clock of its own, so the merge
 * could only compare the analysis timestamps, which were identical, and the
 * tie resolved to the server. A tick therefore lost every race against a
 * pre-tick server copy: a reload inside the 1.2s push debounce, an offline
 * tick, or a dropped request all silently reverted it.
 *
 * Each done-state field now carries its own `*UpdatedAt` stamp and is
 * resolved independently of the record it lives on, so the most recent tick
 * wins regardless of which device made it.
 */
const DONE_FIELDS: { keys: string; stamp: string }[] = [
  { keys: "doneKeys", stamp: "doneKeysUpdatedAt" },
  { keys: "planDoneKeys", stamp: "planDoneUpdatedAt" },
];

/**
 * Newest `timestamp` wins for the record as a whole; a record only one side
 * has is always kept; and each done-state field is resolved separately by its
 * own stamp so a tick is never reverted by an otherwise-newer record.
 *
 * Ties on the record timestamp still resolve to remote, unchanged — that is
 * only about which analysis body to keep, and both sides' bodies are the same
 * in every case that matters.
 */
export function mergeMaps(local: RecordMap, remote: RecordMap): RecordMap {
  const merged: RecordMap = { ...remote };
  for (const [id, localRec] of Object.entries(local)) {
    const remoteRec = remote[id];
    if (!remoteRec) {
      merged[id] = localRec;
      continue;
    }
    const l = localRec?.timestamp ?? "";
    const r = remoteRec?.timestamp ?? "";
    const winner = l > r ? localRec : remoteRec;
    merged[id] = resolveDoneFields(winner, localRec, remoteRec);
  }
  return merged;
}

/**
 * Overlay whichever side ticked most recently onto the winning record.
 *
 * A side with a stamp always beats a side without one: an absent stamp means
 * that copy predates this mechanism, so it cannot have a more recent tick than
 * one that was explicitly recorded. When neither side has a stamp, the
 * winner's own value stands and behaviour is exactly as it was for legacy data.
 */
function resolveDoneFields(
  winner: TimestampedRecord,
  localRec: TimestampedRecord,
  remoteRec: TimestampedRecord
): TimestampedRecord {
  let out = winner;
  for (const { keys, stamp } of DONE_FIELDS) {
    const ls = typeof localRec[stamp] === "string" ? (localRec[stamp] as string) : "";
    const rs = typeof remoteRec[stamp] === "string" ? (remoteRec[stamp] as string) : "";
    if (!ls && !rs) continue;
    const fresher = ls >= rs ? localRec : remoteRec;
    if (fresher === out) continue;
    if (!(keys in fresher) && !(stamp in fresher)) continue;
    // Copy-on-write: never mutate either side's record in place.
    out = { ...out, [keys]: fresher[keys], [stamp]: fresher[stamp] };
  }
  return out;
}

/**
 * Entries keyed by their conversation-id set and re-runnable, so a whole-list
 * replace is harmless — newest-list-wins by length is sufficient.
 */
export function mergeByLength(local: ArrayRecord[], remote: ArrayRecord[]): ArrayRecord[] {
  return remote.length > local.length ? remote : local;
}

/**
 * One entry per real conversationId whose `current.timestamp` genuinely can
 * differ between devices. A length comparison would silently drop a newer
 * local edit whenever the other side has more distinct conversations analyzed.
 */
export function mergeConversationList(local: ArrayRecord[], remote: ArrayRecord[]): ArrayRecord[] {
  const byId = new Map<string, ArrayRecord>();
  for (const r of remote) {
    const id = r?.conversationId;
    if (typeof id === "string") byId.set(id, r);
  }
  for (const l of local) {
    const id = l?.conversationId;
    if (typeof id !== "string") continue;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, l);
      continue;
    }
    const lt = (l.current as { timestamp?: string } | undefined)?.timestamp ?? "";
    const rt = (existing.current as { timestamp?: string } | undefined)?.timestamp ?? "";
    if (lt > rt) byId.set(id, l);
  }
  return Array.from(byId.values());
}

export function mergeArrayNamespace(ns: string, local: ArrayRecord[], remote: ArrayRecord[]): ArrayRecord[] {
  return ns === "omi-thesis-analyses" ? mergeConversationList(local, remote) : mergeByLength(local, remote);
}
