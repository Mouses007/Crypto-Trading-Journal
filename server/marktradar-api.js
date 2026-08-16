/**
 * Marktradar — Endpunkte für die Kacheln.
 *
 * Jede Kachel hat einen eigenen Endpunkt. Ein Sammel-Endpunkt wäre bequemer,
 * aber dann leert eine einzige tote Fremdquelle die ganze Seite.
 *
 * Zwei Regeln gelten überall in dieser Datei:
 *
 * 1. **Der letzte gute Stand ist besser als eine leere Kachel.** Fällt eine
 *    Fremdquelle aus, liefern wir den Cache-Inhalt mit `veraltet: true` — die
 *    Oberfläche zeigt ihn dann mit gelbem Punkt und Stand-Zeit.
 * 2. **Antwortform immer gleich:** `{ stand, veraltet, hinweis?, …Nutzlast }`.
 *
 * Zum Doppelbetrieb: NAS-Container und Entwickler-Rechner teilen dieselbe
 * Datenbank, haben aber je einen eigenen Zwischenspeicher. Lesende Abrufe
 * laufen deshalb im schlechtesten Fall doppelt — bei TTLs von Minuten ist das
 * belanglos. Alles SCHREIBENDE (Schnappschüsse, Kalender, News) muss dagegen
 * über `server/db-claim.js` laufen.
 */

import { logWarn } from './logger.js'
import { getKnex } from './database.js'
import { beansprucheAufgabe, meldeFehler } from './db-claim.js'
import { getClosedCandles, getHistoricalCandles } from './market-data.js'
import { rsi } from './strategies/indicators.js'

const HTTP_TIMEOUT = 10000

const FEAR_GREED_URL = 'https://api.alternative.me/fng/'
const COINGECKO_GLOBAL_URL = 'https://api.coingecko.com/api/v3/global'

// key -> { ts, payload }
const cache = new Map()
// key -> Promise  (parallele Anfragen desselben Schlüssels teilen einen Abruf)
const inFlight = new Map()

/**
 * Erlaubte Ranglisten-Grössen. Bewusst nur drei Stufen: mehr Auswahl heisst
 * mehr Cache-Varianten und mehr Fremdanfragen, ohne dass jemand den
 * Unterschied zwischen „Top 60" und „Top 70" beurteilen könnte.
 */
export const TOP_N = [10, 50, 100]
const topN = (v) => (TOP_N.includes(Number(v)) ? Number(v) : 50)

/** Abruf mit Zeitgrenze. `fetch` allein kennt keinen Timeout. */
export async function holeJson(url, timeout = HTTP_TIMEOUT) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeout)
    try {
        const r = await fetch(url, {
            signal: ctrl.signal,
            headers: { 'User-Agent': 'CryptoTradingJournal', Accept: 'application/json' },
        })
        if (!r.ok) {
            const e = new Error(`HTTP ${r.status}`)
            e.status = r.status
            throw e
        }
        return await r.json()
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Zwischenspeicher mit Zeitgrenze, Mehrfachabruf-Bündelung und Altstand-Rückfall.
 *
 * @param {string} key    Cache-Schlüssel (Parameter mit hineinnehmen!)
 * @param {number} ttlMs  Wie lange ein Eintrag als frisch gilt
 * @param {Function} holen  async () => Nutzlast
 */
export async function ausCache(key, ttlMs, holen) {
    const alt = cache.get(key)
    if (alt && Date.now() - alt.ts < ttlMs) {
        // _cache wird von sendeRadar() in einen Kopf umgezogen und nie mitgesendet
        return { ...alt.payload, stand: alt.ts, veraltet: false, _cache: 'HIT' }
    }
    if (inFlight.has(key)) {
        try {
            const payload = await inFlight.get(key)
            return { ...payload, stand: cache.get(key)?.ts || Date.now(), veraltet: false, _cache: 'WAIT' }
        } catch (e) {
            // Wer sich an einen laufenden Abruf hängt, muss denselben Rückfall
            // bekommen wie der, der ihn gestartet hat. Sonst entscheidet der
            // Zufall des Zeitpunkts darüber, ob eine Kachel einen Altstand
            // zeigt oder leer bleibt.
            if (alt) {
                logWarn('marktradar', `${key}: Abruf fehlgeschlagen (mitgewartet), liefere Altstand — ${e.message}`)
                return { ...alt.payload, stand: alt.ts, veraltet: true, hinweis: e.message, _cache: 'STALE' }
            }
            throw e
        }
    }

    const p = holen().then((wert) => {
        cache.set(key, { ts: Date.now(), payload: wert })
        return wert
    })
    inFlight.set(key, p)
    try {
        const payload = await p
        return { ...payload, stand: cache.get(key).ts, veraltet: false, _cache: 'MISS' }
    } catch (e) {
        if (alt) {
            logWarn('marktradar', `${key}: Abruf fehlgeschlagen, liefere Altstand — ${e.message}`)
            return { ...alt.payload, stand: alt.ts, veraltet: true, hinweis: e.message, _cache: 'STALE' }
        }
        throw e
    } finally {
        inFlight.delete(key)
    }
}

/** Antwort senden und den Cache-Zustand in einen Kopf umziehen. */
export function sendeRadar(res, payload) {
    const { _cache, ...rest } = payload
    res.set('X-Cache', _cache || 'MISS')
    res.set('Cache-Control', 'no-store')
    res.json(rest)
}

/** Cache-Eintrag verwerfen — für „Jetzt aktualisieren". */
export function verwerfeCache(prefix) {
    for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key)
}

/** Fehlerabbildung wie in binance-api.js: der Grund soll am Statuscode ablesbar sein. */
export function sendRadarError(res, error, kontext) {
    const code = error?.status || error?.response?.status
    if (error?.name === 'AbortError' || error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') {
        return res.status(504).json({ error: `${kontext}: Zeitüberschreitung bei der Fremdquelle` })
    }
    if (code === 429 || code === 418) {
        return res.status(429).json({ error: `${kontext}: Anfragegrenze der Fremdquelle erreicht` })
    }
    logWarn('marktradar', `${kontext}: ${error?.message || error}`)
    return res.status(code && code >= 400 && code < 600 ? code : 502)
        .json({ error: `${kontext}: ${error?.message || 'Fremdquelle nicht erreichbar'}` })
}

// ── Kachel: Fear & Greed ─────────────────────────────────────────────────

/** Einordnung selbst vergeben, damit Grenzen und Beschriftung zusammenpassen. */
function fngKlasse(wert) {
    if (wert <= 24) return 'extremeFear'
    if (wert <= 44) return 'fear'
    if (wert <= 55) return 'neutral'
    if (wert <= 75) return 'greed'
    return 'extremeGreed'
}

/**
 * Historie des Stimmungsindex. Wird auch von der Kachel „Trades × Marktregime"
 * gebraucht — deshalb als eigene Funktion und über denselben Cache-Eintrag.
 */
export async function holeFearGreed(tage = 365) {
    const grenze = Math.max(2, Math.min(3000, Number(tage) || 365))
    // Der Wert wechselt einmal täglich um 00:00 UTC — 15 Minuten sind reichlich
    return ausCache(`fng|${grenze}`, 15 * 60 * 1000, async () => {
        const d = await holeJson(`${FEAR_GREED_URL}?limit=${grenze}&format=json`)
        const roh = Array.isArray(d?.data) ? d.data : []
        if (!roh.length) throw new Error('Antwort ohne Daten')

        // alternative.me liefert neueste zuerst; für Charts brauchen wir aufsteigend
        const historie = roh
            .map(e => [Number(e.timestamp) * 1000, Number(e.value)])
            .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
            .sort((a, b) => a[0] - b[0])

        const letzte = historie[historie.length - 1]
        const vorletzte = historie[historie.length - 2] || null
        const werte30 = historie.slice(-30).map(([, v]) => v)
        const alleWerte = historie.map(([, v]) => v)

        return {
            aktuell: { wert: letzte[1], klasse: fngKlasse(letzte[1]), t: letzte[0] },
            gestern: vorletzte ? { wert: vorletzte[1], t: vorletzte[0] } : null,
            mittel30: werte30.length
                ? Math.round((werte30.reduce((s, v) => s + v, 0) / werte30.length) * 10) / 10
                : null,
            tief: Math.min(...alleWerte),
            hoch: Math.max(...alleWerte),
            tage: historie.length,
            historie,
        }
    })
}

