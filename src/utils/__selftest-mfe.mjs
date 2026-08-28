/**
 * Selbsttest der MFE-R-Rechnung.
 *
 *   node src/utils/__selftest-mfe.mjs
 *
 * Diese Rechnung trägt die Take-Profit-Empfehlung des Journals. Sie zeigte
 * monatelang konstant 20,00 an — nicht als Messergebnis, sondern als oberen
 * Rand der Stufenliste: eine Kursdifferenz (USD je Stück) wurde durch einen
 * Tradebetrag (USD je Trade) geteilt, R kam um den Faktor 1/Menge zu gross
 * heraus, und damit lag jeder Trade über jeder angebotenen Zielstufe.
 *
 * Der Test hält beide Richtungen fest: die grosse Menge (DOGE) muss ein
 * kleines R geben, die kleine Menge (BTC) ein moderates — vorher war es
 * genau umgekehrt.
 */

import { mfeR, mfeDifferenz, mengeFuerR, hatMfeMessung } from './mfe-kern.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const nahe = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

console.log('\nMFE in R\n')

/*
 * Der Beleg aus dem Audit vom 28.08.2026: BTCUSDT, 0,05 BTC, Einstieg
 * 100 000, MFE-Preis 101 500, durchschnittlicher Netto-Verlusttrade 250 USD.
 * Soll (1500 × 0,05) / 250 = 0,30 R. Vorher: 1500 / 250 = 6,00 R.
 */
{
    const btc = { entryPrice: 100000, strategy: 'long', buyQuantity: 0.05 }
    check('BTC-Beleg ergibt 0,30 R', nahe(mfeR(btc, 101500, 250), 0.30), String(mfeR(btc, 101500, 250)))
    check('BTC-Beleg ergibt NICHT 6,00 R', !nahe(mfeR(btc, 101500, 250), 6))
}

/*
 * Die Gegenprobe ist die wichtigere: DOGEUSDT mit grosser Menge musste vorher
 * ein verschwindend kleines R zeigen (0,00002) und tauchte in der Auswertung
 * nie auf. Richtig gerechnet sind es 0,10 R.
 */
{
    const doge = { entryPrice: 0.20, strategy: 'long', buyQuantity: 5000 }
    check('DOGE-Gegenprobe ergibt 0,10 R', nahe(mfeR(doge, 0.205, 250), 0.10), String(mfeR(doge, 0.205, 250)))
}

/*
 * Mengenunabhängigkeit bei gleichem Dollarbetrag: derselbe Gewinn in USD muss
 * dasselbe R ergeben, egal ob er aus wenig Stück mit grosser Kursbewegung oder
 * viel Stück mit kleiner stammt. Vorher skalierte R mit 1/Menge.
 */
{
    const a = mfeR({ entryPrice: 100, strategy: 'long', buyQuantity: 10 }, 110, 50)   // 100 USD
    const b = mfeR({ entryPrice: 1000, strategy: 'long', buyQuantity: 1 }, 1100, 50)  // 100 USD
    check('gleicher USD-Betrag ergibt gleiches R', nahe(a, b) && nahe(a, 2), `${a} vs ${b}`)
}

console.log('\nRichtung\n')
{
    const long = { entryPrice: 100, strategy: 'long', buyQuantity: 1 }
    const short = { entryPrice: 100, strategy: 'short', buyQuantity: 1 }
    check('Long misst nach oben', nahe(mfeDifferenz(long, 110), 10))
    check('Short misst nach unten', nahe(mfeDifferenz(short, 90), 10))
    check('Short mit steigendem Kurs ist negativ', mfeDifferenz(short, 110) === -10)
    check('Short-R ist positiv, wenn der Kurs fiel', nahe(mfeR(short, 90, 5), 2))
}

console.log('\nFehlende Messung ist keine Null\n')

