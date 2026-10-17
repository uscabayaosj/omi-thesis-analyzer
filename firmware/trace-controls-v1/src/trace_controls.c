/* Button controls: no button changes capture locally. TRACE admits requests
 * through the same phone-side boundary drain as its Pause/Resume buttons. */
#include "trace_controls.h"
#include "trace_stats.h"
#include "transport.h"
#include "button.h"
#include <zephyr/kernel.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/logging/log.h>
LOG_MODULE_REGISTER(trace_controls, CONFIG_LOG_DEFAULT_LEVEL);
extern bool is_off;
static const struct gpio_dt_spec motor = {.port=DEVICE_DT_GET(DT_NODELABEL(gpio1)), .pin=11};
static atomic_t settings, subscribed, motor_ready, fault_pending, stopped, feedback_permission;
static uint32_t sequence;
struct control_job { uint8_t event, pattern; };
K_MSGQ_DEFINE(jobs, sizeof(struct control_job), 8, 4);
K_THREAD_STACK_DEFINE(control_stack, 2048);
static struct k_thread control_thread;
static struct bt_uuid_128 service_uuid = BT_UUID_INIT_128(BT_UUID_128_ENCODE(0xA71C0010,0x6B8D,0x4E75,0xA1B2,0x7D0E6F545243));
static struct bt_uuid_128 event_uuid = BT_UUID_INIT_128(BT_UUID_128_ENCODE(0xA71C0011,0x6B8D,0x4E75,0xA1B2,0x7D0E6F545243));
static struct bt_uuid_128 command_uuid = BT_UUID_INIT_128(BT_UUID_128_ENCODE(0xA71C0012,0x6B8D,0x4E75,0xA1B2,0x7D0E6F545243));
static void ccc(const struct bt_gatt_attr *a, uint16_t value) {
    atomic_set(&subscribed, value == BT_GATT_CCC_NOTIFY);
    /* Explicit configuration required on every new subscription. No old taps
     * are read/replayed across a disconnect or a phone process restart. */
    atomic_clear(&settings);
}
static ssize_t status_read(struct bt_conn *c,const struct bt_gatt_attr *a,void *b,uint16_t n,uint16_t o) {
    uint8_t status[3]={1,(atomic_get(&motor_ready)?1:0),atomic_get(&settings)};
    return bt_gatt_attr_read(c,a,b,n,o,status,sizeof(status));
}
static ssize_t command_write(struct bt_conn *c,const struct bt_gatt_attr *a,const void *b,uint16_t n,uint16_t o,uint8_t f) {
    if(o) return BT_GATT_ERR(BT_ATT_ERR_INVALID_OFFSET);
    if(n!=2) return BT_GATT_ERR(BT_ATT_ERR_INVALID_ATTRIBUTE_LEN);
    const uint8_t *v=b;
    if(f & BT_GATT_WRITE_FLAG_PREPARE) return BT_GATT_ERR(BT_ATT_ERR_VALUE_NOT_ALLOWED);
    if(v[0]==1 && v[1]<=7) { atomic_set(&settings,v[1]&5); atomic_set(&feedback_permission,(v[1]&5)==5); }
    else if(v[0]==2 && v[1]>=1 && v[1]<=4) {
        struct control_job j={.pattern=v[1]};
        if(k_msgq_put(&jobs,&j,K_NO_WAIT)) return BT_GATT_ERR(BT_ATT_ERR_INSUFFICIENT_RESOURCES);
    } else return BT_GATT_ERR(BT_ATT_ERR_VALUE_NOT_ALLOWED);
    return n;
}
static struct bt_gatt_attr attrs[]={
    BT_GATT_PRIMARY_SERVICE(&service_uuid),
    BT_GATT_CHARACTERISTIC(&event_uuid.uuid,BT_GATT_CHRC_NOTIFY,0,NULL,NULL,NULL),
    BT_GATT_CCC(ccc,BT_GATT_PERM_READ|BT_GATT_PERM_WRITE),
    BT_GATT_CHARACTERISTIC(&command_uuid.uuid,BT_GATT_CHRC_READ|BT_GATT_CHRC_WRITE,BT_GATT_PERM_READ|BT_GATT_PERM_WRITE,status_read,command_write,NULL),
};
static struct bt_gatt_service service=BT_GATT_SERVICE(attrs);
static void request(uint8_t event) {
    if(!atomic_get(&subscribed) || !(atomic_get(&settings)&1) || is_off || atomic_get(&stopped)) return;
    struct control_job j={.event=event}; (void)k_msgq_put(&jobs,&j,K_NO_WAIT);
}
void trace_controls_button(unsigned event) {
    if(event==1) request(1); /* single press -> bookmark */
    if(event==2) request(2); /* two presses -> pause/resume request */
}
void trace_controls_sd_fault(void) { atomic_set(&fault_pending,1); }
static void pulse(unsigned ms) {
    if(!atomic_get(&motor_ready) || !atomic_get(&feedback_permission) || is_off) return;
    gpio_pin_set_dt(&motor,1); k_msleep(ms); gpio_pin_set_dt(&motor,0);
}
static void feedback(uint8_t pattern) {
    switch(pattern) {
    case 1: pulse(45); break;
    case 2: pulse(110); break;
    case 3: pulse(45); k_msleep(100); pulse(45); break;
    case 4: pulse(180); k_msleep(180); pulse(180); k_msleep(180); pulse(180); break;
    }
}
static void run(void *a,void *b,void *c) {
    uint32_t previous[TRACE_STAT_COUNT]={0};
    bool was_active=false, incident=false;
    int64_t next_fault_sample=0;
    while(!atomic_get(&stopped)) {
        if(!atomic_get(&subscribed)) atomic_clear(&settings);
        bool active=trace_capture_is_active();
        if(k_uptime_get()>=next_fault_sample || active!=was_active) {
            bool changed=false;
            for(unsigned i=0;i<TRACE_STAT_COUNT;i++) {
                uint32_t now=atomic_get(&trace_stats[i]);
                if(active && was_active && (i==TRACE_PDM_ERRORS || i==TRACE_PCM_DROPPED_SAMPLES || i==TRACE_ENCODER_FAILURES || i==TRACE_TX_DROPPED_FRAMES || i==TRACE_BLE_NOTIFY_FAILURES) && now!=previous[i]) changed=true;
                previous[i]=now;
            }
            if(!active) incident=false;
            if(active && changed && !incident) { incident=true; feedback(4); request(4); }
            was_active=active; next_fault_sample=k_uptime_get()+5000;
        }
        if(atomic_cas(&fault_pending,1,0)) { feedback(4); request(4); }
        struct control_job j;
        if(!k_msgq_get(&jobs,&j,K_MSEC(50))) {
            if(j.pattern) feedback(j.pattern);
            if(j.event && atomic_get(&subscribed) && (atomic_get(&settings)&1)) {
                uint8_t packet[14]={1,j.event}; sys_put_le32(++sequence,packet+2); sys_put_le64(k_uptime_get(),packet+6);
                struct bt_conn *conn=bt_conn_lookup_index(0); /* BT_MAX_CONN=1; returns a held reference */
                if(conn) { (void)bt_gatt_notify(conn,&attrs[2],packet,sizeof(packet)); bt_conn_unref(conn); }
            }
        }
    }
    gpio_pin_set_dt(&motor,0);
}
void trace_controls_init(void) {
    if(gpio_is_ready_dt(&motor) && !gpio_pin_configure_dt(&motor,GPIO_OUTPUT_INACTIVE)) atomic_set(&motor_ready,1);
    int err=bt_gatt_service_register(&service);
    LOG_INF("TRACE controls v2 service=%d haptic=%d",err,(int)atomic_get(&motor_ready));
    if(!err) k_thread_create(&control_thread,control_stack,K_THREAD_STACK_SIZEOF(control_stack),run,NULL,NULL,NULL,10,0,K_NO_WAIT);
}
void trace_controls_shutdown(void) {
    atomic_set(&stopped,1); atomic_clear(&settings);
    gpio_pin_set_dt(&motor,0);
}
