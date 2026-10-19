# Herkunft und Lizenzwechsel – Bestandsaufnahme und Plan (19.10.2026)

## 1. Was vom Ursprung übrig ist

Ursprung: **TradeNote** (Eleven-Trading, GPL-3.0), importiert im ersten Commit `3f7c784` (15.02.2026).
Gemessen gegen den aktuellen Upstream-Stand (`56eb096`, 14.04.2025): eine Zeile zählt als
übernommen, wenn sie (ohne Einrückung, mindestens 20 Zeichen) wörtlich irgendwo in TradeNote steht.

| | Zeilen |
|---|---|
| Substanzielle Codezeilen gesamt (js/mjs/vue/css/html) | 125 372 |
| davon wörtlich aus TradeNote | **6 438 (5,1 %)** |
| Gegenprobe per `git blame`: Zeilen, die seit dem Erstimport nie angefasst wurden | 15 436 von 227 620 (6,8 %, inkl. LICENSE/Doku) |

Der Rest stammt vollständig von dir (571 Commits, alle von Mouses007/MaRo bzw. Claude als Co-Autor –
keine fremden Mitwirkenden).

### Wo der Ursprungscode sitzt

Fast alles steckt im **alten Journal-Kern**. Die Radar-, Chart-, Live-Trading-, Strategie- und
KI-Teile sind praktisch frei davon (die 10–30 Treffer je Kachel sind generische CSS-Zeilen wie
`display: flex; align-items: center;` – kein schützbarer Ausdruck, wird nach dem Umbau trotzdem
nachgeprüft).

| Datei | aus TradeNote | Anteil |
|---|---|---|
| `src/utils/addTrades.js` | 1127 / 1360 | 83 % |
| `src/utils/charts.js` | 698 / 1776 | 39 % |
| `src/assets/style-dark.css` | 517 / 1221 | 42 % |
| `src/views/Daily.vue` | 508 / 1339 | 38 % |
| `src/utils/trades.js` | 414 / 726 | 57 % |
| `src/utils/screenshots.js` | 268 / 360 | 74 % |
| `src/utils/utils.js` | 242 / 409 | 59 % |
| `src/utils/daily.js` | 201 / 355 | 57 % |
| `src/views/Settings.vue` | 196 / 4045 | 5 % |
| `src/stores/globals.js` | 138 / 308 | 45 % |
| `src/views/Dashboard.vue` | 119 / 697 | 17 % |
| `src/components/SidebarFilters.vue` | 87 / 310 | 28 % |
| `src/utils/mountOrchestration.js` | 85 / 207 | 41 % |
| `src/views/AddExcursions.vue` | 76 / 101 | 75 % |
| `src/utils/calendar.js` | 74 / 85 | 87 % |
| `src/components/Screenshot.vue` | 56 / 97 | 58 % |
| `src/router/index.js` | 50 / 239 | 21 % |
| `src/utils/formatters.js` | 43 / 97 | 44 % |
| `src/assets/base.css` | 42 / 43 | 98 % |
| `src/views/AddTrades.vue` | 41 / 325 | 13 % |
| `src/components/SideMenu.vue`, `Nav.vue`, `layouts/Dashboard.vue`, `Calendar.vue` (+View), `Screenshots.vue`, `utils/dayjs-setup.js`, `brokers.js` | je 12–40 | – |

Dazu: `LICENSE` (GPL-Text), Erwähnungen von TradeNote in README/CLAUDE.md/Kommentaren,
der Dateiname `tradenote.db` und Salt-/Schlüsselnamen in `server/crypto.js`/`db-config.js`
(reine Bezeichner, nicht schützbar – aus Kompatibilität mit bestehenden Schlüsseln stehen lassen
oder per Migration umbenennen).

## 2. Rechtliche Eckpunkte (keine Rechtsberatung)

1. **Bereits veröffentlichte Versionen bleiben GPL-3.0** – für immer, für jeden, der sie hat
   (GitHub-Releases bis v3.x, Docker-Hub-Tags). Ein Lizenzwechsel wirkt nur für neue Versionen.
2. Neu lizenzieren darfst du nur Code, an dem du **alle Rechte** hältst. Solange auch nur ein
   abgeleiteter TradeNote-Teil drin ist, bleibt das Gesamtwerk GPL. Deshalb: Ursprungscode nicht
   umformulieren, sondern **aus einer Funktionsbeschreibung neu schreiben** – mit eigener Struktur
   (Aufteilung, Datenfluss, Namen). Zeilenweises Umschreiben einer Vorlage gilt weiter als Bearbeitung.
3. Mitwirkende: keine fremden. Claude-Co-Autorenschaft ist kein Hindernis (Rechte am Output liegen
   nach den Anthropic-Nutzungsbedingungen bei dir).
