/**
 * Reine CSV-Zeilen-Logik der Broker-Importe — ohne Vue, ohne i18n, ohne Stores.
 *
 * Bewusst von `brokers.js` getrennt: die Wrapper dort hängen an PapaParse und
 * den Frontend-Globals und lassen sich in Node nicht laden. Genau deshalb war
 * der Import-Pfad jahrelang der einzige geldführende Code ohne einen einzigen
 * Test. Hier drin ist alles eine Funktion: Zeilen rein, Trades raus.
 */

import dayjs from './dayjs-setup.js'

/**
 * Bitunix-Kontoauszug: nur „Futures Profit"/„Futures Loss"-Zeilen sind Trades.
 * Die Beträge sind bereits NETTO (nach Gebühren) — brutto wird rekonstruiert.
 *
 * @param {Array<object>} rows geparste CSV-Zeilen (Header als Schlüssel)
 * @returns {{ trades: Array<object>, uebersprungen: number }}
 */
export function parseBitunixRows(rows) {
    const trades = []
    let uebersprungen = 0
    /** Funding-Buchungen, bevor sie zugeordnet sind: Schlüssel `Tag|Symbol`. */
    const fundingRoh = []

    for (const row of rows || []) {
        const label = (row.Label || '').trim()

        /*
         * Funding-Zeilen sind eigene Buchungen, keine Trades — sie fielen
         * bis zum Audit vom 28.08.2026 stillschweigend unter
         * `uebersprungen`. Folge: aus einem CSV-Import kam IMMER
         * `fundingFee: 0`, obwohl die Beträge in der Datei standen, und die
         * Funding-Zeile der Kennzahlen-Kachel blendete sich lautlos aus.
         *
         * Vorzeichen nach dem Kanon aus `funding.js`: + erhalten, − bezahlt.
         */
        if (label === 'Funding Fee') {
            const erhalten = parseFloat(row['Incoming Amount'] || 0) || 0
            const bezahlt = Math.abs(parseFloat(row['Outgoing Amount'] || 0) || 0)
            const betrag = erhalten - bezahlt
            if (betrag !== 0) {
                fundingRoh.push({
                    tag: (row['Date (UTC)'] || '').trim().slice(0, 10),
                    symbol: (row.Comment || '').trim(),
                    betrag,
                })
            }
            uebersprungen++
            continue
        }

        if (label !== 'Futures Profit' && label !== 'Futures Loss') { uebersprungen++; continue }
        const isProfit = label === 'Futures Profit'

        // Bitunix CSV amounts are already NET (after fees).
        let netPL = 0
        if (isProfit) {
            netPL = parseFloat(row['Incoming Amount'] || 0)
        } else {
            netPL = -Math.abs(parseFloat(row['Outgoing Amount'] || 0))
        }

        const fee = Math.abs(parseFloat(row['Fee Amount'] || 0))
        // Brutto = netto plus die abgezogene Gebühr
        const grossPL = netPL + fee

        const comment = (row.Comment || '').trim()

        trades.push({
            Account: 'bitunix',
            DateUTC: (row['Date (UTC)'] || '').trim(),
            Symbol: comment || 'FUTURES',
            Type: 'futures',
            GrossProceeds: grossPL,
            Fee: fee,
            NetProceeds: netPL,
            // Auch getrennt mitgeben, wie im Bitget-Pfad weiter unten: sonst
            // steht im Trade `tradingFee: 0`, obwohl die Gebühr in der CSV
            // steht — `totals.tradingFees` zählte CSV-Trades dadurch nicht mit.
            // Kein Doppelzählen: die Summe `fees` rechnet mit `commission`,
            // `tradingFees` ist eine eigene Kennzahl daneben.
            TradingFee: fee,
            TrxId: (row['Trx. ID'] || '').trim(),
            IncomingAsset: (row['Incoming Asset'] || '').trim(),
            OutgoingAsset: (row['Outgoing Asset'] || '').trim(),
        })
    }

    /*
     * Zuordnung — und zwar nur, wo sie EINDEUTIG ist.
     *
     * Eine Funding-Buchung trägt keine Positions-ID. Zugeordnet wird deshalb
     * über Tag und Symbol, und auch das nur, wenn an diesem Tag genau EIN
     * Trade dieses Symbols steht. Gibt es mehrere, wäre jede Aufteilung
     * geraten; die Buchung bleibt dann offen und wird gemeldet, statt
     * gleichmässig verteilt zu werden. Dasselbe gilt für Zeilen ohne Symbol
     * im Kommentarfeld.
     *
     * Ein stiller Fehlbetrag ist schlimmer als ein ausgewiesener.
     */
    const nachTagSymbol = new Map()
    for (const t of trades) {
        const schluessel = `${(t.DateUTC || '').slice(0, 10)}|${t.Symbol}`
        if (!nachTagSymbol.has(schluessel)) nachTagSymbol.set(schluessel, [])
        nachTagSymbol.get(schluessel).push(t)
    }

    let zugeordnet = 0
    let offen = 0
    let offenBetrag = 0
    for (const f of fundingRoh) {
        const treffer = f.symbol ? nachTagSymbol.get(`${f.tag}|${f.symbol}`) : null
        if (treffer && treffer.length === 1) {
            const t = treffer[0]
            t.FundingFee = (Number(t.FundingFee) || 0) + f.betrag
            /*
             * Netto ist das Wallet-Delta und muss das Funding enthalten —
             * so rechnet auch der API-Pfad (`realizedPNL` ist dort bereits
             * inklusive). Brutto bleibt die reine Trade-PnL, damit
             * `netto = brutto − tradingFee + fundingFee` weiter aufgeht.
             */
            t.NetProceeds = (Number(t.NetProceeds) || 0) + f.betrag
            zugeordnet++
        } else {
            offen++
            offenBetrag += f.betrag
        }
    }

    return {
        trades,
        uebersprungen,
        funding: { gefunden: fundingRoh.length, zugeordnet, offen, offenBetrag },
    }
}

