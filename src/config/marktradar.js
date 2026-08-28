/**
 * Registry der Marktradar-Kacheln.
 *
 * Reines Datenmodul ohne Vue-Abhängigkeit — dasselbe Prinzip wie
 * `src/config/menu.js`. Die Vorgabe-Reihenfolge steht in
 * `STANDARD_REIHENFOLGE`; der Nutzer kann sie per Ziehen ändern, seine
 * Anordnung liegt im localStorage.
 *
 * Felder:
 *   id          — Schlüssel in Sichtbarkeit, Reihenfolge und Datenspeicher
 *   titleKey    — i18n-Schlüssel der Überschrift
 *   icon        — Unicons-Klasse
 *   endpunkt    — Server-Endpunkt; null = Kachel rechnet ohne eigenen Abruf
 *   intervallMs — wie oft nachgeladen wird, solange die Kachel sichtbar ist
 *   spalten     — Breite im Raster (1 = normal, 2 = doppelt)
 *   quelle      — kurze Herkunftsangabe für die Fusszeile der Gross-Ansicht
 */

import { baueKachelListe, macheSortierer } from './kachel-registry.js'

/**
 * Standardanordnung für Geräte, auf denen noch nichts gezogen wurde.
 *
 * Bewusst getrennt von den Definitionen: die Reihenfolge ist eine
 * Geschmacksfrage und ändert sich öfter als die Kacheln selbst — so ist eine
 * Umsortierung eine Zeile statt eines Verschiebens ganzer Blöcke. Ids, die
 * hier fehlen, hängen hinten an (siehe `sortiereKacheln`), gehen also nie
 * verloren.
 *
 * Stand 17.08.2026: Wunsch-Layout des Nutzers vom Desktop übernommen.
 */
export const STANDARD_REIHENFOLGE = [
    'mechanik', 'funding', 'lsoi', 'liq24', 'fng', 'dom',
    'picycle', 'altseason', 'markt', 'rainbow', 'regime', 'rsi', 'makro', 'etf',
    // Die Zusammenfassung steht am Ende: sie liest die anderen Kacheln, also
    // gehört sie hinter sie — und nachrückende Ids landen ohnehin dort.
    'lage',
]

