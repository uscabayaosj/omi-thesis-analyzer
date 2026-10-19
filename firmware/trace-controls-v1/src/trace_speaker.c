/* SPDX-License-Identifier: MIT
 * TRACE replacement for the Omi speaker path. See firmware/NOTICE.md.
 * 8 kHz signed little-endian mono input, stereo I2S output.
 */
#include "speaker.h"
#include <errno.h>
#include <string.h>
#include <zephyr/device.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/drivers/i2s.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/sys/atomic.h>

LOG_MODULE_REGISTER(speaker, CONFIG_LOG_DEFAULT_LEVEL);
#define MAX_HAPTIC_DURATION 5000
static const struct gpio_dt_spec haptic_gpio_pin = {
    .port = DEVICE_DT_GET(DT_NODELABEL(gpio1)), .pin = 11};
static const struct gpio_dt_spec speaker_gpio_pin = {
    .port = DEVICE_DT_GET(DT_NODELABEL(gpio0)), .pin = 4};

#ifdef CONFIG_OMI_ENABLE_SPEAKER
#define RATE 8000
#define FRAMES 320
#define BLOCK_BYTES (FRAMES * 4)
#define BLOCKS 3
#define MAX_MONO_BYTES 4000
/* Four-byte alignment is required by EasyDMA. Ownership transfers to I2S
 * only on a successful write; the driver then returns the block to this slab. */
K_MEM_SLAB_DEFINE_STATIC(tx_slab, BLOCK_BYTES, BLOCKS, 4);
K_MUTEX_DEFINE(audio_lock);
K_SEM_DEFINE(play_ready, 0, 1);
static const struct device *const audio_speaker = DEVICE_DT_GET(DT_NODELABEL(i2s0));
static uint8_t mono[MAX_MONO_BYTES];
static size_t expected, received;
static int64_t last_packet;
static bool initialized, queued;
static atomic_t powered_off;
#ifdef CONFIG_TRACE_SPEAKER_SELF_TEST
#include "trace_speaker_phrase.h"
static bool diagnostic;
#endif

static int play_pcm(const uint8_t *pcm, size_t bytes)
{
    int err = 0;
    size_t sent = 0;
    bool started = false;
    if (atomic_get(&powered_off)) return -ESHUTDOWN;
    gpio_pin_set_dt(&speaker_gpio_pin, 1);
    k_msleep(10); /* amplifier enable settling, on the playback thread only */
    while (sent < bytes) {
        if (atomic_get(&powered_off)) { err = -ECANCELED; break; }
        void *block;
        err = k_mem_slab_alloc(&tx_slab, &block, K_MSEC(200));
        if (err) break;
        size_t frames = MIN((bytes - sent) / 2, FRAMES);
        int16_t *stereo = block;
        for (size_t i = 0; i < frames; ++i) {
            /* Clamp all incoming audio to the diagnostic's conservative peak.
             * This is a digital amplitude limit, not a calibrated sound level. */
            int16_t sample = (int16_t)sys_get_le16(pcm + sent + i * 2);
            sample = CLAMP(sample, -650, 650);
            stereo[i * 2] = sample;
            stereo[i * 2 + 1] = sample;
        }
        err = i2s_write(audio_speaker, block, frames * 4);
        if (err) { k_mem_slab_free(&tx_slab, block); break; }
        sent += frames * 2;
        /* Prefill two buffers before starting to avoid immediate underrun. */
        if (!started && (sent >= FRAMES * 4 || sent == bytes)) {
            err = i2s_trigger(audio_speaker, I2S_DIR_TX, I2S_TRIGGER_START);
            if (err) break;
            started = true;
        }
    }
    if (!err) err = i2s_trigger(audio_speaker, I2S_DIR_TX, I2S_TRIGGER_DRAIN);
    /* Last two/three buffers are at most 120 ms. Bound completion waiting. */
    int64_t deadline = k_uptime_get() + 500;
    while (!err && k_mem_slab_num_used_get(&tx_slab)) {
        if (k_uptime_get() >= deadline) { err = -ETIMEDOUT; break; }
        k_msleep(5);
    }
    /* DROP stops hardware and releases any remaining driver-owned buffers,
     * including after an underrun/error. Never manually free an owned block. */
    int drop = i2s_trigger(audio_speaker, I2S_DIR_TX, I2S_TRIGGER_DROP);
    if (!err && drop) err = drop;
    gpio_pin_set_dt(&speaker_gpio_pin, 0);
    LOG_INF("Speaker playback bytes=%u result=%d", (unsigned)sent, err);
    return err;
}

static void playback_thread(void *a, void *b, void *c)
{
    for (;;) {
        k_sem_take(&play_ready, K_FOREVER);
        k_mutex_lock(&audio_lock, K_FOREVER);
#ifdef CONFIG_TRACE_SPEAKER_SELF_TEST
        if (diagnostic) {
            diagnostic = false;
            LOG_INF("Speaker diagnostic tone START");
            int err = play_pcm(trace_tone, sizeof(trace_tone));
            LOG_INF("Speaker diagnostic tone END result=%d", err);
            if (!err && !atomic_get(&powered_off)) {
                k_msleep(800);
                LOG_INF("Speaker diagnostic phrase START: TRACE speaker test.");
                err = play_pcm(trace_phrase, sizeof(trace_phrase));
                LOG_INF("Speaker diagnostic phrase END result=%d", err);
            }
        } else
#endif
        if (queued) play_pcm(mono, expected);
        queued = false;
        expected = received = 0;
        k_mutex_unlock(&audio_lock);
    }
}
/* Playback has its own stack; Bluetooth and the system work queue never wait. */
K_THREAD_DEFINE(speaker_worker, 2048, playback_thread, NULL, NULL, NULL, 12, 0, 0);

