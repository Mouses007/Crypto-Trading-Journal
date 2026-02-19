#!/bin/bash
# Crypto Trading Journal — Server starten und Browser oeffnen (macOS)
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

PORT="${TRADENOTE_PORT:-8080}"

# Pruefen ob bereits laeuft
if curl -s "http://localhost:$PORT" > /dev/null 2>&1; then
    echo "Crypto Trading Journal laeuft bereits auf http://localhost:$PORT"
    open "http://localhost:$PORT"
    exit 0
fi

# Pruefen ob Frontend gebaut
if [ ! -f "dist/index.html" ]; then
    echo "Fehler: Frontend nicht gebaut. Bitte zuerst install-mac.command ausfuehren."
    exit 1
fi

echo ""
echo "  Crypto Trading Journal startet..."
echo ""
echo "  Server:   http://localhost:$PORT"
echo "  Beenden:  Ctrl+C oder Fenster schliessen"
echo ""

# Server starten im Hintergrund, Browser nach 2 Sekunden oeffnen
node index.mjs &
SERVER_PID=$!

sleep 2
open "http://localhost:$PORT"

# Warten auf Server-Prozess (haelt Terminal offen)
wait $SERVER_PID
