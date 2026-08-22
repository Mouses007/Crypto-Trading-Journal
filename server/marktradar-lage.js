/**
 * Kachel „Gesamtlage" — eine KI fasst zusammen, was die übrigen Kacheln zeigen.
 *
 * Der Sinn der Kachel ist Zeit: Wer die Live-Analyse öffnet, liest sonst
 * dreizehn Kacheln einzeln und baut sich das Bild im Kopf zusammen. Hier
 * drückt man einmal und liest fünf Zeilen.
 *
 * Drei Regeln, die diese Kachel von einer Empfehlungsmaschine trennen:
 *
 *   1. **Die KI recherchiert nicht, sie liest ab.** Grundlage sind
 *      ausschliesslich die Zahlen der anderen Kacheln — dieselben Werte, die
 *      auf dem Bildschirm stehen. Sie werden mitgeliefert (`grundlage`), damit
 *      man die Zusammenfassung nachprüfen statt glauben kann.
 *   2. **Keine Handelsempfehlung.** Einordnung, Widersprüche, Beobachtungs-
 *      punkte — keine Kursziele, keine Positionsvorschläge.
 *   3. **Kein Abruf ohne Knopfdruck.** Der Takt der Seite (GET) liefert nur,
 *      was schon im Speicher liegt; erzeugt wird ausschliesslich per POST.
 *      Sonst würde „Alle aktualisieren" bei jedem Klick Geld kosten.
 *
 * Die Zahlen kommen über dieselben `hole*`-Funktionen wie die Kacheln, also
 * aus deren Zwischenspeicher: eine Zusammenfassung löst im Regelfall keinen
 * einzigen zusätzlichen Fremdabruf aus.
 */

import { getKnex } from './database.js'
import { logWarn } from './logger.js'
import { ladeLlmConfig, ladeLlmConfigFuerAufgabe, callLLMJson } from './llm.js'
import { baueZeilen, normalisiereAntwort, STIMMUNGEN } from './lagebild.js'
import {
    holeFearGreed, holeDominanz, holeFunding, holeLsOi, holeLiquidationen,
    holeMechanik, holeMakro, holeRsi, holeRegime, holePiCycle, holeAltseason,
    holeMarkt, holeRainbow,
} from './marktradar-api.js'

/** Solange gilt eine vorhandene Einordnung als brauchbar genug für den Knopf. */
const TTL_MS = 20 * 60 * 1000
/** Untergrenze zwischen zwei erzwungenen Läufen — gegen Doppelklick auf Kosten. */
const SPERRE_MS = 60 * 1000
/** Mehr als so viele Symbole hebt niemand auf; jeder Eintrag ist bezahlter Text. */
const CACHE_MAX = 10

/** Symbol → { ts, payload }. Bewusst nur im Speicher: nach einem Neustart ist die Lage ohnehin eine andere. */
const cache = new Map()
/** Symbol → laufender Lauf, damit zwei Klicks nicht zweimal bezahlen. */
const laufend = new Map()

const SYMBOL_RE = /^[A-Z0-9]{2,20}$/

export function normSymbol(symbol) {
    const s = String(symbol || 'BTCUSDT').toUpperCase()
    return SYMBOL_RE.test(s) ? s : 'BTCUSDT'
}

/** Was liegt zu diesem Symbol im Speicher? `null`, wenn noch nie eines erzeugt wurde. */
export function letzteLage(symbol) {
    const eintrag = cache.get(normSymbol(symbol))
    if (!eintrag) return null
    return { ...eintrag.payload, stand: eintrag.ts, alterMs: Date.now() - eintrag.ts }
}

/**
 * Wie lange eine einzelne Kachel höchstens braucht, bevor sie ohne sie
 * weitergeht.
 *
 * Im Normalfall sind alle Werte längst im Zwischenspeicher — die Seite hat sie
 * beim Aufbau geholt, und der Knopf kommt danach. Kalt ist es etwas anderes:
 * Regenbogen und Pi-Cycle hängen an einer trägen Fremdquelle, die im Zweifel
 * mit Wiederholungen über eine Minute braucht. Ohne Frist wartet die ganze
 * Zusammenfassung auf die langsamste Kachel, und der Nutzer sieht einen
 * Ladepunkt statt eines Textes. Eine fehlende Zeile ist der bessere Handel.
 */
