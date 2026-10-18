/**
 * Mo's VWAP Vector — Rechnung (pur: keine Bibliothek, kein Netz).
 *
 * Nachbau des Pine-Indikators „Mo's VWAP Vector" des Users, Modul für Modul:
 *   1  PVSRA-Vektorkerzen        Kerzenfarbe nach Volumen
 *   2  Anchored VWAPs            Tag/Woche/Monat/ATH/ATL + Swing-Fächer (Leiter-Logik)
 *   3  EMAs                      21/50/200, zwei freie, drei aus höheren Zeiteinheiten
 *   4  Fibonacci                 ATR-ZigZag auf einer höheren Zeiteinheit
 *   5  Engulfing                 markante Umkehrkerzen
 *   6  Perioden-POC (naked)      Volumen-POC je Periode, bis er berührt wird
 *   7  Candle-POC                POC INNERHALB der Kerze aus Intrabar-Kerzen
 *   8  Vektorkerzen-Zonen        unabgeholte Rest-Liquidität
 *   9  Daily Open
 * Die Alarm-Bedingungen (Abschnitt 10 im Pine) sind hier nicht nachgebaut.
 *
 * Gerechnet wird mit `shared/indicators.js` (VWAP-Anker und Swing-Leiter
 * stammen dort bereits aus diesem Pine), damit Chart und Strategien dieselbe
 * Linie sehen.
 *
 * Zeit: Perioden (Tag, Woche, Monat) in UTC, wie `timeframe.change` bei einer
 * Börse in UTC. Kerzen sind `{t,o,h,l,c,v}` mit `t` in ms.
 */
import { ema, atr, vwap, swingAnker, pivotHighs, pivotLows } from '../../../shared/indicators.js'

const TAG = 86_400_000
const MIN = 60_000

/** Zeiteinheit als ms; 'D'/'W'/'M' sind Kalenderperioden und hier nur grob. */
export const TF_MS = {
    '1m': MIN, '3m': 3 * MIN, '5m': 5 * MIN, '15m': 15 * MIN, '30m': 30 * MIN,
    '1h': 60 * MIN, '2h': 120 * MIN, '4h': 240 * MIN, '6h': 360 * MIN, '8h': 480 * MIN, '12h': 720 * MIN,
    '1d': TAG, '3d': 3 * TAG, '1w': 7 * TAG, '1M': 30 * TAG,
}

/** Periodennummer einer Zeit — Tag/Woche (Montag)/Monat in UTC, sonst feste Länge. */
export function periodeVon(t, tf) {
    if (tf === '1d') return Math.floor(t / TAG)
    if (tf === '1w') return Math.floor((t / TAG + 3) / 7)          // 1.1.1970 war ein Donnerstag
    if (tf === '1M') { const d = new Date(t); return d.getUTCFullYear() * 12 + d.getUTCMonth() }
    return Math.floor(t / (TF_MS[tf] || TAG))
}

function smaReihe(werte, n) {
    const out = new Array(werte.length).fill(null)
    let summe = 0
    for (let i = 0; i < werte.length; i++) {
        summe += werte[i]
        if (i >= n) summe -= werte[i - n]
        if (i >= n - 1) out[i] = summe / n
    }
    return out
}

function hoechstes(werte, i, n) {
    let m = -Infinity
    for (let j = Math.max(0, i - n + 1); j <= i; j++) if (werte[j] > m) m = werte[j]
    return m
}

// ── 1 PVSRA ──────────────────────────────────────────────────────────────
/**
 * Stufe je Kerze: 'climax' | 'rising' | 'neutral' (+ bull). Climax heisst
 * Volumen ≥ Durchschnitt × climaxMult ODER die grösste Volumen×Spanne der
 * letzten `len` Kerzen — der zweite Teil fängt eine weite Kerze mit nur
 * leicht erhöhtem Volumen.
 */
export function pvsra(kerzen, { len = 10, climaxMult = 2, risingMult = 1.5 } = {}) {
    const v = kerzen.map((k) => (k.v > 0 ? k.v : 0))
    const av = smaReihe(v, len)
    const spreadVol = kerzen.map((k, i) => v[i] * (k.h - k.l))
    return kerzen.map((k, i) => {
        const bull = k.c >= k.o
        if (av[i] == null) return { stufe: 'neutral', bull }
        const climax = v[i] >= av[i] * climaxMult || spreadVol[i] >= hoechstes(spreadVol, i, len)
        const rising = v[i] >= av[i] * risingMult
        return { stufe: climax ? 'climax' : rising ? 'rising' : 'neutral', bull }
    })
}

