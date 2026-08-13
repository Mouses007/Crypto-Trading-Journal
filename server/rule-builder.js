/**
 * Strategien im Gespräch bauen.
 *
 * Der Unterschied zum älteren `strategy-builder.js`: dort entstand eine
 * Entwurfsdatei, deren `detect()` ein Mensch noch schreiben musste. Hier
 * entsteht eine REGELBESCHREIBUNG für den Interpreter — sie ist sofort
 * lauffähig, backtestbar und im Editor weiterzubearbeiten.
 *
 * ── Warum das sicher ist ────────────────────────────────────────────────
 * Das Modell schreibt keinen Code und wählt nichts frei. Es füllt eine
 * Beschreibung aus einem FESTEN Vokabular (`BAUSTEINE`) aus. Jede Antwort
 * läuft durch `pruefeRegeln()`; ein unbekannter Baustein ist ein
 * Validierungsfehler, keine Ausführung. Was nicht durch die Prüfung kommt,
 * wird nie gespeichert.
 *
 * ── Warum die Rückkopplung ──────────────────────────────────────────────
 * Ein Modell trifft eine 40-Feld-Struktur selten im ersten Versuch exakt.
 * Statt dem Nutzer eine Fehlerliste hinzuwerfen, bekommt das Modell die
 * Fehlertexte zurück und darf nachbessern (`MAX_VERSUCHE`). Das ist der
 * Unterschied zwischen "geht nicht" und "geht beim zweiten Anlauf".
 */

import { getKnex } from './database.js'
import { ladeLlmConfig, callLLMJson, pruefeAnhaenge } from './llm.js'
import { BAUSTEINE } from './strategies/rule-engine.js'
import { pruefeRegeln } from './strategies/rule-validate.js'
import { VORLAGEN } from './strategies/rule-templates.js'
import { istEingebaut } from './strategies/index.js'
import { ladeAlleRegelStrategien } from './strategy-api.js'
import { logError } from './logger.js'

const MAX_VERSUCHE = 3
const MAX_ANHANG_BYTES = 8 * 1024 * 1024
const MAX_ANHAENGE_GESAMT = 24 * 1024 * 1024

/**
 * Der Prompt wird aus BAUSTEINE ERZEUGT, nicht danebengeschrieben.
 *
 * Das ist Absicht: käme ein Baustein dazu und der Prompt bliebe stehen, würde
 * das Modell ihn nie nutzen — und niemand merkte es, weil nichts fehlschlägt.
 * So kann die Beschreibung gar nicht erst auseinanderlaufen.
 */
