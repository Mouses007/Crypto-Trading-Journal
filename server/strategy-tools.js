/**
 * Werkzeuge für den Optimizer.
 *
 * Damit liest ein Agent die Auswertung der eigenen Trades, prüft eine
 * Gegenhypothese im Backtest und schlägt konkrete Parameter vor — mit Zahlen
 * statt Behauptungen.
 *
 * Zwei Grenzen sind fest eingebaut:
 *   1. `propose_param_change` schreibt nur einen Entwurf mit `status='pending'`.
 *      Übernommen wird er ausschliesslich durch den Nutzer im Labor. Ein Agent
 *      kann die Parameter einer laufenden Strategie nicht selbst ändern.
 *   2. `run_backtest` ist gedeckelt und je Sitzung begrenzt — sonst liesse sich
 *      der Server mit ein paar Aufrufen lahmlegen.
 *
 * Registriert werden die Werkzeuge in `ai-agent-tools.js`, damit auch der
 * bestehende KI-Coach sie nutzen kann.
 */

import { getStrategy, validateParams, RISK_PARAMS } from './strategies/index.js'
import { runBacktest, MAX_BACKTEST_CANDLES, schaetzeKerzen } from './strategy-backtest.js'
import { ladePerformance } from './strategy-api.js'
import { isValidTimeframe } from './market-data.js'

/** Backtests sind teuer — pro Agentenlauf ein knappes Kontingent. */
const MAX_BACKTESTS_PRO_LAUF = 5
let backtestZaehler = 0
export function resetBacktestKontingent() { backtestZaehler = 0 }

export const STRATEGY_TOOLS = [
    {
        name: 'get_strategy_performance',
        description: 'Auswertung der Agent-Trades: Kennzahlen, Setup-Trichter (wo Setups verloren gehen), '
            + 'Aufschlüsselungen und MAE/MFE. Die Grundlage jeder Optimierungsaussage. '
            + 'Ohne instanceId werden alle Instanzen zusammengefasst.',
        parameters: {
            type: 'object',
            properties: {
                instanceId: { type: 'number', description: 'Strategie-Instanz (optional)' },
                mode: { type: 'string', description: 'paper | shadow | live (optional)' },
                symbol: { type: 'string', description: 'z.B. BTCUSDT (optional)' },
                paramsVersion: { type: 'number', description: 'Nur Trades einer Parameter-Version (optional)' },
                from: { type: 'number', description: 'Unix ms (optional)' },
                to: { type: 'number', description: 'Unix ms (optional)' },
            },
        },
    },
    {
        name: 'get_strategy_config',
        description: 'Aktuelle Parameter einer Instanz UND das zugehörige Schema mit erlaubten '
            + 'Wertebereichen. Vor jedem Änderungsvorschlag aufrufen — Vorschläge ausserhalb der '
            + 'Grenzen werden verworfen.',
        parameters: {
            type: 'object',
            properties: { instanceId: { type: 'number', description: 'Strategie-Instanz' } },
            required: ['instanceId'],
        },
    },
    {
        name: 'get_strategy_setups',
        description: 'Einzelne erkannte Setups mit Kursmarken und Invalidierungsgrund. Nützlich, um '
            + 'einen auffälligen Posten aus dem Trichter an konkreten Fällen nachzuvollziehen.',
        parameters: {
            type: 'object',
            properties: {
                instanceId: { type: 'number' },
                status: { type: 'string', description: 'z.B. invalidated,expired' },
                limit: { type: 'number', description: 'Standard 30, max 100' },
            },
        },
    },
    {
        name: 'run_backtest',
        description: 'Prüft einen Parametersatz gegen historische Kurse — dieselbe Engine wie im '
            + 'Papierbetrieb. Damit lässt sich eine Vermutung MESSEN statt behaupten. '
            + `Höchstens ${MAX_BACKTESTS_PRO_LAUF} Aufrufe je Sitzung.`,
        parameters: {
            type: 'object',
            properties: {
                strategyId: { type: 'string', description: 'z.B. lsob' },
                symbol: { type: 'string' },
                timeframe: { type: 'string', description: 'z.B. 1h' },
                days: { type: 'number', description: 'Zeitraum in Tagen, Standard 90' },
                params: { type: 'object', description: 'Nur die abweichenden Parameter; der Rest bleibt Standard' },
                risk: { type: 'object', description: 'Abweichende Risiko-Parameter (optional)' },
            },
            required: ['strategyId', 'symbol', 'timeframe'],
        },
    },
    {
        name: 'propose_param_change',
        description: 'Legt einen Verbesserungsvorschlag zur Freigabe an. Ändert NICHTS an der laufenden '
            + 'Strategie — der Nutzer entscheidet im Labor. Immer mit Begründung und, wenn vorhanden, '
            + 'der backtestId als Beleg.',
        parameters: {
            type: 'object',
            properties: {
                instanceId: { type: 'number' },
                title: { type: 'string', description: 'Kurztitel, z.B. "Take-Profit auf 2R festlegen"' },
                rationale: { type: 'string', description: 'Begründung mit den Zahlen, auf die sie sich stützt' },
                params: { type: 'object', description: 'Nur die zu ändernden Parameter' },
                backtestId: { type: 'number', description: 'Beleg aus run_backtest (optional, aber erwünscht)' },
            },
            required: ['instanceId', 'title', 'rationale', 'params'],
        },
    },
]

