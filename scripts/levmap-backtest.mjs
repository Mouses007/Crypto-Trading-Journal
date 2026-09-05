/**
 * Rückwärts-Backtest der Liquidationskarte gegen aufgezeichnete Liquidationen.
 *
 *   node scripts/levmap-backtest.mjs [SYMBOL …]
 *
 * Der Vorgänger (`_levmap-backtest.mjs`, Quelle der alten „Lift 1,54×"-Zahl)
 * war per .gitignore ausgeschlossen und ist verloren — dieses Skript ist
 * eingecheckt, damit die Zahl in der Fusszeile der Seite reproduzierbar
 * bleibt. Wer an der Richtungslogik oder den Gewichten dreht, misst hier.
 *
 * Methode: Ein `buildLeverageHistory`-Lauf je Gewichtssatz (Spalte i kennt
 * nur Kerzen ≤ i — kein Blick in die Zukunft). An jedem Bewertungspunkt
 * werden die massereichsten Zeilen markiert, bis ein fester Flächenanteil f
 * des ±6-%-Bandes erreicht ist; dann zählt, wie viele der im FOLGENDEN
 * 4-h-Fenster aufgezeichneten Liquidationen in markierten Zeilen liegen.
 * Lift = Trefferquote / f. Zufall hat per Konstruktion Lift 1.
 *
 * Kontrollen:
 *  - Geometrie: gleiche Zeilenzahl, markiert allein nach Hebeldistanz vom
 *    aktuellen Kurs (ohne OI-Verteilung). Schlägt die Karte die Geometrie
 *    nicht, trägt die OI-Attribution nichts bei.
 *  - Gemessene Gewichte: Kalibrierung auf der ERSTEN Hälfte des Fensters
 *    (out-of-sample), getestet auf der zweiten.
 *
 * Liest die Datenbank NUR (eigene Knex-Verbindung ohne Migrationen) und holt
 * Kerzen/OI von Binance. Läuft im Projektverzeichnis (node_modules!).
 */

import knexLib from 'knex'
import axios from 'axios'
import zlib from 'zlib'
import { promisify } from 'util'
import { loadDbConfig } from '../server/db-config.js'
import { holeMarginRate, MMR_VORGABE } from '../server/margin-rates.js'
import { schaetzeHebelVerteilung } from '../server/liq-kalibrierung.js'
import {
    buildLeverageHistory, LEVERAGE_TIERS, effektiveStufen,
    liqPriceLong, liqPriceShort,
} from '../shared/leverageMap.js'
import { pickBucketSize } from '../shared/priceBins.js'

const gunzip = promisify(zlib.gunzip)

const SYMBOLE = process.argv.slice(2).length
    ? process.argv.slice(2).map(s => s.toUpperCase())
    : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT']

const PERIOD = '15m'
const PERIOD_MS = 15 * 60 * 1000
const BAND_PCT = 6            // bewertetes Preisband um den Kurs, einseitig
const FLAECHE = 0.15          // markierter Anteil des Bandes
const WARMUP = 96             // 24 h Aufwärmzeit, bevor bewertet wird
const SCHRITT = 16            // Bewertung alle 4 h
const HOUR_MS = 3600 * 1000

/** DB_*-Umgebungsvariablen (Container) stechen db-config.json. */
function dbKonfig() {
    if (process.env.DB_TYPE === 'postgresql' || process.env.DB_HOST) {
        return {
            client: 'pg',
            connection: {
                host: process.env.DB_HOST || 'localhost',
                port: Number(process.env.DB_PORT) || 5432,
                user: process.env.DB_USER || 'tradejournal',
                password: process.env.DB_PASSWORD || '',
                database: process.env.DB_NAME || 'tradejournal',
            },
            pool: { min: 0, max: 3 },
        }
    }
    return loadDbConfig()
}

async function leseEvents(knex, symbol, von, bis) {
    const rows = await knex('live_recordings')
        .where({ symbol, market: 'futures', kind: 'liq' })
        .andWhere('hourStart', '>=', Math.floor(von / HOUR_MS) * HOUR_MS)
        .andWhere('hourStart', '<=', Math.floor(bis / HOUR_MS) * HOUR_MS)
        .orderBy('hourStart')
    const events = []
    for (const row of rows) {
        const roh = JSON.parse((await gunzip(row.payload)).toString('utf8'))
        for (const e of roh) {
            if (e[0] >= von && e[0] <= bis) {
                events.push({ t: e[0], price: e[1], qty: e[2], isBuy: !!e[3] })
            }
        }
    }
    events.sort((a, b) => a.t - b.t)
    return events
}

