# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Crypto Trading Journal is a **local single-user** trading journal for **Bitunix futures trading**. It lets users import trades via CSV or Bitunix API, view dashboards with analytics/charts, keep a diary, manage playbooks, and store screenshots. Licensed under GPL-3.0.

**Key simplifications from the original project:**
- No cloud login (single user, direct to dashboard); API protected by session cookie
- SQLite (or optional PostgreSQL) instead of MongoDB/Parse Server (no Docker needed)
- Bitunix primary; optional Bitget broker (CSV + API)
- No Stripe payments, no PostHog analytics, no Shepherd tours
- KI-Agent: AI reports/chat (Ollama, OpenAI, Anthropic, Gemini, DeepSeek)

README.md and this file are kept in sync for project and architecture description.

## Tech Stack

- **Frontend**: Vue 3 (Composition API with `<script setup>`), Vue Router, Vite; state via `ref()`-Exporte in `src/stores/` (kein Pinia)
- **Backend**: Express.js with Knex (SQLite default, optional PostgreSQL)
- **Charts**: Apache ECharts
- **Styling**: Bootstrap (CDN in `index.html`), custom dark theme via CSS variables (`src/assets/style-dark.css`)
- **Other key libs**: dayjs (dates/timezones), PapaParse (CSV), Quill (rich text), markerjs2 (screenshot annotation), lodash, axios

## Commands

```bash
npm install          # Install dependencies
npm run build        # Vite production build (output to dist/)
npm start            # Start production server (node index.mjs)
npm run dev          # Start dev server with Vite HMR
npm run test:self    # Run all self-tests (scripts/run-selftests.mjs)
```

There is **no test framework, no linter, and no CI/CD pipeline** configured.
What does exist are standalone self-test files (`server/**/__selftest*.mjs`,
`src/utils/__selftest*.mjs`, `shared/__selftest*.mjs` — `npm run test:self`
zeigt den aktuellen Stand, Zahlen hier veralten schneller als Prosa)
covering the strategy layer (detectors, fill simulation incl. liquidation,
look-ahead, live gates, statistics, robustness, journal bridge, coin ranking),
session-cookie handling, the funding sign convention, and the live-trading
layer (trading hours incl. the DST gaps between US and EU changeover, the
liquidation ring buffer, the intraday candle parser, session P&L).
`npm run test:self` runs each in its own process and prints one summary; run it
after touching anything under `server/strategies/`, `server/fill-simulator.js`,
`server/strategy-*.js`, `server/live-gates.js`, `server/liq-ticker.js`,
`server/sitzung-rechnung.js`, `server/makro.js` or `shared/handelszeiten.js`.
Directories are listed in `ORTE` in `scripts/run-selftests.mjs` — a new one has
to be added there or its tests are silently skipped.

Not covered: CSV import (`brokers.js`/`addTrades.js`), journal P&L
(`src/utils/trades.js`), the REST CRUD layer, and anything rendered in the
frontend.

## Architecture

### Server