// ── Kachel: BTC-Dominanz ─────────────────────────────────────────────────

const TAG_MS = 24 * 60 * 60 * 1000
const tagesBeginn = (ms) => Math.floor(ms / TAG_MS) * TAG_MS

/** Momentaufnahme des Gesamtmarkts. CoinGecko gibt hier keine Historie heraus. */
async function holeGlobal() {
    return ausCache('global', 3 * 60 * 1000, async () => {
        const d = await holeJson(COINGECKO_GLOBAL_URL)
        const pct = Number(d?.data?.market_cap_percentage?.btc)
        const mcap = Number(d?.data?.total_market_cap?.usd)
        if (!Number.isFinite(pct)) throw new Error('Antwort ohne Dominanzwert')
        return { pct: Math.round(pct * 100) / 100, mcapUsd: Number.isFinite(mcap) ? mcap : null }
    })
}

/**
 * Tageswerte wegschreiben. Für die BTC-Dominanz gibt es keine kostenlose
 * Historie — wer sie haben will, muss sie selbst sammeln. Ein verpasster Tag
 * ist endgültig weg, deshalb läuft der Takt halbstündlich; der Anspruch sorgt
 * dafür, dass trotzdem nur zweimal am Tag wirklich geschrieben wird und nicht
 * jede Instanz für sich.
 */
async function schreibeSchnappschuss() {
    if (!(await beansprucheAufgabe('snap_global', 12 * 60 * 60 * 1000))) return
    // Nachschlag aus derselben Quelle wie die Kurve — acht Tage reichen, um
    // Lücken nach einem Ausfall zu schliessen
    try {
        const r = await holeDominanzHistorie({ tage: 8 })
        console.log(` -> Marktradar: Dominanz nachgeführt (${r.punkte} Tage)`)
    } catch (e) {
        logWarn('marktradar', `Dominanz-Nachschlag: ${e.message}`)
    }
    try {
        const g = await holeGlobal()
        const tag = tagesBeginn(Date.now())
        const knex = getKnex()
        const zeilen = [{ kind: 'btcDominanz', dayUnix: tag, value: g.pct, createdAt: Date.now() }]
        if (g.mcapUsd) zeilen.push({ kind: 'totalMcapUsd', dayUnix: tag, value: g.mcapUsd, createdAt: Date.now() })
        for (const zeile of zeilen) {
            // Letzter Wert des Tages gewinnt — er ist der aktuellere
            await knex('market_snapshots').insert(zeile)
                .onConflict(['kind', 'dayUnix']).merge(['value', 'createdAt'])
        }
        console.log(` -> Marktradar: Schnappschuss geschrieben (BTC-Dominanz ${g.pct} %)`)
    } catch (e) {
        logWarn('marktradar', `Schnappschuss fehlgeschlagen: ${e.message}`)
        await meldeFehler('snap_global', e.message)
    }
}

const CMC_HISTORIE_URL = 'https://api.coinmarketcap.com/data-api/v3/global-metrics/quotes/historical'

/**
 * Dominanz-Historie holen und in den EIGENEN Bestand schreiben.
 *
 * Frei gibt es sie sonst nirgends: CoinGecko verlangt für den
 * Gesamtmarkt-Verlauf einen Bezahltarif, Messari inzwischen eine Anmeldung,
 * und aus Einzelwerten summiert liegt sie messbar 1,3 bis 4,7 Prozentpunkte
 * daneben (nachgerechnet mit Top 20/50/100). Diese Adresse ist die interne
 * Schnittstelle der CoinMarketCap-Webseite: undokumentiert, ohne Schlüssel,
 * jederzeit abschaltbar — der Nutzer hat sie in Kenntnis dessen gewählt.
 *
 * Deshalb wird sie EINMAL vollständig abgeholt und dauerhaft eingelagert.
 * Fällt die Quelle weg, verlieren wir nur den Nachschub, nicht den Bestand.
 *
 * Wichtig, und der Grund für eigene `kind`-Schlüssel: CoinMarketCap zählt
 * anders als CoinGecko — am 16.08.2026 standen 58,37 % gegen 56,16 %. Beide
 * Reihen in einen Topf zu werfen ergäbe an der Nahtstelle einen Sprung von
 * zwei Punkten, der wie ein Marktereignis aussähe. Eine Kurve, eine Quelle.
 */
async function holeDominanzHistorie({ tage = 8 } = {}) {
    const ende = Math.floor(Date.now() / 1000)
    const start = ende - Math.max(2, tage) * 24 * 60 * 60
    const roh = await holeJson(
        `${CMC_HISTORIE_URL}?format=chart_crypto_details&interval=1d&timeEnd=${ende}&timeStart=${start}`,
        20000)
    const punkte = roh?.data?.quotes
    if (!Array.isArray(punkte) || !punkte.length) throw new Error('Antwort ohne Punkte')

    const knex = getKnex()
    const zeilen = []
    for (const p of punkte) {
        const t = Date.parse(p.timestamp)
        if (!Number.isFinite(t)) continue
        const tag = tagesBeginn(t)
        const btc = Number(p.btcDominance)
        const eth = Number(p.ethDominance)
        const mcap = Number(p.quote?.[0]?.totalMarketCap ?? p.quote?.[0]?.marketCap)
        if (Number.isFinite(btc)) zeilen.push({ kind: 'domBtc', dayUnix: tag, value: btc, createdAt: Date.now() })
        if (Number.isFinite(eth)) zeilen.push({ kind: 'domEth', dayUnix: tag, value: eth, createdAt: Date.now() })
        if (Number.isFinite(mcap)) zeilen.push({ kind: 'domMcap', dayUnix: tag, value: mcap, createdAt: Date.now() })
    }
    if (!zeilen.length) throw new Error('keine verwertbaren Punkte')

    for (let i = 0; i < zeilen.length; i += 200) {
        await knex('market_snapshots').insert(zeilen.slice(i, i + 200))
            .onConflict(['kind', 'dayUnix']).merge(['value', 'createdAt'])
    }
    return { punkte: punkte.length, zeilen: zeilen.length }
}

/**
 * Einmaliger Rückblick beim Start: sechs Jahre am Stück. Danach genügt der
 * tägliche Nachschlag, weil der Bestand bei uns liegt.
 */
export async function holeDominanzRueckblick() {
    if (!(await beansprucheAufgabe('dominanz_rueckblick', 30 * 24 * 60 * 60 * 1000))) {
        return { uebersprungen: true }
    }
    const r = await holeDominanzHistorie({ tage: 6 * 365 })
    console.log(` -> Marktradar: Dominanz-Rückblick eingelagert (${r.punkte} Tage)`)
    return r
}

