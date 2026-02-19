# Architektur- und Struktur-Audit

**Projekt:** TradeNote (lokale Single-User Trading Journal App)  
**Datum:** 2026-02-18  
**Stack:** Vue 3 + Vue Router + Express + Knex + SQLite/PostgreSQL

---

## 1) Executive Summary

Die Codebase ist aktuell am besten als **Layered Modular Monolith** beschreibbar, allerdings mit inkonsistenter Trennung zwischen Präsentation, Business-Logik und Infrastruktur.  
Die Anwendung funktioniert pragmatisch gut fuer den Single-User-Zweck, weist aber mittelfristige Wartbarkeitsrisiken auf:

- starke Kopplung ueber `src/stores/globals.js`
- sehr grosse Utility-/Route-Dateien mit gemischter Verantwortung
- mindestens eine echte zyklische Abhaengigkeit im Frontend (`utils.js` <-> `trades.js`)
- fehlende Service-/Repository-Schicht im Backend (Logik direkt in Route-Handlern)

**Gesamtbewertung Architektur-Reife:** **mittel**  
**Risiko fuer weitere Feature-Entwicklung ohne Refactoring:** **mittel-hoch**

---

## 2) Aktuelle Ordnerstruktur und Verantwortung

## Top-Level

- `src/`: Vue-Frontend (Views, Components, Router, globale States, Utilities)
- `server/`: Express-Backend (CRUD-API, Broker-Integrationen, KI-Endpoints, DB-Init)
- `index.mjs`: Application Bootstrap (DB init, Route setup, Dev/Prod server behavior)
- `dist/`: Build-Artefakte
- `docs/`, Skripte (`install*.sh`, `start*.command`), lokale DB/Backups

## Frontend (`src/`)

- `views/`: Seitenlogik und erhebliche Orchestrierung
- `components/`: Wiederverwendbare UI-Bausteine
- `stores/globals.js`: globaler Zustand via `ref`/`reactive` (statt Pinia-Stores)
- `utils/`: Datenzugriff, Berechnung, Charting, Mount-/Init-Logik, Side-Effects
- `router/index.js`: Routing + globaler Setup-Guard

## Backend (`server/`)

- `api-routes.js`: generische DB-CRUD Endpunkte + Setup + Import/Export + Settings
- `bitunix-api.js`, `bitget-api.js`, `binance-api.js`: broker-spezifische API-Routen
- `ollama-api.js`: KI-Provider, Reporting, Prompting, Provider-Checks
- `database.js`: Knex-Initialisierung + Schema-Migration
- `db-config.js`: Persistenz der DB-Konfiguration

---

## 3) Architektur-Patterns: Werden sie konsequent eingehalten?

## Erkennbar vorhanden

- **Layered Architecture (teilweise):**
  - UI (`views/components`) -> Utility-/State-Layer -> REST API -> DB
- **Modular Monolith:**
  - ein deploybares System, mehrere funktionale Module (Trading, Diary, Screenshots, KI)
- **Gateway/Adapter-artige Schicht:**
  - `src/utils/db.js` kapselt HTTP-Aufrufe gegen `/api/db/*`
- **Singleton-Nutzung:**
  - `server/database.js` haelt eine globale Knex-Instanz

## Inkonsistente Einhaltung

- **Frontend-Schichtentrennung ist nicht konsequent:**
  - Business-Logik, Mount-Orchestrierung, DOM-Interaktionen, Storage-Zugriffe in denselben Dateien (`src/utils/utils.js`)
- **Backend-Schichtentrennung ist nicht konsequent:**
  - Route-Handler enthalten Query-Bau, Transformation, Provider-Aufrufe, Fehlerbehandlung
- **State-Pattern inkonsistent:**
  - Pinia ist vorhanden (`src/main.js`), aber Kern-State liegt in `src/stores/globals.js`

**Fazit:** Pattern vorhanden, aber **nicht stringent umgesetzt**.

---

## 4) Zirkulaere Abhaengigkeiten

## Befund

- **Frontend-Zyklus vorhanden:**
  - `src/utils/utils.js` importiert aus `src/utils/trades.js`
  - `src/utils/trades.js` importiert aus `src/utils/utils.js`

Das ist eine echte zirkulaere Modulabhaengigkeit und kann Initialisierungsreihenfolge/Debugbarkeit verschlechtern.

## Backend

- Im Backend wurde kein Zyklus festgestellt (Import-Graph wirkt azyklisch zwischen `index.mjs`, Route-Dateien und `database.js`).

---

## 5) Stark gekoppelte Module (Hotspots)

## Frontend-Kopplung

- `src/stores/globals.js` (340 Zeilen) als zentraler Kopplungspunkt mit sehr vielen Exports.
- Grosse God-Modules:
  - `src/utils/addTrades.js` (2035 Zeilen)
  - `src/utils/trades.js` (1336 Zeilen)
  - `src/utils/utils.js` (963 Zeilen)
