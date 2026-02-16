#!/bin/bash
# TJ Trading Journal — Server starten und Browser öffnen
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Prüfen ob bereits läuft
if curl -s http://localhost:8080 > /dev/null 2>&1; then
    xdg-open http://localhost:8080
    exit 0
fi

# Server starten
node index.mjs &
sleep 2
xdg-open http://localhost:8080
