/**
 * Selbsttest der Journal-Brücke.
 *
 *   node server/strategies/__selftest-journalbruecke.mjs
 *
 * Die Gewinn/Verlust-Aufteilung ist der gefährliche Teil: sie ist vorberechnet,
 * und ein Fehler darin verfälscht Trefferquote und Erwartungswert im GANZEN
 * Journal — still, weil nirgends eine Zahl fehlt.
 */

import { alsJournalTrade, tagesBeginnSek, AGENT_KATEGORIE } from '../journal-bridge.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const basis = {
    id: 42, instanceId: 7, symbol: 'BTCUSDT', timeframe: '15m', direction: 'long',
    qty: 0.05, entryPrice: 60000, exitPrice: 61000,
    entryTime: 1786528851000, exitTime: 1786598142000,
    grossPnl: 50, netPnl: 46, fees: 3.5, funding: 0.5,
    rMultiple: 1.8, exitReason: 'tp', mode: 'paper', paramsVersion: 3, broker: 'bitunix',
}

console.log('\nJournal-Brücke — Selbsttest\n')

console.log('Grundform')
{
    const j = alsJournalTrade(basis, { account: 'agent-papier' })
    check('Kategorie trennt ihn von echten Futures', j.category === AGENT_KATEGORIE, j.category)
    check('Kennung ist aus der Trade-Nummer ableitbar', j.id === 'agent_42', j.id)
    check('Konto wird übernommen', j.account === 'agent-papier')
    check('Long wird zu Seite BS', j.side === 'BS' && j.strategy === 'long')
    check('Zeiten liegen in Sekunden, nicht Millisekunden',
        j.entryTime === 1786528851 && j.exitTime === 1786598142, `${j.entryTime}/${j.exitTime}`)
    check('Tagesstempel ist Tagesbeginn', j.td === tagesBeginnSek(basis.exitTime) && j.td % 86400 === 0, String(j.td))
    check('Herkunft bleibt nachvollziehbar',
        j.agentTradeId === 42 && j.agentInstanceId === 7 && j.agentMode === 'paper' && j.agentParamsVersion === 3)
    check('R und Ausstiegsgrund reisen mit', j.agentRMultiple === 1.8 && j.agentExitReason === 'tp')
}

console.log('\nAufteilung Gewinner')
{
    const j = alsJournalTrade(basis)
    check('netto zählt als EIN Gewinner', j.netWinsCount === 1 && j.netLossCount === 0)
    check('Gewinnbetrag steht bei wins, nicht bei loss', j.netWins === 46 && j.netLoss === 0)
    check('Menge landet auf der Gewinnerseite', j.netWinsQuantity === 0.05 && j.netLossQuantity === 0)
    check('brutto getrennt vom netto gerechnet', j.grossWins === 50 && j.grossLoss === 0)
    check('Gebühren und Funding getrennt', j.commission === 3.5 && j.fundingFee === 0.5)
}

console.log('\nAufteilung Verlierer')
{
    const v = alsJournalTrade({ ...basis, direction: 'short', grossPnl: -20, netPnl: -24, rMultiple: -1 })
    check('Short wird zu Seite SS', v.side === 'SS' && v.strategy === 'short')
    check('netto zählt als EIN Verlierer', v.netLossCount === 1 && v.netWinsCount === 0)
    check('Verlustbetrag steht bei loss', v.netLoss === -24 && v.netWins === 0)
    check('Menge landet auf der Verliererseite', v.netLossQuantity === 0.05 && v.netWinsQuantity === 0)
}

