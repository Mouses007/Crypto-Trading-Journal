/**
 * Bot-Trades im Journal-Chart darstellen.
 *
 * Der Chart aus dem Journal (`useCandlestickChart`) kann alles, was ein
 * abgeschlossener Trade braucht: Ein- und Ausstiegsmarker, SL/TP-Linien,
 * Teilausführungen. Ein Bot-Trade hat dieselben Angaben, nur unter anderen
 * Namen — statt einen zweiten Chart zu pflegen, wird hier übersetzt.
 *
 * Was dazukommt gegenüber einem Journal-Trade: die Order-Block-Zone des
 * zugehörigen Setups. Sie ist der Grund, warum der Trade überhaupt entstand,
 * und ohne sie lässt sich im Bild nicht beurteilen, ob der Detector richtig
 * gearbeitet hat.
 */

import { useCandlestickChart } from './charts.js'

/**
 * Kerzen aus `market-data`-Form in die drei Arrays, die der Chart erwartet.
 * Reihenfolge ist ECharts-Konvention: [close, open, low, high].
 */
export function kerzenAufteilen(candles) {
    const ohlcTimestamps = []
    const ohlcPrices = []
    const ohlcVolumes = []
    for (const k of candles || []) {
        ohlcTimestamps.push(Number(k.t))
        ohlcPrices.push([Number(k.c), Number(k.o), Number(k.l), Number(k.h)])
        ohlcVolumes.push(Number(k.v) || 0)
    }
    return { ohlcTimestamps, ohlcPrices, ohlcVolumes }
}

/**
 * Einen Datensatz aus `strategy_trades` in die Form bringen, die der
 * Journal-Chart liest.
 *
 * `td` ist im Journal der Tagesstempel; der Chart nutzt ihn nur zum Vergleich
 * mit dem gerade gezeichneten Tag. Für einen Bot-Trade genügt der Einstiegstag.
 */
export function alsJournalTrade(botTrade) {
    if (!botTrade) return null
    const t = botTrade
    // strategy_trades speichert Zeiten in Millisekunden, der Journal-Chart
    // rechnet durchgehend in Sekunden.
    const inSekunden = (wert) => {
        const n = Number(wert) || 0
        return n > 1e12 ? Math.floor(n / 1000) : n
    }
    const einstieg = inSekunden(t.entryTime)

    const trade = {
        entryPrice: Number(t.entryPrice),
        entryTime: einstieg,
        exitPrice: t.exitPrice === null || t.exitPrice === undefined ? null : Number(t.exitPrice),
        exitTime: inSekunden(t.exitTime),
        // Der Chart färbt die Marker nach `strategy` — bei uns heisst das Feld
        // `direction`, die Werte sind dieselben.
        strategy: t.direction,
        td: Math.floor(einstieg / 86400) * 86400,
        symbol: t.symbol,
        _tradingMeta: {},
    }
    if (t.stopLoss) trade._tradingMeta.sl = String(t.stopLoss)
    if (t.takeProfit) trade._tradingMeta.tp = String(t.takeProfit)
    // Höchst- und Tiefstand während der Haltedauer — im Journal die MFE-Linie
    if (t.mfePrice) trade._tradingMeta.mfe = String(t.mfePrice)
    if (t.maePrice) trade._tradingMeta.mae = String(t.maePrice)
    return trade
}

/** Order-Block-Zone eines Setups als Chart-Zone. */
export function zoneAusSetup(setup, beschriftung = 'Order Block') {
    if (!setup || !setup.obHigh || !setup.obLow) return []
    return [{
        von: Number(setup.obLow),
        bis: Number(setup.obHigh),
        farbe: setup.direction === 'long' ? 'rgba(38, 166, 154, 0.12)' : 'rgba(255, 105, 96, 0.12)',
        rand: setup.direction === 'long' ? 'rgba(38, 166, 154, 0.5)' : 'rgba(255, 105, 96, 0.5)',
        name: beschriftung,
    }]
}

/**
 * Zeichnet einen Bot-Trade in das Element `elementId`.
 *
 * @param {string} elementId   Ziel-Container
 * @param {Array}  candles     Kerzen in { t, o, h, l, c, v }
 * @param {object} botTrade    Datensatz aus `strategy_trades`
 * @param {object} [setup]     zugehöriges Setup, für die Zone
 * @returns {Promise}
 */
export function useBotTradeChart(elementId, candles, botTrade, setup = null) {
    const { ohlcTimestamps, ohlcPrices, ohlcVolumes } = kerzenAufteilen(candles)
    const trade = alsJournalTrade(botTrade)
    if (!trade || !ohlcTimestamps.length) return Promise.resolve(null)
    return useCandlestickChart(
        ohlcTimestamps, ohlcPrices, ohlcVolumes, trade, true,
        elementId, zoneAusSetup(setup), true,
    )
}
