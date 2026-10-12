/**
 * Abverkaufs-Wache — die reine Rechnung.
 *
 * Die Frage: Ein Perpetual ist hochgepumpt worden — droht jetzt der
 * Abverkauf? Zwei Teile, und die Trennung ist der Kern:
 *
 *   TREIBSTOFF   Ist genug da, das fallen kann? Überdehnung gegen den eigenen
 *                Schnitt, überhitztes Momentum, teures Funding, frisch
 *                aufgebautes Open Interest, Long-Überhang, ein Anstieg, den
 *                nur die Futures tragen, ein frisches Listing. Das allein ist
 *                noch kein Abverkauf — überdehnt kann ein Coin tagelang
 *                bleiben, und wer dagegenhält, wird ausgequetscht.
 *   KIPPEN       Beginnt es? Abstand vom Hoch, tieferes Hoch, Strukturbruch,
 *                Kaufdruck weg, Divergenz, abgelehnte Spitze, Open Interest
 *                fällt, Volumen erschöpft, Long-Liquidationen.
 *
 * Gemeldet wird erst, wenn beides zusammenkommt UND der Kurs selbst
 * mitspielt (`preisSpieltMit`): ein Kaufdruck, der nachlässt, während der Kurs
 * neue Hochs macht, ist kein Kippen. Gegenanzeichen (Short-Überhang,
 * negatives Funding, neue Hochs) stehen daneben und sperren, wo sie sperren
 * müssen.
 *
 * Unbekannt bleibt unbekannt: Fehlt eine Quelle, zählt ihr Signal weder für
 * noch gegen, und sie steht unter `fehlend`. Eine fehlende Funding-Zahl als
 * „0 %" gelesen wäre ein Gegenanzeichen, das es nie gab.
 *
 * Rein: Zahlen hinein, Urteil heraus. Kein Netz, keine DB.
 */

import { ema, atr, rsi, pivotHighs } from '../strategies/indicators.js'

/** Vorgaben der Einstellungen — die Seite zeigt sie, der Lauf liest sie. */
export const ABVERKAUF_VORGABEN = {
    /** Ab diesem 24h-Anstieg (in %) kommt ein Perpetual in die Vorauswahl. */
    minAnstieg: 20,
    /** Mindestumsatz 24h in USD — darunter ist ein Short ein Liquiditätsrisiko. */
    minUmsatz: 10_000_000,
    /** Ab dieser Treibstoff-Note gilt ein Coin als überdehnt. */
    schwelle: 45,
    /** Wie viele Coins je Lauf genau angesehen werden (höchstens). */
    maxKandidaten: 20,
}

/**
 * Eingaben der Seite in sichere Grenzen — rein. Unbekanntes fällt weg, ein
 * leeres Feld behält den alten Wert (`alt`), statt als 0 eine Hürde zu öffnen.
 */
export function bereinigeAbverkauf(neu = {}, alt = {}) {
    const grenzen = { minAnstieg: [5, 500], minUmsatz: [0, 1e11], schwelle: [10, 100], maxKandidaten: [1, 40], intervallMin: [5, 120] }
    const raus = { ...alt }
    for (const [k, [lo, hi]] of Object.entries(grenzen)) {
        if (neu[k] === '' || neu[k] === null || neu[k] === undefined) continue
        const z = Number(neu[k])
        if (Number.isFinite(z)) raus[k] = Math.min(hi, Math.max(lo, z))
    }
    for (const k of ['an', 'vorwarnung']) if (typeof neu[k] === 'boolean') raus[k] = neu[k]
    return raus
}

/** Wie lange ein Coin nach dem letzten Treffer weiter beobachtet wird, auch wenn sein 24h-Anstieg schrumpft. */
export const NACHLAUF_MS = 12 * 3600e3

