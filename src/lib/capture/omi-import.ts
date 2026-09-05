import { getConversations, getConversation, type Conversation as OmiConversation } from "../omi-api";
import { omiToRow, type ConversationRow } from "./omi-import-map";

export { omiToRow, type ConversationRow } from "./omi-import-map";

const PAGE = 50;
const SPACING_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Omi rate-limits bursts; a 429 is retried with backoff before giving up. */
async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("Omi API 429") || attempt >= 3) throw err;
      await sleep(2000 * 2 ** attempt);
    }
  }
}

/**
 * One-time backfill, driven page by page so it fits inside one function
 * invocation and inside Omi's rate limit: conversations are fetched one at a
 * time with a short gap (the list endpoint omits transcripts). Idempotent
 * (upsert by id), so any page can be re-run. Returns the offset to continue
 * from, or null when the history is exhausted.
 */
export async function importOmiHistory(
  upsert: (rows: ConversationRow[]) => Promise<void>,
  opts: { offset?: number; pages?: number } = {},
  deps = { list: getConversations, get: getConversation },
): Promise<{ imported: number; nextOffset: number | null }> {
  let offset = opts.offset ?? 0;
  let imported = 0;
  for (let p = 0; p < (opts.pages ?? 1); p++) {
    const page: OmiConversation[] = await withBackoff(() => deps.list(PAGE, offset));
    if (page.length === 0) return { imported, nextOffset: null };
    const full: OmiConversation[] = [];
    for (const c of page) {
      full.push(await withBackoff(() => deps.get(c.id)));
      await sleep(SPACING_MS);
    }
    await upsert(full.map(omiToRow));
    imported += full.length;
    offset += page.length;
    if (page.length < PAGE) return { imported, nextOffset: null };
  }
  return { imported, nextOffset: offset };
}