4. Abhängigkeiten sind alle permissiv (MIT, Apache-2.0, BSD-3, MPL/Apache bei DOMPurify) und mit
   jedem Lizenzmodell vereinbar. Zwei Pflichten bleiben:
   - **markerjs2**: Linkware – sichtbarer Link zur Bibliothek muss bleiben, oder kommerzielle
     Lizenz kaufen, oder durch eigene Annotation ersetzen (wird beim Screenshot-Umbau ohnehin angefasst).
   - **Lightweight Charts**: TradingView-Attribution-Logo bleibt an (Apache-2.0 + deren Vorgabe).
   - Eine `THIRD-PARTY-NOTICES`-Datei mit den Lizenztexten gehört in Repo und Docker-Image.
5. Vor dem Wechsel kurz von einem Anwalt (IT-/Urheberrecht CH) gegenlesen lassen, vor allem
   Punkt 2 – das ist die Stelle, an der ein Lizenzwechsel angreifbar wäre.

## 3. Lizenzmodell: kommerziell, auch an Private verkaufbar

Alle offenen und „source-available"-Lizenzen (PolyForm NC, FSL, BSL, AGPL) passen nicht: sie
erlauben Privaten die Gratisnutzung, oder jeder darf den Code weitergeben. Für den Verkauf an
Private braucht es eine **eigene proprietäre Lizenz (EULA)**: Nutzung nur mit gekaufter Lizenz,
kein Weitergeben, kein Weiterverkaufen, kein Bearbeiten.

### Empfehlung

| Baustein | Vorschlag |
|---|---|
| Lizenzvertrag | Eigene EULA nach Schweizer Recht (Gerichtsstand CH), vom Anwalt aufgesetzt. Kernpunkte: Nutzungsrecht pro Person/Installation, kein Weitergeben, Haftungsausschluss, **ausdrücklich keine Anlageberatung, keine Haftung für Handelsverluste und Fehlorders** (die App platziert über die Strategie-Schicht echte Orders – das ist der wichtigste Absatz). |
| Preismodell | Wahl zwischen **Einmalkauf + 12 Monate Updates** (danach Verlängerung, die gekaufte Version läuft weiter – bei Privatkunden am leichtesten zu verkaufen) oder **Abo** monatlich/jährlich. Optional ein Gratis-Testzeitraum (z. B. 14 Tage). |
| Quellcode | **Repo privat.** Öffentlicher Quellcode und Verkauf an Private beissen sich: wer den Code hat, braucht keine Lizenz. Ein öffentliches Repo nur noch für README, Handbuch und Releases-Notizen. |
| Auslieferung | Docker-Image in einer **privaten Registry** (Docker Hub privat oder GHCR) mit Zugang je Kunde, oder signiertes Paket zum Download nach Kauf. Das öffentliche `mouses007/trading-journal:latest` wird eingestellt. |
| Aktivierung | Lizenzschlüssel als signiertes Token (Ed25519: Käufer, Ablauf der Update-Berechtigung, Edition). Die App prüft die Signatur **offline** mit eingebautem öffentlichem Schlüssel – kein Zwang zum Online-Check, passt zur lokalen Einzelnutzer-Idee. Ohne gültigen Schlüssel: Testmodus bzw. nur lesen, Daten bleiben nie gesperrt. |
| Verkauf | Ein Händler-Dienst als „Merchant of Record" (z. B. Paddle, Lemon Squeezy): übernimmt Zahlung, Rechnung und **MWST/EU-Umsatzsteuer** für Privatkunden im Ausland, und kann Lizenzschlüssel per Webhook ausstellen lassen. Selbst verkaufen heisst EU-OSS-Registrierung ab dem ersten EU-Privatkunden. |

Hinweise, die zum Modell gehören:
- Schutz ist nur so gut wie die Verbreitung: ein Node-/Vue-Programm lässt sich im ausgelieferten
  Image lesen. Minifizierter Frontend-Build ist Standard; den Server zusätzlich zu bündeln
  (esbuild, ohne Quellkarten) erschwert das Abschreiben, verhindert es nicht. Rechtlich schützt
  dich die EULA, technisch nur die Hürde.
- **v3.x bleibt GPL und öffentlich verfügbar** – wer heute einen Abzug hat, darf ihn weiter nutzen,
  verändern und sogar weitergeben. Verkaufen kannst du, was ab v4.0 dazukommt. Je mehr Neues nach
  dem Schnitt entsteht, desto grösser der Abstand zur freien Altversion.
- Alle Abhängigkeiten (MIT/Apache/BSD) erlauben geschlossenen kommerziellen Vertrieb.
  markerjs2: Link sichtbar lassen oder kommerzielle Lizenz kaufen/ersetzen; Lightweight Charts:
  Attribution-Logo bleibt.
- Externe Datenquellen prüfen: einige Gratis-Endpunkte (CoinMarketCap-Webendpunkt, CryptoQuant
  Gratis-Tarif, CoinGecko ohne Schlüssel, Yahoo-Chart) erlauben laut ihren Bedingungen oft keine
  **kommerzielle** Nutzung. Bei einem verkauften Produkt ist das nicht mehr dein privates Problem,
  sondern das des Produkts – vor dem Verkauf je Quelle die Nutzungsbedingungen lesen, ggf. den
  Kunden eigene Schlüssel eintragen lassen (wie heute schon bei den KI-Anbietern).

