import { cosineSimilarity } from "./identify.ts";

export interface ClusterItem {
  key: string;
  /** null = unembeddable; it gets a group of its own and joins no other. */
  embedding: number[] | null;
}

export function voiceKey(conversationId: string, speakerId: number): string {
  return `${conversationId}:${speakerId}`;
}

/**
 * Greedy single-link clustering over cosine similarity: an item joins any group
 * containing a member it is similar enough to, and bridges two groups into one
 * when it is similar to both.
 *
 * Order-dependent by nature, so the caller must pass items in a stable order
 * (conversation date) — a group is a review convenience, not stored identity,
 * and the identity is the Person created when the user names the group.
 *
 * A group is named for its earliest member, so ids stay stable as later
 * conversations join an existing group.
 */
export function clusterEmbeddings(items: ClusterItem[], threshold: number): Record<string, string> {
  const groups: { id: string; members: ClusterItem[] }[] = [];

  for (const item of items) {
    if (!item.embedding) {
      groups.push({ id: item.key, members: [item] });
      continue;
    }
    const hits = groups.filter((g) =>
      g.members.some(
        (m) =>
          m.embedding !== null &&
          m.embedding.length === item.embedding!.length &&
          cosineSimilarity(m.embedding, item.embedding!) >= threshold
      )
    );
    if (hits.length === 0) {
      groups.push({ id: item.key, members: [item] });
      continue;
    }
    // Keep the earliest group's id and fold the rest into it.
    const [keep, ...merged] = hits;
    keep.members.push(item);
    for (const g of merged) {
      keep.members.push(...g.members);
      groups.splice(groups.indexOf(g), 1);
    }
  }

  const out: Record<string, string> = {};
  for (const g of groups) for (const m of g.members) out[m.key] = g.id;
  return out;
}
