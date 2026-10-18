/**
 * Indikatoren für den Chart — Definitionen und Rechnung.
 *
 * Gerechnet wird ausschliesslich mit `shared/indicators.js`, derselben Datei,
 * die die Strategie-Detektoren benutzen. Ein RSI im Chart, der vom RSI der
 * Strategie abweicht, wäre schlimmer als keiner: man sähe ein Signal, das die
 * Strategie nie gesehen hat.
 *
 * Diese Datei kennt Lightweight Charts NICHT — sie liefert Zahlenreihen.
 * Gezeichnet wird in `indikatorZeichner.js`. So bleibt die Rechnung im
 * Selbsttest prüfbar (`src/utils/__selftest-chart-indikatoren.mjs`).
 *
 * Aufbau einer Definition:
 *   ort       'preis' (im Kerzen-Pane) | 'eigen' (eigenes Pane darunter)
 *   params    [{ key, typ: 'zahl'|'wahl'|'schalter'|'farbe', vorgabe, min, max, schritt, optionen, gruppe, roh }]
 *             `gruppe` ordnet im Dialog unter eine Überschrift, `roh` zeigt die
 *             Optionen einer Wahl unübersetzt (Zeiteinheiten).
 *   ausgabenFuer(p)  (optional) Ausgaben je nach Einstellung — nur was an ist,
 *             bekommt eine Serie (VWAP Vector: 13 schaltbare Linien)
 *   ausgaben  [{ key, art: 'linie'|'histogramm', farbe, breite }]
 *   linien    feste Marken im Pane (z. B. 70/30 beim RSI)
 *   band      (optional) { oben, unten, linie } — getöntes Band zwischen den
 *             Marken und gefüllte Ausschläge der `linie` darüber/darunter, wie
 *             TradingView RSI und Stochastik zeichnet
 *   ausgaben[].vierFarben  Histogramm in vier Stufen (über/unter null ×
 *             steigend/fallend) — das MACD-Histogramm von TradingView
 *   rechne(kerzen, p, ext) → { [ausgabeKey]: Array<number|null> } gleich lang wie kerzen
 *   extern    (optional) Name einer Datenquelle, die das Panel nachlädt — Open
 *             Interest, Funding, Momentum. `ext` sind dann deren Punkte; sie
 *             werden hier auf die Kerzenzeiten gelegt.
 */
import {
    sma, ema, bollinger, vwap, vwapBand, rsi, macd, stochastic, stochRsi, atr, adx, obv, mfi, volumeSma, smaSerie,
} from '../../../shared/indicators.js'
import { rechneVwapVector } from './vwapVector.js'

/** Preisquelle — wie bei TradingView wählbar. */
export const QUELLEN = {
    c: (k) => k.c,
    o: (k) => k.o,
    h: (k) => k.h,
    l: (k) => k.l,
    hl2: (k) => (k.h + k.l) / 2,
    hlc3: (k) => (k.h + k.l + k.c) / 3,
    ohlc4: (k) => (k.o + k.h + k.l + k.c) / 4,
}

/**
 * Die Detektoren rechnen auf `k.c`. Für eine andere Quelle bekommt die
 * Funktion Kerzen, deren Schluss durch die Quelle ersetzt ist — so bleibt
 * `shared/indicators.js` unverändert die einzige Rechnung.
 */
function mitQuelle(kerzen, quelle) {
    if (!quelle || quelle === 'c') return kerzen
    const f = QUELLEN[quelle] || QUELLEN.c
    return kerzen.map((k) => ({ ...k, c: f(k) }))
}

/**
 * Punkte einer fremden Reihe auf die Kerzen legen: jede Kerze bekommt den
 * letzten Wert, der zu ihrer Eröffnung bekannt war. Vor dem ersten Punkt null
 * — nicht 0, sonst sähe der Anfang wie ein Einbruch aus.
 */
