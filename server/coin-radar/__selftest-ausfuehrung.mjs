/**
 * Selbsttest: Ausführungsgüte aus dem Orderbuch.
 *
 * Ohne Netz. Hier entsteht die Zahl, die „gut handelbar" künftig beantwortet —
 * und sie muss in beide Richtungen stimmen: Ein zu gutes Ergebnis lädt zu
 * einem Trade ein, der teurer wird als gedacht; ein zu schlechtes verwirft
 * Coins, die in Ordnung sind.
 *
 * Aufruf: node server/coin-radar/__selftest-ausfuehrung.mjs
 */
import { slippage, tiefeInBp, ausfuehrungsGuete, noteAusfuehrung, BETRAEGE_USD } from './ausfuehrung.js'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Coin-Radar: Ausführungsgüte')

/** Ein Buch mit gleichmässigen Ebenen um 100. */
const buch = (schritt = 0.1, menge = 100, ebenen = 50) => ({
    bids: Array.from({ length: ebenen }, (_, i) => [100 - schritt * (i + 1), menge]),
    asks: Array.from({ length: ebenen }, (_, i) => [100 + schritt * (i + 1), menge]),
})

// ── Slippage ────────────────────────────────────────────────────────────
{
    // Erste Ebene bei 100.1, Mitte 100 → 10 bp, und 100·100 = 10'000 USD
    // reichen für eine Order über 1'000 vollständig aus.
    const s = slippage(buch().asks, 1000, 100, 1)
    p('Slippage wird gegen die MITTE gemessen', Math.abs(s.slippageBp - 10) < 0.01, String(s.slippageBp))
    p('vollständig gefüllt', s.vollstaendig && s.gefuellt === 1000)
}

{
    // Grössere Order frisst tiefere Ebenen → teurer.
    const klein = slippage(buch().asks, 1000, 100, 1).slippageBp
    const gross = slippage(buch().asks, 50000, 100, 1).slippageBp
    p('grössere Order rutscht weiter', gross > klein, `${klein} → ${gross}`)
}

{
    /*
     * Der teuerste Fehler wäre ein zu GUTES Ergebnis aus einem Buch, das die
     * Order gar nicht fasst — dann fehlte genau der teure Teil. Deshalb wird
     * nicht hochgerechnet, sondern `vollstaendig: false` gemeldet.
     */
    const duenn = { bids: [[99.9, 1]], asks: [[100.1, 1]] }
    const s = slippage(duenn.asks, 10000, 100, 1)
    p('zu dünnes Buch meldet unvollständig', s.vollstaendig === false)
    p('und gibt an, wie viel überhaupt ging', s.gefuellt > 0 && s.gefuellt < 10000, String(s.gefuellt))
}

// Verkauf: schlechtere Preise sind NIEDRIGER, die Kosten müssen trotzdem
// positiv herauskommen — sonst sähe ein teurer Ausstieg wie ein Gewinn aus.
{
    const v = slippage(buch().bids, 1000, 100, -1)
    p('Verkaufs-Slippage ist positiv als Kosten', v.slippageBp > 0, String(v.slippageBp))
}

p('leeres Buch ergibt null', slippage([], 1000, 100).slippageBp === null)
p('Betrag null ergibt null', slippage(buch().asks, 0, 100).slippageBp === null)
p('Mitte null ergibt null', slippage(buch().asks, 1000, 0).slippageBp === null)

// ── Tiefe ───────────────────────────────────────────────────────────────
{
    // Ebenen im Abstand 0.1 → innerhalb ±25 bp (=0.25) liegen zwei Ebenen.
    const t = tiefeInBp(buch().asks, 100, 25)
    p('Tiefe zählt nur Ebenen innerhalb der Spanne',
        Math.abs(t - (100.1 * 100 + 100.2 * 100)) < 1, String(t))
    p('engere Spanne ergibt weniger', tiefeInBp(buch().asks, 100, 10) < t)
}

// ── Gesamtbild ──────────────────────────────────────────────────────────
{
    const g = ausfuehrungsGuete(buch())
    p('Mitte wird berechnet', g.mitte === 100)
    p('Spread aus beiden Seiten', Math.abs(g.spreadBp - 20) < 0.01, String(g.spreadBp))
    p('alle Beträge gerechnet', BETRAEGE_USD.every((b) => g.kauf[b] && g.verkauf[b]))
    p('Rundlauf ist die Summe beider Richtungen',
        Math.abs(g.rundlaufBp - (g.kauf[5000].slippageBp + g.verkauf[5000].slippageBp)) < 0.01)
    p('drei Tiefenstufen', [10, 25, 50].every((s) => g.tiefe[s] >= 0))

    p('leeres Buch ergibt null', ausfuehrungsGuete({ bids: [], asks: [] }) === null)
    // Ein verschränktes Buch ist kaputt, keine Gelegenheit.
    p('verschränktes Buch ergibt null',
        ausfuehrungsGuete({ bids: [[101, 1]], asks: [[99, 1]] }) === null)
}

// ── Note ────────────────────────────────────────────────────────────────
{
    const eng = ausfuehrungsGuete(buch(0.001, 10000))
    const weit = ausfuehrungsGuete(buch(0.5, 10000))
    p('enges Buch schneidet besser ab als weites',
        noteAusfuehrung(eng) > noteAusfuehrung(weit),
        `${noteAusfuehrung(eng)} vs ${noteAusfuehrung(weit)}`)
    p('die Note bleibt zwischen 0 und 100',
        [eng, weit].every((g) => noteAusfuehrung(g) >= 0 && noteAusfuehrung(g) <= 100))

    /*
     * Passt der Betrag nicht ins Buch, ist die Note NULL — kein Abzug. Wer
     * nicht wieder herauskommt, hat kein Ausführungsproblem, sondern gar
     * keine Ausführung. Das als „etwas schlechter" zu werten wäre die
     * gefährlichste Zahl der ganzen Seite.
     */
    const winzig = ausfuehrungsGuete({ bids: [[99.9, 1]], asks: [[100.1, 1]] })
    p('Buch, das den Betrag nicht fasst, bekommt 0', noteAusfuehrung(winzig) === 0,
        String(noteAusfuehrung(winzig)))
    p('ohne Buch gibt es keine Note', noteAusfuehrung(null) === null)
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
