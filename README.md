# TJ - Trading Journal

A local, privacy-focused trading journal for **Bitunix futures trading**. No cloud, no accounts, no Docker — just run it on your machine.

> **Hinweis:** Die Benutzeroberfläche ist komplett auf **Deutsch**.

## Screenshots

![Dashboard](docs/dashboard.png)

![Playbook](docs/playbook.png)

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

- [Node.js 20+](https://nodejs.org/) (LTS empfohlen)

### Windows

1. Dieses Repository herunterladen oder klonen
2. `install.bat` doppelklicken — prüft automatisch alle Voraussetzungen:
   - **Node.js 20+** — [Download](https://nodejs.org/)
   - **Python 3** — [Download](https://www.python.org/downloads/) (bei Installation "Add to PATH" ankreuzen)
   - **Visual Studio Build Tools** — [Download](https://visualstudio.microsoft.com/visual-cpp-build-tools/) ("Desktopentwicklung mit C++" auswählen)
   - Falls etwas fehlt, zeigt der Installer die Download-Links an
3. `start.bat` doppelklicken — startet den Server und öffnet den Browser

### Linux

```bash
git clone https://github.com/Mouses007/TJ-Trading-Journal.git
cd TJ-Trading-Journal
chmod +x install.sh
./install.sh
npm start
```

Oder manuell:

```bash
npm install
npm run build
npm start
```

Im Browser `http://localhost:8080` öffnen.

### Entwicklung (Dev Mode)

```bash
npm run dev
```

Startet den Vite Dev-Server mit Hot Module Replacement.

### Port ändern

Standard-Port ist `8080`. Ändern mit:

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
