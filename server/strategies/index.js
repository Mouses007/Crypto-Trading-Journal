/**
 * Strategie-Registry.
 *
 * Eine Strategie ist ein Modul mit einem Manifest. Das Manifest beschreibt seine
 * Parameter selbst (`params`), und aus dieser Beschreibung entstehen automatisch:
 *   - das Einstellungsformular im Frontend (StrategyParamForm.vue)
 *   - die serverseitige Validierung beim Speichern einer Instanz
 *   - die Grenzen, innerhalb derer der Optimizer-Agent Vorschläge machen darf
 *
 * Dadurch kostet eine weitere Strategie genau eine Datei und null Zeilen Vue.
 *
 * Die Erkennungslogik (`detect`) muss eine REINE Funktion sein: gleiche Kerzen +
 * gleiche Parameter = gleiches Ergebnis. Kein DB-Zugriff, kein Netzwerk, kein
 * LLM, kein Date.now(). Nur so ist die Strategie backtestbar.
 */

import lsob from './lsob.js'
import emaTouch from './ema_touch.js'
import { alsManifest } from './rule-engine.js'
import { pruefeRegeln } from './rule-validate.js'
import { TIMEFRAME_MS } from '../market-data.js'

const registry = new Map()

const PARAM_TYPES = ['number', 'integer', 'boolean', 'select', 'string']

/**
 * Risiko-Parameter sind strategie-UNABHÄNGIG und gelten für jede Instanz.
 * Gleiches Schema-Format wie die Strategie-Parameter, damit das Frontend
 * beide Blöcke mit derselben Komponente rendern kann.
 */
export const RISK_PARAMS = [
    { key: 'startEquityUsdt', type: 'number', default: 1000, min: 10, max: 10000000, step: 10, group: 'size' },
    { key: 'riskPerTradePct', type: 'number', default: 1.0, min: 0.05, max: 10, step: 0.05, group: 'size' },
    { key: 'maxDailyLossPct', type: 'number', default: 3.0, min: 0.1, max: 25, step: 0.1, group: 'limits' },
    { key: 'maxConcurrentPositions', type: 'integer', default: 2, min: 1, max: 20, step: 1, group: 'limits' },
    { key: 'maxNotionalUsdt', type: 'number', default: 500, min: 5, max: 1000000, step: 5, group: 'limits' },
    { key: 'leverage', type: 'number', default: 3, min: 1, max: 125, step: 1, group: 'size' },
    { key: 'cooldownMinutes', type: 'integer', default: 60, min: 0, max: 10080, step: 5, group: 'limits' },
    // Fährt eine Instanz mehrere Zeiteinheiten, konkurrieren sie um dasselbe
    // Symbol: `symbol` (Standard, sicher) lässt nur EINE Position je Coin zu —
    // die schnellste Zeiteinheit gewinnt und die langsameren kommen kaum zum
    // Zug. `symbol_tf` erlaubt je Zeiteinheit eine eigene Position; für den
    // Vergleich der Zeiteinheiten richtig, im Echtgeldbetrieb aber mehrfaches
    // Risiko auf denselben Coin.
    { key: 'duplicateScope', type: 'select', default: 'symbol', options: ['symbol', 'symbol_tf'], group: 'limits' },
    { key: 'minRR', type: 'number', default: 1.5, min: 0.1, max: 20, step: 0.1, group: 'quality' },
    { key: 'feeBps', type: 'number', default: 6, min: 0, max: 100, step: 0.5, group: 'costs' },
    { key: 'slippageBps', type: 'number', default: 2, min: 0, max: 100, step: 0.5, group: 'costs' },
    // Finanzierungskosten je 8-Stunden-Abrechnung, in Basispunkten des
    // Nominalwerts. 0 = nicht modelliert (bisheriges Verhalten).
    //
    // Bewusst KEINE echten historischen Sätze: die müsste man je Symbol und
    // Zeitpunkt laden, und ein halb geladener Satz wäre schlimmer als eine
    // offen genannte Annahme. Wer den Wert setzt, trifft eine Annahme, die im
    // Ergebnis ausgewiesen wird. Gerechnet wird sie als KOSTEN für beide
    // Richtungen — welche Seite zahlt, hängt vom Vorzeichen des echten Satzes
    // ab, und das ist ohne Daten unbekannt. Im Zweifel pessimistisch, wie im
    // Rest der Ausführungs-Simulation.
    { key: 'fundingBpsPer8h', type: 'number', default: 0, min: 0, max: 50, step: 0.1, group: 'costs' },
    // Wartungsmarge in Prozent des Nominalwerts — bestimmt, ab wann die Börse
    // zwangsschliesst. Greift nur, wenn der Hebel so hoch ist, dass die Marge
    // vor dem Stop aufgebraucht wäre; bei moderatem Hebel ändert sie nichts.
    { key: 'maintenanceMarginPct', type: 'number', default: 0.5, min: 0, max: 5, step: 0.1, group: 'costs' },
    { key: 'maxPriceDeviationPct', type: 'number', default: 0.5, min: 0.01, max: 10, step: 0.01, group: 'quality' },
]

