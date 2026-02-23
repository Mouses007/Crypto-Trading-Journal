# Bericht: Sprachoption (i18n) – Funktion, Fehler, Vollständigkeit

**Datum:** 23.02.2025  
**Projekt:** Crypto Trading Journal

---

## 1. Zusammenfassung

Die Sprachoption ist **grundsätzlich funktionsfähig**: Nutzer können in den Einstellungen zwischen **Deutsch** und **English** wählen. Die Einstellung wird in der Datenbank und in `localStorage` gespeichert und beim nächsten Laden angewendet. Es gibt jedoch **Fehler** (z. B. fehlende/inkonsistente Titel) und **Vollständigkeitslücken** (v. a. hardcodierte deutsche Texte in Nav und Fehlermeldungen).

---

## 2. Funktion

### 2.1 Was funktioniert

- **Vue I18n** ist korrekt eingebunden (`src/main.js`, `app.use(i18n)`).
- **Zwei Sprachen:** `de` (Deutsch) und `en` (English) mit JSON-Dateien unter `src/i18n/locales/`.
- **Sprachumschaltung in den Einstellungen:**  
  `selectedLanguage` → `changeLanguage(lang)` ruft `setLocale(lang)` auf, speichert in der DB (`dbUpdateSettings({ language: lang })`) und aktualisiert `currentUser.value.language` sowie die Perioden (`useGetPeriods()`).
- **Persistenz:**  
  - Beim Start: `localStorage.getItem('appLanguage')` bzw. Fallback `'de'` in `src/i18n/index.js`.  
  - Nach dem Laden der Settings: `Dashboard.vue` ruft in `onBeforeMount` `setLocale(currentUser.value?.language || 'de')` auf → DB hat Vorrang und wird mit dem UI (und `lang`-Attribut) abgeglichen.
- **Datenbank:** Spalte `settings.language` existiert (Migration in `server/database.js`), und `language` ist in der API-Whitelist (`server/api-routes.js`).
- **Übersetzungsdateien:** `de.json` und `en.json` sind strukturidentisch (gleiche Namespaces und Keys: `common`, `nav`, `filters`, `options`, `timeframes`, `dashboard`, `settings`, `setup`, `incoming`, `addTrades`, `kiAgent`, `imports`, `playbook`, `auswertung`, `charts`, `messages`, `daily`, `notifications`).
- **Fallback:** `fallbackLocale: 'de'` ist gesetzt; fehlende Keys fallen auf Deutsch zurück.
- **Warnungen:** `missingWarn` und `fallbackWarn` sind deaktiviert (keine Konsolen-Warnungen bei fehlenden Keys).

### 2.2 Ablauf Sprachwechsel

1. Nutzer wählt in Einstellungen „App-Sprache“ (Deutsch/English).
2. `changeLanguage(selectedLanguage)` wird ausgeführt.
3. `setLocale(lang)` setzt `i18n.global.locale`, `localStorage.appLanguage` und `document.documentElement.lang`.
4. Einstellung wird in der DB gespeichert und in `currentUser` übernommen.
5. `useGetPeriods()` aktualisiert die Perioden-Labels (z. B. „Diese Woche“ / „This week“).

---

## 3. Fehler und Inkonsistenzen

### 3.1 Document Title (Browser-Tab) nicht durchgängig übersetzt

- **Ort:** `src/router/index.js` (Guard `beforeEach`).
- **Logik:**  
  - Wenn `to.meta.titleKey` gesetzt ist → `document.title = i18n.global.t(to.meta.titleKey)` (übersetzt).  
  - Sonst → `document.title = to.meta.title` (hardcodierter englischer String).
- **Betroffen:** Routen **ohne** `titleKey` zeigen immer den gleichen Titel, unabhängig von der gewählten Sprache, z. B.:
  - `/setup` → „Setup“
  - `/dashboard` → „Dashboard“
  - `/calendar` → „Calendar“
  - `/daily` → „Daily“
  - `/screenshots` → „Screenshots“
  - `/playbook` → „Playbook“
  - `/settings` → „Settings“
  - `/addExcursions` → „Add Excursions“
