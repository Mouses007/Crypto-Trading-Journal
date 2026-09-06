/**
 * Sucht in echten Binance-Kerzen Beispiele fuer die Strukturkarten des
 * Lern-Decks und schlaegt sie VOR — uebernommen wird nichts.
 *
 *   node scripts/lernkarten-beispiel-suchen.mjs [SYMBOL] [INTERVALL]
 *
 * Warum nur vorschlagen: Ein automatisch etikettiertes Beispiel, das die
 * Struktur gar nicht zeigt, praegt das Falsche ein — und niemand merkt es,
 * weil auf der Karte ja ein Bild steht. Die Ausgabe ist deshalb ein fertiger
 * JSON-Block zum Einfuegen in `server/lernkarten-beispiele.js`, nachdem man
 * ihn angesehen hat.
 *
 * Gesucht wird nur, was OHNE WILLKUER definiert ist:
 *
 *   Fair Value Gap   Hoch[i-1] < Tief[i+1] (bullisch) bzw. umgekehrt. Die
 *                    Definition braucht keine Swing-Regel, nur drei Kerzen.
 *   Gleiche Hochs    Zwei Pivot-Hochs innerhalb einer Toleranz. Die Toleranz
 *                    ist eine Zahl, die im Bild dabeisteht — keine Auslegung.
 *
 * BOS, CHoCH, Order Block, Breaker, Mitigation und Inducement stehen hier
 * bewusst NICHT: Sie haengen an der Definition von Hoch und Tief, und genau
 * deren Beliebigkeit ist der Inhalt der jeweiligen Karte. Ein Beispiel dafuer
 * zu erzeugen hiesse, die Karte mit der Regel zu bebildern, vor der sie warnt.
 */

import { pivotHighs } from '../server/strategies/indicators.js'

const SYMBOL = process.argv[2] || 'BTCUSDT'
const INTERVALL = process.argv[3] || '5m'
const FENSTER = 40          // so viele Kerzen wandern spaeter ins Bild

const zahl = (v) => Number(v)

