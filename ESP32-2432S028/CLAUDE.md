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

Same boot sequence, screens, and API logic as `ESP32-Waveshare/`. Hardware layer only differs.

### Hardware Configuration — ESP32-2432S028 (CYD)

| Peripheral | Pin | Notes |
|------------|-----|-------|
| Display MOSI | GPIO 13 | ILI9341, SPI @ 40 MHz |
| Display MISO | GPIO 12 | |
| Display SCLK | GPIO 14 | |
| Display CS | GPIO 15 | |
| Display DC | GPIO 2 | |
| Display RST | — | Not connected on CYD |
| Backlight | GPIO 21 | LEDC PWM |
| Touch CS | GPIO 33 | XPT2046, shared SPI bus |
| Touch IRQ | GPIO 36 | |

Display uses **ILI9341** driver — TFT_eSPI's built-in init is sufficient (no custom sequence needed).

Touch uses **XPT2046** (resistive) via TFT_eSPI's built-in `tft.getTouch()`. Calibration data set in setup().

Display runs in landscape rotation 3 (320×240 effective).

### Key Constants

```cpp
#define FW_VERSION      "2.8.2-CYD"
#define ACTIVE_INTERVAL 5
#define STANDBY_TIMEOUT 30
#define TFT_BL_PIN      21
```