// ── 2 Swing-VWAP-Fächer ──────────────────────────────────────────────────
/**
 * Linien des Fächers je Seite, Stand der LETZTEN Kerze: wie die Polylines
 * im Pine, die bei `barstate.islast` neu gezeichnet werden. Eine Linie
 * beginnt am Pivot selbst (dort liegt der Anker), nicht erst an der
 * Bestätigung — im Chart soll sie zeigen, wo der Einstand herkommt.
 */
export function swingFaecher(kerzen, { seite, staerke = 20, anzahl = 1, minSepAtr = 1 }) {
    const n = kerzen.length
    const linien = []
    for (let nth = 1; nth <= anzahl; nth++) {
        const anker = swingAnker(kerzen, { seite, staerke, nth, minSepAtr })[n - 1]
        if (anker == null) continue
        const werte = new Array(n).fill(null)
        let pv = 0, vol = 0
        for (let i = anker; i < n; i++) {
            const k = kerzen[i]
            const w = k.v > 0 ? k.v : 1
            pv += ((k.h + k.l + k.c) / 3) * w
            vol += w
            werte[i] = pv / vol
        }
        linien.push({ nth, anker, werte })
    }
    return linien
}

// ── 3 EMA einer höheren Zeiteinheit ──────────────────────────────────────
/**
 * EMA einer höheren Zeiteinheit, auf die Chartkerzen gelegt.
 *
 * Wie `request.security(…, lookahead_off)` im Pine: auf HISTORISCHEN Kerzen
 * sieht eine Chartkerze die EMA der höheren Kerzen, die bis zu ihrem eigenen
 * Schluss geschlossen waren — innerhalb einer höheren Kerze also deren
 * Vorgänger, und der neue Wert erscheint auf der Chartkerze, mit der die höhere
 * schliesst. Das ergibt die Treppe, die TradingView zeigt. Nur die LETZTE
 * Chartkerze (Echtzeit im Pine) rechnet ihren Schluss als vorläufigen Schluss
 * der laufenden höheren Kerze ein und folgt dem Kurs.
 * Bis 18.10.2026 rechnete jede historische Kerze so — eine glatte Linie, die im
 * Pine nicht vorkommt, und Abstände zur Linie, die dort anders aussahen.
 */
export function emaHoehereTf(kerzen, htf, laenge, htfMs, ivMs) {
    const out = new Array(kerzen.length).fill(null)
    if (!Array.isArray(htf) || htf.length < laenge) return out
    const e = ema(htf, laenge)
    const a = 2 / (laenge + 1)
    let j = -1
    for (let i = 0; i < kerzen.length; i++) {
        const schluss = kerzen[i].t + ivMs
        // letzte höhere Kerze, die bis zum Schluss dieser Chartkerze GESCHLOSSEN war
        while (j + 1 < htf.length && htf[j + 1].t + htfMs <= schluss) j++
        const laufend = j + 1 < htf.length && htf[j + 1].t < schluss
        if (j < 0) continue
        const echtzeit = laufend && i === kerzen.length - 1
        out[i] = echtzeit && e[j] != null ? e[j] + a * (kerzen[i].c - e[j]) : e[j]
    }
    return out
}

// ── 4 Fibonacci aus dem ATR-ZigZag ───────────────────────────────────────
/** `f_zigzag` aus dem Pine: die letzten beiden Wendepunkte [piv1, piv0]. */
export function zigzag(kerzen, mult = 3) {
    const a = atr(kerzen, 14)
    let dir = 1
    let ext = kerzen[0]?.h ?? null
    let piv1 = null, piv0 = null
    for (let i = 0; i < kerzen.length; i++) {
        const k = kerzen[i]
        const sw = a[i] == null ? null : a[i] * mult
        if (dir === 1) {
            ext = Math.max(ext, k.h)
            if (sw != null && k.c <= ext - sw) { piv0 = piv1; piv1 = ext; dir = -1; ext = k.l }
        } else {
            ext = Math.min(ext, k.l)
            if (sw != null && k.c >= ext + sw) { piv0 = piv1; piv1 = ext; dir = 1; ext = k.h }
        }
    }
    return { piv1, piv0 }
}

export const FIB_STUFEN = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]

