/**
 * Selbsttest: Lückenfüllung des 1-Minuten-OI-Archivs (`oi-archiv.js`).
 *
 *   node server/__selftest-oi-archiv.mjs
 *
 * Die heikle Stelle ist die Stufenfunktion: ein INTERPOLIERTER OI-Wert
 * erfände ein ΔOI und damit Einzahlungen in der Liquidationskarte, die nie
 * stattgefunden haben. Und die Abdeckung entscheidet, ob der Server ehrlich
 * auf 5m herabstuft — eine zu grosszügige Zählung verkaufte eine 5m-Treppe
 * als Minutenreihe.
 */

import { fuelleOiLuecken } from './oi-archiv.js'

let bestanden = 0
let fehlgeschlagen = 0
const pruefe = (name, ok, detail = '') => {
    if (ok) { bestanden++; return }
    fehlgeschlagen++
    console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
}

console.log('OI-Archiv: Lückenfüllung')

const M = 60000
const t0 = 1000 * M

// ── Ohne Lücke: Reihe unverändert, Abdeckung 1 ─────────────────────────
{
    const minuten = [0, 1, 2, 3].map(i => ({ t: t0 + i * M, oi: 100 + i }))
    const { reihe, abdeckung } = fuelleOiLuecken(minuten, [], t0, t0 + 3 * M)
    pruefe('lückenlose Reihe bleibt unverändert',
        reihe.length === 4 && reihe.every((p, i) => p.oi === 100 + i && p.eigen))
    pruefe('Abdeckung 1 ohne Lücken', abdeckung === 1)
}

// ── Lücke wird als Stufe gefüllt, nicht interpoliert ───────────────────
{
    const minuten = [
        { t: t0, oi: 100 },
        { t: t0 + 4 * M, oi: 200 },
    ]
    const { reihe } = fuelleOiLuecken(minuten, [], t0, t0 + 4 * M)
    const mitte = reihe.find(p => p.t === t0 + 2 * M)
    pruefe('Lücke trägt den LETZTEN Wert (Stufe), keine Interpolation',
        mitte?.oi === 100 && mitte?.eigen === false, `bekam ${mitte?.oi}`)
    pruefe('gefüllte Reihe ist lückenlos', reihe.length === 5)
}

// ── 5m-Stützen greifen in Lücken, eigene Minute gewinnt ────────────────
{
    const minuten = [{ t: t0 + 5 * M, oi: 111 }]
    const fuenfMin = [{ t: t0, oi: 100 }, { t: t0 + 5 * M, oi: 999 }]
    const { reihe } = fuelleOiLuecken(minuten, fuenfMin, t0, t0 + 6 * M)
    pruefe('vor der eigenen Minute gilt die 5m-Stütze',
        reihe.find(p => p.t === t0 + 2 * M)?.oi === 100)
    pruefe('die eigene Minute schlägt die gleichzeitige 5m-Stütze',
        reihe.find(p => p.t === t0 + 5 * M)?.oi === 111)
    pruefe('nach der eigenen Minute gilt deren Wert weiter',
        reihe.find(p => p.t === t0 + 6 * M)?.oi === 111)
}

// ── Vor der ersten Stütze entfällt die Minute ──────────────────────────
{
    const minuten = [{ t: t0 + 3 * M, oi: 50 }]
    const { reihe, abdeckung } = fuelleOiLuecken(minuten, [], t0, t0 + 4 * M)
    pruefe('führende Minuten ohne jeden Wert entfallen (kein erfundener Start)',
        reihe.length === 2 && reihe[0].t === t0 + 3 * M)
    pruefe('Abdeckung zählt gegen das GANZE Fenster', abdeckung === 1 / 5,
        String(abdeckung))
}

// ── Leere Eingaben ─────────────────────────────────────────────────────
{
    const leer = fuelleOiLuecken([], [], t0, t0 + 4 * M)
    pruefe('ohne eigene Punkte und Stützen: leere Reihe, Abdeckung 0',
        leer.reihe.length === 0 && leer.abdeckung === 0)

    const nurStuetzen = fuelleOiLuecken([], [{ t: t0, oi: 77 }], t0, t0 + 2 * M)
    pruefe('nur 5m-Stützen: Reihe existiert, Abdeckung bleibt 0',
        nurStuetzen.reihe.length === 3 && nurStuetzen.abdeckung === 0
        && nurStuetzen.reihe.every(p => p.oi === 77 && !p.eigen))
}

console.log(`  ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) process.exit(1)
