/* SPDX-License-Identifier: MIT */
#ifndef TRACE_PROMPT_POLICY_H
#define TRACE_PROMPT_POLICY_H
#include <stdbool.h>
#include <stdint.h>
enum trace_prompt_id { PROMPT_CONNECTED=1, PROMPT_DISCONNECTED, PROMPT_RECORDING,
    PROMPT_PAUSED, PROMPT_LOW_BATTERY, PROMPT_SUMMARY };
struct trace_prompt_policy {
    bool configured, enabled, linked, announced_link, active, low_latched;
    uint32_t epoch;
    int battery;
};
static inline unsigned prompt_policy_link(struct trace_prompt_policy *p, bool linked) {
    if (p->linked == linked) return 0;
    unsigned event = !linked && p->configured && p->enabled ? PROMPT_DISCONNECTED : 0;
    p->linked=linked; p->epoch++; p->announced_link=false;
    if(linked) { p->configured=false; p->enabled=false; p->active=false; }
    return event;
}
static inline unsigned prompt_policy_configure(struct trace_prompt_policy *p, bool enabled) {
    p->configured=true; p->enabled=enabled;
    if(p->linked && enabled && !p->announced_link) { p->announced_link=true; return PROMPT_CONNECTED; }
    return 0;
}
static inline unsigned prompt_policy_capture(struct trace_prompt_policy *p, bool active) {
    bool changed=p->active!=active; p->active=active;
    return changed && p->configured && p->enabled ? (active ? PROMPT_RECORDING : PROMPT_PAUSED) : 0;
}
static inline unsigned prompt_policy_battery(struct trace_prompt_policy *p, int level) {
    if(level<0 || level>100) return 0;
    p->battery=level;
    if(level>=25) p->low_latched=false;
    if(level<=20 && !p->low_latched && p->configured && p->enabled) {
        p->low_latched=true; return PROMPT_LOW_BATTERY;
    }
    return 0;
}
static inline bool prompt_policy_valid(const struct trace_prompt_policy *p, unsigned id, uint32_t epoch, bool preview) {
    if(!p->configured || !p->enabled || p->epoch!=epoch) return false;
    if(preview) return true;
    switch(id) {
    case PROMPT_CONNECTED: return p->linked;
    case PROMPT_DISCONNECTED: return !p->linked;
    case PROMPT_RECORDING: return p->active;
    case PROMPT_PAUSED: return !p->active;
    case PROMPT_LOW_BATTERY: return p->battery>=0 && p->battery<=20;
    case PROMPT_SUMMARY: return p->linked;
    default: return false;
    }
}
#endif