const QUELLE_FRIST_MS = 12000

/** Ergebnis oder `null` — aber nie ein Fehler und nie eine offene Wartezeit. */
function mitFrist(aufgabe, name) {
    let uhr
    const frist = new Promise((fertig) => {
        uhr = setTimeout(() => {
            logWarn('lagebild', `${name}: nicht rechtzeitig da — die Zeile fällt weg`)
            fertig(null)
        }, QUELLE_FRIST_MS)
    })
    return Promise.race([
        aufgabe.catch((e) => {
            logWarn('lagebild', `${name} fehlt: ${e.message}`)
            return null
        }),
        frist,
    ]).finally(() => clearTimeout(uhr))
}

/**
 * Zahlen aller Kacheln einsammeln.
 *
 * Jede Quelle einzeln abgesichert: eine Kachel, die gerade klemmt oder trödelt,
 * kostet eine Zeile in der Grundlage — nie die ganze Einordnung. Parallel, weil
 * die Wartezeit sonst die Summe aller Kacheln wäre.
 */
export async function sammleKacheln(symbol) {
    const [
        mechanik, fng, dom, funding, lsoi, liq24, rsi, markt,
        altseason, picycle, rainbow, makro, regime,
    ] = await Promise.all([
        mitFrist(holeMechanik(symbol, '1h'), 'Marktmechanik'),
        mitFrist(holeFearGreed(365), 'Fear & Greed'),
        mitFrist(holeDominanz(), 'Dominanz'),
        mitFrist(holeFunding(50), 'Funding'),
        mitFrist(holeLsOi(symbol, 48), 'Long/Short'),
        mitFrist(holeLiquidationen(24), 'Liquidationen'),
        mitFrist(holeRsi('1h', 'top', 50), 'RSI'),
        mitFrist(holeMarkt(50), 'Marktübersicht'),
        mitFrist(holeAltseason(90), 'Altcoin-Saison'),
        mitFrist(holePiCycle(), 'Pi-Cycle'),
        mitFrist(holeRainbow(), 'Regenbogen'),
        mitFrist(holeMakro(), 'Makro'),
        mitFrist(holeRegime(365), 'Marktregime'),
    ])

    return { mechanik, fng, dom, funding, lsoi, liq24, rsi, markt, altseason, picycle, rainbow, makro, regime }
}

