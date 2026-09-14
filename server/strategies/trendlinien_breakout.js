/**
 * Trendlinien-Ausbruch — Trendfolge mit frühem Einstieg über eine Trendlinie.
 *
 * Regelwerk aus dem Video „Die Ultimative Swing Trading Strategie: So erzielst
 * du 136% Profit mit Trendlinien" (Kanal: Trading Strategie Analyse,
 * https://www.youtube.com/watch?v=j7cRV6IAw3Q, Tageskerzen, drei Indikatoren):
 *
 *   1. OBV zeigt die Trendrichtung (grün = Aufwärtstrend, rot = Abwärtstrend)
 *   2. Die beiden gleitenden Durchschnitte des Trendscanners stehen in
 *      Trendrichtung (schnell über langsam = grün), und der Scanner färbt den
 *      Chart-Hintergrund in dieselbe Richtung ein. Im Video heisst diese
 *      senkrechte Säule „Balken"; gemeint ist das Ereignis dahinter — der
 *      Stoch-RSI verlässt den überverkauften Bereich (grün) bzw. den
 *      überkauften (rot). Der Code nennt sie deshalb weiter `balken*`, die
 *      Oberfläche spricht von der Momentum-Säule.
 *   3. Alternativ genügt die KREUZUNG der beiden Durchschnitte (das Dreieck)
 *      zusammen mit dem OBV in derselben Farbe
 *   4. Ab der Signalkerze wird eine Trendlinie gezogen: vom letzten Higher
 *      High zum SCHLUSSKURS der Signalkerze (Short: vom letzten Lower Low).
 *      Liegt der Schlusskurs schon jenseits dieses Punktes, ist die Linie
 *      WAAGERECHT auf dessen Höhe — der Fall, den das Video als drittes
 *      Kaufsignal zeigt („Signal > Higher High").
 *   5. Bricht eine spätere Kerze die Linie und SCHLIESST jenseits davon, liegt
 *      eine Stop-Order knapp über deren Hoch (Short: unter deren Tief)
 *   6. Wird sie von der nächsten Kerze nicht ausgelöst, wird sie gestrichen
 *   7. Stop zwischen den Durchschnitten oder hinter dem letzten Swing,
 *      Ziel bei Chance/Risiko 1:2
 *
 * ── Was das Video NICHT festlegt ──
 * Die drei Indikatoren sind fremde TradingView-Skripte; ihr Quelltext ist hier
 * nicht nachgebaut, sondern ihre BESCHREIBUNG: OBV gegen einen gleitenden
 * Durchschnitt seiner selbst (im Video von Länge 100 auf 200 gestellt), zwei
 * EMAs (12/25) für den Trendscanner, Pivot-Hochs/Tiefs mit 5 Kerzen links und
 * rechts für Higher High / Lower Low. Ob der farbige Balken des Scanners aus
 * dem Stoch-RSI kommt, ist der wahrscheinlichste, aber nicht bewiesene Fall —
 * deshalb ist er abschaltbar (`verlangeBalken`) und in seinen Schwellen
 * einstellbar. „Leicht über dem Hoch", „zwischen den Durchschnitten" und die
 * Geduld beim Warten auf den Bruch sind im Video Augenmass; hier sind es
 * Parameter mit weitem Bereich. Welcher Wert trägt, entscheidet der Backtest.
 *
 * ── Bewusst nicht umgesetzt ──
 * Das Video handelt Tageskerzen auf Forex- und Krypto-Charts und misst in
 * Prozent des Kontos; die Kostenrechnung (Gebühr, Slippage, Funding) kommt
 * hier aus der Risiko-Schicht und ist damit strenger als im Video.
 *
 * detect() ist eine REINE Funktion: keine DB, kein Netz, kein Date.now().
 */

import { pivotHighs, pivotLows, ema, obv, emaSerie, smaSerie, stochRsi, tagGesperrt, macd, sma } from './indicators.js'

export const DETECTOR_VERSION = 1

/** Abbruchgründe. Die Auswertung gruppiert danach — Codes stabil halten. */
export const INVALID_REASONS = {
    KEIN_ANKER: 'no_pivot_anchor',
    TREND_GEDREHT: 'trend_reversed',
    KEIN_AUSBRUCH: 'trendline_not_broken',
    ORDER_VERFALLEN: 'order_not_filled',
    STOP_UNGUELTIG: 'invalid_stop',
    WOCHENTAG_GESPERRT: 'weekday_blocked',
    MACD_FILTER: 'macd_filter',
    MACRO_FILTER: 'macro_ma_filter',
}

