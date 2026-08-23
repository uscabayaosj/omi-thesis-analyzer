"use client";

import { fetchJson } from "@/lib/fetch-json";
import type { Conversation } from "@/lib/omi-api";
import {
  addPending,
  getExtractedConversationIds,
  getIgnoredNames,
  getPeople,
  markConversationExtracted,
  matchPerson,
  normalize,
  type ExtractedPerson,
} from "@/lib/people";

/**
 * Run the extraction pass for one conversation and convert results into
 * pending suggestions. Safe to call after any lens completes — failures are
 * returned, never thrown, so analysis flows can ignore them.
 */
export async function runExtraction(
  conversationId: string,
  opts?: { force?: boolean }
): Promise<{ suggested: number } | { error: string }> {
  if (!opts?.force && getExtractedConversationIds().has(conversationId)) {
    return { suggested: 0 };
  }
  let data: { conversation: Conversation; people: ExtractedPerson[] };
  try {
    data = await fetchJson("/api/extract-people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId }),
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Extraction failed." };
  }

  const geo = data.conversation.geolocation ?? undefined;
  const date = data.conversation.created_at;
  const ignored = new Set(getIgnoredNames().map(normalize));
  const people = getPeople();
  let suggested = 0;

  for (const ex of data.people) {
    if (ignored.has(normalize(ex.name))) continue;
    const match = matchPerson(ex.name, people);
    addPending({
      conversationId,
      date,
      extractedName: ex.name,
      details: ex.details,
      placeName: ex.place ?? geo?.location_name ?? geo?.address ?? undefined,
      lat: geo?.latitude,
      lng: geo?.longitude,
      matchedPersonId: match.kind === "confident" ? match.personId : undefined,
      candidateIds: match.kind === "ambiguous" ? match.candidateIds : undefined,
    });
    suggested++;
  }
  markConversationExtracted(conversationId);
  return { suggested };
}
