/**
 * Selbsttest der Zeiteinheiten-Liste einer Instanz.
 *
 *   node server/strategies/__selftest-timeframes.mjs
 *
 * Eine Instanz darf dieselbe Strategie auf mehreren Zeiteinheiten gleichzeitig
 * fahren. Diese Liste entscheidet, WAS die Engine je Takt abarbeitet — steht
 * hier Unsinn, handelt die Instanz auf einer Zeiteinheit, die niemand gewählt
 * hat, oder gar nicht mehr auf der eingestellten.
 */

import { normalisiereTimeframes, MAX_TIMEFRAMES, validateRisk } from './index.js'
import { evaluateRisk, RISK_REASONS } from '../risk-engine.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const strat = { supportedTimeframes: ['5m', '15m', '30m', '1h', '4h', '1d'] }
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('\nZeiteinheiten je Instanz — Selbsttest\n')

{
    check('leer → nur die Haupt-Zeiteinheit',
        gleich(normalisiereTimeframes([], '1h', strat), ['1h']),
        JSON.stringify(normalisiereTimeframes([], '1h', strat)))
    check('null → nur die Haupt-Zeiteinheit',
        gleich(normalisiereTimeframes(null, '1h', strat), ['1h']))
    check('kaputter JSON-Text kippt nicht um',
        gleich(normalisiereTimeframes('{kein json', '1h', strat), ['1h']))
    check('JSON-Text wird gelesen',
        gleich(normalisiereTimeframes('["15m","4h"]', '1h', strat), ['15m', '1h', '4h']),
        JSON.stringify(normalisiereTimeframes('["15m","4h"]', '1h', strat)))
}

{
    // Ohne diese Zusicherung könnte eine Instanz plötzlich NICHT mehr auf der
    // Zeiteinheit laufen, die in ihrer Karte steht.
    check('Haupt-Zeiteinheit ist immer dabei',
        normalisiereTimeframes(['15m'], '4h', strat).includes('4h'))
    check('Doppelte fliegen raus',
        gleich(normalisiereTimeframes(['1h', '1h', '15m'], '1h', strat), ['15m', '1h']))
    check('nicht unterstützte Zeiteinheit fliegt raus',
        gleich(normalisiereTimeframes(['3m', '15m'], '1h', strat), ['15m', '1h']),
        JSON.stringify(normalisiereTimeframes(['3m', '15m'], '1h', strat)))
    check('unbekannte Zeiteinheit fliegt raus',
        gleich(normalisiereTimeframes(['quatsch', '4h'], '1h', strat), ['1h', '4h']))
}

{
    // Fein vor grob: die Engine arbeitet die Liste der Reihe nach ab, und bei
    // knappem Risikobudget soll die Reihenfolge nicht vom Zufall abhängen.
    check('sortiert von fein nach grob',
        gleich(normalisiereTimeframes(['1d', '15m', '4h'], '1h', strat), ['15m', '1h', '4h', '1d']),
        JSON.stringify(normalisiereTimeframes(['1d', '15m', '4h'], '1h', strat)))
}

{
    const viele = ['5m', '15m', '30m', '4h', '1d', '1h']
    const raus = normalisiereTimeframes(viele, '1h', strat)
    check(`höchstens ${MAX_TIMEFRAMES} Zeiteinheiten`, raus.length <= MAX_TIMEFRAMES, String(raus.length))
    // Der Deckel darf niemals ausgerechnet die eingestellte Zeiteinheit kappen.
    check('die Haupt-Zeiteinheit überlebt den Deckel', raus.includes('1h'), JSON.stringify(raus))
}

{
    // Ohne Manifest (z. B. Strategie inzwischen gelöscht) darf nichts explodieren.
    check('ohne Strategie-Manifest bleibt die Haupt-Zeiteinheit',
        gleich(normalisiereTimeframes(['15m'], '1h', null), ['15m', '1h']),
        JSON.stringify(normalisiereTimeframes(['15m'], '1h', null)))
}

// ── Belegung je Symbol bzw. je Symbol+Zeiteinheit ────────────────────────
{
    const setup = { symbol: 'BTCUSDT', timeframe: '1h', direction: 'long', entry: 100, stopLoss: 99, takeProfit: 103, rr: 3 }
    const offen15m = [{ symbol: 'BTCUSDT', timeframe: '15m' }]
    const basis = { equity: 1000, openPositions: offen15m, now: 5 * 3600000 }

    const eng = validateRisk({ duplicateScope: 'symbol', cooldownMinutes: 0 }).values
    const weit = validateRisk({ duplicateScope: 'symbol_tf', cooldownMinutes: 0 }).values

    check('Standard bleibt "symbol"', validateRisk({}).values.duplicateScope === 'symbol',
        String(validateRisk({}).values.duplicateScope))
    check('unsinniger Wert wird abgewiesen',
        validateRisk({ duplicateScope: 'quatsch' }).errors.length > 0)

    const a = evaluateRisk({ ...basis, setup, risk: eng })
    check('"symbol": offene 15m-Position blockiert den 1h-Einstieg',
        !a.ok && a.reason === RISK_REASONS.DUPLICATE, JSON.stringify(a))

    const b = evaluateRisk({ ...basis, setup, risk: weit })
    check('"symbol_tf": 15m und 1h dürfen nebeneinander laufen',
        b.ok, JSON.stringify(b))

    const c = evaluateRisk({
        ...basis, setup, risk: weit,
        openPositions: [{ symbol: 'BTCUSDT', timeframe: '1h' }],
    })
    check('"symbol_tf" blockt trotzdem dieselbe Zeiteinheit',
        !c.ok && c.reason === RISK_REASONS.DUPLICATE, JSON.stringify(c))

    // Die Sperrfrist muss derselben Aufteilung folgen — sonst sperrt ein
    // 15m-Ausstieg den 1h-Einstieg wieder durch die Hintertür.
    const jetzt = 10 * 3600000
    const sperre = validateRisk({ duplicateScope: 'symbol_tf', cooldownMinutes: 60 }).values
    const d = evaluateRisk({
        equity: 1000, openPositions: [], now: jetzt, setup, risk: sperre,
        lastExitBySymbol: { BTCUSDT: jetzt - 60000, 'BTCUSDT|15m': jetzt - 60000 },
    })
    check('Sperrfrist je Zeiteinheit: 15m-Ausstieg blockt 1h nicht', d.ok, JSON.stringify(d))

    const e = evaluateRisk({
        equity: 1000, openPositions: [], now: jetzt, setup, risk: sperre,
        lastExitBySymbol: { BTCUSDT: jetzt - 60000, 'BTCUSDT|1h': jetzt - 60000 },
    })
    check('Sperrfrist greift auf der eigenen Zeiteinheit',
        !e.ok && e.reason === RISK_REASONS.COOLDOWN, JSON.stringify(e))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
