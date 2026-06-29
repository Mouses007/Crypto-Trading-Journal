# Trading Widget (Android)

A native Android home-screen widget for the **Crypto Trading Journal**. It shows your
open Bitunix/Bitget futures positions **and** running Pionex bots with live PnL, plus a
KPI strip (balance, today's PnL, total PnL, win rate).

It reads the journal's read-only `GET /api/esp32/display` endpoint using the static
`X-ESP32-Key` header — the same data source as the ESP32 displays and the Cinnamon
desklet. No login/session is involved, so it keeps working even if you enable the
journal's optional password gate.

## Prerequisites

1. **Android Studio** (latest stable) — bundles the JDK, Android SDK and Gradle. Nothing
   else needs to be installed on the build machine.
2. An **ESP32 API key**: in the journal open **Einstellungen → ESP32 Display →
   „Key generieren"** and copy the key (shown once).
3. The journal must be reachable from the phone. Your phone's VPN is always on when off
   Wi-Fi, so `http://<server-ip>:8080` is reachable everywhere — use that host/port.

## Build & install

1. Open the `android-widget/` folder in Android Studio (`File → Open`). On first open it
   will sync Gradle and, if asked, set up the Gradle wrapper (Gradle 8.9) automatically.
2. Connect your phone with USB debugging enabled, or build an APK:
   - **APK:** `Build → Build Bundle(s)/APK(s) → Build APK(s)`, then copy
     `app/build/outputs/apk/debug/app-debug.apk` to the phone and open it
     (allow „install from unknown sources").
   - **Direct run:** select your device and press ▶.
3. From a terminal you can also run (after Android Studio created the wrapper):
   `./gradlew assembleDebug`.

## Add & configure the widget

1. Long-press the home screen → **Widgets** → **Trading Widget** → drag it out.
2. The config screen opens: enter **Host** (e.g. `192.168.178.100`), **Port** (`8080`),
   the **ESP32 key**, and a **time range**. Tap **Verbindung testen** to verify, then
   **Speichern**.
3. The widget refreshes automatically (~every 15 min, Android's minimum for background
   widget updates) and on demand via the **↻ button**. Tap the **title** to reopen config.

## How it works (for maintenance)

- `ApiClient` — one OkHttp GET with the `X-ESP32-Key` header; returns raw JSON.
- `RefreshWorker` (WorkManager `CoroutineWorker`) — fetches off the main thread, caches the
  JSON per widget in `Prefs`, then re-binds widgets and reloads the list.
- `TradingWidgetProvider` (`AppWidgetProvider`) — builds the header/KPIs, wires the list
  adapter and PendingIntents (refresh broadcast, title→config), schedules periodic +
  one-shot refresh.
- `PositionsRemoteViewsService` / factory — turns the cached JSON into the scrollable list
  (Futures section + Bots section). Bot PnL/margin is shown in its `marginCoin`
  (e.g. SOL for Coin-M), never force-converted to USDT.
- `WidgetConfigActivity` — host/port/key/filter, „test connection", saved per widget.

### Android touchpoints worth knowing (new to Android)
- **RemoteViews** only supports a limited set of views — that's why layouts use plain
  `LinearLayout`/`TextView` and a `ListView` collection (not RecyclerView).
- A scrollable widget list = `RemoteViewsService` + `RemoteViewsFactory` (the „collection
  widget" pattern). Each widget instance gets its own factory via a unique intent `data` Uri.
- **PendingIntent** must use `FLAG_IMMUTABLE`.
- Background refresh uses **WorkManager** (min period 15 min); there is no 30-second polling
  like the desklet — that's an OS limitation for home-screen widgets.

## Versioning

`versionName` tracks the journal app version (currently **3.3.0**).
