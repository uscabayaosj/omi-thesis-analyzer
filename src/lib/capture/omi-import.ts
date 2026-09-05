import { getConversations, getConversation, type Conversation as OmiConversation } from "../omi-api";
import { omiToRow, type ConversationRow } from "./omi-import-map";

export { omiToRow, type ConversationRow } from "./omi-import-map";

const PAGE = 50;

/**
 * One-time backfill. The list endpoint omits transcripts, so each page's
 * conversations are fetched individually for their segments — slow but it
 * runs once, and it is idempotent (upsert by id) so a timeout mid-way is
 * simply resumed by running it again.
 */
export async function importOmiHistory(
  upsert: (rows: ConversationRow[]) => Promise<void>,
  deps = { list: getConversations, get: getConversation },
): Promise<{ imported: number }> {
  let offset = 0;
  let imported = 0;
  for (;;) {
    const page: OmiConversation[] = await deps.list(PAGE, offset);
    if (page.length === 0) break;
    const full = await Promise.all(page.map((c) => deps.get(c.id)));
    await upsert(full.map(omiToRow));
    imported += full.length;
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return { imported };
}
