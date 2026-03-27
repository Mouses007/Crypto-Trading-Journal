#include <Arduino.h>
#include <SPI.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TFT_eSPI.h>
#include <XPT2046_Touchscreen.h>
#include <vector>

// ── Touch SPI (VSPI) CYD ESP32-2432S028 Pins ─────────────
#define TOUCH_CLK   25
#define TOUCH_MISO  39
#define TOUCH_MOSI  32
#define MY_TOUCH_CS 33   // Eigener Name — vermeidet Konflikt mit -DTOUCH_CS=-1 Build-Flag

// ── Konstanten ───────────────────────────────────────────

#define AP_SSID          "TradingJournal-Setup"
#define UPDATE_INTERVAL  30        // Sekunden
#define PREF_NAMESPACE   "tjcfg"
#define WIFI_TIMEOUT_MS  12000
#define DISPLAY_ROTATION 3
#define FW_VERSION       "2.8.0"

// ── Farben RGB565 ────────────────────────────────────────

#define COLOR_BG         0x0841   // Dunkles Blau-Schwarz
#define COLOR_CARD       0x1082   // Karten-Hintergrund
#define COLOR_GREEN      0x07E0
#define COLOR_RED        0xF800
#define COLOR_WHITE      0xFFFF
#define COLOR_GREY       0x8410
#define COLOR_GREY_DARK  0x2104
#define COLOR_YELLOW     0xFFE0
#define COLOR_BLUE_NAV   0x1F6F   // Aktiver Nav-Button
#define COLOR_NAV_BG     0x0841
#define COLOR_HEADER_BG  0x0010   // Fast schwarz für Header

// ── Globals ──────────────────────────────────────────────

TFT_eSPI    tft;
XPT2046_Touchscreen ts(MY_TOUCH_CS);   // Verwendet globale SPI-Instanz
WebServer   server(80);
Preferences prefs;

String cfgSSID, cfgPass, cfgHost, cfgPort, cfgKey;
String cfgFilter = "month";       // "month", "week", "year", "all"
bool   configMode  = false;
int    activeScreen = 0;          // 0 = Dashboard, 1 = Positionen, 2 = Filter
unsigned long lastUpdate = 0;

// ── Datenstrukturen ──────────────────────────────────────

struct Position {
  String symbol;
  String side;
  float  leverage;
  float  entryPrice;
  float  markPrice;
  float  qty;
  float  unrealizedPNL;
};

struct TradeData {
  float todayPnL    = 0;
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
  cfgFilter = prefs.getString("filter", "month");
  prefs.end();
}

void saveFilter() {
  prefs.begin(PREF_NAMESPACE, false);
  prefs.putString("filter", cfgFilter);
  prefs.end();
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

// ── Touch (XPT2046_Touchscreen, VSPI via globale SPI-Instanz) ────────────
// Kalibrierungswerte aus tatsächlich beobachteten Rohkoordinaten (Landscape)
// ts.setRotation(1): p.x = 4095 - hardware_y, p.y = hardware_x
// p.x = 250..3750 → screen x 0..319 (links→rechts)
// p.y = 200..930  → screen y 0..239 (oben→unten)
#define TOUCH_X_MIN  560   // Linker Rand  (~600 gemessen, Marge -40)
#define TOUCH_X_MAX  3520  // Rechter Rand (~3475 gemessen, Marge +45)
#define TOUCH_Y_MIN  650   // Oberer Rand  (~700 gemessen, Marge -50)
#define TOUCH_Y_MAX  3420  // Unterer Rand (~3352 gemessen, Marge +68)

bool mapTouch(int* screenX, int* screenY) {
  if (!ts.touched()) return false;
  TS_Point p = ts.getPoint();
  if (p.z < 100) return false;
  Serial.printf("[Touch] raw x=%d y=%d z=%d\n", p.x, p.y, p.z);
  *screenX = constrain(map(p.x, TOUCH_X_MAX, TOUCH_X_MIN, 0, 319), 0, 319); // X invertiert: hoher raw = links
  *screenY = constrain(map(p.y, TOUCH_Y_MAX, TOUCH_Y_MIN, 0, 239), 0, 239); // Y invertiert: hoher raw = oben
  return true;
}

void loadTouchCal() {}  // Keine NVS-Kalibrierung nötig

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
  tft.drawRoundRect(x, y, w, h, 6, COLOR_GREY_DARK);
}

// ── Nav-Bar (Landscape: y=207, h=33, 3 Buttons je ~107px) ──
// Button 0: Dashboard  x=0..106
// Button 1: Positionen x=107..213
// Button 2: Filter     x=214..319

