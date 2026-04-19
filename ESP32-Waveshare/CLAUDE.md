# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ESP32 firmware for the **Waveshare ESP32-S3-Touch-LCD-2.8** board that functions as a cryptocurrency trading dashboard. It fetches data from a backend Trading Journal API and displays metrics on a 240×320 ST7789T3 touchscreen.

## Build System

This is a **PlatformIO** project (Arduino framework, **ESP32 Arduino core 2.0.11**). There is no npm, Makefile, or test framework.

```bash
# Compile firmware
pio run -e esp32dev

# Compile & upload — FIRST TIME or after fresh boot (auto-reset works):
pio run -e esp32dev --target upload

# Upload after Light Sleep (USB CDC breaks auto-reset after first sleep cycle):
# 1. Hold BOOT button on device
# 2. Press & release RESET
# 3. Release BOOT
# 4. Run:
pio run -e esp32dev && python3 ~/.platformio/packages/tool-esptoolpy@1.40501.0/esptool.py \
  --chip esp32s3 --port /dev/ttyACM0 --baud 921600 --before no_reset \
  write_flash -z --flash_mode dio --flash_freq 80m --flash_size detect \
  0x0 .pio/build/esp32dev/bootloader.bin \
  0x8000 .pio/build/esp32dev/partitions.bin \
  0x10000 .pio/build/esp32dev/firmware.bin

# Open serial monitor (115200 baud)
pio device monitor -p /dev/ttyACM0 --baud 115200
```

**CRITICAL:** The platform is pinned to `espressif32@6.5.0` (= Arduino ESP32 core 2.0.11).
Waveshare explicitly warns: higher core versions cause display failure.

There are no unit tests — validation is done on hardware via serial output.

## Architecture

All application logic lives in a **single file**: `src/main.cpp`.

### Boot Sequence

1. **First boot / no config**: Device starts a WiFi AP (`TradingJournal-Setup` at `192.168.4.1`) and serves a web portal for configuration (WiFi credentials, API host/port/key).
2. **Normal boot**: Loads config from NVS flash (via `Preferences`), connects to WiFi, fetches data, enters the main loop.

### Main Loop (loop())

- Handles HTTP requests from the setup web portal
- Processes touch input (CST328 via I2C) → screen navigation & filter selection
- Every 5 seconds: calls `fetchData()` → HTTP GET → parses JSON → redraws screen
- Standby: 30s without touch → backlight off; touch → wake up & refresh

### Three Screens

| Screen | Function | Content |
|--------|----------|---------|
| 0 – Dashboard | `drawScreen1()` | Balance, P&L, volume, 3 donut charts (Win Rate, Satisfaction, RRR) |
| 1 – Open Positions | `drawScreen2()` | Table of open futures positions (max 7 rows) |
| 2 – Time Filter | `drawScreen3()` | Month / Week / Year / All buttons; triggers data refresh on change |

### Key Data Structures (main.cpp)

```cpp
struct Position { String symbol, side; float leverage, entryPrice, markPrice, qty, unrealizedPNL; };
struct TradeData { float todayPnL, totalPnL, winRate, satisfaction, rrr, balance, balancePerf;
                   long volume30d, volumeTotal; bool valid, hasBalance; vector<Position> positions; };
```

### Backend API

- Endpoint: `GET http://<host>:<port>/api/esp32/display?filter=<period>`
- Response: JSON with `todayPnL`, `totalPnL`, `winRate`, `satisfaction`, `rrr`, `balance`, `openPositions[]`, etc.
- API key is sent as custom HTTP header `X-ESP32-Key`.

### Hardware Configuration — Waveshare ESP32-S3-Touch-LCD-2.8

**IMPORTANT:** Platform must be `espressif32@6.5.0` (Arduino core 2.0.11). Newer versions break display.

| Peripheral | Pin | Notes |
|------------|-----|-------|
| Display MOSI | GPIO 45 | ST7789T3, SPI @ 40 MHz |
| Display SCLK | GPIO 40 | |
| Display CS | GPIO 42 | |
| Display DC | GPIO 41 | |
| Display RST | GPIO 39 | |
| Backlight | GPIO 5 | LEDC PWM (ledcSetup/ledcAttachPin), 20kHz |
| Touch SDA | GPIO 1 | CST328, Wire1, I2C @ 400kHz |
| Touch SCL | GPIO 3 | I2C address 0x1A |
| Touch RST | GPIO 2 | |
| Touch INT | GPIO 4 | |

Display uses **ST7789T3** driver with custom Waveshare init sequence (`waveshareInitST7789()` in main.cpp) — TFT_eSPI's built-in ST7789 init alone is not sufficient.

Touch uses **CST328** (not FT6336G!) with 16-bit register addresses. Uses `Wire1` (second I2C bus).

Backlight requires LEDC PWM (`ledcSetup`+`ledcAttachPin`) — simple `digitalWrite` does not work.

Display runs in landscape rotation 3 (320×240 effective).

### Important Constants (top of main.cpp)

```cpp
#define FW_VERSION      "2.8.2"
#define ACTIVE_INTERVAL 5        // seconds between API fetches when active
#define STANDBY_TIMEOUT 30       // seconds without touch → backlight off
#define WIFI_TIMEOUT_MS 12000
#define AP_SSID         "TradingJournal-Setup"
#define TFT_BL_PIN      5
```

## Libraries

- **TFT_eSPI** (`bodmer/TFT_eSPI ^2.5.43`) – display driver; configured via `User_Setup.h` and `platformio.ini` build flags. ST7789_DRIVER.
- **ArduinoJson** (`bblanchon/ArduinoJson ^7.0.0`) – JSON parsing (v7 API: `JsonDocument`)
- Built-in Arduino/ESP32 libraries: `WiFi`, `WebServer`, `HTTPClient`, `Preferences`, `Wire`