export function baueSystemPrompt() {
    const beispiel = VORLAGEN.find((v) => v.key === 'ema_pullback')
    return `Du baust Handelsstrategien für ein System, das eine Regelbeschreibung
mit einem festen Interpreter ausführt. Du schreibst KEINEN Code — du wählst aus
einem festen Vokabular aus.

Halte dich exakt an dieses Vokabular. Alles andere wird abgelehnt:

Indikatoren (Feld "type"): ${BAUSTEINE.indikatoren.join(', ')}
  - ema, sma, rsi, atr brauchen "period" (Zahl oder {"param":"name"})
  - vwap und vwapBand brauchen "anchor": ${BAUSTEINE.vwapAnker.join(' oder ')}
    ("session" = Rücksetzen zum UTC-Tageswechsel, "rolling" = gleitendes Fenster
    über "period"). vwapBand zusätzlich "mult" (Standardabweichungen,
    negativ = unteres Band).
Auslöser (signal.type): ${BAUSTEINE.signale.join(', ')}
  - pivotHigh/pivotLow: "left" und "right" (Kerzen links/rechts zur Bestätigung)
  - crossUp/crossDown: "a" und "b" (zwei Referenzen, die sich kreuzen)
Vergleiche (op): ${BAUSTEINE.vergleiche.join(', ')}
  - distancePctGt/distancePctLt brauchen zusätzlich "value" (Prozent)
  - isBullish/isBearish/higherThanPrevSignal/lowerThanPrevSignal haben KEINE
    "left"/"right"-Seiten
Referenzen (überall wo left/right/anchor/a/b steht):
  ${BAUSTEINE.anker.join(', ')} — oder die "id" eines Indikators,
  den du selbst definiert hast, oder {"param":"name"} für einen Parameter.
Einstieg (entry.type): ${BAUSTEINE.einstieg.join(', ')}
  - touch: "anchor" (worauf der Kurs zurücklaufen muss) und "from": above|below
  - immediate: sofort beim bestätigten Auslöser
Ziel (takeProfit.mode): ${BAUSTEINE.ziele.join(', ')}
  - rr: "rr" (Chance/Risiko-Verhältnis), anchor: "anchor", none: kein festes Ziel

So sieht eine vollständige Beschreibung aus:
${JSON.stringify(beispiel.rules, null, 1)}

Verstehe das Zielsystem:
- Gerechnet wird auf ABGESCHLOSSENEN Kerzen. Regeln, die den Verlauf INNERHALB
  einer Kerze brauchen, sind nicht umsetzbar — sag das dann offen.
- Ein Setup lebt über viele Kerzen: Auslöser → Warten → Einstieg. "invalidations"
  wird in dieser Wartezeit bei JEDER Kerze geprüft.
- Jeder Schwellenwert gehört als Parameter ins Schema, nicht als feste Zahl in
  die Regel — nur Parameter kann der Backtest später variieren.
- Risiko, Positionsgrösse, Gebühren und Hebel regelt das System zentral.
  Lass sie weg.
- "direction" ist long ODER short, nicht beides. Für beide Richtungen braucht es
  zwei Strategien.

Antworte ausschliesslich mit JSON in genau dieser Form:
{
  "antwort": "Deine Nachricht an den Nutzer, deutsch, kurz",
  "offeneFragen": ["Was du noch wissen musst"],
  "nichtUmsetzbar": ["Regeln aus der Vorlage, die dieses Vokabular nicht abbildet"],
  "regeln": { ...Beschreibung wie oben, zusätzlich "id" (kurzname_klein) und "name"... }
}

- Gib "regeln" nur zurück, wenn du genug weisst. Sonst "regeln": null und frage nach.
- RATE NICHT. Was das Dokument offen lässt, kommt in "offeneFragen".
- Was du mit dem Vokabular nicht ausdrücken kannst, kommt in "nichtUmsetzbar" —
  verschweige es nicht und baue keinen Ersatz, der etwas anderes tut.`
}

/** Anhänge prüfen — dieselben Grenzen wie im älteren Baukasten. */
function pruefeUploads(roh) {
    const liste = Array.isArray(roh) ? roh : []
    let summe = 0
    return liste.slice(0, 10).map((a) => {
        const name = String(a?.name || 'datei').slice(0, 200)
        const base64 = String(a?.base64 || '')
        const bytes = Math.floor(base64.length * 0.75)
        if (bytes > MAX_ANHANG_BYTES) throw new Error(`"${name}" ist grösser als 8 MB`)
        summe += bytes
        if (summe > MAX_ANHAENGE_GESAMT) throw new Error('Zusammen mehr als 24 MB — bitte weniger auf einmal')
        const typ = String(a?.mediaType || '')
        const kind = typ.startsWith('image/') ? 'image'
            : typ === 'application/pdf' ? 'pdf'
                : 'text'
        return { name, base64, mediaType: typ, kind }
    })
}

const parseJson = (v, f) => {
    if (v === null || v === undefined) return f
    if (typeof v === 'object') return v
    try { return JSON.parse(v) } catch { return f }
}

/**
 * Ein Modellaufruf plus Nachbesserungsrunden.
 *
 * Rückgabe enthält immer den letzten Antworttext — auch wenn keine gültige
 * Beschreibung zustande kam, damit der Nutzer sieht, woran es lag.
 *
 * `aufruf` ist einspeisbar, damit der Selbsttest die Schleife ohne echtes
 * Modell prüfen kann — die Nachbesserung ist die Stelle, die stillschweigend
 * kaputtgehen könnte.
 */
