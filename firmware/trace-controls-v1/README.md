# TRACE button controls — trace-controls-v2

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
`trace-controls.conf` declares the `trace-controls-v2` revision.

Build logs, provenance files and per-device installation evidence are local-only.
