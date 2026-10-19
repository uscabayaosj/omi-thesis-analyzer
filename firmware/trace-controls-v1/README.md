# TRACE button controls and spoken prompts — trace-controls-v5

This historical folder name contains the current button-only controls integration.
Start with the [firmware build guide](../README.md).

- One centre-button press requests a bookmark.
- Two quick centre-button presses request Pause/Resume through the paired TRACE app.
- Three-second power-off behavior is preserved.
- Vibration feedback is coordinated with app permissions/settings and acknowledgements.
- Motion/casing double taps are disabled; there is no IMU initialization or sampling.

`prepare.py` first prepares `../trace-sd-v1`, then copies its generated upstream
source and runs `integrate.py`. The generated controls copy references the sibling
SD headers and corrected SD synchronization source, so retain the firmware folder
layout when building.

`src/trace_controls.c` implements the custom BLE control service and feedback
worker; `src/button_loop.txt` replaces the legacy polling button state machine.
`trace-controls.conf` declares the `trace-controls-v5` revision.
`src/trace_status_leds.c` provides the recording/paused/disconnected colours and a
500 ms green USB-power pulse every three seconds. It reads hardware VBUS presence,
not battery charge current or completion. See the shared guide for the colour table.

Build logs, provenance files and per-device installation evidence are local-only.

## Speaker correction and diagnostic

`src/trace_speaker.c` replaces the inherited speaker implementation. It uses the
Devicetree I2S device, checks initialization without dereferencing a missing
device, and keeps optional speaker failure from stopping capture startup.
Bluetooth ingress validates lengths and copies bounded audio; a separate worker
owns playback. I2S owns each successfully queued slab until transmission finishes.
The worker bounds waits and stops the amplifier after playback or failure.

Normal `trace-controls-v5` enables the corrected speaker endpoint and fixed event
prompts, with **no automatic startup diagnostic**. TRACE app build 36 configures
the prompts after connecting. The legacy
endpoint accepts a four-byte little-endian byte count (even, 2–4000), then exactly
that many bytes of 8 kHz signed 16-bit little-endian mono audio. Four-byte data
packets remain data during an active transfer. Transfers time out after five
seconds without an accepted packet. Busy/invalid writes are rejected through ATT;
there is no playback-completion notification protocol. Each clip is at most
250 ms; this is not a general continuous voice-streaming protocol.

All PCM is clamped to +/-29490 (about 90% of full-scale amplitude). This limits
the digital signal, not acoustic loudness or amplifier gain. The attended
listening results below record how this level was selected.

For the explicitly attended speaker check, append `speaker-diagnostic.conf` to
`EXTRA_CONF_FILE` after `trace-controls.conf`, separated by a semicolon. The
result advertises `trace-speaker-d5`. About 15 seconds after transport startup it
plays a 240 ms quiet 400 Hz tone, waits 800 ms, then plays the locally synthesized
phrase “TRACE speaker test.” once per boot. Diagnostic audio is stored in flash
and excluded from the normal build. A listener must confirm audible output;
I2S success logs alone cannot prove that a physical speaker works. Diagnostic
builds repeat this sequence on every reboot and should be replaced with the
normal image after the check.

Host packet regression checks (ASan and UBSan, requires Clang):

```sh
python3 firmware/trace-controls-v1/tests/check_speaker_protocol.py
```

The checks exercise the exact production ingress function with mocked RTOS
primitives, including exact 400-byte completion, four-byte data, unaligned
headers, maximum/oversized inputs, timeout, busy and unavailable paths. They do
not validate I2S hardware, RTOS scheduling, Bluetooth delivery or sound quality.

### Hardware check status

The first attended diagnostic (`trace-speaker-d1`) booted, initialized I2S at
8 kHz and completed both DMA playbacks with zero driver return codes. The human
listener reported **no sound**. Those logs do not establish working audio output.

The inherited left-justified format does not match the MAX98357A specified for
the reference Adafruit Audio BFF. The second diagnostic (`trace-speaker-d2`)
uses standard I2S at the same low amplitude. The attended second diagnostic booted and completed both playbacks; the human
listener confirmed hearing both the tone and an understandable phrase on one
DevKit. This verifies acoustic output on that unit at the tested level.
Simultaneous recording/playback and continuous Bluetooth voice streaming were
not qualified in this check. Production DevKit board revisions may
differ from the published reference assembly; neither a working I2S peripheral
nor generic product documentation proves a speaker is installed or connected.