- **Routen mit titleKey** (bereits übersetzt):  
  Pendente Trades, Auswertung, KI-Agent, Manueller Import.

**Empfehlung:** Für alle relevanten Routen ein `titleKey` aus den bestehenden `nav.*`-Keys setzen (z. B. `nav.dashboard`, `nav.dailyView`, `nav.calendar`, `nav.settings`) und ggf. fehlende Keys in den Locale-Dateien ergänzen (z. B. für „Add Excursions“).

### 3.2 Hardcodierter deutscher Fallback in Benachrichtigung

- **Ort:** `src/layouts/Dashboard.vue` (ca. Zeile 80).
- **Code:**  
  `sendNotification(_t('notifications.reportReady'), _t('notifications.reportCreated', { label: aiReportLabel.value || 'Zeitraum' }))`
- **Problem:** Wenn `aiReportLabel.value` leer ist, wird immer „Zeitraum“ angezeigt – auch bei englischer Sprache.
- **Empfehlung:** Fallback übersetzen, z. B. `aiReportLabel.value || _t('kiAgent.period')` (oder einen eigenen Key wie `common.period`).

### 3.3 Fehlermeldungen nur auf Deutsch

An mehreren Stellen werden Fehlermeldungen ohne i18n verwendet:

| Ort | Hardcodierter Text |
|-----|--------------------|
| `src/views/Daily.vue` (ca. Zeile 134) | `'Bewertung fehlgeschlagen'` |
| `src/views/Settings.vue` (ca. Zeilen 356, 359, 508) | `'Import fehlgeschlagen'` / `'Import fehlgeschlagen: ' + ...` |
| `src/views/Settings.vue` (ca. Zeile 533) | `'Verbindung fehlgeschlagen'` |
| `src/utils/quickImport.js` (ca. Zeile 23) | `'Import fehlgeschlagen'` |

In den Locale-Dateien existieren bereits passende Keys (z. B. `common.connectionFailed`, `addTrades.importFailed`, `messages.importFailed`). Diese sollten hier genutzt werden, damit die Meldungen in der gewählten Sprache erscheinen.

---

## 4. Vollständigkeit

### 4.1 Navigation (Nav.vue) – kritisch

- **Ort:** `src/components/Nav.vue`.
- **Problem:** Die Komponente verwendet **kein** Vue I18n. Alle sichtbaren Texte sind fest auf Deutsch gesetzt:
  - Seitennamen im `pages`-Array: „Tages Ansicht“, „Kalender“, „Pendente Trades“, „Auswertung“, „Manueller Trade Import“, „Einstellungen“, „Exkursionen hinzufügen“, „Importe“ usw.
  - Filter-Zusammenfassung: „Brutto“, „Netto“, „Long“, „Short“.
  - Export-Button: „Export“ (bleibt gleich, könnte aber konsistent übersetzt werden).
- **Folge:** Bei gewählter Sprache „English“ bleibt die gesamte Navigationsleiste (inkl. Filter-Info) auf Deutsch.
- **Vorhandene Keys:** In `nav` existieren passende Keys (z. B. `nav.dashboard`, `nav.dailyView`, `nav.calendar`, `nav.pendingTrades`, `nav.evaluation`, `nav.kiAgent`, `nav.manualImport`, `nav.settings`). In `options` gibt es `options.gross` und `options.net`.
- **Empfehlung:** In `Nav.vue` `useI18n()` nutzen und alle angezeigten Texte über `t('nav.xxx')` bzw. `t('options.gross')` / `t('options.net')` aus den Locale-Dateien beziehen. Fehlende Einträge (z. B. „Exkursionen hinzufügen“) in den JSON-Dateien ergänzen.

### 4.2 Weitere Views ohne / mit wenig i18n

- **Calendar.vue, Screenshots.vue, AddExcursions.vue:** Keine Nutzung von `useI18n` oder `t()`. Sobald dort nutzer sichtbare Texte vorkommen, sollten diese übersetzt werden.
- **SideMenu.vue, SidebarFilters.vue:** Nutzen laut Codebase `useI18n` – hier ist die Abdeckung abhängig davon, ob alle angezeigten Strings über `t()` laufen (nicht im Detail geprüft).

