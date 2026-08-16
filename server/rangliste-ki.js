/**
 * KI-Vorschlag für ein Coin-Universum.
 *
 * „RWA", „Meme-Coins", „KI-Token" sind BEDEUTUNGSFRAGEN — kein Kursverlauf
 * verrät, ob ein Token eine tokenisierte Staatsanleihe abbildet. Genau dafür
 * taugt ein Sprachmodell. Für alles andere in der Rangliste taugt es nicht:
 * gerechnet und gerangt wird deterministisch, sonst ergäben zwei Läufe zwei
 * Reihenfolgen und man könnte nichts vergleichen.
 *
 * Bewusst `callLLMJson` statt der Agentenschleife: hier wird EINE Liste
 * erzeugt, nicht ergebnisoffen gearbeitet. Der Agent mit seinen zehn
 * Werkzeugrunden wäre teurer und weniger vorhersagbar.
 *
 * Der Topf, aus dem gewählt werden darf, ist die Schnittmenge Bitunix ∩ Binance
 * — NICHT die Marktübersicht des Radars: deren `KEIN_COIN`-Filter wirft
 * tokenisierte Realwerte gerade heraus, eine RWA-Liste könnte daraus also per
 * Bauart nie entstehen.
 *
 * Jedes vorgeschlagene Symbol wird serverseitig gegen den Topf geprüft. Was das
 * Modell erfindet, fliegt raus und wird GEZÄHLT — eine stillschweigend
 * gekürzte Liste wäre eine Behauptung über Vollständigkeit, die niemand
 * nachprüfen kann.
 */

import { ladeLlmConfig, callLLMJson } from './llm.js'
import { holeHandelbar, holeTestbar } from './coin-universum.js'
import { logWarn } from './logger.js'

/**
 * Der Systemprompt nennt die Regeln, die das Modell NICHT brechen darf.
 * Vorbild: `SYSTEM_LAGE` in `marktradar-news.js` — striktes Antwortschema,
 * ausdrückliches Verbot zu raten.
 */
const SYSTEM = `Du ordnest Kryptowährungen thematisch ein.

Du bekommst ein Thema und eine Liste handelbarer Symbole (Binance-Perpetual-Schreibweise,
z. B. BTCUSDT, 1000SHIBUSDT). Wähle daraus die Symbole, die zum Thema gehören.

REGELN:
- Wähle AUSSCHLIESSLICH aus der gegebenen Liste. Erfinde kein Symbol.
- Gehört ein Coin nur vielleicht dazu, gehört er in "unsicher", nicht in "symbole".
- Lieber wenige sichere als viele fragliche Treffer.
- Passt gar nichts, gib eine leere Liste zurück. Das ist eine gültige Antwort.
- Begründe in einem Satz, wonach du ausgewählt hast.

Antworte NUR mit diesem JSON:
{"name":"kurzer Listenname","begruendung":"ein Satz","symbole":["..."],"unsicher":["..."]}`

/** Wie viele Symbole je Antwort höchstens übernommen werden. */
const MAX_VORSCHLAEGE = 120

/**
 * Eine Themenliste vorschlagen lassen.
 *
 * @param {string} thema  z. B. „RWA", „Meme-Coins"
 * @param {object} [opts] `{ provider, modell, llm }` — `llm` nur zum Prüfen
 * @returns {{name, begruendung, symbole, unsicher, verworfen, gesamtVorschlaege, provider, modell, kostenUsd, tokens}}
 */
export async function schlageUniversumVor(thema, opts = {}) {
    const t = String(thema || '').trim()
    if (!t) throw new Error('Kein Thema angegeben')
    if (t.length > 120) throw new Error('Thema zu lang')

    const [handelbar, testbar] = await Promise.all([
        opts.handelbar ? opts.handelbar() : holeHandelbar(),
        opts.testbar ? opts.testbar() : holeTestbar(),
    ])
    // Nur was handelbar UND testbar ist — alles andere könnte die Rangliste
    // hinterher ohnehin nicht verwenden.
    const topf = [...testbar].filter((s) => handelbar.has(s)).sort()
    if (!topf.length) throw new Error('Keine testbaren Symbole verfügbar')

    const ruf = opts.llm || (async (cfg, auftrag) => callLLMJson(cfg, auftrag))
    const cfg = opts.llm
        ? { provider: 'test', model: 'test' }
        : await ladeLlmConfig({ provider: opts.provider || undefined, model: opts.modell || undefined })
    if (!opts.llm) cfg.maxTokens = 2000

    const antwort = await ruf(cfg, {
        system: SYSTEM,
        user: `Thema: ${t}\n\nVerfügbare Symbole (${topf.length}):\n${topf.join(' ')}`,
        timeoutMs: 90000,
    })

    const daten = antwort?.json
    if (!daten || !Array.isArray(daten.symbole)) {
        throw new Error('Das Modell hat keine verwertbare Liste geliefert')
    }

    // ── Die Prüfung, die das Ganze erst brauchbar macht ──────────────────
    const erlaubt = new Set(topf)
    const gesehen = new Set()
    const symbole = []
    const verworfen = []
    for (const roh of daten.symbole.slice(0, MAX_VORSCHLAEGE * 2)) {
        const s = String(roh || '').trim().toUpperCase()
        if (!s || gesehen.has(s)) continue
        gesehen.add(s)
        if (!erlaubt.has(s)) { verworfen.push(s); continue }
        if (symbole.length < MAX_VORSCHLAEGE) symbole.push(s)
    }
    const unsicher = (Array.isArray(daten.unsicher) ? daten.unsicher : [])
        .map((x) => String(x || '').trim().toUpperCase())
        .filter((x) => erlaubt.has(x) && !gesehen.has(x))
        .slice(0, 40)

    if (verworfen.length) {
        logWarn('rangliste-ki', `${verworfen.length} erfundene oder nicht handelbare Symbole verworfen: `
            + verworfen.slice(0, 8).join(', '))
    }

    return {
        name: String(daten.name || t).slice(0, 120),
        begruendung: String(daten.begruendung || '').slice(0, 2000),
        symbole,
        unsicher,
        // Beides ausweisen: „18 von 22 übernommen" ist eine Aussage über die
        // Qualität des Vorschlags, die der Nutzer sehen soll.
        verworfen,
        gesamtVorschlaege: daten.symbole.length,
        provider: cfg.provider,
        modell: cfg.model,
        kostenUsd: Number(antwort?.costUsd) || 0,
        tokens: Number(antwort?.usage?.totalTokens) || 0,
    }
}
