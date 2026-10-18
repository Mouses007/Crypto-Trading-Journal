/**
 * Chart-Arbeitsplatz — Server-Seite.
 *
 * Der Chart ersetzt die frühere Übersicht. Er ist kein Nachbau von
 * TradingView-Code (der ist proprietär), sondern dieselben Funktionen auf der
 * freien Bibliothek Lightweight Charts — plus das, was TradingView nicht hat:
 * Journal, Strategie-Schicht und eigene Marktdaten im selben Bild.
 *
 * Diese Datei liefert nur Daten und speichert Arbeitsstände; gezeichnet wird
 * im Browser (`src/views/Chart.vue`, `src/components/chart/`).
 *
 *   GET  /api/chart/kerzen       Kerzen in EINER Normalform, egal welche Quelle
 *   GET  /api/chart/handelbar    welche Basiswährungen Bitunix/Bitget/Pionex führen
 *   CRUD /api/chart/layouts      Raster, Panels, Indikatoren, Overlay-Schalter
 *   CRUD /api/chart/watchlists   Symbol-Listen
 *   GET  /api/chart/ticker       Startkurse der Watchlist (bis der Stream tickt)
 *   CRUD /api/chart/vorlagen     Indikator-Vorlagen (benannte Indikatorlisten)
 *   CRUD /api/chart/zeichnungen  Linien, Zonen, Fibonacci … je Symbol
 *   GET  /api/chart/journal      eigene Trades eines Symbols im sichtbaren Zeitraum
 *   GET  /api/chart/hebelzonen   modellierte Liquidationszonen (Hebelkarte, verdichtet)
 *   GET  /api/chart/funding      Funding-Verlauf eines Perpetuals
 */

import axios from 'axios'
import { getKnex } from './database.js'
import { notiereGewicht, melde429, pausiertBis } from './binance-takt.js'
import { ladeListungen } from './hype-radar/listungen.js'
import { logWarn } from './logger.js'
import { tradesAusZeilen, mitNotizen } from './chart-journal.js'
import { holeHebelzonen } from './hebelzonen.js'
import { getFundingHistory } from './market-data.js'
import { ausCache } from './marktradar-api.js'
import { saubereVorlage } from './chart-vorlagen.js'
import { ordnePunkte } from './chart-alarm-regeln.js'

const SYMBOL_RE = /^[A-Z0-9]{2,20}$/
const HTTP_TIMEOUT = 10000

/** Binance-Zeiteinheiten; dieselbe Liste kennt das Frontend (`kerzenQuelle.js`). */
export const INTERVALLE = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']

/*
 * Quellen. Binance ist die Datenbasis (User-Entscheid 18.10.2026): tiefe
 * Historie, Websocket für die laufende Kerze. Bitunix und Bitget folgen als
 * wählbare REST-Quellen — sie haben öffentlich weniger Tiefe und keinen
 * angebundenen Websocket, und das wird im Kopf des Charts auch so gesagt.
 *
 * Gemessen 18.10.2026 gegen die Live-APIs:
 *   Bitunix  /api/v1/futures/market/kline — neueste ZUERST, höchstens 200,
 *            `endTime` blättert zurück, alle 15 Zeiteinheiten UTC-geschnitten,
 *            die LAUFENDE Kerze fehlt immer (auch mit endTime in der Zukunft:
 *            dann kommt gar nichts). Den laufenden Kurs liefert der Ticker.
 *   Bitget   /api/v2/mix/market/candles — aufsteigend, bis 1000, MIT laufender
 *            Kerze. Kein 8h. Ab 6h nur über die `…utc`-Varianten UTC-geschnitten
 *            (`1D` schneidet um 16:00 UTC, also UTC+8). Ältere Kerzen unter
 *            `history-candles` (höchstens 200).
 */
const QUELLEN = {
    'binance-futures': { basis: 'https://fapi.binance.com', pfad: '/fapi/v1/klines', max: 1500 },
    'binance-spot': { basis: 'https://api.binance.com', pfad: '/api/v3/klines', max: 1000 },
    'bitunix': { max: 200 },
    'bitget': { max: 1000 },
}

const BITGET_GRANULARITAET = {
    '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '2h': '2H', '4h': '4H',
    '6h': '6Hutc', '12h': '12Hutc', '1d': '1Dutc', '3d': '3Dutc', '1w': '1Wutc', '1M': '1Mutc',
}

