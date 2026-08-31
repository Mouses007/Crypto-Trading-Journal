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
import { notiereGewicht, melde429 } from './binance-takt.js'
import { rsi } from './strategies/indicators.js'
import { bewerteMechanik, FENSTER } from './marktmechanik.js'
import {
    reiheAusChart, deltaAusReihe, korrelationAusReihen, deuteKorrelation,
    stableFluss, waehleDominanzPunkte, zerlegeDominanz,
} from './makro.js'
import { ladeLlmConfig, callLLMJson } from './llm.js'
import { parseWalBeitrag } from './wal-parser.js'

const HTTP_TIMEOUT = 10000

const FEAR_GREED_URL = 'https://api.alternative.me/fng/'
const COINGECKO_GLOBAL_URL = 'https://api.coingecko.com/api/v3/global'

// key -> { ts, ttlMs, payload }
const cache = new Map()
// key -> Promise  (parallele Anfragen desselben Schlüssels teilen einen Abruf)
const inFlight = new Map()
// key -> { ts, anzahl }  — letzter Fehlschlag je Schlüssel
const fehlschlag = new Map()

/**
 * Sperrfenster nach Fehlschlägen.
 *
 * Ohne das hämmert der Client eine gestörte Fremdquelle im PRÜFTAKT nach (3 s
 * im Live-Trading, 30 s im Marktradar) statt im Kachel-Intervall: `ausCache`
 * legt nur Erfolge ab, also ist nach einem Fehlschlag sofort wieder alles
 * fällig. Wer wegen zu vieler Anfragen gesperrt wurde, verlängert damit die
 * eigene Sperre. Der Altstand wird während der Sperre weiter geliefert.
 */
function darfNeuVersuchen(key, ttlMs) {
    const f = fehlschlag.get(key)
    if (!f) return true
    // 30 s, 60 s, 120 s … gedeckelt auf die TTL der Kachel (kürzere Kacheln
    // dürfen häufiger nachsehen, eine Tageskachel nicht öfter als täglich)
    const sperre = Math.min(Math.max(ttlMs, 30000), 30000 * 2 ** Math.min(f.anzahl - 1, 4))
    return Date.now() - f.ts > sperre
}

/**
 * Alte Einträge wegräumen.
 *
 * Der Cache wuchs bisher unbegrenzt: Schlüssel mit rotierenden Anteilen
 * (Symbollisten, Zeitfenster) legen laufend neue Einträge an, gelöscht wurde
 * nur auf Knopfdruck. Auf dem NAS läuft der Prozess wochenlang.
 *
 * Die Frist richtet sich nach der TTL des Eintrags, nicht nach einer Pauschale:
 * ein fester 1-h-Schnitt warf Langläufer (coinSymbole, rainbow, picycle — TTL
 * 12 h) stündlich weg und zerstörte damit genau deren Altstand-Rückfall — nach
 * der Räumung gab es bei Quellenausfall nichts Altes mehr zu liefern, obwohl
 * der Dateikopf das verspricht.
 */
const RAEUM_ALTER_MS = 60 * 60 * 1000
let raeumZaehler = 0
function raeumeAbgelaufene() {
    const jetzt = Date.now()
    for (const [k, v] of cache) {
        const frist = Math.max(2 * (v.ttlMs || 0), RAEUM_ALTER_MS)
        if (v.ts < jetzt - frist) cache.delete(k)
    }
    for (const [k, v] of fehlschlag) if (v.ts < jetzt - RAEUM_ALTER_MS) fehlschlag.delete(k)
}

/**
 * Erlaubte Ranglisten-Grössen. Bewusst nur drei Stufen: mehr Auswahl heisst
 * mehr Cache-Varianten und mehr Fremdanfragen, ohne dass jemand den
 * Unterschied zwischen „Top 60" und „Top 70" beurteilen könnte.
 */
export const TOP_N = [10, 50, 100]
const topN = (v) => (TOP_N.includes(Number(v)) ? Number(v) : 50)

/** Auf Stellen runden; alles Unbrauchbare wird null statt NaN oder 0. */
const rundeAuf = (v, stellen = 2) => (Number.isFinite(v)
    ? Math.round(v * 10 ** stellen) / 10 ** stellen
    : null)

/**
 * Abruf mit Zeitgrenze. `fetch` allein kennt keinen Timeout.
 *
 * Antworten von Binance-Futures-Hosts werden zusätzlich an die gemeinsame
 * Bremse gemeldet (`server/binance-takt.js`): Der Verbrauch gilt für die
 * GANZE IP, also zahlen die Radar-Kacheln auf dasselbe Kontingent ein wie
 * Rangliste und Historienläufe. Ohne die Meldung lösten die Kacheln ein 429
 * aus und die gebremsten Pfade feuerten trotzdem weiter, weil `gesperrtBis`
 * nie gesetzt wurde.
 */
