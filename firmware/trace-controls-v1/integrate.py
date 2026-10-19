from pathlib import Path
r=Path(__file__).resolve().parent;u=r/'upstream'
def replace(file,old,new):
 p=u/file;s=p.read_text();assert old in s,(file,old);p.write_text(s.replace(old,new))
# Reuse audited SD originals; generated source references remain outside this folder.
replace('CMakeLists.txt','../src/trace_sd.c','../../trace-sd-v1/src/trace_sd.c\n    ../src/trace_controls.c')
replace('CMakeLists.txt','include(${CMAKE_CURRENT_SOURCE_DIR}/../sd-sync-fix.cmake)','include(${CMAKE_CURRENT_SOURCE_DIR}/../../trace-sd-v1/sd-sync-fix.cmake)')
with (u/'CMakeLists.txt').open('a') as f:f.write('\ntarget_include_directories(app PRIVATE ../src src)\n')
replace('src/main.c','#include "button.h"','#include "button.h"\n#include "trace_controls.h"')
# Button controls cannot block boot/BLE/audio if the motor is unavailable.
replace('src/main.c','    set_mic_callback(mic_handler);','    trace_controls_init();\n    set_mic_callback(mic_handler);')
replace('src/button.c','#include "button.h"','#include "button.h"\n#include "trace_controls.h"')
replace('src/button.c','    LOG_INF("Button single tap");','    LOG_INF("Button single tap");\n    trace_controls_button(1);')
replace('src/button.c','    LOG_INF("Button double tap");','    LOG_INF("Button double tap");\n    trace_controls_button(2);')
# Replace the legacy polling FSM: monotonic timing, debounce, delayed single,
# no release-event resets during the double window; preserve 3s power-off.
p=u/'src/button.c';s=p.read_text();start=s.index('void check_button_level(struct k_work *work_item)\n{');end=s.index('// @deprecated',start)
s=s[:start]+(r/'src/button_loop.txt').read_text()+'\n'+s[end:];p.write_text(s)
replace('src/button.c','    trace_sd_shutdown();','    trace_controls_shutdown();\n    trace_sd_shutdown();')
# Make SD faults signal controls without modifying the original SD module.
# Source compiled once through an explicit generated copy.
s=(r.parent/'trace-sd-v1/src/trace_sd.c').read_text().replace('#include "trace_sd.h"','#include "trace_sd.h"\n#include "trace_controls.h"').replace('static void storage_failed(int error) {','static void storage_failed(int error) {\n    trace_controls_sd_fault();')
(u/'src/trace_sd_controls.c').write_text(s)
replace('CMakeLists.txt','../../trace-sd-v1/src/trace_sd.c','src/trace_sd_controls.c')
for name in ['trace_sd.h']:(u/'src'/name).write_bytes((r.parent/'trace-sd-v1/src'/name).read_bytes())
# Poll the hardware VBUS bit without enabling the USB data stack.
replace('CMakeLists.txt','../src/trace_controls.c','../src/trace_controls.c\n    ../src/trace_status_leds.c')
replace('src/main.c','#include "trace_controls.h"','#include "trace_controls.h"\n#include "trace_status_leds.h"')
p=u/'src/main.c';s=p.read_text();start=s.index('void set_led_state()\n{');end=s.index('\nint main(void)',start)
s=s[:start]+"""void set_led_state()
{
    trace_status_leds_update(is_off, is_connected, trace_capture_is_active(), trace_sd_recording());
}
"""+s[end:];p.write_text(s)
p=r/'trace-controls.conf';s=p.read_text().replace('trace-sd-v3','trace-controls-v3').replace('trace-controls-v2','trace-controls-v3');p.write_text(s)


# Speaker replacement: all playback runs on its own bounded worker.
(u/'src/speaker.c').write_bytes((r/'src/trace_speaker.c').read_bytes())
(u/'src/speaker.h').write_bytes((r/'src/trace_speaker.h').read_bytes())
with (u/'Kconfig').open('a') as f:
 f.write('\nconfig TRACE_SPEAKER_SELF_TEST\n    bool "One quiet tone and phrase after boot (diagnostic only)"\n    depends on OMI_ENABLE_SPEAKER\n    default n\n')
replace('src/main.c', '        LOG_ERR("Speaker failed to start");\n        return err;', '        LOG_ERR("Optional speaker unavailable: %d; continuing capture startup", err);')
start=(u/'src/transport.c').read_text().index('    uint16_t amount = 400;')
p=u/'src/transport.c';s=p.read_text();end=s.index('\n}',start)
s=s[:start]+"""    if (offset || (flags & BT_GATT_WRITE_FLAG_PREPARE))
        return BT_GATT_ERR(BT_ATT_ERR_NOT_SUPPORTED);
    int result = speak(len, buf);
    if (result < 0) return BT_GATT_ERR(BT_ATT_ERR_VALUE_NOT_ALLOWED);
    return result;"""+s[end:];p.write_text(s)
