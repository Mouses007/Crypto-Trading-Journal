/**
 * Selbsttest: Aufgaben-Tabelle und Claude-5.5-Anfrageteile.
 *
 * Läuft ohne Netz und ohne Datenbank. Prüft, was am 18.10.2026 eingeführt
 * wurde: dass eine Zeile der Aufgaben-Tabelle (`aiTaskProviders`) überall
 * gleich gelesen wird, dass „nur Anbieter" dessen EIGENES Standardmodell
 * bekommt (nicht das globale eines anderen Hauses) und dass die 5.5-Modelle
 * weder `temperature` noch einen fehlenden Denk-Aufwand bekommen.
 *
 * Aufruf: node server/__selftest-aufgaben.mjs
 */
import { aufgabenWahl, aufgabeNachId, AI_TASKS } from './ai-task-config.js'
import {
    aufwandFelder, lehntSamplingAb, samplingFelder, standardModell, ANBIETER_REG,
} from './ai-models.js'
import { anbieterVon, KI_FUNKTIONEN } from './ki-funktionen.js'
import { schaetzeKosten } from './ai-preise.js'
import {
    baueSuchanfragen, suchZeitraum, waehleTreffer, nummeriereBelege, DEEPSEEK_SUCHE,
} from './news-recherche.js'

let fehler = 0
let bestanden = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ── aufgabenWahl ─────────────────────────────────────────────────────────
{
    const roh = JSON.stringify({
        agent: 'anthropic/claude-opus-5-5',
        lagebericht: 'anthropic',
        'x-suche': 'gemini/gemini-3.8-flash',     // falscher Anbieter für X
        video: 'gemini',
        rangliste: 'erfunden/modell',
        'chart-analyse': 'openrouter/anthropic/claude-opus-5.5',
        mechanik: '   ',
    })
    pruefe('anbieter/modell wird getrennt',
        gleich(aufgabenWahl(roh, 'agent'), { provider: 'anthropic', model: 'claude-opus-5-5' }))
    pruefe('nur Anbieter → dessen Standardmodell, nicht das globale',
        gleich(aufgabenWahl(roh, 'lagebericht'), { provider: 'anthropic', model: standardModell('anthropic') }))
    pruefe('Anbieter, der die Aufgabe nicht kann, zählt als leer',
        aufgabenWahl(roh, 'x-suche') === null)
    pruefe('Video nur mit Gemini, dort das Standardmodell',
        gleich(aufgabenWahl(roh, 'video'), { provider: 'gemini', model: standardModell('gemini') }))
    pruefe('unbekannter Anbieter zählt als leer', aufgabenWahl(roh, 'rangliste') === null)
    pruefe('nur am ersten / getrennt — OpenRouter behält sein Modell',
        gleich(aufgabenWahl(roh, 'chart-analyse'), { provider: 'openrouter', model: 'anthropic/claude-opus-5.5' }))
    pruefe('Leerzeichen sind leer', aufgabenWahl(roh, 'mechanik') === null)
    pruefe('fehlende Zeile ist leer', aufgabenWahl(roh, 'coin-radar') === null)
    pruefe('Objekt statt Zeichenkette geht auch',
        aufgabenWahl({ agent: 'gemini/gemini-4-argon' }, 'agent')?.model === 'gemini-4-argon')
    pruefe('kaputtes JSON wirft nicht', aufgabenWahl('{kaputt', 'agent') === null)
    pruefe('ohne Aufgabe nichts', aufgabenWahl(roh, '') === null)
}

