# Code-Audit: TradeNote Journal

**Stand:** Februar 2026  
**Umfang:** Fehler, Sicherheit, Optimierungen (nur Dokumentation, keine Änderungen).

---

## 1. Sicherheit

### 1.1 Kritisch / Hoch

| # | Befund | Ort | Empfehlung |
|---|--------|-----|------------|
| 1 | **Backup-Export enthält Secrets** – `EXPORT_TABLES` in `server/api-routes.js` inkludiert `bitunix_config`. API-Key und Secret werden unverschlüsselt in JSON-Backups geschrieben. | `server/api-routes.js` (EXPORT_TABLES, `/api/db-export`) | Beim Export `bitunix_config` weglassen oder Secrets maskieren (z. B. nur `hasSecret: true`). Beim Import entsprechende Felder nicht überschreiben oder separat behandeln. |
| 2 | **DB-Konfiguration mit Passwort auf Disk** – `db-config.json` speichert PostgreSQL-Passwort im Klartext. Datei ist **nicht** in `.gitignore`. | `server/db-config.js`, `saveDbConfig()`, `.gitignore` | `db-config.json` in `.gitignore` aufnehmen. Optional: Passwort nur in Umgebungsvariable oder System-Keyring, Konfiguration ohne Passwort in Datei. |
| 3 | **API-Keys in URLs (Referrer/Logs)** – Polygon.io-Aufrufe bauen API-Key in Query-String ein (`apiKey=...`). Kann in Server-Logs, Referrer-Header oder Browser-History landen. | `src/views/Daily.vue` (Polygon-URL), `src/utils/addTrades.js` (Polygon-URL) | API-Aufruf über Backend-Proxy leiten; Key nur serverseitig setzen und nie in Client-URL. |

### 1.2 Mittel

| # | Befund | Ort | Empfehlung |
|---|--------|-----|------------|
| 4 | **v-html / innerHTML mit Nutzer- oder KI-Inhalt** – `v-html` bzw. `innerHTML` werden für Diary, Playbook und KI-Reports genutzt. Keine sichtbare HTML-Sanitization. | `src/views/Diary.vue`, `src/views/Playbook.vue`, `src/views/KiAgent.vue` (markdownToHtml + v-html) | Alle Ausgaben, die aus Nutzer- oder KI-Text kommen, vor dem Rendern sanitizen (z. B. DOMPurify). In KiAgent.vue: `markdownToHtml()` erweitern oder Ausgabe durch Sanitizer laufen lassen. |
| 5 | **Bitunix API-Key/Secret in DB unverschlüsselt** – `bitunix_config` speichert API-Key und Secret im Klartext (SQLite/PostgreSQL). | `server/database.js` (Schema), `server/bitunix-api.js` | Analog zu KI-Keys (crypto.js): serverseitig verschlüsselt speichern und nur bei Verwendung entschlüsseln. |
| 6 | **Sensible Log-Ausgaben** – Bitunix-Routen loggen Roh-Responses und Positionsdaten (z. B. `JSON.stringify(result).substring(0, 500)`). In Produktion können dadurch Handelsdaten in Logs landen. | `server/bitunix-api.js` (open-positions, position-history) | Logs in Produktion reduzieren oder nur bei Fehlern/Diagnose-Level ausgeben. |

### 1.3 Niedrig / Hinweise

| # | Befund | Ort | Empfehlung |
|---|--------|-----|------------|
| 7 | **Kein CORS/Rate-Limit/Helmet** – Express hat keine explizite CORS-, Rate-Limit- oder Security-Header-Middleware. Für lokale Single-User-App oft akzeptabel; bei späterer Netzwerk-Nutzung relevant. | `index.mjs` | Bei Deployment mit Fremdzugriff: CORS einschränken, optional Helmet, Rate-Limit für API. |
| 8 | **Großer JSON-Body-Limit** – `express.json({ limit: '50mb' })` erlaubt sehr große Bodies. Kann bei Missbrauch (z. B. Import-Endpunkte) zu Lastspitzen führen. | `index.mjs` | Limit pro Route oder generell auf sinnvollen Wert (z. B. 5–10 MB) setzen. |

