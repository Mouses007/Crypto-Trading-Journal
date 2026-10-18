/**
 * KI-Analyse im Chart: das Modell liest den Chart und liefert Linien, Zonen
 * und Bedingungen als JSON — der Chart zeichnet sie.
 *
 *   GET  /api/chart/ki-analyse?symbol=&interval=   letzte Analyse (kostet nichts, erzeugt nichts)
 *   POST /api/chart/ki-analyse {symbol, interval, markt}  erzeugt — kostet einen KI-Aufruf
 *
 * Dieselben Grundregeln wie Gesamtlage und Handelslage:
 *   1. Die KI liest ab, sie recherchiert nicht — alles, worauf sie sich
 *      stützen darf, steht in der Eingabe (Kerzen, eigene Linien, Hebelzonen).
 *   2. Keine Prognose, kein Kursziel, keine Empfehlung — wohl aber Marken und
 *      Bedingungen („solange über X …"). Geprüft mit demselben Wächter wie die
 *      Coin-Radar-Einordnung (`pruefeEinordnung`); ist in den Einstellungen
 *      `kiEmpfehlungenAn` gesetzt, entfällt die Prüfung wie bei der Handelslage.
 *   3. GET erzeugt nie. Ein Lauf je Symbol+Zeiteinheit wird zusammengelegt,
 *      und zwischen zwei erzwungenen Läufen liegen mindestens 45 s.
 *   4. Was die Prüfung verwirft, steht im Protokoll und in der Antwort
 *      (`verworfen`) — sonst wüsste niemand, ob sie nützt oder frisst.
 *
 * `baueChartEingabe` und `pruefeChartAntwort` sind rein (Selbsttest:
 * `server/__selftest-chart-ki.mjs`).
 */
import { getKnex } from './database.js'
import { logWarn } from './logger.js'
import { ladeLlmConfigFuerAufgabe, callLLMJson } from './llm.js'
import { getClosedCandles, isValidTimeframe, timeframeMs } from './market-data.js'
import { holeHebelzonen } from './hebelzonen.js'
import { pruefeEinordnung } from './coin-radar/einordnung.js'
import { tradesAusZeilen } from './chart-journal.js'

const SYMBOL_RE = /^[A-Z0-9]{2,20}$/
const KERZEN = 150
const TTL_MS = 30 * 60 * 1000
const SPERRE_MS = 45 * 1000
const CACHE_MAX = 12
const MAX_LINIEN = 8
const MAX_ZONEN = 5
const MAX_BEDINGUNGEN = 5

/** Zahl mit etwa fünf gültigen Stellen — reicht dem Modell und spart Text. */
function kurz(x) {
    if (!Number.isFinite(x)) return '—'
    const a = Math.abs(x)
    if (a >= 1000) return x.toFixed(1)
    if (a >= 1) return x.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
    return Number(x.toPrecision(5)).toString()
}

const isoKurz = (ms) => new Date(ms).toISOString().slice(0, 16) + 'Z'

/**
 * Die Eingabe an das Modell — rein.
 * @returns {string}
 */