/** Bitunix-Antwort ({time, open, …} neueste zuerst) → [[t,o,h,l,c,v]] aufsteigend. */
export function kerzenAusBitunix(roh) {
    const aus = []
    for (const k of Array.isArray(roh) ? roh : []) {
        const z = [Number(k.time), Number(k.open), Number(k.high), Number(k.low), Number(k.close), Number(k.baseVol)]
        if (z.every(Number.isFinite)) aus.push(z)
    }
    return aus.sort((a, b) => a[0] - b[0])
}

/** Bitget-Antwort ([ts, o, h, l, c, baseVol, quoteVol]) → [[t,o,h,l,c,v]] aufsteigend. */
export function kerzenAusBitget(roh) {
    const aus = []
    for (const k of Array.isArray(roh) ? roh : []) {
        if (!Array.isArray(k)) continue
        const z = [Number(k[0]), Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4]), Number(k[5])]
        if (z.every(Number.isFinite)) aus.push(z)
    }
    return aus.sort((a, b) => a[0] - b[0])
}

const IV_MS = {
    '1m': 6e4, '3m': 18e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '2h': 72e5, '4h': 144e5,
    '6h': 216e5, '8h': 288e5, '12h': 432e5, '1d': 864e5, '3d': 2592e5, '1w': 6048e5,
}

async function holeBitunix(symbol, interval, limit, endTime) {
    const params = { symbol, interval, limit }
    if (endTime) params.endTime = endTime
    const { data } = await axios.get('https://fapi.bitunix.com/api/v1/futures/market/kline', { params, timeout: HTTP_TIMEOUT })
    if (data?.code !== 0) throw Object.assign(new Error(data?.msg || 'Bitunix-Fehler'), { status: 400 })
    const kerzen = kerzenAusBitunix(data.data)
    if (endTime) return { kerzen }
    // Laufende Kerze: Bitunix liefert sie nicht. Mitgegeben wird der
    // Tickerpreis und die Eröffnungszeit der laufenden Kerze — der Browser
    // baut daraus die Kerze und führt Hoch/Tief über seine Abfragen nach.
    // Dass sie damit erst ab dem Öffnen der Seite stimmt, sagt der Kopf.
    let lauf = null
    try {
        const t = await axios.get('https://fapi.bitunix.com/api/v1/futures/market/tickers', { params: { symbols: symbol }, timeout: HTTP_TIMEOUT })
        const preis = Number(t.data?.data?.[0]?.lastPrice)
        const iv = IV_MS[interval]
        const letzte = kerzen[kerzen.length - 1]
        // Monatskerzen haben keine feste Länge — dort keine gebaute Kerze,
        // lieber keine als eine mit falscher Eröffnungszeit.
        if (preis > 0 && letzte && iv) {
            // Die laufende Kerze schliesst an die letzte geschlossene an. Früher
            // floor(jetzt/iv)·iv: die Epoche (1.1.1970) war ein Donnerstag, Bitunix
            // öffnet Wochenkerzen aber am Montag — die laufende 1w-Kerze stand drei
            // Tage zu spät, mit einer Lücke davor. Liegt die letzte geschlossene
            // Kerze mehr als eine Länge zurück (Lücke), lieber keine gebaute Kerze.
            const t = letzte[0] + iv
            if (t <= Date.now() && Date.now() < t + iv) lauf = { t, preis }
        }
    } catch { /* ohne Ticker eben ohne laufende Kerze */ }
    return { kerzen, lauf }
}

async function holeBitget(symbol, interval, limit, endTime) {
    const granularity = BITGET_GRANULARITAET[interval]
    if (!granularity) throw Object.assign(new Error(`Bitget kennt keine Zeiteinheit ${interval}`), { status: 400 })
    const params = { symbol, productType: 'USDT-FUTURES', granularity, limit }
    if (endTime) params.endTime = endTime
    let { data } = await axios.get('https://api.bitget.com/api/v2/mix/market/candles', { params, timeout: HTTP_TIMEOUT })
    if (data?.code !== '00000') throw Object.assign(new Error(data?.msg || 'Bitget-Fehler'), { status: 400 })
    let kerzen = kerzenAusBitget(data.data)
    if (!kerzen.length && endTime) {
        // Jenseits der Reichweite von `candles` hilft `history-candles` weiter.
        ;({ data } = await axios.get('https://api.bitget.com/api/v2/mix/market/history-candles',
            { params: { ...params, limit: Math.min(limit, 200) }, timeout: HTTP_TIMEOUT }))
        kerzen = kerzenAusBitget(data?.data)
    }
    return { kerzen }
}

