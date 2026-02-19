# Sicherheits- und Fehlerprüfung TradeNote

**Datum:** 19.02.2026

## Kritische Punkte (behoben)

### 1. Server startete nicht (getDb fehlte)
- **Problem:** `server/api-routes.js` importierte `getDb` aus `server/database.js`, aber `database.js` exportiert nur `getKnex()` (Knex-Migration). Beim Start schlug der Modul-Import fehl.
- **Lösung:** API-Routes wurden auf **Knex** umgestellt (`getKnex()`), alle DB-Zugriffe nutzen jetzt den Knex-Query-Builder.

### 2. SQL-Injection in den CRUD-Routen
- **Problem:** Benutzereingaben (Query-Parameter und Request-Body) wurden teils direkt in SQL eingebaut:
  - `doesNotExist`: Feldnamen ungeprüft in `WHERE` (z. B. `field IS NULL OR ...`).
  - `descending` / `ascending`: Spaltennamen ungeprüft in `ORDER BY`.
  - `limit` / `skip`: `parseInt` ohne Prüfung (z. B. `NaN` möglich).
  - POST/PUT: Alle Keys aus `req.body` als Spaltennamen in `INSERT`/`UPDATE` verwendet.
- **Lösung:**
  - Feste **Whitelist** `TABLE_COLUMNS` pro Tabelle; nur diese Spalten werden in Abfragen und beim Schreiben zugelassen.
  - Alle Filter (equalTo, gte, lt, lte, doesNotExist, orderBy, exclude) prüfen Spaltennamen gegen diese Whitelist.
  - `limit`/`skip` nur gesetzt, wenn `Number.isInteger()` und sinnvolle Werte.
  - Sichere JSON-Parameter mit `safeParseQuery()` (try/catch, keine ungeprüfte Nutzung von `JSON.parse`).

### 3. Sensible Daten in API-Antworten
- **Problem:** `GET/PUT /api/db/bitunix_config` lieferten die komplette Zeile inkl. **secretKey** (und ggf. Klartext-Keys) aus.
- **Lösung:** Antwort enthält **keinen** `secretKey` mehr; es wird nur `hasSecret: true/false` zurückgegeben. Die eigentliche Bitunix-Konfiguration läuft weiter über `server/bitunix-api.js` (Verschlüsselung, keine Weitergabe des Secrets).

---

## Weitere Sicherheitsaspekte (bereits in Ordnung)

- **Authentifizierung:** Session-Cookie (`server/auth.js`) für alle `/api/*`-Requests; HttpOnly, SameSite=Strict. Kein Zugriff ohne vorherigen Seitenaufruf im Browser.
- **XSS:**  
  - Rich-Text/HTML wird mit **DOMPurify** in `src/utils/sanitize.js` bereinigt.  
  - KI-Berichte/Chat nutzen `markdownToHtml()` und danach `sanitizeHtml()` (KiAgent.vue).
- **API-Keys (Bitunix/Bitget):** Werden serverseitig in `server/crypto.js` mit maschinengebundenem Schlüssel (AES-256-GCM) verschlüsselt gespeichert; Bitunix/Bitget-Routen nutzen getKnex + encrypt/decrypt.
- **Host-Bindung:** Server bindet standardmäßig an `127.0.0.1` (nur lokal), außer `TRADENOTE_HOST=0.0.0.0`.

---

## Empfehlungen

1. **Limit/Skip:** Optional Obergrenzen einführen (z. B. `limit` max. 1000), um große Abfragen zu begrenzen.
2. **Body-Größe:** Bereits auf 50 MB begrenzt (`express.json({ limit: '50mb' })`); bei Bedarf reduzieren.
3. **Fehlerdetails:** In Produktion `error.message` in API-Responses ggf. einschränken, um keine internen Pfade/Stacktraces zu verraten.
4. **HTTPS:** Bei Nutzung im Netzwerk (z. B. TRADENOTE_HOST=0.0.0.0) Reverse-Proxy mit HTTPS (z. B. nginx/Caddy) verwenden.

---

## Kurzüberblick

| Bereich              | Status   | Anmerkung                                      |
|----------------------|----------|------------------------------------------------|
| Server-Start         | Behoben  | api-routes nutzt Knex                          |
| SQL-Injection        | Behoben  | Spalten-Whitelist + Knex-Query-Builder         |
| Sensible API-Antworten | Behoben | bitunix_config ohne secretKey                  |
| Session-/API-Auth     | OK       | Cookie-basiert                                 |
| XSS (HTML/Markdown)  | OK       | DOMPurify + sanitizeHtml                       |
| Speicherung API-Keys | OK       | Verschlüsselung (crypto.js)                    |