void drawNavBar() {
  const int ny = 207, nh = 33;

  tft.fillRect(0, ny, 320, nh, COLOR_NAV_BG);
  tft.drawFastHLine(0, ny, 320, COLOR_GREY_DARK);
  tft.drawFastVLine(107, ny, nh, COLOR_GREY_DARK);
  tft.drawFastVLine(214, ny, nh, COLOR_GREY_DARK);
  tft.setTextSize(1);

  // Dashboard
  if (activeScreen == 0) tft.fillRect(1,   ny+1, 105, nh-1, COLOR_BLUE_NAV);
  tft.setTextColor(activeScreen == 0 ? COLOR_WHITE : COLOR_GREY,
                   activeScreen == 0 ? COLOR_BLUE_NAV : COLOR_NAV_BG);
  tft.setCursor(22, ny + 12);
  tft.print("Dashboard");

  // Positionen
  if (activeScreen == 1) tft.fillRect(108, ny+1, 105, nh-1, COLOR_BLUE_NAV);
  tft.setTextColor(activeScreen == 1 ? COLOR_WHITE : COLOR_GREY,
                   activeScreen == 1 ? COLOR_BLUE_NAV : COLOR_NAV_BG);
  tft.setCursor(122, ny + 12);
  tft.print("Positionen");

  // Filter (aktiver Filter als Label)
  const char* fLabel = cfgFilter == "month" ? "Monat"  :
                       cfgFilter == "week"  ? "Woche"  :
                       cfgFilter == "year"  ? "Jahr"   : "Gesamt";
  if (activeScreen == 2) tft.fillRect(215, ny+1, 104, nh-1, COLOR_BLUE_NAV);
  tft.setTextColor(activeScreen == 2 ? COLOR_WHITE : COLOR_YELLOW,
                   activeScreen == 2 ? COLOR_BLUE_NAV : COLOR_NAV_BG);
  tft.setCursor(220, ny + 6);
  tft.print("Filter");
  tft.setCursor(228, ny + 18);
  tft.print(fLabel);
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

  // ── Kontostand-Karte (x=4, y=2, w=312, h=60) ─────
  fillCard(4, 2, 312, 60);

  tft.setTextColor(COLOR_GREY, COLOR_CARD);
  tft.setTextSize(1);
  tft.setCursor(12, 9);
  tft.print("KONTOSTAND");

  // Filter-Label (oben rechts in der Karte)
  const char* fLbl = cfgFilter == "month" ? "Monat"  :
                     cfgFilter == "week"  ? "Woche"  :
                     cfgFilter == "year"  ? "Jahr"   : "Gesamt";
  tft.setTextColor(COLOR_YELLOW, COLOR_CARD);
  tft.setTextSize(1);
  tft.setCursor(264, 9);
  tft.print(fLbl);

  if (data.hasBalance) {
    // Balance-Modus: Kontostand gross, Perf rechts, Heute PnL unten
    String balStr = "$ " + String(data.balance, 2);
    tft.setTextColor(pnlColor(data.balancePerf), COLOR_CARD);
    tft.setTextSize(2);
    tft.setCursor(12, 26);
    tft.print(balStr);
    String perfStr = (data.balancePerf >= 0 ? "+" : "") + String(data.balancePerf, 1) + "%";
    tft.setTextColor(pnlColor(data.balancePerf), COLOR_CARD);
    tft.setTextSize(1);
    tft.setCursor(12, 50);
    tft.print("Heute: ");
    tft.setTextColor(pnlColor(data.todayPnL), COLOR_CARD);
    tft.print((data.todayPnL >= 0 ? "+" : "") + String(data.todayPnL, 2));
    tft.setTextColor(pnlColor(data.balancePerf), COLOR_CARD);
    tft.setCursor(220, 50);
    tft.print("Perf: " + perfStr);
  } else {
    // Kein Startkapital: Gefilterter PnL gross, Heute-PnL klein
    String totStr = (data.totalPnL >= 0 ? "+" : "") + String(data.totalPnL, 2) + " USDT";
    tft.setTextColor(pnlColor(data.totalPnL), COLOR_CARD);
    tft.setTextSize(2);
    tft.setCursor(12, 26);
    tft.print(totStr);
    // Heute PnL klein unten links
    tft.setTextColor(COLOR_GREY, COLOR_CARD);
    tft.setTextSize(1);
    tft.setCursor(12, 50);
    tft.print("Heute: ");
    tft.setTextColor(pnlColor(data.todayPnL), COLOR_CARD);
    tft.print((data.todayPnL >= 0 ? "+" : "") + String(data.todayPnL, 2) + " USDT");
  }

  // ── Volumen-Zeilen ────────────────────────────────
  tft.drawFastHLine(4, 66, 312, COLOR_GREY_DARK);
  tft.setTextColor(COLOR_GREY, COLOR_BG);
  tft.setTextSize(1);
  tft.setCursor(8, 72);
  tft.print("Volumen (30 Tage)");
  String v30 = "$ " + fmtVol(data.volume30d);
  tft.setTextColor(COLOR_WHITE, COLOR_BG);
  tft.setCursor(320 - 8 - (int)v30.length() * 6, 72);
  tft.print(v30);

  tft.drawFastHLine(4, 84, 312, COLOR_GREY_DARK);
  tft.setTextColor(COLOR_GREY, COLOR_BG);
  tft.setCursor(8, 90);
  tft.print("Volumen (Gesamt)");
  String vtot = "$ " + fmtVol(data.volumeTotal);
  tft.setTextColor(COLOR_WHITE, COLOR_BG);
  tft.setCursor(320 - 8 - (int)vtot.length() * 6, 90);
  tft.print(vtot);

  // ── Trennlinie ────────────────────────────────────
  tft.drawFastHLine(0, 101, 320, COLOR_GREY_DARK);

  // ── 3 Donuts (Landscape: cx=55/160/265, cy=158) ──
  // cy=158: label-Unterkante bei 158+34+4+8=204px < NavBar 207px
  const int cy = 158, r = 34, ir = 23;

  char wrStr[10];
  snprintf(wrStr, sizeof(wrStr), "%.1f%%", data.winRate);
  uint16_t wrCol = data.winRate >= 50 ? COLOR_GREEN : (data.winRate >= 40 ? COLOR_YELLOW : COLOR_RED);
  drawDonut(55, cy, r, ir, data.winRate, wrCol, "Win rate", wrStr);

  char satStr[10];
  snprintf(satStr, sizeof(satStr), "%.1f%%", data.satisfaction);
  uint16_t satCol = data.satisfaction >= 50 ? COLOR_GREEN : (data.satisfaction >= 30 ? COLOR_YELLOW : COLOR_RED);
  drawDonut(160, cy, r, ir, data.satisfaction, satCol, "Satisfaction", satStr);

  char rrrStr[12];
  snprintf(rrrStr, sizeof(rrrStr), "1:%.1f", data.rrr);
  float rrrPct = constrain(data.rrr / 3.0f * 100.0f, 0, 100);
  uint16_t rrrCol = data.rrr >= 1.5f ? COLOR_GREEN : (data.rrr >= 1.0f ? COLOR_YELLOW : COLOR_RED);
  drawDonut(265, cy, r, ir, rrrPct, rrrCol, "O RRR", rrrStr);
}