// ── Registry der Aufgaben ────────────────────────────────────────────────
{
    const ids = Object.values(AI_TASKS).map((t) => t.id)
    pruefe('Aufgaben-IDs sind eindeutig', new Set(ids).size === ids.length)
    pruefe('Tippfehler „mechenik" ist weg', !('mechenik' in AI_TASKS) && !!aufgabeNachId('mechanik'))
    for (const id of ['coin-radar', 'chart-analyse', 'livetrading-handelslage', 'marktradar-lage']) {
        pruefe(`Aufgabe ${id} ist registriert`, !!aufgabeNachId(id))
    }
    // Jede Empfehlung muss so, wie sie dasteht, eintragbar sein.
    for (const t of Object.values(AI_TASKS)) {
        for (const e of t.recommendedModels || []) {
            const w = aufgabenWahl({ [t.id]: e }, t.id)
            pruefe(`Empfehlung ${e} für ${t.id} ist gültig`, !!w && w.model === e.slice(e.indexOf('/') + 1))
        }
    }
    pruefe('Agent kann mehr als Anthropic/OpenAI/OpenRouter',
        aufgabeNachId('agent').supportedProviders.includes('gemini')
        && !aufgabeNachId('agent').supportedProviders.includes('perplexity'))
}

// ── Claude 5.5: Sampling und Denk-Aufwand ────────────────────────────────
{
    for (const m of ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1',
        'anthropic/claude-opus-5.5', 'kimi-k3', 'gpt-6.1-sol']) {
        pruefe(`${m} bekommt kein temperature`, lehntSamplingAb(m) && gleich(samplingFelder(m, 0), {}))
    }
    pruefe('Haiku 4.5 darf temperature behalten', !lehntSamplingAb('claude-haiku-4-5'))
    pruefe('Gemini behält temperature', gleich(samplingFelder('gemini-3.8-flash', 0), { temperature: 0 }))

    pruefe('kleiner Deckel → low',
        gleich(aufwandFelder('claude-haiku-5-5', 800), { output_config: { effort: 'low' } }))
    pruefe('grosser Deckel → medium',
        gleich(aufwandFelder('claude-opus-5-5', 3000), { output_config: { effort: 'medium' } }))
    pruefe('ausdrücklicher Aufwand gewinnt',
        gleich(aufwandFelder('claude-sonnet-5-5', 3000, 'low'), { output_config: { effort: 'low' } }))
    pruefe('Haiku 4.5 bekommt kein effort (lehnt es ab)', gleich(aufwandFelder('claude-haiku-4-5', 800), {}))
    pruefe('Nicht-Claude bekommt kein effort', gleich(aufwandFelder('gemini-3.8-flash', 800), {}))
}

// ── Registry der Modelle ─────────────────────────────────────────────────
{
    pruefe('Anthropic-Standard ist Sonnet 5.5', standardModell('anthropic') === 'claude-sonnet-5-5')
    pruefe('Gemini-Standard bleibt das Flash', standardModell('gemini') === 'gemini-3.8-flash')
    pruefe('X-Standard ist die Non-Reasoning-Variante',
        standardModell('xai') === 'grok-4.20-0309-non-reasoning')
    pruefe('abgeschaltete Mistral-Modelle sind raus',
        !ANBIETER_REG.mistral.modelle.some((m) => /2508|2411|2506/.test(m)))
}

// ── Preise: 5.5 nicht zum alten Opus-Preis ───────────────────────────────
{
    const p = (m) => schaetzeKosten(m, 1e6, 1e6)
    pruefe('Opus 5.5 = 4 + 20', Math.abs(p('claude-opus-5-5') - 24) < 1e-9, String(p('claude-opus-5-5')))
    pruefe('Opus 5 bleibt 5 + 25', Math.abs(p('claude-opus-5') - 30) < 1e-9)
    pruefe('Haiku 5.5 = 0,10 + 0,50', Math.abs(p('claude-haiku-5-5') - 0.6) < 1e-9)
    pruefe('Sonnet 5.5 = 2 + 10', Math.abs(p('claude-sonnet-5-5') - 12) < 1e-9)
    pruefe('Haiku 4.5 bleibt 1 + 5', Math.abs(p('claude-haiku-4-5') - 6) < 1e-9)
}

