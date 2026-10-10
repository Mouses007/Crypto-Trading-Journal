/**
 * Coin-Radar, Tiefensuche: was hinter einem gelisteten Coin steht.
 *
 * Die Einzelprüfung misst, wie sich ein Perpetual handeln lässt — Bewegung,
 * Umsatz, Spread, Orderbuch. Sie sagt nichts über den Token dahinter: Wer hält
 * ihn, kann der Herausgeber Bestände sperren oder neu prägen, steht ein Projekt
 * dahinter? Genau das prüft die Frühphase für junge Token, und dieselben
 * Bausteine beantworten es hier:
 *
 *   Verträge     CoinGecko (`platforms`) — je Kette die Adresse des Tokens
 *   Vertrag      RugCheck (Solana) bzw. GoPlus — Mint, Freeze, Honeypot,
 *                Token-2022, verdeckte Eigentümerrechte (`pruefe` / `risikoFrueh`)
 *   Halter       Top-10 (ohne Pools und Locker), Insider, Ersteller
 *   On-Chain     DexScreener — Liquidität und Umsatz der DEX-Pools
 *   Projekt      die Projektprüfung mit allen Regeln (eigene Seite, Beleg, GitHub)
 *
 * Bewusst NICHT die Frühphasen-Note: Sie misst Beschleunigung gegen den
 * eigenen Verlauf eines jungen Tokens. Ein Perpetual mit hundert Millionen
 * Umsatz hat diesen Verlauf nicht; die Note wäre eine Zahl ohne Bedeutung.
 *
 * Kostet kein Geld (keine KI), nur Abrufe ohne Schlüssel.
 */

import { holeCoinInfo } from './coin-info.js'
import { dexDetails, normChain } from '../hype-radar/quellen.js'
import { holeRisiko } from '../hype-radar/fruehphase.js'
import { risikoFrueh } from '../hype-radar/fruehphase-bewertung.js'
import { pruefeProjekt, kurzfassung } from '../hype-radar/projekt.js'
import { SKALA_PROZENT } from '../hype-radar/sicherheit.js'

/** Ketten, deren Verträge geprüft werden können (RugCheck/GoPlus). */
export const PRUEFBARE_KETTEN = ['ethereum', 'solana', 'base', 'bsc', 'arbitrum', 'polygon', 'avalanche', 'optimism']

/** Höchstens so viele Ketten werden auf DEX-Liquidität abgefragt. */
const MAX_KETTEN = 4

/**
 * Verträge aus CoinGeckos `platforms` — rein. Kettennamen vereinheitlicht,
 * leere Einträge weg, prüfbare Ketten in fester Reihenfolge zuerst.
 *
 * @returns {Array<{chain:string, contract:string, pruefbar:boolean}>}
 */
export function vertraegeAus(plattformen = {}) {
    const raus = []
    for (const [kette, adresse] of Object.entries(plattformen || {})) {
        const c = String(adresse || '').trim()
        if (!c) continue
        const chain = kette === 'optimistic-ethereum' ? 'optimism' : normChain(kette)
        raus.push({ chain, contract: c, pruefbar: PRUEFBARE_KETTEN.includes(chain) })
    }
    const rang = (x) => (x.pruefbar ? PRUEFBARE_KETTEN.indexOf(x.chain) : 99)
    return raus.sort((a, b) => rang(a) - rang(b))
}

/**
 * Welcher Vertrag wird geprüft? Der mit der meisten DEX-Liquidität — dort
 * wird der Token tatsächlich gehandelt; ohne Liquiditätsangabe der erste
 * prüfbare. Rein.
 */
export function waehleVertrag(kandidaten = []) {
    const pruefbar = kandidaten.filter((k) => k.pruefbar)
    if (!pruefbar.length) return null
    const mitLiq = pruefbar.filter((k) => Number(k.liquiditaetUsd) > 0)
    if (mitLiq.length) return [...mitLiq].sort((a, b) => Number(b.liquiditaetUsd) - Number(a.liquiditaetUsd))[0]
    return pruefbar[0]
}

/**
 * Welcher Anteil der zehn grössten Halter in VERTRÄGEN liegt — rein.
 *
 * Bei einem gelisteten Coin sind das meist Bridge, Staking, Vesting oder
 * Börsen-Verwahrung: Bei LUMIA (10.10.2026) hielten zwei Verträge 89 %, und
 * „Top-10 halten 97 %" las sich wie ein Wal. Ein Vertrag ist kein Einzelbesitz.
 *
 * @returns {number|null} Prozent, null ohne Angabe
 */
