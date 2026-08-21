/**
 * Hype-Radar, Stufe 1: Kandidaten sammeln.
 *
 * Sechs Fremdquellen, die nichts voneinander wissen und unterschiedlich
 * zuverlässig sind. Zwei Regeln bestimmen den Aufbau:
 *
 * 1. **Eine Quelle darf den Lauf nicht kippen.** Jede läuft in ihrem eigenen
 *    try/catch mit Zeitgrenze; was ausfällt, vermerkt der Bericht unter
 *    `quellenStand`. Ein Lauf mit fünf von sechs Quellen ist brauchbar, ein
 *    abgebrochener ist es nicht.
 *
 * 2. **Ein Fund aus einer einzigen Quelle ist kein Hype.** Deshalb wird nach
 *    Vertrag/Symbol zusammengeführt und gezählt, aus wie vielen unabhängigen
 *    Quellen ein Kandidat stammt — diese Zahl ist später der wichtigste
 *    Einzelfaktor gegen gekauften Lärm.
 *
 * KEINE der Quellen braucht einen Schlüssel. Das ist Absicht: das Feature
 * soll nach dem Einschalten laufen, nicht nach dem Anlegen von Konten.
 *
 * CryptoPanic und LunarCrush standen hier bis zum 21.08.2026 und sind geprüft
 * entfernt worden: CryptoPanic hat seinen Gratis-Tarif abgeschafft
 * (günstigster Plan 50 $/Woche) und den Endpunkt auf /api/{plan}/v2/
 * umgestellt, LunarCrush war nie gratis (ab 90 $/Monat).
 *
 * Reddit war am selben Tag zuerst mit entfernt und ist dann zurückgekommen.
 * Der Grund für die Kehrtwende ist eine Messung: `/hot.json` ergab in vier
 * von vier Versuchen 403, `/hot.rss` mit DERSELBEN Kennung 200. Gesperrt war
 * nicht die Quelle, sondern der Weg dorthin. Eine fremde Kennung braucht es
 * dafür nicht — im Gegenteil, mit einer Browser-Kennung kam die Drosselung
 * früher.
 */

import { logWarn } from '../logger.js'
import { leseFeed } from '../feed-parser.js'

/** Zeitgrenze je Einzelabruf. Lieber eine Quelle weniger als ein hängender Lauf. */
const ABRUF_TIMEOUT_MS = 10000

/**
 * Erlaubte Gegenstellen.
 *
 * Der Radar ruft ausschliesslich diese Hosts. Anders als bei den
 * Nachrichtenquellen gibt der Nutzer hier keine Adressen ein — es gibt also
 * auch keinen Grund, beliebige zuzulassen (vgl. `net-guard.js`, das für den
 * umgekehrten Fall gebaut ist).
 */
export const ERLAUBTE_HOSTS = new Set([
    'api.coingecko.com',
    'api.dexscreener.com',
    'api.geckoterminal.com',
    'api.gopluslabs.io',
    'api.rugcheck.xyz',
    'www.reddit.com',
    'frontend-api-v3.pump.fun',
    'api.coinpaprika.com',
])

/**
 * Einfacher Eimer je Host.
 *
 * DexScreener lässt 60 Anfragen je Minute auf die Trend-Endpunkte und 300 auf
 * Suche und Paare. Ohne Bremse rennt ein Lauf mit hundert Kandidaten sofort in
 * ein 429, und dann fehlen genau die Detaildaten, auf denen die Bewertung
 * beruht.
 */
class Eimer {
    constructor(proMinute) {
        this.abstandMs = Math.ceil(60000 / proMinute)
        this.frei = 0
    }

    async warte() {
        const jetzt = Date.now()
        const start = Math.max(jetzt, this.frei)
        this.frei = start + this.abstandMs
        const warten = start - jetzt
        if (warten > 0) await new Promise((r) => setTimeout(r, warten))
    }
}

const EIMER = {
    'api.dexscreener.com': new Eimer(50),      // Reserve zu den erlaubten 60
    'api.coingecko.com': new Eimer(25),        // Demo-Kontingent ~30
    'api.geckoterminal.com': new Eimer(25),
    'api.gopluslabs.io': new Eimer(30),
    /*
     * Reddit drosselt spürbar. Gemessen am 21.08.2026: bei 20 s Abstand kam
     * nur jeder zweite Abruf durch, bei 60 s jeder. Eins je Minute ist die
     * ehrliche Obergrenze — bei zwei Unterforen und einem Lauf alle sechs
     * Stunden kostet das zwei Minuten und fällt nicht ins Gewicht.
     */
    'www.reddit.com': new Eimer(1),
    'frontend-api-v3.pump.fun': new Eimer(20),
    'api.coinpaprika.com': new Eimer(10),
}

/**
 * Wie `holeJson`, aber für Text — RSS und Atom kommen als XML.
 *
 * Eigene Funktion statt eines Schalters an `holeJson`: Dort steht `Accept:
 * application/json` im Kopf, und ein Feed-Server darf darauf mit 406
 * antworten. Der Rest (Whitelist, Bremse, eine Wiederholung) ist derselbe.
 */
