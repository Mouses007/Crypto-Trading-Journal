/**
 * Selbsttest des Live-Feeds: Orderbuch, Sequenzprüfung, Heatmap-Ring, Socket.
 *
 *   node server/__selftest-livefeed.mjs
 *
 * Warum ausgerechnet hier Tests: Der Feed hat keine Fehlermeldung. Läuft etwas
 * schief, zeigt die Heatmap trotzdem ein Bild — nur ein falsches. Ein
 * gekreuztes Buch ergibt einen plausiblen Mittelwert, eine NaN-Menge einen
 * leeren Fleck, ein doppelter Socket verdoppelte Mengen. Nichts davon fällt
 * beim Hinsehen auf, und genau deshalb muss es geprüft werden.
 *
 * Aufgestellt entlang der Befunde des Audits vom 16.08.2026 (A1-2, A2-3, A2-4)
 * und der Nachbesserungen dazu. Zeit wird nicht gemessen, sondern gerechnet;
 * WebSockets werden eingespeist statt geöffnet — der Lauf dauert Millisekunden
 * und braucht kein Netz.
 */

import fs from 'fs'
import { OrderBook } from '../shared/orderbook.js'
import { HeatmapRing } from '../src/utils/heatmapRing.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** Diff im Binance-Format. Kurze Hand, damit die Fälle lesbar bleiben. */
const diff = (U, u, pu, bids = [], asks = []) => ({ U, u, pu, b: bids, a: asks })

console.log('\nLive-Feed — Selbsttest\n')

// ── Orderbuch: was hineindarf ────────────────────────────────────────────
console.log('Orderbuch nimmt nur Gültiges an')
{
    const buch = new OrderBook()
    buch.applySnapshot({ lastUpdateId: 100, bids: [['100', '5']], asks: [['101', '5']] })

    // Der erste Diff muss den Snapshot ÜBERLAPPEN (U <= lastUpdateId <= u),
    // sonst gilt er als verfrüht und wird übersprungen
    buch.applyDiff(diff(95, 105, 94, [
        ['abc', '1'],      // Preis kein Zahlwert
        ['100.5', 'xyz'],  // Menge kein Zahlwert
        ['-5', '1'],       // negativer Preis
        ['99', '-2'],      // negative Menge
        ['98', '2'],       // gültig
    ]), true)

    const preise = [...buch.bids.keys()]
    check('kaputte Level werden verworfen, gültige übernommen',
        preise.includes(98) && preise.includes(100) && preise.length === 2,
        `Gebote: ${preise.join(', ')}`)
    check('kein NaN als Schlüssel im Buch',
        !preise.some(Number.isNaN),
        `Gebote: ${preise.join(', ')}`)
    check('keine NaN-Menge in den Werten',
        ![...buch.bids.values(), ...buch.asks.values()].some(Number.isNaN))
}

// ── Orderbuch: gekreuztes Buch ───────────────────────────────────────────
console.log('\nGekreuztes Buch liefert kein Mid')
{
    const buch = new OrderBook()
    buch.bids.set(100, 1)
    buch.asks.set(101, 1)
    const gesund = buch.bestPrices()
    check('gesundes Buch: Mid ist der Mittelwert', gesund.mid === 100.5 && !gesund.gekreuzt,
        JSON.stringify(gesund))

    buch.bids.set(102, 1)   // Gebot über dem Brief
    const krumm = buch.bestPrices()
    check('gekreuzt: Mid ist 0 statt eines plausiblen Werts', krumm.mid === 0,
        `mid=${krumm.mid}`)
    check('gekreuzt wird nach aussen gemeldet', krumm.gekreuzt === true)

    buch.bids.delete(102)
    check('nach dem Aufräumen ist das Mid wieder da', buch.bestPrices().mid === 100.5)
}