---

## 2. Fehlerbehandlung & Robustheit

| # | Befund | Ort | Empfehlung |
|---|--------|-----|------------|
| 9 | **Startup ohne globalen Fehlerhandler** – `startIndex()` hat keinen `try/catch` oder `.catch()`. Nicht behandelte Rejection in `initDb()` oder `runServer()` beendet den Prozess ohne klare Meldung. | `index.mjs` | `startIndex().catch(err => { console.error(err); process.exit(1) })` oder äquivalent. |
| 10 | **Promise-Anti-Pattern** – `new Promise(async (resolve) => { ... })` in `startServer` und `runServer`. Async-Callback-Fehler werden nicht in die Promise übernommen. | `index.mjs` | Stattdessen z. B. `async`-Funktion nutzen und `await app.listen(...)` bzw. explizites Warten auf Listen-Callback; oder Fehler im Callback mit `reject()` propagieren. |
| 11 | **DB-Import löscht Tabelle ohne Transaktion** – Beim Import wird pro Tabelle `knex(table).del()` und dann Batch-Insert ausgeführt. Abbruch zwischen `del()` und Ende der Inserts lässt Tabelle leer. | `server/api-routes.js` (`/api/db-import`) | Import pro Tabelle (oder gesamten Import) in Transaktion packen (`knex.transaction(...)`). |
| 12 | **Axios-Fehler nicht zentral behandelt** – Client-seitige API-Calls haben keinen globalen Interceptor. Netzwerkfehler/500 werden je Komponente unterschiedlich behandelt; manche nur `console.log`. | `src/utils/db.js`, verschiedene Vue-Komponenten | Optional: Axios-Response-Interceptor für 401/500 und einheitliche Anzeige (z. B. Toast/Banner). |
| 13 | **Binance-Proxy leitet Status durch** – Bei Binance-Fehlern wird `error.response.status` und `error.response.data.msg` an den Client durchgereicht. Kann interne Meldungen exponieren. | `server/binance-api.js` | Für Produktion generische Fehlermeldung zurückgeben, Details nur server-seitig loggen. |

---

## 3. Daten & Validierung

| # | Befund | Ort | Empfehlung |
|---|--------|-----|------------|
| 14 | **ID in CRUD nicht typgeprüft** – `id` in GET/PUT/DELETE `:id` wird von Knex genutzt. Nicht-numerische IDs (z. B. `"1; DROP TABLE trades"`) werden von Knex gebunden und führen i. d. R. nur zu „Not found“; explizite Prüfung (Integer/positiv) fehlt. | `server/api-routes.js` (GET/PUT/DELETE by id) | Optional: `id` als positive Integer parsen und bei Ungültigkeit 400 zurückgeben. |
| 15 | **Import-Body-Größe unbegrenzt** – `/api/db-import` akzeptiert `req.body.tables` ohne Größenlimit. Sehr großes Backup kann Speicher und Zeit belasten. | `server/api-routes.js` (`/api/db-import`) | Body-Limit (bereits global 50 MB) oder maximale Tabellen-/Zeilenanzahl prüfen und bei Überschreitung 413/400. |
| 16 | **Ollama-URL aus Request** – `GET /api/ollama/status?url=...` verwendet `req.query.url`. Beliebiges URL kann zu SSRF führen (Abruf interner Dienste). | `server/ollama-api.js` | Nur localhost/erlaubte Hosts zulassen oder URL ausschließlich aus DB/Einstellungen verwenden. |

---

## 4. Verschlüsselung & Keys (Überblick)

