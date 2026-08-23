"use client";

import { fetchJson } from "@/lib/fetch-json";
import type { Conversation, OmiGeolocation } from "@/lib/omi-api";
import type { AdhdPerson } from "@/lib/adhd";
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

/**
 * Route the ADHD lens's own `people` output through the same matcher/pending
 * pipeline as the LLM extraction pass. Meant to be called alongside
 * `runExtraction` for the same conversation — `addPending`'s existing
 * per-conversation + normalized-name dedup collapses any overlap between the
 * two sources. Never throws: this runs fire-and-forget inside the ADHD lens's
 * own success handler and touches localStorage synchronously (which can in
 * principle throw on quota), so failures are swallowed and logged.
 */
export function suggestFromAdhdPeople(
  conversationId: string,
  date: string,
  people: AdhdPerson[],
  geo?: OmiGeolocation | null
): void {
  try {
    const ignored = new Set(getIgnoredNames().map(normalize));
    const existing = getPeople();
    for (const ap of people) {
      if (!ap.name || ignored.has(normalize(ap.name))) continue;
      const details = [ap.shared, ap.owed].filter(
        (d): d is string => !!d && d.trim().length > 0 && d.trim().toLowerCase() !== "none"
      );
      const match = matchPerson(ap.name, existing);
      addPending({
        conversationId,
        date,
        extractedName: ap.name,
        details,
        placeName: geo?.location_name ?? geo?.address ?? undefined,
        lat: geo?.latitude,
        lng: geo?.longitude,
        matchedPersonId: match.kind === "confident" ? match.personId : undefined,
        candidateIds: match.kind === "ambiguous" ? match.candidateIds : undefined,
      });
    }
  } catch (e) {
    console.error("suggestFromAdhdPeople failed", e);
  }
}