const params = [
    // ── Trendrichtung (OBV) ───────────────────────────────────────
    { key: 'obvLaenge', type: 'integer', default: 200, min: 10, max: 400, step: 10, group: 'trend' },
    {
        key: 'obvMaArt', type: 'select', default: 'ema', group: 'trend',
        options: [{ value: 'ema', labelKey: 'strategies.trendlinien_breakout.maEma' },
                  { value: 'sma', labelKey: 'strategies.trendlinien_breakout.maSma' }],
    },

    // ── Trendscanner (zwei EMAs) ──────────────────────────────────
    { key: 'emaFast', type: 'integer', default: 12, min: 3, max: 100, step: 1, group: 'trend' },
    { key: 'emaSlow', type: 'integer', default: 25, min: 5, max: 200, step: 1, group: 'trend' },

    // ── Signalquellen ─────────────────────────────────────────────
    { key: 'signalTrend', type: 'boolean', default: true, group: 'confirm' },
    { key: 'signalKreuzung', type: 'boolean', default: true, group: 'confirm' },
    { key: 'verlangeBalken', type: 'boolean', default: true, group: 'confirm' },
    {
        key: 'balkenArt', type: 'select', default: 'austritt', group: 'confirm',
        options: [{ value: 'eintritt', labelKey: 'strategies.trendlinien_breakout.balkenEintritt' },
                  { value: 'austritt', labelKey: 'strategies.trendlinien_breakout.balkenAustritt' }],
    },
    { key: 'stochRsiLaenge', type: 'integer', default: 14, min: 3, max: 50, step: 1, group: 'confirm' },
    { key: 'stochLaenge', type: 'integer', default: 14, min: 3, max: 50, step: 1, group: 'confirm' },
    { key: 'stochSmoothK', type: 'integer', default: 3, min: 1, max: 10, step: 1, group: 'confirm' },
    { key: 'stochSmoothD', type: 'integer', default: 3, min: 1, max: 10, step: 1, group: 'confirm' },
    { key: 'stochNiedrig', type: 'number', default: 20, min: 1, max: 49, step: 1, group: 'confirm' },
    { key: 'stochHoch', type: 'number', default: 80, min: 51, max: 99, step: 1, group: 'confirm' },
    { key: 'balkenGueltigKerzen', type: 'integer', default: 0, min: 0, max: 20, step: 1, group: 'confirm' },

    // ── MACD-Filter ───────────────────────────────────────────────
    // Nicht aus dem Video. Die Frage dahinter: Ein Setup entsteht auch dann,
    // wenn die Bewegung schon gelaufen ist — und genau die werden nichts.
    // Zwei entgegengesetzte Lesarten, beide vertretbar:
    //   'frueh'      Long nur, solange die MACD-Linie noch UNTER null steht,
    //                Short nur, solange sie darüber steht. Das kauft in die
    //                frühe Phase hinein, bevor das Momentum ausgereizt ist.
    //   'bestaetigt' die übliche Lesart: Long über null, Short darunter.
    // Welche trägt, entscheidet der Backtest — deshalb sind beide da und die
    // Vorgabe ist 'aus'.
    //
    // GEMESSEN (ETH, 3316 Tageskerzen, 14.09.2026): der Filter taugt hier
    // nichts, und zwar aus einem arithmetischen Grund. Die MACD-Linie IST
    // ema(fast) − ema(slow), also bei 12/26 fast dieselbe Grösse wie die
    // Signalbedingung „EMA12 über EMA25". 'bestaetigt' schneidet deshalb kaum
    // etwas weg (122 von 126 Setups bleiben), 'frueh' widerspricht der
    // Signalbedingung und schneidet fast alles weg (4 von 126). Wer hier
    // filtern will, muss Perioden wählen, die eine ANDERE Ebene messen —
    // 26/50 lässt 106 durch und ändert am Ergebnis ebenfalls wenig.
    {
        key: 'macdFilter', type: 'select', default: 'aus', group: 'confirm',
        options: [{ value: 'aus', labelKey: 'strategies.trendlinien_breakout.macdAus' },
                  { value: 'frueh', labelKey: 'strategies.trendlinien_breakout.macdFrueh' },
                  { value: 'bestaetigt', labelKey: 'strategies.trendlinien_breakout.macdBestaetigt' }],
    },
    { key: 'macdFast', type: 'integer', default: 12, min: 2, max: 50, step: 1, group: 'confirm' },
    { key: 'macdSlow', type: 'integer', default: 26, min: 5, max: 100, step: 1, group: 'confirm' },
    { key: 'macdSignal', type: 'integer', default: 9, min: 1, max: 50, step: 1, group: 'confirm' },
    {
        key: 'macdLinie', type: 'select', default: 'macd', group: 'confirm',
        options: [{ value: 'macd', labelKey: 'strategies.trendlinien_breakout.macdLinieMacd' },
                  { value: 'hist', labelKey: 'strategies.trendlinien_breakout.macdLinieHist' }],
    },

    // ── Übergeordneter Trendfilter ────────────────────────────────
    // Aus dem Referenz-Skript („Macro Moving Average", 200): dort entscheidet
    // er, ob eine K/D-Kreuzung überhaupt markiert wird — bullisch nur über dem
    // MA. Anders als der MACD misst er wirklich etwas anderes als die
    // Signalbedingung: die 200er liegt Grössenordnungen über EMA12/25.
    // GEMESSEN (ETH, volle Historie): 114 statt 126 Setups, +8 statt +7 R —
    // er wirkt, aber er räumt die schlechten Setups nicht ab. Vorgabe aus.
    {
        key: 'macroFilter', type: 'select', default: 'aus', group: 'confirm',
        options: [{ value: 'aus', labelKey: 'strategies.trendlinien_breakout.macroAus' },
                  { value: 'kurs', labelKey: 'strategies.trendlinien_breakout.macroKurs' }],
    },
    { key: 'macroLaenge', type: 'integer', default: 200, min: 20, max: 400, step: 10, group: 'confirm' },
    {
        key: 'macroTyp', type: 'select', default: 'ema', group: 'confirm',
        options: [{ value: 'ema', labelKey: 'strategies.trendlinien_breakout.maEma' },
                  { value: 'sma', labelKey: 'strategies.trendlinien_breakout.maSma' }],
    },

    // ── Struktur (Higher High / Lower Low) ────────────────────────
    { key: 'pivotLinks', type: 'integer', default: 5, min: 1, max: 30, step: 1, group: 'structure' },
    { key: 'pivotRechts', type: 'integer', default: 5, min: 1, max: 30, step: 1, group: 'structure' },
    { key: 'nurHigherHigh', type: 'boolean', default: true, group: 'structure' },
    { key: 'scanWindowCandles', type: 'integer', default: 200, min: 30, max: 1000, step: 10, group: 'structure' },
    {
        key: 'direction', type: 'select', default: 'both', group: 'direction',
        options: [{ value: 'both', labelKey: 'strategies.directionBoth' },
                  { value: 'long', labelKey: 'strategies.trendlinien_breakout.dirLong' },
                  { value: 'short', labelKey: 'strategies.trendlinien_breakout.dirShort' }],
    },

    // ── Ausbruch und Einstieg ─────────────────────────────────────
    // EINE Kerze, und das ist die Regel selbst, keine technische Zutat: das
    // Video wartet darauf, dass die NÄCHSTE Kerze die Linie bricht, und das
    // Referenz-Skript setzt genau das um (`pendUpBar = bar_index + 1`, danach
    // verfällt das Setup). Der Unterschied ist gross — ETH über die volle
    // Historie (2017 bis 14.09.2026, mit Kosten): mit einer Kerze Frist 31
    // Trades / 39 % / +43 $, mit zehn Kerzen 41 / 34 % / −1 $. Ein Ausbruch,
    // der eine Woche auf sich warten lässt, ist eben keiner mehr.
    { key: 'maxWarteKerzen', type: 'integer', default: 1, min: 1, max: 100, step: 1, group: 'entry' },
    { key: 'entryPufferPct', type: 'number', default: 0.05, min: 0, max: 2, step: 0.01, group: 'entry' },
    { key: 'orderGueltigKerzen', type: 'integer', default: 1, min: 1, max: 10, step: 1, group: 'entry' },
    // NICHT aus dem Video: dort wird die Linie gezogen und auf den Bruch
    // gewartet, ohne dass ein Farbwechsel das Setup vorher tötet. Als Vorgabe
    // war das mein Zusatz — und er kostet: über 1000 Tageskerzen von BTC, ETH
    // und SOL (gemessen 13.09.2026, ohne Kosten) 44 Trades / 36 % / +4 R mit
    // Abbruch gegen 52 Trades / 38 % / +8 R ohne ihn. Deshalb aus; wer die
    // strengere Variante will, schaltet sie ein.
    { key: 'abbruchBeiTrendwechsel', type: 'boolean', default: false, group: 'entry' },

    // Wochentagssperre (`tagGesperrt` in indicators.js, geteilt mit LSOB, GUSS
    // und dem Regel-Interpreter — eine zweite Kopie hier wäre genau die Art
    // Doppelung, die irgendwann auseinanderläuft).
    // Nicht aus dem Video, sondern aus der Erfahrung mit dem
    // Krypto-Wochenende: samstags und sonntags fehlt das Volumen, und der
    // Montag beginnt oft mit einer Bewegung, die bis Dienstag wieder eingesammelt
    // ist. Gesperrt wird der EINSTIEG, nicht das Signal: ein Setup, das am
    // Sonntag entsteht und am Dienstag ausbricht, bleibt handelbar. Gerechnet
    // wird in UTC — dieselbe Zeitrechnung wie die Kerzen, damit die Sperre nicht
    // je nach Sommerzeit eine andere Kerze trifft.
    { key: 'sperreSamstag', type: 'boolean', default: false, group: 'entry' },
    { key: 'sperreSonntag', type: 'boolean', default: false, group: 'entry' },
    { key: 'sperreMontag', type: 'boolean', default: false, group: 'entry' },

    // ── Ausstieg ──────────────────────────────────────────────────
    // Das Video nennt beide Möglichkeiten in einem Atemzug („SL zwischen den
    // MAs oder unter dem Swing Low") und lässt offen, wann welche gilt. Vorgabe
    // sind hier die Durchschnitte, weil sie im Video zuerst stehen — und weil
    // der Unterschied gross ist: über 1000 Tageskerzen von BTC, ETH und SOL
    // (gemessen 13.09.2026, ohne Kosten) liefert der Swing-Stop 23 % Treffer
    // und −14 R, der MA-Stop 36 % und +4 R. Der Swing liegt nach einem
    // Ausbruch oft so weit weg, dass das 2-R-Ziel ausser Reichweite gerät.
    {
        key: 'slQuelle', type: 'select', default: 'mas', group: 'exit',
        options: [{ value: 'swing', labelKey: 'strategies.trendlinien_breakout.slSwing' },
                  { value: 'mas', labelKey: 'strategies.trendlinien_breakout.slMas' }],
    },
    { key: 'slPufferPct', type: 'number', default: 0.2, min: 0, max: 3, step: 0.01, group: 'exit' },
    { key: 'tpRR', type: 'number', default: 2, min: 0.5, max: 15, step: 0.5, group: 'exit' },
    { key: 'minRR', type: 'number', default: 0, min: 0, max: 10, step: 0.1, group: 'exit' },
    { key: 'breakEvenAtR', type: 'number', default: 0, min: 0, max: 10, step: 0.1, group: 'exit' },
    { key: 'maxHoldCandles', type: 'integer', default: 0, min: 0, max: 2000, step: 1, group: 'exit' },
]

