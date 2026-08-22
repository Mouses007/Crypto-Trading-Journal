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
node scripts/fixtures-auffrischen.mjs   # compare stored API fixtures against live
node scripts/fixtures-auffrischen.mjs --schreiben   # …and update them
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

`server/__selftest-datenvertrag.mjs` is a different kind of test: it asserts
which FIELDS of the third-party responses the code depends on, running against
captured real answers in `server/fixtures/`. Every other test checks
mathematics — which is exactly why the GoPlus gap went unnoticed for months
(`lp_holders` is absent from the Solana response; the arithmetic was correct,
it just computed with nothing). On its first run it found two more: the code
read `cannot_sell_all`, a field GoPlus v1 does not have at all, and an empty
`sell_tax` became 0 % via `Number('')`. `scripts/fixtures-auffrischen.mjs`
re-fetches and reports **disappeared** fields; it is deliberately not part of
`npm run test:self`, because that must work without network.

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
- **`server/marktradar-news.js`** — News sources (YouTube/RSS/Telegram/Truth/X), fetching, retention, and the AI briefing. Multiple providers on purpose: the briefing is written by the *configured* provider (Claude), YouTube videos go to Gemini first (the only one that opens a video URL itself; summarized as bullet points), X sources are fetched via one paid Grok `x_search` call per run (xAI Responses API, 4h cooldown), and Perplexity Sonar adds one research call per selected topic (citations become numbered Belege). The briefing is chaptered (crypto/finanzen/tech selectable), sized (kurz/mittel/lang → maxTokens override), daily, weekly (weekday selectable) or manual-only, and prepends a Marktradar data block (Fear&Greed, dominance, funding, long/short, altseason — internal calls via `ausCache`). Two filters: the per-source `laerm` flag + `radarArschlochfilter` switch (UI label "Temporär ausschliessen") skips sources at fetch time; the keyword "Arschlochfilter" (`radarArschlochAn`/`radarArschlochWoerter` + automatic Truth Social exclusion, logic in `server/news-recherche.js:istGefiltert`) filters delivery and briefing basis only, so stored items react retroactively to word-list changes. Reports live in `news_digests` (incl. `kapitel`/`themen`/`laenge`, plus `art`/`basisId`/`updateNr` for updates), browsable via `GET /api/marktradar/lagebericht/:id` (archive) and deletable per id. Caps: videos per run, low media resolution by default, one report per day/week. **Interim notes** (`radarNewsUpdates` 0–2, hours in `radarNewsUpdateStunden`) are a *separate, shorter* report, not a rewrite: the item window starts at `basis.erstelltAm`, Perplexity is asked a different question ("what happened since HH:MM that matters for a crypto futures trader — figures, decisions, dates"), the length drops one step (`laengeFuerUpdate`), the chartanalyse chapter is dropped, and the day's report is supplied only as a *do-not-repeat* block (`kompaktVorbericht`, which re-numbers its Belege so a correction can still cite them). Points that correct the morning report carry `korrektur: true`. Each slot has its own daily claim (`UPDATE_SCHLUESSEL(n)`); a missed slot is not caught up (`faelligerUpdatePlatz` returns only the latest one due), and an update never runs before the day's report exists. `POST /api/marktradar/lagebericht/aktualisieren` is the by-hand path.
- **`server/news-doppler.js`** — Deduplication pass over a finished report, run before it is stored. The model writes one text, the page shows six blocks (market table, overall Lage, Abwägung, chapter Lage, points, figure chips), and the same measurement lands in three of them — "Fear & Greed 63" stood on the page three times on 21.08.2026. Pure and testable, no second (paid) model call. **Two signals must coincide** before a sentence is dropped: a shared FIGURE and a shared word fraction — the number alone would merge "58,2 % dominance" with "58,2 % of accounts are long". Numbers that are not measurements are excluded (time spans, dates, indicator periods like `EMAs 20/50/100/200`) — they were the most frequent false positive. Deliberately exempt: the **Abwägung** is deduped only against ITSELF and per column, because it *is* the restatement in another frame, and "offen" asks the question about the fact in "dafuer"; the market table only silences the chips that repeat it, never the prose. Measured against stored reports: 4–7 % of text, two chips each. Selftest carries a counter-check for every catch — a pass that eats too much is more dangerous than one that finds nothing.
- **`server/news-themen.js`** — The same problem from the other side: `news-doppler.js` cuts repetition out of a *finished* report, but the duplicate paragraph was written and paid for by then, and what it displaced nobody learns. A report with eight points of which two cover the same event really had seven topics. So posts are grouped into topics **before** the prompt, each group gets an id, and the brief says "at most ONE report per topic" — the model cannot emit a topic twice without issuing the id twice, which is checkable instead of guessable (`gruppiereBeitraege`, `themenRegel`, `haltEinsProThema`). A word weighs more the **rarer it is in the current run**: "bitcoin" sits in every third crypto post, "fomc" or "blackrock" in two of sixty — two posts sharing one of those are almost always the same event. A fixed stopword list would be wrong here, because what is common depends on the day. The rule everything hangs on is that the two shared content words must stand **in both TITLES**: measured against the real stock of 21.08.2026 that decided all eight cases correctly, while "shared anywhere in the text" merged half of them wrongly — a headline IS the topic announcement, body text wanders, and two long articles touch somewhere always. Threshold 0.45 over weights of 0–1, so it does not depend on run length. Pure — no net, no DB, no model call; the selftest checks both directions, and the second one (different stays separate) is the important one: a bundler that merges too much suppresses reports, and nobody notices, because what is missing is not there.
- **`server/hype-radar-api.js`** / **`server/hype-radar/*`** — Hype-Radar: young coin projects from CoinGecko, DexScreener, GeckoTerminal (`quellen.js`), scored from five sub-scores (`bewertung.js`), filtered for scam patterns via GoPlus with a **RugCheck fallback** (`sicherheit.js` — GoPlus 504s on Solana, and almost every meme find is on Solana, so "unchecked → rejected" would have been the normal state), exchange listings split by spot/futures (`listungen.js`), AI report (`bericht.js`). `wachhund.js` watches favourites and holds **two rule sets**: `pruefeRegeln` for DEX finds (price, liquidity drain, safety re-check) and `pruefeRegelnBoerse` for Coin-Radar favourites (`hype_favoriten.quelle = 'coinradar'` — turnover collapse, widening spread, extreme funding; a Bitunix perp has no liquidity pool). Spread and funding fire on **crossing** the threshold, not while above it, or a permanently expensive coin would beep forever. Delivery in `zustellung.js` (ntfy/Telegram/webhook). `STANDARD_ALARM_REGELN` is the single source of the thresholds — `VORGABEN.alarmRegeln` is deliberately empty and the route fills it in, because a second list drifted the moment new thresholds were added.
- **`server/coin-radar-api.js`** / **`server/coin-radar/*`** — Coin-Radar: which of the tradable coins can be traded *now*. `daten.js` has the two paths — `holeMarktweit()` (three bulk Binance calls, 61 weight, covers every perp) and `holeKerzenGebremst()` (candles only for survivors, `warteAufGewicht` before each, because `getClosedCandles` is the deliberately unbraked live path). `kennzahlen.js` computes ATR%/RVOL/ADX from `strategies/indicators.js` — RVOL against `volumeSma(kerzen.slice(0,-1), 20)` so an outlier does not damp its own baseline. `bewertung.js` is pure: liquidity is a **gate, not a sub-score**, and unknown data is never scored as good (missing spread → rejected, missing funding → 50 points + hint). **`minTiefeUsd` defaults to 0**: `bookTicker` returns the best bid/ask *size*, which tracks tick size, not book depth — measured, a gate on it rejected ACEUSDT (559M turnover, 0.49 bp spread, 5 USD at the top) and BTWUSDT (892M), which without it ranks 13th at 7.72 % ATR. `rangkorrelation()` (Spearman over the intersection, min 10 symbols) is the honest self-check and is shown next to the headline figures, not in the fine print. `einordnung.js` writes one paragraph per run via the Hype-Radar's `editor` role and **rejects forecasts** — its guard matches the future tense (`dürfte`, `wird … steigen`, Kursziel), never the bare verb, because matching `steigen`/`fallen` silently discarded paid, factual paragraphs ("in diese Gruppe fallen 20 Coins", "auffallen"). A full run: ~42 s, 360 of the 1000/min weight budget.
- **`server/coin-radar/boersen.js`** / **`ausfuehrung.js`** — the venue layer (audit R-01/R-02/R-07). One shape per exchange: `holeTicker()` bulk for all symbols, `holeTiefe(symbol)` only for survivors. The exchanges are unequal and that shapes the code: Bitget returns bid/ask **with sizes**, funding and open interest in one call; Bitunix — the journal's execution venue — carries no quotes in its ticker, so spread and depth must come from the book (and its `limit` accepts only 1/5/15/50/`max`, 100 is rejected). **Pionex is absent for lack of a verified order book, not for lack of perpetuals** — the older note here claimed the latter, reading 405 spot-only markets off `/api/v1/common/symbols`; that is the spot endpoint. Perps live at `/api/v1/market/tickers?type=PERP` (602 measured 21.08.2026) and `hype-radar/listungen.js` already queries it. `ausfuehrung.js` needs a book, and no public depth endpoint is verified, so Pionex stays a listing hint: it appears in the exchange filter, not in the execution measurement. `ausfuehrung.js` is pure: VWAP slippage for 1k/5k/10k USD, **buy and sell separately** (a book that is cheap to enter and expensive to exit is a trap no average shows), depth within ±10/25/50 bp, measured against the **mid** — measuring against the best quote hides half the spread. If the amount does not fit the book, nothing is extrapolated: `vollstaendig: false` and the score is 0, not a deduction.
- **`server/radar-ergebnisse.js`** / **`radar-guete.js`** — outcome tracking (audit R-06). The rank correlation between two runs measures *persistence*, not usefulness; a stable ranking can be stably wrong. `radar_ergebnisse` freezes what the page claimed (rank, score, price) and a takt redeems the orders when due. `radar-guete.js` is the pure evaluation: it measures the **span** (MFE − MAE), not the return, because the page promises movement and not direction — and it always reports the **control group** (bottom half), since on a busy day everything moves and Precision@10 alone would look perfect. Weights are deliberately *not* auto-optimised against it.
- **`server/net-guard.js`** / **`server/feed-parser.js`** — SSRF guard for user-entered feed URLs (public hosts only, no private ranges, redirects re-checked) and a slim reader for RSS, Atom and public Telegram channel pages.
- **`server/livetrading-api.js`** — Endpoints of the live-trading window: `/api/livetrading/indizes` (ES=F, NQ=F, DX-Y.NYB as intraday candles from the same key-less Yahoo v8 endpoint the Makro tile uses — parsed by the new `ohlcAusChart` in `makro.js`, which keeps OHLC where `reiheAusChart` keeps only closes), `/kalender-countdown` (next hours from `calendar_events` via `leseKalender`, passing `gesamtImZeitraum` through so a tile can tell "nothing happening" from "all filtered out"), `/liq-ticker` and `/session-stand`. All go through `ausCache`/`sendeRadar`, so every open tab shares one fetch. **`/session-stand` deliberately uses `getHistoryPositions` and NOT `/api/bitunix/recent-closed`** — the latter writes `bitunix_config.lastHistoryScan` on every call and a polling tile would keep resetting the trade-import window.
- **`server/liq-ticker.js`** — In-memory ring buffer (30 min / 20k events) for the live liquidation ticker, filled next to the recorder's write buffer. Needed because `live-recorder.js` flushes to the DB only every 30 s, so a DB read lags for "what just happened". Does **not** touch the side convention — all three hook points already store `1 = SHORT liquidated`.
- **`server/sitzung-rechnung.js`** — Pure calculation of a running session: realised and unrealised P&L stay **separate** (a floating book gain is not a result), and the plan limits count against the **realised** part only — otherwise the bar breaks on every pullback.
- **`shared/handelszeiten.js`** — Trading sessions, market marks and volatility windows. Each session carries its own zone as wall-clock time, because the US and EU switch to summer time weeks apart; a fixed offset is wrong two to three times a year. Shared between browser (per-second countdown) and server. Holidays and calendar events are passed in from outside so the module stays net-free.
- **`server/db-claim.js`** — Database-backed throttle for periodic work. `beansprucheAufgabe(key, ttl)` for "once per interval", `beansprucheFuehrung/verlaengereFuehrung/gibFuehrungFrei` for a renewable leader lock. Needed because every other guard in the project is process-local while NAS container and dev server share one PostgreSQL.
- **`server/llm.js`** — Single transport for one-shot LLM calls (`ladeLlmConfig`, `callLLMJson`): one function per provider, plus credit/key error bookkeeping. Used by the news briefing, the "Gesamtlage" tile and the strategy layer. Reports/chat (`ollama-api.js`) and the agent loop (`ai-agent.js`) still carry their own HTTP paths — consolidating them onto this module is the open item from the 19.08.2026 audit.
- **`server/ai-models.js`** — Registry of providers and models: which key column, which endpoint, which sampling fields a model still accepts (`samplingFelder` — the Claude 5 models reject `temperature` with a 400). Registry only, no transport.
- **`server/benachrichtigungen.js`** — Notification channels per event type (mail, push), including the "nothing happened" guard.
- **`shared/liquidation.js`** — The one liquidation formula (exchange formula, maintenance margin as a fraction), imported by the backtest and the leverage map. Canon since the 19.08.2026 audit; the maintenance rate itself comes per symbol from `server/margin-rates.js`.
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

