/**
 * Registry der Marktradar-Kacheln.
 *
 * Reines Datenmodul ohne Vue-Abhängigkeit — dasselbe Prinzip wie
 * `src/config/menu.js`. Reihenfolge hier ist die Vorgabe; der Nutzer kann sie
 * per Ziehen ändern, seine Anordnung liegt im localStorage.
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

export const KACHELN = [
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
        quelle: 'TradingView (CRYPTOCAP:BTC.D) · CoinGecko',
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
        id: 'rainbow',
        titleKey: 'marktradar.rainbow.title',
        icon: 'uil uil-rainbow',
        endpunkt: '/api/marktradar/rainbow',
        // Wochenkerzen — häufiger nachzufragen wäre sinnlos
        intervallMs: 12 * 60 * 60 * 1000,
        spalten: 1,
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
        id: 'liq24',
        titleKey: 'marktradar.liq.title',
        icon: 'uil uil-fire',
        endpunkt: '/api/marktradar/liquidationen',
        params: { stunden: 24 },
        intervallMs: 60 * 1000,
        spalten: 1,
        quelle: 'eigene Aufzeichnung',
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
        id: 'markt',
        titleKey: 'marktradar.markt.title',
        icon: 'uil uil-circle-layer',
        endpunkt: '/api/marktradar/markt',
        params: { n: 50 },
        intervallMs: 5 * 60 * 1000,
        // Blasen und Treemap brauchen Fläche, sonst wird jede Beschriftung Brei
        spalten: 2,
        quelle: 'CoinGecko',
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
        id: 'rsi',
        titleKey: 'marktradar.rsi.title',
        icon: 'uil uil-table',
        endpunkt: '/api/marktradar/rsi',
        params: { n: 50 },
        intervallMs: 60 * 1000,
        // Eine Matrix braucht Breite — sonst quetschen sich die Spalten
        spalten: 2,
        quelle: 'Binance-Kerzen · RSI(14) nach Wilder',
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
]

export const kachelById = (id) => KACHELN.find(k => k.id === id) || null

/** Reihenfolge aus dem localStorage auf die bekannten Kacheln abbilden. */
export function sortiereKacheln(reihenfolge) {
    if (!Array.isArray(reihenfolge) || !reihenfolge.length) return [...KACHELN]
    const rest = KACHELN.filter(k => !reihenfolge.includes(k.id))
    const bekannt = reihenfolge.map(id => kachelById(id)).filter(Boolean)
    // Neue Kacheln aus einer neueren Version hängen hinten an, statt zu verschwinden
    return [...bekannt, ...rest]
}
