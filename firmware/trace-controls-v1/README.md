# TRACE button controls — trace-controls-v4

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
`trace-controls.conf` declares the `trace-controls-v4` revision.
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

Normal `trace-controls-v4` enables the corrected speaker endpoint but has **no
startup sound**. The native TRACE app does not yet send voice prompts. The legacy
endpoint accepts a four-byte little-endian byte count (even, 2–4000), then exactly
that many bytes of 8 kHz signed 16-bit little-endian mono audio. Four-byte data
packets remain data during an active transfer. Transfers time out after five
seconds without an accepted packet. Busy/invalid writes are rejected through ATT;
there is no playback-completion notification protocol. Each clip is at most
250 ms; this is not a general continuous voice-streaming protocol.

All PCM is clamped to +/-650 (about 2% of full-scale amplitude). This limits the
digital signal, not acoustic loudness or speaker gain. This conservative limit
should remain until the actual speaker is checked.

For the explicitly attended speaker check, append `speaker-diagnostic.conf` to
`EXTRA_CONF_FILE` after `trace-controls.conf`, separated by a semicolon. The
result advertises `trace-speaker-d2`. About 15 seconds after transport startup it
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
uses standard I2S at the same low amplitude. This format correction still needs
a listening check on the actual device. Production DevKit board revisions may
differ from the published reference assembly; neither a working I2S peripheral
nor generic product documentation proves a speaker is installed or connected.

Hardware references:
- [Adafruit Audio BFF pins](https://learn.adafruit.com/adafruit-audio-bff/pinouts)
- [MAX98357A vs MAX98357B audio formats](https://www.analog.com/en/products/max98357a.html)