- **`index.mjs`** — Entry point: Express server + DB init (Knex) + API routes. Session cookie set for all non-API requests; all `/api/*` require valid session. In dev mode (`NODE_ENV=dev`), proxies non-API requests to Vite dev server on port 39482. In production, serves static files from `dist/`. Default bind: `127.0.0.1` (override with `CTJ_HOST`).
- **`server/database.js`** — Knex setup: **`initDb()`** / **`getKnex()`**. Schema and migrations in code. Default: SQLite (**`tradenote.db`** in project root, WAL mode). Optional PostgreSQL via **`server/db-config.js`** and `db-config.json`. Tables: settings, trades, diaries, screenshots, playbooks, satisfactions, tags, notes, excursions, bitunix_config, bitget_config, incoming_positions, ai_reports, ai_report_messages, market_snapshots (daily snapshots of values without free history, e.g. BTC dominance), radar_fetch_state (claims for periodic tasks), calendar_events, live_sessions (one row per trading session in the live-trading window: plan, notes, verdict, frozen trade snapshot), etc. `SCHEMA_VERSION` at the top guards against an older code stand writing against a newer schema — it only warns, it never aborts.
- **`server/auth.js`** — Session cookie (`tn_session`) for API auth; token generated at startup.
- **`server/api-routes.js`** — Generic REST CRUD (`GET/POST/PUT/DELETE /api/db/{table}`) using Knex; table/column whitelist; settings and bitunix_config endpoints (bitunix_config response omits secretKey).
- **`server/bitunix-api.js`** — Bitunix API client (SHA256 double-hash auth); encrypt/decrypt for API keys; proxy endpoints for positions.
- **`server/bitget-api.js`** — Bitget API (HMAC-SHA256); encrypt/decrypt for keys.
- **`server/binance-api.js`** — Binance public klines proxy (no API key needed, CORS bypass).
- **`server/ollama-api.js`** — AI: Ollama, OpenAI, Anthropic, Gemini, DeepSeek (reports + chat).
- **`server/ai-agent.js`** — Autonomous KI-Agent with tool use / function calling. Supports Anthropic (native), OpenAI/DeepSeek (native), Gemini (native), Ollama (prompt-based fallback). Agent loop runs via SSE streaming; max 10 iterations; concurrency-guarded (one run at a time).
- **`server/ai-agent-tools.js`** — Tool definitions and `executeTool()` for the agent loop (DB queries, trade analysis, etc.). Also `query_app_help` (answers about the software itself, sourced from `server/app-hilfe.js`) and `query_marktradar` (current Marktradar tile readings via `sammleKacheln`/`baueZeilen` — same cached `hole*` functions the tiles use).
- **`server/app-hilfe.js`** — Built-in German usage documentation of the app, one section per topic. Single source the KI-Agent may quote about the software; describes the UI, not the implementation.
- **`server/flux-api.js`** — Share Card API: generates stylized trade share images using FLUX.2 (Black Forest Labs) AI backgrounds + SVG overlay. Uses `sharp` for image processing. Admin: `/api/flux/*`.
- **`server/esp32-api.js`** — Read-only endpoint for ESP32-2432S028 (CYD) hardware display. Auth via static API key in `X-ESP32-Key` header (key stored encrypted in `settings.esp32ApiKey`). `/api/esp32/display` is public (no session); admin routes behind session.
- **`server/backup-api.js`** — JSON export/import of all DB tables. Redacts sensitive keys (AI keys, etc.) on export. Handles import order to respect FK constraints.
- **`server/update-api.js`** — Checks GitHub releases (`GET /api/update/check`) and performs one-click update via git fetch+reset+npm install (`POST /api/update/install`). Repo: `Mouses007/Crypto-Trading-Journal`.
- **`server/polygon-api.js`** — Polygon.io proxy (e.g. market data).
- **`server/marktradar-api.js`** — Marktradar tiles: Fear & Greed, BTC dominance, funding rates, long/short + OI, RSI scatter, market overview (CoinGecko), rainbow chart, 24h liquidations (from own recordings), trades × market regime, altcoin season, Pi Cycle Top. One endpoint per tile under `/api/marktradar/*`, each with its own TTL cache, in-flight de-duplication and **stale-fallback** (`veraltet: true` instead of an empty tile). Binance markets are filtered to `underlyingType === 'COIN'`. The dominance series (BTC/ETH/total, ~6 years) is imported once from CoinMarketCap's public web endpoint into `market_snapshots` and refreshed daily — the curve is drawn from our own data, no third-party embed (content blockers killed the previous TradingView widget).
- **`server/marktradar-lage.js`** / **`server/lagebild.js`** — Tile "Gesamtlage": an LLM summarises what the other tiles currently show. `marktradar-lage.js` collects the payloads through the same `hole*` functions the tiles use (so a run normally causes no extra third-party requests, each source capped at 12 s), calls the configured provider and caches per symbol in memory (20 min TTL, 60 s floor for a forced re-run). `lagebild.js` is the pure part — tile payloads → text lines, and validation of the model's answer — and is covered by `__selftest-lagebild.mjs`. **`GET /api/marktradar/lage` only ever reads the cache; generating costs money and happens on `POST` only** — otherwise the page's polling and "Refresh all" would bill on every click. Routes are wired in `index.mjs` rather than in `setupMarktradarRoutes` because the module imports from `marktradar-api.js` (the other direction would be a cycle). Budget note: `maxTokens` is 3000 instead of the usual 800 because the requested answer is long (~2000 output tokens measured); at 900 and 1800 the JSON came back truncated, i.e. paid for and worthless.
- **`server/marktradar-kalender.js`** — Economic calendar. The ForexFactory feed only ever carries the *current* week, so events are collected into `calendar_events` (deduped by a `sha1(country|title|time)` fingerprint). A second source adds reach: the Fed publishes its own calendar as JSON months ahead (FOMC, Beige Book) — those are imported for dates **beyond** the current week so the two sources never overlap.
- **`server/marktradar-news.js`** — News sources (YouTube/RSS/Telegram/Truth/X), fetching, retention, and the AI briefing. Multiple providers on purpose: the briefing is written by the *configured* provider (Claude), YouTube videos go to Gemini first (the only one that opens a video URL itself; summarized as bullet points), X sources are fetched via one paid Grok `x_search` call per run (xAI Responses API, 4h cooldown), and Perplexity Sonar adds one research call per selected topic (citations become numbered Belege). The briefing is chaptered (crypto/finanzen/tech selectable), sized (kurz/mittel/lang → maxTokens override), daily or weekly (weekday selectable), and prepends a Marktradar data block (Fear&Greed, dominance, funding, long/short, altseason — internal calls via `ausCache`). Two filters: the per-source `laerm` flag + `radarArschlochfilter` switch (UI label "Temporär ausschliessen") skips sources at fetch time; the keyword "Arschlochfilter" (`radarArschlochAn`/`radarArschlochWoerter` + automatic Truth Social exclusion, logic in `server/news-recherche.js:istGefiltert`) filters delivery and briefing basis only, so stored items react retroactively to word-list changes. Reports live in `news_digests` (incl. `kapitel`/`themen`/`laenge`), browsable via `GET /api/marktradar/lagebericht/:id` (archive) and deletable per id. Caps: videos per run, low media resolution by default, one report per day/week.
- **`server/net-guard.js`** / **`server/feed-parser.js`** — SSRF guard for user-entered feed URLs (public hosts only, no private ranges, redirects re-checked) and a slim reader for RSS, Atom and public Telegram channel pages.
- **`server/livetrading-api.js`** — Endpoints of the live-trading window: `/api/livetrading/indizes` (ES=F, NQ=F, DX-Y.NYB as intraday candles from the same key-less Yahoo v8 endpoint the Makro tile uses — parsed by the new `ohlcAusChart` in `makro.js`, which keeps OHLC where `reiheAusChart` keeps only closes), `/kalender-countdown` (next hours from `calendar_events` via `leseKalender`, passing `gesamtImZeitraum` through so a tile can tell "nothing happening" from "all filtered out"), `/liq-ticker` and `/session-stand`. All go through `ausCache`/`sendeRadar`, so every open tab shares one fetch. **`/session-stand` deliberately uses `getHistoryPositions` and NOT `/api/bitunix/recent-closed`** — the latter writes `bitunix_config.lastHistoryScan` on every call and a polling tile would keep resetting the trade-import window.
- **`server/liq-ticker.js`** — In-memory ring buffer (30 min / 20k events) for the live liquidation ticker, filled next to the recorder's write buffer. Needed because `live-recorder.js` flushes to the DB only every 30 s, so a DB read lags for "what just happened". Does **not** touch the side convention — all three hook points already store `1 = SHORT liquidated`.
- **`server/sitzung-rechnung.js`** — Pure calculation of a running session: realised and unrealised P&L stay **separate** (a floating book gain is not a result), and the plan limits count against the **realised** part only — otherwise the bar breaks on every pullback.
- **`shared/handelszeiten.js`** — Trading sessions, market marks and volatility windows. Each session carries its own zone as wall-clock time, because the US and EU switch to summer time weeks apart; a fixed offset is wrong two to three times a year. Shared between browser (per-second countdown) and server. Holidays and calendar events are passed in from outside so the module stays net-free.
- **`server/db-claim.js`** — Database-backed throttle for periodic work. `beansprucheAufgabe(key, ttl)` for "once per interval", `beansprucheFuehrung/verlaengereFuehrung/gibFuehrungFrei` for a renewable leader lock. Needed because every other guard in the project is process-local while NAS container and dev server share one PostgreSQL.
- **`server/logger.js`** — Shared logging utility (`logWarn`, `logError`) used across server modules.

