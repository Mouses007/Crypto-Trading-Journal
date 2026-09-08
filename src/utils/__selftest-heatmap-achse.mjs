/**
 * Selbsttest der Zeitachse (Faltung/Streckung der Heatmap).
 *
 *   node src/utils/__selftest-heatmap-achse.mjs
 *
 * Diese Rechnung entscheidet, welche Ringspalten hinter welchem Pixel liegen.
 * Sie kann auf drei Arten still schiefgehen, und keine davon fällt im Bild auf
 * — es sähe nur „irgendwie anders" aus:
 *
 *  1. Eine LÜCKE zwischen zwei Pixeln verschluckt Spalten. Das Bild ist
 *     vollständig, die Daten sind es nicht.
 *  2. Nicht MONOTON, und die binäre Suche nach der Pixelspalte eines Trades
 *     liefert irgendetwas — Blasen landen an falschen Stellen.
 *  3. Bei k = 1 nicht exakt die alte 1:1-Zuordnung, und der ganze Umbau hätte
 *     die native Ansicht nebenbei verändert.
 */

import { spaltenProPixel, spaltenFenster, K_MIN, K_MAX } from './heatmapAchse.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nSpalten je Pixel\n')
{
    check('ohne Spanne nativ', spaltenProPixel(0, 500, 800) === 1)
    check('ohne Takt nativ', spaltenProPixel(900000, 0, 800) === 1)
    check('15 min bei 500 ms auf 800 px', Math.abs(spaltenProPixel(900000, 500, 800) - 2.25) < 1e-9)
    check('1 h bei 500 ms auf 800 px', Math.abs(spaltenProPixel(3600000, 500, 800) - 9) < 1e-9)
    // 1 Minute auf 800 px sind 120 Spalten — das ist Strecken, nicht Falten
    check('1 min streckt (k < 1)', spaltenProPixel(60000, 500, 800) === 0.15)
    check('nach unten geklemmt', spaltenProPixel(1, 500, 800) === K_MIN)
    check('nach oben geklemmt', spaltenProPixel(1e12, 500, 800) === K_MAX)
}

console.log('\nSpaltenfenster\n')
{
    // 1. Native Auflösung muss Zeile für Zeile die alte Zuordnung sein
    const n = 200
    let nativOk = true
    for (let px = 0; px < n; px++) {
        const { jung, alt } = spaltenFenster(px, n, 1)
        if (jung !== n - 1 - px || alt !== n - 1 - px) { nativOk = false; break }
    }
    check('k = 1 ist exakt die alte 1:1-Zuordnung', nativOk)
}

for (const k of [1, 1.5, 2, 2.25, 3, 9, 0.15, 0.25, 0.5, K_MIN, K_MAX]) {
    const n = 137          // krumm, damit sich Rundungsfehler nicht wegkürzen
    const fenster = []
    for (let px = 0; px < n; px++) fenster.push(spaltenFenster(px, n, k))

    // 2. lückenfrei: der linke Nachbar setzt spätestens dort an, wo dieser aufhört
    let luecke = -1
    for (let px = 1; px < n; px++) {
        if (fenster[px - 1].jung > fenster[px].alt + 1) { luecke = px; break }
    }
    check(`k=${k}: keine Lücke zwischen den Pixeln`, luecke < 0, `bei px=${luecke}`)

    // 3. monoton: nach rechts wird es jünger (kleinerer Abstand zum Kopf)
    let unsortiert = -1
    for (let px = 1; px < n; px++) {
        if (fenster[px].jung > fenster[px - 1].jung) { unsortiert = px; break }
    }
    check(`k=${k}: monoton von links nach rechts`, unsortiert < 0, `bei px=${unsortiert}`)

    // 4. wohlgeformt: jung ≤ alt, nichts negativ
    const kaputt = fenster.findIndex(f => f.jung < 0 || f.alt < f.jung)
    check(`k=${k}: jung ≤ alt und nie negativ`, kaputt < 0, `bei px=${kaputt}`)

    // 5. das rechteste Pixel muss die NEUESTE Spalte enthalten, sonst fehlt
    //    rechts der aktuelle Rand — der Teil, auf den man beim Handeln schaut
    check(`k=${k}: rechtes Pixel enthält Spalte 0`, fenster[n - 1].jung === 0)
}

{
    /*
     * Gegenprobe zur Faltung: bei k = 9 muss das Bild wirklich neunmal so viel
     * Zeit abdecken. Fiele die Abdeckung kleiner aus, zeigte die Auswahl „1 h"
     * stillschweigend weniger als eine Stunde.
     */
    const n = 800, k = 9
    const aeltester = spaltenFenster(0, n, k).alt
    check('k=9 deckt rund das Neunfache ab',
        aeltester >= n * k - 2 && aeltester <= n * k + 2, `ältester=${aeltester}, erwartet ≈${n * k}`)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler: ' + fehler.join(', ')); process.exit(1) }
