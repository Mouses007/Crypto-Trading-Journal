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
 *   CRUD /api/chart/zeichnungen  Linien, Zonen, Fibonacci … je Symbol
 */

import axios from 'axios'
import { getKnex } from './database.js'
import { notiereGewicht, melde429 } from './binance-takt.js'
import { ladeListungen } from './hype-radar/listungen.js'
import { logWarn } from './logger.js'

const SYMBOL_RE = /^[A-Z0-9]{2,20}$/
const HTTP_TIMEOUT = 10000

/** Binance-Zeiteinheiten; dieselbe Liste kennt das Frontend (`kerzenQuelle.js`). */
export const INTERVALLE = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']

/*
 * Quellen. Binance ist die Datenbasis (User-Entscheid 18.10.2026): tiefe
 * Historie, Websocket für die laufende Kerze. Bitunix und Bitget folgen als
 * wählbare REST-Quellen — sie haben öffentlich weniger Tiefe und keinen
 * angebundenen Websocket, und das wird im Kopf des Charts auch so gesagt.
 */
const QUELLEN = {
    'binance-futures': { basis: 'https://fapi.binance.com', pfad: '/fapi/v1/klines', max: 1500 },
    'binance-spot': { basis: 'https://api.binance.com', pfad: '/api/v3/klines', max: 1000 },
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
export function pruefeZeichnung(roh, { teilweise = false } = {}) {
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
        aus.punkte = JSON.stringify(punkte)
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
        punkte: parse(r.punkte, []), stil: parse(r.stil, {}),
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
            if (!(await knex('chart_zeichnungen').where('id', id).first())) return res.status(404).json({ error: 'Zeichnung nicht gefunden' })
            const { fehler, daten } = pruefeZeichnung(req.body || {}, { teilweise: true })
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
