/**
 * Symbole der Börsen vergleichbar machen — für Server (Journal-Auswertung)
 * und Browser (offene Positionen im Chart) dieselbe Regel.
 *
 * Bitget `BTCUSDT_UMCBL`, Pionex `BTC_USDT_PERP`, `BTC-USDT` → `BTCUSDT`.
 * Die `1000`-Vorsilbe bleibt bewusst stehen: 1000PEPE notiert tausendmal höher
 * als PEPE, ein Trade darauf an PEPE-Kerzen stünde drei Grössenordnungen
 * neben dem Kurs.
 */
export function normSymbol(s) {
    let x = String(s || '').toUpperCase().trim()
    x = x.replace(/_(UMCBL|DMCBL|CMCBL|PERP|SWAP)$/, '')
    x = x.replace(/[-_/:]/g, '')
    x = x.replace(/PERP$/, '')
    return x
}
