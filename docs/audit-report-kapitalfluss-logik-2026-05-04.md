# Audit Report: Kapitalfluss, Berechnungen, Logik

Datum: 2026-05-04  
Projekt: Crypto Trading Journal

## Scope und Methode

- Sehr tiefe statische Codeanalyse von Backend und Frontend.
- Fokus auf Kapitalfluss, PnL-/Equity-Berechnungen, Aggregationen, Filterlogik, Datenintegritaet.
- Gepruefte Kernbereiche: `server/*.js`, `index.mjs`, `src/utils/*.js`, `src/stores/*.js`.
- Keine destruktiven Laufzeittests (kein Import/Export ausgefuehrt, keine DB-Mutation fuer Testzwecke).

## Executive Summary

- Gesamtbewertung: **erhoehtes fachliches Risiko** fuer Kennzahlen-Konsistenz.
- Kritischste Punkte:
  1. PostgreSQL-Import kann Sequenzen nicht reparieren (`backup-api`), Risiko fuer Insert-Fehler nach Restore.
  2. ESP32-Display mischt Brokerlogik (Balance nach Primary Broker, Open Positions aber Bitunix-first).
  3. Daily-Ansicht kann Eintraege doppelt laden (kapitalfluss-relevante Sicht verzerrt).
- Mehrere hohe Risiken betreffen stille API-Fehler, inkonsistente Aggregationspfade und uneinheitliche PnL-Interpretation.

## Findings

### Kritisch

1) **PostgreSQL Restore: Sequenz-Reparatur wird u. U. nie ausgefuehrt**  
- **Ort:** `server/backup-api.js`, `server/db-config.js`  
- **Befund:** In `backup-api` wird `isPg` ueber `dbConfig?.type === 'postgresql'` bestimmt, `loadDbConfig()` liefert aber Knex-Konfiguration mit `client: 'pg'`.  
- **Risiko:** Nach Import mit expliziten IDs koennen Sequenzen hinterherhinken -> spaetere Inserts schlagen mit Duplicate-Key fehl.  
- **Kapitalfluss-Auswirkung:** Operative Unterbrechung, ggf. unvollstaendige Journal-Fortfuehrung nach Restore.

2) **Broker-Inkonsistenz auf ESP32 (Balance vs Open Positions)**  
- **Ort:** `server/esp32-api.js`  
- **Befund:** Startbalance/Broker wird aus `balances` bestimmt, Open Positions werden dennoch primaer ueber Bitunix geladen.  
- **Risiko:** Nutzer mit Bitget als Hauptbroker sehen potentiell falsche offene Positionen.  
- **Kapitalfluss-Auswirkung:** Falsches Live-Risikobild und Fehlinterpretation aktueller Exposure-Lage.

3) **Daily Pagination dupliziert Tagesdaten**  
- **Ort:** `src/utils/trades.js` (`useGetFilteredTradesForDaily`), `src/utils/mountOrchestration.js` (`useMountDaily`, `useLoadMore`)  
- **Befund:** `useMountDaily` fuellt `filteredTrades` bereits, `useLoadMore` haengt spaeter Eintraege aus `filteredTradesDaily` erneut an.  
- **Risiko:** Doppelte Tageskarten und verzerrte Summen in der Daily-Darstellung.  
- **Kapitalfluss-Auswirkung:** Ueberhoehte/inkonsistente visuelle PnL-Wahrnehmung.

### Hoch

4) **Bitunix Positions-Proxy ohne `code`-Validierung**  
- **Ort:** `server/bitunix-api.js` (`GET /api/bitunix/positions`)  
- **Befund:** API-Antwort wird ungeprueft durchgereicht (`res.json(result)`).  
- **Risiko:** Fehlerhafte Upstream-Antworten koennen als "normale" Daten weiterlaufen.

5) **Bitunix Connection-Test ohne semantische Erfolgspruefung**  
- **Ort:** `server/bitunix-api.js` (`POST /api/bitunix/test`)  
- **Befund:** Kein Check auf `result.code`.  
- **Risiko:** Falsch-positive Konnektivitaetsannahme.