const paramGroups = [
    { id: 'trend', labelKey: 'strategies.groups.trend' },
    { id: 'confirm', labelKey: 'strategies.groups.confirm' },
    { id: 'structure', labelKey: 'strategies.groups.structure' },
    { id: 'direction', labelKey: 'strategies.groups.direction' },
    { id: 'entry', labelKey: 'strategies.groups.entry' },
    { id: 'exit', labelKey: 'strategies.groups.exit' },
]

// ── Hilfsfunktionen (rein, deshalb exportiert und einzeln testbar) ────────

/**
 * Ampel des OBV: +1 über seiner Linie, -1 darunter, 0 solange die Linie noch
 * keinen Wert hat.
 *
 * Der OBV-Absolutwert hängt vom Anfang des Fensters ab und sagt für sich
 * nichts; verglichen wird er deshalb immer mit seinem eigenen Durchschnitt.
 */
export function obvAmpel(candles, { laenge = 200, art = 'ema' } = {}) {
    const reihe = obv(candles)
    const linie = art === 'sma' ? smaSerie(reihe, laenge) : emaSerie(reihe, laenge)
    return reihe.map((v, i) => {
        const l = linie[i]
        if (v === null || l === null || l === undefined) return 0
        return v > l ? 1 : (v < l ? -1 : 0)
    })
}