export function baueChartEingabe({ symbol, interval, kerzen, zeichnungen = [], hebelzonen = null, trades = [] }) {
    const zeilen = [
        `SYMBOL: ${symbol}`,
        `ZEITEINHEIT: ${interval}`,
        `JETZT: ${isoKurz(Date.now())}`,
        '',
        `KERZEN (älteste zuerst; Zeit,Eröffnung,Hoch,Tief,Schluss,Volumen) — ${kerzen.length} Stück:`,
        ...kerzen.map((k) => [isoKurz(k.t), kurz(k.o), kurz(k.h), kurz(k.l), kurz(k.c), kurz(k.v)].join(',')),
    ]
    const linien = zeichnungen.filter((z) => ['horizontale', 'strahlH', 'trendlinie', 'strahl', 'rechteck'].includes(z.typ))
    if (linien.length) {
        zeilen.push('', 'EIGENE LINIEN DES NUTZERS (dürfen bestätigt oder widersprochen werden):')
        for (const z of linien.slice(0, 20)) {
            const p = z.punkte || []
            const text = z.stil?.text ? ` „${z.stil.text}"` : ''
            if (z.typ === 'rechteck') zeilen.push(`- Zone ${kurz(Math.min(p[0]?.p, p[1]?.p))}–${kurz(Math.max(p[0]?.p, p[1]?.p))}${text}`)
            else if (p.length > 1) zeilen.push(`- ${z.typ} ${isoKurz(p[0].t)} ${kurz(p[0].p)} → ${isoKurz(p[1].t)} ${kurz(p[1].p)}${text}`)
            else if (p.length) zeilen.push(`- ${z.typ} bei ${kurz(p[0].p)}${text}`)
        }
    }
    if (hebelzonen && (hebelzonen.oben?.length || hebelzonen.unten?.length)) {
        zeilen.push('', 'GESCHÄTZTE LIQUIDATIONSZONEN (Modell aus Open Interest, keine Messung):')
        for (const z of (hebelzonen.oben || []).slice(0, 3)) zeilen.push(`- darüber ${kurz(z.preis)} (~${Math.round(z.usd / 1e6)} Mio USD Shorts)`)
        for (const z of (hebelzonen.unten || []).slice(0, 3)) zeilen.push(`- darunter ${kurz(z.preis)} (~${Math.round(z.usd / 1e6)} Mio USD Longs)`)
    }
    if (trades.length) {
        zeilen.push('', 'EIGENE TRADES AUF DIESEM SYMBOL IM ZEITRAUM (nur zur Einordnung, nicht bewerten):')
        for (const t of trades.slice(-5)) {
            zeilen.push(`- ${t.richtung} ${isoKurz(t.einstieg.t)} @ ${kurz(t.einstieg.p)}${t.ausstieg ? ` → ${isoKurz(t.ausstieg.t)} @ ${kurz(t.ausstieg.p)}` : ' (offen)'}`)
        }
    }
    return zeilen.join('\n')
}

export function systemText(englisch, empfehlungen) {
    const sprache = englisch ? 'Write all texts in English.' : 'Schreibe alle Texte auf Deutsch.'
    return `Du bist ein nüchterner technischer Analyst. Du liest einen Krypto-Kerzenchart und markierst, was ein erfahrener Trader dort einzeichnen würde.

Regeln:
- Stütze dich NUR auf die gelieferten Kerzen, Linien und Zonen. Keine Nachrichten, kein Allgemeinwissen über den Coin.
- Linien: Unterstützung, Widerstand, Trendlinien an echten Hochs/Tiefs der Kerzen. Zeiten und Preise müssen aus dem gezeigten Bereich stammen (Trendlinien dürfen in die Zukunft verlängert gemeint sein, ihre Punkte liegen aber auf Kerzen).
- Zonen: Preisbereiche mit mehrfacher Reaktion.
- Bedingungen: "wenn … dann …" — beobachtbar, an eine Zahl gebunden.
${empfehlungen ? '' : '- KEINE Prognose, KEIN Kursziel, KEINE Handelsempfehlung, kein "dürfte", kein "kaufen/verkaufen". Beschreibe Marken und was ihr Bruch bedeuten würde.\n'}- Jede Linie und Zone bekommt eine kurze Beschriftung (max. 40 Zeichen) und einen Grund (max. 200 Zeichen), WARUM sie dort liegt (z. B. "drei Tiefs bei 101,2 am 12., 14. und 16.").
- Höchstens ${MAX_LINIEN} Linien, ${MAX_ZONEN} Zonen, ${MAX_BEDINGUNGEN} Bedingungen. Lieber wenige gute.
- ${sprache}

Antworte NUR mit JSON:
{"text": "2–4 Sätze zur Lage",
 "linien": [{"art": "unterstuetzung|widerstand|trend", "t1": "YYYY-MM-DDTHH:MMZ", "p1": 0, "t2": "YYYY-MM-DDTHH:MMZ", "p2": 0, "label": "...", "grund": "..."}],
 "zonen": [{"tief": 0, "hoch": 0, "label": "...", "grund": "..."}],
 "bedingungen": [{"wenn": "...", "dann": "..."}]}`
}