- Breite direkte State-Mutationen statt klarer Actions/Domain-Store-Methoden.
- Wiederholte Datums-/Plugin-Initialisierung in mehreren Utility-Dateien (Dayjs-Setup dupliziert).

## Backend-Kopplung

- `server/ollama-api.js` (1341 Zeilen) kombiniert:
  - Routing, Provider-Client-Aufrufe, Prompt-Building, Datenaggregation
- `server/api-routes.js` (621 Zeilen) kombiniert:
  - CRUD + Setup + DB-Config + Export/Import + JSON/Legacy-Mapping
- Direkter DB-Zugriff in Route-Handlern statt Repository/Service-Schicht.

---

## 6) Abweichungen von Best Practices (Vue 3 + Express)

## Vue 3 Best Practices

- **Store-Architektur:** Pinia installiert, aber zentraler Zustand weiterhin in globalen Refs.
- **Composables vs Utilities:** viele Funktionen mit `use*`-Namen sind eher Service/Helper mit Side-Effects als klare Composables.
- **DOM-Manipulation:** direkte `document.querySelector(...)`-Manipulation in Utility-Logik statt template-driven Vue-Reaktivitaet.
- **Feature-Schnitt:** Domain-Logik, UI-Orchestrierung und Infrastruktur in denselben Dateien statt Feature-Slices.

## Express/Node Best Practices

- **Service-/Repository-Schicht fehlt weitgehend:** Query- und Business-Logik in Route-Dateien.
- **Error Handling nicht zentralisiert:** viele lokale `try/catch`-Bloecke statt einheitlicher Fehlerpipeline.
- **Dateigroessen als Geruch:** sehr grosse Route-Dateien erschweren Testbarkeit und Ownership.

---

## 7) Konkrete Architektur-Risiken

- **Aenderungsrisiko:** kleine Aenderungen in `globals.js`/`utils.js` koennen viele Views indirekt brechen.
- **Onboarding-Risiko:** hohe kognitive Last durch breite, gemischte Verantwortungen.
- **Testbarkeitsrisiko:** geringe Isolierung der Logik erschwert Unit-/Integrationstests.
- **Refactoring-Risiko:** fehlende Schichtgrenzen machen sichere Umbauten schwieriger.

---

## 8) Priorisierte Empfehlungen (realistisch, inkrementell)

## Prioritaet P0 (kurzfristig, niedriges Risiko)

- Zyklus `src/utils/utils.js` <-> `src/utils/trades.js` aufloesen.
- Dayjs-Setup in eine zentrale Datei extrahieren (`src/utils/dayjs-setup.js`).
- `src/utils/db.js` als alleinigen API-Zugriffspunkt beibehalten und staerker durchsetzen.

## Prioritaet P1 (mittelfristig, hoher Hebel)

- `src/stores/globals.js` in Domainen aufteilen:
  - `stores/trades`, `stores/filters`, `stores/ui`, `stores/settings`
- `src/utils/utils.js` aufsplitten:
  - `composables/useMount*`
  - `utils/formatters`
  - `services/local-storage`
- Backend: Service/Repository fuer Settings, Trades, AI-Report einfuehren.

## Prioritaet P2 (strukturell, langfristig)

- Feature-orientierte Frontend-Struktur:
  - `src/features/trades`, `src/features/diary`, `src/features/screenshots`, ...
- Backend-Modularisierung:
  - `server/routes`, `server/services`, `server/repositories`, `server/clients`
- Guardrails etablieren:
  - einfache Architekturregeln (z. B. keine `views -> server` direkten Koppelungen, keine zyklischen Imports)

---

## 9) Zielbild (empfohlenes Architekturmodell)

**Empfehlung:** Beibehalten als **modularer Monolith**, aber konsequent in Schichten:

- **Frontend:** Feature + Shared-Layer (State/Composables/Services sauber getrennt)
- **Backend:** Route -> Service -> Repository -> DB/External Clients
- **Cross-cutting:** zentrale Fehlerbehandlung, zentrale Validierung, klare API-Vertraege

Damit bleibt die App leicht deploybar, gewinnt aber deutlich an Wartbarkeit und Erweiterbarkeit.

---

## 10) Gepruefte Kernartefakte (Auswahl)

- `index.mjs`
- `server/api-routes.js`
- `server/ollama-api.js`
- `server/bitunix-api.js`
- `server/database.js`
- `src/main.js`
- `src/router/index.js`
- `src/stores/globals.js`
- `src/utils/utils.js`
- `src/utils/trades.js`
- `src/utils/addTrades.js`
- `src/utils/db.js`
- `src/views/Dashboard.vue`
- `src/components/Filters.vue`

