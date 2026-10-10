/**
 * Mo's Momentum Radar — die Rechnung des Pine-Indikators, ohne Netz und ohne DB.
 *
 * Vorlage ist `Mo's Momentum Radar` (Pine v5) des Nutzers. Übernommen sind das
 * Rechenwerk und seine Konstanten 1:1, nicht die Darstellung: die Kachel
 * `KachelMomentum.vue` zeichnet daraus Welle, Geldfluss, Punkte und das Panel.
 * Wer hier an einer Konstante dreht, ändert die Aussage — die Werte stehen im
 * Pine bewusst nicht im Dialog, und hier auch nicht.
 *
 * ## Repaint-Schutz, strenger als im Pine
 *
 * Gerechnet wird AUSSCHLIESSLICH auf geschlossenen Kerzen (`getClosedCandles`).
 * Im Pine gilt das nur für die Zeitebenen über dem Chart; die Chart-Zeitebene
 * selbst liest dort die laufende Kerze mit (und zeigt sie als hohlen Kreis).
 * Die Kachel hat keine Kerze, auf die man zeigen könnte — eine Aussage, die
 * bis zum Kerzenschluss noch kippen kann, hätte hier keinen sichtbaren Ort
 * für ihr „noch nicht verlässlich". Also gibt es sie nicht.
 *
 * Höhere Zeitebenen werden im Verlauf genauso ausgerichtet wie im Pine mit
 * `[1]` + `lookahead_on`: an einer Chart-Kerze gilt die letzte höhere Kerze,
 * die bei deren BEGINN schon geschlossen war. Der Selbsttest prüft genau das,
 * denn ein Versatz um eine Kerze sieht im Verlauf besser aus, als es live war.
 *
 * Kerzenformat wie in `market-data.js`: `{ t, o, h, l, c, v }`, aufsteigend.
 */

import { emaSerie, smaSerie, pivotHighs, pivotLows } from './strategies/indicators.js'

// ── Rechenwerk (Konstanten aus dem Pine) ──────────────────────────────────
export const WT_CH = 9
export const WT_AVG = 12
export const WT_SIG = 3
export const OB_LVL = 50
export const OS_LVL = -50
export const NEAR_PCT = 70
export const OV_LVL = 100
export const STR_PCT = 0.6
export const EXT_LOOK = 4
export const MF_LEN = 60
export const MF_NORM = 200
export const MF_TARGET = 22
export const MF_MIN = 5
export const SF_NORM = 200
export const SF_EXCESS = 1.15
export const DIV_MAX = 80
export const DIV_LOOK = 5
export const BOS_LEN = 5
export const EMA_LEN = 50

/** Zeitebenen in der Reihenfolge des Panels, mit ihrer Länge in ms. */
export const ZEITEBENEN = [
    { tf: '1w', ms: 7 * 86400000 },
    { tf: '1d', ms: 86400000 },
    { tf: '4h', ms: 4 * 3600000 },
    { tf: '1h', ms: 3600000 },
    { tf: '15m', ms: 15 * 60000 },
    { tf: '5m', ms: 5 * 60000 },
]
const TF_MS = Object.fromEntries(ZEITEBENEN.map(z => [z.tf, z.ms]))

/** Zeitebenen, die als Chart-Zeitebene der Kachel wählbar sind. */
export const CHART_ZEITEBENEN = ['5m', '15m', '1h', '4h']

/** Auf diesen Zeitebenen erscheinen Signale auf den Schienen (Pine: use1/4/D/W). */
const SCHIENEN_TF = ['1h', '4h', '1d', '1w']

const ok = (v) => v !== null && v !== undefined && Number.isFinite(v)

// ── Welle (WaveTrend) ────────────────────────────────────────────────────

/**
 * Die Welle und ihre Signallinie.
 * @returns {{ w1: Array<number|null>, w2: Array<number|null> }}
 */
export function welle(kerzen) {
    const src = kerzen.map(k => (k.h + k.l + k.c) / 3)
    const esa = emaSerie(src, WT_CH)
    const abw = src.map((s, i) => (ok(esa[i]) ? Math.abs(s - esa[i]) : null))
    const dev = emaSerie(abw, WT_CH)
    const ci = src.map((s, i) => {
        if (!ok(esa[i]) || !ok(dev[i])) return null
        return dev[i] === 0 ? 0 : (s - esa[i]) / (0.015 * dev[i])
    })
    const w1 = emaSerie(ci, WT_AVG)
    const w2 = smaSerie(w1, WT_SIG)
    return { w1, w2 }
}

