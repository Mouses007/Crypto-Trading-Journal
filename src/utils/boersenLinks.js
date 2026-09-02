/**
 * Verlinkung eines Coins zu einer externen Handelsseite oder zu TradingView.
 *
 * Vorher an drei Stellen unabhängig dupliziert (CoinRadar.vue, KachelRsi.vue,
 * KachelMarkt.vue) — hier EINE Quelle, damit ein neues Börsen-Kürzel oder eine
 * geänderte URL nicht an mehreren Stellen nachgezogen werden muss.
 *
 * Pionex hat ein eigenes Symbol-Schema, weil die Handelsseite nicht das rohe
 * Bitunix/Bitget-Symbol (z. B. `BTCUSDT`) versteht, sondern `BASIS.PERP_USDT`
 * (z. B. `BTC.PERP_USDT`) — das `USDT`-Suffix und ein führendes `1000...`
 * (Meme-Coins mit vielen Nullen) müssen dafür weg.
 *
 * TradingView bekommt KEINE Listungsprüfung wie die drei Börsen: alle Coins in
 * Coin-Radar/Hype-Radar/RSI-Kachel/Markt-Kachel kommen ohnehin aus Binances
 * USDⓈ-M-FUTURES (`nurCoinSymbole()`/`getClosedCandles(..., {market:'futures'})`
 * in server/marktradar-api.js bzw. server/market-data.js) — ein Perpetual-Chart
 * existiert dafür also immer. Das `.P`-Suffix ist hier PFLICHT: ohne ihn löst
 * TradingView den SPOT-Markt auf, und der existiert nicht zwingend — Monero
 * z.B. ist bei Binance nur noch als Future gelistet, nicht mehr als Spot-Paar.
 * `1000PEPEUSDT` als Futures-Symbol hat ohne `.P` ebenfalls keine Entsprechung,
 * weil es dort gar keinen Spot-Markt mit diesem Namen gibt. Live geprüft am
 * 02.09.2026: `BINANCE:XMRUSDT.P` und `BINANCE:1000PEPEUSDT.P` laden beide,
 * die Varianten ohne `.P` beide nicht.
 */
export const BOERSE_URL = {
    bitunix: (s) => `https://www.bitunix.com/contract-trade/${s}`,
    bitget: (s) => `https://www.bitget.com/futures/usdt/${s}`,
    pionex: (s) => `https://www.pionex.com/en/futures/${s.replace(/USDT$/, '').replace(/^1000+/, '')}.PERP_USDT/Manual`,
    tradingview: (s) => `https://www.tradingview.com/chart/?symbol=BINANCE:${s}.P`,
}

export const BOERSE_KURZ = { bitunix: 'BX', bitget: 'BG', pionex: 'PX', tradingview: 'TV' }
export const BOERSE_NAME = { bitunix: 'Bitunix', bitget: 'Bitget', pionex: 'Pionex', tradingview: 'TradingView' }

/** Kanonische Reihenfolge — bestimmt sowohl die Anzeige-Reihenfolge als auch die CSV-Schreibreihenfolge der Einstellung. */
export const BOERSE_SCHLUESSEL = ['bitunix', 'bitget', 'pionex', 'tradingview']

export function boerseUrl(boerse, symbol) {
    return BOERSE_URL[boerse]?.(symbol) || null
}

/**
 * CSV aus den Settings (`currentUser.value.boersenLinks`) → gültiges Array.
 *
 * Leer oder komplett unbekannt heisst "alles an", nicht "nichts an" — sonst
 * würde eine noch nicht geladene Einstellung (z. B. während `currentUser` noch
 * lädt) sämtliche Links verschwinden lassen, obwohl niemand das gewählt hat.
 */
export function aktivierteBoersen(csv) {
    const gewaehlt = String(csv || '').split(',').map((s) => s.trim()).filter(Boolean)
    const gefiltert = BOERSE_SCHLUESSEL.filter((b) => gewaehlt.includes(b))
    return gefiltert.length ? gefiltert : BOERSE_SCHLUESSEL
}
