/**
 * Selbsttest des lokalen L2-Orderbuchs (Bookmap-Kern).
 *
 *   node shared/__selftest-orderbuch.mjs
 *
 * Prüft die zwei Fehlerklassen, an denen selbstgebaute Bookmaps laut
 * Recherche vom 30.08.2026 scheitern: die Sync-Zustandsmaschine (Futures mit
 * pu-Kette, Spot mit U==prevU+1) und die Buchpflege (qty=0, NaN-Wächter,
 * gekreuztes Buch, prune). Dazu den Re-Anker `mergeSnapshot`: er darf NUR
 * unbekannte Level ergänzen — überschriebe er bekannte, wäre das laufende
 * Buch (das für jedes berührte Level neuer ist als jeder Snapshot) rückwärts
 * auf einen älteren Stand gezogen.
 */

import { OrderBook } from './orderbook.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nOrderbuch: Sync-Zustandsmaschine und Buchpflege\n')

// ── Futures-Sync (pu-Kette) ─────────────────────────────────

{
    const book = new OrderBook()
    book.applySnapshot({ lastUpdateId: 100, bids: [['100', '1']], asks: [['101', '1']] })

    check('veraltetes Event (u < lastUpdateId) wird übersprungen',
        book.applyDiff({ U: 90, u: 99, pu: 89, b: [], a: [] }, true) === 'skip')
    check('nicht überlappendes Event vor dem Sync wird übersprungen',
        book.applyDiff({ U: 101, u: 105, pu: 100, b: [], a: [] }, true) === 'skip' && !book.synced)
    check('überlappendes Event (U <= lastUpdateId <= u) synchronisiert',
        book.applyDiff({ U: 95, u: 102, pu: 94, b: [['99', '2']], a: [] }, true) === 'ok' && book.synced)
    check('lückenlose pu-Kette läuft weiter',
        book.applyDiff({ U: 103, u: 104, pu: 102, b: [], a: [] }, true) === 'ok')
    check('gerissene pu-Kette fordert Resync',
        book.applyDiff({ U: 108, u: 109, pu: 107, b: [], a: [] }, true) === 'resync')
}

// ── Spot-Sync (U == prevU + 1) ──────────────────────────────

{
    const book = new OrderBook()
    book.applySnapshot({ lastUpdateId: 100, bids: [['100', '1']], asks: [['101', '1']] })

    check('Spot: Event mit u <= lastUpdateId wird übersprungen',
        book.applyDiff({ U: 98, u: 100, b: [], a: [] }, false) === 'skip')
    check('Spot: erstes Event muss lastUpdateId+1 überlappen',
        book.applyDiff({ U: 99, u: 103, b: [], a: [] }, false) === 'ok' && book.synced)
    check('Spot: U == prevU+1 läuft weiter',
        book.applyDiff({ U: 104, u: 106, b: [], a: [] }, false) === 'ok')
    check('Spot: Sprung in U fordert Resync',
        book.applyDiff({ U: 110, u: 111, b: [], a: [] }, false) === 'resync')
}

// ── Buchpflege ──────────────────────────────────────────────

{
    const book = new OrderBook()
    book.applySnapshot({ lastUpdateId: 10, bids: [['100', '1'], ['99', '2']], asks: [['101', '1']] })
    book.applyDiff({ U: 5, u: 11, pu: 4, b: [['100', '0']], a: [] }, true)

    check('Menge 0 löscht das Level', !book.bids.has(100))
    check('Löschen eines unbekannten Levels ist ein No-op',
        book.applyDiff({ U: 12, u: 12, pu: 11, b: [['98.5', '0']], a: [] }, true) === 'ok')

    book.applyDiff({ U: 13, u: 13, pu: 12, b: [['abc', '5'], ['97', 'xyz'], ['-1', '3'], ['96', '-2']], a: [] }, true)
    check('NaN-Preis, NaN-Menge, negative Werte werden verworfen',
        !book.bids.has(NaN) && !book.bids.has(97) && !book.bids.has(-1) && !book.bids.has(96))

    const { mid, bestBid, bestAsk } = book.bestPrices()
    check('bestPrices liefert Mid aus bestem Gebot/Brief',
        bestBid === 99 && bestAsk === 101 && mid === 100)
}