### Key Backend Patterns

**`objectId` mapping**: SQLite uses `id` (auto-increment), but the frontend expects `objectId` (legacy from Parse). `api-routes.js` maps `id` → `objectId` in all responses and `objectId` → `id` in incoming requests.

**JSON columns**: Certain columns (e.g., `trades.executions`, `trades.blotter`, `trades.pAndL`, `screenshots.maState`) are stored as TEXT in SQLite. `api-routes.js` auto-stringifies on write and auto-parses on read via the `JSON_COLUMNS` config object.

**Boolean conversion**: JavaScript `true`/`false` ↔ SQLite `1`/`0`, handled in api-routes.js.

### Frontend (`src/`)

**Import alias**: `@` resolves to `src/` (configured in `vite.config.js`).

**Layout system**: `App.vue` renders `<component :is="$route.meta.layout">` — all routes use `DashboardLayout` (side menu + nav + content area). Routes defined in `src/router/index.js`, all lazy-loaded.

**State management** (`src/stores/globals.js`): Uses Vue `ref()` and `reactive()` exports directly — **not Pinia stores**. Components import and mutate these directly. Filter state (selected tags, positions, date ranges, etc.) is persisted to `localStorage`.

**`currentUser.value`**: Holds app settings loaded from the SQLite `settings` table via `dbGetSettings()`. This is not a user object — it's the single-user settings record.

