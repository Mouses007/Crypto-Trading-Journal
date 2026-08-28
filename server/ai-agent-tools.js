/**
 * ai-agent-tools.js — Read-only tool implementations for the KI-Agent.
 * Each tool queries the DB via Knex and returns structured data.
 * No write operations — agent has read-only access.
 */

import { logWarn } from './logger.js'
import { STRATEGY_TOOLS, STRATEGY_TOOL_IMPL } from './strategy-tools.js'
import { hilfeUebersicht, hilfeThema, HILFE_THEMEN } from './app-hilfe.js'
import { sammleKacheln, normSymbol } from './marktradar-lage.js'
import { baueZeilen } from './lagebild.js'
import { ANKER } from './coin-radar/bewertung.js'
import { KOPPLUNG_FEST, KOPPLUNG_LOSE, deuteKopplung } from './coin-radar/btc-vergleich.js'

// ==================== TOOL DEFINITIONS (for LLM) ====================

export const AGENT_TOOLS = [
    {
        name: 'query_trades',
        description: 'Fetch trades from the journal within a date range. Can filter by symbol, strategy (long/short), broker, and PnL range. Returns trade details including symbol, date, strategy, PnL, entry/close price, quantity, duration.',
        parameters: {
            type: 'object',
            properties: {
                startDate: { type: 'number', description: 'Start date as Unix timestamp (seconds). Required.' },
                endDate: { type: 'number', description: 'End date as Unix timestamp (seconds). Required.' },
                symbol: { type: 'string', description: 'Filter by symbol name (e.g. "BTCUSDT"). Partial match.' },
                strategy: { type: 'string', enum: ['long', 'short'], description: 'Filter by trade direction.' },
                broker: { type: 'string', description: 'Filter by broker (e.g. "bitunix", "bitget").' },
                minPnl: { type: 'number', description: 'Minimum gross PnL filter.' },
                maxPnl: { type: 'number', description: 'Maximum gross PnL filter.' },
                limit: { type: 'number', description: 'Max results (default 50, max 200).' }
            },
            required: ['startDate', 'endDate']
        }
    },
    {
        name: 'query_notes',
        description: 'Search trade notes and diary entries. Returns entry/closing notes, stress levels, emotions, feelings, playbook assignments, trade types, and trading metadata (SL/TP history, position sizing).',
        parameters: {
            type: 'object',
            properties: {
                startDate: { type: 'number', description: 'Start date as Unix timestamp (seconds).' },
                endDate: { type: 'number', description: 'End date as Unix timestamp (seconds).' },
                tradeId: { type: 'string', description: 'Filter by specific trade ID.' },
                hasPlaybook: { type: 'boolean', description: 'Only notes with playbook assignment.' },
                limit: { type: 'number', description: 'Max results (default 50, max 200).' }
            }
        }
    },
    {
        name: 'query_tags',
        description: 'Query tag usage for trades. Returns which tags were assigned to which trades/dates. Useful for pattern analysis (e.g. which setups perform best).',
        parameters: {
            type: 'object',
            properties: {
                startDate: { type: 'number', description: 'Start date as Unix timestamp (seconds).' },
                endDate: { type: 'number', description: 'End date as Unix timestamp (seconds).' },
                tradeId: { type: 'string', description: 'Filter by specific trade ID.' }
            }
        }
    },
    {
        name: 'query_excursions',
        description: 'Query MFE (Maximum Favorable Excursion) and MAE (Maximum Adverse Excursion) data for trades. Shows how far price moved for/against the trade, and stop loss levels. Useful for risk analysis.',
        parameters: {
            type: 'object',
            properties: {
                startDate: { type: 'number', description: 'Start date as Unix timestamp (seconds).' },
                endDate: { type: 'number', description: 'End date as Unix timestamp (seconds).' },
                tradeId: { type: 'string', description: 'Filter by specific trade ID.' }
            }
        }
    },
    {
        name: 'query_playbooks',
        description: 'List all playbook definitions. Returns playbook names, descriptions, and IDs. Use to understand the trader\'s strategy framework.',
        parameters: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'query_satisfactions',
        description: 'Query trade satisfaction ratings (1=satisfied, 0=not satisfied). Shows how the trader evaluated their own execution.',
        parameters: {
            type: 'object',
            properties: {
                startDate: { type: 'number', description: 'Start date as Unix timestamp (seconds).' },
                endDate: { type: 'number', description: 'End date as Unix timestamp (seconds).' }
            }
        }
    },
    {
        name: 'query_incoming_positions',
        description: 'Query open/pending positions and their SL/TP change history. Shows current positions with entry price, leverage, quantity, and the complete SL/TP modification protocol.',
        parameters: {
            type: 'object',
            properties: {
                status: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Position status filter (default: all).' },
                symbol: { type: 'string', description: 'Filter by symbol.' },
                limit: { type: 'number', description: 'Max results (default 20).' }
            }
        }
    },
    {
        name: 'compute_statistics',
        description: 'Compute trading statistics for a date range: win rate, profit factor, APPT, average win/loss, best/worst trade, long vs short performance, top symbols, stress/emotion averages, tag usage. This is the most comprehensive analysis tool.',
        parameters: {
            type: 'object',
            properties: {
                startDate: { type: 'number', description: 'Start date as Unix timestamp (seconds). Required.' },
                endDate: { type: 'number', description: 'End date as Unix timestamp (seconds). Required.' },
                broker: { type: 'string', description: 'Filter by broker.' }
            },
            required: ['startDate', 'endDate']
        }
    },
    {
        name: 'analyze_sl_tp_patterns',
        description: 'Analyze SL/TP modification patterns across completed trades. Shows how often SL/TP was moved, direction of changes, RRR (Risk-Reward-Ratio) at each step, and correlation with trade outcomes.',
        parameters: {
            type: 'object',
            properties: {
                startDate: { type: 'number', description: 'Start date as Unix timestamp (seconds).' },
                endDate: { type: 'number', description: 'End date as Unix timestamp (seconds).' },
                symbol: { type: 'string', description: 'Filter by symbol.' }
            }
        }
    },
    {
        name: 'query_settings',
        description: 'Read app settings: timezone, broker config, available tag groups, playbook names, trade timeframes, balances. Does NOT return API keys or sensitive data.',
        parameters: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'query_screenshots',
        description: 'List screenshots (chart images) from the journal. Returns metadata only (no images). Use analyze_screenshot to view a specific image. Returns id, symbol, side, date, and whether an AI review already exists.',
        parameters: {
            type: 'object',
            properties: {
                startDate: { type: 'number', description: 'Start date as Unix timestamp (seconds).' },
                endDate: { type: 'number', description: 'End date as Unix timestamp (seconds).' },
                symbol: { type: 'string', description: 'Filter by symbol (partial match, e.g. "BTC").' },
                limit: { type: 'number', description: 'Max results (default 20, max 50).' }
            }
        }
    },
    {
        name: 'analyze_screenshot',
        description: 'Fetch a specific screenshot image by ID for visual analysis. The image (chart/trade screenshot) will be sent to you for analysis. Use query_screenshots first to find the ID. Only works with vision-capable models (Claude, GPT-4o, Gemini).',
        parameters: {
            type: 'object',
            properties: {
                screenshotId: { type: 'number', description: 'The screenshot ID from query_screenshots.' },
                useAnnotated: { type: 'boolean', description: 'If true, use the annotated version (with markings). Default: true.' }
            },
            required: ['screenshotId']
        }
    },
    {
        name: 'query_app_help',
        description: 'Read the built-in documentation of THIS software (Crypto Trading Journal). Use this for any question about how to use the app: where a setting lives, what a page or tile does, how import/export works, what the Live-Analyse, Livetrading or Strategien mode offers. Without a topic it returns the list of available topics. Answer software questions ONLY from this documentation, never from general knowledge.',
        parameters: {
            type: 'object',
            properties: {
                topic: { type: 'string', enum: Object.keys(HILFE_THEMEN), description: 'Help topic to read. Omit to get the topic list first.' }
            }
        }
    },
    {
        name: 'query_marktradar',
        description: 'Fetch the CURRENT readings of the Live-Analyse market dashboard (Marktradar): Fear & Greed, BTC dominance, funding rates, long/short ratio + open interest, 24h liquidations, RSI breadth, market overview, altcoin season, Pi Cycle, rainbow chart, macro (index futures, DXY, correlation), market mechanics state and the user\'s own results per market regime. Returns one text line per tile — the same numbers shown on screen. Use ONLY these numbers, never invent market data, and give no trading recommendations.',
        parameters: {
            type: 'object',
            properties: {
                symbol: { type: 'string', description: 'Symbol for the symbol-specific tiles (mechanics, long/short). Default BTCUSDT.' }
            }
        }
    },
    {
        name: 'query_coin_radar',
        description: 'Fetch the current Coin-Radar ranking — which of the tradable coins looks best to trade RIGHT NOW (movement, liquidity, trend, funding cost), from the most recently finished run. Returns the top-ranked coins as text lines. This is DIFFERENT from query_marktradar (which covers Marktradar tiles for ONE symbol, e.g. Fear&Greed, Marktmechanik) — use THIS tool for Coin-Radar questions ("welcher Coin lässt sich gerade gut handeln"). Important: a high score means "tradeable now" (moves enough, cheap to execute), NOT "will go up" — never turn this into a price/direction prediction.',
        parameters: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'How many top-ranked coins to return. Default 12, max 30.' },
                filter: {
                    type: 'string',
                    enum: ['alle', 'imSpiel', 'trendend', 'bestaetigt', 'laeuftMitBtc', 'eigenstaendig'],
                    description: 'alle = keine Einschränkung. imSpiel = RVOL über der Schwelle. trendend = ADX über der Schwelle. bestaetigt = beide Zeiteinheiten stimmen überein. laeuftMitBtc = starker Bitcoin-Gleichlauf. eigenstaendig = kaum Bitcoin-Bezug.'
                },
                boerse: { type: 'string', enum: ['bitunix', 'bitget', 'pionex'], description: 'Nur Coins zeigen, die auf dieser Börse handelbar sind.' }
            }
        }
    },
    // ── Modell-Optimierung: OpenRouter-Analyse ──────────────────────
    {
        name: 'analyze_model_performance',
        description: 'Analysiert, welche KI-Modelle für welche Aufgaben am besten funktionieren anhand von Kosten und Verbrauch',
        parameters: {
            type: 'object',
            properties: {
                task: {
                    type: 'string',
                    description: 'Aufgaben-ID zur Analyse (z.B. "lagebericht", "trade-analyse")',
                },
                daysBack: {
                    type: 'number',
                    description: 'Wie viele Tage in die Vergangenheit schauen (Standard: 30)',
                    default: 30,
                },
            },
        },
    },
    {
        name: 'get_openrouter_models',
        description: 'Holt verfügbare OpenRouter-Modelle mit Preisen und Benchmarks',
        parameters: {
            type: 'object',
            properties: {
                filterBy: {
                    type: 'string',
                    enum: ['speed', 'cost', 'quality', 'all'],
                    description: 'Filterkriterium: schnelle, billige oder hochwertige Modelle',
                    default: 'all',
                },
            },
        },
    },
    {
        name: 'recommend_model_allocation',
        description: 'Empfiehlt beste Modell-Zuordnung für alle KI-Aufgaben basierend auf Kosten und Qualität',
        parameters: {
            type: 'object',
            properties: {
                optimizeFor: {
                    type: 'string',
                    enum: ['cost', 'quality', 'balance'],
                    description: 'Optimierungs-Ziel: minimale Kosten, beste Qualität oder Balance',
                    default: 'balance',
                },
            },
        },
    },
    // Werkzeuge der Strategie-Agenten — auch der KI-Coach darf die Auswertung
    // der automatisch gehandelten Strategien lesen und Verbesserungen vorschlagen.
    ...STRATEGY_TOOLS,
]

