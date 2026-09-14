/**
 * Kontraktdaten von Pionex: Rundungsregeln und Wartungsmargen.
 *
 * Warum das nicht über `market-data.js` läuft: `getSymbolMeta` dort liest
 * tickSize/stepSize/minQty/minNotional von BINANCE. Für den Backtest ist das
 * richtig und soll so bleiben — er rechnet auf Binance-Kerzen, und wer die
 * Quelle wechselt, macht alle gespeicherten Läufe unvergleichbar. Für eine
 * ORDER auf Pionex sind es aber die falschen Zahlen: eine Menge, die Binance
 * akzeptiert, kann dort unter der Mindestgrösse liegen oder eine Nachkommastelle
 * zu viel haben.
 *
 * Die Feldnamen der Rückgabe sind absichtlich die von `computePositionSize`
 * (server/risk-engine.js) — so muss die Risk-Engine nicht wissen, woher ihre
 * Rundungsregeln kommen.
 *
 * Zwischenspeicher wie bei `margin-rates.js`: im Prozess und zusätzlich in
 * `api_cache`, damit ein Neustart keinen Abruf kostet und NAS und Dev-Rechner
 * sich einen teilen. Jeder DB-Fehler ist weich — der Persist ist eine
 * Abkürzung, keine Voraussetzung.
 */

import { BASE_URL } from '../pionex-transport.js'
import { baueVerzeichnis, journalSymbol } from '../pionex-symbole.js'
import { logWarn } from '../logger.js'

const CACHE_MS = 6 * 60 * 60 * 1000
const SYMBOLE_DB_KEY = 'pionex_perp_symbols'
const RISK_DB_KEY = 'pionex_risk_table'
const HTTP_TIMEOUT = 15000

let symbolCache = null       // { ts, liste, verzeichnis }
let symbolLaeuft = null      // laufender Abruf, gegen den Ansturm beim Start
let riskCache = null         // { ts, tabelle: Map<journalSymbol, Stufen[]> }
let riskLaeuft = null

async function holeJson(pfad) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT)
    try {
        const r = await fetch(`${BASE_URL}${pfad}`, { signal: ctrl.signal })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const d = await r.json()
        if (d?.result === false) throw new Error(`[${d.code}] ${d.message || 'Fehler'}`)
        return d
    } finally {
        clearTimeout(t)
    }
}

async function leseAusDb(key) {
    try {
        const { getKnex } = await import('../database.js')
        const knex = getKnex()
        if (!knex) return null
        const zeile = await knex('api_cache').where({ key }).first()
        if (!zeile?.payload || (Date.now() - Number(zeile.ts)) >= CACHE_MS) return null
        return { ts: Number(zeile.ts), roh: JSON.parse(zeile.payload) }
    } catch {
        return null
    }
}

async function schreibeInDb(key, ts, roh) {
    try {
        const { getKnex } = await import('../database.js')
        const knex = getKnex()
        if (!knex) return
        await knex('api_cache')
            .insert({ key, ts, payload: JSON.stringify(roh) })
            .onConflict('key').merge(['ts', 'payload'])
    } catch (fehler) {
        logWarn('pionex-meta', `Persist ${key} fehlgeschlagen: ${fehler.message}`)
    }
}

// ── Symbole ──────────────────────────────────────────────────────────────

/**
 * Reiner Teil: Pionex-Eintrag → die Felder, die `computePositionSize` liest.
 *
 * `baseStep` ist die Mengen-Schrittweite, `quoteStep` die Preis-Schrittweite —
 * die Namensgleichheit mit „Basis/Quote" führt leicht in die Irre, deshalb
 * hier einmal übersetzt und nirgends sonst.
 */
