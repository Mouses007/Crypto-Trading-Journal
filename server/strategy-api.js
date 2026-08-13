/**
 * HTTP-Schnittstelle der Strategie-Agenten.
 *
 * Schreibende Zugriffe laufen ausschliesslich hier durch — die generische
 * `/api/db/:table`-Route ist für die `strategy_*`-Tabellen auf Lesen begrenzt
 * (siehe READ_ONLY_TABLES in api-routes.js). Nur so ist sichergestellt, dass
 * Parameter gegen das Manifest-Schema validiert werden und `paramsVersion`
 * gepflegt bleibt — beides ist Voraussetzung dafür, dass die Auswertung
 * Ergebnisse überhaupt einem Parametersatz zuordnen kann.
 */

import { getKnex } from './database.js'
import { logError } from './logger.js'
import {
    listStrategies, getStrategy, validateParams, validateRisk,
    defaultsFromSchema, RISK_PARAMS, AGENT_DEFAULTS,
    ladeRegelStrategien, istEingebaut,
} from './strategies/index.js'
import { BAUSTEINE } from './strategies/rule-engine.js'
import { pruefeRegeln } from './strategies/rule-validate.js'
import { VORLAGEN } from './strategies/rule-templates.js'
import { isValidTimeframe, timeframeMs, getLastPrice } from './market-data.js'
import { runBacktest, berechneStatistik, MAX_BACKTEST_CANDLES, schaetzeKerzen } from './strategy-backtest.js'
import { engineStatus, resetSymbolCache, killSwitch, ladeInstanz, tick } from './strategy-engine.js'
import { closePaperPositionManually } from './execution/paper.js'

const MAX_SYMBOLS = 20
const SYMBOL_RE = /^[A-Z0-9]{2,20}$/

function parseJson(wert, fallback) {
    if (wert === null || wert === undefined) return fallback
    if (typeof wert === 'object') return wert
    try { return JSON.parse(wert) } catch { return fallback }
}

/** DB-Zeile → API-Form (JSON geparst, objectId wie überall im Projekt). */
function instanzNachAussen(row) {
    return {
        ...row,
        objectId: String(row.id),
        enabled: Boolean(row.enabled),
        symbols: parseJson(row.symbols, []),
        params: parseJson(row.params, {}),
        risk: parseJson(row.risk, {}),
        agents: parseJson(row.agents, {}),
    }
}

/** Gemeinsame Prüfung für Anlegen und Ändern. */
function pruefeInstanzEingabe(body, vorhanden = null) {
    const fehler = []
    const strategyId = String(body.strategyId || vorhanden?.strategyId || '')
    const strategie = getStrategy(strategyId)
    if (!strategie) fehler.push(`Unbekannte Strategie: ${strategyId}`)

    const timeframe = String(body.timeframe || vorhanden?.timeframe || '')
    if (!isValidTimeframe(timeframe)) fehler.push(`Ungültige Zeiteinheit: ${timeframe}`)
    else if (strategie && !strategie.supportedTimeframes.includes(timeframe)) {
        fehler.push(`${strategie.name} unterstützt ${timeframe} nicht`)
    }

    const rohSymbols = body.symbols !== undefined
        ? body.symbols
        : parseJson(vorhanden?.symbols, [])
    const symbols = (Array.isArray(rohSymbols) ? rohSymbols : [])
        .map((s) => String(s).toUpperCase().trim())
        .filter((s) => SYMBOL_RE.test(s))
        .slice(0, MAX_SYMBOLS)
    if (!symbols.length) fehler.push('Mindestens ein gültiges Symbol angeben')

    const mode = ['paper', 'shadow', 'live'].includes(body.mode) ? body.mode : (vorhanden?.mode || 'paper')

    if (fehler.length) return { fehler }

    const params = validateParams(strategyId, {
        ...parseJson(vorhanden?.params, {}),
        ...(body.params || {}),
    })
    const risk = validateRisk({
        ...parseJson(vorhanden?.risk, {}),
        ...(body.risk || {}),
    })
    if (params.errors.length || risk.errors.length) {
        return { fehler: [...params.errors, ...risk.errors] }
    }

    return {
        werte: {
            strategyId,
            name: String(body.name ?? vorhanden?.name ?? strategie.name).slice(0, 120),
            mode,
            broker: String(body.broker || vorhanden?.broker || 'bitunix'),
            market: body.market === 'spot' ? 'spot' : (vorhanden?.market || 'futures'),
            timeframe,
            symbols: JSON.stringify(symbols),
            params: JSON.stringify(params.values),
            risk: JSON.stringify(risk.values),
            agents: JSON.stringify({ ...AGENT_DEFAULTS, ...parseJson(vorhanden?.agents, {}), ...(body.agents || {}) }),
        },
        hinweise: [...params.clamped, ...risk.clamped],
        neueParams: params.values,
    }
}