export function aufKerzen(kerzen, punkte, feld, { amSchluss = false } = {}) {
    const aus = new Array(kerzen.length).fill(null)
    if (!Array.isArray(punkte) || !punkte.length) return aus
    const p = [...punkte].sort((a, b) => a.t - b.t)
    // Kerzenlänge aus den Nachbarn (der Register kennt die Zeiteinheit nicht).
    const laenge = (i) => (kerzen[i + 1] ? kerzen[i + 1].t - kerzen[i].t : i > 0 ? kerzen[i].t - kerzen[i - 1].t : 0)
    let j = -1
    for (let i = 0; i < kerzen.length; i++) {
        // `amSchluss`: ein Messpunkt ist ein STAND zur Zeit t (OI, Long/Short) und gehört
        // zur Kerze, die um t SCHLIESST — das OI von 14:00 ist der Stand am Ende der
        // 13-Uhr-Kerze (gemessen 18.10.2026: der 5m-Eintrag „13:15" erscheint um 13:17,
        // vor dem Ende von 13:15–13:20, ist also kein Periodenbeginn). Vorher stand er
        // auf der 14-Uhr-Kerze, eine Kerze zu spät, und der Balken „Positionen kamen
        // dazu" sass neben der Kerze, in der es geschah.
        const grenze = amSchluss ? kerzen[i].t + laenge(i) : kerzen[i].t
        while (j + 1 < p.length && p[j + 1].t <= grenze) j++
        if (j >= 0) {
            const v = Number(p[j][feld])
            aus[i] = Number.isFinite(v) ? v : null
        }
    }
    return aus
}

/**
 * Veränderung zur Vorkerze. Ein fortgeschriebener Wert (stündliches OI auf
 * 15m-Kerzen) ist keine Veränderung von 0, sondern keine Messung → null;
 * sonst stünden drei von vier Balken als flache Null da.
 */
export function veraenderung(werte) {
    return werte.map((w, i) => {
        const v = werte[i - 1]
        if (i === 0 || w == null || v == null || w === v) return null
        return w - v
    })
}

/**
 * Ereignisse (Funding-Zahlungen) der Kerze zuordnen, in die sie fallen, und
 * je Kerze summieren. Kerzen ohne Zahlung bleiben leer: auf 15m zahlt nur
 * jede 16. bzw. 32. Kerze.
 */
export function jeKerzeSumme(kerzen, punkte, feld, faktor = 1) {
    const aus = new Array(kerzen.length).fill(null)
    if (!Array.isArray(punkte) || !punkte.length || !kerzen.length) return aus
    let i = 0
    for (const pkt of [...punkte].sort((a, b) => a.t - b.t)) {
        if (pkt.t < kerzen[0].t) continue
        while (i + 1 < kerzen.length && kerzen[i + 1].t <= pkt.t) i++
        const v = Number(pkt[feld]) * faktor
        if (!Number.isFinite(v)) continue
        aus[i] = (aus[i] ?? 0) + v
    }
    return aus
}

/** Werte, die genau zu Kerzenzeiten gehören (Momentum: gleiche Zeiteinheit). */
function nachZeit(kerzen, zeiten, werte) {
    const aus = new Array(kerzen.length).fill(null)
    if (!Array.isArray(zeiten) || !Array.isArray(werte)) return aus
    const karte = new Map(zeiten.map((t, i) => [t, werte[i]]))
    for (let i = 0; i < kerzen.length; i++) {
        const v = karte.get(kerzen[i].t)
        if (Number.isFinite(v)) aus[i] = v
    }
    return aus
}

const P_LAENGE = (vorgabe, max = 500) => ({ key: 'laenge', typ: 'zahl', vorgabe, min: 1, max, schritt: 1 })
const P_QUELLE = { key: 'quelle', typ: 'wahl', vorgabe: 'c', optionen: Object.keys(QUELLEN) }
// ── Mo's VWAP Vector (Pine des Users, Rechnung in vwapVector.js) ─────────
const TFS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']
const S = (key, vorgabe, gruppe) => ({ key, typ: 'schalter', vorgabe, gruppe })
const F = (key, vorgabe, gruppe) => ({ key, typ: 'farbe', vorgabe, gruppe })
const Z = (key, vorgabe, min, max, schritt, gruppe) => ({ key, typ: 'zahl', vorgabe, min, max, schritt, gruppe })
const W = (key, vorgabe, optionen, gruppe, roh = false) => ({ key, typ: 'wahl', vorgabe, optionen, gruppe, roh })

