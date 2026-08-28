/**
 * Registry der Kacheln im Live-Trading-Fenster.
 *
 * Gleiches Feldschema wie `src/config/marktradar.js` — dieselbe Mechanik aus
 * `kachel-registry.js`, dieselbe Bedeutung von `endpunkt`, `intervallMs`,
 * `spalten`, `symbolAbhaengig`. Drei Felder kommen dazu:
 *
 *   gross       — false = kein Vergrössern. Für Kacheln, die ihre Daten selbst
 *                 über einen laufenden Strom holen: die Gross-Ansicht ist eine
 *                 zweite Instanz derselben Komponente und würde eine zweite
 *                 Verbindung öffnen.
 *   minSpalten  — Untergrenze beim Ziehen. Eine Bookmap in einer Spalte ist
 *                 nicht klein, sondern unlesbar.
 *   eigenerStrom — die Kachel hängt an einem laufenden Datenstrom und MELDET
 *                 dessen Zustand selbst ans Raster. Nicht zu verwechseln mit
 *                 `endpunkt: null`: „Handelszeiten" hat auch keinen Endpunkt,
 *                 rechnet aber lokal aus `shared/handelszeiten.js` und ist zu
 *                 Recht immer fertig. Nur wer eine Verbindung hat, kann sie
 *                 auch verlieren.
 *   hoehe       — Standardhöhe in Pixeln, wenn der Nutzer noch nie am
 *                 Anfasser gezogen hat (sonst gilt die Rasterhöhe 270).
 *
 * ## Was hier bewusst FEHLT
 *
 * Regenbogen, Pi-Cycle, Altcoin-Saison, Marktregime, Marktübersicht,
 * Fear & Greed und die RSI-Matrix stehen im Marktradar und gehören dort auch
 * hin. Das sind Wochen- und Monatsinstrumente: sie ändern sich in einer
 * Handelssitzung nicht ein einziges Mal und kosten nur Platz neben dem Chart.
 *
 * Vier Kacheln teilt sich diese Seite mit dem Marktradar — gleiche Id, gleicher
 * Endpunkt. Das ist unkritisch, weil Sichtbarkeit, Reihenfolge, Grösse und
 * Parameter über getrennte localStorage-Schlüssel laufen. `mechanik` läuft hier
 * allerdings auf dem 15-Minuten-Fenster statt auf der Stunde: im Handelsfenster
 * interessiert, was gerade passiert, nicht was heute passiert ist.
 */

import { baueKachelListe, macheSortierer } from './kachel-registry.js'

/**
 * Standardanordnung — die im echten Handel bewährte Aufstellung: die beiden
 * grossen Arbeitsflächen (Bookmap, Hebelkarte) zuoberst, direkt darunter das
 * Kurzfristige (Mechanik, Liquidationen, eigene Positionen), dann Markt-
 * positionierung und Aussenwelt, die Nachschlage-Kacheln zuletzt. Ersetzt die
 * frühere „von innen nach aussen"-Ordnung, bei der die Charts erst nach
 * zweimal Scrollen kamen.
 */
export const STANDARD_REIHENFOLGE = [
    'bookmap', 'hebelkarte',
    'mechanik', 'liqticker', 'positionen',
    'lsoi', 'indizes', 'funding',
    'handelszeiten', 'makro', 'kalender',
    'lage',
]