{
    const book = new OrderBook()
    book.applySnapshot({ lastUpdateId: 10, bids: [['102', '1']], asks: [['101', '1']] })
    const { mid, gekreuzt } = book.bestPrices()
    check('gekreuztes Buch liefert KEINEN Mid (0 statt plausiblem Falschwert)',
        gekreuzt === true && mid === 0)
}

{
    const book = new OrderBook()
    book.applySnapshot({
        lastUpdateId: 10,
        bids: [['100', '1'], ['98', '1'], ['80', '1']],
        asks: [['101', '1'], ['102.5', '1'], ['130', '1']],
    })
    book.prune(100, 0.03)
    check('prune entfernt Level ausserhalb ±3 %',
        !book.bids.has(80) && !book.asks.has(130))
    check('prune behält Level innerhalb des Bandes',
        book.bids.has(100) && book.bids.has(98) && book.asks.has(101) && book.asks.has(102.5))
}

// ── mergeSnapshot (Re-Anker des Recorders) ──────────────────

{
    const book = new OrderBook()
    book.applySnapshot({ lastUpdateId: 100, bids: [['100', '1']], asks: [['101', '1']] })

    check('mergeSnapshot vor dem Sync tut nichts',
        book.mergeSnapshot({ bids: [['99', '5']], asks: [] }) === 0 && !book.bids.has(99))

    // Synchronisieren und ein Level per Diff aktualisieren
    book.applyDiff({ U: 95, u: 102, pu: 94, b: [['100', '7']], a: [] }, true)

    const neu = book.mergeSnapshot({
        lastUpdateId: 90,   // Snapshot darf ÄLTER sein — er ergänzt nur Ruhendes
        bids: [['100', '3'], ['98', '4']],
        asks: [['101', '9'], ['103', '2']],
    })
    check('mergeSnapshot ergänzt nur unbekannte Level', neu === 2
        && book.bids.get(98) === 4 && book.asks.get(103) === 2)
    check('mergeSnapshot überschreibt bekannte Level NICHT',
        book.bids.get(100) === 7 && book.asks.get(101) === 1)
    check('mergeSnapshot lässt den Sync-Zustand unangetastet',
        book.synced && book.prevU === 102 && book.lastUpdateId === 102)
    check('mergeSnapshot erweitert die Abdeckung als Vereinigung',
        book.coverLo === 98 && book.coverHi === 103)
    check('pu-Kette läuft nach dem Merge nahtlos weiter',
        book.applyDiff({ U: 103, u: 104, pu: 102, b: [], a: [] }, true) === 'ok')

    check('mergeSnapshot verwirft kaputte Level',
        book.mergeSnapshot({ bids: [['abc', '1'], ['97', '0'], ['-5', '2']], asks: [] }) === 0)

    // Crossing-Guard: der Snapshot ist älter als das Buch — ein Bid über dem
    // eigenen bestAsk (bzw. Ask unter dem bestBid) ist ein durchgehandeltes
    // Geist-Level und darf das Buch nicht kreuzen (mid=0 → Aufzeichnung still).
    const vorher = book.bestPrices()
    const geister = book.mergeSnapshot({
        bids: [['102', '1'], ['101', '1']],   // beide >= bestAsk (101)
        asks: [['99', '1'], ['100', '1']],    // beide <= bestBid (100)
    })
    const nachher = book.bestPrices()
    check('mergeSnapshot kreuzt das Buch nie (Geist-Level verworfen)',
        geister === 0 && !nachher.gekreuzt
        && nachher.bestBid === vorher.bestBid && nachher.bestAsk === vorher.bestAsk)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler: ' + fehler.join(', ')); process.exit(1) }