function baueSystem(englisch) {
    const regeln = englisch
        ? [
            'You are a sober market observer inside a trading journal. You receive the CURRENT readings of a market',
            'dashboard — sentiment, dominance, funding, long/short, liquidations, RSI, breadth, cycle models, macro',
            'and the user\'s own trading record by market regime.',
            'Summarise the overall situation in a way that can be read in fifteen seconds.',
            'Use ONLY the numbers given. Never invent a number, never add outside knowledge, never guess a price.',
            'Name contradictions between the readings explicitly — that is the most valuable part.',
            'NO trading recommendation, no price targets, no entries or exits, no "one should".',
            'Respond in English.',
        ]
        : [
            'Du bist ein nüchterner Marktbeobachter in einem Trading-Journal. Du bekommst die AKTUELLEN Messwerte',
            'einer Marktübersicht — Stimmung, Dominanz, Funding, Long/Short, Liquidationen, RSI, Marktbreite,',
            'Zyklusmodelle, Makro-Umfeld und die eigene Handelsbilanz des Nutzers je Stimmungslage.',
            'Fasse die Gesamtlage so zusammen, dass man sie in fünfzehn Sekunden liest.',
            'Nutze AUSSCHLIESSLICH die genannten Zahlen. Erfinde nie eine Zahl, ergänze kein Fremdwissen, rate keinen Kurs.',
            'Benenne Widersprüche zwischen den Messwerten ausdrücklich — das ist der wertvollste Teil.',
            'KEINE Handelsempfehlung, keine Kursziele, keine Ein- oder Ausstiege, kein „sollte man".',
            'Antworte auf Deutsch.',
        ]

    const schema = englisch
        ? [
            'Answer as JSON:',
            '{"stimmung": "risiko_auf|risiko_ab|angespannt|gemischt|ruhig",',
            ' "ueberschrift": "the situation in at most 9 words",',
            ' "text": "three to four sentences on the overall picture",',
            ' "punkte": [{"titel": "3-5 words", "text": "one or two sentences", "ton": "gut|schlecht|neutral"}],',
            ' "widerspruch": "where the readings disagree — empty string if they do not",',
            ' "achten": ["at most three concrete things to watch, each with the number that would matter"]}',
            'Give three or four "punkte", each at most two sentences. "ton" describes the reading, not a recommendation:',
            '"gut" = supportive for risk, "schlecht" = adverse, "neutral" = neither.',
        ]
        : [
            'Antworte als JSON:',
            '{"stimmung": "risiko_auf|risiko_ab|angespannt|gemischt|ruhig",',
            ' "ueberschrift": "die Lage in höchstens 9 Wörtern",',
            ' "text": "drei bis vier Sätze zum Gesamtbild",',
            ' "punkte": [{"titel": "3-5 Wörter", "text": "ein bis zwei Sätze", "ton": "gut|schlecht|neutral"}],',
            ' "widerspruch": "wo sich die Messwerte widersprechen — leerer Text, wenn nicht",',
            ' "achten": ["höchstens drei konkrete Beobachtungspunkte, je mit der Zahl, auf die es ankäme"]}',
            'Gib drei bis vier „punkte", je höchstens zwei Sätze. „ton" beschreibt den Messwert, nicht eine Empfehlung:',
            '„gut" = trägt Risikofreude, „schlecht" = spricht dagegen, „neutral" = weder noch.',
        ]

    const stimmungen = englisch
        ? [
            '"stimmung" means: risiko_auf = risk appetite carries the market, risiko_ab = money leaves risk,',
            'angespannt = positioning is stretched and fragile regardless of direction, gemischt = readings pull',
            'apart, ruhig = little is happening.',
        ]
        : [
            '„stimmung" heisst: risiko_auf = Risikofreude trägt, risiko_ab = Geld verlässt das Risiko,',
            'angespannt = die Positionierung ist aufgeladen und zerbrechlich, egal in welche Richtung,',
            'gemischt = die Messwerte ziehen auseinander, ruhig = es passiert wenig.',
        ]

    return [...regeln, '', ...stimmungen, '', ...schema].join(' ').replace(/\s+/g, ' ')
}

/**
 * Einordnung erzeugen — der bezahlte Weg. Nur aus der POST-Route.
 *
 * @param {string} symbol  Symbol der symbolabhängigen Kacheln (Mechanik, Long/Short)
 * @param {boolean} erzwingen  Auch dann neu rechnen, wenn eine frische Einordnung vorliegt
 */