async function holeKerzen() {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${SYMBOL}&interval=${INTERVALL}&limit=500`
    const antwort = await fetch(url)
    if (!antwort.ok) throw new Error(`Binance ${antwort.status}`)
    return (await antwort.json()).map(k => ({
        t: zahl(k[0]), o: zahl(k[1]), h: zahl(k[2]), l: zahl(k[3]), c: zahl(k[4]), v: zahl(k[5]),
    }))
}

/** Mittlere Spanne der letzten n Kerzen — Massstab fuer „gross genug". */
function spanne(kerzen, bis, n = 20) {
    const von = Math.max(0, bis - n)
    const teil = kerzen.slice(von, bis)
    if (!teil.length) return 0
    return teil.reduce((a, k) => a + (k.h - k.l), 0) / teil.length
}

/**
 * Fair Value Gaps. Verlangt wird mehr als die blosse Luecke: Sie muss
 * mindestens so gross sein wie eine halbe uebliche Kerzenspanne, sonst ist
 * jedes zweite Kerzentrio eine — und ein Beispiel, das man mit der Lupe
 * suchen muss, erklaert nichts.
 */
function findeFvg(kerzen) {
    const treffer = []
    for (let i = 1; i < kerzen.length - 1; i++) {
        const a = kerzen[i - 1], m = kerzen[i], b = kerzen[i + 1]
        const s = spanne(kerzen, i)
        if (!s) continue
        const bull = b.l - a.h
        const bear = a.l - b.h
        const luecke = Math.max(bull, bear)
        if (luecke <= 0) continue
        const koerper = Math.abs(m.c - m.o)
        treffer.push({
            i, richtung: bull > 0 ? 'bullisch' : 'baerisch',
            luecke, lueckeInSpannen: luecke / s,
            koerperInSpannen: koerper / s,
            zeit: new Date(m.t).toISOString(),
        })
    }
    return treffer
        .filter(t => t.lueckeInSpannen >= 0.5 && t.koerperInSpannen >= 1.5)
        .sort((a, b) => b.lueckeInSpannen - a.lueckeInSpannen)
}

/**
 * Gleiche Hochs: zwei Pivot-Hochs, deren Abstand unter der Toleranz liegt.
 * `abstandMin` verhindert Nachbarpunkte — zwei Hochs zwei Kerzen auseinander
 * sind dasselbe Hoch, nicht zwei gleiche.
 */
function findeGleicheHochs(kerzen, { toleranzPct = 0.06, abstandMin = 6 } = {}) {
    // `pivotHighs` liefert {index, t, price} — nicht den nackten Index.
    const pivots = pivotHighs(kerzen, 3, 3).map(p => p.index)
    const treffer = []
    for (let a = 0; a < pivots.length; a++) {
        for (let b = a + 1; b < pivots.length; b++) {
            const ia = pivots[a], ib = pivots[b]
            if (ib - ia < abstandMin) continue
            const ha = kerzen[ia].h, hb = kerzen[ib].h
            const abw = Math.abs(ha - hb) / ha * 100
            if (abw > toleranzPct) continue
            // Dazwischen muss ein echtes Tief liegen, sonst ist es ein Plateau.
            const tief = Math.min(...kerzen.slice(ia, ib + 1).map(k => k.l))
            const einbruch = (ha - tief) / ha * 100
            if (einbruch < 0.25) continue
            treffer.push({ ia, ib, abwPct: abw, einbruchPct: einbruch, zeit: new Date(kerzen[ib].t).toISOString() })
        }
    }
    return treffer.sort((x, y) => x.abwPct - y.abwPct || y.einbruchPct - x.einbruchPct)
}

/** Kerzenfenster um einen Index, gerundet und klein gehalten. */
function fenster(kerzen, mitte, breite = FENSTER) {
    const von = Math.max(0, mitte - Math.floor(breite / 2))
    const bis = Math.min(kerzen.length, von + breite)
    const dez = kerzen[mitte].c > 1000 ? 1 : kerzen[mitte].c > 10 ? 3 : 5
    const r = (v) => Number(v.toFixed(dez))
    return {
        symbol: SYMBOL, intervall: INTERVALL, von: kerzen[von].t,
        kerzen: kerzen.slice(von, bis).map(k => [k.t, r(k.o), r(k.h), r(k.l), r(k.c)]),
        mitte: mitte - von,
    }
}

const kerzen = await holeKerzen()
console.log(`${SYMBOL} ${INTERVALL}: ${kerzen.length} Kerzen, `
    + `${new Date(kerzen[0].t).toISOString().slice(0, 16)} bis ${new Date(kerzen.at(-1).t).toISOString().slice(0, 16)}\n`)

const fvg = findeFvg(kerzen)
console.log(`FAIR VALUE GAP — ${fvg.length} Kandidaten (Luecke >= 0,5 Spannen, Koerper >= 1,5 Spannen)`)
for (const t of fvg.slice(0, 5)) {
    console.log(`  #${t.i} ${t.richtung.padEnd(9)} Luecke ${t.luecke.toFixed(1)} `
        + `(${t.lueckeInSpannen.toFixed(1)} Spannen), Koerper ${t.koerperInSpannen.toFixed(1)}, ${t.zeit.slice(0, 16)}`)
}

const gleich = findeGleicheHochs(kerzen)
console.log(`\nGLEICHE HOCHS — ${gleich.length} Kandidaten (Abweichung <= 0,06 %, Einbruch >= 0,25 %)`)
for (const t of gleich.slice(0, 5)) {
    console.log(`  #${t.ia}/#${t.ib} Abweichung ${t.abwPct.toFixed(3)} %, `
        + `Einbruch dazwischen ${t.einbruchPct.toFixed(2)} %, ${t.zeit.slice(0, 16)}`)
}

if (process.argv.includes('--json')) {
    console.log('\n── Zum Einfuegen ──────────────────────────────────────────')
    if (fvg[0]) console.log('fairValueGap:', JSON.stringify(fenster(kerzen, fvg[0].i)))
    if (gleich[0]) console.log('\nequalHighsLows:', JSON.stringify(fenster(kerzen, Math.round((gleich[0].ia + gleich[0].ib) / 2))))
}