export function vertragsAnteilTop10(halter = [], skala = '') {
    const top = (Array.isArray(halter) ? halter : []).slice(0, 10)
    if (!top.length || !top.some((h) => h && 'is_contract' in h)) return null
    const faktor = skala === SKALA_PROZENT ? 1 : 100
    return top.filter((h) => Number(h?.is_contract) === 1).reduce((a, h) => a + (Number(h?.percent) || 0) * faktor, 0)
}

/**
 * Die Tiefensuche für ein Symbol.
 *
 * @param {string} symbol      z. B. „LUMIA" oder „LUMIAUSDT"
 * @param {string} schluessel  optionaler CoinGecko-Schlüssel
 */
export async function tiefensuche(symbol, schluessel = '') {
    const info = await holeCoinInfo(symbol, schluessel)
    if (!info) return { gefunden: false, symbol: String(symbol || '').toUpperCase() }

    const vertraege = vertraegeAus(info.plattformen)
    // DEX-Liquidität je prüfbarer Kette — entscheidet, welcher Vertrag zählt.
    const geprueft = await Promise.all(vertraege.filter((v) => v.pruefbar).slice(0, MAX_KETTEN).map(async (v) => {
        const d = await dexDetails(v.contract).catch(() => null)
        return { ...v, markt: d?.markt || null, pair: d?.pair || '', url: d?.url || '', liquiditaetUsd: d?.markt?.liquiditaetUsd ?? null }
    }))
    const gewaehlt = waehleVertrag(geprueft)

    let risiko = null
    let risikoFehler = ''
    if (gewaehlt) {
        try {
            const roh = await holeRisiko(gewaehlt.chain, gewaehlt.contract)
            risiko = roh ? risikoFrueh(roh) : null
            if (!roh) risikoFehler = 'Kein Prüfdienst kennt diesen Vertrag'
            const inVertraegen = roh ? vertragsAnteilTop10(roh.holders, roh.anteilSkala) : null
            if (risiko && inVertraegen !== null && inVertraegen >= 30) {
                risiko.befunde = [...(risiko.befunde || []), { art: 'info', schluessel: 'halterVertraege',
                    text: `Davon liegen ${Math.round(inVertraegen)} % in Verträgen (Bridge, Staking, Vesting oder Börse) — kein Einzelbesitz belegt` }]
            }
        } catch (e) {
            risikoFehler = String(e.message || e).slice(0, 120)
        }
    }

    const kanaele = [
        info.twitter && { typ: 'twitter', url: info.twitter },
        info.telegram && { typ: 'telegram', url: info.telegram },
        info.github && { typ: 'github', url: info.github },
    ].filter(Boolean)
    let projekt = null
    try {
        projekt = kurzfassung(await pruefeProjekt({
            symbol: info.symbol, name: info.name,
            chain: gewaehlt?.chain || '', contract: gewaehlt?.contract || '',
            links: { webseiten: info.homepage ? [info.homepage] : [], kanaele },
            seiteBelegt: info.homepage || '',
            // Auch das Repository führt CoinGecko beim Coin — kein virales fremdes Projekt.
            githubBelegt: Boolean(info.github),
        }))
    } catch { /* ohne Projektprüfung: der Rest gilt */ }

    return {
        gefunden: true,
        coin: {
            name: info.name, symbol: info.symbol, bild: info.bild, rang: info.marketCapRang,
            kategorien: info.kategorien, coingeckoUrl: info.coingeckoUrl, explorer: info.explorer,
        },
        vertraege: vertraege.map((v) => {
            const g = geprueft.find((x) => x.chain === v.chain && x.contract === v.contract)
            return { ...v, liquiditaetUsd: g?.liquiditaetUsd ?? null, volumen24h: g?.markt?.volumen24h ?? null, dex: g?.markt?.dex || '', url: g?.url || '' }
        }),
        gewaehlt: gewaehlt ? { chain: gewaehlt.chain, contract: gewaehlt.contract } : null,
        risiko,
        risikoFehler,
        projekt,
        geprueftAm: Date.now(),
    }
}
