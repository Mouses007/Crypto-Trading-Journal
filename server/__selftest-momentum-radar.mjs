/**
 * Selbsttest des Momentum Radars (`server/momentum-radar.js`).
 *
 *   node server/__selftest-momentum-radar.mjs
 *
 * Vier Dinge sind hier teuer, wenn sie still kippen:
 *
 *  1. **Look-ahead.** Eine höhere Zeitebene darf an einer Chart-Kerze erst
 *     gelten, wenn ihre Kerze vor deren Beginn geschlossen hat. Um eine Kerze
 *     verrutscht sieht der Verlauf besser aus, als er live war.
 *  2. **Zonen und Setups.** Die Grenzen ±50 / ±35 und die Regel „alle mit
 *     Richtung zeigen gleich, mindestens zwei" tragen das ganze Panel.
 *  3. **Struktur.** Ein Bruch zählt beim Überqueren, nicht solange der Kurs
 *     jenseits bleibt; CHoCH nur gegen die bisherige Richtung.
 *  4. **Herkunft.** Der nackte Futures-Anteil ist kein Signal, erst die
 *     Abweichung vom eigenen Schnitt — und nur bei spürbarem Geldfluss.
 */

import {
    welle, signale, zustand, setup, geldfluss, herkunft, richteAus,
    periodenBeginn, vwapSeit, struktur, zaehltFuerStaerke, werteAus,
} from './momentum-radar.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const H = 3600000

/** Kerzenreihe aus Schlusskursen, Spanne ±0,5 %, fester Abstand. */
function reihe(schluesse, schrittMs = H, start = Date.UTC(2026, 0, 5), v = 100) {
    return schluesse.map((c, i) => {
        const o = i ? schluesse[i - 1] : c
        return { t: start + i * schrittMs, o, h: Math.max(o, c) * 1.005, l: Math.min(o, c) * 0.995, c, v }
    })
}

const sinus = (n, periode = 40, mitte = 100, amp = 10) =>
    Array.from({ length: n }, (_, i) => mitte + amp * Math.sin((2 * Math.PI * i) / periode))

console.log('\nZonen und Setups')
{
    check('−50 ist Long-Zone', zustand(-50).code === 'long' && zustand(-50).dir === 1)
    check('−36 ist fast Long', zustand(-36).code === 'fastLong')
    check('−34 ist neutral', zustand(-34).code === 'neutral' && zustand(-34).dir === 0)
    check('+35 ist fast Short (Grenze 70 % von 50)', zustand(35).code === 'fastShort')
    check('+50 ist Short-Zone', zustand(50).code === 'short' && zustand(50).dir === -1)
    check('fehlender Wert ist unbekannt, nicht neutral', zustand(null).code === null)

    check('drei gleich → Setup', setup(1, 1, 1) === 1)
    check('zwei gleich, einer neutral → Setup', setup(-1, 0, -1) === -1)
    check('einer allein ist kein Setup', setup(1, 0, 0) === 0)
    check('Widerspruch ist kein Setup', setup(1, 1, -1) === 0)
    check('DAY braucht 15m UND 5m', setup(1, 0, 0) === 0 && setup(1, 1, 0) === 1)
}

console.log('\nWelle und Signale')
{
    const k = reihe(sinus(300))
    const { w1, w2 } = welle(k)
    check('Welle hat Werte nach der Anlaufzeit', w1.slice(50).every(Number.isFinite))
    check('Anlaufzeit ist leer, nicht 0', w1[0] === null)
    const max = Math.max(...w1.slice(50))
    const min = Math.min(...w1.slice(50))
    check('Sinus treibt die Welle in beide Zonen', max >= 50 && min <= -50, `${min.toFixed(1)} … ${max.toFixed(1)}`)
    const s = signale(w1, w2)
    const longs = s.filter(x => x.long).length
    const shorts = s.filter(x => x.short).length
    check('Signale auf beiden Seiten', longs > 2 && shorts > 2, `${longs}/${shorts}`)
    const i = s.findIndex(x => x.long)
    check('Long-Signal steht in der Long-Zone', w1[i] <= -50 && w1[i] > w2[i] && w1[i - 1] <= w2[i - 1])

    // Gerade Linie: keine Bewegung, keine Zonen
    const flach = welle(reihe(Array(120).fill(100)))
    check('flacher Kurs → Welle 0', flach.w1.slice(40).every(x => Math.abs(x) < 1e-9))
}