const ok = (x) => typeof x === 'number' && Number.isFinite(x)
const letzt = (a) => (Array.isArray(a) && a.length ? a[a.length - 1] : null)
const median = (w) => {
    const z = w.filter(ok).sort((a, b) => a - b)
    if (!z.length) return null
    const m = Math.floor(z.length / 2)
    return z.length % 2 ? z[m] : (z[m - 1] + z[m]) / 2
}
const mittel = (w) => {
    const z = w.filter(ok)
    return z.length ? z.reduce((a, b) => a + b, 0) / z.length : null
}
const runde = (x, n = 1) => (ok(x) ? Math.round(x * 10 ** n) / 10 ** n : null)
const pct = (x) => `${x >= 0 ? '+' : ''}${runde(x, 1)} %`

/**
 * Funding auf acht Stunden umgerechnet. Ein 4h-Markt zahlt doppelt so oft —
 * 0,05 % je 4 h sind 0,1 % je 8 h, und nur so sind die Schwellen vergleichbar
 * (siehe `funding-takt-kanon`). Ohne bekannten Takt: unbekannt, nicht 8 h.
 */
export function funding8h(ratePct, intervallH) {
    if (!ok(ratePct) || !ok(intervallH) || intervallH <= 0) return null
    return ratePct * (8 / intervallH)
}

/** Änderung in % zwischen dem Wert vor `zurueck` Punkten und dem letzten. */
function aenderung(reihe, zurueck) {
    const w = (reihe || []).filter((p) => ok(p?.wert))
    if (w.length < 2) return null
    const a = w[Math.max(0, w.length - 1 - zurueck)].wert
    const b = w[w.length - 1].wert
    return a > 0 ? ((b - a) / a) * 100 : null
}

/**
 * Die Kennzahlen, aus denen die Signale entstehen — rein, einzeln testbar.
 *
 * @param {object} d  siehe `bewerteAbverkauf`
 */