async function holeDominanz() {
    let historie = []
    let ethReihe = []
    let quelle = 'coinmarketcap'
    try {
        const knex = getKnex()
        const btc = await knex('market_snapshots')
            .where('kind', 'domBtc').orderBy('dayUnix', 'asc').select('dayUnix', 'value')
        const eth = await knex('market_snapshots')
            .where('kind', 'domEth').orderBy('dayUnix', 'asc').select('dayUnix', 'value')
        historie = btc.map(z => [Number(z.dayUnix), Number(z.value)])
        ethReihe = eth.map(z => [Number(z.dayUnix), Number(z.value)])
    } catch (e) {
        logWarn('marktradar', `Dominanz-Historie nicht lesbar: ${e.message}`)
    }

    // Der aktuelle Wert kommt aus derselben Reihe wie die Kurve, sonst passen
    // Zahl und Kurvenende nicht zusammen. CoinGecko bleibt als Rückfall.
    let jetzt
    const letzterEigen = historie[historie.length - 1]
    if (letzterEigen && Date.now() - letzterEigen[0] < 3 * TAG_MS) {
        const mcapZeile = await getKnex()('market_snapshots')
            .where('kind', 'domMcap').orderBy('dayUnix', 'desc').first().catch(() => null)
        jetzt = {
            pct: Math.round(letzterEigen[1] * 100) / 100,
            mcapUsd: mcapZeile ? Number(mcapZeile.value) : null,
            stand: letzterEigen[0],
        }
    } else {
        jetzt = await holeGlobal()
        quelle = 'coingecko'
    }

    // Δ 7 Tage nur, wenn ein Wert von vor mindestens 7 Tagen vorliegt — sonst
    // wäre es eine Zahl, die etwas anderes behauptet, als sie misst.
    const sieben = tagesBeginn(Date.now()) - 7 * TAG_MS
    const alt = [...historie].reverse().find(([t]) => t <= sieben)
    return {
        stand: jetzt.stand,
        veraltet: jetzt.veraltet,
        hinweis: jetzt.hinweis,
        _cache: jetzt._cache,
        jetzt: { pct: jetzt.pct, mcapUsd: jetzt.mcapUsd, t: jetzt.stand },
        delta7: alt ? Math.round((jetzt.pct - alt[1]) * 100) / 100 : null,
        historie,
        // Ethereum und „Rest" daneben: erst die drei zusammen zeigen, wohin
        // das Geld wandert. Steigt BTC, während der Rest fällt, ist es eine
        // Flucht in Bitcoin — steigen beide, kommt frisches Geld herein.
        ethHistorie: ethReihe,
        eth: ethReihe.length ? Math.round(ethReihe[ethReihe.length - 1][1] * 100) / 100 : null,
        quelle,
        tage: historie.length,
        seit: historie.length ? historie[0][0] : null,
    }
}

// ── Kachel: Funding-Raten ────────────────────────────────────────────────

const FAPI = 'https://fapi.binance.com'

/**
 * Nur echte Kryptowährungen.
 *
 * Binance führt auf denselben USDⓈ-M-Perpetuals längst auch tokenisierte
 * AKTIEN und Rohstoffe: von 693 USDT-Märkten sind 529 `COIN`, aber 132
 * `EQUITY` (SNXX, KORU, SNDK …), dazu 8 Rohstoffe, 20 asiatische Aktien,
 * 2 Vor-Börsengang-Kontrakte und 2 Indizes (BTCDOM). Ohne diesen Filter
 * standen in der Funding-Rangliste und im RSI-Bild Aktien statt Coins.
 */
export async function nurCoinSymbole() {
    const { menge } = await ausCache('coinSymbole', 12 * 60 * 60 * 1000, async () => {
        const info = await holeJson(`${FAPI}/fapi/v1/exchangeInfo`, 20000)
        const liste = (info?.symbols || [])
            .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT' && s.underlyingType === 'COIN')
            .map(s => s.symbol)
        if (!liste.length) throw new Error('exchangeInfo ohne Coin-Märkte')
        return { menge: liste }
    })
    return new Set(menge)
}

/**
 * 24h-Umsätze aller Perps. Nur zum Aussortieren illiquider Märkte gedacht —
 * ohne den Filter führen Exoten mit drei Kontrakten jede Funding-Rangliste an.
 * Eigene, längere Zeitgrenze: die Rangfolge nach Volumen bewegt sich kaum, der
 * Abruf kostet aber Binance-Gewicht 40.
 */
async function holeVolumen() {
    const coins = await nurCoinSymbole()
    return ausCache('vol24', 10 * 60 * 1000, async () => {
        const roh = await holeJson(`${FAPI}/fapi/v1/ticker/24hr`)
        const map = {}
        // Aktien und Rohstoffe fallen hier schon raus, damit sie in keiner
        // Rangliste und keiner Symbolauswahl mehr auftauchen können
        for (const t of roh) if (coins.has(t.symbol)) map[t.symbol] = Number(t.quoteVolume) || 0
        return { map }
    })
}

/**
 * Funding über die N umsatzstärksten Coin-Märkte.
 *
 * Die Auswahl läuft über eine Rangliste statt über eine Umsatzschwelle: „Top 50"
 * ist eine Aussage, die jeder sofort versteht, „ab 20 Mio. USD" nicht — und die
 * Zahl der Märkte hinter einer festen Schwelle schwankt mit der Marktlage.
 */
async function holeFunding(anzahl = 50) {
    const n = topN(anzahl)
    const meine = await eigeneSymbole().catch(() => [])
    return ausCache(`funding|${n}|${meine.join(',')}`, 60 * 1000, async () => {
        // premiumIndex ohne Symbol liefert ALLE Perps in einem Abruf (Gewicht 10)
        const [roh, vol] = await Promise.all([
            holeJson(`${FAPI}/fapi/v1/premiumIndex`),
            holeVolumen().catch(() => ({ map: {} })),
        ])

        // Nur Coin-Märkte (vol.map ist bereits gefiltert) und davon die N
        // umsatzstärksten
        const rangliste = new Set(Object.entries(vol.map)
            .sort((a, b) => b[1] - a[1]).slice(0, n).map(([s]) => s))

        const alleZeilen = roh
            .filter(r => vol.map[r.symbol] !== undefined)
            .map(r => ({
                symbol: r.symbol,
                rate: Number(r.lastFundingRate),
                naechsteZahlung: Number(r.nextFundingTime) || null,
                markPreis: Number(r.markPrice) || null,
                volumen24h: vol.map[r.symbol] || 0,
            }))
            .filter(r => Number.isFinite(r.rate))
            // Binance zahlt dreimal täglich — hochgerechnet auf ein Jahr wird
            // aus einer unscheinbaren Zahl eine begreifbare Grösse
            .map(r => ({ ...r, jahresRate: r.rate * 3 * 365 }))
            .sort((a, b) => b.rate - a.rate)

        // Die Extreme des Gesamtmarkts sitzen fast immer in Mikro-Werten, die
        // niemand handelt. Deshalb stehen VORNE die eigenen Märkte; die
        // Rangliste ist der zweite Blick.
        const zeilen = alleZeilen.filter(r => rangliste.has(r.symbol))
        const nachSymbol = new Map(alleZeilen.map(r => [r.symbol, r]))

        return {
            eigene: meine.map(s => nachSymbol.get(s)).filter(Boolean),
            oben: zeilen.slice(0, 8),
            unten: zeilen.slice(-8).reverse(),
            alle: zeilen,
            gezaehlt: zeilen.length,
            n,
        }
    })
}

// ── Kachel: Long/Short-Verhältnis + Open Interest ────────────────────────

const SYMBOL_RE = /^[A-Z0-9]{2,20}$/

