/**
 * Hype-Radar, Stufe 4: der Bericht.
 *
 * Erst hier kommt ein Sprachmodell ins Spiel, und nur für die Kandidaten, die
 * Bewertung und Sicherheitsprüfung überstanden haben. Das ist der teure
 * Schritt, deshalb steht davor alles, was sich auch rechnen lässt.
 *
 * Zwei Betriebsarten:
 *
 *   **einfach**    Ein Aufruf. Das Redakteursmodell bekommt alle Kandidaten
 *                  auf einmal und schreibt daraus den Bericht. Günstig, und
 *                  für den Überblick meist genug.
 *
 *   **gründlich**  Je Kandidat ein eigener Recherche-Aufruf mit kurzem
 *                  Auftrag, danach ein Redakteursaufruf über die Ergebnisse.
 *                  Tiefer, weil jeder Kandidat eigenen Kontext bekommt statt
 *                  ein Zehntel eines Sammelkontexts.
 *
 * Der Bericht ist ausdrücklich Recherche und keine Kaufempfehlung. Der
 * Hinweis dazu steht fest im Ergebnis und nicht im Ermessen des Modells.
 */

import { ladeLlmConfig, callLLMJson } from '../llm.js'
import { rechercheThema } from '../news-recherche.js'
import { rollenAnbieter } from './stufen.js'
import { logWarn } from '../logger.js'

/** Steht unter jedem Bericht. Nicht verhandelbar, nicht vom Modell erzeugt. */
export const HINWEIS = 'Keine Anlageberatung. Frühphasen-Token sind hochriskant; '
    + 'ein Totalverlust ist möglich. Diese Zusammenstellung ist Recherche, keine Empfehlung.'

const SYSTEM_REDAKTEUR = `Du bist Research-Analyst für Krypto-Frühphasenprojekte.

Du bekommst vorgefilterte Kandidaten mit Markt-, Sozial- und Sicherheitsdaten.
Schreibe einen nüchternen Bericht auf Deutsch.

Regeln:
- KEINE Kursziele, KEINE Kaufempfehlungen, keine Aufforderung zum Handeln.
- Bewerte je Projekt: Warum wird darüber gesprochen? Steckt Substanz dahinter
  (Produkt, Team, Nutzen)? Welche Risiken nennen die Sicherheitsdaten?
- Nenne die Sicherheitsbefunde ausdrücklich, auch bei bestandenen Kandidaten.
- Kennzeichne Unsicherheit klar. Wo du nichts weisst, schreibe das.
- Erfinde nichts: keine Teams, keine Partnerschaften, keine Zahlen, die nicht
  in den Daten stehen.

Antworte AUSSCHLIESSLICH mit JSON in dieser Form:
{
  "ueberschrift": "kurze Überschrift",
  "marktkontext": "2-3 Sätze: welche Themen laufen gerade",
  "kandidaten": [
    {
      "symbol": "…",
      "einordnung": "warum wird darüber gesprochen",
      "substanz": "was wirklich dahintersteckt, oder dass es unklar ist",
      "risiken": "die konkreten Risiken inklusive Sicherheitsbefunde",
      "vertrauen": "hoch|mittel|niedrig"
    }
  ]
}`

const SYSTEM_RECHERCHE = `Du recherchierst ein einzelnes Krypto-Projekt.

Fasse zusammen, was sich über Team, Produkt, Whitepaper, geplante Börsen-
Listings und jüngste Nachrichten sagen lässt. Erfinde nichts. Wo sich nichts
finden lässt, sage das ausdrücklich — „keine Angaben auffindbar" ist ein
wertvolles Ergebnis, eine erfundene Firmengeschichte ist es nicht.

Antworte AUSSCHLIESSLICH mit JSON:
{"team":"…","produkt":"…","news":"…","listings":"…","warnzeichen":"…","vertrauen":"hoch|mittel|niedrig"}`

/** Kandidat als Textblock fürs Modell — kompakt, aber vollständig. */
function beschreibe(k) {
    const m = k.marktDaten || {}
    const s = k.sicherheitsDaten || {}
    const zeilen = [
        `${k.symbol}${k.name ? ` (${k.name})` : ''} auf ${k.chain || 'unbekannter Kette'}`,
        `  Hype-Note ${k.hypeScore}, Sicherheitsnote ${k.safetyScore}`,
        `  Narrativ: ${k.narrative || 'keines erkannt'}`,
        `  Quellen: ${(k.quellen || []).map((q) => q.quelle).join(', ') || 'unbekannt'}`,
    ]
    if (m.liquiditaetUsd) zeilen.push(`  Liquidität ${Math.round(m.liquiditaetUsd)} USD, Volumen 24h ${Math.round(m.volumen24h || 0)} USD`)
    if (m.fdv) zeilen.push(`  Bewertung (FDV) ${Math.round(m.fdv)} USD`)
    if (Number.isFinite(m.paarAlterStunden)) zeilen.push(`  Paar seit ${(m.paarAlterStunden / 24).toFixed(1)} Tagen`)
    if (s.hinweise?.length) zeilen.push(`  Sicherheitsbefunde: ${s.hinweise.join('; ')}`)
    else zeilen.push('  Sicherheitsbefunde: keine Auffälligkeiten')
    return zeilen.join('\n')
}

