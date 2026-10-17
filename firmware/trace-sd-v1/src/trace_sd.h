#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

int trace_sd_start(void);
void trace_sd_frame(const uint8_t *data, size_t length);
void trace_sd_link(bool connected);
void trace_sd_pause(bool paused);
bool trace_sd_recording(void);

void trace_sd_shutdown(void);
