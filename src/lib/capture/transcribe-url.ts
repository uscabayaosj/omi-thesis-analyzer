/**
 * Builds the Deepgram prerecorded request URL. Pure and dependency-free so
 * node:test can load it directly and so every quality knob lives in one place.
 *
 * Why these defaults (field recordings from a pendant mic, one closed
 * conversation per call, English):
 *  - nova-3 + language=en: pinning the language skips detection and is more
 *    accurate than letting the model guess on noisy audio.
 *  - diarize_model=latest + utterances: speaker-attributed turns with tight
 *    timestamps, which transcribe-map.ts maps back to wall-clock time.
 *    `diarize=true` alone always routes to Deepgram's legacy v1 diarizer,
 *    which was flipping speakers mid-sentence on pendant-mic audio; `latest`
 *    resolves to v2 (~80% fewer speaker-confusion errors per Deepgram's own
 *    benchmarks) and is rejected if sent alongside diarize=true.
 *  - smart_format + punctuate + numerals + measurements: readable prose,
 *    "fourteen hundred acres" → "1,400 acres".
 *  - keyterm: nova-3's keyterm prompting biases recognition toward the
 *    vocabulary of the dissertation (ranch, place, and Jesuit terms) that a
 *    general model otherwise mishears. Extend with DEEPGRAM_KEYTERMS.
 *  - utt_split: assemble.ts pads voiced pieces with 400 ms of synthetic
 *    silence; a 1.0 s split keeps one thought from fragmenting across that
 *    seam while still breaking on real pauses.
 *  - mip_opt_out defaults to false: recordings go into Deepgram's
 *    model-improvement program in exchange for the standard (non-surcharged)
 *    per-minute rate. Set DEEPGRAM_MIP_OPT_OUT=true to pay the surcharge and
 *    keep participant audio out of it instead.
 *  - filler_words off by default: cleaner text for the analysis lenses.
 *    Set DEEPGRAM_FILLER_WORDS=true for a verbatim qualitative transcript.
 */

export const DEFAULT_KEYTERMS: readonly string[] = [
  "Pioneer Sovereignty",
  "sovereignty",
  "ranch sociality",
  "Montana",
  "rancher",
  "homestead",
  "grazing allotment",
  "BLM",
  "Forest Service",
  "water rights",
  "brand inspection",
  "calving",
  "Jesuit",
  "Society of Jesus",
  "ethnography",
  "fieldwork",
  "dissertation",
];

export interface TranscribeUrlOptions {
  language?: string;
  keyterms?: readonly string[];
  fillerWords?: boolean;
  uttSplitSeconds?: number;
  mipOptOut?: boolean;
  tag?: string;
}

const DEEPGRAM_LISTEN = "https://api.deepgram.com/v1/listen";

export function buildTranscribeUrl(opts: TranscribeUrlOptions = {}): string {
  const p = new URLSearchParams();
  p.set("model", "nova-3");
  p.set("language", opts.language ?? "en");
  p.set("diarize_model", "latest");
  p.set("utterances", "true");
  p.set("utt_split", String(opts.uttSplitSeconds ?? 1.0));
  p.set("smart_format", "true");
  p.set("punctuate", "true");
  p.set("numerals", "true");
  p.set("measurements", "true");
  p.set("filler_words", String(opts.fillerWords ?? false));
  p.set("mip_opt_out", String(opts.mipOptOut ?? false));
  p.set("tag", opts.tag ?? "trace-capture");
  for (const k of dedupe(opts.keyterms ?? DEFAULT_KEYTERMS)) p.append("keyterm", k);
  return `${DEEPGRAM_LISTEN}?${p.toString()}`;
}

/** Comma-separated env list → trimmed, non-empty, unique terms (undefined when unset). */
export function parseKeytermsEnv(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  return dedupe(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

/** Env → options. Each knob is optional; unset means the tuned default above. */
export function optionsFromEnv(env: Record<string, string | undefined>): TranscribeUrlOptions {
  const extra = parseKeytermsEnv(env.DEEPGRAM_KEYTERMS);
  const split = Number(env.DEEPGRAM_UTT_SPLIT);
  return {
    language: env.DEEPGRAM_LANGUAGE || undefined,
    keyterms: extra ? dedupe([...DEFAULT_KEYTERMS, ...extra]) : undefined,
    fillerWords: env.DEEPGRAM_FILLER_WORDS === undefined ? undefined : env.DEEPGRAM_FILLER_WORDS === "true",
    uttSplitSeconds: Number.isFinite(split) && split > 0 ? split : undefined,
    mipOptOut: env.DEEPGRAM_MIP_OPT_OUT === undefined ? undefined : env.DEEPGRAM_MIP_OPT_OUT !== "false",
  };
}

function dedupe(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of terms) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
