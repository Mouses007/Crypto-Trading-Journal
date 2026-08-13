# Security Test Report (Intensiv)

Datum: 2026-03-16  
Projekt: Crypto Trading Journal

## Scope und Methode

- Statische Codeanalyse (Backend/Frontend, Auth, API, Crypto, Import/Update-Routen)
- Abhängigkeits-Scan mit `npm audit --json`
- Laufzeit-Tests gegen lokale Instanz auf `127.0.0.1:8080` (Header, Auth, Endpoint-Verhalten)
- Keine destruktiven Tests (kein Update-Install, kein Restart, kein DB-Import ausgelöst)

## Executive Summary

- Gesamtbewertung: **mittel bis erhöhtes Risiko** bei lokalem Single-User-Betrieb.
- Positiv: Session-Cookie + API-Auth aktiv, SQL-Injection über Knex/Whitelist gut mitigiert, Backup-Export redaktiert Secrets.
- Kritischster Punkt: **remote update route kann mit gültiger Session tiefgreifende Systemaktionen triggern**.
- Wichtigste Sofortmaßnahmen: Sicherheitsheader, Fehlerdetails härten, Secrets nicht über generische Settings-API ausliefern, Update/Restart zusätzlich absichern.

## Befunde

### 1) Kritisch: Update-Install ermöglicht harte Systemänderungen über API

- **Severity:** Hoch
- **Ort:** `server/update-api.js`
- **Beschreibung:** `POST /api/update/install` führt u. a. `git reset --hard origin/master`, `npm install`, `npm run build` und anschließend Neustart aus.
- **Risiko:** Bei Session-Kompromittierung (z. B. XSS/Lokalmalware) kann ein Angreifer den laufenden Code/Stand des Systems remote verändern.
- **Evidenz (Code):** Nutzung von `execSync` für Git/NPM-Kommandos in der Route.
- **Empfehlung:**
  - Endpoint standardmäßig deaktivieren (Feature-Flag).
  - Zusätzliche Bestätigung (One-time Admin-PIN) für `install/rollback/restart`.
  - Optional nur localhost + CLI-trigger statt Web-API für kritische Betriebsfunktionen.

### 2) Hoch: Sensible Schlüssel in generischer Settings-API enthalten

- **Severity:** Hoch
- **Ort:** `server/api-routes.js` (`GET /api/db/settings`)
- **Beschreibung:** Die generische Settings-Route gibt verschlüsselte Schlüssel-Felder zurück (`aiApiKey`, `aiKeyAnthropic`, `fluxApiKey`, etc.).
- **Laufzeit-Evidenz:** Feldprüfung zeigte diese Keys als `present` mit signifikanter Länge.
- **Risiko:** Ciphertext-Exfiltration ist unnötig und vergrößert Angriffsfläche (Offline-Angriff, Metadaten-Leak, Folgeangriffe).
- **Empfehlung:**
  - Bei `GET /api/db/settings` sensitive Felder immer serverseitig entfernen.
  - Ausschließlich `/api/ai/settings` (maskiert) für Key-UI nutzen.

### 3) Mittel: Fehlermeldungen leaken interne SQL/DB-Details

- **Severity:** Mittel
- **Ort:** Mehrere Routen in `server/api-routes.js`
- **Laufzeit-Evidenz:** Request auf `GET /api/db/trades/1 OR 1=1` liefert DB-Fehlertext inkl. SQL/Typinformation zurück.
- **Risiko:** Erleichtert Reconnaissance und Angriffsvorbereitung.
- **Empfehlung:**
  - Einheitliche, generische Fehlermeldungen für Client (`"Bad request"` / `"Internal error"`).
  - Technische Details nur serverseitig loggen.

### 4) Mittel: Security-Header fehlen (CSP/HSTS/Frame/NoSniff/Referrer)

