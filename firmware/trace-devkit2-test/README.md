# Earlier TRACE DevKit patches

Historical patches and configurations leading up to the consolidated SD and
button-control firmware. For the current build, use the [firmware guide](../README.md)
and `trace-controls-v1/prepare.py`.

This folder retains development building blocks for live BLE transport, LED
capture state, battery work queues, microphone standby, counters and bounded
transport backpressure. The current SD preparation already applies its consolidated
`stats8-base.patch`; do not apply these historical patches on top of it.

Some earlier patches use repository-root paths, while later patches use DevKit
module-relative paths. Their filenames are historical development stages rather
than an automatic, supported upgrade chain.

Per-device logs, generated binaries and installation evidence remain local.
