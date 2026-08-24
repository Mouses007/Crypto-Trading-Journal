/**
 * Projekt-Infos zu einem Coin: was ist das, wer steckt dahinter, wo ist die
 * Website — für den Klick auf ein Symbol im Coin-Radar.
 *
 * Quelle ist CoinGecko (`search` zum Auflösen des Handelssymbols auf eine
 * CoinGecko-Id, `coins/{id}` für die eigentlichen Angaben) über den
 * gemeinsamen, bereits ratenbegrenzten `holeJson` des Hype-Radars — eigene
 * Bremse hier hätte nichts gegen dessen Verbrauch geschützt, beide Module
 * treffen denselben Host.
 *
 * ⚠ CoinGecko führt seit Jahren KEIN strukturiertes „Team"-Feld mehr. Was
 * hier steht, ist die Projektbeschreibung plus Links — daraus lässt sich ein
 * Team allenfalls lesen, nicht zuverlässig ableiten. Kein Feld täuscht das vor.
 */

import { holeJson } from '../hype-radar/quellen.js'
import { logWarn } from '../logger.js'

/** Projektinfos ändern sich kaum — ein Tag Cache ist grosszügig, nicht knapp. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const cache = new Map()   // Basissymbol -> { ts, daten: object|null }

/** Wie bei der Listungsprüfung: USDT-Endung und 1000er-Bündelung runter. */
function basisVon(symbol) {
    return String(symbol || '').toUpperCase().replace(/USDT$/, '').replace(/^1000+/, '')
}

/**
 * @param {string} symbol  Handelssymbol, z.B. "BSBUSDT"
 * @param {string} [schluessel]  entschlüsselter CoinGecko-Demo-Key, falls hinterlegt
 * @returns {Promise<object|null>}  null = nicht gefunden, nicht „Fehler beim Abruf"
 */
export async function holeCoinInfo(symbol, schluessel = '') {
    const basis = basisVon(symbol)
    if (!basis) return null

    const alt = cache.get(basis)
    if (alt && Date.now() - alt.ts < CACHE_TTL_MS) return alt.daten

    const kopf = schluessel ? { 'x-cg-demo-api-key': schluessel } : {}
    let treffer
    try {
        const suche = await holeJson(
            `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(basis)}`, { kopf })
        const kandidaten = suche?.coins || []
        // Exakter Symbol-Treffer mit dem kleinsten (= bedeutendsten) Rang zuerst
        // — bei mehrdeutigen Tickern (z.B. "BSB": Rang 747 UND Rang 7004) ist das
        // Perpetual auf einer grossen Börse fast immer der prominentere.
        treffer = kandidaten
            .filter((c) => String(c?.symbol || '').toUpperCase() === basis)
            .sort((a, b) => (a.market_cap_rank ?? Infinity) - (b.market_cap_rank ?? Infinity))[0]
            || kandidaten[0]
    } catch (e) {
        logWarn('coin-radar', `Coin-Info: Suche nach "${basis}" fehlgeschlagen: ${e.message}`)
        throw e   // Netzfehler ≠ „nicht gefunden" — nicht cachen, nicht als leer melden
    }
    if (!treffer?.id) {
        cache.set(basis, { ts: Date.now(), daten: null })
        return null
    }

    let j
    try {
        j = await holeJson(
            `https://api.coingecko.com/api/v3/coins/${treffer.id}`
            + '?localization=false&tickers=false&market_data=true&community_data=false'
            + '&developer_data=false&sparkline=false', { kopf })
    } catch (e) {
        logWarn('coin-radar', `Coin-Info: Details zu "${treffer.id}" fehlgeschlagen: ${e.message}`)
        throw e
    }

    const daten = {
        name: j?.name || treffer.name || basis,
        symbol: String(j?.symbol || basis).toUpperCase(),
        bild: j?.image?.small || treffer.thumb || '',
        beschreibung: String(j?.description?.en || '').trim(),
        kategorien: Array.isArray(j?.categories) ? j.categories.filter(Boolean) : [],
        marketCapRang: j?.market_cap_rank ?? treffer.market_cap_rank ?? null,
        homepage: (j?.links?.homepage || []).find(Boolean) || '',
        whitepaper: j?.links?.whitepaper || '',
        twitter: j?.links?.twitter_screen_name ? `https://x.com/${j.links.twitter_screen_name}` : '',
        telegram: j?.links?.telegram_channel_identifier ? `https://t.me/${j.links.telegram_channel_identifier}` : '',
        github: (j?.links?.repos_url?.github || []).find(Boolean) || '',
        explorer: (j?.links?.blockchain_site || []).find(Boolean) || '',
        coingeckoUrl: `https://www.coingecko.com/en/coins/${treffer.id}`,
    }
    cache.set(basis, { ts: Date.now(), daten })
    return daten
}
