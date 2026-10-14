# TRACE for two people, with operator-paid API billing

## Architecture

Each person uses a dedicated Vercel backend, Neon project/database, private Blob store, and enrollment credential. This keeps all database namespaces isolated: conversations/transcripts/summaries, Places, people, reference voices, analyses, commitments, codebooks, backups, deletion markers, capture sessions, and usage records.

The operator's original workspace and deployment are retained. The second workspace is `anthroinsight/trace-companion`, using a London-region Neon database and a distinct private London-region Blob store. Existing personal records and audio are not copied into the second workspace. OMI cloud credentials are not copied.

OpenAI and Deepgram processing use the operator-provided API keys on both deployments. API billing therefore remains with the operator; infrastructure billing also belongs to the operator's Vercel team. Each workspace tracks its own usage, not a combined invoice. The configured summary model matches the original workspace's recent usage: `gpt-5-nano-2025-08-07` via OpenAI.

This is separation between the two app users, not end-to-end encryption against the operator: the operator administers both backend resources and provider accounts.

## Deployment guards

- `TRACE_NATIVE_API_ONLY=1`: `src/proxy.ts` rejects all non-native app paths, including the shared PWA's browser APIs. Native handlers retain their own device or cron authorization.
- `TRACE_SINGLE_PERSON_WORKSPACE=1`: native schema initialization creates `trace_native_one_active_installation`, a partial unique index permitting one unrevoked installation. The database enforces capacity during concurrent enrollment. An attempted second active installation returns HTTP 409; same-installation credential rotation remains possible. Revoke before enrolling a replacement phone.
- Fresh enrollment and cron secrets per workspace. Installation tokens are hashed in the database and retained in the iPhone Keychain.
- Dedicated Blob credentials; private capture objects do not share the original workspace's bucket.
- Secrets are production-only and not bundled into the iPhone app or checked into Git.

## Repeatable packaging

`node scripts/prepare-native-backend.mjs /absolute/separate/deployment/directory`

The script copies server source/configuration without copying credentials, native recordings, or an existing `.vercel` link. It preserves a destination's explicit project linkage and writes a capture-only cron schedule. Configure both guards before deploying. Do not deploy the companion configuration through the original project link.

## Installing the friend's phone

The existing app supports a separate server URL and enrollment credential in Settings. The same app bundle can be installed on a different person's phone without switching the operator's own phone.

1. Connect the friend's unlocked iPhone to the Mac. Register/sign for that device through the existing Apple developer team; resolve device-local trust/developer-mode prompts as needed.
2. Install the current signed TRACE app for that device. Do not uninstall an existing TRACE installation or discard queued recordings.
3. Enroll only against `https://trace-companion.vercel.app`. The operator's private setup file is `/Users/ulyssescabayao/.config/trace/companion-enrollment.json` (mode 0600). Never put the original workspace's enrollment secret on the friend's phone.
4. Check enrollment, loaded workspace, queue state, and app version after installation. Physical friend-phone enrollment and recording are separate acceptance steps; provisioning/build evidence does not prove them.

Provider keys are supplied privately in `/Users/ulyssescabayao/.config/trace/companion-provider.env`, outside this Git repository. Do not copy these setup files into exports or backups intended for the friend. The operator should enter the bootstrap credential and retain it; the app saves only its installation token.

## Scope and evidence

Two-person personal distribution only. No public release, TestFlight invitation, payment collection, or firmware change. No automated test suite or paid provider recording was run for this implementation request.

Provisioning/build/release evidence is retained under `/tmp/trace-companion-setup`; final deployment metadata is recorded separately. Installed/enrolled friend-phone evidence remains pending until that phone is connected.

Production deployment: `dpl_2kw2nXByfNVZbd8jPTD2o1ijUNAM`, Ready at `https://trace-companion.vercel.app`. Scoped TypeScript checking and production build succeeded; the database was independently confirmed distinct and initialized with zero installations.


## Friend-phone installation — 14 October 2026

TRACE 1.0 (35) was signed for and installed on Anna Tsing (iPhone 16 Pro). Apple Developer Mode was enabled by the operator after the device initially rejected the developer disk image. Before installation, successful app inventory confirmed no existing TRACE bundle; the existing Omi app was retained.

The operator enrolled a fresh installation against the companion backend using its private bootstrap credential on the Mac. Build 35 imports a short-lived `Library/Application Support/TRACE/installation-setup.json` only when no installation is already enrolled. It deletes the temporary file before network work, validates its expiry and UUID/token format, verifies the server-returned installation ID, and stores the installation token in this iPhone's Keychain. It never transfers provider API keys or the administrator enrollment secret and never replaces an enrolled workspace.

Evidence: distribution profile includes the exact friend's device, `get-task-allow=false`, strict signature verification passed, app inventory shows build 35, launch succeeded, and the phone's Settings visually shows `https://trace-companion.vercel.app`, `Connected to TRACE`, and `Anna Tsing’s iPhone`. Capture is paused; upload queue defaults to empty and server-session list is empty. Independent app-container inspection confirmed the temporary setup file is absent. The blank conversation screen was visually observed. The original phone was not installed, launched, or re-enrolled.

Package SHA-256: `f99c579bf85539d7ca28d4c10c6452cd4768b7c83073e7941cd06508e6e5b9b8`.
Distribution profile expires 30 September 2027, 19:09:32 UTC; re-sign/reinstall before expiry without uninstalling.

Evidence directory: `/tmp/trace-friend-install`. No live recording, provider transcription, summary, or export test was performed for this installation request. DevKit pairing and fresh capture remain separate acceptance steps.
