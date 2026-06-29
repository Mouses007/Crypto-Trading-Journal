#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TFT_eSPI.h>
#include <vector>
#include "esp_sleep.h"
#include "driver/gpio.h"

// ── Touch I2C — Waveshare ESP32-S3-Touch-LCD-2.8 (CST328) ─
#define TOUCH_SDA  1
#define TOUCH_SCL  3
#define TOUCH_RST  2
#define TOUCH_INT  4

// ── Konstanten ───────────────────────────────────────────

#define AP_SSID            "TradingJournal-Setup"
#define ACTIVE_INTERVAL    10        // Sekunden zwischen Updates wenn aktiv
#define STANDBY_TIMEOUT    30        // Sekunden ohne Touch → Backlight aus
#define LIGHT_SLEEP_TIMEOUT 60       // Sekunden ohne Touch → Light Sleep + WiFi aus
#define BOOT_GRACE_MS    300000      // 5 Min nach Boot kein Light Sleep (für Flash-Vorgang)
#define PREF_NAMESPACE     "tjcfg"
#define WIFI_TIMEOUT_MS    12000
#define DISPLAY_ROTATION   3
#define TFT_BL_PIN         5         // Backlight-Pin Waveshare ESP32-S3-Touch-LCD-2.8
#define FW_VERSION         "3.3.0-WS"

// ── Farben RGB565 — Journal-Farbschema ──────────────────
// Aus src/assets/style-dark.css konvertiert
#define COLOR_BG         0x0000   // #000000  --black-bg-0
#define COLOR_CARD       0x0000   // Schwarz — Display-Gamma macht Grau lila, daher transparent
#define COLOR_GREEN      0x064E   // #00CA73  .greenTrade
#define COLOR_RED        0xFB4C   // #FF6960  .redTrade
#define COLOR_WHITE      0xFFFF   // #FFFFFF
#define COLOR_WHITE_DIM  0x9CF3   // ~#999999 Sekundärtext
#define COLOR_GREY       0x6BAF   // #6c757d  --grey-color
#define COLOR_GREY_DARK  0x2945   // #292929  Trennlinien / Kartenrand
#define COLOR_YELLOW     0xFE00   // #FFC107  .neutralTrade
#define COLOR_BLUE       0x05BF   // #01B4FF  --blue-color
#define COLOR_BLUE_NAV   0x2D1B   // #2ea2d9  --blue-active-color
#define COLOR_NAV_BG     0x0841   // #080808  Nav-Hintergrund
#define COLOR_HEADER_BG  0x0841   // #080808  Header-Hintergrund

// ── Globals ──────────────────────────────────────────────

TFT_eSPI  tft;
WebServer server(80);
Preferences prefs;

String cfgSSID, cfgPass, cfgHost, cfgPort, cfgKey;
String cfgFilter = "month";       // "month", "week", "year", "all"
bool   configMode  = false;
int    activeScreen = 0;          // 0 = Dashboard, 1 = Positionen, 2 = Filter
unsigned long lastUpdate    = 0;
unsigned long lastTouchTime = 0;
bool          inStandby     = false;

void setBacklight(bool on) {
  ledcWrite(0, on ? 800 : 0);
}

void backlightInit() {
  ledcSetup(0, 20000, 10);
  ledcAttachPin(TFT_BL_PIN, 0);
  ledcWrite(0, 800);
}

// ── Light Sleep mit WiFi aus, Wakeup über Touch-INT (GPIO 4) oder Timer ──
// Blockiert bis Touch oder 30 Min Timer. CST328 INT ist active-low.
void enterLightSleep() {
  Serial.println("[PWR] Light Sleep — WiFi aus, Wakeup via Touch oder 30min Timer");
  Serial.flush();

  // Backlight aus + Pin festhalten, damit er während Sleep nicht flackert
  setBacklight(false);
  gpio_hold_en((gpio_num_t)TFT_BL_PIN);

  // WiFi komplett runterfahren
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);

  // Touch INT (GPIO 4) als Wake-Quelle — gpio_wakeup ist der korrekte API für Light Sleep
  pinMode(TOUCH_INT, INPUT_PULLUP);
  gpio_wakeup_enable((gpio_num_t)TOUCH_INT, GPIO_INTR_LOW_LEVEL);
  esp_sleep_enable_gpio_wakeup();

  // Safety-Net: alle 30 Min auf jeden Fall aufwachen für Datenrefresh
  esp_sleep_enable_timer_wakeup(30ULL * 60ULL * 1000000ULL);  // 30 Min in µs

  // BLOCKIERT bis Wakeup
  esp_light_sleep_start();

  // ── Wake-Up ─────────────────────────────────────────
  esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
  gpio_hold_dis((gpio_num_t)TFT_BL_PIN);
  Serial.printf("[PWR] Wake from Light Sleep — cause=%d (2=GPIO, 4=Timer)\n", cause);

  // WiFi wieder an
  WiFi.mode(WIFI_STA);
  WiFi.begin(cfgSSID.c_str(), cfgPass.c_str());
}

// ── Datenstrukturen ──────────────────────────────────────

struct Position {
  String symbol;
  String side;
  float  leverage;
  float  entryPrice;
  float  markPrice;
  float  qty;
  float  unrealizedPNL;
  float  realizedPNL;
};

// Laufender Pionex-Bot. PnL/Marge in marginCoin (z.B. SOL bei Coin-M), nicht zwingend USDT.
struct Bot {
  String symbol;
  String side;
  String marginCoin;
  float  leverage;
  float  entryPrice;
  float  markPrice;
  float  unrealizedPNL;
  float  liqPrice;
  bool   coinM;
};

struct TradeData {
  float todayPnL    = 0;
  int   todayTrades = 0;
  int   todayWins   = 0;
  int   todayLosses = 0;
  float totalPnL    = 0;
  float winRate     = 0;
  float satisfaction= 0;
  float rrr         = 0;
  float balance     = 0;
  float balancePerf = 0;
  bool  hasBalance  = false;
  long  volume30d   = 0;
  long  volumeTotal = 0;
  bool  valid       = false;
  std::vector<Position> positions;
  std::vector<Bot> bots;
};
TradeData data;

// ── Config ───────────────────────────────────────────────

void loadConfig() {
  prefs.begin(PREF_NAMESPACE, true);
  cfgSSID   = prefs.getString("ssid",   "");
  cfgPass   = prefs.getString("pass",   "");
  cfgHost   = prefs.getString("host",   "192.168.178.100");
  cfgPort   = prefs.getString("port",   "8080");
  cfgKey    = prefs.getString("key",    "");
  // Filter kommt vom Server — nicht aus NVS laden
  cfgFilter = "month";
  prefs.end();
}

void saveFilter() {
  // Filter wird vom Server gesteuert, kein lokales Speichern nötig
}