6) **Bitunix Recent-Closed liefert bei Fehler trotzdem `ok: true`**  
- **Ort:** `server/bitunix-api.js` (`GET /api/bitunix/recent-closed`)  
- **Befund:** Im Catch wird "ok true, leere Liste" zurueckgegeben.  
- **Risiko:** Stille Datenluecken im Verlaufscan.

7) **Bitget Balance-Fallback via `||` statt Nullish-Pruefung**  
- **Ort:** `server/bitget-api.js` (`GET /api/bitget/balance`)  
- **Befund:** `balance = usdtEquity || (available + locked + unrealizedPL)`.  
- **Risiko:** Legitime `usdtEquity = 0` wird als falsy behandelt und durch andere Summe ersetzt.

8) **Equity-Chart sortiert nur nach Tag, nicht nach intraday Reihenfolge**  
- **Ort:** `src/utils/charts.js` (`usePerfChart`)  
- **Befund:** Sortierung nur `a.td - b.td`; bei mehreren Trades am selben Tag fehlt Tie-Breaker (`entryTime`/`exitTime`).  
- **Risiko:** Cumulative Equity / Drawdown kann intraday verzerrt dargestellt werden.

9) **Daily Double-Line: Erste Serie bleibt immer "gross"**  
- **Ort:** `src/utils/charts.js` (`useRenderDoubleLineChart`)  
- **Befund:** Erste Linie nutzt immer `grossProceeds`, zweite nutzt `amountCase`.  
- **Risiko:** Bei Net-Ansicht semantisch irrefuehrende Visualisierung.

10) **Generische DB-CRUD ohne fachliche Plausibilitaetsvalidierung**  
- **Ort:** `server/api-routes.js`  
- **Befund:** Whitelist schuetzt gegen SQL-Injection, aber keine fachliche Validierung von Finanzfeldern (`trades`, `pAndL`, Counts, Signs).  
- **Risiko:** Inkonsistente oder manipulierte Kennzahlen koennen persistiert werden (bei gueltiger Session).

### Mittel

11) **AI-Statistikpfade nutzen unterschiedliche Day-PnL-Quellen**  
- **Ort:** `server/ollama-api.js` (`collectReportData`), `server/ai-agent-tools.js` (`toolComputeStatistics`)  
- **Befund:** Ohne Broker oft `row.pAndL.grossProceeds`, mit Broker Summe aus Trades.  
- **Risiko:** "Best/Worst Day" kann von Summenlogik abweichen.

12) **Zero-PnL wird statistisch als Verlust eingestuft**  
- **Ort:** `server/ai-agent-tools.js`, `server/ollama-api.js`  
- **Befund:** Logik ist meist `if (gp > 0) win else loss`.  
- **Risiko:** Winrate/Profit-Factor werden bei vielen Break-even Trades verzerrt.

13) **Gebuehrenmodell uneinheitlich (commission/funding/trading/fees)**  
- **Ort:** `src/utils/trades.js`, `server/ai-agent-tools.js`, `server/ollama-api.js`  
- **Befund:** Unterschiedliche Fee-Felder werden je nach Pfad unterschiedlich summiert oder ignoriert.  
- **Risiko:** Kennzahlen "Fees", "Net", "Expectancy" sind je nach View nicht exakt vergleichbar.

14) **Weekly/Monthly PF Aggregation potentiell reihenfolgesensitiv**  
- **Ort:** `src/utils/charts.js` (`useLineChart`)  
- **Befund:** Gruppierung basiert auf Key-Reihenfolge von `totalsByDate`; Randfaelle um Kalendergrenzen koennen schwierig sein.  
- **Risiko:** Wochen-/Monatspunkte koennen in Grenzfaellen verschoben wirken.

