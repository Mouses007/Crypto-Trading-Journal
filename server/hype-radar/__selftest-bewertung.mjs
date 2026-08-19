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
    bewerte, noteSozial, noteVolumen, noteQuellen, noteNarrativ, noteNeuheit, istTrittbrettfahrer,
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

/*
 * Der Fehler, der im ersten Livetest auffiel: Funde ohne Kettenangabe
 * (CoinGecko nennt nur Symbole) trafen nie auf denselben Coin mit Kette, und
 * die Quellenzahl blieb ausnahmslos 1 — der wichtigste Faktor gegen gekauften
 * Lärm war damit wirkungslos.
 */
const ohneKette = fuehreZusammen([
    { symbol: 'PEPE', chain: 'solana', contract: '', quelle: { quelle: 'geckoterminal' }, markt: { volumen24h: 5 }, sozial: {} },
    { symbol: 'PEPE', chain: '', contract: '', quelle: { quelle: 'coingecko' }, markt: {}, sozial: { stimmen: 7 } },
])
pruefe('Fund ohne Kette schliesst sich dem mit Kette an', ohneKette.length === 1,
    JSON.stringify(ohneKette.map((k) => `${k.symbol}|${k.chain}`)))
pruefe('und wird als zweite Quelle gezählt', ohneKette[0]?.quellenAnzahl === 2)
pruefe('die Kette bleibt erhalten', ohneKette[0]?.chain === 'solana')
pruefe('Sozialdaten werden übernommen', ohneKette[0]?.sozial?.stimmen === 7)

/*
 * Aber nur bei Eindeutigkeit: „PEPE" gibt es auf vier Ketten. Ein falsch
 * verschmolzener Kandidat wäre schlimmer als ein doppelter — er trüge die
 * Quellenzahl eines anderen Coins.
 */
const mehrdeutig = fuehreZusammen([
    { symbol: 'PEPE', chain: 'solana', contract: '', quelle: { quelle: 'geckoterminal' }, markt: {}, sozial: {} },
    { symbol: 'PEPE', chain: 'ethereum', contract: '', quelle: { quelle: 'dexscreener' }, markt: {}, sozial: {} },
    { symbol: 'PEPE', chain: '', contract: '', quelle: { quelle: 'coingecko' }, markt: {}, sozial: {} },
])
pruefe('bei zwei möglichen Ketten wird NICHT geraten', mehrdeutig.length === 3,
    String(mehrdeutig.length))
pruefe('und niemand bekommt eine fremde Quelle zugerechnet',
    mehrdeutig.every((k) => k.quellenAnzahl === 1))

// Der zweite Durchgang bekommt bereits zusammengeführte Kandidaten herein.
const zweiterDurchgang = fuehreZusammen([
    { symbol: 'ABC', chain: 'base', contract: '0xC', quellen: [{ quelle: 'dexscreener' }], markt: {}, sozial: {} },
    { symbol: 'ABC', chain: 'base', contract: '', quellen: [{ quelle: 'coingecko' }], markt: {}, sozial: {} },
])
pruefe('bereits zusammengeführte Kandidaten lassen sich erneut vereinen',
    zweiterDurchgang.length === 1 && zweiterDurchgang[0].quellenAnzahl === 2,
    JSON.stringify(zweiterDurchgang.map((k) => k.quellenAnzahl)))

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

/*
 * Die Gegenwährung darf nicht einordnen. GeckoTerminal liefert Poolnamen wie
 * „WETH / USDC"; wer den ganzen Namen prüft, hält jeden Pool, der gegen USDC
 * handelt, für ein Stablecoin-Projekt. Im Livelauf traf das WETH, WBTC und
 * SHIB. Deshalb kommt hier nur noch die erste Seite des Paars an.
 */
pruefe('Gegenwährung im Namen ordnet nicht ein',
    noteNarrativ({ symbol: 'WETH', name: 'WETH' }).narrativ === '',
    noteNarrativ({ symbol: 'WETH', name: 'WETH' }).narrativ)

/*
 * Teilzeichenketten mitten im Wort.
 *
 * Im Livelauf stand PEPECOIN („Make Memes Great Again") unter KI-Agenten: `ai`
 * traf in „Ag-ai-n", und weil `ai-agents` das erste Thema der Liste ist, gewann
 * es den Gleichstand gegen `pepe`. NIUNAI („Niu Nai", chinesisch für Milch)
 * traf aus demselben Grund. Beide Fehler — Wortmitte und Reihenfolge — werden
 * hier einzeln festgehalten.
 */
