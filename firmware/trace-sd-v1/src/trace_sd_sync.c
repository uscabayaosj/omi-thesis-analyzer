/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2022,2024 NXP
 * Modified for TRACE: correct the SD sync ioctl fallthrough.
 * Project-local correction for NCS 2.7.0's SD ioctl fallthrough.
 * Keep the card mutex and readiness wait; return the actual sync result.
 */
#include <zephyr/drivers/disk.h>
#include <zephyr/sd/sdmmc.h>
#include <zephyr/kernel.h>
#include <errno.h>

int sdmmc_wait_ready(struct sd_card *card);

int card_ioctl(struct sd_card *card, uint8_t cmd, void *buf)
{
    int ret = k_mutex_lock(&card->lock, K_MSEC(CONFIG_SD_DATA_TIMEOUT));
    if (ret) return ret;
    switch (cmd) {
    case DISK_IOCTL_GET_SECTOR_COUNT:
        *(uint32_t *)buf = card->block_count; ret = 0; break;
    case DISK_IOCTL_GET_SECTOR_SIZE:
    case DISK_IOCTL_GET_ERASE_BLOCK_SZ:
        *(uint32_t *)buf = card->block_size; ret = 0; break;
    case DISK_IOCTL_CTRL_SYNC:
        ret = sdmmc_wait_ready(card); break;
    default:
        ret = -ENOTSUP; break;
    }
    k_mutex_unlock(&card->lock);
    return ret;
}