/** Linien des VWAP Vector: Ausgabe-Key → [Schalter, Farb-Param, Beschriftung]. */
export const VV_LINIEN = [
    ['vwapD', 'showDaily', 'cDaily', 'VWAP-D', 'vwap'],
    ['vwapW', 'showWeekly', 'cWeekly', 'VWAP-W', 'vwap'],
    ['vwapM', 'showMonthly', 'cMonthly', 'VWAP-M', 'vwap'],
    ['vwapATH', 'showATH', 'cATH', 'VWAP-ATH', 'vwap'],
    ['vwapATL', 'showATL', 'cATL', 'VWAP-ATL', 'vwap'],
    ['ema21', 'showEma21', 'cEma21', 'EMA 21', 'ema'],
    ['ema50', 'showEma50', 'cEma50', 'EMA 50', 'ema'],
    ['ema200', 'showEma200', 'cEma200', 'EMA 200', 'ema'],
    ['emaC1', 'showEmaC1', 'cEmaC1', (p) => `EMA ${p.lenEmaC1}`, 'ema'],
    ['emaC2', 'showEmaC2', 'cEmaC2', (p) => `EMA ${p.lenEmaC2}`, 'ema'],
    ['mtf1', 'showMtfE1', 'cMtfE1', (p) => `EMA ${p.lenMtfE1} ${p.tfMtfE1}`, 'ema'],
    ['mtf2', 'showMtfE2', 'cMtfE2', (p) => `EMA ${p.lenMtfE2} ${p.tfMtfE2}`, 'ema'],
    ['mtf3', 'showMtfE3', 'cMtfE3', (p) => `EMA ${p.lenMtfE3} ${p.tfMtfE3}`, 'ema'],
]

/*
 * Dialog-Aufbau: `haupt` = Hauptschalter der Gruppe (steht in der Überschrift),
 * `mit` = gehört in die Zeile des Parameters davor (Schalter · Länge · Farbe
 * in EINER Zeile statt drei). Die Werte selbst sind die des Pine.
 */
