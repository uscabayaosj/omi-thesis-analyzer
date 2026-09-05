# Capture Mute, Status Redesign & Icon Family — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give TRACE Capture a persistent relay mute with a redesigned status screen, and ship one copper-on-leather icon family for both the web PWA and the iOS app.

**Architecture:** Mute is a persisted flag owned by `CaptureCoordinator`; frames are dropped at `onFrame` while the BLE subscription stays live. The status screen is rebuilt around a hero state card and a primary mute button. Icons are hand-written SVGs rasterised with `qlmanage`/`sips` and committed alongside.

**Tech Stack:** Swift 5 / SwiftUI / Observation (iOS 18), xcodegen, Next.js PWA metadata, macOS `qlmanage` + `sips`, Python 3 stdlib for the `.ico` wrapper.

## Global Constraints

- Brand colours: leather `#2a1c10`, copper `#b96d33`, copper-light `#d99a5e`, clay `#e98d72`. Flat — no gradients.
- Every interactive target ≥ 44pt.
- `ios/TraceCapture/*.xcodeproj` is gitignored; regenerate with `xcodegen generate` from `ios/TraceCapture`.
- Mute is a *relay* mute; copy must say the pendant keeps transmitting.

---

### Task 1: Persisted mute flag + coordinator frame drop

**Files:**
- Modify: `ios/TraceCapture/TraceCapture/CaptureSettings.swift`
- Modify: `ios/TraceCapture/TraceCapture/CaptureCoordinator.swift`

**Interfaces:**
- Produces: `CaptureSettings.muted: Bool`; `CaptureCoordinator.muted: Bool` (observable, read-only outside) and `func setMuted(_ on: Bool)`.

- [ ] **Step 1: Add the setting**

```swift
    /// Relay mute: frames are dropped before the chunk writer. Persisted so a
    /// mute survives relaunch and BLE background restoration.
    static var muted: Bool {
        get { defaults.bool(forKey: "muted") }
        set { defaults.set(newValue, forKey: "muted") }
    }
```

- [ ] **Step 2: Own it in the coordinator**

Add `var muted = CaptureSettings.muted` next to the other observable vars. In `onFrame`, before the writer: `guard !self.muted else { return }`. Add:

```swift
    /// Relay mute. The BLE subscription stays live (instant unmute, battery
    /// keeps reporting); frames are simply dropped at the door. Muting flushes
    /// what was already captured — audio from before the mute is legitimate —
    /// and asks TRACE to close the open conversation now.
    func setMuted(_ on: Bool) {
        guard on != muted else { return }
        muted = on
        CaptureSettings.muted = on
        guard on else { return }
        if let file = writer.flush() { UploadQueue.shared.enqueue(file: file) }
        framesThisChunk = 0
        requestSweep()
    }
```

- [ ] **Step 3: Build** — `cd ios/TraceCapture && xcodegen generate -q && xcodebuild -scheme TraceCapture -destination 'generic/platform=iOS Simulator' build -quiet` → no errors.
- [ ] **Step 4: Commit** — `feat(capture): persistent relay mute`

### Task 2: StatusView redesign

**Files:**
- Modify: `ios/TraceCapture/TraceCapture/StatusView.swift` (rewrite)
- Create: `ios/TraceCapture/TraceCapture/Theme.swift`

**Interfaces:**
- Consumes: `CaptureCoordinator.muted`, `setMuted(_:)`, `connection`, `battery`, `pending`, `lastUpload`, `lastError`, `framesThisChunk`, `endNote`, `endConversation()`.

