/**
 * Kachel „Handelslage" — eine KI ordnet ein, was die nächsten Stunden hergeben.
 *
 * Schwester der „Gesamtlage" (`marktradar-lage.js`), mit ausdrücklich anderem
 * Horizont und deshalb bewusst als zweite Kachel statt als Umbau der ersten:
 *
 *   • Gesamtlage  → „wo stehen wir im Zyklus" — Pi-Cycle, Regenbogen,
 *     Altcoin-Saison, Dominanz über Wochen, die eigene Jahresbilanz.
 *     Richtig auf dem Marktradar, unbrauchbar während einer Sitzung.
 *   • Handelslage → „was gibt der Nachmittag her" — Tagesspanne, Bewegungs-
 *     vorrat, Sitzungsphase, anstehende Termine, Mechanik auf 15 Minuten,
 *     laufende Liquidationen.
 *
 * Die vier Regeln der Schwesterkachel gelten unverändert, plus eine fünfte:
 *
 *   1. Die KI recherchiert nicht, sie liest ab (`grundlage` kommt mit).
 *   2. Keine Handelsempfehlung — aber sehr wohl BEDINGUNGEN. Der Unterschied
 *      ist die Richtung der Aussage: „Fortsetzung trägt, solange das Open
 *      Interest steigt" beschreibt den Markt, „steig bei 4300 ein" den Leser.
 *   3. Kein Abruf ohne Anlass: GET liest nur, erzeugt wird per POST.
 *   4. Ein Lauf je Symbol wird zusammengelegt, ein Doppelklick kostet nichts.
 *   5. NEU: Der automatische Nachzug (`auto`) ist eine Einstellung des Nutzers
 *      und hat einen eigenen Tagesdeckel. Eine Kachel, die sich alle 15 Minuten
 *      selbst erneuert, ist bequem — und ohne Deckel eine offene Rechnung.
 */

import { getKnex } from './database.js'
import { logWarn } from './logger.js'
import { ladeLlmConfigFuerAufgabe, callLLMJson } from './llm.js'
import { baueHandelsZeilen, normalisiereHandelslage, rechneTagesbild, LAGEN } from './handelsbild.js'
import { getClosedCandles } from './market-data.js'
import { lies as liesLiqTicker } from './liq-ticker.js'
import { lageZu } from '../shared/handelszeiten.js'
import { leseKalender } from './marktradar-kalender.js'
import {
    holeMechanik, holeFunding, holeLsOi, holeMakro, holeRsi, holeMarkt,
} from './marktradar-api.js'

/**
 * Solange gilt eine vorhandene Einordnung als brauchbar genug für den Knopf.
 *
 * Fünf Minuten statt der zwanzig der Gesamtlage: Auf Stundenhorizont ist ein
 * zwanzig Minuten alter Befund bereits ein anderer Markt. Wer den Knopf drückt,
 * will neu rechnen — die kurze Frist fängt nur den Doppelklick ab.
 */
const TTL_MS = 5 * 60 * 1000
/** Untergrenze zwischen zwei erzwungenen Läufen — gegen Doppelklick auf Kosten. */
const SPERRE_MS = 45 * 1000
/** Mehr als so viele Symbole hebt niemand auf; jeder Eintrag ist bezahlter Text. */
const CACHE_MAX = 6
/**
 * Höchstzahl AUTOMATISCHER Läufe je Kalendertag, über alle Symbole.
 *
 * 24 deckt eine ganze Sitzung bei 15-Minuten-Takt und noch etwas darüber ab.
 * Der Deckel gilt ausdrücklich nur für den Automatismus: ein Knopfdruck des
 * Nutzers ist eine Absicht und wird nie abgelehnt.
 */
const AUTO_DECKEL_TAG = 24

/** Wie weit der Kalender vorausschaut. Alles darüber ist keine Sitzungsfrage mehr. */
const TERMIN_STUNDEN = 8

/** Symbol → { ts, payload }. Nur im Speicher: nach einem Neustart ist die Lage ohnehin eine andere. */
const cache = new Map()
/** Symbol → laufender Lauf, damit zwei Klicks nicht zweimal bezahlen. */
const laufend = new Map()
/** { tag: 'YYYY-MM-DD', anzahl } — Zähler der automatischen Läufe. */
let autoZaehler = { tag: '', anzahl: 0 }

const SYMBOL_RE = /^[A-Z0-9]{2,20}$/