export function kennzahlen(d) {
    const k1 = Array.isArray(d.k1h) ? d.k1h : []
    const k15 = Array.isArray(d.k15m) ? d.k15m : []
    const kz = {}

    if (k1.length >= 30) {
        const e20 = ema(k1, 20)
        const a14 = atr(k1, 14)
        const r14 = rsi(k1, 14)
        const c = letzt(k1).c
        kz.preis = c
        kz.dehnungAtr = ok(letzt(e20)) && ok(letzt(a14)) && letzt(a14) > 0 ? (c - letzt(e20)) / letzt(a14) : null
        // Wie beim RSI die Spitze der letzten sechs Stunden: kippt es, ist die Dehnung schon geschrumpft.
        const dehnungen = k1.slice(-6).map((x, j) => {
            const i = k1.length - 6 + j
            return ok(e20[i]) && ok(a14[i]) && a14[i] > 0 ? (x.h - e20[i]) / a14[i] : null
        }).filter(ok)
        kz.dehnungSpitze = dehnungen.length ? Math.max(...dehnungen) : null
        kz.rsi1h = runde(letzt(r14))
        // Höchster RSI der letzten sechs Stunden: wenn es kippt, ist er schon gefallen.
        kz.rsi1hSpitze = runde(Math.max(...r14.slice(-6).filter(ok)))
        const fenster = k1.slice(-24)
        kz.hoch24h = Math.max(...fenster.map((x) => x.h))
        const iHoch = fenster.findIndex((x) => x.h === kz.hoch24h)
        kz.hochVorH = fenster.length - 1 - iHoch
        kz.vomHochPct = kz.hoch24h > 0 ? ((c - kz.hoch24h) / kz.hoch24h) * 100 : null
        // Docht-Ablehnung: eine der letzten vier Stunden mit langem oberen Docht bei hohem Volumen.
        const volMedian = median(k1.slice(-25, -1).map((x) => x.v))
        kz.docht = null
        for (const x of k1.slice(-4)) {
            const spanne = x.h - x.l
            if (!(spanne > 0) || !(volMedian > 0)) continue
            const oben = x.h - Math.max(x.o, x.c)
            if (oben / spanne >= 0.5 && x.v >= 2 * volMedian) kz.docht = { anteil: oben / spanne, volFaktor: x.v / volMedian, t: x.t }
        }
    }

    if (k15.length >= 40) {
        const a15 = atr(k15, 14)
        const e15 = ema(k15, 20)
        const r15 = rsi(k15, 14)
        const c = letzt(k15).c
        kz.atr15Pct = ok(letzt(a15)) && c > 0 ? (letzt(a15) / c) * 100 : null
        // Neue Hochs: macht eine der beiden letzten 15m-Kerzen das Hoch der letzten 24 h?
        const hoch96 = Math.max(...k15.slice(-96).map((x) => x.h))
        kz.neuesHoch = k15.slice(-2).some((x) => x.h >= hoch96)
        // Strukturbruch: die letzten zwei Schlüsse unter der EMA20, davor mindestens acht darüber.
        const n = k15.length
        const unter = (i) => ok(e15[i]) && k15[i].c < e15[i]
        const ueber = (i) => ok(e15[i]) && k15[i].c > e15[i]
        let davorUeber = 0
        for (let i = n - 3; i >= 0 && ueber(i); i--) davorUeber++
        kz.unterEma15 = unter(n - 1) && unter(n - 2)
        kz.strukturbruch = kz.unterEma15 && davorUeber >= 8
        // Tieferes Hoch: die letzten zwei bestätigten 15m-Pivots, das jüngere tiefer.
        const piv = pivotHighs(k15, 3, 2).map((p) => p.index)
        kz.tieferesHoch = false
        kz.divergenz = false
        if (piv.length >= 2) {
            const [a, b] = piv.slice(-2)
            kz.tieferesHoch = k15[b].h < k15[a].h && n - 1 - b <= 12
            // Bärische Divergenz: höheres Hoch im Kurs, tieferes im RSI — vom überkauften Bereich aus.
            kz.divergenz = k15[b].h > k15[a].h && ok(r15[a]) && ok(r15[b]) && r15[a] >= 70 && r15[a] - r15[b] >= 3
                && n - 1 - b <= 12
        }
        // Volumen erschöpft: die letzte Stunde gegen die stärkste Viertelstunde des Tages.
        const volMax = Math.max(...k15.slice(-96).map((x) => x.v))
        const volJetzt = mittel(k15.slice(-4).map((x) => x.v))
        kz.volErschoepft = volMax > 0 && ok(volJetzt) ? volJetzt / volMax : null
    }

    kz.funding8h = funding8h(d.fundingRate, d.fundingIntervallH)

    // Open Interest: 24 h (Stundenpunkte) und gegen die Spitze der letzten drei Stunden (5m-Punkte).
    kz.oi24h = aenderung(d.oi1h, 24)
    const oi5 = (d.oi5m || []).filter((p) => ok(p?.wert))
    if (oi5.length >= 6) {
        const spitze = Math.max(...oi5.slice(-36).map((p) => p.wert))
        kz.oiVonSpitze = spitze > 0 ? ((letzt(oi5).wert - spitze) / spitze) * 100 : null
    }

    kz.kontenLongPct = ok(letzt(d.lsKonten)?.longPct) ? letzt(d.lsKonten).longPct : null
    kz.topRatio = ok(letzt(d.lsTop)?.ratio) ? letzt(d.lsTop).ratio : null

    // Taker-Kauf/Verkauf: die letzte halbe Stunde gegen die zwei Stunden davor.
    const tk = (d.taker5m || []).filter((p) => ok(p?.ratio))
    if (tk.length >= 12) {
        kz.takerJetzt = mittel(tk.slice(-6).map((p) => p.ratio))
        kz.takerVorher = mittel(tk.slice(-30, -6).map((p) => p.ratio))
    }

    // Spot gegen Futures: Umsatzverhältnis der letzten sechs Stunden gegen sein eigenes Wochenmittel.
    if (Array.isArray(d.spot1h)) {
        if (!d.spot1h.length) kz.keinSpot = true
        else if (k1.length >= 30) {
            const spotNach = new Map(d.spot1h.map((x) => [x.t, x.v * x.c]))
            const quoten = k1.map((x) => { const s = spotNach.get(x.t); return s > 0 ? (x.v * x.c) / s : null })
            const jetzt = mittel(quoten.slice(-6))
            const norm = median(quoten.slice(-168, -6))
            kz.futSpot = jetzt
            kz.futSpotFaktor = ok(jetzt) && ok(norm) && norm > 0 ? jetzt / norm : null
        }
    }

    if (d.liq?.erfasst) {
        kz.liqLongUsd = Number(d.liq.longUsd) || 0
        kz.liqShortUsd = Number(d.liq.shortUsd) || 0
    }
    return kz
}