const H = (p) => ({ ...p, haupt: true })
const M = (p) => ({ ...p, mit: true })
const VV_PARAMS = [
    // 1 PVSRA
    H(S('showVector', true, 'pvsra')), Z('climaxMult', 2, 0.5, 10, 0.1, 'pvsra'), Z('risingMult', 1.5, 0.5, 10, 0.1, 'pvsra'),
    Z('pvsraLen', 10, 1, 200, 1, 'pvsra'),
    F('cClimaxBull', '#00e600', 'pvsra'), M(F('cClimaxBear', '#ff0000', 'pvsra')),
    F('cRisingBull', '#0000ff', 'pvsra'), M(F('cRisingBear', '#da00ff', 'pvsra')),
    F('cNeutBull', '#999999', 'pvsra'), M(F('cNeutBear', '#4d4d4d', 'pvsra')),
    Z('vecDeckkraft', 80, 0, 100, 5, 'pvsra'),
    // 2 VWAP
    S('showDaily', false, 'vwap'), M(F('cDaily', '#70ccbd', 'vwap')),
    S('showWeekly', false, 'vwap'), M(F('cWeekly', '#ffffff', 'vwap')),
    S('showMonthly', false, 'vwap'), M(F('cMonthly', '#f06292', 'vwap')),
    S('showATH', false, 'vwap'), M(F('cATH', '#00bcd4', 'vwap')),
    S('showATL', false, 'vwap'), M(F('cATL', '#3355ff', 'vwap')),
    S('showSwingHi', true, 'vwap'), M(F('cSwingHi', '#5cb85c', 'vwap')),
    S('showSwingLo', true, 'vwap'), M(F('cSwingLo', '#880e4f', 'vwap')),
    Z('swingWidth', 2, 1, 5, 1, 'vwap'), M(W('swingStyle', 'gestrichelt', ['gestrichelt', 'durchgezogen', 'gepunktet'], 'vwap')),
    Z('swingPivLen', 20, 2, 200, 1, 'vwap'), Z('swingCnt', 1, 1, 3, 1, 'vwap'), Z('swingMinSep', 1, 0, 20, 0.1, 'vwap'),
    S('labelVWAPS', true, 'vwap'), M(Z('lblOffVwap', 12, 0, 100, 1, 'vwap')),
    // 3 EMA
    S('showEma21', true, 'ema'), M(F('cEma21', '#f5d300', 'ema')),
    S('showEma50', true, 'ema'), M(F('cEma50', '#ff9800', 'ema')),
    S('showEma200', true, 'ema'), M(F('cEma200', '#e0e0e0', 'ema')),
    S('showEmaC1', false, 'ema'), M(Z('lenEmaC1', 200, 1, 2000, 1, 'ema')), M(F('cEmaC1', '#7b2fbe', 'ema')),
    S('showEmaC2', false, 'ema'), M(Z('lenEmaC2', 800, 1, 2000, 1, 'ema')), M(F('cEmaC2', '#a52020', 'ema')),
    S('showMtfE1', true, 'ema'), M(Z('lenMtfE1', 13, 1, 1000, 1, 'ema')), M(W('tfMtfE1', '1d', TFS, 'ema', true)), M(F('cMtfE1', '#00bcd4', 'ema')),
    S('showMtfE2', true, 'ema'), M(Z('lenMtfE2', 50, 1, 1000, 1, 'ema')), M(W('tfMtfE2', '1d', TFS, 'ema', true)), M(F('cMtfE2', '#e65100', 'ema')),
    S('showMtfE3', false, 'ema'), M(Z('lenMtfE3', 200, 1, 1000, 1, 'ema')), M(W('tfMtfE3', '1d', TFS, 'ema', true)), M(F('cMtfE3', '#b388ff', 'ema')),
    S('labelEMAS', true, 'ema'), M(Z('lblOffEma', 3, 0, 100, 1, 'ema')),
    // 4 Fibonacci
    H(S('showFib', false, 'fib')), W('fibTf', '4h', TFS, 'fib', true), Z('fibAtrMult', 3, 0.5, 20, 0.5, 'fib'),
    S('fL0', true, 'fib'), M(F('cL0', '#787b86', 'fib')), S('fL236', false, 'fib'), M(F('cL236', '#f23645', 'fib')),
    S('fL382', false, 'fib'), M(F('cL382', '#ff9800', 'fib')), S('fL5', false, 'fib'), M(F('cL5', '#4caf50', 'fib')),
    S('fL618', true, 'fib'), M(F('cL618', '#089981', 'fib')), S('fL786', true, 'fib'), M(F('cL786', '#64b5f6', 'fib')),
    S('fL1', true, 'fib'), M(F('cL1', '#787b86', 'fib')),
    // 5 Engulfing
    H(S('showEng', true, 'eng')), Z('engMinBody', 1, 0, 10, 0.1, 'eng'), S('engVolConf', false, 'eng'),
    F('cEngBull', '#00e676', 'eng'), M(F('cEngBear', '#ff1744', 'eng')),
    // 6 Perioden-POC
    H(S('showPocPer', true, 'pocPer')), W('pocPerTf', '1d', ['4h', '12h', '1d', '1w', '1M'], 'pocPer', true),
    Z('pocPerBins', 50, 10, 200, 1, 'pocPer'), Z('pocPerMax', 20, 1, 100, 1, 'pocPer'),
    S('pocPerExt', true, 'pocPer'), S('pocPerLbl', true, 'pocPer'), M(Z('lblOffPocPer', 22, 0, 100, 1, 'pocPer')),
    F('cPocPer', '#ab47bc', 'pocPer'), M(Z('pocPerWid', 2, 1, 4, 1, 'pocPer')), Z('pocPerDist', 4, 0, 50, 0.5, 'pocPer'),
    // 7 Candle-POC
    H(S('showPocC', true, 'pocC')), Z('pocCPiv', 5, 1, 20, 1, 'pocC'), W('pocCTf', '1m', ['1m', '3m', '5m', '15m'], 'pocC', true),
    Z('pocCBins', 25, 5, 100, 1, 'pocC'), Z('pocCMax', 60, 5, 300, 1, 'pocC'),
    S('pocCLabel', false, 'pocC'), M(Z('lblOffPocC', 22, 0, 100, 1, 'pocC')),
    F('cPocC', '#26c6da', 'pocC'), M(Z('pocCWidth', 2, 1, 4, 1, 'pocC')),
    S('pocCAll', true, 'pocC'), M(F('cPocCAll', '#26c6da', 'pocC')), M(Z('pocCAllW', 1, 1, 4, 1, 'pocC')),
    // 8 Vektorkerzen-Zonen
    H(S('showVliq', true, 'vliq')), S('vliqClimax', true, 'vliq'), S('vliqBody', true, 'vliq'),
    Z('vliqTransp', 85, 0, 100, 5, 'vliq'), S('vliqBorder', false, 'vliq'),
    F('cVliqBull', '#26a69a', 'vliq'), M(F('cVliqBear', '#ef5350', 'vliq')), Z('vliqMax', 30, 2, 300, 1, 'vliq'),
    // 9 Daily Open
    H(S('showDOpen', true, 'dopen')), F('cDOpen', '#ffffff', 'dopen'), S('dOpenLbl', true, 'dopen'), M(Z('lblOffDO', 12, 0, 100, 1, 'dopen')),
]

/** Welche Zeiteinheiten der VWAP Vector nachladen muss (höhere + Intrabar). */
export function vwapVectorQuellen(p, ivMs, tfMs) {
    const htf = new Set()
    for (const x of [1, 2, 3]) if (p[`showMtfE${x}`]) htf.add(p[`tfMtfE${x}`])
    if (p.showFib) htf.add(p.fibTf)
    // Eine „höhere" Zeiteinheit, die gar nicht höher ist, rechnet der Chart selbst.
    const hoeher = [...htf].filter((tf) => tfMs[tf] > ivMs)
    const intra = p.showPocC && tfMs[p.pocCTf] < ivMs ? p.pocCTf : null
    return { htf: hoeher, intra }
}