export async function holeText(url, { timeout = ABRUF_TIMEOUT_MS, kopf = {} } = {}) {
    const ziel = new URL(url)
    if (!ERLAUBTE_HOSTS.has(ziel.hostname)) {
        throw new Error(`Host nicht erlaubt: ${ziel.hostname}`)
    }
    await EIMER[ziel.hostname]?.warte()

    let letzterFehler
    for (let versuch = 0; versuch < 2; versuch++) {
        const abbruch = new AbortController()
        const uhr = setTimeout(() => abbruch.abort(), timeout)
        try {
            const r = await fetch(url, {
                signal: abbruch.signal,
                headers: {
                    'User-Agent': 'CryptoTradingJournal/1.0 (Hype-Radar)',
                    Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
                    ...kopf,
                },
            })
            if (!r.ok) {
                const fehler = new Error(`HTTP ${r.status}`)
                /*
                 * 429 ist hier NICHT endgültig: Reddit drosselt, und genau
                 * dafür ist die Wiederholung da. Bei 403 dagegen hilft kein
                 * zweiter Versuch — das ist eine Entscheidung, keine Last.
                 */
                if (r.status < 500 && r.status !== 429) throw Object.assign(fehler, { endgueltig: true })
                throw fehler
            }
            return await r.text()
        } catch (e) {
            letzterFehler = e
            if (e.endgueltig || versuch === 1) break
            await new Promise((r) => setTimeout(r, 2000))
        } finally {
            clearTimeout(uhr)
        }
    }
    throw letzterFehler
}

/**
 * Abruf mit Zeitgrenze, Bremse und einer Wiederholung.
 *
 * Wiederholt wird nur einmal und nur bei Netzfehlern oder 5xx: ein 404 wird
 * beim zweiten Mal auch nicht besser, und ein 429 wäre mit sofortigem
 * Nachfassen genau die falsche Antwort.
 */
export async function holeJson(url, { timeout = ABRUF_TIMEOUT_MS, kopf = {} } = {}) {
    const ziel = new URL(url)
    if (!ERLAUBTE_HOSTS.has(ziel.hostname)) {
        throw new Error(`Host nicht erlaubt: ${ziel.hostname}`)
    }
    await EIMER[ziel.hostname]?.warte()

    let letzterFehler
    for (let versuch = 0; versuch < 2; versuch++) {
        const abbruch = new AbortController()
        const uhr = setTimeout(() => abbruch.abort(), timeout)
        try {
            const r = await fetch(url, {
                signal: abbruch.signal,
                headers: {
                    // Eigene Kennung: manche Anbieter weisen anonyme Anfragen ab.
                    'User-Agent': 'CryptoTradingJournal/1.0 (Hype-Radar)',
                    Accept: 'application/json',
                    ...kopf,
                },
            })
            if (!r.ok) {
                const fehler = new Error(`HTTP ${r.status}`)
                // Nur bei Serverfehlern nachfassen.
                if (r.status < 500) throw Object.assign(fehler, { endgueltig: true })
                throw fehler
            }
            return await r.json()
        } catch (e) {
            letzterFehler = e
            if (e.endgueltig || versuch === 1) break
            await new Promise((r) => setTimeout(r, 800))
        } finally {
            clearTimeout(uhr)
        }
    }
    throw letzterFehler
}

/** Symbol vereinheitlichen — „$PEPE" und „pepe" sind derselbe Fund. */
export function normSymbol(roh) {
    return String(roh || '').trim().replace(/^\$/, '').toUpperCase().slice(0, 20)
}

/** Kettenname vereinheitlichen; die Quellen schreiben sie verschieden. */
export function normChain(roh) {
    const c = String(roh || '').trim().toLowerCase()
    const karte = {
        eth: 'ethereum', ethereum: 'ethereum',
        sol: 'solana', solana: 'solana',
        bsc: 'bsc', 'binance-smart-chain': 'bsc', bnb: 'bsc',
        base: 'base', arbitrum: 'arbitrum', 'arbitrum-one': 'arbitrum',
        polygon: 'polygon', 'polygon-pos': 'polygon', avalanche: 'avalanche',
    }
    return karte[c] || c
}

/**
 * Ein Fund, wie ihn jede Quelle liefert.
 *
 * Bewusst flach und tolerant: Fremdantworten haben ständig fehlende Felder,
 * und ein Fund ohne Preis ist immer noch ein Fund.
 */
function fund({ symbol, name = '', chain = '', contract = '', pair = '', quelle, rang = 0, url = '', markt = {}, sozial = {} }) {
    return {
        symbol: normSymbol(symbol),
        name: String(name || '').slice(0, 120),
        chain: normChain(chain),
        contract: String(contract || '').trim(),
        pair: String(pair || '').trim(),
        quelle: { quelle, rang, url, geholtAm: Date.now() },
        markt,
        sozial,
    }
}

// ── Die einzelnen Quellen ────────────────────────────────────────────────
//
// Jede liefert eine Liste von Funden und wirft im Fehlerfall. Das Auffangen
// passiert eine Ebene höher, damit hier keine Quelle den Ausfall einer anderen
// verstecken kann.

/** CoinGecko: wonach gerade gesucht wird. Kein Schlüssel nötig. */
export async function ausCoinGecko(schluessel = '') {
    const url = 'https://api.coingecko.com/api/v3/search/trending'
    const kopf = schluessel ? { 'x-cg-demo-api-key': schluessel } : {}
    const j = await holeJson(url, { kopf })
    return (j?.coins || []).map((c, i) => fund({
        symbol: c?.item?.symbol,
        name: c?.item?.name,
        quelle: 'coingecko',
        rang: i + 1,
        url: c?.item?.slug ? `https://www.coingecko.com/en/coins/${c.item.slug}` : '',
        markt: {
            marketCapRang: c?.item?.market_cap_rank ?? null,
            preisUsd: Number(c?.item?.data?.price) || null,
            aenderung24h: Number(c?.item?.data?.price_change_percentage_24h?.usd) || null,
        },
    })).filter((f) => f.symbol)
}