// ── SCREEN 2: Offene Positionen (Landscape 320×207) ──────
// Spalten: Sym=70 | Side=30 | Heb=30 | Entry=52 | Mark=52 | PnL=68
// x-Offsets: 4      76       108      140       194       248

void drawScreen2() {
  tft.fillRect(0, 0, 320, 207, COLOR_BG);

  // ── Header ────────────────────────────────────────
  tft.fillRect(0, 0, 320, 26, COLOR_HEADER_BG);
  tft.setTextColor(COLOR_WHITE, COLOR_HEADER_BG);
  tft.setTextSize(1);
  tft.setCursor(8, 5);
  tft.print("Crypto Trading Journal");
  tft.setTextColor(COLOR_GREY, COLOR_HEADER_BG);
  tft.setCursor(8, 16);
  tft.print("Offene Bitunix Futures");

  // ── Gesamt-Zeile ──────────────────────────────────
  float totalUnrPnL = 0;
  for (auto& p : data.positions) totalUnrPnL += p.unrealizedPNL;
  int n = data.positions.size();

  char gesamt[52];
  snprintf(gesamt, sizeof(gesamt), "Gesamt: %.2f USDT  (%d Position%s)",
           totalUnrPnL, n, n == 1 ? "" : "en");
  tft.setTextColor(pnlColor(totalUnrPnL), COLOR_BG);
  tft.setTextSize(1);
  tft.setCursor(8, 31);
  tft.print(gesamt);

  if (n == 0) {
    tft.setTextColor(COLOR_GREY, COLOR_BG);
    tft.setCursor(8, 100);
    tft.print("Keine offenen Positionen");
    tft.setTextColor(COLOR_GREY, COLOR_BG);
    tft.setCursor(270, 193);
    tft.print("v" FW_VERSION);
    return;
  }

  // ── Tabellen-Header (y=44) ────────────────────────
  tft.drawFastHLine(0, 44, 320, COLOR_GREY_DARK);
  tft.setTextColor(COLOR_GREY, COLOR_BG);
  tft.setTextSize(1);
  tft.setCursor(4,   48); tft.print("Symbol");
  tft.setCursor(76,  48); tft.print("Side");
  tft.setCursor(108, 48); tft.print("Heb.");
  tft.setCursor(140, 48); tft.print("Einst.");
  tft.setCursor(194, 48); tft.print("Mark");
  tft.setCursor(248, 48); tft.print("unr. PnL");
  tft.drawFastHLine(0, 60, 320, COLOR_GREY_DARK);

  // ── Tabellenzeilen (ab y=63, 20px pro Zeile, max 7) ──
  int maxRows = min((int)data.positions.size(), 7);
  int y = 63;

  for (int i = 0; i < maxRows; i++) {
    auto& p = data.positions[i];
    uint16_t rowColor = pnlColor(p.unrealizedPNL);

    // Symbol (ohne USDT-Suffix, max 7 Zeichen)
    tft.setTextColor(COLOR_WHITE, COLOR_BG);
    tft.setCursor(4, y);
    String sym = p.symbol;
    if (sym.endsWith("USDT")) sym = sym.substring(0, sym.length() - 4);
    if (sym.length() > 7) sym = sym.substring(0, 7);
    tft.print(sym);

    // Side
    tft.setTextColor(p.side == "BUY" || p.side == "LONG" ? COLOR_GREEN : COLOR_RED, COLOR_BG);
    tft.setCursor(76, y);
    tft.print(p.side.substring(0, 4));

    // Hebel
    tft.setTextColor(COLOR_WHITE, COLOR_BG);
    tft.setCursor(108, y);
    char hebStr[8];
    snprintf(hebStr, sizeof(hebStr), "%dx", (int)p.leverage);
    tft.print(hebStr);

    // Entry price
    tft.setCursor(140, y);
    char epStr[10];
    snprintf(epStr, sizeof(epStr), "%.2f", p.entryPrice);
    tft.print(epStr);

    // Mark price
    tft.setCursor(194, y);
    char mpStr[10];
    snprintf(mpStr, sizeof(mpStr), "%.2f", p.markPrice);
    tft.print(mpStr);

    // unr. PnL
    tft.setTextColor(rowColor, COLOR_BG);
    tft.setCursor(248, y);
    char pnlStr[12];
    snprintf(pnlStr, sizeof(pnlStr), "%.2f", p.unrealizedPNL);
    tft.print(pnlStr);

    tft.drawFastHLine(0, y + 15, 320, COLOR_GREY_DARK);
    y += 20;
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

// ── SCREEN 3: Filter-Auswahl ─────────────────────────────
// 4 große Tap-Buttons, y=8/58/108/158, je h=44px

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
  tft.setTextColor(COLOR_WHITE, COLOR_HEADER_BG);
  tft.setTextSize(1);
  tft.setCursor(8, 7);
  tft.print("FILTER / ZEITRAUM");

  // 4 Buttons
  for (int i = 0; i < 4; i++) {
    int by = 26 + i * 46;
    bool active = (cfgFilter == String(FILTER_OPTS[i].key));
    uint16_t bgCol  = active ? COLOR_BLUE_NAV : COLOR_CARD;
    uint16_t bdrCol = active ? COLOR_WHITE    : COLOR_GREY_DARK;
    tft.fillRoundRect(6, by, 308, 40, 5, bgCol);
    tft.drawRoundRect(6, by, 308, 40, 5, bdrCol);
    tft.setTextColor(active ? COLOR_WHITE : COLOR_WHITE, bgCol);
    tft.setTextSize(1);
    tft.setCursor(16, by + 8);
    tft.print(FILTER_OPTS[i].label);
    tft.setTextColor(active ? COLOR_YELLOW : COLOR_GREY, bgCol);
    tft.setCursor(16, by + 22);
    tft.print(FILTER_OPTS[i].sub);
    if (active) {
      // Checkmark rechts
      tft.setTextColor(COLOR_GREEN, bgCol);
      tft.setCursor(290, by + 14);
      tft.print("<<");
    }
  }
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
  data.totalPnL    = doc["totalPnL"]    | 0.0f;
  data.winRate     = doc["winRate"]     | 0.0f;
  data.satisfaction= doc["satisfaction"]| 0.0f;
  data.rrr         = doc["rrr"]         | 0.0f;
  data.hasBalance  = !doc["balance"].isNull();
  data.balance     = doc["balance"]     | 0.0f;
  data.balancePerf = doc["balancePerf"] | 0.0f;
  data.volume30d   = doc["volume30d"]   | 0L;
  data.volumeTotal = doc["volumeTotal"] | 0L;

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
    data.positions.push_back(pos);
  }

  data.valid = true;
  return true;
}

