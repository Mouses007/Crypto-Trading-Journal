/**
 * Strategie-Schicht im Chart-Arbeitsplatz.
 *
 *   GET  /api/chart/strategie?symbol=&von=&bis=   Instanzen, Setups, Positionen, Trades, Backtests des Symbols
 *   POST /api/chart/strategie/erkennen             detect() JETZT auf ein Symbol, OHNE zu speichern
 *   GET  /api/chart/strategie/backtest/:id         Trades eines gespeicherten Backtests
 *
 * Instanzen werden immer mit Strategie, Symbol und Zeiteinheit benannt — eine
 * nackte Nummer sagt im Chart niemandem etwas.
 *
 * `erkennen` ist bewusst ein eigener Weg neben der Engine: die Engine SPEICHERT
 * jedes neue Setup und kann daraus Positionen eröffnen. Hier soll nur
 * sichtbar werden, was die Strategie auf den aktuellen Kerzen sähe.
 */
import { getKnex } from './database.js'
import { getStrategy, validateParams } from './strategies/index.js'
import { ladeInstanz } from './strategy-engine.js'
import { getClosedCandles, isValidTimeframe } from './market-data.js'
import { overlaysFuer } from './strategies/overlays.js'
import { signalVerlauf, fensterFuer } from './chart-signale.js'
import { timeframeMs } from './market-data.js'

const SYMBOL_RE = /^[A-Z0-9]{2,20}$/
const MAX_KERZEN = 1500

/** PostgreSQL liefert bigint als Zeichenkette — im Chart muss es eine Zahl sein. */
const n = (v) => {
    if (v == null || v === '') return null
    const x = Number(v)
    return Number.isFinite(x) ? x : null
}

function parse(text, ersatz) {
    if (text == null || text === '') return ersatz
    if (typeof text === 'object') return text
    try { return JSON.parse(text) } catch { return ersatz }
}

function setupAus(r) {
    return {
        id: r.id, instanceId: n(r.instanceId), strategyId: r.strategyId, timeframe: r.timeframe,
        richtung: r.direction, status: r.status,
        sweepLevel: n(r.sweepLevel), sweepPrice: n(r.sweepPrice), sweepT: n(r.sweepCandleTime),
        obHoch: n(r.obHigh), obTief: n(r.obLow), obT: n(r.obCandleTime),
        einstieg: n(r.entry), stop: n(r.stopLoss), ziel: n(r.takeProfit), rr: n(r.rr),
        ausgeloestT: n(r.triggeredAt), grund: r.invalidReason || r.rejectReason || null,
        bestaetigung: parse(r.confirmations, {}),
    }
}

function positionAus(r) {
    return {
        id: r.id, instanceId: n(r.instanceId), timeframe: r.timeframe, modus: r.mode, richtung: r.direction,
        einstieg: n(r.entryPrice), einstiegT: n(r.entryTime), stop: n(r.stopLoss), anfangsStop: n(r.initialStopLoss),
        ziel: n(r.takeProfit), liq: n(r.liqPrice), status: r.status,
    }
}

function tradeAus(r) {
    return {
        id: r.id, instanceId: n(r.instanceId), timeframe: r.timeframe, modus: r.mode, richtung: r.direction,
        einstieg: { t: n(r.entryTime), p: n(r.entryPrice) },
        ausstieg: n(r.exitTime) ? { t: n(r.exitTime), p: n(r.exitPrice) } : null,
        stop: n(r.stopLoss), ziel: n(r.takeProfit), r: n(r.rMultiple), netto: n(r.netPnl), grund: r.exitReason || null,
    }
}