15) **Backup-Redaction nicht deckungsgleich mit allen sensiblen Feldern**  
- **Ort:** `server/backup-api.js`, Vergleich `server/api-routes.js` (`SETTINGS_SENSITIVE_FIELDS`)  
- **Befund:** Redaction-Liste in Backup ist enger als Sensitivliste in API-Routen.  
- **Risiko:** Backup kann verschluesselte, aber sensible Zusatzfelder enthalten.

### Niedrig

16) **Bitunix Balanceformel basiert auf Modellannahme**  
- **Ort:** `server/bitunix-api.js` (`GET /api/bitunix/balance`)  
- **Befund:** `available + margin + crossUnrealizedPNL + isolationUnrealizedPNL`.  
- **Risiko:** Falls Felder laut Exchange-Semantik ueberlappen, Anzeigeabweichung moeglich.

17) **Globaler Modulzustand fuer Trades kann race-anfaellig sein**  
- **Ort:** `src/utils/trades.js` (`let trades = []`)  
- **Befund:** Shared mutable state ohne Request-Token/Abort.  
- **Risiko:** In schnellen Navigationswechseln sind inkonsistente Zwischenstaende moeglich.

## Positive Findings

- SQL-Injection-Risiko in Generic CRUD ist durch Tabellen-/Spalten-Whitelists deutlich reduziert.
- `settings`-Read-Route entfernt sensible Felder serverseitig und setzt nur `*Set`-Flags.
- Mehrere Importpfade nutzen bereits defensive JSON-Parsing-Fallbacks.

## Priorisierter Maßnahmenplan

### Sofort (0-2 Tage)

1. **Fix Restore-Erkennung fuer PostgreSQL:** in `backup-api` auf `dbConfig.client === 'pg'` pruefen.  
2. **ESP32 Brokerlogik konsistent machen:** Open Positions je `primaryBroker` laden (Bitget/Bitunix).  
3. **Daily-Duplikation beheben:** initiale Datenmenge und "load more" eindeutig trennen.

### Kurzfristig (3-7 Tage)

1. Bitunix `/positions` und `/test` mit `result.code` absichern.  
2. Bitunix `/recent-closed` Fehlerpfad auf `ok: false` + Fehlerkontext umstellen.  
3. Bitget Balance-Fallback auf Nullish-Logik (`??`) umstellen.

### Mittelfristig (1-3 Wochen)

1. Einheitliches Fee-/PnL-Datenmodell fuer Frontend, AI-Reports und API-Tools dokumentieren und zentralisieren.  
2. Equity-Reihenfolge stabilisieren (`td` + `entryTime`/`exitTime`).  
3. Testkatalog fuer Kapitalfluss-Regressionen etablieren (siehe unten).

## Empfohlene Regressionstests

- **DB Restore (PostgreSQL):** Import mit IDs, danach Insert ohne ID muss funktionieren.  
- **Broker-Konsistenz:** `primaryBroker=bitget` -> ESP32 zeigt Bitget Open Positions.  
- **Daily Pagination:** Kein doppelter `dateUnix`-Block nach mehrfach `useLoadMore`.  
- **Equity Intraday:** Mehrere Trades am selben Tag ergeben stabile Kurve bei Reload.  
- **Fee Konsistenz:** Dashboard/AI/Reports liefern bei gleichem Datensatz identische Kernmetriken (Net, Gross, Fees, PF, Winrate).  
- **Break-even Trades:** `grossProceeds=0` beeinflusst Win/Loss-Statistik nicht als "Loss".

## Fazit

Die Architektur ist grundsaetzlich tragfaehig, aber es gibt mehrere Stellen, an denen Kapitalfluss-Kennzahlen je nach Pfad unterschiedlich berechnet oder dargestellt werden.  
Fuer hohe fachliche Verlaesslichkeit sollten zuerst Restore-Integritaet, Broker-Konsistenz und Daily-Datenfluss stabilisiert werden, danach die Vereinheitlichung der PnL-/Fee-Logik ueber alle Auswertungswege.
