/**
 * Zugriff auf das öffentliche Binance-Datenarchiv (data.binance.vision).
 *
 * Warum das wichtig ist: über die REST-API reicht die Open-Interest-Historie
 * nur 500 Punkte weit — bei 5-Minuten-Auflösung also 42 Stunden. Das Archiv
 * liefert dieselben Werte als Tagesdateien **zurück bis September 2020**.
 * Für ein Modell, das offenes Interesse Preisen zuordnet, ist das der
 * Unterschied zwischen „90 % der Masse geraten" und einer belastbaren Historie.
 *
 * Was es NICHT gibt (geprüft, nicht vermutet):
 *  - Orderbuch je Preisebene. `bookDepth` ist prozentgestaffelt (Tiefe bei
 *    −5/−4/−3/−2/−1 % vom Mittelkurs, Minutentakt) — daraus lässt sich keine
 *    Heatmap rekonstruieren.
 *  - Liquidationen für USDⓈ-M. `liquidationSnapshot` gab es nur für Coin-M
 *    und endet am 2024-10-14.
 *
 * Ohne neue Abhängigkeit: die Tagesdateien sind ZIPs mit genau einem Eintrag,
 * die sich mit `zlib.inflateRawSync` auspacken lassen.
 */

import zlib from 'zlib'
import { logWarn } from './logger.js'

const BASE = 'https://data.binance.vision/data'
const HTTP_TIMEOUT = 30000

/** Entpackt ein ZIP mit einem einzigen Eintrag — ohne externe Bibliothek. */
export function unzipSingle(buf) {
    // End of Central Directory rückwärts suchen (max. 64 kB Kommentar)
    let eocd = -1
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
    }
    if (eocd < 0) throw new Error('Kein ZIP (End of Central Directory fehlt)')

    const cdOffset = buf.readUInt32LE(eocd + 16)
    if (buf.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error('Zentralverzeichnis beschädigt')

    const method = buf.readUInt16LE(cdOffset + 10)
    const compSize = buf.readUInt32LE(cdOffset + 20)
    const localOffset = buf.readUInt32LE(cdOffset + 42)

    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Lokaler Header beschädigt')
    const nameLen = buf.readUInt16LE(localOffset + 26)
    const extraLen = buf.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + nameLen + extraLen
    const daten = buf.subarray(start, start + compSize)

    if (method === 0) return daten                     // unkomprimiert abgelegt
    if (method === 8) return zlib.inflateRawSync(daten) // deflate
    throw new Error(`Unbekanntes ZIP-Kompressionsverfahren: ${method}`)
}

/** CSV mit Kopfzeile → Array von Objekten. */
function parseCsv(text) {
    const zeilen = text.trim().split('\n')
    if (zeilen.length < 2) return []
    const kopf = zeilen[0].split(',').map(s => s.trim())
    const out = []
    for (let i = 1; i < zeilen.length; i++) {
        const teile = zeilen[i].split(',')
        if (teile.length !== kopf.length) continue
        const o = {}
        for (let k = 0; k < kopf.length; k++) o[kopf[k]] = teile[k]
        out.push(o)
    }
    return out
}

async function ladeTag(pfad) {
    const res = await fetch(`${BASE}/${pfad}`, { signal: AbortSignal.timeout(HTTP_TIMEOUT) })
    if (res.status === 404) return null      // Tag existiert nicht — kein Fehler
    if (!res.ok) throw new Error(`HTTP ${res.status} für ${pfad}`)
    return parseCsv(unzipSingle(Buffer.from(await res.arrayBuffer())).toString('utf8'))
}

const alsDatum = (ts) => new Date(ts).toISOString().slice(0, 10)

/**
 * Open Interest und Positionsquoten im 5-Minuten-Takt.
 * Spalten der Quelle: create_time, symbol, sum_open_interest,
 * sum_open_interest_value, count_toptrader_long_short_ratio,
 * sum_toptrader_long_short_ratio, count_long_short_ratio,
 * sum_taker_long_short_vol_ratio
 *
 * @returns {Promise<Array<{t:number, oi:number, oiUsd:number, takerRatio:number, topPosRatio:number}>>}
 */