// ==================== TOOL EXECUTION ====================

/**
 * Execute a tool by name with given parameters.
 * @param {string} toolName
 * @param {object} params
 * @param {import('knex').Knex} knex
 * @returns {Promise<object>} Tool result
 */
export async function executeTool(toolName, params, knex) {
    const tools = {
        query_trades: toolQueryTrades,
        query_notes: toolQueryNotes,
        query_tags: toolQueryTags,
        query_excursions: toolQueryExcursions,
        query_playbooks: toolQueryPlaybooks,
        query_satisfactions: toolQuerySatisfactions,
        query_incoming_positions: toolQueryIncomingPositions,
        compute_statistics: toolComputeStatistics,
        analyze_sl_tp_patterns: toolAnalyzeSlTpPatterns,
        query_settings: toolQuerySettings,
        query_screenshots: toolQueryScreenshots,
        analyze_screenshot: toolAnalyzeScreenshot,
        query_app_help: toolQueryAppHelp,
        query_marktradar: toolQueryMarktradar,
        query_coin_radar: toolQueryCoinRadar,
        analyze_model_performance: toolAnalyzeModelPerformance,
        get_openrouter_models: toolGetOpenrouterModels,
        recommend_model_allocation: toolRecommendModelAllocation,
        // Werkzeuge der Strategie-Agenten: Auswertung lesen, Hypothesen im
        // Backtest messen, Parameteränderungen zur Freigabe vorschlagen.
        ...STRATEGY_TOOL_IMPL,
    }

    const fn = tools[toolName]
    if (!fn) {
        return { error: `Unknown tool: ${toolName}` }
    }

    try {
        return await fn(knex, params || {})
    } catch (err) {
        logWarn('ai-agent-tools', `Tool ${toolName} failed: ${err.message}`)
        return { error: `Tool execution failed: ${err.message}` }
    }
}

