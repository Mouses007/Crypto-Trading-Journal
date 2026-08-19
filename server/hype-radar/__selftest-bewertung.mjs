/**
 * Selbsttest: Bewertung und Zusammenführung des Hype-Radars.
 *
 * Ohne Netz und ohne Datenbank. Geprüft wird die Rangfolge-Logik — sie
 * entscheidet, welche zehn von fünfhundert Funden überhaupt vor ein
 * Sprachmodell kommen, und eine falsche Note hier ist teurer als ein
 * Anzeigefehler.
 *
 * Aufruf: node server/hype-radar/__selftest-bewertung.mjs
 */
import {
    bewerte, noteSozial, noteVolumen, noteQuellen, noteNarrativ, noteNeuheit,
    STANDARD_GEWICHTE,
} from './bewertung.js'
import { fuehreZusammen, normSymbol, normChain } from './quellen.js'

let fehler = 0
let bestanden = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Hype-Radar: Bewertung')

// ── Vereinheitlichung ───────────────────────────────────────────────────
pruefe('$-Zeichen fällt weg', normSymbol('$pepe') === 'PEPE')
pruefe('Leerzeichen fallen weg', normSymbol('  wif ') === 'WIF')
pruefe('leere Eingabe bleibt leer', normSymbol(null) === '')
pruefe('Kettennamen werden vereinheitlicht',
    normChain('ETH') === 'ethereum' && normChain('sol') === 'solana' && normChain('BNB') === 'bsc')

// ── Quellenzahl: der Anti-Fake-Faktor ───────────────────────────────────
pruefe('eine Quelle wiegt wenig', noteQuellen({ quellenAnzahl: 1 }) === 20)
pruefe('zwei Quellen wiegen mehr als doppelt', noteQuellen({ quellenAnzahl: 2 }) === 50)
pruefe('vier Quellen sind Vollausschlag', noteQuellen({ quellenAnzahl: 4 }) === 100)
pruefe('keine Quelle ist 0', noteQuellen({}) === 0)

// ── Zusammenführung ─────────────────────────────────────────────────────
const funde = [
    { symbol: 'PEPE', name: '', chain: 'ethereum', contract: '0xAAA', pair: '', quelle: { quelle: 'coingecko' }, markt: { preisUsd: 1 }, sozial: { stimmen: 10 } },
    { symbol: 'PEPE', name: 'Pepe', chain: 'ethereum', contract: '0xaaa', pair: 'p1', quelle: { quelle: 'reddit-CryptoMoonShots' }, markt: {}, sozial: { stimmen: 15 } },
    { symbol: 'WIF', name: 'dogwifhat', chain: 'solana', contract: '', pair: '', quelle: { quelle: 'reddit-CryptoCurrency' }, markt: {}, sozial: { stimmen: 5 } },
]
const zusammen = fuehreZusammen(funde)
pruefe('gleicher Vertrag wird zusammengefasst, Schreibweise egal', zusammen.length === 2,
    JSON.stringify(zusammen.map((z) => z.symbol)))
const pepe = zusammen.find((z) => z.symbol === 'PEPE')
pruefe('fehlender Name wird nachgetragen', pepe.name === 'Pepe')
pruefe('fehlendes Paar wird nachgetragen', pepe.pair === 'p1')
pruefe('Zahlen werden addiert', pepe.sozial.stimmen === 25)
pruefe('zwei unabhängige Quellen erkannt', pepe.quellenAnzahl === 2)

/*
 * Die Falle, gegen die der Zähler gebaut ist: zwei Endpunkte DESSELBEN
 * Anbieters dürfen nicht als zwei unabhängige Bestätigungen zählen, sonst
 * liesse sich Bestätigung durch einen einzigen Anbieter vortäuschen.
 */
const nurDex = fuehreZusammen([
    { symbol: 'X', chain: 'base', contract: '0xB', quelle: { quelle: 'dexscreener-boost' }, markt: {}, sozial: {} },
    { symbol: 'X', chain: 'base', contract: '0xB', quelle: { quelle: 'dexscreener-neu' }, markt: {}, sozial: {} },
])
pruefe('zwei Endpunkte eines Anbieters zählen als eine Quelle',
    nurDex[0].quellenAnzahl === 1, String(nurDex[0].quellenAnzahl))

// ── Volumen ─────────────────────────────────────────────────────────────
pruefe('ohne Handel keine Note', noteVolumen({ markt: { volumen24h: 0 } }) === 0)
// 24 h = 2400, Mittel je Stunde = 100. Letzte Stunde 100 → Faktor 1 → 25.
pruefe('Handel wie üblich gibt 25',
    noteVolumen({ markt: { volumen24h: 2400, volumen1h: 100 } }) === 25)
// Letzte Stunde 400 → Faktor 4 → 100.
pruefe('vierfacher Schub gibt Vollausschlag',
    noteVolumen({ markt: { volumen24h: 2400, volumen1h: 400 } }) === 100)