export function normSymbol(symbol) {
    const s = String(symbol || 'BTCUSDT').toUpperCase()
    return SYMBOL_RE.test(s) ? s : 'BTCUSDT'
}

const heuteSchluessel = () => new Date().toISOString().slice(0, 10)

/** Wie viele automatische Läufe heute noch frei sind. */
export function autoRestHeute() {
    if (autoZaehler.tag !== heuteSchluessel()) return AUTO_DECKEL_TAG
    return Math.max(0, AUTO_DECKEL_TAG - autoZaehler.anzahl)
}

function zaehleAuto() {
    const tag = heuteSchluessel()
    if (autoZaehler.tag !== tag) autoZaehler = { tag, anzahl: 0 }
    autoZaehler.anzahl++
}

/** Was liegt zu diesem Symbol im Speicher? `null`, wenn noch nie eines erzeugt wurde. */
export function letzteHandelslage(symbol) {
    const eintrag = cache.get(normSymbol(symbol))
    if (!eintrag) return null
    return { ...eintrag.payload, stand: eintrag.ts, alterMs: Date.now() - eintrag.ts }
}

/**
 * Frist je Quelle.
 *
 * Erst auf 8 s angesetzt, nach dem ersten Probelauf auf 12 angehoben: kalt
 * brauchten Funding (30 Märkte) und der RSI-Streuplot (50 Märkte) länger, und
 * beide Zeilen fielen weg — ausgerechnet beim ERSTEN Lauf einer Sitzung, dem
 * einzigen, bei dem der Zwischenspeicher der Nachbarkacheln noch leer ist.
 * Warm kostet die höhere Frist nichts, und gegen die 20–30 s, die das Modell
 * danach ohnehin braucht, fallen vier Sekunden nicht ins Gewicht.
 */
const QUELLE_FRIST_MS = 12000

/** Ergebnis oder `null` — aber nie ein Fehler und nie eine offene Wartezeit. */
function mitFrist(aufgabe, name) {
    let uhr
    const frist = new Promise((fertig) => {
        uhr = setTimeout(() => {
            logWarn('handelslage', `${name}: nicht rechtzeitig da — die Zeile fällt weg`)
            fertig(null)
        }, QUELLE_FRIST_MS)
    })
    return Promise.race([
        aufgabe.catch((e) => {
            logWarn('handelslage', `${name} fehlt: ${e.message}`)
            return null
        }),
        frist,
    ]).finally(() => clearTimeout(uhr))
}

/**
 * Termine der nächsten Stunden — dieselbe Rechnung wie die Kalender-Kachel.
 *
 * Bewusst hier nachgebaut statt aus `livetrading-api.js` importiert: dort ist
 * sie an die Route gebunden (Cache-Schlüssel, `force`-Parameter, Antwortform),
 * und ein Import in beide Richtungen zwischen den zwei Modulen wäre ein Zyklus
 * in Wartestellung. Es sind sechs Zeilen.
 */
async function holeTermine(stunden) {
    const jetzt = Date.now()
    const knex = getKnex()
    const s = await knex('settings').where('id', 1).first().catch(() => null)
    const daten = await leseKalender({
        von: jetzt - 60 * 60 * 1000,
        bis: jetzt + stunden * 60 * 60 * 1000,
        laender: s?.radarKalenderLaender ?? 'USD,JPY',
        impact: s?.radarKalenderImpact ?? 'medium',
    })
    const ereignisse = (daten.ereignisse || []).map(e => ({
        ...e, inMs: e.dateUnix - jetzt, vorbei: e.dateUnix < jetzt,
    }))
    return { stunden, ereignisse, gesamtImZeitraum: daten.gesamtImZeitraum }
}

/**
 * Die laufende Sitzung, falls eine läuft.
 *
 * Bewusst nur der PLAN und die Dauer — nicht das laufende Ergebnis. Realisiertes
 * P&L steht während einer Sitzung nicht in `live_sessions` (die Trades werden
 * erst beim Beenden eingefroren); es zu beschaffen hiesse, bei jedem Lauf die
 * Börse mit Schlüssel abzufragen. Der Plan allein trägt schon den Befund, um
 * den es geht: wie viel Spielraum die eigenen Regeln heute noch lassen.
 */