/**
 * DexScreener: bezahlte Hervorhebungen und neue Profile.
 *
 * Wichtig zur Einordnung: „geboostet" heisst, dass jemand für Sichtbarkeit
 * bezahlt hat — das ist ein Aufmerksamkeitssignal, ausdrücklich kein
 * Gütesiegel. Genau deshalb zählt später, ob eine zweite Quelle zustimmt.
 */
export async function ausDexScreener() {
    const funde = []
    const [boosts, profile] = await Promise.allSettled([
        holeJson('https://api.dexscreener.com/token-boosts/top/v1'),
        holeJson('https://api.dexscreener.com/token-profiles/latest/v1'),
    ])

    if (boosts.status === 'fulfilled') {
        const liste = Array.isArray(boosts.value) ? boosts.value : []
        liste.slice(0, 30).forEach((b, i) => funde.push(fund({
            // Kein Symbol: die Trend-Endpunkte nennen nur die Adresse. Es
            // aus ihr zu basteln wäre ein Platzhalter, der später als echtes
            // Symbol gälte und jede Zusammenführung verhinderte.
            symbol: '',
            chain: b?.chainId,
            contract: b?.tokenAddress,
            quelle: 'dexscreener-boost',
            rang: i + 1,
            url: b?.url || '',
            sozial: { boostGesamt: Number(b?.totalAmount) || 0 },
        })))
    }
    if (profile.status === 'fulfilled') {
        const liste = Array.isArray(profile.value) ? profile.value : []
        liste.slice(0, 30).forEach((p, i) => funde.push(fund({
            symbol: '',
            chain: p?.chainId,
            contract: p?.tokenAddress,
            quelle: 'dexscreener-neu',
            rang: i + 1,
            url: p?.url || '',
        })))
    }
    if (!funde.length && boosts.status === 'rejected' && profile.status === 'rejected') {
        throw boosts.reason || profile.reason
    }
    return funde.filter((f) => f.contract)
}

/**
 * Detaildaten zu einem Vertrag nachschlagen.
 *
 * Die Trend-Endpunkte liefern kaum mehr als eine Adresse. Erst hier kommen
 * Liquidität, Volumen, Alter und das Kauf/Verkauf-Verhältnis dazu — die Zahlen,
 * auf denen Bewertung und Sicherheitsprüfung beruhen.
 */
export async function dexDetails(contract) {
    const karte = await dexDetailsViele([contract])
    return karte.get(String(contract).toLowerCase()) || null
}

/** Wie viele Adressen DexScreener je Abruf annimmt. */
const SAMMEL_GROESSE = 30

/**
 * Detaildaten für VIELE Verträge — in Häppchen zu dreissig.
 *
 * Der Grund ist nicht Geschwindigkeit, sondern Reihenfolge. Die
 * DexScreener-Trendlisten liefern nur Adressen: kein Symbol, kein Alter, kein
 * Volumen. In der Vorsortierung bekamen diese Funde deshalb Volumen 0,
 * Neuheit 0 und Narrativ 0 — sie fielen bei rund zehn Punkten aus den besten
 * vierzig, BEVOR die Daten geholt wurden, die sie überhaupt bewertbar machen.
 * Ausgerechnet die frischesten Funde wurden so systematisch aussortiert.
 *
 * Mit dem Sammelabruf sind alle sechzig in zwei Anfragen angereichert, und die
 * Rangfolge entsteht zum ersten Mal auf vergleichbarer Grundlage.
 *
 * @param {string[]} contracts
 * @returns {Promise<Map<string, object>>} Adresse (klein) → Details
 */
export async function dexDetailsViele(contracts = []) {
    const raus = new Map()
    const liste = [...new Set(contracts.filter(Boolean).map(String))]

    for (let i = 0; i < liste.length; i += SAMMEL_GROESSE) {
        const teil = liste.slice(i, i + SAMMEL_GROESSE)
        let paare = []
        try {
            const j = await holeJson(
                `https://api.dexscreener.com/latest/dex/tokens/${teil.map(encodeURIComponent).join(',')}`)
            paare = Array.isArray(j?.pairs) ? j.pairs : []
        } catch (e) {
            // Ein Häppchen, das klemmt, darf die übrigen nicht mitnehmen.
            logWarn('hype-radar', `DexScreener-Sammelabruf: ${e.message}`)
            continue
        }

        /*
         * Jedes Paar der angefragten Adresse zuordnen — und zwar auf DER
         * SEITE, auf der sie steht.
         *
         * `dexDetails` las früher immer `baseToken`. Live geprüft: Für drei
         * angefragte Adressen kamen vier verschiedene Basis-Token zurück, weil
         * eine der Adressen in ihrem Paar die GEGENWÄHRUNG ist. Wer blind die
         * Basisseite nimmt, schreibt einem Fund Symbol, Name und Marktwerte
         * eines fremden Tokens zu — bei jungen Token ein Vertrauensbruch.
         */
        const gesucht = new Map(teil.map((a) => [a.toLowerCase(), a]))
        for (const p of paare) {
            const basis = String(p?.baseToken?.address || '').toLowerCase()
            const gegen = String(p?.quoteToken?.address || '').toLowerCase()
            const seite = gesucht.has(basis) ? 'base' : (gesucht.has(gegen) ? 'quote' : null)
            if (!seite) continue
            const schluessel = seite === 'base' ? basis : gegen

            // Das liquideste Paar ist das aussagekräftigste: dort findet der
            // Handel statt.
            const bisher = raus.get(schluessel)
            const liqNeu = Number(p?.liquidity?.usd) || 0
            if (bisher && bisher._liq >= liqNeu) continue
            raus.set(schluessel, { ...ausPaar(p, seite), _liq: liqNeu })
        }
    }

    for (const d of raus.values()) delete d._liq
    return raus
}

