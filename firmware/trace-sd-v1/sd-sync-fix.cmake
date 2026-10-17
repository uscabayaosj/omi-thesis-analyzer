# Rename only the bundled SDK definition, then link the corrected implementation.
# The installed Nordic SDK is left untouched. Calls from sdmmc.c resolve to ours.
if(NOT TARGET subsys__sd)
  message(FATAL_ERROR "TRACE SD sync fix requires the NCS SD subsystem target")
endif()
set_property(SOURCE ${ZEPHYR_BASE}/subsys/sd/sd_ops.c
  DIRECTORY ${ZEPHYR_BASE}/subsys/sd
  APPEND PROPERTY COMPILE_DEFINITIONS card_ioctl=trace_sdk_card_ioctl)
target_sources(app PRIVATE ${CMAKE_CURRENT_LIST_DIR}/src/trace_sd_sync.c)