const zeitAus = (v) => {
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
    const t = Date.parse(String(v || ''))
    return Number.isFinite(t) ? t : null
}

/**
 * Antwort des Modells prüfen und säubern — rein.
 *
 * Verworfen wird, was sich nicht zeichnen liesse oder was die Regeln bricht:
 * Zeiten weit ausserhalb des Kerzenbereichs, Preise fern jeder Kerze (ein
 * vertippter Preis wäre eine Linie an einem Ort, wo der Kurs nie war),
 * Prognosen und Empfehlungen (ausser `empfehlungen`).
 *
 * @param {object} json
 * @param {{vonT:number, bisT:number, iv:number, preisMin:number, preisMax:number, empfehlungen?:boolean}} rahmen
 */
export function pruefeChartAntwort(json, { vonT, bisT, iv, preisMin, preisMax, empfehlungen = false }) {
    const verworfen = []
    const textOk = (s) => empfehlungen || pruefeEinordnung({ text: s }).ok
    const spanne = preisMax - preisMin
    const preisOk = (p) => Number.isFinite(p) && p >= preisMin - spanne * 0.5 && p <= preisMax + spanne * 0.5 && p > 0
    // Trendpunkte dürfen etwas in der Zukunft liegen (verlängerte Linie),
    // aber nicht vor dem gezeigten Bereich.
    const zeitOk = (t) => Number.isFinite(t) && t >= vonT - iv && t <= bisT + 50 * iv
    const wort = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

    let text = wort(json?.text, 1200)
    if (text && !textOk(text)) { verworfen.push({ art: 'text', grund: 'prognose', inhalt: text.slice(0, 120) }); text = '' }

    const linien = []
    for (const l of Array.isArray(json?.linien) ? json.linien : []) {
        if (linien.length >= MAX_LINIEN) break
        let t1 = zeitAus(l?.t1), t2 = zeitAus(l?.t2)
        let p1 = Number(l?.p1), p2 = Number(l?.p2)
        if (t1 != null && t2 == null) { t2 = bisT; p2 = p1 }
        if (!zeitOk(t1) || !zeitOk(t2)) { verworfen.push({ art: 'linie', grund: 'zeit', inhalt: wort(l?.label, 40) }); continue }
        if (!preisOk(p1) || !preisOk(p2)) { verworfen.push({ art: 'linie', grund: 'preis', inhalt: wort(l?.label, 40) }); continue }
        if (t2 < t1) { [t1, t2] = [t2, t1]; [p1, p2] = [p2, p1] }
        const label = wort(l?.label, 40)
        const grund = wort(l?.grund, 200)
        if (!textOk(`${label}. ${grund}`)) { verworfen.push({ art: 'linie', grund: 'prognose', inhalt: label }); continue }
        const art = ['unterstuetzung', 'widerstand', 'trend'].includes(l?.art) ? l.art : (p1 === p2 ? 'unterstuetzung' : 'trend')
        linien.push({ art, t1, p1, t2, p2, label, grund })
    }

    const zonen = []
    for (const z of Array.isArray(json?.zonen) ? json.zonen : []) {
        if (zonen.length >= MAX_ZONEN) break
        let tief = Number(z?.tief), hoch = Number(z?.hoch)
        if (tief > hoch) [tief, hoch] = [hoch, tief]
        if (!preisOk(tief) || !preisOk(hoch) || tief === hoch) { verworfen.push({ art: 'zone', grund: 'preis', inhalt: wort(z?.label, 40) }); continue }
        const label = wort(z?.label, 40)
        const grund = wort(z?.grund, 200)
        if (!textOk(`${label}. ${grund}`)) { verworfen.push({ art: 'zone', grund: 'prognose', inhalt: label }); continue }
        zonen.push({ tief, hoch, label, grund })
    }

    const bedingungen = []
    for (const b of Array.isArray(json?.bedingungen) ? json.bedingungen : []) {
        if (bedingungen.length >= MAX_BEDINGUNGEN) break
        const wenn = wort(b?.wenn, 200), dann = wort(b?.dann, 200)
        if (!wenn || !dann) continue
        if (!textOk(`Wenn ${wenn}, dann ${dann}.`)) { verworfen.push({ art: 'bedingung', grund: 'prognose', inhalt: wenn }); continue }
        bedingungen.push({ wenn, dann })
    }

    const leer = !text && !linien.length && !zonen.length && !bedingungen.length
    return { text, linien, zonen, bedingungen, verworfen, leer }
}

