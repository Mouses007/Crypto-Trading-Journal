# Stores

Zustand lebt weiterhin zentral in `globals.js`. Die Einstiegspunkte `ui.js`, `filters.js`, `trades.js`, `settings.js` und `diary.js` bündeln Re-Exports; die Unterordner gruppieren sie nach Domain/Concern.

## Einstiegspunkte (öffentliche API)

| Datei | Inhalt |
|-------|--------|
| `ui.js` | Loading, Navigation, Tabs, Screenshot-UI, allgemeiner App-State |
| `filters.js` | Auswahlwerte (Tags, Zeitraum, …) und Optionlisten |
| `trades.js` | Dashboard-Daten, Add-Trades, Daily-Detail, Incoming, Screenshots, Kalender |
| `settings.js` | User/Config und KI-Report-Status |
| `diary.js` | Tagebuch-State (eigene Refs/Reactive) |

## Granulare Imports

Statt nur aus dem Einstiegspunkt kannst du gezielt aus Submodulen importieren:

```js
// Nur Loading-State
import { spinnerLoadingPage, dashboardChartsMounted } from '@/stores/ui/loading.js'

// Nur Filter-Auswahl
import { selectedTags, selectedDateRange } from '@/stores/filters/selection.js'

// Nur Incoming/Evaluation
import { pendingOpeningCount, getNotifiedPositionIds } from '@/stores/trades/incoming.js'
```

Weiterhin gültig (und unverändert):

```js
import { spinnerLoadingPage, selectedTags } from '@/stores/ui.js'
import { selectedTags } from '@/stores/filters.js'
```

## Ordnerstruktur

- `ui/` — loading.js, navigation.js, tabs.js, screenshots-ui.js, app.js
- `filters/` — selection.js, options.js
- `trades/` — dashboard.js, add-trades.js, daily-detail.js, incoming.js, screenshots.js, calendar.js
- `settings/` — app.js, reporting.js