/**
 * Ein DexScreener-Paar in unsere Form bringen.
 *
 * @param {object} p      das Paar
 * @param {string} seite  'base' oder 'quote' — auf welcher Seite der gesuchte
 *                        Token steht. Davon hängt ab, wessen Symbol und Name
 *                        übernommen werden.
 */
function ausPaar(p, seite = 'base') {
    const token = seite === 'quote' ? p?.quoteToken : p?.baseToken
    const kaeufe = Number(p?.txns?.h24?.buys) || 0
    const verkaeufe = Number(p?.txns?.h24?.sells) || 0
    return {
        symbol: normSymbol(token?.symbol),
        name: token?.name || '',
        chain: normChain(p?.chainId),
        pair: p?.pairAddress || '',
        url: p?.url || '',
        /*
         * Steht der gesuchte Token auf der Gegenseite, beziehen sich Preis,
         * Volumen und Liquidität des Paars NICHT auf ihn. Der Hinweis bleibt
         * am Fund, statt still falsche Zahlen zu übernehmen.
         */
        seite,
        markt: {
            // Der Handelsplatz selbst (raydium, uniswap, pancakeswap …) — die
            // Antwort auf „wo läuft das eigentlich", die sonst erst ein Klick
            // auf DexScreener beantwortet hätte. In `markt`, weil die
            // Zusammenführung nur diese Felder überträgt.
            dex: String(p?.dexId || ''),
            preisUsd: Number(p?.priceUsd) || null,
            liquiditaetUsd: Number(p?.liquidity?.usd) || 0,
            volumen24h: Number(p?.volume?.h24) || 0,
            volumen6h: Number(p?.volume?.h6) || 0,
            volumen1h: Number(p?.volume?.h1) || 0,
            fdv: Number(p?.fdv) || 0,
            marktkapitalisierung: Number(p?.marketCap) || 0,
            aenderung24h: zahlOderNull(p?.priceChange?.h24),
            /*
             * Die kurzen Fenster sind das eigentliche Frühsignal.
             *
             * Bisher wurde nur die Tagesveränderung behalten — bei einem Coin,
             * der in der letzten Stunde um 238 % gestiegen ist, sagt die aber
             * nichts über das, was gerade passiert. DexScreener liefert alle
             * vier Fenster im selben Abruf; sie wegzuwerfen war schlicht
             * verschenkt.
             */
            aenderung6h: zahlOderNull(p?.priceChange?.h6),
            aenderung1h: zahlOderNull(p?.priceChange?.h1),
            aenderung5m: zahlOderNull(p?.priceChange?.m5),
            paarAlterStunden: p?.pairCreatedAt
                ? Math.max(0, (Date.now() - Number(p.pairCreatedAt)) / 3600000)
                : null,
            kaufVerkaufVerhaeltnis: verkaeufe > 0 ? kaeufe / verkaeufe : (kaeufe > 0 ? 99 : null),
            transaktionen24h: kaeufe + verkaeufe,
            transaktionen1h: (Number(p?.txns?.h1?.buys) || 0) + (Number(p?.txns?.h1?.sells) || 0),
            kaufVerkauf1h: verhaeltnis(p?.txns?.h1),
            /*
             * BEZAHLTE SICHTBARKEIT — der Wert, um den es hier eigentlich geht.
             *
             * Ein „Boost" ist ein gekaufter Platz in den DexScreener-Listen.
             * Der Radar warnt an mehreren Stellen vor gekauftem Lärm und hat
             * ihn bisher nur aus dem Missverhältnis zwischen Gerede und Handel
             * ERSCHLOSSEN — dabei steht er hier als Zahl. Wer sich Reichweite
             * kauft, soll dafür keine Aufmerksamkeitspunkte bekommen.
             */
            boosts: Number(p?.boosts?.active) || 0,
            // Vorhandensein von Seite und Kanälen: kein Beweis für Substanz,
            // aber ihr Fehlen ist ein Hinweis. Nur die Anzahl, keine Adressen —
            // die Anzeige verlinkt ohnehin auf DexScreener.
            webseiten: (p?.info?.websites || []).length,
            kanaele: (p?.info?.socials || []).length,
            bild: p?.info?.imageUrl || '',
        },
    }
}

const zahlOderNull = (w) => (Number.isFinite(Number(w)) ? Number(w) : null)

const verhaeltnis = (t) => {
    const k = Number(t?.buys) || 0
    const v = Number(t?.sells) || 0
    if (v > 0) return k / v
    return k > 0 ? 99 : null
}