async function holeSitzung() {
    const knex = getKnex()
    const s = await knex('live_sessions')
        .where('status', 'laufend').orderBy('startUnix', 'desc').first()
    if (!s) return null
    return {
        dauerMs: Date.now() - Number(s.startUnix || 0),
        maxTrades: Number(s.planMaxTrades) || null,
        maxVerlust: Number(s.planMaxVerlustUsd) || null,
        vorhaben: String(s.planNotiz || '').trim().slice(0, 200),
    }
}

/**
 * Die bewegtesten Münzen des letzten Coin-Radar-Laufs.
 *
 * Nur, wenn der Lauf frisch genug ist: eine Rangliste von gestern beantwortet
 * die Frage „wo ist heute Bewegung" nicht, sie beantwortet sie falsch. Zwölf
 * Stunden ist die Grenze, danach fällt die Zeile weg.
 */
async function holeCoinRadar() {
    const knex = getKnex()
    const lauf = await knex('coinradar_laeufe')
        .where('status', 'fertig').orderBy('id', 'desc').first()
    if (!lauf) return null
    const alterMs = Date.now() - Number(lauf.erstelltAm || lauf.beendetAm || 0)
    if (!Number.isFinite(alterMs) || alterMs > 12 * 3600 * 1000) return null

    const zeilen = await knex('coinradar_zeilen')
        .where({ laufId: lauf.id, status: 'bewertet' })
        .orderBy('rang', 'asc').limit(8)
    if (!zeilen.length) return null

    const stunden = Math.round(alterMs / 3600000)
    return {
        alter: stunden < 1 ? 'unter 1 h' : `vor ${stunden} h`,
        zeilen: zeilen.map(z => ({ symbol: z.symbol, atrPct: z.atrPct, rvol: z.rvol, adx: z.adx })),
    }
}

/** Kerzen dreier Raster → Tagesbild. Fehlt eines, fehlen nur dessen Felder. */
async function holeTagesbild(sym) {
    const [k5m, k1h, kTag] = await Promise.all([
        getClosedCandles(sym, '5m', 300).catch(() => []),
        getClosedCandles(sym, '1h', 200).catch(() => []),
        getClosedCandles(sym, '1d', 12).catch(() => []),
    ])
    return rechneTagesbild({ k5m, k1h, kTag, jetzt: Date.now() })
}

/**
 * Alle Quellen einsammeln.
 *
 * Jede einzeln abgesichert: eine Quelle, die klemmt, kostet eine Zeile in der
 * Grundlage — nie die ganze Einordnung. Parallel, weil die Wartezeit sonst die
 * Summe aller Quellen wäre.
 */
export async function sammleHandelsdaten(symbol) {
    const sym = normSymbol(symbol)
    const [
        tagesbild, mechanik15, mechanik1h, lsoi, funding,
        rsi, markt, makro, termine, coinradar, sitzung,
    ] = await Promise.all([
        mitFrist(holeTagesbild(sym), 'Tagesbild'),
        mitFrist(holeMechanik(sym, '15m'), 'Mechanik 15m'),
        mitFrist(holeMechanik(sym, '1h'), 'Mechanik 1h'),
        mitFrist(holeLsOi(sym, 24), 'Long/Short'),
        mitFrist(holeFunding(30), 'Funding'),
        mitFrist(holeRsi('15m', 'top', 50), 'RSI'),
        mitFrist(holeMarkt(50), 'Marktübersicht'),
        mitFrist(holeMakro(), 'Makro'),
        mitFrist(holeTermine(TERMIN_STUNDEN), 'Termine'),
        mitFrist(holeCoinRadar(), 'Coin-Radar'),
        mitFrist(holeSitzung(), 'Sitzung'),
    ])

    /*
     * Handelszeiten rechnet der Server selbst — kein Abruf, keine Frist nötig.
     * Die Kalendertermine gehen mit hinein, weil `lageZu` ihre FOMC-Marken nur
     * dann setzt, wenn ein echter Termin dahintersteht (die Modulregel: lieber
     * schweigen als täglich falsch warnen).
     */
    const zeit = lageZu(Date.now(), {
        ereignisse: (termine?.ereignisse || []).map(e => ({ dateUnix: e.dateUnix, impact: e.impact })),
    })

    /*
     * Liquidationen aus dem Ringpuffer, nicht aus der Datenbank: der Aufzeichner
     * schreibt nur alle 30 Sekunden, und „was gerade passiert" verträgt keinen
     * halbminütigen Rückstand. 30 Minuten ist das Maximum des Puffers.
     */
    let liqJetzt = null
    try {
        const l = liesLiqTicker({ minuten: 30, symbol: sym })
        liqJetzt = {
            minuten: l.fensterMinuten, symbol: sym,
            longUsd: l.gesamt.longUsd, shortUsd: l.gesamt.shortUsd, anzahl: l.gesamt.anzahl,
            groesstes: l.groesste?.[0]?.usd ?? null,
        }
    } catch (e) {
        logWarn('handelslage', `Liquidationsticker fehlt: ${e.message}`)
    }

    return {
        symbol: sym, zeit, termine, tagesbild, mechanik15, mechanik1h,
        liqJetzt, lsoi, funding, rsi, markt, makro, coinradar, sitzung,
    }
}

