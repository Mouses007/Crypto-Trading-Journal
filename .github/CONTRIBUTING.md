# Contributing

Issues and pull requests are welcome — in English or German.

## Development setup

Node.js 20+ is required. Run `npm install`, then `npm run dev` for the Vite dev server with
hot reload (proxied through the Express backend on port 8080). SQLite needs no configuration;
the database file is created on first start.

## Before you open a PR

Run `npm run test:self` — it executes the standalone self-tests covering the calculation and
live-trading layers. There is no linter; match the style of the surrounding code. Keep a PR
focused on one topic and describe how you tested it.