// ── Setup ────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);

  // ── Display initialisieren ──────────────────────
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, HIGH);
  tft.init();
  // Alle 4 Rotationen leeren → komplettes GRAM egal welcher Chip-Variant
  for (uint8_t r = 0; r < 4; r++) { tft.setRotation(r); tft.fillScreen(TFT_BLACK); }
  tft.setRotation(DISPLAY_ROTATION);
  tft.invertDisplay(true);   // CYD ILI9341_2_DRIVER benötigt Farb-Inversion
  tft.fillScreen(COLOR_BG);

  // ── Touch-SPI via globale SPI-Instanz (VSPI, ESP32 SPI3_HOST) ──
  // Globale SPI.begin() VOR ts.begin(), damit ts.begin()'s interner
  // SPI.begin()-Aufruf ein No-Op ist und unsere Pins erhalten bleiben.
  // MY_TOUCH_CS ist 33 (separater Name, kein Konflikt mit Build-Flag -DTOUCH_CS=-1)
  pinMode(MY_TOUCH_CS, OUTPUT);
  digitalWrite(MY_TOUCH_CS, HIGH);
  SPI.begin(TOUCH_CLK, TOUCH_MISO, TOUCH_MOSI, MY_TOUCH_CS);
  ts.begin();           // verwendet globale SPI — intern: SPI.begin() → No-Op
  ts.setRotation(1);    // Landscape: Rotation 1 passt zu Display-Rotation 3

  // GPIO-Diagnose (einmalig beim Boot)
  Serial.printf("[GPIO] CS=%d CLK=%d MOSI=%d MISO=%d\n",
    digitalRead(MY_TOUCH_CS), digitalRead(TOUCH_CLK),
    digitalRead(TOUCH_MOSI), digitalRead(TOUCH_MISO));

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
  setupRoutes();

  drawConnecting("Lade Daten...");
  bool ok = fetchData();
  if (!ok) {
    drawStartupError("API Fehler", "Pruefen: Host, Port und API-Key");
    delay(5000);
  }
  drawCurrentScreen();
  lastUpdate = millis();
}

