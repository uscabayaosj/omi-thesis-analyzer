import { chatCompletion, clampTranscript, extractJsonObject } from "./analysis";

export interface ExtractedPerson {
  name: string;
  details: string[];
  place?: string;
}

const SYSTEM_PROMPT = `You extract the people mentioned in or party to a recorded conversation, as a memory aid for the wearer of the recording device (the user). The user has difficulty remembering names.

Rules:
- Include named third parties AND named conversation partners. A name is required — never invent one, never include unnamed speakers ("the cashier"), and never include the user themself.
- Exclude public figures mentioned in passing (politicians, celebrities) unless the user personally interacted with them.
- details: 0-5 short, concrete, remember-worthy facts about that person from THIS conversation (role, relation to others, what they do, commitments involving them, distinguishing details). Neutral tone. No speculation.
- place: if the conversation makes clear WHERE the user encountered or will encounter this person (e.g. "here at the feed store", "at the Ronan church"), give that place name; omit otherwise.

Respond with JSON only:
{"people":[{"name":"Full Name As Heard","details":["...",""],"place":"..."}]}
An empty people array is a correct answer.`;

export async function extractPeople(transcript: string, title: string, date: string): Promise<ExtractedPerson[]> {
  const content = await chatCompletion(
    [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Conversation title: "${title}"\nConversation date: ${date}\n\nTranscript:\n${clampTranscript(transcript)}`,
      },
    ],
    true
  );
  const raw = extractJsonObject(content);
  const list = Array.isArray(raw.people) ? raw.people : [];
  return list
    .map((p): ExtractedPerson | null => {
      if (!p || typeof p !== "object") return null;
      const r = p as Record<string, unknown>;
      if (typeof r.name !== "string" || !r.name.trim()) return null;
      return {
        name: r.name.trim(),
        details: Array.isArray(r.details) ? r.details.filter((d): d is string => typeof d === "string" && !!d.trim()) : [],
        place: typeof r.place === "string" && r.place.trim() ? r.place.trim() : undefined,
      };
    })
    .filter((p): p is ExtractedPerson => p !== null);
}
