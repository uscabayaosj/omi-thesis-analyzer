import type { ReactNode } from "react";

// Markdown-lite renderer for model-written prose. The analysis prompts allow
// "simple markdown like bold or hyphen bullets", but the raw string used to be
// rendered verbatim (whitespace-pre-wrap), so `**bold**` asterisks and `- `
// dashes showed as literal characters — a wall of text. This turns that string
// into real paragraphs, lists, and <strong>, and nothing more: no links, no
// code, no images, because the prompts never ask for them. Unrecognized syntax
// degrades to plain text rather than erroring.

// Inline pass: **bold** only.
function renderInline(text: string): ReactNode {
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="text-slate-100 font-semibold">{part}</strong> : part
  );
}

/** Inline-only variant for short strings (list items the UI already structures). */
export function Inline({ text }: { text: string }) {
  return <>{renderInline(text)}</>;
}

type Chunk =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

function parseChunks(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    // A model sometimes emits a `## heading` despite instructions — show its
    // text as a bold paragraph rather than literal hash marks.
    const heading = /^#{1,6}\s+(.*)$/.exec(line);

    const last = chunks[chunks.length - 1];
    if (bullet) {
      if (last?.kind === "ul") last.items.push(bullet[1]);
      else chunks.push({ kind: "ul", items: [bullet[1]] });
    } else if (numbered) {
      if (last?.kind === "ol") last.items.push(numbered[1]);
      else chunks.push({ kind: "ol", items: [numbered[1]] });
    } else if (heading) {
      chunks.push({ kind: "p", lines: [`**${heading[1]}**`] });
    } else if (last?.kind === "p") {
      last.lines.push(line);
    } else {
      chunks.push({ kind: "p", lines: [line] });
    }
  }
  return chunks;
}

export function Prose({ text, className = "" }: { text: string; className?: string }) {
  const chunks = parseChunks(text);
  return (
    <div className={`space-y-2.5 ${className}`}>
      {chunks.map((chunk, i) => {
        if (chunk.kind === "ul") {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1.5 marker:text-slate-600">
              {chunk.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
            </ul>
          );
        }
        if (chunk.kind === "ol") {
          return (
            <ol key={i} className="list-decimal pl-5 space-y-1.5 marker:text-slate-500">
              {chunk.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
            </ol>
          );
        }
        return <p key={i}>{renderInline(chunk.lines.join(" "))}</p>;
      })}
    </div>
  );
}