/** Spielt der Kurs selbst mit? Regel und Begründung siehe `bewerteAbverkauf`. */
export function preisSpieltMit(kippen = []) {
    const hat = (k) => kippen.some((x) => x.schluessel === k)
    return hat('vomHoch') || hat('strukturbruch') || (hat('tieferesHoch') && kippen.length >= 3)
}

/**
 * Das Urteil für einen Coin.
 *
 * @param {object} d
 * @param {number} d.preisAenderung24h  in %
 * @param {number} d.fundingRate        in % je Takt (Binance-Dezimalbruch × 100)
 * @param {number} d.fundingIntervallH
 * @param {Array}  d.k1h, d.k15m        geschlossene Kerzen {t,o,h,l,c,v}
 * @param {Array|null} d.spot1h         Spotkerzen; [] = kein Spotmarkt, null = nicht abgefragt
 * @param {Array}  d.oi1h, d.oi5m       [{t, wert}]
 * @param {Array}  d.lsKonten           [{t, longPct}]
 * @param {Array}  d.lsTop              [{t, ratio}]  Top-Trader, Positionen
 * @param {Array}  d.taker5m            [{t, ratio}]  Kauf/Verkauf
 * @param {object|null} d.liq           {erfasst, longUsd, shortUsd} der letzten halben Stunde
 * @param {object|null} d.listung       {boerse, gesehenAm}
 * @param {number} schwelle             Treibstoff-Note ab „überdehnt"
 * @param {number} jetzt
 */