export const INDIKATOREN = {
    sma: {
        ort: 'preis',
        params: [P_LAENGE(20), P_QUELLE],
        ausgaben: [{ key: 'wert', art: 'linie', farbe: '#f5c542', breite: 1 }],
        rechne: (k, p) => ({ wert: sma(mitQuelle(k, p.quelle), p.laenge) }),
    },
    ema: {
        ort: 'preis',
        params: [P_LAENGE(21), P_QUELLE],
        ausgaben: [{ key: 'wert', art: 'linie', farbe: '#29b6f6', breite: 1 }],
        rechne: (k, p) => ({ wert: ema(mitQuelle(k, p.quelle), p.laenge) }),
    },
    bb: {
        ort: 'preis',
        params: [P_LAENGE(20), { key: 'mult', typ: 'zahl', vorgabe: 2, min: 0.1, max: 10, schritt: 0.1 },
            { key: 'basis', typ: 'wahl', vorgabe: 'sma', optionen: ['sma', 'ema'] }],
        ausgaben: [
            { key: 'oben', art: 'linie', farbe: '#7e57c2', breite: 1 },
            { key: 'mitte', art: 'linie', farbe: '#ff9800', breite: 1 },
            { key: 'unten', art: 'linie', farbe: '#7e57c2', breite: 1 },
        ],
        rechne: (k, p) => {
            const b = bollinger(k, { period: p.laenge, mult: p.mult, basis: p.basis })
            return { oben: b.upper, mitte: b.middle, unten: b.lower }
        },
    },
    vwap: {
        ort: 'preis',
        params: [
            { key: 'anker', typ: 'wahl', vorgabe: 'session', optionen: ['session', 'week', 'month', 'swingHigh', 'swingLow', 'ath', 'atl'] },
            { key: 'band', typ: 'zahl', vorgabe: 0, min: 0, max: 5, schritt: 0.5 },
        ],
        ausgaben: [
            { key: 'wert', art: 'linie', farbe: '#e91e63', breite: 2 },
            { key: 'oben', art: 'linie', farbe: 'rgba(233,30,99,0.45)', breite: 1, optional: true },
            { key: 'unten', art: 'linie', farbe: 'rgba(233,30,99,0.45)', breite: 1, optional: true },
        ],
        rechne: (k, p) => {
            const aus = { wert: vwap(k, { anchor: p.anker }) }
            // Bänder nur, wenn verlangt — sonst bleiben zwei leere Reihen stehen.
            if (p.band > 0) {
                aus.oben = vwapBand(k, { anchor: p.anker, mult: p.band })
                aus.unten = vwapBand(k, { anchor: p.anker, mult: -p.band })
            }
            return aus
        },
    },
    rsi: {
        ort: 'eigen',
        params: [P_LAENGE(14), P_QUELLE,
            { key: 'maAn', typ: 'schalter', vorgabe: true },
            // Nicht im Legendennamen: „RSI 14 14" liest sich wie ein Tippfehler.
            { key: 'maLaenge', typ: 'zahl', vorgabe: 14, min: 1, max: 200, schritt: 1, nichtImNamen: true }],
        ausgaben: [
            { key: 'wert', art: 'linie', farbe: '#7e57c2', breite: 1 },
            { key: 'ma', art: 'linie', farbe: '#f7df1e', breite: 1 },
        ],
        // Die gleitende Linie nur, wenn sie an ist — sonst stünde eine leere Serie in der Legende.
        ausgabenFuer: (p) => [
            { key: 'wert', art: 'linie', farbe: '#7e57c2', breite: 1 },
            ...(p.maAn ? [{ key: 'ma', art: 'linie', farbe: '#f7df1e', breite: 1 }] : []),
        ],
        linien: [70, 50, 30],
        band: { oben: 70, unten: 30, linie: 'wert' },
        bereich: [0, 100],
        rechne: (k, p) => {
            const wert = rsi(mitQuelle(k, p.quelle), p.laenge)
            return p.maAn ? { wert, ma: smaSerie(wert, p.maLaenge) } : { wert }
        },
    },
    macd: {
        ort: 'eigen',
        params: [
            { key: 'schnell', typ: 'zahl', vorgabe: 12, min: 1, max: 200, schritt: 1 },
            { key: 'langsam', typ: 'zahl', vorgabe: 26, min: 1, max: 400, schritt: 1 },
            { key: 'signal', typ: 'zahl', vorgabe: 9, min: 1, max: 100, schritt: 1 },
            P_QUELLE,
        ],
        ausgaben: [
            { key: 'hist', art: 'histogramm', farbe: '#26a69a', vierFarben: true },
            { key: 'macd', art: 'linie', farbe: '#2962ff', breite: 1 },
            { key: 'signal', art: 'linie', farbe: '#ff6d00', breite: 1 },
        ],
        linien: [0],
        rechne: (k, p) => {
            const kk = mitQuelle(k, p.quelle)
            const o = { fast: p.schnell, slow: p.langsam, signal: p.signal }
            return {
                macd: macd(kk, { ...o, line: 'macd' }),
                signal: macd(kk, { ...o, line: 'signal' }),
                hist: macd(kk, { ...o, line: 'hist' }),
            }
        },
    },
    stoch: {
        ort: 'eigen',
        // Vorgabe wie TradingView: %K 14, %K-Glättung 1, %D 3 (vorher 3 — eine „Slow"-Stochastik
        // unter dem Namen der normalen, und die Werte wichen vom TradingView-Chart ab).
        params: [P_LAENGE(14), { key: 'glaettK', typ: 'zahl', vorgabe: 1, min: 1, max: 20, schritt: 1 },
            { key: 'glaettD', typ: 'zahl', vorgabe: 3, min: 1, max: 20, schritt: 1 }],
        ausgaben: [
            { key: 'k', art: 'linie', farbe: '#2962ff', breite: 1 },
            { key: 'd', art: 'linie', farbe: '#ff6d00', breite: 1 },
        ],
        linien: [80, 20],
        band: { oben: 80, unten: 20, linie: 'k' },
        bereich: [0, 100],
        rechne: (k, p) => stochastic(k, { period: p.laenge, smoothK: p.glaettK, smoothD: p.glaettD }),
    },
    stochRsi: {
        ort: 'eigen',
        params: [
            { key: 'rsiLaenge', typ: 'zahl', vorgabe: 14, min: 1, max: 100, schritt: 1 },
            P_LAENGE(14, 100),
            { key: 'glaettK', typ: 'zahl', vorgabe: 3, min: 1, max: 20, schritt: 1 },
            { key: 'glaettD', typ: 'zahl', vorgabe: 3, min: 1, max: 20, schritt: 1 },
        ],
        ausgaben: [
            { key: 'k', art: 'linie', farbe: '#2962ff', breite: 1 },
            { key: 'd', art: 'linie', farbe: '#ff6d00', breite: 1 },
        ],
        linien: [80, 20],
        band: { oben: 80, unten: 20, linie: 'k' },
        bereich: [0, 100],
        rechne: (k, p) => stochRsi(k, { rsiPeriod: p.rsiLaenge, stochPeriod: p.laenge, smoothK: p.glaettK, smoothD: p.glaettD }),
    },
    atr: {
        ort: 'eigen',
        params: [P_LAENGE(14)],
        ausgaben: [{ key: 'wert', art: 'linie', farbe: '#ef5350', breite: 1 }],
        rechne: (k, p) => ({ wert: atr(k, p.laenge) }),
    },
    adx: {
        ort: 'eigen',
        params: [P_LAENGE(14, 100)],
        ausgaben: [
            { key: 'adx', art: 'linie', farbe: '#ff9800', breite: 2 },
            { key: 'plus', art: 'linie', farbe: '#26a69a', breite: 1 },
            { key: 'minus', art: 'linie', farbe: '#ef5350', breite: 1 },
        ],
        linien: [25],
        rechne: (k, p) => {
            const a = adx(k, p.laenge)
            return { adx: a.adx, plus: a.plusDI, minus: a.minusDI }
        },
    },
    mfi: {
        ort: 'eigen',
        params: [P_LAENGE(14)],
        ausgaben: [{ key: 'wert', art: 'linie', farbe: '#00bcd4', breite: 1 }],
        linien: [80, 20],
        band: { oben: 80, unten: 20, linie: 'wert' },
        bereich: [0, 100],
        rechne: (k, p) => ({ wert: mfi(k, p.laenge) }),
    },
    obv: {
        ort: 'eigen',
        params: [],
        ausgaben: [{ key: 'wert', art: 'linie', farbe: '#8d6e63', breite: 1 }],
        rechne: (k) => ({ wert: obv(k) }),
    },
    // ── Daten-Fenster aus eigenen Quellen ────────────────────────────────
    oi: {
        ort: 'eigen',
        extern: 'oi',
        params: [],
        // Fläche mit Verlauf für den Bestand, darunter die Veränderung je Kerze
        // als Balken (grün = Positionen kommen dazu, rot = sie werden
        // geschlossen) — die Veränderung ist die eigentliche Aussage.
        ausgaben: [
            { key: 'wert', art: 'flaeche', farbe: '#ffb74d', breite: 2 },
            { key: 'delta', art: 'histogramm', farbe: '#26a69a', vorzeichen: true, unten: true },
        ],
        kompakt: true,
        rechne: (k, _p, ext) => {
            const wert = aufKerzen(k, ext, 'oi', { amSchluss: true })
            return { wert, delta: veraenderung(wert) }
        },
    },
    longShort: {
        ort: 'eigen',
        extern: 'oi',
        params: [],
        ausgaben: [{ key: 'wert', art: 'linie', farbe: '#26a69a', breite: 2 }],
        linien: [50],
        rechne: (k, _p, ext) => ({ wert: aufKerzen(k, ext, 'longPct', { amSchluss: true }) }),
    },
    funding: {
        ort: 'eigen',
        extern: 'funding',
        params: [],
        ausgaben: [{ key: 'hist', art: 'histogramm', farbe: '#26a69a' }],
        linien: [0],
        // In Prozent je Zahlung; mehrere Zahlungen in einer Kerze summiert.
        rechne: (k, _p, ext) => ({ hist: jeKerzeSumme(k, ext, 'rate', 100) }),
    },
    momentum: {
        ort: 'eigen',
        extern: 'momentum',
        params: [],
        // Eigene Zeichnung wie im Pine (`momentumZeichnung.js`): Flächen bis zur
        // Nulllinie, Geldfluss je Kerze mit violetter Futures-Phase, Spot-Linie,
        // Punkte, Rauten, Schienen, Divergenzen, 4h-Farbleiste. Als Serien
        // bleiben nur Welle und Signallinie; der Geldfluss steht als Wert in der
        // Legende.
        zeichner: 'momentum',
        ausgaben: [
            { key: 'w1', art: 'linie', farbe: '#6fa8ff', breite: 2 },
            { key: 'w2', art: 'linie', farbe: 'rgba(61,99,214,0.55)', breite: 1 },
            { key: 'mf', art: 'wert', farbe: '#4caf50' },
        ],
        bereich: [-140, 128],
        rechne: (k, _p, ext) => ({
            w1: nachZeit(k, ext?.t, ext?.w1),
            w2: nachZeit(k, ext?.t, ext?.w2),
            mf: nachZeit(k, ext?.t, ext?.mf),
        }),
    },
    vwapVector: {
        ort: 'preis',
        extern: 'vwapVector',
        zeichner: 'vwapVector',
        kurzOhneParams: true,
        params: VV_PARAMS,
        ausgaben: [],
        ausgabenFuer: (p) => VV_LINIEN.filter(([, an]) => p[an]).map(([key, , farbe]) => ({ key, art: 'linie', farbe: p[farbe], breite: 1 })),
        rechne: (k, p, ext) => {
            const r = rechneVwapVector(k, p, ext || {}, ext?.ivMs || (k.length > 1 ? k[k.length - 1].t - k[k.length - 2].t : 3_600_000))
            return { ...r.linien, _vv: r }
        },
    },
    // ── Strategie-Signale (server/chart-signale.js) ─────────────────────
    // Jedes Setup, das die Strategie über die geladene Historie gefunden hätte —
    // gerechnet wie im Backtest, ohne Blick in die Zukunft, mit Standardparametern.
    lsob: {
        ort: 'preis',
        extern: 'signale_lsob',
        zeichner: 'signale',
        kurzOhneParams: true,
        params: [],
        ausgaben: [],
        rechne: () => ({}),
    },
    guss: {
        ort: 'preis',
        extern: 'signale_ema_touch',
        zeichner: 'signale',
        kurzOhneParams: true,
        // Die drei EMAs der Strategie (Vorgaben aus ema_touch.js: 21 / 50 / 200)
        params: [{ key: 'gussEmas', typ: 'schalter', vorgabe: true }],
        ausgaben: [],
        ausgabenFuer: (p) => (p.gussEmas ? [
            { key: 'ema21', art: 'linie', farbe: '#29b6f6', breite: 1 },
            { key: 'ema50', art: 'linie', farbe: '#f5c542', breite: 2 },
            { key: 'ema200', art: 'linie', farbe: '#ab47bc', breite: 1 },
        ] : []),
        rechne: (k, p) => (p.gussEmas ? { ema21: ema(k, 21), ema50: ema(k, 50), ema200: ema(k, 200) } : {}),
    },
    volSma: {
        ort: 'eigen',
        params: [P_LAENGE(20)],
        ausgaben: [
            { key: 'vol', art: 'histogramm', farbe: 'rgba(120,123,134,0.5)' },
            { key: 'wert', art: 'linie', farbe: '#ffb74d', breite: 1 },
        ],
        rechne: (k, p) => ({ vol: k.map((x) => x.v), wert: volumeSma(k, p.laenge) }),
    },
}

