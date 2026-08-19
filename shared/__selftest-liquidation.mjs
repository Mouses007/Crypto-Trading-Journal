/**
 * Selbsttest für `shared/liquidation.js`.
 *
 *   node shared/__selftest-liquidation.mjs
 *
 * Warum eigener Test: die Formel wurde bis zum Audit vom 19.08.2026 an zwei
 * Stellen unabhängig gepflegt (Backtest und Hebelkarte) und lief auseinander.
 * Die Sollwerte hier stehen als Arithmetik da, nicht als aus dem Modul
 * gezogene Zahlen — sonst prüfte der Test nur, dass das Modul mit sich selbst
 * übereinstimmt.
 */

import { liqPreisLong, liqPreisShort, hebelHaltbar, liqPreis } from './liquidation.js'

let ok = 0
let fehler = 0
function check(name, bedingung, detail = '') {
    if (bedingung) { ok++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehler++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const nah = (a, b) => Math.abs(a - b) < 1e-9

console.log('Börsenformel (Binance USDⓈ-M, Stufe 1)')

// Einstieg 100, Hebel 20, MMR 0,4 %
check('Long: E·(1 − 1/L)/(1 − m)', nah(liqPreisLong(100, 20, 0.004), 95 / 0.996),
    String(liqPreisLong(100, 20, 0.004)))
check('Short: E·(1 + 1/L)/(1 + m)', nah(liqPreisShort(100, 20, 0.004), 105 / 1.004),
    String(liqPreisShort(100, 20, 0.004)))

// Ohne Wartungsmarge bleibt der reine Margen-Aufbrauch übrig
check('Wartungsmarge 0 → Long bei E·(1 − 1/L)', nah(liqPreisLong(100, 20, 0), 95))
check('Wartungsmarge 0 → Short bei E·(1 + 1/L)', nah(liqPreisShort(100, 20, 0), 105))

// Hebel 1 heisst: das ganze Kapital steckt drin, der Long geht erst bei 0 kaputt
check('Hebel 1 liquidiert den Long erst bei 0 (ohne Wartungsmarge)',
    nah(liqPreisLong(100, 1, 0), 0), String(liqPreisLong(100, 1, 0)))

/*
 * Abstand zur alten Näherung (Wartungsmarge aufs EINSTIEGS-Nominal), die bis
 * zum Audit im Fill-Simulator stand. BEIDE Börsenpreise liegen unter der
 * Näherung — für den Long heisst das später liquidiert, für den Short früher.
 * Die Näherung war also beim Long optimistisch und beim Short pessimistisch.
 * Der Betrag ist wirtschaftlich vernachlässigbar (≤ 0,5 % der Pufferdistanz);
 * die Richtung muss trotzdem stimmen, sonst ist ein Vorzeichen verrutscht.
 */
{
    const naeherungLong = 100 * (1 - (1 / 20 - 0.004))
    const naeherungShort = 100 * (1 + (1 / 20 - 0.004))
    check('Long: Börsenformel liquidiert später als die alte Näherung',
        liqPreisLong(100, 20, 0.004) < naeherungLong,
        `${liqPreisLong(100, 20, 0.004)} vs ${naeherungLong}`)
    check('Short: Börsenformel liquidiert früher als die alte Näherung',
        liqPreisShort(100, 20, 0.004) < naeherungShort,
        `${liqPreisShort(100, 20, 0.004)} vs ${naeherungShort}`)
    check('Abstand Long bleibt unter 0,5 % der Pufferdistanz',
        Math.abs(liqPreisLong(100, 20, 0.004) - naeherungLong) < 0.005 * (100 - naeherungLong),
        String(Math.abs(liqPreisLong(100, 20, 0.004) - naeherungLong)))
    check('Abstand Short bleibt unter 0,5 % der Pufferdistanz',
        Math.abs(liqPreisShort(100, 20, 0.004) - naeherungShort) < 0.005 * (naeherungShort - 100),
        String(Math.abs(liqPreisShort(100, 20, 0.004) - naeherungShort)))
}

console.log('\nHaltbarkeit des Hebels')

check('1/20 > 0,4 % → haltbar', hebelHaltbar(20, 0.004))
check('1/300 < 0,4 % → nicht haltbar', !hebelHaltbar(300, 0.004))
// Genau auf der Kante: die Marge deckt die Wartungsmarge exakt, kein Puffer
check('genau auf der Kante gilt als nicht haltbar', !hebelHaltbar(250, 0.004))
// Alt-Coin mit 2,5 % kann bei Hebel 50 gar nicht offen sein
check('MMR 2,5 % macht Hebel 50 unmöglich', !hebelHaltbar(50, 0.025))

console.log('\nliqPreis(): Richtung, Randfälle')

check('Richtung long', nah(liqPreis(100, 20, 0.004, 'long'), liqPreisLong(100, 20, 0.004)))
check('Richtung short', nah(liqPreis(100, 20, 0.004, 'short'), liqPreisShort(100, 20, 0.004)))
check('unhaltbarer Hebel → sofort am Einstieg', liqPreis(100, 300, 0.004, 'long') === 100)
check('Einstieg 0 → 0 statt NaN', liqPreis(0, 20, 0.004, 'long') === 0)
check('Hebel 0 → 0 statt Unendlich', liqPreis(100, 0, 0.004, 'long') === 0)
check('kaputte Eingabe → 0 statt NaN', liqPreis('quatsch', 20, 0.004, 'long') === 0)
check('negative Wartungsmarge wird auf 0 gezogen',
    nah(liqPreis(100, 20, -1, 'long'), 95), String(liqPreis(100, 20, -1, 'long')))

/*
 * Einheiten-Falle, die den Kanon überhaupt nötig machte: 0.004 ist ein Bruch.
 * Wer 0,4 (den Prozentwert) hineinsteckt, bekommt eine Wartungsmarge von 40 %
 * — und damit einen unhaltbaren Hebel schon bei 3. Der Test hält fest, dass
 * das Modul den Bruch erwartet.
 */
check('0,4 statt 0,004 macht Hebel 20 unhaltbar (Prozent ≠ Bruch)',
    liqPreis(100, 20, 0.4, 'long') === 100)

console.log(`\n${ok} bestanden, ${fehler} fehlgeschlagen`)
if (fehler) process.exit(1)
