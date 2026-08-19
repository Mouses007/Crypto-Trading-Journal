/**
 * Selbsttest: Anbieter-Verzeichnis.
 *
 * Läuft ohne Netz und ohne Datenbank. Prüft die Zusagen, auf die sich der
 * gemeinsame Code-Pfad verlässt — vor allem, dass der Umbau auf die Registry
 * die Fähigkeiten der bestehenden Anbieter NICHT verändert hat.
 *
 * Aufruf: node server/__selftest-anbieter.mjs
 */
import {
    ANBIETER_REG, ANBIETER, STANDARD_MODELLE, KEY_SPALTEN, KI_URL_SPALTEN,
    keySpalte, istOpenAiKompatibel, kannBilder, standardModell,
    anbieterBasis, chatEndpunkt,
} from './ai-models.js'
import { ANHANG_UNTERSTUETZUNG } from './llm.js'

let fehler = 0
// Auch die bestandenen zählen: `scripts/run-selftests.mjs` liest das Zahlenpaar
// aus der Schlussmeldung. Ohne es zählte die ganze Datei als EINE Prüfung —
// die Gesamtsumme des Sammellaufs war dadurch deutlich zu niedrig.
let bestanden = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Anbieter-Verzeichnis')

// 1) Auswahl. DeepSeek war abgekündigt und ist wieder da — der Hype-Radar
//    braucht ein billiges Modell für Hilfsarbeiten. Die Mechanik für
//    abgekündigte Anbieter bleibt geprüft: `ANBIETER` filtert sie heraus,
//    zur Laufzeit werden sie weiter bedient.
pruefe('DeepSeek ist wieder wählbar', ANBIETER.includes('deepseek'))
pruefe('DeepSeek bleibt zur Laufzeit bedienbar', istOpenAiKompatibel('deepseek'))
pruefe('abgekündigte Anbieter fallen aus der Auswahl',
    Object.entries(ANBIETER_REG).filter(([, r]) => r.abgekuendigt)
        .every(([id]) => !ANBIETER.includes(id)))
pruefe('Mistral/xAI/Qwen sind wählbar',
    ['mistral', 'xai', 'qwen'].every((p) => ANBIETER.includes(p)))
pruefe('die neuen Anbieter sind wählbar',
    ['moonshot', 'zai', 'minimax'].every((p) => ANBIETER.includes(p)))
pruefe('STANDARD_MODELLE deckt genau die Auswahl ab',
    JSON.stringify(Object.keys(STANDARD_MODELLE)) === JSON.stringify(ANBIETER))

// 2) Jeder OpenAI-kompatible Anbieter braucht eine Adressquelle.
for (const [id, reg] of Object.entries(ANBIETER_REG)) {
    if (reg.art !== 'openai') continue
    pruefe(`${id} hat eine Adressquelle`, !!(reg.basisUrl || reg.urlSpalte))
    pruefe(`${id} hat eine Schlüsselspalte`, !!reg.keySpalte)
}

// 3) Spaltenlisten sind vollständig und doppelfrei.
pruefe('KEY_SPALTEN enthält jede Schlüsselspalte',
    Object.values(ANBIETER_REG).filter((r) => r.keySpalte)
        .every((r) => KEY_SPALTEN.includes(r.keySpalte)))
pruefe('KEY_SPALTEN ist doppelfrei', new Set(KEY_SPALTEN).size === KEY_SPALTEN.length)
pruefe('KI_URL_SPALTEN kennt Qwen und den eigenen Anbieter',
    KI_URL_SPALTEN.includes('aiQwenUrl') && KI_URL_SPALTEN.includes('aiCustomUrl'))
pruefe('keySpalte(ollama) ist leer', keySpalte('ollama') === '')

// 4) Adress-Auflösung: Feld schlägt Vorgabe, Pflichtfeld bleibt leer.
pruefe('Qwen nutzt die Vorgabe, wenn kein Feld gesetzt ist',
    anbieterBasis('qwen', {}) === 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1')
pruefe('Qwen-Feld schlägt die Vorgabe',
    anbieterBasis('qwen', { aiQwenUrl: 'https://ws.example.com/compatible-mode/v1' })
        === 'https://ws.example.com/compatible-mode/v1')
pruefe('versehentlich mitkopiertes /chat/completions wird abgeschnitten',
    chatEndpunkt('qwen', { aiQwenUrl: 'https://ws.example.com/v1/chat/completions' })
        === 'https://ws.example.com/v1/chat/completions')
pruefe('eigener Anbieter ohne URL liefert keinen Endpunkt', chatEndpunkt('custom', {}) === '')
pruefe('Mistral-Endpunkt', chatEndpunkt('mistral', {}) === 'https://api.mistral.ai/v1/chat/completions')
pruefe('xAI-Endpunkt', chatEndpunkt('xai', {}) === 'https://api.x.ai/v1/chat/completions')
pruefe('unbekannter Anbieter liefert keinen Endpunkt', chatEndpunkt('gibtsnicht', {}) === '')

// 5) Nicht-OpenAI-Anbieter dürfen NICHT in den gemeinsamen Zweig fallen.
for (const p of ['anthropic', 'gemini', 'ollama']) {
    pruefe(`${p} bleibt ein eigener Zweig`, !istOpenAiKompatibel(p))
}

// 6) Regressionsschutz: die Anhang-Fähigkeiten der bestehenden Anbieter
//    müssen exakt bleiben, was vor dem Umbau in llm.js stand.
const VORHER = {
    anthropic: { image: true, pdf: true },
    gemini: { image: true, pdf: true },
    openai: { image: true, pdf: false },
    deepseek: { image: false, pdf: false },
    ollama: { image: true, pdf: false },
    custom: { image: true, pdf: false },
}
for (const [id, erwartet] of Object.entries(VORHER)) {
    pruefe(`Anhänge ${id} unverändert`,
        ANHANG_UNTERSTUETZUNG[id]?.image === erwartet.image
        && ANHANG_UNTERSTUETZUNG[id]?.pdf === erwartet.pdf,
        JSON.stringify(ANHANG_UNTERSTUETZUNG[id]))
}
pruefe('Screenshot-Gate schliesst die ungetesteten Neuen aus',
    ['mistral', 'xai', 'qwen', 'moonshot', 'zai', 'minimax'].every((p) => !kannBilder(p)))

// 7) Rückfallmodelle sind gesetzt, wo es sie geben muss.
for (const p of ['openai', 'anthropic', 'gemini', 'mistral', 'xai', 'qwen']) {
    pruefe(`${p} hat ein Standardmodell`, !!standardModell(p))
}
pruefe('eigener Anbieter hat bewusst keines', standardModell('custom') === '')

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
