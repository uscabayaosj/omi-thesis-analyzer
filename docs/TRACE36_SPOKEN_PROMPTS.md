# TRACE build 36 / controls-v5: spoken prompts

## Delivered behavior

Connected, Disconnected, Recording started, Paused, Low battery, and Conversation
summary completed are fixed local DevKit phrases. Settings → DevKit controls →
Spoken prompts enables/disables all of them. The selected digital peak remains
90% from the user's attended speaker test. There is no automatic startup test.
The second DevKit and companion iPhone have not received this revision.

The firmware queue/worker, stale-event policy, wire protocol and low-battery
hysteresis are documented in [the firmware guide](../firmware/trace-controls-v1/README.md#spoken-event-prompts-v5--trace-build-36).
The app persists/deduplicates summary announcements, waits for write response,
and scopes them to the enrolled backend and installation. Old completion events
expire after five minutes. Merely browsing saved conversations stays quiet.

## Recording and privacy

The microphone, BLE capture and SD recording are never deliberately stopped or
muted for speech. Clips are embedded in firmware; no new TTS provider or audio
upload is used to play them. Originals can contain these prompts. There is no
echo cancellation, transcript filtering, or promise that simultaneous human
speech will remain intelligible over a speaker at this level. Phone diagnostics
record speaker-event receipt UTC, device uptime, preview/event distinction and
capture counters. These windows are provenance, not deleted samples. During a
disconnection, the phone cannot receive playback notifications; USB serial
provided independent start/end evidence in this test.

## Validation on 19 October 2026

Firmware built with NCS 2.7.0 for the existing reference DevKit 2 target:

- Revision: `trace-controls-v5`.
- UF2 SHA-256: `adc5329b514657b40342c4faf5255019396ccbadfdce99a7ceeb1b643ec0bbdb`.
- FLASH: 448,532 bytes; RAM: 237,832 bytes.
- Backed up the connected board before copying the candidate.
- Fresh boot identity, service registration and speaker initialization succeeded.
- App build 36 installed on the owner's iPhone, preserving enrollment/data.

Host policy tests with ASan/UBSan passed; legacy speaker packet regression tests
passed. The simulator app unit suite passed 34 tests, and the dedicated core
spoken-prompt tests passed four tests. The complete core suite was also rerun
successfully. Those are software checks, not acoustic
or physical transport evidence.

Two physical recording passes were retained, with Mac-spoken continuity markers:

| Check | First recording | Repeat recording |
| --- | ---: | ---: |
| Encoded audio | 91.9 seconds | 90.5 seconds |
| Received = written = parsed frames | 9,190 | 9,050 |
| Original chunks, each at most 30 seconds | 4 | 4 |
| Missing/duplicate/discontinuous notifications | 0 / 0 / 0 | 0 / 0 / 0 |
| Write failures / final pending writes | 0 / 0 | 0 / 0 |
| Largest sampled pending writes | 2 | 1 |
| Largest observed receive gap | 0.1173 s | 0.1278 s |
| Largest observed write delay | 0.1264 s | 0.1398 s |

All eight original chunks were independently copied twice from the phone.
SHA-256 agreed between copies; strict parsing found no truncated/empty frames.
Full chunks contain exactly 3,000 ten-millisecond frames. Chunk start times
increase; the encoded-end/start differences were -14 to +29 ms, consistent
with receipt timestamp jitter rather than missing sequence numbers. Firmware
settled at 18,240 encoded = queued = BLE-sent frames, matching the combined phone
and original totals. Sampled PDM errors, PCM dropped samples, encoder failures,
transport dropped frames and BLE notification failures remained zero throughout
both active intervals and after Pause. Counters did not reset between passes.

All six fixed phrases had successful start/end logs during active recording in
the first pass, explicitly marked as previews. Real disconnect/reconnect,
recording-start, Pause, and actual server-summary-completion paths also played
successfully. The battery stayed at its high estimate: the low-battery phrase
was a preview; its real threshold/hysteresis was checked by host policy tests,
not by draining the physical battery. Original recording counts increased across
every observed preview window. No prompt deliberately changed recording state.

The first XCTest attempt was blocked before actions by Apple's automation
permission. After the human approved it, the first functional pass reached the
saved-summary state but failed a final offscreen-button assertion. That harness
assertion was corrected for the lazy scroll view; the repeat physical test
passed with zero failures. One repeat preview tap reached an adjacent preview;
all six IDs had already been independently verified in the first pass. Both
actual summary completions were accepted exactly once, with successful firmware
playback logs. Final phone preferences show capture paused, empty upload and
server-session queues, and no pending summary prompts. No audio was deleted.
Mac output volume/mute settings were restored after each pass.

This is a short, connected, awake-phone recording check. It does not qualify
locked-phone background completion, endurance, every board revision, acoustic
echo removal, speech-recognition accuracy, battery runtime, or SD recovery.
Private audio, transcript content, device identifiers and raw logs remain local.

## Source and rebuild

The firmware README contains the pinned upstream preparation/build sequence.
For native sources use `xcodegen generate` in `ios/TRACEApp`, then build the
TRACE scheme. `TRACECore` is a local Swift package. Production signing must use
an authorized Apple team; this repository contains no enrollment or provider
secrets. The native app uses the existing compatible native backend.
