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
import { logError, logWarn } from './logger.js'
import {
    listStrategies, getStrategy, validateParams, validateRisk,
    defaultsFromSchema, RISK_PARAMS, AGENT_DEFAULTS,
    ladeRegelStrategien, istEingebaut,
    normalisiereTimeframes, MAX_TIMEFRAMES,
} from './strategies/index.js'
import { BAUSTEINE } from './strategies/rule-engine.js'
import { pruefeRegeln, regelnUnterscheidenSich } from './strategies/rule-validate.js'
import { regelnAlsSaetze } from './strategies/rule-text.js'
import { VORLAGEN } from './strategies/rule-templates.js'
import { isValidTimeframe, timeframeMs, getLastPrice } from './market-data.js'
import { runBacktest, berechneStatistik, MAX_BACKTEST_CANDLES, schaetzeKerzen } from './strategy-backtest.js'
import { monteCarlo, parameterStabilitaet, stabilitaetsMatrix, walkForward, MAX_STUFEN } from './robustness.js'
import { engineStatus, resetSymbolCache, killSwitch, ladeInstanz, tick, schliessePositionManuell } from './strategy-engine.js'
import { bewerteGates } from './live-gates.js'
import { spiegleInsJournal, entferneAusJournal } from './journal-bridge.js'

const MAX_SYMBOLS = 20
const SYMBOL_RE = /^[A-Z0-9]{2,20}$/

// Kennung der Austauschdatei. Ohne sie wäre jede beliebige JSON-Datei ein
// Importversuch — mit ihr gibt es eine verständliche Fehlermeldung statt eines
// Validierungsfehlers über Bausteine, die der Nutzer nie geschrieben hat.
const PAKET_FORMAT = 'ctj-strategie'
const PAKET_VERSION = 1

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
        timeframes: parseJson(row.timeframes, []),
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

    // Mehrere Zeiteinheiten je Instanz: dieselbe Strategie läuft auf jeder für
    // sich (15m-Setup wird auf 15m gehandelt, 1h-Setup auf 1h), aber unter EINEM
    // Risikobudget. `timeframe` bleibt die Haupt-Zeiteinheit und ist immer dabei.
    const rohTimeframes = body.timeframes !== undefined
        ? body.timeframes
        : parseJson(vorhanden?.timeframes, [])
    if (Array.isArray(rohTimeframes)) {
        for (const tf of rohTimeframes) {
            const s = String(tf || '').trim()
            if (!s || s === timeframe) continue
            if (!isValidTimeframe(s)) fehler.push(`Ungültige Zeiteinheit: ${s}`)
            else if (strategie && !strategie.supportedTimeframes.includes(s)) {
                fehler.push(`${strategie.name} unterstützt ${s} nicht`)
            }
        }
        if (rohTimeframes.length > MAX_TIMEFRAMES) {
            fehler.push(`Höchstens ${MAX_TIMEFRAMES} Zeiteinheiten je Instanz`)
        }
    }
    const timeframes = normalisiereTimeframes(rohTimeframes, timeframe, strategie)

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
            timeframes: JSON.stringify(timeframes),
            symbols: JSON.stringify(symbols),
            params: JSON.stringify(params.values),
            risk: JSON.stringify(risk.values),
            agents: JSON.stringify({ ...AGENT_DEFAULTS, ...parseJson(vorhanden?.agents, {}), ...(body.agents || {}) }),
        },
        hinweise: [...params.clamped, ...risk.clamped],
        neueParams: params.values,
    }
}

/**
 * Version in die Parameter-Historie schreiben. `onConflict`-frei gehalten:
 * der Unique-Index fängt Doppelläufe ab, ein Konflikt ist dann kein Fehler.
 */
async function historieSchreiben(knexOderTrx, instanceId, paramsVersion, params, risk, source) {
    try {
        await knexOderTrx('strategy_param_history').insert({
            instanceId, paramsVersion, params, risk, source,
        })
    } catch (e) {
        if (!/unique|constraint/i.test(e.message)) throw e
    }
}

/**
 * Reifegrad einer Instanz aus den gespeicherten Daten.
 *
 * Zusammengetragen wird nur, was ohnehin vorliegt: die Backtests dieser Instanz
 * (oder ihrer Strategie), die Zahl abgeschlossener Papier-Trades und die
 * Mindestzahl aus den Einstellungen.
 */