/** GeckoTerminal: was on-chain gerade läuft, je Kette. */
export async function ausGeckoTerminal(ketten = ['solana', 'eth', 'base', 'bsc']) {
    const funde = []
    for (const kette of ketten) {
        try {
            /*
             * `include=base_token` liefert den Basis-Token als eigenes Objekt.
             *
             * Vorher entstand das Symbol aus `poolName.split('/')[0]` — also
             * aus einer Zeichenkette, die zufällig so aussieht wie ein Symbol.
             * Zwei Folgen: Bei einem Pool wie „USDC / MEME" wurde die
             * Gegenwährung zum Fund, und es gab NIE eine Vertragsadresse.
             * Ohne Adresse kann weder der Detailabruf noch die
             * Sicherheitsprüfung etwas ausrichten — jeder GeckoTerminal-Fund
             * landete zwangsläufig bei „ungeprüft" und war damit von vornherein
             * chancenlos. Die Beziehung stand die ganze Zeit in derselben
             * Antwort.
             */
            const j = await holeJson(
                `https://api.geckoterminal.com/api/v2/networks/${kette}/trending_pools?include=base_token`)
            const liste = Array.isArray(j?.data) ? j.data : []
            const tokens = new Map((Array.isArray(j?.included) ? j.included : [])
                .filter((t) => t?.type === 'token')
                .map((t) => [t.id, t.attributes || {}]))

            liste.slice(0, 15).forEach((p, i) => {
                const basisId = p?.relationships?.base_token?.data?.id
                const basis = tokens.get(basisId) || {}
                // Notfalls die erste Seite des Poolnamens — aber nur, wenn die
                // Beziehung fehlt; sie ist die verlässliche Quelle.
                const symbol = basis.symbol || String(p?.attributes?.name || '').split('/')[0]
                const a = p?.attributes || {}
                funde.push(fund({
                    symbol,
                    name: basis.name || String(symbol).trim(),
                    chain: kette,
                    contract: basis.address || '',
                    pair: a.address || '',
                    quelle: 'geckoterminal',
                    rang: i + 1,
                    markt: {
                        preisUsd: Number(a.base_token_price_usd) || null,
                        volumen24h: Number(a.volume_usd?.h24) || 0,
                        liquiditaetUsd: Number(a.reserve_in_usd) || 0,
                        // Ebenfalls in derselben Antwort und bisher liegen
                        // gelassen: Alter und Bewertung tragen unmittelbar in
                        // die Neuheits- und Sicherheitsnote.
                        fdv: Number(a.fdv_usd) || 0,
                        marktkapitalisierung: Number(a.market_cap_usd) || 0,
                        aenderung24h: zahlOderNull(a.price_change_percentage?.h24),
                        aenderung1h: zahlOderNull(a.price_change_percentage?.h1),
                        paarAlterStunden: a.pool_created_at
                            ? Math.max(0, (Date.now() - new Date(a.pool_created_at).getTime()) / 3600000)
                            : null,
                    },
                }))
            })
        } catch (e) {
            // Eine Kette, die klemmt, darf die übrigen nicht mitnehmen.
            logWarn('hype-radar', `GeckoTerminal ${kette}: ${e.message}`)
        }
    }
    if (!funde.length) throw new Error('keine Kette lieferte Daten')
    return funde.filter((f) => f.symbol)
}

/**
 * Reddit — über den RSS-Feed, nicht über die JSON-Schnittstelle.
 *
 * Der alte Weg (`/hot.json`) ist tot: vier von vier Abrufen am 21.08.2026
 * ergaben 403, und daran ändert auch eine Kennung nichts. `/hot.rss` dagegen
 * antwortet derselben Kennung mit 200 — es ist ein öffentlicher Feed, für
 * Leseprogramme gedacht, und wir geben uns dabei als das aus, was wir sind.
 *
 * Gedrosselt wird spürbar (siehe `EIMER`). Der Feed liefert die Beitrags-
 * titel samt Textvorschau; daraus werden `$SYMBOL`-Nennungen und
 * Vertragsadressen gezogen. Gemessen an r/CryptoMoonShots: aus 25 Beiträgen
 * 7 Symbole, 5 Solana- und 8 EVM-Adressen.
 *
 * Das ist die EINZIGE Quelle der Domäne `social` — Menschen, die reden, statt
 * Ketten, die handeln. Genau deshalb ist sie den Aufwand wert, obwohl das
 * Rauschen hoch ist: Sie bestätigt unabhängig von allem anderen.
 */