export function bewerteAbverkauf(d, { schwelle = ABVERKAUF_VORGABEN.schwelle, jetzt = Date.now() } = {}) {
    const kz = kennzahlen(d)
    const treibstoff = []
    const kippen = []
    const gegen = []
    const fehlend = []
    const plus = (liste, schluessel, punkte, text) => liste.push({ schluessel, punkte, text })

    // ── Treibstoff ─────────────────────────────────────────────────────
    const a24 = Number(d.preisAenderung24h)
    if (ok(a24) && a24 >= 20) plus(treibstoff, 'anstieg', a24 >= 100 ? 28 : a24 >= 50 ? 22 : 15, `${pct(a24)} in 24 h`)

    if (ok(kz.dehnungSpitze)) {
        if (kz.dehnungSpitze >= 3) plus(treibstoff, 'dehnung', kz.dehnungSpitze >= 5 ? 18 : 12,
            `bis ${runde(kz.dehnungSpitze)} ATR über der 1h-EMA20`)
    } else fehlend.push('kerzen1h')

    if (ok(kz.rsi1hSpitze) && kz.rsi1hSpitze >= 80) plus(treibstoff, 'rsi', kz.rsi1hSpitze >= 88 ? 12 : 8,
        `RSI(1h) bis ${kz.rsi1hSpitze}`)

    if (ok(kz.funding8h)) {
        if (kz.funding8h >= 0.05) plus(treibstoff, 'funding', kz.funding8h >= 0.1 ? 15 : 10,
            `Funding ${runde(kz.funding8h, 3)} % je 8 h — Longs zahlen`)
        /*
         * Negatives Funding: Shorts zahlen. Leicht negativ ist ein Hinweis; ab
         * −0,1 % je 8 h sperrt es. RSR stand am 12.10.2026 bei −2 % je 8 h —
         * ein Short kostete dort 6 % am Tag, und so viele Shorts auf einem
         * Haufen sind der Brennstoff für einen Squeeze, nicht für einen Abverkauf.
         */
        if (kz.funding8h <= -0.03) gegen.push({ schluessel: 'fundingNegativ', sperrt: kz.funding8h <= -0.1,
            text: `Funding ${runde(kz.funding8h, 3)} % je 8 h — Shorts zahlen${kz.funding8h <= -0.1 ? ' viel' : ''}, Squeeze-Gefahr` })
    } else fehlend.push('funding')

    if (ok(kz.oi24h)) {
        if (kz.oi24h >= 25) plus(treibstoff, 'oi', kz.oi24h >= 60 ? 15 : 10, `Open Interest ${pct(kz.oi24h)} in 24 h — frisch gehebelt`)
    } else fehlend.push('oi')

    if (ok(kz.topRatio) && kz.topRatio >= 1.8) plus(treibstoff, 'topLong', 6, `Top-Trader ${runde(kz.topRatio, 2)} : 1 long`)
    if (ok(kz.kontenLongPct)) {
        if (kz.kontenLongPct >= 65) plus(treibstoff, 'kontenLong', 4, `${runde(kz.kontenLongPct)} % der Konten long`)
        if (kz.kontenLongPct <= 40) gegen.push({ schluessel: 'shortUeberhang', sperrt: false,
            text: `nur ${runde(kz.kontenLongPct)} % der Konten long — viele Shorts, Squeeze-Gefahr` })
    } else fehlend.push('longShort')

    if (kz.keinSpot) plus(treibstoff, 'nurFutures', 5, 'kein Binance-Spotmarkt — der Anstieg läuft dort über Hebel')
    else if (ok(kz.futSpotFaktor) && kz.futSpotFaktor >= 1.5) plus(treibstoff, 'futuresGetrieben', 8,
        `Futures-Umsatz ${runde(kz.futSpotFaktor)}× so hoch gegen Spot wie üblich`)
    else if (!ok(kz.futSpotFaktor) && !kz.keinSpot) fehlend.push('spot')

    if (d.listung && ok(Number(d.listung.gesehenAm)) && jetzt - Number(d.listung.gesehenAm) <= 7 * 86400e3) {
        plus(treibstoff, 'frischGelistet', 6, `vor ${Math.max(1, Math.round((jetzt - d.listung.gesehenAm) / 86400e3))} Tag(en) neu gelistet (${d.listung.boerse})`)
    }

    const note = Math.min(100, treibstoff.reduce((s, x) => s + x.punkte, 0))

    // ── Kippen ─────────────────────────────────────────────────────────
    if (ok(kz.vomHochPct)) {
        // Mindestens 4 % und mindestens drei 15m-ATR — bei wilden Coins ist 4 % nur Rauschen.
        const grenze = Math.max(4, ok(kz.atr15Pct) ? 3 * kz.atr15Pct : 0)
        if (-kz.vomHochPct >= grenze) plus(kippen, 'vomHoch', 0,
            `${runde(-kz.vomHochPct)} % unter dem 24h-Hoch (vor ${kz.hochVorH} h)`)
    }
    if (kz.tieferesHoch) plus(kippen, 'tieferesHoch', 0, 'tieferes Hoch im 15m-Chart')
    if (kz.strukturbruch) plus(kippen, 'strukturbruch', 0, 'zwei 15m-Schlüsse unter der EMA20 nach langem Lauf darüber')
    if (ok(kz.takerJetzt) && ok(kz.takerVorher)) {
        if (kz.takerJetzt < 0.95 && kz.takerVorher > 1.05) plus(kippen, 'kaufdruckWeg', 0,
            `Taker-Kauf/Verkauf ${runde(kz.takerJetzt, 2)} nach ${runde(kz.takerVorher, 2)} — Käufer ziehen sich zurück`)
        if (kz.takerJetzt > 1.2) gegen.push({ schluessel: 'kaufdruckStark', sperrt: false,
            text: `Taker kaufen weiter (${runde(kz.takerJetzt, 2)})` })
    } else fehlend.push('taker')
    if (kz.divergenz) plus(kippen, 'divergenz', 0, 'bärische RSI-Divergenz im 15m-Chart')
    if (kz.docht) plus(kippen, 'docht', 0,
        `abgelehnte Spitze: oberer Docht ${Math.round(kz.docht.anteil * 100)} % der Kerze bei ${runde(kz.docht.volFaktor)}× Volumen`)
    // Nur in der Nähe des Hochs: weit unten ist der Abverkauf gelaufen, und fallendes OI heisst nur noch „vorbei".
    if (ok(kz.oiVonSpitze) && kz.oiVonSpitze <= -5 && ok(kz.vomHochPct) && kz.vomHochPct >= -25) {
        plus(kippen, 'oiFaellt', 0, `Open Interest ${pct(kz.oiVonSpitze)} von der Spitze — Longs schliessen`)
    }
    if (ok(kz.volErschoepft) && kz.volErschoepft < 0.4 && ok(kz.vomHochPct) && kz.vomHochPct >= -8) {
        plus(kippen, 'volumenErschoepft', 0, `Volumen nur noch ${Math.round(kz.volErschoepft * 100)} % der stärksten Viertelstunde`)
    }
    if (ok(kz.liqLongUsd) && kz.liqLongUsd >= 50_000 && kz.liqLongUsd >= 2 * (kz.liqShortUsd || 0)) {
        plus(kippen, 'longLiquidationen', 0, `Long-Liquidationen ${Math.round(kz.liqLongUsd / 1000)} k USD in 30 min`)
    }

    if (kz.neuesHoch) gegen.push({ schluessel: 'neuesHoch', sperrt: true, text: 'macht gerade neue Hochs' })

    // ── Phase ─────────────────────────────────────────────────────────
    /*
     * Der Kurs muss mitspielen. Abstand vom Hoch und Strukturbruch reichen
     * allein; ein tieferes Hoch allein ist zu früh (IOUSDT am 12.10.2026: 3 %
     * unter dem Gipfel) — es zählt erst mit zwei weiteren Kippzeichen.
     */
    const preisDabei = preisSpieltMit(kippen)
    const gesperrt = gegen.some((g) => g.sperrt)
    let phase = 'keine'
    if (note >= schwelle) phase = 'ueberdehnt'
    if (phase === 'ueberdehnt' && kippen.length >= 2 && preisDabei && !gesperrt) phase = 'kippt'

    return {
        phase,
        note,
        treibstoff,
        kippen,
        gegen,
        fehlend: [...new Set(fehlend)],
        // Über dem Hoch ist die Lesart hinfällig — die eine Marke, die zur Warnung gehört.
        ungueltigUeber: ok(kz.hoch24h) ? kz.hoch24h : null,
        kennzahlen: {
            preis: kz.preis ?? null,
            anstieg24h: ok(a24) ? runde(a24) : null,
            vomHochPct: runde(kz.vomHochPct),
            dehnungAtr: runde(kz.dehnungAtr),
            dehnungSpitze: runde(kz.dehnungSpitze),
            rsi1h: kz.rsi1h ?? null,
            funding8h: runde(kz.funding8h, 4),
            oi24h: runde(kz.oi24h),
            oiVonSpitze: runde(kz.oiVonSpitze),
            kontenLongPct: runde(kz.kontenLongPct),
            topRatio: runde(kz.topRatio, 2),
            takerJetzt: runde(kz.takerJetzt, 2),
            takerVorher: runde(kz.takerVorher, 2),
            futSpotFaktor: runde(kz.futSpotFaktor),
            keinSpot: kz.keinSpot === true,
            liqLongUsd: kz.liqLongUsd ?? null,
            liqShortUsd: kz.liqShortUsd ?? null,
        },
    }
}

