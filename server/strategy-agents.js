/**
 * Agenten-Veto.
 *
 * Die entscheidende Regel dieses Moduls: **die Agenten dürfen nur bremsen.**
 * Sie können ein Setup ablehnen oder die Positionsgrösse verkleinern — sie
 * können keines erfinden, keine Kursmarke verschieben und nichts vergrössern.
 * Der deterministische Detector bleibt damit die Wahrheit, und die Strategie
 * bleibt backtestbar. Ein Backtest, dessen Ergebnis von der Tagesform eines
 * Sprachmodells abhinge, wäre wertlos.
 *
 * Aufgerufen wird nur, wenn ein Setup tatsächlich auslöst — nicht bei jedem
 * Scan. Bei vier Symbolen auf 15m sind das rund zehn Aufrufe am Tag statt
 * über tausend.
 *
 * Alles hier ist optional: ohne konfigurierte Rollen handelt die Strategie
 * unverändert weiter.
 */

import { getKnex } from './database.js'
import { logWarn } from './logger.js'
import { ladeLlmConfig, callLLMJson } from './llm.js'
import { getFundingRate } from './market-data.js'
import { startOfDayUtc } from './risk-engine.js'

const FEAR_GREED_URL = 'https://api.alternative.me/fng/?limit=1'
const HTTP_TIMEOUT = 8000

/** Was der Agent antworten darf. Alles andere wird verworfen. */
const ERLAUBTE_AKTIONEN = ['allow', 'reject']

// ── Sentiment-Daten ──────────────────────────────────────────────────────

async function holeFearGreed() {
    try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT)
        const r = await fetch(FEAR_GREED_URL, { signal: ctrl.signal })
        clearTimeout(timer)
        if (!r.ok) return null
        const d = await r.json()
        const eintrag = d?.data?.[0]
        return eintrag ? { wert: Number(eintrag.value), einordnung: eintrag.value_classification } : null
    } catch (e) {
        logWarn('strategy-agents', `Fear&Greed nicht abrufbar: ${e.message}`)
        return null
    }
}

/**
 * Sammelt die aktivierten Sentiment-Quellen. Jede Quelle ist einzeln
 * abschaltbar, und jede fällt bei Fehlern still aus — fehlendes Sentiment darf
 * einen Handelstakt nicht scheitern lassen.
 */
export async function sammleSentiment(symbol, quellen = {}) {
    const daten = {}
    const aufgaben = []

    if (quellen.fearGreed !== false) {
        aufgaben.push(holeFearGreed().then((v) => { if (v) daten.fearGreed = v }))
    }
    if (quellen.funding !== false) {
        aufgaben.push(getFundingRate(symbol).then((v) => {
            if (v) daten.funding = { ratePct: v.rate * 100, naechsteZahlung: v.nextFundingTime }
        }))
    }
    await Promise.all(aufgaben)
    return daten
}

// ── Budget ───────────────────────────────────────────────────────────────

/**
 * Heute bereits verbrauchtes KI-Budget. Ohne Deckel könnte eine fehlerhaft
 * konfigurierte Instanz unbemerkt Geld verbrennen.
 */
async function heutigeKosten() {
    const knex = getKnex()
    const seit = new Date(startOfDayUtc(Date.now()))
    const row = await knex('strategy_runs')
        .where('createdAt', '>=', seit)
        .sum({ summe: 'costUsd' }).first()
    return Number(row?.summe) || 0
}

// ── Prompts ──────────────────────────────────────────────────────────────

const SYSTEM_SENTIMENT = `Du prüfst ein bereits erkanntes Handels-Setup auf Marktumfeld-Risiken.

Du entscheidest NICHT, ob das Chartmuster gültig ist — das steht fest.
Deine einzige Aufgabe: Gibt es im Umfeld einen Grund, diesen Trade NICHT oder
kleiner zu machen?

Antworte ausschliesslich mit JSON:
{"action":"allow"|"reject","sizeFactor":0.0-1.0,"confidence":0.0-1.0,"reason":"kurze Begründung"}

- "allow" mit sizeFactor 1.0 = keine Einwände.
- sizeFactor unter 1.0 verkleinert die Position. Über 1.0 ist nicht erlaubt.
- "reject" nur bei einem konkreten, benennbaren Risiko. Unsicherheit allein ist keines.`

const SYSTEM_PORTFOLIO = `Du bist die letzte Kontrollinstanz vor einer Handelsausführung.

Die Chartanalyse und die harten Risikogrenzen sind bereits geprüft. Du siehst
zusätzlich das Marktumfeld und die offenen Positionen. Deine einzige Frage:
Passt dieser Trade ins Gesamtbild, oder häuft er ein Risiko, das die
Einzelprüfungen nicht sehen (etwa mehrere gleichlaufende Positionen)?

Antworte ausschliesslich mit JSON:
{"action":"allow"|"reject","sizeFactor":0.0-1.0,"confidence":0.0-1.0,"reason":"kurze Begründung"}

Du kannst nur ablehnen oder verkleinern, niemals vergrössern.`

function beschreibeSetup(setup, instance) {
    return JSON.stringify({
        symbol: setup.symbol,
        zeiteinheit: setup.timeframe,
        richtung: setup.direction,
        einstieg: setup.entry,
        stop: setup.stopLoss,
        ziel: setup.takeProfit || null,
        chanceRisiko: Number(setup.rr?.toFixed?.(2) ?? setup.rr) || null,
        orderBlockZone: [setup.obLow, setup.obHigh],
        gesweeptesLevel: setup.sweepLevel,
        bestaetigungen: setup.confirmations || {},
        strategie: instance.strategyId,
    }, null, 1)
}