// ==================== TOOL IMPLEMENTATIONS ====================

// Bedienungsfragen zur Software — Antwort ausschliesslich aus der eingebauten
// Doku, damit der Agent nicht aus Allgemeinwissen über eine App rät, die es
// nur hier gibt.
async function toolQueryAppHelp(knex, params) {
    if (params.topic) {
        const t = hilfeThema(params.topic)
        if (t) return t
        return { error: `Unknown topic: ${params.topic}`, verfuegbareThemen: hilfeUebersicht() }
    }
    return { hinweis: 'Wähle ein Thema und rufe query_app_help erneut mit topic auf.', themen: hilfeUebersicht() }
}

// Aktuelle Messwerte der Marktradar-Kacheln — dieselben `hole*`-Funktionen wie
// die Seite selbst, also im Regelfall aus deren Zwischenspeicher ohne einen
// zusätzlichen Fremdabruf. Textzeilen statt Rohzahlen, damit die Einheiten
// gleich dabeistehen.
async function toolQueryMarktradar(knex, params) {
    // Über normSymbol, nicht bloss `toUpperCase()`: das Symbol wandert
    // ungekodiert in die Binance-Abfragen (`?symbol=…`) und in Cache-Schlüssel.
    // Was das Modell schickt, ist ungeprüfte Eingabe.
    const symbol = normSymbol(params.symbol)
    const kacheln = await sammleKacheln(symbol)
    const zeilen = baueZeilen(kacheln)
    if (zeilen.length === 0) return { error: 'Keine Marktradar-Kachel liefert gerade Daten.' }
    return {
        symbol,
        stand: new Date().toISOString(),
        hinweis: 'Eine Zeile je Kachel; fehlende Kacheln waren gerade nicht erreichbar. Keine Handelsempfehlungen ableiten.',
        messwerte: zeilen.map(z => z.text),
    }
}

/** JSON-Spalten von `coinradar_zeilen` sind TEXT (siehe database.js) — Parse-Fehler geben den Rückfall. */
function sicherParseJson(text, rueckfall) {
    try {
        const j = JSON.parse(text)
        return j ?? rueckfall
    } catch {
        return rueckfall
    }
}

// Dieselben Schwellenfragen wie CoinRadar.vue (`istImSpiel`/`istTrendend`/
// `laeuftMitBtc`/`istEigenstaendig`), damit das Tool nicht zufällig eine
// andere Grenze zieht als die Seite, die es beschreibt. `ohneWert` zuerst:
// Number(null) ist 0, und 0 unterschreitet jede Schwelle — ein ungemessener
// Coin fiele sonst still in „nein" statt in „unbekannt".
const COIN_RADAR_FILTER = {
    imSpiel: z => z.rvol != null && Number(z.rvol) >= ANKER.rvolSchwelle,
    trendend: z => z.adx != null && Number(z.adx) >= ANKER.adxSchwelle,
    bestaetigt: z => z.jeZeiteinheit?.bestaetigt === true,
    laeuftMitBtc: z => z.btcKorrelation != null && Number(z.btcKorrelation) >= KOPPLUNG_FEST,
    eigenstaendig: z => z.btcKorrelation != null && Math.abs(Number(z.btcKorrelation)) <= KOPPLUNG_LOSE,
}

const fmtZahl = v => (v === null || v === undefined ? '?' : Number(v).toFixed(2))