// ── Erzeugen ─────────────────────────────────────────────────────────────
const cache = new Map()      // `${symbol}|${interval}` → { ts, payload }
const laufend = new Map()

/*
 * Schlüssel mit Markt: Spot und Perpetual haben andere Kerzen — eine geteilte
 * Ablage zeigte die Spot-Analyse im Futures-Panel, und die 45-s-Sperre gab der
 * Futures-Anfrage das Spot-Ergebnis.
 */
const schluesselVon = (symbol, interval, markt) => `${symbol}|${interval}|${markt === 'spot' ? 'spot' : 'futures'}`
// Fehlschläge sperren ebenfalls — die Antwort war bezahlt, ein sofortiger zweiter Klick bezahlte erneut.
const fehlschlaege = new Map()   // schluessel → { ts, meldung }

export function letzteChartAnalyse(symbol, interval, markt = 'futures') {
    const e = cache.get(schluesselVon(symbol, interval, markt))
    if (!e || Date.now() - e.ts > TTL_MS) return null
    return { ...e.payload, stand: e.ts, alterMs: Date.now() - e.ts }
}

export async function erzeugeChartAnalyse({ symbol, interval, markt = 'futures' }) {
    const schluessel = schluesselVon(symbol, interval, markt)
    const alt = cache.get(schluessel)
    if (alt && Date.now() - alt.ts < SPERRE_MS) return { ...alt.payload, stand: alt.ts, alterMs: Date.now() - alt.ts, aus: 'sperre' }
    if (laufend.has(schluessel)) return laufend.get(schluessel)
    const fehl = fehlschlaege.get(schluessel)
    if (fehl && Date.now() - fehl.ts < SPERRE_MS) {
        const e = new Error(`${fehl.meldung} — nächster Versuch in ${Math.ceil((SPERRE_MS - (Date.now() - fehl.ts)) / 1000)} s`)
        e.status = 429
        throw e
    }

    const lauf = (async () => {
        const iv = timeframeMs(interval)
        const kerzen = await getClosedCandles(symbol, interval, KERZEN, { market: markt })
        if (kerzen.length < 30) throw new Error('Zu wenige Kerzen für eine Analyse')
        const vonT = kerzen[0].t
        const bisT = kerzen[kerzen.length - 1].t
        const knex = getKnex()
        const [zeichnungenRoh, hebel, tagesZeilen, s] = await Promise.all([
            knex('chart_zeichnungen').where('symbol', symbol).catch(() => []),
            markt === 'spot' ? null : holeHebelzonen(symbol).catch(() => null),
            knex('trades').select('dateUnix', 'broker', 'trades')
                .where('dateUnix', '>=', Math.floor(vonT / 1000) - 7 * 86400).catch(() => []),
            knex('settings').select('language', 'kiEmpfehlungenAn').where('id', 1).first().catch(() => null),
        ])
        const zeichnungen = zeichnungenRoh.map((z) => ({ ...z, punkte: JSON.parse(z.punkte || '[]'), stil: JSON.parse(z.stil || '{}') }))
        const trades = tradesAusZeilen(tagesZeilen, symbol, vonT, Date.now())
        const englisch = s?.language === 'en'
        const empfehlungen = Number(s?.kiEmpfehlungenAn ?? 0) === 1

        const cfg = await ladeLlmConfigFuerAufgabe('chart-analyse')
        // Die bestellte Antwort ist lang (Linien mit Gründen). Nach Textlänge
        // bemessen frisst ein Reasoning-Modell den Deckel und liefert leeren
        // Inhalt bei voller Rechnung — deshalb grosszügig, und bei
        // abgeschnittenem JSON einmal mit doppeltem Deckel.
        cfg.maxTokens = 3000
        const system = systemText(englisch, empfehlungen)
        const user = baueChartEingabe({ symbol, interval, kerzen, zeichnungen, hebelzonen: hebel, trades })
        const buchung = { zweck: 'chart-analyse', ausloeser: 'manuell', bezug: { typ: 'symbol', id: symbol } }
        let antwort = await callLLMJson(cfg, { system, user, timeoutMs: 90000, ...buchung })
        // Kosten beider Aufrufe zusammen anzeigen — bei abgeschnittener Antwort wurde der erste auch bezahlt.
        let kosten = antwort.costUsd ?? null
        if (!antwort.json && antwort.abgeschnitten) {
            cfg.maxTokens = 6000
            antwort = await callLLMJson(cfg, { system, user, timeoutMs: 90000, ...buchung })
            if (antwort.costUsd != null) kosten = (kosten ?? 0) + antwort.costUsd
        }
        const preise = kerzen.flatMap((k) => [k.h, k.l])
        const ergebnis = pruefeChartAntwort(antwort.json, {
            vonT, bisT, iv, preisMin: Math.min(...preise), preisMax: Math.max(...preise), empfehlungen,
        })
        for (const v of ergebnis.verworfen) logWarn('chart-ki', `${symbol} ${interval}: ${v.art} verworfen (${v.grund}) — ${v.inhalt}`)
        if (ergebnis.leer) throw new Error('Die KI hat keine verwertbare Analyse geliefert')

        const payload = {
            symbol, interval, ...ergebnis, kerzenVon: vonT, kerzenBis: bisT,
            markt, provider: cfg.provider, model: cfg.model, costUsd: kosten,
        }
        cache.set(schluessel, { ts: Date.now(), payload })
        while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
        return { ...payload, stand: Date.now(), alterMs: 0, aus: 'neu' }
    })()
    laufend.set(schluessel, lauf)
    try {
        const r = await lauf
        fehlschlaege.delete(schluessel)
        return r
    } catch (e) {
        if (e.status !== 429) fehlschlaege.set(schluessel, { ts: Date.now(), meldung: e.message })
        throw e
    } finally { laufend.delete(schluessel) }
}

export function setupChartKiRoutes(app) {
    app.get('/api/chart/ki-analyse', (req, res) => {
        const symbol = String(req.query.symbol || '').toUpperCase()
        const interval = String(req.query.interval || '')
        res.set('Cache-Control', 'no-store')
        const markt = req.query.markt === 'spot' ? 'spot' : 'futures'
        res.json(letzteChartAnalyse(symbol, interval, markt) || { leer: true, symbol, interval, markt })
    })

    app.post('/api/chart/ki-analyse', async (req, res) => {
        const symbol = String(req.body?.symbol || '').toUpperCase()
        const interval = String(req.body?.interval || '')
        if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'symbol ungültig' })
        if (!isValidTimeframe(interval)) return res.status(400).json({ error: `Zeiteinheit ${interval} wird nicht unterstützt` })
        try {
            res.json(await erzeugeChartAnalyse({ symbol, interval, markt: req.body?.markt === 'spot' ? 'spot' : 'futures' }))
        } catch (e) {
            logWarn('chart-ki', `${symbol} ${interval}: ${e.message}`)
            res.status(e.status === 429 ? 429 : 502).json({ error: e.message })
        }
    })
}