/*
 * `excursions.mfePrice` ist mit 0 vorbelegt. 0 heisst „nie gemessen", nicht
 * „der Kurs fiel auf null" — und bei einem SHORT wird aus `entryPrice − 0`
 * der volle Positionswert als angebliches Gewinnpotenzial.
 *
 * An den echten Daten (28.08.2026): 13 von 26 Einträgen hatten mfePrice 0,
 * ALLE zu Short-Trades, mit R zwischen 25 und 57. Sie allein liessen die
 * oberste Zielstufe gewinnen — die zweite Hälfte der Ursache für die
 * konstante 20,00, die im Audit nicht erwähnt ist.
 */
{
    const short = { entryPrice: 100000, strategy: 'short', buyQuantity: 0.05 }
    check('mfePrice 0 ergibt null, nicht eine Zahl', mfeR(short, 0, 250) === null, String(mfeR(short, 0, 250)))
    check('mfePrice 0 ergibt NICHT den Positionswert als R',
        mfeR(short, 0, 250) !== 20 && mfeR(short, 0, 250) !== 5000 / 250)
    check('negativer mfePrice ergibt null', mfeR(short, -5, 250) === null)
    check('fehlender mfePrice ergibt null', mfeR(short, undefined, 250) === null && mfeR(short, null, 250) === null)
    check('Text als mfePrice ergibt null', mfeR(short, 'abc', 250) === null)
    check('hatMfeMessung trennt gemessen von vorbelegt',
        hatMfeMessung(101500) === true && hatMfeMessung(0) === false && hatMfeMessung(undefined) === false)
    // Ein echter Short mit echtem Preis muss weiterhin rechnen.
    check('gemessener Short rechnet normal', Math.abs(mfeR(short, 99000, 250) - 0.2) < 1e-9,
        String(mfeR(short, 99000, 250)))
}

console.log('\nBot-Trades sind ausgenommen\n')

/*
 * Bei Grid-Bots steht in `buyQuantity` bereits ein USDT-Volumen und keine
 * Coin-Menge (createPionexTradeObj: totalVolume / usdtInvestment). Eine
 * Kursdifferenz damit zu multiplizieren erzeugt denselben Einheitenfehler
 * noch einmal — hier mit Faktor 5000 statt 1/0,05.
 */
{
    const bot = { entryPrice: 100, strategy: 'long', buyQuantity: 5000, botType: 'grid' }
    check('botType schliesst aus', mengeFuerR(bot) === 0 && mfeR(bot, 110, 50) === null)
    const bot2 = { entryPrice: 100, strategy: 'long', buyQuantity: 5000, category: 'bot' }
    check('category "bot" schliesst aus', mengeFuerR(bot2) === 0 && mfeR(bot2, 110, 50) === null)
    const echt = { entryPrice: 100, strategy: 'long', buyQuantity: 5000, category: 'futures' }
    check('normale Futures bleiben drin', mengeFuerR(echt) === 5000)
}

console.log('\nNicht rechenbare Fälle ergeben null, nie NaN oder Infinity\n')
{
    const t = { entryPrice: 100, strategy: 'long', buyQuantity: 1 }
    check('Nenner 0 ergibt null', mfeR(t, 110, 0) === null)
    check('Nenner undefined ergibt null', mfeR(t, 110, undefined) === null)
    check('Menge 0 ergibt null', mfeR({ ...t, buyQuantity: 0 }, 110, 50) === null)
    check('Menge fehlt ergibt null', mfeR({ entryPrice: 100, strategy: 'long' }, 110, 50) === null)
    check('negative Menge ergibt 0 Menge', mengeFuerR({ buyQuantity: -5 }) === 0)
    check('kein Trade ergibt 0 Menge', mengeFuerR(undefined) === 0 && mengeFuerR(null) === 0)
    check('Ergebnis ist nie NaN',
        [[t, 110, 50], [t, 0, 50], [{}, 0, 0], [t, 110, 0]]
            .every(([a, b, c]) => { const r = mfeR(a, b, c); return r === null || Number.isFinite(r) }))
    /*
     * Ein echtes 0-R muss weiterhin möglich sein: der Kurs lief bis genau
     * zum Einstieg und nicht weiter. Das IST eine Messung.
     */
    check('gemessene Null-Bewegung ergibt 0, nicht null', mfeR(t, 100, 50) === 0)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler: ' + fehler.join(', ')); process.exit(1) }