// Aktuelle Coin-Radar-Rangliste — letzter FERTIGER Lauf, dieselbe Abfrage wie
// GET /api/coin-radar/zeilen (server/coin-radar-api.js), nur ohne Express und
// mit knappen Textzeilen statt Rohdaten, damit der Agent nicht ~100 Zeilen mit
// allen Spalten in den Kontext bekommt.
async function toolQueryCoinRadar(knex, params) {
    const letzterLauf = await knex('coinradar_laeufe').where('status', 'fertig').orderBy('id', 'desc').first()
    if (!letzterLauf) return { error: 'Noch kein fertiger Coin-Radar-Lauf vorhanden.' }

    const rohZeilen = await knex('coinradar_zeilen')
        .where('laufId', letzterLauf.id)
        .where('status', 'bewertet')
        .orderBy('rang', 'asc')

    let zeilen = rohZeilen.map(z => ({
        ...z,
        jeZeiteinheit: sicherParseJson(z.jeZeiteinheit, {}),
        boersen: sicherParseJson(z.boersen, {}),
    }))

    const filter = String(params.filter || 'alle')
    if (COIN_RADAR_FILTER[filter]) zeilen = zeilen.filter(COIN_RADAR_FILTER[filter])

    const boerse = String(params.boerse || '').trim()
    if (boerse) {
        zeilen = zeilen.filter(z => {
            const liste = Array.isArray(z.boersen?.liste) ? z.boersen.liste : []
            const unbekannt = Array.isArray(z.boersen?.unbekannt) ? z.boersen.unbekannt : []
            // Unbekannt bleibt stehen statt als „nein" zu gelten — ein
            // Netzaussetzer bei einer Quelle soll die Liste nicht leeren.
            return liste.some(e => e.boerse === boerse) || unbekannt.includes(boerse)
        })
    }

    if (zeilen.length === 0) return { error: 'Kein Coin passt zu diesem Filter.' }

    const limit = Math.min(30, Math.max(1, Number(params.limit) || 12))
    zeilen = zeilen.slice(0, limit)

    const zeile = z => {
        const teile = [
            `#${z.rang} ${z.symbol}`,
            `Note ${z.note}`,
            `ATR% ${fmtZahl(z.atrPct)}`,
            `RVOL ${fmtZahl(z.rvol)}`,
            `ADX ${fmtZahl(z.adx)}`,
            `Funding ${fmtZahl(z.fundingJahresRate)}% p.a.`,
            `BTC-Bezug ${deuteKopplung(z.btcKorrelation)}${z.btcKorrelation != null ? ` (${(Number(z.btcKorrelation) * 100).toFixed(0)}%)` : ''}`,
        ]
        if (z.rundlaufBp != null) teile.push(`Ausführung ${fmtZahl(z.rundlaufBp)} bp${z.besteBoerse ? ` (${z.besteBoerse})` : ''}`)
        if (z.umsatz24h != null) teile.push(`Umsatz ${(Number(z.umsatz24h) / 1e6).toFixed(0)} Mio USD`)
        return teile.join(', ')
    }

    return {
        stand: new Date(Number(letzterLauf.erstelltAm)).toISOString(),
        filter,
        boerse: boerse || null,
        anzahlGezeigt: zeilen.length,
        hinweis: 'Der Coin-Radar sagt NICHTS über die Richtung — eine hohe Note heisst "lässt sich jetzt gut handeln", nicht "steigt". Keine Handelsempfehlung daraus ableiten.',
        rangliste: zeilen.map(zeile),
    }
}

async function toolQueryTrades(knex, params) {
    const limit = Math.min(params.limit || 50, 200)
    const rows = await knex('trades')
        .where('dateUnix', '>=', params.startDate)
        .where('dateUnix', '<=', params.endDate)
        .orderBy('dateUnix', 'desc')

    let allTrades = []
    for (const row of rows) {
        let tradesArr = []
        try { tradesArr = JSON.parse(row.trades || '[]') } catch { tradesArr = [] }
        if (params.broker) tradesArr = tradesArr.filter(t => t.broker === params.broker)
        if (params.symbol) tradesArr = tradesArr.filter(t => (t.symbol || '').toLowerCase().includes(params.symbol.toLowerCase()))
        if (params.strategy) tradesArr = tradesArr.filter(t => t.strategy === params.strategy)
        if (params.minPnl !== undefined) tradesArr = tradesArr.filter(t => (t.grossProceeds || 0) >= params.minPnl)
        if (params.maxPnl !== undefined) tradesArr = tradesArr.filter(t => (t.grossProceeds || 0) <= params.maxPnl)

        for (const t of tradesArr) {
            allTrades.push({
                dateUnix: row.dateUnix,
                tradeId: t.id,
                symbol: t.symbol,
                strategy: t.strategy,
                grossProceeds: t.grossProceeds,
                netProceeds: t.netProceeds,
                entryPrice: t.entryPrice,
                closePrice: t.closePrice,
                buyQuantity: t.buyQuantity,
                sellQuantity: t.sellQuantity,
                entryTime: t.entryTime,
                exitTime: t.exitTime,
                commission: t.commission,
                fees: t.fees,
                broker: t.broker
            })
        }
    }

    return {
        count: allTrades.length,
        trades: allTrades.slice(0, limit)
    }
}

async function toolQueryNotes(knex, params) {
    const limit = Math.min(params.limit || 50, 200)
    let query = knex('notes').orderBy('dateUnix', 'desc')

    if (params.startDate) query = query.where('dateUnix', '>=', params.startDate)
    if (params.endDate) query = query.where('dateUnix', '<=', params.endDate)
    if (params.tradeId) query = query.where('tradeId', params.tradeId)
    if (params.hasPlaybook) query = query.whereNot('playbook', '')

    const rows = await query.limit(limit)
    return {
        count: rows.length,
        notes: rows.map(n => {
            let metadata = null
            try { metadata = n.tradingMetadata ? JSON.parse(n.tradingMetadata) : null } catch { /* ignore */ }
            return {
                dateUnix: n.dateUnix,
                tradeId: n.tradeId,
                entryNote: n.entryNote || '',
                closingNote: n.closingNote || '',
                note: n.note || '',
                title: n.title || '',
                playbook: n.playbook || '',
                timeframe: n.timeframe || '',
                tradeType: n.tradeType || '',
                closingTradeType: n.closingTradeType || '',
                entryStressLevel: n.entryStressLevel || 0,
                exitStressLevel: n.exitStressLevel || 0,
                emotionLevel: n.emotionLevel || 0,
                feelings: n.feelings || '',
                strategyFollowed: n.strategyFollowed,
                tradingMetadata: metadata
            }
        })
    }
}

async function toolQueryTags(knex, params) {
    let query = knex('tags').orderBy('dateUnix', 'desc')
    if (params.startDate) query = query.where('dateUnix', '>=', params.startDate)
    if (params.endDate) query = query.where('dateUnix', '<=', params.endDate)
    if (params.tradeId) query = query.where('tradeId', params.tradeId)

    const rows = await query.limit(200)

    // Resolve tag names from settings
    const settings = await knex('settings').select('tags').where('id', 1).first()
    let tagGroups = []
    try { tagGroups = JSON.parse(settings?.tags || '[]') } catch { tagGroups = [] }
    const tagIdToName = {}
    for (const group of tagGroups) {
        if (group.tags) {
            for (const tag of group.tags) {
                tagIdToName[tag.id] = `${group.name}: ${tag.name}`
            }
        }
    }

    return {
        count: rows.length,
        tags: rows.map(r => {
            let tagIds = []
            let closingTagIds = []
            try { tagIds = JSON.parse(r.tags || '[]') } catch { tagIds = [] }
            try { closingTagIds = JSON.parse(r.closingTags || '[]') } catch { closingTagIds = [] }
            return {
                dateUnix: r.dateUnix,
                tradeId: r.tradeId,
                entryTags: tagIds.map(id => tagIdToName[id] || id),
                closingTags: closingTagIds.map(id => tagIdToName[id] || id)
            }
        }),
        availableTagGroups: tagGroups.map(g => ({
            name: g.name,
            tags: (g.tags || []).map(t => t.name)
        }))
    }
}