const DEFINITIONEN = [
    {
        id: 'fng',
        titleKey: 'marktradar.fng.title',
        icon: 'uil uil-heart-rate',
        endpunkt: '/api/marktradar/fear-greed',
        params: { tage: 365 },
        // Der Wert wechselt einmal täglich — häufiger nachfragen wäre reine Fremdlast
        intervallMs: 15 * 60 * 1000,
        spalten: 1,
        quelle: 'alternative.me',
    },
    {
        id: 'dom',
        titleKey: 'marktradar.dom.title',
        icon: 'uil uil-bitcoin-circle',
        endpunkt: '/api/marktradar/btc-dominanz',
        intervallMs: 3 * 60 * 1000,
        spalten: 1,
        flaeche: true,
        quelle: 'CoinMarketCap (eigener Bestand) · CoinGecko',
    },
    {
        id: 'funding',
        titleKey: 'marktradar.funding.title',
        icon: 'uil uil-percentage',
        endpunkt: '/api/marktradar/funding',
        params: { n: 50 },
        intervallMs: 60 * 1000,
        spalten: 1,
        quelle: 'Binance USDⓈ-M Futures',
    },
    {
        id: 'lsoi',
        titleKey: 'marktradar.lsoi.title',
        icon: 'uil uil-balance-scale',
        endpunkt: '/api/marktradar/ls-oi',
        params: { stunden: 48 },
        // Folgt der Symbolwahl im Seitenmenü, damit sie überall dieselbe ist
        symbolAbhaengig: true,
        intervallMs: 5 * 60 * 1000,
        spalten: 1,
        quelle: 'Binance USDⓈ-M Futures',
    },
    {
        id: 'mechanik',
        titleKey: 'marktradar.mechanik.title',
        icon: 'uil uil-processor',
        endpunkt: '/api/marktradar/mechanik',
        params: { fenster: '1h' },
        // Folgt der Symbolwahl im Seitenmenü wie die Long/Short-Kachel
        symbolAbhaengig: true,
        intervallMs: 60 * 1000,
        spalten: 1,
        quelle: 'Binance USDⓈ-M Futures · eigene Liquidations-Aufzeichnung (Binance + Bybit)',
    },
    {
        id: 'liq24',
        titleKey: 'marktradar.liq.title',
        icon: 'uil uil-fire',
        endpunkt: '/api/marktradar/liquidationen',
        params: { stunden: 24 },
        intervallMs: 60 * 1000,
        spalten: 1,
        quelle: 'eigene Aufzeichnung (Binance + Bybit)',
    },
    {
        id: 'makro',
        titleKey: 'marktradar.makro.title',
        icon: 'uil uil-globe',
        endpunkt: '/api/marktradar/makro',
        // Futures laufen fast durch, aber ein Minutentakt brächte nichts —
        // die Kopplung ändert sich in Tagen, nicht in Minuten
        intervallMs: 5 * 60 * 1000,
        spalten: 1,
        quelle: 'Yahoo Finance (ES/NQ-Futures, DXY) · CoinGecko · Binance-Tageskerzen',
    },
    {
        id: 'picycle',
        titleKey: 'marktradar.picycle.title',
        icon: 'uil uil-chart-growth',
        endpunkt: '/api/marktradar/picycle',
        // Tageskerzen — häufiger nachzufragen ändert nichts
        intervallMs: 12 * 60 * 60 * 1000,
        spalten: 1,
        quelle: 'blockchain.info · Binance',
    },
    {
        id: 'altseason',
        titleKey: 'marktradar.altseason.title',
        icon: 'uil uil-exchange',
        endpunkt: '/api/marktradar/altseason',
        params: { tage: 90 },
        intervallMs: 30 * 60 * 1000,
        spalten: 1,
        quelle: 'Binance-Tageskerzen · CoinGecko-Rangliste',
    },
    {
        id: 'markt',
        titleKey: 'marktradar.markt.title',
        icon: 'uil uil-circle-layer',
        endpunkt: '/api/marktradar/markt',
        params: { n: 50 },
        intervallMs: 5 * 60 * 1000,
        // Blasen und Treemap brauchen Fläche, sonst wird jede Beschriftung Brei
        spalten: 2,
        flaeche: true,
        quelle: 'CoinGecko',
    },
    {
        id: 'rainbow',
        titleKey: 'marktradar.rainbow.title',
        icon: 'uil uil-rainbow',
        endpunkt: '/api/marktradar/rainbow',
        // Wochenkerzen — häufiger nachzufragen wäre sinnlos
        intervallMs: 12 * 60 * 60 * 1000,
        spalten: 1,
        flaeche: true,
        quelle: 'blockchain.info · Binance',
    },
    {
        id: 'regime',
        titleKey: 'marktradar.regime.title',
        icon: 'uil uil-analysis',
        endpunkt: '/api/marktradar/regime',
        params: { tage: 365 },
        intervallMs: 5 * 60 * 1000,
        spalten: 1,
        quelle: 'eigene Trades × alternative.me',
    },
    {
        id: 'lage',
        titleKey: 'marktradar.lage.title',
        icon: 'uil uil-robot',
        // Der Endpunkt LIEST nur, was schon erzeugt wurde — erzeugt wird per
        // Knopf in der Kachel (POST). Sonst würde „Alle aktualisieren" jedes
        // Mal eine KI-Anfrage bezahlen.
        endpunkt: '/api/marktradar/lage',
        // Mechanik und Long/Short in der Zusammenfassung sollen denselben Markt
        // meinen wie der Rest der Seite
        symbolAbhaengig: true,
        // Nur ein Blick in den Speicher des Servers; nichts Fremdes daran
        intervallMs: 5 * 60 * 1000,
        spalten: 1,
        quelle: 'die übrigen Kacheln dieser Seite · Einordnung durch die eingestellte KI',
    },
    {
        id: 'etf',
        titleKey: 'marktradar.etf.title',
        icon: 'uil uil-university',
        endpunkt: '/api/marktradar/etf',
        // Der Endpunkt liest nur den eigenen Bestand — der Abruf bei
        // CryptoQuant läuft im Hintergrundtakt, höchstens alle sechs Stunden.
        // Häufiger nachzusehen kostet nichts und ändert meist nichts: die
        // Quelle liefert einmal täglich gegen 12:00 UTC.
        intervallMs: 30 * 60 * 1000,
        spalten: 1,
        quelle: 'CryptoQuant (Gratis-Tarif) · eigener Bestand ab Einrichtung',
    },
    {
        id: 'rsi',
        titleKey: 'marktradar.rsi.title',
        icon: 'uil uil-table',
        endpunkt: '/api/marktradar/rsi',
        params: { n: 50 },
        intervallMs: 60 * 1000,
        // Eine Matrix braucht Breite — sonst quetschen sich die Spalten
        spalten: 2,
        flaeche: true,
        quelle: 'Binance-Kerzen · RSI(14) nach Wilder',
    },
]

/**
 * Die Kacheln in der Standardanordnung. Kacheln ohne Eintrag in
 * `STANDARD_REIHENFOLGE` hängen hinten an — eine vergessene Id kostet damit
 * die Wunschposition, aber nie die Kachel.
 *
 * Die Mechanik dahinter teilt sich diese Registry mit dem Live-Trading-Fenster
 * (`src/config/kachel-registry.js`); die Exporte hier bleiben unverändert,
 * damit keine Importstelle angefasst werden muss.
 */
export const KACHELN = baueKachelListe(DEFINITIONEN, STANDARD_REIHENFOLGE)

export const { kachelById, sortiereKacheln } = macheSortierer(KACHELN)