// ── Loop ─────────────────────────────────────────────────

void loop() {
  server.handleClient();

  if (configMode) return;

  // Touch prüfen (XPT2046, VSPI)
  int tx, ty;
  if (mapTouch(&tx, &ty)) {
    if (ty > 180) {
      // ── Nav-Bar: 3 Buttons (je ~107px breit) ──────────
      int newScreen = (tx < 107) ? 0 : (tx < 214) ? 1 : 2;
      if (newScreen != activeScreen) {
        activeScreen = newScreen;
        drawCurrentScreen();
      }
    } else if (activeScreen == 2) {
      // ── Filter-Screen: Content-Tap → Filter auswählen ──
      // 4 Buttons bei y=26/72/118/164 (je 46px)
      // Tap-Bereiche: 0→Gesamt, 1→Jahr, 2→Monat, 3→Woche
      int idx = (ty < 72) ? 0 : (ty < 118) ? 1 : (ty < 164) ? 2 : 3;
      cfgFilter = FILTER_OPTS[idx].key;
      saveFilter();
      activeScreen = 0;
      drawConnecting("Lade Daten...");
      if (fetchData()) {
        drawCurrentScreen();
      } else {
        drawStartupError("API Fehler", "Filter konnte nicht geladen werden");
        delay(2000);
        drawCurrentScreen();
      }
    }
    // Warten bis Finger losgelassen, max 600ms (verhindert Ghost-Touches & Deadlock)
    unsigned long tRelease = millis() + 600;
    while (ts.touched() && millis() < tRelease) delay(10);
    delay(80);
  }

  // Daten aktualisieren
  if (millis() - lastUpdate >= (unsigned long)UPDATE_INTERVAL * 1000) {
    if (WiFi.status() != WL_CONNECTED) {
      WiFi.reconnect();
      unsigned long t = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - t < WIFI_TIMEOUT_MS)
        delay(200);
    }
    if (fetchData()) drawCurrentScreen();
    lastUpdate = millis();
  }
}
