/**
 * GUSS — Nachbau des TradingView-Indikators „GUSS V8 [Claudius Vertesi]"
 * (Sniperentry nach Kryptomano) aus seinem sichtbaren Verhalten.
 *
 * Das Original ist geschützter Quelltext. Hergeleitet am 18.10.2026 aus den
 * Einstellungen und ⓘ-Texten und gegen seine Labels auf ETHUSDT.P 1h und
 * BTCUSDT.P 4h geprüft (Fixtures unter shared/fixtures/, Selbsttest
 * shared/__selftest-cv-indikatoren.mjs).
 *
 *   Start   (GUSS, Long) der Schluss ist der höchste der letzten `lookback`
 *           Kerzen — „Number of candles used to find the highest/lowest
 *           close" —, die EMAs stehen in Trendordnung (21 > 50 > 200; mit
 *           `ohne200` nur 21 > 50), die EMAs halten den Mindestabstand in ATR
 *           und der Schluss liegt mindestens `minAbstandPreis` × ATR über der
 *           EMA 21 (starker Ausbruch). Ein weiteres neues Extrem verschiebt
 *           den Start dorthin. R-GUSS (Short) spiegelbildlich.
 *   Rücklauf„in einem Guss": Kerzen gegen die Rücklaufrichtung (bei Long eine
 *           grüne) sind Gegenkerzen — höchstens `maxGegenkerzen` in Folge, jede
 *           mit einem Körper bis `maxGegenkerzenAtr` × ATR, sonst verfällt das
 *           Signal. Ebenso nach `timeout` Kerzen ohne Einstieg.
 *   Entry   die erste Kerze (nach mindestens `bestaetigung` Kerzen in
 *           Rücklaufrichtung), deren Tief (Long) bzw. Hoch (Short) eine der
 *           gewählten Ziel-EMAs erreicht — Label „GUSS Entry (EMA 50)".
 *
 * Rein, ohne Netz. Kerzen `{t,o,h,l,c}` aufsteigend, nur geschlossene.
 */
import { ema, atr } from './indicators.js'

export const GUSS_VORGABEN = {
    lookback: 20,
    bestaetigung: 0,
    timeout: 20,
    trendFilter: true,
    ohne200: false,
    ema0: 21, ema1: 50, ema2: 200,
    abstandFilter: true,
    atrLaenge: 14,
    minAbstand2150: 0.5,
    minAbstand50200: 0.5,
    preisFilter: true,
    minAbstandPreis: 0.5,
    zeigeLong: true,
    zeigeShort: true,
    ziel21: false, ziel50: true, ziel200: true,
    maxGegenkerzen: 1,
    maxGegenkerzenAtr: 0.1,
}

/**
 * @returns {{ ereignisse: Array<{seite:'long'|'short', startT, startP, startI, entryT:number|null, entryP:number|null, ziel:string|null, status:'entry'|'offen'|'verfallen'}>,
 *             emas: { e0:number[], e1:number[], e2:number[] } }}
 */
export function gussCv(kerzen, opt = {}) {
    const p = { ...GUSS_VORGABEN, ...opt }
    const k = kerzen || []
    const e0 = ema(k, p.ema0), e1 = ema(k, p.ema1), e2 = ema(k, p.ema2)
    const A = atr(k, p.atrLaenge)
    const ziele = [p.ziel21 && ['EMA ' + p.ema0, e0], p.ziel50 && ['EMA ' + p.ema1, e1], p.ziel200 && ['EMA ' + p.ema2, e2]].filter(Boolean)
    const ereignisse = []
    const lb = Math.max(1, Math.round(p.lookback))

    const trendOk = (i, lang) => {
        if (!p.trendFilter) return true
        if (e0[i] == null || e1[i] == null || (!p.ohne200 && e2[i] == null)) return false
        const ordnung = lang ? e0[i] > e1[i] && (p.ohne200 || e1[i] > e2[i]) : e0[i] < e1[i] && (p.ohne200 || e1[i] < e2[i])
        return ordnung
    }
    const abstandOk = (i) => {
        if (!p.abstandFilter) return true
        if (!(A[i] > 0) || e0[i] == null || e1[i] == null) return false
        if (Math.abs(e0[i] - e1[i]) < p.minAbstand2150 * A[i]) return false
        if (!p.ohne200 && (e2[i] == null || Math.abs(e1[i] - e2[i]) < p.minAbstand50200 * A[i])) return false
        return true
    }
    const preisOk = (i, lang) => {
        if (!p.preisFilter) return true
        if (!(A[i] > 0) || e0[i] == null) return false
        return lang ? k[i].c - e0[i] >= p.minAbstandPreis * A[i] : e0[i] - k[i].c >= p.minAbstandPreis * A[i]
    }

    for (const lang of [true, false]) {
        if (lang ? !p.zeigeLong : !p.zeigeShort) continue
        const seite = lang ? 'long' : 'short'
        let aktiv = null
        const schliesse = (status, extra = {}) => { ereignisse.push({ ...aktiv.ereignis, status, ...extra }); aktiv = null }
        for (let i = lb; i < k.length; i++) {
            const x = k[i]
            let extrem = true
            for (let j = i - lb; j < i && extrem; j++) extrem = lang ? x.c > k[j].c : x.c < k[j].c
            if (extrem && trendOk(i, lang) && abstandOk(i) && preisOk(i, lang)) {
                // neues Extrem → (neuer) Start; ein laufender wird dorthin verschoben
                aktiv = { i, gegen: 0, imRuecklauf: 0, ereignis: { seite, startI: i, startT: x.t, startP: lang ? x.h : x.l, entryT: null, entryP: null, ziel: null } }
                continue
            }
            if (!aktiv) continue
            if (i - aktiv.i > p.timeout) { schliesse('verfallen'); continue }
            const gegenkerze = lang ? x.c > x.o : x.c < x.o
            if (gegenkerze) {
                aktiv.gegen++
                if (aktiv.gegen > p.maxGegenkerzen || Math.abs(x.c - x.o) > p.maxGegenkerzenAtr * (A[i] || Infinity)) { schliesse('verfallen'); continue }
            } else {
                aktiv.gegen = 0
                aktiv.imRuecklauf++
            }
            if (aktiv.imRuecklauf < p.bestaetigung) continue
            for (const [name, reihe] of ziele) {
                const z = reihe[i]
                if (z != null && (lang ? x.l <= z : x.h >= z)) { schliesse('entry', { entryT: x.t, entryP: z, ziel: name }); break }
            }
        }
        if (aktiv) ereignisse.push({ ...aktiv.ereignis, status: 'offen' })
    }
    return { ereignisse: ereignisse.sort((a, b) => a.startT - b.startT), emas: { e0, e1, e2 } }
}
