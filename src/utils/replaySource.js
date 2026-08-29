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
 * Was fehlt: aggTrades werden nicht mitgeschnitten. Handelspunkte,
 * Volumenprofil und Volumen-Säulen bleiben in der Wiedergabe deshalb leer;
 * Liquidität, Mid-Kurve und Liquidationen sind da.
 */
import axios from 'axios'
import { HeatmapRing } from './heatmapRing.js'
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
        // Spalten ohne Mid sind Lücken in der Aufzeichnung (Server war aus)
        ring.flags[c] = data.mid[c] ? 0 : 1
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
    const { data } = await axios.get('/api/live/liquidations', { params: { symbol, market, from, to } })
    const events = data.events || []
    if (!events.length) return null
    const ring = new TradeRing(Math.max(16, events.length))
    // Der Server liefert bereits nach Zeit sortiert — der Ring erwartet das,
    // weil er von hinten gelesen wird.
    for (const e of events) ring.push(e.t, e.price, e.qty, e.isBuy)
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