/** Agent-Konfiguration je Rolle. Beide Rollen sind optional abschaltbar. */
export const AGENT_DEFAULTS = {
    sentiment: { enabled: false, provider: '', model: '', sources: { fearGreed: true, funding: true, news: false } },
    portfolio: { enabled: false, provider: '', model: '' },
    dailyBudgetUsd: 1.0,
    onBudgetExceeded: 'skip_trade',   // skip_trade | trade_without_agents
}

/** Wirft, wenn ein Manifest nicht dem erwarteten Vertrag entspricht. */
function assertManifest(m) {
    if (!m || typeof m !== 'object') throw new Error('Strategie-Manifest fehlt')
    if (!m.id || typeof m.id !== 'string') throw new Error('Strategie ohne id')
    if (typeof m.detect !== 'function') throw new Error(`Strategie ${m.id}: detect() fehlt`)
    if (!Array.isArray(m.params)) throw new Error(`Strategie ${m.id}: params-Schema fehlt`)
    if (!Array.isArray(m.supportedTimeframes) || m.supportedTimeframes.length === 0) {
        throw new Error(`Strategie ${m.id}: supportedTimeframes fehlt`)
    }
    const seen = new Set()
    for (const p of m.params) {
        if (!p.key) throw new Error(`Strategie ${m.id}: Parameter ohne key`)
        if (seen.has(p.key)) throw new Error(`Strategie ${m.id}: doppelter Parameter ${p.key}`)
        seen.add(p.key)
        if (!PARAM_TYPES.includes(p.type)) {
            throw new Error(`Strategie ${m.id}: Parameter ${p.key} hat unbekannten Typ ${p.type}`)
        }
        if (p.default === undefined) throw new Error(`Strategie ${m.id}: Parameter ${p.key} ohne default`)
        if (p.type === 'select' && !Array.isArray(p.options)) {
            throw new Error(`Strategie ${m.id}: Parameter ${p.key} ist select ohne options`)
        }
    }
}

export function registerStrategy(manifest) {
    assertManifest(manifest)
    registry.set(manifest.id, manifest)
    return manifest
}

export function getStrategy(id) {
    return registry.get(id) || null
}

/**
 * Selbst gebaute Regelstrategien aus der DB in die Registry laden.
 *
 * Wird beim Start und nach jeder Änderung aufgerufen. Eingebaute Strategien
 * bleiben unangetastet — sie lassen sich nicht durch eine gleichnamige
 * Regelstrategie überschreiben, sonst könnte man LSOB aus der Oberfläche
 * heraus ersetzen.
 */
export function ladeRegelStrategien(zeilen) {
    // Erst alle bisherigen Regelstrategien entfernen, damit gelöschte
    // verschwinden statt als Karteileiche weiterzuleben.
    for (const [id, m] of [...registry]) {
        if (m.istRegelStrategie) registry.delete(id)
    }

    const geladen = []
    const fehlerhaft = []
    for (const z of zeilen || []) {
        if (EINGEBAUT.has(z.strategyId)) {
            fehlerhaft.push({ strategyId: z.strategyId, fehler: ['Name ist von einer eingebauten Strategie belegt'] })
            continue
        }
        let roh
        try { roh = typeof z.rules === 'object' ? z.rules : JSON.parse(z.rules || '{}') }
        catch { fehlerhaft.push({ strategyId: z.strategyId, fehler: ['Regelbeschreibung ist kein gültiges JSON'] }); continue }

        const g = pruefeRegeln({ ...roh, id: z.strategyId, name: z.name, description: z.description })
        if (!g.ok) { fehlerhaft.push({ strategyId: z.strategyId, fehler: g.fehler }); continue }

        try {
            registerStrategy(alsManifest(g.regeln))
            geladen.push(z.strategyId)
        } catch (e) {
            fehlerhaft.push({ strategyId: z.strategyId, fehler: [e.message] })
        }
    }
    return { geladen, fehlerhaft }
}

/** Manifeste ohne die Funktionen — genau das, was das Frontend braucht. */
export function listStrategies() {
    return [...registry.values()].map((m) => ({
        id: m.id,
        name: m.name || m.id,
        description: m.description || '',
        version: m.version || 1,
        supportedTimeframes: m.supportedTimeframes,
        warmupCandles: m.warmupCandles || 200,
        params: m.params,
        paramGroups: m.paramGroups || [],
    }))
}

/** Defaults aus einem beliebigen Schema (Strategie-Params oder RISK_PARAMS). */
export function defaultsFromSchema(schema) {
    const out = {}
    for (const p of schema) out[p.key] = p.default
    return out
}

