/**
 * Selbsttest der statistischen Grundrechnungen.
 *
 *   node shared/__selftest-statistik.mjs
 *
 * Spearman stand dreimal im Projekt, zweimal ohne Bindungskorrektur. Der
 * Unterschied fällt nie als Absturz auf: die Kurzformel liefert bei Bindungen
 * still einen zu hohen Betrag, und das Ergebnis hängt davon ab, in welcher
 * Reihenfolge `sort` gleiche Werte zufällig stehen liess. Genau das prüft der
 * wichtigste Fall hier.
 */
import { median, spearman, raenge } from './statistik.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const nahe = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

console.log('\nMedian\n')
check('ungerade Anzahl nimmt die Mitte', median([3, 1, 2]) === 2)
check('gerade Anzahl mittelt die beiden Mittleren', median([1, 2, 3, 4]) === 2.5)
check('unsortierte Eingabe stört nicht', median([10, -5, 3]) === 3)
check('leere Reihe ergibt null, nicht 0', median([]) === null)
check('nur unlesbare Werte ergeben null', median([NaN, undefined, 'x']) === null)
check('unlesbare Werte werden übersprungen', median([1, NaN, 3, 'x']) === 2)
check('Eingabe wird nicht verändert', (() => { const a = [3, 1, 2]; median(a); return a[0] === 3 })())

/*
 * Der Fall, um den es geht: vier Verlustsitzungen und ein grosser Gewinn.
 * Der Durchschnitt sagt "gut", der Median sagt die Wahrheit.
 */
{
    const werte = [-20, -15, -10, -5, 200]
    const schnitt = werte.reduce((a, b) => a + b, 0) / werte.length
    check('Ausreisser kippt den Durchschnitt, nicht den Median',
        schnitt > 0 && median(werte) === -10, `Ø ${schnitt}, Median ${median(werte)}`)
}

console.log('\nRänge mit Bindungen\n')
check('ohne Bindungen 1..n', JSON.stringify(raenge([10, 20, 30])) === JSON.stringify([1, 2, 3]))
check('zwei gleiche teilen sich den mittleren Rang',
    JSON.stringify(raenge([10, 10, 30])) === JSON.stringify([1.5, 1.5, 3]),
    JSON.stringify(raenge([10, 10, 30])))
check('drei gleiche bekommen alle Rang 2',
    JSON.stringify(raenge([5, 5, 5])) === JSON.stringify([2, 2, 2]))
check('Rangsumme bleibt n(n+1)/2 auch mit Bindungen',
    nahe(raenge([1, 1, 2, 2, 3]).reduce((a, b) => a + b, 0), 15))

console.log('\nSpearman\n')
check('perfekt gleichläufig ergibt 1', nahe(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1))
check('perfekt gegenläufig ergibt −1', nahe(spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1))
check('monotone Verzerrung ändert nichts', nahe(spearman([1, 2, 3, 4], [1, 4, 9, 16]), 1))

/*
 * DER Fall. Mit Bindungen in beiden Reihen weicht die Kurzformel
 * `1 − 6Σd²/(n(n²−1))` vom richtigen Wert ab. Läge unsere Fassung daneben,
 * wäre sie die Kurzformel.
 */
{
    const xs = [1, 2, 2, 4, 5]
    const ys = [1, 3, 3, 3, 5]
    const rho = spearman(xs, ys)
    // Von Hand über die Mittelränge gerechnet: rx=[1,2.5,2.5,4,5], ry=[1,3,3,3,5]
    const rx = [1, 2.5, 2.5, 4, 5]
    const ry = [1, 3, 3, 3, 5]
    const mx = 3, my = 3
    let o = 0, sx = 0, sy = 0
    for (let i = 0; i < 5; i++) { o += (rx[i] - mx) * (ry[i] - my); sx += (rx[i] - mx) ** 2; sy += (ry[i] - my) ** 2 }
    const soll = o / Math.sqrt(sx * sy)
    check('Bindungen: stimmt mit der Rechnung über Mittelränge überein', nahe(rho, soll), `${rho} vs ${soll}`)

    const d2 = rx.reduce((s, v, i) => s + (v - ry[i]) ** 2, 0)
    const kurz = 1 - (6 * d2) / (5 * 24)
    check('Bindungen: weicht von der Kurzformel ab (sonst wäre es die Kurzformel)',
        !nahe(rho, kurz), `unsere ${rho}, Kurzformel ${kurz}`)
}

/*
 * Die zweite Eigenschaft der Bindungskorrektur: das Ergebnis darf NICHT davon
 * abhängen, in welcher Reihenfolge gleiche Werte in der Eingabe stehen.
 */
{
    const a = spearman([1, 2, 2, 3], [5, 7, 7, 9])
    const b = spearman([1, 2, 2, 3], [5, 7, 7, 9].slice())
    const c = spearman([3, 2, 2, 1], [9, 7, 7, 5])
    check('Reihenfolge gleicher Werte ändert das Ergebnis nicht',
        nahe(a, b) && nahe(a, c), `${a} / ${b} / ${c}`)
}

console.log('\nNicht messbar ist nicht 0\n')
check('zu wenige Paare ergeben null', spearman([1, 2], [1, 2]) === null)
check('eigene Untergrenze wird beachtet', spearman([1, 2, 3, 4], [1, 2, 3, 4], 10) === null)
check('konstante Reihe ergibt null, nicht 0', spearman([1, 1, 1, 1], [1, 2, 3, 4]) === null)
check('leere Reihen ergeben null', spearman([], []) === null)
check('Ergebnis bleibt in [−1, 1]',
    [[1, 2, 3, 4], [4, 3, 2, 1]].every(() => { const r = spearman([1, 2, 3, 4], [4, 3, 2, 1]); return r >= -1 && r <= 1 }))
check('ungleich lange Reihen nutzen die kürzere', nahe(spearman([1, 2, 3, 4, 5], [10, 20, 30]), 1))

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler: ' + fehler.join(', ')); process.exit(1) }