console.log('\nGeldfluss')
{
    // Jede Kerze schliesst oben: Zufluss
    const auf = Array.from({ length: 300 }, (_, i) => ({ t: i * H, o: 100, h: 101, l: 99.9, c: 100.9, v: 10 }))
    const mfAuf = geldfluss(auf)
    check('Schluss oben → positiver Geldfluss', mfAuf[299] > 0)
    check('Selbstskalierung: Dauerzufluss landet bei der Zielgrösse 22', Math.abs(mfAuf[299] - 22) < 0.5, String(mfAuf[299]))
    const ab = auf.map(k => ({ ...k, o: 100.9, c: 100 }))
    check('Schluss unten → negativer Geldfluss', geldfluss(ab)[299] < 0)
    // Wie im Pine: ohne Normalmass `0.0`, nicht na — die Fläche liegt am
    // linken Rand auf der Nulllinie statt zu fehlen.
    check('vor 60 Kerzen 0 wie im Pine', geldfluss(auf)[30] === 0)

    // Volumen gewichtet: eine starke Abflusskerze mit viel Volumen dreht mehr
    const gemischt = auf.map((k, i) => (i % 2 ? { ...k, o: 100.9, c: 100, v: 30 } : k))
    check('Volumen gewichtet: schwerer Abfluss überwiegt', geldfluss(gemischt)[299] < 0)
}

console.log('\nHerkunft Spot/Futures')
{
    const n = 260
    const fut = Array.from({ length: n }, (_, i) => ({ t: i * H, o: 1, h: 1, l: 1, c: 1, v: 90 }))
    const spot = fut.map(k => ({ ...k, v: 10 }))
    const mfStark = Array(n).fill(20)
    check('gleichbleibend 90 % Futures ist normal', herkunft(fut, spot, mfStark).urteil === 'normal')

    /*
     * Die Wand, an der die alte Anteils-Rechnung scheiterte: bei 90 %
     * Normalmass lag die Schwelle bei 103,5 %. Als Verhältnis (9×) liegt sie
     * bei 10,35× — erreichbar.
     */
    const futHoch = fut.map((k, i) => (i === n - 1 ? { ...k, v: 990 } : k))   // 99×
    check('bei 90 % Normalmass: plötzlich 99 % → Futures treiben (Anteil konnte das nie)',
        herkunft(futHoch, spot, mfStark).urteil === 'futures')
    check('…aber nicht bei schwachem Geldfluss', herkunft(futHoch, spot, Array(n).fill(2)).urteil === 'normal')
    const knapp = fut.map((k, i) => (i === n - 1 ? { ...k, v: 100 } : k))       // 10× gegen 9×
    check('10× gegen 9× liegt unter der Schwelle 1,15', herkunft(knapp, spot, mfStark).urteil === 'normal')

    /*
     * Gleiche Empfindlichkeit auf jeder Münze: dieselbe RELATIVE Verschiebung
     * des Verhältnisses (×1,2) löst bei 1:1 und bei 9:1 gleich aus. Mit dem
     * Anteil brauchte 50 % → 57,5 % sieben Punkte, 75 % → 86,2 % elf.
     */
    for (const [f, sp] of [[50, 50], [75, 25], [90, 10], [97, 3]]) {
        const basisF = fut.map(k => ({ ...k, v: f }))
        const basisS = fut.map(k => ({ ...k, v: sp }))
        const hoch = basisF.map((k, i) => (i === n - 1 ? { ...k, v: f * 1.2 } : k))
        const tief = basisF.map((k, i) => (i === n - 1 ? { ...k, v: f / 1.2 } : k))
        check(`${f} % Normalmass: ×1,2 → Futures, ÷1,2 → Spot`,
            herkunft(hoch, basisS, mfStark).urteil === 'futures' && herkunft(tief, basisS, mfStark).urteil === 'spot')
    }

    const v = herkunft(futHoch, spot, mfStark)
    check('Anteil zum Ablesen bleibt Fut/(Fut+Spot)', Math.abs(v.anteil - 0.99) < 1e-9 && v.verhaeltnis === 99)

    const ohneSpotVolumen = spot.map((k, i) => (i === n - 1 ? { ...k, v: 0 } : k))
    check('Spot-Volumen 0 → kein Verhältnis statt Unendlich', herkunft(fut, ohneSpotVolumen, mfStark).verhaeltnis === null)

    const spotHoch = spot.map((k, i) => (i === n - 1 ? { ...k, v: 90 } : k))  // 50 %
    check('plötzlich 50 % → Spot trägt', herkunft(fut, spotHoch, mfStark).urteil === 'spot')
    check('ohne Spot keine Aussage', herkunft(fut, null, mfStark).urteil === null)

    const lueckeJetzt = spot.slice(0, -1)
    check('fehlt Spot an der letzten Kerze, ist der Anteil unbekannt',
        herkunft(fut, lueckeJetzt, mfStark).anteil === null)
}