## 4. Umbauplan

**Schritt 0 – Absicherung vor dem Umbau.** Journal-P&L, Gruppierung und Import haben keine
Selbsttests (laut CLAUDE.md ausdrücklich nicht abgedeckt). Zuerst Golden-Master-Tests: aktuelle
Ergebnisse von `trades.js`/`daily.js`/Import für einen festen Satz echter Trades einfrieren
(`src/utils/__selftest-journal.mjs`). Der Neubau muss dieselben Zahlen liefern.

**Schritt 1 – Löschen statt ersetzen.**
- CSV-Pfad (`brokers.js`, `brokers-kern.js`, CSV-Teile von `addTrades.js`): seit v3.0.0 ohne UI → raus.
- Toter Code in `addTrades.js` (alter Import-Fluss, laut CLAUDE.md bewusst stehen gelassen) → raus.
- Erwartung: ein grosser Teil der 1127 Zeilen in `addTrades.js` verschwindet ohne Neuschreiben.

**Schritt 2 – Neubau in Paketen** (je Paket: Funktionsbeschreibung schreiben → neu implementieren,
ohne die alte Datei offen → Golden-Master grün → alte Datei löschen):

| Paket | Inhalt | grob |
|---|---|---|
| A Journal-Kern | `trades.js`, `daily.js`, `mountOrchestration.js`, `globals.js`, Filter (`SidebarFilters.vue`), `calendar.js`, `formatters.js`, `dayjs-setup.js`, `utils.js` | ~2 500 Z. |
| B Import | API-Import aus `addTrades.js` als eigenes Modul (Bitunix/Bitget), `AddTrades.vue`, `quickImport.js` | ~1 500 Z. |
| C Auswertungs-Charts | `charts.js` → ein Modul je Chart auf Basis der ECharts-Doku | ~1 800 Z. |
| D Ansichten | `Daily.vue`, `Dashboard.vue`, `AddExcursions.vue`, `Calendar.vue` (+Komponente), `Screenshots.vue`/`Screenshot.vue`/`screenshots.js` (dabei markerjs2-Frage klären) | ~2 500 Z. |
| E Gerüst + Stil | `base.css`, `style-dark.css` (eigenes Token-System), `router/index.js`, `SideMenu.vue`, `Nav.vue`, `layouts/Dashboard.vue`, Rest in `Settings.vue` | ~2 000 Z. |

Reihenfolge A → B → C → D → E: A ist das Fundament der anderen und das mit dem höchsten
Rechenrisiko; E zuletzt, weil es am wenigsten Logik und am meisten Sichtbares hat.

**Schritt 3 – Nachweis.** Den Vergleich aus Abschnitt 1 als Skript ablegen
(`scripts/herkunft-pruefen.mjs`, klont TradeNote in ein Temp-Verzeichnis) und laufen lassen.
Ziel: nur noch generische Einzeiler (CSS-Eigenschaften, Importe von Bibliotheken), jede
verbleibende Zeile einzeln gesichtet. Ergebnis als `HERKUNFT.md` ins Repo – das ist der Beleg,
falls je jemand fragt.

**Schritt 4 – Lizenz und Vertrieb (v4.0.0).**
- EULA beim Anwalt aufsetzen lassen; `LICENSE` durch die EULA ersetzen, `package.json`
  `"license": "SEE LICENSE IN LICENSE"`, `"private": true`, `THIRD-PARTY-NOTICES` anlegen.
- Repo auf privat stellen, öffentliches Repo nur mit README/Handbuch; v3.x-Releases bleiben dort
  stehen (GPL verlangt, dass deren Quellcode erhältlich bleibt).
- Lizenzprüfung bauen: `server/lizenz.js` (Ed25519-Token prüfen, rein, mit Selbsttest),
  Eingabe unter Einstellungen → Lizenz, Testmodus-Zustand, Anzeige „Updates bis …".
- `server/update-api.js` umbauen: zieht heute per `git fetch` aus dem öffentlichen GitHub-Repo –
  künftig prüft es die Update-Berechtigung im Lizenzschlüssel und holt das Image/Paket aus der
  privaten Quelle.
- Docker: private Registry, Server-Bündel ohne Quellkarten, `LICENSE` + `THIRD-PARTY-NOTICES` im
  Image, OCI-Label `org.opencontainers.image.licenses=LicenseRef-Proprietary`; CI-Workflow auf die
  private Registry umstellen.
- Begleitteile mitdenken: Android-Widget und ESP32-Firmware lizenzrechtlich gleich behandeln
  (Teil des Produkts), Installationsskripte (`install.sh`, `setup-remote.sh`, `update.*`) zeigen heute
  auf das öffentliche Repo.
- Shop beim Händler-Dienst einrichten, Webhook → Lizenzschlüssel ausstellen und mailen.
- In der App: Lizenz und Drittanbieter-Hinweise unter Einstellungen/Über (markerjs2-Link).