View initialization follows a pattern in `src/utils/mountOrchestration.js`:
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
- `Livetrading.vue` — Live-trading window (`/livetrading`), the workspace for the hours actually spent trading. Same grid mechanics as the Marktradar — both use `src/composables/useKachelRaster.js` (loading, polling, dragging, resizing) with their own registry, `localStorage` key and check interval (3 s instead of 30 s; per-tile `intervallMs` still decides when a fetch happens). Registry: `src/config/livetrading.js`. Three extra registry fields: `gross: false` (no enlarging — the enlarged view is a *second instance*, which for the Bookmap would mean a second WebSocket and a shared module singleton for freeze state), `minSpalten`, `mobilAus`. Above the grid sits the session bar: the plan (max loss, max trades, intent) is entered **before** starting and is not editable afterwards. Starting a session opens the page in its **own browser window** in cockpit state (`?cockpit=1` — `Dashboard.vue` drops the side menu and the nav there, and the content gets full width), so nothing else is within reach during a session; `src/utils/livetradingFenster.js` handles it, falling back to the current tab if a popup blocker intervenes. Real fullscreen is a button, not an automatism: the Fullscreen API needs a gesture *in the document going fullscreen*, and the click that opened the window happened in the opener. **Desktop only** (`nurDesktop` in `menu.js`): eleven tiles, an order book and a candle chart cannot be operated on 375 px, and a tool that half-works leads to decisions on half the information. Switchable off via the `livetradingAn` setting — then the start button on the Marktradar, the menu entry and the route all disappear. Above it sits the mode switch `modusLiveAn`: every mode except the journal can be turned off individually (`flag` on the `MODES` entries in `menu.js`, evaluated by `istModusAn()`), and off means off — the tab goes, the side menu renders nothing, and a central `watch([currentUser, route.fullPath])` guard in `layouts/Dashboard.vue` redirects even a cold deep link. The guard lives there and not in the router because on a cold deep link `currentUser` is still null and a `beforeEach` would have to guess; it waits instead (`if (!u) return` — unknown is not a no). This replaced `betaAusblenden`, which only hid the tab while `/hype-radar` stayed reachable by URL; a one-time migration in `database.js` carries the old setting over.
- `LiveSessions.vue` — Session archive (`/live-sessions`). Together with `Livetrading.vue` and `LiveAuswertung.vue` it forms the `liveTrade` menu group in the **live** mode — everything about live trading in one place. The headline figure is not P&L but whether the plan held. Replay only becomes clickable once `/api/live/recorder/available` confirms a recording exists for that symbol and window. Sessions can be **archived** (`archiviert` column) instead of deleted — the discipline tally deliberately keeps counting archived ones, otherwise the number could be improved by tidying up. A session is a **period, not a market**: the symbol may change during it, every switch lands in the log, and `symbol` follows the last one picked (that is what the replay button needs).
- `LiveAuswertung.vue` — Four questions about the sessions, building on each other: do I keep my plan and am I improving, does the plan help at all, at which times do I trade well, does it turn with duration or trade count. Computation lives in `src/utils/sitzungStatistik.js` (pure, no Vue, no network — selftest alongside it); the view only draws. Groups below `MIN_GRUPPE` carry `duenn: true` and are greyed out: three sessions on a Tuesday are noise, not a finding. Same approach as `KachelRegime.vue`.
- `Nachrichten.vue` — News page (`/nachrichten`): AI briefing at the top styled as a newspaper article (serif headline, chapter per topic, two-column body, drop cap), with an archive browser (open/delete old reports, two-click delete) and compact 3-column point tiles below; then economic calendar with adjustable range/impact/countries, and the raw posts with thumbnails. YouTube posts appear in the list with a "Video" badge and their collapsible bullet-point summary (they also feed the briefing).

