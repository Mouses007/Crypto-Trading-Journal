/**
 * Wo ist ein Fund handelbar? — Listungsprüfung gegen die eigenen Börsen.
 *
 * Der Radar findet Coins auf dezentralen Handelsplätzen, gehandelt wird hier
 * aber über Bitunix, Bitget und Pionex. Ein Fund, den keine der drei führt,
 * ist für den Nutzer Beobachtung, kein Kandidat fürs eigene Konto — der
 * Unterschied gehört an jede Zeile, und auf Wunsch filtert er den ganzen Lauf.
 *
 * Unterschieden wird SPOT und FUTURES: ein Coin, den es nur am Kassamarkt
 * gibt, lässt sich nicht hebeln und nicht shorten — für ein Futures-Journal
 * ist das keine Fussnote, sondern die halbe Antwort.
 *
 * Alle Listen sind öffentlich und brauchen keinen Schlüssel (19.08.2026
 * geprüft):
 *   Bitunix  Futures über den bestehenden `holeHandelbar`-Weg der Rangliste.
 *            Spot wird NICHT geprüft — das Journal hat keine Bitunix-Spot-
 *            Anbindung, eine Angabe dazu wäre Behauptung ohne Nutzen.
 *   Bitget   Futures `/api/v2/mix/market/contracts`, Spot `/api/v2/spot/public/symbols`.
 *   Pionex   Spot `/api/v1/common/symbols`; Perpetuals über
 *            `/api/v1/market/tickers?type=PERP` (Symbole wie `BTC_USDT_PERP`) —
 *            eine eigene Vertragsliste gibt es dort nicht.
 *
 * Drei Antworten je Börse, nicht zwei: gelistet, nicht gelistet — und
 * UNBEKANNT, wenn keine der Listen zu holen war. Ein Netzfehler bei Bitget
 * darf nicht als „nirgends handelbar" durchgehen; mit dem Filter an würde
 * sonst ein Aussetzer einer Börse den ganzen Lauf leeren.
 */

import { holeHandelbar } from '../coin-universum.js'
import { logWarn } from '../logger.js'

const CACHE_TTL_MS = 12 * 60 * 60 * 1000
const ABRUF_TIMEOUT_MS = 12000

/** Je Börse: { ts, maerkte: {spot:Set|null, futures:Set|null} } — null heisst ungeprüft. */
const cache = new Map()

async function holeJson(url) {
    const abbruch = new AbortController()
    const uhr = setTimeout(() => abbruch.abort(), ABRUF_TIMEOUT_MS)
    try {
        const r = await fetch(url, { signal: abbruch.signal, headers: { Accept: 'application/json' } })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return await r.json()
    } finally {
        clearTimeout(uhr)
    }
}

/**
 * Märkte einer Börse, je als Set von Basiswährungen ({'BTC','1000SHIB',…}).
 * Bei Fehler bleibt der letzte gute Stand stehen; ganz ohne Stand kommt null.
 */
async function maerkteVon(boerse, holen) {
    const alt = cache.get(boerse)
    if (alt && Date.now() - alt.ts < CACHE_TTL_MS && alt.maerkte) return alt.maerkte
    try {
        const maerkte = await holen()
        cache.set(boerse, { ts: Date.now(), maerkte })
        return maerkte
    } catch (e) {
        logWarn('hype-radar', `Listung ${boerse} nicht abrufbar: ${e.message}`)
        return alt?.maerkte || null
    }
}

async function bitunixMaerkte() {
    // Die Rangliste pflegt diese Karte schon (Schlüssel wie `BTCUSDT`).
    const karte = await holeHandelbar()
    const futures = new Set()
    for (const symbol of karte.keys()) {
        if (symbol.endsWith('USDT')) futures.add(symbol.slice(0, -4))
    }
    if (!futures.size) throw new Error('leere Liste')
    // Spot bewusst null: keine Anbindung, keine Behauptung.
    return { spot: null, futures }
}

async function bitgetMaerkte() {
    const [f, s] = await Promise.allSettled([
        holeJson('https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES'),
        holeJson('https://api.bitget.com/api/v2/spot/public/symbols'),
    ])
    const futures = f.status === 'fulfilled'
        ? new Set((f.value?.data || []).map((c) => String(c?.baseCoin || '').toUpperCase()).filter(Boolean))
        : null
    const spot = s.status === 'fulfilled'
        ? new Set((s.value?.data || []).map((c) => String(c?.baseCoin || '').toUpperCase()).filter(Boolean))
        : null
    if (!futures?.size && !spot?.size) throw new Error('beide Listen leer')
    return { spot: spot?.size ? spot : null, futures: futures?.size ? futures : null }
}

async function pionexMaerkte() {
    const [s, f] = await Promise.allSettled([
        holeJson('https://api.pionex.com/api/v1/common/symbols'),
        holeJson('https://api.pionex.com/api/v1/market/tickers?type=PERP'),
    ])
    const spot = s.status === 'fulfilled'
        ? new Set((s.value?.data?.symbols || [])
            .filter((p) => p?.enable !== false && p?.baseCurrency)
            .map((p) => String(p.baseCurrency).toUpperCase()))
        : null
    // Perpetual-Symbole heissen `BTC_USDT_PERP` — die Basis ist das erste Stück.
    const futures = f.status === 'fulfilled'
        ? new Set((f.value?.data?.tickers || [])
            .map((t) => String(t?.symbol || '').split('_')[0].toUpperCase())
            .filter(Boolean))
        : null
    if (!spot?.size && !futures?.size) throw new Error('beide Listen leer')
    return { spot: spot?.size ? spot : null, futures: futures?.size ? futures : null }
}

/** Alle drei Börsen parallel; jede darf einzeln fehlen. */
export async function ladeListungen() {
    const [bitunix, bitget, pionex] = await Promise.all([
        maerkteVon('bitunix', bitunixMaerkte),
        maerkteVon('bitget', bitgetMaerkte),
        maerkteVon('pionex', pionexMaerkte),
    ])
    return { bitunix, bitget, pionex }
}

/**
 * Auf welchen Börsen und Märkten ein Symbol handelbar ist.
 *
 * Geprüft wird auch die `1000…`-Schreibweise: Terminbörsen bündeln
 * Kleinstpreis-Coins (1000SHIB, 1000PEPE) — wer nur das blanke Symbol
 * vergleicht, hält genau die Meme-Coins für ungelistet, um die es hier
 * meistens geht.
 *
 * @returns {{liste: Array<{boerse:string, spot:boolean, futures:boolean}>, unbekannt: string[]}}
 *   `liste` = Börsen, die den Coin führen (mit Marktart);
 *   `unbekannt` = Börsen, deren Listen nicht zu holen waren.
 */
export function pruefeListung(symbol, listen) {
    const s = String(symbol || '').toUpperCase()
    const liste = []
    const unbekannt = []
    if (!s) return { liste, unbekannt }
    const drin = (set) => Boolean(set && (set.has(s) || set.has(`1000${s}`)))
    for (const [boerse, maerkte] of Object.entries(listen || {})) {
        if (!maerkte || (!maerkte.spot && !maerkte.futures)) { unbekannt.push(boerse); continue }
        const spot = drin(maerkte.spot)
        const futures = drin(maerkte.futures)
        if (spot || futures) liste.push({ boerse, spot, futures })
    }
    return { liste, unbekannt }
}
