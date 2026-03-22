#!/usr/bin/env bash
# Trading Positions Desklet – Installations-Skript
# Kopiert den Desklet in das Cinnamon-Desklet-Verzeichnis und aktiviert ihn.

set -euo pipefail

DESKLET_UUID="trading-positions@trading-journal"
DESKLET_SRC="$(cd "$(dirname "$0")" && pwd)/${DESKLET_UUID}"
DESKLET_DIR="${HOME}/.local/share/cinnamon/desklets"
DEST="${DESKLET_DIR}/${DESKLET_UUID}"

echo "==> Trading Positions Desklet installieren"
echo "    Quelle: ${DESKLET_SRC}"
echo "    Ziel:   ${DEST}"

# Zielverzeichnis erstellen
mkdir -p "${DESKLET_DIR}"

# Alten Desklet ggf. ersetzen
if [ -d "${DEST}" ]; then
    echo "    Vorhandene Version wird ersetzt..."
    rm -rf "${DEST}"
fi

cp -r "${DESKLET_SRC}" "${DEST}"
echo "    Dateien kopiert."

# Cinnamon-Einstellungen: Desklet zur enabled-Liste hinzufügen (falls noch nicht vorhanden)
SETTINGS_FILE="${HOME}/.cinnamon/configs/org.cinnamon/org.cinnamon.json"

if [ -f "${SETTINGS_FILE}" ]; then
    # Prüfen ob desklet bereits aktiviert ist
    if python3 -c "
import json, sys
with open('${SETTINGS_FILE}') as f:
    cfg = json.load(f)
desklets = cfg.get('enabled-desklets', {}).get('value', [])
# Suche nach UUID in der Liste
found = any('${DESKLET_UUID}' in str(d) for d in desklets)
sys.exit(0 if found else 1)
" 2>/dev/null; then
        echo "    Desklet ist bereits in der aktivierten Liste."
    else
        echo ""
        echo "    HINWEIS: Desklet wurde installiert, aber noch nicht aktiviert."
        echo "    Bitte manuell aktivieren:"
        echo ""
        echo "    Rechtsklick auf Desktop → Desklets → '${DESKLET_UUID}' suchen → Hinzufügen"
        echo ""
        echo "    Oder über die Kommandozeile:"
        echo "    gsettings set org.cinnamon enabled-desklets \"\$(gsettings get org.cinnamon enabled-desklets | sed \"s/]$/, '${DESKLET_UUID}:0:100:100']/\")\""
    fi
else
    echo ""
    echo "    Cinnamon-Konfigurationsdatei nicht gefunden."
    echo "    Bitte Desklet manuell aktivieren:"
    echo "    Rechtsklick auf Desktop → Desklets → '${DESKLET_UUID}' → Hinzufügen"
fi

echo ""
echo "==> Installation abgeschlossen!"
echo ""
echo "    Nach der Aktivierung:"
echo "    - Rechtsklick auf Desklet → Einstellungen → Port ggf. anpassen (Standard: 8080)"
echo "    - Desklet aktualisiert sich automatisch alle 30 Sekunden"
echo ""