export function meteAus(eintrag) {
    if (!eintrag?.symbol) return null
    const z = (v) => {
        const n = Number(v)
        return Number.isFinite(n) && n > 0 ? n : 0
    }
    /*
     * Pionex führt GETRENNTE Grenzen für Limit- und Marktorders
     * (`minSizeLimit`/`maxSizeLimit` gegen `minSizeMarket`/`maxSizeMarket`).
     * Der Einstieg geht als MARKET_QTY raus, also gelten die Markt-Grenzen —
     * gemessen an BTC_USDT_PERP am 14.09.2026 ist `maxSizeMarket` 100 gegen
     * `maxSizeLimit` 500, also ein Fünftel. Wer hier die Limit-Werte nimmt,
     * baut eine Order, die die Börse ablehnt, und merkt es erst beim Senden.
     * Fehlen die Markt-Grenzen, gelten die Limit-Werte als Rückfall.
     */
    return {
        symbol: String(eintrag.symbol),
        journalSymbol: journalSymbol(eintrag.symbol),
        tickSize: z(eintrag.quoteStep),
        stepSize: z(eintrag.baseStep),
        minQty: z(eintrag.minSizeMarket) || z(eintrag.minSizeLimit),
        maxQty: z(eintrag.maxSizeMarket) || z(eintrag.maxSizeLimit),
        // Die Grenzen der Limit-Order gelten für die Ziel-Order, die als
        // reduceOnly-Limit ins Buch geht.
        minQtyLimit: z(eintrag.minSizeLimit),
        maxQtyLimit: z(eintrag.maxSizeLimit),
        minNotional: z(eintrag.minNotional),
        // Liquidationsgebühr der Börse. Sie ist der Grund, warum das Margen-Netz
        // ein Puffer hinter dem Stop sein soll und nicht genau auf ihm: eine
        // Liquidation kostet zusätzlich diesen Satz auf das Nominal.
        liquidationFeeRate: z(eintrag.liquidationFeeRate),
        handelbar: String(eintrag.status || '').toUpperCase() === 'TRADING',
    }
}

async function holeSymbolTabelleIntern() {
    if (symbolCache && (Date.now() - symbolCache.ts) < CACHE_MS) return symbolCache
    if (symbolLaeuft) return symbolLaeuft

    symbolLaeuft = (async () => {
        const ausDb = await leseAusDb(SYMBOLE_DB_KEY)
        if (ausDb) {
            symbolCache = { ts: ausDb.ts, liste: ausDb.roh, verzeichnis: baueVerzeichnis(ausDb.roh) }
            return symbolCache
        }
        const d = await holeJson('/api/v1/common/symbols?type=PERP')
        const liste = d?.data?.symbols || d?.data || []
        if (!Array.isArray(liste) || !liste.length) throw new Error('Pionex lieferte keine Perp-Symbole')
        const ts = Date.now()
        symbolCache = { ts, liste, verzeichnis: baueVerzeichnis(liste) }
        await schreibeInDb(SYMBOLE_DB_KEY, ts, liste)
        return symbolCache
    })().finally(() => { symbolLaeuft = null })

    return symbolLaeuft
}

/** Die rohe Perp-Liste (für die Symbolübersetzung). */
export async function holeSymbolTabelle() {
    return (await holeSymbolTabelleIntern()).liste
}

/**
 * Rundungsregeln für ein Journal-Symbol, in den Feldnamen der Risk-Engine.
 * `null`, wenn Pionex das Paar nicht führt — der Aufrufer darf daraus KEINE
 * Vorgabewerte machen: ohne Mindestgrösse würde eine zu kleine Order gesendet
 * und von der Börse abgelehnt, im ungünstigen Fall erst nach dem Reservieren.
 */
export async function holeSymbolMeta(symbol) {
    const { verzeichnis } = await holeSymbolTabelleIntern()
    const eintrag = verzeichnis.get(String(symbol || '').toUpperCase())
    return eintrag ? meteAus(eintrag) : null
}

// ── Wartungsmargen ───────────────────────────────────────────────────────