pruefe('extremer Schub bleibt gedeckelt',
    noteVolumen({ markt: { volumen24h: 2400, volumen1h: 5000 } }) === 100)
pruefe('ohne Stundenauflösung ein schwaches Ja',
    noteVolumen({ markt: { volumen24h: 2400 } }) === 20)

// ── Neuheit ─────────────────────────────────────────────────────────────
pruefe('zwei Tage alt ist voll neu', noteNeuheit({ markt: { paarAlterStunden: 48 } }) === 100)
pruefe('vier Monate alt ist nicht mehr neu', noteNeuheit({ markt: { paarAlterStunden: 24 * 120 } }) === 0)
pruefe('unbekanntes Alter gilt NICHT als neu', noteNeuheit({ markt: {} }) === 0)
const mitte = noteNeuheit({ markt: { paarAlterStunden: 24 * 52 } })
pruefe('dazwischen fällt es linear', mitte > 40 && mitte < 60, String(mitte))

// ── Narrativ ────────────────────────────────────────────────────────────
pruefe('KI-Thema wird erkannt',
    noteNarrativ({ symbol: 'BRAIN', name: 'Neural Agent Protocol' }).narrativ === 'ai-agents')
pruefe('Meme wird erkannt',
    noteNarrativ({ symbol: 'WIF', name: 'dogwifhat inu' }).narrativ === 'meme')
pruefe('ohne Treffer keine Zuordnung',
    noteNarrativ({ symbol: 'ZZZZ', name: 'qqqq' }).note === 0)

// ── Sozial ──────────────────────────────────────────────────────────────
pruefe('ohne Signale keine Note', noteSozial({ sozial: {} }) === 0)
const wenig = noteSozial({ sozial: { stimmen: 10 } })
const viel = noteSozial({ sozial: { stimmen: 1000 } })
pruefe('mehr Zustimmung gibt mehr Note', viel > wenig)
pruefe('Zustimmung wirkt gedämpft, nicht linear', viel < wenig * 10,
    `${wenig} → ${viel}`)
/*
 * Gekaufte Sichtbarkeit darf nicht so schwer wiegen wie echte Zustimmung —
 * sonst kauft man sich in den Bericht.
 */
const gekauft = noteSozial({ sozial: { boostGesamt: 1000 } })
const echt = noteSozial({ sozial: { stimmen: 1000 } })
pruefe('gekaufte Sichtbarkeit wiegt weniger als echte Zustimmung', gekauft < echt,
    `boost ${gekauft} vs stimmen ${echt}`)

// ── Gesamtnote ──────────────────────────────────────────────────────────
const stark = bewerte({
    symbol: 'AGENT', name: 'AI Agent Protocol',
    quellenAnzahl: 4,
    markt: { volumen24h: 2400, volumen1h: 400, paarAlterStunden: 48 },
    sozial: { stimmen: 2000 },
})
const schwach = bewerte({
    symbol: 'ZZZ', name: '',
    quellenAnzahl: 1,
    markt: { volumen24h: 100, paarAlterStunden: 24 * 200 },
    sozial: {},
})
pruefe('starker Fund bekommt eine hohe Note', stark.hypeScore > 70, String(stark.hypeScore))
pruefe('schwacher Fund bekommt eine niedrige Note', schwach.hypeScore < 25, String(schwach.hypeScore))
pruefe('Note bleibt im Bereich 0..100',
    stark.hypeScore <= 100 && schwach.hypeScore >= 0)
pruefe('Teilnoten werden mitgeliefert',
    Object.keys(stark.teilnoten).length === 5)
pruefe('Narrativ wird mitgeliefert', stark.narrativ === 'ai-agents')

/*
 * Gewichte, die nicht auf 100 summieren, dürfen keine krumme Note ergeben —
 * geteilt wird durch die tatsächliche Summe.
 */
const schief = bewerte(
    { symbol: 'A', quellenAnzahl: 4, markt: {}, sozial: {} },
    { sozial: 10, volumen: 10, quellen: 10, narrativ: 10, neuheit: 10 },
)
pruefe('krumme Gewichtssumme bleibt im Bereich',
    schief.hypeScore >= 0 && schief.hypeScore <= 100, String(schief.hypeScore))
pruefe('nur Quellen gefüllt → Note entspricht dem Quellenanteil',
    schief.hypeScore === 20, String(schief.hypeScore))

// Kaputte Eingaben dürfen keine NaN-Note erzeugen.
const murks = bewerte({ symbol: 'A', quellenAnzahl: 'viele', markt: { volumen24h: 'x' }, sozial: { stimmen: null } })
pruefe('unbrauchbare Eingaben ergeben eine gültige Zahl',
    Number.isFinite(murks.hypeScore) && murks.hypeScore >= 0)

pruefe('Standardgewichte summieren auf 100',
    Object.values(STANDARD_GEWICHTE).reduce((a, b) => a + b, 0) === 100)

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