async function holePunkte(symbol) {
    const { data: hist } = await axios.get('https://fapi.binance.com/futures/data/openInterestHist', {
        params: { symbol, period: PERIOD, limit: 500 }, timeout: 15000,
    })
    if (!Array.isArray(hist) || !hist.length) return []
    const { data: klines } = await axios.get('https://fapi.binance.com/fapi/v1/klines', {
        params: {
            symbol, interval: PERIOD,
            startTime: Number(hist[0].timestamp) - PERIOD_MS, limit: hist.length + 2,
        },
        timeout: 15000,
    })
    const proKerze = new Map(klines.map(k => [Number(k[0]), k]))
    const punkte = []
    for (const h of hist) {
        const t = Number(h.timestamp)
        const k = proKerze.get(t - PERIOD_MS)
        if (!k) continue
        punkte.push({
            t, oi: Number(h.sumOpenInterest),
            o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], tb: +k[9],
        })
    }
    return punkte
}

/** Zeilen einer Spalte markieren: die massereichsten zuerst, bis f erreicht. */
function markiereKarte(hist, spalte, rLo, rHi, anzahl) {
    const off = spalte * hist.rows
    const zeilen = []
    for (let r = rLo; r <= rHi; r++) {
        const masse = hist.long[off + r] + hist.short[off + r]
        if (masse > 0) zeilen.push([r, masse])
    }
    zeilen.sort((a, b) => b[1] - a[1])
    return new Set(zeilen.slice(0, anzahl).map(z => z[0]))
}

/** Geometrie-Kontrolle: Zeilen um die reinen Hebeldistanzen vom Kurs. */
function markiereGeometrie(mid, stufen, mmr, base, bucketSize, rLo, rHi, anzahl) {
    const zentren = []
    for (const s of stufen) {
        zentren.push(Math.round(liqPriceLong(mid, s.effektiv, mmr) / bucketSize) - base)
        zentren.push(Math.round(liqPriceShort(mid, s.effektiv, mmr) / bucketSize) - base)
    }
    const markiert = new Set()
    for (let abstand = 0; markiert.size < anzahl && abstand <= (rHi - rLo); abstand++) {
        for (const z of zentren) {
            for (const r of [z - abstand, z + abstand]) {
                if (r >= rLo && r <= rHi && markiert.size < anzahl) markiert.add(r)
            }
        }
    }
    return markiert
}

function gewichteAusMessung(messung, mmr, maxHebel) {
    if (!messung?.gewichte) return null
    const stufen = effektiveStufen(LEVERAGE_TIERS, maxHebel)
    return stufen.map(s => messung.gewichte[s.nominal] || 0)
}