export async function frageModell(cfg, { system, user, anhaenge }, aufruf = callLLMJson) {
    let eingabe = user
    let letzte = null
    const versuche = []

    for (let n = 1; n <= MAX_VERSUCHE; n++) {
        const antwort = await aufruf(
            { ...cfg, maxTokens: 16000 },
            { system, user: eingabe, anhaenge, timeoutMs: 180000 },
        )
        letzte = antwort
        if (!antwort.json) return { antwort, regeln: null, fehler: [], versuche }

        const roh = antwort.json.regeln
        if (!roh) return { antwort, regeln: null, fehler: [], versuche }

        const geprueft = pruefeRegeln(roh)
        versuche.push({ nr: n, ok: geprueft.ok, fehler: geprueft.fehler })
        if (geprueft.ok) return { antwort, regeln: geprueft.regeln, hinweise: geprueft.hinweise, versuche }

        if (n === MAX_VERSUCHE) return { antwort, regeln: null, fehler: geprueft.fehler, versuche }

        // Nachbessern lassen: die Fehler sind präzise genug, um sie direkt
        // zurückzugeben. Die ursprüngliche Aufgabe bleibt im Prompt stehen,
        // sonst korrigiert das Modell ins Leere.
        eingabe = `${user}

Dein letzter Versuch wurde abgelehnt. Diese Fehler musst du beheben:
${geprueft.fehler.map((f) => `- ${f}`).join('\n')}

Gib die vollständige Beschreibung erneut aus — nicht nur den geänderten Teil.`
    }
    return { antwort: letzte, regeln: null, fehler: [], versuche }
}

