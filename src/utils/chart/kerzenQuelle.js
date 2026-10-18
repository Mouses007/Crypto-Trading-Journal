/**
 * Kerzen für den Chart: Historie per REST, laufende Kerze per Websocket.
 *
 * Normalform im ganzen Chart ist `{t, o, h, l, c, v}` mit `t` in
 * MILLISEKUNDEN (wie überall im Projekt, Strategie-Schicht und Indikatoren
 * eingeschlossen). Erst `ChartPanel.vue` rechnet beim Übergeben an Lightweight
 * Charts in Sekunden um — an genau einer Stelle, damit Zeichnungen, Journal-
 * und Strategie-Overlays nie zwei Zeitbasen mischen.
 */
import axios from 'axios'
import { BinanceStream, buildKlineUrl } from '../binanceStream.js'

export const INTERVALLE = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']

/** Die Knöpfe, die ohne Aufklappen sichtbar sind. */
export const INTERVALLE_SICHTBAR = ['1m', '5m', '15m', '1h', '4h', '1d', '1w']

const MIN = 60_000
export const INTERVALL_MS = {
    '1m': MIN, '3m': 3 * MIN, '5m': 5 * MIN, '15m': 15 * MIN, '30m': 30 * MIN,
    '1h': 60 * MIN, '2h': 120 * MIN, '4h': 240 * MIN, '6h': 360 * MIN, '8h': 480 * MIN, '12h': 720 * MIN,
    '1d': 1440 * MIN, '3d': 3 * 1440 * MIN, '1w': 7 * 1440 * MIN,
    // Monat ist keine feste Länge; für Hochrechnungen in die Zukunft (Zeichnungen
    // rechts der letzten Kerze) genügt ein Mittelwert.
    '1M': 30.44 * 1440 * MIN,
}

/** Quelle aus dem Markt — Binance ist die Datenbasis. */
export function quelleFuer(markt) {
    return markt === 'spot' ? 'binance-spot' : 'binance-futures'
}

/**
 * Kerzen holen. Ohne `endTime` die jüngsten (inkl. laufender), mit `endTime`
 * die davor — für das Nachladen beim Zurückscrollen.
 * @returns {Promise<Array<{t,o,h,l,c,v}>>}
 */
export async function ladeKerzen({ markt, symbol, interval, endTime, limit = 1000 }) {
    const params = { quelle: quelleFuer(markt), symbol, interval, limit }
    if (endTime) params.endTime = endTime
    const { data } = await axios.get('/api/chart/kerzen', { params })
    return (data?.kerzen || []).map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
}

/**
 * Laufende Kerze. `onKerze({t,o,h,l,c,v, geschlossen})` wird bei jeder
 * Änderung gerufen; nach einem Wiederverbinden ruft `onLuecke()` — der Chart
 * holt dann die letzten Kerzen neu, sonst bliebe ein Loch, wo die Verbindung
 * weg war.
 */
export class LiveKerze {
    constructor({ markt, symbol, interval, onKerze, onLuecke, onStatus }) {
        this.ersteVerbindung = true
        this.stream = new BinanceStream({
            url: buildKlineUrl(symbol, markt, interval),
            // Bei 1w/1M kommen Updates nur, wenn gehandelt wird — das tut der
            // Markt aber ständig; 30 s Stille heisst hier wirklich tot.
            silenceLimitMs: 30_000,
            onOpen: () => {
                if (!this.ersteVerbindung) onLuecke?.()
                this.ersteVerbindung = false
            },
            onStatus,
            onMessage: (m) => {
                const k = m?.k
                if (!k) return
                onKerze({
                    t: Number(k.t), o: Number(k.o), h: Number(k.h), l: Number(k.l), c: Number(k.c), v: Number(k.v),
                    geschlossen: k.x === true,
                })
            },
        })
        this.stream.connect()
    }

    stop() {
        this.stream.stop()
    }
}

/**
 * Zwei Kerzenreihen zusammenführen (ältere vorn), Doppelte nach `t` entfernt.
 * Die jüngere Reihe gewinnt bei gleicher Zeit — sie ist der neuere Stand.
 */
export function fuegeZusammen(aelter, juenger) {
    const karte = new Map()
    for (const k of aelter) karte.set(k.t, k)
    for (const k of juenger) karte.set(k.t, k)
    return [...karte.values()].sort((a, b) => a.t - b.t)
}