#ifdef CONFIG_TRACE_SPEAKER_SELF_TEST
static void diagnostic_due(struct k_work *work)
{
    if (k_mutex_lock(&audio_lock, K_NO_WAIT)) return;
    if (initialized && !queued && !expected && !atomic_get(&powered_off)) {
        diagnostic = true;
        queued = true;
        k_sem_give(&play_ready);
    }
    k_mutex_unlock(&audio_lock);
}
K_WORK_DELAYABLE_DEFINE(diagnostic_work, diagnostic_due);
#endif
#endif

int speaker_init(void)
{
#ifdef CONFIG_OMI_ENABLE_SPEAKER
    if (!device_is_ready(audio_speaker) || !gpio_is_ready_dt(&speaker_gpio_pin))
        return -ENODEV;
    int err = gpio_pin_configure_dt(&speaker_gpio_pin, GPIO_OUTPUT_INACTIVE);
    if (err) return err;
    struct i2s_config config = {
        .word_size = 16, .channels = 2,
        .format = I2S_FMT_DATA_FORMAT_I2S, /* MAX98357A (Adafruit Audio BFF) */
        .options = I2S_OPT_FRAME_CLK_MASTER | I2S_OPT_BIT_CLK_MASTER,
        .frame_clk_freq = RATE, .mem_slab = &tx_slab,
        .block_size = BLOCK_BYTES, .timeout = 200,
    };
    err = i2s_configure(audio_speaker, I2S_DIR_TX, &config);
    initialized = !err;
    LOG_INF("Speaker init result=%d; low amplitude limit=650", err);
    return err;
#else
    return -ENOTSUP;
#endif
}

int speak(uint16_t len, const void *buf)
{
#ifdef CONFIG_OMI_ENABLE_SPEAKER
    if (!buf || !len || (len & 1)) return -EINVAL;
    if (k_mutex_lock(&audio_lock, K_NO_WAIT)) return -EBUSY;
    int result = len;
    if (!initialized || atomic_get(&powered_off)) { result = -ENODEV; goto out; }
    if (queued) { result = -EBUSY; goto out; }
    if (expected && k_uptime_get() - last_packet > 5000) expected = received = 0;
    if (!expected) {
        if (len != 4) { result = -EINVAL; goto out; }
        uint32_t size = sys_get_le32(buf); /* handles unaligned BLE input */
        if (!size || (size & 1) || size > sizeof(mono)) { result = -EMSGSIZE; goto out; }
        expected = size;
        received = 0;
    } else {
        if (len > expected - received) {
            expected = received = 0;
            result = -EMSGSIZE;
            goto out;
        }
        memcpy(mono + received, buf, len);
        received += len;
        if (received == expected) {
            queued = true;
            k_sem_give(&play_ready);
        }
    }
    last_packet = k_uptime_get();
out:
    k_mutex_unlock(&audio_lock);
    return result;
#else
    return -ENOTSUP;
#endif
}

int play_boot_sound(void)
{
#ifdef CONFIG_TRACE_SPEAKER_SELF_TEST
    if (!initialized) return -ENODEV;
    /* Opt-in diagnostic only, one playback per boot after normal startup. */
    k_work_reschedule(&diagnostic_work, K_SECONDS(15));
#endif
    return 0;
}

/* Legacy optional haptic service is intentionally not registered. TRACE uses
 * its acknowledged controls service and independent nonblocking motor worker. */
void register_speaker_service(void) {}

int init_haptic_pin()
{
    if (gpio_is_ready_dt(&haptic_gpio_pin)) {
        LOG_INF("Haptic Pin ready");
    } else {
        LOG_ERR("Error setting up Haptic Pin");
        return -1;
    }
    if (gpio_pin_configure_dt(&haptic_gpio_pin, GPIO_OUTPUT_INACTIVE) < 0) {
        LOG_ERR("Error setting up Haptic Pin");
        return -1;
    }
    gpio_pin_set_dt(&haptic_gpio_pin, 0);

    return 0;
}
K_SEM_DEFINE(haptic_sem, 0, 1);
void haptic_timer_callback(struct k_timer *timer);

K_TIMER_DEFINE(my_status_timer, haptic_timer_callback, NULL);

void haptic_timer_callback(struct k_timer *timer)
{
    // k_sem_give(&haptic_sem);
    gpio_pin_set_dt(&haptic_gpio_pin, 0);
}

void play_haptic_milli(uint32_t duration)
{
    if (duration > MAX_HAPTIC_DURATION) {
        LOG_ERR("Duration is too long");
        return;
    }
    gpio_pin_set_dt(&haptic_gpio_pin, 1);
    // if (k_sem_take(&haptic_sem, K_MSEC(50)) != 0)
    // {

    // }
    // else
    // {
    k_timer_start(&my_status_timer, K_MSEC(duration), K_NO_WAIT);
    // }
}

void speaker_off(void)
{
#ifdef CONFIG_OMI_ENABLE_SPEAKER
    atomic_set(&powered_off, 1);
    gpio_pin_set_dt(&speaker_gpio_pin, 0);
#endif
}
