/**
 * Signalverlauf einer Strategie für den Chart — die Indikatoren „LSOB" und
 * „GUSS" (EMA Touch) zeigen jedes Setup, das die Strategie über die geladene
 * Historie gefunden hätte, wie ein TradingView-Indikator seine Signale.
 *
 * Gerechnet wird genau wie im Backtest (`strategy-backtest.js`, Schritt 2–3):
 * je geschlossene Kerze `detect()` auf dem Fenster bis einschliesslich dieser
 * Kerze, mit offenen Setups und bekannten Schlüsseln, HTF-Kerzen nur, wenn sie
 * VOR der Chartkerze geschlossen haben. Kein Blick in die Zukunft — das Bild
 * zeigt, was die Strategie damals gesehen hätte, nicht was man heute weiss.
 *
 * Nach dem Auslösen wird nur noch nachgesehen, ob zuerst Ziel oder Stop
 * erreicht wurde (bei beidem in derselben Kerze: Stop — die vorsichtige
 * Lesart). Keine Gebühren, kein Break-even, keine Teilausstiege: das ist eine
 * Markierung im Chart, kein Backtest; dafür gibt es den Backtest.
 *
 * Rein — kein Netz, keine Datenbank (Selbsttest `__selftest-chart-signale.mjs`).
 */

/** Wie viele Kerzen braucht eine Erkennung (gleiche Formel wie im Backtest)? */
export function fensterFuer(strategie, params) {
    return (strategie.warmupCandles || 200) + (params.scanWindowCandles || 200) + (params.retestMaxCandles || 40) + 10
}

function ausgang(setup, candles, abIndex) {
    const long = setup.direction === 'long'
    const sl = setup.stopLoss, tp = setup.takeProfit
    if (!(sl > 0)) return { ausgang: 'offen', exitT: null, exitP: null }
    for (let i = abIndex; i < candles.length; i++) {
        const k = candles[i]
        const stop = long ? k.l <= sl : k.h >= sl
        const ziel = tp > 0 && (long ? k.h >= tp : k.l <= tp)
        if (stop) return { ausgang: 'stop', exitT: k.t, exitP: sl }
        if (ziel) return { ausgang: 'ziel', exitT: k.t, exitP: tp }
    }
    return { ausgang: 'offen', exitT: null, exitP: null }
}

/**
 * @param {{ strategie, candles, params, htfCandles?, ltfMs, htfMs?, anzeigen? }} o
 *   `anzeigen`: über wie viele der jüngsten Kerzen Signale gesucht werden
 * @returns {{ setups: Array, von: number|null, bis: number|null }}
 */
export function signalVerlauf({ strategie, candles, params, htfCandles = null, ltfMs, htfMs = 0, anzeigen = 500 }) {
    const n = candles.length
    const fenster = fensterFuer(strategie, params)
    const warmup = strategie.warmupCandles || 200
    const start = Math.max(warmup, n - anzeigen)
    const htfAlle = Array.isArray(htfCandles) ? htfCandles : []
    let htfZeiger = 0
    let offene = []
    const bekannt = new Set()
    const alle = []
    for (let i = start; i < n; i++) {
        const kerze = candles[i]
        while (htfZeiger < htfAlle.length && htfAlle[htfZeiger].t + htfMs <= kerze.t + ltfMs) htfZeiger++
        const von = Math.max(0, i + 1 - fenster)
        const { setups, events } = strategie.detect({
            candles: candles.slice(von, i + 1),
            params,
            openSetups: offene,
            knownSetupKeys: [...bekannt],
            htfCandles: htfZeiger > 0 ? htfAlle.slice(0, htfZeiger) : null,
            historieVerkuerzt: von > 0,
        })
        for (const s of setups || []) {
            const setup = { ...s, id: alle.length + 1, erkanntT: kerze.t }
            offene.push(setup)
            alle.push(setup)
            bekannt.add(`${s.direction}|${s.obCandleTime}`)
        }
        for (const ev of events || []) {
            const setup = offene.find((s) => s.id === ev.id)
            if (!setup) continue
            offene = offene.filter((s) => s.id !== ev.id)
            setup.status = ev.status
            setup.endeT = ev.triggeredAt || ev.candleTime || kerze.t
            if (ev.invalidReason) setup.invalidReason = ev.invalidReason
            if (ev.status !== 'triggered') continue
            setup.triggeredAt = ev.triggeredAt || kerze.t
            if (Number.isFinite(ev.entry) && ev.entry > 0) setup.entry = ev.entry
            if (Number.isFinite(ev.stopLoss) && ev.stopLoss > 0) setup.stopLoss = ev.stopLoss
            if (Number.isFinite(ev.takeProfit)) setup.takeProfit = ev.takeProfit
            // Ausgang ab der Kerze NACH dem Auslösen — in der Auslösekerze ist die Reihenfolge unbekannt.
            const j = candles.findIndex((k) => k.t > setup.triggeredAt)
            Object.assign(setup, ausgang(setup, candles, j < 0 ? n : j))
        }
    }
    return {
        von: candles[start]?.t ?? null,
        bis: candles[n - 1]?.t ?? null,
        setups: alle.map((s) => ({
            id: s.id, direction: s.direction, status: s.status, invalidReason: s.invalidReason || null,
            sweepLevel: s.sweepLevel ?? null, sweepPrice: s.sweepPrice ?? null, sweepCandleTime: s.sweepCandleTime ?? null,
            obHigh: s.obHigh ?? null, obLow: s.obLow ?? null, obCandleTime: s.obCandleTime ?? null,
            entry: s.entry ?? null, stopLoss: s.stopLoss ?? null, takeProfit: s.takeProfit ?? null,
            erkanntT: s.erkanntT, endeT: s.endeT ?? null, triggeredAt: s.triggeredAt ?? null,
            ausgang: s.ausgang ?? null, exitT: s.exitT ?? null, exitP: s.exitP ?? null,
        })),
    }
}
