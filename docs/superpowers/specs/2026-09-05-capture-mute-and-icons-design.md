# TRACE Capture: persistent mute, status redesign, and a shared icon family

Date: 2026-09-05

## Why

The pendant streams continuously and the relay forwards every frame. There is
no way to say "don't record this" short of taking the pendant off. The status
screen is a bare settings-style list, and the TRACE web icon still carries the
pre-redesign cyan node-mark. Three changes, one PR.

## 1. Persistent mute

**State.** `CaptureSettings.muted: Bool` in UserDefaults. Default `false`.
Read by `CaptureCoordinator.start()` so the flag holds across relaunch and
BLE background restoration.

**Cut point.** `CaptureCoordinator` owns `muted`. While `true`, `onFrame`
returns before touching the writer. The BLE audio subscription is left alive:
unmute is instant and battery keeps reporting. The pendant itself still
transmits — this is a relay mute, and the UI says so.

**Transitions.**
- `setMuted(true)`: flush the writer's current chunk and enqueue it (audio
  from before the mute is legitimate), reset `framesThisChunk` to 0, then
  `requestSweep()` so TRACE closes the open conversation promptly instead of
  waiting out the quiet window.
- `setMuted(false)`: frames flow again. TRACE opens a new conversation from
  the next uploaded chunk; nothing else to do.

**Not in scope.** Unsubscribing from the BLE characteristic; a hardware mute;
a scheduled/timed mute.

## 2. StatusView redesign

Field-journal language, forced dark, one copper accent (`#b96d33`).

- **Hero card:** one large state line — `Listening`, `Muted`,
  `Disconnected`, `No pendant`, `Bluetooth off` — with a status dot, the
  connection detail beneath, and battery as a glyph + percent.
- **Mute is the primary control:** full-width button under the hero. Copper
  "Mute" while listening; a visibly different muted treatment ("Muted — tap to
  resume") so a pocket-glance can't misread it. 44pt minimum. Footnote states
  the relay-mute caveat.
- "End conversation now" becomes a secondary row with its existing footnote.
- Uploads section kept: pending count, last upload, last error in clay
  (`#e98d72`).
- Serif nav title; `.preferredColorScheme(.dark)`; `.tint(copper)`.

State derivation: `muted` wins over connection text; otherwise map the
`PendantConnection` state strings onto the five labels (Connected →
Listening; anything containing "Disconnected"/"retrying"/"Connecting" →
Disconnected; "No pendant paired" → No pendant; "Bluetooth is off" →
Bluetooth off).

## 3. Icon family — concept A, "voice → lines"

Both icons: flat copper (`#b96d33`, highlight `#d99a5e`) on brand-leather
(`#2a1c10`). No gradients.

- **TRACE (web):** a short waveform on the left resolving into three ruled
  journal lines on the right — speech becoming notes. Replaces
  `public/icon.svg`, `public/icon-192.png`, `public/icon-512.png`,
  `src/app/favicon.ico`. `manifest.json` and `layout.tsx` metadata already
  point at these paths; no change needed there.
- **TRACE Capture (iOS):** the same waveform alone, centred inside a copper
  ring — a pendant / record button; unmistakably the sibling. Shipped as
  `TraceCapture/Assets.xcassets/AppIcon.appiconset` with a single 1024×1024
  PNG (iOS 18 single-size catalog). `project.yml` `sources: [TraceCapture]`
  already includes the catalog; regenerate the project with `xcodegen`.

**Rendering.** Source SVGs are committed (`public/icon.svg`;
`ios/TraceCapture/Design/AppIcon.svg`). PNGs are rasterised locally
(`qlmanage`/`sips`; no ImageMagick on this machine) and committed alongside.

## Testing

- `CaptureCoordinator`'s frame-drop rule is exercised by injecting frames
  through `onFrame` with `muted` set and asserting the writer's pending count
  stays 0 — only if the coordinator can be constructed without CoreBluetooth
  side effects; otherwise it is verified by hand on device.
- Existing `ChunkWriter` / `ChunkContainer` tests must still pass.
- Web: `npm run lint`, `tsc --noEmit`, and the manifest/icons load in the
  browser pane.