/**
 * Recherche zu einem Kandidaten über Perplexity Sonar.
 *
 * Sonar ist bereits im Haus und bringt seine Websuche mit — ein eigenes
 * Suchwerkzeug samt zusätzlichem Schlüssel wäre ein zweiter Weg zum selben
 * Ziel. Scheitert die Recherche, wird das vermerkt und der Kandidat kommt
 * ohne sie in den Bericht; er fällt nicht heraus.
 */
async function recherchiere(kandidat, einstellungen) {
    const frage = `Krypto-Projekt "${kandidat.symbol}"`
        + `${kandidat.name ? ` (${kandidat.name})` : ''}`
        + `${kandidat.chain ? ` auf ${kandidat.chain}` : ''}`
        + `${kandidat.contractAddress ? `, Vertrag ${kandidat.contractAddress}` : ''}`
        + '. Team, Produkt, Whitepaper, geplante Listings, jüngste Nachrichten, Warnzeichen.'

    const { provider, modell } = rollenAnbieter(einstellungen, 'research')
    try {
        // Perplexity bringt die Suche mit; andere Anbieter bekommen die Frage
        // ohne Netzzugang und antworten aus ihrem Wissen.
        if (provider === 'perplexity') {
            // `rechercheThema` verlangt den Schlüssel ausdrücklich — es lädt
            // ihn nicht selbst, damit es ohne Datenbank prüfbar bleibt.
            const cfg = await ladeLlmConfig({ provider: 'perplexity', model: modell || 'sonar' })
            const r = await rechercheThema({
                thema: kandidat.symbol,
                frage,
                apiKey: cfg.apiKey,
                modell: modell || 'sonar',
            })
            // Der Verbrauch wird in `rechercheThema` selbst gebucht.
            return { text: r?.text || '', belege: r?.citations || [], ok: true }
        }

        const cfg = await ladeLlmConfig({ provider, model: modell })
        cfg.maxTokens = 700
        const a = await callLLMJson(cfg, {
            system: SYSTEM_RECHERCHE,
            user: frage,
            timeoutMs: 60000,
            zweck: 'hype-recherche',
            ausloeser: einstellungen?._ausloeser || 'auto',
        })
        return { text: a.json ? JSON.stringify(a.json) : (a.text || ''), belege: [], ok: Boolean(a.json) }
    } catch (e) {
        logWarn('hype-radar', `Recherche zu ${kandidat.symbol} fehlgeschlagen: ${e.message}`)
        return { text: '', belege: [], ok: false, fehler: e.message }
    }
}

/**
 * Bericht erzeugen.
 *
 * @param {object[]} bestanden    Kandidaten, die Stufe 3 überstanden haben
 * @param {object[]} verworfen    Aussortierte, mit Grund
 * @param {object} einstellungen  llmStufe / llmModus / llmRollen
 * @param {function} melde        Fortschrittsmeldung an die Oberfläche
 */
