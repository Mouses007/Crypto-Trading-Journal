# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ESP32 firmware for the **ESP32-2432S028 (CYD — Cheap Yellow Display)** board that functions as a cryptocurrency trading dashboard. It fetches data from a backend Trading Journal API and displays metrics on a 240×320 ILI9341 touchscreen.

## Build System

This is a **PlatformIO** project (Arduino framework, ESP32). There is no npm, Makefile, or test framework.

```bash
# Compile firmware
pio run -e esp32dev

# Compile & upload to device (requires /dev/ttyUSB0)
pio run -e esp32dev --target upload

# Open serial monitor (115200 baud)
pio device monitor -p /dev/ttyUSB0 --baud 115200
```

There are no unit tests — validation is done on hardware via serial output.

## Architecture

All application logic lives in a **single file**: `src/main.cpp`.

Same boot sequence, screens, and API logic as `ESP32-Waveshare/`. Hardware layer differs.

### Hardware Configuration — ESP32-2432S028 (CYD)

**IMPORTANT:** Display + Touch run on **separate SPI buses** on the CYD. Touch uses HSPI with the `XPT2046_Touchscreen` library by Paul Stoffregen. Display uses the default VSPI bus through TFT_eSPI.

The Micro-USB CYD variant requires `ILI9341_2_DRIVER` plus `tft.invertDisplay(1)` after `setRotation()` — without this the colors are inverted.

| Peripheral | Pin | Notes |
|------------|-----|-------|
| Display MOSI | GPIO 13 | ILI9341, VSPI @ 40 MHz |
| Display MISO | GPIO 12 | |
| Display SCLK | GPIO 14 | |
| Display CS | GPIO 15 | |
| Display DC | GPIO 2 | |
| Display RST | — | Not connected on CYD |
| Backlight | GPIO 21 | LEDC PWM (Channel 0, 20kHz) |
| Touch MOSI | GPIO 32 | XPT2046, separate HSPI bus |
| Touch MISO | GPIO 39 | |
| Touch SCLK | GPIO 25 | |
| Touch CS | GPIO 33 | |
| Touch IRQ (PENIRQ) | GPIO 36 | RTC GPIO — used for Light Sleep wakeup |

Display runs in landscape rotation 3 (320×240 effective).

### Power Management — Two-Stage Sleep

1. **Stage 1 (Standby)** — 30s without touch → backlight off, MCU still running, polls touch.
2. **Stage 2 (Light Sleep)** — 60s without touch (after `BOOT_GRACE_MS` boot grace period) → WiFi off, `esp_light_sleep_start()`. Wakes on PENIRQ low (GPIO 36) or 30 min timer. `gpio_hold_en/dis` keeps backlight off across sleep.
3. **Boot Grace**: First 5 minutes after boot no Light Sleep — so flashing always works without BOOT/RESET dance.

### Filter (Server-Controlled)

Filter (`month`/`week`/`year`/`all`) is **set in the Journal Web UI**, not on the device. The device receives the active filter via the `filter` field in the JSON response and syncs `cfgFilter` accordingly. Screen 3 is now an info/status screen (no buttons) — tap returns to Dashboard.

### Key Constants

```cpp
#define FW_VERSION          "3.3.0-CYD"
#define ACTIVE_INTERVAL     10        // seconds between API fetches when active
#define STANDBY_TIMEOUT     30        // seconds without touch → backlight off
#define LIGHT_SLEEP_TIMEOUT 60        // seconds without touch → light sleep + WiFi off
#define BOOT_GRACE_MS       300000    // 5 min after boot: no light sleep
#define WIFI_TIMEOUT_MS     12000
#define TFT_BL_PIN          21
#define TOUCH_MOSI 32
#define TOUCH_MISO 39
#define TOUCH_SCK  25
#define TOUCH_CS_PIN  33
#define TOUCH_IRQ_PIN 36
```

## Libraries

- **TFT_eSPI** (`bodmer/TFT_eSPI ^2.5.43`) — display driver via build flags. `ILI9341_2_DRIVER`.
- **XPT2046_Touchscreen** (Paul Stoffregen, GitHub URL) — resistive touch on HSPI.
- **ArduinoJson** (`bblanchon/ArduinoJson ^7.0.0`) — JSON parsing (v7 API).
- Built-in: `WiFi`, `WebServer`, `HTTPClient`, `Preferences`, `SPI`, `esp_sleep`, `driver/gpio`.