// ── KI-Übersicht folgt der Aufgaben-Zeile ────────────────────────────────
{
    const s = {
        aiProvider: 'gemini',
        aiTaskProviders: JSON.stringify({ 'coin-radar': 'anthropic/claude-haiku-5-5', agent: 'anthropic' }),
    }
    const f = (id) => KI_FUNKTIONEN.find((x) => x.id === id)
    pruefe('Coin-Radar hat eine eigene Zeile', !!f('coinRadar'))
    pruefe('Übersicht zeigt den Anbieter der Aufgaben-Zeile', anbieterVon(f('coinRadar'), s) === 'anthropic')
    pruefe('Agent ebenso', anbieterVon(f('agent'), s) === 'anthropic')
    pruefe('ohne Zeile der globale', anbieterVon(f('chart'), s) === 'gemini')
}

// ── DeepSeek-Suche als Recherche-Weg ─────────────────────────────────────
{
    const jetzt = Date.parse('2026-10-18T12:00:00Z')
    pruefe('Tagesfilter → after: gestern', suchZeitraum('day', jetzt) === 'after:2026-10-17')
    pruefe('Wochenfilter → after: vor 7 Tagen', suchZeitraum('week', jetzt) === 'after:2026-10-11')
    pruefe('ohne Filter kein after:', suchZeitraum('', jetzt) === '')

    const q = baueSuchanfragen({ thema: 'crypto', aktualitaet: 'day', jetzt })
    pruefe('Krypto: zwei feste englische Anfragen', q.length === 2 && q.every((x) => x.query.includes('after:2026-10-17')))
    pruefe('ohne Frage kein ori_question', q.every((x) => !('ori_question' in x)))
    const lang = 'x'.repeat(400)
    const q2 = baueSuchanfragen({ thema: 'WIF', frage: lang, aktualitaet: '', jetzt })
    pruefe('Anfrage höchstens 128 Zeichen', q2.length === 1 && q2[0].query.length <= 128, String(q2[0]?.query.length))
    pruefe('ori_question höchstens 128 Zeichen', q2[0].ori_question.length === 128)

    const t = waehleTreffer([
        [{ url: 'https://a.ch/1', rerank_score: 1 }, { url: 'https://b.ch/1', rerank_score: 2.5 }],
        [{ url: 'https://a.ch/1', rerank_score: 3 }, { url: 'javascript:x' }, { url: 'https://c.ch/1', rerank_score: 2 }],
    ])
    pruefe('doppelte URL und Nicht-http fallen weg', t.length === 3)
    pruefe('beste Bewertung zuerst', t[0].url === 'https://b.ch/1' && t[1].url === 'https://c.ch/1')

    const treffer = ['u1', 'u2', 'u3', 'u4'].map((u) => ({ url: 'https://x.ch/' + u }))
    const n = nummeriereBelege('BTC fiel [3]. ETF-Abfluss [1][3]. Unsinn [9]. Rest [2].', treffer)
    pruefe('Belege in Reihenfolge des ersten Auftretens neu gezählt',
        n.text === 'BTC fiel [1]. ETF-Abfluss [2][1]. Unsinn. Rest [3].', n.text)
    pruefe('nur zitierte Treffer als Belege',
        gleich(n.urls, ['https://x.ch/u3', 'https://x.ch/u1', 'https://x.ch/u2']))
    const deckel = nummeriereBelege('[1] [2] [3] [4]', treffer, 2)
    pruefe('höchstens so viele Belege wie der Bericht nimmt', deckel.urls.length === 2 && !deckel.text.includes('[3]'))

    const r = aufgabeNachId('recherche')
    pruefe('Recherche erlaubt DeepSeek', r.supportedProviders.includes('deepseek'))
    pruefe('Vorgabe bleibt Perplexity', r.recommendedModels[0].startsWith('perplexity/'))
    pruefe('Schreiber-Aufgabe registriert', aufgabeNachId('recherche-schreiber')?.recommendedModels[0] === 'anthropic/claude-haiku-5-5')
    const f = KI_FUNKTIONEN.find((x) => x.id === 'recherche')
    pruefe('Übersicht zeigt DeepSeek, wenn das Nachrichtenfeld umgeschaltet ist',
        anbieterVon(f, { radarNewsRechercheModell: DEEPSEEK_SUCHE }) === 'deepseek')
    pruefe('sonst Perplexity', anbieterVon(f, { radarNewsRechercheModell: 'sonar-pro' }) === 'perplexity')
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