/**
 * Vorauswahl aus den marktweiten Daten — rein.
 *
 * Stark gestiegen und liquide genug, um dagegen zu handeln; dazu wer zuletzt
 * überdehnt war (`nachlauf`): Beginnt der Abverkauf, schrumpft der
 * 24h-Anstieg, und gerade dann fiele der Coin sonst heraus.
 *
 * @param {Map<string, object>} jeSymbol  aus `holeMarktweit`
 * @param {Set<string>} nachlauf          Symbole, die weiter beobachtet werden
 */
export function vorauswahl(jeSymbol, nachlauf = new Set(), einst = ABVERKAUF_VORGABEN) {
    const e = { ...ABVERKAUF_VORGABEN, ...einst }
    const alle = [...(jeSymbol?.values?.() || [])].filter((x) => /USDT$/.test(x.symbol))
    const gestiegen = alle.filter((x) => ok(x.preisAenderung24h) && x.preisAenderung24h >= e.minAnstieg
        && (Number(x.umsatz24h) || 0) >= e.minUmsatz)
        .sort((a, b) => b.preisAenderung24h - a.preisAenderung24h)
    const raus = new Map()
    for (const x of alle) if (nachlauf.has(x.symbol)) raus.set(x.symbol, x)
    for (const x of gestiegen) {
        if (raus.size >= e.maxKandidaten) break
        raus.set(x.symbol, x)
    }
    return [...raus.values()]
}