// ── Umsetzungen ──────────────────────────────────────────────────────────

async function toolPerformance(knex, p) {
    const d = await ladePerformance(p)
    // Die Trade-Liste bläht die Antwort auf, ohne dem Agenten zu helfen
    const { trades, ...rest } = d
    return { ...rest, hinweis: 'Der Setup-Trichter zeigt, WO Setups verloren gehen — meist der beste Ansatzpunkt.' }
}

async function toolConfig(knex, p) {
    const row = await knex('strategy_instances').where('id', Number(p.instanceId)).first()
    if (!row) return { error: 'Instanz nicht gefunden' }
    const s = getStrategy(row.strategyId)
    if (!s) return { error: `Unbekannte Strategie: ${row.strategyId}` }

    const parse = (v, f) => { try { return typeof v === 'object' ? v : JSON.parse(v || 'null') ?? f } catch { return f } }
    return {
        instanceId: row.id,
        name: row.name,
        strategyId: row.strategyId,
        mode: row.mode,
        timeframe: row.timeframe,
        symbols: parse(row.symbols, []),
        paramsVersion: row.paramsVersion,
        params: parse(row.params, {}),
        risk: parse(row.risk, {}),
        // Das Schema ist der eigentliche Wert: es nennt die Grenzen, innerhalb
        // derer ein Vorschlag überhaupt angenommen werden kann.
        paramSchema: s.params.map((x) => ({
            key: x.key, type: x.type, default: x.default,
            min: x.min, max: x.max,
            options: x.options?.map((o) => (typeof o === 'object' ? o.value : o)),
        })),
        riskSchema: RISK_PARAMS.map((x) => ({ key: x.key, type: x.type, default: x.default, min: x.min, max: x.max })),
    }
}

async function toolSetups(knex, p) {
    let q = knex('strategy_setups').orderBy('id', 'desc')
        .limit(Math.min(Number(p.limit) || 30, 100))
    if (p.instanceId) q = q.where('instanceId', Number(p.instanceId))
    if (p.status) q = q.whereIn('status', String(p.status).split(','))
    const rows = await q
    return rows.map((r) => ({
        id: r.id, symbol: r.symbol, timeframe: r.timeframe, direction: r.direction,
        status: r.status, invalidReason: r.invalidReason, rejectReason: r.rejectReason,
        entry: r.entry, stopLoss: r.stopLoss, takeProfit: r.takeProfit, rr: r.rr,
        zone: [r.obLow, r.obHigh], sweepCandleTime: r.sweepCandleTime,
    }))
}

