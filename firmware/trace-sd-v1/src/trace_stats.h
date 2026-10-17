#ifndef TRACE_STATS_H
#define TRACE_STATS_H
#include <zephyr/sys/atomic.h>
enum trace_stat {
 TRACE_PDM_SAMPLES, TRACE_PDM_ERRORS, TRACE_PCM_ACCEPTED_SAMPLES,
 TRACE_PCM_DROPPED_SAMPLES, TRACE_ENCODED_FRAMES, TRACE_ENCODER_FAILURES,
 TRACE_TX_QUEUED_FRAMES, TRACE_TX_DROPPED_FRAMES, TRACE_BLE_SENT_FRAMES,
 TRACE_BLE_NOTIFY_FAILURES, TRACE_STAT_COUNT
};
extern atomic_t trace_stats[TRACE_STAT_COUNT];
static inline void trace_stat_add(enum trace_stat counter, uint32_t amount)
{ atomic_add(&trace_stats[counter], amount); }
#endif
