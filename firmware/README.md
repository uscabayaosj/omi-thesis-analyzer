# TRACE DevKit firmware

Firmware sources and integration patches for the TRACE iPhone app and Omi DevKit 2 (Seeed XIAO nRF52840 Sense with the DevKit 2 Adafruit BFF).

## Start here

| Directory | Purpose |
| --- | --- |
| [trace-controls-v1](trace-controls-v1/) | Current button-only firmware, advertised as `trace-controls-v4`. Includes SD recording and vibration feedback. The folder name is historical. |
| [trace-sd-v1](trace-sd-v1/) | SD recording base, advertised as `trace-sd-v3`. Includes the project-local SD synchronization correction. |
| [trace-devkit2-test](trace-devkit2-test/) | Earlier BLE audio, standby, battery, LED, and backpressure patches/configurations. Historical building blocks; use the consolidated SD base for the current build. |

Current centre-button controls request a bookmark on a single press and Pause/Resume on two quick presses. The paired TRACE app applies recording-boundary handling and feedback. Casing/motion double-tap detection was retired; the current configuration disables the IMU.

## Light indicators

These describe the main RGB status LED. The USB-power pulse is new in
`trace-controls-v3`; earlier installed `trace-controls-v2` images do not have it.

| Light | Meaning |
| --- | --- |
| Blue | Recording state is active: connected TRACE capture, or offline SD recording. |
| Amber / yellow-orange | Connected to the iPhone and paused, with no SD recording active. |
| Red | Disconnected from the iPhone, with no SD recording active. |
| Brief green pulse every three seconds | USB charging power is present. It alternates with the current blue, amber, or red status rather than mixing colours. |
| Off | Firmware is powered down; all three RGB channels are off. |
| Brief multicolour startup flashes | Normal boot LED sequence before the steady status. |

The green pulse is approximately half a second, at the existing 500 ms status
update cadence, and is available while the firmware is running. It reads the
nRF52840 hardware VBUS-detect bit, so it also works with a USB power adapter
without USB data enumeration. It does not change charging current, charger
settings, recording, Bluetooth, or SD behavior.

USB presence does **not** prove that battery charge current is flowing or that the
battery is full. The green pulse may remain when the battery is fully charged;
there is no separate full-charge indication. Recording colours describe device
state and do not prove that every frame was saved, uploaded, or transcribed.
Persistent fast flashing during initialization may indicate a startup failure.

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

Expected output: `firmware/trace-controls-v1/build/zephyr/zephyr.uf2`. Existing local build configuration used the board/configuration above. The original source publication did not rerun the firmware build or hardware checks. See the current revision notes below for subsequent build evidence.

## Installing and compatibility

These sources target the tested DevKit 2 hardware and NCS 2.7.0. They are not a generic image for all Omi products. Use a paired TRACE app that supports the TRACE SD/control services. Stock Omi applications do not implement the TRACE-specific controls and SD protocol.

The preparation/build commands do not flash hardware. To install a separately checked UF2, put the intended DevKit into its UF2 bootloader using the small RST button twice, confirm its XIAO-SENSE volume, and copy the UF2 to that specific volume. Preserve current firmware and any recordings you need before flashing. Do not infer installed firmware identity from the filename alone.

The SD module uses a separate TRACE namespace. Its configuration disables automatic filesystem formatting. This source publication does not format cards, flash devices, or qualify new hardware.

## What is published

Source modules, preparation scripts, integration patches, configuration, and licensing notices. Generated SDK/upstream trees, build logs, installation records, device identifiers, and local recordings are excluded. Compiled firmware is not included in this source commit.

## Upstream and licensing

OMI source is pinned to [`bc5d7a34a33f34112eba95902ba26294e60f8d2a`](https://github.com/BasedHardware/omi/tree/bc5d7a34a33f34112eba95902ba26294e60f8d2a/omi/firmware/devkit). See [NOTICE](NOTICE.md) and [LICENSES](LICENSES/). The Nordic/Zephyr SDK and its dependencies retain their own licenses and are installed separately.

## Charging-indicator revision

`trace-controls-v3` adds the USB-power green pulse without enabling the USB data
stack. The previous button-only implementation is retained. This is a source and
build candidate until explicitly installed and checked on a device; publishing the
README does not update an already-flashed DevKit.

## Speaker revision

`trace-controls-v4` replaces the legacy speaker driver with bounded asynchronous
playback, optional initialization, checked ingress and correct I2S buffer ownership.
It retains the button controls, SD path and green USB-power indicator. Normal
builds have no startup sound. The separate `trace-speaker-d1` configuration plays
one quiet tone and phrase after boot for an attended hardware check; see the
[controls speaker notes](trace-controls-v1/README.md#speaker-correction-and-diagnostic).
Speaker presence/output still requires an acoustic check on the actual device.
