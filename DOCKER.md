# Docker-Installation — Crypto Trading Journal

## Voraussetzungen

- Docker und Docker Compose installiert
- Zugang zum Git-Repository

## Schnellstart (mit externer PostgreSQL)

Wenn du bereits eine PostgreSQL-Datenbank hast (z.B. auf dem NAS), verbindet sich der Container direkt dorthin. Deine bestehende Datenbank wird unverändert übernommen.

```bash
# 1. Repository klonen
git clone <repo-url> crypto-trading-journal
cd crypto-trading-journal

# 2. Konfiguration anlegen
cp .env.example .env
```

Passe die `.env` an deine PostgreSQL-Zugangsdaten an:

```env
CTJ_PORT=8080
DB_TYPE=postgresql
DB_HOST=192.168.178.100
DB_PORT=5433
DB_USER=tradejournal
DB_PASSWORD=dein_passwort
DB_NAME=tradejournal
```

```bash
# 3. Container bauen und starten
docker compose up -d

# 4. Öffne im Browser
# http://localhost:8080
```

Fertig. Der Container liest deine bestehende PostgreSQL-Datenbank mit allen Trades, Einstellungen und Daten.

## Befehle

```bash
# Starten
docker compose up -d

# Stoppen
docker compose down

# Logs anzeigen
docker compose logs -f journal

# Neu bauen nach Update
git pull
docker compose up -d --build

# Container-Status prüfen
docker compose ps
```

## Update

```bash
git pull
docker compose up -d --build
```

Das baut das Image mit dem neuen Code neu und startet den Container. Die Datenbank (extern auf PostgreSQL) bleibt unberührt.

## Hinweise

- Der Container bindet auf `0.0.0.0`, ist also im Netzwerk erreichbar
- Über `CTJ_PORT` in der `.env` kann der Port geändert werden
- Die `.env`-Datei ist in `.gitignore` und wird nicht committed
- Wenn `DB_TYPE` nicht gesetzt oder leer ist, verwendet der Container SQLite (lokal im Container — nur für Tests geeignet)
