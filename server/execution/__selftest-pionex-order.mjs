/**
 * Selbsttest des Pionex-Order-Pfads — ohne Netz, ohne Datenbank.
 *
 *   node server/execution/__selftest-pionex-order.mjs
 *
 * Geprueft werden die REINEN Teile: die Order-Bodies, die der Schattenbetrieb
 * protokolliert und der Live-Modus sendet, die Fill-Auswertung und die
 * Positions-Normalisierung.
 *
 * Die wichtigste Pruefung hier ist eine Regression, die es noch nicht gab:
 * **im Pionex-Body duerfen KEINE Stop-/Zielfelder stehen.** Der Adapter ist
 * nach dem Vorbild von `bitunix.js` gebaut, und dort gehen `slPrice`/`tpPrice`
 * mit der Order raus. Wer sie hierher kopiert, baut Felder ein, die Pionex
 * stillschweigend ignoriert — die Order geht durch, der Stop existiert nicht,
 * und im Log sieht alles richtig aus. Das faellt sonst erst auf, wenn der Kurs
 * durch den Stop laeuft und nichts passiert.
 */

import { baueOrder, baueCloseOrder, baueZielOrder, rundePreis, fassFillsZusammen, zuPosition, faehigkeiten } from './pionex.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const setupLong = { symbol: 'BTCUSDT', direction: 'long', stopLoss: 64000, takeProfit: 70000 }
const setupShort = { symbol: 'BTCUSDT', direction: 'short', stopLoss: 70000, takeProfit: 64000 }

console.log('\nOrder-Body (baueOrder)\n')
{
    const long = baueOrder({
        setup: setupLong, size: { qty: 0.015 },
        clientOrderId: 'ctj-7-4823', psym: 'BTC_USDT_PERP',
    })
    check('Long öffnet mit side=BUY', long.side === 'BUY')
    check('Symbol ist das UEBERSETZTE Pionex-Symbol', long.symbol === 'BTC_USDT_PERP')
    check('Ordersorte ist MARKET_QTY', long.type === 'MARKET_QTY')
    check('Menge geht als String raus', long.size === '0.015')
    check('deterministische clientOrderId', long.clientOrderId === 'ctj-7-4823')
    check('reduceOnly ist beim Oeffnen false', long.reduceOnly === false)

    const short = baueOrder({
        setup: setupShort, size: { qty: 0.02 },
        clientOrderId: 'ctj-7-4824', psym: 'BTC_USDT_PERP',
    })
    check('Short öffnet mit side=SELL', short.side === 'SELL')

    /*
     * DIE Regression. Pionex kennt diese Felder nicht; stuenden sie im Body,
     * wuerde die Order trotzdem angenommen und der Stop existierte nie.
     */
    const verbotene = ['slPrice', 'tpPrice', 'slStopType', 'tpStopType', 'slOrderType',
        'tpOrderType', 'stopLoss', 'takeProfit', 'triggerPrice', 'stopPrice']
    const gefunden = verbotene.filter((k) => k in long)
    check('KEINE Stop-/Zielfelder im Body (Pionex kennt sie nicht)',
        gefunden.length === 0, `gefunden: ${gefunden.join(', ')}`)

    // Ebenso wenig gehoert der Hebel in den Body — er wird vorher gesetzt.
    check('kein leverage-Feld im Body (wird ueber /account/leverage gesetzt)',
        !('leverage' in long))
    // MARKET_QTY braucht keinen Preis; einer waere hier ein Widerspruch.
    check('kein price-Feld bei einer Marktorder', !('price' in long))
}

console.log('\nKontomodus: positionSide und reduceOnly haengen zusammen\n')
{
    const oneWay = baueOrder({
        setup: setupLong, size: { qty: 1 }, clientOrderId: 'x',
        kontomodus: 'BUYSELL', psym: 'BTC_USDT_PERP',
    })
    check('One-way (BUYSELL) → positionSide BOTH', oneWay.positionSide === 'BOTH')

    const hedgeL = baueOrder({
        setup: setupLong, size: { qty: 1 }, clientOrderId: 'x',
        kontomodus: 'OPENCLOSE', psym: 'BTC_USDT_PERP',
    })
    const hedgeS = baueOrder({
        setup: setupShort, size: { qty: 1 }, clientOrderId: 'x',
        kontomodus: 'OPENCLOSE', psym: 'BTC_USDT_PERP',
    })
    check('Hedge (OPENCLOSE) → positionSide LONG/SHORT',
        hedgeL.positionSide === 'LONG' && hedgeS.positionSide === 'SHORT')
    check('Vorgabe ohne Angabe ist One-way', baueOrder({
        setup: setupLong, size: { qty: 1 }, clientOrderId: 'x', psym: 'P',
    }).positionSide === 'BOTH')
}

console.log('\nSchliessen (baueCloseOrder)\n')
{
    const zu = baueCloseOrder({ psym: 'BTC_USDT_PERP', direction: 'long', netSize: 0.015 })
    check('Long schliesst mit SELL', zu.side === 'SELL')
    check('Short schliesst mit BUY',
        baueCloseOrder({ psym: 'P', direction: 'short', netSize: 1 }).side === 'BUY')
    check('reduceOnly im One-way-Modus', zu.reduceOnly === true)
    check('Marktorder', zu.type === 'MARKET_QTY')

    /*
     * Die Menge wird EXAKT uebernommen, nicht auf eine Schrittweite gerundet.
     * Ein abgerundeter Rest bliebe als offene Position stehen — und die ist auf
     * Pionex ungesichert, weil es keinen Boersen-Stop gibt.
     */
    const krumm = baueCloseOrder({ psym: 'P', direction: 'long', netSize: 0.0154321 })
    check('Menge wird exakt uebernommen, nicht gerundet', krumm.size === '0.0154321')
    check('negatives netSize (Short) wird als Betrag gesendet',
        baueCloseOrder({ psym: 'P', direction: 'short', netSize: -2.5 }).size === '2.5')

    // Im Hedge-Modus verbietet Pionex reduceOnly.
    const hedge = baueCloseOrder({ psym: 'P', direction: 'long', netSize: 1, kontomodus: 'OPENCLOSE' })
    check('Hedge-Modus sendet reduceOnly=false und setzt die Seite',
        hedge.reduceOnly === false && hedge.positionSide === 'LONG')
}

