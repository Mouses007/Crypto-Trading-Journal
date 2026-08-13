/**
 * Selbsttest der Chat→Regelstrategie-Strecke.
 *
 *   node server/strategies/__selftest-chatbuilder.mjs
 *
 * Geprüft wird das, was ohne echtes Modell prüfbar ist — und das ist das
 * Wesentliche: dass der Prompt das vollständige Vokabular nennt, dass eine
 * fehlerhafte Antwort abgelehnt UND nachgebessert wird, und dass nichts
 * Ungeprüftes durchrutscht.
 */

import { frageModell, baueSystemPrompt } from '../rule-builder.js'
import { BAUSTEINE } from './rule-engine.js'
import { pruefeRegeln } from './rule-validate.js'
import { VORLAGEN } from './rule-templates.js'

let bestanden = 0
let fehlgeschlagen = 0

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** Ein Modell, das eine vorgegebene Folge von Antworten liefert. */
function fakeModell(antworten) {
    let i = 0
    const gesehen = []
    const fn = async (_cfg, { user }) => {
        gesehen.push(user)
        const a = antworten[Math.min(i++, antworten.length - 1)]
        return { json: a, text: JSON.stringify(a), costUsd: 0, stopReason: 'end_turn' }
    }
    fn.gesehen = gesehen
    fn.aufrufe = () => i
    return fn
}

const gut = VORLAGEN.find((v) => v.key === 'rsi_umkehr')
const gueltig = { ...JSON.parse(JSON.stringify(gut.rules)), id: 'test_strategie', name: 'Test' }

console.log('\nChat → Regelstrategie — Selbsttest\n')

// ── Prompt ───────────────────────────────────────────────────────────────
console.log('Systemprompt')
{
    const p = baueSystemPrompt()
    for (const [name, liste] of Object.entries(BAUSTEINE)) {
        const fehlend = liste.filter((x) => !p.includes(x))
        check(`alle ${name} stehen im Prompt`, fehlend.length === 0, fehlend.join(', '))
    }
    check('ein vollständiges Beispiel liegt bei', p.includes('"signalFilters"') && p.includes('"invalidations"'))
    check('sagt, dass kein Code geschrieben wird', /KEINEN Code/.test(p))
    check('verlangt Offenlegung des Nicht-Umsetzbaren', p.includes('nichtUmsetzbar'))
}

// ── Die Schleife ─────────────────────────────────────────────────────────
console.log('\nNachbesserungs-Schleife')
{
    const m = fakeModell([{ antwort: 'Bitte sehr', regeln: gueltig }])
    const r = await frageModell({}, { system: 's', user: 'u' }, m)
    check('gültige Antwort kommt im ersten Anlauf durch', !!r.regeln && m.aufrufe() === 1)
    check('Kurzname wird übernommen', r.regeln?.id === 'test_strategie', r.regeln?.id)
}

{
    // Erster Versuch: Tippfehler in einer Referenz. Zweiter: korrekt.
    const kaputt = JSON.parse(JSON.stringify(gueltig))
    kaputt.signalFilters[0].left = 'rsiX'   // gibt es nicht
    const m = fakeModell([
        { antwort: 'Versuch 1', regeln: kaputt },
        { antwort: 'Versuch 2', regeln: gueltig },
    ])
    const r = await frageModell({}, { system: 's', user: 'Baue X' }, m)
    check('fehlerhafte Antwort wird abgelehnt und nachgebessert', !!r.regeln && m.aufrufe() === 2)
    check('die Fehlertexte gehen ans Modell zurück',
        m.gesehen[1]?.includes('unbekannte Referenz "rsiX"'), m.gesehen[1]?.slice(-200))
    check('die ursprüngliche Aufgabe bleibt im zweiten Prompt',
        m.gesehen[1]?.includes('Baue X'))
    check('die Versuche werden protokolliert', r.versuche.length === 2 && r.versuche[0].ok === false)
}

{
    // Dauerhaft kaputt → nach MAX_VERSUCHE aufgeben, aber mit Begründung
    const kaputt = JSON.parse(JSON.stringify(gueltig))
    kaputt.signal = { type: 'zauberstab' }
    const m = fakeModell([{ antwort: 'nope', regeln: kaputt }])
    const r = await frageModell({}, { system: 's', user: 'u' }, m)
    check('gibt nach 3 Versuchen auf', r.regeln === null && m.aufrufe() === 3)
    check('nennt den Grund', r.fehler.some((f) => f.includes('zauberstab')), r.fehler.join('; '))
}

{
    // Modell antwortet ohne Beschreibung (Rückfrage) → keine Schleife
    const m = fakeModell([{ antwort: 'Welche Zeiteinheit?', regeln: null, offeneFragen: ['Zeiteinheit?'] }])
    const r = await frageModell({}, { system: 's', user: 'u' }, m)
    check('Rückfrage löst keine Nachbesserung aus', r.regeln === null && m.aufrufe() === 1)
}

// ── Nichts Ungeprüftes ───────────────────────────────────────────────────
console.log('\nAbwehr')
{
    const boese = {
        ...gueltig, id: 'boese',
        indicators: [{ id: 'x', type: 'ema', period: 20 }, { id: 'y', type: 'eval', period: 1 }],
    }
    const g = pruefeRegeln(boese)
    check('erfundener Indikatortyp wird abgelehnt',
        !g.ok && g.fehler.some((f) => f.includes('eval')), JSON.stringify(g.fehler))
}
{
    const g = pruefeRegeln({ ...gueltig, id: '../../etc/passwd' })
    check('Pfad als Kurzname wird abgelehnt', !g.ok, JSON.stringify(g.fehler))
}
{
    const g = pruefeRegeln({ ...gueltig, timeframes: ['1s'] })
    check('unbekannte Zeiteinheit wird abgelehnt', !g.ok, JSON.stringify(g.fehler))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen\n`)
process.exit(fehlgeschlagen ? 1 : 0)