const kreuztHoch = (a, b, i) => i > 0 && ok(a[i]) && ok(b[i]) && ok(a[i - 1]) && ok(b[i - 1])
    && a[i] > b[i] && a[i - 1] <= b[i - 1]
const kreuztRunter = (a, b, i) => i > 0 && ok(a[i]) && ok(b[i]) && ok(a[i - 1]) && ok(b[i - 1])
    && a[i] < b[i] && a[i - 1] >= b[i - 1]

/**
 * Signale einer Zeitebene je Kerze (Pine `f_sig`): Kreuz nach oben IN der
 * Long-Zone (≤ −50), Kreuz nach unten IN der Short-Zone (≥ +50).
 */
export function signale(w1, w2) {
    return w1.map((_, i) => ({
        long: kreuztHoch(w1, w2, i) && w1[i] <= OS_LVL,
        short: kreuztRunter(w1, w2, i) && w1[i] >= OB_LVL,
    }))
}

/**
 * Zustand aus dem Wellenwert (Pine `f_state`). `dir` 1 = Long-Seite,
 * −1 = Short-Seite, 0 = neutral. `null` heisst unbekannt, nicht neutral.
 */
export function zustand(w) {
    if (!ok(w)) return { code: null, dir: 0 }
    const nahTief = OS_LVL * NEAR_PCT / 100
    const nahHoch = OB_LVL * NEAR_PCT / 100
    if (w <= OS_LVL) return { code: 'long', dir: 1 }
    if (w >= OB_LVL) return { code: 'short', dir: -1 }
    if (w <= nahTief) return { code: 'fastLong', dir: 1 }
    if (w >= nahHoch) return { code: 'fastShort', dir: -1 }
    return { code: 'neutral', dir: 0 }
}

/**
 * Setup aus zwei oder drei Richtungen (Pine `f_setup`): mindestens zwei
 * Zeitebenen haben eine Richtung, und ALLE mit Richtung zeigen in dieselbe.
 * Für DAY wird mit `c = 0` gerufen — dort müssen also 15m UND 5m stimmen.
 */
export function setup(a, b, c = 0) {
    const r = [a, b, c].filter(x => x !== 0)
    if (r.length < 2) return 0
    if (r.every(x => x > 0)) return 1
    if (r.every(x => x < 0)) return -1
    return 0
}

// ── Geldfluss ─────────────────────────────────────────────────────────────

/**
 * Geldfluss (Pine `f_mf`): wo schliesst die Kerze in ihrer Spanne, gewichtet
 * mit dem Volumen, selbstskaliert am eigenen Mittel der letzten 200 Kerzen.
 * Solange die 200 nicht da sind, gilt der laufende Mittelwert seit Beginn —
 * sonst gäbe es am linken Rand einen Sprung.
 */
export function geldfluss(kerzen) {
    const pos = kerzen.map(k => {
        const r = k.h - k.l
        return r === 0 ? 0 : (k.c - k.o) / r
    })
    const v = kerzen.map(k => Number(k.v) || 0)
    const num = smaSerie(pos.map((p, i) => p * v[i]), MF_LEN)
    const den = smaSerie(v, MF_LEN)
    const posSma = smaSerie(pos, MF_LEN)
    const roh = num.map((n, i) => {
        if (!ok(den[i])) return null
        return den[i] === 0 ? posSma[i] : n / den[i]
    })
    const absRoh = roh.map(x => (ok(x) ? Math.abs(x) : null))
    const refSma = smaSerie(absRoh, MF_NORM)
    let anzahl = 0
    let summe = 0
    return roh.map((x, i) => {
        if (ok(absRoh[i])) { anzahl++; summe += absRoh[i] }
        const ref = ok(refSma[i]) ? refSma[i] : (anzahl ? summe / anzahl : null)
        if (!ok(ref) || ref === 0) return 0
        return ok(x) ? x / ref * MF_TARGET : null
    })
}

