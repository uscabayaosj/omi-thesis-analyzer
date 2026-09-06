import type { Conversation } from "./conversation-types";

/**
 * Local-only stand-in for TRACE's store, so the list and detail screens can
 * be exercised in `next dev` without a database.
 *
 * Local development is deliberately localStorage-only (getStore() refuses a
 * DATABASE_URL outside production — see kv.ts), which is right for safety but
 * leaves every conversation-driven screen empty. With `TRACE_FIXTURES=1` the
 * two conversation routes answer from this in-memory set instead. Never active
 * in a production build, never active without the flag, and never persisted:
 * an analysis run against one of these goes to the real AI provider, so don't
 * run one unless that spend is intended.
 */
export function fixturesEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.TRACE_FIXTURES === "1";
}

function at(daysAgo: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

function seg(speaker: number, text: string, name?: string) {
  return { speaker_id: speaker, speaker_name: name, text };
}

const FIXTURES: Conversation[] = [
  {
    id: "fx-fence-dale",
    created_at: at(0, 9, 12),
    source: "trace",
    structured: {
      title: "Fence repair plan with Dale",
      overview: "Dale agreed to bring the post driver Thursday; the east line needs six new posts before the lease cattle arrive.",
      category: "ranch work",
      emoji: "🪵",
    },
    geolocation: { latitude: 47.6, longitude: -114.1, address: "Dry Fork Ranch, Ronan, MT" },
    transcript_segments: [
      seg(0, "So the east line, the one along the county road, that whole stretch is leaning."),
      seg(1, "I saw that. Six posts, maybe seven. I can bring the driver Thursday.", "Dale"),
      seg(0, "Thursday works. The lease cattle come the week after, so it has to hold by then."),
      seg(1, "My granddad put that fence in after the war. Never had a permit for any of it.", "Dale"),
      seg(0, "Nobody asked back then."),
      seg(1, "Nobody asks now either, until the Forest Service does.", "Dale"),
    ],
  },
  {
    id: "fx-untitled-morning",
    created_at: at(0, 11, 40),
    source: "trace",
    structured: { title: "", overview: "", category: "" },
    transcript_segments: [
      seg(0, "Did you get the water compact letter?"),
      seg(2, "Came Tuesday. I haven't opened it. What's the point, they already decided."),
      seg(0, "The point is the deadline is the thirtieth."),
      seg(2, "Then I'll open it on the twenty-ninth."),
    ],
    unmatched_speakers: [2],
  },
  {
    id: "fx-noise-radio",
    created_at: at(0, 13, 5),
    source: "trace",
    structured: { title: "", overview: "", category: "" },
    transcript_segments: [seg(0, "...and that's the forecast for the valley, back after this.")],
  },
  {
    id: "fx-branding-day",
    created_at: at(1, 15, 30),
    source: "omi",
    structured: {
      title: "Branding day at the Kesslers",
      overview: "Three families worked the calves; talk turned to who inherits the north pasture and whether Ray's brand transfers with it.",
      category: "kinship",
      emoji: "🐄",
    },
    geolocation: { latitude: 47.52, longitude: -114.09, location_type: "farm" },
    transcript_segments: [
      seg(0, "How many head this year?"),
      seg(1, "Hundred and twelve. Down from last year, we sold the pairs in March.", "Ray Kessler"),
      seg(3, "The north pasture goes to Barbara when Ray's done. That was always the deal.", "June Kessler"),
      seg(1, "The brand goes with the ground. That's how it's registered.", "Ray Kessler"),
      seg(0, "Registered with the state?"),
      seg(1, "With the state, sure. But the brand was ours before the state cared.", "Ray Kessler"),
    ],
  },
  {
    id: "fx-feed-store",
    created_at: at(1, 17, 10),
    source: "omi",
    structured: { title: "", overview: "", category: "errand" },
    transcript_segments: [
      seg(0, "Two of the mineral tubs and the salt."),
      seg(4, "You want the loose or the block?"),
      seg(0, "Block. And put it on the account."),
      seg(4, "Tell June I'll have her order Friday."),
    ],
  },
  {
    id: "fx-council-meeting",
    created_at: at(5, 19, 0),
    source: "omi",
    structured: {
      title: "County commission public comment on grazing permits",
      overview: "Public comment ran ninety minutes; three ranchers framed the BLM review as a repeat of the homestead fights.",
      category: "public meeting",
      emoji: "🏛️",
    },
    transcript_segments: [
      seg(5, "My family has run cattle on that allotment since 1911. We were here before the agency existed."),
      seg(6, "The review is statutory, sir. It is not a judgment on your family."),
      seg(5, "It's the same fight my grandfather had. Different letterhead."),
      seg(0, "Note for later: ask who filed the 1911 entry and whether it was a patent or a lease."),
    ],
  },
];

export function fixtureConversations(): Conversation[] {
  return FIXTURES.map((c) => ({ ...c }));
}

export function fixtureConversation(id: string): Conversation | null {
  const found = FIXTURES.find((c) => c.id === id);
  return found ? { ...found } : null;
}
