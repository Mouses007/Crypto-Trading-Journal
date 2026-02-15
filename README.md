# TJ - Trading Journal

A local, privacy-focused trading journal for **Bitunix futures trading**. No cloud, no accounts, no Docker — just run it on your machine.

## Features

- **Dashboard** with P&L analytics, win rate, profit factor, and more
- **Playbook** for trade notes with stress level (0-5) and emotion level (1-10)
- **Auswertung** (Evaluation) with tag-based strategy analysis, stress/emotion charts, and completeness radar
- **Calendar** view of daily trading performance
- **Diary** for daily journal entries
- **Screenshots** with annotation support
- **Incoming positions** — track and evaluate open trades in real-time via Bitunix API
- **CSV and API import** from Bitunix

## Tech Stack

- **Frontend**: Vue 3, Vue Router, ECharts, Bootstrap (dark theme)
- **Backend**: Express.js + SQLite (better-sqlite3)
- **No external database** required — everything stored in a single `tradenote.db` file

## Installation

### Requirements

- Node.js 18+

### Setup

```bash
git clone <repo-url>
cd Journal
npm install
npm run build
npm start
```

Open `http://localhost:8080` in your browser.

### Development

```bash
npm run dev
```

Starts the Vite dev server with hot module replacement.

### Port

Default port is `8080`. Change with the `TRADENOTE_PORT` environment variable:

```bash
TRADENOTE_PORT=3000 npm start
```

## Usage

1. Go to **Settings** and configure your Bitunix API Key + Secret (optional, for API import)
2. Import trades via **CSV upload** or **API fetch**
3. Evaluate your trades in **Playbook** — add tags, stress/emotion levels, notes
4. Review your performance in **Dashboard** and **Auswertung**

## Attribution

This project is a fork of [TradeNote](https://github.com/Eleven-Trading/TradeNote) by eleven.trading, substantially modified:

- Replaced MongoDB/Parse Server with SQLite
- Removed Docker, authentication, payments, analytics
- Simplified to single-user, Bitunix-only
- Added emotion level tracking, tag-based strategy evaluation, incoming positions

## License

GPL-3.0 — see [LICENSE](LICENSE) file.
