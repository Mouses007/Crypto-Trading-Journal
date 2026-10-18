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

/**
 * Quelle aus Börse und Markt. Binance ist die Datenbasis; Bitunix und Bitget
 * gibt es nur als Futures und nur per REST (siehe `server/chart-api.js`).
 */
export function quelleFuer(markt, boerse = 'binance') {
    if (boerse === 'bitunix' || boerse === 'bitget') return boerse
    return markt === 'spot' ? 'binance-spot' : 'binance-futures'
}

export const istRestQuelle = (boerse) => boerse === 'bitunix' || boerse === 'bitget'

/** Wie viele Kerzen eine Quelle je Abruf hergibt. */
export const QUELLEN_MAX = { binance: 1000, bitunix: 200, bitget: 1000 }

/** Zeiteinheiten, die eine Quelle nicht kennt. */
export const QUELLEN_OHNE = { bitget: ['8h'] }

/**
 * Kerzen holen. Ohne `endTime` die jüngsten (inkl. laufender), mit `endTime`
 * die davor — für das Nachladen beim Zurückscrollen.
 * @returns {Promise<Array<{t,o,h,l,c,v}>>}
 */
export async function ladeKerzen({ markt, symbol, interval, endTime, limit = 1000, boerse = 'binance', mitLauf = false }) {
    const params = { quelle: quelleFuer(markt, boerse), symbol, interval, limit: Math.min(limit, QUELLEN_MAX[boerse] || 1000) }
    if (endTime) params.endTime = endTime
    const { data } = await axios.get('/api/chart/kerzen', { params })
    const kerzen = (data?.kerzen || []).map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
    return mitLauf ? { kerzen, lauf: data?.lauf || null } : kerzen
}

/**
 * Laufende Kerze per Abfrage statt Websocket (Bitunix, Bitget), alle 3 s.
 *
 * Bitget liefert die laufende Kerze mit. Bitunix nicht — dort kommt nur der
 * Tickerpreis, und die Kerze wird hier gebaut: Eröffnung = Schluss der
 * vorigen, Hoch/Tief aus den Preisen, die diese Seite gesehen hat. Sie ist
 * damit erst ab dem Öffnen genau; das steht im Kopf des Charts.
 */
export class RestKerze {
    constructor({ markt, symbol, interval, boerse, onKerze, onStatus }) {
        this.aus = false
        this.gebaut = null
        const runde = async () => {
            if (this.aus) return
            try {
                const { kerzen, lauf } = await ladeKerzen({ markt, symbol, interval, boerse, limit: 3, mitLauf: true })
                if (this.aus) return
                for (const k of kerzen) onKerze({ ...k, geschlossen: false })
                const letzte = kerzen[kerzen.length - 1]
                if (lauf && letzte && lauf.t > letzte.t) {
                    if (!this.gebaut || this.gebaut.t !== lauf.t) {
                        this.gebaut = { t: lauf.t, o: letzte.c, h: Math.max(letzte.c, lauf.preis), l: Math.min(letzte.c, lauf.preis), c: lauf.preis, v: 0 }
                    } else {
                        this.gebaut.h = Math.max(this.gebaut.h, lauf.preis)
                        this.gebaut.l = Math.min(this.gebaut.l, lauf.preis)
                        this.gebaut.c = lauf.preis
                    }
                    onKerze({ ...this.gebaut, geschlossen: false })
                }
                onStatus?.('open')
            } catch {
                onStatus?.('closed')
            }
            if (!this.aus) this.uhr = setTimeout(runde, 3000)
        }
        onStatus?.('connecting')
        runde()
    }

    stop() {
        this.aus = true
        clearTimeout(this.uhr)
    }
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
