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
  { keys: "letGoKeys", stamp: "letGoUpdatedAt" },
  // Not a key list but the same contract: a user act carrying its own clock,
  // resolved independently so it is never reverted by an otherwise-newer
  // record (an enrichment re-run must not un-Keep an ignored conversation).
  { keys: "keep", stamp: "keepUpdatedAt" },
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
 * Last-resort rule for an array namespace with no known record identity:
 * newest-list-wins by length. Only reached for a namespace this module has no
 * merge for — both array namespaces the app actually syncs have one below.
 */
export function mergeByLength(local: ArrayRecord[], remote: ArrayRecord[]): ArrayRecord[] {
  return remote.length > local.length ? remote : local;
}

type CustomField = { timestamp?: string } | undefined;

function customStamp(c: unknown): string {
  return c && typeof c === "object" && typeof (c as CustomField)?.timestamp === "string"
    ? ((c as CustomField)!.timestamp as string)
    : "";
}

/**
 * A custom (free-prompt) result is saved onto an existing analysis without
 * restamping the analysis's own clock — that clock means "when this was
 * analyzed" and drives the age badge. So the record-level rule cannot see it,
 * and on a tie it would resolve to the copy *without* the custom result.
 * Resolve the custom field on its own clock, the way done-state fields are.
 */
function overlayCustom(winner: ArrayRecord, local: unknown, remote: unknown): ArrayRecord {
  const ls = customStamp(local);
  const rs = customStamp(remote);
  if (!ls && !rs) return winner;
  const fresher = ls >= rs ? local : remote;
  return { ...winner, custom: fresher };
}

/**
 * One entry per real conversationId whose `current.timestamp` genuinely can
 * differ between devices. A length comparison would silently drop a newer
 * local edit whenever the other side has more distinct conversations analyzed.
 * The nested `current.custom` is resolved on its own clock (see overlayCustom).
 */
export function mergeConversationList(local: ArrayRecord[], remote: ArrayRecord[]): ArrayRecord[] {
  const byId = new Map<string, ArrayRecord>();
  const unkeyed: ArrayRecord[] = [];
  for (const r of remote) {
    const id = r?.conversationId;
    if (typeof id === "string") byId.set(id, r);
    else unkeyed.push(r);
  }
  for (const l of local) {
    const id = l?.conversationId;
    if (typeof id !== "string") {
      unkeyed.push(l);
      continue;
    }
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, l);
      continue;
    }
    const lc = l.current as Record<string, unknown> | undefined;
    const rc = existing.current as Record<string, unknown> | undefined;
    const lt = (lc?.timestamp as string | undefined) ?? "";
    const rt = (rc?.timestamp as string | undefined) ?? "";
    const winner = lt > rt ? l : existing;
    const wc = winner.current as Record<string, unknown> | undefined;
    const current = wc ? overlayCustom(wc, lc?.custom, rc?.custom) : wc;
    byId.set(id, current === wc ? winner : { ...winner, current });
  }
  // Malformed entries are unreadable but not ours to discard: a merge must
  // never be the step that loses something.
  return [...byId.values(), ...unkeyed];
}

function groupKeyOf(r: ArrayRecord): string | null {
  const ids = r?.conversationIds;
  if (!Array.isArray(ids)) return null;
  const strs = ids.filter((x): x is string => typeof x === "string");
  return strs.length ? [...strs].sort().join(",") : null;
}

/**
 * One entry per group (the sorted set of conversation ids), newest
 * `timestamp` wins, custom result on its own clock. Replaces the old
 * longer-list-wins rule, which dropped a group added on one device whenever
 * the other side happened to hold more groups.
 */
export function mergeGroupList(local: ArrayRecord[], remote: ArrayRecord[]): ArrayRecord[] {
  const byKey = new Map<string, ArrayRecord>();
  const unkeyed: ArrayRecord[] = [];
  for (const r of remote) {
    const k = groupKeyOf(r);
    if (k) byKey.set(k, r);
    else unkeyed.push(r);
  }
  for (const l of local) {
    const k = groupKeyOf(l);
    if (!k) {
      unkeyed.push(l);
      continue;
    }
    const existing = byKey.get(k);
    if (!existing) {
      byKey.set(k, l);
      continue;
    }
    const lt = typeof l.timestamp === "string" ? l.timestamp : "";
    const rt = typeof existing.timestamp === "string" ? existing.timestamp : "";
    const winner = lt > rt ? l : existing;
    byKey.set(k, overlayCustom(winner, l.custom, existing.custom));
  }
  return [...byKey.values(), ...unkeyed];
}

export function mergeArrayNamespace(ns: string, local: ArrayRecord[], remote: ArrayRecord[]): ArrayRecord[] {
  if (ns === "omi-thesis-analyses") return mergeConversationList(local, remote);
  if (ns === "omi-thesis-group-analyses") return mergeGroupList(local, remote);
  return mergeByLength(local, remote);
}

/** Unwrap the `{ list: [...] }` transport wrapper (or accept a bare array). */
export function toList(v: unknown): ArrayRecord[] {
  if (Array.isArray(v)) return v as ArrayRecord[];
  if (v && typeof v === "object" && Array.isArray((v as { list?: unknown }).list)) {
    return (v as { list: ArrayRecord[] }).list;
  }
  return [];
}

export function toMap(v: unknown): RecordMap {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as RecordMap) : {};
}

/** A deletion record — see people.ts's Tombstone; the same shape everywhere. */
export function isTombstoneRecord(v: unknown): boolean {
  return !!v && typeof v === "object" && (v as { deleted?: unknown }).deleted === true;
}

/**
 * The server-side half of the contract: what `PUT /api/store` should store
 * given what a client sent (`incoming`) and what the row already holds
 * (`existing`). The client is treated as "local" and the row as "remote", so
 * ties resolve to the stored copy exactly as they do on a client pull.
 *
 * Exists because the route used to replace the row wholesale. Every pull
 * merged per record, but nothing protected the *server's* copy: a device with
 * an empty or corrupt localStorage that wrote before its first pull landed
 * (a new browser, cleared site data, a slow connection) pushed a one-record
 * map and the server lost everything else. Under this rule a PUT can only add
 * or update records; removing one takes an explicit tombstone.
 *
 * Array namespaces are stored wrapped as `{ list: [...] }` (see kv.ts); the
 * result keeps that shape.
 */
export function mergeNamespaceValue(ns: string, isArray: boolean, incoming: unknown, existing: unknown): unknown {
  if (isArray) {
    const merged = mergeArrayNamespace(ns, toList(incoming), toList(existing));
    return { list: merged };
  }
  if (existing == null) return toMap(incoming);
  return mergeMaps(toMap(incoming), toMap(existing));
}
