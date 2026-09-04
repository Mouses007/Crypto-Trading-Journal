/**
 * Selbsttest der Coin-Radar-Einzelprüfung.
 *
 * Geprüft wird das, was ohne Netz prüfbar ist — und das ist genau der Teil,
 * an dem die Messung still falsch würde: die Übersetzung der Bitunix-Kerzen.
 * Ihre drei Abweichungen von Binance (Reihenfolge, laufende Kerze, Volumenfeld)
 * ergeben allesamt PLAUSIBLE Zahlen, wenn man sie übersieht. Ein ATR, das
 * rückwärts durch die Zeit gerechnet wurde, sieht aus wie ein ATR.
 *
 * `pruefeEinzeln` selbst ist bewusst nicht abgedeckt: Die Funktion ist
 * Verdrahtung um bereits getestete Teile (`bewertung.js`, `kennzahlen.js`,
 * `ausfuehrung.js`, `btc-vergleich.js`) herum. Was sie an eigener Logik trägt,
 * steht hier als reine Funktion daneben.
 */

import assert from 'node:assert/strict'
import {
    normalisiereEingabe, vorschlaege, kerzenAusBitunix, spitzeAusBuch,
} from './einzel.js'

let gut = 0
let schlecht = 0
function pruefe(name, fn) {
    try {
        fn()
        gut++
    } catch (e) {
        schlecht++
        console.error(`  ✗ ${name}\n    ${e.message}`)
    }
}

// ── Eingabe → Symbol ────────────────────────────────────────────────────
pruefe('nackte Basis bekommt USDT', () => {
    const r = normalisiereEingabe('cashcat')
    assert.equal(r.symbol, 'CASHCATUSDT')
    assert.equal(r.basis, 'CASHCAT')
    assert.equal(r.ergaenzt, true)
})

pruefe('Trennzeichen und Kleinschrift', () => {
    assert.equal(normalisiereEingabe('cashcat/usdt').symbol, 'CASHCATUSDT')
    assert.equal(normalisiereEingabe(' cashcat-usdt ').symbol, 'CASHCATUSDT')
    assert.equal(normalisiereEingabe('CASHCATUSDT').symbol, 'CASHCATUSDT')
})

pruefe('vorhandene Quote wird NICHT verdoppelt', () => {
    const r = normalisiereEingabe('btcusdc')
    assert.equal(r.symbol, 'BTCUSDC')
    assert.equal(r.ergaenzt, false)
})

pruefe('leere und unsinnige Eingaben melden sich', () => {
    assert.equal(normalisiereEingabe('').fehler, 'leer')
    assert.equal(normalisiereEingabe('   ').fehler, 'leer')
    assert.equal(normalisiereEingabe('!!!').fehler, 'leer')
    assert.equal(normalisiereEingabe('A'.repeat(30)).fehler, 'zu_lang')
})

/*
 * Der Fall, an dem eine naive Endungsprüfung scheitert: „USDT" allein ist
 * keine Basis mit Quote, sondern eine Basis. Ohne die Längenprüfung käme ein
 * leeres Symbol heraus.
 */
pruefe('Quote allein ist eine Basis, kein Paar', () => {
    assert.equal(normalisiereEingabe('usdt').symbol, 'USDTUSDT')
})

// ── Vorschläge ──────────────────────────────────────────────────────────
const BESTAND = new Set([
    'CATUSDT', 'CATIUSDT', 'CASHCATUSDT', 'POPCATUSDT', 'CATERPILLARUSDT', 'BTCUSDT',
])

pruefe('Präfixtreffer kommen zuerst, kurze vor langen', () => {
    const v = vorschlaege('CAT', BESTAND)
    assert.equal(v[0], 'CATUSDT')
    assert.equal(v[1], 'CATIUSDT')
    // Enthalten, aber nicht am Anfang — muss hinter allen Präfixtreffern stehen.
    assert.ok(v.indexOf('CASHCATUSDT') > v.indexOf('CATERPILLARUSDT'))
})

pruefe('zu kurze Eingabe schlägt nichts vor', () => {
    // Ein einzelner Buchstabe passt auf hunderte Symbole; eine Liste daraus
    // wäre kein Vorschlag, sondern ein Auszug aus dem Bestand.
    assert.deepEqual(vorschlaege('C', BESTAND), [])
})

pruefe('kein Treffer bleibt leer', () => {
    assert.deepEqual(vorschlaege('QUATSCH', BESTAND), [])
})

/*
 * Der eigentliche Zweck der Vorschläge. „CASHCTA" ist Teilstring von nichts —
 * mit reiner Enthält-Suche käme die leere Antwort heraus, obwohl das gemeinte
 * Symbol fünf gemeinsame Anfangszeichen hat. Genau dieser Dreher ist bei
 * Meme-Tickern der häufigste Vertipper.
 */
