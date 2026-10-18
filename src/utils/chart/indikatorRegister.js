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
 *   params    [{ key, typ: 'zahl'|'wahl', vorgabe, min, max, schritt, optionen }]
 *   ausgaben  [{ key, art: 'linie'|'histogramm', farbe, breite }]
 *   linien    feste Marken im Pane (z. B. 70/30 beim RSI)
 *   rechne(kerzen, p) → { [ausgabeKey]: Array<number|null> } gleich lang wie kerzen
 */
import {
    sma, ema, bollinger, vwap, vwapBand, rsi, macd, stochastic, stochRsi, atr, adx, obv, mfi, volumeSma,
} from '../../../shared/indicators.js'

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

const P_LAENGE = (vorgabe, max = 500) => ({ key: 'laenge', typ: 'zahl', vorgabe, min: 1, max, schritt: 1 })
const P_QUELLE = { key: 'quelle', typ: 'wahl', vorgabe: 'c', optionen: Object.keys(QUELLEN) }

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
        params: [P_LAENGE(14), P_QUELLE],
        ausgaben: [{ key: 'wert', art: 'linie', farbe: '#ab47bc', breite: 1 }],
        linien: [70, 50, 30],
        bereich: [0, 100],
        rechne: (k, p) => ({ wert: rsi(mitQuelle(k, p.quelle), p.laenge) }),
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
            { key: 'hist', art: 'histogramm', farbe: '#26a69a' },
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
        params: [P_LAENGE(14), { key: 'glaettK', typ: 'zahl', vorgabe: 3, min: 1, max: 20, schritt: 1 },
            { key: 'glaettD', typ: 'zahl', vorgabe: 3, min: 1, max: 20, schritt: 1 }],
        ausgaben: [
            { key: 'k', art: 'linie', farbe: '#2962ff', breite: 1 },
            { key: 'd', art: 'linie', farbe: '#ff6d00', breite: 1 },
        ],
        linien: [80, 20],
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
        bereich: [0, 100],
        rechne: (k, p) => ({ wert: mfi(k, p.laenge) }),
    },
    obv: {
        ort: 'eigen',
        params: [],
        ausgaben: [{ key: 'wert', art: 'linie', farbe: '#8d6e63', breite: 1 }],
        rechne: (k) => ({ wert: obv(k) }),
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
            const n = Number(v)
            p[x.key] = Number.isFinite(n) ? Math.min(x.max, Math.max(x.min, n)) : x.vorgabe
        } else {
            p[x.key] = x.optionen.includes(v) ? v : x.vorgabe
        }
    }
    return p
}

/** Rechnet eine Instanz; unbekannter Typ → leeres Ergebnis statt Absturz. */
export function rechneIndikator(typ, kerzen, params) {
    const def = INDIKATOREN[typ]
    if (!def || !kerzen.length) return {}
    return def.rechne(kerzen, saubereParams(typ, params))
}

/** Kurzbeschriftung für die Legende, z. B. „EMA 21" oder „BB 20 2". */
export function kurzname(typ, params, name) {
    const p = saubereParams(typ, params)
    const zahlen = (INDIKATOREN[typ]?.params || []).filter((x) => x.typ === 'zahl').map((x) => p[x.key])
    const quelle = p.quelle && p.quelle !== 'c' ? ` ${p.quelle}` : ''
    const anker = p.anker ? ` ${p.anker}` : ''
    return `${name}${zahlen.length ? ' ' + zahlen.join(' ') : ''}${anker}${quelle}`
}

let laufNr = 0
/** Neue Instanz für ein Layout. `id` nur innerhalb des Panels eindeutig. */
export function neueInstanz(typ) {
    return { id: `${typ}-${Date.now().toString(36)}-${(laufNr++).toString(36)}`, typ, params: vorgaben(typ), farben: {}, sichtbar: true }
}