/** Antwort des Modells auf das erlaubte Format eindampfen. */
function normalisiere(json, rolle) {
    if (!json || typeof json !== 'object') {
        return { action: 'allow', sizeFactor: 1, confidence: 0, reason: `${rolle}: keine verwertbare Antwort`, unklar: true }
    }
    const action = ERLAUBTE_AKTIONEN.includes(json.action) ? json.action : 'allow'
    // Der Deckel bei 1 ist die technische Durchsetzung der Regel »nur bremsen«.
    let sizeFactor = Number(json.sizeFactor)
    if (!Number.isFinite(sizeFactor)) sizeFactor = 1
    sizeFactor = Math.min(Math.max(sizeFactor, 0), 1)
    return {
        action,
        sizeFactor,
        confidence: Math.min(Math.max(Number(json.confidence) || 0, 0), 1),
        reason: String(json.reason || '').slice(0, 400),
    }
}

// ── Der Hook ─────────────────────────────────────────────────────────────

/**
 * Wird von der Engine aufgerufen, sobald ein Setup auslöst.
 *
 * @returns {Promise<{action, sizeFactor, reason, sentiment, portfolio, costUsd}>}
 */
export async function agentenVeto({ instance, setup }) {
    const konf = instance.agents || {}
    const ergebnis = {
        action: 'allow', sizeFactor: 1, reason: '',
        sentiment: {}, portfolio: {}, costUsd: 0,
    }

    const sentimentAn = konf.sentiment?.enabled
    const portfolioAn = konf.portfolio?.enabled
    if (!sentimentAn && !portfolioAn) return ergebnis

    // Budget zuerst — ein überschrittenes Budget darf nicht dazu führen, dass
    // ungeprüft gehandelt wird, es sei denn, das ist ausdrücklich gewünscht.
    const budget = Number(konf.dailyBudgetUsd) || 0
    if (budget > 0 && (await heutigeKosten()) >= budget) {
        if (konf.onBudgetExceeded === 'trade_without_agents') {
            ergebnis.reason = 'KI-Budget erschöpft — ohne Agentenprüfung gehandelt'
            return ergebnis
        }
        return { ...ergebnis, action: 'reject', reason: 'KI-Tagesbudget erschöpft' }
    }

    const knex = getKnex()
    const offene = await knex('strategy_positions')
        .where({ instanceId: instance.id, status: 'open' })
        .select('symbol', 'direction', 'notionalUsdt')

    // ── Sentiment ────────────────────────────────────────────────────
    let sentimentDaten = null
    if (sentimentAn) {
        sentimentDaten = await sammleSentiment(setup.symbol, konf.sentiment.sources || {})
        try {
            const cfg = await ladeLlmConfig({
                provider: konf.sentiment.provider || undefined,
                model: konf.sentiment.model || undefined,
            })
            const antwort = await callLLMJson(cfg, {
                system: SYSTEM_SENTIMENT,
                user: `Setup:\n${beschreibeSetup(setup, instance)}\n\nMarktumfeld:\n${JSON.stringify(sentimentDaten, null, 1)}`,
            })
            ergebnis.costUsd += antwort.costUsd
            ergebnis.sentiment = { ...normalisiere(antwort.json, 'Sentiment'), daten: sentimentDaten, usage: antwort.usage }
        } catch (e) {
            logWarn('strategy-agents', `Sentiment-Agent fehlgeschlagen: ${e.message}`)
            // Ausfall der Agenten darf den deterministischen Teil nicht kippen
            ergebnis.sentiment = { action: 'allow', sizeFactor: 1, reason: `Fehler: ${e.message}`, fehler: true }
        }

        if (ergebnis.sentiment.action === 'reject') {
            return { ...ergebnis, action: 'reject', reason: `Sentiment: ${ergebnis.sentiment.reason}` }
        }
        ergebnis.sizeFactor = Math.min(ergebnis.sizeFactor, ergebnis.sentiment.sizeFactor ?? 1)
    }

    // ── Portfolio ────────────────────────────────────────────────────
    if (portfolioAn) {
        try {
            const cfg = await ladeLlmConfig({
                provider: konf.portfolio.provider || undefined,
                model: konf.portfolio.model || undefined,
            })
            const antwort = await callLLMJson(cfg, {
                system: SYSTEM_PORTFOLIO,
                user: [
                    `Setup:\n${beschreibeSetup(setup, instance)}`,
                    `Marktumfeld:\n${JSON.stringify(sentimentDaten || {}, null, 1)}`,
                    `Bewertung des Sentiment-Agenten:\n${JSON.stringify(ergebnis.sentiment || {}, null, 1)}`,
                    `Offene Positionen dieser Strategie:\n${JSON.stringify(offene, null, 1)}`,
                ].join('\n\n'),
            })
            ergebnis.costUsd += antwort.costUsd
            ergebnis.portfolio = { ...normalisiere(antwort.json, 'Portfolio'), usage: antwort.usage }
        } catch (e) {
            logWarn('strategy-agents', `Portfolio-Agent fehlgeschlagen: ${e.message}`)
            ergebnis.portfolio = { action: 'allow', sizeFactor: 1, reason: `Fehler: ${e.message}`, fehler: true }
        }

        if (ergebnis.portfolio.action === 'reject') {
            return { ...ergebnis, action: 'reject', reason: `Portfolio: ${ergebnis.portfolio.reason}` }
        }
        ergebnis.sizeFactor = Math.min(ergebnis.sizeFactor, ergebnis.portfolio.sizeFactor ?? 1)
    }

    return ergebnis
}