/** Vorgaben einer Definition als Parameter-Objekt. */
export function vorgaben(typ) {
    const def = INDIKATOREN[typ]
    const p = {}
    for (const x of def?.params || []) p[x.key] = x.vorgabe
    return p
}

/**
 * Gespeicherte Parameter säubern: Unbekanntes fällt weg, Zahlen werden auf
 * ihren Bereich begrenzt, eine unbekannte Wahl fällt auf die Vorgabe zurück.
 * Ein Layout kann von einem älteren Stand stammen oder von Hand geändert sein.
 */
export function saubereParams(typ, roh) {
    const def = INDIKATOREN[typ]
    const p = {}
    for (const x of def?.params || []) {
        const v = roh?.[x.key]
        if (x.typ === 'zahl') {
            // Leeres Feld (v-model.number liefert '') ist die Vorgabe, nicht 0 → Minimum (EMA 1).
            const n = v === '' || v == null ? NaN : Number(v)
            if (!Number.isFinite(n)) { p[x.key] = x.vorgabe; continue }
            // Ganzzahlige Längen runden: 14.5 liess ema/sma/rsi auf candles[i − 14.5] greifen und werfen.
            // Faktoren mit Schritt 0.1 (Bollinger 2.25) bleiben, wie eingegeben.
            const gerundet = (x.schritt ?? 1) >= 1 ? Math.round(n) : n
            p[x.key] = Math.min(x.max, Math.max(x.min, gerundet))
        } else if (x.typ === 'schalter') {
            p[x.key] = typeof v === 'boolean' ? v : x.vorgabe
        } else if (x.typ === 'farbe') {
            p[x.key] = /^#[0-9a-f]{6}$/i.test(v || '') ? v : x.vorgabe
        } else {
            p[x.key] = x.optionen.includes(v) ? v : x.vorgabe
        }
    }
    return p
}