pruefe('Vertipper findet über den gemeinsamen Anfang', () => {
    const v = vorschlaege('CASHCTA', BESTAND)
    assert.equal(v[0], 'CASHCATUSDT')
})

pruefe('unter drei gemeinsamen Zeichen wird nichts geraten', () => {
    // 'BT' teilt mit BTCUSDT zwei Zeichen — zu wenig, um mehr als Zufall zu sein.
    assert.deepEqual(vorschlaege('BTXYZQ', BESTAND), [])
})

// ── Bitunix-Kerzen ──────────────────────────────────────────────────────
/** Eine Antwort, wie Bitunix sie liefert: neueste zuerst, Zahlen als Text. */
function bitunixAntwort(zeiten) {
    return zeiten.map((t, i) => ({
        time: String(t),
        open: String(100 + i),
        high: String(110 + i),
        low: String(90 + i),
        close: String(105 + i),
        baseVol: String(1000 + i),
        quoteVol: String((1000 + i) * 105),
    }))
}

const STUNDE = 3600000
// 10:00, 09:00, 08:00 — die 10:00-Kerze läuft noch, wenn es 10:30 ist.
const T10 = 1788534000000
const ANTWORT = bitunixAntwort([T10, T10 - STUNDE, T10 - 2 * STUNDE])

pruefe('Reihenfolge wird gedreht', () => {
    const k = kerzenAusBitunix(ANTWORT, '1h', T10 + 2 * STUNDE)
    assert.equal(k.length, 3)
    assert.ok(k[0].t < k[1].t && k[1].t < k[2].t, 'aufsteigend nach Zeit')
})

pruefe('laufende Kerze fliegt raus', () => {
    // Halbe Stunde nach Öffnung der 10:00-Kerze: sie ist nicht geschlossen.
    const k = kerzenAusBitunix(ANTWORT, '1h', T10 + STUNDE / 2)
    assert.equal(k.length, 2)
    assert.equal(k[k.length - 1].t, T10 - STUNDE)
})

pruefe('exakt zur Schlusszeit gilt die Kerze als geschlossen', () => {
    const k = kerzenAusBitunix(ANTWORT, '1h', T10 + STUNDE)
    assert.equal(k.length, 3)
})

pruefe('Volumen ist die Basismenge, nicht der Umsatz', () => {
    // Wie Binance an Position 5. Käme hier `quoteVol` an, wäre RVOL zwischen
    // den beiden Pfaden um den Preis verschoben — und zwar unauffällig, weil
    // RVOL ein Verhältnis ist und das erst bei Preisänderung auffiele.
    const k = kerzenAusBitunix(ANTWORT, '1h', T10 + 2 * STUNDE)
    assert.equal(k[0].v, 1002)
    assert.equal(typeof k[0].c, 'number')
})

pruefe('kaputte Zeilen fallen weg, nicht der ganze Abruf', () => {
    const mit = [...ANTWORT, { time: 'x', open: null, close: '0' }]
    const k = kerzenAusBitunix(mit, '1h', T10 + 2 * STUNDE)
    assert.equal(k.length, 3)
})

pruefe('leere oder fehlende Antwort ergibt eine leere Liste', () => {
    assert.deepEqual(kerzenAusBitunix(null, '1h'), [])
    assert.deepEqual(kerzenAusBitunix({ data: [] }, '1h'), [])
})

pruefe('unbekannte Zeiteinheit filtert nichts weg', () => {
    // Ohne bekannte Kerzenlänge lässt sich „läuft noch" nicht entscheiden —
    // dann lieber alles behalten als willkürlich schneiden.
    const k = kerzenAusBitunix(ANTWORT, '7h', T10)
    assert.equal(k.length, 3)
})

// ── Spitze im Buch ──────────────────────────────────────────────────────
pruefe('Spitze ist die kleinere Seite mal Mitte', () => {
    const w = spitzeAusBuch({ bids: [[100, 3]], asks: [[102, 5]] })
    assert.equal(w, 3 * 101)
})

pruefe('halbes Buch hat keine Spitze', () => {
    assert.equal(spitzeAusBuch({ bids: [[100, 3]], asks: [] }), null)
    assert.equal(spitzeAusBuch(null), null)
})

// Wortlaut wie in den übrigen Selbsttests — `run-selftests.mjs` liest die
// Zahlen genau aus dieser Zeile; jede andere Formulierung zählt als „keine
// Zählung gefunden" und fällt aus der Gesamtsumme.
console.log(`  ${gut} bestanden, ${schlecht} fehlgeschlagen`)
process.exit(schlecht === 0 ? 0 : 1)