export async function ausReddit(unterforen = ['CryptoMoonShots', 'SolanaMemeCoins']) {
    const funde = []
    for (const sub of unterforen) {
        try {
            const xml = await holeText(`https://www.reddit.com/r/${encodeURIComponent(sub)}/hot.rss?limit=50`)
            const beitraege = leseFeed(xml)
            for (const b of beitraege) {
                const text = `${b.titel || ''} ${b.inhalt || ''}`
                /*
                 * Die Stimmenzahl steht im RSS NICHT — anders als in der alten
                 * JSON-Antwort. Statt eine zu erfinden, zählt die POSITION:
                 * „hot" ist bereits nach Zustimmung sortiert, der erste
                 * Beitrag hat mehr davon als der fünfzigste. Eine erfundene
                 * Stimmenzahl wäre eine Messung, die nie stattfand.
                 */
                const rang = beitraege.indexOf(b) + 1
                const kuerzel = text.match(/\$([A-Za-z][A-Za-z0-9]{1,9})\b/g) || []
                const evm = text.match(/0x[a-fA-F0-9]{40}/g) || []
                const sol = text.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g) || []
                for (const k of kuerzel.slice(0, 3)) {
                    funde.push(fund({
                        symbol: k.slice(1),
                        quelle: `reddit-${sub}`,
                        url: b.link || '',
                        contract: evm[0] || sol[0] || '',
                        rang,
                        /*
                         * NUR der Rang, keine erfundene Stimmenzahl.
                         *
                         * Im ersten Anlauf stand hier `stimmen: 51 - rang` —
                         * eine Zahl, die aussieht wie gemessene Zustimmung und
                         * keine ist. Der Feed nennt Stimmen nicht; „Platz 7 in
                         * hot" ist alles, was wir wissen, und genau das steht
                         * jetzt da.
                         */
                        sozial: { redditRang: rang },
                    }))
                }
            }
        } catch (e) {
            logWarn('hype-radar', `Reddit ${sub}: ${e.message}`)
        }
    }
    if (!funde.length) throw new Error('kein Unterforum lieferte Daten')
    return funde
}

/**
 * Pump.fun — die frischesten Solana-Starts.
 *
 * Der Wert dieser Quelle ist der ZEITPUNKT. Ein Token auf der Bindungskurve
 * hat noch keinen Raydium-Pool und taucht deshalb weder bei DexScreener noch
 * bei GeckoTerminal auf. Gemessen am 21.08.2026 waren die obersten Einträge
 * null Stunden alt, mit Marktkapitalisierungen zwischen 680 und 108'000 USD.
 *
 * Der alte Host `frontend-api.pump.fun` ist abgeschaltet (HTTP 530); der
 * v3-Host antwortet ohne Schlüssel.
 *
 * Domäne bleibt `onchain`: Auch eine Bindungskurve ist gehandelte Kette, nur
 * an einem anderen Ort. Als eigene Bestätigung neben DexScreener zu zählen
 * wäre derselbe Fehler, den das Audit im August behoben hat.
 */
export async function ausPumpFun(anzahl = 50) {
    const j = await holeJson(
        `https://frontend-api-v3.pump.fun/coins?limit=${Math.min(100, anzahl)}`
        + '&sort=created_timestamp&order=DESC&includeNsfw=false')
    const liste = Array.isArray(j) ? j : []
    return liste
        .map((c, i) => {
            const erstellt = Number(c?.created_timestamp) || 0
            const alterStunden = erstellt ? (Date.now() - erstellt) / 3600000 : null
            return fund({
                symbol: c?.symbol,
                name: c?.name || '',
                chain: 'solana',
                contract: c?.mint || '',
                quelle: 'pumpfun',
                rang: i + 1,
                url: c?.mint ? `https://pump.fun/coin/${c.mint}` : '',
                markt: {
                    marktKapUsd: Number(c?.usd_market_cap) || null,
                    paarAlterStunden: alterStunden,
                    // `complete` heisst: die Kurve ist durch, der Token ist an
                    // eine echte Börse gewandert. Das ist ein Reifezeichen.
                    graduiert: c?.complete === true,
                },
            })
        })
        .filter((f) => f.symbol)
}

/**
 * CoinPaprika — zweite Meinung zur Entdeckung.
 *
 * Anderes Haus als CoinGecko, eigene Redaktion, eigene Aufnahmekriterien.
 * Deshalb ist es keine Verdopplung derselben Liste, sondern eine unabhängige
 * Bestätigung INNERHALB der Domäne `discovery` — sie erhöht die Datenqualität,
 * nicht die Zahl der Belege.
 *
 * Gemessen: 61'083 Coins, davon 14'974 aktiv und 71 mit `is_new`-Marke.
 *
 * ⚠ Die Antwort ist 7,4 MB gross, und `limit` wird ignoriert (geprüft). Bei
 * einem Lauf alle sechs Stunden sind das rund 30 MB am Tag — vertretbar, aber
 * der Grund, warum diese Quelle nicht öfter befragt werden sollte.
 */
export async function ausCoinPaprika() {
    const j = await holeJson('https://api.coinpaprika.com/v1/coins', { timeout: 25000 })
    const liste = Array.isArray(j) ? j : []
    return liste
        .filter((c) => c?.is_new && c?.is_active)
        .slice(0, 60)
        .map((c, i) => fund({
            symbol: c?.symbol,
            name: c?.name || '',
            quelle: 'coinpaprika',
            rang: Number(c?.rank) > 0 ? Number(c.rank) : i + 1,
        }))
        .filter((f) => f.symbol)
}

/**
 * Funde zu Kandidaten zusammenführen.
 *
 * Zusammengeführt wird bevorzugt über die Vertragsadresse — sie ist eindeutig,
 * während Symbole sich wiederholen: „PEPE" gibt es auf vier Ketten und
 * hundertfach als Nachahmung. Nur wo keine Adresse vorliegt (CoinGecko),
 * dient Symbol samt Kette als Notbehelf (CoinGecko liefert keine Adresse).
 */