export function fibLevel(kerzen, htf, mult, an) {
    if (!Array.isArray(htf) || htf.length < 16 || !kerzen.length) return null
    const { piv1, piv0 } = zigzag(htf, mult)
    if (piv1 == null || piv0 == null) return null
    const top = Math.max(piv0, piv1), bot = Math.min(piv0, piv1)
    // Linke Kante: die Kerze, an der das Bein beginnt — von beiden Enden das ältere.
    const n = kerzen.length
    let offTop = 0, offBot = 0, gefTop = false, gefBot = false
    for (let j = 0; j <= Math.min(1500, n - 1); j++) {
        const k = kerzen[n - 1 - j]
        if (!gefTop && k.h >= top) { offTop = j; gefTop = true }
        if (!gefBot && k.l <= bot) { offBot = j; gefBot = true }
        if (gefTop && gefBot) break
    }
    const von = n - 1 - Math.max(offTop, offBot)
    return FIB_STUFEN.map((l, i) => ({ stufe: l, an: an[i], preis: piv1 + (piv0 - piv1) * l, von })).filter((x) => x.an)
}

// ── 5 Engulfing ──────────────────────────────────────────────────────────
export function engulfing(kerzen, { minKoerperAtr = 1, nurVolumen = false, stufen, a }) {
    const aus = []
    // Die letzte Kerze läuft noch: im Pine erscheint das Signal erst mit Kerzenschluss.
    for (let i = 1; i < kerzen.length - 1; i++) {
        const k = kerzen[i], v = kerzen[i - 1]
        const bull = k.c > k.o && v.c < v.o && k.c >= v.o && k.o <= v.c
        const bear = k.c < k.o && v.c > v.o && k.c <= v.o && k.o >= v.c
        if (!bull && !bear) continue
        if (a[i] == null || Math.abs(k.c - k.o) < minKoerperAtr * a[i]) continue
        if (nurVolumen && stufen[i].stufe === 'neutral') continue
        aus.push({ i, seite: bull ? 'bull' : 'bear' })
    }
    return aus
}

// ── 6 Perioden-POC (naked) ───────────────────────────────────────────────
/** Volumenprofil über Kerzen: Volumen je Kerze gleichmässig auf ihre Bins verteilt. */
function pocAus(kerzen, von, bis, bins) {
    let hoch = -Infinity, tief = Infinity
    for (let j = von; j <= bis; j++) { hoch = Math.max(hoch, kerzen[j].h); tief = Math.min(tief, kerzen[j].l) }
    const spanne = hoch - tief
    if (!(spanne > 0)) return null
    const b = spanne / bins
    const vol = new Array(bins).fill(0)
    for (let j = von; j <= bis; j++) {
        const lo = Math.max(0, Math.min(bins - 1, Math.floor((kerzen[j].l - tief) / b)))
        const hi = Math.max(0, Math.min(bins - 1, Math.floor((kerzen[j].h - tief) / b)))
        const anteil = (kerzen[j].v || 0) / (hi - lo + 1)
        for (let x = lo; x <= hi; x++) vol[x] += anteil
    }
    let m = 0, mb = 0
    for (let x = 0; x < bins; x++) if (vol[x] > m) { m = vol[x]; mb = x }
    return tief + (mb + 0.5) * b
}

/**
 * Am Ende jeder Periode deren POC; er bleibt stehen, bis eine spätere Kerze
 * ihn durchläuft. Höchstens `max` gleichzeitig, die älteste fliegt.
 * @returns [{ preis, von (erste Kerze der Periode), ab (Kerze der Entstehung) }]
 */
export function periodenPoc(kerzen, { tf = '1d', bins = 50, max = 20 }) {
    let offen = []
    let start = 0
    for (let i = 0; i < kerzen.length; i++) {
        const k = kerzen[i]
        // Abholung durch diese Kerze (nicht durch die, an der das Level entstand)
        offen = offen.filter((l) => !(i > l.ab && k.h >= l.preis && k.l <= l.preis))
        if (i > 0 && periodeVon(k.t, tf) !== periodeVon(kerzen[i - 1].t, tf)) {
            // Die erste Periode ist nur vollständig, wenn die Reihe an ihrem Anfang beginnt.
            const vollstaendig = start > 0 || periodeVon(kerzen[0].t - 1, tf) !== periodeVon(kerzen[0].t, tf)
            const von = Math.max(start, i - 500)
            const pp = vollstaendig ? pocAus(kerzen, von, i - 1, bins) : null
            if (pp != null && !(k.h >= pp && k.l <= pp)) offen.push({ preis: pp, von: start, ab: i })
            if (offen.length > max) offen = offen.slice(offen.length - max)
            start = i
        }
    }
    return offen
}