async function holeLsOi(symbol, stunden = 48) {
    const sym = String(symbol || 'BTCUSDT').toUpperCase()
    if (!SYMBOL_RE.test(sym)) throw new Error('Ungültiges Symbol')
    const limit = Math.max(6, Math.min(200, Number(stunden) || 48))

    return ausCache(`lsoi|${sym}|${limit}`, 5 * 60 * 1000, async () => {
        const [ls, oi, kerzen] = await Promise.all([
            holeJson(`${FAPI}/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=1h&limit=${limit}`),
            holeJson(`${FAPI}/futures/data/openInterestHist?symbol=${sym}&period=1h&limit=${limit}`),
            // Preisänderung aus denselben Stundenkerzen, die auch die Engine nutzt
            getClosedCandles(sym, '1h', 25).catch(() => []),
        ])
        if (!Array.isArray(ls) || !ls.length) {
            // Kein Serverfehler, sondern ein Symbol ohne Perp-Markt — 404 sagt das
            const e = new Error(`Für ${sym} gibt es keine Kontenquote`)
            e.status = 404
            throw e
        }

        const oiNach = {}
        for (const o of oi || []) oiNach[Number(o.timestamp)] = Number(o.sumOpenInterest)

        const punkte = ls.map(r => ({
            t: Number(r.timestamp),
            ratio: Number(r.longShortRatio),
            longPct: Math.round(Number(r.longAccount) * 1000) / 10,
            shortPct: Math.round(Number(r.shortAccount) * 1000) / 10,
            oi: oiNach[Number(r.timestamp)] ?? null,
        }))

        const mitOi = punkte.filter(p => p.oi !== null)
        const oiJetzt = mitOi.length ? mitOi[mitOi.length - 1].oi : null
        const oiVor24 = mitOi.length > 24 ? mitOi[mitOi.length - 25].oi : (mitOi[0]?.oi ?? null)
        const oiDelta = oiJetzt && oiVor24 ? ((oiJetzt - oiVor24) / oiVor24) * 100 : null

        const preisJetzt = kerzen.length ? kerzen[kerzen.length - 1].c : null
        const preisVor24 = kerzen.length ? kerzen[0].c : null
        const preisDelta = preisJetzt && preisVor24 ? ((preisJetzt - preisVor24) / preisVor24) * 100 : null

        // Dieselbe Vier-Felder-Lesart wie auf der Open-Interest-Seite; die
        // Übersetzungen (oi.read_*) werden im Frontend wiederverwendet.
        let deutung = 'neutral'
        if (oiDelta !== null && preisDelta !== null) {
            if (oiDelta > 1 && preisDelta > 0.3) deutung = 'longAufbau'
            else if (oiDelta > 1 && preisDelta < -0.3) deutung = 'shortAufbau'
            else if (oiDelta < -1 && preisDelta > 0.3) deutung = 'shortDeckung'
            else if (oiDelta < -1 && preisDelta < -0.3) deutung = 'longAufloesung'
        }

        return {
            symbol: sym,
            punkte,
            jetzt: {
                ratio: punkte[punkte.length - 1]?.ratio ?? null,
                longPct: punkte[punkte.length - 1]?.longPct ?? null,
                shortPct: punkte[punkte.length - 1]?.shortPct ?? null,
                oi: oiJetzt,
                oiDelta24hPct: oiDelta === null ? null : Math.round(oiDelta * 100) / 100,
                preisDelta24hPct: preisDelta === null ? null : Math.round(preisDelta * 100) / 100,
                deutung,
            },
        }
    })
}

// ── Kachel: RSI-Heatmap ──────────────────────────────────────────────────

const RSI_TFS_ERLAUBT = ['15m', '1h', '4h', '1d', '1w']
const RSI_FALLBACK = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT']
const RSI_MAX_SYMBOLE = 60

/**
 * Welche Märkte interessieren DICH? Die Vorgabe kommt nicht aus einer
 * Bestenliste, sondern aus den eigenen Trades der letzten 90 Tage — RSI-Heatmap
 * und Funding-Liste zeigen damit die Märkte, in denen wirklich Geld unterwegs
 * ist. Eine eingetragene Liste in den Einstellungen sticht die Ableitung.
 */
async function eigeneSymbole() {
    const knex = getKnex()
    const s = await knex('settings').where('id', 1).first().catch(() => null)

    const eigene = String(s?.radarRsiSymbols || '').split(/[,\s]+/)
        .map(x => x.trim().toUpperCase()).filter(x => SYMBOL_RE.test(x))
    if (eigene.length) return eigene.slice(0, RSI_MAX_SYMBOLE)

    const seit = Math.floor((Date.now() - 90 * TAG_MS) / 1000)
    const zaehler = new Map()
    try {
        const zeilen = await knex('trades').where('dateUnix', '>=', seit).select('trades')
        for (const z of zeilen) {
            let arr = []
            try { arr = JSON.parse(z.trades || '[]') } catch { continue }
            for (const t of arr) {
                const sym = String(t.symbol || '').toUpperCase()
                if (!SYMBOL_RE.test(sym) || !sym.endsWith('USDT')) continue
                zaehler.set(sym, (zaehler.get(sym) || 0) + 1)
            }
        }
    } catch (e) {
        logWarn('marktradar', `RSI-Symbole aus Trades nicht lesbar: ${e.message}`)
    }

    const ausTrades = [...zaehler.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s)
    // Mit den grossen Märkten auffüllen, damit die Heatmap nie fast leer ist
    const liste = [...ausTrades]
    for (const s2 of RSI_FALLBACK) if (!liste.includes(s2) && liste.length < 8) liste.push(s2)
    return liste.slice(0, RSI_MAX_SYMBOLE)
}

/** Die umsatzstärksten Coin-Perps — die Märkte, in denen etwas passiert. */
async function topSymbole(n = 50) {
    const { map } = await holeVolumen()
    return Object.entries(map)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN(n))
        .map(([s]) => s)
}

/**
 * RSI-Verteilung über viele Märkte in EINER Zeiteinheit.
 *
 * Bewusst ein Streubild statt einer Matrix: die interessante Frage ist nicht
 * „welchen RSI hat Coin X", sondern „steht der ganze Markt oben oder unten und
 * wer schert aus". Dafür braucht es viele Punkte auf einer Skala, nicht viele
 * Zeilen mit Zahlen.
 *
 * @param {string} tf      Zeiteinheit
 * @param {string} quelle  'top' (Umsatz-Rangliste) | 'eigene' (eigene Trades) | 'liste'
 */
async function holeRsi(tf = '1h', quelle = 'top', anzahl = 50) {
    const n = topN(anzahl)
    const zeiteinheit = RSI_TFS_ERLAUBT.includes(String(tf)) ? String(tf) : '1h'
    const knex = getKnex()
    const s = await knex('settings').where('id', 1).first().catch(() => null)
    const eigeneListe = String(s?.radarRsiSymbols || '').trim()

    let art = ['top', 'eigene', 'liste'].includes(quelle) ? quelle : 'top'
    // Eine eingetragene Liste ist eine bewusste Entscheidung — sie gewinnt
    if (art === 'liste' && !eigeneListe) art = 'top'

    const symbole = art === 'liste' || (art === 'eigene' && eigeneListe)
        ? await eigeneSymbole()
        : art === 'eigene' ? await eigeneSymbole() : await topSymbole(n)

    return ausCache(`rsi|${zeiteinheit}|${art}|${n}|${symbole.join(',')}`, 60 * 1000, async () => {
        const { map: volumen } = await holeVolumen().catch(() => ({ map: {} }))
        const punkte = []
        const fehlend = []

        // In Häppchen, damit ein totes Symbol nicht den ganzen Abruf aufhält
        for (let i = 0; i < symbole.length; i += 5) {
            if (i) await new Promise(r => setTimeout(r, 120))
            const teil = symbole.slice(i, i + 5)
            await Promise.all(teil.map(async (symbol) => {
                try {
                    const kerzen = await getClosedCandles(symbol, zeiteinheit, 100)
                    const reihe = rsi(kerzen, 14)
                    const wert = reihe[reihe.length - 1]
                    if (!Number.isFinite(wert)) { fehlend.push(symbol); return }
                    punkte.push({
                        symbol,
                        rsi: Math.round(wert * 10) / 10,
                        volumen24h: volumen[symbol] || 0,
                    })
                } catch {
                    fehlend.push(symbol)
                }
            }))
        }

        // Wenn die Hälfte fehlt, ist das Bild wertlos — dann lieber der
        // Altstand mit Hinweis als eine Wolke aus drei Punkten
        if (punkte.length < symbole.length * 0.5) {
            throw new Error(`nur ${punkte.length} von ${symbole.length} Märkten abrufbar`)
        }

        // Nach Umsatz sortiert: links die grossen Märkte, rechts die kleinen
        punkte.sort((a, b) => b.volumen24h - a.volumen24h)
        const schnitt = punkte.length
            ? Math.round((punkte.reduce((sum, p) => sum + p.rsi, 0) / punkte.length) * 100) / 100
            : null

        return {
            tf: zeiteinheit,
            quelle: art,
            punkte,
            fehlend,
            schnitt,
            gezaehlt: punkte.length,
            n,
            hatEigeneListe: Boolean(eigeneListe),
        }
    })
}

// ── Kachel: Liquidationen 24 h ───────────────────────────────────────────

const stundenBeginn = (ms) => Math.floor(ms / 3600000) * 3600000