export function setupStrategyRoutes(app) {

    // ── Registry: Manifeste treiben das gesamte Frontend-Formular ────────
    app.get('/api/strategies/registry', (req, res) => {
        res.json({
            strategies: listStrategies().map((s) => ({ ...s, eingebaut: istEingebaut(s.id) })),
            riskParams: RISK_PARAMS,
            riskDefaults: defaultsFromSchema(RISK_PARAMS),
            agentDefaults: AGENT_DEFAULTS,
            modes: ['paper', 'shadow', 'live'],
            bausteine: BAUSTEINE,
        })
    })

    // ── Instanzen ────────────────────────────────────────────────────────
    app.get('/api/strategies/instances', async (req, res) => {
        try {
            const knex = getKnex()
            const rows = await knex('strategy_instances').orderBy('id', 'desc')

            // Kennzahlen je Instanz gleich mitliefern — die Übersicht soll ohne
            // n weitere Abrufe auskommen.
            const [offen, summen] = await Promise.all([
                knex('strategy_positions').where('status', 'open')
                    .select('instanceId').count({ n: '*' }).groupBy('instanceId'),
                knex('strategy_trades')
                    .select('instanceId').count({ n: '*' }).sum({ pnl: 'netPnl' })
                    .groupBy('instanceId'),
            ])
            const offenMap = Object.fromEntries(offen.map((r) => [r.instanceId, Number(r.n)]))
            const summeMap = Object.fromEntries(summen.map((r) => [r.instanceId, r]))

            res.json(rows.map((r) => ({
                ...instanzNachAussen(r),
                openPositions: offenMap[r.id] || 0,
                totalTrades: Number(summeMap[r.id]?.n) || 0,
                totalNetPnl: Number(summeMap[r.id]?.pnl) || 0,
            })))
        } catch (e) {
            logError('strategy-api', 'Instanzen laden fehlgeschlagen', e)
            res.status(500).json({ error: 'Instanzen konnten nicht geladen werden' })
        }
    })

    app.post('/api/strategies/instances', async (req, res) => {
        try {
            const strategie = getStrategy(req.body?.strategyId)
            if (!strategie) return res.status(400).json({ error: 'Unbekannte Strategie' })

            // Defaults aus dem Manifest, damit eine neue Instanz sofort läuft
            const body = {
                ...req.body,
                params: { ...defaultsFromSchema(strategie.params), ...(req.body.params || {}) },
                risk: { ...defaultsFromSchema(RISK_PARAMS), ...(req.body.risk || {}) },
            }
            const geprueft = pruefeInstanzEingabe(body)
            if (geprueft.fehler) return res.status(400).json({ error: geprueft.fehler.join('; ') })

            const knex = getKnex()
            const isPg = knex.client.config.client === 'pg'
            const datensatz = { ...geprueft.werte, enabled: 0, paramsVersion: 1 }
            const id = isPg
                ? (await knex('strategy_instances').insert(datensatz).returning('id'))[0]?.id
                : (await knex('strategy_instances').insert(datensatz))[0]

            const row = await knex('strategy_instances').where('id', id).first()
            res.status(201).json({ ...instanzNachAussen(row), hinweise: geprueft.hinweise })
        } catch (e) {
            logError('strategy-api', 'Instanz anlegen fehlgeschlagen', e)
            res.status(500).json({ error: 'Instanz konnte nicht angelegt werden' })
        }
    })

    app.put('/api/strategies/instances/:id', async (req, res) => {
        try {
            const knex = getKnex()
            const vorhanden = await knex('strategy_instances').where('id', req.params.id).first()
            if (!vorhanden) return res.status(404).json({ error: 'Instanz nicht gefunden' })

            const geprueft = pruefeInstanzEingabe(req.body || {}, vorhanden)
            if (geprueft.fehler) return res.status(400).json({ error: geprueft.fehler.join('; ') })

            // Jede Parameteränderung erhöht die Version. Nur so lassen sich
            // Ergebnisse später einem konkreten Parametersatz zuordnen (A/B).
            const paramsGeaendert = geprueft.werte.params !== vorhanden.params
                || geprueft.werte.risk !== vorhanden.risk
            const aktualisierung = {
                ...geprueft.werte,
                updatedAt: knex.fn.now(),
            }
            if (paramsGeaendert) aktualisierung.paramsVersion = (Number(vorhanden.paramsVersion) || 1) + 1

            // Betriebsart-Wechsel auf live setzt die Freigabe zurück
            if (geprueft.werte.mode === 'live' && vorhanden.mode !== 'live') {
                aktualisierung.liveApprovedAt = 0
            }

            await knex('strategy_instances').where('id', req.params.id).update(aktualisierung)
            resetSymbolCache(Number(req.params.id))   // sofort neu auswerten

            const row = await knex('strategy_instances').where('id', req.params.id).first()
            res.json({
                ...instanzNachAussen(row),
                hinweise: geprueft.hinweise,
                paramsVersionErhoeht: paramsGeaendert,
            })
        } catch (e) {
            logError('strategy-api', 'Instanz ändern fehlgeschlagen', e)
            res.status(500).json({ error: 'Instanz konnte nicht geändert werden' })
        }
    })

    app.delete('/api/strategies/instances/:id', async (req, res) => {
        try {
            const knex = getKnex()
            const id = Number(req.params.id)
            const offen = await knex('strategy_positions')
                .where({ instanceId: id, status: 'open' }).count({ n: '*' }).first()
            if (Number(offen?.n) > 0) {
                return res.status(409).json({ error: 'Instanz hat offene Positionen — erst schliessen' })
            }
            await knex('strategy_instances').where('id', id).delete()
            resetSymbolCache(id)
            res.json({ ok: true })
        } catch (e) {
            logError('strategy-api', 'Instanz löschen fehlgeschlagen', e)
            res.status(500).json({ error: 'Instanz konnte nicht gelöscht werden' })
        }
    })

    /** Start/Stop einer Instanz. */
    app.post('/api/strategies/instances/:id/enabled', async (req, res) => {
        try {
            const knex = getKnex()
            const id = Number(req.params.id)
            const row = await knex('strategy_instances').where('id', id).first()
            if (!row) return res.status(404).json({ error: 'Instanz nicht gefunden' })

            const an = Boolean(req.body?.enabled)
            if (an) {
                const instance = ladeInstanz(row)
                if (!instance) return res.status(400).json({ error: 'Instanz ist nicht lauffähig (Strategie/Zeiteinheit prüfen)' })
                if (instance.mode === 'live') {
                    const s = await knex('settings').select('strategyLiveEnabled').where('id', 1).first()
                    if (!s?.strategyLiveEnabled) {
                        return res.status(409).json({ error: 'Live ist global nicht freigegeben (Einstellungen)' })
                    }
                    if (!row.liveApprovedAt) {
                        return res.status(409).json({ error: 'Diese Instanz ist für Live nicht freigegeben' })
                    }
                }
                // Not-Aus aufheben, sonst startet nichts
                await knex('settings').where('id', 1).update({ strategyKillSwitch: 0 })
            }

            await knex('strategy_instances').where('id', id)
                .update({ enabled: an ? 1 : 0, lastError: '', updatedAt: knex.fn.now() })
            resetSymbolCache(id)
            res.json({ ok: true, enabled: an })
        } catch (e) {
            logError('strategy-api', 'Start/Stop fehlgeschlagen', e)
            res.status(500).json({ error: 'Status konnte nicht geändert werden' })
        }
    })

    /**
     * Live-Freigabe je Instanz. Verlangt den ausgeschriebenen Instanznamen als
     * Bestätigung — ein versehentlicher Klick reicht damit nicht aus.
     */
    app.post('/api/strategies/instances/:id/approve-live', async (req, res) => {
        try {
            const knex = getKnex()
            const row = await knex('strategy_instances').where('id', req.params.id).first()
            if (!row) return res.status(404).json({ error: 'Instanz nicht gefunden' })

            if (String(req.body?.confirm || '').trim() !== row.name) {
                return res.status(400).json({ error: 'Zur Bestätigung den Namen der Instanz exakt eingeben' })
            }
            const s = await knex('settings').select('strategyLiveEnabled').where('id', 1).first()
            if (!s?.strategyLiveEnabled) {
                return res.status(409).json({ error: 'Live ist global nicht freigegeben (Einstellungen)' })
            }

            await knex('strategy_instances').where('id', row.id)
                .update({ liveApprovedAt: Date.now(), updatedAt: knex.fn.now() })
            res.json({ ok: true })
        } catch (e) {
            logError('strategy-api', 'Live-Freigabe fehlgeschlagen', e)
            res.status(500).json({ error: 'Freigabe fehlgeschlagen' })
        }
    })

    // ── Backtest ─────────────────────────────────────────────────────────
    app.post('/api/strategies/backtest', async (req, res) => {
        try {
            const b = req.body || {}
            const strategie = getStrategy(b.strategyId)
            if (!strategie) return res.status(400).json({ error: 'Unbekannte Strategie' })

            const symbol = String(b.symbol || '').toUpperCase()
            if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Ungültiges Symbol' })
            if (!isValidTimeframe(b.timeframe)) return res.status(400).json({ error: 'Ungültige Zeiteinheit' })

            const toTs = Number(b.toTs) || Date.now()
            const fromTs = Number(b.fromTs) || (toTs - 90 * 86400000)
            if (fromTs >= toTs) return res.status(400).json({ error: 'Zeitraum ist leer' })

            const geschaetzt = schaetzeKerzen(fromTs, toTs, b.timeframe)
            if (geschaetzt > MAX_BACKTEST_CANDLES) {
                return res.status(400).json({
                    error: `Zeitraum zu gross: ~${geschaetzt} Kerzen, erlaubt sind ${MAX_BACKTEST_CANDLES}`,
                })
            }

            const ergebnis = await runBacktest({
                strategyId: b.strategyId,
                params: b.params || {},
                risk: b.risk || {},
                symbol, timeframe: b.timeframe,
                market: b.market === 'spot' ? 'spot' : 'futures',
                fromTs, toTs,
                startEquity: Number(b.startEquity) || 1000,
            })

            // Ergebnis sichern, damit ein Optimizer-Vorschlag darauf zeigen kann
            let backtestId = 0
            if (b.save !== false && ergebnis.trades.length >= 0) {
                const knex = getKnex()
                const isPg = knex.client.config.client === 'pg'
                const datensatz = {
                    strategyId: b.strategyId,
                    instanceId: Number(b.instanceId) || 0,
                    label: String(b.label || '').slice(0, 120),
                    symbol, timeframe: b.timeframe,
                    market: b.market === 'spot' ? 'spot' : 'futures',
                    fromTs, toTs,
                    params: JSON.stringify(ergebnis.meta?.params || {}),
                    stats: JSON.stringify({ ...ergebnis.stats, funnel: ergebnis.funnel }),
                    trades: JSON.stringify(ergebnis.trades.slice(0, 500)),
                }
                backtestId = isPg
                    ? (await knex('strategy_backtests').insert(datensatz).returning('id'))[0]?.id
                    : (await knex('strategy_backtests').insert(datensatz))[0]
            }

            res.json({ ...ergebnis, backtestId })
        } catch (e) {
            logError('strategy-api', 'Backtest fehlgeschlagen', e)
            res.status(500).json({ error: `Backtest fehlgeschlagen: ${e.message}` })
        }
    })

    app.get('/api/strategies/backtests', async (req, res) => {
        try {
            const knex = getKnex()
            let q = knex('strategy_backtests')
                .select('id', 'strategyId', 'instanceId', 'label', 'symbol', 'timeframe', 'fromTs', 'toTs', 'stats', 'createdAt')
                .orderBy('id', 'desc').limit(Math.min(Number(req.query.limit) || 50, 200))
            if (req.query.instanceId) q = q.where('instanceId', Number(req.query.instanceId))
            const rows = await q
            res.json(rows.map((r) => ({ ...r, objectId: String(r.id), stats: parseJson(r.stats, {}) })))
        } catch (e) {
            logError('strategy-api', 'Backtests laden fehlgeschlagen', e)
            res.status(500).json({ error: 'Backtests konnten nicht geladen werden' })
        }
    })

    /** Einzelnen Backtest löschen. */
    app.delete('/api/strategies/backtests/:id', async (req, res) => {
        try {
            const knex = getKnex()
            const n = await knex('strategy_backtests').where('id', req.params.id).delete()
            if (!n) return res.status(404).json({ error: 'Nicht gefunden' })
            res.json({ ok: true })
        } catch (e) {
            logError('strategy-api', 'Backtest löschen fehlgeschlagen', e)
            res.status(500).json({ error: 'Backtest konnte nicht gelöscht werden' })
        }
    })

    /**
     * Mehrere Backtests auf einmal löschen — optional auf eine Instanz begrenzt.
     * Ohne Filter wird alles gelöscht; das verlangt `confirm: true`, damit ein
     * versehentlicher Aufruf nicht die gesamte Vergleichsbasis wegräumt.
     */
    app.delete('/api/strategies/backtests', async (req, res) => {
        try {
            const knex = getKnex()
            let q = knex('strategy_backtests')
            if (req.query.instanceId) q = q.where('instanceId', Number(req.query.instanceId))
            else if (req.query.confirm !== 'true') {
                return res.status(400).json({ error: 'Zum Löschen aller Läufe confirm=true angeben' })
            }
            const n = await q.delete()
            res.json({ ok: true, geloescht: n })
        } catch (e) {
            logError('strategy-api', 'Backtests löschen fehlgeschlagen', e)
            res.status(500).json({ error: 'Backtests konnten nicht gelöscht werden' })
        }
    })

    app.get('/api/strategies/backtests/:id', async (req, res) => {
        try {
            const knex = getKnex()
            const row = await knex('strategy_backtests').where('id', req.params.id).first()
            if (!row) return res.status(404).json({ error: 'Nicht gefunden' })
            res.json({
                ...row, objectId: String(row.id),
                params: parseJson(row.params, {}),
                stats: parseJson(row.stats, {}),
                trades: parseJson(row.trades, []),
            })
        } catch (e) {
            res.status(500).json({ error: 'Backtest konnte nicht geladen werden' })
        }
    })

    // ── Auswertung ───────────────────────────────────────────────────────
    app.get('/api/strategies/performance', async (req, res) => {
        try {
            res.json(await ladePerformance(req.query))
        } catch (e) {
            logError('strategy-api', 'Auswertung fehlgeschlagen', e)
            res.status(500).json({ error: 'Auswertung konnte nicht geladen werden' })
        }
    })

    // ── Setups ───────────────────────────────────────────────────────────
    app.get('/api/strategies/setups', async (req, res) => {
        try {
            const knex = getKnex()
            let q = knex('strategy_setups').orderBy('id', 'desc')
                .limit(Math.min(Number(req.query.limit) || 100, 500))
            if (req.query.instanceId) q = q.where('instanceId', Number(req.query.instanceId))
            if (req.query.symbol) q = q.where('symbol', String(req.query.symbol).toUpperCase())
            if (req.query.status) q = q.whereIn('status', String(req.query.status).split(','))
            const rows = await q
            res.json(rows.map((r) => ({
                ...r, objectId: String(r.id), confirmations: parseJson(r.confirmations, {}),
            })))
        } catch (e) {
            res.status(500).json({ error: 'Setups konnten nicht geladen werden' })
        }
    })

    // ── Positionen ───────────────────────────────────────────────────────
    app.post('/api/strategies/positions/:id/close', async (req, res) => {
        try {
            const knex = getKnex()
            const row = await knex('strategy_positions').where('id', req.params.id).first()
            if (!row) return res.status(404).json({ error: 'Position nicht gefunden' })
            if (row.status !== 'open') return res.status(409).json({ error: 'Position ist bereits geschlossen' })

            const instRow = await knex('strategy_instances').where('id', row.instanceId).first()
            const instance = ladeInstanz(instRow)
            if (!instance) return res.status(400).json({ error: 'Instanz ist nicht lauffähig' })

            const preis = Number(req.body?.price)
                || await getLastPrice(row.symbol, { market: instance.market }).catch(() => Number(row.entryPrice))

            const trade = await closePaperPositionManually({
                instance, positionRow: row, price: preis, time: Date.now(),
                costs: { feeBps: instance.risk.feeBps, slippageBps: instance.risk.slippageBps },
            })
            res.json({ ok: true, trade })
        } catch (e) {
            logError('strategy-api', 'Position schliessen fehlgeschlagen', e)
            res.status(500).json({ error: 'Position konnte nicht geschlossen werden' })
        }
    })

    // ── Vorschläge (Optimizer) ───────────────────────────────────────────
    app.get('/api/strategies/suggestions', async (req, res) => {
        try {
            const knex = getKnex()
            let q = knex('strategy_suggestions').orderBy('id', 'desc').limit(100)
            if (req.query.instanceId) q = q.where('instanceId', Number(req.query.instanceId))
            if (req.query.status) q = q.where('status', String(req.query.status))
            const rows = await q
            res.json(rows.map((r) => ({
                ...r, objectId: String(r.id), proposedParams: parseJson(r.proposedParams, {}),
            })))
        } catch (e) {
            res.status(500).json({ error: 'Vorschläge konnten nicht geladen werden' })
        }
    })

    /**
     * Vorschlag annehmen. Erst hier werden die Parameter übernommen — ein Agent
     * kann sie nie selbst setzen, er kann sie nur vorschlagen.
     */
    app.post('/api/strategies/suggestions/:id/accept', async (req, res) => {
        try {
            const knex = getKnex()
            const vorschlag = await knex('strategy_suggestions').where('id', req.params.id).first()
            if (!vorschlag) return res.status(404).json({ error: 'Vorschlag nicht gefunden' })
            if (vorschlag.status !== 'pending') return res.status(409).json({ error: 'Vorschlag ist bereits entschieden' })

            const instanz = await knex('strategy_instances').where('id', vorschlag.instanceId).first()
            if (!instanz) return res.status(404).json({ error: 'Instanz nicht gefunden' })

            const vorgeschlagen = parseJson(vorschlag.proposedParams, {})
            const geprueft = pruefeInstanzEingabe({ params: vorgeschlagen }, instanz)
            if (geprueft.fehler) return res.status(400).json({ error: geprueft.fehler.join('; ') })

            await knex.transaction(async (trx) => {
                await trx('strategy_instances').where('id', instanz.id).update({
                    params: geprueft.werte.params,
                    paramsVersion: (Number(instanz.paramsVersion) || 1) + 1,
                    updatedAt: trx.fn.now(),
                })
                await trx('strategy_suggestions').where('id', vorschlag.id).update({
                    status: 'accepted', decidedAt: Date.now(),
                })
            })
            resetSymbolCache(instanz.id)
            res.json({ ok: true, paramsVersion: (Number(instanz.paramsVersion) || 1) + 1 })
        } catch (e) {
            logError('strategy-api', 'Vorschlag annehmen fehlgeschlagen', e)
            res.status(500).json({ error: 'Vorschlag konnte nicht übernommen werden' })
        }
    })

    app.post('/api/strategies/suggestions/:id/reject', async (req, res) => {
        try {
            const knex = getKnex()
            const n = await knex('strategy_suggestions')
                .where({ id: req.params.id, status: 'pending' })
                .update({ status: 'rejected', decidedAt: Date.now() })
            if (!n) return res.status(404).json({ error: 'Vorschlag nicht gefunden oder bereits entschieden' })
            res.json({ ok: true })
        } catch (e) {
            res.status(500).json({ error: 'Vorschlag konnte nicht verworfen werden' })
        }
    })

    // ── Eigene Regelstrategien ───────────────────────────────────────────

    /** Bausteine und Vorlagen für den Editor. */
    app.get('/api/strategies/rules/blocks', (req, res) => {
        res.json({ bausteine: BAUSTEINE, vorlagen: VORLAGEN })
    })

    app.get('/api/strategies/rules', async (req, res) => {
        try {
            const rows = await getKnex()('rule_strategies').orderBy('id', 'desc')
            res.json(rows.map((r) => ({
                ...r, objectId: String(r.id), enabled: Boolean(r.enabled),
                rules: parseJson(r.rules, {}),
                geladen: Boolean(getStrategy(r.strategyId)),
            })))
        } catch (e) {
            logError('strategy-api', 'Regelstrategien laden fehlgeschlagen', e)
            res.status(500).json({ error: 'Regelstrategien konnten nicht geladen werden' })
        }
    })

    /** Prüft eine Beschreibung, ohne sie zu speichern — für die Live-Rückmeldung im Editor. */
    app.post('/api/strategies/rules/validate', (req, res) => {
        const g = pruefeRegeln(req.body?.rules || {})
        res.json({ ok: g.ok, fehler: g.fehler, hinweise: g.hinweise, regeln: g.regeln })
    })

    app.post('/api/strategies/rules', async (req, res) => {
        try {
            const knex = getKnex()
            const b = req.body || {}
            const strategyId = String(b.strategyId || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40)
            if (istEingebaut(strategyId)) {
                return res.status(409).json({ error: 'Dieser Name gehört einer eingebauten Strategie' })
            }
            const g = pruefeRegeln({ ...(b.rules || {}), id: strategyId, name: b.name, description: b.description })
            if (!g.ok) return res.status(400).json({ error: g.fehler.join('; '), fehler: g.fehler })

            const isPg = knex.client.config.client === 'pg'
            const datensatz = {
                strategyId, name: g.regeln.name, description: g.regeln.description,
                enabled: 1, rules: JSON.stringify(g.regeln), source: 'user',
            }
            let id
            try {
                id = isPg
                    ? (await knex('rule_strategies').insert(datensatz).returning('id'))[0]?.id
                    : (await knex('rule_strategies').insert(datensatz))[0]
            } catch (e) {
                if (/unique|constraint/i.test(e.message)) {
                    return res.status(409).json({ error: 'Eine Strategie mit diesem Namen existiert bereits' })
                }
                throw e
            }
            await ladeAlleRegelStrategien()
            res.status(201).json({ id, strategyId, hinweise: g.hinweise })
        } catch (e) {
            logError('strategy-api', 'Regelstrategie anlegen fehlgeschlagen', e)
            res.status(500).json({ error: 'Regelstrategie konnte nicht angelegt werden' })
        }
    })

    app.put('/api/strategies/rules/:id', async (req, res) => {
        try {
            const knex = getKnex()
            const row = await knex('rule_strategies').where('id', req.params.id).first()
            if (!row) return res.status(404).json({ error: 'Nicht gefunden' })

            const b = req.body || {}
            const g = pruefeRegeln({
                ...(b.rules || parseJson(row.rules, {})),
                id: row.strategyId,
                name: b.name ?? row.name,
                description: b.description ?? row.description,
            })
            if (!g.ok) return res.status(400).json({ error: g.fehler.join('; '), fehler: g.fehler })

            await knex('rule_strategies').where('id', row.id).update({
                name: g.regeln.name, description: g.regeln.description,
                enabled: b.enabled === undefined ? row.enabled : (b.enabled ? 1 : 0),
                rules: JSON.stringify(g.regeln), updatedAt: knex.fn.now(),
            })
            await ladeAlleRegelStrategien()
            res.json({ ok: true, hinweise: g.hinweise })
        } catch (e) {
            logError('strategy-api', 'Regelstrategie ändern fehlgeschlagen', e)
            res.status(500).json({ error: 'Regelstrategie konnte nicht geändert werden' })
        }
    })

    app.delete('/api/strategies/rules/:id', async (req, res) => {
        try {
            const knex = getKnex()
            const row = await knex('rule_strategies').where('id', req.params.id).first()
            if (!row) return res.status(404).json({ error: 'Nicht gefunden' })

            // Eine Strategie, auf der Instanzen laufen, darf nicht verschwinden —
            // sonst stünden deren Trades ohne Regelwerk da.
            const benutzt = await knex('strategy_instances')
                .where('strategyId', row.strategyId).count({ n: '*' }).first()
            if (Number(benutzt?.n) > 0) {
                return res.status(409).json({
                    error: `${benutzt.n} Instanz(en) benutzen diese Strategie — erst dort entfernen`,
                })
            }
            await knex('rule_strategies').where('id', row.id).delete()
            await ladeAlleRegelStrategien()
            res.json({ ok: true })
        } catch (e) {
            res.status(500).json({ error: 'Regelstrategie konnte nicht gelöscht werden' })
        }
    })

    /** Kopie anlegen — der übliche Weg, eine Variante auszuprobieren. */
    app.post('/api/strategies/rules/:id/duplicate', async (req, res) => {
        try {
            const knex = getKnex()
            const row = await knex('rule_strategies').where('id', req.params.id).first()
            if (!row) return res.status(404).json({ error: 'Nicht gefunden' })

            let neueId = `${row.strategyId}_kopie`
            for (let n = 2; await knex('rule_strategies').where('strategyId', neueId).first(); n++) {
                neueId = `${row.strategyId}_kopie${n}`
                if (n > 50) return res.status(409).json({ error: 'Zu viele Kopien' })
            }
            const isPg = knex.client.config.client === 'pg'
            const roh = parseJson(row.rules, {})
            const g = pruefeRegeln({ ...roh, id: neueId, name: `${row.name} (Kopie)` })
            const datensatz = {
                strategyId: neueId, name: g.regeln.name, description: row.description,
                enabled: 1, rules: JSON.stringify(g.regeln), source: row.source,
            }
            const id = isPg
                ? (await knex('rule_strategies').insert(datensatz).returning('id'))[0]?.id
                : (await knex('rule_strategies').insert(datensatz))[0]
            await ladeAlleRegelStrategien()
            res.status(201).json({ id, strategyId: neueId })
        } catch (e) {
            logError('strategy-api', 'Kopieren fehlgeschlagen', e)
            res.status(500).json({ error: 'Kopie konnte nicht angelegt werden' })
        }
    })

    // ── Engine ───────────────────────────────────────────────────────────
    app.get('/api/strategies/engine/status', async (req, res) => {
        try {
            const knex = getKnex()
            const s = await knex('settings')
                .select('strategyLiveEnabled', 'strategyKillSwitch', 'strategyMaxLeverage', 'strategyMinPaperTrades')
                .where('id', 1).first()
            res.json({
                ...engineStatus(),
                liveEnabled: Boolean(s?.strategyLiveEnabled),
                killSwitch: Boolean(s?.strategyKillSwitch),
                maxLeverage: Number(s?.strategyMaxLeverage) || 10,
                minPaperTrades: Number(s?.strategyMinPaperTrades) || 0,
            })
        } catch (e) {
            res.status(500).json({ error: 'Status nicht abrufbar' })
        }
    })

    /** Sofort einen Takt auslösen, statt bis zu 15 s zu warten. */
    app.post('/api/strategies/engine/run', async (req, res) => {
        try {
            resetSymbolCache()
            await tick()
            res.json({ ok: true, ...engineStatus() })
        } catch (e) {
            logError('strategy-api', 'Manueller Takt fehlgeschlagen', e)
            res.status(500).json({ error: `Takt fehlgeschlagen: ${e.message}` })
        }
    })

    app.post('/api/strategies/kill-switch', async (req, res) => {
        try {
            const ergebnis = await killSwitch({ closePositions: Boolean(req.body?.closePositions) })
            res.json({ ok: true, ...ergebnis })
        } catch (e) {
            logError('strategy-api', 'Not-Aus fehlgeschlagen', e)
            res.status(500).json({ error: 'Not-Aus fehlgeschlagen' })
        }
    })
}

