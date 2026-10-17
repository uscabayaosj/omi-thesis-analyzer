/* TRACE SD v1: separate namespace, no legacy erase commands, no format. */
#include "trace_sd.h"
#include "mic.h"
#include "config.h"
#include <ff.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <zephyr/kernel.h>
#include <zephyr/fs/fs.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/storage/disk_access.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/random/random.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/sys/crc.h>
#include <zephyr/sys/atomic.h>
#include <zephyr/logging/log.h>
LOG_MODULE_REGISTER(trace_sd, CONFIG_LOG_DEFAULT_LEVEL);
#define ROOT "/SD:/TRACE01"
#define BLOCK 192
#define FRAME_COUNT 3000
struct frame { uint16_t length; uint32_t sequence; uint64_t uptime; uint8_t data[CODEC_OUTPUT_MAX_BYTES]; };
K_MSGQ_DEFINE(frames, sizeof(struct frame), 48, 4);
K_THREAD_STACK_DEFINE(sd_stack, 4096);
static struct k_thread sd_thread;
K_MUTEX_DEFINE(command_lock);
static FATFS fat;
static struct fs_mount_t mount = { .type=FS_FATFS, .fs_data=&fat, .mnt_point="/SD:", .flags=FS_MOUNT_FLAG_NO_FORMAT };
static const struct gpio_dt_spec enable = { .port=DEVICE_DT_GET(DT_NODELABEL(gpio0)), .pin=19 };
static atomic_t ready, link_up=ATOMIC_INIT(1), armed, intent, failed, drops, write_errors;
static atomic_t mount_error, mount_stage;
static int64_t clock_delta;
static uint64_t boot_id, file_id;
static uint32_t file_index, sequence, bytes, count, file_crc;
static struct fs_file_t writer;
static bool open_file;
static char active_path[64];
static uint8_t command[24], response[32+BLOCK+4];
static size_t response_length=36;
static bool command_pending;
static uint8_t read_snapshot[32+BLOCK+4];
static size_t read_length;
static atomic_t shutting_down;
K_SEM_DEFINE(shutdown_complete,0,1);
static uint32_t active_request;