export async function erzeugeLage(symbol, erzwingen = false) {
    const sym = normSymbol(symbol)

    const alt = cache.get(sym)
    const alter = alt ? Date.now() - alt.ts : Infinity
    // Frisch genug: zurückgeben statt bezahlen. Und selbst „erzwingen" kommt
    // nicht an der Sperre vorbei — ein zweiter Klick auf denselben Knopf ist
    // fast immer Ungeduld, nicht Absicht.
    if (alt && (alter < (erzwingen ? SPERRE_MS : TTL_MS))) {
        return { ...alt.payload, stand: alt.ts, alterMs: alter, aus: 'speicher' }
    }
    if (laufend.has(sym)) return laufend.get(sym)

    const lauf = (async () => {
        const t0 = Date.now()
        const rohdaten = await sammleKacheln(sym)
        const tGesammelt = Date.now()
        const grundlage = baueZeilen(rohdaten)
        // Unter dieser Grenze wäre die „Gesamtlage" das Echo von zwei Kacheln
        if (grundlage.length < 4) {
            throw new Error('Zu wenige Kacheln liefern gerade Daten — eine Gesamtlage wäre geraten')
        }

        const s = await getKnex()('settings').select('language').where('id', 1).first().catch(() => null)
        const englisch = s?.language === 'en'

        const cfg = await ladeLlmConfigFuerAufgabe('marktradar-lage')
        /*
         * Deutlich mehr als die 800 aus `ladeLlmConfig`, weil hier eine LANGE
         * Antwort bestellt ist: Gesamtbild, drei bis vier Punkte mit je zwei
         * Sätzen, Widerspruch und Beobachtungspunkte — gemessen rund 2000
         * Token. Mit 900 und mit 1800 kam die Antwort abgeschnitten zurück und
         * war damit komplett wertlos (JSON ohne Ende), also doppelt bezahlt.
         * Das Budget ist eine Obergrenze, keine Rechnung: kürzere Antworten
         * kosten weiterhin weniger.
         */
        cfg.maxTokens = 3000

        const system = baueSystem(englisch)
        const user = [
            `SYMBOL: ${sym}`,
            `ZEITPUNKT: ${new Date().toISOString()}`,
            '',
            'MESSWERTE DER KACHELN:',
            ...grundlage.map(z => `- ${z.text}`),
        ].join('\n')

        // Guthaben- und Schlüsselfehler vermerkt `callLLMJson` selbst
        const buchung = { zweck: 'lage', ausloeser: 'manuell', bezug: { typ: 'symbol', id: sym } }
        let antwort = await callLLMJson(cfg, { system, user, timeoutMs: 90000, ...buchung })
        if (!antwort.json && antwort.abgeschnitten) {
            // Budget zu klein, nicht der Prompt kaputt — einmal nachlegen.
            // Der erste Versuch wird trotzdem verbucht: bezahlt ist er.
            cfg.maxTokens = 6000
            antwort = await callLLMJson(cfg, { system, user, timeoutMs: 90000, ...buchung })
        }

        const einordnung = normalisiereAntwort(antwort.json)
        if (!einordnung) throw new Error('Die KI hat keine verwertbare Einordnung geliefert')

        const payload = {
            symbol: sym,
            ...einordnung,
            grundlage,
            model: cfg.model,
            provider: cfg.provider,
            costUsd: antwort.costUsd ?? null,
        }
        // Ein Knopfdruck, der eine Minute braucht, wirft die Frage auf, WO die
        // Zeit hingeht. Der Löwenanteil ist je nach Modell der Denkschritt der
        // KI, nicht das Einsammeln — ohne diese Zeile rät man daran herum.
        console.log(` -> Lagebild ${sym}: Kacheln ${tGesammelt - t0} ms, KI ${Date.now() - tGesammelt} ms `
            + `(${cfg.provider}/${cfg.model}), ${grundlage.length} Zeilen`)

        cache.set(sym, { ts: Date.now(), payload })
        // Deckel: der älteste Eintrag fällt raus, sonst sammelt jeder
        // Symbolwechsel einen bezahlten Text an, den niemand mehr ansieht
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

export function setupLageRoutes(app) {
    /**
     * Lesen. Kostet nichts und erzeugt nichts — der Seitentakt und „Alle
     * aktualisieren" landen hier, und beide dürfen keine Rechnung auslösen.
     */
    app.get('/api/marktradar/lage', (req, res) => {
        const vorhanden = letzteLage(req.query.symbol)
        res.set('Cache-Control', 'no-store')
        res.json(vorhanden || { leer: true, symbol: normSymbol(req.query.symbol), stimmungen: STIMMUNGEN })
    })

    /** Erzeugen. Nur per Knopf in der Kachel. */
    app.post('/api/marktradar/lage', async (req, res) => {
        try {
            res.json(await erzeugeLage(req.body?.symbol, req.body?.erzwingen === true))
        } catch (e) {
            const msg = e?.message || 'Einordnung fehlgeschlagen'
            // Fehlender Schlüssel oder Modell ist ein Konfigurationsproblem des
            // Nutzers (400), alles andere ein Ausfall dahinter (502)
            const konfig = /Schlüssel|Modell|Einstellungen|Kacheln liefern/i.test(msg)
            res.status(konfig ? 400 : 502).json({ error: msg })
        }
    })

    console.log(' -> Marktradar-Lagebild routes initialized')
}
