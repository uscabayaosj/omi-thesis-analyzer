#!/usr/bin/env python3
"""Compile the actual SD ioctl correction against deterministic card stubs."""
from pathlib import Path
import subprocess, tempfile
fixtures={'test.c': '#include <assert.h>\n#include <errno.h>\n#include <stdio.h>\n#include <zephyr/sd/sdmmc.h>\n#include <zephyr/drivers/disk.h>\nint card_ioctl(struct sd_card*,uint8_t,void*);\nstatic int lock_result, sync_result, locks, unlocks, waits;\nint k_mutex_lock(struct k_mutex *m,int t){locks++;return lock_result;}\nint k_mutex_unlock(struct k_mutex *m){unlocks++;return 0;}\nint sdmmc_wait_ready(struct sd_card *c){waits++;return sync_result;}\nint main(void){struct sd_card c={.block_count=4096,.block_size=512};uint32_t n=0;\nassert(card_ioctl(&c,DISK_IOCTL_CTRL_SYNC,0)==0);assert(waits==1 && unlocks==1);\nsync_result=-EIO;assert(card_ioctl(&c,DISK_IOCTL_CTRL_SYNC,0)==-EIO);assert(waits==2 && unlocks==2);\nlock_result=-ETIMEDOUT;assert(card_ioctl(&c,DISK_IOCTL_CTRL_SYNC,0)==-ETIMEDOUT);assert(waits==2 && unlocks==2);lock_result=0;\nassert(card_ioctl(&c,DISK_IOCTL_GET_SECTOR_COUNT,&n)==0 && n==4096);\nassert(card_ioctl(&c,DISK_IOCTL_GET_SECTOR_SIZE,&n)==0 && n==512);\nassert(card_ioctl(&c,DISK_IOCTL_GET_ERASE_BLOCK_SZ,&n)==0 && n==512);\nassert(card_ioctl(&c,255,0)==-ENOTSUP);assert(unlocks==locks-1);puts("7 SD ioctl regression cases passed");}\n', 'zephyr/kernel.h': '#pragma once\n#include <stdint.h>\nstruct k_mutex { int marker; };\n#define K_MSEC(x) (x)\n#define CONFIG_SD_DATA_TIMEOUT 1000\nint k_mutex_lock(struct k_mutex*, int);\nint k_mutex_unlock(struct k_mutex*);\n', 'zephyr/sd/sdmmc.h': '#include <stdint.h>\n#include <zephyr/kernel.h>\nstruct sd_card {struct k_mutex lock; uint32_t block_count, block_size;};\n', 'zephyr/drivers/disk.h': '#define DISK_IOCTL_GET_SECTOR_COUNT 1\n#define DISK_IOCTL_GET_SECTOR_SIZE 2\n#define DISK_IOCTL_GET_ERASE_BLOCK_SZ 3\n#define DISK_IOCTL_CTRL_SYNC 4\n'}
with tempfile.TemporaryDirectory(prefix="trace-sd-sync-") as temporary:
 root=Path(temporary)
 for name,text in fixtures.items():
  path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text)
 source=Path(__file__).resolve().parents[1]/"src/trace_sd_sync.c"
 subprocess.run(["clang","-I",str(root),str(source),str(root/"test.c"),"-o",str(root/"test")],check=True)
 subprocess.run([str(root/"test")],check=True)
