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
- Physical firmware installation and tone/capture test are pending bootloader
  access. No claim of physical tone loudness or continuity is made yet.
- Source changes retain the low-battery threshold/hysteresis, real-summary
  completion gating, queue expiry and existing recording path.

Private recordings and prior endurance evidence are retained. No card is
formatted and no new provider service is required.