- `HypeRadar.vue` / `CoinRadar.vue` — The two pages of the `research` mode (`/hype-radar`, `/coin-radar`), siblings with opposite questions: "what is new out there" vs. "what can be traded today". Same shape, same star, same expandable sub-scores; phone gets cards instead of tables. The former in-page tabs are gone: each view is a **side-menu entry** on a shared route (`/hype-radar` + `/hype-radar/berichte`, `/coin-radar` + `/coin-radar/verlauf`) — one route record per page, so switching does not remount and a running scan keeps its SSE stream. Settings are no longer a tab but a **gear panel with a one-line summary**, the same pattern as `Nachrichten.vue`. The star feeds one shared `hype_favoriten` list — `quelle` decides which watchdog data path applies. `CoinRadar.vue` shows the **rank correlation among the headline figures**, in words as well as a number ("Rangfolge ist grösstenteils Rauschen"): a ranking that hides its own predictive power is more dangerous than none. The gate view switches to a **different column set** (reason, turnover, spread, depth) rather than printing zeros — for a rejected coin no metrics were ever computed. Note: the side menu renders per-mode groups (`research` = `HYPE-RADAR` + `COIN-RADAR`) and highlights by **path, not `pageId`** — two entries share one route name, so `pageId` would light up both. `menuKey`/`menuIcon` in `menu.js` let a menu entry read "Übersicht" while the page header still says "Hype-Radar".
- `Incoming.vue` — Live open positions from Bitunix API
- `Imports.vue` — CSV / API trade import UI