export function fuehreZusammen(funde) {
    const nachSchluessel = new Map()

    for (const f of funde) {
        /*
         * Die VERTRAGSADRESSE führt, das Symbol ist der Notbehelf.
         *
         * Bis zum Audit vom 19.08.2026 war es umgekehrt — und der
         * Kopfkommentar dieser Funktion behauptete schon damals das Richtige,
         * ohne dass der Code es tat. Der Grund für die Umkehrung ist im
         * Kommentar von damals nachlesbar und war für seine Zeit korrekt:
         * DexScreener lieferte Adressen ohne Symbol, CoinGecko Symbole ohne
         * Adresse, die Schlüssel trafen sich nie und die Quellenzahl blieb 1.
         *
         * Seit R-03 (Sammelanreicherung vor der Vorsortierung) haben die
         * DexScreener-Funde ihr Symbol, bevor zusammengeführt wird — der Grund
         * ist damit weg. Geblieben war nur die Gefahr: „PEPE" gibt es auf vier
         * Ketten und hundertfach als Nachahmung. Zwei verschiedene Verträge
         * mit gleichem Kürzel wurden zu EINEM Kandidaten, der die Quellenzahl,
         * die Marktdaten und das Sicherheitsurteil des jeweils anderen erbte.
         * Bei jungen Token ist das kein Schönheitsfehler.
         */
        const vertrag = String(f.contract || '').toLowerCase()
        const schluessel = vertrag
            ? `c:${f.chain || '?'}|${vertrag}`
            : (f.symbol ? `s:${f.symbol}|${f.chain || '?'}` : '')
        if (!schluessel) continue

        if (!nachSchluessel.has(schluessel)) {
            nachSchluessel.set(schluessel, {
                symbol: f.symbol,
                name: f.name,
                chain: f.chain,
                contract: f.contract,
                pair: f.pair,
                quellen: [],
                markt: {},
                sozial: {},
            })
        }
        const k = nachSchluessel.get(schluessel)
        // Nimmt beide Formen an: einen frischen Fund (`quelle`) und einen
        // bereits zusammengeführten Kandidaten (`quellen`). Der zweite
        // Durchgang nach dem Detailabruf braucht das.
        if (Array.isArray(f.quellen)) k.quellen.push(...f.quellen)
        if (f.quelle) k.quellen.push(f.quelle)
        // Erste brauchbare Angabe gewinnt; spätere füllen nur Lücken.
        if (!k.symbol && f.symbol) k.symbol = f.symbol
        if (!k.name && f.name) k.name = f.name
        if (!k.chain && f.chain) k.chain = f.chain
        if (!k.contract && f.contract) k.contract = f.contract
        if (!k.pair && f.pair) k.pair = f.pair
        Object.assign(k.markt, Object.fromEntries(
            Object.entries(f.markt || {}).filter(([, v]) => v !== null && v !== undefined)))
        for (const [feld, wert] of Object.entries(f.sozial || {})) {
            if (wert === null || wert === undefined) continue
            // Zahlen aufaddieren (drei Nennungen sind mehr als eine),
            // alles andere überschreiben.
            k.sozial[feld] = typeof wert === 'number' ? (k.sozial[feld] || 0) + wert : wert
        }
    }

    /*
     * Zwei Nachlesen, beide nach derselben Regel: Ein ungenauerer Eintrag
     * schliesst sich einem genaueren an — aber NUR, wenn es genau einen
     * passenden gibt. Bei mehreren bliebe es Raten, und ein falsch
     * verschmolzener Kandidat ist schlimmer als ein doppelter: er trüge die
     * Quellenzahl und das Sicherheitsurteil eines anderen Coins.
     */
    // 1. Symbol samt Kette, aber ohne Adresse → Eintrag mit Adresse.
    //    Betrifft CoinGecko, das keine Adresse nennt.
    schliesseAn(nachSchluessel,
        (sl, k) => sl.startsWith('s:') && k.chain && k.chain !== '?',
        (k, k2) => k2.contract && k2.symbol === k.symbol && k2.chain === k.chain)

    // 2. Symbol ohne Kette → irgendein Eintrag mit diesem Symbol.
    //    „PEPE ohne Kette" und „PEPE auf solana" sind mit hoher
    //    Wahrscheinlichkeit derselbe Fund — solange es nur einen gibt.
    schliesseAn(nachSchluessel,
        (sl) => sl.startsWith('s:') && sl.endsWith('|?'),
        (k, k2) => k2.symbol === k.symbol && k2.chain && k2.chain !== '?')

    return [...nachSchluessel.values()].map((k) => {
        const domaenen = evidenzDomaenen(k.quellen)
        return {
            ...k,
            /*
             * Die entscheidende Zahl: aus wie vielen unabhängigen EVIDENZ-
             * DOMÄNEN stammt der Fund — nicht aus wie vielen Anbietern.
             *
             * Bis zum Audit vom 19.08.2026 wurden Anbieter gezählt (die beiden
             * DexScreener-Endpunkte immerhin schon als einer). Nur lesen
             * DexScreener und GeckoTerminal DIESELBEN On-chain-Pools: ein
             * einzelner Pump löst beide zugleich aus und sah damit aus wie
             * zwei unabhängige Bestätigungen. Da diese Zahl der stärkste
             * Einzelfaktor gegen gekauften Lärm ist, war das die teuerste
             * Lücke der Bewertung.
             *
             * Mehrere Anbieter derselben Domäne erhöhen die Datenqualität,
             * nicht die Bestätigung.
             */
            quellenAnzahl: domaenen.length,
            evidenzDomaenen: domaenen,
            // Die Anbieterzahl bleibt sichtbar: sie erklärt, warum eine Zahl
            // kleiner ausfällt als die Liste der Quellen vermuten liesse.
            anbieterAnzahl: new Set(k.quellen.map((q) => String(q.quelle).split('-')[0])).size,
        }
    })
}

