/**
 * Symbol-Metadaten (tickSize, stepSize) von Binance.
 *
 * Modulweiter Promise-Cache: Picker und Datenfeed brauchen dieselbe Liste,
 * sollen sie aber nicht doppelt anfragen. Der Server hält zusätzlich einen
 * 6-Stunden-Cache, die Antwort ist auf ~45 kB geslimmt.
 */
import axios from 'axios'

const cache = new Map()   // market -> Promise<Array>

export function loadSymbolMeta(market = 'futures') {
    if (!cache.has(market)) {
        const request = axios.get('/api/binance/exchange-info', { params: { market } })
            .then(res => res.data?.symbols || [])
            .catch(() => {
                cache.delete(market)   // Fehlschlag nicht dauerhaft festschreiben
                return []
            })
        cache.set(market, request)
    }
    return cache.get(market)
}

export async function tickSizeFor(symbol, market = 'futures') {
    const symbols = await loadSymbolMeta(market)
    return symbols.find(s => s.symbol === symbol)?.tickSize || null
}