const DEFINITIONEN = [
    {
        id: 'handelszeiten',
        titleKey: 'livetrading.handelszeiten.title',
        icon: 'uil uil-clock',
        // Rechnet im Browser aus `shared/handelszeiten.js` — kein Abruf.
        endpunkt: null,
        intervallMs: Infinity,
        spalten: 1,
        quelle: 'Eigene Rechnung (Zeitzonen)',
    },
    {
        id: 'mechanik',
        titleKey: 'marktradar.mechanik.title',
        icon: 'uil uil-cog',
        endpunkt: '/api/marktradar/mechanik',
        params: { fenster: '15m' },
        intervallMs: 60 * 1000,
        spalten: 1,
        quelle: 'Binance · eigene Aufzeichnung',
        symbolAbhaengig: true,
    },
    {
        id: 'liqticker',
        titleKey: 'livetrading.liq.title',
        icon: 'uil uil-fire',
        endpunkt: '/api/livetrading/liq-ticker',
        params: { minuten: 15 },
        // Der Server hält die Ereignisse im Arbeitsspeicher; fünf Sekunden sind
        // hier billig und machen aus der Kachel erst einen Ticker.
        intervallMs: 5 * 1000,
        spalten: 1,
        quelle: 'eigene Aufzeichnung (Binance gedrosselt · Bybit ungedrosselt)',
    },
    {
        id: 'positionen',
        titleKey: 'livetrading.positionen.title',
        icon: 'uil uil-wallet',
        endpunkt: '/api/livetrading/session-stand',
        // Zeitraum und Plangrenzen kommen aus der laufenden Sitzung, nicht aus
        // der Registry — die Seite reicht sie über `zusatzParams` nach.
        sitzungAbhaengig: true,
        intervallMs: 10 * 1000,
        spalten: 1,
        quelle: 'Bitunix (offene und geschlossene Positionen)',
    },
    {
        id: 'kalender',
        titleKey: 'livetrading.kalender.title',
        icon: 'uil uil-calendar-alt',
        endpunkt: '/api/livetrading/kalender-countdown',
        params: { stunden: 8 },
        intervallMs: 60 * 1000,
        spalten: 1,
        quelle: 'ForexFactory · Fed-Kalender (eigener Bestand)',
    },
    {
        id: 'indizes',
        titleKey: 'livetrading.indizes.title',
        icon: 'uil uil-chart-line',
        endpunkt: '/api/livetrading/indizes',
        // `stunden` statt `range`: Yahoos `range=1d` liefert für einen Future
        // nur die laufende reguläre Sitzung — morgens sind das zehn Kerzen.
        // Der Server holt jetzt immer fünf Tage und schneidet auf dieses
        // Fenster zu; die Auflösung wandert mit (siehe `FENSTER` in der Kachel).
        params: { interval: '5m', stunden: 12 },
        intervallMs: 60 * 1000,
        // Ein Kerzenchart braucht Breite, sonst klebt jede Kerze an der nächsten
        spalten: 2,
        quelle: 'Yahoo Finance (ES=F, NQ=F, RTY=F, DX-Y.NYB)',
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
        symbolAbhaengig: true,
        intervallMs: 5 * 60 * 1000,
        spalten: 1,
        quelle: 'Binance USDⓈ-M Futures',
    },
    {
        id: 'makro',
        titleKey: 'marktradar.makro.title',
        icon: 'uil uil-globe',
        endpunkt: '/api/marktradar/makro',
        intervallMs: 5 * 60 * 1000,
        spalten: 1,
        quelle: 'Yahoo Finance · CoinGecko · Binance-Tageskerzen',
    },
    {
        // Dieselbe Kachel wie im Marktradar. Der Endpunkt LIEST nur, was schon
        // erzeugt wurde — erzeugt wird per Knopf in der Kachel (POST). Sonst
        // würde „Alle aktualisieren" bei jedem Druck eine KI-Anfrage bezahlen,
        // und im Live-Fenster läuft der Prüftakt bei drei Sekunden.
        id: 'lage',
        titleKey: 'marktradar.lage.title',
        icon: 'uil uil-robot',
        endpunkt: '/api/marktradar/lage',
        symbolAbhaengig: true,
        intervallMs: 5 * 60 * 1000,
        spalten: 1,
        quelle: 'die übrigen Kacheln · Einordnung durch die eingestellte KI',
    },
    /*
     * Die beiden Canvas-Kacheln hängen an eigenen Datenströmen und stehen
     * deshalb am Ende: `endpunkt: null` (sie holen selbst), `gross: false`
     * (die Gross-Ansicht wäre eine zweite Instanz und damit eine zweite
     * Verbindung) und `minSpalten: 2` (in einer Spalte unlesbar). Eine
     * Telefon-Ausnahme brauchen sie nicht mehr — die ganze Seite ist auf den
     * Desktop beschränkt.
     */
    {
        id: 'bookmap',
        titleKey: 'nav.liquidity',
        // Eigenes `infoKey`: `nav.liquidity`/`nav.liquidations` enden nicht auf
        // `.title`, die Ableitung ergäbe zweimal dasselbe `nav.info`.
        infoKey: 'livetrading.bookmap.info',
        icon: 'uil uil-chart-line',
        endpunkt: null,
        intervallMs: Infinity,
        spalten: 2,
        minSpalten: 2,
        // Standardhöhe in Pixeln (sonst gälte die Rasterhöhe von 270): als
        // oberste Arbeitsfläche braucht der Chart von Anfang an echte Höhe,
        // nicht erst nach dem Ziehen am Anfasser.
        hoehe: 559,
        gross: false,
        // Hängt an einem eigenen Strom und meldet dessen Zustand selbst ans
        // Raster. Siehe `eigenerStrom` in `useKachelRaster.js`.
        eigenerStrom: true,
        quelle: 'Binance-Orderbuchstrom (live)',
    },
    {
        id: 'hebelkarte',
        titleKey: 'nav.liquidations',
        // Eigenes `infoKey`: `nav.liquidity`/`nav.liquidations` enden nicht auf
        // `.title`, die Ableitung ergäbe zweimal dasselbe `nav.info`.
        infoKey: 'livetrading.hebelkarte.info',
        icon: 'uil uil-fire',
        endpunkt: null,
        intervallMs: Infinity,
        spalten: 2,
        minSpalten: 2,
        hoehe: 546,
        gross: false,
        eigenerStrom: true,
        quelle: 'Modell auf Basis der eigenen Aufzeichnung',
    },
]

export const KACHELN = baueKachelListe(DEFINITIONEN, STANDARD_REIHENFOLGE)

export const { kachelById, sortiereKacheln } = macheSortierer(KACHELN)
