/**
 * Selbsttest der Chartbild-Substanzprüfung.
 *
 * Zu jeder Fangprobe eine Gegenprobe. Ein Gate, das zu streng ist, wirft die
 * eine brauchbare Chartanalyse weg, die der ganze Lauf produziert hat — und
 * niemand vermisst eine Grafik, die er nie gesehen hat. Deshalb steht neben
 * „die Floskel fällt" immer „die konkrete Aussage bleibt".
 */

import { bewerteChartGehalt, istFormfloskel, marktMarken } from './news-bildgehalt.js'

let bestanden = 0, fehlgeschlagen = 0
const gruppe = (name) => console.log(`\n${name}`)
const pruefe = (was, bedingung) => {
    if (bedingung) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${was}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${was}`) }
}

gruppe('Formfloskel erkennen')
{
    // Die reale Bildunterschrift vom 30.08.2026, die den Anlass gab.
    const floskel = 'Ein Preis-Chart mit farblich hervorgehobenen horizontalen Unterstützungs- und Widerstandszonen sowie markierten Kerzen'
    pruefe('die reale Leerformel gilt als Floskel', istFormfloskel(floskel))
    pruefe('leerer Text gilt als Floskel', istFormfloskel(''))
    pruefe('reines Formvokabular ohne Zahl ist Floskel', istFormfloskel('Chart zeigt eine Trendlinie und Kerzen'))
}

gruppe('Gegenprobe: konkrete Aussage ist keine Floskel')
{
    pruefe('eine Zahl reicht gegen die Floskel',
        !istFormfloskel('Bruch über 46.000 eröffnet das Ziel bei 52.000'))
    pruefe('kurze konkrete Aussage bleibt',
        !istFormfloskel('Unterstützung bei 38.500 hält'))
    // Ohne Formvokabular UND ohne Zahl: kein Chartsatz, aber auch keine
    // Chartfloskel — Formfloskel bezieht sich auf Chartbeschreibungen.
    pruefe('formfremder Satz ohne Zahl ist keine Chartfloskel',
        !istFormfloskel('Die Notenbank tagt am Mittwoch'))
}

gruppe('Marken zählen — Nicht-Messwerte ausschliessen')
{
    pruefe('zwei Preise ergeben zwei Marken',
        marktMarken({ marken: ['46.000', '38.500'] }).size === 2)
    pruefe('Indikator-Periode ist keine Marke',
        marktMarken({ marken: ['200 EMA'] }).size === 0)
    pruefe('reiner Timeframe ist keine Marke',
        marktMarken({ marken: ['1W'] }).size === 0)
    pruefe('fehlendes Feld stürzt nicht ab',
        marktMarken({}).size === 0)
}

gruppe('Gesamturteil: fail')
{
    pruefe('kein Chart fällt durch',
        bewerteChartGehalt({ istChart: false, marken: ['46.000', '52.000'], aussage: 'x' }) === 'fail')
    pruefe('Chart ohne Marke mit Floskel fällt durch',
        bewerteChartGehalt({
            istChart: true, marken: [],
            aussage: 'Ein Chart mit Unterstützungs- und Widerstandszonen und markierten Kerzen',
        }) === 'fail')
    pruefe('Chart ohne Marke und ohne Aussage fällt durch',
        bewerteChartGehalt({ istChart: true, marken: [], aussage: '' }) === 'fail')
}

gruppe('Gesamturteil: pass')
{
    pruefe('Chart mit zwei Marken und zahlhaltiger Aussage besteht',
        bewerteChartGehalt({
            istChart: true, marken: ['46.000', '52.000'],
            aussage: 'Aufwärtstrend intakt; Bruch über 46.000 eröffnet 52.000, darunter droht Rücklauf.',
        }) === 'pass')
}

gruppe('Gesamturteil: grenzfall an den Judge')
{
    pruefe('genau eine Marke ist ein Grenzfall',
        bewerteChartGehalt({ istChart: true, marken: ['46.000'], aussage: 'Widerstand bei 46.000 im Blick.' }) === 'grenzfall')
    pruefe('zahlhaltige Aussage ohne befülltes Markenfeld ist ein Grenzfall',
        bewerteChartGehalt({ istChart: true, marken: [], aussage: 'Bruch über 46.000 eröffnet 52.000.' }) === 'grenzfall')
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