| Thema | Status |
|-------|--------|
| **KI-API-Keys** | Werden mit `server/crypto.js` (AES-256-GCM, maschinengebundener Schlüssel) verschlüsselt gespeichert. |
| **Bitunix API** | Key/Secret in DB unverschlüsselt (siehe 1.2 #5). |
| **PostgreSQL-Passwort** | In `db-config.json` im Klartext (siehe 1.1 #2). |
| **Backup** | Enthält alle Tabellen inkl. Secrets (siehe 1.1 #1). |

---

## 5. Optimierungen

| # | Befund | Ort | Empfehlung |
|---|--------|-----|------------|
| 17 | **getTableColumns pro Request** – Bei jedem GET `/api/db/:table` und bei POST/PUT wird `getTableColumns(table)` aufgerufen (Knex `columnInfo()`). Bei vielen Requests gleiche Tabelle wiederholte DB-Meta-Abfragen. | `server/api-routes.js` | Spalten-Liste pro Tabelle cachen (z. B. Map mit TTL oder bis Schema-Änderung). |
| 18 | **Import-Batch-Größe fix** – Batch-Größe 50 ist fest. PostgreSQL hat Parameter-Grenzen; bei vielen Spalten könnte Batch angepasst werden. | `server/api-routes.js` (`/api/db-import`) | Optional: Batch-Größe abhängig von Spaltenanzahl berechnen oder konfigurierbar machen. |
| 19 | **Bitunix Quick-Import: alle Seiten nacheinander** – Lädt alle Positionen in einer Schleife (skip += 100). Bei sehr vielen Daten viele sequentielle Requests. | `server/bitunix-api.js` (quick-import) | Optional: Parallelisierung mit begrenztem Concurrency oder Stream-Verarbeitung, falls API das erlaubt. |
| 20 | **Frontend: queryLimit 10M** – `queryLimit = 10000000` in globals kann zu sehr großen Abfragen führen. | `src/stores/globals.js` | Prüfen ob alle Aufrufer sinnvolle Limits setzen; sonst Default auf z. B. 10.000–50.000 begrenzen. |

---

## 6. Code-Qualität & Wartbarkeit

| # | Befund | Ort | Empfehlung |
|---|--------|-----|------------|
| 21 | **Doppeltes express.json()** – Global `express.json({ limit: '50mb' })` und in Production zusätzlich `app.use('/api/*', express.json(), ...)`. Body wird nur einmal geparst; zweites Middleware überflüssig. | `index.mjs` | Redundante `express.json()` in der `/api/*`-Kette entfernen. |
| 22 | **Verschiedene Fehlermeldungen Deutsch/Englisch** – API liefert teils deutsche, teils englische Meldungen (z. B. Bitunix „API-Schlüssel nicht konfiguriert“ vs. „Invalid table“). | Diverse Server-Routen | Einheitliche Sprache oder Fehlercode + optional lokalisierte Meldung. |
| 23 | **Legacy/Dead Code** – `addTrades.js` enthält laut CLAUDE.md alten Import-Flow und viel Code; Polygon/Databento-Pfade. | `src/utils/addTrades.js` | Gezielte Bereinigung und ggf. Aufteilen in Module, um Wartung zu erleichtern. |

---

## 7. Kurzfassung Prioritäten

- **Sofort umsetzbar (ohne große Refactor):**  
  Backup ohne Bitunix-Secrets oder maskiert (#1), `db-config.json` in `.gitignore` (#2), Startup-Fehlerbehandlung (#9), Import-Transaktion (#11), Ollama-URL auf erlaubte Hosts beschränken (#16).
- **Mittel:**  
  v-html sanitizen (#4), Bitunix-Keys verschlüsseln (#5), Logging in Bitunix reduzieren (#6), Polygon-Proxy (#3).
- **Optional / bei Skalierung:**  
  CORS/Rate-Limit/Helmet (#7), Body-Limit (#8), ID-Validierung (#14), Caching getTableColumns (#17), einheitliche Fehlermeldungen (#22).

---

*Dieses Dokument dient nur der Dokumentation. Keine Änderungen am Code wurden im Zuge dieses Audits vorgenommen.*