async function backtestSymbol(knex, symbol) {
    const punkte = await holePunkte(symbol)
    if (punkte.length < WARMUP + SCHRITT + 10) {
        console.log(`${symbol}: zu wenige Punkte (${punkte.length})`)
        return null
    }
    const von = punkte[0].t
    const bis = punkte[punkte.length - 1].t
    const events = await leseEvents(knex, symbol, von, bis)
    if (events.length < 100) {
        console.log(`${symbol}: nur ${events.length} Liquidationen im Fenster — übersprungen`)
        return null
    }

    const rate = await holeMarginRate(symbol).catch(() => null)
    const mmr = rate?.mmr > 0 ? rate.mmr : MMR_VORGABE
    const maxHebel = rate?.maxHebel || 0

    // Out-of-sample-Kalibrierung: erste Hälfte misst, zweite Hälfte testet.
    const mitteIdx = punkte.length >> 1
    const splitT = punkte[mitteIdx].t
    const kalibKerzen = punkte.slice(0, mitteIdx).map((p, i) => ({
        t: p.t - PERIOD_MS, l: p.l, h: p.h,
        add: i > 0 ? Math.max(0, p.oi - punkte[i - 1].oi) : 0,
    }))
    const kalibEvents = events.filter(e => e.t < splitT)
    const messung = schaetzeHebelVerteilung(kalibEvents, kalibKerzen, { mmr, maxHebel })

    const mid0 = punkte[punkte.length - 1].c
    const bucketSize = pickBucketSize(mid0 > 1000 ? 0.1 : mid0 > 10 ? 0.001 : 0.00001, mid0, 12, 1200)
    const basisOpts = { mid: mid0, bucketSize, spanPct: 12, mmr, maxHebel, tiers: LEVERAGE_TIERS, seed: false }

    const stufen = effektiveStufen(LEVERAGE_TIERS, maxHebel)
    const standard = stufen.map(s => [0.4, 0.3, 0.2, 0.1][LEVERAGE_TIERS.indexOf(s.nominal)] || 0)
    const gemessen = gewichteAusMessung(messung, mmr, maxHebel)

    const laeufe = {
        standard: buildLeverageHistory(punkte, { ...basisOpts, weights: standard }),
        gemessen: gemessen ? buildLeverageHistory(punkte, { ...basisOpts, weights: gemessen }) : null,
    }

    const zaehler = {
        standard: { treffer: 0, events: 0, f: 0, fenster: 0 },
        gemessen: { treffer: 0, events: 0, f: 0, fenster: 0 },
        geometrie: { treffer: 0, events: 0, f: 0, fenster: 0 },
    }

    const referenz = laeufe.standard
    for (let i = WARMUP; i + SCHRITT < referenz.cols; i += SCHRITT) {
        const mid = referenz.mid[i]
        const rLo = Math.max(0, Math.round((mid * (1 - BAND_PCT / 100)) / bucketSize) - referenz.base)
        const rHi = Math.min(referenz.rows - 1, Math.round((mid * (1 + BAND_PCT / 100)) / bucketSize) - referenz.base)
        const bandZeilen = rHi - rLo + 1
        if (bandZeilen < 20) continue
        const anzahl = Math.max(1, Math.round(bandZeilen * FLAECHE))

        // Nur Test-Fenster nach dem Kalibrier-Split bewerten (für Fairness
        // gilt derselbe Zeitraum für alle drei Läufe).
        if (referenz.ts[i] < splitT) continue

        const imFenster = events.filter(e =>
            e.t > referenz.ts[i] && e.t <= referenz.ts[i + SCHRITT]
            && Math.abs(e.price - mid) / mid <= BAND_PCT / 100)
        if (!imFenster.length) continue

        const marken = {
            standard: markiereKarte(laeufe.standard, i, rLo, rHi, anzahl),
            gemessen: laeufe.gemessen ? markiereKarte(laeufe.gemessen, i, rLo, rHi, anzahl) : null,
            geometrie: markiereGeometrie(mid, stufen, mmr, referenz.base, bucketSize, rLo, rHi, anzahl),
        }

        for (const [name, markiert] of Object.entries(marken)) {
            if (!markiert) continue
            const z = zaehler[name]
            z.f += markiert.size / bandZeilen
            z.fenster++
            for (const e of imFenster) {
                z.events++
                const r = Math.round(e.price / bucketSize) - referenz.base
                if (markiert.has(r)) z.treffer++
            }
        }
    }

    const zeile = (name) => {
        const z = zaehler[name]
        if (!z.fenster || !z.events) return null
        const fMittel = z.f / z.fenster
        const quote = z.treffer / z.events
        return { quote, f: fMittel, lift: quote / fMittel, events: z.events }
    }
    return {
        symbol,
        events: events.length,
        kalibrierung: messung.gewichte
            ? Object.fromEntries(Object.entries(messung.gewichte).map(([k, v]) => [k, Math.round(v * 100)]))
            : null,
        unerklaertPct: messung.unerklaertPct,
        standard: zeile('standard'),
        gemessen: zeile('gemessen'),
        geometrie: zeile('geometrie'),
    }
}

const knex = knexLib(dbKonfig())
try {
    const gesamt = { standard: [0, 0], gemessen: [0, 0], geometrie: [0, 0] }
    for (const symbol of SYMBOLE) {
        const r = await backtestSymbol(knex, symbol)
        if (!r) continue
        const fmt = (z) => z ? `Lift ${z.lift.toFixed(2)}× (Quote ${(z.quote * 100).toFixed(1)} % bei f ${(z.f * 100).toFixed(1)} %, n=${z.events})` : '—'
        console.log(`\n${r.symbol} — ${r.events} Liquidationen im Fenster`)
        console.log(`  gemessene Gewichte: ${JSON.stringify(r.kalibrierung)} (unerklärt ${r.unerklaertPct} %)`)
        console.log(`  Karte (40/30/20/10): ${fmt(r.standard)}`)
        console.log(`  Karte (gemessen):    ${fmt(r.gemessen)}`)
        console.log(`  Geometrie-Kontrolle: ${fmt(r.geometrie)}`)
        for (const name of ['standard', 'gemessen', 'geometrie']) {
            const z = r[name]
            if (z) { gesamt[name][0] += z.lift * z.events; gesamt[name][1] += z.events }
        }
    }
    console.log('\n── Gesamt (eventgewichtet) ──')
    for (const name of ['standard', 'gemessen', 'geometrie']) {
        const [summe, n] = gesamt[name]
        console.log(`  ${name.padEnd(10)} Lift ${n ? (summe / n).toFixed(2) : '—'}× über ${n} Events`)
    }
    console.log('  Zufall     Lift 1.00× (per Konstruktion)')
} finally {
    await knex.destroy()
}