export async function holeJson(url, timeout = HTTP_TIMEOUT) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeout)
    const binance = /(^|\.)binance\.com$/.test(hostVon(url))
    try {
        const r = await fetch(url, {
            signal: ctrl.signal,
            headers: { 'User-Agent': 'CryptoTradingJournal', Accept: 'application/json' },
        })
        if (binance) {
            // Beide Funktionen kommen mit `Headers` (get) wie mit Objekten klar
            if (r.status === 429 || r.status === 418) melde429(r.status, r.headers)
            else notiereGewicht(r.headers)
        }
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

/** Host einer URL, ohne bei Unsinn zu werfen. */
function hostVon(url) {
    try { return new URL(url).hostname.toLowerCase() } catch { return '' }
}


/**
 * Zwischenspeicher mit Zeitgrenze, Mehrfachabruf-Bündelung und Altstand-Rückfall.
 *
 * @param {string} key    Cache-Schlüssel (Parameter mit hineinnehmen!)
 * @param {number} ttlMs  Wie lange ein Eintrag als frisch gilt
 * @param {Function} holen  async () => Nutzlast
 */
export async function ausCache(key, ttlMs, holen) {
    if (++raeumZaehler % 100 === 0) raeumeAbgelaufene()
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

    // Fremdquelle ist gerade gestört: nicht schon wieder hinlaufen
    if (alt && !darfNeuVersuchen(key, ttlMs)) {
        return { ...alt.payload, stand: alt.ts, veraltet: true, hinweis: 'Quelle gestört, warte vor dem nächsten Versuch', _cache: 'BACKOFF' }
    }

    const p = holen().then((wert) => {
        cache.set(key, { ts: Date.now(), ttlMs, payload: wert })
        fehlschlag.delete(key)
        return wert
    })
    inFlight.set(key, p)
    try {
        const payload = await p
        return { ...payload, stand: cache.get(key).ts, veraltet: false, _cache: 'MISS' }
    } catch (e) {
        const f = fehlschlag.get(key)
        fehlschlag.set(key, { ts: Date.now(), anzahl: (f?.anzahl || 0) + 1 })
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
    // Auch die Sperre lösen: „Jetzt aktualisieren" ist eine bewusste Ansage
    // des Nutzers, keine automatische Wiederholung.
    for (const key of fehlschlag.keys()) if (key.startsWith(prefix)) fehlschlag.delete(key)
}

/** Nur für Selftests: Zustand des Zwischenspeichers zurücksetzen. */
export function _cacheZuruecksetzen() {
    cache.clear()
    inFlight.clear()
    fehlschlag.clear()
    raeumZaehler = 0
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
export async function holeGlobal() {
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

export async function holeDominanz() {
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
 * Kanon für Funding-Jahresraten.
 *
 * Eine Funding-Rate gilt IMMER je Zahlungsintervall, und das Intervall ist
 * nicht überall gleich — acht Stunden ist nur der Normalfall. Wer stur
 * dreimal täglich rechnet, bekommt bei einem 4h-Markt genau die halbe
 * Jahresrate und merkt es nicht, weil die Zahl plausibel aussieht. Genau so
 * ist am 17.08.2026 eine Divergenz-Mail entstanden, die LAB als Grenzfall
 * meldete, obwohl es der auffälligste Markt der Liste war.
 *
 * Deshalb steht die Umrechnung einmal hier statt viermal ausgeschrieben.
 */
export const FUNDING_STANDARD_H = 8

export function jahresRateAus(rate, intervallStunden = FUNDING_STANDARD_H) {
    // Bewusst typstreng: `Number(null)` ist 0, und eine fehlende Rate als
    // „0 % Funding" durchzureichen wäre schlimmer als eine Lücke.
    if (typeof rate !== 'number' || !Number.isFinite(rate)) return null
    const h = Number(intervallStunden)
    const takt = Number.isFinite(h) && h > 0 ? h : FUNDING_STANDARD_H
    return Number(rate) * (24 / takt) * 365
}

const BITUNIX_FAPI = 'https://fapi.bitunix.com'

/**
 * Bitunix-Funding für die eigenen Märkte — die Rate, die eine eigene Position
 * WIRKLICH zahlt (gehandelt wird auf Bitunix, nicht auf Binance).
 *
 * Bitunix meldet die Rate in PROZENT, nicht als Dezimalbruch wie Binance —
 * verifiziert am 17.08.2026 über fünf Symbole (BTC 0.0088 gegen Binance
 * 0.0000875). Das Zahlungsintervall kommt als `fundingInterval` (Stunden) mit
 * und geht in die Jahresrate ein, statt stur 3×365 zu rechnen.
 *
 * Ein Abruf je Symbol; es gibt keinen Sammel-Endpunkt. Bei den höchstens
 * acht eigenen Märkten ist das verkraftbar, ein eigener Cache-Schlüssel
 * verhindert, dass jede n/rang-Variante der Kachel erneut abruft. Fehler je
 * Symbol werden geschluckt — eine fehlende Bitunix-Zeile darf die Kachel
 * nicht leeren.
 */
async function holeBitunixFunding(symbole) {
    if (!symbole.length) return {}
    const key = `bitunixFunding|${[...symbole].sort().join(',')}`
    const { map } = await ausCache(key, 60 * 1000, async () => {
        const paare = await Promise.all(symbole.map(async (sym) => {
            try {
                const r = await holeJson(`${BITUNIX_FAPI}/api/v1/futures/market/funding_rate?symbol=${sym}`)
                const prozent = Number(r?.data?.fundingRate)
                if (!Number.isFinite(prozent)) return null
                const intervall = Number(r?.data?.fundingInterval) || FUNDING_STANDARD_H
                const rate = prozent / 100
                return [sym, {
                    rate,
                    jahresRate: jahresRateAus(rate, intervall),
                    intervallStunden: intervall,
                    naechsteZahlung: Number(r?.data?.nextFundingTime) || null,
                }]
            } catch {
                return null
            }
        }))
        return { map: Object.fromEntries(paare.filter(Boolean)) }
    })
    return map || {}
}

/**
 * Zahlungsintervalle der Binance-Perps (Stunden).
 *
 * `premiumIndex` liefert die Rate, aber nicht den Takt. Der steht in
 * `/fapi/v1/fundingInfo` — und zwar NUR für Märkte mit abweichender
 * Einstellung; im Abruf vom 17.08.2026 waren das 445 Perps, fast alle auf
 * vier Stunden (u. a. AERO und LAB). Wer im Endpunkt fehlt, zahlt im
 * Standardtakt.
 *
 * Fällt der Abruf aus, rechnet alles im Standardtakt weiter — dieselbe
 * Notlösung wie bei Bybit. Sie liefert für die 4h-Märkte zu kleine Werte,
 * aber eine leere Funding-Kachel wäre schlechter als eine vorsichtige.
 * Der Takt ändert sich praktisch nie, deshalb 12h-Cache.
 */
/*
 * Exportiert, weil der Coin-Radar denselben Takt braucht: Er rechnete Funding
 * pauschal auf acht Stunden hoch und halbierte damit die Jahreskosten aller
 * 4h-Märkte — genau der Fehler, gegen den dieser Helfer im August gebaut
 * wurde. Ein zweiter Abruf dafür wäre Verschwendung, der Cache hält 12 h.
 */
export async function holeBinanceIntervalle() {
    const { stunden } = await ausCache('binanceIntervalle', 12 * 60 * 60 * 1000, async () => {
        const r = await holeJson(`${FAPI}/fapi/v1/fundingInfo`)
        const stunden = {}
        for (const x of r || []) {
            const h = Number(x.fundingIntervalHours)
            if (Number.isFinite(h) && h > 0) stunden[x.symbol] = h
        }
        return { stunden }
    }).catch(() => ({ stunden: {} }))
    return stunden || {}
}

const BYBIT_API = 'https://api.bybit.com'

/**
 * Ab wie viel Abweichung (Jahresrate, als Dezimalbruch) gilt eine Bybit-Rate
 * als Divergenz? 10 Prozentpunkte p.a.: BTC/ETH liegen börsenübergreifend
 * wenige Punkte auseinander (Arbitrage), echte einseitige Positionierung auf
 * EINER Börse reisst die Schwelle deutlich.
 */
const DIVERGENZ_PP = 0.10

/** Mehr als so viele Märkte darf der Divergenz-Alarm nicht beobachten. */
const DIVERGENZ_MAX_SYMBOLE = 40

/**
 * Welche Märkte der Divergenz-Alarm beobachtet.
 *
 * Leer = die eigenen Märkte, wie bisher. Eine Liste in den Einstellungen
 * sticht das: eine auseinanderlaufende Funding-Rate ist ein Grund, sich einen
 * Markt ANZUSEHEN — man muss ihn dafür nicht schon handeln. Umgekehrt will
 * nicht jeder eigene Markt eine Meldung.
 */
async function divergenzSymbole() {
    const s = await getKnex()('settings').where('id', 1).first().catch(() => null)
    return String(s?.radarDivergenzSymbole || '').split(/[,\s]+/)
        .map(x => x.trim().toUpperCase()).filter(x => SYMBOL_RE.test(x))
        .slice(0, DIVERGENZ_MAX_SYMBOLE)
}

/**
 * Bybit als Vergleichsbörse: Jahresrate je Symbol aus EINEM Ticker-Abruf.
 *
 * Anders als Bitunix meldet Bybit die Rate als Dezimalbruch wie Binance
 * (verifiziert 17.08.2026: BTC 0.000063 gegen Binance 0.0000875). Das
 * Zahlungsintervall steht NICHT im Ticker, sondern in instruments-info
 * (Minuten, alle 821 Instrumente in einem Abruf) — ohne Intervall wären die
 * p.a.-Werte der 4h/1h-Märkte glatt falsch. Die Intervalle ändern sich
 * praktisch nie, deshalb 12h-Cache.
 */
async function holeBybitFunding() {
    const { map } = await ausCache('bybitFunding', 60 * 1000, async () => {
        const [ticker, intervalle] = await Promise.all([
            holeJson(`${BYBIT_API}/v5/market/tickers?category=linear`),
            ausCache('bybitIntervalle', 12 * 60 * 60 * 1000, async () => {
                const r = await holeJson(`${BYBIT_API}/v5/market/instruments-info?category=linear&limit=1000`)
                const stunden = {}
                for (const x of r?.result?.list || []) {
                    const min = Number(x.fundingInterval)
                    if (Number.isFinite(min) && min > 0) stunden[x.symbol] = min / 60
                }
                return { stunden }
            }).catch(() => ({ stunden: {} })),
        ])
        const map = {}
        for (const t of ticker?.result?.list || []) {
            const rate = Number(t.fundingRate)
            if (!Number.isFinite(rate)) continue
            const intervall = intervalle.stunden[t.symbol] || FUNDING_STANDARD_H
            map[t.symbol] = jahresRateAus(rate, intervall)
        }
        return { map }
    })
    return map || {}
}

/**
 * Funding über die Top-N-Coin-Märkte — wahlweise nach 24h-Umsatz (Vorgabe)
 * oder nach Marktkapitalisierung.
 *
 * Die Auswahl läuft über eine Rangliste statt über eine Umsatzschwelle: „Top 50"
 * ist eine Aussage, die jeder sofort versteht, „ab 20 Mio. USD" nicht — und die
 * Zahl der Märkte hinter einer festen Schwelle schwankt mit der Marktlage.
 * Umsatz zeigt, WO gerade gehandelt wird (auch kleine Coins im Pump), die
 * Marktkapitalisierung die dauerhaft grossen Werte — beides sind berechtigte
 * Blickwinkel, deshalb der Umschalter.
 */
export async function holeFunding(anzahl = 50, rang = 'volumen') {
    const n = topN(anzahl)
    const nachMcap = rang === 'mcap'
    const meine = await eigeneSymbole().catch(() => [])
    const gewaehlt = await divergenzSymbole().catch(() => [])
    const schluessel = `funding|${n}|${nachMcap ? 'mcap' : 'vol'}|${meine.join(',')}|${gewaehlt.join(',')}`
    return ausCache(schluessel, 60 * 1000, async () => {
        // premiumIndex ohne Symbol liefert ALLE Perps in einem Abruf (Gewicht 10)
        const [roh, vol, bitunix, bybit, taktBinance] = await Promise.all([
            holeJson(`${FAPI}/fapi/v1/premiumIndex`),
            holeVolumen().catch(() => ({ map: {} })),
            holeBitunixFunding(meine).catch(() => ({})),
            holeBybitFunding().catch(() => ({})),
            holeBinanceIntervalle(),
        ])

        // Ohne Umsatzliste gibt es keine Rangliste und keine einzige Zeile.
        // Das Weiterreichen einer leeren Liste als frischen Stand widerspräche
        // Regel 1 dieser Datei — beobachtet beim Startsturm, als der Abruf
        // einmal danebenging und die Kachel „—" statt Zahlen zeigte. Werfen
        // heisst: `ausCache` liefert den letzten guten Stand mit `veraltet`.
        if (!Object.keys(vol.map).length) throw new Error('Umsatzliste leer')

        // Nur Coin-Märkte (vol.map ist bereits gefiltert) und davon die N
        // umsatzstärksten — oder, auf Wunsch, die N grössten Coins nach
        // Marktkapitalisierung. Die CoinGecko-Rangliste liefert das
        // Binance-Symbol (`perp`) gleich mit; Coins ohne Perp werden
        // übersprungen, damit „Top 10" auch zehn HANDELBARE Märkte zeigt.
        let rangliste
        if (nachMcap) {
            const markt = await holeMarkt(250)
            rangliste = new Set((markt.muenzen || [])
                .filter(m => m.perp).slice(0, n).map(m => m.perp))
        } else {
            rangliste = new Set(Object.entries(vol.map)
                .sort((a, b) => b[1] - a[1]).slice(0, n).map(([s]) => s))
        }

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
            // Hochgerechnet auf ein Jahr wird aus einer unscheinbaren Zahl eine
            // begreifbare Grösse — mit dem Takt des jeweiligen Marktes, nicht
            // mit pauschal dreimal täglich (siehe `holeBinanceIntervalle`).
            .map(r => {
                const intervallStunden = taktBinance[r.symbol] || FUNDING_STANDARD_H
                return { ...r, intervallStunden, jahresRate: jahresRateAus(r.rate, intervallStunden) }
            })
            // Bybit danebenhalten. Arbitrage hält die Raten normalerweise
            // zusammen; wo sie AUSEINANDERLAUFEN, sitzt die überfüllte Seite
            // auf einer Börse allein — dort zündet eine Auflösung zuerst.
            // Nur die Abweichung wird gemeldet, nicht jede zweite Rate: die
            // Liste soll ruhig bleiben und erst dann sprechen, wenn es etwas
            // zu sagen gibt.
            .map(r => {
                const by = bybit[r.symbol]
                if (!Number.isFinite(by)) return r
                const delta = r.jahresRate - by
                return {
                    ...r,
                    bybitJahresRate: by,
                    divergenz: Math.abs(delta) >= DIVERGENZ_PP ? delta : null,
                }
            })
            // Nach JAHRESRATE ordnen, nicht nach der rohen Intervallrate:
            // die Liste vergleicht Märkte mit 1-h-, 4-h- und 8-h-Takt
            // miteinander. -0,09 % je Stunde kostet achtmal so viel wie
            // -0,09 % je acht Stunden — nach der rohen Zahl sortiert stünden
            // beide nebeneinander, und die Kachel zeigt daneben ohnehin die
            // Jahresrate an.
            .sort((a, b) => (b.jahresRate ?? 0) - (a.jahresRate ?? 0))

        // Die Extreme des Gesamtmarkts sitzen fast immer in Mikro-Werten, die
        // niemand handelt. Deshalb stehen VORNE die eigenen Märkte; die
        // Rangliste ist der zweite Blick.
        const zeilen = alleZeilen.filter(r => rangliste.has(r.symbol))
        const nachSymbol = new Map(alleZeilen.map(r => [r.symbol, r]))

        return {
            // Je eigener Markt beide Blickwinkel: die Binance-Zeile für die
            // Marktbreite, daneben die Bitunix-Rate der eigenen Börse. Ein
            // Markt, den Binance nicht führt, bleibt dank Bitunix trotzdem
            // sichtbar — vorher fiel er stumm aus der Liste.
            eigene: meine.map(s => {
                const z = nachSymbol.get(s)
                const bu = bitunix[s] || null
                if (!z && !bu) return null
                return {
                    symbol: s, rate: null, jahresRate: null,
                    naechsteZahlung: null, volumen24h: 0,
                    ...(z || {}), bitunix: bu,
                }
            }).filter(Boolean),
            oben: zeilen.slice(0, 8),
            unten: zeilen.slice(-8).reverse(),
            alle: zeilen,
            gezaehlt: zeilen.length,
            n,
            rang: nachMcap ? 'mcap' : 'volumen',
            // Die stärksten Börsen-Abweichungen, für Marker und Alarm. Bewusst
            // aus der RANGLISTE gezogen: bei Mikro-Werten weichen die Raten
            // ständig ab, ohne dass es jemanden betrifft.
            divergenzen: zeilen
                .filter(r => r.divergenz !== null && r.divergenz !== undefined)
                .sort((a, b) => Math.abs(b.divergenz) - Math.abs(a.divergenz))
                .slice(0, 5)
                .map(r => ({
                    symbol: r.symbol,
                    binance: r.jahresRate,
                    bybit: r.bybitJahresRate,
                    delta: r.divergenz,
                    // Der Takt gehört mit: eine Jahresrate von -900 % liest
                    // sich wie ein Fehler, bis danebensteht, dass es -0,10 %
                    // je Stunde sind — eine Zahl innerhalb der Börsengrenze.
                    intervallStunden: r.intervallStunden ?? FUNDING_STANDARD_H,
                    rate: r.rate,
                })),
            divergenzSchwelle: DIVERGENZ_PP,
            /*
             * Die Märkte, die der Alarm beobachtet — mit ihrer aktuellen
             * Abweichung, sonst nichts. Browser und Takt-Mail lesen beide von
             * hier, damit „welche Coins" an EINER Stelle entschieden wird und
             * nicht zweimal leicht verschieden.
             *
             * Bewusst aus `alleZeilen` und nicht aus der Rangliste: ein
             * ausgewählter Markt soll melden, auch wenn er nicht unter den Top
             * N liegt — genau das ist der Sinn der Auswahl. Ohne eigene Liste
             * sind es die eigenen Märkte, wie vorher.
             *
             * Märkte OHNE Abweichung stehen mit `delta: null` trotzdem drin:
             * die Entprellung im Browser löscht ihren Merker erst, wenn sie
             * eine Zeile sehen, die unter der Schwelle liegt. Liesse man sie
             * weg, bliebe der Merker stehen und ein wieder auflodernder Markt
             * meldete sich nie erneut.
             */
            divergenzMaerkte: (gewaehlt.length ? gewaehlt : meine).map(s => {
                const z = nachSymbol.get(s)
                if (!z) return null
                return {
                    symbol: s,
                    binance: z.jahresRate ?? null,
                    bybit: z.bybitJahresRate ?? null,
                    delta: z.divergenz ?? null,
                }
            }).filter(Boolean),
            divergenzEigene: !gewaehlt.length,
        }
    })
}

// ── Kachel: Long/Short-Verhältnis + Open Interest ────────────────────────

const SYMBOL_RE = /^[A-Z0-9]{2,20}$/

export async function holeLsOi(symbol, stunden = 48) {
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
 * Die Coin-Perps mit der höchsten Marktkapitalisierung — kein eigener Abruf,
 * sondern dieselbe CoinGecko-Rangliste, die die Marktübersicht-Kachel ohnehin
 * alle 5 Minuten hält (`holeMarkt`). `muenzen` kommt bereits nach Mcap
 * sortiert von CoinGecko, `.perp` bildet auf das Binance/Bitunix-Symbol ab
 * (inkl. 1000er-Präfix bei Kleinstwerten) — Coins ohne handelbaren Perp
 * fallen einfach raus.
 */
async function topSymboleNachMcap(n = 50) {
    const { muenzen } = await holeMarkt(250)
    return muenzen.filter(m => m.perp).map(m => m.perp).slice(0, topN(n))
}

/** Mcap je Perp-Symbol, zum Anzeigen/Sortieren der RSI-Punkte. */
async function holeMarktkapMap() {
    const { muenzen } = await holeMarkt(250)
    const map = {}
    for (const m of muenzen) if (m.perp) map[m.perp] = m.mcap
    return map
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
 * @param {string} quelle  'top' (Umsatz-Rangliste) | 'mcap' (Mcap-Rangliste) | 'eigene' (eigene Trades) | 'liste'
 */
export async function holeRsi(tf = '1h', quelle = 'top', anzahl = 50) {
    const n = topN(anzahl)
    const zeiteinheit = RSI_TFS_ERLAUBT.includes(String(tf)) ? String(tf) : '1h'
    const knex = getKnex()
    const s = await knex('settings').where('id', 1).first().catch(() => null)
    const eigeneListe = String(s?.radarRsiSymbols || '').trim()

    let art = ['top', 'mcap', 'eigene', 'liste'].includes(quelle) ? quelle : 'top'
    // Eine eingetragene Liste ist eine bewusste Entscheidung — sie gewinnt
    if (art === 'liste' && !eigeneListe) art = 'top'

    const symbole = art === 'liste' || (art === 'eigene' && eigeneListe)
        ? await eigeneSymbole()
        : art === 'eigene' ? await eigeneSymbole()
        : art === 'mcap' ? await topSymboleNachMcap(n)
        : await topSymbole(n)

    return ausCache(`rsi|${zeiteinheit}|${art}|${n}|${symbole.join(',')}`, 60 * 1000, async () => {
        const { map: volumen } = await holeVolumen().catch(() => ({ map: {} }))
        const mcap = art === 'mcap' ? await holeMarktkapMap().catch(() => ({})) : {}
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
                        mcap: mcap[symbol] || 0,
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

        // Sortiert nach der Grösse, auf der auch die Auswahl beruht: links die
        // grossen Märkte, rechts die kleinen
        punkte.sort((a, b) => art === 'mcap' ? b.mcap - a.mcap : b.volumen24h - a.volumen24h)
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
 * Seit dem Bybit-Sammelstrom fliessen zwei Börsen ein: Binance ist eine
 * gedrosselte Stichprobe (1 Ereignis/s/Symbol), Bybit ungedrosselt — Bybit
 * wird deshalb meist dominieren, das ist kein Fehler.
 *
 * ACHTUNG bei der Seite: `seite = 1` heisst, die Börse hat GEKAUFT, also wurde
 * ein SHORT glattgestellt. Wer das dreht, färbt die ganze Kachel falsch.
 */
/**
 * @param {number} stunden Zeitfenster
 * @param {string} [symbol] Nur dieses Symbol. Leer/fehlend = marktweit — das
 *   ist die Vorgabe und der eigentliche Zweck der Kachel; die Einengung ist ein
 *   Knopf in der Kachel, keine automatische Folge der Symbolwahl. Gefiltert
 *   wird in der Abfrage, nicht nach dem Auspacken: sonst würde für ein Symbol
 *   trotzdem jede Stundenzeile des ganzen Marktes entpackt.
 */
export async function holeLiquidationen(stunden = 24, symbol = '') {
    const h = Math.max(1, Math.min(72, Number(stunden) || 24))
    const sym = String(symbol || '').trim().toUpperCase() || null
    return ausCache(`liq|${h}|${sym || '*'}`, 60 * 1000, async () => {
        const { promisify } = await import('util')
        const zlib = await import('zlib')
        const gunzip = promisify(zlib.gunzip)

        const knex = getKnex()
        const s = await knex('settings').where('id', 1).first().catch(() => null)
        const von = Date.now() - h * 3600000

        // 'liq' = Binance forceOrder (gedrosselte Stichprobe), 'liqB' = Bybit
        // allLiquidation (ungedrosselt). Beide zusammen ergeben das Bild;
        // die Seiten-Konvention ist beim Schreiben bereits vereinheitlicht.
        const abfrage = knex('live_recordings')
            .whereIn('kind', ['liq', 'liqB'])
            .andWhere('hourStart', '>=', stundenBeginn(von))
        if (sym) abfrage.andWhere('symbol', sym)
        const zeilen = await abfrage.orderBy('hourStart')

        const jeSymbol = new Map()
        const jeStunde = new Map()
        const jeBoerse = new Map()
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
            const boerseId = zeile.kind === 'liqB' ? 'bybit' : 'binance'
            for (const [t, preis, menge, seite] of roh) {
                if (t < von) continue
                const usd = preis * menge
                if (!Number.isFinite(usd)) continue
                // seite 1 = Kauf der Börse = Short wurde liquidiert
                const istShort = seite === 1
                anzahl++
                if (istShort) shortUsd += usd; else longUsd += usd
                if (frueheste === null || t < frueheste) frueheste = t

                const bo = jeBoerse.get(boerseId) || { id: boerseId, longUsd: 0, shortUsd: 0, anzahl: 0 }
                bo[istShort ? 'shortUsd' : 'longUsd'] += usd
                bo.anzahl++
                jeBoerse.set(boerseId, bo)

                const sym = jeSymbol.get(zeile.symbol) || { symbol: zeile.symbol, longUsd: 0, shortUsd: 0, anzahl: 0 }
                sym[istShort ? 'shortUsd' : 'longUsd'] += usd
                sym.anzahl++
                jeSymbol.set(zeile.symbol, sym)

                const stunde = stundenBeginn(t)
                const st = jeStunde.get(stunde) || { t: stunde, longUsd: 0, shortUsd: 0 }
                st[istShort ? 'shortUsd' : 'longUsd'] += usd
                jeStunde.set(stunde, st)

                groesste.push({ t, symbol: zeile.symbol, usd, seite: istShort ? 'short' : 'long', boerse: boerseId })
            }
        }

        groesste.sort((a, b) => b.usd - a.usd)

        return {
            // Aufzeichnung gilt als aktiv, wenn der Sammelstrom läuft ODER
            // tatsächlich Daten im Fenster liegen
            aktiv: Number(s?.liveRecordAllLiq) === 1 || anzahl > 0,
            stunden: h,
            // null = marktweit. Die Kachel liest daran ab, welcher Knopf leuchtet.
            symbol: sym,
            seit: frueheste,
            symbole: [...jeSymbol.values()].sort((a, b) => (b.longUsd + b.shortUsd) - (a.longUsd + a.shortUsd)),
            verlauf: [...jeStunde.values()].sort((a, b) => a.t - b.t),
            groesste: groesste.slice(0, 10),
            gesamt: { longUsd, shortUsd, anzahl },
            boersen: [...jeBoerse.values()].sort((a, b) => (b.longUsd + b.shortUsd) - (a.longUsd + a.shortUsd)),
        }
    })
}

// ── Kachel: Marktmechanik ────────────────────────────────────────────────

/**
 * Liquidationen EINES Symbols im Zeitfenster plus 24-h-Referenz für den
 * Spike-Vergleich — beides in einem Durchlauf aus denselben Stundenzeilen
 * der eigenen Aufzeichnung (Binance + Bybit, Seiten-Konvention beim
 * Schreiben bereits vereinheitlicht: seite 1 = Short liquidiert).
 */
async function liesLiqFenster(symbol, vonMs, bisMs) {
    const { promisify } = await import('util')
    const zlib = await import('zlib')
    const gunzip = promisify(zlib.gunzip)

    const refVon = bisMs - 24 * 3600000
    const zeilen = await getKnex()('live_recordings')
        .whereIn('kind', ['liq', 'liqB'])
        .andWhere('symbol', symbol)
        .andWhere('hourStart', '>=', stundenBeginn(refVon))
        .orderBy('hourStart')

    let fensterLong = 0
    let fensterShort = 0
    let fensterAnzahl = 0
    let refUsd = 0
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
            if (t < refVon || t > bisMs) continue
            const usd = preis * menge
            if (!Number.isFinite(usd)) continue
            refUsd += usd
            if (t >= vonMs) {
                fensterAnzahl++
                if (seite === 1) fensterShort += usd; else fensterLong += usd
            }
        }
    }
    // verfuegbar unterscheidet „nicht aufgezeichnet" von „ruhige 24 h":
    // gibt es überhaupt Zeilen, wird gesammelt — auch wenn im Fenster nichts lag
    return { verfuegbar: zeilen.length > 0, fensterLong, fensterShort, fensterAnzahl, refUsd }
}

// Kerzen-/OI-Raster je Fenster: n Punkte im Abstand tf decken das Fenster ab,
// der erste Punkt ist die Vergleichsbasis (Delta = letzter vs. erster).
const MECHANIK_RASTER = {
    '15m': { tf: '5m', n: 4 },
    '1h': { tf: '15m', n: 5 },
    '4h': { tf: '1h', n: 5 },
}

/**
 * Marktmechanik: Faktoren beschaffen, Urteil fällen. Das Urteil selbst liegt
 * in marktmechanik.js (rein, selbstgetestet) — hier steht nur, WOHER die
 * Zahlen kommen. Antwort enthält Schlüssel statt Texte; übersetzt wird im
 * Frontend (marktradar.mechanik.state_*).
 */
export async function holeMechanik(symbol, fenster) {
    const sym = String(symbol || 'BTCUSDT').toUpperCase()
    if (!SYMBOL_RE.test(sym)) {
        const e = new Error('Ungültiges Symbol')
        e.status = 400
        throw e
    }
    const f = Object.hasOwn(FENSTER, String(fenster)) ? String(fenster) : '1h'

    return ausCache(`mechanik|${sym}|${f}`, 60 * 1000, async () => {
        const jetzt = Date.now()
        const fensterMs = FENSTER[f].ms
        const { tf, n } = MECHANIK_RASTER[f]

        // Vier Quellen parallel; jede darf einzeln ausfallen — das Regelwerk
        // degradiert dann und `fehlend` benennt die Lücke, statt dass die
        // ganze Kachel an einer Teilquelle stirbt.
        const [kerzen, oiHist, premium, fundingHist, liq, taktBinance] = await Promise.all([
            getClosedCandles(sym, tf, n).catch(() => []),
            holeJson(`${FAPI}/futures/data/openInterestHist?symbol=${sym}&period=${tf}&limit=${n}`).catch(() => null),
            holeJson(`${FAPI}/fapi/v1/premiumIndex?symbol=${sym}`).catch(() => null),
            holeJson(`${FAPI}/fapi/v1/fundingRate?symbol=${sym}&limit=1`).catch(() => null),
            liesLiqFenster(sym, jetzt - fensterMs, jetzt).catch(() => null),
            holeBinanceIntervalle(),
        ])

        const preisDeltaPct = kerzen.length >= 2 && kerzen[0].c > 0
            ? ((kerzen[kerzen.length - 1].c - kerzen[0].c) / kerzen[0].c) * 100
            : null

        let oiDeltaPct = null
        let oiJetzt = null
        if (Array.isArray(oiHist) && oiHist.length >= 2) {
            const erster = Number(oiHist[0].sumOpenInterest)
            const letzter = Number(oiHist[oiHist.length - 1].sumOpenInterest)
            if (erster > 0 && Number.isFinite(letzter)) {
                oiJetzt = letzter
                oiDeltaPct = ((letzter - erster) / erster) * 100
            }
        }

        // Binance liefert die Rate als Bruch (0.0001 = 0,01 %); das Regelwerk
        // rechnet in % je 8 h — deshalb ×100
        const rohRate = Number(premium?.lastFundingRate)
        const fundingRate = Number.isFinite(rohRate) ? rohRate * 100 : null
        // Die Schwellen in marktmechanik.js sind auf den 8h-Takt geeicht
        // („+0,03 % je 8 h ≈ +33 % p.a."). Ein 4h-Markt zahlt bei gleicher
        // Rate das Doppelte — ohne Umrechnung müsste er die doppelten
        // Jahreskosten erreichen, bevor „Funding hoch" überhaupt anspringt.
        // Also wird für das URTEIL auf 8h-Äquivalent normiert; gemeldet wird
        // weiter die echte Rate.
        const taktStunden = taktBinance[sym] || FUNDING_STANDARD_H
        const fundingRate8h = fundingRate === null
            ? null
            : fundingRate * (FUNDING_STANDARD_H / taktStunden)
        const abgerechnet = Array.isArray(fundingHist) && fundingHist.length
            ? Number(fundingHist[fundingHist.length - 1].fundingRate) * 100
            : null
        const fundingTrend = fundingRate !== null && Number.isFinite(abgerechnet)
            ? Math.sign(fundingRate - abgerechnet)
            : 0

        let liqLongUsd = null
        let liqShortUsd = null
        let liqSpikeFaktor = null
        const liqVerfuegbar = !!liq?.verfuegbar
        if (liqVerfuegbar) {
            liqLongUsd = liq.fensterLong
            liqShortUsd = liq.fensterShort
            // Spike = Fenster-Volumen gegen einen durchschnittlich gleich
            // langen Abschnitt der letzten 24 h
            const erwartet = liq.refUsd * (fensterMs / (24 * 3600000))
            liqSpikeFaktor = erwartet > 0 ? (liq.fensterLong + liq.fensterShort) / erwartet : null
        }

        const faktoren = {
            preisDeltaPct, oiDeltaPct, fundingRate: fundingRate8h, fundingTrend,
            liqLongUsd, liqShortUsd, liqSpikeFaktor, liqVerfuegbar,
        }
        const urteil = bewerteMechanik(faktoren, f)

        return {
            symbol: sym,
            fenster: f,
            state: urteil.state,
            gruende: urteil.gruende,
            fehlend: urteil.fehlend,
            faktoren: {
                preisDeltaPct: rundeAuf(preisDeltaPct),
                oiDeltaPct: rundeAuf(oiDeltaPct),
                oiJetzt,
                fundingRate: rundeAuf(fundingRate, 4),
                // Im Takt DIESES Marktes aufs Jahr hochgerechnet — dieselbe
                // Grösse wie in der Funding-Kachel
                fundingIntervallStunden: taktStunden,
                fundingJahresRate: rundeAuf(jahresRateAus(fundingRate, taktStunden), 1),
                fundingTrend,
                liqVerfuegbar,
                liqLongUsd: rundeAuf(liqLongUsd, 0),
                liqShortUsd: rundeAuf(liqShortUsd, 0),
                liqSpikeFaktor: rundeAuf(liqSpikeFaktor, 1),
                liqAnzahl: liqVerfuegbar ? liq.fensterAnzahl : null,
            },
        }
    })
}

/**
 * KI-Einordnung des Marktmechanik-Zustands — die KI ERKLÄRT, sie bestimmt
 * nicht. Sie bekommt nur den regelbasiert ermittelten Zustand plus die
 * Messwerte dahinter (STATE + DATA) und darf keine Empfehlung geben.
 *
 * Wird nur per Knopf in der Gross-Ansicht aufgerufen, nie im Poll. Der Cache
 * hängt am Zustand: solange (Symbol, Fenster, Zustand) gleich bleiben, kommt
 * derselbe Text zurück und es wird kein zweites Mal bezahlt. Kein
 * `beansprucheAufgabe` nötig — der Aufruf ist nutzergetrieben.
 */
const erklaerungCache = new Map()   // "SYM|fenster|STATE" -> { ts, payload }
const ERKLAERUNG_TTL_MS = 30 * 60 * 1000
const ERKLAERUNG_MAX = 50

async function holeMechanikErklaerung(symbol, fenster) {
    const mech = await holeMechanik(symbol, fenster)
    const key = `${mech.symbol}|${mech.fenster}|${mech.state}`
    const alt = erklaerungCache.get(key)
    if (alt && Date.now() - alt.ts < ERKLAERUNG_TTL_MS) {
        return { ...alt.payload, cached: true }
    }

    const cfg = await ladeLlmConfig()
    cfg.maxTokens = 300

    const s = await getKnex()('settings').select('language').where('id', 1).first().catch(() => null)
    const englisch = s?.language === 'en'

    const fx = mech.faktoren
    const system = (englisch
        ? 'You are a sober market observer. You receive a rule-derived market state and the measurements behind it. '
        + 'Explain in at most 80 words what this constellation means mechanically. Name contradictions between the '
        + 'factors explicitly. NO trading recommendation, no price targets, no "one should". Respond in English.'
        : 'Du bist ein nüchterner Marktbeobachter. Du bekommst einen regelbasiert bestimmten Marktzustand und die '
        + 'Messwerte dahinter. Erkläre in höchstens 80 Wörtern, was diese Konstellation mechanisch bedeutet. Benenne '
        + 'Widersprüche zwischen den Faktoren ausdrücklich. KEINE Handelsempfehlung, keine Kursziele, kein „sollte '
        + 'man". Antworte auf Deutsch.')
        + ' JSON: {"text": "…"}'

    const user = [
        `STATE: ${mech.state}`,
        `SYMBOL: ${mech.symbol}, Fenster: ${mech.fenster}`,
        'DATA:',
        `  Preis: ${fx.preisDeltaPct ?? 'n/a'} %`,
        `  Open Interest: ${fx.oiDeltaPct ?? 'n/a'} %`,
        `  Funding: ${fx.fundingRate ?? 'n/a'} % je 8h (${fx.fundingJahresRate ?? 'n/a'} % p.a.), Trend ${fx.fundingTrend}`,
        fx.liqLongUsd === null
            ? '  Liquidationen: keine Aufzeichnung für dieses Symbol'
            : `  Liquidationen: Longs ${Math.round(fx.liqLongUsd)} USD, Shorts ${Math.round(fx.liqShortUsd)} USD, Spike-Faktor ${fx.liqSpikeFaktor ?? 'n/a'}`,
        mech.fehlend.length ? `  Fehlende Faktoren: ${mech.fehlend.join(', ')}` : '',
    ].filter(Boolean).join('\n')

    const buchung = { zweck: 'mechanik', ausloeser: 'manuell', bezug: { typ: 'symbol', id: symbol } }
    let antwort = await callLLMJson(cfg, { system, user, timeoutMs: 60000, ...buchung })
    if (!antwort.json && antwort.abgeschnitten) {
        // Token-Budget zu klein, nicht der Prompt kaputt — einmal nachlegen.
        // Der erste Versuch wird trotzdem verbucht: bezahlt ist er.
        cfg.maxTokens = 600
        antwort = await callLLMJson(cfg, { system, user, timeoutMs: 60000, ...buchung })
    }
    const text = String(antwort.json?.text || '').trim()
    if (!text) throw new Error('Die KI hat keine verwertbare Einordnung geliefert')

    const payload = { text, state: mech.state, model: cfg.model, costUsd: antwort.costUsd }
    erklaerungCache.set(key, { ts: Date.now(), payload })
    // Deckel: älteste Einträge fallen raus, sonst sammelt jeder Symbolwechsel an
    while (erklaerungCache.size > ERKLAERUNG_MAX) {
        erklaerungCache.delete(erklaerungCache.keys().next().value)
    }
    return { ...payload, cached: false }
}

// ── Kachel: Makro-Umfeld ─────────────────────────────────────────────────

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart'
const CG_COIN_CHART = 'https://api.coingecko.com/api/v3/coins'

/**
 * Bewusst die FUTURES, nicht die Kassa-Indizes: der S&P-500-Index steht
 * nachts und am Wochenende still (beim Bau dieser Kachel war sein letzter
 * Kurs 62 Stunden alt), der Future läuft fast rund um die Uhr — nur so ist
 * der Vergleich mit dem durchlaufenden Krypto-Markt ehrlich.
 */
const MAKRO_MAERKTE = [
    { id: 'sp500', ticker: 'ES=F' },
    { id: 'nasdaq', ticker: 'NQ=F' },
    // Nebenwerte als Gegenprobe zur Nasdaq: laufen NQ und RTY zusammen, ist es
    // eine Liquiditäts- oder Zinsbewegung und betrifft Krypto mit; läuft nur
    // NQ, ist es Rotation in wenige grosse Werte und trägt selten hierher.
    { id: 'russell', ticker: 'RTY=F' },
    // Dollar-Index: kein Future, aber als Index rund um die Uhr fortgeschrieben
    { id: 'dxy', ticker: 'DX-Y.NYB' },
]

const STABLE_COINS = ['tether', 'usd-coin']

// Ab dieser Stille gilt die Börse als geschlossen (Wochenendlücke der Futures
// ist gut eine Stunde am Tag plus Freitagabend bis Sonntagabend).
const MAKRO_STILL_MS = 90 * 60 * 1000

/**
 * Makro-Umfeld: Aktien-Futures, Dollar-Index, Kopplung zu Krypto und
 * Stablecoin-Fluss.
 *
 * Die Kopplung ist der eigentliche Inhalt: „Nasdaq −1 %" allein sagt nichts,
 * solange offen ist, ob der Krypto-Markt gerade daran hängt. Deshalb wird die
 * Korrelation der Tagesrenditen über 30 Tage mitgerechnet und mitgeliefert.
 */
export async function holeMakro() {
    return ausCache('makro', 5 * 60 * 1000, async () => {
        const [charts, btcKerzen, stableReihen] = await Promise.all([
            Promise.all(MAKRO_MAERKTE.map(m => holeJson(
                `${YAHOO_CHART}/${encodeURIComponent(m.ticker)}?range=3mo&interval=1d`, 12000,
            ).catch(() => null))),
            getClosedCandles('BTCUSDT', '1d', 95).catch(() => []),
            Promise.all(STABLE_COINS.map(id => holeJson(
                `${CG_COIN_CHART}/${id}/market_chart?vs_currency=usd&days=30&interval=daily`, 12000,
            ).then(d => d?.market_caps || null).catch(() => null))),
        ])

        const jetzt = Date.now()
        const maerkte = []
        const reihen = {}
        for (let i = 0; i < MAKRO_MAERKTE.length; i++) {
            const def = MAKRO_MAERKTE[i]
            if (!charts[i]) { maerkte.push({ id: def.id, verfuegbar: false }); continue }
            const a = reiheAusChart(charts[i])
            reihen[def.id] = a.reihe
            const still = a.zeit ? jetzt - a.zeit : null
            maerkte.push({
                id: def.id,
                verfuegbar: a.reihe.length > 0,
                preis: a.preis,
                deltaPct: rundeAuf(deltaAusReihe(a.reihe), 2),
                zeit: a.zeit,
                // Ehrlich anschreiben statt einen eingefrorenen Kurs als
                // aktuell zu verkaufen — Krypto läuft weiter, die Börse nicht
                offen: still === null ? null : still < MAKRO_STILL_MS,
            })
        }

        // Krypto-Tagesreihe im selben Format wie die Yahoo-Reihen
        const btcReihe = (btcKerzen || []).map(k => ({
            tag: new Date(k.t).toISOString().slice(0, 10), close: k.c,
        }))

        // Korrelation nur über die letzten ~30 gemeinsamen Handelstage: über ein
        // ganzes Quartal gemittelt verwischt genau der Regimewechsel, auf den es
        // ankommt (Kopplung springt in Risk-off-Phasen).
        const letzte = (r, n) => (r || []).slice(-n)
        const korrNasdaq = korrelationAusReihen(letzte(btcReihe, 45), letzte(reihen.nasdaq, 32))
        const korrRussell = korrelationAusReihen(letzte(btcReihe, 45), letzte(reihen.russell, 32))
        const korrDxy = korrelationAusReihen(letzte(btcReihe, 45), letzte(reihen.dxy, 32))

        const gueltigeStable = stableReihen.filter(Boolean)
        const stable = stableFluss(gueltigeStable, 30)

        // Stablecoin-Menge je Tag — nur Tage, an denen ALLE Coins einen Wert
        // haben, sonst springt die Summe an einer Datenlücke wie ein Abfluss
        const stableNachTag = new Map()
        if (gueltigeStable.length) {
            const zaehler = new Map()
            for (const reihe of gueltigeStable) {
                for (const [ts, wert] of reihe) {
                    if (!Number.isFinite(wert) || wert <= 0) continue
                    const tag = new Date(ts).toISOString().slice(0, 10)
                    const e = zaehler.get(tag) || { summe: 0, n: 0 }
                    e.summe += wert
                    e.n++
                    zaehler.set(tag, e)
                }
            }
            for (const [tag, e] of zaehler) {
                if (e.n === gueltigeStable.length) stableNachTag.set(tag, e.summe)
            }
        }

        // Gesamtmarkt-Historie aus den eigenen Tagesschnappschüssen. Die Menge
        // kommt von CoinGecko, der Gesamtmarkt aus der CoinMarketCap-Reihe —
        // der absolute Dominanz-WERT trägt dadurch einen kleinen Versatz, die
        // Zerlegung der VERÄNDERUNG bleibt davon unberührt.
        let totalNachTag = new Map()
        try {
            const snaps = await getKnex()('market_snapshots')
                .where('kind', 'domMcap')
                .andWhere('dayUnix', '>=', Date.now() - 45 * 86400000)
                .orderBy('dayUnix')
            totalNachTag = new Map(snaps.map(r => [
                new Date(Number(r.dayUnix)).toISOString().slice(0, 10), Number(r.value),
            ]))
        } catch (e) {
            logWarn('marktradar', `Gesamtmarkt-Historie für die Dominanz-Zerlegung fehlt: ${e.message}`)
        }

        const punkte = waehleDominanzPunkte(stableNachTag, totalNachTag, 30)
        const zerlegt = punkte ? zerlegeDominanz(punkte) : null

        return {
            maerkte,
            korrelation: {
                nasdaq: rundeAuf(korrNasdaq.r, 2),
                russell: rundeAuf(korrRussell.r, 2),
                dxy: rundeAuf(korrDxy.r, 2),
                punkte: korrNasdaq.punkte,
                deutung: deuteKorrelation(korrNasdaq.r),
            },
            stablecoins: {
                jetztUsd: stable.jetztUsd,
                deltaUsd: stable.deltaUsd,
                deltaPct: rundeAuf(stable.deltaPct, 2),
                tage: stable.tage,
                verfuegbar: stable.jetztUsd !== null,
            },
            // Dominanz nur ZERLEGT — die blosse Zahl wäre nicht deutbar, weil
            // sie schon steigt, wenn nur die Kurse fallen
            dominanz: zerlegt ? {
                vorherPct: rundeAuf(zerlegt.vorherPct, 2),
                jetztPct: rundeAuf(zerlegt.jetztPct, 2),
                deltaPunkte: rundeAuf(zerlegt.deltaPunkte, 2),
                mengePunkte: rundeAuf(zerlegt.mengePunkte, 2),
                kursPunkte: rundeAuf(zerlegt.kursPunkte, 2),
                tage: punkte.tage,
                von: punkte.tagVon,
                bis: punkte.tagBis,
            } : null,
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
export async function holeRegime(tage = 365) {
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

export async function holeRainbow() {
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
export async function holePiCycle() {
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
export async function holeAltseason(tage = 90) {
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

// ── Kachel: Wal-Transaktionen ────────────────────────────────────────────

/**
 * Grosse Krypto-Transaktionen aus den bereits gesammelten Telegram-Quellen
 * (`news_items`) — keine eigene Fremdquelle, kein zweiter Abruf. Bewusst
 * ohne Kanal-Whitelist: der Parser läuft über ALLE aktiven Telegram-Quellen
 * und behält nur, was er als Wal-Transaktion über der Schwelle erkennt.
 * Kommt der Nutzer später ein fünfter Kanal hinzu, muss hier nichts geändert
 * werden — dieselbe Lehre wie bei `STANDARD_ALARM_REGELN` im Hype-Radar,
 * wo eine zweite, separat gepflegte Liste irgendwann verlässlich abdriftet.
 *
 * `aktiveQuellen` (Anzahl eingeschalteter Telegram-Quellen, nicht nur
 * Wal-Kanäle) lässt die Kachel „keine Quelle aktiv" von „nichts über der
 * Schwelle im Fenster" unterscheiden — dieselbe Unterscheidung wie
 * `gesamtImZeitraum` beim Kalender-Countdown.
 */
export async function holeWalTransaktionen({ stunden = 24, minUsd = 5_000_000 } = {}) {
    const fenster = Math.max(1, Math.min(168, Math.round(Number(stunden)) || 24))
    const schwelle = Math.max(0, Number(minUsd) || 0)

    return ausCache(`wal|${fenster}|${schwelle}`, 5 * 60 * 1000, async () => {
        const knex = getKnex()
        const telegramQuellen = await knex('news_sources').where({ art: 'telegram' })
        const aktive = telegramQuellen.filter(q => Number(q.enabled) === 1)

        if (!aktive.length) {
            return { transaktionen: [], aktiveQuellen: 0, fenster, schwelle }
        }

        const seit = Date.now() - fenster * 60 * 60 * 1000
        const beitraege = await knex('news_items')
            .whereIn('sourceId', aktive.map(q => q.id))
            .where('publishedAt', '>=', seit)
            .select('inhalt', 'url', 'publishedAt', 'sourceId')

        const nameVon = new Map(aktive.map(q => [q.id, q.name]))
        const transaktionen = []
        for (const b of beitraege) {
            const p = parseWalBeitrag(b.inhalt)
            if (!p.erkannt || p.usdWert < schwelle) continue
            transaktionen.push({
                zeit: Number(b.publishedAt),
                betrag: p.betrag,
                symbol: p.symbol,
                usdWert: p.usdWert,
                richtung: p.richtung,
                gegenpartei: p.gegenpartei,
                zuversicht: p.zuversicht,
                quelle: nameVon.get(b.sourceId) || '',
                url: b.url,
            })
        }
        transaktionen.sort((a, b) => b.usdWert - a.usdWert)

        return { transaktionen: transaktionen.slice(0, 30), aktiveQuellen: aktive.length, fenster, schwelle }
    })
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
            sendeRadar(res, await holeFunding(req.query.n, req.query.rang))
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
            sendeRadar(res, await holeLiquidationen(req.query.stunden, req.query.symbol))
        } catch (e) {
            sendRadarError(res, e, 'Liquidationen')
        }
    })

    app.get('/api/marktradar/mechanik', async (req, res) => {
        try {
            if (req.query.force === '1') verwerfeCache('mechanik|')
            sendeRadar(res, await holeMechanik(req.query.symbol, req.query.fenster))
        } catch (e) {
            sendRadarError(res, e, 'Marktmechanik')
        }
    })

    app.get('/api/marktradar/makro', async (req, res) => {
        try {
            if (req.query.force === '1') verwerfeCache('makro')
            sendeRadar(res, await holeMakro())
        } catch (e) {
            sendRadarError(res, e, 'Makro-Umfeld')
        }
    })

    app.get('/api/marktradar/mechanik-erklaerung', async (req, res) => {
        try {
            res.json(await holeMechanikErklaerung(req.query.symbol, req.query.fenster))
        } catch (e) {
            const msg = e?.message || 'Einordnung fehlgeschlagen'
            // Fehlender Schlüssel/Modell ist ein Konfigurationsproblem des
            // Nutzers (400), alles andere ein Ausfall dahinter (502)
            const konfig = /Schlüssel|Modell|Einstellungen/i.test(msg)
            res.status(konfig ? 400 : 502).json({ error: msg })
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

    app.get('/api/marktradar/wale', async (req, res) => {
        try {
            if (req.query.force === '1') verwerfeCache('wal|')
            sendeRadar(res, await holeWalTransaktionen({
                stunden: req.query.stunden, minUsd: req.query.minUsd,
            }))
        } catch (e) {
            sendRadarError(res, e, 'Wal-Transaktionen')
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
