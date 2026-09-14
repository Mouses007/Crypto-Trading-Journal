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

import { liqPreisLong, liqPreisShort, hebelHaltbar, liqPreis, hebelFuerLiqPreis } from './liquidation.js'

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


/*
 * Die Umkehrung (Margen-Netz auf Boersen ohne Stop-Order).
 *
 * Geprueft wird als RUNDREISE: aus dem gewuenschten Liquidationspreis einen
 * Hebel rechnen, ihn in die Vorwaertsformel stecken, wieder beim Ziel landen.
 * Ein eigener Sollwert waere hier wertlos — er waere dieselbe Algebra ein
 * zweites Mal hingeschrieben. Die Rundreise prueft dagegen genau das, worauf
 * sich das Netz verlaesst: dass die beiden Formeln zueinander passen.
 */
console.log('\nUmkehrung (hebelFuerLiqPreis)')

for (const [E, Z, m, r] of [
    [100, 99, 0.004, 'long'],
    [100, 101, 0.004, 'short'],
    [64000, 62720, 0.004, 'long'],     // BTC, Stop 2 % darunter
    [2500, 2450, 0.01, 'long'],        // Alt-Coin mit 1 % Wartungsmarge
    [2500, 2550, 0.01, 'short'],
    [0.00001234, 0.00001210, 0.02, 'long'],  // Kleinstpreis: Rundung darf nicht kippen
]) {
    const L = hebelFuerLiqPreis(E, Z, m, r)
    check(`Rundreise ${r} E=${E} Z=${Z} m=${m} (L=${L.toFixed(2)})`,
        L > 0 && Math.abs(liqPreis(E, L, m, r) - Z) < Math.abs(Z) * 1e-9,
        `liq=${liqPreis(E, L, m, r)}`)
}

// Die Faustregel, die an jeder Aufrufstelle bekannt sein muss: der noetige
// Hebel ist ungefaehr der Kehrwert des relativen Stopabstands. Ohne mmr waere
// es exakt 1/abstand; die Wartungsmarge macht ihn etwas kleiner.
{
    const E = 100000
    const L1 = hebelFuerLiqPreis(E, E * 0.99, 0.004, 'long')   // 1 % Abstand
    const L2 = hebelFuerLiqPreis(E, E * 0.98, 0.004, 'long')   // 2 % Abstand
    check('1 % Stopabstand verlangt Hebel zwischen 60 und 80', L1 > 60 && L1 < 80, String(L1))
    check('groesserer Abstand = kleinerer Hebel (Monotonie)', L2 < L1)

    // Die Regel ist 1/(a + m), NICHT 1/a. Der Unterschied ist kein Feinschliff:
    // bei a = 0,1 % und m = 0,4 % waeren es 1000 gegen 200 — Faktor fuenf, und
    // zwar zugunsten des Netzes. Wer hier 1/a annimmt, haelt das Margen-Netz
    // faelschlich fuer unerreichbar und schaltet es ab.
    const m = 0.004
    for (const a of [0.001, 0.01, 0.02, 0.10]) {
        const L = hebelFuerLiqPreis(E, E * (1 - a), m, 'long')
        check(`Faustregel 1/(a+m) trifft bei a=${(a * 100).toFixed(1)} %`,
            Math.abs(L - 1 / (a + m)) / L < 0.01, `${L.toFixed(1)} vs ${(1 / (a + m)).toFixed(1)}`)
    }
    check('1/a allein waere bei engem Stop deutlich daneben',
        Math.abs(hebelFuerLiqPreis(E, E * 0.999, m, 'long') - 1 / 0.001) > 100)
}

/*
 * Ein Ziel auf der falschen Seite ist kein Grenzfall, sondern ein Denkfehler
 * beim Aufrufer: ein Long wird UNTER dem Einstieg liquidiert. Faellt das hier
 * durch, bekaeme das Margen-Netz einen Hebel geliefert, der rechnerisch stimmt
 * und fachlich Unsinn ist — und die UI zeigte ein Netz an, das es nicht gibt.
 */
check('Long mit Ziel UEBER dem Einstieg → 0', hebelFuerLiqPreis(100, 101, 0.004, 'long') === 0)
check('Short mit Ziel UNTER dem Einstieg → 0', hebelFuerLiqPreis(100, 99, 0.004, 'short') === 0)
// Ziel = Einstieg ergibt rechnerisch L = 1/m (hier 250) — die Liquidation
// laege exakt auf dem Einstieg, die Position waere bei Eroeffnung schon weg.
// `hebelHaltbar` laesst das wegen Gleitkomma-Rest knapp durch, deshalb faengt
// das Modul es mit Toleranz ab.
check('Ziel gleich Einstieg → 0 (Position waere sofort liquidiert)',
    hebelFuerLiqPreis(100, 100, 0.004, 'long') === 0 && hebelFuerLiqPreis(100, 100, 0.004, 'short') === 0)
check('Ziel knapp jenseits des Grenzhebels wird noch geliefert',
    hebelFuerLiqPreis(100, 99.9, 0.004, 'long') > 0)
check('kaputte Eingaben → 0 statt NaN',
    hebelFuerLiqPreis(0, 99, 0.004, 'long') === 0
    && hebelFuerLiqPreis(100, 0, 0.004, 'long') === 0
    && hebelFuerLiqPreis('quatsch', 99, 0.004, 'long') === 0)

// Gegenprobe zur Vorwaertsformel: der zurueckgerechnete Hebel muss haltbar
// sein. Waere er es nicht, gaebe liqPreis den Einstieg zurueck und die
// Rundreise oben waere still gruen, ohne etwas zu pruefen.
{
    const L = hebelFuerLiqPreis(100, 99, 0.004, 'long')
    check('zurueckgerechneter Hebel ist haltbar', hebelHaltbar(L, 0.004))
}

console.log(`\n${ok} bestanden, ${fehler} fehlgeschlagen`)
if (fehler) process.exit(1)
