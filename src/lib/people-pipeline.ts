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
      // Preference order: the LLM's own read of the transcript (a real name,
      // "the Ronan feed store") beats Omi's `address` (a formatted address,
      // still human-readable) beats `location_type` (a coarse category like
      // "restaurant" — better than nothing, but not a name).
      placeName: ex.place ?? geo?.address ?? geo?.location_type ?? undefined,
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

/** An LLM "None" is the schema's way of saying absent — treat it as empty. */
function meaningful(value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v || v.toLowerCase() === "none") return undefined;
  return v;
}

/**
 * Route the ADHD lens's own `people` output through the same matcher/pending
 * pipeline as the LLM extraction pass.
 *
 * This is the *whole* people pass for an ADHD-lens conversation, not a
 * supplement to one: that lens already names everyone in the transcript, so
 * calling `runExtraction` here too would re-send the entire transcript — the
 * ~97% of a request's tokens that isn't prompt — to learn what we were just
 * told. The ADHD schema carries `place` for exactly this reason, so the
 * cheaper source loses nothing. `runExtraction` still owns thesis-only
 * conversations, whose output has no people in it.
 *
 * Never throws: this runs fire-and-forget inside the ADHD lens's own success
 * handler and touches localStorage synchronously (which can throw on quota),
 * so failures are swallowed and logged rather than surfacing in that lens.
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
      const details = [meaningful(ap.shared), meaningful(ap.owed)].filter(
        (d): d is string => d !== undefined
      );
      const match = matchPerson(ap.name, existing);
      addPending({
        conversationId,
        date,
        extractedName: ap.name,
        details,
        // Same preference order as runExtraction: transcript read, then
        // Omi's formatted address, then its coarse location category.
        placeName:
          meaningful(ap.place) ?? geo?.address ?? geo?.location_type ?? undefined,
        lat: geo?.latitude,
        lng: geo?.longitude,
        matchedPersonId: match.kind === "confident" ? match.personId : undefined,
        candidateIds: match.kind === "ambiguous" ? match.candidateIds : undefined,
      });
    }
    // Claim the conversation so a later backfill doesn't pay for the
    // transcript pass this call just made unnecessary.
    markConversationExtracted(conversationId);
  } catch (e) {
    console.error("suggestFromAdhdPeople failed", e);
  }
}