/**
 * Vergleichspartner für die Erfolgskontrolle — rein.
 *
 * Gegen wen misst man „nach der Warnung fiel der Kurs"? Gegen gepumpte Coins
 * aus DEMSELBEN Lauf, die nicht gekippt sind — sonst misst man nur, dass
 * gepumpte Coins im Mittel zurückkommen, was sie ohnehin tun. Je Treffer der
 * mit dem ähnlichsten 24h-Anstieg, jeder Partner höchstens einmal.
 */
export function waehlePartner(treffer = [], uebrige = []) {
    const frei = [...uebrige]
    const paare = []
    for (const t of treffer) {
        if (!frei.length) break
        let best = 0
        for (let i = 1; i < frei.length; i++) {
            if (Math.abs(frei[i].anstieg24h - t.anstieg24h) < Math.abs(frei[best].anstieg24h - t.anstieg24h)) best = i
        }
        paare.push([t, frei.splice(best, 1)[0]])
    }
    return paare
}

/**
 * Auswertung der Erfolgskontrolle — rein.
 *
 * Für einen Short zählt der Kurs RÜCKWÄRTS: eine negative Rendite ist gut,
 * und das MFE (der höchste Ausschlag nach oben) ist der Schmerz bis dahin.
 * Je Horizont: Median der Rendite, Anteil mit Rückgang ≥ 3 %, Median des
 * Ausschlags nach oben — für Warnungen und Vergleichscoins getrennt.
 *
 * @param {Array<{gruppe, horizont, renditePct, mfePct, status}>} zeilen
 */
export function abverkaufGuete(zeilen = []) {
    const raus = {}
    for (const z of zeilen) {
        if (z.status !== 'gemessen') continue
        const h = (raus[z.horizont] ||= { spitze: [], kontrolle: [] })
        const g = z.gruppe === 'spitze' ? h.spitze : z.gruppe === 'kontrolle' ? h.kontrolle : null
        if (g) g.push(z)
    }
    const fasse = (l) => ({
        n: l.length,
        medianRendite: runde(median(l.map((z) => Number(z.renditePct)))),
        anteilFall: l.length ? Math.round((l.filter((z) => Number(z.renditePct) <= -3).length / l.length) * 100) : null,
        medianHoch: runde(median(l.map((z) => Number(z.mfePct)))),
    })
    return Object.fromEntries(Object.entries(raus).map(([h, g]) => [h, { spitze: fasse(g.spitze), kontrolle: fasse(g.kontrolle) }]))
}
