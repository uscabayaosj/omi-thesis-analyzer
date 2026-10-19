/* SPDX-License-Identifier: MIT */
#ifndef SPEAKER_H
#define SPEAKER_H
#include <zephyr/kernel.h>
int speaker_init(void);
/* Legacy wire format: four-byte LE mono byte count (2..4000, even), then
 * that many signed 16-bit LE mono bytes in even packets. Four-byte data
 * packets are data while a transfer is in progress. 5 s timeout resets it.
 * Returns accepted bytes or negative errno; queued/busy is rejected.
 * Complete clips play asynchronously, with peak limited to 650/32767. */
int speak(uint16_t len, const void *buf);
int play_boot_sound(void);
int init_haptic_pin(void);
void play_haptic_milli(uint32_t duration);
void speaker_off(void);
void register_speaker_service(void);
#endif