### 4.3 KI-Prompt-Texte in Settings

- **Ort:** `src/views/Settings.vue` (z. B. ca. Zeile 98).
- **Hinweis:** Die Prompt-Beschreibungen (z. B. „Erkläre alle Kennzahlen…“) sind fest auf Deutsch. Das betrifft die KI-Konfiguration; eine Übersetzung wäre optional, aber für vollständige Zweisprachigkeit sinnvoll.

### 4.4 Option-Labels im Sprach-Dropdown

- **Ort:** `src/views/Settings.vue` (Template).
- **Code:** `<option value="de">Deutsch</option>` und `<option value="en">English</option>`.
- **Bewertung:** In Ordnung; Sprachnamen in der jeweiligen Sprache sind üblich. Optional könnte man Keys wie `settings.languageDe` / `settings.languageEn` einführen.

---

## 5. Technische Details

### 5.1 Verwendung von i18n im Projekt

- **Composition API:** `legacy: false` in `src/i18n/index.js` → Nutzung von `useI18n()` in Komponenten.
- **Außerhalb von Setup/Komponenten:**  
  - `router/index.js`, `utils/charts.js`, `utils/brokers.js`, `utils/incoming.js`, `utils/utils.js`, `stores/globals.js`, `layouts/Dashboard.vue` importieren die i18n-Instanz und rufen `i18n.global.t(key)` bzw. eine lokale `_t(key)`-Hilfsfunktion auf.
- **setLocale:** Wird aus `Settings.vue` (Sprachwechsel) und aus `Dashboard.vue` (Sync nach Settings-Load) aufgerufen.

### 5.2 Sync-Reihenfolge

1. App-Start → i18n liest `localStorage.appLanguage` oder nutzt `'de'`.
2. Dashboard-Layout wird geladen → `useInitParse()` lädt die Settings aus der DB.
3. `setLocale(currentUser.value?.language || 'de')` stellt sicher, dass die in der DB gespeicherte Sprache die Anzeige bestimmt und mit dem `lang`-Attribut übereinstimmt.

Damit ist die Reihenfolge sinnvoll; ein kurzer „Flackern“ von localStorage-Sprache zu DB-Sprache ist bei langsamer API theoretisch möglich, aber akzeptabel.

---

## 6. Empfehlungen (Priorität)

| Priorität | Maßnahme |
|-----------|----------|
| **Hoch** | **Nav.vue** auf i18n umstellen (Seitennamen + Filter „Brutto/Netto/Long/Short“), damit die Sprachwahl die Navigation erfasst. |
| **Hoch** | **Router:** Für alle Hauptseiten `titleKey` setzen und Document Title übersetzen. |
| **Mittel** | **Dashboard.vue:** Fallback „Zeitraum“ durch übersetzten Key ersetzen. |
| **Mittel** | **Fehlermeldungen** in Daily.vue, Settings.vue und quickImport.js auf bestehende i18n-Keys umstellen. |
| **Niedrig** | Calendar, Screenshots, AddExcursions prüfen und sichtbare Texte übersetzen. |
| **Niedrig** | Optional: KI-Prompt-Texte und Sprach-Dropdown-Labels über i18n steuern. |

---

## 7. Fazit

- **Funktion:** Die Sprachoption funktioniert: Umschaltung, Speicherung (DB + localStorage), Anwendung beim nächsten Laden und Abgleich mit dem Layout sind korrekt umgesetzt. Die Locale-Dateien sind vollständig und strukturgleich.
- **Fehler:** Document Title ist nur auf einigen Routen übersetzt; ein deutscher Fallback in der KI-Benachrichtigung und mehrere hardcodierte deutsche Fehlermeldungen brechen die Konsistenz der gewählten Sprache.
- **Vollständigkeit:** Die größte Lücke ist die **Navigation (Nav.vue)**: Sie reagiert nicht auf die Sprachwahl. Daneben fehlt i18n in einigen weiteren Views und in zentralen Fehlermeldungen.

Nach Behebung der hochprioritären Punkte (Nav + Router-Titel + Fallback + Fehlermeldungen) ist die Sprachoption in der täglichen Nutzung konsistent und vollständig genug für Deutsch und English.