### Data Layer

All DB operations go through `src/utils/db.js` which calls the Express REST API via axios:
- `dbFind(table, options)` — query with filters, sort, limit
- `dbCreate(table, data)` / `dbUpdate(table, id, data)` / `dbDelete(table, id)`
- `dbGetSettings()` / `dbUpdateSettings(data)` — singleton settings record

### Mount Orchestration

View initialization follows a pattern in `src/utils/utils.js`:
- `useMountDashboard()` — sequential + parallel promise chains: fetch data → filter → calculate totals → group → render charts
- `useMountDaily()`, `useMountCalendar()`, `useMountScreenshots()` — similar patterns per view
- Each manages spinner state (`spinnerLoadingPage.value`) and mounted flags

### Business Logic Utils

- `trades.js` — Query/filter/group trades, P&L calculations (`useGetFilteredTrades`, `useGroupTrades`, `useCalculateProfitAnalysis`)
- `addTrades.js` — Import Bitunix CSV/API data (~2000+ lines, contains dead code from old import flow — left intentionally)
- `brokers.js` — Bitunix-only CSV parser (PapaParse)
- `charts.js` — ECharts configuration and rendering

### Key Views

- `Marktradar.vue` — Tile grid in the "Live-Analyse" mode (`/marktradar`, also the mode's landing page). The **page fetches, the tile draws**: the enlarged view is a second instance of the same component fed the same data. Hidden tiles are not loaded at all. Visibility, order and per-tile size live in `localStorage`; tiles are registered in `src/config/marktradar.js` and implemented under `src/components/radar/`. Fourteen tiles — news and the calendar moved to their own page.
- `Livetrading.vue` — Live-trading window (`/livetrading`), the workspace for the hours actually spent trading. Same grid mechanics as the Marktradar — both use `src/composables/useKachelRaster.js` (loading, polling, dragging, resizing) with their own registry, `localStorage` key and check interval (3 s instead of 30 s; per-tile `intervallMs` still decides when a fetch happens). Registry: `src/config/livetrading.js`. Three extra registry fields: `gross: false` (no enlarging — the enlarged view is a *second instance*, which for the Bookmap would mean a second WebSocket and a shared module singleton for freeze state), `minSpalten`, `mobilAus`. Above the grid sits the session bar: the plan (max loss, max trades, intent) is entered **before** starting and is not editable afterwards. Starting a session opens the page in its **own browser window** in cockpit state (`?cockpit=1` — `Dashboard.vue` drops the side menu and the nav there, and the content gets full width), so nothing else is within reach during a session; `src/utils/livetradingFenster.js` handles it, falling back to the current tab if a popup blocker intervenes. Real fullscreen is a button, not an automatism: the Fullscreen API needs a gesture *in the document going fullscreen*, and the click that opened the window happened in the opener. **Desktop only** (`nurDesktop` in `menu.js`): eleven tiles, an order book and a candle chart cannot be operated on 375 px, and a tool that half-works leads to decisions on half the information. Switchable off via the `livetradingAn` setting — then the start button on the Marktradar, the menu entry and the route all disappear.
- `LiveSessions.vue` — Session archive (`/live-sessions`). Together with `Livetrading.vue` and `LiveAuswertung.vue` it forms the `liveTrade` menu group in the **live** mode — everything about live trading in one place. The headline figure is not P&L but whether the plan held. Replay only becomes clickable once `/api/live/recorder/available` confirms a recording exists for that symbol and window. Sessions can be **archived** (`archiviert` column) instead of deleted — the discipline tally deliberately keeps counting archived ones, otherwise the number could be improved by tidying up. A session is a **period, not a market**: the symbol may change during it, every switch lands in the log, and `symbol` follows the last one picked (that is what the replay button needs).
- `LiveAuswertung.vue` — Four questions about the sessions, building on each other: do I keep my plan and am I improving, does the plan help at all, at which times do I trade well, does it turn with duration or trade count. Computation lives in `src/utils/sitzungStatistik.js` (pure, no Vue, no network — selftest alongside it); the view only draws. Groups below `MIN_GRUPPE` carry `duenn: true` and are greyed out: three sessions on a Tuesday are noise, not a finding. Same approach as `KachelRegime.vue`.
- `Nachrichten.vue` — News page (`/nachrichten`): AI briefing at the top styled as a newspaper article (serif headline, chapter per topic, two-column body, drop cap), with an archive browser (open/delete old reports, two-click delete) and compact 3-column point tiles below; then economic calendar with adjustable range/impact/countries, and the raw posts with thumbnails. YouTube posts appear in the list with a "Video" badge and their collapsible bullet-point summary (they also feed the briefing).

- `KiAgent.vue` — Frontend for the autonomous KI-Agent (SSE-based streaming, tool-call visualization)
- `Incoming.vue` — Live open positions from Bitunix API
- `Imports.vue` — CSV / API trade import UI

### Key Components

- `ShareCardModal.vue` — Trade share card generator (FLUX.2 AI image + SVG overlay via `flux-api.js`)
- `TradeEvalPopup.vue` — Trade evaluation/rating popup (SL/TP, RRR, etc.)
- `SidebarFilters.vue` — Global filter panel (tags, date range, position type); state in `globals.js`

### Styling

Dark theme uses CSS custom properties defined in `src/assets/style-dark.css`:
- Color vars: `--blue-color`, `--grey-color`, `--black-bg-*`, `--white-*`
- Layout vars: `--border-radius`, `--shadow-sm`
- Utility classes: `.greenTrade`, `.redTrade`, `.dailyCard`, `.chartClass`

Bootstrap loaded from CDN (not bundled).

### Environment Variables

- `CTJ_PORT` — Server port (default 8080; also accepts `PORT`)
- `CTJ_HOST` — Bind address (default 127.0.0.1; use 0.0.0.0 for network access)
- `CTJ_SECRET` — Secret for session token / crypto key derivation (required in production)
- `NODE_ENV=dev` — Enable Vite dev server with HMR

No `.env` files — runtime config stored in DB (settings table) and localStorage. Optional DB: `db-config.json` for PostgreSQL.

### Bitunix / Bitget Integration

**CSV Import**: Bitunix CSV export; parses "Futures Profit"/"Futures Loss" rows into trade objects. Bitget CSV supported where implemented.

**API Import**: Configure API Key + Secret (Bitunix) or API Key + Secret + Passphrase (Bitget) in Settings. Keys are encrypted at rest (`server/crypto.js`). Server-side proxies (`/api/bitunix/*`, `/api/bitget/*`) fetch positions; Bitunix uses SHA256 double-hash auth.