async function toolQueryExcursions(knex, params) {
    let query = knex('excursions').orderBy('dateUnix', 'desc')
    if (params.startDate) query = query.where('dateUnix', '>=', params.startDate)
    if (params.endDate) query = query.where('dateUnix', '<=', params.endDate)
    if (params.tradeId) query = query.where('tradeId', params.tradeId)

    const rows = await query.limit(200)
    return {
        count: rows.length,
        excursions: rows.map(r => ({
            dateUnix: r.dateUnix,
            tradeId: r.tradeId,
            stopLoss: r.stopLoss,
            maePrice: r.maePrice,
            mfePrice: r.mfePrice
        }))
    }
}

async function toolQueryPlaybooks(knex) {
    // Playbooks are stored in settings.tags as tag groups, AND in playbook fields of notes
    // The actual "playbook" definitions come from what's been used
    const notes = await knex('notes').whereNot('playbook', '').select('playbook').groupBy('playbook')
    const playbooks = await knex('playbooks').select('*').catch(() => [])

    // Also check if there's a dedicated playbooks table
    if (playbooks.length > 0) {
        return {
            count: playbooks.length,
            playbooks: playbooks.map(p => ({
                id: p.id,
                name: p.name || '',
                description: p.description || '',
                rules: p.rules || ''
            }))
        }
    }

    // Fallback: collect unique playbook names from notes
    const uniquePlaybooks = [...new Set(notes.map(n => n.playbook).filter(Boolean))]
    return {
        count: uniquePlaybooks.length,
        playbooks: uniquePlaybooks.map(name => ({ name }))
    }
}

async function toolQuerySatisfactions(knex, params) {
    let query = knex('satisfactions').orderBy('dateUnix', 'desc')
    if (params.startDate) query = query.where('dateUnix', '>=', params.startDate)
    if (params.endDate) query = query.where('dateUnix', '<=', params.endDate)

    const rows = await query.limit(200)
    const satisfied = rows.filter(r => r.satisfaction === 1).length
    const unsatisfied = rows.filter(r => r.satisfaction === 0).length

    return {
        count: rows.length,
        satisfied,
        unsatisfied,
        satisfactionRate: rows.length > 0 ? ((satisfied / rows.length) * 100).toFixed(1) + '%' : 'N/A',
        details: rows.map(r => ({
            dateUnix: r.dateUnix,
            tradeId: r.tradeId,
            satisfaction: r.satisfaction
        }))
    }
}

async function toolQueryIncomingPositions(knex, params) {
    const limit = Math.min(params.limit || 20, 100)
    let query = knex('incoming_positions').orderBy('createdAt', 'desc')

    if (params.status && params.status !== 'all') {
        query = query.where('status', params.status)
    }
    if (params.symbol) {
        query = query.where('symbol', 'like', `%${params.symbol}%`)
    }

    const rows = await query.limit(limit)
    return {
        count: rows.length,
        positions: rows.map(p => {
            let tpslHistory = []
            try { tpslHistory = JSON.parse(p.tpslHistory || '[]') } catch { tpslHistory = [] }
            return {
                positionId: p.positionId,
                symbol: p.symbol,
                side: p.side,
                entryPrice: p.entryPrice,
                leverage: p.leverage,
                quantity: p.quantity,
                status: p.status,
                playbook: p.playbook || '',
                stressLevel: p.stressLevel || 0,
                broker: p.broker || 'bitunix',
                tpslHistory: tpslHistory.slice(-20) // Last 20 entries max
            }
        })
    }
}

