# Anleitung für Claude Code: LSOB Multi-Agent-Sektion im Crypto Trading Journal

## Kontext

Dieses Repo ist **Crypto Trading Journal** (Fork von TradeNote, Vue 3 + Express + Knex/SQLite, siehe `CLAUDE.md`). Es soll eine neue Sektion bekommen: ein **Multi-Agenten-System**, das die LSOB-Strategie (Liquidity Sweep + Order Block) auf Bitunix-Futures handelt — unterstützt durch Sentiment-/Trend-Daten. Die neue Sektion muss sich nahtlos in bestehende Muster einfügen (Knex-Migrationen, `objectId`-Mapping, generische `/api/db/{table}`-Routen, verschlüsselte Keys wie bei `bitunix_config`, Provider-Abstraktion wie in `ollama-api.js`/`ai-agent.js`).

**Leitprinzip: Nichts hardcoden.** Jeder Parameter, der die Strategie oder das Verhalten der Agenten beeinflusst, muss über die Weboberfläche (Einstellungen) änderbar sein — keine `.env`-Variablen, keine Konstanten im Code für Dinge wie Symbole, Schwellenwerte, Intervalle oder Modell-Auswahl. Das Projekt speichert Konfiguration bewusst in der DB (`settings`-Tabelle), nicht in `.env` — das gilt auch hier.

---

## 1. Datenmodell (Knex-Migration)

Neue Tabellen anlegen (Migration im bestehenden Knex-Setup, analog zu `bitunix_config`):

### `lsob_agent_config` (Singleton, wie `settings`)
Alle konfigurierbaren Parameter, editierbar über die UI:

| Feld | Typ | Beschreibung |
|---|---|---|
| `active` | boolean | Agent an/aus |
| `mode` | text | `paper` \| `live` |
| `symbols` | text (JSON-Array) | z.B. `["BTCUSDT","ETHUSDT"]` |
| `timeframe` | text | z.B. `15m`, `1h`, `4h` |
| `scanIntervalMinutes` | integer | Wie oft der Agent-Loop läuft |
| `maxRetestDepthPct` | float | Default 25 (aus LSOB-Regel: 20–30%) |
| `riskPerTradePct` | float | Default 1.0 |
| `maxDailyLossPct` | float | Default 3.0 |
| `confidenceThreshold` | float | Mindest-Konfidenz für Ausführung (0–1) |
| `sentimentSourcesEnabled` | text (JSON) | z.B. `{"fearGreed":true,"funding":true,"twitter":false,"news":true}` |
| `agentModels` | text (JSON) | Modell pro Rolle, z.B. `{"technical":"claude-haiku-4-5-20251001","sentiment":"claude-haiku-4-5-20251001","portfolio":"claude-sonnet-5"}` — Provider-Auswahl analog zu bestehendem KI-Agent-Dropdown |
| `twitterApiKey` | text (verschlüsselt) | optional, wie bei `bitunix_config.secretKey` |
| `updatedAt` | timestamp | |

### `lsob_signals`
Jedes Ergebnis des deterministischen Detectors (Historie, nicht nur letzter Stand):
`id, symbol, timeframe, direction, valid, obHigh, obLow, sweepLow, entry, stopLoss, takeProfit, invalidReason, createdAt`

### `lsob_agent_runs`
Ein Eintrag pro Agent-Durchlauf, für Nachvollziehbarkeit/Debugging:
`id, symbolId (FK lsob_signals), technicalOutput (JSON), sentimentOutput (JSON), riskOutput (JSON), portfolioDecision (JSON), finalAction, executedTradeId (FK trades, nullable), createdAt`

### Erweiterung `trades`
Falls noch nicht vorhanden: Spalte `source` (text, default `manual`) ergänzen, damit Agent-Trades (`source = 'lsob_agent'`) automatisch in Dashboard/Kalender/Auswertung erscheinen, gefiltert nach `mode` (paper/live) wie andere Broker-Filter (Bitunix/Bitget/Pionex) im Screenshot.

Alle neuen Tabellen in `JSON_COLUMNS`-Config (`api-routes.js`) eintragen, damit JSON-Spalten automatisch (de)serialisiert werden — exakt wie bei `trades.executions`.