export function setupRuleBuilderRoutes(app) {
    /**
     * Ein Gesprächsschritt: Beschreibung und/oder Datei rein, geprüfte
     * Regelstrategie raus.
     */
    app.post('/api/strategies/builder/rules/chat', async (req, res) => {
        try {
            const knex = getKnex()
            const nachricht = String(req.body?.message || '').slice(0, 8000)
            let anhaenge
            try { anhaenge = pruefeUploads(req.body?.attachments) }
            catch (e) { return res.status(400).json({ error: e.message }) }

            if (!nachricht && !anhaenge.length) {
                return res.status(400).json({ error: 'Bitte eine Nachricht oder eine Datei mitgeben' })
            }

            const textDateien = anhaenge.filter((a) => a.kind === 'text')
            const modellAnhaenge = anhaenge.filter((a) => a.kind !== 'text')

            const draftId = Number(req.body?.draftId) || 0
            const vorhanden = draftId ? await knex('strategy_drafts').where('id', draftId).first() : null
            const verlauf = vorhanden ? parseJson(vorhanden.messages, []) : []

            const cfg = await ladeLlmConfig()
            const pruefung = pruefeAnhaenge(cfg.provider, modellAnhaenge)
            if (!pruefung.ok) {
                return res.status(400).json({
                    error: `${cfg.provider} kann diese Dateien nicht lesen: ${pruefung.nichtUnterstuetzt.join(', ')}. `
                        + 'Anthropic und Gemini verstehen PDFs direkt — sonst bitte Bilder oder Text.',
                })
            }

            const teile = []
            if (verlauf.length) {
                teile.push('Bisheriges Gespräch:\n' + verlauf
                    .map((m) => `${m.role === 'user' ? 'Nutzer' : 'Du'}: ${m.content}`).join('\n'))
            }
            // Die bereits erarbeitete Beschreibung mitgeben, sonst fängt jede
            // Folgefrage („mach das Ziel auf 3R") wieder bei null an.
            const bisher = parseJson(vorhanden?.spec, null)
            if (bisher) {
                teile.push('Bisher erarbeitete Beschreibung:\n' + JSON.stringify(bisher))
            }
            for (const t of textDateien) {
                const inhalt = Buffer.from(t.base64, 'base64').toString('utf8').slice(0, 60000)
                teile.push(`Datei "${t.name}":\n${inhalt}`)
            }
            if (nachricht) teile.push(`Nutzer: ${nachricht}`)
            if (modellAnhaenge.length) {
                teile.push(`Beigefügt: ${modellAnhaenge.map((a) => a.name).join(', ')}`)
            }

            const ergebnis = await frageModell(cfg, {
                system: baueSystemPrompt(),
                user: teile.join('\n\n'),
                anhaenge: modellAnhaenge,
            })
            const antwort = ergebnis.antwort

            if (!antwort.json) {
                const auszug = String(antwort.text || '').trim().slice(0, 400)
                const grund = antwort.abgeschnitten
                    ? 'Die Antwort wurde abgeschnitten (Token-Grenze erreicht). Bitte in kleineren '
                        + 'Schritten arbeiten — erst die Regeln klären, dann die Parameter.'
                    : auszug
                        ? `Das Modell hat statt JSON Folgendes geantwortet: "${auszug}"`
                        : 'Das Modell hat eine leere Antwort geliefert.'
                return res.status(502).json({ error: grund, stopReason: antwort.stopReason })
            }

            const text = String(antwort.json.antwort || '').slice(0, 4000)
            const kurz = (l) => (Array.isArray(l) ? l : []).map((f) => String(f).slice(0, 300)).slice(0, 20)
            const fragen = kurz(antwort.json.offeneFragen)
            const nichtUmsetzbar = kurz(antwort.json.nichtUmsetzbar)

            const neuerVerlauf = [
                ...verlauf,
                { role: 'user', content: nachricht || `[${anhaenge.map((a) => a.name).join(', ')}]` },
                { role: 'assistant', content: text },
            ].slice(-40)

            const regeln = ergebnis.regeln
            const datensatz = {
                title: regeln?.name || vorhanden?.title || (nachricht || 'Entwurf').slice(0, 120),
                slug: regeln?.id || vorhanden?.slug || '',
                sourceName: anhaenge.map((a) => a.name).join(', ').slice(0, 300) || vorhanden?.sourceName || '',
                spec: JSON.stringify(regeln || bisher),
                messages: JSON.stringify(neuerVerlauf),
                provider: cfg.provider, model: cfg.model,
                costUsd: (Number(vorhanden?.costUsd) || 0) + antwort.costUsd,
                updatedAt: knex.fn.now(),
            }

            const isPg = knex.client.config.client === 'pg'
            let id = draftId
            if (vorhanden) {
                await knex('strategy_drafts').where('id', draftId).update(datensatz)
            } else {
                id = isPg
                    ? (await knex('strategy_drafts').insert(datensatz).returning('id'))[0]?.id
                    : (await knex('strategy_drafts').insert(datensatz))[0]
            }

            res.json({
                draftId: id,
                antwort: text,
                offeneFragen: fragen,
                nichtUmsetzbar,
                regeln,
                fehler: ergebnis.fehler || [],
                hinweise: ergebnis.hinweise || [],
                // Wie oft nachgebessert werden musste — nützlich, um zu sehen,
                // ob das gewählte Modell mit der Struktur zurechtkommt.
                versuche: ergebnis.versuche.length,
                costUsd: antwort.costUsd,
                provider: cfg.provider,
                model: cfg.model,
            })
        } catch (e) {
            logError('rule-builder', 'Chat fehlgeschlagen', e)
            res.status(500).json({ error: e.message })
        }
    })

    /**
     * Aus dem Entwurf eine echte Strategie machen.
     * Erst hier wird registriert — vorher kann nichts davon handeln.
     */
    app.post('/api/strategies/builder/rules/:id/save', async (req, res) => {
        try {
            const knex = getKnex()
            const row = await knex('strategy_drafts').where('id', req.params.id).first()
            if (!row) return res.status(404).json({ error: 'Nicht gefunden' })

            const roh = parseJson(row.spec, null)
            if (!roh) return res.status(400).json({ error: 'Dieser Entwurf hat noch keine Beschreibung' })

            // Erneut prüfen statt der gespeicherten Fassung zu vertrauen: zwischen
            // Erzeugen und Speichern kann sich das Vokabular geändert haben.
            const geprueft = pruefeRegeln(roh)
            if (!geprueft.ok) return res.status(400).json({ error: geprueft.fehler.join('; ') })

            const regeln = geprueft.regeln
            if (istEingebaut(regeln.id)) {
                return res.status(409).json({
                    error: `"${regeln.id}" ist von einer eingebauten Strategie belegt — bitte umbenennen.`,
                })
            }
            const doppelt = await knex('rule_strategies').where('strategyId', regeln.id).first()
            if (doppelt) {
                return res.status(409).json({
                    error: `"${regeln.id}" gibt es schon. Bitte im Entwurf umbenennen.`,
                })
            }

            const isPg = knex.client.config.client === 'pg'
            const datensatz = {
                strategyId: regeln.id,
                name: regeln.name || regeln.id,
                description: String(roh.description || '').slice(0, 1000),
                enabled: true,
                rules: JSON.stringify(regeln),
                source: 'chat',
                createdAt: knex.fn.now(),
                updatedAt: knex.fn.now(),
            }
            const id = isPg
                ? (await knex('rule_strategies').insert(datensatz).returning('id'))[0]?.id
                : (await knex('rule_strategies').insert(datensatz))[0]

            await knex('strategy_drafts').where('id', row.id)
                .update({ status: 'generated', updatedAt: knex.fn.now() })
            await ladeAlleRegelStrategien()

            res.json({
                ok: true, id, strategyId: regeln.id,
                hinweise: geprueft.hinweise,
            })
        } catch (e) {
            logError('rule-builder', 'Speichern fehlgeschlagen', e)
            res.status(500).json({ error: e.message })
        }
    })
}
