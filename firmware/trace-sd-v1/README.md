# TRACE SD recording base — trace-sd-v3

This folder contains the SD source used by the current button-control firmware.
See the [shared build guide](../README.md) for prerequisites and the current image.

`prepare.py --omi-repo <checkout>` extracts the pinned OMI DevKit source, applies
`stats8-base.patch` and `sd-integration.patch`, copies the shared statistics header,
and includes the project-local SD synchronization correction. Generated upstream
source is ignored by Git.

- `src/trace_sd.c` and `src/trace_sd.h`: TRACE SD recording and transfer service.
- `src/trace_stats.h`: shared diagnostic counters.
- `src/trace_sd_sync.c` and `sd-sync-fix.cmake`: correct SDK SD sync ioctl fallthrough
  without editing the installed SDK.
- `trace-sd.conf`: separate TRACE SD implementation, automatic formatting disabled,
  revision `trace-sd-v3`.
- `tests/test_sd_sync.py`: retained source checks for the SD sync correction.

For a standalone SD-base build, run this folder's preparation script and use the
same board, base config and overlay as the current controls build, with this
folder's `upstream/`, `build/`, and `trace-sd.conf` paths instead.