/** Rechnet eine Instanz; unbekannter Typ → leeres Ergebnis statt Absturz. */
export function rechneIndikator(typ, kerzen, params, extern = {}) {
    const def = INDIKATOREN[typ]
    if (!def || !kerzen.length) return {}
    return def.rechne(kerzen, saubereParams(typ, params), def.extern ? extern?.[def.extern] : undefined)
}

/** Ausgaben einer Instanz — je nach Einstellung, wenn die Definition das vorsieht. */
export function ausgabenVon(typ, params) {
    const def = INDIKATOREN[typ]
    if (!def) return []
    return def.ausgabenFuer ? def.ausgabenFuer(saubereParams(typ, params)) : def.ausgaben
}

/** Welche fremden Datenquellen braucht eine Indikatorliste? */
export function benoetigteQuellen(instanzen) {
    return [...new Set((instanzen || []).filter((i) => i.sichtbar !== false).map((i) => INDIKATOREN[i.typ]?.extern).filter(Boolean))]
}

/** Kurzbeschriftung für die Legende, z. B. „EMA 21" oder „BB 20 2". */
export function kurzname(typ, params, name) {
    if (INDIKATOREN[typ]?.kurzOhneParams) return name
    const p = saubereParams(typ, params)
    const zahlen = (INDIKATOREN[typ]?.params || []).filter((x) => x.typ === 'zahl' && !x.nichtImNamen).map((x) => p[x.key])
    const quelle = p.quelle && p.quelle !== 'c' ? ` ${p.quelle}` : ''
    const anker = p.anker ? ` ${p.anker}` : ''
    return `${name}${zahlen.length ? ' ' + zahlen.join(' ') : ''}${anker}${quelle}`
}

let laufNr = 0
/** Neue Instanz für ein Layout. `id` nur innerhalb des Panels eindeutig. */
export function neueInstanz(typ) {
    return { id: `${typ}-${Date.now().toString(36)}-${(laufNr++).toString(36)}`, typ, params: vorgaben(typ), farben: {}, sichtbar: true }
}