void saveConfig(String ssid, String pass, String host, String port, String key) {
  prefs.begin(PREF_NAMESPACE, false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.putString("host", host);
  prefs.putString("port", port);
  prefs.putString("key",  key);
  prefs.end();
}

void clearConfig() {
  prefs.begin(PREF_NAMESPACE, false);
  prefs.clear();
  prefs.end();
}

// ── Touch (CST328 direkt via I2C) — Waveshare ESP32-S3-Touch-LCD-2.8 ────
// CST328 I2C Adresse: 0x1A  — verwendet Wire1 (SDA=1, SCL=3)
// 16-bit Registeradressen (MSB first)
// 0xD005 = Anzahl Touch-Punkte
// 0xD000 = XY-Daten (Portrait: x=0..239, y=0..319)
// Display läuft in Rotation 3 (Landscape 320×240):
//   screen_x = raw_y         (0..319)
//   screen_y = 239 - raw_x   (0..239)

#define CST328_ADDR       0x1A
#define CST328_REG_NUM    0xD005
#define CST328_REG_XY     0xD000

static bool cst328Read(uint16_t reg, uint8_t* buf, uint8_t len) {
  Wire1.beginTransmission(CST328_ADDR);
  Wire1.write((uint8_t)(reg >> 8));
  Wire1.write((uint8_t)(reg & 0xFF));
  if (Wire1.endTransmission(true) != 0) return false;
  Wire1.requestFrom((uint8_t)CST328_ADDR, len);
  for (uint8_t i = 0; i < len; i++) {
    if (!Wire1.available()) return false;
    buf[i] = Wire1.read();
  }
  return true;
}

static void cst328ClearFlag() {
  uint8_t clear = 0;
  Wire1.beginTransmission(CST328_ADDR);
  Wire1.write((uint8_t)(CST328_REG_NUM >> 8));
  Wire1.write((uint8_t)(CST328_REG_NUM & 0xFF));
  Wire1.write(clear);
  Wire1.endTransmission(true);
}

bool mapTouch(int* screenX, int* screenY) {
  uint8_t nbuf[1];
  if (!cst328Read(CST328_REG_NUM, nbuf, 1)) return false;
  uint8_t n = nbuf[0] & 0x0F;
  if (n == 0) return false;

  uint8_t xy[27] = {};
  if (!cst328Read(CST328_REG_XY, xy, 27)) { cst328ClearFlag(); return false; }
  cst328ClearFlag();

  // Ersten Touch-Punkt dekodieren (12-bit Koordinaten)
  // xy[1]=x_high, xy[2]=y_high, xy[3]=xy_low (für i=0, num=0)
  uint16_t raw_x = ((uint16_t)xy[1] << 4) | ((xy[3] & 0xF0) >> 4);
  uint16_t raw_y = ((uint16_t)xy[2] << 4) |  (xy[3] & 0x0F);

  Serial.printf("[Touch] n=%d raw_x=%d raw_y=%d\n", n, raw_x, raw_y);

  // Portrait → Landscape Rotation 3 Mapping (ermittelt per Debug)
  // Drücken unten-links (x≈50,y≈220) → raw_x=224, raw_y=262
  // → screenX = 319 - raw_y, screenY = raw_x
  *screenX = constrain(319 - (int)raw_y, 0, 319);
  *screenY = constrain((int)raw_x,       0, 239);
  return true;
}

// CST328 initialisieren: Reset + Normal-Mode aktivieren
// Ohne diesen Befehl bleibt der Chip im Debug-Modus und meldet keine Touches!
void cst328Init() {
  Wire1.begin(TOUCH_SDA, TOUCH_SCL, 400000);
  pinMode(TOUCH_INT, INPUT);
  pinMode(TOUCH_RST, OUTPUT);
  // Reset-Sequenz
  digitalWrite(TOUCH_RST, HIGH); delay(50);
  digitalWrite(TOUCH_RST, LOW);  delay(5);
  digitalWrite(TOUCH_RST, HIGH); delay(50);
  // Normal-Mode aktivieren (0xD109 = HYN_REG_MUT_NORMAL_MODE)
  Wire1.beginTransmission(CST328_ADDR);
  Wire1.write(0xD1);
  Wire1.write(0x09);
  Wire1.endTransmission(true);
  delay(10);
}

void loadTouchCal() {}  // Keine Kalibrierung nötig (kapazitiv)

// ── Waveshare ST7789T3 Custom Init ───────────────────────
// Exakt aus dem offiziellen Waveshare Demo (Display_ST7789.cpp)
void waveshareInitST7789() {
  tft.startWrite();         // SPI-Bus öffnen (CS low, Transaktion starten)

  tft.writecommand(0x01);   // Software Reset
  tft.endWrite(); delay(120); tft.startWrite();

  tft.writecommand(0x11);   // Sleep Out
  tft.endWrite(); delay(120); tft.startWrite();

  tft.writecommand(0x36);   // MADCTL
  tft.writedata(0x00);

  tft.writecommand(0x3A);   // COLMOD 16-bit
  tft.writedata(0x05);

  tft.writecommand(0xB0);
  tft.writedata(0x00);
  tft.writedata(0xE8);

  tft.writecommand(0xB2);
  tft.writedata(0x0C); tft.writedata(0x0C); tft.writedata(0x00);
  tft.writedata(0x33); tft.writedata(0x33);

  tft.writecommand(0xB7);
  tft.writedata(0x75);

  tft.writecommand(0xBB);
  tft.writedata(0x1A);

  tft.writecommand(0xC0);
  tft.writedata(0x2C);

  tft.writecommand(0xC2);
  tft.writedata(0x01); tft.writedata(0xFF);

  tft.writecommand(0xC3);
  tft.writedata(0x13);

  tft.writecommand(0xC4);
  tft.writedata(0x20);

  tft.writecommand(0xC6);
  tft.writedata(0x0F);

  tft.writecommand(0xD0);
  tft.writedata(0xA4); tft.writedata(0xA1);

  tft.writecommand(0xD6);
  tft.writedata(0xA1);

  tft.writecommand(0xE0);   // Gamma+
  tft.writedata(0xD0); tft.writedata(0x0D); tft.writedata(0x14);
  tft.writedata(0x0D); tft.writedata(0x0D); tft.writedata(0x09);
  tft.writedata(0x38); tft.writedata(0x44); tft.writedata(0x4E);
  tft.writedata(0x3A); tft.writedata(0x17); tft.writedata(0x18);
  tft.writedata(0x2F); tft.writedata(0x30);

  tft.writecommand(0xE1);   // Gamma-
  tft.writedata(0xD0); tft.writedata(0x09); tft.writedata(0x0F);
  tft.writedata(0x08); tft.writedata(0x07); tft.writedata(0x14);
  tft.writedata(0x37); tft.writedata(0x44); tft.writedata(0x4D);
  tft.writedata(0x38); tft.writedata(0x15); tft.writedata(0x16);
  tft.writedata(0x2C); tft.writedata(0x2E);

  tft.writecommand(0x21);   // Display Inversion ON (ST7789T3 braucht das)
  tft.writecommand(0x29);   // Display ON
  tft.endWrite();
  delay(50);
}

// ── Hilfsfunktionen Display ──────────────────────────────

String fmtMoney(float v, int dec = 2) {
  String s = (v >= 0 ? "+" : "") + String(v, dec);
  return s;
}

String fmtVol(long v) {
  if (v >= 1000000) return String(v / 1000000.0f, 1) + "M";
  if (v >= 1000)    return String(v / 1000.0f, 1) + "K";
  return String(v);
}

uint16_t pnlColor(float v) {
  return v >= 0 ? COLOR_GREEN : COLOR_RED;
}

void fillCard(int x, int y, int w, int h) {
  tft.fillRoundRect(x, y, w, h, 6, COLOR_CARD);
  tft.drawRoundRect(x, y, w, h, 6, COLOR_BLUE_NAV);
}

// ── Nav-Bar (Landscape: y=207, h=33, 3 Buttons je ~107px) ──
// Button 0: Dashboard  x=0..106
// Button 1: Positionen x=107..213
// Button 2: Filter     x=214..319

void drawNavBar() {
  const int ny = 207, nh = 33;

  tft.fillRect(0, ny, 320, nh, COLOR_NAV_BG);
  // Blauer Trennstrich oben (Journal-Stil)
  tft.drawFastHLine(0, ny, 320, COLOR_BLUE_NAV);
  tft.drawFastVLine(107, ny+1, nh-1, COLOR_GREY_DARK);
  tft.drawFastVLine(214, ny+1, nh-1, COLOR_GREY_DARK);
  tft.setTextSize(1);

  // Dashboard
  if (activeScreen == 0) {
    tft.fillRect(1, ny+1, 105, nh-1, 0x0C62);   // leicht blau-dunkel aktiv
    tft.drawFastHLine(1, ny, 105, COLOR_BLUE);    // blauer Indikator-Strich
  }
  tft.setTextColor(activeScreen == 0 ? COLOR_WHITE : COLOR_GREY,
                   activeScreen == 0 ? 0x0C62 : COLOR_NAV_BG);
  tft.setCursor(18, ny + 12);
  tft.print("Dashboard");

  // Positionen
  if (activeScreen == 1) {
    tft.fillRect(108, ny+1, 105, nh-1, 0x0C62);
    tft.drawFastHLine(108, ny, 105, COLOR_BLUE);
  }
  tft.setTextColor(activeScreen == 1 ? COLOR_WHITE : COLOR_GREY,
                   activeScreen == 1 ? 0x0C62 : COLOR_NAV_BG);
  tft.setCursor(118, ny + 12);
  tft.print("Positionen");

  // Info-Tab
  if (activeScreen == 2) {
    tft.fillRect(215, ny+1, 104, nh-1, 0x0C62);
    tft.drawFastHLine(215, ny, 104, COLOR_BLUE);
  }
  tft.setTextColor(activeScreen == 2 ? COLOR_WHITE : COLOR_YELLOW,
                   activeScreen == 2 ? 0x0C62 : COLOR_NAV_BG);
  tft.setCursor(251, ny + 12);
  tft.print("Info");

  // Offline-Indikator: kleiner roter Punkt rechts unten wenn keine Daten
  if (!data.valid) {
    tft.fillCircle(313, ny + 26, 4, COLOR_RED);
  }
}

// ── Donut-Chart ──────────────────────────────────────────

void drawDonut(int cx, int cy, int r, int ir, float pct, uint16_t color,
               const char* label, const char* valStr) {
  // Grauer Hintergrunds-Ring
  tft.drawSmoothArc(cx, cy, r, ir, 0, 360, COLOR_GREY_DARK, COLOR_BG, true);

  // Farbiger Fortschritts-Arc (0° = oben, gegen Uhrzeigersinn)
  float angle = constrain(pct / 100.0f * 360.0f, 0, 360);
  if (angle > 1.0f)
    tft.drawSmoothArc(cx, cy, r, ir, 0, angle, color, COLOR_BG, true);

  // Wert in der Mitte
  tft.setTextColor(COLOR_WHITE, COLOR_BG);
  tft.setTextSize(1);
  int vw = strlen(valStr) * 6;
  tft.setCursor(cx - vw / 2, cy - 4);
  tft.print(valStr);

  // Label darunter
  tft.setTextColor(COLOR_GREY, COLOR_BG);
  int lw = strlen(label) * 6;
  tft.setCursor(cx - lw / 2, cy + r + 4);
  tft.print(label);
}

// ── SCREEN 1: Dashboard (Landscape 320×207) ──────────────

void drawScreen1() {
  tft.fillRect(0, 0, 320, 207, COLOR_BG);

  // ── Offline-Banner wenn keine Daten ───────────────
  if (!data.valid) {
    tft.fillRoundRect(4, 2, 312, 20, 4, COLOR_GREY_DARK);
    tft.setTextColor(COLOR_RED, COLOR_GREY_DARK);
    tft.setTextSize(1);
    tft.setCursor(8, 8);
    tft.print("OFFLINE — API nicht erreichbar");
  }

  // ── Kontostand-Karte ──────────────────────────────
  int cardY = data.valid ? 2 : 26;
  int cardH = data.valid ? 62 : 38;
  fillCard(4, cardY, 312, cardH);

  // Label + Filter
  tft.setTextColor(COLOR_GREY, COLOR_CARD);
  tft.setTextSize(1);
  tft.setCursor(12, cardY + 7);
  tft.print(data.hasBalance ? "KONTOSTAND" : "P&L GESAMT");

  const char* fLbl = cfgFilter == "month" ? "Monat" :
                     cfgFilter == "week"  ? "Woche" :
                     cfgFilter == "year"  ? "Jahr"  : "Alle";
  tft.setTextColor(COLOR_YELLOW, COLOR_CARD);
  int fLblX = 304 - (int)strlen(fLbl) * 6;
  tft.setCursor(fLblX, cardY + 7);
  tft.print(fLbl);

  if (data.hasBalance) {
    String balStr = "$" + String(data.balance, 2);
    tft.setTextColor(pnlColor(data.balancePerf), COLOR_CARD);
    tft.setTextSize(2);
    tft.setCursor(12, cardY + 22);
    tft.print(balStr);
    tft.setTextSize(1);
    tft.setTextColor(COLOR_GREY, COLOR_CARD);
    tft.setCursor(12, cardY + 48);
    tft.print("Heute ");
    tft.setTextColor(COLOR_WHITE_DIM, COLOR_CARD);
    tft.print(String(data.todayTrades));
    tft.print(" T  ");
    tft.setTextColor(COLOR_GREEN, COLOR_CARD);
    tft.print(String(data.todayWins));
    tft.print("+ ");
    tft.setTextColor(COLOR_RED, COLOR_CARD);
    tft.print(String(data.todayLosses));
    tft.print("-  ");
    tft.setTextColor(pnlColor(data.todayPnL), COLOR_CARD);
    tft.print((data.todayPnL >= 0 ? "+" : "") + String(data.todayPnL, 2));
    String perfStr = (data.balancePerf >= 0 ? "+" : "") + String(data.balancePerf, 1) + "%";
    tft.setTextColor(pnlColor(data.balancePerf), COLOR_CARD);
    tft.setCursor(220, cardY + 48);
    tft.print("Perf " + perfStr);
  } else {
    String totStr = (data.totalPnL >= 0 ? "+" : "") + String(data.totalPnL, 2) + " USDT";
    tft.setTextColor(pnlColor(data.totalPnL), COLOR_CARD);
    tft.setTextSize(2);
    tft.setCursor(12, cardY + 22);
    tft.print(totStr);
    tft.setTextSize(1);
    tft.setTextColor(COLOR_GREY, COLOR_CARD);
    tft.setCursor(12, cardY + 48);
    tft.print("Heute ");
    tft.setTextColor(COLOR_WHITE_DIM, COLOR_CARD);
    tft.print(String(data.todayTrades));
    tft.print(" T  ");
    tft.setTextColor(COLOR_GREEN, COLOR_CARD);
    tft.print(String(data.todayWins));
    tft.print("+ ");
    tft.setTextColor(COLOR_RED, COLOR_CARD);
    tft.print(String(data.todayLosses));
    tft.print("-  ");
    tft.setTextColor(pnlColor(data.todayPnL), COLOR_CARD);
    tft.print((data.todayPnL >= 0 ? "+" : "") + String(data.todayPnL, 2));
  }

  // ── Volumen (kompakt, 2 Zeilen) ───────────────────
  int volY = cardY + cardH + 4;
  tft.drawFastHLine(0, volY, 320, COLOR_GREY_DARK);
  tft.setTextColor(COLOR_GREY, COLOR_BG);
  tft.setTextSize(1);
  tft.setCursor(8, volY + 5);
  tft.print("Vol 30d");
  String v30 = "$" + fmtVol(data.volume30d);
  tft.setTextColor(COLOR_WHITE_DIM, COLOR_BG);
  tft.setCursor(316 - (int)v30.length() * 6, volY + 5);
  tft.print(v30);

  tft.setTextColor(COLOR_GREY, COLOR_BG);
  tft.setCursor(8, volY + 17);
  tft.print("Vol Total");
  String vtot = "$" + fmtVol(data.volumeTotal);
  tft.setTextColor(COLOR_WHITE_DIM, COLOR_BG);
  tft.setCursor(316 - (int)vtot.length() * 6, volY + 17);
  tft.print(vtot);

  // ── Trennlinie vor Donuts ─────────────────────────
  int donutY = volY + 30;
  tft.drawFastHLine(0, donutY, 320, COLOR_GREY_DARK);

  // ── 3 Donuts ─────────────────────────────────────
  int cy = donutY + 46;
  const int r = 34, ir = 23;

  char wrStr[10];
  snprintf(wrStr, sizeof(wrStr), "%.0f%%", data.winRate);
  uint16_t wrCol = data.winRate >= 50 ? COLOR_GREEN : (data.winRate >= 40 ? COLOR_YELLOW : COLOR_RED);
  drawDonut(55, cy, r, ir, data.winRate, wrCol, "Win Rate", wrStr);

  char satStr[10];
  snprintf(satStr, sizeof(satStr), "%.0f%%", data.satisfaction);
  uint16_t satCol = data.satisfaction >= 50 ? COLOR_GREEN : (data.satisfaction >= 30 ? COLOR_YELLOW : COLOR_RED);
  drawDonut(160, cy, r, ir, data.satisfaction, satCol, "Zufried.", satStr);

  char rrrStr[12];
  snprintf(rrrStr, sizeof(rrrStr), "1:%.1f", data.rrr);
  float rrrPct = constrain(data.rrr / 3.0f * 100.0f, 0, 100);
  uint16_t rrrCol = data.rrr >= 1.5f ? COLOR_GREEN : (data.rrr >= 1.0f ? COLOR_YELLOW : COLOR_RED);
  drawDonut(265, cy, r, ir, rrrPct, rrrCol, "RRR", rrrStr);
}

// ── SCREEN 2: Offene Positionen (Landscape 320×207) ──────
// Spalten: Sym=70 | Side=30 | Heb=30 | Entry=52 | Mark=52 | PnL=68
// x-Offsets: 4      76       108      140       194       248

void drawScreen2() {
  tft.fillRect(0, 0, 320, 207, COLOR_BG);

  // ── Header ────────────────────────────────────────
  tft.fillRect(0, 0, 320, 24, COLOR_HEADER_BG);
  tft.drawFastHLine(0, 24, 320, COLOR_GREY_DARK);
  tft.setTextColor(COLOR_BLUE, COLOR_HEADER_BG);
  tft.setTextSize(1);
  tft.setCursor(8, 5);
  tft.print("Trading Journal");
  tft.setTextColor(COLOR_GREY, COLOR_HEADER_BG);
  tft.setCursor(8, 16);
  tft.print("Offene Positionen & Bots");

  int nFut = data.positions.size();
  int nBot = data.bots.size();

  if (nFut == 0 && nBot == 0) {
    tft.setTextColor(COLOR_GREY, COLOR_BG);
    tft.setCursor(8, 110);
    tft.print("Keine offenen Positionen");
    tft.setCursor(270, 193);
    tft.print("v" FW_VERSION);
    return;
  }

  // ── Tabellen-Header (y=28) ────────────────────────
  // Spalten: Symbol | Side | Heb. | PnL | real./Liq
  // x:       4       72     104    140    228
  tft.drawFastHLine(0, 28, 320, COLOR_GREY_DARK);
  tft.setTextColor(COLOR_GREY, COLOR_BG);
  tft.setTextSize(1);
  tft.setCursor(4,   32); tft.print("Symbol");
  tft.setCursor(72,  32); tft.print("Side");
  tft.setCursor(104, 32); tft.print("Heb.");
  tft.setCursor(140, 32); tft.print("PnL");
  tft.setCursor(228, 32); tft.print("real./Liq");
  tft.drawFastHLine(0, 44, 320, COLOR_GREY_DARK);

  // Row-Budget (7 Slots): bei Bots je max 3 Datenzeilen + 1 Label-Zeile.
  int futCap, botCap;
  if      (nBot == 0) { futCap = min(nFut, 7); botCap = 0; }
  else if (nFut == 0) { futCap = 0;            botCap = min(nBot, 7); }
  else                { futCap = min(nFut, 3); botCap = min(nBot, 3); }

  int y = 47;

  // ── Futures ───────────────────────────────────────
  for (int i = 0; i < futCap; i++) {
    auto& p = data.positions[i];

    tft.setTextColor(COLOR_WHITE, COLOR_BG);
    tft.setCursor(4, y);
    String sym = p.symbol;
    if (sym.endsWith("USDT")) sym = sym.substring(0, sym.length() - 4);
    if (sym.length() > 7) sym = sym.substring(0, 7);
    tft.print(sym);

    tft.setTextColor(p.side == "BUY" || p.side == "LONG" ? COLOR_GREEN : COLOR_RED, COLOR_BG);
    tft.setCursor(72, y);
    tft.print(p.side.substring(0, 4));

    tft.setTextColor(COLOR_WHITE, COLOR_BG);
    tft.setCursor(104, y);
    char hebStr[8];
    snprintf(hebStr, sizeof(hebStr), "%dx", (int)p.leverage);
    tft.print(hebStr);

    tft.setTextColor(pnlColor(p.unrealizedPNL), COLOR_BG);
    tft.setCursor(140, y);
    char unrPnlStr[12];
    snprintf(unrPnlStr, sizeof(unrPnlStr), "%+.2f", p.unrealizedPNL);
    tft.print(unrPnlStr);

    if (p.realizedPNL != 0.0f) {
      tft.setTextColor(pnlColor(p.realizedPNL), COLOR_BG);
      tft.setCursor(228, y);
      char realPnlStr[12];
      snprintf(realPnlStr, sizeof(realPnlStr), "%+.2f", p.realizedPNL);
      tft.print(realPnlStr);
    } else {
      tft.setTextColor(COLOR_GREY, COLOR_BG);
      tft.setCursor(228, y);
      tft.print("—");
    }

    tft.drawFastHLine(0, y + 15, 320, COLOR_GREY_DARK);
    y += 20;
  }

  // ── Bots (PnL/Marge in marginCoin) ────────────────
  if (botCap > 0) {
    tft.setTextColor(COLOR_BLUE, COLOR_BG);
    tft.setCursor(4, y);
    char botHdr[20];
    snprintf(botHdr, sizeof(botHdr), "BOTS (%d)", nBot);
    tft.print(botHdr);
    tft.setTextColor(COLOR_GREY, COLOR_BG);
    tft.setCursor(228, y); tft.print("Liq");
    tft.drawFastHLine(0, y + 13, 320, COLOR_GREY_DARK);
    y += 16;

    for (int i = 0; i < botCap; i++) {
      auto& b = data.bots[i];

      tft.setTextColor(COLOR_WHITE, COLOR_BG);
      tft.setCursor(4, y);
      String sym = b.symbol;
      if (sym.endsWith("USDT")) sym = sym.substring(0, sym.length() - 4);
      if (sym.length() > 7) sym = sym.substring(0, 7);
      tft.print(sym);

      tft.setTextColor(b.side == "BUY" || b.side == "LONG" ? COLOR_GREEN : COLOR_RED, COLOR_BG);
      tft.setCursor(72, y);
      tft.print(b.side.substring(0, 4));

      tft.setTextColor(COLOR_WHITE, COLOR_BG);
      tft.setCursor(104, y);
      char hebStr[8];
      snprintf(hebStr, sizeof(hebStr), "%dx", (int)b.leverage);
      tft.print(hebStr);

      tft.setTextColor(pnlColor(b.unrealizedPNL), COLOR_BG);
      tft.setCursor(140, y);
      char botPnl[20];
      if (b.marginCoin == "USDT")
        snprintf(botPnl, sizeof(botPnl), "%+.2f", b.unrealizedPNL);
      else
        snprintf(botPnl, sizeof(botPnl), "%+.3f %s", b.unrealizedPNL, b.marginCoin.c_str());
      tft.print(botPnl);

      tft.setTextColor(COLOR_GREY, COLOR_BG);
      tft.setCursor(228, y);
      if (b.liqPrice > 0) {
        char liqStr[14];
        if      (b.liqPrice >= 1000) snprintf(liqStr, sizeof(liqStr), "%.0f", b.liqPrice);
        else if (b.liqPrice >= 1)    snprintf(liqStr, sizeof(liqStr), "%.3f", b.liqPrice);
        else                         snprintf(liqStr, sizeof(liqStr), "%.5f", b.liqPrice);
        tft.print(liqStr);
      } else {
        tft.print("—");
      }

      tft.drawFastHLine(0, y + 15, 320, COLOR_GREY_DARK);
      y += 20;
    }
  }

  // ── Footer ────────────────────────────────────────
  time_t now = time(nullptr);
  struct tm* t = localtime(&now);
  char timeStr[16];
  strftime(timeStr, sizeof(timeStr), "%H:%M:%S", t);

  tft.setTextColor(COLOR_GREY, COLOR_BG);
  tft.setCursor(8, 193);
  tft.print("Aktual.: ");
  tft.print(timeStr);
  tft.setCursor(270, 193);
  tft.print("v" FW_VERSION);
}

// ── SCREEN 3: Info-Screen ────────────────────────────────
// Zeigt aktuellen Filter (vom Server gesteuert) + Verbindungsinfos.
// Tap → zurück zum Dashboard + Daten neu laden.

struct FilterOption { const char* key; const char* label; const char* sub; };
static const FilterOption FILTER_OPTS[] = {
  { "all",   "Gesamtzeitraum",   "alle Trades" },
  { "year",  "Aktuelles Jahr",   "1. Jan bis heute" },
  { "month", "Aktueller Monat",  "laufender Kalendermonat" },
  { "week",  "Aktuelle Woche",   "Mo. bis So." },
};

void drawScreen3() {
  tft.fillRect(0, 0, 320, 207, COLOR_BG);

  // Header
  tft.fillRect(0, 0, 320, 22, COLOR_HEADER_BG);
  tft.drawFastHLine(0, 22, 320, COLOR_GREY_DARK);
  tft.setTextColor(COLOR_BLUE, COLOR_HEADER_BG);
  tft.setTextSize(1);
  tft.setCursor(8, 7);
  tft.print("ZEITRAUM & INFO");

  // Aktiver Filter — vom Server
  fillCard(6, 30, 308, 52);
  tft.setTextColor(COLOR_GREY, COLOR_CARD);
  tft.setTextSize(1);
  tft.setCursor(18, 40);
  tft.print("Aktiver Zeitraum (vom Server):");

  // Aktuellen Filter anzeigen
  const char* fLabel = cfgFilter == "month" ? "Aktueller Monat"  :
                       cfgFilter == "week"  ? "Aktuelle Woche"   :
                       cfgFilter == "year"  ? "Aktuelles Jahr"   : "Gesamtzeitraum";
  tft.setTextColor(COLOR_WHITE, COLOR_CARD);
  tft.setTextSize(1);
  tft.setCursor(18, 54);
  tft.print(fLabel);

  // Hinweis: Einstellung im Journal
  fillCard(6, 92, 308, 40);
  tft.setTextColor(COLOR_GREY, COLOR_CARD);
  tft.setTextSize(1);
  tft.setCursor(18, 102);
  tft.print("Aendern: Journal");
  tft.setTextColor(COLOR_WHITE_DIM, COLOR_CARD);
  tft.setCursor(18, 115);
  tft.print("Einstellungen > ESP32 Display > Zeitraum");

  // Verbindungsinfo
  fillCard(6, 142, 308, 54);
  tft.setTextColor(COLOR_GREY, COLOR_CARD);
  tft.setTextSize(1);
  tft.setCursor(18, 152);
  tft.print("Server:");
  tft.setTextColor(COLOR_WHITE_DIM, COLOR_CARD);
  tft.setCursor(72, 152);
  tft.print(cfgHost + ":" + cfgPort);
  tft.setTextColor(COLOR_GREY, COLOR_CARD);
  tft.setCursor(18, 164);
  tft.print("WLAN:");
  tft.setTextColor(WiFi.status() == WL_CONNECTED ? COLOR_GREEN : COLOR_RED, COLOR_CARD);
  tft.setCursor(72, 164);
  tft.print(WiFi.status() == WL_CONNECTED ? cfgSSID.substring(0, 22) : "getrennt");
  tft.setTextColor(COLOR_GREY, COLOR_CARD);
  tft.setCursor(18, 176);
  tft.print("Firmware:");
  tft.setTextColor(COLOR_WHITE_DIM, COLOR_CARD);
  tft.setCursor(80, 176);
  tft.print("v" FW_VERSION);
  tft.setCursor(200, 176);
  tft.print("Tap: Dashboard");
}

// ── Verbindungs-/Fehler-Screens ──────────────────────────

void drawConnecting(const char* msg) {
  tft.fillScreen(COLOR_BG);
  tft.setTextColor(COLOR_GREY, COLOR_BG);
  tft.setTextSize(1);
  tft.setCursor(10, 112);
  tft.print(msg);
}

void drawStartupError(const char* title, const char* detail) {
  tft.fillScreen(COLOR_BG);
  tft.setTextColor(COLOR_RED, COLOR_BG);
  tft.setTextSize(2);
  tft.setCursor(10, 85);
  tft.print(title);
  tft.setTextColor(COLOR_GREY, COLOR_BG);
  tft.setTextSize(1);
  tft.setCursor(10, 120);
  tft.print(detail);
}

// ── Aktuellen Screen zeichnen ────────────────────────────

void drawCurrentScreen() {
  if      (activeScreen == 0) drawScreen1();
  else if (activeScreen == 1) drawScreen2();
  else                        drawScreen3();
  drawNavBar();
}

// ── HTML Helpers ─────────────────────────────────────────

String htmlEscape(const String& v) {
  String s = v;
  s.replace("&", "&amp;"); s.replace("\"", "&quot;");
  s.replace("'", "&#39;"); s.replace("<", "&lt;");
  s.replace(">", "&gt;");
  return s;
}

bool isValidPort(const String& p) {
  if (p.isEmpty()) return false;
  for (size_t i = 0; i < p.length(); i++)
    if (!isDigit((unsigned char)p[i])) return false;
  long v = p.toInt();
  return v >= 1 && v <= 65535;
}

// ── Setup-Portal HTML ────────────────────────────────────

const char CONFIG_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trading Journal Setup</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0d1117; color: #e6edf3; font-family: -apple-system, sans-serif; padding: 20px; }
  h1 { color: #58a6ff; margin-bottom: 4px; font-size: 1.3rem; }
  p.sub { color: #8b949e; font-size: 0.82rem; margin-bottom: 18px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 16px; margin-bottom: 12px; }
  .card h2 { color: #8b949e; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
  label { display: block; color: #8b949e; font-size: 0.82rem; margin-bottom: 3px; margin-top: 9px; }
  input { width: 100%; background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
          color: #e6edf3; padding: 9px 12px; font-size: 0.95rem; outline: none; }
  input:focus { border-color: #58a6ff; }
  button { width: 100%; background: #238636; color: #fff; border: none; border-radius: 6px;
           padding: 12px; font-size: 1rem; font-weight: 600; cursor: pointer; margin-top: 14px; }
  button:active { opacity: 0.8; }
  .scan-btn { background: #1f6feb; margin-top: 0; padding: 8px; font-size: 0.85rem; margin-bottom: 8px; }
  .reset { background: #da3633; margin-top: 8px; }
  .info { background: #1c2128; border: 1px solid #30363d; border-radius: 6px;
          padding: 9px 12px; font-size: 0.82rem; color: #8b949e; margin-top: 5px; }
  .net-list { margin-top: 8px; }
  .net-item { display: flex; justify-content: space-between; align-items: center;
              background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
              padding: 9px 12px; margin-bottom: 5px; cursor: pointer; font-size: 0.9rem; }
  .net-item:hover, .net-item.selected { border-color: #3fb950; background: #0d1f12; }
  .rssi { font-size: 0.75rem; color: #8b949e; }
  #scan-status { color: #8b949e; font-size: 0.82rem; margin-top: 5px; min-height: 18px; }
</style>
</head>
<body>
<h1>Trading Journal</h1>
<p class="sub">ESP32-2432S028 CYD Setup</p>

<form action="/save" method="POST">
  <div class="card">
    <h2>WLAN</h2>
    <button type="button" class="scan-btn" onclick="scanWifi()">Netzwerke suchen...</button>
    <div id="scan-status"></div>
    <div class="net-list" id="net-list"></div>
    <label>SSID</label>
    <input name="ssid" id="ssid" type="text" value="%SSID%" required autocomplete="off">
    <label>Passwort</label>
    <input name="pass" id="pass" type="password" value="%PASS%" autocomplete="off">
  </div>
  <div class="card">
    <h2>Trading Journal API</h2>
    <div class="info">Settings → ESP32 Display → API-Key kopieren</div>
    <label>Host (IP des NAS)</label>
    <input name="host" type="text" value="%HOST%" placeholder="192.168.178.100" required>
    <label>Port</label>
    <input name="port" type="text" value="%PORT%" placeholder="8080" required>
    <label>ESP32 API-Key</label>
    <input name="key" type="text" value="%KEY%" placeholder="Hex-String aus Settings" required>
  </div>
  <button type="submit">Speichern und Verbinden</button>
</form>
<form action="/reset" method="POST" style="margin-top:8px">
  <button class="reset" type="submit">Konfiguration loeschen</button>
</form>

<script>
function rssiBar(r){return r>-60?'████':r>-70?'███░':r>-80?'██░░':'█░░░';}
function selectNet(el, ssid, enc) {
  document.getElementById('ssid').value = ssid;
  document.querySelectorAll('.net-item').forEach(e=>e.classList.remove('selected'));
  el.classList.add('selected');
  if(enc) document.getElementById('pass').focus();
}
function scanWifi() {
  document.getElementById('scan-status').textContent='Scanne...';
  document.getElementById('net-list').innerHTML='';
  fetch('/scan').then(r=>{if(!r.ok)throw r;return r.json();}).then(nets=>{
    document.getElementById('scan-status').textContent=nets.length+' Netzwerke gefunden';
    nets.sort((a,b)=>b.rssi-a.rssi);
    const list=document.getElementById('net-list');
    nets.forEach(n=>{
      const d=document.createElement('div');
      d.className='net-item';
      const lbl=document.createElement('span');
      lbl.textContent=(n.ssid||'(versteckt)')+(n.enc?' [+]':'');
      const sig=document.createElement('span');
      sig.className='rssi';
      sig.textContent=rssiBar(n.rssi)+' '+n.rssi+'dBm';
      d.appendChild(lbl);d.appendChild(sig);
      d.onclick=()=>selectNet(d,n.ssid,n.enc);
      list.appendChild(d);
    });
  }).catch(()=>{document.getElementById('scan-status').textContent='Scan fehlgeschlagen';});
}
window.onload=scanWifi;
</script>
</body>
</html>
)rawliteral";

// ── WiFi-Scan Handler ────────────────────────────────────

void handleScan() {
  int n = WiFi.scanNetworks();
  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  for (int i = 0; i < n; i++) {
    JsonObject net = arr.add<JsonObject>();
    net["ssid"] = WiFi.SSID(i);
    net["rssi"] = WiFi.RSSI(i);
    net["enc"]  = (WiFi.encryptionType(i) != WIFI_AUTH_OPEN) ? 1 : 0;
  }
  WiFi.scanDelete();
  String json;
  serializeJson(doc, json);
  server.send(200, "application/json", json);
}

// ── Web-Server Handlers ──────────────────────────────────

String buildHtml() {
  String html = String(CONFIG_HTML);
  html.replace("%SSID%", htmlEscape(cfgSSID));
  html.replace("%PASS%", htmlEscape(cfgPass));
  html.replace("%HOST%", htmlEscape(cfgHost));
  html.replace("%PORT%", htmlEscape(cfgPort));
  html.replace("%KEY%",  htmlEscape(cfgKey));
  return html;
}

void handleRoot()  { server.send(200, "text/html; charset=utf-8", buildHtml()); }

void handleSave() {
  String ssid = server.arg("ssid"), pass = server.arg("pass");
  String host = server.arg("host"), port = server.arg("port");
  String key  = server.arg("key");
  ssid.trim(); pass.trim(); host.trim(); port.trim(); key.trim();

  if (ssid.isEmpty() || host.isEmpty() || key.isEmpty()) {
    server.send(400, "text/plain", "Fehlende Felder"); return;
  }
  if (!isValidPort(port)) {
    server.send(400, "text/plain", "Ungueltiger Port"); return;
  }
  saveConfig(ssid, pass, host, port, key);
  loadConfig();
  bool saved = (cfgSSID == ssid && cfgKey == key);
  server.send(200, "text/html; charset=utf-8",
    saved
    ? "<html><head><meta charset='UTF-8'></head><body style='background:#0d1117;color:#e6edf3;font-family:sans-serif;padding:30px'>"
      "<h2 style='color:#3fb950'>Gespeichert!</h2><p>ESP32 startet neu...</p></body></html>"
    : "<html><head><meta charset='UTF-8'></head><body style='background:#0d1117;color:#e6edf3;font-family:sans-serif;padding:30px'>"
      "<h2 style='color:#da3633'>Fehler!</h2><p>Bitte nochmal versuchen.</p></body></html>");
  if (!saved) return;
  delay(3000);
  ESP.restart();
}

void handleReset() {
  clearConfig();
  server.send(200, "text/html; charset=utf-8",
    "<html><head><meta charset='UTF-8'></head><body style='background:#0d1117;color:#e6edf3;font-family:sans-serif;padding:30px'>"
    "<h2 style='color:#da3633'>Geloescht</h2><p>ESP32 startet neu...</p></body></html>");
  delay(1500);
  ESP.restart();
}

void setupRoutes() {
  server.on("/",      HTTP_GET,  handleRoot);
  server.on("/save",  HTTP_POST, handleSave);
  server.on("/reset", HTTP_POST, handleReset);
  server.on("/scan",  HTTP_GET,  handleScan);
  server.begin();
}

// ── Daten holen ──────────────────────────────────────────

bool fetchData() {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String url = "http://" + cfgHost + ":" + cfgPort + "/api/esp32/display?filter=" + cfgFilter;
  http.begin(url);
  http.addHeader("X-ESP32-Key", cfgKey);
  http.setTimeout(10000);

  int code = http.GET();
  if (code != 200) {
    http.end();
    data.valid = false;
    Serial.printf("[API] HTTP %d\n", code);
    return false;
  }

  String payload = http.getString();
  http.end();
  Serial.println("[API] Response: " + payload);

  JsonDocument doc;
  if (deserializeJson(doc, payload) != DeserializationError::Ok) {
    data.valid = false;
    return false;
  }

  data.todayPnL    = doc["todayPnL"]    | 0.0f;
  data.todayTrades = doc["todayTrades"] | 0;
  data.todayWins   = doc["todayWins"]   | 0;
  data.todayLosses = doc["todayLosses"] | 0;
  data.totalPnL    = doc["totalPnL"]    | 0.0f;
  data.winRate     = doc["winRate"]     | 0.0f;
  data.satisfaction= doc["satisfaction"]| 0.0f;
  data.rrr         = doc["rrr"]         | 0.0f;
  data.hasBalance  = !doc["balance"].isNull();
  data.balance     = doc["balance"]     | 0.0f;
  data.balancePerf = doc["balancePerf"] | 0.0f;
  data.volume30d   = doc["volume30d"]   | 0L;
  data.volumeTotal = doc["volumeTotal"] | 0L;

  // Sync filter from server (server controls which period to display)
  const char* srvFilter = doc["filter"] | "";
  if (strlen(srvFilter) > 0) {
    String newFilter = String(srvFilter);
    if (newFilter != cfgFilter) {
      cfgFilter = newFilter;
      saveFilter();
      Serial.println("[CFG] Filter synced from server: " + cfgFilter);
    }
  }

  data.positions.clear();
  JsonArray posArr = doc["openPositions"].as<JsonArray>();
  for (JsonObject p : posArr) {
    Position pos;
    pos.symbol        = p["symbol"]        | "";
    pos.side          = p["side"]          | "";
    pos.leverage      = p["leverage"]      | 0.0f;
    pos.entryPrice    = p["entryPrice"]    | 0.0f;
    pos.markPrice     = p["markPrice"]     | 0.0f;
    pos.qty           = p["qty"]           | 0.0f;
    pos.unrealizedPNL = p["unrealizedPNL"] | 0.0f;
    pos.realizedPNL   = p["realizedPNL"]   | 0.0f;
    data.positions.push_back(pos);
  }

  // Laufende Pionex-Bots (eigenes Array; ältere Server ohne Feld → leer)
  data.bots.clear();
  JsonArray botArr = doc["bots"].as<JsonArray>();
  for (JsonObject b : botArr) {
    Bot bot;
    bot.symbol        = b["symbol"]        | "";
    bot.side          = b["side"]          | "";
    bot.marginCoin    = b["marginCoin"]    | "USDT";
    bot.leverage      = b["leverage"]      | 0.0f;
    bot.entryPrice    = b["entryPrice"]    | 0.0f;
    bot.markPrice     = b["markPrice"]     | 0.0f;
    bot.unrealizedPNL = b["unrealizedPNL"] | 0.0f;
    bot.liqPrice      = b["liqPrice"]      | 0.0f;
    bot.coinM         = b["coinM"]         | false;
    data.bots.push_back(bot);
  }

  data.valid = true;
  return true;
}

// ── Setup ────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(1500);  // ESP32-S3 USB CDC: warten bis Host verbunden
  Serial.println("[BOOT] Start");

  // ── Display initialisieren ──────────────────────
  // tft.init() zuerst (TFT_BL=5 in Build-Flags lässt TFT_eSPI digitalWrite auf Pin 5 machen)
  // backlightInit() danach: re-attached LEDC auf Pin 5, sonst funktioniert ledcWrite nicht
  Serial.println("[BOOT] tft.init()");
  tft.init();
  waveshareInitST7789();     // ST7789T3 Custom-Init (Waveshare ESP32-S3-Touch-LCD-2.8)
  tft.setRotation(DISPLAY_ROTATION);
  Serial.println("[BOOT] Backlight LEDC init");
  backlightInit();           // NACH tft.init(): LEDC re-attached Pin 5 nach TFT_eSPI digitalWrite
  tft.fillScreen(COLOR_BG);

  // ── Touch I2C (CST328) ───────────────────────────
  cst328Init();

  loadConfig();

  // ── Setup-Modus ──────────────────────────────────
  if (cfgSSID.isEmpty() || cfgKey.isEmpty()) {
    configMode = true;
    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP(AP_SSID);
    Serial.printf("[AP] %s\n", WiFi.softAPIP().toString().c_str());
    setupRoutes();

    // Setup-Screen (Landscape 320×240)
    tft.fillScreen(COLOR_BG);
    tft.setTextColor(COLOR_YELLOW, COLOR_BG);
    tft.setTextSize(2);
    tft.setCursor(10, 20);
    tft.print("SETUP MODUS");
    tft.drawFastVLine(160, 50, 155, COLOR_GREY_DARK);
    tft.setTextColor(COLOR_GREY, COLOR_BG);
    tft.setTextSize(1);
    tft.setCursor(10, 58);  tft.print("1. WLAN verbinden:");
    tft.setTextColor(COLOR_GREEN, COLOR_BG);
    tft.setCursor(10, 74);  tft.print(AP_SSID);
    tft.setTextColor(COLOR_GREY, COLOR_BG);
    tft.setCursor(10, 90);  tft.print("(kein Passwort)");
    tft.setCursor(172, 58); tft.print("2. Browser:");
    tft.setTextColor(COLOR_YELLOW, COLOR_BG);
    tft.setCursor(172, 74); tft.print("192.168.4.1");
    tft.drawFastHLine(0, 207, 320, COLOR_GREY_DARK);
    tft.setTextColor(COLOR_GREY, COLOR_BG);
    tft.setCursor(10, 217); tft.print("Trading Journal ESP32 v" FW_VERSION);
    return;
  }

  // ── WiFi verbinden ───────────────────────────────
  WiFi.mode(WIFI_STA);
  tft.fillScreen(COLOR_BG);
  tft.setTextColor(COLOR_WHITE, COLOR_BG);
  tft.setTextSize(1);
  tft.setCursor(10, 108);
  tft.print("Verbinde mit WiFi...");

  WiFi.begin(cfgSSID.c_str(), cfgPass.c_str());
  unsigned long t0 = millis();
  int dotX = 10;
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - t0 > WIFI_TIMEOUT_MS) break;
    tft.setTextColor(COLOR_GREY, COLOR_BG);
    tft.setCursor(dotX, 124); tft.print(".");
    dotX += 8; if (dotX > 220) dotX = 10;
    delay(300);
  }

  if (WiFi.status() != WL_CONNECTED) {
    drawStartupError("WiFi Fehler", "Zugangsdaten pruefen (Setup: 192.168.4.1)");
    delay(10000);
    ESP.restart();
    return;
  }

  Serial.printf("[WiFi] %s\n", WiFi.localIP().toString().c_str());
  WiFi.setSleep(true);   // Modem Sleep: Radio schläft zwischen Requests (~50 mA gespart)
  setupRoutes();

  drawConnecting("Lade Daten...");
  bool ok = fetchData();
  if (!ok) {
    drawStartupError("API Fehler", "Pruefen: Host, Port und API-Key");
    delay(5000);
  }
  drawCurrentScreen();
  lastUpdate    = millis();
  lastTouchTime = millis();
}

// ── Loop ─────────────────────────────────────────────────

// ── WiFi sicherstellen (nach Verbindungsverlust) ──────────
static void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.reconnect();
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < WIFI_TIMEOUT_MS)
    delay(100);
  if (WiFi.status() == WL_CONNECTED) WiFi.setSleep(true);
}

void loop() {
  server.handleClient();

  if (configMode) return;

  unsigned long now = millis();

  // ── Touch prüfen ─────────────────────────────────────
  int tx, ty;
  if (mapTouch(&tx, &ty)) {
    lastTouchTime = now;

    if (inStandby) {
      // ── Aufwachen aus Standby ─────────────────────────
      inStandby = false;
      setBacklight(true);
      drawConnecting("Lade Daten...");
      ensureWiFi();
      fetchData();
      drawCurrentScreen();
      lastUpdate = millis();
      delay(80);
      return;
    }

    if (ty > 180) {
      // ── Nav-Bar: 3 Buttons (je ~107px breit) ──────────
      int newScreen = (tx < 107) ? 0 : (tx < 214) ? 1 : 2;
      if (newScreen != activeScreen) {
        activeScreen = newScreen;
        drawCurrentScreen();
      }
    } else if (activeScreen == 2) {
      // Screen 3 ist jetzt rein informativ (Filter wird vom Server gesteuert)
      // Tap wechselt zurück zum Dashboard und lädt aktuelle Daten
      activeScreen = 0;
      drawConnecting("Lade Daten...");
      ensureWiFi();
      if (fetchData()) {
        drawCurrentScreen();
      } else {
        drawStartupError("API Fehler", "Verbindung zum Server fehlgeschlagen");
        delay(2000);
        drawCurrentScreen();
      }
    }
    delay(80);  // Ghost-Touch-Schutz
    return;
  }

  // ── Standby Stufe 1: 30s ohne Touch → Backlight aus ─
  if (!inStandby && now - lastTouchTime >= (unsigned long)STANDBY_TIMEOUT * 1000) {
    inStandby = true;
    tft.fillScreen(COLOR_BG);
    setBacklight(false);
    Serial.println("[PWR] Standby — Backlight aus");
  }

  // ── Standby Stufe 2: 60s ohne Touch → Light Sleep + WiFi aus ─
  // Boot-Grace: erste 5 Min nach Boot kein Sleep (damit Flashen funktioniert)
  if (inStandby
      && now > BOOT_GRACE_MS
      && now - lastTouchTime >= (unsigned long)LIGHT_SLEEP_TIMEOUT * 1000) {

    enterLightSleep();   // BLOCKIERT bis Touch

    // ── Nach Wake: aufwachen wie bei Touch im Standby ──
    inStandby = false;
    lastTouchTime = millis();
    setBacklight(true);
    drawConnecting("Lade Daten...");
    ensureWiFi();
    if (fetchData()) drawCurrentScreen();
    lastUpdate = millis();
    delay(150);   // Touch-Event abklingen lassen
    return;
  }

  // Im Standby (Stufe 1): nur kurz warten, Touch-Polling läuft weiter
  if (inStandby) {
    delay(50);
    return;
  }

  // ── Aktiv: Daten alle 5 Sekunden aktualisieren ───────
  if (now - lastUpdate >= (unsigned long)ACTIVE_INTERVAL * 1000) {
    ensureWiFi();
    if (fetchData()) drawCurrentScreen();
    lastUpdate = millis();
    return;
  }

  delay(50);
}