/**
 * Spot gegen Futures (Pine Gruppe 3): Futures-Anteil am Volumen gegen sein
 * eigenes Normalmass der letzten 200 Kerzen. Der nackte Anteil sagt nichts —
 * 91 % Futures sind bei der einen Münze normal, bei der nächsten ein Signal.
 *
 * @param {Array} fut  Futures-Kerzen der Chart-Zeitebene
 * @param {Array|null} spot Spot-Kerzen derselben Zeitebene (oder null)
 * @param {Array<number|null>} mf Geldfluss der Futures (für die Mindeststärke)
 * @returns {{ anteil:number|null, schnitt:number|null, urteil:'futures'|'spot'|'normal'|null, reihe:Array|null }}
 */
export function herkunft(fut, spot, mf) {
    const leer = { anteil: null, schnitt: null, urteil: null, reihe: null }
    if (!Array.isArray(spot) || !spot.length) return leer
    const spotNachT = new Map(spot.map(k => [k.t, Number(k.v) || 0]))
    // Anteil je Kerze; fehlt Spot dort, ist er unbekannt
    const anteile = fut.map(k => {
        const sv = spotNachT.get(k.t)
        const fv = Number(k.v) || 0
        return sv !== undefined && fv + sv > 0 ? fv / (fv + sv) : null
    })
    // Eine einzelne Lücke darf nicht 200 Kerzen lang das Normalmass löschen —
    // für den Schnitt wird der letzte gültige Wert gehalten (Pine `fsHold`).
    let halt = null
    const gehalten = anteile.map(a => (a !== null ? (halt = a) : halt))
    const schnitte = smaSerie(gehalten, SF_NORM)
    const urteilAn = (i) => {
        const a = anteile[i]
        const s = schnitte[i]
        if (!ok(a) || !ok(s) || s <= 0) return null
        if (Math.abs(mf[i] ?? 0) < MF_MIN) return 'normal'
        if (a > s * SF_EXCESS) return 'futures'
        if (a < s / SF_EXCESS) return 'spot'
        return 'normal'
    }
    const reihe = fut.map((_, i) => urteilAn(i))
    const i = fut.length - 1
    return {
        anteil: anteile[i],
        schnitt: ok(schnitte[i]) ? schnitte[i] : null,
        urteil: reihe[i],
        reihe,
    }
}

// ── Ausrichtung höherer Zeitebenen ────────────────────────────────────────

/**
 * Für jede Chart-Kerze den Index der höheren Kerze, die bei deren BEGINN
 * schon geschlossen war (−1 = keine). Entspricht `[1]` + `lookahead_on`.
 */
export function richteAus(chartKerzen, hoehereKerzen, hoeherMs) {
    const out = new Array(chartKerzen.length).fill(-1)
    let j = -1
    for (let i = 0; i < chartKerzen.length; i++) {
        const t = chartKerzen[i].t
        while (j + 1 < hoehereKerzen.length && hoehereKerzen[j + 1].t + hoeherMs <= t) j++
        out[i] = j
    }
    return out
}

// ── Kontext: VWAP und Struktur ────────────────────────────────────────────

/** Beginn der laufenden Woche (Montag 00:00 UTC) bzw. des Monats (1. 00:00 UTC). */
export function periodenBeginn(art, jetztMs) {
    const d = new Date(jetztMs)
    if (art === 'monat') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
    const tag = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    const wochentag = (d.getUTCDay() + 6) % 7      // Montag = 0
    return tag - wochentag * 86400000
}

/** VWAP über hlc3 aller Kerzen ab `seitMs`. `null`, wenn noch keine geschlossen ist. */
export function vwapSeit(kerzen, seitMs) {
    let pv = 0
    let vol = 0
    for (const k of kerzen) {
        if (k.t < seitMs) continue
        const v = Number(k.v) || 0
        pv += (k.h + k.l + k.c) / 3 * v
        vol += v
    }
    return vol > 0 ? pv / vol : null
}

/**
 * Struktur auf der Strukturzeitebene (Pine: 4h, Pivot-Breite 5, EMA 50).
 *
 * Zustandsmaschine wie im Pine, auf der Ebene der 4h-Kerzen: ein Pivot gilt
 * erst `BOS_LEN` Kerzen nach seiner Spitze, ein Bruch zählt nur beim
 * ÜBERQUEREN des Levels (nicht, solange der Kurs jenseits bleibt). CHoCH =
 * Bruch gegen die bisherige Richtung, BOS = in Richtung.
 */