### Key Components

- `InfoTipp.vue` — the one way to attach an inline explanation to a single element: a small "i" that shows text on hover (tap on phones), globally switchable via the `erweiterteInfos` setting (default on, mirrored to `localStorage` so nothing flashes before settings load). Deliberately **not** a Bootstrap tooltip: those are imperative instances that a `v-if` would orphan, `useInitTooltip()` in `utils.js` is not idempotent (unlike `useInitPopover()` right above it), and Bootstrap comes from a CDN — help text that vanishes offline is the wrong failure mode. Positioning is `Teleport to="body"` + fixed coords from `getBoundingClientRect()`, the same pattern and the same reason as `PageInfo.vue`/`RadarOverlay.vue` (tile heads clip overflow). `te()` before `t()` is mandatory: a missing key renders **nothing** rather than the raw key — the bug that made `info.coinRadar.caveat` show up literally for months. Boundary: `title=` says what a control **is**, `InfoTipp` says what a number **means**, so the existing `title=` attributes on bare icon buttons stay. Tile-level texts attach through `infoKey` on the registry entries, derived in `kachel-registry.js` as `<raum>.title` → `<raum>.info` (two Live-Trading tiles hang on `nav.liquidity`/`nav.liquidations` and carry an explicit `infoKey`) — ~29 texts cover 48 placements across Marktradar, Startseite and Live-Trading.
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