/** Setups, die eine Detektion liefert, in dieselbe Form wie gespeicherte bringen. */
function vorschauSetup(s, strategyId, timeframe) {
    return setupAus({
        id: null, instanceId: null, strategyId, timeframe,
        direction: s.direction, status: s.status,
        sweepLevel: s.sweepLevel, sweepPrice: s.sweepPrice, sweepCandleTime: s.sweepCandleTime,
        obHigh: s.obHigh, obLow: s.obLow, obCandleTime: s.obCandleTime,
        entry: s.entry, stopLoss: s.stopLoss, takeProfit: s.takeProfit, rr: s.rr,
        triggeredAt: s.triggeredAt, invalidReason: s.invalidReason, confirmations: s.confirmations,
    })
}

// Signalverlauf je Strategie+Symbol+Zeiteinheit+Markt: 60 s, gleichzeitige Abrufe geteilt —
// mehrere Panels und der 60-s-Takt fragen sonst jeder ~1000 Kerzen und rechnen neu.
const SIGNALE_TTL_MS = 60_000
const SIGNAL_STRATEGIEN = ['lsob', 'ema_touch']
const signalCache = new Map()   // schluessel → { t, daten } | { laeuft }

async function holeSignale(strategyId, symbol, timeframe, market) {
    const schluessel = `${strategyId}|${symbol}|${timeframe}|${market}`
    const c = signalCache.get(schluessel)
    if (c?.daten && Date.now() - c.t < SIGNALE_TTL_MS) return c.daten
    if (c?.laeuft) return c.laeuft
    const laeuft = (async () => {
        const strategie = getStrategy(strategyId)
        const params = validateParams(strategyId, {}).values
        const anzeigen = 500
        const candles = await getClosedCandles(symbol, timeframe, Math.min(MAX_KERZEN, fensterFuer(strategie, params) + anzeigen), { market })
        let htfCandles = null
        if (params.htfTrendFilter && params.htfTimeframe && params.htfTimeframe !== timeframe) {
            try { htfCandles = await getClosedCandles(symbol, params.htfTimeframe, 500, { market }) } catch { htfCandles = null }
        }
        const r = signalVerlauf({
            strategie, candles, params, htfCandles, anzeigen,
            ltfMs: timeframeMs(timeframe), htfMs: htfCandles ? timeframeMs(params.htfTimeframe) : 0,
        })
        return { strategyId, strategieName: strategie.name || strategyId, symbol, timeframe, ...r }
    })()
    signalCache.set(schluessel, { laeuft })
    try {
        const daten = await laeuft
        signalCache.set(schluessel, { t: Date.now(), daten })
        if (signalCache.size > 60) signalCache.delete(signalCache.keys().next().value)
        return daten
    } catch (e) { signalCache.delete(schluessel); throw e }
}

