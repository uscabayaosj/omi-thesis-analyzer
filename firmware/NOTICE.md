# Upstream notices

## OMI

TRACE's firmware preparation reads the OMI DevKit source at commit
`bc5d7a34a33f34112eba95902ba26294e60f8d2a` from BasedHardware/omi.
The integration patches modify portions of that source. Retain OMI's MIT notice
with copied or modified upstream source; the exact pinned upstream license is
included in [LICENSES/OMI-MIT.txt](LICENSES/OMI-MIT.txt).

Copyright (c) 2024 Based Hardware Contributors.

## Zephyr / NCS SD synchronization

`trace-sd-v1/src/trace_sd_sync.c` is a project-local correction based on the
Apache-2.0 SD ioctl implementation in the Zephyr source shipped with NCS 2.7.0.
The upstream file credits Copyright 2022,2024 NXP. TRACE modifies the sync case
so the readiness result is returned instead of falling through to an unsupported
operation. The Apache-2.0 license is included in
[LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt).

Generated firmware also links Nordic, Zephyr, Opus and other upstream components.
Their source and license notices come from the pinned OMI source and installed
SDK/toolchain; this folder does not replace those notices or redistribute the SDK.