function baueSystem(englisch) {
    const regeln = englisch
        ? [
            'You are a sober market observer inside the live-trading window of a trading journal.',
            'Your horizon is the NEXT ONE TO FOUR HOURS — not days, not weeks. A cycle argument is out of scope here.',
            'You receive current readings: where we are in the trading day, upcoming economic events, the day range and',
            'how much of a usual day range is already used up, marks from the previous day, the session VWAP, volatility,',
            'participation, market mechanics on two windows, live liquidations, positioning and the wider market.',
            'The questions you answer, in this order: (1) is there tradable movement at all right now,',
            '(2) what KIND of movement is it, (3) how much room is left, (4) what would make this reading void.',
            'Use ONLY the numbers given. Never invent a number, never add outside knowledge.',
            'NO trading recommendation: no entries, no exits, no price targets, no position sizes, no "one should".',
            'Conditions ARE wanted: "continuation holds as long as X" is a statement about the market, not about the reader.',
            'Price marks contained in the readings (previous day high/low, session VWAP, day high/low) may be named.',
            'Time beats technique: if an event of high importance is due within an hour, that is the main finding,',
            'no matter how clean the trend looks.',
            'Respond in English.',
        ]
        : [
            'Du bist ein nüchterner Marktbeobachter im Live-Trading-Fenster eines Trading-Journals.',
            'Dein Horizont sind die NÄCHSTEN EIN BIS VIER STUNDEN — nicht Tage, nicht Wochen. Ein Zyklus-Argument',
            'gehört hier nicht hin.',
            'Du bekommst aktuelle Messwerte: wo im Handelstag wir stehen, anstehende Wirtschaftstermine, die Tagesspanne',
            'und wie viel einer üblichen Tagesspanne schon verbraucht ist, Marken aus dem Vortag, den Tages-VWAP,',
            'Volatilität, Beteiligung, Marktmechanik auf zwei Fenstern, laufende Liquidationen, Positionierung und den',
            'breiten Markt.',
            'Die Fragen, die du beantwortest, in dieser Reihenfolge: (1) ist gerade überhaupt handelbare Bewegung da,',
            '(2) welcher ART ist sie, (3) wie viel Spielraum ist noch übrig, (4) was macht diese Einordnung hinfällig.',
            'Nutze AUSSCHLIESSLICH die genannten Zahlen. Erfinde nie eine Zahl, ergänze kein Fremdwissen.',
            'KEINE Handelsempfehlung: keine Einstiege, keine Ausstiege, keine Kursziele, keine Positionsgrössen,',
            'kein „sollte man".',
            'Bedingungen sind ausdrücklich erwünscht: „Fortsetzung trägt, solange X" ist eine Aussage über den Markt,',
            'nicht über den Leser.',
            'Preismarken, die in den Messwerten stehen (Vortageshoch/-tief, Tages-VWAP, Tageshoch/-tief), darfst du nennen.',
            'Zeit schlägt Technik: Steht ein Termin hoher Bedeutung binnen einer Stunde an, ist das der Hauptbefund —',
            'egal wie sauber der Trend aussieht.',
            'Antworte auf Deutsch.',
        ]

    const lagen = englisch
        ? [
            '"lage" means: trend_auf = directed move upward with participation, trend_ab = the same downward,',
            'spanne = price oscillates within a range whose edges hold, quetsche = small range with loaded positioning',
            '(a break is likely, its direction is open), nachrichtenrisiko = an event dominates everything else,',
            'unklar = the readings do not carry a verdict.',
        ]
        : [
            '„lage" heisst: trend_auf = gerichtete Bewegung nach oben mit Beteiligung, trend_ab = dasselbe nach unten,',
            'spanne = der Preis pendelt in einem Bereich, dessen Ränder halten, quetsche = kleine Spanne bei',
            'aufgeladener Positionierung (ein Ausbruch ist wahrscheinlich, seine Richtung offen),',
            'nachrichtenrisiko = ein Termin überlagert alles andere, unklar = die Messwerte tragen kein Urteil.',
        ]

    const schema = englisch
        ? [
            'Answer as JSON:',
            '{"lage": "trend_auf|trend_ab|spanne|quetsche|nachrichtenrisiko|unklar",',
            ' "ueberschrift": "the situation in at most 9 words",',
            ' "text": "three to four sentences on the next few hours",',
            ' "spielraum": "one sentence on how much movement is left, citing the used-up share of a usual day range",',
            ' "zeitfenster": "one sentence on what the next hours bring by session and events",',
            ' "punkte": [{"titel": "3-5 words", "text": "one or two sentences", "ton": "gut|schlecht|neutral"}],',
            ' "bedingungen": [{"wenn": "a condition WITH the number it hangs on", "dann": "what that would say about the market"}],',
            ' "hinfaellig": ["at most three marks or numbers at which this reading no longer holds"],',
            ' "widerspruch": "where the readings disagree — empty string if they do not"}',
            'Three or four "punkte", two to four "bedingungen". "ton" describes the reading, not a recommendation:',
            '"gut" = supportive for taking risk, "schlecht" = adverse, "neutral" = neither.',
        ]
        : [
            'Antworte als JSON:',
            '{"lage": "trend_auf|trend_ab|spanne|quetsche|nachrichtenrisiko|unklar",',
            ' "ueberschrift": "die Lage in höchstens 9 Wörtern",',
            ' "text": "drei bis vier Sätze zu den nächsten Stunden",',
            ' "spielraum": "ein Satz dazu, wie viel Bewegung noch drin ist, mit dem verbrauchten Anteil einer üblichen Tagesspanne",',
            ' "zeitfenster": "ein Satz dazu, was die nächsten Stunden nach Sitzung und Terminen bringen",',
            ' "punkte": [{"titel": "3-5 Wörter", "text": "ein bis zwei Sätze", "ton": "gut|schlecht|neutral"}],',
            ' "bedingungen": [{"wenn": "eine Bedingung MIT der Zahl, an der sie hängt", "dann": "was das über den Markt aussagen würde"}],',
            ' "hinfaellig": ["höchstens drei Marken oder Zahlen, bei denen diese Einordnung nicht mehr gilt"],',
            ' "widerspruch": "wo sich die Messwerte widersprechen — leerer Text, wenn nicht"}',
            'Drei bis vier „punkte", zwei bis vier „bedingungen". „ton" beschreibt den Messwert, nicht eine Empfehlung:',
            '„gut" = trägt Risikobereitschaft, „schlecht" = spricht dagegen, „neutral" = weder noch.',
        ]

    return [...regeln, '', ...lagen, '', ...schema].join(' ').replace(/\s+/g, ' ')
}