/**
 * Spaltensuche über mehrere mögliche Schreibweisen (Bitget exportiert bunt).
 *
 * ZWEI Durchgänge, und die Reihenfolge ist der ganze Punkt. Die reine
 * Teilstringsuche verwechselte Spalten: gesucht wird die Brutto-PnL unter
 * anderem als `'Profit'` — und `netProfit` enthält „profit". Stand `netProfit`
 * in der Kopfzeile VOR `pnl`, landete die NETTO-Spalte im Bruttowert. Brutto
 * und netto waren dann identisch, die Gebühren verschwanden spurlos aus der
 * Bruttorechnung, und weil beide Zahlen für sich plausibel aussahen, fiel es
 * im Journal nicht auf.
 *
 * Erst exakt (normalisiert, ohne Trenn- und Sonderzeichen), dann als
 * Teilstring. Der zweite Durchgang bleibt, weil echte Exporte Spalten wie
 * `Realized PnL (USDT)` tragen — ohne ihn wären alte Dateien nicht mehr
 * lesbar.
 */
export function findeSpalte(headers, ...namen) {
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
    const gesucht = new Set(namen.map(norm))
    const exakt = headers.find((h) => gesucht.has(norm(h)))
    if (exakt) return exakt
    return headers.find((h) => namen.some((n) => h.toLowerCase().includes(n.toLowerCase())))
}

/**
 * Bitget-Verlaufsexport. `netProfit` ist der echte Wallet-Delta (0 = gültiges
 * Break-even); Funding ist signiert und wird NICHT in die Trading-Fee gemischt.
 *
 * @param {Array<object>} rows geparste CSV-Zeilen
 * @returns {{ trades: Array<object>, unbekannteSides: number }}
 */