export async function ladeMetrics(symbol, vonMs, bisMs, { market = 'um' } = {}) {
    const punkte = []
    const fehlend = []
    for (let tag = new Date(alsDatum(vonMs)).getTime(); tag <= bisMs; tag += 86400000) {
        const d = alsDatum(tag)
        const pfad = `futures/${market}/daily/metrics/${symbol}/${symbol}-metrics-${d}.zip`
        let zeilen
        try {
            zeilen = await ladeTag(pfad)
        } catch (e) {
            logWarn('binance-archive', `metrics ${symbol} ${d} fehlgeschlagen`, e.message)
            continue
        }
        if (!zeilen) { fehlend.push(d); continue }
        for (const z of zeilen) {
            // "2026-08-01 00:00:00" ist UTC, wird von Date.parse aber als lokal
            // gelesen — ohne das angehängte Z läge alles um den Zeitzonen-
            // versatz daneben.
            const t = Date.parse(z.create_time.replace(' ', 'T') + 'Z')
            if (!Number.isFinite(t) || t < vonMs || t > bisMs) continue
            punkte.push({
                t,
                oi: +z.sum_open_interest,
                oiUsd: +z.sum_open_interest_value,
                takerRatio: +z.sum_taker_long_short_vol_ratio,
                topPosRatio: +z.sum_toptrader_long_short_ratio,
            })
        }
    }
    punkte.sort((a, b) => a.t - b.t)
    if (fehlend.length) logWarn('binance-archive', `${symbol}: ${fehlend.length} Tage ohne metrics`, fehlend.slice(0, 3).join(', '))
    return punkte
}

/**
 * Kerzen aus dem Archiv. Für lange Zeiträume deutlich sparsamer als die REST-API
 * (die max. 1500 Kerzen je Abruf liefert).
 */
export async function ladeKlines(symbol, interval, vonMs, bisMs, { market = 'um' } = {}) {
    const kerzen = []
    for (let tag = new Date(alsDatum(vonMs)).getTime(); tag <= bisMs; tag += 86400000) {
        const d = alsDatum(tag)
        const pfad = `futures/${market}/daily/klines/${symbol}/${interval}/${symbol}-${interval}-${d}.zip`
        let zeilen
        try {
            zeilen = await ladeTag(pfad)
        } catch (e) {
            logWarn('binance-archive', `klines ${symbol} ${d} fehlgeschlagen`, e.message)
            continue
        }
        if (!zeilen) continue
        for (const z of zeilen) {
            // Ältere Dateien haben keine Kopfzeile — dann steht die Zeit im
            // ersten Feld und parseCsv hat sie als Kopf verschluckt.
            const t = Number(z.open_time ?? z.openTime)
            if (!Number.isFinite(t) || t < vonMs || t > bisMs) continue
            kerzen.push({
                t,
                o: +z.open, h: +z.high, l: +z.low, c: +z.close,
                v: +z.volume, tb: +z.taker_buy_volume,
            })
        }
    }
    kerzen.sort((a, b) => a.t - b.t)
    return kerzen
}

/**
 * Führt Metrics und Kerzen auf denselben Zeitraster zusammen — dasselbe Format,
 * das `buildLeverageMap` erwartet.
 */
export async function ladeModellPunkte(symbol, vonMs, bisMs, { interval = '5m', market = 'um' } = {}) {
    const [metrics, kerzen] = await Promise.all([
        ladeMetrics(symbol, vonMs, bisMs, { market }),
        ladeKlines(symbol, interval, vonMs, bisMs, { market }),
    ])
    const nachZeit = new Map(kerzen.map(k => [k.t, k]))
    const punkte = []
    for (const m of metrics) {
        const k = nachZeit.get(m.t)
        if (!k) continue          // fehlende Kerze überspringen statt schief verknüpfen
        punkte.push({ t: m.t, oi: m.oi, oiUsd: m.oiUsd, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v, tb: k.tb })
    }
    return punkte
}