// ── 7 Candle-POC (intrabar) ──────────────────────────────────────────────
/**
 * POC je Chartkerze aus den Intrabar-Kerzen, die in sie fallen. Eine Kerze
 * ohne Intrabar-Daten (älter als das, was geladen wurde) bekommt keinen —
 * wie im Pine, wenn das Intrabar-Budget aufgebraucht ist.
 */
export function candlePocs(kerzen, intra, ivMs, bins = 25) {
    const out = new Array(kerzen.length).fill(null)
    if (!Array.isArray(intra) || !intra.length) return out
    let j = 0
    for (let i = 0; i < kerzen.length; i++) {
        const k = kerzen[i]
        const spanne = k.h - k.l
        while (j < intra.length && intra[j].t < k.t) j++
        if (!(spanne > 0)) continue
        const b = spanne / bins
        const vol = new Array(bins).fill(0)
        let n = 0
        for (let x = j; x < intra.length && intra[x].t < k.t + ivMs; x++) {
            const pr = (intra[x].h + intra[x].l) / 2
            const bb = Math.max(0, Math.min(bins - 1, Math.floor((pr - k.l) / b)))
            vol[bb] += intra[x].v || 0
            n++
        }
        if (!n) continue
        let m = 0, mb = 0
        for (let x = 0; x < bins; x++) if (vol[x] > m) { m = vol[x]; mb = x }
        out[i] = k.l + (mb + 0.5) * b
    }
    return out
}

/**
 * Docht-Level: an bestätigten Pivot-Hochs/-Tiefs der Candle-POC, wenn er im
 * oberen bzw. unteren DOCHT liegt — ein Wiederanlaufziel. Bleibt bis zur
 * ersten Berührung stehen.
 */
export function dochtLevel(kerzen, pocs, { staerke = 5, max = 60 }) {
    const hoch = new Set(pivotHighs(kerzen, staerke, staerke).map((p) => p.index))
    const tief = new Set(pivotLows(kerzen, staerke, staerke).map((p) => p.index))
    let offen = []
    for (let i = 0; i < kerzen.length; i++) {
        const k = kerzen[i]
        offen = offen.filter((l) => !(k.h >= l.preis && k.l <= l.preis))
        const p = i - staerke                       // Pivot-Kerze, an DIESER Kerze bestätigt
        if (p < 0 || i === kerzen.length - 1) continue   // laufende Kerze bestätigt nichts
        const istH = hoch.has(p), istL = tief.has(p)
        if (!istH && !istL) continue
        const cp = pocs[p]
        if (cp == null) continue
        const kp = kerzen[p]
        const imDocht = (istH && cp > Math.max(kp.o, kp.c)) || (istL && cp < Math.min(kp.o, kp.c))
        if (!imDocht) continue
        let schon = false
        for (let x = p + 1; x <= i; x++) if (kerzen[x].h >= cp && kerzen[x].l <= cp) { schon = true; break }
        if (schon) continue
        offen.push({ preis: cp, von: p })
        if (offen.length > max) offen = offen.slice(offen.length - max)
    }
    return offen
}

// ── 8 Vektorkerzen-Zonen ─────────────────────────────────────────────────
/**
 * Jede Vektorkerze wird zur Zone; Folgekerzen fressen den durchhandelten Teil
 * weg (Demand von oben, Supply von unten), komplett durchlaufen = abgeholt.
 */
export function vektorZonen(kerzen, stufen, { nurClimax = true, nurKoerper = true, max = 30 }) {
    let zonen = []
    for (let i = 0; i < kerzen.length; i++) {
        const k = kerzen[i]
        zonen = zonen.filter((z) => !(z.bull ? k.l <= z.unten : k.h >= z.oben))
        for (const z of zonen) {
            if (z.bull && k.l < z.oben) z.oben = k.l
            if (!z.bull && k.h > z.unten) z.unten = k.h
        }
        if (i === kerzen.length - 1) continue      // erst mit Kerzenschluss
        const s = stufen[i]
        const ok = nurClimax ? s.stufe === 'climax' : s.stufe !== 'neutral'
        if (!ok) continue
        const oben = nurKoerper ? Math.max(k.o, k.c) : k.h
        const unten = nurKoerper ? Math.min(k.o, k.c) : k.l
        if (!(oben > unten)) continue
        zonen.push({ von: i, oben, unten, bull: s.bull })
        if (zonen.length > max) zonen = zonen.slice(zonen.length - max)
    }
    return zonen
}

