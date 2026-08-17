/**
 * Bybit-Liquidationen: pure Bausteine für den zweiten Sammelstrom.
 *
 * Warum Bybit zusätzlich zu Binance: Binance drosselt forceOrder auf
 * 1 Ereignis/s/Symbol — unsere Aufzeichnung ist dort nur eine Stichprobe.
 * Bybit pusht `allLiquidation` ungedrosselt alle 500 ms und macht das
 * Liquidations-Bild damit deutlich vollständiger.
 *
 * Dieses Modul enthält nur Netz- und DB-freie Funktionen, damit der
 * Selbsttest (__selftest-bybit-liq.mjs) die Normalisierung ohne Verbindung
 * prüfen kann. Die WebSocket-Verwaltung liegt im live-recorder.js.
 */

export const BYBIT_LIQ_WS = 'wss://stream.bybit.com/v5/public/linear'

// Bybit trennt inaktive Verbindungen nach 10 Minuten — der Client muss selbst
// pingen (Doku empfiehlt alle 20 s). Bleibt der Pong aus, ist der Socket tot.
export const BYBIT_PING_MS = 20000
export const BYBIT_PONG_LIMIT_MS = 60000

/** Subscribe-Nachricht für die allLiquidation-Topics der gewünschten Symbole. */
export function bybitSubscribeMsg(symbole) {
    return JSON.stringify({
        op: 'subscribe',
        args: [...symbole].map((s) => `allLiquidation.${String(s).toUpperCase()}`),
    })
}

/**
 * Eine Bybit-Nachricht in unsere Ereignis-Tupel [t, preis, menge, seite]
 * übersetzen. Rückgabe: Map SYMBOL -> Tupel[], oder null für alles, was kein
 * Liquidations-Push ist (Pong, Subscribe-Ack, fremde Topics).
 *
 * ⚠️ SEITEN-KONVENTION — gegenüber Binance INVERTIERTE String-Logik!
 * Bybit-Doku zu `S`: "Position side. Buy, Sell. When you receive a Buy update,
 * this means that a long position has been liquidated." `S` ist also die Seite
 * der liquidierten POSITION, während Binance die Order-Seite der Börse liefert
 * (dort: BUY = Short liquidiert). Unsere Speicher-Konvention ist überall
 * seite 1 = SHORT liquidiert, 0 = LONG liquidiert — daraus folgt hier:
 * Bybit `S === 'Sell'` → 1, `S === 'Buy'` → 0. NIEMALS umdrehen, siehe auch
 * die Warnungen in live-recorder.js, marktradar-api.js und KachelLiq24.vue.
 *
 * `p` ist bei Bybit der Bankruptcy-Preis (nicht der Markpreis) — für das
 * USD-Notional preis×menge ist das genau genug.
 */
export function normalisiereBybitLiq(msg, erlaubteSymbole) {
    if (!msg || typeof msg !== 'object') return null
    if (typeof msg.topic !== 'string' || !msg.topic.startsWith('allLiquidation.')) return null
    if (!Array.isArray(msg.data)) return null

    const proSymbol = new Map()
    for (const e of msg.data) {
        const symbol = String(e?.s || '').toUpperCase()
        if (!symbol || (erlaubteSymbole && !erlaubteSymbole.has(symbol))) continue
        // Number(null) wäre 0 und damit „finite" — deshalb echt positiv fordern:
        // Preis oder Menge 0 ist bei einer Liquidation immer Datenmüll.
        const t = Number(e.T)
        const preis = Number(e.p)
        const menge = Number(e.v)
        if (!Number.isFinite(t) || t <= 0 || !(preis > 0) || !(menge > 0)) continue
        if (e.S !== 'Buy' && e.S !== 'Sell') continue

        let liste = proSymbol.get(symbol)
        if (!liste) proSymbol.set(symbol, liste = [])
        liste.push([t, preis, menge, e.S === 'Sell' ? 1 : 0])
    }
    return proSymbol
}
