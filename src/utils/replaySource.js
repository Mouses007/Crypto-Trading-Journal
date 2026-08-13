/**
 * Wiedergabe aufgezeichneter Heatmaps.
 *
 * Lädt einen Zeitraum vom Server und füllt damit denselben Ringpuffer, den auch
 * der Live-Feed benutzt — der Renderer merkt keinen Unterschied und braucht
 * keinen zweiten Zeichenpfad.
 *
 * Was fehlt: Trades und Liquidationen werden noch nicht mitgeschnitten, in der
 * Wiedergabe gibt es also nur Liquidität und Mid-Kurve.
 */
import axios from 'axios'
import { HeatmapRing } from './heatmapRing.js'

/**
 * @returns {Promise<{ring: HeatmapRing, startTs: number, frameMs: number, cols: number, hinweis?: string}>}
 */
export async function loadReplay({ symbol, market, from, to }) {
    const { data } = await axios.get('/api/live/replay', { params: { symbol, market, from, to } })
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
        cols: data.cols,
        hinweis: data.abgeschnitten || undefined,
    }
}

/** Welche Stunden liegen für ein Symbol vor? */
export async function loadAvailability({ symbol, market, from, to }) {
    const { data } = await axios.get('/api/live/recorder/available', { params: { symbol, market, from, to } })
    return data.stunden || []
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
