/**
 * Shared shapes for the capture pipeline. Kept dependency-free so the pure
 * modules (container, vad, sessions, assemble) can be unit-tested directly.
 */

/** First byte of the pendant's codec characteristic (sdks/device/PROTOCOL.md). */
export type CodecId = 0x14 | 0x15;

export interface ParsedChunk {
  codec: CodecId;
  frameMs: 10 | 20;
  /** Phone clock at the chunk's first packet, ms since epoch. */
  startedAtMs: number;
  /** Raw Opus frames, 3-byte BLE header already stripped by the phone. */
  frames: Uint8Array[];
  durationMs: number;
}

/** A voiced stretch, ms relative to the chunk it was found in. */
export interface Span {
  startMs: number;
  endMs: number;
}

/** A voiced stretch on the wall clock (ms since epoch), tied to its chunk. */
export interface AbsSpan {
  chunkId: string;
  startMs: number;
  endMs: number;
}

export interface SessionState {
  id: string;
  deviceId: string;
  startedAtMs: number;
  lastSpeechAtMs: number;
  voicedMs: number;
  spans: AbsSpan[];
}

/** The segment shape the UI already reads (see omi-api.ts TranscriptSegment). */
export interface TranscriptSegment {
  text: string;
  speaker_id: number;
  /** Seconds relative to the conversation start. */
  start: number;
  end: number;
}