async function toolComputeStatistics(knex, params) {
    const rows = await knex('trades')
        .where('dateUnix', '>=', params.startDate)
        .where('dateUnix', '<=', params.endDate)

    let allTrades = []
    let totalGrossProceeds = 0, totalNetProceeds = 0, totalFees = 0
    let totalGrossWins = 0, totalGrossLoss = 0
    let wins = 0, losses = 0
    let bestTradePnl = -Infinity, worstTradePnl = Infinity
    let bestDay = { dateUnix: 0, pnl: -Infinity }, worstDay = { dateUnix: 0, pnl: Infinity }

    for (const row of rows) {
        let tradesArr = []
        try { tradesArr = JSON.parse(row.trades || '[]') } catch { tradesArr = [] }
        if (params.broker) {
            tradesArr = tradesArr.filter(t => t.broker === params.broker)
            if (tradesArr.length === 0) continue
        }

        let dayPnl = params.broker
            ? tradesArr.reduce((sum, t) => sum + (t.grossProceeds || 0), 0)
            : (JSON.parse(row.pAndL || '{}').grossProceeds || 0)

        if (dayPnl > bestDay.pnl) bestDay = { dateUnix: row.dateUnix, pnl: dayPnl }
        if (dayPnl < worstDay.pnl) worstDay = { dateUnix: row.dateUnix, pnl: dayPnl }

        for (const t of tradesArr) {
            allTrades.push(t)
            const gp = t.grossProceeds || 0
            const np = t.netProceeds || 0
            const fee = (t.commission || 0) + (t.fees || 0)
            totalGrossProceeds += gp
            totalNetProceeds += np
            totalFees += fee
            if (gp > 0) { wins++; totalGrossWins += gp }
            else { losses++; totalGrossLoss += Math.abs(gp) }
            if (gp > bestTradePnl) bestTradePnl = gp
            if (gp < worstTradePnl) worstTradePnl = gp
        }
    }

    const tradeCount = allTrades.length
    const winRate = tradeCount > 0 ? ((wins / tradeCount) * 100).toFixed(1) : '0'
    const profitFactor = totalGrossLoss > 0 ? (totalGrossWins / totalGrossLoss).toFixed(2) : 'N/A'
    const appt = tradeCount > 0 ? (totalGrossProceeds / tradeCount).toFixed(2) : '0'
    const avgWin = wins > 0 ? (totalGrossWins / wins).toFixed(2) : '0'
    const avgLoss = losses > 0 ? (totalGrossLoss / losses).toFixed(2) : '0'

    // Long/Short
    const longTrades = allTrades.filter(t => t.strategy === 'long')
    const shortTrades = allTrades.filter(t => t.strategy === 'short')
    let longWins = 0, longLosses = 0, longPnl = 0
    for (const t of longTrades) { const gp = t.grossProceeds || 0; if (gp > 0) longWins++; else longLosses++; longPnl += gp }
    let shortWins = 0, shortLosses = 0, shortPnl = 0
    for (const t of shortTrades) { const gp = t.grossProceeds || 0; if (gp > 0) shortWins++; else shortLosses++; shortPnl += gp }

    // Top symbols
    const symbolMap = {}
    for (const t of allTrades) {
        const sym = t.symbol || 'Unknown'
        if (!symbolMap[sym]) symbolMap[sym] = { count: 0, pnl: 0, wins: 0, losses: 0 }
        symbolMap[sym].count++
        symbolMap[sym].pnl += (t.grossProceeds || 0)
        if ((t.grossProceeds || 0) > 0) symbolMap[sym].wins++; else symbolMap[sym].losses++
    }
    const topSymbols = Object.entries(symbolMap)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([sym, d]) => ({ symbol: sym, count: d.count, pnl: d.pnl.toFixed(2), wins: d.wins, losses: d.losses }))

    // Psychology
    const notes = await knex('notes')
        .where('dateUnix', '>=', params.startDate)
        .where('dateUnix', '<=', params.endDate)
    let stressSum = 0, stressCount = 0, emotionSum = 0, emotionCount = 0
    for (const n of notes) {
        if (n.entryStressLevel > 0) { stressSum += n.entryStressLevel; stressCount++ }
        if (n.emotionLevel > 0) { emotionSum += n.emotionLevel; emotionCount++ }
    }

    // Satisfaction
    const satisfactions = await knex('satisfactions')
        .where('dateUnix', '>=', params.startDate)
        .where('dateUnix', '<=', params.endDate)
    const satisfiedCount = satisfactions.filter(s => s.satisfaction === 1).length

    // Tag usage
    const tagsRows = await knex('tags')
        .where('dateUnix', '>=', params.startDate)
        .where('dateUnix', '<=', params.endDate)
    const settingsRow = await knex('settings').select('tags').where('id', 1).first()
    let availableTags = []
    try { availableTags = JSON.parse(settingsRow?.tags || '[]') } catch { availableTags = [] }
    const tagIdToName = {}
    for (const group of availableTags) {
        if (group.tags) { for (const tag of group.tags) { tagIdToName[tag.id] = tag.name } }
    }
    const tagUsage = {}
    for (const row of tagsRows) {
        let tagIds = []
        try { tagIds = JSON.parse(row.tags || '[]') } catch { tagIds = [] }
        for (const id of tagIds) {
            const name = tagIdToName[id] || id
            if (!tagUsage[name]) tagUsage[name] = 0
            tagUsage[name]++
        }
    }

    return {
        tradeCount, tradingDays: rows.length,
        wins, losses, winRate: winRate + '%',
        totalGrossProceeds: totalGrossProceeds.toFixed(2),
        totalNetProceeds: totalNetProceeds.toFixed(2),
        totalFees: totalFees.toFixed(2),
        profitFactor, appt,
        avgWin, avgLoss,
        bestTradePnl: bestTradePnl === -Infinity ? 'N/A' : bestTradePnl.toFixed(2),
        worstTradePnl: worstTradePnl === Infinity ? 'N/A' : worstTradePnl.toFixed(2),
        bestDay: bestDay.dateUnix ? { dateUnix: bestDay.dateUnix, pnl: bestDay.pnl.toFixed(2) } : null,
        worstDay: worstDay.dateUnix ? { dateUnix: worstDay.dateUnix, pnl: worstDay.pnl.toFixed(2) } : null,
        longStats: { count: longTrades.length, wins: longWins, losses: longLosses, pnl: longPnl.toFixed(2) },
        shortStats: { count: shortTrades.length, wins: shortWins, losses: shortLosses, pnl: shortPnl.toFixed(2) },
        topSymbols,
        avgStress: stressCount > 0 ? (stressSum / stressCount).toFixed(1) : 'N/A',
        avgEmotion: emotionCount > 0 ? (emotionSum / emotionCount).toFixed(1) : 'N/A',
        satisfactionRate: satisfactions.length > 0 ? ((satisfiedCount / satisfactions.length) * 100).toFixed(0) + '%' : 'N/A',
        tagUsage
    }
}

