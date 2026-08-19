/**
 * Wo ist ein Fund handelbar? — Listungsprüfung gegen die eigenen Börsen.
 *
 * Der Radar findet Coins auf dezentralen Handelsplätzen, gehandelt wird hier
 * aber über Bitunix, Bitget und Pionex. Ein Fund, den keine der drei führt,
 * ist für den Nutzer Beobachtung, kein Kandidat fürs eigene Konto — der
 * Unterschied gehört an jede Zeile, und auf Wunsch filtert er den ganzen Lauf.
 *
 * Alle drei Listen sind öffentlich und brauchen keinen Schlüssel (am
 * 19.08.2026 geprüft): Bitunix über den bestehenden `holeHandelbar`-Weg der
 * Coin-Rangliste, Bitget über `/api/v2/mix/market/contracts`, Pionex über
 * `/api/v1/common/symbols`.
 *
 * Drei Antworten je Börse, nicht zwei: gelistet, nicht gelistet — und
 * UNBEKANNT, wenn die Liste gerade nicht zu holen war. Ein Netzfehler bei
 * Bitget darf nicht als „nirgends handelbar" durchgehen; mit dem Filter an
 * würde sonst ein Aussetzer einer Börse den ganzen Lauf leeren.
 */

import { holeHandelbar } from '../coin-universum.js'
import { logWarn } from '../logger.js'

const CACHE_TTL_MS = 12 * 60 * 60 * 1000
const ABRUF_TIMEOUT_MS = 12000

/** Ein Cache-Eintrag je Börse: { ts, symbole: Set|null } — null heisst unbekannt. */
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
 * Basiswährungen einer Börse als Set, z. B. {'BTC','PEPE','1000SHIB'}.
 * Bei Fehler null — und der letzte gute Stand bleibt stehen, solange er da ist.
 */
async function symbolSet(boerse, holen) {
    const alt = cache.get(boerse)
    if (alt && Date.now() - alt.ts < CACHE_TTL_MS && alt.symbole) return alt.symbole
    try {
        const symbole = await holen()
        cache.set(boerse, { ts: Date.now(), symbole })
        return symbole
    } catch (e) {
        logWarn('hype-radar', `Listung ${boerse} nicht abrufbar: ${e.message}`)
        // Ein abgelaufener Stand ist besser als gar keiner — Listungen ändern
        // sich über Stunden, nicht über Minuten.
        return alt?.symbole || null
    }
}

async function bitunixSet() {
    // Die Rangliste pflegt diese Karte schon (Schlüssel wie `BTCUSDT`).
    const karte = await holeHandelbar()
    const s = new Set()
    for (const symbol of karte.keys()) {
        if (symbol.endsWith('USDT')) s.add(symbol.slice(0, -4))
    }
    if (!s.size) throw new Error('leere Liste')
    return s
}

async function bitgetSet() {
    const j = await holeJson('https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES')
    const s = new Set()
    for (const c of (Array.isArray(j?.data) ? j.data : [])) {
        if (c?.baseCoin) s.add(String(c.baseCoin).toUpperCase())
    }
    if (!s.size) throw new Error('leere Liste')
    return s
}

async function pionexSet() {
    const j = await holeJson('https://api.pionex.com/api/v1/common/symbols')
    const s = new Set()
    for (const p of (j?.data?.symbols || [])) {
        if (p?.enable !== false && p?.baseCurrency) s.add(String(p.baseCurrency).toUpperCase())
    }
    if (!s.size) throw new Error('leere Liste')
    return s
}

/** Alle drei Listen parallel; jede darf einzeln fehlen. */
export async function ladeListungen() {
    const [bitunix, bitget, pionex] = await Promise.all([
        symbolSet('bitunix', bitunixSet),
        symbolSet('bitget', bitgetSet),
        symbolSet('pionex', pionexSet),
    ])
    return { bitunix, bitget, pionex }
}

/**
 * Auf welchen Börsen ein Symbol handelbar ist.
 *
 * Geprüft wird auch die `1000…`-Schreibweise: Kleinstpreis-Coins werden an
 * den Terminbörsen gebündelt geführt (1000SHIB, 1000PEPE) — wer nur das
 * blanke Symbol vergleicht, hält genau die Meme-Coins für ungelistet, um die
 * es hier meistens geht.
 *
 * @returns {{liste:string[], unbekannt:string[]}}
 *   `liste` = Börsen, die den Coin führen; `unbekannt` = Börsen ohne Antwort.
 */
export function pruefeListung(symbol, listen) {
    const s = String(symbol || '').toUpperCase()
    const liste = []
    const unbekannt = []
    if (!s) return { liste, unbekannt }
    for (const [boerse, set] of Object.entries(listen || {})) {
        if (!set) { unbekannt.push(boerse); continue }
        if (set.has(s) || set.has(`1000${s}`)) liste.push(boerse)
    }
    return { liste, unbekannt }
}