export function defaultParams(strategyId) {
    const s = getStrategy(strategyId)
    return s ? defaultsFromSchema(s.params) : {}
}

/**
 * Validiert und normalisiert Parameter gegen ein Schema.
 * Unbekannte Schlüssel fliegen raus, fehlende werden mit dem Default gefüllt,
 * Zahlen werden auf [min, max] geklemmt. Gibt Werte UND Hinweise zurück, damit
 * die UI zeigen kann, was korrigiert wurde.
 *
 * @returns {{ values: object, errors: string[], clamped: string[] }}
 */
export function validateAgainstSchema(schema, input) {
    const values = {}
    const errors = []
    const clamped = []
    const src = input && typeof input === 'object' ? input : {}

    for (const p of schema) {
        const raw = src[p.key]
        if (raw === undefined || raw === null || raw === '') {
            values[p.key] = p.default
            continue
        }

        switch (p.type) {
            case 'boolean':
                values[p.key] = raw === true || raw === 1 || raw === '1' || raw === 'true'
                break

            case 'select':
                if (!p.options.some((o) => (o?.value ?? o) === raw)) {
                    errors.push(`${p.key}: "${raw}" ist keine gültige Option`)
                    values[p.key] = p.default
                } else {
                    values[p.key] = raw
                }
                break

            case 'string':
                values[p.key] = String(raw).slice(0, p.maxLength || 200)
                break

            case 'number':
            case 'integer': {
                let n = Number(raw)
                if (!Number.isFinite(n)) {
                    errors.push(`${p.key}: "${raw}" ist keine Zahl`)
                    values[p.key] = p.default
                    break
                }
                if (p.type === 'integer') n = Math.round(n)
                if (p.min !== undefined && n < p.min) { n = p.min; clamped.push(p.key) }
                if (p.max !== undefined && n > p.max) { n = p.max; clamped.push(p.key) }
                values[p.key] = n
                break
            }
        }
    }

    return { values, errors, clamped }
}

/** Kurzform für Strategie-Parameter. */
export function validateParams(strategyId, input) {
    const s = getStrategy(strategyId)
    if (!s) return { values: {}, errors: [`Unbekannte Strategie: ${strategyId}`], clamped: [] }
    return validateAgainstSchema(s.params, input)
}

export function validateRisk(input) {
    return validateAgainstSchema(RISK_PARAMS, input)
}

/** Wie viele Zeiteinheiten eine Instanz höchstens gleichzeitig fahren darf. */
export const MAX_TIMEFRAMES = 6

/**
 * Zeiteinheiten-Liste einer Instanz säubern.
 *
 * Eine Instanz darf dieselbe Strategie auf mehreren Zeiteinheiten gleichzeitig
 * laufen lassen (15m-Setup wird auf 15m gehandelt, 1h-Setup auf 1h). Erlaubt
 * ist nur, was die Strategie auch unterstützt; die Haupt-Zeiteinheit ist immer
 * dabei und steht vorn. Doppelte fliegen raus, die Reihenfolge ist von fein
 * nach grob — so wird bei knappem Risikobudget nicht zufällig entschieden,
 * welche Zeiteinheit zuerst zum Zug kommt.
 *
 * @param {string|Array} roh     gespeicherte Liste (JSON-Text oder Array)
 * @param {string} haupt         `timeframe` der Instanz
 * @param {object} strategie     Manifest (für `supportedTimeframes`)
 * @returns {string[]}           mindestens `[haupt]`
 */
export function normalisiereTimeframes(roh, haupt, strategie) {
    let liste = roh
    if (typeof liste === 'string') {
        try { liste = JSON.parse(liste) } catch { liste = [] }
    }
    if (!Array.isArray(liste)) liste = []

    const erlaubt = new Set(strategie?.supportedTimeframes || [])
    const raus = []
    for (const tf of [haupt, ...liste]) {
        const s = String(tf || '').trim()
        if (!s || raus.includes(s)) continue
        if (!TIMEFRAME_MS[s]) continue
        if (erlaubt.size && !erlaubt.has(s)) continue
        raus.push(s)
    }
    if (!raus.length && haupt) raus.push(haupt)
    // Erst kappen, dann sortieren: `haupt` steht vorn und überlebt die Grenze
    // damit immer. Andersherum könnte die Haupt-Zeiteinheit herausfallen.
    return raus.slice(0, MAX_TIMEFRAMES).sort((a, b) => TIMEFRAME_MS[a] - TIMEFRAME_MS[b])
}

// ── Eingebaute Strategien ────────────────────────────────────────────────
// Ihre Namen sind reserviert: eine selbst gebaute Strategie darf sie nicht
// überschreiben.
registerStrategy(lsob)
registerStrategy(emaTouch)

export const EINGEBAUT = new Set([...registry.keys()])
export const istEingebaut = (id) => EINGEBAUT.has(id)