/**
 * Zusammenfassung aus der EIGENEN Aufzeichnung — keine Fremdquelle.
 *
 * Für aggregierte Liquidationen gibt es nichts Brauchbares umsonst (Coinglass
 * kostet, Binance gibt sie nicht rückwirkend heraus). Der Recorder schreibt sie
 * ohnehin mit, 365 Tage lang. Ist er aus, sagt die Kachel das — statt „0
 * Liquidationen" zu behaupten, was etwas völlig anderes bedeutet.
 *
 * ACHTUNG bei der Seite: `seite = 1` heisst, die Börse hat GEKAUFT, also wurde
 * ein SHORT glattgestellt. Wer das dreht, färbt die ganze Kachel falsch.
 */
async function holeLiquidationen(stunden = 24) {
    const h = Math.max(1, Math.min(72, Number(stunden) || 24))
    return ausCache(`liq|${h}`, 60 * 1000, async () => {
        const { promisify } = await import('util')
        const zlib = await import('zlib')
        const gunzip = promisify(zlib.gunzip)

        const knex = getKnex()
        const s = await knex('settings').where('id', 1).first().catch(() => null)
        const von = Date.now() - h * 3600000

        const zeilen = await knex('live_recordings')
            .where('kind', 'liq')
            .andWhere('hourStart', '>=', stundenBeginn(von))
            .orderBy('hourStart')

        const jeSymbol = new Map()
        const jeStunde = new Map()
        const groesste = []
        let longUsd = 0, shortUsd = 0, anzahl = 0
        let frueheste = null

        for (const zeile of zeilen) {
            if (!zeile.payload) continue
            let roh
            try {
                roh = JSON.parse((await gunzip(zeile.payload)).toString('utf8'))
            } catch (e) {
                logWarn('marktradar', `Liq-Zeile ${zeile.symbol}/${zeile.hourStart} unlesbar: ${e.message}`)
                continue
            }
            for (const [t, preis, menge, seite] of roh) {
                if (t < von) continue
                const usd = preis * menge
                if (!Number.isFinite(usd)) continue
                // seite 1 = Kauf der Börse = Short wurde liquidiert
                const istShort = seite === 1
                anzahl++
                if (istShort) shortUsd += usd; else longUsd += usd
                if (frueheste === null || t < frueheste) frueheste = t

                const sym = jeSymbol.get(zeile.symbol) || { symbol: zeile.symbol, longUsd: 0, shortUsd: 0, anzahl: 0 }
                sym[istShort ? 'shortUsd' : 'longUsd'] += usd
                sym.anzahl++
                jeSymbol.set(zeile.symbol, sym)

                const stunde = stundenBeginn(t)
                const st = jeStunde.get(stunde) || { t: stunde, longUsd: 0, shortUsd: 0 }
                st[istShort ? 'shortUsd' : 'longUsd'] += usd
                jeStunde.set(stunde, st)

                groesste.push({ t, symbol: zeile.symbol, usd, seite: istShort ? 'short' : 'long' })
            }
        }

        groesste.sort((a, b) => b.usd - a.usd)

        return {
            // Aufzeichnung gilt als aktiv, wenn der Sammelstrom läuft ODER
            // tatsächlich Daten im Fenster liegen
            aktiv: Number(s?.liveRecordAllLiq) === 1 || anzahl > 0,
            stunden: h,
            seit: frueheste,
            symbole: [...jeSymbol.values()].sort((a, b) => (b.longUsd + b.shortUsd) - (a.longUsd + a.shortUsd)),
            verlauf: [...jeStunde.values()].sort((a, b) => a.t - b.t),
            groesste: groesste.slice(0, 10),
            gesamt: { longUsd, shortUsd, anzahl },
        }
    })
}

// ── Kachel: Deine Trades × Marktregime ───────────────────────────────────

/** Grenzen von alternative.me selbst — damit sie nicht erfunden sind. */
const REGIME_BUCKETS = [
    { id: 'extremeFear', von: 0, bis: 24 },
    { id: 'fear', von: 25, bis: 44 },
    { id: 'neutral', von: 45, bis: 55 },
    { id: 'greed', von: 56, bis: 75 },
    { id: 'extremeGreed', von: 76, bis: 100 },
]

/**
 * Kreuzt die eigenen Trades mit der Stimmungslage am Handelstag.
 *
 * Serverseitig gerechnet, aus zwei Gründen: die Fear-&-Greed-Historie liegt
 * hier ohnehin im Zwischenspeicher, und die Kachel soll ALLE Trades auswerten —
 * nicht die durch die Seitenleiste gefilterte Journal-Sicht.
 *
 * Bot-Trades bleiben draussen: sie laufen nach eigener Mechanik weiter,
 * unabhängig davon, wie der Markt gestimmt ist.
 */
async function holeRegime(tage = 365) {
    const t = Math.max(30, Math.min(3000, Number(tage) || 365))
    const fng = await holeFearGreed(t + 10)

    return ausCache(`regime|${t}`, 5 * 60 * 1000, async () => {
        // Stimmungswert je UTC-Tag nachschlagbar machen
        const proTag = new Map()
        for (const [ts, wert] of fng.historie) proTag.set(tagesBeginn(ts), wert)

        const seit = Math.floor((Date.now() - t * TAG_MS) / 1000)
        const zeilen = await getKnex()('trades').where('dateUnix', '>=', seit).select('dateUnix', 'trades')

        const eimer = new Map(REGIME_BUCKETS.map(b => [b.id, {
            id: b.id, von: b.von, bis: b.bis,
            anzahl: 0, gewinne: 0, summe: 0, gewinnSumme: 0, verlustSumme: 0, longs: 0,
        }]))
        const punkte = []
        let ohneFng = 0, gesamtAnzahl = 0

        for (const zeile of zeilen) {
            let arr = []
            try { arr = JSON.parse(zeile.trades || '[]') } catch { continue }
            for (const tr of arr) {
                if (tr.botType) continue
                const pnl = Number(tr.netProceeds)
                if (!Number.isFinite(pnl)) continue
                gesamtAnzahl++

                // entryTime steht in SEKUNDEN (nicht ms) — Rückfall auf den Tag der Zeile
                const ms = tr.entryTime ? Number(tr.entryTime) * 1000 : Number(zeile.dateUnix) * 1000
                const wert = proTag.get(tagesBeginn(ms))
                if (wert === undefined) { ohneFng++; continue }

                const b = REGIME_BUCKETS.find(x => wert >= x.von && wert <= x.bis) || REGIME_BUCKETS[2]
                const e = eimer.get(b.id)
                e.anzahl++
                e.summe += pnl
                if (pnl > 0) { e.gewinne++; e.gewinnSumme += pnl } else { e.verlustSumme += Math.abs(pnl) }
                if (String(tr.strategy || '').toLowerCase() === 'long') e.longs++

                punkte.push([wert, Math.round(pnl * 100) / 100, tr.strategy === 'long' ? 1 : 0])
            }
        }

        const buckets = [...eimer.values()].map(e => ({
            id: e.id, von: e.von, bis: e.bis, anzahl: e.anzahl,
            trefferquote: e.anzahl ? Math.round((e.gewinne / e.anzahl) * 1000) / 10 : null,
            summe: Math.round(e.summe * 100) / 100,
            schnitt: e.anzahl ? Math.round((e.summe / e.anzahl) * 100) / 100 : null,
            // Kein Verlust heisst nicht „unendlich gut" — dann lieber null
            profitfaktor: e.verlustSumme > 0 ? Math.round((e.gewinnSumme / e.verlustSumme) * 100) / 100 : null,
            longAnteil: e.anzahl ? Math.round((e.longs / e.anzahl) * 1000) / 10 : null,
        }))

        const mitTrades = buckets.filter(b => b.anzahl > 0)
        const beste = mitTrades.length
            ? mitTrades.reduce((a, b) => (b.summe > a.summe ? b : a))
            : null

        return {
            tage: t,
            buckets,
            punkte,
            beste: beste?.id || null,
            gesamt: { anzahl: gesamtAnzahl, bewertet: punkte.length, ohneFng },
        }
    })
}