for (const [k, erwartet] of [
    [{ symbol: 'PEPECOIN', name: 'Make Memes Great Again' }, 'meme'],
    [{ symbol: 'NIUNAI', name: 'Niu Nai' }, ''],
    [{ symbol: 'SAILOR', name: 'Sailor Moon' }, 'meme'],
    [{ symbol: 'MISTAKE', name: 'Mistake' }, ''],
    [{ symbol: 'ROBOT', name: 'Robot' }, ''],
]) {
    const got = noteNarrativ(k).narrativ
    pruefe(`„${k.name}" wird nicht über eine Wortmitte eingeordnet`, got === erwartet, `war „${got}"`)
}
pruefe('Wortanfang trifft weiterhin', noteNarrativ({ symbol: 'AIDOG', name: 'AI Dog' }).narrativ !== '')

/*
 * Die Gegenrichtung, im Livelauf gemessen: Der Anker pauschal für ALLE
 * Stichwörter war zu scharf — „SOLCAT" und „RobinhoodCat" verloren ihre
 * Meme-Einordnung, weil `cat` mitten im Wort steht. Zusammengesetzte Namen
 * sind hier die Regel.
 */
for (const k of [
    { symbol: 'SOLCAT', name: 'SOLCAT' },
    { symbol: 'RHCAT', name: 'RobinhoodCat' },
    { symbol: 'PANTS', name: 'dogwifpants' },
]) {
    pruefe(`zusammengesetzter Meme-Name wird erkannt: ${k.name}`,
        noteNarrativ(k).narrativ === 'meme', noteNarrativ(k).narrativ || 'leer')
}
pruefe('längerer Treffer schlägt kürzeren bei Gleichstand',
    noteNarrativ({ symbol: 'PEPE', name: 'AI Pepe' }).narrativ === 'meme',
    noteNarrativ({ symbol: 'PEPE', name: 'AI Pepe' }).narrativ)

// ── Trittbrettfahrer ────────────────────────────────────────────────────
/*
 * Der Radar soll neue Projekte MIT SUBSTANZ finden. Ein Name, der einen
 * etablierten enthält und etwas anhängt, bringt keine eigene Idee mit — er
 * hofft auf die Verwechslung.
 */
for (const k of [
    { symbol: 'PEPECOIN', name: 'Make Memes Great Again' },
    { symbol: 'DOGEZILL', name: 'Dogezilla' },
    { symbol: 'MOONCOIN', name: 'MoonCoin' },
    { symbol: 'CYBERTRUMP', name: 'CyberTrump' },
    { symbol: 'ZARD', name: 'CHARIZARD' },
    { symbol: 'BABYDOGE', name: 'Baby Doge' },
]) {
    pruefe(`Aufguss erkannt: ${k.symbol}`, istTrittbrettfahrer(k).ja, JSON.stringify(istTrittbrettfahrer(k)))
}
for (const k of [
    // Das Original selbst ist kein Trittbrettfahrer.
    { symbol: 'DOGE', name: 'doge' },
    { symbol: 'PEPE', name: 'Pepe' },
    // Und ein eigenständiger Name erst recht nicht.
    { symbol: 'CGX', name: 'CryptoGDEX' },
    { symbol: 'UTANG', name: 'UTANG' },
]) {
    pruefe(`kein Aufguss: ${k.symbol}`, !istTrittbrettfahrer(k).ja, JSON.stringify(istTrittbrettfahrer(k)))
}

{
    /*
     * Gleiches Thema, einmal eigenständig und einmal geliehen — sonst misst
     * der Vergleich die Themen-Teilnote statt den Abzug. Genau daran ist der
     * erste Anlauf gescheitert: Der Klon stand mit 22 zu 18 HÖHER, weil
     * „meme" als erkanntes Thema mehr einbrachte als der Abzug wegnahm.
     */
    const basis = { symbol: 'CATTO', name: 'Catto', markt: { paarAlterStunden: 24 }, quellenAnzahl: 2 }
    const klon = { ...basis, symbol: 'DOGEZILLA', name: 'Dogezilla' }
    const a = bewerte(basis)
    const b = bewerte(klon)
    pruefe('beide tragen dasselbe Thema', a.narrativ === 'meme' && b.narrativ === 'meme')
    pruefe('Aufguss wird abgewertet', b.hypeScore < a.hypeScore, `${a.hypeScore} vs ${b.hypeScore}`)
    pruefe('Abzug wird ausgewiesen', b.trittbrett.ja && b.trittbrett.vorbild === 'doge')
    pruefe('sauberer Fund behält seine Note', a.trittbrett.ja === false)

    /*
     * Und die Aussage, um die es dem Nutzer ging: Ein Sachthema muss einen
     * Meme-Klon schlagen, sonst füllt sich die Liste weiter mit Aufgüssen.
     */
    const sache = { symbol: 'VLTX', name: 'Vaulteryx Restaking', markt: { paarAlterStunden: 24 }, quellenAnzahl: 2 }
    pruefe('Sachthema schlägt Meme-Klon',
        bewerte(sache).hypeScore > b.hypeScore,
        `${bewerte(sache).hypeScore} vs ${b.hypeScore}`)
}

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
