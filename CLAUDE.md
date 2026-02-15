# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TradeNote is a **local single-user** trading journal for **Bitunix futures trading**. It lets users import trades via CSV or Bitunix API, view dashboards with analytics/charts, keep a diary, manage playbooks, and store screenshots. Licensed under GPL-3.0.

**Key simplifications from the original TradeNote:**
- No login/auth (single user, direct to dashboard)
- SQLite instead of MongoDB/Parse Server (no Docker needed)
- Only Bitunix broker support (CSV + API)
- No Stripe payments, no PostHog analytics, no Shepherd tours

> **Note:** `README.md` is stale — it still references Docker/MongoDB from the original project. This file is the authoritative reference.

## Tech Stack

- **Frontend**: Vue 3 (Composition API with `<script setup>`), Vue Router, Pinia (installed but not used — state in globals.js), Vite
- **Backend**: Express.js with SQLite (better-sqlite3)
- **Charts**: Apache ECharts
- **Styling**: Bootstrap (CDN in `index.html`), custom dark theme via CSS variables (`src/assets/style-dark.css`)
- **Other key libs**: dayjs (dates/timezones), PapaParse (CSV), Quill (rich text), markerjs2 (screenshot annotation), lodash, axios

## Commands

```bash
npm install          # Install dependencies
npm run build        # Vite production build (output to dist/)
npm start            # Start production server (node index.mjs)
npm run dev          # Start dev server with Vite HMR
```

There are **no tests, no linter, and no CI/CD pipeline** configured.

## Architecture

### Server

- **`index.mjs`** — Entry point: Express server + SQLite init + API routes. In dev mode (`NODE_ENV=dev`), proxies non-API requests to Vite dev server on port 39482. In production, serves static files from `dist/`.
- **`server/database.js`** — SQLite schema and singleton `getDb()`. DB file: **`tradenote.db`** in project root. WAL mode enabled. Tables: settings, trades, diaries, screenshots, playbooks, satisfactions, tags, notes, excursions, bitunix_config.
- **`server/api-routes.js`** — Generic REST CRUD (`GET/POST/PUT/DELETE /api/db/{table}`) + settings endpoints.
- **`server/bitunix-api.js`** — Bitunix API client (SHA256 double-hash auth) + proxy endpoints for positions.

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

### Styling

Dark theme uses CSS custom properties defined in `src/assets/style-dark.css`:
- Color vars: `--blue-color`, `--grey-color`, `--black-bg-*`, `--white-*`
- Layout vars: `--border-radius`, `--shadow-sm`
- Utility classes: `.greenTrade`, `.redTrade`, `.dailyCard`, `.chartClass`

Bootstrap loaded from CDN (not bundled).

### Environment Variables

- `TRADENOTE_PORT` — Server port (default 8080)
- `NODE_ENV=dev` — Enable Vite dev server with HMR

No `.env` files — runtime config stored in SQLite settings table and localStorage.

### Bitunix Integration

**CSV Import**: Upload Bitunix CSV export, parses "Futures Profit"/"Futures Loss" rows into trade objects.

**API Import**: Configure API Key + Secret in Settings. Server-side proxy (`/api/bitunix/positions`) fetches historical positions with full details (symbol, entry/close prices, side, fees, realized PnL).