// ── Kachel: Regenbogen-Chart ─────────────────────────────────────────────

const BTC_HISTORIE_URL = 'https://api.blockchain.info/charts/market-price?timespan=all&format=json&sampled=true'
const GENESIS = Date.UTC(2009, 0, 3)   // Bitcoins erster Block
const TAG = 24 * 60 * 60 * 1000

/**
 * Bänder des Regenbogen-Charts. Die Namen sind bewusst salopp — das Ding ist
 * eine Kurvenanpassung an die Vergangenheit, keine Prognose, und soll auch so
 * klingen. `k` ist der Abstand in Standardabweichungen der Regression.
 */
const RAINBOW_BAENDER = [
    { k: 2.0, key: 'blase', farbe: '#c0392b' },
    { k: 1.5, key: 'verkaufen', farbe: '#e05c2a' },
    { k: 1.0, key: 'fomo', farbe: '#e8a33d' },
    { k: 0.5, key: 'teuer', farbe: '#e3d04a' },
    { k: 0.0, key: 'fair', farbe: '#a9c94f' },
    { k: -0.5, key: 'guenstig', farbe: '#57b76a' },
    { k: -1.0, key: 'kaufen', farbe: '#3aa8a0' },
    { k: -1.5, key: 'ausverkauf', farbe: '#3b7fbd' },
    { k: -2.0, key: 'grund', farbe: '#3a4fa0' },
]

/** Statische Rückfallreihe aus dem Repo — falls die Fremdquelle ausfällt. */
async function statischeBtcReihe() {
    const { readFile } = await import('fs/promises')
    const pfad = new URL('./data/btc-monatskurse.json', import.meta.url)
    const roh = JSON.parse(await readFile(pfad, 'utf8'))
    return roh.werte.map(([t, p]) => ({ t, p }))
}

/**
 * Logarithmische Regression über die gesamte Kurshistorie:
 *   ln(Preis) ≈ a · ln(Tage seit Genesis) + b
 * Zurückgegeben werden auch Reststreuung und Stützpunktzahl, damit die
 * Kurve nachrechenbar ist statt geglaubt werden zu müssen.
 */
function regression(punkte) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0
    for (const v of punkte) {
        const x = Math.log((v.t - GENESIS) / TAG)
        const y = Math.log(v.p)
        sx += x; sy += y; sxx += x * x; sxy += x * y
    }
    const n = punkte.length
    const a = (n * sxy - sx * sy) / (n * sxx - sx * sx)
    const b = (sy - a * sx) / n
    let ss = 0
    for (const v of punkte) {
        const x = Math.log((v.t - GENESIS) / TAG)
        ss += Math.pow(Math.log(v.p) - (a * x + b), 2)
    }
    return { a, b, s: Math.sqrt(ss / Math.max(1, n - 2)), n }
}

async function holeRainbow() {
    return ausCache('rainbow', 12 * 60 * 60 * 1000, async () => {
        let punkte = []
        let quelle = 'blockchain.info'
        try {
            const d = await holeJson(BTC_HISTORIE_URL, 20000)
            punkte = (d?.values || []).map(v => ({ t: v.x * 1000, p: v.y })).filter(v => v.p > 0)
        } catch (e) {
            logWarn('marktradar', `BTC-Historie nicht abrufbar, nutze statische Reihe: ${e.message}`)
        }
        if (punkte.length < 100) {
            punkte = await statischeBtcReihe()
            quelle = 'statische Reihe im Repo'
        }

        // Jüngeres Ende mit Binance-Wochenkerzen auffrischen: die Fremdreihe
        // ist grob abgetastet und hinkt bis zu einer Woche hinterher.
        try {
            const seit = punkte[punkte.length - 1].t - 30 * TAG
            const kerzen = await getHistoricalCandles('BTCUSDT', '1w', seit, Date.now(), { market: 'spot' })
            const alt = punkte.filter(v => v.t < seit)
            punkte = [...alt, ...kerzen.map(k => ({ t: k.t, p: k.c }))]
        } catch (e) {
            logWarn('marktradar', `Binance-Wochenkerzen für den Regenbogen fehlen: ${e.message}`)
        }

        // Die ersten Monate sind wertlos: Kurse nahe null verzerren die
        // Regression stark, gehandelt wurde damals praktisch nicht.
        const gefiltert = punkte.filter(v => v.t >= GENESIS + 180 * TAG)
        const reg = regression(gefiltert)

        const jetzt = gefiltert[gefiltert.length - 1]
        const bandWert = (k, t) => Math.exp(reg.a * Math.log((t - GENESIS) / TAG) + reg.b + k * reg.s)
        // In welchem Band steht der Kurs gerade?
        const heutige = RAINBOW_BAENDER.map(b => ({ ...b, wert: bandWert(b.k, jetzt.t) }))
        const aktuell = heutige.find(b => jetzt.p >= b.wert) || heutige[heutige.length - 1]

        return {
            punkte: gefiltert.map(v => [v.t, Math.round(v.p * 100) / 100]),
            baender: RAINBOW_BAENDER,
            regression: { a: reg.a, b: reg.b, s: reg.s, n: reg.n },
            genesis: GENESIS,
            jetzt: { t: jetzt.t, preis: jetzt.p, band: aktuell.key },
            quelle,
        }
    })
}

// ── Kachel: Pi-Cycle-Top ─────────────────────────────────────────────────

const BTC_TAGES_URL = 'https://api.blockchain.info/charts/market-price?timespan=all&format=json&sampled=false'

/** Gleitender Durchschnitt; die ersten `n-1` Stellen bleiben leer. */
function gleitend(werte, n) {
    const out = new Array(werte.length).fill(null)
    let summe = 0
    for (let i = 0; i < werte.length; i++) {
        summe += werte[i]
        if (i >= n) summe -= werte[i - n]
        if (i >= n - 1) out[i] = summe / n
    }
    return out
}

/**
 * Pi-Cycle-Top: 111-Tage-Linie gegen die verdoppelte 350-Tage-Linie.
 *
 * Kreuzt die kurze Linie die lange von unten, war das bisher in jedem Zyklus
 * nahe am Hoch (2013, 2017, 2021). Was das Modell NICHT ist: eine Vorhersage.
 * Es sind drei Treffer bei drei Gelegenheiten — statistisch nichts, wovon man
 * eine Regel ableiten kann. Der Name kommt daher, dass 350/111 ≈ π ist; auch
 * das ist Zahlenmystik und kein Mechanismus.
 */