async function toolAnalyzeSlTpPatterns(knex, params) {
    // Collect tpslHistory from completed trades (in notes.tradingMetadata)
    let query = knex('notes').whereNot('tradingMetadata', '').orderBy('dateUnix', 'desc')
    if (params.startDate) query = query.where('dateUnix', '>=', params.startDate)
    if (params.endDate) query = query.where('dateUnix', '<=', params.endDate)
    const notes = await query.limit(200)

    // Also get trade outcomes for correlation
    const tradesRows = params.startDate && params.endDate
        ? await knex('trades').where('dateUnix', '>=', params.startDate).where('dateUnix', '<=', params.endDate)
        : []
    const tradeOutcomes = {}
    for (const row of tradesRows) {
        let tradesArr = []
        try { tradesArr = JSON.parse(row.trades || '[]') } catch { tradesArr = [] }
        for (const t of tradesArr) {
            if (t.id) tradeOutcomes[t.id] = { grossProceeds: t.grossProceeds || 0, symbol: t.symbol }
        }
    }

    let totalModifications = 0
    let slMoves = 0, tpMoves = 0
    let slWidenings = 0, slTightenings = 0
    let tpWidenings = 0, tpTightenings = 0
    let tradesWithHistory = 0
    let rrrValues = []
    const perTrade = []

    for (const note of notes) {
        let metadata = null
        try { metadata = JSON.parse(note.tradingMetadata) } catch { continue }
        if (!metadata?.tpslHistory || !Array.isArray(metadata.tpslHistory) || metadata.tpslHistory.length === 0) continue

        const history = metadata.tpslHistory
        tradesWithHistory++
        let tradeSlMoves = 0, tradeTpMoves = 0

        for (const h of history) {
            totalModifications++
            if (h.type === 'sl') {
                slMoves++
                tradeSlMoves++
                if (h.action === 'set' || h.action === 'changed') {
                    // Determine if SL was widened (moved further from entry) or tightened
                    if (h.oldVal && h.newVal) {
                        const diff = Math.abs(parseFloat(h.newVal)) - Math.abs(parseFloat(h.oldVal))
                        if (diff > 0) slWidenings++; else slTightenings++
                    }
                }
            }
            if (h.type === 'tp') {
                tpMoves++
                tradeTpMoves++
                if (h.action === 'set' || h.action === 'changed') {
                    if (h.oldVal && h.newVal) {
                        const diff = Math.abs(parseFloat(h.newVal)) - Math.abs(parseFloat(h.oldVal))
                        if (diff > 0) tpWidenings++; else tpTightenings++
                    }
                }
            }
            if (h.rrr) rrrValues.push(h.rrr)
        }

        // Correlate with trade outcome
        const outcome = tradeOutcomes[note.tradeId] || null
        if (params.symbol && outcome && !outcome.symbol?.toLowerCase().includes(params.symbol.toLowerCase())) continue

        perTrade.push({
            tradeId: note.tradeId,
            dateUnix: note.dateUnix,
            symbol: outcome?.symbol || '',
            slModifications: tradeSlMoves,
            tpModifications: tradeTpMoves,
            totalModifications: tradeSlMoves + tradeTpMoves,
            lastRRR: history.filter(h => h.rrr).pop()?.rrr || null,
            outcome: outcome ? (outcome.grossProceeds > 0 ? 'win' : 'loss') : 'unknown',
            pnl: outcome?.grossProceeds?.toFixed(2) || null
        })
    }

    const avgRRR = rrrValues.length > 0 ? (rrrValues.reduce((s, v) => s + v, 0) / rrrValues.length).toFixed(2) : null

    return {
        tradesAnalyzed: tradesWithHistory,
        totalModifications,
        slMoves, tpMoves,
        slTightenings, slWidenings,
        tpTightenings, tpWidenings,
        avgRRR,
        rrrDistribution: rrrValues.length > 0 ? {
            min: Math.min(...rrrValues).toFixed(2),
            max: Math.max(...rrrValues).toFixed(2),
            median: rrrValues.sort((a, b) => a - b)[Math.floor(rrrValues.length / 2)]?.toFixed(2)
        } : null,
        perTrade: perTrade.slice(0, 50)
    }
}

async function toolQuerySettings(knex) {
    const settings = await knex('settings').where('id', 1).first()
    if (!settings) return { error: 'No settings found' }

    // Parse JSON columns
    let tags = [], accounts = [], tradeTimeframes = [], balances = {}
    try { tags = JSON.parse(settings.tags || '[]') } catch { tags = [] }
    try { accounts = JSON.parse(settings.accounts || '[]') } catch { accounts = [] }
    try { tradeTimeframes = JSON.parse(settings.tradeTimeframes || '[]') } catch { tradeTimeframes = [] }
    try { balances = JSON.parse(settings.balances || '{}') } catch { balances = {} }

    return {
        timeZone: settings.timeZone || '',
        language: settings.language || 'de',
        startBalance: settings.startBalance || 0,
        startBalanceDate: settings.startBalanceDate || 0,
        currentBalance: settings.currentBalance || 0,
        balances,
        tagGroups: tags.map(g => ({
            name: g.name,
            tags: (g.tags || []).map(t => t.name)
        })),
        tradeTimeframes,
        aiProvider: settings.aiProvider || 'ollama',
        aiModel: settings.aiModel || '',
        // NO API keys or sensitive data!
    }
}

async function toolQueryScreenshots(knex, params) {
    const limit = Math.min(params.limit || 20, 50)
    let query = knex('screenshots')
        .select('id', 'symbol', 'side', 'date', 'dateUnix', 'name', 'broker', 'aiReview')
        .orderBy('dateUnix', 'desc')

    if (params.startDate) query = query.where('dateUnix', '>=', params.startDate)
    if (params.endDate) query = query.where('dateUnix', '<=', params.endDate)
    if (params.symbol) query = query.where('symbol', 'like', `%${params.symbol}%`)

    query = query.limit(limit)
    const rows = await query

    return {
        count: rows.length,
        screenshots: rows.map(r => ({
            id: r.id,
            symbol: r.symbol || '',
            side: r.side || '',
            date: r.date || '',
            dateUnix: r.dateUnix,
            broker: r.broker || '',
            hasAiReview: !!(r.aiReview && r.aiReview.trim()),
            aiReviewPreview: r.aiReview ? r.aiReview.substring(0, 100) : ''
        }))
    }
}

async function toolAnalyzeScreenshot(knex, params) {
    if (!params.screenshotId) return { error: 'screenshotId is required' }

    const row = await knex('screenshots').where('id', params.screenshotId).first()
    if (!row) return { error: `Screenshot with id ${params.screenshotId} not found` }

    const useAnnotated = params.useAnnotated !== false
    const base64Field = useAnnotated && row.annotatedBase64 ? row.annotatedBase64 : row.originalBase64
    if (!base64Field) return { error: 'Screenshot has no image data' }

    // Extract mime type and raw base64 from data URL
    // Format: data:image/png;base64,iVBORw0K...
    let mediaType = 'image/png'
    let rawBase64 = base64Field
    const dataUrlMatch = base64Field.match(/^data:(image\/[^;]+);base64,(.+)$/)
    if (dataUrlMatch) {
        mediaType = dataUrlMatch[1]
        rawBase64 = dataUrlMatch[2]
    }

    // Return special format with __imageContent marker for the agent loop
    return {
        __imageContent: true,
        mediaType,
        base64: rawBase64,
        metadata: {
            id: row.id,
            symbol: row.symbol || '',
            side: row.side || '',
            date: row.date || '',
            dateUnix: row.dateUnix,
            broker: row.broker || '',
            existingAiReview: row.aiReview || ''
        }
    }
}

// ── Modell-Optimierung: OpenRouter & KI-Modelle ──────────────────

/**
 * Analysiert Performance von KI-Modellen für eine Aufgabe.
 * Liest `ai_usage` Tabelle und berechnet Kosten/Token-Verhältnis.
 */