export function setupChartStrategieRoutes(app) {

    /**
     * GET /api/chart/signale?strategie=lsob|ema_touch&symbol=&interval=&markt=
     * Signalverlauf für die Chart-Indikatoren „LSOB" und „GUSS" (Standardparameter).
     */
    app.get('/api/chart/signale', async (req, res) => {
        try {
            const strategyId = String(req.query.strategie || '')
            if (!SIGNAL_STRATEGIEN.includes(strategyId)) return res.status(400).json({ error: 'strategie unbekannt' })
            const symbol = String(req.query.symbol || '').toUpperCase()
            if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'symbol ungültig' })
            const timeframe = String(req.query.interval || '')
            const strategie = getStrategy(strategyId)
            if (!strategie.supportedTimeframes.includes(timeframe)) {
                return res.status(400).json({ error: `${strategie.name || strategyId} läuft nur auf ${strategie.supportedTimeframes.join(', ')}` })
            }
            res.json(await holeSignale(strategyId, symbol, timeframe, req.query.markt === 'spot' ? 'spot' : 'futures'))
        } catch (e) {
            const st = e.response?.status || e.status
            if (st === 400 || /invalid symbol|-1121/i.test(String(e.response?.data?.msg || e.message))) {
                return res.status(400).json({ error: `${req.query.symbol || 'Symbol'} gibt es bei Binance nicht` })
            }
            res.status(500).json({ error: e.message })
        }
    })

    app.get('/api/chart/strategie', async (req, res) => {
        try {
            const symbol = String(req.query.symbol || '').toUpperCase()
            if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'symbol ungültig' })
            const bis = Number(req.query.bis) || Date.now()
            const von = Number(req.query.von) || bis - 90 * 86_400_000
            const knex = getKnex()

            // Instanzen, die dieses Symbol führen. `symbols` ist JSON-Text —
            // grob per LIKE vorfiltern, genau danach in JS.
            const roh = await knex('strategy_instances').where('symbols', 'like', `%${symbol}%`)
            const instanzen = roh
                .filter((r) => parse(r.symbols, []).map((s) => String(s).toUpperCase()).includes(symbol))
                .map((r) => {
                    const s = getStrategy(r.strategyId)
                    return {
                        id: r.id, strategyId: r.strategyId, strategieName: s?.name || r.strategyId,
                        name: r.name || null, modus: r.mode || 'paper', aktiv: Boolean(r.enabled),
                        timeframe: r.timeframe, timeframes: parse(r.timeframes, [r.timeframe]),
                    }
                })

            const [setups, positionen, trades, backtests] = await Promise.all([
                knex('strategy_setups').where('symbol', symbol)
                    .where((q) => q.whereBetween('obCandleTime', [von, bis]).orWhereBetween('triggeredAt', [von, bis]))
                    .orderBy('obCandleTime', 'desc').limit(500),
                knex('strategy_positions').where('symbol', symbol)
                    .where((q) => q.whereIn('status', ['open', 'closing']).orWhere('entryTime', '>=', von))
                    .orderBy('entryTime', 'desc').limit(200),
                knex('strategy_trades').where('symbol', symbol)
                    .where('exitTime', '>=', von).where('entryTime', '<=', bis)
                    .orderBy('entryTime', 'desc').limit(500),
                knex('strategy_backtests').where('symbol', symbol)
                    .select('id', 'strategyId', 'instanceId', 'label', 'timeframe', 'fromTs', 'toTs', 'stats', 'createdAt')
                    .orderBy('id', 'desc').limit(20),
            ])

            res.json({
                symbol, von, bis, instanzen,
                setups: setups.map(setupAus),
                positionen: positionen.map(positionAus),
                trades: trades.map(tradeAus),
                backtests: backtests.map((b) => {
                    const st = parse(b.stats, {})
                    return {
                        id: b.id, strategyId: b.strategyId, strategieName: getStrategy(b.strategyId)?.name || b.strategyId,
                        instanceId: n(b.instanceId), label: b.label || null, timeframe: b.timeframe,
                        von: n(b.fromTs), bis: n(b.toTs), erstelltAm: n(b.createdAt),
                        // Die Statistik führt den Erwartungswert je Trade, keine
                        // Summe — die Summe ist das, was man im Chart vergleicht.
                        anzahl: n(st.trades),
                        summeR: n(st.trades) != null && n(st.expectancyR) != null ? n(st.trades) * n(st.expectancyR) : null,
                        trefferquote: n(st.winRate),
                    }
                }),
            })
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    app.get('/api/chart/strategie/backtest/:id', async (req, res) => {
        try {
            const id = Number(req.params.id)
            if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'ungültige id' })
            const b = await getKnex()('strategy_backtests').where('id', id).first()
            if (!b) return res.status(404).json({ error: 'Backtest nicht gefunden' })
            const trades = parse(b.trades, []).map((t) => ({
                richtung: t.direction || t.richtung,
                einstieg: { t: n(t.entryTime), p: n(t.entryPrice) },
                ausstieg: n(t.exitTime) ? { t: n(t.exitTime), p: n(t.exitPrice) } : null,
                stop: n(t.stopLoss), ziel: n(t.takeProfit), r: n(t.rMultiple ?? t.r), grund: t.exitReason || null,
            })).filter((t) => t.einstieg.t && t.einstieg.p)
            res.json({ id: b.id, symbol: b.symbol, timeframe: b.timeframe, strategyId: b.strategyId, trades })
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    /**
     * POST { instanceId } oder { strategyId, params? } — dazu symbol, timeframe, market.
     * Mit Instanz gelten deren Parameter; ohne die Vorgaben der Strategie.
     */
    app.post('/api/chart/strategie/erkennen', async (req, res) => {
        try {
            const symbol = String(req.body?.symbol || '').toUpperCase()
            if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'symbol ungültig' })
            const timeframe = String(req.body?.timeframe || '')
            if (!isValidTimeframe(timeframe)) return res.status(400).json({ error: `Zeiteinheit ${timeframe} wird von der Strategie-Schicht nicht unterstützt` })
            const market = req.body?.market === 'spot' ? 'spot' : 'futures'

            let strategie, params, quelle
            if (req.body?.instanceId) {
                const row = await getKnex()('strategy_instances').where('id', Number(req.body.instanceId)).first()
                const inst = row && ladeInstanz(row)
                if (!inst) return res.status(404).json({ error: 'Instanz nicht gefunden oder ungültig' })
                strategie = inst.strategie
                params = inst.params
                quelle = { instanceId: inst.id, name: inst.name }
            } else {
                strategie = getStrategy(String(req.body?.strategyId || ''))
                if (!strategie) return res.status(404).json({ error: 'Strategie unbekannt' })
                params = validateParams(strategie.id, req.body?.params || {}).values
                quelle = { strategyId: strategie.id }
            }
            if (!strategie.supportedTimeframes.includes(timeframe)) {
                return res.status(400).json({ error: `${strategie.name || strategie.id} läuft nicht auf ${timeframe}`, unterstuetzt: strategie.supportedTimeframes })
            }

            // Derselbe Kerzenbedarf wie in der Engine — ein kürzeres Fenster
            // fände weniger Zonen und zeigte eine andere Strategie.
            const bedarf = Math.min(MAX_KERZEN,
                (strategie.warmupCandles || 200) + (params.scanWindowCandles || 200) + (params.retestMaxCandles || 40) + 10)
            const candles = await getClosedCandles(symbol, timeframe, bedarf, { market })
            let htfCandles = null
            if (params.htfTrendFilter && params.htfTimeframe && params.htfTimeframe !== timeframe) {
                const htfBedarf = Math.min(MAX_KERZEN, Math.max((params.htfEmaPeriod || 50) + 20, (params.zonenFensterHtf || 0) + 20))
                try { htfCandles = await getClosedCandles(symbol, params.htfTimeframe, htfBedarf, { market }) } catch { htfCandles = null }
            }

            const { setups, diagnostics } = strategie.detect({
                candles, params, openSetups: [], knownSetupKeys: [], htfCandles, historieVerkuerzt: true,
            })
            res.json({
                quelle, symbol, timeframe, strategyId: strategie.id, strategieName: strategie.name || strategie.id,
                kerzen: candles.length, von: candles[0]?.t ?? null, bis: candles[candles.length - 1]?.t ?? null,
                setups: (setups || []).map((s) => vorschauSetup(s, strategie.id, timeframe)),
                gefunden: diagnostics?.sweepsFound ?? null,
                verworfen: diagnostics?.rejected || {},
                overlays: overlaysFuer(strategie.id, { candles, params, htfCandles }),
            })
        } catch (e) {
            // Ein Symbol, das Binance nicht führt (400 / -1121), ist ein Eingabefehler, kein Serverfehler.
            const st = e.response?.status || e.status
            if (st === 400 || /invalid symbol|-1121/i.test(String(e.response?.data?.msg || e.message))) {
                return res.status(400).json({ error: `${req.body?.symbol || 'Symbol'} gibt es bei Binance nicht` })
            }
            res.status(500).json({ error: e.message })
        }
    })
}