export function parseBitgetRows(rows) {
    const zeilen = rows || []
    if (!zeilen.length) return { trades: [], unbekannteSides: 0 }

    const headers = Object.keys(zeilen[0])
    const findCol = (...names) => findeSpalte(headers, ...names)

    const colSymbol = findCol('symbol', 'Symbol', 'Pair')
    const colSide = findCol('holdSide', 'side', 'Side', 'Direction')
    const colOpenPrice = findCol('openAvgPrice', 'Open Price', 'Entry Price', 'openPrice', 'Avg Open')
    const colClosePrice = findCol('closeAvgPrice', 'Close Price', 'Exit Price', 'closePrice', 'Avg Close')
    const colPnl = findCol('pnl', 'PnL', 'Profit', 'realizedPnl', 'Realized PnL')
    const colNetProfit = findCol('netProfit', 'Net Profit', 'Net PnL')
    const colOpenFee = findCol('openFee', 'Open Fee')
    const colCloseFee = findCol('closeFee', 'Close Fee')
    const colFunding = findCol('totalFunding', 'Funding', 'funding')
    const colFee = findCol('Fee', 'fee', 'Fee Amount')
    const colQuantity = findCol('closeTotalPos', 'openTotalPos', 'Quantity', 'Size', 'qty')
    const colTime = findCol('uTime', 'cTime', 'Time', 'Date', 'Close Time', 'closeTime')
    const colOpenTime = findCol('cTime', 'openTime', 'Open Time')
    const colTrxId = findCol('positionId', 'Position ID', 'TradeId', 'Trx')

    const trades = []
    let unbekannteSides = 0

    for (const row of zeilen) {
        const grossPL = parseFloat(row[colPnl] || 0)
        if (grossPL === 0 && !row[colPnl]) continue // skip empty rows

        // commission = NUR Trading-Fee (Open + Close). Funding NICHT
        // einrechnen — identisch zur API-Import- und Bitunix-Semantik.
        let tradingFee = 0
        let fundingFee = 0
        if (colOpenFee && colCloseFee) {
            tradingFee = Math.abs(parseFloat(row[colOpenFee] || 0)) + Math.abs(parseFloat(row[colCloseFee] || 0))
            if (colFunding) fundingFee = parseFloat(row[colFunding] || 0)  // signiert
        } else if (colFee) {
            tradingFee = Math.abs(parseFloat(row[colFee] || 0))
        }
        const fee = tradingFee

        // netProfit ist der echte Wallet-Delta (auch 0 = gueltiges Break-even).
        const hasNet = colNetProfit && row[colNetProfit] !== undefined && row[colNetProfit] !== ''
        const netPL = hasNet ? parseFloat(row[colNetProfit]) : (grossPL - tradingFee + fundingFee)

        // Beide Richtungen ausdrücklich erkennen — Unerkanntes wird gezählt
        // statt still als Short durchzurutschen.
        const rawSide = (row[colSide] || '').toLowerCase().trim()
        let side
        if (['long', 'buy', 'b', 'open_long', 'close_long'].includes(rawSide)) side = 'B'
        else if (['short', 'sell', 's', 'open_short', 'close_short'].includes(rawSide)) side = 'SS'
        else { side = 'SS'; unbekannteSides++ }

        // Zeitstempel: 13-stellig = Millisekunden, sonst Datums-Text
        let dateStr = row[colTime] || ''
        if (/^\d{13}$/.test(dateStr)) {
            dateStr = dayjs(parseInt(dateStr)).utc().format('YYYY-MM-DD HH:mm:ss')
        }
        let entryDateStr = row[colOpenTime] || dateStr
        if (/^\d{13}$/.test(entryDateStr)) {
            entryDateStr = dayjs(parseInt(entryDateStr)).utc().format('YYYY-MM-DD HH:mm:ss')
        }

        trades.push({
            Account: 'bitget',
            Broker: 'bitget',
            DateUTC: dateStr,
            EntryDateUTC: entryDateStr,
            Symbol: row[colSymbol] || 'FUTURES',
            Type: 'futures',
            GrossProceeds: grossPL,
            Fee: fee,
            NetProceeds: netPL,
            // Getrennt mitgeben — addTrades.js liest row.TradingFee und
            // row.FundingFee ins Trade-Objekt. Ohne diese Felder zeigte das
            // Journal Funding=0, obwohl die CSV es hatte (es steckte nur
            // unsichtbar im Netto-Fallback oben).
            TradingFee: tradingFee,
            FundingFee: fundingFee,
            TrxId: row[colTrxId] || '',
            Side: side,
            EntryPrice: parseFloat(row[colOpenPrice] || 0),
            ClosePrice: parseFloat(row[colClosePrice] || 0),
            Quantity: parseFloat(row[colQuantity] || 1),
            IncomingAsset: 'USDT',
            OutgoingAsset: 'USDT',
        })
    }

    return { trades, unbekannteSides }
}