async function ladeReifegrad(row) {
    const knex = getKnex()
    const [laeufe, papier, s] = await Promise.all([
        knex('strategy_backtests')
            .where(function () { this.where('instanceId', row.id).orWhere('strategyId', row.strategyId) })
            .select('stats', 'risk', 'entscheidung').orderBy('id', 'desc').limit(200),
        knex('strategy_trades').where({ instanceId: row.id })
            .whereIn('mode', ['paper', 'shadow']).count({ n: '*' }).first(),
        knex('settings').select('strategyMinPaperTrades').where('id', 1).first(),
    ])
    return bewerteGates({
        laeufe: laeufe.map((l) => ({
            stats: parseJson(l.stats, {}), risk: parseJson(l.risk, {}), entscheidung: l.entscheidung,
        })),
        paperTrades: Number(papier?.n) || 0,
        minPaperTrades: Number(s?.strategyMinPaperTrades) || 0,
    })
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
            await historieSchreiben(knex, id, 1, geprueft.werte.params, geprueft.werte.risk, 'angelegt')
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
            // Die Freigabe galt für einen KONKRETEN Handelszustand. Ändert sich
            // etwas Handelsrelevantes (Parameter, Risiko, Symbole, Strategie,
            // Zeiteinheit), muss neu freigegeben werden — sonst handelt eine
            // "genehmigte" Instanz nachträglich völlig andere Logik.
            const handelsrelevant = paramsGeaendert
                || geprueft.werte.symbols !== vorhanden.symbols
                || geprueft.werte.strategyId !== vorhanden.strategyId
                || geprueft.werte.timeframe !== vorhanden.timeframe
                || geprueft.werte.timeframes !== JSON.stringify(normalisiereTimeframes(
                    vorhanden.timeframes, vorhanden.timeframe, getStrategy(vorhanden.strategyId)))
            if (handelsrelevant && vorhanden.liveApprovedAt) {
                aktualisierung.liveApprovedAt = 0
            }

            await knex('strategy_instances').where('id', req.params.id).update(aktualisierung)
            if (paramsGeaendert) {
                await historieSchreiben(knex, Number(req.params.id), aktualisierung.paramsVersion,
                    geprueft.werte.params, geprueft.werte.risk, 'manuell')
            }
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
                // Der Not-Aus wird hier NICHT aufgehoben. Er ist eine bewusste
                // Entscheidung und darf nur dort zurückgenommen werden, wo er
                // gesetzt wurde — sonst hebt ein beiläufiger Start-Klick den
                // Notfallzustand auf.
                const schalterRow = await knex('settings').where('id', 1).select('strategyKillSwitch').first()
                if (schalterRow?.strategyKillSwitch) {
                    return res.status(409).json({ error: 'Not-Aus ist aktiv — zuerst in den Einstellungen aufheben' })
                }
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
    /** Reifegrad einer Instanz — welche Nachweise fehlen noch für den scharfen Betrieb? */
    app.get('/api/strategies/instances/:id/readiness', async (req, res) => {
        try {
            const row = await getKnex()('strategy_instances').where('id', req.params.id).first()
            if (!row) return res.status(404).json({ error: 'Instanz nicht gefunden' })
            res.json(await ladeReifegrad(row))
        } catch (e) {
            logError('strategy-api', 'Reifegrad fehlgeschlagen', e)
            res.status(500).json({ error: 'Reifegrad konnte nicht ermittelt werden' })
        }
    })

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

            // Die Belege. Ohne sie ist die Freigabe eine Absichtserklärung —
            // eine Strategie mit sieben Trades, ohne Gebühren gerechnet, deren
            // Ergebnis an einem Ausreisser hängt, käme sonst durch.
            const reife = await ladeReifegrad(row)
            if (!reife.bereit) {
                return res.status(409).json({
                    error: `Noch nicht freigabereif — offene Nachweise: ${reife.offen.join(', ')}`,
                    tore: reife.tore, offen: reife.offen,
                })
            }

            await knex('strategy_instances').where('id', row.id)
                .update({ liveApprovedAt: Date.now(), updatedAt: knex.fn.now() })
            res.json({ ok: true })
        } catch (e) {
            logError('strategy-api', 'Live-Freigabe fehlgeschlagen', e)
            res.status(500).json({ error: 'Freigabe fehlgeschlagen' })
        }
    })

    /**
     * Entscheidung zu einem Lauf festhalten.
     *
     * Ohne diesen Schritt bleibt die Liste der Durchläufe eine Sammlung von
     * Zahlen, aus der niemand mehr herausliest, was daraus folgte — und in vier
     * Wochen ist die Antwort auf „warum haben wir 15m verworfen?" ein
     * Gesprächsverlauf statt ein Eintrag.
     */
    app.post('/api/strategies/backtests/:id/decision', async (req, res) => {
        try {
            const erlaubt = ['offen', 'uebernommen', 'verworfen']
            const entscheidung = String(req.body?.entscheidung || '')
            if (!erlaubt.includes(entscheidung)) {
                return res.status(400).json({ error: `Entscheidung muss eine von ${erlaubt.join(', ')} sein` })
            }
            const knex = getKnex()
            const treffer = await knex('strategy_backtests').where('id', Number(req.params.id)).update({
                entscheidung,
                notiz: String(req.body?.notiz || '').slice(0, 500),
                // „offen" nimmt die Entscheidung zurück — dann gehört auch der
                // Zeitstempel weg, sonst behauptet die Zeile etwas Falsches.
                entschiedenAm: entscheidung === 'offen' ? 0 : Date.now(),
            })
            if (!treffer) return res.status(404).json({ error: 'Lauf nicht gefunden' })
            res.json({ ok: true, entscheidung })
        } catch (e) {
            logError('strategy-api', 'Entscheidung fehlgeschlagen', e)
            res.status(500).json({ error: 'Entscheidung konnte nicht gespeichert werden' })
        }
    })

    /**
     * Geschlossene Trades einer Instanz ins Journal spiegeln.
     *
     * Sie landen dort in einer EIGENEN Kategorie („Agent") und sind nur
     * sichtbar, wenn man sie ausdrücklich wählt — die normale Ansicht und die
     * Bilanz bleiben unberührt. Ohne diese Trennung würde simuliertes Geld in
     * echte Kennzahlen laufen.
     *
     * Der Aufruf ist wiederholbar: bereits gespiegelte Trades werden erkannt.
     */
    app.post('/api/strategies/instances/:id/mirror-journal', async (req, res) => {
        try {
            const knex = getKnex()
            const inst = await knex('strategy_instances').where('id', req.params.id).first()
            if (!inst) return res.status(404).json({ error: 'Instanz nicht gefunden' })

            // Auswahl ist der Normalfall, „alle" die Ausnahme: wer 500 Trades
            // hat, will selten alle spiegeln.
            const auswahl = Array.isArray(req.body?.tradeIds)
                ? req.body.tradeIds.map(Number).filter(Number.isFinite) : []
            const trades = await knex('strategy_trades')
                .where({ instanceId: inst.id })
                .whereNot('exitTime', 0)
                .modify((q) => { if (auswahl.length) q.whereIn('id', auswahl) })
                .orderBy('exitTime')
            if (!trades.length) return res.json({ gespiegelt: 0, uebersprungen: 0, tage: 0 })

            // Kontoname macht im Journal sichtbar, WOHER die Trades stammen und
            // dass sie nicht echt sind.
            const account = `agent-${inst.mode}`
            const ergebnis = await spiegleInsJournal(knex, trades, { account })

            // Rückverweis setzen: `journalTradeId` stand seit jeher im Schema
            // („>0 = ins Journal übernommen") und wurde nie gefüllt.
            if (ergebnis.gespiegelt > 0) {
                await knex('strategy_trades').where({ instanceId: inst.id })
                    .whereNot('exitTime', 0)
                    .modify((q) => { if (auswahl.length) q.whereIn('id', auswahl) })
                    .update({ journalTradeId: 1 })
            }
            res.json({ ...ergebnis, account })
        } catch (e) {
            logError('strategy-api', 'Spiegeln ins Journal fehlgeschlagen', e)
            res.status(500).json({ error: `Spiegeln fehlgeschlagen: ${e.message}` })
        }
    })

    /**
     * Gespiegelte Trades wieder aus dem Journal nehmen.
     *
     * Ohne Auswahl werden ALLE Agenten-Trades entfernt — auch die anderer
     * Instanzen. Das ist Absicht: „aufräumen" soll aufräumen. Mit `tradeIds`
     * trifft es genau die genannten.
     */
    app.post('/api/strategies/journal/unmirror', async (req, res) => {
        try {
            const knex = getKnex()
            const ids = Array.isArray(req.body?.tradeIds)
                ? req.body.tradeIds.map(Number).filter(Number.isFinite) : []
            const ergebnis = await entferneAusJournal(knex, ids)
            if (ids.length) await knex('strategy_trades').whereIn('id', ids).update({ journalTradeId: 0 })
            else await knex('strategy_trades').update({ journalTradeId: 0 })
            res.json(ergebnis)
        } catch (e) {
            logError('strategy-api', 'Entspiegeln fehlgeschlagen', e)
            res.status(500).json({ error: `Entfernen fehlgeschlagen: ${e.message}` })
        }
    })

    /**
     * Ein Trade und die Fassung, unter der er entstand.
     *
     * Das ist die Brücke zurück: `paramsVersion` steht am Trade, die Werte
     * dazu in der Parameter-Historie, die Regeln in der Regel-Historie. Ohne
     * diesen Weg zeigt ein alter Trade auf eine Strategie, deren Einstellungen
     * inzwischen andere sind — und niemand kann mehr sagen, wonach er gehandelt
     * wurde.
     */
    app.get('/api/strategies/trades/:id/context', async (req, res) => {
        try {
            const knex = getKnex()
            const trade = await knex('strategy_trades').where('id', Number(req.params.id)).first()
            if (!trade) return res.status(404).json({ error: 'Trade nicht gefunden' })

            const instanz = await knex('strategy_instances').where('id', trade.instanceId).first()
            const stand = await knex('strategy_param_history')
                .where({ instanceId: trade.instanceId, paramsVersion: trade.paramsVersion }).first()

            // Regelfassung: die zum Zeitpunkt des Trades jüngste, die nicht
            // NACH ihm entstanden ist. Eine spätere Fassung hat ihn nicht erzeugt.
            let regelStand = null
            const regelZeilen = await knex('rule_strategy_history')
                .where('strategyId', trade.strategyId).orderBy('version', 'desc')
            regelStand = regelZeilen.find((z) => Number(z.createdAt) <= Number(trade.createdAt || Date.now()))
                || regelZeilen[regelZeilen.length - 1] || null

            const regeln = regelStand ? parseJson(regelStand.rules, null) : getStrategy(trade.strategyId)?.regeln
            res.json({
                trade: { ...trade, objectId: String(trade.id) },
                instanz: instanz ? { id: instanz.id, name: instanz.name, mode: instanz.mode } : null,
                paramsVersion: trade.paramsVersion,
                params: stand ? parseJson(stand.params, {}) : null,
                risk: stand ? parseJson(stand.risk, {}) : null,
                quelle: stand?.source || null,
                ruleVersion: regelStand ? Number(regelStand.version) : null,
                saetze: regeln ? regelnAlsSaetze(regeln) : [],
            })
        } catch (e) {
            logError('strategy-api', 'Trade-Kontext fehlgeschlagen', e)
            res.status(500).json({ error: 'Kontext konnte nicht geladen werden' })
        }
    })

    // ── Robustheit ───────────────────────────────────────────────────────
    // Drei Stufen zwischen „guter Backtest" und „belastbar". Alle rechnen auf
    // demselben Simulator wie der Backtest — eine Prüfung mit eigenen Regeln
    // würde etwas anderes messen als das, was sie beurteilen soll.

    /** Gemeinsame Eingabeprüfung: Strategie, Symbol, Zeitraum. */
    /**
     * Der globale Hebeldeckel aus den Einstellungen — derselbe, den die Engine
     * in JEDER Betriebsart anwendet. Das Labor muss ihn kennen, sonst misst es
     * Positionsgrössen, die der Papierbetrieb nie eingehen würde.
     * Bei Fehlern lieber ungekappt rechnen als den Lauf verweigern; die Zahl
     * steht im Ergebnis (`leverageEffektiv`), also fällt es auf.
     */
    async function globalerHebelDeckel() {
        try {
            const s = await getKnex()('settings').select('strategyMaxLeverage').where('id', 1).first()
            return Number(s?.strategyMaxLeverage) || 10
        } catch (e) {
            logWarn('strategy-api', 'Hebeldeckel nicht lesbar — Lauf rechnet ohne Kappung')
            return 0
        }
    }

    async function robustBasis(b) {
        const strategie = getStrategy(b.strategyId)
        if (!strategie) return { fehler: `Unbekannte Strategie: ${b.strategyId}` }
        if (!isValidTimeframe(b.timeframe)) return { fehler: 'Ungültige Zeiteinheit' }
        if (!strategie.supportedTimeframes.includes(b.timeframe)) {
            return { fehler: `${strategie.name} unterstützt ${b.timeframe} nicht` }
        }
        const symbol = String(b.symbol || '').toUpperCase()
        if (!SYMBOL_RE.test(symbol)) return { fehler: 'Ungültiges Symbol' }
        const toTs = Number(b.toTs) || Date.now()
        const fromTs = Number(b.fromTs) || (toTs - 180 * 86400000)
        if (fromTs >= toTs) return { fehler: 'Zeitraum ist leer' }
        return {
            basis: {
                strategyId: b.strategyId, params: b.params || {}, risk: b.risk || {},
                symbol, timeframe: b.timeframe,
                market: b.market === 'spot' ? 'spot' : 'futures',
                fromTs, toTs, startEquity: Number(b.startEquity) || 1000,
                // Der Deckel wird bei jedem Robustheitslauf mitgegeben, sonst
                // rechnen Monte Carlo, Stabilität und Walk-forward mit einem
                // Hebel, den der Betrieb gar nicht zulässt.
                maxLeverage: await globalerHebelDeckel(),
            },
        }
    }

    /**
     * Monte Carlo auf einem frisch gerechneten Backtest. Zeigt, wie schlimm es
     * zwischendurch aussehen konnte — die Frage, die ein Erwartungswert nicht
     * beantwortet.
     */
    app.post('/api/strategies/robustness/montecarlo', async (req, res) => {
        try {
            const b = req.body || {}
            const { basis, fehler } = await robustBasis(b)
            if (fehler) return res.status(400).json({ error: fehler })
            const geschaetzt = schaetzeKerzen(basis.fromTs, basis.toTs, basis.timeframe)
            if (geschaetzt > MAX_BACKTEST_CANDLES) {
                return res.status(400).json({ error: `Zeitraum zu gross: ~${geschaetzt} Kerzen` })
            }
            const lauf = await runBacktest(basis)
            res.json({
                stats: lauf.stats,
                monteCarlo: monteCarlo(lauf.trades, {
                    startEquity: basis.startEquity,
                    laeufe: Number(b.laeufe) || 1000,
                    aussaat: Number(b.aussaat) || 1,
                }),
            })
        } catch (e) {
            logError('strategy-api', 'Monte Carlo fehlgeschlagen', e)
            res.status(500).json({ error: `Monte Carlo fehlgeschlagen: ${e.message}` })
        }
    })

    /**
     * Parameterstabilität: einen Wert in Stufen durchfahren und die Nachbarschaft
     * zeigen. Ein Gipfel zwischen Abstürzen ist Zufall, kein Ergebnis.
     */
    app.post('/api/strategies/robustness/stability', async (req, res) => {
        try {
            const b = req.body || {}
            const { basis, fehler } = await robustBasis(b)
            if (fehler) return res.status(400).json({ error: fehler })

            const werte = Array.isArray(b.werte) ? b.werte.slice(0, MAX_STUFEN) : []
            if (werte.length < 3) return res.status(400).json({ error: 'Mindestens drei Werte angeben' })
            const geschaetzt = schaetzeKerzen(basis.fromTs, basis.toTs, basis.timeframe)
            if (geschaetzt * werte.length > MAX_BACKTEST_CANDLES * 10) {
                return res.status(400).json({ error: 'Zeitraum × Stufen zu gross — Zeitraum kürzen oder weniger Stufen' })
            }
            res.json(await parameterStabilitaet(basis, String(b.paramKey || ''), werte))
        } catch (e) {
            logError('strategy-api', 'Stabilitätslauf fehlgeschlagen', e)
            res.status(500).json({ error: `Stabilitätslauf fehlgeschlagen: ${e.message}` })
        }
    })

    /**
     * Stabilität über mehrere Symbole UND beide Zeitfenster.
     *
     * Die ehrlichere Fassung von `/stability`: eine einzelne Kurve auf einem
     * Symbol verleitet dazu, ein Zufallsplateau für eine Eigenschaft der
     * Strategie zu halten — genau das ist am 16.08.2026 passiert.
     */
    app.post('/api/strategies/robustness/stability-matrix', async (req, res) => {
        try {
            const b = req.body || {}
            const { basis, fehler } = await robustBasis(b)
            if (fehler) return res.status(400).json({ error: fehler })
            const werte = Array.isArray(b.werte) ? b.werte.slice(0, MAX_STUFEN) : []
            if (werte.length < 3) return res.status(400).json({ error: 'Mindestens drei Werte angeben' })

            const symbole = (Array.isArray(b.symbole) ? b.symbole : [])
                .map((x) => String(x).toUpperCase().trim()).filter((x) => SYMBOL_RE.test(x)).slice(0, 8)
            const geschaetzt = schaetzeKerzen(basis.fromTs, basis.toTs, basis.timeframe)
            if (geschaetzt * werte.length * Math.max(1, symbole.length) > MAX_BACKTEST_CANDLES * 40) {
                return res.status(400).json({ error: 'Zeitraum × Stufen × Symbole zu gross — bitte eingrenzen' })
            }
            res.json(await stabilitaetsMatrix(basis, String(b.paramKey || ''), werte, { symbole }))
        } catch (e) {
            logError('strategy-api', 'Stabilitätsmatrix fehlgeschlagen', e)
            res.status(500).json({ error: `Stabilitätsmatrix fehlgeschlagen: ${e.message}` })
        }
    })

    /**
     * Walk-forward: rollend auswählen, immer auf dem folgenden ungesehenen
     * Abschnitt prüfen. Die Summe der Prüfabschnitte ist die Kurve, die man
     * damals wirklich gehandelt hätte.
     */
    app.post('/api/strategies/robustness/walkforward', async (req, res) => {
        try {
            const b = req.body || {}
            const { basis, fehler } = await robustBasis(b)
            if (fehler) return res.status(400).json({ error: fehler })
            const werte = Array.isArray(b.werte) ? b.werte.slice(0, MAX_STUFEN) : []
            if (werte.length < 2) return res.status(400).json({ error: 'Mindestens zwei Werte angeben' })

            // Derselbe Deckel wie bei /stability — er fehlte hier, obwohl
            // Walk-forward MEHR rechnet: je Fenster ein Backtest pro Stufe plus
            // einer zur Prüfung. Die Optimierungsabschnitte sind zusammen etwa
            // so breit wie der ganze Zeitraum, also kostet der Lauf grob
            // Zeitraum × Stufen Kerzen. Ohne Grenze blockiert ein Laborlauf den
            // Hauptprozess — und damit auch Live-Takt und Not-Aus.
            const geschaetzt = schaetzeKerzen(basis.fromTs, basis.toTs, basis.timeframe)
            if (geschaetzt * werte.length > MAX_BACKTEST_CANDLES * 10) {
                return res.status(400).json({ error: 'Zeitraum × Stufen zu gross — Zeitraum kürzen oder weniger Stufen' })
            }
            res.json(await walkForward(basis, String(b.paramKey || ''), werte, { fenster: Number(b.fenster) || 4 }))
        } catch (e) {
            logError('strategy-api', 'Walk-forward fehlgeschlagen', e)
            res.status(500).json({ error: `Walk-forward fehlgeschlagen: ${e.message}` })
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
            if (!strategie.supportedTimeframes.includes(b.timeframe)) {
                return res.status(400).json({ error: `${strategie.name} unterstützt ${b.timeframe} nicht` })
            }

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
                maxLeverage: await globalerHebelDeckel(),
            })

            // Ergebnis sichern, damit ein Optimizer-Vorschlag darauf zeigen kann
            let backtestId = 0
            if (b.save !== false && ergebnis.trades.length >= 0) {
                const knex = getKnex()
                const isPg = knex.client.config.client === 'pg'
                // Fassung der Regelstrategie festhalten: ohne sie zeigt ein alter
                // Lauf auf eine Strategie, deren Regeln inzwischen andere sind.
                const regelZeile = await knex('rule_strategies')
                    .where('strategyId', b.strategyId).select('version').first()

                const datensatz = {
                    strategyId: b.strategyId,
                    instanceId: Number(b.instanceId) || 0,
                    label: String(b.label || '').slice(0, 120),
                    symbol, timeframe: b.timeframe,
                    market: b.market === 'spot' ? 'spot' : 'futures',
                    fromTs, toTs,
                    params: JSON.stringify(ergebnis.meta?.params || {}),
                    // Das Kostenmodell gehört zum Ergebnis, nicht zur Umgebung:
                    // dieselben Regeln mit 2 statt 6 Basispunkten sind ein anderer
                    // Test. Ohne diese Zeile war kein Lauf reproduzierbar.
                    risk: JSON.stringify(ergebnis.meta?.risk || {}),
                    ruleVersion: Number(regelZeile?.version) || 0,
                    variantenGeprueft: Math.max(1, Math.min(Number(b.variantenGeprueft) || 1, 10000)),
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

    /**
     * Mehrfach-Test: ein Parametersatz über mehrere Symbole und über zwei
     * Zeitfenster — die erste Hälfte des Zeitraums zum Optimieren, die zweite
     * zum Prüfen.
     *
     * Der Sinn ist eine Regel, keine Bequemlichkeit: eine Einstellung, die nur
     * in dem Fenster gut aussieht, in dem sie ausgewählt wurde, ist wertlos.
     * Wer von Hand nacheinander testet, sieht das nicht — deshalb rechnet diese
     * Route beides zusammen aus und stellt es nebeneinander.
     *
     * Optional wird ein Vergleichssatz (`baselineParams`) mitgerechnet; dann
     * enthält die Antwort die Differenz je Feld und ein Urteil, in wie vielen
     * Feldern der Kandidat besser ist.
     *
     * Ergebnisse werden NICHT gespeichert — sonst füllt ein Durchlauf mit vier
     * Symbolen die Liste der Läufe mit sechzehn Zeilen.
     */
    app.post('/api/strategies/backtest-matrix', async (req, res) => {
        try {
            const b = req.body || {}
            const strategie = getStrategy(b.strategyId)
            if (!strategie) return res.status(400).json({ error: 'Unbekannte Strategie' })
            if (!isValidTimeframe(b.timeframe)) return res.status(400).json({ error: 'Ungültige Zeiteinheit' })
            if (!strategie.supportedTimeframes.includes(b.timeframe)) {
                return res.status(400).json({ error: `${strategie.name} unterstützt ${b.timeframe} nicht` })
            }

            const symbole = [...new Set((Array.isArray(b.symbols) ? b.symbols : [])
                .map((s) => String(s || '').toUpperCase()).filter((s) => SYMBOL_RE.test(s)))]
            if (!symbole.length) return res.status(400).json({ error: 'Keine gültigen Symbole' })
            // Jeder Lauf holt Kerzen und rechnet sie durch; ohne Deckel wartet
            // der Nutzer minutenlang auf eine Antwort, die längst abgebrochen ist.
            if (symbole.length > 6) return res.status(400).json({ error: 'Höchstens 6 Symbole je Durchlauf' })

            const toTs = Number(b.toTs) || Date.now()
            const fromTs = Number(b.fromTs) || (toTs - 360 * 86400000)
            if (fromTs >= toTs) return res.status(400).json({ error: 'Zeitraum ist leer' })

            const mitte = Math.floor((fromTs + toTs) / 2)
            const fenster = [
                { key: 'optimierung', von: fromTs, bis: mitte },
                { key: 'pruefung', von: mitte, bis: toTs },
            ]

            const proFenster = schaetzeKerzen(fromTs, mitte, b.timeframe)
            if (proFenster > MAX_BACKTEST_CANDLES) {
                return res.status(400).json({
                    error: `Zeitraum zu gross: ~${proFenster} Kerzen je Fenster, erlaubt sind ${MAX_BACKTEST_CANDLES}`,
                })
            }

            const risk = b.risk || {}
            const market = b.market === 'spot' ? 'spot' : 'futures'
            const startEquity = Number(b.startEquity) || 1000
            const maxLeverage = await globalerHebelDeckel()

            const lauf = async (params, symbol, f) => {
                const e = await runBacktest({
                    strategyId: b.strategyId, params, risk, symbol,
                    timeframe: b.timeframe, market,
                    fromTs: f.von, toTs: f.bis, startEquity, maxLeverage,
                })
                // Erwartungswert ohne den grössten Gewinner: trennt eine echte
                // Verbesserung von einem einzelnen Ausreisser, der sie trägt.
                const rs = (e.trades || []).map((t) => Number(t.rMultiple))
                    .filter((v) => Number.isFinite(v)).sort((x, y) => y - x)
                const summe = rs.reduce((a, c) => a + c, 0)
                return {
                    trades: e.stats?.trades ?? 0,
                    expectancyR: e.stats?.expectancyR ?? 0,
                    ohneBestenR: rs.length > 1 ? (summe - rs[0]) / (rs.length - 1) : null,
                    profitFactor: e.stats?.profitFactor ?? null,
                    winRate: e.stats?.winRate ?? 0,
                    returnPct: e.stats?.returnPct ?? 0,
                    maxDrawdownPct: e.stats?.maxDrawdownPct ?? 0,
                }
            }

            const zeilen = []
            let besser = 0
            let felder = 0
            for (const symbol of symbole) {
                for (const f of fenster) {
                    const kandidat = await lauf(b.params || {}, symbol, f)
                    const zeile = { symbol, fenster: f.key, von: f.von, bis: f.bis, kandidat }
                    if (b.baselineParams) {
                        zeile.basis = await lauf(b.baselineParams, symbol, f)
                        zeile.deltaR = kandidat.expectancyR - zeile.basis.expectancyR
                        felder++
                        if (zeile.deltaR > 0) besser++
                    }
                    zeilen.push(zeile)
                }
            }

            res.json({
                strategyId: b.strategyId, timeframe: b.timeframe, market,
                fenster, zeilen,
                // Nur wenn verglichen wurde: das Urteil in einem Satz.
                urteil: b.baselineParams
                    ? {
                        besser, felder,
                        bestanden: felder > 0 && besser === felder,
                        // Vergleicht jemand einen unveränderten Satz mit sich
                        // selbst, sind alle Differenzen null. Ohne diesen
                        // Hinweis liest sich das wie „durchgefallen".
                        identisch: zeilen.every((z) => Math.abs(z.deltaR ?? 0) < 1e-9),
                    }
                    : null,
                hinweis: 'Ein Kandidat zählt erst, wenn er in JEDEM Feld besser ist — '
                    + 'sonst wurde er auf einem Fenster ausgewählt und dort gemessen.',
            })
        } catch (e) {
            logError('strategy-api', 'Mehrfach-Test fehlgeschlagen', e)
            res.status(500).json({ error: `Mehrfach-Test fehlgeschlagen: ${e.message}` })
        }
    })

    app.get('/api/strategies/backtests', async (req, res) => {
        try {
            const knex = getKnex()
            let q = knex('strategy_backtests')
                .select('id', 'strategyId', 'instanceId', 'label', 'symbol', 'timeframe', 'fromTs', 'toTs',
                    'stats', 'risk', 'ruleVersion', 'entscheidung', 'entschiedenAm', 'notiz', 'variantenGeprueft', 'createdAt')
                .orderBy('id', 'desc').limit(Math.min(Number(req.query.limit) || 50, 200))
            if (req.query.instanceId) q = q.where('instanceId', Number(req.query.instanceId))
            const rows = await q
            res.json(rows.map((r) => ({
                ...r, objectId: String(r.id),
                stats: parseJson(r.stats, {}), risk: parseJson(r.risk, {}),
            })))
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

    /**
     * Parameter-Historie einer Instanz — mit der Leistung je Version.
     *
     * Der Diff zwischen den Versionen wird bewusst dem Frontend überlassen:
     * dort steht das Manifest-Schema mit den Anzeigenamen, hier gäbe es nur
     * rohe Schlüssel.
     */
    app.get('/api/strategies/instances/:id/history', async (req, res) => {
        try {
            const knex = getKnex()
            const id = Number(req.params.id)
            const [zeilen, statistik] = await Promise.all([
                knex('strategy_param_history').where('instanceId', id).orderBy('paramsVersion', 'desc'),
                knex('strategy_trades').where('instanceId', id)
                    .select('paramsVersion')
                    .count({ trades: '*' })
                    .sum({ summeR: 'rMultiple', netPnl: 'netPnl' })
                    .groupBy('paramsVersion'),
            ])
            const statsJe = Object.fromEntries(statistik.map((s) => [s.paramsVersion, s]))
            const gewinne = await knex('strategy_trades').where('instanceId', id)
                .where('rMultiple', '>', 0)
                .select('paramsVersion').count({ n: '*' }).groupBy('paramsVersion')
            const gewinneJe = Object.fromEntries(gewinne.map((g) => [g.paramsVersion, Number(g.n)]))

            res.json(zeilen.map((z) => {
                const s = statsJe[z.paramsVersion]
                const n = Number(s?.trades) || 0
                return {
                    paramsVersion: z.paramsVersion,
                    source: z.source,
                    createdAt: z.createdAt,
                    params: parseJson(z.params, {}),
                    risk: parseJson(z.risk, {}),
                    trades: n,
                    summeR: Number(s?.summeR) || 0,
                    netPnl: Number(s?.netPnl) || 0,
                    winRate: n > 0 ? ((gewinneJe[z.paramsVersion] || 0) / n) * 100 : null,
                }
            }))
        } catch (e) {
            logError('strategy-api', 'Historie laden fehlgeschlagen', e)
            res.status(500).json({ error: 'Historie konnte nicht geladen werden' })
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

            // Der Preis kommt ausschliesslich vom Kursfeed. Ein frei wählbarer
            // Preis im Request würde die PnL-Statistik fälschbar machen — und
            // auf ihr bauen Auswertung und Optimizer-Vorschläge auf.
            const preis = await getLastPrice(row.symbol, { market: instance.market })
                .catch(() => Number(row.entryPrice))

            const r = await schliessePositionManuell({
                instance, positionRow: row, price: preis, time: Date.now(),
                costs: { feeBps: instance.risk.feeBps, slippageBps: instance.risk.slippageBps, fundingBpsPer8h: instance.risk.fundingBpsPer8h },
            })
            if (!r.ok) {
                return res.status(502).json({ error: `Position konnte an der Börse nicht geschlossen werden: ${r.reason}` })
            }
            res.json({ ok: true, trade: r.trade })
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

            const neueVersion = (Number(instanz.paramsVersion) || 1) + 1
            await knex.transaction(async (trx) => {
                await trx('strategy_instances').where('id', instanz.id).update({
                    params: geprueft.werte.params,
                    paramsVersion: neueVersion,
                    updatedAt: trx.fn.now(),
                })
                await trx('strategy_suggestions').where('id', vorschlag.id).update({
                    status: 'accepted', decidedAt: Date.now(),
                })
                await historieSchreiben(trx, instanz.id, neueVersion,
                    geprueft.werte.params, instanz.risk, `vorschlag #${vorschlag.id}`)
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
    app.get('/api/strategies/rules/blocks', async (req, res) => {
        // Ausgeblendete Vorlagen fliegen aus der Auswahl, bleiben aber im Code:
        // Ausblenden ist eine Ansichtssache, kein Datenverlust. Die Liste der
        // ausgeblendeten Schlüssel geht mit, damit die Oberfläche „wieder
        // einblenden" anbieten kann.
        let versteckt = []
        try {
            const row = await getKnex()('settings').select('strategyHiddenTemplates').where('id', 1).first()
            versteckt = parseJson(row?.strategyHiddenTemplates, [])
            if (!Array.isArray(versteckt)) versteckt = []
        } catch { versteckt = [] }
        res.json({
            bausteine: BAUSTEINE,
            vorlagen: VORLAGEN.filter((v) => !versteckt.includes(v.key)),
            versteckteVorlagen: versteckt,
        })
    })

    /**
     * Strategie als weitergebbares Paket. Enthält die geprüfte Beschreibung,
     * nicht den Zustand: Instanzen, Trades und Freigaben bleiben ausdrücklich
     * draussen — importiert wird eine Idee, kein Handelsverlauf.
     */
    app.get('/api/strategies/rules/:id/export', async (req, res) => {
        try {
            const row = await getKnex()('rule_strategies').where('id', req.params.id).first()
            if (!row) return res.status(404).json({ error: 'Nicht gefunden' })
            res.json({
                format: PAKET_FORMAT,
                formatVersion: PAKET_VERSION,
                exportiertAm: Date.now(),
                strategie: {
                    strategyId: row.strategyId,
                    name: row.name,
                    description: row.description,
                    version: Number(row.version) || 1,
                    rules: parseJson(row.rules, {}),
                },
            })
        } catch (e) {
            logError('strategy-api', 'Export fehlgeschlagen', e)
            res.status(500).json({ error: 'Export fehlgeschlagen' })
        }
    })

    /**
     * Paket einlesen. Es durchläuft dieselbe Prüfung wie eine von Hand gebaute
     * Strategie — ein fremdes Paket bekommt keinen kürzeren Weg. Der Kurzname
     * wird bei Kollision hochgezählt, damit ein Import nie etwas überschreibt.
     */
    app.post('/api/strategies/rules/import', async (req, res) => {
        try {
            const knex = getKnex()
            const paket = req.body?.paket ?? req.body
            if (!paket || typeof paket !== 'object') {
                return res.status(400).json({ error: 'Kein lesbares Paket' })
            }
            if (paket.format !== PAKET_FORMAT) {
                return res.status(400).json({
                    error: 'Das ist kein Strategie-Paket dieser Anwendung (Feld "format" fehlt oder passt nicht).',
                })
            }
            if (Number(paket.formatVersion) > PAKET_VERSION) {
                return res.status(400).json({
                    error: `Das Paket stammt aus einer neueren Fassung (Format ${paket.formatVersion}, hier ${PAKET_VERSION}).`,
                })
            }
            const s = paket.strategie || {}
            const roh = s.rules
            if (!roh || typeof roh !== 'object') return res.status(400).json({ error: 'Paket enthält keine Regeln' })

            // Wunschname säubern; bei Kollision hochzählen statt überschreiben.
            let ziel = String(req.body?.strategyId || s.strategyId || 'import')
                .toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'import'
            if (istEingebaut(ziel)) ziel = `${ziel}_import`
            const basis = ziel
            for (let n = 2; await knex('rule_strategies').where('strategyId', ziel).first(); n++) {
                ziel = `${basis}_${n}`
                if (n > 50) return res.status(409).json({ error: 'Zu viele gleichnamige Strategien' })
            }

            const g = pruefeRegeln({ ...roh, id: ziel, name: s.name || ziel, description: s.description || '' })
            if (!g.ok) {
                return res.status(400).json({
                    error: `Das Paket ist nicht gültig: ${g.fehler.join('; ')}`, fehler: g.fehler,
                })
            }

            const isPg = knex.client.config.client === 'pg'
            const datensatz = {
                strategyId: ziel, name: g.regeln.name, description: g.regeln.description,
                enabled: 1, rules: JSON.stringify(g.regeln), source: 'import', version: 1,
            }
            const id = isPg
                ? (await knex('rule_strategies').insert(datensatz).returning('id'))[0]?.id
                : (await knex('rule_strategies').insert(datensatz))[0]

            await knex('rule_strategy_history').insert({
                strategyId: ziel, version: 1, name: g.regeln.name, description: g.regeln.description,
                rules: JSON.stringify(g.regeln), source: `import (Quelle ${s.strategyId || '?'} v${s.version || '?'})`,
                createdAt: Date.now(),
            }).catch(() => {})

            await ladeAlleRegelStrategien()
            res.status(201).json({ id, strategyId: ziel, umbenannt: ziel !== (s.strategyId || ''), hinweise: g.hinweise })
        } catch (e) {
            logError('strategy-api', 'Import fehlgeschlagen', e)
            res.status(500).json({ error: 'Import fehlgeschlagen' })
        }
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
        // Die Sätze kommen mit der Prüfung: sie beschreiben, was der Interpreter
        // aus der Eingabe gemacht HAT — nicht, was der Nutzer gemeint haben
        // könnte. Genau deshalb sind sie eine Kontrolle und keine Verzierung.
        res.json({
            ok: g.ok, fehler: g.fehler, hinweise: g.hinweise, regeln: g.regeln,
            saetze: g.regeln ? regelnAlsSaetze(g.regeln) : [],
        })
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
            // Version 1 gleich in die Historie — sonst fehlt später ausgerechnet
            // die Fassung, mit der alles angefangen hat.
            await knex('rule_strategy_history').insert({
                strategyId, version: 1, name: g.regeln.name, description: g.regeln.description,
                rules: JSON.stringify(g.regeln), source: 'angelegt', createdAt: Date.now(),
            }).catch(() => {})
            await ladeAlleRegelStrategien()
            res.status(201).json({ id, strategyId, version: 1, hinweise: g.hinweise })
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
            // Deaktivieren nimmt die Strategie aus der Registry — Instanzen und
            // offene Positionen darauf wären ab dann UNVERWALTET: kein Stop,
            // kein Ziel, und der Not-Aus würde sie still überspringen.
            if (b.enabled === false || b.enabled === 0) {
                const benutzt = await knex('strategy_instances')
                    .where('strategyId', row.strategyId).count({ n: '*' }).first()
                if (Number(benutzt?.n) > 0) {
                    return res.status(409).json({
                        error: `${benutzt.n} Instanz(en) benutzen diese Strategie — erst dort entfernen`,
                    })
                }
            }
            const g = pruefeRegeln({
                ...(b.rules || parseJson(row.rules, {})),
                id: row.strategyId,
                name: b.name ?? row.name,
                description: b.description ?? row.description,
            })
            if (!g.ok) return res.status(400).json({ error: g.fehler.join('; '), fehler: g.fehler })

            // Nur eine echte Regeländerung zählt als neue Version. Umbenennen
            // oder die Beschreibung anzupassen ändert nichts am Handeln und darf
            // deshalb weder die Historie aufblähen noch eine Live-Freigabe kosten.
            //
            // `pruefeRegeln` legt Name und Beschreibung MIT in die Beschreibung,
            // ein roher Textvergleich würde also jedes Umbenennen als Änderung
            // lesen — gemessen und behoben, nicht vermutet.
            const neueRegeln = JSON.stringify(g.regeln)
            const regelnGeaendert = regelnUnterscheidenSich(g.regeln, parseJson(row.rules, {}))
            const version = (Number(row.version) || 1) + (regelnGeaendert ? 1 : 0)

            await knex('rule_strategies').where('id', row.id).update({
                name: g.regeln.name, description: g.regeln.description,
                enabled: b.enabled === undefined ? row.enabled : (b.enabled ? 1 : 0),
                rules: neueRegeln, version, updatedAt: knex.fn.now(),
            })

            let betroffeneInstanzen = 0
            if (regelnGeaendert) {
                await knex('rule_strategy_history').insert({
                    strategyId: row.strategyId, version,
                    name: g.regeln.name, description: g.regeln.description,
                    rules: neueRegeln, source: 'manuell', createdAt: Date.now(),
                }).catch((e) => { if (!/unique|constraint/i.test(e.message)) throw e })

                // Instanzen auf dieser Strategie erben die Änderung, ohne dass
                // jemand sie dort angefasst hätte. Ihre `paramsVersion` muss
                // deshalb mitwandern — sonst landen Trades von vorher und nachher
                // in derselben Schublade und niemand kann sie mehr trennen.
                // Und die Live-Freigabe galt für die ALTE Logik: sie erlischt.
                const instanzen = await knex('strategy_instances')
                    .where('strategyId', row.strategyId)
                    .select('id', 'paramsVersion', 'params', 'risk')
                for (const inst of instanzen) {
                    const neueVersion = (Number(inst.paramsVersion) || 1) + 1
                    await knex('strategy_instances').where('id', inst.id).update({
                        paramsVersion: neueVersion, liveApprovedAt: 0, updatedAt: knex.fn.now(),
                    })
                    await historieSchreiben(knex, inst.id, neueVersion,
                        typeof inst.params === 'string' ? inst.params : JSON.stringify(inst.params || {}),
                        typeof inst.risk === 'string' ? inst.risk : JSON.stringify(inst.risk || {}),
                        `regeländerung v${version}`)
                    resetSymbolCache(inst.id)
                    betroffeneInstanzen++
                }
            }

            await ladeAlleRegelStrategien()
            res.json({ ok: true, hinweise: g.hinweise, version, regelnGeaendert, betroffeneInstanzen })
        } catch (e) {
            logError('strategy-api', 'Regelstrategie ändern fehlgeschlagen', e)
            res.status(500).json({ error: 'Regelstrategie konnte nicht geändert werden' })
        }
    })

    /**
     * Fassungen einer Regelstrategie. Erst damit ist ein alter Trade wieder
     * erklärbar: welche Regeln galten, als er entstand?
     */
    app.get('/api/strategies/rules/:id/history', async (req, res) => {
        try {
            const knex = getKnex()
            const row = await knex('rule_strategies').where('id', req.params.id).first()
            if (!row) return res.status(404).json({ error: 'Nicht gefunden' })
            const fassungen = await knex('rule_strategy_history')
                .where('strategyId', row.strategyId).orderBy('version', 'desc')
            res.json({
                strategyId: row.strategyId,
                aktuelleVersion: Number(row.version) || 1,
                fassungen: fassungen.map((f) => ({ ...f, rules: parseJson(f.rules, {}) })),
            })
        } catch (e) {
            logError('strategy-api', 'Regel-Historie fehlgeschlagen', e)
            res.status(500).json({ error: 'Historie konnte nicht geladen werden' })
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
            await knex('rule_strategy_history').insert({
                strategyId: neueId, version: 1, name: g.regeln.name, description: row.description,
                rules: JSON.stringify(g.regeln), source: `kopie von ${row.strategyId} v${row.version || 1}`,
                createdAt: Date.now(),
            }).catch(() => {})
            await ladeAlleRegelStrategien()
            res.status(201).json({ id, strategyId: neueId, version: 1 })
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
            const gestartet = await tick({ vorher: resetSymbolCache })
            if (!gestartet) {
                // Zwei Gründe, aus denen ein Takt nicht anläuft — sie brauchen
                // verschiedene Antworten. „Läuft schon" löst sich von selbst,
                // „ein anderer Prozess führt" nicht: dort muss der Nutzer wissen,
                // dass dieser Server gar nicht der taktende ist.
                const status = engineStatus()
                if (!status.fuehrung) {
                    return res.status(409).json({
                        error: 'Ein anderer Prozess führt die Engine (z. B. der NAS-Container). '
                            + 'Dieser Server taktet nicht — sonst liefen zwei Engines auf derselben Datenbank.',
                    })
                }
                return res.status(409).json({ error: 'Ein Takt läuft bereits — gleich erneut versuchen' })
            }
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
        // Dieselbe Menge wie in den Kennzahlen: `berechneStatistik` klammert
        // am Stichtag bewertete Positionen aus, also darf die Kurve sie auch
        // nicht enthalten. Im Betrieb entstehen solche Zeilen zwar nicht —
        // aber die Rechnung soll nicht davon abhängen, dass das so bleibt.
        if (t.exitReason === 'open_at_end') continue
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