/**
 * Einordnung erzeugen — der bezahlte Weg. Nur aus der POST-Route.
 *
 * @param {string} symbol
 * @param {object} opt
 * @param {boolean} opt.erzwingen  Auch dann neu rechnen, wenn eine frische vorliegt
 * @param {boolean} opt.auto       Lauf kommt vom Automatismus, nicht vom Knopf
 */
export async function erzeugeHandelslage(symbol, { erzwingen = false, auto = false } = {}) {
    const sym = normSymbol(symbol)

    const alt = cache.get(sym)
    const alter = alt ? Date.now() - alt.ts : Infinity
    if (alt && (alter < (erzwingen ? SPERRE_MS : TTL_MS))) {
        return { ...alt.payload, stand: alt.ts, alterMs: alter, aus: 'speicher' }
    }
    if (laufend.has(sym)) return laufend.get(sym)

    // Der Deckel gilt nur dem Automatismus. Ein Knopfdruck ist eine Absicht.
    if (auto && autoRestHeute() <= 0) {
        const e = new Error(`Tagesdeckel für automatische Läufe erreicht (${AUTO_DECKEL_TAG})`)
        e.deckel = true
        throw e
    }

    const lauf = (async () => {
        const t0 = Date.now()
        const rohdaten = await sammleHandelsdaten(sym)
        const tGesammelt = Date.now()
        const grundlage = baueHandelsZeilen(rohdaten)
        /*
         * Sechs statt der vier der Gesamtlage. Zeit und Termine kommen ohne
         * Netz zustande und sind praktisch immer da — sie allein wären aber
         * kein Lagebild, sondern eine Uhr. Unter sechs Zeilen fehlt der Markt.
         */
        if (grundlage.length < 6) {
            throw new Error('Zu wenige Quellen liefern gerade Daten — eine Handelslage wäre geraten')
        }

        const s = await getKnex()('settings').select('language').where('id', 1).first().catch(() => null)
        const englisch = s?.language === 'en'

        const cfg = await ladeLlmConfigFuerAufgabe('livetrading-handelslage')
        // Gleiche Begründung wie bei der Gesamtlage: die bestellte Antwort ist
        // lang, und ein abgeschnittenes JSON ist bezahlt und wertlos.
        cfg.maxTokens = 3000

        const system = baueSystem(englisch)
        const user = [
            `SYMBOL: ${sym}`,
            `ZEITPUNKT: ${new Date().toISOString()} (UTC)`,
            '',
            'MESSWERTE:',
            ...grundlage.map(z => `- ${z.text}`),
        ].join('\n')

        const buchung = {
            zweck: 'handelslage',
            ausloeser: auto ? 'automatisch' : 'manuell',
            bezug: { typ: 'symbol', id: sym },
        }
        let antwort = await callLLMJson(cfg, { system, user, timeoutMs: 90000, ...buchung })
        if (!antwort.json && antwort.abgeschnitten) {
            cfg.maxTokens = 6000
            antwort = await callLLMJson(cfg, { system, user, timeoutMs: 90000, ...buchung })
        }

        const einordnung = normalisiereHandelslage(antwort.json)
        if (!einordnung) throw new Error('Die KI hat keine verwertbare Einordnung geliefert')

        if (auto) zaehleAuto()

        const payload = {
            symbol: sym,
            ...einordnung,
            grundlage,
            model: cfg.model,
            provider: cfg.provider,
            costUsd: antwort.costUsd ?? null,
            automatisch: auto,
            autoRest: autoRestHeute(),
        }
        console.log(` -> Handelslage ${sym}: Quellen ${tGesammelt - t0} ms, KI ${Date.now() - tGesammelt} ms `
            + `(${cfg.provider}/${cfg.model}), ${grundlage.length} Zeilen${auto ? ', automatisch' : ''}`)

        cache.set(sym, { ts: Date.now(), payload })
        while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)

        return { ...payload, stand: cache.get(sym).ts, alterMs: 0, aus: 'neu' }
    })()

    laufend.set(sym, lauf)
    try {
        return await lauf
    } finally {
        laufend.delete(sym)
    }
}

