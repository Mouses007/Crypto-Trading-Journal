/**
 * Selbsttest des Bitunix-Order-Pfads — ohne Netz, ohne Datenbank.
 *
 *   node server/execution/__selftest-bitunix-order.mjs
 *
 * Geprüft wird der reine Teil der Scharfschaltung: der Order-Body, den der
 * Schattenbetrieb protokolliert und der Live-Modus sendet, und die
 * Positions-Suche fürs gezielte Schliessen. Genau hier gab es bisher keinen
 * einzigen Test — und der Body ist gegen die Bitunix-Doku gebaut, im Betrieb
 * aber noch nicht bestätigt. Ändert jemand ein Feld, soll das hier knallen,
 * nicht erst an der Börse.
 */

import { baueOrder, findePositionsId } from './bitunix.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nOrder-Body (baueOrder)\n')

{
    const long = baueOrder({
        setup: { symbol: 'BTCUSDT', direction: 'long', stopLoss: 64000, takeProfit: 70000 },
        size: { qty: 0.015 },
        leverage: 5,
        clientOrderId: 'inst7-abc123',
    })
    check('Long öffnet mit side=BUY, tradeSide=OPEN', long.side === 'BUY' && long.tradeSide === 'OPEN')
    check('Symbol und Margin-Coin gesetzt', long.symbol === 'BTCUSDT' && long.marginCoin === 'USDT')
    check('Menge, Hebel und Preise gehen als STRING raus (Bitunix-Doku)',
        long.qty === '0.015' && long.leverage === '5' && long.slPrice === '64000' && long.tpPrice === '70000',
        JSON.stringify({ qty: long.qty, leverage: long.leverage, sl: long.slPrice, tp: long.tpPrice }))
    check('Market-Order, GTC, deterministische clientId',
        long.orderType === 'MARKET' && long.effect === 'GTC' && long.clientId === 'inst7-abc123')
    check('Stop geht MIT der Order raus (slPrice + Typfelder)',
        long.slPrice === '64000' && long.slStopType === 'LAST_PRICE' && long.slOrderType === 'MARKET')
    check('Ziel-Felder vollständig, wenn Ziel gesetzt',
        long.tpStopType === 'LAST_PRICE' && long.tpOrderType === 'MARKET')

    const short = baueOrder({
        setup: { symbol: 'ETHUSDT', direction: 'short', stopLoss: 3600, takeProfit: 0 },
        size: { qty: 1.2 },
        leverage: 3,
        clientOrderId: 'inst9-def456',
    })
    check('Short öffnet mit side=SELL, tradeSide=OPEN', short.side === 'SELL' && short.tradeSide === 'OPEN')
    check('ohne Ziel: keine tp-Felder im Body',
        short.tpPrice === undefined && short.tpStopType === undefined && short.tpOrderType === undefined)
    check('Stop ist auch ohne Ziel Pflichtfeld', short.slPrice === '3600')

    // openLivePosition weigert sich zu senden, wenn `Number(body.slPrice)`
    // nicht positiv ist. String-truthiness reicht NICHT: stopLoss=0 wird zu
    // '0', und '0' ist truthy — genau deshalb prüft der Wächter numerisch.
    const ohneStop = baueOrder({
        setup: { symbol: 'BTCUSDT', direction: 'long', stopLoss: 0, takeProfit: 0 },
        size: { qty: 1 }, leverage: 1, clientOrderId: 'x',
    })
    check('stopLoss=0 fällt durch die numerische Stop-Prüfung des Senders',
        !Number(ohneStop.slPrice), ohneStop.slPrice)
}

console.log('\nPositions-Suche (findePositionsId)\n')

{
    const liste = [
        { symbol: 'BTCUSDT', side: 'BUY', positionId: 111 },
        { symbol: 'BTCUSDT', side: 'SELL', positionId: 222 },
        { symbol: 'ETHUSDT', side: 'SELL', positionId: 333 },
    ]
    check('Long findet die BUY-Position', findePositionsId(liste, 'BTCUSDT', 'long') === '111')
    check('Short findet die SELL-Position', findePositionsId(liste, 'BTCUSDT', 'short') === '222')
    check('fremdes Symbol wird nie geliefert', findePositionsId(liste, 'SOLUSDT', 'long') === '')

    // Der frühere Rückfall „nur eine Position → nimm die" hätte hier die
    // handgehaltene GEGENposition geliefert und dem Flash-Close ausgeliefert.
    const nurGegenseite = [{ symbol: 'BTCUSDT', side: 'SELL', positionId: 999 }]
    check('einzelne Position mit falscher Seite wird NICHT geliefert',
        findePositionsId(nurGegenseite, 'BTCUSDT', 'long') === '')
    check('einzelne Position mit richtiger Seite wird geliefert',
        findePositionsId(nurGegenseite, 'BTCUSDT', 'short') === '999')

    check('leere/kaputte Listen liefern leere Kennung',
        findePositionsId([], 'BTCUSDT', 'long') === ''
        && findePositionsId(null, 'BTCUSDT', 'long') === ''
        && findePositionsId([null, {}], 'BTCUSDT', 'long') === '')
    check('Kennung kommt als String zurück', findePositionsId(liste, 'ETHUSDT', 'short') === '333')
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
