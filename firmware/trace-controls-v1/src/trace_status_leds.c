/* USB-power indication is independent of the USB data stack and BLE callbacks.
 * VBUS indicates charging power is available, not battery current or completion.
 */
#include "trace_status_leds.h"
#include "led.h"
#include <hal/nrf_power.h>
#include <zephyr/kernel.h>

void trace_status_leds_update(bool powered_off, bool connected, bool capture_active, bool sd_recording)
{
    bool red = false, green = false, blue = false;
    if (!powered_off) {
        bool usb_power = nrf_power_usbregstatus_vbusdet_get(NRF_POWER);
        // Existing main-loop updates occur every 500 ms. No extra work queue,
        // sleep, USB initialization, or charging-circuit writes are needed.
        bool charging_pulse = usb_power && (k_uptime_get() % 3000 < 500);
        bool recording = sd_recording || (connected && capture_active);
        if (charging_pulse) {
            green = true;
        } else if (recording) {
            blue = true;
        } else if (connected) {
            red = true;
            green = true; // amber: connected and paused
        } else {
            red = true;
        }
    }
    set_led_red(red);
    set_led_green(green);
    set_led_blue(blue);
}
