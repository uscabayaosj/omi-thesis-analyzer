# TRACE DevKit firmware

Firmware sources and integration patches for the TRACE iPhone app and Omi DevKit 2 (Seeed XIAO nRF52840 Sense with the DevKit 2 Adafruit BFF).

## Start here

| Directory | Purpose |
| --- | --- |
| [trace-controls-v1](trace-controls-v1/) | Current button-only firmware, advertised as `trace-controls-v2`. Includes SD recording and vibration feedback. The folder name is historical. |
| [trace-sd-v1](trace-sd-v1/) | SD recording base, advertised as `trace-sd-v3`. Includes the project-local SD synchronization correction. |
| [trace-devkit2-test](trace-devkit2-test/) | Earlier BLE audio, standby, battery, LED, and backpressure patches/configurations. Historical building blocks; use the consolidated SD base for the current build. |

Current centre-button controls request a bookmark on a single press and Pause/Resume on two quick presses. The paired TRACE app applies recording-boundary handling and feedback. Casing/motion double-tap detection was retired; the current configuration disables the IMU.

## Rebuild

Use Nordic nRF Connect SDK **2.7.0** and its matching toolchain in a configured SDK terminal. Python 3, Git, patch, and CMake are required. The board is `xiao_ble/nrf52840/sense`; use the DevKit 2 Adafruit configuration and overlay.

From the TRACE repository root:

```sh
git clone --filter=blob:none https://github.com/BasedHardware/omi.git ../omi-upstream
git -C ../omi-upstream fetch origin bc5d7a34a33f34112eba95902ba26294e60f8d2a
python3 firmware/trace-controls-v1/prepare.py --omi-repo ../omi-upstream

cmake -S firmware/trace-controls-v1/upstream \
  -B firmware/trace-controls-v1/build \
  -DBOARD=xiao_ble/nrf52840/sense \
  -DCONF_FILE=prj_xiao_ble_sense_devkitv2-adafruit.conf \
  -DDTC_OVERLAY_FILE=overlay/xiao_ble_sense_devkitv2-adafruit.overlay \
  -DEXTRA_CONF_FILE="$PWD/firmware/trace-controls-v1/trace-controls.conf"
cmake --build firmware/trace-controls-v1/build --parallel
```

`prepare.py` reads the pinned commit from the supplied checkout; it does not depend on that checkout's active branch and does not modify it. It prepares the SD base, copies the generated base into the controls folder, and integrates controls. Generated `upstream/` and `build/` folders are ignored. Recreate them from a clean clone for a clean source preparation.

Expected output: `firmware/trace-controls-v1/build/zephyr/zephyr.uf2`. Existing local build configuration used the board/configuration above. The publishing change did not rerun the firmware build or hardware checks.

## Installing and compatibility

These sources target the tested DevKit 2 hardware and NCS 2.7.0. They are not a generic image for all Omi products. Use a paired TRACE app that supports the TRACE SD/control services. Stock Omi applications do not implement the TRACE-specific controls and SD protocol.

The preparation/build commands do not flash hardware. To install a separately checked UF2, put the intended DevKit into its UF2 bootloader using the small RST button twice, confirm its XIAO-SENSE volume, and copy the UF2 to that specific volume. Preserve current firmware and any recordings you need before flashing. Do not infer installed firmware identity from the filename alone.

The SD module uses a separate TRACE namespace. Its configuration disables automatic filesystem formatting. This source publication does not format cards, flash devices, or qualify new hardware.

## What is published

Source modules, preparation scripts, integration patches, configuration, and licensing notices. Generated SDK/upstream trees, build logs, installation records, device identifiers, and local recordings are excluded. Compiled firmware is not included in this source commit.

## Upstream and licensing

OMI source is pinned to [`bc5d7a34a33f34112eba95902ba26294e60f8d2a`](https://github.com/BasedHardware/omi/tree/bc5d7a34a33f34112eba95902ba26294e60f8d2a/omi/firmware/devkit). See [NOTICE](NOTICE.md) and [LICENSES](LICENSES/). The Nordic/Zephyr SDK and its dependencies retain their own licenses and are installed separately.
