#!/usr/bin/env python3
"""Run the exact production speak() parser with mocked RTOS ingress primitives.
No hardware or speaker output. Compile with host ASan/UBSan.
"""
from pathlib import Path
import subprocess, tempfile
root=Path(__file__).resolve().parents[1]
source=(root/'src/trace_speaker.c').read_text()
parser=source[source.index('int speak('):source.index('\nint play_boot_sound')]
shim=r'''
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include <string.h>
#include <errno.h>
#include <assert.h>
#include <stdio.h>
#define CONFIG_OMI_ENABLE_SPEAKER 1
#define K_NO_WAIT 0
static int audio_lock, play_ready, powered_off, busy, signals;
static uint8_t mono[4000];
static size_t expected, received;
static int64_t last_packet, now;
static bool initialized=true, queued;
static int k_mutex_lock(int *m,int t) { return busy ? -EBUSY : 0; }
static void k_mutex_unlock(int *m) {}
static int atomic_get(int *p) { return *p; }
static int64_t k_uptime_get(void) { return now; }
static void k_sem_give(int *s) { ++signals; }
static uint32_t sys_get_le32(const void *p) {
 const uint8_t *b=p; return b[0]|((uint32_t)b[1]<<8)|((uint32_t)b[2]<<16)|((uint32_t)b[3]<<24);
}
'''
tests=r'''
static void reset(void) { expected=received=0; queued=false; signals=busy=0; powered_off=0; now=0; initialized=true; }
int main(void) {
 uint8_t data[4002]={0};
 uint8_t h[5]={99,0x90,1,0,0}; /* unaligned LE 400 */
 reset(); assert(speak(4,h+1)==4); assert(speak(400,data)==400);
 assert(queued && received==400 && signals==1); /* exact 400 final packet */
 assert(speak(4,h+1)==-EBUSY);
 reset(); h[1]=8;h[2]=0; assert(speak(4,h+1)==4);
 assert(speak(4,data)==4); assert(!queued && received==4); /* data, not header */
 assert(speak(4,data)==4); assert(queued && signals==1);
 reset(); assert(speak(0,data)==-EINVAL); assert(speak(1,data)==-EINVAL);
 assert(speak(4,NULL)==-EINVAL); assert(speak(4,data)==-EMSGSIZE);
 uint8_t maxheader[]={0xa0,0x0f,0,0};
 assert(speak(4,maxheader)==4);
 for(int i=0;i<10;i++) assert(speak(400,data)==400);
 assert(received==4000 && signals==1);
 reset(); maxheader[0]=0xa2; assert(speak(4,maxheader)==-EMSGSIZE);
 reset(); uint8_t small[]={2,0,0,0}; assert(speak(4,small)==4);
 assert(speak(4,data)==-EMSGSIZE); assert(!expected && !received);
 assert(speak(4,small)==4); assert(speak(2,data)==2); assert(queued);
 reset(); assert(speak(4,small)==4); now=5001;
 assert(speak(4,small)==4); assert(expected==2 && received==0);
 busy=1; assert(speak(2,data)==-EBUSY); busy=0;
 powered_off=1; assert(speak(2,data)==-ENODEV);
 reset(); initialized=false; assert(speak(4,small)==-ENODEV);
 puts("PASS: exact final packet, four-byte data, unaligned header, bounds, timeout, busy, unavailable");
}
'''
with tempfile.TemporaryDirectory() as td:
 p=Path(td); (p/'test.c').write_text(shim+parser+tests)
 subprocess.run(['clang','-std=c11','-fsanitize=address,undefined','-g',str(p/'test.c'),'-o',str(p/'test')],check=True)
 subprocess.run([str(p/'test')],check=True)