/**
 * Reiner Teil: Risikotabelle → aufsteigend sortierte Stufen.
 *
 * ── Die Einheitenfrage, und warum sie nicht geraten wird ────────────────────
 * `mmr` ist im ganzen Projekt ein BRUCH (0.004 = 0,4 %, siehe
 * shared/liquidation.js). Pionex' Feld heisst `maintMarginRatio` und es ist
 * nicht dokumentiert, ob es als Bruch oder als Prozentzahl kommt. Eine
 * Schwelle („über 1 muss Prozent sein") hilft nur halb: realistische Brüche
 * liegen bei 0,004–0,05, realistische Prozentwerte bei 0,4–5 — die beiden
 * Bereiche überlappen sich zwischen 0,4 und 1, und genau dort würde geraten.
 * Ein um Faktor 100 falscher Wert verschiebt den Liquidationspreis massiv;
 * das Margen-Netz wäre dann eine Zahl ohne Deckung.
 *
 * Deshalb wird die Einheit ABGELEITET statt geschätzt: jede Stufe nennt neben
 * der Wartungsmarge auch ihren Höchsthebel, und beide müssen zueinander
 * passen — bei `1/maxLeverage <= mmr` wäre die Position im Moment der
 * Eröffnung schon liquidiert, so eine Stufe kann die Börse nicht anbieten.
 * Passt der Rohwert als Bruch nicht, passt aber geteilt durch 100, dann war es
 * Prozent. Passt beides oder keines, gibt es keine Stufe statt einer geratenen.
 */
export function stufenAus(eintrag) {
    const rows = eintrag?.rows || eintrag?.riskRows || []
    const faktor = deuteEinheit(rows)
    if (!faktor) return []

    return rows
        .map((r) => {
            const roh = Number(r?.maintMarginRatio ?? r?.mmr ?? 0)
            if (!Number.isFinite(roh) || roh <= 0) return null
            return {
                mmr: roh * faktor,
                maxLeverage: Number(r?.maxLeverage) || 0,
                notionalLimit: Number(r?.notionalLimit) || Infinity,
            }
        })
        .filter(Boolean)
        .sort((a, b) => a.notionalLimit - b.notionalLimit)
}

/**
 * Bruch oder Prozent — entschieden für die GANZE Tabelle, nicht je Zeile.
 *
 * Je Zeile ging es schief, und zwar an einer echten Antwort: BTC_USDT_PERP hat
 * sieben Stufen, die unterste mit `maxLeverage 1` und `maintMarginRatio 0.5`.
 * Das sind 50 % Wartungsmarge — bei Hebel 1 völlig richtig, und es sieht
 * zugleich aus wie ein Prozentwert. Eine Heuristik „über 0,2 muss Prozent
 * sein" macht daraus 0,5 %, also einen Faktor 100 daneben, und das Margen-Netz
 * wäre eine Zahl ohne Deckung.
 *
 * Der belastbare Hinweis liegt im VERHÄLTNIS: die Stufen sind so gebaut, dass
 * die Wartungsmarge ein fester Bruchteil der Anfangsmarge ist. Gemessen an
 * BTC ist `mmr · maxLeverage` über alle sieben Stufen exakt 0,5. Käme derselbe
 * Wert als Prozentzahl, wäre der Rohwert hundertmal grösser und das Produkt
 * läge bei 50 — ein Faktor 100 dazwischen, sauber trennbar.
 *
 * (Die Richtung ist die Stelle, an der man sich vertut: eine Prozentzahl ist
 * die GRÖSSERE Zahl, das Produkt also das grössere. Der Selbsttest hat genau
 * diesen Dreher gefunden, als die Bereiche einmal vertauscht standen.)
 *
 * Findet sich nichts Plausibles, gibt es KEINE Stufen statt geratener. Der
 * Aufrufer lehnt den Trade dann ab; das ist die richtige Antwort auf eine
 * Wartungsmarge, die man nicht kennt.
 *
 * @returns {number|null} 1 (Bruch), 0.01 (Prozent) oder null
 */
export function deuteEinheit(rows) {
    const produkte = (Array.isArray(rows) ? rows : [])
        .map((r) => {
            const m = Number(r?.maintMarginRatio ?? r?.mmr ?? 0)
            const l = Number(r?.maxLeverage) || 0
            return m > 0 && l > 0 ? m * l : null
        })
        .filter((x) => x !== null)
        .sort((a, b) => a - b)

    if (!produkte.length) return null
    const median = produkte[Math.floor(produkte.length / 2)]

    if (median >= 0.05 && median <= 1.5) return 1     // Bruch:   mmr·L ≈ 0,5
    if (median >= 5 && median <= 150) return 0.01     // Prozent: mmr·L ≈ 50
    return null
}