/**
 * Binance-Antwort → [[t, o, h, l, c, v], …], aufsteigend nach Zeit.
 * Zahlen statt Strings: der Browser rechnet Indikatoren darauf, und ein
 * `'64000.1' + 1` wäre eine Zeichenkette.
 */
export function kerzenAusBinance(roh) {
    if (!Array.isArray(roh)) return []
    const aus = []
    for (const k of roh) {
        if (!Array.isArray(k) || k.length < 6) continue
        const zeile = [Number(k[0]), Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4]), Number(k[5])]
        if (zeile.every(Number.isFinite)) aus.push(zeile)
    }
    aus.sort((a, b) => a[0] - b[0])
    return aus
}

/** Antwort auf JSON-Spalten, die als Text liegen. */
function parse(text, ersatz) {
    if (text == null || text === '') return ersatz
    if (typeof text === 'object') return text
    try { return JSON.parse(text) } catch { return ersatz }
}

/*
 * Grössendeckel für gespeicherte Arbeitsstände. Ein Layout ist Konfiguration
 * (Panels, Indikatoren mit Parametern) — ein paar Kilobyte. Ein Deckel schützt
 * die gemeinsame Datenbank vor einem Fehler im Browser, der Kerzen oder ganze
 * Serien ins Layout schreibt.
 */
const MAX_LAYOUT_BYTES = 200 * 1024
const MAX_WATCHLIST_SYMBOLE = 400

function layoutZeile(r) {
    return { id: r.id, name: r.name, aktiv: Number(r.aktiv) === 1, daten: parse(r.daten, {}), geaendertAm: Number(r.geaendertAm) || 0 }
}

function vorlageZeile(r) {
    return { id: r.id, name: r.name, indikatoren: parse(r.indikatoren, []), geaendertAm: Number(r.geaendertAm) || 0 }
}

function watchlistZeile(r) {
    return { id: r.id, name: r.name, symbole: parse(r.symbole, []), reihenfolge: Number(r.reihenfolge) || 0 }
}

/** Watchlist-Einträge säubern: {symbol, markt}, ohne Doppelte, nur gültige Symbole. */
export function saubereSymbole(eingabe) {
    if (!Array.isArray(eingabe)) return []
    const gesehen = new Set()
    const aus = []
    for (const e of eingabe) {
        const symbol = String(e?.symbol || '').toUpperCase()
        const markt = e?.markt === 'spot' ? 'spot' : 'futures'
        if (!SYMBOL_RE.test(symbol)) continue
        const schluessel = `${markt}|${symbol}`
        if (gesehen.has(schluessel)) continue
        gesehen.add(schluessel)
        aus.push({ symbol, markt })
        if (aus.length >= MAX_WATCHLIST_SYMBOLE) break
    }
    return aus
}

/** Werkzeuge, die gespeichert werden dürfen (`messen` ist flüchtig). */
export const ZEICHEN_TYPEN = ['horizontale', 'strahlH', 'vertikale', 'trendlinie', 'strahl', 'kanal', 'rechteck', 'fib', 'position', 'text']
const MAX_PUNKTE = 4
const MAX_STIL_BYTES = 4096

/**
 * Eine Zeichnung aus dem Browser prüfen. Punkte stehen in Zeit (ms) + Preis;
 * alles andere wäre beim Wechsel der Zeiteinheit falsch. Gibt `{fehler}` oder
 * die gesäuberten Felder zurück.
 */
export function pruefeZeichnung(roh, { teilweise = false, typ: altTyp = null } = {}) {
    const aus = {}
    if (!teilweise || roh.symbol !== undefined) {
        const symbol = String(roh.symbol || '').toUpperCase()
        if (!SYMBOL_RE.test(symbol)) return { fehler: 'symbol ungültig' }
        aus.symbol = symbol
    }
    if (!teilweise || roh.typ !== undefined) {
        if (!ZEICHEN_TYPEN.includes(roh.typ)) return { fehler: `typ unbekannt: ${roh.typ}` }
        aus.typ = roh.typ
    }
    if (!teilweise || roh.punkte !== undefined) {
        if (!Array.isArray(roh.punkte) || !roh.punkte.length || roh.punkte.length > MAX_PUNKTE) return { fehler: 'punkte ungültig' }
        const punkte = []
        for (const x of roh.punkte) {
            const t = Number(x?.t)
            const p = Number(x?.p)
            if (!Number.isFinite(t) || !Number.isFinite(p)) return { fehler: 'punkt ohne Zeit oder Preis' }
            punkte.push({ t: Math.round(t), p })
        }
        // Nach der Zeit ordnen (ausser Strahl/Fibonacci/Position): „rechts" heisst dann
        // in Bild, Treffertest und Alarm dasselbe — über den SPÄTEREN Punkt hinaus.
        aus.punkte = JSON.stringify(ordnePunkte(aus.typ || roh.typ || altTyp, punkte))
    }
    if (roh.stil !== undefined) {
        const text = JSON.stringify(roh.stil && typeof roh.stil === 'object' ? roh.stil : {})
        if (text.length > MAX_STIL_BYTES) return { fehler: 'stil zu gross' }
        aus.stil = text
    }
    if (roh.sichtbarAuf !== undefined) {
        aus.sichtbarAuf = Array.isArray(roh.sichtbarAuf)
            ? JSON.stringify(roh.sichtbarAuf.filter((i) => INTERVALLE.includes(i)))
            : null
    }
    if (roh.gesperrt !== undefined) aus.gesperrt = roh.gesperrt ? 1 : 0
    if (roh.versteckt !== undefined) aus.versteckt = roh.versteckt ? 1 : 0
    return { daten: aus }
}