// ── Sequenzprüfung: Lücke, Dublette, Reihenfolge ─────────────────────────
console.log('\nSequenzprüfung (Futures-Regel über pu)')
{
    const buch = new OrderBook()
    buch.applySnapshot({ lastUpdateId: 100, bids: [['100', '1']], asks: [['101', '1']] })

    check('überlappender Diff wird angewandt',
        buch.applyDiff(diff(95, 105, 94, [['100', '2']]), true) === 'ok')
    check('veralteter Diff wird übersprungen',
        buch.applyDiff(diff(90, 100, 89), true) === 'skip')

    // pu muss auf das u des Vorgängers zeigen; tut es das nicht, fehlt etwas
    const nachLuecke = buch.applyDiff(diff(200, 205, 199, [['100', '3']]), true)
    check('Lücke in der Kette verlangt einen Neuabgleich',
        nachLuecke === 'resync', `Ergebnis: ${nachLuecke}`)
    /*
     * Das Buch setzt sich NICHT selbst zurück — es meldet nur. Das Aufräumen
     * gehört dem Aufrufer, der auch den neuen Snapshot holen muss. Diese
     * Arbeitsteilung ist richtig, aber sie hält nur, solange beide Aufrufer sie
     * einhalten: ein 'resync', das niemand behandelt, führt zu einem Buch, das
     * stillschweigend falsche Mengen weiterträgt.
     */
    check('das Buch räumt nicht selbst auf, sondern meldet',
        buch.synced === true, 'Zurücksetzen ist Sache des Aufrufers')

    for (const [name, pfad] of [
        ['Browser-Feed', '../src/utils/liveFeed.js'],
        ['Server-Recorder', './live-recorder.js'],
    ]) {
        const quelle = fs.readFileSync(new URL(pfad, import.meta.url), 'utf8')
        check(`${name} behandelt ein gemeldetes 'resync'`,
            /=== 'resync'/.test(quelle) && /_beginSync\(\)/.test(quelle))
    }
}

// ── Heatmap-Ring: ungültiges Mid darf die Achse nicht verreissen ─────────
console.log('\nHeatmap-Ring bei ungültigem Mid')
{
    const ring = new HeatmapRing({ rows: 20, cap: 5, bucketSize: 1 })
    const buch = new OrderBook()
    buch.bids.set(100, 5)
    buch.asks.set(101, 5)

    ring.commit(buch, 1000)
    const achseVorher = ring.mid[0]

    buch.bids.set(103, 5)                  // kreuzt das Buch
    const mid = ring.commit(buch, 2000)

    check('kein Mid für die Spalte', mid === 0, `mid=${mid}`)
    check('die letzte gültige Achse bleibt stehen',
        ring.mid[1] === achseVorher, `${ring.mid[1]} statt ${achseVorher}`)
    check('die Spalte wird als Lücke geführt', ring.flags[1] === 1)
    check('der Ring wird NICHT um den Preis 0 aufgebaut',
        ring.base[1] === ring.base[0], `base ${ring.base[1]} vs ${ring.base[0]}`)

    buch.bids.delete(103)
    ring.commit(buch, 3000)
    check('danach zeichnet der Ring wieder normal',
        ring.flags[2] === 0 && ring.mid[2] === 100.5)
}

// ── Socket-Lebenszyklus ohne Netz ────────────────────────────────────────
console.log('\nSocket-Lebenszyklus (eingespeister WebSocket)')
{
    let erzeugt = 0
    let offen = 0
    class ErsatzSocket {
        constructor() { erzeugt++; offen++; this.readyState = 0 }
        close() { if (this.readyState !== 3) { this.readyState = 3; offen-- } }
    }
    ErsatzSocket.OPEN = 1

    // Die Datei ist Browser-Code (globales WebSocket). Für den Test wird sie
    // ohne Netz geladen und der Ersatz eingespeist — echtes Öffnen wäre hier
    // weder möglich noch aussagekräftig.
    const quelle = fs.readFileSync(new URL('../src/utils/binanceStream.js', import.meta.url), 'utf8')
    const fabrik = new Function('WebSocket', 'module',
        `${quelle.replace(/^export /gm, '')}\nmodule.exports = { BinanceStream }`)
    const modul = { exports: {} }
    fabrik(ErsatzSocket, modul)
    const { BinanceStream } = modul.exports

    const stream = new BinanceStream({ url: 'wss://test', onMessage() { }, silenceLimitMs: 0 })
    stream.connect()
    stream.connect()
    stream.connect()
    check('drei connect() hinterlassen genau einen offenen Socket',
        offen === 1 && erzeugt === 3, `${offen} offen von ${erzeugt} erzeugten`)

    stream._scheduleReconnect()
    const geplant = stream.reconnectTimer !== null
    stream._clearTimers()
    check('_clearTimers räumt auch den Reconnect-Timer ab',
        geplant && stream.reconnectTimer === null)

    stream.stop()
    check('stop() hinterlässt keinen offenen Socket', offen === 0, `${offen} offen`)
}