/**
 * Bruch oder Prozent? Entschieden wird über den Höchsthebel derselben Stufe./**
 * Bruch oder Prozent? Entschieden wird über den Höchsthebel derselben Stufe.
 *
 * @returns {number|null} die Wartungsmarge als Bruch, oder null wenn die
 *   Angaben sich nicht widerspruchsfrei deuten lassen.
 */
export function deuteMmr(roh, maxLeverage) {
    const alsBruch = roh
    const alsProzent = roh / 100

    // Ohne Hebelangabe bleibt nur die grobe Schwelle: über 1 kann kein Bruch
    // sein. Im Graubereich lieber nichts liefern als etwas Geratenes.
    if (!(maxLeverage > 0)) {
        if (alsBruch > 1) return alsProzent
        if (alsBruch <= 0.2) return alsBruch
        return null
    }

    const grenze = 1 / maxLeverage
    const bruchPasst = alsBruch < grenze
    const prozentPasst = alsProzent < grenze

    if (bruchPasst && !prozentPasst) return alsBruch
    if (prozentPasst && !bruchPasst) return alsProzent

    // Beides denkbar: dann entscheidet die Grössenordnung. Eine Wartungsmarge
    // von mehr als 20 % gibt es in keiner ersten Stufe; ein Rohwert darüber war
    // Prozent.
    if (bruchPasst && prozentPasst) return alsBruch <= 0.2 ? alsBruch : alsProzent

    // Keines von beiden passt zum Hebel — die Stufe widerspricht sich selbst.
    return null
}

/**
 * Wartungsmarge und Höchsthebel für ein Nominalvolumen.
 * @returns {{mmr, maxLeverage}|null}
 */
export async function holeMmr(symbol, notionalUsdt = 0) {
    const tabelle = await holeRiskTabelle()
    const stufen = tabelle.get(String(symbol || '').toUpperCase())
    if (!stufen?.length) return null
    const n = Number(notionalUsdt) || 0
    // Erste Stufe, deren Obergrenze das Volumen noch trägt; sonst die letzte.
    const stufe = stufen.find((s) => n <= s.notionalLimit) || stufen[stufen.length - 1]
    return { mmr: stufe.mmr, maxLeverage: stufe.maxLeverage }
}

async function holeRiskTabelle() {
    if (riskCache && (Date.now() - riskCache.ts) < CACHE_MS) return riskCache.tabelle
    if (riskLaeuft) return riskLaeuft

    riskLaeuft = (async () => {
        const ausDb = await leseAusDb(RISK_DB_KEY)
        if (ausDb) {
            riskCache = { ts: ausDb.ts, tabelle: new Map(Object.entries(ausDb.roh)) }
            return riskCache.tabelle
        }
        const d = await holeJson('/api/v1/common/riskTable')
        // Gemessene Struktur (14.09.2026): { data: { symbols: [{ symbol, rows:[…] }] } }.
        // Die beiden anderen Formen bleiben als Rückfall stehen, falls Pionex
        // die Hülle ändert — der Datenvertrag-Test schlägt dann trotzdem an.
        const liste = d?.data?.symbols || d?.data?.riskTable || d?.data || []
        const tabelle = new Map()
        for (const e of Array.isArray(liste) ? liste : []) {
            const j = journalSymbol(e?.symbol)
            const stufen = stufenAus(e)
            if (j && stufen.length) tabelle.set(j, stufen)
        }
        if (!tabelle.size) throw new Error('Pionex lieferte keine Risikotabelle')
        const ts = Date.now()
        riskCache = { ts, tabelle }
        await schreibeInDb(RISK_DB_KEY, ts, Object.fromEntries(tabelle))
        return tabelle
    })().finally(() => { riskLaeuft = null })

    return riskLaeuft
}

/** Nur für Tests und die Inbetriebnahme-Probe. */
export function leereCache() {
    symbolCache = null
    riskCache = null
}