/**
 * Welcher Quelle welche Art von Beleg zuzurechnen ist.
 *
 * `discovery`  jemand hat den Fund in eine Liste gestellt (Suchinteresse,
 *              bezahlte Sichtbarkeit, neues Profil) — sagt nichts über Handel
 * `onchain`    tatsächlicher Handel in einem Pool. DexScreener und
 *              GeckoTerminal aggregieren dieselben Pools; zwei Anbieter, EIN
 *              Beleg.
 * `social`     Menschen reden darüber
 * `news`       redaktionelle Erwähnung
 */
const QUELL_DOMAENE = {
    coingecko: 'discovery',
    'dexscreener-boost': 'discovery',    // bezahlt — ausdrücklich kein Handelsbeleg
    'dexscreener-neu': 'discovery',      // frisch eingereichtes Profil
    dexscreener: 'onchain',
    geckoterminal: 'onchain',
    // Auch eine Bindungskurve ist gehandelte Kette — nur an anderem Ort.
    pumpfun: 'onchain',
    // Eigenes Haus, eigene Aufnahmekriterien — aber dieselbe Frage wie CoinGecko.
    coinpaprika: 'discovery',
    // Die einzige Quelle, in der Menschen reden statt Ketten zu handeln.
    reddit: 'social',
}

/** Die belegten Domänen eines Kandidaten, ohne Wiederholung. */
export function evidenzDomaenen(quellen = []) {
    const raus = new Set()
    for (const q of quellen) {
        const name = String(q?.quelle || '')
        // Erst der volle Name (`dexscreener-boost`), dann der Anbieter.
        const d = QUELL_DOMAENE[name] || QUELL_DOMAENE[name.split('-')[0]]
        if (d) raus.add(d)
    }
    return [...raus]
}

/**
 * Einen ungenaueren Eintrag einem genaueren anschliessen — nur bei
 * Eindeutigkeit.
 *
 * @param {Map} karte     Schlüssel → Kandidat
 * @param {function} istVage   (schluessel, kandidat) → ist das ein Anwärter?
 * @param {function} passt     (vager, anderer) → gehören sie zusammen?
 */
function schliesseAn(karte, istVage, passt) {
    for (const [schluessel, k] of [...karte.entries()]) {
        if (!karte.has(schluessel) || !istVage(schluessel, k)) continue
        const treffer = [...karte.entries()]
            .filter(([s2, k2]) => s2 !== schluessel && passt(k, k2))
        if (treffer.length !== 1) continue

        const [, ziel] = treffer[0]
        ziel.quellen.push(...k.quellen)
        if (!ziel.name && k.name) ziel.name = k.name
        if (!ziel.contract && k.contract) ziel.contract = k.contract
        if (!ziel.pair && k.pair) ziel.pair = k.pair
        for (const [feld, wert] of Object.entries(k.markt)) {
            if (ziel.markt[feld] === undefined) ziel.markt[feld] = wert
        }
        for (const [feld, wert] of Object.entries(k.sozial)) {
            ziel.sozial[feld] = typeof wert === 'number'
                ? (ziel.sozial[feld] || 0) + wert
                : wert
        }
        karte.delete(schluessel)
    }
}

/**
 * Stufe 1 im Ganzen.
 *
 * @param {object} opts
 * @param {object} opts.schluessel  {coingecko} — optional, hebt nur das Limit
 * @param {string[]} opts.ketten    GeckoTerminal-Ketten
 * @param {object} opts.quellen     Schalter je Quelle
 * @returns {Promise<{kandidaten: object[], quellenStand: object}>}
 */
export async function sammle({ schluessel = {}, ketten, quellen = {} } = {}) {
    const an = (name) => quellen[name] !== false
    const aufgaben = []

    if (an('coingecko')) aufgaben.push(['coingecko', () => ausCoinGecko(schluessel.coingecko)])
    if (an('dexscreener')) aufgaben.push(['dexscreener', () => ausDexScreener()])
    if (an('geckoterminal')) aufgaben.push(['geckoterminal', () => ausGeckoTerminal(ketten)])
    if (an('pumpfun')) aufgaben.push(['pumpfun', () => ausPumpFun()])
    if (an('coinpaprika')) aufgaben.push(['coinpaprika', () => ausCoinPaprika()])
    if (an('reddit')) aufgaben.push(['reddit', () => ausReddit()])

    const ergebnisse = await Promise.allSettled(aufgaben.map(([, f]) => f()))

    const quellenStand = {}
    const alleFunde = []
    ergebnisse.forEach((e, i) => {
        const name = aufgaben[i][0]
        if (e.status === 'fulfilled') {
            quellenStand[name] = { ok: true, anzahl: e.value.length }
            alleFunde.push(...e.value)
        } else {
            quellenStand[name] = { ok: false, fehler: String(e.reason?.message || e.reason).slice(0, 200) }
            logWarn('hype-radar', `Quelle ${name} ausgefallen: ${quellenStand[name].fehler}`)
        }
    })

    return { kandidaten: fuehreZusammen(alleFunde), quellenStand }
}