async function toolBacktest(knex, p) {
    if (backtestZaehler >= MAX_BACKTESTS_PRO_LAUF) {
        return { error: `Backtest-Kontingent erschöpft (${MAX_BACKTESTS_PRO_LAUF} je Sitzung).` }
    }
    const s = getStrategy(p.strategyId)
    if (!s) return { error: `Unbekannte Strategie: ${p.strategyId}` }
    if (!isValidTimeframe(p.timeframe)) return { error: `Ungültige Zeiteinheit: ${p.timeframe}` }
    if (!s.supportedTimeframes.includes(p.timeframe)) {
        return { error: `${s.name} unterstützt ${p.timeframe} nicht` }
    }

    const tage = Math.min(Math.max(Number(p.days) || 90, 7), 720)
    const toTs = Date.now()
    const fromTs = toTs - tage * 86400000
    if (schaetzeKerzen(fromTs, toTs, p.timeframe) > MAX_BACKTEST_CANDLES) {
        return { error: `Zeitraum zu gross für ${p.timeframe}. Weniger Tage oder grössere Zeiteinheit wählen.` }
    }

    backtestZaehler++
    const r = await runBacktest({
        strategyId: p.strategyId,
        params: p.params || {},
        risk: p.risk || {},
        symbol: String(p.symbol || '').toUpperCase(),
        timeframe: p.timeframe,
        fromTs, toTs,
        startEquity: 1000,
    })

    // Ergebnis sichern, damit ein Vorschlag darauf verweisen kann
    const isPg = knex.client.config.client === 'pg'
    const datensatz = {
        strategyId: p.strategyId,
        instanceId: Number(p.instanceId) || 0,
        label: 'Agent-Prüfung',
        symbol: String(p.symbol || '').toUpperCase(),
        timeframe: p.timeframe,
        market: 'futures',
        fromTs, toTs,
        params: JSON.stringify(r.meta?.params || {}),
        stats: JSON.stringify({ ...r.stats, funnel: r.funnel }),
        trades: JSON.stringify(r.trades.slice(0, 200)),
    }
    const backtestId = isPg
        ? (await knex('strategy_backtests').insert(datensatz).returning('id'))[0]?.id
        : (await knex('strategy_backtests').insert(datensatz))[0]

    return {
        backtestId,
        zeitraumTage: tage,
        stats: r.stats,
        funnel: r.funnel,
        hinweis: 'Die aussagekräftigste Zahl ist expectancyR (erwarteter Gewinn je Trade in R). '
            + 'Bei weniger als etwa 30 Trades ist das Ergebnis nicht belastbar.',
    }
}

async function toolPropose(knex, p) {
    const row = await knex('strategy_instances').where('id', Number(p.instanceId)).first()
    if (!row) return { error: 'Instanz nicht gefunden' }

    // Gegen das Schema prüfen, BEVOR der Vorschlag entsteht — ein Vorschlag mit
    // unmöglichen Werten wäre für den Nutzer nur Arbeit.
    const geprueft = validateParams(row.strategyId, p.params || {})
    if (geprueft.errors.length) return { error: geprueft.errors.join('; ') }

    const geaendert = {}
    for (const key of Object.keys(p.params || {})) {
        if (geprueft.values[key] !== undefined) geaendert[key] = geprueft.values[key]
    }
    if (!Object.keys(geaendert).length) return { error: 'Keine gültigen Parameter im Vorschlag' }

    const isPg = knex.client.config.client === 'pg'
    const datensatz = {
        instanceId: row.id,
        source: 'agent',
        title: String(p.title).slice(0, 200),
        rationale: String(p.rationale).slice(0, 2000),
        proposedParams: JSON.stringify(geaendert),
        backtestId: Number(p.backtestId) || 0,
        status: 'pending',
    }
    const id = isPg
        ? (await knex('strategy_suggestions').insert(datensatz).returning('id'))[0]?.id
        : (await knex('strategy_suggestions').insert(datensatz))[0]

    return {
        suggestionId: id,
        status: 'pending',
        geaendert,
        geklemmt: geprueft.clamped,
        hinweis: 'Vorschlag angelegt. Er ändert nichts, bis der Nutzer ihn im Labor übernimmt.',
    }
}

export const STRATEGY_TOOL_IMPL = {
    get_strategy_performance: toolPerformance,
    get_strategy_config: toolConfig,
    get_strategy_setups: toolSetups,
    run_backtest: toolBacktest,
    propose_param_change: toolPropose,
}