console.log('\nDie Grenzfälle, an denen Statistiken kippen')
{
    // Break-even: netto genau null. Muss EINDEUTIG einer Seite zufallen,
    // sonst zählt das Journal einen Trade doppelt oder gar nicht. Die Seite ist
    // der Journal-Kanon: 0 = kein Verlust, zählt als Gewinner (wie der Import).
    const be = alsJournalTrade({ ...basis, grossPnl: 0, netPnl: 0 })
    check('Break-even zählt als Gewinner (Journal-Kanon), nicht als beides',
        be.netWinsCount === 1 && be.netLossCount === 0, `${be.netWinsCount}/${be.netLossCount}`)
    check('Break-even wird genau EINMAL gezählt', be.netWinsCount + be.netLossCount === 1)

    // Brutto Gewinn, netto Verlust — nach Gebühren gekippt. Beide Aufteilungen
    // müssen unabhängig voneinander stimmen.
    const gekippt = alsJournalTrade({ ...basis, grossPnl: 2, netPnl: -1.5 })
    check('brutto Gewinner und netto Verlierer gleichzeitig möglich',
        gekippt.grossWinsCount === 1 && gekippt.netLossCount === 1, `${gekippt.grossWinsCount}/${gekippt.netLossCount}`)
    check('die Beträge stehen jeweils richtig',
        gekippt.grossWins === 2 && gekippt.grossLoss === 0 && gekippt.netLoss === -1.5 && gekippt.netWins === 0)

    // Jeder Trade wird in beiden Aufteilungen genau einmal gezählt.
    for (const p of [50, -50, 0, 0.0001]) {
        const x = alsJournalTrade({ ...basis, grossPnl: p, netPnl: p })
        if (x.netWinsCount + x.netLossCount !== 1 || x.grossWinsCount + x.grossLossCount !== 1) {
            check(`Zählung bei netPnl=${p}`, false, JSON.stringify({ n: x.netWinsCount + x.netLossCount }))
        }
    }
    check('Zählung stimmt über alle Vorzeichen', true)
}

console.log('\nUnvollständige Eingaben')
{
    const leer = alsJournalTrade({ id: 1 })
    check('fehlende Zahlen werden zu 0 statt NaN',
        leer.netProceeds === 0 && leer.buyQuantity === 0 && !Number.isNaN(leer.entryPrice))
    check('ohne Richtung gilt Short (kein stiller Long)', leer.side === 'SS')
    check('Kategorie bleibt auch dann gesetzt', leer.category === AGENT_KATEGORIE)
}

console.log('\nTagesstempel')
{
    check('Millisekunden werden erkannt', tagesBeginnSek(1786598142000) % 86400 === 0)
    check('Sekunden werden erkannt', tagesBeginnSek(1786598142) % 86400 === 0)
    check('beide ergeben denselben Tag', tagesBeginnSek(1786598142000) === tagesBeginnSek(1786598142))
}

// ── Entfernen: das Gegenstück ────────────────────────────────────────────
// Geprüft ohne Datenbank, über die reine Auswahl-Logik: welche Einträge einer
// Tagesliste bleiben stehen? Der teure Fehler wäre, einen ECHTEN Trade
// mitzulöschen, weil er am selben Tag liegt.
console.log('\nEntfernen (Auswahl-Logik)')
{
    const tagesliste = [
        { id: 'echt_1', category: 'futures', netProceeds: 100 },
        { id: 'agent_1', category: AGENT_KATEGORIE },
        { id: 'agent_2', category: AGENT_KATEGORIE },
        { id: 'bot_9', category: 'bot' },
    ]
    // Dieselbe Bedingung wie in `entferneAusJournal`
    const bleibt = (liste, ids) => {
        const gesucht = new Set((ids || []).map((i) => `agent_${i}`))
        const alle = gesucht.size === 0
        return liste.filter((x) => (x.category !== AGENT_KATEGORIE ? true : (alle ? false : !gesucht.has(x.id))))
    }

    const einer = bleibt(tagesliste, [1])
    check('gezielt entfernen trifft nur den gewählten',
        einer.length === 3 && !einer.some((x) => x.id === 'agent_1') && einer.some((x) => x.id === 'agent_2'),
        JSON.stringify(einer.map((x) => x.id)))
    check('echter Trade bleibt bei gezieltem Entfernen', einer.some((x) => x.id === 'echt_1'))
    check('Bot-Trade bleibt ebenfalls', einer.some((x) => x.id === 'bot_9'))

    const alle = bleibt(tagesliste, [])
    check('ohne Auswahl fliegen ALLE Agenten-Trades',
        alle.length === 2 && !alle.some((x) => x.category === AGENT_KATEGORIE), JSON.stringify(alle.map((x) => x.id)))
    check('aber niemals ein echter oder ein Bot-Trade',
        alle.some((x) => x.id === 'echt_1') && alle.some((x) => x.id === 'bot_9'))

    const nurAgenten = bleibt([{ id: 'agent_5', category: AGENT_KATEGORIE }], [])
    check('ein Tag mit ausschliesslich Agenten-Trades wird leer', nurAgenten.length === 0)

    const unbekannt = bleibt(tagesliste, [999])
    check('unbekannte Nummer entfernt nichts', unbekannt.length === 4)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
