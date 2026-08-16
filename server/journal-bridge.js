/**
 * Agenten-Trades ins Journal spiegeln.
 *
 * Der Agent führt Buch in `strategy_trades`. Das Journal führt Buch in `trades`
 * — tagesweise, mit einer eigenen Aufteilung nach Gewinnern und Verlierern.
 * Beide beschreiben dasselbe Ereignis, sprechen aber verschiedene Sprachen.
 *
 * Diese Datei übersetzt. Und sie ist der Grund, warum das überhaupt geht: das
 * Journal trennt bereits nach `category` — Futures und Bots liegen dort seit
 * jeher nebeneinander, ohne sich zu vermischen. Der Agent wird eine dritte
 * Kategorie, keine Ausnahme.
 *
 * WARUM DAS HEIKEL IST: Die Felder `grossWins`/`netLoss`/`…Count`/`…Quantity`
 * sind eine vorberechnete Aufteilung. Wer sie falsch füllt, verfälscht
 * Trefferquote und Erwartungswert im ganzen Journal — und zwar still, weil
 * nirgends eine Zahl fehlt. Deshalb steht die Aufteilung hier an EINER Stelle
 * und wird im Selbsttest gegen beide Vorzeichen geprüft.
 */

/** Kennzeichnung im Journal — muss zur Kategorie-Pille passen. */
export const AGENT_KATEGORIE = 'agent'

/** Beginn des UTC-Tages in Sekunden (das Journal rechnet in Sekunden). */
export function tagesBeginnSek(msOderSek) {
    const ms = Number(msOderSek) > 1e11 ? Number(msOderSek) : Number(msOderSek) * 1000
    return Math.floor(new Date(ms).setUTCHours(0, 0, 0, 0) / 1000)
}

/**
 * Ein Trade der Strategie-Engine in der Sprache des Journals.
 *
 * @param {object} t         Zeile aus `strategy_trades`
 * @param {object} opts      { account } — Kontoname, unter dem er erscheint
 * @returns {object}         Eintrag für das `trades`-Feld einer Tageszeile
 */
export function alsJournalTrade(t, { account = 'agent' } = {}) {
    const sek = (v) => (Number(v) > 1e11 ? Math.floor(Number(v) / 1000) : Math.floor(Number(v) || 0))
    const long = t.direction === 'long'
    const menge = Number(t.qty) || 0
    const brutto = Number(t.grossPnl) || 0
    const netto = Number(t.netPnl) || 0

    // Die Aufteilung. Ein Trade ist entweder Gewinner oder Verlierer — nie
    // beides und nie keins. Break-even (0) zählt als GEWINNER — das ist der
    // Journal-Kanon (Import in addTrades.js, Dashboard-Färbung: 0 = kein
    // Verlust). Diese Brücke schreibt INS Journal, also gilt dessen Konvention;
    // vorher stand hier `> 0`, und dieselbe Null zählte je nach Herkunft mal
    // als Gewinn, mal als Verlust. Die Backtest-STATISTIK (strategy-backtest)
    // bleibt bewusst bei `> 0` — dort ist Pessimismus die Grundhaltung.
    const bruttoGewinn = brutto >= 0
    const nettoGewinn = netto >= 0
    const teile = (wert, istGewinn) => ({
        wins: istGewinn ? wert : 0,
        loss: istGewinn ? 0 : wert,
        winsCount: istGewinn ? 1 : 0,
        lossCount: istGewinn ? 0 : 1,
        winsQuantity: istGewinn ? menge : 0,
        lossQuantity: istGewinn ? 0 : menge,
    })
    const b = teile(brutto, bruttoGewinn)
    const n = teile(netto, nettoGewinn)

    return {
        // Eindeutig und WIEDERERKENNBAR: aus derselben Strategie-Trade-Nummer
        // entsteht immer dieselbe Kennung. Ein zweiter Spiegelversuch erzeugt
        // damit keinen Doppeleintrag.
        id: `agent_${t.id}`,
        account,
        broker: String(t.broker || 'agent'),
        td: tagesBeginnSek(t.exitTime),
        currency: 'USDT',
        type: 'futures',
        side: long ? 'BS' : 'SS',
        strategy: long ? 'long' : 'short',
        symbol: String(t.symbol || ''),
        buyQuantity: menge,
        sellQuantity: menge,
        entryPrice: Number(t.entryPrice) || 0,
        exitPrice: Number(t.exitPrice) || 0,
        entryTime: sek(t.entryTime),
        exitTime: sek(t.exitTime),
        grossProceeds: brutto,
        netProceeds: netto,
        commission: Number(t.fees) || 0,
        tradingFee: Number(t.fees) || 0,
        fundingFee: Number(t.funding) || 0,
        sec: 0, taf: 0, nscc: 0, nasdaq: 0,
        grossSharePL: brutto,
        netSharePL: netto,
        grossWins: b.wins, grossLoss: b.loss,
        netWins: n.wins, netLoss: n.loss,
        grossWinsCount: b.winsCount, grossLossCount: b.lossCount,
        netWinsCount: n.winsCount, netLossCount: n.lossCount,
        grossWinsQuantity: b.winsQuantity, grossLossQuantity: b.lossQuantity,
        netWinsQuantity: n.winsQuantity, netLossQuantity: n.lossQuantity,
        grossSharePLWins: b.wins, grossSharePLLoss: b.loss,
        netSharePLWins: n.wins, netSharePLLoss: n.loss,
        highGrossSharePLWin: b.wins, highGrossSharePLLoss: b.loss,
        highNetSharePLWin: n.wins, highNetSharePLLoss: n.loss,
        executionsCount: 1,
        tradesCount: 1,
        openPosition: false,
        // Der Schlüssel zur Trennung. Ohne ihn läge ein Papier-Trade
        // ununterscheidbar zwischen echten Futures.
        category: AGENT_KATEGORIE,
        // Herkunft, damit sich ein gespiegelter Trade jederzeit zurückverfolgen
        // lässt — und damit die Oberfläche „Papier" davorschreiben kann.
        agentTradeId: Number(t.id) || 0,
        agentInstanceId: Number(t.instanceId) || 0,
        agentMode: String(t.mode || 'paper'),
        agentParamsVersion: Number(t.paramsVersion) || 0,
        agentRMultiple: Number(t.rMultiple) || 0,
        agentExitReason: String(t.exitReason || ''),
        agentTimeframe: String(t.timeframe || ''),
    }
}

