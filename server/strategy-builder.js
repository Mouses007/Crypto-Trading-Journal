/**
 * Strategie-Baukasten.
 *
 * Nimmt ein Dokument (Regelbeschreibung, Chartbilder, PDF) entgegen und leitet
 * daraus eine strukturierte Strategie-Beschreibung ab: Parameter-Schema,
 * Einstiegsregeln, Invalidierungen, Ausstieg.
 *
 * ── Die Sicherheitsregel dieses Moduls ──────────────────────────────────
 * Eine Strategie ist ausführbarer Code in einem Prozess, der Börsen-Schlüssel
 * hält und Orders senden kann. Deshalb wird hier NIEMALS Code ausgeführt oder
 * geladen, den ein Sprachmodell geschrieben hat.
 *
 * Konkret: Die erzeugte Moduldatei entsteht aus einer FESTEN Vorlage in dieser
 * Datei. Vom Modell stammen ausschliesslich
 *   - Daten (das Parameter-Schema, streng geprüft), und
 *   - Kommentare (die Regeln im Klartext).
 * Die `detect()`-Funktion bleibt ein Rumpf, der bewusst wirft. Ein Mensch muss
 * sie implementieren. Ausserdem heisst die Datei `_entwurf_*.js` und wird von
 * der Registry nicht importiert — sie kann nicht versehentlich handeln.
 */

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { getKnex } from './database.js'
import { logError } from './logger.js'
import { ladeStrategieLlmConfig, callLLMJson, pruefeAnhaenge } from './llm.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STRATEGIEN_VERZEICHNIS = path.join(__dirname, 'strategies')

const SLUG_RE = /^[a-z][a-z0-9_]{1,40}$/
const PARAM_TYPEN = ['number', 'integer', 'boolean', 'select', 'string']
const MAX_ANHANG_BYTES = 8 * 1024 * 1024
const MAX_ANHAENGE_GESAMT = 24 * 1024 * 1024
const MAX_PARAMS = 60
const ERLAUBTE_TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w']

// ── Prompt ───────────────────────────────────────────────────────────────

const SYSTEM = `Du hilfst dabei, eine Handelsstrategie aus einer Beschreibung in eine
strukturierte Form zu bringen, aus der ein Entwickler ein Modul bauen kann.

Du schreibst KEINEN Code. Du beschreibst Regeln und Parameter.

Wichtig zum Verständnis des Zielsystems:
- Eine Strategie arbeitet auf ABGESCHLOSSENEN Kerzen. Regeln, die den Verlauf
  innerhalb einer Kerze brauchen, sind nicht umsetzbar — sage das dann.
- Jeder Schwellenwert gehört als Parameter mit Wertebereich ins Schema, nicht
  als feste Zahl in die Regel. Wenn im Dokument "20-30 %" steht, wird daraus
  ein Parameter mit default 25, min 20, max 30 (oder weiter gefasst).
- Ein Setup kann über viele Kerzen leben (Signal → Warten → Einstieg). Beschreibe
  die Abbruchgründe ("Invalidierungen") einzeln und gib jedem einen kurzen Code.
- Risiko, Positionsgrösse, Gebühren und Hebel sind NICHT Teil der Strategie —
  die regelt das System zentral. Lass sie weg.

Antworte ausschliesslich mit JSON in genau dieser Form:
{
  "antwort": "Deine Nachricht an den Nutzer, deutsch, kurz",
  "offeneFragen": ["Was du noch wissen musst"],
  "spec": {
    "slug": "kurzname_klein_mit_unterstrich",
    "name": "Anzeigename",
    "description": "Ein Satz",
    "supportedTimeframes": ["15m","1h","4h"],
    "warmupCandles": 300,
    "paramGroups": [{"id":"entry","label":"Einstieg"}],
    "params": [
      {"key":"nameDesParameters","type":"number","default":25,"min":5,"max":60,
       "step":1,"group":"entry","label":"Klartext","hint":"Wozu er dient"}
    ],
    "rules": {
      "context": "Marktumfeld/Vorbedingungen",
      "entryLong": ["Schritt für Schritt"],
      "entryShort": ["Schritt für Schritt"],
      "invalidations": [{"code":"kurz_und_klein","description":"Wann das Setup stirbt"}],
      "stopLoss": "Wo der Stop liegt",
      "takeProfit": "Wo das Ziel liegt"
    },
    "detectPseudocode": ["Erkennungslogik in nummerierten Schritten"]
  }
}

Regeln für das JSON:
- "type" ist number, integer, boolean, select oder string. Bei select gehört
  eine "options"-Liste dazu.
- Zahlen-Parameter brauchen immer default, min und max.
- Lässt das Dokument etwas offen, RATE NICHT. Stell die Frage in "offeneFragen"
  und lass den Parameter weg oder markiere ihn im hint als unsicher.
- Gib "spec" nur zurück, wenn du genug weisst. Sonst "spec": null und frage nach.`

