/**
 * Selbsttest der Bybit-Liquidations-Normalisierung.
 *
 *   node server/__selftest-bybit-liq.mjs
 *
 * Der kritischste Punkt ist die Seiten-Konvention: Bybit meldet die Seite der
 * liquidierten POSITION ("When you receive a Buy update, this means that a
 * long position has been liquidated"), Binance dagegen die Order-Seite der
 * Börse. Eine vertauschte Seite fiele im Betrieb erst bei einem scharfen Move
 * auf — und hätte bis dahin monatelang falsche Daten aufgezeichnet.
 */

import { bybitSubscribeMsg, normalisiereBybitLiq } from './bybit-liq.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const WHITELIST = new Set(['BTCUSDT', 'ETHUSDT'])

/** Nachricht im Doku-Format bauen. */
const nachricht = (data, topic = 'allLiquidation.BTCUSDT') => ({
    topic, type: 'snapshot', ts: 1739502303204, data,
})

console.log('\nBybit-Liquidationen — Selbsttest\n')

// ── Seiten-Konvention ────────────────────────────────────────────────────
console.log('Seiten-Konvention')
{
    // Beispiel aus der Bybit-Doku (ROSEUSDT, hier auf BTCUSDT übertragen):
    // S:"Sell" = Short-Position liquidiert → unsere seite 1
    const short = normalisiereBybitLiq(nachricht([
        { T: 1739502302929, s: 'BTCUSDT', S: 'Sell', v: '20000', p: '0.04499' },
    ]), WHITELIST)
    check('S:"Sell" wird zu seite 1 (Short liquidiert)',
        short?.get('BTCUSDT')?.[0]?.[3] === 1, JSON.stringify(short?.get('BTCUSDT')))

    // "When you receive a Buy update, this means that a long position has
    // been liquidated" → unsere seite 0
    const long = normalisiereBybitLiq(nachricht([
        { T: 1739502302929, s: 'BTCUSDT', S: 'Buy', v: '1.5', p: '64000' },
    ]), WHITELIST)
    check('S:"Buy" wird zu seite 0 (Long liquidiert)',
        long?.get('BTCUSDT')?.[0]?.[3] === 0)

    const tupel = short.get('BTCUSDT')[0]
    check('Tupel-Reihenfolge ist [t, preis, menge, seite]',
        tupel[0] === 1739502302929 && tupel[1] === 0.04499 && tupel[2] === 20000)
}

// ── Fremde Nachrichten ───────────────────────────────────────────────────
console.log('\nFremde Nachrichten')
{
    check('Pong wird ignoriert',
        normalisiereBybitLiq({ op: 'pong', success: true, ret_msg: 'pong' }, WHITELIST) === null)
    check('Subscribe-Ack wird ignoriert',
        normalisiereBybitLiq({ op: 'subscribe', success: true, conn_id: 'x' }, WHITELIST) === null)
    check('fremdes Topic wird ignoriert',
        normalisiereBybitLiq(nachricht([], 'publicTrade.BTCUSDT'), WHITELIST) === null)
    check('null/undefined kippen nicht um',
        normalisiereBybitLiq(null, WHITELIST) === null && normalisiereBybitLiq(undefined, WHITELIST) === null)
    check('data als Nicht-Array wird ignoriert',
        normalisiereBybitLiq({ topic: 'allLiquidation.BTCUSDT', data: {} }, WHITELIST) === null)
}

// ── Feld-Validierung ─────────────────────────────────────────────────────
console.log('\nFeld-Validierung')
{
    const kaputt = normalisiereBybitLiq(nachricht([
        { T: 'abc', s: 'BTCUSDT', S: 'Sell', v: '1', p: '100' },      // Zeit kaputt
        { T: 1, s: 'BTCUSDT', S: 'Sell', v: 'x', p: '100' },          // Menge kaputt
        { T: 1, s: 'BTCUSDT', S: 'Sell', v: '1', p: null },           // Preis kaputt
        { T: 1, s: 'BTCUSDT', S: 'Both', v: '1', p: '100' },          // Seite unbekannt
        { T: 2, s: 'BTCUSDT', S: 'Sell', v: '1', p: '100' },          // gültig
    ]), WHITELIST)
    check('nicht-numerische oder unbekannte Felder werden verworfen, gültige bleiben',
        kaputt.get('BTCUSDT')?.length === 1 && kaputt.get('BTCUSDT')[0][0] === 2)

    const fremd = normalisiereBybitLiq(nachricht([
        { T: 1, s: 'DOGEUSDT', S: 'Sell', v: '1', p: '0.1' },
        { T: 2, s: 'ETHUSDT', S: 'Buy', v: '2', p: '3000' },
    ]), WHITELIST)
    check('Symbole ausserhalb der Whitelist werden verworfen',
        !fremd.has('DOGEUSDT') && fremd.get('ETHUSDT')?.length === 1)

    const ohneFilter = normalisiereBybitLiq(nachricht([
        { T: 1, s: 'DOGEUSDT', S: 'Sell', v: '1', p: '0.1' },
    ]), null)
    check('ohne Whitelist wird nichts gefiltert', ohneFilter.get('DOGEUSDT')?.length === 1)

    const mehrere = normalisiereBybitLiq(nachricht([
        { T: 1, s: 'BTCUSDT', S: 'Sell', v: '1', p: '100' },
        { T: 2, s: 'BTCUSDT', S: 'Buy', v: '2', p: '101' },
        { T: 3, s: 'ETHUSDT', S: 'Sell', v: '3', p: '3000' },
    ]), WHITELIST)
    check('mehrere data-Einträge landen je Symbol gesammelt',
        mehrere.get('BTCUSDT')?.length === 2 && mehrere.get('ETHUSDT')?.length === 1)
}

// ── Subscribe-Nachricht ──────────────────────────────────────────────────
console.log('\nSubscribe-Nachricht')
{
    const sub = JSON.parse(bybitSubscribeMsg(['btcusdt', 'ETHUSDT']))
    check('op ist subscribe', sub.op === 'subscribe')
    check('Topics werden gross geschrieben und mit Präfix versehen',
        sub.args.join(',') === 'allLiquidation.BTCUSDT,allLiquidation.ETHUSDT', sub.args.join(','))
    const ausSet = JSON.parse(bybitSubscribeMsg(new Set(['BTCUSDT'])))
    check('akzeptiert auch ein Set', ausSet.args.join(',') === 'allLiquidation.BTCUSDT')
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) {
    console.log('Fehlgeschlagen:')
    for (const f of fehler) console.log(`  - ${f}`)
    process.exit(1)
}