// ── Auswertung ───────────────────────────────────────────────────────────

/**
 * Datenbasis der Auswertungs-Rubrik.
 *
 * Wertet ausschliesslich `strategy_trades` aus — die echten Journal-Kennzahlen
 * bleiben davon unberührt. Der Setup-Trichter kommt aus `strategy_setups` und
 * `strategy_runs` und zeigt, WO Setups verloren gehen; das ist die eigentlich
 * nützliche Information für die Optimierung.
 */
export async function ladePerformance(filter = {}) {
    const knex = getKnex()

    const anwenden = (q, zeitSpalte) => {
        if (filter.instanceId) q = q.where('instanceId', Number(filter.instanceId))
        if (filter.symbol) q = q.where('symbol', String(filter.symbol).toUpperCase())
        if (filter.timeframe) q = q.where('timeframe', String(filter.timeframe))
        if (filter.mode) q = q.whereIn('mode', String(filter.mode).split(','))
        if (filter.paramsVersion) q = q.where('paramsVersion', Number(filter.paramsVersion))
        if (filter.from) q = q.where(zeitSpalte, '>=', Number(filter.from))
        if (filter.to) q = q.where(zeitSpalte, '<=', Number(filter.to))
        return q
    }

    const trades = await anwenden(knex('strategy_trades'), 'exitTime').orderBy('exitTime', 'asc')

    // Kapitalkurve aus den Trades — dieselbe Rechnung wie im Backtest
    const startEquity = Number(filter.startEquity) || 1000
    let equity = startEquity
    const equityCurve = []
    for (const t of trades) {
        equity += Number(t.netPnl) || 0
        equityCurve.push({ t: Number(t.exitTime), equity })
    }

    const normiert = trades.map((t) => ({
        ...t,
        netPnl: Number(t.netPnl) || 0,
        grossPnl: Number(t.grossPnl) || 0,
        fees: Number(t.fees) || 0,
        rMultiple: Number(t.rMultiple) || 0,
        maeR: Number(t.maeR) || 0,
        mfeR: Number(t.mfeR) || 0,
        holdingMinutes: Number(t.holdingMinutes) || 0,
    }))

    const kpis = berechneStatistik(normiert, startEquity, equity, equityCurve)

    // ── Gruppierungen ────────────────────────────────────────────────
    const gruppiere = (schluessel) => {
        const map = new Map()
        for (const t of normiert) {
            const k = schluessel(t)
            if (!map.has(k)) map.set(k, { key: k, trades: 0, netPnl: 0, wins: 0, sumR: 0 })
            const g = map.get(k)
            g.trades++
            g.netPnl += t.netPnl
            g.sumR += t.rMultiple
            if (t.netPnl > 0) g.wins++
        }
        return [...map.values()].map((g) => ({
            ...g,
            winRate: g.trades ? (g.wins / g.trades) * 100 : 0,
            avgR: g.trades ? g.sumR / g.trades : 0,
        })).sort((a, b) => b.netPnl - a.netPnl)
    }

    const byGroup = {
        symbol: gruppiere((t) => t.symbol),
        timeframe: gruppiere((t) => t.timeframe),
        direction: gruppiere((t) => t.direction),
        exitReason: gruppiere((t) => t.exitReason),
        weekday: gruppiere((t) => new Date(Number(t.exitTime)).getUTCDay()),
        hour: gruppiere((t) => new Date(Number(t.entryTime)).getUTCHours()),
        paramsVersion: gruppiere((t) => t.paramsVersion),
    }

    // R-Verteilung — zeigt auf einen Blick, ob die Ausreisser stimmen
    const stufen = [-3, -2, -1, 0, 1, 2, 3, 5]
    const rVerteilung = stufen.map((s, i) => ({
        von: s,
        bis: stufen[i + 1] ?? Infinity,
        n: normiert.filter((t) => t.rMultiple >= s && t.rMultiple < (stufen[i + 1] ?? Infinity)).length,
    }))

    // ── Setup-Trichter ───────────────────────────────────────────────
    let setupQ = knex('strategy_setups')
    if (filter.instanceId) setupQ = setupQ.where('instanceId', Number(filter.instanceId))
    if (filter.symbol) setupQ = setupQ.where('symbol', String(filter.symbol).toUpperCase())
    if (filter.timeframe) setupQ = setupQ.where('timeframe', String(filter.timeframe))
    const setupStatus = await setupQ.clone()
        .select('status').count({ n: '*' }).groupBy('status')
    const invalidGruende = await setupQ.clone()
        .whereNot('invalidReason', '')
        .select('invalidReason').count({ n: '*' }).groupBy('invalidReason')
    const rejectGruende = await setupQ.clone()
        .whereNot('rejectReason', '')
        .select('rejectReason').count({ n: '*' }).groupBy('rejectReason')

    const statusMap = Object.fromEntries(setupStatus.map((r) => [r.status, Number(r.n)]))
    const erkannt = Object.values(statusMap).reduce((a, b) => a + b, 0)
    const gewonnen = normiert.filter((t) => t.netPnl > 0).length

    const funnel = {
        erkannt,
        wartend: (statusMap.waiting_retest || 0) + (statusMap.armed || 0),
        getriggert: (statusMap.open || 0) + (statusMap.closed || 0) + (statusMap.rejected || 0),
        ausgefuehrt: normiert.length,
        gewonnen,
        byInvalidReason: Object.fromEntries(invalidGruende.map((r) => [r.invalidReason, Number(r.n)])),
        byRejectReason: Object.fromEntries(rejectGruende.map((r) => [r.rejectReason, Number(r.n)])),
    }

    // ── Hinweise für die Optimierung ─────────────────────────────────
    // Bewusst konservativ formuliert: das sind Beobachtungen, keine Empfehlungen.
    const hinweise = []
    if (normiert.length >= 10) {
        const erreicht2R = normiert.filter((t) => t.mfeR >= 2).length
        const beendetUnter2R = normiert.filter((t) => t.mfeR >= 2 && t.rMultiple < 2).length
        if (erreicht2R && beendetUnter2R / erreicht2R > 0.5) {
            hinweise.push({
                thema: 'takeProfit',
                text: `${beendetUnter2R} von ${erreicht2R} Trades liefen über 2R, endeten aber darunter — Ziel oder Break-Even prüfen.`,
            })
        }
        const slAnteil = normiert.filter((t) => t.exitReason === 'sl').length / normiert.length
        if (slAnteil > 0.6) {
            hinweise.push({
                thema: 'stopLoss',
                text: `${(slAnteil * 100).toFixed(0)} % enden im Stop — Stop-Abstand oder Einstiegsfilter prüfen.`,
            })
        }
        const avgMae = kpis.avgMaeR || 0
        if (avgMae > 0 && avgMae < 0.35) {
            hinweise.push({
                thema: 'stopLoss',
                text: `Der Kurs lief im Schnitt nur ${avgMae.toFixed(2)}R gegen die Position — ein engerer Stop wäre womöglich tragfähig.`,
            })
        }
    }
    const groesster = Object.entries(funnel.byInvalidReason).sort((a, b) => b[1] - a[1])[0]
    if (groesster && erkannt >= 20 && groesster[1] / erkannt > 0.4) {
        hinweise.push({
            thema: 'setups',
            text: `${((groesster[1] / erkannt) * 100).toFixed(0)} % der Setups scheitern an "${groesster[0]}".`,
        })
    }

    return { kpis, equityCurve, byGroup, rVerteilung, funnel, hinweise, trades: normiert.slice(-500) }
}


/**
 * Lädt alle aktiven Regelstrategien aus der DB in die Registry.
 * Beim Start und nach jeder Änderung — so wirken Änderungen sofort, ohne
 * Serverneustart.
 */
export async function ladeAlleRegelStrategien() {
    try {
        const rows = await getKnex()('rule_strategies').where('enabled', 1)
        const r = ladeRegelStrategien(rows)
        if (r.fehlerhaft.length) {
            for (const f of r.fehlerhaft) {
                logError('strategy-api', `Regelstrategie "${f.strategyId}" nicht ladbar: ${f.fehler.join('; ')}`, new Error('ungültig'))
            }
        }
        if (r.geladen.length) console.log(` -> ${r.geladen.length} eigene Strategie(n) geladen: ${r.geladen.join(', ')}`)
        return r
    } catch (e) {
        logError('strategy-api', 'Regelstrategien konnten nicht geladen werden', e)
        return { geladen: [], fehlerhaft: [] }
    }
}