function zeichnungZeile(r) {
    return {
        id: r.id, symbol: r.symbol, typ: r.typ,
        // ältere Zeichnungen (vor der Ordnung beim Speichern) beim Lesen ordnen
        punkte: ordnePunkte(r.typ, parse(r.punkte, [])), stil: parse(r.stil, {}),
        sichtbarAuf: parse(r.sichtbarAuf, null),
        gesperrt: Number(r.gesperrt) === 1, versteckt: Number(r.versteckt) === 1,
        erstelltAm: Number(r.erstelltAm) || 0, geaendertAm: Number(r.geaendertAm) || 0,
    }
}

function name(eingabe, ersatz) {
    const n = String(eingabe ?? '').trim().slice(0, 80)
    return n || ersatz
}

export function setupChartRoutes(app) {

    /**
     * GET /api/chart/kerzen?quelle=binance-futures&symbol=BTCUSDT&interval=1h&endTime=&limit=
     *
     * Ohne `endTime` die jüngsten Kerzen einschliesslich der laufenden; mit
     * `endTime` die Kerzen BIS dahin — so lädt der Chart beim Zurückscrollen
     * nach. Binance akzeptiert `endTime` allein (anders als der ältere Proxy
     * `/api/binance/klines`, der beide Grenzen verlangt).
     *
     * Antwort: { quelle, symbol, interval, kerzen: [[t(ms), o, h, l, c, v], …] }
     */
    app.get('/api/chart/kerzen', async (req, res) => {
        const quelle = String(req.query.quelle || 'binance-futures')
        const q = QUELLEN[quelle]
        if (!q) return res.status(400).json({ error: `Unbekannte Quelle: ${quelle}` })
        const symbol = String(req.query.symbol || '').toUpperCase()
        if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'symbol fehlt oder ist ungültig' })
        const interval = String(req.query.interval || '1h')
        if (!INTERVALLE.includes(interval)) return res.status(400).json({ error: `Unbekannte Zeiteinheit: ${interval}` })
        const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 1000), q.max)
        const params = { symbol, interval, limit }
        if (req.query.endTime !== undefined && req.query.endTime !== '') {
            const end = Number(req.query.endTime)
            if (!Number.isFinite(end) || end <= 0) return res.status(400).json({ error: 'endTime muss Unix-Millisekunden sein' })
            params.endTime = Math.floor(end)
        }
        if (quelle === 'bitunix' || quelle === 'bitget') {
            try {
                const erg = quelle === 'bitunix'
                    ? await holeBitunix(symbol, interval, limit, params.endTime)
                    : await holeBitget(symbol, interval, limit, params.endTime)
                res.setHeader('Cache-Control', 'no-store')
                return res.json({ quelle, symbol, interval, ...erg })
            } catch (e) {
                const status = e.status || e.response?.status || 502
                if (status >= 500 || !e.response) logWarn('chart', `Kerzen ${quelle} ${symbol} ${interval}: ${e.message}`)
                return res.status(status >= 400 && status < 500 ? status : 502).json({ error: e.response?.data?.msg || e.message })
            }
        }
        try {
            const antwort = await axios.get(q.basis + q.pfad, { params, timeout: HTTP_TIMEOUT })
            notiereGewicht(antwort.headers)
            res.setHeader('Cache-Control', 'no-store')
            res.json({ quelle, symbol, interval, kerzen: kerzenAusBinance(antwort.data) })
        } catch (e) {
            const status = e.response?.status || 502
            if (status === 429 || status === 418) {
                melde429(status, e.response?.headers)
                return res.status(429).json({ error: 'Binance-Rate-Limit erreicht. Bitte kurz warten.' })
            }
            // Binance antwortet auf ein unbekanntes Symbol mit 400 / Code -1121.
            const msg = e.response?.data?.msg || e.message
            if (status >= 500 || !e.response) logWarn('chart', `Kerzen ${quelle} ${symbol} ${interval}: ${msg}`)
            res.status(status >= 400 && status < 500 ? status : 502).json({ error: msg })
        }
    })

    /**
     * GET /api/chart/handelbar
     * Basiswährungen je Börse (Futures), damit die Symbolsuche zeigen kann, wo
     * ein Coin wirklich handelbar ist. `null` je Börse heisst UNBEKANNT (Liste
     * nicht abrufbar) — nicht „führt nichts".
     */
    app.get('/api/chart/handelbar', async (_req, res) => {
        try {
            const listen = await ladeListungen()
            const alsListe = (m) => (m?.futures ? [...m.futures] : null)
            res.json({
                bitunix: alsListe(listen.bitunix),
                bitget: alsListe(listen.bitget),
                pionex: alsListe(listen.pionex),
            })
        } catch (e) {
            res.status(502).json({ error: e.message })
        }
    })

    // ── Layouts ──────────────────────────────────────────────────────────
    app.get('/api/chart/layouts', async (_req, res) => {
        try {
            const zeilen = await getKnex()('chart_layouts').orderBy('id')
            res.json(zeilen.map(layoutZeile))
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    app.post('/api/chart/layouts', async (req, res) => {
        try {
            const daten = req.body?.daten && typeof req.body.daten === 'object' ? req.body.daten : {}
            const text = JSON.stringify(daten)
            if (text.length > MAX_LAYOUT_BYTES) return res.status(413).json({ error: 'Layout zu gross' })
            const knex = getKnex()
            const [zeile] = await knex('chart_layouts')
                .insert({ name: name(req.body?.name, 'Layout'), aktiv: 0, daten: text, geaendertAm: Date.now() })
                .returning('id')
            const id = typeof zeile === 'object' ? zeile.id : zeile
            if (req.body?.aktiv) {
                await knex('chart_layouts').update({ aktiv: 0 })
                await knex('chart_layouts').where('id', id).update({ aktiv: 1 })
            }
            res.json(layoutZeile(await knex('chart_layouts').where('id', id).first()))
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    app.put('/api/chart/layouts/:id', async (req, res) => {
        try {
            const id = Number(req.params.id)
            const knex = getKnex()
            const alt = await knex('chart_layouts').where('id', id).first()
            if (!alt) return res.status(404).json({ error: 'Layout nicht gefunden' })
            const patch = { geaendertAm: Date.now() }
            if (req.body?.name !== undefined) patch.name = name(req.body.name, alt.name)
            if (req.body?.daten !== undefined) {
                if (!req.body.daten || typeof req.body.daten !== 'object') return res.status(400).json({ error: 'daten muss ein Objekt sein' })
                const text = JSON.stringify(req.body.daten)
                if (text.length > MAX_LAYOUT_BYTES) return res.status(413).json({ error: 'Layout zu gross' })
                patch.daten = text
            }
            await knex('chart_layouts').where('id', id).update(patch)
            if (req.body?.aktiv) {
                await knex('chart_layouts').whereNot('id', id).update({ aktiv: 0 })
                await knex('chart_layouts').where('id', id).update({ aktiv: 1 })
            }
            res.json(layoutZeile(await knex('chart_layouts').where('id', id).first()))
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    app.delete('/api/chart/layouts/:id', async (req, res) => {
        try {
            await getKnex()('chart_layouts').where('id', Number(req.params.id)).del()
            res.json({ ok: true })
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    // ── Watchlists ───────────────────────────────────────────────────────
    app.get('/api/chart/watchlists', async (_req, res) => {
        try {
            const zeilen = await getKnex()('chart_watchlists').orderBy([{ column: 'reihenfolge' }, { column: 'id' }])
            res.json(zeilen.map(watchlistZeile))
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    app.post('/api/chart/watchlists', async (req, res) => {
        try {
            const knex = getKnex()
            const [zeile] = await knex('chart_watchlists').insert({
                name: name(req.body?.name, 'Watchlist'),
                symbole: JSON.stringify(saubereSymbole(req.body?.symbole)),
                reihenfolge: Number(req.body?.reihenfolge) || 0,
                geaendertAm: Date.now(),
            }).returning('id')
            const id = typeof zeile === 'object' ? zeile.id : zeile
            res.json(watchlistZeile(await knex('chart_watchlists').where('id', id).first()))
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    app.put('/api/chart/watchlists/:id', async (req, res) => {
        try {
            const id = Number(req.params.id)
            const knex = getKnex()
            const alt = await knex('chart_watchlists').where('id', id).first()
            if (!alt) return res.status(404).json({ error: 'Watchlist nicht gefunden' })
            const patch = { geaendertAm: Date.now() }
            if (req.body?.name !== undefined) patch.name = name(req.body.name, alt.name)
            if (req.body?.symbole !== undefined) patch.symbole = JSON.stringify(saubereSymbole(req.body.symbole))
            if (req.body?.reihenfolge !== undefined) patch.reihenfolge = Number(req.body.reihenfolge) || 0
            await knex('chart_watchlists').where('id', id).update(patch)
            res.json(watchlistZeile(await knex('chart_watchlists').where('id', id).first()))
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    app.delete('/api/chart/watchlists/:id', async (req, res) => {
        try {
            await getKnex()('chart_watchlists').where('id', Number(req.params.id)).del()
            res.json({ ok: true })
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    // ── Startkurse der Watchlist ─────────────────────────────────────────
    /*
     * GET /api/chart/ticker?markt=futures&symbole=BTCUSDT,ETHUSDT
     *
     * Die Watchlist bekommt ihre Kurse per miniTicker-Stream — bis zum ersten
     * Tick (und nach jeder Neuverbindung) stand dort „—". Je Symbol ein
     * 24h-Ticker (Gewicht 1; der Sammelabruf aller Symbole kostet 40), 10 s im
     * Speicher, damit mehrere offene Fenster nicht mehrfach fragen.
     */
    const tickerCache = new Map()     // markt|symbol → { zeit, wert }
    app.get('/api/chart/ticker', async (req, res) => {
        try {
            const markt = req.query.markt === 'spot' ? 'spot' : 'futures'
            const symbole = String(req.query.symbole || '').toUpperCase().split(',').filter((x) => SYMBOL_RE.test(x)).slice(0, 40)
            const basis = markt === 'spot' ? 'https://api.binance.com/api/v3/ticker/24hr' : 'https://fapi.binance.com/fapi/v1/ticker/24hr'
            const aus = {}
            await Promise.all(symbole.map(async (sym) => {
                const k = `${markt}|${sym}`
                const c = tickerCache.get(k)
                if (c && Date.now() - c.zeit < (c.fehlt ? 5 * 60_000 : 10_000)) { if (c.wert) aus[sym] = c.wert; return }
                // Während einer Binance-Strafe gar nicht erst fragen — jeder weitere Abruf verlängert sie.
                if (pausiertBis()) { if (c?.wert) aus[sym] = c.wert; return }
                try {
                    const antwort = await axios.get(basis, { params: { symbol: sym }, timeout: HTTP_TIMEOUT })
                    if (markt === 'futures') notiereGewicht(antwort.headers)
                    const data = antwort.data
                    // q = 24h-Umsatz in USDT — der Chart misst daran, ob eine Orderbuch-Wand gross ist
                    const wert = { c: Number(data.lastPrice), o: Number(data.openPrice), q: Number(data.quoteVolume) }
                    if (Number.isFinite(wert.c)) { tickerCache.set(k, { zeit: Date.now(), wert }); aus[sym] = wert }
                } catch (e) {
                    const st = e.response?.status
                    // NUR 429/418 sind eine Drosselung. melde429 setzt für jeden Status eine 30-s-Sperre
                    // aller Binance-Historienabrufe — ein delistetes Symbol in der Watchlist (400) legte
                    // so Coin-Radar und Ergebnis-Tracking still.
                    if (markt === 'futures' && (st === 429 || st === 418)) melde429(st, e.response.headers)
                    // Unbekanntes Symbol: 5 Minuten nicht wieder fragen (der Stream liefert es auch nicht).
                    else if (st === 400) tickerCache.set(k, { zeit: Date.now(), wert: null, fehlt: true })
                }
            }))
            res.json({ markt, kurse: aus })
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    // ── Indikator-Vorlagen ───────────────────────────────────────────────
    app.get('/api/chart/vorlagen', async (_req, res) => {
        try {
            const zeilen = await getKnex()('chart_vorlagen').orderBy([{ column: 'name' }, { column: 'id' }])
            res.json(zeilen.map(vorlageZeile))
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    app.post('/api/chart/vorlagen', async (req, res) => {
        try {
            const v = saubereVorlage(req.body?.indikatoren)
            if (!v.ok) return res.status(400).json({ error: v.fehler })
            const knex = getKnex()
            const [zeile] = await knex('chart_vorlagen').insert({
                name: name(req.body?.name, 'Vorlage'),
                indikatoren: JSON.stringify(v.indikatoren),
                geaendertAm: Date.now(),
            }).returning('id')
            const id = typeof zeile === 'object' ? zeile.id : zeile
            res.json(vorlageZeile(await knex('chart_vorlagen').where('id', id).first()))
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    app.put('/api/chart/vorlagen/:id', async (req, res) => {
        try {
            const id = Number(req.params.id)
            const knex = getKnex()
            const alt = await knex('chart_vorlagen').where('id', id).first()
            if (!alt) return res.status(404).json({ error: 'Vorlage nicht gefunden' })
            const patch = { geaendertAm: Date.now() }
            if (req.body?.name !== undefined) patch.name = name(req.body.name, alt.name)
            if (req.body?.indikatoren !== undefined) {
                const v = saubereVorlage(req.body.indikatoren)
                if (!v.ok) return res.status(400).json({ error: v.fehler })
                patch.indikatoren = JSON.stringify(v.indikatoren)
            }
            await knex('chart_vorlagen').where('id', id).update(patch)
            res.json(vorlageZeile(await knex('chart_vorlagen').where('id', id).first()))
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    app.delete('/api/chart/vorlagen/:id', async (req, res) => {
        try {
            await getKnex()('chart_vorlagen').where('id', Number(req.params.id)).del()
            res.json({ ok: true })
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    /**
     * GET /api/chart/journal?symbol=BTCUSDT&von=<ms>&bis=<ms>
     *
     * Eigene Trades des Symbols, deren Laufzeit den Zeitraum berührt, mit
     * Anfangs-Stop, R, Teil-Fills, SL/TP-Verlauf, Notizen und Tags. Die
     * Tageszeilen werden mit einer Woche Vorlauf gelesen: eine Zeile steht
     * unter dem Tag des Schliessens, ein Swing-Trade kann Tage davor begonnen
     * haben.
     */
    app.get('/api/chart/journal', async (req, res) => {
        try {
            const symbol = String(req.query.symbol || '').toUpperCase()
            if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'symbol ungültig' })
            const bis = Number(req.query.bis) || Date.now()
            const von = Number(req.query.von) || bis - 90 * 86_400_000
            if (!(von < bis)) return res.status(400).json({ error: 'von muss vor bis liegen' })
            const knex = getKnex()
            const zeilen = await knex('trades')
                .select('dateUnix', 'broker', 'trades')
                .where('dateUnix', '>=', Math.floor(von / 1000) - 7 * 86400)
                .where('dateUnix', '<=', Math.ceil(bis / 1000) + 86400)
            const trades = tradesAusZeilen(zeilen, symbol, von, bis)
            // Grosse Zeiträume (Wochenchart über Jahre) sollen den Browser nicht
            // mit Tausenden Markern fluten — die jüngsten zählen.
            const begrenzt = trades.slice(-500)
            const ids = begrenzt.map((t) => t.id)
            const notizen = []
            const tags = []
            for (let i = 0; i < ids.length; i += 400) {
                const stueck = ids.slice(i, i + 400)
                notizen.push(...await knex('notes')
                    .select('tradeId', 'note', 'entryNote', 'closingNote', 'playbook', 'timeframe', 'tradeType', 'strategyFollowed',
                        'screenshotId', 'trendScreenshotId', 'closingScreenshotId', 'tradingMetadata')
                    .whereIn('tradeId', stueck))
                tags.push(...await knex('tags').select('tradeId', 'tags', 'closingTags').whereIn('tradeId', stueck))
            }
            res.json({ symbol, von, bis, gekappt: trades.length > begrenzt.length, trades: mitNotizen(begrenzt, notizen, tags) })
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    /**
     * GET /api/chart/hebelzonen?symbol=
     * Dieselbe Verdichtung wie in der Handelslage — ein MODELL aus OI-Verlauf
     * und Kerzen, keine Messung (siehe `shared/leverageMap.js`). Zwischen-
     * gespeichert 2 min; die Rohpunkte teilen sich ohnehin den Cache der
     * Liquidationskarte.
     */
    app.get('/api/chart/hebelzonen', async (req, res) => {
        const symbol = String(req.query.symbol || '').toUpperCase()
        if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'symbol ungültig' })
        try {
            // `ausCache` verteilt die Antwort per Spread — deshalb verpackt,
            // sonst würde aus `null` ein leeres Objekt mit Zeitstempel.
            const { zonen, veraltet } = await ausCache(`chart_hebelzonen|${symbol}`, 2 * 60 * 1000,
                async () => ({ zonen: await holeHebelzonen(symbol) }))
            res.json({ symbol, zonen: zonen || null, veraltet: !!veraltet })
        } catch (e) { res.status(502).json({ error: e.message }) }
    })

    /**
     * GET /api/chart/funding?symbol=
     * Die letzten 180 Tage, 10 min zwischengespeichert. Der Satz bleibt
     * Rohwert je Zahlung; die Umrechnung auf 8 h macht der Browser mit dem
     * gemessenen Abstand der Zahlungen (31 von 50 Top-Perps zahlen 4-stündlich).
     */
    app.get('/api/chart/funding', async (req, res) => {
        const symbol = String(req.query.symbol || '').toUpperCase()
        if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'symbol ungültig' })
        try {
            const { punkte } = await ausCache(`chart_funding|${symbol}`, 10 * 60 * 1000,
                async () => ({ punkte: await getFundingHistory(symbol, Date.now() - 180 * 86_400_000, Date.now()) }))
            res.json({ symbol, punkte: punkte || [] })
        } catch (e) { res.status(502).json({ error: e.message }) }
    })

    // ── Zeichnungen ──────────────────────────────────────────────────────
    app.get('/api/chart/zeichnungen', async (req, res) => {
        try {
            const symbol = String(req.query.symbol || '').toUpperCase()
            let q = getKnex()('chart_zeichnungen').orderBy('id')
            if (symbol) {
                if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'symbol ungültig' })
                q = q.where('symbol', symbol)
            }
            res.json((await q).map(zeichnungZeile))
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    app.post('/api/chart/zeichnungen', async (req, res) => {
        try {
            const { fehler, daten } = pruefeZeichnung(req.body || {})
            if (fehler) return res.status(400).json({ error: fehler })
            const jetzt = Date.now()
            const knex = getKnex()
            const [zeile] = await knex('chart_zeichnungen')
                .insert({ stil: '{}', ...daten, erstelltAm: jetzt, geaendertAm: jetzt })
                .returning('id')
            const id = typeof zeile === 'object' ? zeile.id : zeile
            res.json(zeichnungZeile(await knex('chart_zeichnungen').where('id', id).first()))
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    app.put('/api/chart/zeichnungen/:id', async (req, res) => {
        try {
            const id = Number(req.params.id)
            const knex = getKnex()
            if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'id ungültig' })
            const alt = await knex('chart_zeichnungen').where('id', id).first()
            if (!alt) return res.status(404).json({ error: 'Zeichnung nicht gefunden' })
            // Typ und Symbol sind fest: ein Alarm auf dieser Linie prüft die Passung nur beim
            // Anlegen und rechnete danach mit einer Geometrie, die nicht mehr passt.
            const koerper = { ...(req.body || {}) }
            if (koerper.typ !== undefined && koerper.typ !== alt.typ) return res.status(400).json({ error: 'typ einer Zeichnung ist nicht änderbar' })
            if (koerper.symbol !== undefined && String(koerper.symbol).toUpperCase() !== alt.symbol) return res.status(400).json({ error: 'symbol einer Zeichnung ist nicht änderbar' })
            delete koerper.typ
            delete koerper.symbol
            const { fehler, daten } = pruefeZeichnung(koerper, { teilweise: true, typ: alt.typ })
            if (fehler) return res.status(400).json({ error: fehler })
            await knex('chart_zeichnungen').where('id', id).update({ ...daten, geaendertAm: Date.now() })
            res.json(zeichnungZeile(await knex('chart_zeichnungen').where('id', id).first()))
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    app.delete('/api/chart/zeichnungen/:id', async (req, res) => {
        try {
            const id = Number(req.params.id)
            const knex = getKnex()
            // Ein Alarm auf dieser Linie hätte danach keine Geometrie mehr —
            // er geht mit, statt still nie wieder auszulösen.
            await knex('chart_alarme').where('zeichnungId', id).del()
            await knex('chart_zeichnungen').where('id', id).del()
            res.json({ ok: true })
        } catch (e) { res.status(500).json({ error: e.message }) }
    })
}