console.log('\nAusrichtung höherer Zeitebenen (Look-ahead)')
{
    const T0 = Date.UTC(2026, 0, 5)
    const chart = Array.from({ length: 16 }, (_, i) => ({ t: T0 + i * 15 * 60000 }))
    const h1 = Array.from({ length: 4 }, (_, i) => ({ t: T0 + i * H }))
    const a = richteAus(chart, h1, H)
    check('in der ersten Stunde gilt noch keine 1h-Kerze', a.slice(0, 4).every(j => j === -1), a.join(','))
    check('ab 01:00 gilt die 00:00-Kerze', a[4] === 0 && a[7] === 0)
    check('ab 02:00 gilt die 01:00-Kerze, nie die laufende', a[8] === 1 && a[11] === 1)
}

console.log('\nVWAP-Perioden')
{
    // Mittwoch, 7. Jan 2026 15:00 UTC → Woche ab Mo 5. Jan, Monat ab 1. Jan
    const jetzt = Date.UTC(2026, 0, 7, 15)
    check('Wochenbeginn Montag 00:00 UTC', periodenBeginn('woche', jetzt) === Date.UTC(2026, 0, 5))
    check('Sonntag gehört zur alten Woche', periodenBeginn('woche', Date.UTC(2026, 0, 11, 23)) === Date.UTC(2026, 0, 5))
    check('Monatsbeginn', periodenBeginn('monat', jetzt) === Date.UTC(2026, 0, 1))
    const k = [
        { t: Date.UTC(2026, 0, 4, 23), h: 999, l: 999, c: 999, v: 1000 },  // vor der Woche
        { t: Date.UTC(2026, 0, 5, 0), h: 100, l: 100, c: 100, v: 1 },
        { t: Date.UTC(2026, 0, 5, 1), h: 200, l: 200, c: 200, v: 3 },
    ]
    check('VWAP nur ab Periodenbeginn, volumengewichtet', vwapSeit(k, Date.UTC(2026, 0, 5)) === 175)
    check('ohne Kerzen kein VWAP', vwapSeit(k, Date.UTC(2026, 1, 1)) === null)
}

