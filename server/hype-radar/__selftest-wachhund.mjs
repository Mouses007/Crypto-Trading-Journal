/**
 * Selbsttest: Alarm-Regeln des Wachhunds.
 *
 * Ohne Netz und ohne Datenbank. Ein falscher Alarm nervt; ein verschluckter
 * kostet Geld — geprüft werden deshalb beide Richtungen: was anschlagen muss
 * und was schweigen muss.
 *
 * Aufruf: node server/hype-radar/__selftest-wachhund.mjs
 */
import { pruefeRegeln, STANDARD_ALARM_REGELN, SPERRFRIST_MS } from './wachhund.js'
import { erreichtSchwere } from './zustellung.js'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Hype-Radar: Wachhund')

const fav = { symbol: 'PEPE' }
const ruhig = { preis: 1.0, liq: 100000, ts: 1 }

// ── Ruhe ist der Normalfall ─────────────────────────────────────────────
p('unveränderter Stand löst nichts aus',
    pruefeRegeln(fav, ruhig, { preisUsd: 1.01, liquiditaetUsd: 99000, aenderung24h: 3 }).length === 0)

// ── Preissprung seit letztem Blick ──────────────────────────────────────
const hoch = pruefeRegeln(fav, ruhig, { preisUsd: 1.20, liquiditaetUsd: 100000 })
p('+20 % seit letztem Blick schlägt an', hoch.some((a) => a.regel === 'preisSprung'))
p('als info, nicht als Drama', hoch.find((a) => a.regel === 'preisSprung')?.schwere === 'info')

const runter = pruefeRegeln(fav, ruhig, { preisUsd: 0.80, liquiditaetUsd: 100000 })
p('-20 % schlägt ebenso an (beide Richtungen)', runter.some((a) => a.regel === 'preisSprung'))

p('+10 % bleibt unter der Schwelle',
    pruefeRegeln(fav, ruhig, { preisUsd: 1.10, liquiditaetUsd: 100000 }).length === 0)

// ── Tagessicht ──────────────────────────────────────────────────────────
const tag = pruefeRegeln(fav, ruhig, { preisUsd: 1.0, liquiditaetUsd: 100000, aenderung24h: -45 })
p('-45 % auf Tagessicht ist eine Warnung',
    tag.find((a) => a.regel === 'preis24h')?.schwere === 'warnung')

// ── Liquidität: der NIUNAI-Fall ─────────────────────────────────────────
// 44 000 → 2 400 USD zwischen zwei Blicken. Genau dafür gibt es den Hund.
const abfluss = pruefeRegeln(fav, { preis: 1, liq: 44000 }, { preisUsd: 1, liquiditaetUsd: 2400 })
p('Liquiditätsabfluss schlägt an', abfluss.some((a) => a.regel === 'liqAbfluss'))
p('und ist kritisch', abfluss.find((a) => a.regel === 'liqAbfluss')?.schwere === 'kritisch')
p('mit Vorher/Nachher in den Daten',
    abfluss.find((a) => a.regel === 'liqAbfluss')?.daten?.vorher === 44000)

// Zufluss ist erfreulich, aber kein Alarm.
p('Liquiditätszufluss schweigt',
    !pruefeRegeln(fav, { preis: 1, liq: 50000 }, { preisUsd: 1, liquiditaetUsd: 200000 })
        .some((a) => a.regel === 'liqAbfluss'))

// ── Sicherheit: nur der Übergang zählt ──────────────────────────────────
const kippt = pruefeRegeln(fav, ruhig, { preisUsd: 1, liquiditaetUsd: 100000 },
    { status: 'bestanden' }, { status: 'verworfen', grund: 'lp_offen' })
p('bestanden → verworfen ist kritisch',
    kippt.find((a) => a.regel === 'sicherheit')?.schwere === 'kritisch')

p('verworfen → verworfen schweigt (keine Neuigkeit)',
    !pruefeRegeln(fav, ruhig, { preisUsd: 1, liquiditaetUsd: 100000 },
        { status: 'verworfen' }, { status: 'verworfen', grund: 'lp_offen' })
        .some((a) => a.regel === 'sicherheit'))

p('ohne Nachprüfung schweigt die Sicherheitsregel',
    !pruefeRegeln(fav, ruhig, { preisUsd: 1, liquiditaetUsd: 100000 },
        { status: 'bestanden' }, null).some((a) => a.regel === 'sicherheit'))

// ── Erster Blick: keine Vergleichsbasis, kein Fehlalarm ─────────────────
const erster = pruefeRegeln(fav, {}, { preisUsd: 1, liquiditaetUsd: 100000, aenderung24h: 2 })
p('ohne alten Stand schlägt nur die Tagessicht an können', erster.length === 0)

// ── Kaputte Eingaben ────────────────────────────────────────────────────
p('Nullpreis als Basis erzeugt keinen Unsinn',
    pruefeRegeln(fav, { preis: 0, liq: 0 }, { preisUsd: 5, liquiditaetUsd: 100 }).length === 0)
p('Textwerte erzeugen keinen Alarm',
    pruefeRegeln(fav, { preis: 'x', liq: 'y' }, { preisUsd: 'z', liquiditaetUsd: null }).length === 0)

// ── Eigene Schwellen greifen ────────────────────────────────────────────
p('strengere Schwelle schlägt früher an',
    pruefeRegeln(fav, ruhig, { preisUsd: 1.10, liquiditaetUsd: 100000 },
        {}, null, { ...STANDARD_ALARM_REGELN, preisSprungPct: 5 })
        .some((a) => a.regel === 'preisSprung'))

// ── Schwere-Ordnung der Zustellung ──────────────────────────────────────
p('kritisch erreicht jede Mindest-Schwere',
    erreichtSchwere('kritisch', 'info') && erreichtSchwere('kritisch', 'kritisch'))
p('info erreicht warnung nicht', !erreichtSchwere('info', 'warnung'))
p('kritische Sperrfrist ist kürzer als die informative',
    SPERRFRIST_MS.kritisch < SPERRFRIST_MS.info)

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
