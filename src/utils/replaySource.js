/**
 * Wiedergabe aufgezeichneter Heatmaps.
 *
 * Lädt einen Zeitraum vom Server und füllt damit denselben Ringpuffer, den auch
 * der Live-Feed benutzt — der Renderer merkt keinen Unterschied und braucht
 * keinen zweiten Zeichenpfad.
 *
 * `maxCols` ist die Plotbreite in Pixeln. Der Server faltet so viele
 * Quellspalten zusammen, dass die Antwort nie breiter ist — dadurch passt auch
 * ein mehrstündiger Trade auf ein Bild, und die Auflösung ergibt sich aus dem
 * angefragten Zeitraum statt aus einem Zoomregler.
 *
 * Seit 10.10.2026 schneidet der Recorder auch aggTrades mit (kind 'trades') —
 * Handelspunkte, Volumenprofil, Säulen und CVD funktionieren damit auch in
 * der Wiedergabe. Für Stunden VOR diesem Datum gibt es keine Trades; die
 * Wiedergabe zeigt dann wie früher nur Liquidität, Mid-Kurve, Liquidationen.
 */
import axios from 'axios'
import { HeatmapRing, FLAG_LUECKE, FLAG_OHNE_BUCH } from './heatmapRing.js'
import { TradeRing } from './tradeRing.js'

/**
 * @returns {Promise<{ring: HeatmapRing, startTs: number, frameMs: number, cols: number,
 *   quellFrameMs: number, verdichtet: number, hinweis?: string}>}
 */
export async function loadReplay({ symbol, market, from, to, maxCols }) {
    const { data } = await axios.get('/api/live/replay', { params: { symbol, market, from, to, maxCols } })
    if (!data.cols) return { ring: null, cols: 0, hinweis: data.hinweis || 'Keine Aufzeichnung für diesen Zeitraum' }

    const raw = await unpack(data)
    const ring = new HeatmapRing({ cap: data.cols, rows: data.rows, bucketSize: data.bucketSize })

    // Uint8 zurückrechnen: bei der Aufzeichnung wurde log-quantisiert, damit aus
    // 4 Byte pro Zelle eines wird. Der Rückweg ist verlustbehaftet — für eine
    // Heatmap unkritisch, für exakte Mengen nicht.
    const logMax = Math.log1p(data.saturation || 4)
    const lut = new Float32Array(256)
    for (let i = 1; i < 256; i++) lut[i] = Math.expm1((i / 255) * logMax) * data.quantRef

    for (let c = 0; c < data.cols; c++) {
        const src = c * data.rows
        const dst = c * ring.rows
        for (let r = 0; r < data.rows; r++) {
            const v = raw[src + r]
            if (v) ring.data[dst + r] = lut[v]
        }
        ring.base[c] = data.base[c]
        ring.mid[c] = data.mid[c]
        ring.ts[c] = data.startTs + c * data.frameMs
        // Spalten ohne Mid sind Lücken in der Aufzeichnung (Server war aus) —
        // und tragen zugleich kein Buch, sonst hielte das freie Feld rechts
        // eine leere Spalte für den aktuellen Buchzustand.
        ring.flags[c] = data.mid[c] ? 0 : (FLAG_LUECKE | FLAG_OHNE_BUCH)
    }
    ring.count = data.cols
    ring.head = 0   // colFrom(0, 0) zeigt auf die letzte Spalte

    return {
        ring,
        startTs: data.startTs,
        frameMs: data.frameMs,
        quellFrameMs: data.quellFrameMs || data.frameMs,
        verdichtet: data.verdichtet || 1,
        cols: data.cols,
        hinweis: data.abgeschnitten || undefined,
    }
}

/**
 * Aufgezeichnete Zwangsliquidationen als TradeRing — dieselbe Struktur, die der
 * Live-Feed füllt, damit der Renderer keinen zweiten Pfad braucht.
 *
 * Achtung bei der Deutung: Binance drosselt `forceOrder` auf ein Ereignis pro
 * Sekunde und Symbol. Was hier ankommt, ist eine Stichprobe, keine Vollzählung.
 */
export async function loadReplayLiquidations({ symbol, market, from, to }) {
    // BEIDE Quellen laden: die Binance-Aufzeichnung ('liq') ist wegen der
    // forceOrder-Drossel eine Stichprobe, die Bybit-Sammlung ('liqB') ist
    // ungedrosselt und deutlich vollständiger. Es sind Ereignisse
    // verschiedener Börsen — zusammen wird nichts doppelt gezählt, nur mehr
    // vom selben Marktgeschehen sichtbar. Die Seitenkonvention ist in beiden
    // Sorten bereits identisch (1 = Short liquidiert, in bybit-liq.js gedreht).
    const [binance, bybit] = await Promise.all([
        axios.get('/api/live/liquidations', { params: { symbol, market, from, to } }).catch(() => null),
        axios.get('/api/live/liquidations', { params: { symbol, market, from, to, venue: 'bybit' } }).catch(() => null),
    ])
    const events = [...(binance?.data?.events || []), ...(bybit?.data?.events || [])]
    if (!events.length) return null
    // Der Ring wird von hinten gelesen und erwartet Zeit-Sortierung — nach dem
    // Zusammenlegen der Quellen muss neu sortiert werden.
    events.sort((a, b) => a.t - b.t)
    const ring = new TradeRing(Math.max(16, events.length))
    for (const e of events) ring.push(e.t, e.price, e.qty, e.isBuy)
    return ring
}

/**
 * Aufgezeichnete aggTrades als TradeRing (Seite: isBuy = Käufer aggressiv,
 * dieselbe Konvention wie der Live-Feed). Null, wenn für das Fenster nichts
 * aufgezeichnet ist — die Ansicht zeigt dann schlicht keine Punkte.
 */
export async function loadReplayTrades({ symbol, market, from, to }) {
    const { data } = await axios.get('/api/live/trades', { params: { symbol, market, from, to } })
    // Kompaktes Array-Format [t, preis, menge, seite] — bei 300k Ereignissen
    // wäre die Objekt-Form ~3× so gross über die Leitung.
    const events = data.events || []
    if (!events.length) return null
    const ring = new TradeRing(Math.max(16, events.length))
    // Server liefert zeitsortiert — der Ring wird von hinten gelesen
    for (const e of events) ring.push(e[0], e[1], e[2], !!e[3])
    return ring
}

/** Server schickt die Matrix gzip-gepackt; ältere Antworten kamen roh. */
async function unpack(data) {
    const bytes = base64ToBytes(data.data)
    if (data.encoding !== 'gzip+base64') return bytes
    if (typeof DecompressionStream === 'undefined') {
        throw new Error('Browser kann die gepackte Aufzeichnung nicht entpacken')
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
}

function base64ToBytes(b64) {
    const binary = atob(b64)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
}