export async function erzeugeBericht(bestanden, verworfen, einstellungen = {}, melde = () => {}) {
    const modus = einstellungen.llmModus || 'gruendlich'
    const topN = Number(einstellungen.berichtTopN) || 7
    const auswahl = [...bestanden]
        .sort((a, b) => b.hypeScore - a.hypeScore)
        .slice(0, topN)

    if (!auswahl.length) {
        /*
         * Kein bestandener Kandidat ist ein gültiges Ergebnis und kein Fehler
         * — an vielen Tagen hält schlicht nichts der Prüfung stand. Dafür ein
         * Sprachmodell zu bezahlen, wäre verschwendet.
         */
        return {
            ueberschrift: 'Keine Kandidaten',
            marktkontext: 'In diesem Lauf hat kein Fund die Sicherheitsprüfung bestanden.',
            kandidaten: [],
            aussortiert: verworfen.map((v) => ({ symbol: v.symbol, grund: v.verworfenGrund })),
            hinweis: HINWEIS,
            meta: { modus, ohneModell: true },
        }
    }

    const meta = { modus, rollen: {}, recherchen: {} }
    let recherchen = new Map()

    if (modus === 'gruendlich') {
        melde({ schritt: 'recherche', gesamt: auswahl.length })
        /*
         * Höchstens drei Recherchen gleichzeitig: Sonar und die übrigen
         * Anbieter drosseln bei parallelen Anfragen, und ein 429 mitten im
         * Lauf kostet mehr Zeit, als die Nebenläufigkeit einspart.
         */
        const grenze = 3
        for (let i = 0; i < auswahl.length; i += grenze) {
            const teil = auswahl.slice(i, i + grenze)
            const ergebnisse = await Promise.allSettled(
                teil.map((k) => recherchiere(k, einstellungen)))
            ergebnisse.forEach((e, j) => {
                const k = teil[j]
                const wert = e.status === 'fulfilled' ? e.value : { ok: false, fehler: String(e.reason) }
                recherchen.set(k.symbol, wert)
                meta.recherchen[k.symbol] = wert.ok ? 'ok' : (wert.fehler || 'fehlgeschlagen')
            })
            melde({ schritt: 'recherche', fertig: Math.min(i + grenze, auswahl.length), gesamt: auswahl.length })
        }
    }

    // ── Redakteur ───────────────────────────────────────────────────────
    melde({ schritt: 'bericht' })
    const { provider, modell } = rollenAnbieter(einstellungen, 'editor')
    meta.rollen.editor = { provider, modell }

    const teile = [
        `Heutiges Datum: ${new Date().toISOString().slice(0, 10)}`,
        '',
        'KANDIDATEN:',
        ...auswahl.map((k) => {
            const r = recherchen.get(k.symbol)
            const block = beschreibe(k)
            if (r?.text) return `${block}\n  Recherche: ${String(r.text).slice(0, 1500)}`
            if (modus === 'gruendlich') return `${block}\n  Recherche: nicht verfügbar`
            return block
        }),
    ]
    if (verworfen.length) {
        teile.push('', `AUSSORTIERT (${verworfen.length}), nur zur Einordnung des Marktumfelds:`,
            verworfen.slice(0, 25).map((v) => `  ${v.symbol}: ${v.verworfenGrund}`).join('\n'))
    }

    const cfg = await ladeLlmConfig({ provider, model: modell })
    // Der Bericht ist lang; zu knappes Budget liefert abgeschnittenes JSON,
    // das bezahlt und trotzdem wertlos ist.
    cfg.maxTokens = 4000
    const antwort = await callLLMJson(cfg, {
        system: SYSTEM_REDAKTEUR,
        user: teile.join('\n'),
        timeoutMs: 180000,
        zweck: 'hype-bericht',
        ausloeser: einstellungen?._ausloeser || 'auto',
    })

    const j = antwort.json
    if (!j) {
        throw new Error(antwort.abgeschnitten
            ? 'Die Antwort wurde abgeschnitten — Token-Budget zu klein.'
            : 'Das Modell hat keinen verwertbaren Bericht geliefert.')
    }

    /*
     * Nur Kandidaten übernehmen, die es auch gibt. Ein Modell, das ein Symbol
     * erfindet oder eines aus der Aussortiert-Liste hochstuft, darf das nicht
     * in den Bericht bekommen — die Sicherheitsprüfung wäre sonst umgangen.
     */
    const erlaubt = new Map(auswahl.map((k) => [k.symbol.toUpperCase(), k]))
    const kandidaten = (Array.isArray(j.kandidaten) ? j.kandidaten : [])
        .map((k) => {
            const original = erlaubt.get(String(k?.symbol || '').toUpperCase())
            if (!original) return null
            const r = recherchen.get(original.symbol)
            return {
                symbol: original.symbol,
                name: original.name,
                chain: original.chain,
                contractAddress: original.contractAddress,
                hypeScore: original.hypeScore,
                safetyScore: original.safetyScore,
                narrative: original.narrative,
                einordnung: String(k.einordnung || '').slice(0, 1200),
                substanz: String(k.substanz || '').slice(0, 1200),
                risiken: String(k.risiken || '').slice(0, 1200),
                vertrauen: ['hoch', 'mittel', 'niedrig'].includes(k.vertrauen) ? k.vertrauen : 'niedrig',
                belege: r?.belege || [],
                marktDaten: original.marktDaten,
            }
        })
        .filter(Boolean)

    const erfunden = (Array.isArray(j.kandidaten) ? j.kandidaten.length : 0) - kandidaten.length
    if (erfunden > 0) {
        meta.verworfeneAntworten = erfunden
        logWarn('hype-radar', `${erfunden} Kandidat(en) aus der Modellantwort verworfen: nicht in der Auswahl`)
    }

    return {
        ueberschrift: String(j.ueberschrift || 'Hype-Radar').slice(0, 200),
        marktkontext: String(j.marktkontext || '').slice(0, 2000),
        kandidaten,
        aussortiert: verworfen.map((v) => ({ symbol: v.symbol, grund: v.verworfenGrund })),
        hinweis: HINWEIS,
        meta: { ...meta, tokens: antwort.usage?.totalTokens || 0, kostenUsd: antwort.costUsd || 0 },
    }
}
