/**
 * Registry der Startseiten-Kacheln.
 *
 * Reines Datenmodul ohne Vue-Abhängigkeit — dasselbe Prinzip wie
 * `src/config/marktradar.js` und `src/config/livetrading.js`. Die Startseite
 * bietet den vollen Marktradar-Katalog PLUS drei Journal-Kacheln an; sichtbar
 * ist beim ersten Öffnen aber nur eine kleine Auswahl (`STANDARD_VERSTECKT`),
 * damit die Seite aufgeräumt startet. Reihenfolge, Sichtbarkeit und Größe liegen
 * unter eigenem localStorage-Schlüssel (siehe `Startseite.vue`), unabhängig vom
 * Marktradar.
 *
 * Die generierte News-Zusammenfassung ist bewusst KEINE Kachel hier — sie sitzt
 * als feste Karte über dem Raster (`NewsKarte.vue`), nicht verschiebbar. Ihr
 * Ein/Aus-Schalter steht trotzdem im Kachel-Menü der Seite (`NEWS_ID` in
 * `Startseite.vue`), gespeichert unter demselben localStorage-Schlüssel.
 *
 * Felder je Kachel: siehe `src/config/marktradar.js`. Zusätzlich hier:
 *   endpunkt: null — die Journal-Kacheln versorgen sich selbst aus den
 *   reaktiven Stores (Kontostand, offene Positionen, Totals), holen also nichts
 *   über einen eigenen Endpunkt.
 *
 * `flaeche: true` markiert Kacheln, die als PULT-BÜHNE taugen — eine grosse
 * Fläche, deren Inhalt mit dem Platz mitwächst (Kapitalkurve, Heatmap, und
 * die vier geteilten Marktradar-Charts markt/rsi/dom/rainbow). Alles andere
 * ist eine kompakte Stat- oder Listenkachel (Kontostand, Offene Trades,
 * Winrate, Kennzahlen, Performance): auf Bühnengrösse gezogen zeigt so eine
 * Kachel eine Zahl oder ein paar Zeilen und lässt den Rest der Fläche leer —
 * genau das Bild, das die erste Fassung des Startseiten-Pults zeigte, als
 * jede sichtbare Kachel als Bühne wählbar war. Siehe
 * `components/startseite/PultAnsicht.vue`.
 */

import { baueKachelListe, macheSortierer } from './kachel-registry.js'
// Der volle Marktradar-Katalog wird eingehängt. Es sind dieselben (reinen
// Daten-)Objekte; das Raster liest sie nur, verändert sie nie — geteilt zu
// nutzen ist also unbedenklich und spart eine zweite Pflegestelle.
import { KACHELN as RADAR_KACHELN } from './marktradar.js'

/**
 * Die drei Journal-Kacheln. Self-supplying (`endpunkt: null`): sie lesen direkt
 * aus den Stores, die die Seite beim Mount befüllt und im Takt frisch hält.
 */
const JOURNAL_KACHELN = [
    {
        id: 'kontostand',
        titleKey: 'startseite.kontostand.title',
        icon: 'uil uil-wallet',
        endpunkt: null,
        intervallMs: Infinity,
        spalten: 1,
        quelle: 'Journal · Broker-Wallet',
    },
    {
        id: 'offeneTrades',
        titleKey: 'startseite.offeneTrades.title',
        icon: 'uil uil-arrow-circle-down',
        endpunkt: null,
        intervallMs: Infinity,
        spalten: 1,
        quelle: 'Broker-API (offene Positionen)',
    },
    {
        id: 'winrate',
        titleKey: 'startseite.winrate.title',
        icon: 'uil uil-chart-pie',
        endpunkt: null,
        intervallMs: Infinity,
        spalten: 1,
        quelle: 'Journal (gesamt)',
    },
    {
        id: 'kapitalkurve',
        titleKey: 'startseite.kapitalkurve.title',
        icon: 'uil uil-chart-line',
        endpunkt: null,
        intervallMs: Infinity,
        spalten: 2,
        flaeche: true,
        quelle: 'Journal (gesamt, kumulierter Netto-PnL)',
    },
    {
        id: 'kennzahlen',
        titleKey: 'startseite.kennzahlen.title',
        icon: 'uil uil-calculator-alt',
        endpunkt: null,
        intervallMs: Infinity,
        spalten: 1,
        quelle: 'Journal (gesamt)',
    },
    {
        id: 'heatmap',
        titleKey: 'startseite.heatmap.title',
        icon: 'uil uil-calendar-alt',
        endpunkt: null,
        intervallMs: Infinity,
        spalten: 2,
        flaeche: true,
        quelle: 'Journal (Netto-PnL je Tag)',
    },
    {
        id: 'performance',
        titleKey: 'startseite.performance.title',
        icon: 'uil uil-chart-bar',
        endpunkt: null,
        intervallMs: Infinity,
        spalten: 1,
        quelle: 'Journal (gesamt)',
    },
]

/**
 * Beim ersten Öffnen sichtbar. Kontostand, Fear&Greed, Marktmechanik, offene
 * Trades und Winrate — ein Blick auf „wie steht mein Konto und wie der Markt".
 * Der Rest des Katalogs ist per Zahnrad zuschaltbar.
 */
const ZUERST = [
    'kontostand', 'kapitalkurve', 'kennzahlen', 'winrate',
    'offeneTrades', 'heatmap', 'performance', 'fng', 'mechanik',
]

/** Journal-Kacheln zuerst, danach der Marktradar-Katalog. */
const DEFINITIONEN = [...JOURNAL_KACHELN, ...RADAR_KACHELN]

/**
 * Standardanordnung: die fünf Startkacheln vorn, alles Übrige hängt in seiner
 * Katalog-Reihenfolge hinten an (`baueKachelListe` sorgt dafür, dass vergessene
 * Ids nie verschwinden).
 */
export const STANDARD_REIHENFOLGE = [...ZUERST]

/**
 * Beim Erststart ausgeblendet: alles außer den fünf Startkacheln. Sobald der
 * Nutzer im Zahnrad etwas umschaltet, gilt nur noch sein localStorage.
 */
export const STANDARD_VERSTECKT = DEFINITIONEN
    .map(k => k.id)
    .filter(id => !ZUERST.includes(id))

export const KACHELN = baueKachelListe(DEFINITIONEN, STANDARD_REIHENFOLGE)

export const { kachelById, sortiereKacheln } = macheSortierer(KACHELN)