- **Severity:** Mittel
- **Ort:** Serverantworten (Runtime)
- **Laufzeit-Evidenz:** Responses enthalten `X-Powered-By`, aber keine modernen Härtungsheader.
- **Risiko:** Erhöhtes XSS/Clickjacking/MIME-Sniffing-Risiko und schwächere Browser-Isolation.
- **Empfehlung:**
  - `helmet` einführen (mit angepasster CSP wegen CDN).
  - `app.disable('x-powered-by')`.
  - HSTS nur bei TLS-Deployment aktivieren.

### 5) Mittel: Kryptoschlüssel-Fallback ohne gesetztes CTJ_SECRET

- **Severity:** Mittel
- **Ort:** `server/crypto.js`
- **Laufzeit-Evidenz:** Startup-Warnung: kein `CTJ_SECRET`, maschinenspezifischer Fallback aktiv.
- **Risiko:** Key-Portabilität und Recovery schwächer; bei Host-Kompromittierung ableitbarer Kontext.
- **Empfehlung:**
  - `CTJ_SECRET` als Pflicht in Produktion erzwingen.
  - Optional Key-Rotation-Migration bereitstellen.

### 6) Niedrig bis Mittel: Kein zusätzlicher Schutz für state-changing API-Aktionen

- **Severity:** Niedrig-Mittel
- **Ort:** Mehrere `POST/PUT/DELETE`-Routen
- **Beschreibung:** Schutz basiert primär auf Session-Cookie (`SameSite=Strict`, `HttpOnly`) ohne separate CSRF-Token-Strategie.
- **Laufzeit-Evidenz:** Mit gültigem Cookie und fremdem `Origin` wurden Requests akzeptiert.
- **Einordnung:** In lokalem Single-User-Setup meist akzeptabel, aber bei Browser- oder XSS-Szenarien relevant.
- **Empfehlung:**
  - Für besonders kritische Routen zusätzliche Nonce/PIN/Confirm-Token.
  - Optional Origin/Referer-Check für state-changing Requests.

## Positive Findings

- API ohne Session-Cookie liefert korrekt `401 Unauthorized`.
- SQL-Injection-Versuche wurden nicht ausgeführt (Knex-Parametrisierung/Whitelist).
- Backup-Export redaktiert Secrets (`[REDACTED]`) in Settings/Broker-Configs.
- SSRF-Schutz für Ollama-URL vorhanden (`localhost/private ranges`).

## Dependency Security (npm audit)

Ergebnis: **6 Vulnerabilities** (2 high, 3 moderate, 1 low)

- High:
  - `jspdf` (mehrere Advisories, inkl. Injection/DoS)
  - `rollup` (Path Traversal, transitive)
- Moderate:
  - `dompurify` (XSS advisory, betrifft genutzte Version)
  - `esbuild` / `vite` (dev server advisory)
- Low:
  - `quill` XSS advisory

Empfehlung:

1. Direktes Upgrade von `jspdf`, `dompurify`, `quill`.
2. Vite/Rollup-Chain auf sichere Versionen anheben (ggf. Major-Migration geplant).
3. Nach Upgrades gezielt UI-/Export-Regressionstest.

## Priorisierter Maßnahmenplan

### Sofort (0-2 Tage)

1. Sensitive Felder aus `GET /api/db/settings` entfernen.
2. Fehlerantworten härten (keine SQL-/Stack-Details an Client).
3. `helmet` + `x-powered-by` deaktivieren.

### Kurzfristig (3-7 Tage)

1. Update/Restart-Endpunkte zusätzlich absichern (PIN/Feature-Flag/localhost-only).
2. `CTJ_SECRET` im Deployment verpflichtend machen.
3. Dependency-Upgrades für High/Moderate Findings.

### Mittelfristig (1-3 Wochen)

1. Security regression checks als Script dokumentieren.
2. Threat model für "lokal aber netzwerkfähig" formal festhalten.
3. Optional rollenbasierte Trennung für besonders kritische Aktionen.

## Fazit

Für ein lokales Single-User-Tool ist die Basis solide, aber es gibt mehrere Punkte mit echtem Härtungsbedarf.  
Die größten Risiken liegen bei privilegierten Betriebs-Endpoints und bei unnötiger Auslieferung sensitiver Settings-Felder.