async function holePiCycle() {
    return ausCache('picycle', 12 * 60 * 60 * 1000, async () => {
        let reihe = []
        let quelle = 'blockchain.info'
        try {
            const d = await holeJson(BTC_TAGES_URL, 25000)
            reihe = (d?.values || []).map(v => ({ t: v.x * 1000, p: v.y })).filter(v => v.p > 0)
        } catch (e) {
            logWarn('marktradar', `Pi-Cycle: Tagesreihe nicht abrufbar — ${e.message}`)
        }
        if (reihe.length < 800) {
            // Ohne die lange Historie ist die 350-Tage-Linie wertlos
            const kerzen = await getClosedCandles('BTCUSDT', '1d', 1000, { market: 'spot' })
            reihe = kerzen.map(k => ({ t: k.t, p: k.c }))
            quelle = 'Binance (verkürzt)'
        }

        // Jüngstes Ende auffrischen: die Fremdreihe endet je nach Abruf ein bis
        // zwei Tage in der Vergangenheit
        try {
            const kerzen = await getClosedCandles('BTCUSDT', '1d', 10, { market: 'spot' })
            const letzterFremd = reihe[reihe.length - 1].t
            for (const k of kerzen) if (k.t > letzterFremd) reihe.push({ t: k.t, p: k.c })
        } catch { /* ohne die letzten Tage geht es auch */ }

        const preise = reihe.map(r => r.p)
        const ma111 = gleitend(preise, 111)
        const ma350x2 = gleitend(preise, 350).map(v => (v === null ? null : v * 2))

        // Kreuzungen von unten nach oben suchen
        const kreuzungen = []
        for (let i = 1; i < reihe.length; i++) {
            if (ma111[i] === null || ma350x2[i] === null || ma111[i - 1] === null || ma350x2[i - 1] === null) continue
            if (ma111[i - 1] <= ma350x2[i - 1] && ma111[i] > ma350x2[i]) {
                kreuzungen.push({ t: reihe[i].t, preis: Math.round(reihe[i].p) })
            }
        }

        const i = reihe.length - 1
        const kurz = ma111[i], lang = ma350x2[i]
        const letzte = kreuzungen[kreuzungen.length - 1] || null

        // Kreuzungen dauerhaft festhalten: sie sind das Ereignis, auf das diese
        // Kachel wartet, und dürfen nicht davon abhängen, ob gerade jemand die
        // Seite offen hatte. `unique(kind, dayUnix)` macht das Schreiben
        // wiederholbar, der Anspruch verhindert doppelte Läufe.
        if (letzte && await beansprucheAufgabe('picycle_kreuzung', 6 * 60 * 60 * 1000)) {
            try {
                await getKnex()('market_snapshots').insert({
                    kind: 'picycleCross',
                    dayUnix: tagesBeginn(letzte.t),
                    value: letzte.preis,
                    createdAt: Date.now(),
                }).onConflict(['kind', 'dayUnix']).ignore()
            } catch (e) {
                logWarn('marktradar', `Pi-Cycle-Kreuzung nicht gespeichert: ${e.message}`)
            }
        }

        return {
            punkte: reihe.map((r, j) => [r.t, Math.round(r.p * 100) / 100, ma111[j], ma350x2[j]]),
            kreuzungen,
            letzteKreuzung: letzte,
            // „Frisch" heisst: in den letzten 30 Tagen. Danach ist es Geschichte
            // und kein Alarm mehr wert.
            frisch: Boolean(letzte && Date.now() - letzte.t < 30 * TAG_MS),
            jetzt: {
                preis: reihe[i].p,
                ma111: kurz,
                ma350x2: lang,
                // Wie weit ist die kurze Linie noch unter der langen?
                abstandPct: kurz && lang ? Math.round(((kurz / lang) - 1) * 1000) / 10 : null,
                ausgeloest: Boolean(kurz && lang && kurz > lang),
            },
            quelle,
        }
    })
}

// ── Kachel: Altcoin-Season-Index ─────────────────────────────────────────

/**
 * Wie viele der grössten Altcoins haben Bitcoin über das Zeitfenster
 * geschlagen? Über 75 % gilt als „Altcoin-Saison", unter 25 % als
 * „Bitcoin-Saison" — die Schwellen stammen vom ursprünglichen Index.
 *
 * Gerechnet wird aus Binance-Tageskerzen statt aus einer Fremd-Kennzahl: so
 * ist nachvollziehbar, WELCHE Coins die Aussage tragen, und die Auswahl folgt
 * derselben Krypto-Filterung wie überall sonst hier.
 */
async function holeAltseason(tage = 90) {
    const fenster = [30, 90].includes(Number(tage)) ? Number(tage) : 90
    const roh = await holeMarkt(100)
    const kandidaten = (roh.muenzen || [])
        .filter(m => m.perp && m.symbol !== 'BTC')
        .slice(0, 50)

    return ausCache(`altseason|${fenster}|${kandidaten.length}`, 30 * 60 * 1000, async () => {
        const wandel = async (symbol) => {
            const kerzen = await getClosedCandles(symbol, '1d', fenster + 2)
            if (kerzen.length < fenster) return null
            const von = kerzen[kerzen.length - fenster].c
            const bis = kerzen[kerzen.length - 1].c
            return von > 0 ? ((bis - von) / von) * 100 : null
        }

        const btc = await wandel('BTCUSDT')
        if (btc === null) throw new Error('BTC-Kerzen unvollständig')

        const werte = []
        // Fünf statt zehn gleichzeitig, dazwischen eine kurze Pause: Binance
        // drosselt bei Bursts, und dann fehlen Märkte ohne erkennbaren Grund.
        for (let i = 0; i < kandidaten.length; i += 5) {
            if (i) await new Promise(r => setTimeout(r, 120))
            const teil = kandidaten.slice(i, i + 5)
            await Promise.all(teil.map(async (m) => {
                try {
                    const v = await wandel(m.perp)
                    if (v !== null) werte.push({ symbol: m.symbol, perp: m.perp, wandel: Math.round(v * 10) / 10 })
                } catch { /* Coin ohne ausreichende Historie fällt weg */ }
            }))
        }

        // Ein halb gefülltes Ergebnis ist hier GEFÄHRLICHER als gar keins:
        // schlagen zufällig zwei von zwei erreichbaren Coins den Bitcoin, stünde
        // „100 % — Altcoin-Saison" da, obwohl 48 Märkte fehlen. Lieber scheitern
        // und den Altstand zeigen.
        if (werte.length < kandidaten.length * 0.6) {
            throw new Error(`nur ${werte.length} von ${kandidaten.length} Märkten abrufbar`)
        }

        werte.sort((a, b) => b.wandel - a.wandel)
        const besser = werte.filter(w => w.wandel > btc).length
        const index = werte.length ? Math.round((besser / werte.length) * 100) : null

        return {
            fenster,
            index,
            btcWandel: Math.round(btc * 10) / 10,
            gezaehlt: werte.length,
            besser,
            // Beste und schlechteste fünf — die Aussage soll überprüfbar sein
            oben: werte.slice(0, 5),
            unten: werte.slice(-5).reverse(),
            lage: index === null ? null : index >= 75 ? 'altcoin' : index <= 25 ? 'bitcoin' : 'gemischt',
        }
    })
}

// ── Kachel: Marktübersicht (Blasen / Kacheln) ────────────────────────────

const COINGECKO_MARKETS = 'https://api.coingecko.com/api/v3/coins/markets'

/**
 * Top-N Coins mit Veränderung über drei Zeitfenster — ein einziger Abruf.
 *
 * Stablecoins fliegen raus: sie stehen per Bauart bei 0 % und würden in der
 * Blasenansicht nur grosse graue Flächen belegen. Wer wissen will, ob ein
 * Stablecoin seine Bindung verliert, schaut nicht in eine Marktübersicht.
 */