- [ ] **Step 1: Theme.swift** — `enum Theme { static let leather, copper, copperLight, clay, panel: Color }` from the constraint hexes (`Color(red:green:blue:)`), plus `panel = #221c17`.
- [ ] **Step 2: Derive the hero state** — a private enum `Hero { listening, muted, disconnected, noPendant, bluetoothOff }` computed from `muted` first, then the connection string per the spec mapping (`"Connected"` → listening; contains "No pendant" → noPendant; contains "Bluetooth" → bluetoothOff; else disconnected). Each case has a title, a dot colour (listening: sage `#a9bd8f`; muted: copperLight; others: clay) and a detail line.
- [ ] **Step 3: Layout** — `ScrollView` on `Theme.leather`: hero card (dot + serif title, detail, battery `battery.75percent` SF symbol + %), full-width mute button (`Theme.copper` filled "Mute" when listening; `Theme.panel` with copper border "Muted — tap to resume" when muted; disabled when no pendant), footnote "The pendant keeps transmitting; muted audio is dropped here and never uploaded.", then Conversation and Uploads cards, then the Settings-required card. Toolbar gear kept. `.preferredColorScheme(.dark)`, `.tint(Theme.copper)`, `.navigationTitle("TRACE Capture")`, `.toolbarTitleDisplayMode(.inlineLarge)`.
- [ ] **Step 4: Build** as in Task 1. Launch in the simulator and screenshot both mute states.
- [ ] **Step 5: Commit** — `feat(capture): field-journal status screen with mute front and centre`

### Task 3: TRACE web icon (concept A)

**Files:**
- Modify: `public/icon.svg`, `public/icon-192.png`, `public/icon-512.png`, `src/app/favicon.ico`
- Create: `scripts/make-ico.py`

- [ ] **Step 1: icon.svg**

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#2a1c10"/>
  <g stroke="#b96d33" stroke-width="3.2" stroke-linecap="round" fill="none">
    <path d="M11 27v10M16.5 20v24M22 15v34M27.5 22v20"/>
  </g>
  <g stroke="#d99a5e" stroke-width="3.2" stroke-linecap="round" fill="none">
    <path d="M35 24h19M35 32h19M35 40h12"/>
  </g>
</svg>
```

- [ ] **Step 2: Rasterise** — `qlmanage -t -s 512 -o /tmp/x public/icon.svg && sips -s format png /tmp/x/icon.svg.png --out public/icon-512.png && sips -z 192 192 public/icon-512.png --out public/icon-192.png`.
- [ ] **Step 3: favicon** — `scripts/make-ico.py` wraps 32 and 48 px PNGs (from `sips -z`) into an ICO (ICONDIR + PNG entries; stdlib `struct`). Run it to write `src/app/favicon.ico`.
- [ ] **Step 4: Verify** — `npm run lint`; open `/` in the browser pane and confirm the tab icon and `/manifest.json` icons load.
- [ ] **Step 5: Commit** — `feat(brand): voice-to-lines icon for TRACE`

### Task 4: TRACE Capture app icon

**Files:**
- Create: `ios/TraceCapture/Design/AppIcon.svg`, `ios/TraceCapture/TraceCapture/Assets.xcassets/Contents.json`, `.../AppIcon.appiconset/Contents.json`, `.../AppIcon.appiconset/AppIcon-1024.png`

- [ ] **Step 1: AppIcon.svg** — same bars as Task 1's waveform scaled to a 1024 canvas, centred inside a copper ring (`r=380`, `stroke-width=64`, `#b96d33`), bars in `#d99a5e`, leather background.
- [ ] **Step 2: Rasterise** — `qlmanage -t -s 1024` → `AppIcon-1024.png`; strip alpha: `sips -s format png` is not enough — use `sips --setProperty format png` after flattening; if alpha remains, App Store rejects but simulator builds fine. Flatten via a second SVG render is unnecessary because the background rect is opaque.
- [ ] **Step 3: Catalog** — `Assets.xcassets/Contents.json` `{"info":{"author":"xcode","version":1}}`; `AppIcon.appiconset/Contents.json` with one image `{"filename":"AppIcon-1024.png","idiom":"universal","platform":"ios","size":"1024x1024"}`.
- [ ] **Step 4: Build & verify** — `xcodegen generate -q && xcodebuild … build -quiet`; install on simulator and screenshot the home screen icon.
- [ ] **Step 5: Commit** — `feat(capture): app icon`

### Task 5: Verify, push

- [ ] `npm test`, `npm run lint`, `npx tsc --noEmit`; `xcodebuild test -scheme TraceCapture` for `ChunkWriter`/`ChunkContainer`.
- [ ] `git push origin main`.
