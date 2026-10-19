# TRACE build 37 / controls-v6: wordless tone alerts

The user requested tones instead of the spoken prompts, then selected 100%
volume for those tones. All six normal event clips now use generated sine tones
with a maximum signed digital sample of 32767. The speaker driver permits this
full peak. This setting is not calibrated acoustic volume or hardware gain.

Patterns and generator are documented in the [firmware guide](https://github.com/uscabayaosj/omi-thesis-analyzer/tree/main/firmware/trace-controls-v1#tone-alerts-v6--trace-build-37).
The app labels the switch Tone alerts and shows all six patterns. Existing
preferences, event IDs and summary queues are preserved. Older v5 boards still
speak until their firmware is updated; the app explains that compatibility.

The microphone is not stopped or muted for a tone. Clips are 170–355 ms rather
than spoken sentences. This reduces the duration of possible overlap but does
not establish acoustic isolation or perfect transcription. The earlier v5
recording test cannot be counted as a physical test of these new waveforms.

## Validation status

- Exact generated PCM check passed: six distinct deterministic clips, 100%
  peak, smooth endpoints, maximum 355 ms and matching hashes.
- Firmware policy ASan/UBSan and legacy packet parser checks passed.
- Native build 37 compiled for the connected physical iPhone.
- v6 installed after the operator confirmed XIAO-SENSE. Previous firmware
  backed up; fresh boot reports v6, speaker initialization success, alert
  service success and amplitude limit 32767. Native build 37 installed.
- Physical phone test passed. All six preview IDs played successfully during
  active recording; real connected/disconnected, recording-start, Pause and
  actual server-summary-completion paths also played with driver result zero.
- The human listener confirmed: “Yes — tones are clear and loud enough,” in
  response to whether the beeps were audible with no spoken words.
- The 87.0-second recording retained 8,700 frames in three valid TRCH chunks,
  each no longer than 30 seconds. Firmware encoded/queued/BLE-sent, phone
  received/written and strict original-file frame totals agree exactly.
- Every original was copied twice independently from the iPhone, with matching
  SHA-256 hashes. No empty/truncated frames or sequence discontinuities.
- No observed PDM errors, dropped PCM samples, encoder failures, dropped
  transport frames, BLE notification failures, missing/duplicate notifications
  or write failures. Final pending writes and upload/server queues were zero.
- Largest observed receive gap: 0.0956 s; write delay: 0.1379 s; sampled pending
  writes: one. Final state is paused. No calibrated acoustic SPL, endurance,
  locked-phone or universal transcription-isolation claim is made.
- Source changes retain the low-battery threshold/hysteresis, real-summary
  completion gating, queue expiry and existing recording path.

Private recordings and prior endurance evidence are retained. No card is
formatted and no new provider service is required.

Candidate UF2 SHA-256: `c49cfacb6ba17359ee4c616aa38cb0bd4f9c3a9c3bdf7e4e6f603baa42628f8c`.