---

## 2. Backend: `server/lsob-detector.js` (neu)

Reine, deterministische Funktion — **kein LLM-Call**. Nimmt Klines (aus `bitunix-api.js` oder `binance-api.js`) entgegen und implementiert die Regeln 1:1:

1. Swing-Hoch/-Tief-Erkennung (Pivot-Logik über konfigurierbares Lookback-Fenster)
2. Sweep-Erkennung: Kerze durchbricht Swing-Level kurz (Docht), schließt zurück
3. Order-Block: letzte gegenläufige Kerze vor dem Impuls nach dem Sweep
4. Retest-Validierung: Eindringtiefe in OB-Zone gegen `maxRetestDepthPct` aus der Config prüfen (**nicht hardcoden** — aus `lsob_agent_config` laden)
5. Invalidierungsregeln aus dem Referenz-PDF: Equal Highs ohne echten Sweep, Zone wird durchbrochen statt respektiert, kein Retest getroffen → jeweils `valid: false` mit `invalidReason`
6. Rückgabe: strukturiertes Objekt `{ valid, direction, obHigh, obLow, sweepLow, entry, stopLoss, takeProfitCandidate, confirmations: { fib786: bool, rsiOversold: bool, rejectionCandle: bool } }`

Jeder Lauf wird in `lsob_signals` geschrieben.

---

## 3. Backend: Agent-Tools erweitern (`server/ai-agent-tools.js`)

Neue Tools nach bestehendem Schema in `executeTool()` ergänzen:

- `get_lsob_signal(symbol, timeframe)` → ruft `lsob-detector.js` auf, liest Config-Parameter aus `lsob_agent_config`
- `get_sentiment_data(symbol)` → aggregiert aktivierte Quellen aus `sentimentSourcesEnabled`: Fear&Greed-Index (kostenlos, alternative.me), Bitunix Funding Rate (über `bitunix-api.js`), optional Twitter/X falls Key hinterlegt, optional Websuche nach News
- `calculate_position_size(entry, stopLoss, accountBalance)` → reiner Code, nutzt `riskPerTradePct` aus Config
- `check_daily_risk_limits()` → prüft `maxDailyLossPct` gegen heutige P&L aus `trades`

Alle Tools lesen ihre Parameter **zur Laufzeit aus `lsob_agent_config`**, nie aus Konstanten.

---

## 4. Backend: Multi-Agent-Orchestrierung (`server/lsob-agent.js`, neu)

Baut auf der bestehenden Provider-Abstraktion in `ai-agent.js`/`ollama-api.js` auf (Anthropic/OpenAI/Gemini/DeepSeek/Ollama, konfigurierbar pro Rolle über `agentModels`):

1. **Technical-Analyst-Call** — nutzt `get_lsob_signal`, interpretiert Grenzfälle, gibt `{signal, confidence, reasoning}` als JSON zurück
2. **Sentiment-Agent-Call** — nutzt `get_sentiment_data`, gibt Konfluenz-Bewertung zurück
3. **Risk-Check** — reiner Code (`calculate_position_size`, `check_daily_risk_limits`), kein LLM nötig
4. **Portfolio-Manager-Call** — bekommt alle drei Outputs als Kontext, trifft finale Entscheidung; nur wenn `confidence >= confidenceThreshold` aus Config wird ausgeführt
5. **Execution** — je nach `mode`:
   - `paper`: Eintrag in `trades` mit `source='lsob_agent', mode='paper'`
   - `live`: echter Order-Call über `bitunix-api.js`, danach ebenfalls Eintrag in `trades`
6. Kompletter Durchlauf wird in `lsob_agent_runs` geloggt (für Transparenz in der UI)

**Scheduler:** Serverseitiger Intervall-Timer (z.B. `node-cron` oder `setInterval`), der beim Start liest, ob `active=true` ist und in welchem `scanIntervalMinutes`-Takt er laufen soll — beides aus der DB, nicht aus Code/ENV. Beim Ändern der Config über die UI muss der Scheduler live neu konfiguriert werden (nicht erst nach Neustart).