console.log('\nZiel als reduceOnly-Limit (baueZielOrder)\n')
{
    const ziel = baueZielOrder({ psym: 'BTC_USDT_PERP', direction: 'long', qty: 0.015, preis: 70000 })
    check('Limit-Order in Gegenrichtung', ziel.type === 'LIMIT' && ziel.side === 'SELL')
    check('Preis geht als String mit', ziel.price === '70000')
    check('reduceOnly, damit sie nie eine Position EROEFFNET', ziel.reduceOnly === true)
}

console.log('\nPreisrundung (rundePreis)\n')
{
    check('auf 0,1 gerundet', rundePreis(64123.456, 0.1) === 64123.5)
    check('auf 0,01 gerundet', rundePreis(1.23456, 0.01) === 1.23)
    check('ohne Schrittweite unveraendert', rundePreis(1.23456, 0) === 1.23456)
    // Gleitkomma: 0.1+0.2-Falle darf keine 17-stelligen Nachkommastellen erzeugen,
    // sonst lehnt die Boerse den Preis ab.
    check('kein Gleitkomma-Schwanz', String(rundePreis(0.30000000000000004, 0.01)) === '0.3')
    check('kaputte Eingabe → 0', rundePreis(0, 0.1) === 0)
}

console.log('\nFills zusammenfassen (fassFillsZusammen)\n')
{
    // Mengengewichtet, nicht arithmetisch: zwei Teilfills zu 1 und 3 Einheiten
    // ergeben nicht den Mittelwert der Preise.
    const f = fassFillsZusammen([
        { price: 100, size: 1, fee: 0.06, feeType: 'TRADING' },
        { price: 200, size: 3, fee: 0.18, feeType: 'TRADING' },
    ])
    check('Preis ist mengengewichtet (175, nicht 150)', f.price === 175, String(f.price))
    check('Mengen summieren sich', f.qty === 4)
    check('Gebuehren summieren sich', Math.abs(f.fee - 0.24) < 1e-9)

    // Funding ist KEINE Handelsgebuehr und geht in ein eigenes Feld — sonst
    // landete es im Gebuehrenblock und die Kostenrechnung waere doppelt falsch
    // (zu hohe Gebuehr, fehlendes Funding).
    const g = fassFillsZusammen([
        { price: 100, size: 1, fee: 0.06, feeType: 'TRADING' },
        { price: 0, size: 0, fee: -0.5, feeType: 'FUNDING' },
    ])
    check('Funding wird getrennt gefuehrt', g.funding === 0.5 && Math.abs(g.fee - 0.06) < 1e-9)
    check('negative Gebuehr (Rabatt) zaehlt als Betrag',
        fassFillsZusammen([{ price: 100, size: 1, fee: -0.02, feeType: 'TRADING' }]).fee === 0.02)

    check('keine Fills → null', fassFillsZusammen([]) === null && fassFillsZusammen(null) === null)
    check('nur Funding, keine Ausfuehrung → null',
        fassFillsZusammen([{ price: 0, size: 0, fee: 1, feeType: 'FUNDING' }]) === null)
}

console.log('\nPositionen normalisieren (zuPosition)\n')
{
    const p = zuPosition({
        symbol: 'BTC_USDT_PERP', positionId: 'abc', positionSide: 'LONG',
        netSize: '0.015', avgPrice: '64000', markPrice: '64500',
        liquidationPrice: '60000', leverage: '10', unrealizedPnL: '7.5',
    })
    check('Symbol kommt als Journal-Symbol zurueck', p.symbol === 'BTCUSDT')
    check('Pionex-Schreibweise bleibt erhalten', p.pionexSymbol === 'BTC_USDT_PERP')
    check('Zahlen sind Zahlen, keine Strings',
        p.qty === 0.015 && p.entryPrice === 64000 && p.markPrice === 64500)
    check('Richtung aus positionSide', p.direction === 'long')

    // Im One-way-Modus fehlt positionSide (bzw. steht auf BOTH) und nur das
    // Vorzeichen sagt die Richtung. Wer das uebersieht, schliesst Shorts mit
    // einer SELL-Order — also mit einer VERDOPPLUNG statt einer Schliessung.
    check('One-way: negatives netSize heisst short',
        zuPosition({ symbol: 'B_USDT_PERP', netSize: -1, positionSide: 'BOTH' }).direction === 'short')
    check('One-way: positives netSize heisst long',
        zuPosition({ symbol: 'B_USDT_PERP', netSize: 1, positionSide: 'BOTH' }).direction === 'long')
    check('qty ist immer positiv',
        zuPosition({ symbol: 'B_USDT_PERP', netSize: -3 }).qty === 3)
    check('kaputte Eingaben → null', zuPosition(null) === null && zuPosition({}) === null)
}

console.log('\nFaehigkeiten\n')
{
    check('boersenStop ist FALSE — daran haengt der ganze Waechter',
        faehigkeiten.boersenStop === false)
    check('echterFillPreis und orderPerClientId sind zugesagt',
        faehigkeiten.echterFillPreis === true && faehigkeiten.orderPerClientId === true)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