async function toolAnalyzeModelPerformance(knex, params) {
    const { task, daysBack = 30 } = params
    if (!task) {
        const { AI_TASKS } = await import('./ai-task-config.js')
        return {
            error: 'task erforderlich',
            verfuebareAufgaben: Object.keys(AI_TASKS),
        }
    }

    const startDate = Date.now() - (daysBack * 24 * 60 * 60 * 1000)

    const records = await knex('ai_usage')
        .where('funktion', task)
        .where('createdAt', '>=', new Date(startDate))
        .select('provider', 'modell', 'usage', 'kostenUsd')

    if (records.length === 0) {
        return { hinweis: `Keine Nutzungsdaten für "${task}" in den letzten ${daysBack} Tagen` }
    }

    // Aggregieren nach Provider/Modell
    const byModel = {}
    for (const r of records) {
        const key = `${r.provider}/${r.modell}`
        if (!byModel[key]) {
            byModel[key] = { count: 0, totalTokens: 0, totalCost: 0, kostenProMillionTokens: 0 }
        }
        byModel[key].count++
        const usage = r.usage || {}
        byModel[key].totalTokens += (usage.totalTokens || 0)
        byModel[key].totalCost += (r.kostenUsd || 0)
    }

    // Metriken berechnen
    const modelStats = Object.entries(byModel).map(([model, stats]) => ({
        modell: model,
        nutzungen: stats.count,
        gesamtTokens: stats.totalTokens,
        gesamtKosten: (stats.totalCost).toFixed(4),
        kostenProMillionTokens: stats.totalTokens > 0
            ? (stats.totalCost / (stats.totalTokens / 1_000_000)).toFixed(2)
            : '0',
        kostenProAufruf: (stats.totalCost / stats.count).toFixed(4),
    }))

    return {
        aufgabe: task,
        tage: daysBack,
        modelle: modelStats.sort((a, b) => parseFloat(a.kostenProAufruf) - parseFloat(b.kostenProAufruf)),
    }
}

/**
 * Holt verfügbare OpenRouter-Modelle mit Preisen.
 */
async function toolGetOpenrouterModels(knex, params) {
    const { filterBy = 'all' } = params

    const settings = await knex('settings').select('aiOpenrouterCatalog').where('id', 1).first()
    let cached = {}
    try { cached = JSON.parse(settings?.aiOpenrouterCatalog || '{}') } catch {}

    if (!cached.models || cached.models.length === 0) {
        return { error: 'OpenRouter-Katalog nicht gecacht. Erst /api/ai/openrouter/models aufrufen.' }
    }

    let modelle = cached.models
    if (filterBy === 'cost') {
        modelle = modelle.sort((a, b) => 
            (a.pricing?.prompt || 0) - (b.pricing?.prompt || 0)
        ).slice(0, 10)
    } else if (filterBy === 'speed') {
        modelle = modelle.filter((m) => 
            (m.contextLength || 0) > 50000 && (m.name || '').includes('flash')
        ).slice(0, 10)
    } else if (filterBy === 'quality') {
        modelle = modelle.filter((m) => 
            (m.contextLength || 0) > 100000
        ).slice(0, 10)
    }

    return {
        filter: filterBy,
        count: modelle.length,
        modelle: modelle.map((m) => ({
            id: m.id,
            name: m.name || m.id,
            provider: m.provider,
            contextLength: m.contextLength || 0,
            pricing: m.pricing || { prompt: 0, completion: 0 },
            topProvider: m.topProvider || '',
        })),
    }
}

/**
 * Empfiehlt beste Modell-Zuordnung für alle Aufgaben.
 */
async function toolRecommendModelAllocation(knex, params) {
    const { optimizeFor = 'balance' } = params
    const { AI_TASKS } = await import('./ai-task-config.js')
    const { PREISE } = await import('./ai-preise.js')

    const settings = await knex('settings').select('aiOpenrouterCatalog').where('id', 1).first()
    let cached = {}
    try { cached = JSON.parse(settings?.aiOpenrouterCatalog || '{}') } catch {}

    if (!cached.models || cached.models.length === 0) {
        return { error: 'OpenRouter-Katalog nicht gecacht. Erst /api/ai/openrouter/models aufrufen.' }
    }

    // Scoring pro Modell für Aufgabe
    const recommendations = {}
    for (const [taskId, task] of Object.entries(AI_TASKS)) {
        if (!task.recommendedModels || task.recommendedModels.length === 0) continue

        let candidates = []
        for (const modelName of task.recommendedModels) {
            const fullName = `anthropic/${modelName}` // Vereinfachung: nur OpenRouter-Namen
            const preis = Object.entries(PREISE).find(([k]) => k.includes(modelName))
            if (preis) {
                candidates.push({
                    model: modelName,
                    fullName,
                    costPerMillion: preis[1]?.[0] || 0,  // prompt price
                    quality: task.importance === 'high' ? 1 : (task.importance === 'medium' ? 0.7 : 0.4),
                })
            }
        }

        if (candidates.length === 0) continue

        let selected
        if (optimizeFor === 'cost') {
            selected = candidates.sort((a, b) => a.costPerMillion - b.costPerMillion)[0]
        } else if (optimizeFor === 'quality') {
            selected = candidates.sort((a, b) => b.quality - a.quality)[0]
        } else {  // balance
            selected = candidates.sort((a, b) => {
                const scoreA = (b.quality / (a.costPerMillion + 0.1))
                const scoreB = (b.quality / (b.costPerMillion + 0.1))
                return scoreB - scoreA
            })[0]
        }

        if (selected) {
            recommendations[taskId] = {
                aufgabe: task.name,
                empfohleneModelle: {
                    eins: `openrouter/${selected.fullName}`,
                    alternativ: candidates.slice(1).map(c => `openrouter/${c.fullName}`),
                },
                gruende: [
                    task.importance === 'high' ? 'Hohe Anforderungen an Qualität' : undefined,
                    optimizeFor === 'cost' ? 'Kostenoptimierung aktiviert' : undefined,
                    optimizeFor === 'balance' ? 'Beste Balance zwischen Kosten und Qualität' : undefined,
                ].filter(Boolean),
            }
        }
    }

    return {
        optimierungsziel: optimizeFor,
        empfehlungen: recommendations,
        einstellungen: {
            pfad: 'Einstellungen → KI → OpenRouter-Modelle',
            spalte: 'aiTaskProviders',
        },
    }
}