Wie beim bestehenden KI-Agent: **Concurrency-Guard**, damit nicht mehrere Läufe gleichzeitig starten, plus SSE-Streaming der Agent-Schritte für die UI.

---

## 5. Frontend: Neue Settings-Sektion

In der bestehenden Einstellungen-Seite (oder als eigener Reiter dort) eine neue Karte **"LSOB Agent"** ergänzen, die 1:1 alle Felder aus `lsob_agent_config` abbildet:

- Toggle Aktiv/Inaktiv
- Radio/Select: Paper / Live (bei Live: deutliche Warnfarbe + Bestätigungsdialog)
- Multi-Select oder Tag-Input für Symbole
- Select für Zeiteinheit
- Number-Input für Scan-Intervall, Retest-Tiefe %, Risiko %, Tagesverlustlimit %, Konfidenz-Schwelle
- Checkboxen für aktivierte Sentiment-Quellen, mit Key-Eingabefeld wo nötig (analog zum bestehenden Bitunix-API-Key-Formular, inkl. Verschlüsselung über `server/crypto.js` und Maskierung in API-Responses wie bei `bitunix_config.secretKey`)
- Dropdown pro Agenten-Rolle (Technical/Sentiment/Portfolio) für Modell-Auswahl, gespeist aus den bereits im Projekt vorhandenen Provider-Optionen

Speichern läuft über die generische `/api/db/lsob_agent_config`-Route (wie bei anderen Config-Tabellen) — kein Extra-Endpoint nötig, außer für den "Scheduler neu starten"-Seiteneffekt nach dem Speichern.

## 6. Frontend: Neue View `LsobAgent.vue`

Analog zu `KiAgent.vue` (SSE-Streaming, Tool-Call-Visualisierung), zeigt:
- Aktuelle Signale pro beobachtetem Symbol (aus `lsob_signals`)
- Letzte Agent-Läufe mit Reasoning aller drei Rollen (aus `lsob_agent_runs`)
- Live-Status während eines laufenden Durchlaufs (SSE)
- Kurzer Equity-Chart der Paper-/Live-Trades mit `source='lsob_agent'` (ECharts, wie im Dashboard)

Neuer Sidebar-Eintrag (Router + Menü) unter "REFLEKTIEREN" oder neuer Gruppe "AUTOMATISIEREN".

---

## 7. Sicherheit & Sorgfaltspflichten

- API-Keys (Twitter etc.) ausschließlich verschlüsselt speichern (bestehendes `server/crypto.js` wiederverwenden), nie im Klartext an Frontend zurückgeben
- Live-Modus nur nach explizitem Bestätigungsdialog aktivierbar
- Harte Serverseitige Prüfung von `maxDailyLossPct` **vor** jeder Order — nicht nur als Prompt-Anweisung an das LLM, sondern als Code-Check, der die Ausführung blockieren kann
- Bitunix-Futures nutzt Hebel bis 125x — falls die UI eine Hebel-Einstellung bekommt, sinnvollen Default (z.B. 3-5x) vorgeben und deutlich labeln

---

## 8. Umsetzungsreihenfolge (Vorschlag für Claude Code)

1. Knex-Migration (neue Tabellen)
2. `lsob-detector.js` (isoliert testbar ohne DB/UI)
3. Neue Tools in `ai-agent-tools.js`
4. `lsob-agent.js` (Orchestrierung + Scheduler)
5. Settings-UI-Karte (damit Config überhaupt befüllbar ist)
6. `LsobAgent.vue` + Routing
7. Ende-zu-Ende-Test im Paper-Modus mit einem Symbol, bevor weitere Symbole/Live-Modus aktiviert werden

---

## Offene Fragen, die Claude Code beim User klären sollte

- Welche Twitter/Sentiment-Datenquelle konkret (X API kostenpflichtig vs. kostenlose Alternativen)?
- Soll der Scheduler bei Server-Neustart automatisch mit `active=true` weiterlaufen, oder immer manuell gestartet werden müssen?
- Reicht eine gemeinsame `trades`-Tabelle mit `source`-Flag, oder soll Paper-Trading strikt getrennt bleiben (eigene Tabelle, taucht nicht im normalen Dashboard auf)?