// ── Prüfung der Spec ─────────────────────────────────────────────────────

/**
 * Prüft die vom Modell gelieferte Beschreibung streng.
 * Alles, was hier durchkommt, landet später als DATEN in der Moduldatei —
 * also darf nichts durch, was dort Unsinn anrichten könnte.
 *
 * @returns {{ ok: boolean, fehler: string[], spec?: object }}
 */
export function pruefeSpec(roh) {
    const fehler = []
    if (!roh || typeof roh !== 'object') return { ok: false, fehler: ['Keine Beschreibung erhalten'] }

    const slug = String(roh.slug || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40)
    if (!SLUG_RE.test(slug)) fehler.push(`Ungültiger Kurzname: "${roh.slug}"`)

    const timeframes = (Array.isArray(roh.supportedTimeframes) ? roh.supportedTimeframes : [])
        .filter((tf) => ERLAUBTE_TIMEFRAMES.includes(tf))
    if (!timeframes.length) fehler.push('Keine gültige Zeiteinheit angegeben')

    const params = []
    const gesehen = new Set()
    for (const p of Array.isArray(roh.params) ? roh.params.slice(0, MAX_PARAMS) : []) {
        const key = String(p?.key || '')
        if (!/^[a-zA-Z][a-zA-Z0-9]{0,40}$/.test(key)) { fehler.push(`Ungültiger Parametername: "${key}"`); continue }
        if (gesehen.has(key)) { fehler.push(`Doppelter Parameter: ${key}`); continue }
        if (!PARAM_TYPEN.includes(p.type)) { fehler.push(`${key}: unbekannter Typ "${p.type}"`); continue }
        gesehen.add(key)

        const eintrag = {
            key, type: p.type,
            group: String(p.group || 'other').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30) || 'other',
            label: String(p.label || key).slice(0, 120),
            hint: String(p.hint || '').slice(0, 300),
        }

        if (p.type === 'number' || p.type === 'integer') {
            const d = Number(p.default); const min = Number(p.min); const max = Number(p.max)
            if (!Number.isFinite(d) || !Number.isFinite(min) || !Number.isFinite(max)) {
                fehler.push(`${key}: default, min und max müssen Zahlen sein`); continue
            }
            if (min > max) { fehler.push(`${key}: min ist grösser als max`); continue }
            eintrag.default = Math.min(Math.max(d, min), max)
            eintrag.min = min
            eintrag.max = max
            eintrag.step = Number.isFinite(Number(p.step)) ? Number(p.step) : (p.type === 'integer' ? 1 : 0.1)
        } else if (p.type === 'boolean') {
            eintrag.default = Boolean(p.default)
        } else if (p.type === 'select') {
            const optionen = (Array.isArray(p.options) ? p.options : [])
                .map((o) => (typeof o === 'object' ? o.value : o))
                .filter((o) => typeof o === 'string' || typeof o === 'number')
                .slice(0, 30)
            if (!optionen.length) { fehler.push(`${key}: select ohne Optionen`); continue }
            eintrag.options = optionen
            eintrag.default = optionen.includes(p.default) ? p.default : optionen[0]
        } else {
            eintrag.default = String(p.default ?? '').slice(0, 200)
        }
        params.push(eintrag)
    }
    if (!params.length) fehler.push('Kein einziger Parameter erkannt')

    const regeln = roh.rules && typeof roh.rules === 'object' ? roh.rules : {}
    const liste = (v) => (Array.isArray(v) ? v : [v]).filter(Boolean).map((x) => String(x).slice(0, 500)).slice(0, 40)

    const spec = {
        slug, name: String(roh.name || slug).slice(0, 120),
        description: String(roh.description || '').slice(0, 500),
        supportedTimeframes: timeframes,
        warmupCandles: Math.min(Math.max(Number(roh.warmupCandles) || 300, 50), 2000),
        paramGroups: (Array.isArray(roh.paramGroups) ? roh.paramGroups : [])
            .map((g) => ({
                id: String(g?.id || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30),
                label: String(g?.label || g?.id || '').slice(0, 80),
            }))
            .filter((g) => g.id).slice(0, 20),
        params,
        rules: {
            context: String(regeln.context || '').slice(0, 1000),
            entryLong: liste(regeln.entryLong),
            entryShort: liste(regeln.entryShort),
            invalidations: (Array.isArray(regeln.invalidations) ? regeln.invalidations : [])
                .map((i) => ({
                    code: String(i?.code || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40),
                    description: String(i?.description || '').slice(0, 300),
                }))
                .filter((i) => i.code).slice(0, 30),
            stopLoss: String(regeln.stopLoss || '').slice(0, 500),
            takeProfit: String(regeln.takeProfit || '').slice(0, 500),
        },
        detectPseudocode: liste(roh.detectPseudocode),
    }

    return { ok: fehler.length === 0, fehler, spec }
}