/**
 * Geschlossene Agenten-Trades in die Tageszeilen des Journals spiegeln.
 *
 * Idempotent über die Kennung `agent_<id>`: ein zweiter Lauf erkennt bereits
 * gespiegelte Trades und lässt sie liegen. Das ist keine Feinheit — der Aufruf
 * kommt aus der Oberfläche und wird garantiert mehrfach ausgelöst.
 *
 * @param {object} knex
 * @param {Array}  trades   Zeilen aus `strategy_trades`
 * @param {object} opts     { account }
 * @returns {Promise<{ gespiegelt: number, uebersprungen: number, tage: number }>}
 */
export async function spiegleInsJournal(knex, trades, { account = 'agent' } = {}) {
    const proTag = new Map()
    for (const t of trades) {
        if (!t?.exitTime) continue
        const tag = tagesBeginnSek(t.exitTime)
        if (!proTag.has(tag)) proTag.set(tag, [])
        proTag.get(tag).push(t)
    }

    let gespiegelt = 0
    let uebersprungen = 0
    for (const [tag, liste] of proTag) {
        const zeile = await knex('trades').where('dateUnix', tag).first()
        const vorhanden = zeile
            ? (typeof zeile.trades === 'string' ? JSON.parse(zeile.trades || '[]') : (zeile.trades || []))
            : []
        const bekannt = new Set(vorhanden.map((x) => x.id))

        const neue = []
        for (const t of liste) {
            const j = alsJournalTrade(t, { account })
            if (bekannt.has(j.id)) { uebersprungen++; continue }
            neue.push(j)
        }
        if (!neue.length) continue

        const zusammen = [...vorhanden, ...neue].sort((a, b) => Number(a.exitTime) - Number(b.exitTime))
        if (zeile) {
            await knex('trades').where('id', zeile.id).update({
                trades: JSON.stringify(zusammen), updatedAt: knex.fn.now(),
            })
        } else {
            // Eine Tageszeile, die es noch nicht gibt. `pAndL` und `blotter`
            // bleiben leer: die Oberfläche rechnet beides beim Lesen neu
            // (siehe trades.js — „We recreate trades and pAndL").
            await knex('trades').insert({
                dateUnix: tag,
                date: new Date(tag * 1000).toISOString().slice(0, 10),
                executions: '[]', trades: JSON.stringify(zusammen),
                blotter: '{}', pAndL: '{}', cashJournal: '{}', openPositions: 0,
            })
        }
        gespiegelt += neue.length
    }
    return { gespiegelt, uebersprungen, tage: proTag.size }
}

/**
 * Gespiegelte Agenten-Trades wieder aus dem Journal entfernen.
 *
 * Das Gegenstück zum Spiegeln, und ebenso wichtig: wer versehentlich spiegelt,
 * muss das zurücknehmen können, ohne in der Datenbank zu hantieren.
 *
 * VORSICHT an genau einer Stelle: eine Tageszeile darf nur verschwinden, wenn
 * NICHTS anderes mehr darin steht. Ein echter Trade am selben Tag wiegt
 * schwerer als eine aufgeräumte Tabelle.
 *
 * @param {Array<number|string>} ids  Trade-Nummern aus `strategy_trades`;
 *                                    leer = alle gespiegelten Agenten-Trades
 * @returns {Promise<{ entfernt: number, tageGeleert: number }>}
 */
export async function entferneAusJournal(knex, ids = []) {
    const gesucht = new Set((ids || []).map((id) => `agent_${id}`))
    const alleEntfernen = gesucht.size === 0

    let entfernt = 0
    let tageGeleert = 0
    // Nur Tage anfassen, die überhaupt Agenten-Trades enthalten.
    const zeilen = await knex('trades').select('id', 'dateUnix', 'trades')
    for (const zeile of zeilen) {
        const liste = typeof zeile.trades === 'string'
            ? JSON.parse(zeile.trades || '[]') : (zeile.trades || [])
        if (!liste.length) continue

        const bleibt = liste.filter((x) => {
            const istAgent = x.category === AGENT_KATEGORIE
            if (!istAgent) return true
            return alleEntfernen ? false : !gesucht.has(x.id)
        })
        if (bleibt.length === liste.length) continue

        entfernt += liste.length - bleibt.length
        if (bleibt.length === 0) {
            // Leere Tageszeile hat keinen Wert mehr — aber nur, wenn sie
            // wirklich leer ist. Echte Trades halten sie am Leben.
            await knex('trades').where('id', zeile.id).del()
            tageGeleert++
        } else {
            await knex('trades').where('id', zeile.id).update({
                trades: JSON.stringify(bleibt), updatedAt: knex.fn.now(),
            })
        }
    }
    return { entfernt, tageGeleert }
}