/**
 * Balken-Ereignisse des Trendscanners, gerechnet über den Stoch-RSI.
 *
 * Die Richtung ist die Falle. Zwei Lesarten sind denkbar, und sie sind
 * GEGENSÄTZLICH:
 *
 *   'eintritt' — grün, wenn %K UNTER die untere Schwelle fällt; rot, wenn es
 *     ÜBER die obere steigt. Der Balken markiert also den Moment, in dem der
 *     Markt überverkauft bzw. überkauft WIRD. In einem Aufwärtstrend ist das
 *     der Rücksetzer — genau der Punkt, an dem die Strategie kaufen will.
 *   'austritt' — grün beim Verlassen der überverkauften Zone, rot beim
 *     Verlassen der überkauften.
 *
 * Beide Quellen sagen 'austritt', und beide sagen es ausdrücklich: der Scanner
 * aus dem Video (Trader XO) wirbt mit dem Alarm „war über 80 und fällt
 * darunter — rot", und das Referenz-Skript („Mo's Swing Game") markiert
 * dasselbe: %K unter das obere Band = rot, %K über das untere = grün, die
 * Gegenrichtung nur auf ausdrücklichen Wunsch. Das ist die Vorgabe hier.
 *
 * Gemessen über 1000 Tageskerzen von BTC, ETH und SOL (13.09.2026, ohne
 * Kosten): 'austritt' 52 Trades / 38 % / +8 R, 'eintritt' 57 / 34 % / +1 R —
 * und ganz ohne diese Bedingung 50 / 47 % / +20 R. Der Balken verbessert also
 * in KEINER Lesart, er verengt nur. Das ist ein Messergebnis auf drei
 * Symbolen, kein Urteil; wer die Regel des Videos vollständig will, lässt ihn
 * an. 'eintritt' bleibt als Gegenprobe, nicht als zweite Lehrmeinung.
 *
 * `balkenGueltigKerzen` verlängert das Ereignis um N Kerzen. Vorgabe ist 0 —
 * das Referenz-Skript verlangt alle drei Bedingungen auf DERSELBEN Kerze
 * (`obv > obvEma and emaGreen and leaveOs`), und gemessen ist das auch besser:
 * ETH über die volle Historie 31 Trades / 39 % / +43 $ ohne Toleranz gegen
 * 41 / 34 % / −1 $ mit drei Kerzen (dort zusammen mit der längeren Wartefrist).
 *
 * @returns {Array<1|-1|0>} je Kerze: 1 grün gültig, -1 rot gültig, 0 keins
 */