// ── Erzeugung der Moduldatei ─────────────────────────────────────────────

/** Macht Text kommentarsicher: ein `*​/` würde den Block sonst vorzeitig schliessen. */
const alsKommentar = (text) => String(text || '').replace(/\*\//g, '* /')

const zeilen = (arr, praefix) => (arr.length
    ? arr.map((z, i) => ` * ${praefix}${i + 1}. ${alsKommentar(z)}`).join('\n')
    : ` * ${praefix}(nicht beschrieben)`)

/**
 * Baut den Quelltext des Entwurfsmoduls.
 *
 * Rein und ohne Seiteneffekte, damit sie testbar ist — und damit man sich
 * ansehen kann, was geschrieben würde, bevor etwas geschrieben wird.
 */
export function baueModulQuelltext(spec) {
    const gruppen = spec.paramGroups.length
        ? spec.paramGroups
        : [...new Set(spec.params.map((p) => p.group))].map((id) => ({ id, label: id }))

    const paramZeilen = spec.params.map((p) => {
        // Nur geprüfte Felder, alle über JSON.stringify — nichts wird interpoliert.
        const felder = ['key', 'type', 'default', 'min', 'max', 'step', 'options', 'group']
            .filter((f) => p[f] !== undefined)
            .map((f) => `${f}: ${JSON.stringify(p[f])}`)
            .join(', ')
        const kommentar = p.hint ? `   // ${alsKommentar(p.hint)}` : ''
        return `    { ${felder} },${kommentar}`
    }).join('\n')

    const invalid = spec.rules.invalidations.map(
        (i) => `    ${i.code.toUpperCase()}: '${i.code}',   // ${alsKommentar(i.description)}`,
    ).join('\n')

    return `/**
 * ${alsKommentar(spec.name)} — ENTWURF, NOCH NICHT LAUFFÄHIG.
 *
 * ${alsKommentar(spec.description)}
 *
 * Diese Datei wurde aus einer Dokumentbeschreibung erzeugt. Das Parameter-
 * Schema unten ist geprüft und benutzbar. Die Erkennungslogik ist es NICHT —
 * \`detect()\` wirft absichtlich, bis ein Mensch sie implementiert hat.
 *
 * Die Datei heisst \`_entwurf_*\` und wird von \`strategies/index.js\` nicht
 * importiert. Zum Scharfschalten: Logik implementieren, Selbsttest nach dem
 * Vorbild von \`__selftest.mjs\` schreiben, umbenennen, registrieren.
 *
 * ── Marktumfeld ──
 * ${alsKommentar(spec.rules.context) || '(nicht beschrieben)'}
 *
 * ── Einstieg Long ──
${zeilen(spec.rules.entryLong, '')}
 *
 * ── Einstieg Short ──
${zeilen(spec.rules.entryShort, '')}
 *
 * ── Stop ──
 * ${alsKommentar(spec.rules.stopLoss) || '(nicht beschrieben)'}
 *
 * ── Ziel ──
 * ${alsKommentar(spec.rules.takeProfit) || '(nicht beschrieben)'}
 *
 * ── Vorgeschlagene Erkennungslogik ──
${zeilen(spec.detectPseudocode, 'Schritt ')}
 */

export const DETECTOR_VERSION = 1

/** Abbruchgründe. Die Auswertung gruppiert danach — Codes stabil halten. */
export const INVALID_REASONS = {
${invalid || "    // (keine beschrieben)"}
}

const params = [
${paramZeilen}
]

const paramGroups = [
${gruppen.map((g) => `    { id: ${JSON.stringify(g.id)}, labelKey: ${JSON.stringify(g.label)} },`).join('\n')}
]

/**
 * @param {object} input
 * @param {Array}  input.candles      geschlossene Kerzen, aufsteigend
 * @param {object} input.params       validierte Parameter
 * @param {Array}  input.openSetups   laufende Setups mit id
 * @param {Array}  input.knownSetupKeys  ALLE bekannten Schlüssel im Scan-Fenster
 *
 * @returns {{ setups: Array, events: Array, diagnostics: object }}
 *
 * Muss eine REINE Funktion sein: kein DB-Zugriff, kein Netz, kein Date.now().
 * Orientierung bietet \`lsob.js\` — dort steht dieselbe Struktur vollständig.
 */
function detect() {
    throw new Error(
        ${JSON.stringify(spec.name + ' ist ein Entwurf: detect() ist noch nicht implementiert. '
            + 'Die Regeln stehen im Kopf dieser Datei.')},
    )
}

export default {
    id: ${JSON.stringify('entwurf_' + spec.slug)},
    name: ${JSON.stringify(spec.name + ' (Entwurf)')},
    description: ${JSON.stringify(spec.description)},
    version: DETECTOR_VERSION,
    supportedTimeframes: ${JSON.stringify(spec.supportedTimeframes)},
    warmupCandles: ${spec.warmupCandles},
    params,
    paramGroups,
    detect,
}
`
}

/** Schreibt den Entwurf auf die Platte. Pfad ist durch den Slug-Filter gesichert. */
export async function schreibeEntwurf(spec) {
    if (!SLUG_RE.test(spec.slug)) throw new Error('Ungültiger Kurzname')
    const datei = `_entwurf_${spec.slug}.js`
    const ziel = path.join(STRATEGIEN_VERZEICHNIS, datei)

    // Doppelter Boden gegen Pfadausbrüche
    if (path.dirname(path.resolve(ziel)) !== path.resolve(STRATEGIEN_VERZEICHNIS)) {
        throw new Error('Unerlaubter Zielpfad')
    }

    const quelltext = baueModulQuelltext(spec)
    await fs.writeFile(ziel, quelltext, 'utf8')
    return { datei, pfad: path.relative(path.join(__dirname, '..'), ziel), quelltext }
}

// ── Routen ───────────────────────────────────────────────────────────────

function parseJson(v, f) {
    if (v === null || v === undefined) return f
    if (typeof v === 'object') return v
    try { return JSON.parse(v) } catch { return f }
}

/** Anhänge normalisieren und begrenzen. */
function pruefeUploads(roh) {
    const raus = []
    let gesamt = 0
    for (const a of Array.isArray(roh) ? roh.slice(0, 10) : []) {
        const base64 = String(a?.base64 || '')
        const bytes = Math.floor(base64.length * 0.75)
        if (!base64) continue
        if (bytes > MAX_ANHANG_BYTES) throw new Error(`"${a.name}" ist zu gross (max 8 MB)`)
        gesamt += bytes
        if (gesamt > MAX_ANHAENGE_GESAMT) throw new Error('Anhänge insgesamt zu gross (max 24 MB)')

        const mediaType = String(a.mediaType || '')
        const kind = mediaType === 'application/pdf' ? 'pdf'
            : mediaType.startsWith('image/') ? 'image' : 'text'
        raus.push({ name: String(a.name || '').slice(0, 200), kind, mediaType, base64 })
    }
    return raus
}

export function setupStrategyBuilderRoutes(app) {

    /** Welche Anhänge kann der eingestellte Anbieter? Steuert die UI. */
    app.get('/api/strategies/builder/capabilities', async (req, res) => {
        try {
            const cfg = await ladeStrategieLlmConfig()
            const { ok } = pruefeAnhaenge(cfg.provider, [{ kind: 'pdf' }])
            const { ok: bilder } = pruefeAnhaenge(cfg.provider, [{ kind: 'image' }])
            res.json({ provider: cfg.provider, model: cfg.model, pdf: ok, image: bilder, text: true })
        } catch (e) {
            res.status(500).json({ error: e.message })
        }
    })

    app.get('/api/strategies/builder/drafts', async (req, res) => {
        try {
            const rows = await getKnex()('strategy_drafts').orderBy('id', 'desc').limit(50)
            res.json(rows.map((r) => ({
                ...r, objectId: String(r.id),
                spec: parseJson(r.spec, null), messages: parseJson(r.messages, []),
            })))
        } catch (e) {
            res.status(500).json({ error: 'Entwürfe konnten nicht geladen werden' })
        }
    })

    app.delete('/api/strategies/builder/drafts/:id', async (req, res) => {
        try {
            const n = await getKnex()('strategy_drafts').where('id', req.params.id).delete()
            if (!n) return res.status(404).json({ error: 'Nicht gefunden' })
            res.json({ ok: true })
        } catch (e) {
            res.status(500).json({ error: 'Entwurf konnte nicht gelöscht werden' })
        }
    })

    /** Ein Gesprächsschritt: Dokument und/oder Nachricht rein, Beschreibung raus. */
    app.post('/api/strategies/builder/chat', async (req, res) => {
        try {
            const knex = getKnex()
            const nachricht = String(req.body?.message || '').slice(0, 8000)
            let anhaenge
            try { anhaenge = pruefeUploads(req.body?.attachments) }
            catch (e) { return res.status(400).json({ error: e.message }) }

            if (!nachricht && !anhaenge.length) {
                return res.status(400).json({ error: 'Bitte eine Nachricht oder eine Datei mitgeben' })
            }

            // Reine Textdateien wandern in den Prompt statt als Anhang
            const textDateien = anhaenge.filter((a) => a.kind === 'text')
            const modellAnhaenge = anhaenge.filter((a) => a.kind !== 'text')

            const draftId = Number(req.body?.draftId) || 0
            const vorhanden = draftId ? await knex('strategy_drafts').where('id', draftId).first() : null
            const verlauf = vorhanden ? parseJson(vorhanden.messages, []) : []

            const cfg = await ladeStrategieLlmConfig()
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
            for (const t of textDateien) {
                const inhalt = Buffer.from(t.base64, 'base64').toString('utf8').slice(0, 60000)
                teile.push(`Datei "${t.name}":\n${inhalt}`)
            }
            if (nachricht) teile.push(`Nutzer: ${nachricht}`)
            if (modellAnhaenge.length) {
                teile.push(`Beigefügt: ${modellAnhaenge.map((a) => a.name).join(', ')}`)
            }

            // Grosszügiges Budget: eine vollständige Beschreibung mit 20+ Parametern
            // und allen Regeln ist lang. Zu knapp bemessen wird die Antwort mitten
            // im JSON abgeschnitten und ist dann unbrauchbar.
            const antwort = await callLLMJson(
                { ...cfg, maxTokens: 16000 },
                { system: SYSTEM, user: teile.join('\n\n'), anhaenge: modellAnhaenge, timeoutMs: 180000 },
            )
            if (!antwort.json) {
                // Den Grund benennen statt achselzuckend abzubrechen.
                const auszug = String(antwort.text || '').trim().slice(0, 400)
                const grund = antwort.abgeschnitten
                    ? 'Die Antwort wurde abgeschnitten (Token-Grenze erreicht). '
                        + 'Bitte in kleineren Schritten arbeiten — z. B. erst nach den Regeln fragen, '
                        + 'dann nach den Parametern.'
                    : auszug
                        ? `Das Modell hat statt JSON Folgendes geantwortet: "${auszug}"`
                        : 'Das Modell hat eine leere Antwort geliefert.'
                return res.status(502).json({
                    error: grund,
                    stopReason: antwort.stopReason,
                    tokens: antwort.usage?.completionTokens,
                })
            }

            const text = String(antwort.json.antwort || '').slice(0, 4000)
            const fragen = (Array.isArray(antwort.json.offeneFragen) ? antwort.json.offeneFragen : [])
                .map((f) => String(f).slice(0, 300)).slice(0, 20)

            let spec = null
            let specFehler = []
            if (antwort.json.spec) {
                const g = pruefeSpec(antwort.json.spec)
                specFehler = g.fehler
                if (g.ok) spec = g.spec
            }

            const neuerVerlauf = [
                ...verlauf,
                { role: 'user', content: nachricht || `[${anhaenge.map((a) => a.name).join(', ')}]` },
                { role: 'assistant', content: text },
            ].slice(-40)

            const datensatz = {
                title: spec?.name || vorhanden?.title || (nachricht || 'Entwurf').slice(0, 120),
                slug: spec?.slug || vorhanden?.slug || '',
                sourceName: anhaenge.map((a) => a.name).join(', ').slice(0, 300) || vorhanden?.sourceName || '',
                spec: JSON.stringify(spec || parseJson(vorhanden?.spec, null)),
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
                spec,
                specFehler,
                costUsd: antwort.costUsd,
                provider: cfg.provider,
                model: cfg.model,
            })
        } catch (e) {
            logError('strategy-builder', 'Chat fehlgeschlagen', e)
            res.status(500).json({ error: e.message })
        }
    })

    /** Vorschau des Quelltexts, ohne etwas zu schreiben. */
    app.get('/api/strategies/builder/drafts/:id/preview', async (req, res) => {
        try {
            const row = await getKnex()('strategy_drafts').where('id', req.params.id).first()
            if (!row) return res.status(404).json({ error: 'Nicht gefunden' })
            const spec = parseJson(row.spec, null)
            if (!spec) return res.status(400).json({ error: 'Dieser Entwurf hat noch keine Beschreibung' })
            res.json({ quelltext: baueModulQuelltext(spec), datei: `_entwurf_${spec.slug}.js` })
        } catch (e) {
            res.status(500).json({ error: e.message })
        }
    })

    /** Schreibt die Entwurfsdatei. Sie wird NICHT registriert und nicht geladen. */
    app.post('/api/strategies/builder/drafts/:id/generate', async (req, res) => {
        try {
            const knex = getKnex()
            const row = await knex('strategy_drafts').where('id', req.params.id).first()
            if (!row) return res.status(404).json({ error: 'Nicht gefunden' })
            const spec = parseJson(row.spec, null)
            if (!spec) return res.status(400).json({ error: 'Dieser Entwurf hat noch keine Beschreibung' })

            const { datei, pfad, quelltext } = await schreibeEntwurf(spec)
            await knex('strategy_drafts').where('id', row.id)
                .update({ status: 'generated', generatedPath: pfad, updatedAt: knex.fn.now() })

            res.json({
                ok: true, datei, pfad,
                zeilen: quelltext.split('\n').length,
                hinweis: 'Die Datei wurde geschrieben, aber NICHT registriert. detect() ist ein Rumpf, '
                    + 'der bewusst wirft — die Strategie kann nicht handeln, bis jemand die Logik baut.',
            })
        } catch (e) {
            logError('strategy-builder', 'Entwurf schreiben fehlgeschlagen', e)
            res.status(500).json({ error: e.message })
        }
    })
}