export async function holeMarkt(anzahl = 100) {
    // Eigener Deckel statt `topN`: die Kachel darf nur 10/50/100 anfordern, die
    // Coin-Rangliste braucht auch krumme Zahlen bis 250. Die Route klemmt ihren
    // Wert weiterhin selbst über `topN`, hier wird nur der Ausschnitt bestimmt —
    // der Cache hält ohnehin immer alle 250.
    const n = Math.max(1, Math.min(250, Math.round(Number(anzahl) || 100)))
    // EIN Abruf für alle drei Stufen: die Rangliste wird einmal geholt und
    // danach nur noch geschnitten. Drei eigene Cache-Einträge wären drei
    // Abrufe alle fünf Minuten — CoinGeckos freie Grenze ist schnell erreicht,
    // und das Umschalten zwischen 10 und 100 wäre jedes Mal ein Netzweg.
    const roh = await ausCache('markt', 5 * 60 * 1000, async () => {
        // Immer die vollen 250 holen: Stablecoins und tokenisierte Realwerte
        // fallen gleich raus, und „Top 10" soll am Ende auch zehn COINS zeigen
        // und nicht sieben.
        const url = `${COINGECKO_MARKETS}?vs_currency=usd&order=market_cap_desc`
            + '&per_page=250&page=1&price_change_percentage=1h%2C24h%2C7d'
        const roh = await holeJson(url)
        if (!Array.isArray(roh)) throw new Error('Unerwartete Antwort')

        const STABLE = /^(USDT|USDC|DAI|FDUSD|USDE|USDS|TUSD|PYUSD|USD1|BUIDL|USDTB|RLUSD|USDF)$/i
        // Tokenisierte Realwerte: Geldmarktfonds, Staatsanleihen, Kreditpools,
        // Gold. CoinGecko führt sie in derselben Rangliste — im Top 100 stehen
        // neun davon, eines auf Rang 9. Für eine KRYPTO-Übersicht ist das
        // Fremdmaterial: sie bewegen sich per Bauart kaum und verdrängen Coins.
        // Wortgrenzen sind wichtig — sonst fiele „Goldfinch" mit „Gold" raus.
        const KEIN_COIN = /\b(fund|funds|treasury|treasuries|t-bills?|bills?|heloc|clo|money market|securities|gold|silver|equity|stock)\b/i
        const zahl = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null)

        /**
         * Stablecoins ohne Namensliste erkennen: Symbol enthält „USD" (USDG,
         * USDY, USDD …) ODER der Name sagt „Dollar", UND der Kurs steht über
         * eine Woche praktisch still. Die zweite Bedingung ist der Schutz —
         * ohne sie fiele ein Coin raus, der zufällig „USD" im Namen trägt,
         * sich aber bewegt.
         */
        const istStabil = (c) => {
            const w24 = Math.abs(Number(c.price_change_percentage_24h_in_currency) || 0)
            const w7 = Math.abs(Number(c.price_change_percentage_7d_in_currency) || 0)
            const nachName = /usd/i.test(c.symbol || '') || /\bdollar\b/i.test(c.name || '')
            if (nachName && w7 < 1.5) return true
            // Rein am Verhalten erkannt: unter einem halben Prozent in einer
            // ganzen WOCHE bewegt sich nichts, was frei schwankt. Das fängt
            // auch Namen wie „Circle USYC", die keine Regel am Text erwischt.
            return w7 < 0.5 && w24 < 0.3
        }

        const muenzen = roh
            .filter(c => c.market_cap > 0
                && !STABLE.test(c.symbol || '')
                && !KEIN_COIN.test(c.name || '')
                && !istStabil(c))
            .map(c => ({
                symbol: String(c.symbol || '').toUpperCase(),
                name: c.name,
                mcap: c.market_cap,
                preis: c.current_price,
                volumen24h: c.total_volume,
                rang: c.market_cap_rank,
                w1h: zahl(c.price_change_percentage_1h_in_currency),
                w24h: zahl(c.price_change_percentage_24h_in_currency),
                w7d: zahl(c.price_change_percentage_7d_in_currency),
            }))
        // Handelbarkeit mitliefern: CoinGecko kennt Coins, die es auf
        // Binance-Futures nicht gibt (PI zum Beispiel). Ein Klick darauf hat
        // vorher das Symbol der ganzen Live-Analyse auf einen toten Markt
        // gesetzt — Bookmap, Liquidationskarte und Open Interest inklusive.
        // Binance handelt Kleinstwerte gebündelt: SHIB heisst dort
        // 1000SHIBUSDT, MOG sogar 1000000MOGUSDT. Ohne diese Varianten wären
        // ausgerechnet die Meme-Coins nicht anklickbar.
        const perps = await nurCoinSymbole().catch(() => new Set())
        for (const m of muenzen) {
            m.perp = ['', '1000', '1000000']
                .map(p => `${p}${m.symbol}USDT`)
                .find(k => perps.has(k)) || null
        }

        return { muenzen }
    })

    const muenzen = (roh.muenzen || []).slice(0, n)
    return {
        stand: roh.stand, veraltet: roh.veraltet, hinweis: roh.hinweis, _cache: roh._cache,
        muenzen, gezaehlt: muenzen.length, n,
    }
}

let snapTimer = null

export function setupMarktradarRoutes(app) {
    app.get('/api/marktradar/fear-greed', async (req, res) => {
        try {
            if (req.query.force === '1') verwerfeCache('fng|')
            sendeRadar(res, await holeFearGreed(req.query.tage))
        } catch (e) {
            sendRadarError(res, e, 'Fear & Greed')
        }
    })

    app.get('/api/marktradar/btc-dominanz', async (req, res) => {
        try {
            if (req.query.force === '1') verwerfeCache('global')
            sendeRadar(res, await holeDominanz())
        } catch (e) {
            sendRadarError(res, e, 'BTC-Dominanz')
        }
    })

    app.get('/api/marktradar/funding', async (req, res) => {
        try {
            if (req.query.force === '1') verwerfeCache('funding|')
            sendeRadar(res, await holeFunding(req.query.n))
        } catch (e) {
            sendRadarError(res, e, 'Funding-Raten')
        }
    })

    app.get('/api/marktradar/ls-oi', async (req, res) => {
        try {
            if (req.query.force === '1') verwerfeCache('lsoi|')
            sendeRadar(res, await holeLsOi(req.query.symbol, req.query.stunden))
        } catch (e) {
            sendRadarError(res, e, 'Long/Short-Verhältnis')
        }
    })

    app.get('/api/marktradar/rsi', async (req, res) => {
        try {
            if (req.query.force === '1') verwerfeCache('rsi|')
            sendeRadar(res, await holeRsi(req.query.tf, req.query.quelle, Number(req.query.n) || 50))
        } catch (e) {
            sendRadarError(res, e, 'RSI-Heatmap')
        }
    })

    app.get('/api/marktradar/liquidationen', async (req, res) => {
        try {
            if (req.query.force === '1') verwerfeCache('liq|')
            sendeRadar(res, await holeLiquidationen(req.query.stunden))
        } catch (e) {
            sendRadarError(res, e, 'Liquidationen')
        }
    })

    app.get('/api/marktradar/regime', async (req, res) => {
        try {
            if (req.query.force === '1') verwerfeCache('regime|')
            sendeRadar(res, await holeRegime(req.query.tage))
        } catch (e) {
            sendRadarError(res, e, 'Trades × Marktregime')
        }
    })

    app.get('/api/marktradar/picycle', async (req, res) => {
        try {
            if (req.query.force === '1') verwerfeCache('picycle')
            sendeRadar(res, await holePiCycle())
        } catch (e) {
            sendRadarError(res, e, 'Pi-Cycle-Top')
        }
    })

    app.get('/api/marktradar/altseason', async (req, res) => {
        try {
            if (req.query.force === '1') verwerfeCache('altseason|')
            sendeRadar(res, await holeAltseason(req.query.tage))
        } catch (e) {
            sendRadarError(res, e, 'Altcoin-Season-Index')
        }
    })

    app.get('/api/marktradar/rainbow', async (req, res) => {
        try {
            if (req.query.force === '1') verwerfeCache('rainbow')
            sendeRadar(res, await holeRainbow())
        } catch (e) {
            sendRadarError(res, e, 'Regenbogen-Chart')
        }
    })

    app.get('/api/marktradar/markt', async (req, res) => {
        try {
            if (req.query.force === '1') verwerfeCache('markt|')
            // `topN` bleibt hier: die Kachel soll weiterhin nur ihre drei Stufen
            // anfordern dürfen, auch wenn `holeMarkt` inzwischen mehr zulässt.
            sendeRadar(res, await holeMarkt(topN(req.query.n)))
        } catch (e) {
            sendRadarError(res, e, 'Marktübersicht')
        }
    })

    // Vorwärmen: die zwei langsamsten Fremdabrufe einmal im Hintergrund holen.
    // Ohne das lief der allererste Aufruf von /markt in eine Zeitüberschreitung
    // (CoinGecko braucht kalt bis zu zehn Sekunden) und die Kachel zeigte 504.
    // Fehler werden verschluckt — beim nächsten echten Abruf wird es erneut
    // versucht, und ein kalter Start darf den Serverstart nicht aufhalten.
    setTimeout(() => {
        holeMarkt(100).catch(() => { })
        nurCoinSymbole().catch(() => { })
        // Einmaliger Rückblick; der Anspruch verhindert Wiederholung
        holeDominanzRueckblick().catch((e) => logWarn('marktradar', `Rückblick: ${e.message}`))
    }, 4000)

    // Erster Schnappschuss beim Start, danach halbstündlich nachfassen
    schreibeSchnappschuss()
    snapTimer = setInterval(schreibeSchnappschuss, 30 * 60 * 1000)

    console.log(' -> Marktradar routes initialized')
}

export function stopMarktradar() {
    clearInterval(snapTimer)
    snapTimer = null
}
