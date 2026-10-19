#include "../src/trace_prompt_policy.h"
#include <assert.h>
#include <stdio.h>
int main(void) {
 struct trace_prompt_policy p={.battery=-1};
 assert(prompt_policy_capture(&p,false)==0);
 assert(prompt_policy_link(&p,true)==0);
 assert(prompt_policy_configure(&p,true)==PROMPT_CONNECTED);
 assert(prompt_policy_configure(&p,true)==0);
 assert(prompt_policy_capture(&p,true)==PROMPT_RECORDING);
 assert(prompt_policy_capture(&p,true)==0);
 uint32_t epoch=p.epoch;
 assert(prompt_policy_capture(&p,false)==PROMPT_PAUSED);
 assert(!prompt_policy_valid(&p,PROMPT_RECORDING,epoch,false));
 assert(prompt_policy_valid(&p,PROMPT_RECORDING,epoch,true));
 assert(prompt_policy_battery(&p,-1)==0 && prompt_policy_battery(&p,101)==0);
 assert(prompt_policy_battery(&p,21)==0);
 assert(prompt_policy_battery(&p,20)==PROMPT_LOW_BATTERY);
 assert(prompt_policy_battery(&p,19)==0);
 assert(prompt_policy_battery(&p,24)==0 && prompt_policy_battery(&p,20)==0);
 assert(prompt_policy_battery(&p,25)==0 && prompt_policy_battery(&p,20)==PROMPT_LOW_BATTERY);
 assert(prompt_policy_link(&p,false)==PROMPT_DISCONNECTED);
 assert(!prompt_policy_valid(&p,PROMPT_CONNECTED,epoch,false));
 assert(prompt_policy_valid(&p,PROMPT_DISCONNECTED,p.epoch,false));
 assert(prompt_policy_link(&p,false)==0);
 assert(prompt_policy_link(&p,true)==0);
 assert(!prompt_policy_valid(&p,PROMPT_SUMMARY,p.epoch,false));
 assert(prompt_policy_configure(&p,false)==0);
 assert(prompt_policy_capture(&p,true)==0);
 assert(prompt_policy_battery(&p,10)==0);
 assert(prompt_policy_configure(&p,true)==PROMPT_CONNECTED);
 assert(prompt_policy_configure(&p,true)==0);
 assert(prompt_policy_valid(&p,PROMPT_SUMMARY,p.epoch,false));
 puts("PASS: prompt transitions, initial pause, repeated writes, reconnect epochs, mute, low battery hysteresis, stale-job rejection");
}