console.log('\nStruktur (BOS/CHoCH)')
{
    // Anstieg mit Hoch bei Index 10 (120), dann Rücksetzer auf 105, dann Bruch über 120
    const hoch = [100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 116, 112, 110, 108, 106, 105, 108, 112, 116, 121, 123, 124]
    const s1 = struktur(reihe(hoch, 4 * H))
    check('Bruch über das Swing-Hoch nach oben', s1.richtung === 1, JSON.stringify(s1))
    check('erster Bruch ist kein CHoCH', s1.choch === false)
    check('Level ist das gebrochene Hoch', Math.abs(s1.level - 120 * 1.005) < 1e-9, String(s1.level))
    check('Alter zählt ab dem Überqueren, nicht ab „liegt drüber"', s1.alterKerzen === 2, String(s1.alterKerzen))

    // Danach Absturz unter das Tief des Rücksetzers (105) → CHoCH abwärts
    const runter = [...hoch, 120, 116, 112, 108, 104, 100]
    const s2 = struktur(reihe(runter, 4 * H))
    check('Bruch gegen die Richtung ist CHoCH', s2.richtung === -1 && s2.choch === true, JSON.stringify(s2))
}

console.log('\nPunktstärke: welche Zeitebenen zählen')
{
    check('15m-Chart: 1h, 4h, D zählen', ['1h', '4h', '1d'].every(tf => zaehltFuerStaerke(tf, '15m')))
    check('15m-Chart: W zählt nicht (erst ab Tageschart)', !zaehltFuerStaerke('1w', '15m'))
    check('5m zählt nie (nur anzeigen)', !zaehltFuerStaerke('5m', '1m') && !zaehltFuerStaerke('15m', '5m'))
    check('Chart-Zeitebene selbst zählt nicht', !zaehltFuerStaerke('1h', '1h'))
    check('4h-Chart: nur D', zaehltFuerStaerke('1d', '4h') && !zaehltFuerStaerke('1h', '4h'))
}

console.log('\nGesamtauswertung')
{
    const T0 = Date.UTC(2026, 0, 5)
    const lang = (n, ms, periode) => reihe(sinus(n, periode), ms, T0 - n * ms)
    const kerzen = {
        '1w': lang(120, 7 * 24 * H, 20),
        '1d': lang(300, 24 * H, 30),
        '4h': lang(400, 4 * H, 35),
        '1h': lang(600, H, 40),
        '15m': lang(400, 15 * 60000, 40),
        '5m': lang(400, 5 * 60000, 40),
    }
    const r = werteAus({ kerzen, chartTf: '15m' })
    check('15m-Chart läuft im Day-Modus', r.modus === 'day')
    check('Status ist das Day-Setup', r.status === r.day)
    check('sechs Zeitebenen im Panel', r.zeitebenen.length === 6)
    check('Verlauf auf 150 Kerzen geschnitten', r.verlauf.w1.length === 150 && r.verlauf.t.length === 150)
    check('Punkte liegen im Fenster', r.verlauf.punkte.every(p => p.i >= 0 && p.i < 150))
    check('Schienen nur von Zeitebenen über dem Chart',
        r.verlauf.schienen.every(s => ['1h', '4h', '1d'].includes(s.tf)), JSON.stringify(r.verlauf.schienen))
    check('ohne Spot keine Herkunft und keine Spot-Linie', r.herkunft.urteil === null && r.verlauf.mfSpot === null)
    check('Divergenzen verbinden gleichfarbige Punkte im Fenster',
        r.verlauf.divergenzen.every(d => d.i1 < d.i2 && d.i1 >= 0))

    const r4 = werteAus({ kerzen, chartTf: '4h' })
    check('4h-Chart läuft im Swing-Modus', r4.modus === 'swing' && r4.status === r4.swing)
    check('4h-Chart: Stärke-Hürde aus D + Geldfluss = 2', r4.staerke.noetig === 2, JSON.stringify(r4.staerke))

    let geworfen = false
    try { werteAus({ kerzen: { ...kerzen, '15m': kerzen['15m'].slice(0, 10) }, chartTf: '15m' }) } catch { geworfen = true }
    check('zu wenige Chart-Kerzen → Fehler statt leerer Aussage', geworfen)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) {
    console.log(`\x1b[31mFehler: ${fehler.join(', ')}\x1b[0m\n`)
    process.exit(1)
}
console.log('')
