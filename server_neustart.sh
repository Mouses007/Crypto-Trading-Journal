#!/bin/bash
# Crypto Trading Journal — Server neu starten
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Laufenden Server auf Port 8080 beenden
PID=$(lsof -ti :8080 2>/dev/null)
if [ -n "$PID" ]; then
    echo "Stoppe Server (PID: $PID)..."
    kill $PID 2>/dev/null
    sleep 1
fi

# .env laden falls vorhanden (enthält CTJ_SECRET, DB-Zugangsdaten etc.)
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

# Build und Server starten
echo "Baue Frontend..."
npm run build

echo "Starte Server..."
node index.mjs