bool trace_sd_recording(void) { return atomic_get(&ready) && atomic_get(&armed) && atomic_get(&intent) && !atomic_get(&link_up) && !atomic_get(&failed) && !atomic_get(&shutting_down); }
void trace_sd_link(bool connected) { atomic_set(&link_up, connected); }
void trace_sd_pause(bool paused) { atomic_set(&intent, !paused); }
void trace_sd_frame(const uint8_t *data, size_t length) {
    if (!trace_sd_recording()) return;
    struct frame f={.length=length,.sequence=sequence++,.uptime=k_uptime_get()};
    if (!length || length>sizeof(f.data)) { atomic_inc(&drops); return; }
    memcpy(f.data,data,length);
    if (k_msgq_put(&frames,&f,K_NO_WAIT)) atomic_inc(&drops);
}
static void path_for(char *path, uint64_t id, const char *extension) {
    snprintf(path,64,ROOT "/%08x%08x.%s",(unsigned)(id>>32),(unsigned)id,extension);
}
static int write_exact(const void *data, size_t length) {
    ssize_t n=fs_write(&writer,data,length);
    if (n!=(ssize_t)length) return n<0?n:-EIO;
    file_crc=crc32_ieee_update(file_crc,data,length);bytes+=length;return 0;
}
static void storage_failed(int error) {
    atomic_inc(&write_errors);atomic_set(&failed,1);atomic_clear(&intent);
    mic_set_capture_active(false);LOG_ERR("SD recording stopped: %d; partial retained",error);
}
static int close_file(void) {
    if (!open_file) return 0;
    if (atomic_get(&failed)) {fs_sync(&writer);fs_close(&writer);open_file=false;return -EIO;}
    uint8_t footer[24]={0};memcpy(footer,"TEND",4);
    sys_put_le32(count,footer+4);sys_put_le32(bytes,footer+8);sys_put_le32(file_crc,footer+12);
    sys_put_le32(atomic_get(&drops),footer+16);sys_put_le32(crc32_ieee(footer,20),footer+20);
    int err=fs_write(&writer,footer,24)==24?0:-EIO;
    if (!err) err=fs_sync(&writer);
    int closing=fs_close(&writer);open_file=false;
    if (!err) err=closing;
    if (!err) { char completed[64];path_for(completed,file_id,"trsd");err=fs_rename(active_path,completed); }
    if (err) storage_failed(err);
    return err;
}
static int append(const struct frame *f) {
    if (!open_file) {
        struct fs_dirent existing;int stat;char completed[64];unsigned attempts=0;
        do {
            if(++attempts>1024 || file_index==UINT32_MAX)return -EOVERFLOW;
            file_id=boot_id | ++file_index;path_for(active_path,file_id,"part");path_for(completed,file_id,"trsd");
            stat=fs_stat(active_path,&existing);
            if(stat && stat!=-ENOENT)return stat;
            if(stat==-ENOENT)stat=fs_stat(completed,&existing);
            if(stat && stat!=-ENOENT)return stat;
        } while(stat!=-ENOENT);
        fs_file_t_init(&writer);int err=fs_open(&writer,active_path,FS_O_CREATE|FS_O_WRITE);
        if (err) return err;
        open_file=true;count=0;bytes=0;file_crc=0;
        uint8_t header[32]={0};memcpy(header,"TRSD",4);header[4]=1;header[5]=CODEC_ID;sys_put_le16(32,header+6);
        sys_put_le64(file_id,header+8);sys_put_le64(f->uptime+clock_delta,header+16);sys_put_le32((uint32_t)f->uptime,header+24);
        sys_put_le32(crc32_ieee(header,28),header+28);err=write_exact(header,32);if(err)return err;
    }
    uint8_t record[12+CODEC_OUTPUT_MAX_BYTES];sys_put_le16(f->length,record);sys_put_le16(10,record+2);sys_put_le32(f->sequence,record+4);
    uint32_t crc=crc32_ieee(record,8);crc=crc32_ieee_update(crc,f->data,f->length);sys_put_le32(crc,record+8);memcpy(record+12,f->data,f->length);
    int err=write_exact(record,12+f->length);if(err)return err;
    count++;
    if (count%100==0) {err=fs_sync(&writer);if(err)return err;}
    return count==FRAME_COUNT?close_file():0;
}
static int mount_card(void) {
    atomic_set(&mount_stage,1);
    if (!gpio_is_ready_dt(&enable)) return -ENODEV;
    int err=gpio_pin_configure_dt(&enable,GPIO_OUTPUT_ACTIVE);if(err)return err;
    /* The switched card supply must settle before its first SPI command. */
    k_msleep(100);
    atomic_set(&mount_stage,2);
    for (unsigned attempt=0;attempt<3;attempt++) {
        err=disk_access_init("SD");if(!err)break;
        k_msleep(1000);
    }
    if(err)return err;
    atomic_set(&mount_stage,3);
    err=fs_mount(&mount);if(err)return err;
    atomic_set(&mount_stage,4);
    err=fs_mkdir(ROOT);if(err && err!=-EEXIST)return err;
    atomic_set(&mount_stage,5);return 0;
}
static uint64_t next_file(uint64_t after, uint32_t *size, bool *partial) {
    struct fs_dir_t dir;fs_dir_t_init(&dir);if(fs_opendir(&dir,ROOT))return 0;
    struct fs_dirent e;uint64_t best=UINT64_MAX;
    while(!fs_readdir(&dir,&e) && e.name[0]) {
        unsigned hi,lo;char suffix[8]={0};int used=0;
        if(e.type!=FS_DIR_ENTRY_FILE || sscanf(e.name,"%8x%8x.%7s%n",&hi,&lo,suffix,&used)!=3 || used!=(int)strlen(e.name) || strlen(e.name)<21)continue;
        if(strcmp(suffix,"trsd") && strcmp(suffix,"part"))continue;
        uint64_t id=((uint64_t)hi<<32)|lo;
        if(open_file && id==file_id)continue;
        if(id>after && id<best) {best=id;*size=e.size;*partial=!strcmp(suffix,"part");}
    }
    fs_closedir(&dir);return best==UINT64_MAX?0:best;
}
static void process_command(void) {
    uint8_t req[24],out[32+BLOCK+4]={0};
    k_mutex_lock(&command_lock,K_FOREVER);memcpy(req,command,24);k_mutex_unlock(&command_lock);
    uint8_t op=req[5],status=0;uint64_t id=sys_get_le64(req+12);uint32_t offset=sys_get_le32(req+20),total=0;uint16_t length=0;bool partial=false;
    memcpy(out,"TSRP",4);out[4]=1;out[5]=op;memcpy(out+8,req+8,4);
    if(op==0) {
        out[32]=atomic_get(&ready);out[33]=trace_sd_recording();out[34]=atomic_get(&armed);out[35]=atomic_get(&failed);
        sys_put_le32(atomic_get(&drops),out+36);sys_put_le32(atomic_get(&write_errors),out+40);length=12;
    } else if(op==5) {
        sys_put_le32((uint32_t)atomic_get(&mount_error),out+32);
        sys_put_le32((uint32_t)atomic_get(&mount_stage),out+36);
        sys_put_le32(k_msgq_num_used_get(&frames),out+40);length=12;
    } else if(op==4) {
        if(id<1577836800000ULL || id>4102444800000ULL || offset>1)status=4;
        else { clock_delta=(int64_t)id-k_uptime_get();atomic_set(&armed,offset);if(!offset && !atomic_get(&link_up)){atomic_clear(&intent);mic_set_capture_active(false);} }
    } else if(!atomic_get(&ready)) status=2;
    else if(trace_sd_recording() || open_file || k_msgq_num_used_get(&frames)) status=5;
    else if(op==1) {
        id=next_file(id,&total,&partial);if(!id)status=3;
    } else if(op==2) {
        char path[64];path_for(path,id,"trsd");struct fs_dirent e;int err=fs_stat(path,&e);
        if(err==-ENOENT){path_for(path,id,"part");err=fs_stat(path,&e);partial=true;}
        if(err || e.type!=FS_DIR_ENTRY_FILE)status=2;
        else { total=e.size;if(offset>total)status=4;
            else {struct fs_file_t file;fs_file_t_init(&file);err=fs_open(&file,path,FS_O_READ);
                if(!err){err=fs_seek(&file,offset,FS_SEEK_SET);if(!err){ssize_t n=fs_read(&file,out+32,MIN(BLOCK,total-offset));if(n<0)err=n;else length=n;}fs_close(&file);}
                if(err)status=2;
            }
        }
    } else status=4;
    out[6]=status;out[7]=partial;sys_put_le64(id,out+12);sys_put_le32(offset,out+20);sys_put_le32(total,out+24);sys_put_le16(length,out+28);
    sys_put_le32(crc32_ieee(out,32+length),out+32+length);
    k_mutex_lock(&command_lock,K_FOREVER);memcpy(response,out,36+length);response_length=36+length;command_pending=false;k_mutex_unlock(&command_lock);
}
static ssize_t read_response(struct bt_conn *conn,const struct bt_gatt_attr *attr,void *buf,uint16_t len,uint16_t offset) {
    k_mutex_lock(&command_lock,K_FOREVER);
    if (!offset) {memcpy(read_snapshot,response,response_length);read_length=response_length;}
    ssize_t n=bt_gatt_attr_read(conn,attr,buf,len,offset,read_snapshot,read_length);k_mutex_unlock(&command_lock);return n;
}
static ssize_t request(struct bt_conn *conn,const struct bt_gatt_attr *attr,const void *buf,uint16_t len,uint16_t offset,uint8_t flags) {
    const uint8_t *p=buf;
    if(offset || len!=24 || (flags&BT_GATT_WRITE_FLAG_PREPARE))return BT_GATT_ERR(BT_ATT_ERR_INVALID_ATTRIBUTE_LEN);
    if(memcmp(p,"TSRQ",4) || p[4]!=1 || p[6] || p[7] || p[5]>5 || p[5]==3)return BT_GATT_ERR(BT_ATT_ERR_VALUE_NOT_ALLOWED);
    k_mutex_lock(&command_lock,K_FOREVER);
    if(command_pending) {k_mutex_unlock(&command_lock);return BT_GATT_ERR(BT_ATT_ERR_UNLIKELY);}
    memcpy(command,p,24);command_pending=true;active_request=sys_get_le32(p+8);
    memset(response,0,36);memcpy(response,"TSRP",4);response[4]=1;response[5]=p[5];response[6]=1;sys_put_le32(active_request,response+8);sys_put_le32(crc32_ieee(response,32),response+32);response_length=36;
    k_mutex_unlock(&command_lock);return len;
}
static struct bt_uuid_128 service_uuid=BT_UUID_INIT_128(BT_UUID_128_ENCODE(0xA71D0000,0x6B8D,0x4E75,0xA1B2,0x7D0E6F545243));
static struct bt_uuid_128 command_uuid=BT_UUID_INIT_128(BT_UUID_128_ENCODE(0xA71D0001,0x6B8D,0x4E75,0xA1B2,0x7D0E6F545243));
static struct bt_uuid_128 response_uuid=BT_UUID_INIT_128(BT_UUID_128_ENCODE(0xA71D0002,0x6B8D,0x4E75,0xA1B2,0x7D0E6F545243));
static struct bt_gatt_attr attrs[]={BT_GATT_PRIMARY_SERVICE(&service_uuid),BT_GATT_CHARACTERISTIC(&command_uuid.uuid,BT_GATT_CHRC_WRITE,BT_GATT_PERM_WRITE,NULL,request,NULL),BT_GATT_CHARACTERISTIC(&response_uuid.uuid,BT_GATT_CHRC_READ,BT_GATT_PERM_READ,read_response,NULL,NULL)};
static struct bt_gatt_service service=BT_GATT_SERVICE(attrs);
static void worker(void *a,void *b,void *c) {
    int err=mount_card();atomic_set(&mount_error,err);atomic_set(&ready,!err);LOG_INF("SD mount without formatting: %d",err);
    while(1) {
        struct frame f;int got=k_msgq_get(&frames,&f,K_MSEC(20));
        if(!got && !atomic_get(&failed)){err=append(&f);if(err)storage_failed(err);}
        if(open_file && !trace_sd_recording() && !k_msgq_num_used_get(&frames))close_file();
        k_mutex_lock(&command_lock,K_FOREVER);bool pending=command_pending;k_mutex_unlock(&command_lock);
        if(pending)process_command();
        if(atomic_get(&shutting_down) && !open_file && !k_msgq_num_used_get(&frames))k_sem_give(&shutdown_complete);
    }
}
int trace_sd_start(void) {
    boot_id=((uint64_t)sys_rand32_get())<<32;fs_file_t_init(&writer);
    int err=bt_gatt_service_register(&service);if(err)return err;
    k_thread_create(&sd_thread,sd_stack,K_THREAD_STACK_SIZEOF(sd_stack),worker,NULL,NULL,NULL,K_PRIO_PREEMPT(8),0,K_NO_WAIT);return 0;
}

void trace_sd_shutdown(void) {
    atomic_set(&shutting_down,1);atomic_clear(&intent);atomic_clear(&armed);mic_set_capture_active(false);
    if(k_sem_take(&shutdown_complete,K_SECONDS(2)))LOG_WRN("SD shutdown timeout; interrupted file retained");
}