// ── 9 Daily Open ─────────────────────────────────────────────────────────
export function dailyOpen(kerzen) {
    for (let i = kerzen.length - 1; i >= 0; i--) {
        if (i === 0 || periodeVon(kerzen[i].t, '1d') !== periodeVon(kerzen[i - 1].t, '1d')) {
            // Beginnt die Reihe mitten im Tag, ist der Tagesanfang nicht geladen.
            if (i === 0 && kerzen[0].t % TAG !== 0) return null
            return { von: i, preis: kerzen[i].o }
        }
    }
    return null
}

// ── Gesamt ───────────────────────────────────────────────────────────────
/**
 * Alles auf einmal. `ext` = { htf: { [tf]: kerzen }, intra: kerzen } —
 * höhere Zeiteinheiten für MTF-EMA und Fibonacci, Intrabar-Kerzen für den
 * Candle-POC. Fehlt etwas, bleibt nur das betroffene Modul leer.
 */
export function rechneVwapVector(kerzen, p, ext = {}, ivMs = 3_600_000) {
    const n = kerzen.length
    const a = atr(kerzen, 14)
    const stufen = pvsra(kerzen, { len: p.pvsraLen, climaxMult: p.climaxMult, risingMult: p.risingMult })
    const linien = {}
    const intraday = ivMs < TAG

    if (p.showDaily) linien.vwapD = vwap(kerzen, { anchor: 'session' })
    if (p.showWeekly) linien.vwapW = vwap(kerzen, { anchor: 'week' })
    if (p.showMonthly) linien.vwapM = vwap(kerzen, { anchor: 'month' })
    // ATH/ATL über die GELADENEN Kerzen — der Chart lädt nicht die ganze Historie.
    if (p.showATH) linien.vwapATH = vwap(kerzen, { anchor: 'ath' })
    if (p.showATL) linien.vwapATL = vwap(kerzen, { anchor: 'atl' })
    if (p.showEma21) linien.ema21 = ema(kerzen, 21)
    if (p.showEma50) linien.ema50 = ema(kerzen, 50)
    if (p.showEma200) linien.ema200 = ema(kerzen, 200)
    if (p.showEmaC1) linien.emaC1 = ema(kerzen, p.lenEmaC1)
    if (p.showEmaC2) linien.emaC2 = ema(kerzen, p.lenEmaC2)
    for (const x of [1, 2, 3]) {
        if (!p[`showMtfE${x}`]) continue
        const tf = p[`tfMtfE${x}`]
        linien[`mtf${x}`] = emaHoehereTf(kerzen, ext.htf?.[tf], p[`lenMtfE${x}`], TF_MS[tf], ivMs)
    }

    const faecher = {
        hoch: p.showSwingHi ? swingFaecher(kerzen, { seite: 'high', staerke: p.swingPivLen, anzahl: p.swingCnt, minSepAtr: p.swingMinSep }) : [],
        tief: p.showSwingLo ? swingFaecher(kerzen, { seite: 'low', staerke: p.swingPivLen, anzahl: p.swingCnt, minSepAtr: p.swingMinSep }) : [],
    }

    const pocs = p.showPocC ? candlePocs(kerzen, ext.intra, ivMs, p.pocCBins) : null
    return {
        n,
        atrLetzte: a[n - 1],
        stufen: p.showVector ? stufen : null,
        linien,
        faecher,
        fib: p.showFib ? fibLevel(kerzen, ext.htf?.[p.fibTf], p.fibAtrMult, [p.fL0, p.fL236, p.fL382, p.fL5, p.fL618, p.fL786, p.fL1]) : null,
        engulfing: p.showEng ? engulfing(kerzen, { minKoerperAtr: p.engMinBody, nurVolumen: p.engVolConf, stufen, a }) : [],
        periodenPoc: p.showPocPer ? periodenPoc(kerzen, { tf: p.pocPerTf, bins: p.pocPerBins, max: p.pocPerMax }) : [],
        candlePoc: p.showPocC && p.pocCAll ? pocs : null,
        dochtLevel: p.showPocC && pocs ? dochtLevel(kerzen, pocs, { staerke: p.pocCPiv, max: p.pocCMax }) : [],
        zonen: p.showVliq ? vektorZonen(kerzen, stufen, { nurClimax: p.vliqClimax, nurKoerper: p.vliqBody, max: p.vliqMax }) : [],
        dailyOpen: p.showDOpen && intraday ? dailyOpen(kerzen) : null,
    }
}
