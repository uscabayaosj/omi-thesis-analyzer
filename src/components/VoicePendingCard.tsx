"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { type PendingSuggestion, type Person } from "@/lib/people";
import { BUTTON_PRIMARY, optionLabel } from "@/lib/ui";
import { getAnalysisAge } from "@/lib/storage";
import {
  buildVoiceEvidence,
  conversationTitle,
  loadConversationCached,
  type VoiceEvidence,
} from "@/lib/voice-evidence";
import { PlayIcon, PauseIcon } from "@/components/icons";

function formatSpeech(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s of speech`;
  return `~${Math.round(seconds / 60)} min of speech`;
}

// Single source of truth for the clip-playback failure copy, shared by the
// <audio> "error" event and both play() rejection handlers below — they all
// mean the same thing to the user, so they must all say the same thing.
const CLIP_LOAD_ERROR = "Couldn’t load the audio for this voice.";

/**
 * The reason this card is answerable at all. Everything here comes from the
 * conversation the suggestion already points at — what this voice said, who
 * else was recognized in the room, and a way into the full transcript.
 *
 * Failure is silent by design: a card without evidence is exactly the card
 * that shipped before, and the picker below it still works. An error banner
 * for a missing enhancement would only be noise stacked on top of a question
 * the user can still answer.
 */
function VoiceEvidenceBlock({ conversationId, speakerId }: { conversationId: string; speakerId: number }) {
  const [evidence, setEvidence] = useState<VoiceEvidence | null>(null);
  const [failed, setFailed] = useState(false);

  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loadingClip, setLoadingClip] = useState(false);
  const [clipError, setClipError] = useState<string | null>(null);

  // What a play() rejection needs undone: an AbortError or NotAllowedError
  // resolves the promise's rejection branch but fires no "error" event on the
  // element, so nothing else clears loadingClip/playing — the button was
  // stuck disabled on "Loading…" forever until this ran on the rejection too.
  const handlePlayFailure = () => {
    setLoadingClip(false);
    setPlaying(false);
    setClipError(CLIP_LOAD_ERROR);
  };

  // Nothing preloads: 44 cards must never mean 44 session decodes. The element
  // is created on the first tap and reused for every replay after it.
  const togglePlay = () => {
    if (audio) {
      if (playing) {
        audio.pause();
      } else {
        setClipError(null);
        audio.play().catch(handlePlayFailure);
      }
      return;
    }
    setLoadingClip(true);
    setClipError(null);
    const el = new Audio(
      `/api/capture/speaker-audio?conversationId=${encodeURIComponent(conversationId)}&speakerId=${speakerId}`
    );
    el.addEventListener("canplay", () => setLoadingClip(false));
    el.addEventListener("play", () => setPlaying(true));
    el.addEventListener("pause", () => setPlaying(false));
    el.addEventListener("ended", () => setPlaying(false));
    el.addEventListener("error", () => {
      // The body is JSON when the route failed; the element cannot read it, so
      // this stays generic rather than guessing which failure it was.
      handlePlayFailure();
      setAudio(null);
    });
    setAudio(el);
    el.play().catch(handlePlayFailure);
  };

  useEffect(() => () => audio?.pause(), [audio]);

  useEffect(() => {
    let live = true;
    loadConversationCached(conversationId)
      .then((c) => live && setEvidence(buildVoiceEvidence(c, speakerId)))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [conversationId, speakerId]);

  if (failed) return null;

  // Reserves the block's height so the picker does not jump under a thumb
  // already reaching for it.
  if (!evidence) return <div className="mb-3 h-24 rounded-lg bg-slate-800/40 animate-pulse" aria-hidden="true" />;

  return (
    <div className="mb-3 min-w-0">
      <Link
        href={`/conversation/${conversationId}`}
        className="text-sm text-cyan-400 hover:underline break-words"
      >
        {evidence.title}
      </Link>
      <p className="text-slate-400 text-xs mt-0.5">
        {evidence.lineCount} {evidence.lineCount === 1 ? "line" : "lines"}
        {evidence.speechSeconds > 0 && ` · ${formatSpeech(evidence.speechSeconds)}`}
      </p>

      {evidence.canPlay && (
        <div className="mt-2">
          <button
            onClick={togglePlay}
            disabled={loadingClip}
            aria-label={playing ? "Pause this voice" : "Play this voice"}
            className="inline-flex items-center gap-2 min-h-[44px] px-3 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-200 hover:border-cyan-500/50 transition-colors disabled:opacity-50"
          >
            {playing ? <PauseIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4" />}
            {loadingClip ? "Loading…" : playing ? "Pause" : "Play this voice"}
          </button>
          {clipError && (
            <p className="text-red-400 text-xs mt-1 break-words" role="alert">
              {clipError}
            </p>
          )}
        </div>
      )}

      {evidence.quotes.length > 0 && (
        <ul className="mt-2 space-y-1">
          {evidence.quotes.map((q, i) => (
            <li key={i} className="text-sm text-slate-300 border-l-2 border-slate-700 pl-3 break-words">
              “{q}”
            </li>
          ))}
        </ul>
      )}

      <p className="text-slate-400 text-xs mt-2 break-words">
        {evidence.othersPresent.length > 0
          ? `Also here: ${evidence.othersPresent.join(", ")}`
          : "No one else was recognized in this conversation."}
      </p>
    </div>
  );
}

/**
 * Everything a group resolves besides `members[0]` — whose conversation the
 * evidence block above already shows and links. The grouping threshold is an
 * uncalibrated guess, and this list is the only way to catch it guessing
 * wrong before answering once, incorrectly, for several conversations: a
 * reviewer who doesn't recognize one of these titles knows to Ignore instead
 * of naming the voice.
 *
 * Titles require a fetch, but every one of these conversations was already
 * being fetched — one per card — before grouping existed; `loadConversationCached`
 * just lets the cards that now share a group share the fetch too, so the
 * total distinct fetches across the queue do not increase. Each link renders
 * immediately with its own relative age and swaps to the real title if and
 * when it resolves — never a loading state, never a skeleton — and degrades
 * silently back to that age label on failure, same as `VoiceEvidenceBlock`.
 */
function OtherGroupMembers({ members }: { members: PendingSuggestion[] }) {
  const others = members.slice(1);
  // `others` is a fresh array every render (it's a slice of a prop that is
  // itself sometimes a fresh array) — the joined ids are what's actually
  // stable, so that's the effect's real dependency.
  const key = others.map((m) => m.conversationId).join("|");
  const [titles, setTitles] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    others.forEach((m) => {
      loadConversationCached(m.conversationId)
        .then((c) => {
          if (live) setTitles((cur) => ({ ...cur, [m.conversationId]: conversationTitle(c) }));
        })
        .catch(() => {
          // Silent by design — the age-label fallback already makes the link
          // usable; see VoiceEvidenceBlock's own failure handling above.
        });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (others.length === 0) return null;

  return (
    <p className="text-slate-400 text-xs mb-3 break-words">
      Also heard in{" "}
      {others.map((m, i) => (
        <span key={m.id}>
          <Link href={`/conversation/${m.conversationId}`} className="text-cyan-400 hover:underline">
            {titles[m.conversationId] ?? getAnalysisAge(m.date).label}
          </Link>
          {i < others.length - 1 ? ", " : "."}
        </span>
      ))}
    </p>
  );
}

export default function VoicePendingCard({
  suggestion: s,
  members,
  people,
  showError,
  errorMessage,
  newName,
  onNewNameChange,
  onAcceptExisting,
  onAcceptNew,
  onIgnore,
}: {
  suggestion: PendingSuggestion;
  members: PendingSuggestion[];
  people: Person[];
  showError: boolean;
  errorMessage?: string | null;
  newName: string;
  onNewNameChange: (v: string) => void;
  onAcceptExisting: (personId: string) => void;
  onAcceptNew: (name: string) => void;
  onIgnore: () => void;
}) {
  return (
    <div className="card p-4">
      <div className="mb-2">
        <div className="text-white font-medium">
          {members.length > 1 ? `This voice · ${members.length} conversations` : "Unrecognized voice"}
        </div>
        <div className="text-slate-400 text-xs">{getAnalysisAge(s.date).label}</div>
      </div>

      <VoiceEvidenceBlock conversationId={s.conversationId} speakerId={s.speakerId ?? 0} />

      {members.length > 1 && <OtherGroupMembers members={members} />}

      {members.length > 1 && (
        <p className="text-slate-400 text-xs mb-3 break-words">
          Naming this voice resolves all {members.length} cards.
        </p>
      )}

      {showError && (
        <p className="text-red-400 text-xs mb-2 break-words" role="alert">
          {errorMessage || "Couldn’t save — try again."}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-2 min-w-0">
        <select
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) onAcceptExisting(e.target.value);
          }}
          aria-label="Select person"
          className="flex-1 min-w-0 max-w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 min-h-[44px] text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
        >
          <option value="" disabled>
            Who is this?
          </option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {optionLabel(p.name)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-2 items-center min-w-0">
        <input
          value={newName}
          onChange={(e) => onNewNameChange(e.target.value)}
          placeholder="Or add a new person…"
          className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 min-h-[44px] text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
        />
        <button
          onClick={() => onAcceptNew(newName)}
          disabled={!newName.trim()}
          className={`${BUTTON_PRIMARY} px-3 disabled:opacity-50`}
        >
          Add
        </button>
        <button
          onClick={onIgnore}
          className="text-sm min-h-[44px] px-3 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          Ignore
        </button>
      </div>
    </div>
  );
}