export function balkenReihe(candles, p) {
    const n = candles.length
    const out = new Array(n).fill(0)
    const { k } = stochRsi(candles, {
        rsiPeriod: p.stochRsiLaenge, stochPeriod: p.stochLaenge,
        smoothK: p.stochSmoothK, smoothD: p.stochSmoothD,
    })
    const halten = Math.max(0, p.balkenGueltigKerzen)
    for (let i = 1; i < n; i++) {
        const v = k[i]
        const vor = k[i - 1]
        if (v === null || vor === null) continue
        let richtung = 0
        if (p.balkenArt === 'austritt') {
            if (vor <= p.stochNiedrig && v > p.stochNiedrig) richtung = 1
            else if (vor >= p.stochHoch && v < p.stochHoch) richtung = -1
        } else {
            if (vor >= p.stochNiedrig && v < p.stochNiedrig) richtung = 1
            else if (vor <= p.stochHoch && v > p.stochHoch) richtung = -1
        }
        if (!richtung) continue
        for (let j = i; j <= Math.min(n - 1, i + halten); j++) out[j] = richtung
    }
    return out
}

/**
 * Preis der Trendlinie zum Zeitpunkt `t`.
 *
 * Gerechnet wird in ZEIT, nicht in Kerzenindizes: das Sichtfenster des
 * Detectors wandert, Indizes verschieben sich damit, Zeitstempel nicht.
 * `steigung === 0` ist die waagerechte Linie (Anker über dem Schlusskurs).
 */
export function linienPreis(ankerZeit, ankerPreis, bisZeit, bisPreis, t) {
    if (!(bisZeit > ankerZeit)) return bisPreis
    const m = (bisPreis - ankerPreis) / (bisZeit - ankerZeit)
    return bisPreis + m * (t - bisZeit)
}

/** Letztes bestätigtes Pivot-Extrem vor `bisIndex`, optional nur als HH/LL. */
function letzterAnker(pivots, bisIndex, nurStrenger, long) {
    for (let n = pivots.length - 1; n >= 0; n--) {
        const p = pivots[n]
        if (p.index > bisIndex) continue
        if (!nurStrenger) return p
        const vorher = pivots[n - 1]
        if (!vorher) continue
        // Higher High bzw. Lower Low gegenüber dem vorherigen Pivot derselben Seite
        if (long ? p.price > vorher.price : p.price < vorher.price) return p
    }
    return null
}

/** Stop-Kurs nach gewählter Quelle; 0, wenn er auf der falschen Seite läge. */
function berechneStop(p, long, entry, swingPreis, emaSchnell, emaLangsam) {
    let roh = 0
    if (p.slQuelle === 'mas') {
        // „Zwischen den Durchschnitten" — die Mitte der beiden, nicht einer von
        // beiden: der schnelle allein liegt im Ausbruch fast immer schon über
        // dem Einstieg, der langsame oft mehrere Prozent entfernt.
        if (emaSchnell === null || emaLangsam === null) return 0
        roh = (emaSchnell + emaLangsam) / 2
    } else {
        if (!(swingPreis > 0)) return 0
        roh = swingPreis
    }
    const puffer = p.slPufferPct / 100
    const stop = long ? roh * (1 - puffer) : roh * (1 + puffer)
    if (long ? !(stop < entry) : !(stop > entry)) return 0
    return stop
}

// ── detect ───────────────────────────────────────────────────────────────