// ── Recorder: Rückzug bei Snapshot-Fehlern ───────────────────────────────
console.log('\nRecorder-Rückzug bei Snapshot-Fehlern')
{
    // Die Formel selbst — gerechnet, nicht gewartet
    const wartezeiten = []
    for (let n = 1; n <= 8; n++) wartezeiten.push(Math.min(3000 * 2 ** (n - 1), 60000))
    check('der Abstand verdoppelt sich und deckelt bei einer Minute',
        JSON.stringify(wartezeiten) === JSON.stringify([3000, 6000, 12000, 24000, 48000, 60000, 60000, 60000]),
        wartezeiten.join(', '))

    const gesamt = wartezeiten.reduce((s, w) => s + w, 0)
    check('acht Fehlversuche dauern über vier Minuten statt 24 Sekunden',
        gesamt > 240000, `${Math.round(gesamt / 1000)} s`)

    /*
     * Und jetzt die Verdrahtung.
     *
     * Eine grüne Formel ohne Aufrufer ist die gefährlichste Sorte Test: sie
     * gibt Sicherheit, wo keine ist. Deshalb wird zusätzlich im Quelltext
     * nachgesehen, dass der Recorder den wachsenden Abstand auch benutzt und
     * nicht mehr die alte feste Wartezeit.
     */
    const rec = fs.readFileSync(new URL('./live-recorder.js', import.meta.url), 'utf8')
    const fehlerZweig = rec.slice(rec.indexOf('async _fetchSnapshot()'))
        .slice(0, rec.slice(rec.indexOf('async _fetchSnapshot()')).indexOf('\n    }\n'))

    check('der Recorder zählt die Fehlversuche',
        /snapshotVersuche/.test(fehlerZweig))
    check('der Recorder wartet mit wachsendem Abstand, nicht mehr starr 3 s',
        /Math\.min\(3000 \* 2 \*\* /.test(fehlerZweig)
        && !/_fetchSnapshot\(\), 3000\)/.test(fehlerZweig))
    check('der Zähler wird bei Erfolg zurückgesetzt',
        /this\.snapshotVersuche = 0/.test(fehlerZweig))
    check('das Snapshot-Gewicht wird an die Bremse gemeldet',
        /notiereGewicht\(/.test(fehlerZweig))
}

// ── Verdrahtung des Proxys ───────────────────────────────────────────────
console.log('\nVerdrahtung des Binance-Proxys')
{
    const api = fs.readFileSync(new URL('./binance-api.js', import.meta.url), 'utf8')
    check('binance-api.js meldet sein Gewicht an die Bremse',
        /from '\.\/binance-takt\.js'/.test(api) && (api.match(/notiereGewicht\(/g) || []).length >= 2,
        `${(api.match(/notiereGewicht\(/g) || []).length} Aufrufe`)
}

console.log(`\n${fehlgeschlagen === 0 ? '\x1b[32m' : '\x1b[31m'}${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen\x1b[0m`)
if (fehlgeschlagen) { console.log('Fehlgeschlagen:'); for (const f of fehler) console.log(`  · ${f}`) }
process.exit(fehlgeschlagen ? 1 : 0)