export function struktur(kerzen) {
    const n = kerzen.length
    const ph = new Map(pivotHighs(kerzen, BOS_LEN, BOS_LEN).map(p => [p.index + BOS_LEN, p.price]))
    const pl = new Map(pivotLows(kerzen, BOS_LEN, BOS_LEN).map(p => [p.index + BOS_LEN, p.price]))
    let lph = null
    let lpl = null
    let richtung = 0
    let level = null
    let choch = false
    let bruchIndex = -1
    for (let k = 0; k < n; k++) {
        if (ph.has(k)) lph = ph.get(k)
        if (pl.has(k)) lpl = pl.get(k)
        const c = kerzen[k].c
        const vorher = k > 0 ? kerzen[k - 1].c : null
        const hoch = lph !== null && c > lph && (vorher === null || vorher <= lph)
        const tief = lpl !== null && c < lpl && (vorher === null || vorher >= lpl)
        if (hoch) {
            choch = richtung === -1; richtung = 1; level = lph; bruchIndex = k
        } else if (tief) {
            choch = richtung === 1; richtung = -1; level = lpl; bruchIndex = k
        }
    }
    const ema = emaSerie(kerzen.map(k => k.c), EMA_LEN)
    const e = ema[n - 1]
    return {
        richtung,
        choch,
        level,
        alterKerzen: bruchIndex >= 0 ? n - 1 - bruchIndex : null,
        bruchT: bruchIndex >= 0 ? kerzen[bruchIndex].t : null,
        emaRichtung: ok(e) ? (kerzen[n - 1].c > e ? 1 : -1) : 0,
        ema: ok(e) ? e : null,
    }
}

// ── Gesamtauswertung ──────────────────────────────────────────────────────

/** Zählt diese Zeitebene für die Punktstärke? (Pine c15/c05/cW/cD/c4/c1) */
export function zaehltFuerStaerke(tf, chartTf) {
    if (TF_MS[tf] <= TF_MS[chartTf]) return false    // nur ECHT darüber
    if (tf === '15m' || tf === '5m') return false     // only15/only5: nur anzeigen
    if (tf === '1w') return TF_MS[chartTf] >= TF_MS['1d']   // useW aus, ab Tageschart automatisch
    return true
}

/**
 * Alles, was die Kachel zeigt, aus den Kerzen aller Zeitebenen.
 *
 * @param {object} o
 * @param {object} o.kerzen   { '1w': [...], '1d': [...], ..., '5m': [...] } — Futures, geschlossen
 * @param {Array|null} o.spot Spot-Kerzen der Chart-Zeitebene
 * @param {string} o.chartTf  eine aus `CHART_ZEITEBENEN`
 * @param {Array} [o.vwapKerzen] Kerzen für Wochen-/Monats-VWAP (1h)
 * @param {number} [o.punkte=150] wie viele Chart-Kerzen der Verlauf zeigt
 */