/**
 * @param {object} input
 * @param {Array}  input.candles          geschlossene Kerzen, aufsteigend
 * @param {object} input.params           validierte Parameter
 * @param {Array}  input.openSetups       laufende Setups mit id
 * @param {Array}  [input.knownSetupKeys] ALLE bekannten `${direction}|${obCandleTime}`
 *
 * @returns {{ setups: Array, events: Array, diagnostics: object }}
 */
function detect({ candles, params: p, openSetups = [], knownSetupKeys = [] }) {
    const setups = []
    const events = []
    const diagnostics = { sweepsFound: 0, setupsCreated: 0, rejected: {}, rejections: [] }

    const reject = (reason, key) => {
        diagnostics.rejected[reason] = (diagnostics.rejected[reason] || 0) + 1
        diagnostics.rejections.push({ reason, key })
    }

    const mindestens = Math.max(
        p.obvLaenge, p.emaSlow, p.stochRsiLaenge + p.stochLaenge,
        p.macdFilter !== 'aus' ? p.macdSlow + p.macdSignal : 0,
        p.macroFilter !== 'aus' ? p.macroLaenge : 0,
    ) + p.pivotLinks + p.pivotRechts + 5
    if (!Array.isArray(candles) || candles.length < mindestens) {
        return { setups, events, diagnostics }
    }

    const ampel = obvAmpel(candles, { laenge: p.obvLaenge, art: p.obvMaArt })
    const emaF = ema(candles, p.emaFast)
    const emaS = ema(candles, p.emaSlow)
    const balken = p.verlangeBalken ? balkenReihe(candles, p) : null
    const macroReihe = p.macroFilter !== 'aus'
        ? (p.macroTyp === 'sma' ? sma(candles, p.macroLaenge) : ema(candles, p.macroLaenge))
        : null
    const macdReihe = p.macdFilter !== 'aus'
        ? macd(candles, { fast: p.macdFast, slow: p.macdSlow, signal: p.macdSignal, line: p.macdLinie })
        : null
    const hochs = pivotHighs(candles, p.pivotLinks, p.pivotRechts)
    const tiefs = pivotLows(candles, p.pivotLinks, p.pivotRechts)

    const richtungen = p.direction === 'both' ? ['long', 'short'] : [p.direction]

    const bekannt = new Set(knownSetupKeys)
    for (const s of openSetups) bekannt.add(`${s.direction}|${s.obCandleTime}`)

    /** Sind an Kerze i alle Bedingungen der Trendvariante erfüllt? */
    const trendVariante = (i, long) => {
        if (!p.signalTrend) return false
        if (ampel[i] !== (long ? 1 : -1)) return false
        if (emaF[i] === null || emaS[i] === null) return false
        if (long ? !(emaF[i] > emaS[i]) : !(emaF[i] < emaS[i])) return false
        if (balken && balken[i] !== (long ? 1 : -1)) return false
        return true
    }

    /** Kreuzung der beiden Durchschnitte auf Kerze i, in Trendrichtung. */
    const kreuzVariante = (i, long) => {
        if (!p.signalKreuzung) return false
        if (ampel[i] !== (long ? 1 : -1)) return false
        if (emaF[i] === null || emaS[i] === null || emaF[i - 1] === null || emaS[i - 1] === null) return false
        return long
            ? emaF[i] > emaS[i] && emaF[i - 1] <= emaS[i - 1]
            : emaF[i] < emaS[i] && emaF[i - 1] >= emaS[i - 1]
    }

    // ══ Phase A: neue Setups ══════════════════════════════════════════════
    const scanAb = Math.max(1, candles.length - p.scanWindowCandles)

    for (const dir of richtungen) {
        const long = dir === 'long'
        for (let i = scanAb; i < candles.length; i++) {
            const trend = trendVariante(i, long)
            const kreuz = kreuzVariante(i, long)
            if (!trend && !kreuz) continue
            // Nur die Kerze zählt, auf der die letzte fehlende Bedingung
            // erfüllt wurde. Sonst entstünde in jedem Takt eines Trends ein
            // weiteres Setup auf demselben Impuls.
            if (trend && !kreuz && trendVariante(i - 1, long)) continue

            const key = `${dir}|${candles[i].t}`
            if (bekannt.has(key)) continue
            diagnostics.sweepsFound++

            // MACD-Filter: ein noch nicht vorhandener Wert ist KEIN Freibrief —
            // ohne Aussage wird nicht gehandelt, sonst wäre der Filter am
            // Anfang jedes Fensters stillschweigend abgeschaltet.
            // Übergeordneter Trend: der Schlusskurs der Signalkerze muss auf
            // der richtigen Seite der langsamen Linie stehen. Fehlt sie (zu
            // kurze Historie), wird nicht gehandelt — wie beim MACD.
            if (macroReihe) {
                const m = macroReihe[i]
                const ok = m === null || m === undefined
                    ? false
                    : (long ? candles[i].c > m : candles[i].c < m)
                if (!ok) { reject(INVALID_REASONS.MACRO_FILTER, key); continue }
            }

            if (macdReihe) {
                const v = macdReihe[i]
                const ok = v === null || v === undefined
                    ? false
                    : (p.macdFilter === 'frueh'
                        ? (long ? v < 0 : v > 0)
                        : (long ? v > 0 : v < 0))
                if (!ok) { reject(INVALID_REASONS.MACD_FILTER, key); continue }
            }

            // Der Anker muss BESTÄTIGT sein: ein Pivot ist erst `pivotRechts`
            // Kerzen später überhaupt erkennbar. Ohne diese Schranke würde auf
            // Wissen gehandelt, das es zum Signalzeitpunkt nicht gab.
            const anker = letzterAnker(long ? hochs : tiefs, i - p.pivotRechts, p.nurHigherHigh, long)
            if (!anker) { reject(INVALID_REASONS.KEIN_ANKER, key); continue }

            const close = candles[i].c
            // Liegt der Schlusskurs schon jenseits des Ankers, ist keine
            // geneigte Linie konstruierbar — dann die waagerechte auf
            // Ankerhöhe (im Video das dritte Kaufsignal).
            const waagerecht = long ? close >= anker.price : close <= anker.price

            bekannt.add(key)
            setups.push({
                direction: dir,
                status: 'waiting_retest',
                sweepLevel: anker.price,                      // Ankerpunkt der Linie
                sweepPrice: waagerecht ? anker.price : close, // zweiter Punkt
                sweepCandleTime: candles[anker.index].t,
                obHigh: emaF[i],
                obLow: emaS[i],
                obCandleTime: candles[i].t,
                impulseExtreme: anker.price,
                entry: 0,
                stopLoss: 0,
                takeProfit: 0,
                rr: 0,
                confirmations: {
                    signal: kreuz ? 'kreuzung' : 'trend',
                    linie: waagerecht ? 'waagerecht' : 'schraeg',
                    entryTrigger: 'stop',
                },
                detectorVersion: DETECTOR_VERSION,
                entryTrigger: 'stop',
                // Beobachtet und gehandelt wird ab der Kerze NACH dem Signal:
                // die Signalkerze selbst ist erst mit ihrem Schluss bekannt.
                watchFrom: candles[i].t,
                tradeableFrom: candles[i].t,
            })
            diagnostics.setupsCreated++
        }
    }

    // ══ Phase B: laufende Setups ══════════════════════════════════════════
    for (const s of openSetups) {
        if (s.status !== 'waiting_retest' && s.status !== 'armed') continue
        const long = s.direction === 'long'

        const ab = Number(s.watchFrom || s.obCandleTime) || 0
        const start = candles.findIndex((c) => c.t > ab)
        if (start === -1) continue

        const ankerZeit = Number(s.sweepCandleTime) || 0
        const ankerPreis = Number(s.sweepLevel) || 0
        const bisPreis = Number(s.sweepPrice) || 0
        const waagerecht = bisPreis === ankerPreis

        let gewartet = 0
        let erledigt = false

        for (let i = start; i < candles.length && !erledigt; i++) {
            const k = candles[i]
            gewartet++

            // (a) Trend gedreht — das Setup lebt von der Richtung, die es
            //     erzeugt hat. Ohne diesen Abbruch würde ein Ausbruch gehandelt,
            //     dessen Voraussetzung längst weggefallen ist.
            if (p.abbruchBeiTrendwechsel) {
                const gegen = ampel[i] === (long ? -1 : 1)
                    || (emaF[i] !== null && emaS[i] !== null
                        && (long ? emaF[i] < emaS[i] : emaF[i] > emaS[i]))
                if (gegen) {
                    events.push({ id: s.id, status: 'invalidated', invalidReason: INVALID_REASONS.TREND_GEDREHT, candleTime: k.t })
                    erledigt = true; break
                }
            }

            // (b) Bricht diese Kerze die Linie und schliesst jenseits davon?
            const linie = waagerecht
                ? ankerPreis
                : linienPreis(ankerZeit, ankerPreis, Number(s.obCandleTime), bisPreis, k.t)
            const gebrochen = long ? k.c > linie : k.c < linie

            if (gebrochen) {
                const entry = long
                    ? k.h * (1 + p.entryPufferPct / 100)
                    : k.l * (1 - p.entryPufferPct / 100)

                // Swing hinter dem Ausbruch: das letzte bestätigte Pivot-Extrem
                // der Gegenseite, ersatzweise das Extrem seit der Signalkerze.
                const gegenPivots = long ? tiefs : hochs
                let swing = 0
                for (let n = gegenPivots.length - 1; n >= 0; n--) {
                    if (gegenPivots[n].index <= i - p.pivotRechts) { swing = gegenPivots[n].price; break }
                }
                if (!swing) {
                    let ext = long ? Infinity : -Infinity
                    for (let j = Math.max(0, start - 1); j <= i; j++) {
                        ext = long ? Math.min(ext, candles[j].l) : Math.max(ext, candles[j].h)
                    }
                    swing = Number.isFinite(ext) ? ext : 0
                }

                const stopLoss = berechneStop(p, long, entry, swing, emaF[i], emaS[i])
                if (!(stopLoss > 0)) {
                    events.push({ id: s.id, status: 'rejected', invalidReason: INVALID_REASONS.STOP_UNGUELTIG, candleTime: k.t })
                    erledigt = true; break
                }

                const risiko = Math.abs(entry - stopLoss)
                const takeProfit = long ? entry + risiko * p.tpRR : entry - risiko * p.tpRR
                const rr = p.tpRR
                if (p.minRR > 0 && rr < p.minRR) {
                    events.push({ id: s.id, status: 'rejected', invalidReason: 'below_min_rr', candleTime: k.t })
                    erledigt = true; break
                }

                // (c) Die Order liegt erst AB DER NÄCHSTEN Kerze im Markt und
                //     verfällt, wenn sie dort nicht ausgelöst wird.
                let gefuellt = false
                let gesperrt = false
                for (let j = i + 1; j < candles.length && j <= i + p.orderGueltigKerzen; j++) {
                    const kk = candles[j]
                    const erreicht = long ? kk.h >= entry : kk.l <= entry
                    if (!erreicht) continue
                    // Der Kurs hätte die Order genommen — nur an diesem Tag wird
                    // nicht eingestiegen. Das wird eigens vermerkt, sonst steht
                    // im Trichter „Order nicht ausgelöst", und der Unterschied
                    // zwischen „Markt kam nicht" und „wir wollten nicht" ginge
                    // verloren.
                    if (tagGesperrt(kk.t, p)) { gesperrt = true; continue }
                    events.push({
                        id: s.id, status: 'triggered', triggeredAt: kk.t, candleTime: kk.t,
                        entry, stopLoss, takeProfit, rr,
                        entryTrigger: 'stop',
                        confirmations: {
                            ...(s.confirmations || {}),
                            entryTrigger: 'stop',
                            ausbruchKerzen: gewartet,
                            linie: waagerecht ? 'waagerecht' : 'schraeg',
                        },
                    })
                    gefuellt = true
                    break
                }

                if (gefuellt) { erledigt = true; break }

                // Erst wenn das Zeitfenster der Order abgelaufen IST, darf sie
                // als verfallen gelten — sonst stirbt sie im selben Takt, in
                // dem sie entstanden ist, nur weil die Folgekerze noch fehlt.
                if (candles.length - 1 >= i + p.orderGueltigKerzen) {
                    const grund = gesperrt ? INVALID_REASONS.WOCHENTAG_GESPERRT : INVALID_REASONS.ORDER_VERFALLEN
                    events.push({ id: s.id, status: 'expired', invalidReason: grund, candleTime: candles[Math.min(candles.length - 1, i + p.orderGueltigKerzen)].t })
                    erledigt = true
                }
                break
            }

            // (d) Zu lange kein Ausbruch.
            //
            // `>=`, nicht `>`: die Prüfung steht NACH der Bruchprüfung, also
            // ist `gewartet` bereits die Zahl der angesehenen Kerzen. Mit `>`
            // bekam das Setup eine Kerze mehr, als eingestellt war — bei der
            // Vorgabe 1 also zwei, und damit genau nicht die Regel des Videos
            // („die nächste Kerze"). Der Fehler fiel erst auf, als die Frist
            // von zehn auf eins ging und der Unterschied ein Verdoppeln war.
            if (gewartet >= p.maxWarteKerzen) {
                events.push({ id: s.id, status: 'expired', invalidReason: INVALID_REASONS.KEIN_AUSBRUCH, candleTime: k.t })
                erledigt = true; break
            }
        }
    }

    return { setups, events, diagnostics }
}

export default {
    id: 'trendlinien_breakout',
    name: 'Trendlinien-Ausbruch',
    description: 'OBV und zwei Durchschnitte geben die Richtung; die Trendlinie vom letzten Higher High zum Signalschluss wird gebrochen, Einstieg per Stop-Order über der Ausbruchskerze.',
    version: DETECTOR_VERSION,
    supportedTimeframes: ['15m', '30m', '1h', '4h', '1d'],
    warmupCandles: 400,
    params,
    paramGroups,
    detect,
}
