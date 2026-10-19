#ifndef TRACE_STATUS_LEDS_H
#define TRACE_STATUS_LEDS_H
#include <stdbool.h>
void trace_status_leds_update(bool powered_off, bool connected, bool capture_active, bool sd_recording);
#endif
