/**
 * Wo ist ein Coin als USDT-Perpetual handelbar (Bitunix, Bitget, Pionex)? —
 * für die Kennzeichen in Symbolsuche und Watchlist und deren Börsenlinks.
 *
 * Die Listen kommen einmal je Seitenaufruf von `/api/chart/handelbar` (Basis-
 * währungen je Börse); alle Aufrufer teilen sich denselben Abruf.
 *
 * Nur USDT-Perpetuals: die drei Börsen führen USDT-margined Kontrakte. Hinge
 * das Kennzeichen nur an der Basis, trüge auch SOLUSDC „BX" — handelbar ist
 * dort aber SOLUSDT. Meme-Coins mit `1000`-Präfix heissen je Börse anders
 * (1000PEPE / PEPE), deshalb wird beides versucht und das Symbol genommen,
 * unter dem die Börse den Coin wirklich führt.
 */
import axios from 'axios'
import { ref } from 'vue'
import { boerseUrl } from '../boersenLinks.js'

export const BOERSEN = [
    { id: 'bitunix', kurz: 'BX', name: 'Bitunix' },
    { id: 'bitget', kurz: 'BG', name: 'Bitget' },
    { id: 'pionex', kurz: 'PX', name: 'Pionex' },
]

/** { bitunix: Set|null, bitget: Set|null, pionex: Set|null } — null = (noch) unbekannt */
export const handelbar = ref({ bitunix: null, bitget: null, pionex: null })
let laden = null

export function ladeHandelbar() {
    if (!laden) {
        laden = axios.get('/api/chart/handelbar').then(({ data }) => {
            const aus = {}
            for (const b of BOERSEN) aus[b.id] = Array.isArray(data?.[b.id]) ? new Set(data[b.id]) : null
            handelbar.value = aus
        }).catch(() => { laden = null })   // beim nächsten Aufruf neu versuchen
    }
    return laden
}

/** Basis und Quote eines Symbols; nur USDT-Paare, sonst null. */
function basisVon(symbol) {
    const s = String(symbol || '').toUpperCase()
    return s.endsWith('USDT') && s.length > 4 ? s.slice(0, -4) : null
}

/**
 * Börsen, an denen das Symbol als USDT-Perpetual handelbar ist, mit Link.
 * @param {string} symbol  z. B. `BTCUSDT`, `1000PEPEUSDT`
 * @param {string} markt   'futures' | 'spot' — Spot bekommt keine (die Börsenseiten sind Perpetuals)
 * @returns [{ id, kurz, name, url }]
 */
export function boersenFuerSymbol(symbol, markt = 'futures') {
    if (markt !== 'futures') return []
    const base = basisVon(symbol)
    if (!base) return []
    const ohne = base.replace(/^1000+/, '')
    const aus = []
    for (const b of BOERSEN) {
        const set = handelbar.value[b.id]
        if (!set) continue
        const treffer = [base, ohne, `1000${ohne}`].find((x) => set.has(x))
        if (treffer) aus.push({ ...b, url: boerseUrl(b.id, `${treffer}USDT`) })
    }
    return aus
}