Hardware references:
- [Adafruit Audio BFF pins](https://learn.adafruit.com/adafruit-audio-bff/pinouts)
- [MAX98357A vs MAX98357B audio formats](https://www.analog.com/en/products/max98357a.html)

The human listener found the successful d2 phrase too quiet. Diagnostic d3 keeps
standard I2S and raises the phrase peak from 650 to 2600 and tone peak from 500
to 2000, without changing timing, the waveform, amplifier hardware gain, or host
volume controls. The listener found this level still too quiet.

The d3 playbacks completed successfully, but the listener still found the volume
too low. Diagnostic d4 raises the phrase peak to 8192 (25% of signed full scale)
and the tone to 6300, about +10 dB from d3, pending a listening-level check.

At d4 the listener could not hear the tone and described the phrase as barely
audible, then explicitly requested 90%. Diagnostic d5 raises the same waveform
to a phrase peak of 29490 (90% of signed full scale), with the tone scaled by the
same factor to 22679. The short timing, I2S format and hardware gain are unchanged.
The attended d5 diagnostic completed both playbacks with zero driver errors.
The listener confirmed "Clear and loud enough." The normal image retains this
selected signal limit and disables the automatic tone/phrase sequence.


## Spoken event prompts (v5 / TRACE build 36)

| Phrase | Trigger |
| --- | --- |
| Connected | TRACE subscribes and enables prompts for this Bluetooth connection. |
| Disconnected | A previously configured connection ends. |
| Recording started | The phone applies a transition to active capture. |
| Paused | The phone applies a transition from active capture to paused. Initial/repeated Pause writes stay quiet. |
| Low battery | A valid sampled DevKit estimate reaches 20% or below; one warning until it recovers to at least 25%. |
| Conversation summary completed | The app observes an actual completed summary for its active workspace. Opening an old conversation alone does not trigger it. |

Turn **Spoken prompts** on or off in TRACE Settings → DevKit controls. It defaults
on in the app. Firmware waits for app configuration on each connection; a fresh
boot without an app connection has not yet enabled offline warnings. A summary
may wait for reconnection for up to five minutes, then expires. App persistence
scopes pending/delivered summaries by installation and backend, and deduplicates
repeated completion polls. A Bluetooth write acknowledgement means accepted,
not proof of acoustic output. Playback events report start, finish and failure.

All six fixed 8 kHz PCM clips live in flash. A low-priority speaker worker plays
them through I2S at the listener-selected 90% digital peak limit. A bounded,
nonblocking queue keeps playback out of microphone and Bluetooth callbacks.
Repeated pending phrases coalesce; outdated link/capture events are skipped.
No microphone muting, capture pause, SD rewrite or network TTS request is used
for a prompt. Speech can therefore be picked up by the microphone and appear in
recordings/transcripts. This implementation does not provide echo cancellation.
The phone saves playback windows in local `Diagnostics/spoken-prompts.jsonl`;
these are provenance markers, not removed audio or automatic transcript edits.

### Fixed-phrase Bluetooth protocol

The service is appended after existing services so their handles stay stable:

- Service: `A71C0020-6B8D-4E75-A1B2-7D0E6F545243`
- Write-with-response command: `A71C0021-6B8D-4E75-A1B2-7D0E6F545243`
- Read/notify events: `A71C0022-6B8D-4E75-A1B2-7D0E6F545243`

Commands are exactly two bytes: `[1, 0|1]` configures prompts; `[2, 6]` queues
the real summary-completed event; `[3, 1...6]` requests an explicitly marked
preview without changing connection, recording or battery state. IDs follow
the table above. The 20-byte status is version (1), phase (0 initial, 1 start,
2 finish, 3 failure), ID (0 initial), flags (bit 0 enabled, bit 1 preview),
sequence u32 LE, device uptime milliseconds u64 LE, result i32 LE. Device uptime
must not be treated as UTC. The app also records actual receipt UTC. Firmware
can speak while disconnected, when the phone cannot receive event notifications;
USB logs were used to verify that path in the attended check.

Additional host policy regression check:

```sh
clang -std=c11 -fsanitize=address,undefined \
  firmware/trace-controls-v1/tests/check_prompt_policy.c -o /tmp/trace-prompt-policy
/tmp/trace-prompt-policy
```

This exercises transition suppression, mute, reconnect epochs, stale events and
low-battery hysteresis. Physical simultaneous-recording results are recorded in
[the build 36 validation note](../../docs/TRACE36_SPOKEN_PROMPTS.md).
