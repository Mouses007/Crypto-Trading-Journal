/**
 * Selbsttest des KI-Listenvorschlags.
 *
 *   node server/__selftest-rangliste-ki.mjs
 *
 * Ein Sprachmodell erfindet Symbole — das ist keine Ausnahme, sondern der
 * Normalfall, sobald man es nach einer Liste fragt. Die Prüfung gegen den Topf
 * ist deshalb der einzige Grund, warum man dem Ergebnis überhaupt trauen kann.
 * Fällt sie aus, landen erfundene Coins in einem Rangliste-Lauf und tauchen dort
 * als „keine Daten" auf — mit der stillen Botschaft, es habe an den Daten
 * gelegen.
 *
 * Das Modell wird eingespeist; der Test kostet nichts und braucht kein Netz.
 */

import { schlageUniversumVor } from './rangliste-ki.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const handelbar = async () => new Map([
    ['BTCUSDT', {}], ['ONDOUSDT', {}], ['1000SHIBUSDT', {}], ['PENDLEUSDT', {}], ['XMRUSDT', {}],
])
// XMRUSDT ist testbar, aber NICHT handelbar → gehört nicht in den Topf
const testbar = async () => new Set(['BTCUSDT', 'ONDOUSDT', '1000SHIBUSDT', 'PENDLEUSDT', 'NURBINANCEUSDT'])

/** Ein erfundenes Modell, das genau die übergebene Antwort liefert. */
function modell(json, merker = {}) {
    return async (cfg, auftrag) => {
        merker.system = auftrag.system
        merker.user = auftrag.user
        return { json, costUsd: 0.004, usage: { totalTokens: 1234 } }
    }
}

console.log('\nKI-Listenvorschlag — Selbsttest\n')

// ── Die Prüfung gegen den Topf ───────────────────────────────────────────
console.log('Erfundene Symbole')
{
    const r = await schlageUniversumVor('RWA', {
        handelbar, testbar,
        llm: modell({
            name: 'RWA', begruendung: 'Tokenisierte Realwerte.',
            symbole: ['ONDOUSDT', 'PENDLEUSDT', 'ERFUNDENUSDT', 'GIBTESNICHT', 'XMRUSDT'],
            unsicher: ['BTCUSDT'],
        }),
    })
    check('nur Symbole aus dem Topf kommen durch',
        r.symbole.join(',') === 'ONDOUSDT,PENDLEUSDT', r.symbole.join(','))
    check('erfundene Symbole werden verworfen',
        r.verworfen.includes('ERFUNDENUSDT') && r.verworfen.includes('GIBTESNICHT'),
        JSON.stringify(r.verworfen))
    check('ein nicht handelbarer Coin fliegt ebenfalls raus',
        r.verworfen.includes('XMRUSDT'), JSON.stringify(r.verworfen))
    check('die Zahl der Verworfenen wird ausgewiesen',
        r.verworfen.length === 3 && r.gesamtVorschlaege === 5,
        `${r.verworfen.length} von ${r.gesamtVorschlaege}`)
    check('„unsicher" wird getrennt geführt', r.unsicher.join(',') === 'BTCUSDT', r.unsicher.join(','))
    check('Kosten und Token kommen mit', r.kostenUsd === 0.004 && r.tokens === 1234)
}

// ── Der Topf ist die Schnittmenge ────────────────────────────────────────
console.log('\nDer Topf, aus dem gewählt wird')
{
    const merker = {}
    await schlageUniversumVor('Meme', {
        handelbar, testbar,
        llm: modell({ name: 'x', symbole: [], unsicher: [] }, merker),
    })
    check('der Topf enthält nur handelbare UND testbare Symbole',
        /BTCUSDT/.test(merker.user) && /ONDOUSDT/.test(merker.user), merker.user?.slice(0, 120))
    check('ein nur testbares Symbol steht NICHT im Topf',
        !/NURBINANCEUSDT/.test(merker.user))
    check('ein nur handelbares Symbol steht NICHT im Topf',
        !/XMRUSDT/.test(merker.user))
    check('das Thema steht im Auftrag', /Thema: Meme/.test(merker.user))
    check('der Systemprompt verbietet das Erfinden',
        /Erfinde kein Symbol/.test(merker.system), merker.system?.slice(0, 60))
    check('… und erlaubt ausdrücklich eine leere Antwort',
        /leere Liste/.test(merker.system))
}

// ── Robustheit ───────────────────────────────────────────────────────────
console.log('\nRobustheit')
{
    const leer = await schlageUniversumVor('Nichts', {
        handelbar, testbar, llm: modell({ name: 'leer', symbole: [], unsicher: [] }),
    })
    check('eine leere Liste ist ein gültiges Ergebnis, kein Fehler',
        leer.symbole.length === 0 && leer.verworfen.length === 0)

    let geworfen = false
    try {
        await schlageUniversumVor('Kaputt', { handelbar, testbar, llm: async () => ({ json: null }) })
    } catch { geworfen = true }
    check('eine unlesbare Antwort wird abgelehnt statt geraten', geworfen)

    let ohneThema = false
    try { await schlageUniversumVor('', { handelbar, testbar, llm: modell({}) }) } catch { ohneThema = true }
    check('ohne Thema wird gar nicht erst gefragt', ohneThema)

    let langesThema = false
    try {
        await schlageUniversumVor('x'.repeat(200), { handelbar, testbar, llm: modell({}) })
    } catch { langesThema = true }
    check('ein übermässig langes Thema wird abgelehnt', langesThema)

    const doppelt = await schlageUniversumVor('RWA', {
        handelbar, testbar,
        llm: modell({ name: 'x', symbole: ['ONDOUSDT', 'ondousdt', 'ONDOUSDT'], unsicher: [] }),
    })
    check('Doppelte und Kleinschreibung werden geglättet',
        doppelt.symbole.join(',') === 'ONDOUSDT', doppelt.symbole.join(','))

    let leererTopf = false
    try {
        await schlageUniversumVor('RWA', {
            handelbar: async () => new Map(), testbar: async () => new Set(), llm: modell({}),
        })
    } catch { leererTopf = true }
    check('ohne testbare Symbole wird gar nicht erst gefragt', leererTopf)
}

console.log(`\n${fehlgeschlagen === 0 ? '\x1b[32m' : '\x1b[31m'}${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen\x1b[0m`)
if (fehlgeschlagen) { console.log('Fehlgeschlagen:'); for (const f of fehler) console.log(`  · ${f}`) }
process.exit(fehlgeschlagen ? 1 : 0)