export function werteAus({ kerzen, spot = null, chartTf, vwapKerzen = null, punkte = 150 }) {
    const chart = kerzen[chartTf] || []
    if (chart.length < 30) throw new Error(`Zu wenig ${chartTf}-Kerzen (${chart.length})`)
    const istDay = TF_MS[chartTf] <= TF_MS['15m']

    // Je Zeitebene: Welle, Signale, Zustand der letzten geschlossenen Kerze
    const je = {}
    for (const { tf, ms } of ZEITEBENEN) {
        const k = kerzen[tf] || []
        const { w1, w2 } = welle(k)
        const w = w1.length ? w1[w1.length - 1] : null
        je[tf] = { kerzen: k, ms, w1, w2, sig: signale(w1, w2), zustand: zustand(w), w }
    }

    const zeitebenen = ZEITEBENEN.map(({ tf }) => {
        const z = je[tf]
        const s = z.sig.length ? z.sig[z.sig.length - 1] : null
        return {
            tf,
            wert: ok(z.w) ? Math.round(z.w * 10) / 10 : null,
            zustand: z.zustand.code,
            dir: z.zustand.dir,
            zaehlt: zaehltFuerStaerke(tf, chartTf),
            ueberChart: TF_MS[tf] > TF_MS[chartTf],
            // Signal genau auf der zuletzt geschlossenen Kerze dieser Zeitebene
            signal: s?.long ? 'long' : s?.short ? 'short' : null,
            kerzeT: z.kerzen.length ? z.kerzen[z.kerzen.length - 1].t : null,
        }
    })
    const dirVon = (tf) => je[tf].zustand.dir

    const swing = setup(dirVon('1d'), dirVon('4h'), dirVon('1h'))
    const day = setup(dirVon('15m'), dirVon('5m'), 0)
    const status = istDay ? day : swing

    // Geldfluss der Chart-Zeitebene (Futures) und der Spot-Vergleich
    const mf = geldfluss(chart)
    const mfSpotVoll = Array.isArray(spot) && spot.length ? geldfluss(spot) : null
    const spotNachT = mfSpotVoll ? new Map(spot.map((k, i) => [k.t, mfSpotVoll[i]])) : null
    const mfSpot = spotNachT ? chart.map(k => spotNachT.get(k.t) ?? null) : null
    const her = herkunft(chart, spot, mf)
    const mf4 = geldfluss(kerzen['4h'] || [])
    // Farbleiste: 4h-Geldfluss der letzten GESCHLOSSENEN 4h-Kerze je Chart-Kerze
    const aus4 = richteAus(chart, kerzen['4h'] || [], TF_MS['4h'])
    const mf4Reihe = aus4.map(j => (j >= 0 ? mf4[j] : null))

    // Punktstärke: zählende Zeitebenen + Geldfluss, ≥ 60 %
    const zaehlende = ZEITEBENEN.map(z => z.tf).filter(tf => zaehltFuerStaerke(tf, chartTf))
    const noetig = Math.max(1, Math.ceil((zaehlende.length + 1) * STR_PCT))
    const ausrichtung = Object.fromEntries(zaehlende.map(tf => [tf, richteAus(chart, je[tf].kerzen, je[tf].ms)]))
    const dirAn = (tf, i) => {
        const j = ausrichtung[tf][i]
        return j >= 0 ? zustand(je[tf].w1[j]).dir : 0
    }

    // Signale der Chart-Zeitebene über die ganze Historie (für Divergenzen)
    const { w1, w2 } = je[chartTf]
    const sig = je[chartTf].sig
    const punktListe = []
    const rauten = []
    const divergenzen = []
    let letzterPunkt = null
    let vorBaer = null
    let vorBulle = null
    for (let i = 0; i < chart.length; i++) {
        if (i > 0 && kreuztRunter(w1, w2, i) && Math.max(...w1.slice(Math.max(0, i - EXT_LOOK + 1), i + 1).filter(ok)) >= OV_LVL) {
            rauten.push({ i, seite: 'short' })
        }
        if (i > 0 && kreuztHoch(w1, w2, i) && Math.min(...w1.slice(Math.max(0, i - EXT_LOOK + 1), i + 1).filter(ok)) <= -OV_LVL) {
            rauten.push({ i, seite: 'long' })
        }
        if (!sig[i].long && !sig[i].short) continue
        const seite = sig[i].long ? 'long' : 'short'
        const vorzeichen = seite === 'long' ? 1 : -1
        const zustimmung = zaehlende.reduce((s, tf) => s + (dirAn(tf, i) === vorzeichen ? 1 : 0), 0)
            + ((mf[i] ?? 0) * vorzeichen > 0 ? 1 : 0)
        const stark = zaehlende.length > 0 && zustimmung >= noetig
        const p = { i, seite, stark, t: chart[i].t, w: w1[i] }
        punktListe.push(p)
        letzterPunkt = p

        // Divergenz: Preis-Extrem über die letzten DIV_LOOK Kerzen gegen den vorigen Punkt
        const fenster = chart.slice(Math.max(0, i - DIV_LOOK + 1), i + 1)
        if (seite === 'short') {
            const px = Math.max(...fenster.map(k => k.h))
            if (vorBaer && i - vorBaer.i <= DIV_MAX && px > vorBaer.px && w1[i] < vorBaer.w) {
                divergenzen.push({ i1: vorBaer.i, w1: vorBaer.w, i2: i, w2: w1[i], seite })
            }
            vorBaer = { i, w: w1[i], px }
        } else {
            const px = Math.min(...fenster.map(k => k.l))
            if (vorBulle && i - vorBulle.i <= DIV_MAX && px < vorBulle.px && w1[i] > vorBulle.w) {
                divergenzen.push({ i1: vorBulle.i, w1: vorBulle.w, i2: i, w2: w1[i], seite })
            }
            vorBulle = { i, w: w1[i], px }
        }
    }

    // Schienen: Signale der Zeitebenen ECHT über dem Chart, an der ersten
    // Chart-Kerze, an der die höhere Kerze lesbar ist
    const schienen = []
    for (const tf of SCHIENEN_TF) {
        if (TF_MS[tf] <= TF_MS[chartTf]) continue
        if (tf === '1w' && TF_MS[chartTf] < TF_MS['1d']) continue
        const aus = richteAus(chart, je[tf].kerzen, je[tf].ms)
        for (let i = 1; i < chart.length; i++) {
            const j = aus[i]
            if (j < 0 || j === aus[i - 1]) continue
            const s = je[tf].sig[j]
            if (s?.long) schienen.push({ i, tf, seite: 'long' })
            if (s?.short) schienen.push({ i, tf, seite: 'short' })
        }
    }

    // Verlauf auf das sichtbare Fenster schneiden, Indizes umrechnen
    const ab = Math.max(0, chart.length - punkte)
    const rund = (x) => (ok(x) ? Math.round(x * 10) / 10 : null)
    const imFenster = (x) => x.i >= ab
    const verschiebe = (x) => ({ ...x, i: x.i - ab })
    const verlauf = {
        t: chart.slice(ab).map(k => k.t),
        w1: w1.slice(ab).map(rund),
        w2: w2.slice(ab).map(rund),
        mf: mf.slice(ab).map(rund),
        mfSpot: mfSpot ? mfSpot.slice(ab).map(rund) : null,
        mf4: mf4Reihe.slice(ab).map(rund),
        // 'f' = Futures ungewöhnlich hoch (violett), 's' = Spot ungewöhnlich hoch
        treiber: her.reihe ? her.reihe.slice(ab).map(u => (u === 'futures' ? 'f' : u === 'spot' ? 's' : null)) : null,
        punkte: punktListe.filter(imFenster).map(({ i, seite, stark }) => ({ i: i - ab, seite, stark })),
        rauten: rauten.filter(imFenster).map(verschiebe),
        schienen: schienen.filter(imFenster).map(verschiebe),
        divergenzen: divergenzen.filter(d => d.i1 >= ab).map(d => ({
            ...d, i1: d.i1 - ab, i2: d.i2 - ab, w1: rund(d.w1), w2: rund(d.w2),
        })),
    }

    // Kontext: VWAP gegen den letzten Schlusskurs der Chart-Zeitebene
    const letzte = chart[chart.length - 1]
    const preis = letzte.c
    const bezug = letzte.t + TF_MS[chartTf]
    const vwapBasis = vwapKerzen || kerzen['1h'] || []
    const woche = vwapSeit(vwapBasis, periodenBeginn('woche', bezug))
    const monat = vwapSeit(vwapBasis, periodenBeginn('monat', bezug))

    const k4 = kerzen['4h'] || []
    const str = k4.length > 2 * BOS_LEN + 1 ? struktur(k4) : null

    return {
        chartTf,
        modus: istDay ? 'day' : 'swing',
        status,
        swing,
        day,
        zeitebenen,
        staerke: { noetig, zaehlende },
        letzterPunkt: letzterPunkt ? {
            seite: letzterPunkt.seite,
            stark: letzterPunkt.stark,
            t: letzterPunkt.t,
            vorKerzen: chart.length - 1 - letzterPunkt.i,
        } : null,
        geldfluss: {
            wert: rund(mf[mf.length - 1]),
            spot: mfSpot ? rund(mfSpot[mfSpot.length - 1]) : null,
            h4: rund(mf4[mf4.length - 1]),
            extrem: Math.abs(mf[mf.length - 1] ?? 0) >= 60,
        },
        herkunft: { anteil: her.anteil, schnitt: her.schnitt, urteil: her.urteil },
        vwap: { preis, woche, monat, ueberWoche: ok(woche) ? preis > woche : null, ueberMonat: ok(monat) ? preis > monat : null },
        struktur: str,
        verlauf,
        letzteKerzeT: letzte.t,
    }
}