export function setupHandelslageRoutes(app) {
    /**
     * Lesen. Kostet nichts und erzeugt nichts — der Prüftakt des Live-Fensters
     * läuft bei drei Sekunden, und „Alle aktualisieren" landet ebenfalls hier.
     */
    app.get('/api/livetrading/handelslage', (req, res) => {
        const vorhanden = letzteHandelslage(req.query.symbol)
        res.set('Cache-Control', 'no-store')
        res.json(vorhanden || {
            leer: true,
            symbol: normSymbol(req.query.symbol),
            lagen: LAGEN,
            autoRest: autoRestHeute(),
        })
    })

    /** Erzeugen. Per Knopf in der Kachel oder durch den Automatismus (`auto`). */
    app.post('/api/livetrading/handelslage', async (req, res) => {
        try {
            res.json(await erzeugeHandelslage(req.body?.symbol, {
                erzwingen: req.body?.erzwingen === true,
                auto: req.body?.auto === true,
            }))
        } catch (e) {
            const msg = e?.message || 'Einordnung fehlgeschlagen'
            /*
             * 429 für den Deckel: Die Kachel soll den Automatismus daraufhin
             * für den Rest des Tages ruhen lassen, statt es im Takt weiter zu
             * versuchen. Ein 400 sähe wie ein Konfigurationsfehler aus.
             */
            if (e?.deckel) return res.status(429).json({ error: msg, deckel: true })
            const konfig = /Schlüssel|Modell|Einstellungen|Quellen liefern/i.test(msg)
            res.status(konfig ? 400 : 502).json({ error: msg })
        }
    })

    console.log(' -> Handelslage routes initialized')
}
