<script setup>
import { onBeforeMount, onMounted, ref, reactive, computed } from 'vue';
import { useDateCalFormat, useKostenAnzeige, useKostenZahl } from '../utils/formatters.js';
import ModelManager from '../components/ModelManager.vue'
import AnbieterWahl from '../components/AnbieterWahl.vue'
import KiUebersicht from '../components/ki/KiUebersicht.vue'
import { useCheckCurrentUser, useInitTooltip } from '../utils/utils';
import { allTradeTimeframes, selectedTradeTimeframes, selectedBroker } from '../stores/filters.js';
import { currentUser, renderProfile } from '../stores/settings.js';
import { dbUpdateSettings, dbGetSettings, dbFind, dbFirst, dbDelete, dbDeleteWhere } from '../utils/db.js'
import { refreshAccountBalance } from '../stores/accountBalance.js'
import axios from 'axios'
import dayjs from 'dayjs'
import { requestNotificationPermission } from '../utils/notify'
import { logWarn } from '../utils/logger.js'
import { useQuickApiImport } from '../utils/quickImport.js'
import { loadSymbolMeta } from '../utils/liveSymbols.js'
import { sendNotification } from '../utils/notify.js'
import { useI18n } from 'vue-i18n'
import { setLocale } from '../i18n'
import { useGetPeriods } from '../utils/utils.js'
import appLogoSrc from '../assets/icon.png'
import {
    liveMarket, liveViewPct, liveFrameMs, liveHistoryMin, liveRamp, liveShowProfile,
    livePauseInBackground, liveColorMode, liveColorRef, liveAutoFollow, liveThreshold, liveDotStep,
    liveShowLiquidations, livePrefillMin,
    VIEW_PCT_OPTIONS, FRAME_MS_OPTIONS, HISTORY_MIN_OPTIONS,
} from '../stores/live.js'

const { t, locale } = useI18n()

let selectedLanguage = ref('de')

async function changeLanguage(lang) {
    setLocale(lang)
    await dbUpdateSettings({ language: lang })
    currentUser.value.language = lang
    await useGetPeriods()
}

let profileAvatar = null
let username = ref('')
// Layout & Stil
let betaAusblenden = ref(false)      // Strategien/Research aus dem Umschalter nehmen
let livetradingMobil = ref(false)    // Live-Trading-Fenster auch am Telefon zeigen
let startseiteAn = ref(true)         // Startseite als Landing-Page + Modus-Tab
let startBalance = ref(0)
let currentBalance = ref(0)
let bitunixApiKey = ref('')
let bitunixSecretKey = ref('')
let bitunixImportStartDate = ref('')
let bitunixTestResult = ref(null)
let bitunixTestLoading = ref(false)

let bitgetApiKey = ref('')
let bitgetSecretKey = ref('')
let bitgetPassphrase = ref('')
let bitgetImportStartDate = ref('')
let bitgetTestResult = ref(null)
let bitgetTestLoading = ref(false)
let bitunixSubExpanded = ref(false)
let bitgetSubExpanded = ref(false)
let showTradePopups = ref(true)
let scalpMaxMinutes = ref(15)
let daytradeMaxHours = ref(24)
let enableBinanceChart = ref(false)
let browserNotifications = ref(true)
let importsExpanded = ref(false)
let layoutExpanded = ref(false)
let balanceExpanded = ref(false)
let apiExpanded = ref(false)
let bewertungExpanded = ref(false)
let subTagsExpanded = ref(false)
let subTimeframesExpanded = ref(false)
let subTradeTypeExpanded = ref(false)
let subPopupsExpanded = ref(false)
let chartExpanded = ref(false)
let kiExpanded = ref(true)   // eigener Unter-Reiter: offen starten
let dbExpanded = ref(false)
let pgProvidersExpanded = ref(false)

/* DATENBANK-KONFIGURATION */
let dbType = ref('sqlite')
let dbHost = ref('localhost')
let dbPort = ref(5432)
let dbUser = ref('tradejournal')
let dbPassword = ref('')
let dbDatabase = ref('tradejournal')
let dbHasPassword = ref(false)
let dbTestLoading = ref(false)
let dbTestResult = ref(null)
let dbSaveResult = ref(null)
let dbRestartLoading = ref(false)
let dbExportLoading = ref(false)
let dbImportLoading = ref(false)
let dbMigrationResult = ref(null)

/* KI-AGENT SETTINGS */
let aiProvider = ref('ollama')
let aiModel = ref('')
// Schlüssel je Anbieter — die Schlüssel selbst kommen maskiert vom Server und
// werden nur zurückgeschickt, wenn sie tatsächlich geändert wurden.
let aiKeys = reactive({})
let aiOllamaUrl = ref('http://localhost:11434')
let aiCustomUrl = ref('')
let aiQwenUrl = ref('')
let aiTemperature = ref(0.7)
let aiMaxTokens = ref(1500)
let aiScreenshots = ref(false)
let aiChatEnabled = ref(true)
let aiReportPrompt = ref('')
let aiReportPromptPreset = ref('standard')
let aiTestLoading = ref(false)
let aiTestResult = ref(null)
let ollamaModels = ref([])
let aiTokenStats = ref(null)

async function loadAiTokenStats() {
    try {
        const res = await axios.get('/api/ai/token-stats')
        aiTokenStats.value = res.data
    } catch (e) { /* silent */ }
}

/* Beschriftung UND Prompt-Text kommen aus der Übersetzung. Vorher war nur die
   Beschriftung übersetzt, der Prompt selbst stand als deutscher Klartext da —
   ein englischer Nutzer wählte „Strict coach" und bekam eine deutsche
   Anweisung an die KI geschickt. */
const promptPresets = computed(() => [
    { value: 'custom', label: t('settings.promptCustom'), prompt: '' },
    { value: 'kurz', label: t('settings.promptShort'), prompt: t('settings.promptTextShort') },
    { value: 'standard', label: t('settings.promptStandard'), prompt: t('settings.promptTextStandard') },
    { value: 'coach', label: t('settings.promptCoach'), prompt: t('settings.promptTextCoach') },
    { value: 'psychologie', label: t('settings.promptPsychology'), prompt: t('settings.promptTextPsychology') },
])

function onPromptPresetChange() {
    const preset = promptPresets.value.find(p => p.value === aiReportPromptPreset.value)
    if (preset && preset.value !== 'custom') {
        aiReportPrompt.value = preset.prompt
    }
}

// Aktueller Key für den gewählten Provider
const currentApiKey = computed({
    get: () => aiKeys[aiProvider.value] || '',
    set: (val) => { aiKeys[aiProvider.value] = val }
})

// Modell-Listen kommen vom Server (Tabelle `settings`), damit neue Modelle
// nachgetragen werden können, ohne den Quelltext anzufassen.
const modellListen = ref({})

/**
 * Die Einstellungen sind über 1500 Zeilen lang. Ohne Gliederung findet man
 * nichts wieder — deshalb Bereiche statt einer Endlosliste. Die Wahl bleibt
 * im localStorage, damit man nach dem Speichern nicht wieder oben landet.
 */
const BEREICHE = [
    { id: 'allgemein', icon: 'uil uil-setting' },
    { id: 'journal', icon: 'uil uil-book-alt' },
    { id: 'live', icon: 'uil uil-chart-line' },
    { id: 'ki', icon: 'uil uil-brain' },
    { id: 'benachrichtigungen', icon: 'uil uil-bell' },
]
const bereich = ref(localStorage.getItem('settingsBereich') || 'allgemein')
function bereichWechseln(id) {
    bereich.value = id
    localStorage.setItem('settingsBereich', id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
}

/**
 * Zweite Reiter-Ebene im KI-Bereich.
 *
 * Die KI-Einstellungen lagen über drei obere Reiter verstreut: Zugang und
 * Berichte unter „KI", die Strategie-Agenten unter „Agent", der ganze
 * Lagebericht unter „Live" beim Marktradar. Wer einen Schlüssel eintrug und
 * dann den Bericht einstellen wollte, suchte zwei Bildschirme weiter.
 *
 * Jetzt: ein Ort, darin je Funktion ein Reiter. Der frühere obere Reiter
 * „Agent" ist deshalb entfallen.
 */
const KI_BEREICHE = [
    // Ganz vorn: die Frage „was läuft hier eigentlich und was kostet es" kommt
    // vor jeder einzelnen Einstellung.
    { id: 'uebersicht', icon: 'uil uil-eye' },
    { id: 'allgemein', icon: 'uil uil-key-skeleton' },
    { id: 'berichte', icon: 'uil uil-file-alt' },
    { id: 'nachrichten', icon: 'uil uil-newspaper' },
    { id: 'agent', icon: 'uil uil-robot' },
    { id: 'strategie', icon: 'uil uil-chart-line' },
    { id: 'bilder', icon: 'uil uil-image' },
]
const kiBereich = ref(localStorage.getItem('settingsKiBereich') || 'allgemein')
function kiBereichWechseln(id) {
    kiBereich.value = id
    localStorage.setItem('settingsKiBereich', id)
}

/**
 * Anbieterliste vom Server — Name, Schlüssel-Bezugsquelle und ob der Anbieter
 * ein eigenes Adressfeld braucht. Vorher stand all das ein zweites Mal fest im
 * Template; die beiden Listen sind dabei zuverlässig auseinandergelaufen.
 * Die Rückfallliste greift nur, wenn der Aufruf scheitert — ohne sie stünde
 * die Auswahl leer da.
 */
const anbieterListe = ref([
    { id: 'ollama', name: 'Ollama (lokal)', keyUrl: '', brauchtKey: false, urlSpalte: '' },
    { id: 'anthropic', name: 'Anthropic (Claude)', keyUrl: '', brauchtKey: true, urlSpalte: '' },
])

async function loadModelLists() {
    try {
        const r = await axios.get('/api/ai/models')
        modellListen.value = r.data.modelle || {}
        ohneSampling.value = r.data.ohneSampling || []
        if (Array.isArray(r.data.anbieter) && r.data.anbieter.length) {
            anbieterListe.value = r.data.anbieter
        }
    } catch (e) {
        modellListen.value = {}
    }
}

/** Angaben zum gewählten Anbieter (Name, Key-Quelle, Adressfeld). */
const aktuellerAnbieter = computed(
    () => anbieterListe.value.find((a) => a.id === aiProvider.value) || null,
)

/**
 * Adressfeld des gewählten Anbieters. Zwei Anbieter haben eines: der eigene
 * (dort Pflicht) und Qwen (dort nur eine Vorbelegung, weil Alibaba
 * internationalen Konten arbeitsbereichs-eigene Hosts vergibt).
 */
const anbieterUrl = computed({
    get() {
        const feld = aktuellerAnbieter.value?.urlSpalte
        if (feld === 'aiQwenUrl') return aiQwenUrl.value
        if (feld === 'aiCustomUrl') return aiCustomUrl.value
        return ''
    },
    set(wert) {
        const feld = aktuellerAnbieter.value?.urlSpalte
        if (feld === 'aiQwenUrl') aiQwenUrl.value = wert
        else if (feld === 'aiCustomUrl') aiCustomUrl.value = wert
    },
})

/** Die Liste des Anbieters, ohne Zutaten. */
function providerListe() {
    return aiProvider.value === 'ollama'
        ? ollamaModels.value
        : (modellListen.value[aiProvider.value] || [])
}

function getModelsForProvider() {
    const liste = providerListe()
    // Ein gespeichertes Modell, das nicht (mehr) in der Liste steht, würde das
    // Auswahlfeld leer erscheinen lassen — und beim nächsten Speichern still
    // verschwinden. Also mit anzeigen, statt es zu verlieren.
    if (aiModel.value && !liste.includes(aiModel.value)) return [aiModel.value, ...liste]
    return liste
}

/** Modelle, die keine Sampling-Parameter annehmen (Server ist die Quelle). */
const ohneSampling = ref([])
const modellOhneTemperatur = computed(
    () => ohneSampling.value.some((p) => String(aiModel.value || '').startsWith(p)),
)

/** Nach dem Bearbeiten der Liste: die Auswahl gültig halten. */
function modelleGeaendert(liste) {
    if (aiProvider.value === 'ollama') ollamaModels.value = liste
    else modellListen.value = { ...modellListen.value, [aiProvider.value]: liste }
    if (!liste.includes(aiModel.value)) aiModel.value = liste[0] || ''
}

async function loadOllamaModels() {
    try {
        const res = await axios.get('/api/ollama/status', { params: { url: aiOllamaUrl.value } })
        ollamaModels.value = res.data.models || []
    } catch (e) {
        ollamaModels.value = []
    }
}

async function toggleAiEnabled(enabled) {
    try {
        const val = enabled ? 1 : 0
        await dbUpdateSettings({ aiEnabled: val })
        currentUser.value.aiEnabled = val
    } catch (error) {
        console.error('Fehler beim Speichern der KI-Einstellung:', error)
    }
}

async function saveAiSettings() {
    try {
        await axios.post('/api/ai/settings', {
            aiProvider: aiProvider.value,
            aiModel: aiModel.value,
            aiOllamaUrl: aiOllamaUrl.value || 'http://localhost:11434',
            aiCustomUrl: aiCustomUrl.value.trim(),
            aiQwenUrl: aiQwenUrl.value.trim(),
            aiTemperature: parseFloat(aiTemperature.value) || 0.7,
            aiMaxTokens: parseInt(aiMaxTokens.value) || 1500,
            aiScreenshots: aiScreenshots.value,
            aiChatEnabled: aiChatEnabled.value,
            aiReportPrompt: aiReportPrompt.value,
            // Alle bekannten Anbieter mitschicken — der Server ignoriert
            // maskierte Werte. Vorher war die Liste hier fest verdrahtet, und
            // der Schlüssel des eigenen Anbieters kam nie an.
            keys: { ...aiKeys },
        })
        currentUser.value.aiProvider = aiProvider.value
        currentUser.value.aiModel = aiModel.value
        currentUser.value.aiOllamaUrl = aiOllamaUrl.value
        currentUser.value.aiTemperature = aiTemperature.value
        currentUser.value.aiMaxTokens = aiMaxTokens.value
        console.log(' -> KI-Einstellungen gespeichert')
        aiTestResult.value = { success: true, message: t('common.saved') }
        setTimeout(() => aiTestResult.value = null, 3000)
        // Maskierte Keys neu laden
        await loadAiSettings()
    } catch (error) {
        alert(t('common.errorSaving') + error.message)
    }
}

async function testAiConnection() {
    aiTestLoading.value = true
    aiTestResult.value = null
    try {
        const res = await axios.post('/api/ai/test', {
            provider: aiProvider.value,
            apiKey: currentApiKey.value,
            model: aiModel.value,
            ollamaUrl: aiOllamaUrl.value,
            // Erlaubt den Test einer noch nicht gespeicherten Adresse.
            basisUrl: anbieterUrl.value.trim(),
        })
        aiTestResult.value = res.data
        // Nach erfolgreichem Ollama-Test Modelle neu laden
        if (aiProvider.value === 'ollama' && res.data.success) {
            await loadOllamaModels()
            if (!aiModel.value && ollamaModels.value.length > 0) {
                aiModel.value = ollamaModels.value[0]
            }
        }
    } catch (e) {
        aiTestResult.value = { success: false, message: e.message }
    }
    aiTestLoading.value = false
}

function onProviderChange() {
    // Bewusst die rohe Liste: `getModelsForProvider()` stellt das gespeicherte
    // Modell voran, und das gehört zum ALTEN Anbieter — sonst stünde nach dem
    // Wechsel auf DeepSeek weiterhin ein Claude-Modell im Feld.
    const models = providerListe()
    aiModel.value = models.length > 0 ? models[0] : ''
    aiTestResult.value = null
    if (aiProvider.value === 'ollama') {
        loadOllamaModels()
        loadModelLists()
    }
}

/* Anbieter und Modell je KI-Funktion. Leer = der global eingestellte Anbieter.
   Gespeichert wird feldweise wie im Marktradar — ein Sammel-Speichern hat dort
   schon einmal einen Schalter mit veraltetem Stand überschrieben. */
let aiBerichtProvider = ref('')
let aiBerichtModell = ref('')
let aiAgentProvider = ref('')
let aiAgentModell = ref('')
let aiAgentTokenBudget = ref(80000)
let aiStrategieProvider = ref('')
let aiStrategieModell = ref('')
let radarNewsRechercheModell = ref('sonar')

/* Wochentage und Themennamen aus der Übersetzung — als computed, damit ein
   Sprachwechsel sie sofort mitzieht. */
const wochentagNamen = computed(() => [1, 2, 3, 4, 5, 6, 7].map(i => t('settings.ki.news.wd' + i)))
const themenNamen = computed(() => ({
    crypto: t('settings.ki.news.topicCrypto'),
    finanzen: t('settings.ki.news.topicFinance'),
    tech: t('settings.ki.news.topicTech'),
    chartanalyse: t('settings.ki.news.topicChartanalyse'),
}))

async function kiSpeichern(feld, wert) {
    await dbUpdateSettings({ [feld]: wert })
    if (currentUser.value) currentUser.value[feld] = wert
}

/**
 * Startseiten-Schalter speichern. Zusätzlich zum DB-Wert wird der Zustand nach
 * localStorage gespiegelt, damit der Root-Redirect (`/`) beim nächsten Start
 * synchron weiß, ob er auf die Startseite oder ins Journal leiten soll.
 */
async function startseiteSpeichern(an) {
    try {
        localStorage.setItem('startseiteAn', an ? '1' : '0')
    } catch (_) { /* privater Modus / kein localStorage */ }
    await kiSpeichern('startseiteAn', an ? 1 : 0)
}

/** Anbieter+Modell eines Bereichs setzen und sofort sichern. */
function setzeFunktionsAnbieter(providerRef, modellRef, providerFeld, modellFeld) {
    return {
        anbieter: (w) => { providerRef.value = w; kiSpeichern(providerFeld, w); modellRef.value = ''; kiSpeichern(modellFeld, '') },
        modell: (w) => { modellRef.value = w; kiSpeichern(modellFeld, w) },
    }
}

/* Guthaben-Status je Anbieter. Die Anbieter verraten ihr Restguthaben nicht
   über den API-Key — gezeigt wird, was der Server weiss: hinterlegter
   Schlüssel, letzter Guthaben-Fehler, letzter Erfolg. */
let guthabenListe = ref([])

/* Anbietername in der Sprache der Oberfläche. Die Namen kommen aus dem
   Anbieter-Register des Servers und sind dort deutsch beschriftet; nur die
   zwei generischen Einträge brauchen eine Übersetzung — „Anthropic (Claude)"
   heisst überall gleich. */
function anbieterName(a) {
    if (a?.id === 'ollama') return t('settings.ki.provOllama')
    if (a?.id === 'custom') return t('settings.ki.provCustom')
    return a?.name || ''
}

/* Zeitpunkt in der Sprache der Oberfläche. Vorher stand hier fest 'de-CH' —
   auf Englisch gestellt blieb das Datum trotzdem schweizerdeutsch formatiert. */
function zeitpunkt(ms) {
    return new Date(ms).toLocaleString(locale.value === 'en' ? 'en-GB' : 'de-CH',
        { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
async function ladeGuthaben() {
    try {
        const { data } = await axios.get('/api/ai/guthaben')
        guthabenListe.value = data.anbieter || []
    } catch (e) {
        guthabenListe.value = []
    }
}

async function loadAiSettings() {
    try {
        const res = await axios.get('/api/ai/settings')
        const s = res.data
        aiProvider.value = s.aiProvider || 'ollama'
        aiModel.value = s.aiModel || ''
        aiOllamaUrl.value = s.aiOllamaUrl || 'http://localhost:11434'
        aiCustomUrl.value = s.aiCustomUrl || ''
        aiQwenUrl.value = s.aiQwenUrl || ''
        aiTemperature.value = s.aiTemperature ?? 0.7
        aiMaxTokens.value = s.aiMaxTokens || 1500
        aiScreenshots.value = s.aiScreenshots || false
        aiChatEnabled.value = s.aiChatEnabled !== false
        aiReportPrompt.value = s.aiReportPrompt || ''
        // Preset erkennen — Standard wenn kein Prompt gespeichert
        const matchedPreset = promptPresets.value.find(p => p.value !== 'custom' && p.prompt === aiReportPrompt.value)
        if (matchedPreset) {
            aiReportPromptPreset.value = matchedPreset.value
        } else if (!aiReportPrompt.value) {
            aiReportPromptPreset.value = 'standard'
            aiReportPrompt.value = promptPresets.value.find(p => p.value === 'standard').prompt
        } else {
            aiReportPromptPreset.value = 'custom'
        }
        // Anbieter-unabhängig: der Server bestimmt, welche Schlüssel es gibt.
        if (s.keys) {
            for (const [id, wert] of Object.entries(s.keys)) aiKeys[id] = wert || ''
        }
        // Wahl je Funktion kommt aus den allgemeinen Einstellungen, nicht aus
        // /api/ai/settings — dort liegen nur Zugang und globale Vorgaben.
        const cu = currentUser.value || {}
        aiBerichtProvider.value = cu.aiBerichtProvider || ''
        aiBerichtModell.value = cu.aiBerichtModell || ''
        aiAgentProvider.value = cu.aiAgentProvider || ''
        aiAgentModell.value = cu.aiAgentModell || ''
        aiAgentTokenBudget.value = Number(cu.aiAgentTokenBudget) || 80000
        aiStrategieProvider.value = cu.aiStrategieProvider || ''
        aiStrategieModell.value = cu.aiStrategieModell || ''
        radarNewsRechercheModell.value = cu.radarNewsRechercheModell || 'sonar'
        ladeGuthaben()
    } catch (e) {
        console.error('Fehler beim Laden der KI-Settings:', e)
    }
}
/* SHARE CARD SETTINGS (FLUX.2 + Gemini) */
let fluxExpanded = ref(true) // eigener Unter-Reiter: offen starten
let shareCardProvider = ref('flux')
let fluxApiKey = ref('')
let fluxModel = ref('flux-2-pro')
let fluxDisplayName = ref('')
let fluxAvatar = ref('')
let fluxUseCustomAvatar = ref(false)
let fluxTestLoading = ref(false)
let fluxTestResult = ref(null)
let geminiImageApiKey = ref('')
let geminiImageModel = ref('gemini-2.5-flash-image')
let geminiTestLoading = ref(false)
let geminiTestResult = ref(null)

const fluxModels = [
    { value: 'flux-2-pro', label: 'FLUX.2 Pro (~$0.03)' },
    { value: 'flux-2-flex', label: 'FLUX.2 Flex (~$0.05)' },
    { value: 'flux-2-max', label: 'FLUX.2 Max (~$0.07)' }
]

const geminiImageModels = [
    { value: 'gemini-2.5-flash-image', label: 'Nano Banana (Gemini 2.5 Flash)' },
    { value: 'gemini-3.1-flash-lite-image', label: 'Nano Banana 2 Lite (Gemini 3.1 Flash Lite)' },
    { value: 'gemini-3.1-flash-image', label: 'Nano Banana 2 (Gemini 3.1 Flash)' },
    { value: 'gemini-3-pro-image', label: 'Nano Banana Pro (Gemini 3 Pro)' }
]

/**
 * Gespeicherten Namen auf einen Eintrag der Auswahl bringen.
 *
 * Die Vorschau-Namen sind inzwischen allgemein verfügbar (ohne `-preview`), und
 * das alte `gemini-2.0-flash-preview-image-generation` gibt es bei Google gar
 * nicht mehr. Ohne Abgleich stünde das Feld leer da, obwohl in der Datenbank
 * etwas hinterlegt ist.
 */
function gueltigesBildmodell(m) {
    const s = String(m || '').replace(/-preview$/, '')
    return geminiImageModels.some((e) => e.value === s) ? s : 'gemini-2.5-flash-image'
}

async function loadFluxSettings() {
    try {
        const res = await axios.get('/api/flux/settings')
        shareCardProvider.value = res.data.shareCardProvider || 'flux'
        fluxApiKey.value = res.data.fluxApiKey || ''
        fluxModel.value = res.data.fluxModel || 'flux-2-pro'
        fluxDisplayName.value = res.data.fluxDisplayName || ''
        fluxAvatar.value = res.data.fluxAvatar || ''
        fluxUseCustomAvatar.value = !!res.data.fluxUseCustomAvatar
        geminiImageApiKey.value = res.data.geminiImageApiKey || ''
        geminiImageModel.value = gueltigesBildmodell(res.data.geminiImageModel)
    } catch (e) {
        console.error('Fehler beim Laden der Share-Card-Settings:', e)
    }
}

async function saveFluxSettings() {
    try {
        await axios.post('/api/flux/settings', {
            shareCardProvider: shareCardProvider.value,
            fluxApiKey: fluxApiKey.value,
            fluxModel: fluxModel.value,
            fluxDisplayName: fluxDisplayName.value,
            fluxAvatar: fluxAvatar.value,
            fluxUseCustomAvatar: fluxUseCustomAvatar.value,
            geminiImageApiKey: geminiImageApiKey.value,
            geminiImageModel: geminiImageModel.value
        })
        fluxTestResult.value = { success: true, message: t('common.saved') }
        setTimeout(() => fluxTestResult.value = null, 3000)
        await loadFluxSettings()
    } catch (e) {
        alert(t('common.errorSaving') + e.message)
    }
}

async function testFluxConnection() {
    fluxTestLoading.value = true
    fluxTestResult.value = null
    try {
        const res = await axios.post('/api/flux/test', { fluxApiKey: fluxApiKey.value })
        fluxTestResult.value = res.data
    } catch (e) {
        fluxTestResult.value = { success: false, message: e.message }
    }
    fluxTestLoading.value = false
}

async function testGeminiConnection() {
    geminiTestLoading.value = true
    geminiTestResult.value = null
    try {
        const res = await axios.post('/api/flux/test-gemini', { geminiImageApiKey: geminiImageApiKey.value })
        geminiTestResult.value = res.data
    } catch (e) {
        geminiTestResult.value = { success: false, message: e.message }
    }
    geminiTestLoading.value = false
}

function onFluxAvatarUpload(event) {
    const file = event.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
        fluxAvatar.value = e.target.result
    }
    reader.readAsDataURL(file)
}

/* LIVE-ANALYSE (Heatmap / Bookmap) — Werte liegen im Live-Store und speichern
   sich dort selbst in die settings-Tabelle. */
let liveExpanded = ref(false)
let livetradingExpanded = ref(false)
/* Vorgabe an — die Seite kostet nichts, solange man sie nicht öffnet. Wer nur
   beobachtet und nicht handelt, schaltet sie hier weg; dann verschwinden auch
   der Startknopf auf dem Marktradar und der Menüeintrag. */
let livetradingAn = ref(true)

/* STRATEGIE-AGENTEN — globale Schutzschalter. Bewusst hier und nicht in der
   Instanz-Konfiguration: sie stehen ÜBER jeder einzelnen Strategie, damit eine
   fehlkonfigurierte Instanz sie nicht umgehen kann. */
let agentExpanded = ref(true) // eigener Unter-Reiter: offen starten
let agentKillSwitch = ref(false)
let agentLiveEnabled = ref(false)
let agentMaxLeverage = ref(10)
let agentMinPaperTrades = ref(20)
let agentLlmBudget = ref(1)
let agentSaving = ref(false)
let agentResult = ref(null)

function loadAgentSettings() {
    const s = currentUser.value || {}
    agentKillSwitch.value = !!Number(s.strategyKillSwitch)
    agentLiveEnabled.value = !!Number(s.strategyLiveEnabled)
    agentMaxLeverage.value = Number(s.strategyMaxLeverage) || 10
    agentMinPaperTrades.value = Number(s.strategyMinPaperTrades) ?? 20
    agentLlmBudget.value = Number(s.strategyLlmBudgetUsd) || 1
}

async function saveAgentSettings() {
    agentSaving.value = true
    agentResult.value = null
    try {
        const daten = {
            strategyKillSwitch: agentKillSwitch.value ? 1 : 0,
            strategyLiveEnabled: agentLiveEnabled.value ? 1 : 0,
            strategyMaxLeverage: Math.min(Math.max(1, agentMaxLeverage.value || 1), 125),
            strategyMinPaperTrades: Math.max(0, agentMinPaperTrades.value || 0),
            strategyLlmBudgetUsd: Math.max(0, agentLlmBudget.value || 0),
        }
        await dbUpdateSettings(daten)
        Object.assign(currentUser.value, daten)
        agentResult.value = { success: true, message: 'Gespeichert.' }
    } catch (e) {
        agentResult.value = { success: false, message: e.response?.data?.error || e.message }
    } finally {
        agentSaving.value = false
        setTimeout(() => agentResult.value = null, 6000)
    }
}

/* MARKTRADAR — betrifft nur, was serverseitig gerechnet wird. Sichtbarkeit,
   Reihenfolge und Grösse der Kacheln stehen bewusst NICHT hier: die liegen je
   Gerät im localStorage und werden direkt auf der Seite eingestellt. */
let radarExpanded = ref(false)
let radarRsiSymbols = ref('')
let radarKalenderLaender = ref('')
let radarKalenderImpact = ref('medium')
let radarHolt = ref(false)
let radarMeldung = ref('')
let radarNewsAuto = ref(true)
let radarNewsStunde = ref(12)
let radarNewsVideos = ref(3)
let radarNewsModel = ref('')
/* Leer = Vorgabe des Projekts bzw. der allgemein eingestellte Anbieter. So
   steht im Feld nie ein Modellname, der beim nächsten Katalogwechsel veraltet. */
let radarNewsAufloesung = ref('niedrig')
let radarNewsBerichtProvider = ref('')
let radarNewsBerichtModell = ref('')
/* Zuschnitt des Berichts: Rhythmus (täglich/wöchentlich + Wochentag), Themen
   als Kapitel und Länge. Themen als Array — gespeichert wird CSV. */
let radarNewsRhythmus = ref('taeglich')
let radarNewsWochentag = ref(1)
/* Aktualisierungen im Tagesverlauf: keine, eine oder zwei. Gespeichert wird
   die Zahl plus die Stunden als CSV; hier stehen sie als zwei getrennte Felder,
   weil man sie einzeln auswählt. */
let radarNewsUpdates = ref(0)
let radarNewsUpdateStunde1 = ref(18)
let radarNewsUpdateStunde2 = ref(21)
/* Ganzer Bericht in der Mail statt nur der Gesamtlage. */
let radarNewsMailVoll = ref(false)
/* Wie lange erzeugte Berichte liegen bleiben. 'manuell' löscht nie. */
let radarNewsBerichtAufbewahrung = ref('manuell')
/* Zeithorizont der Chartanalyse: wie alt die Analysen sein dürfen und wie weit
   sie vorausschauen sollen. */
let radarNewsChartFrische = ref('woche')
/* Prüfung der eigenen Anweisungen: Befunde und geschärfte Fassung. */
const anweisungPruefung = ref(null)
const anweisungLaeuft = ref(false)

/**
 * Die eigene Anweisung vom Modell beurteilen lassen.
 *
 * Geprüft wird der Text im Feld, nicht der gespeicherte — sonst müsste man
 * erst speichern, um zu erfahren, ob das Gespeicherte etwas taugt. Gespeichert
 * wird erst mit „Übernehmen".
 */
async function anweisungPruefen() {
    anweisungLaeuft.value = true
    anweisungPruefung.value = null
    try {
        const { data } = await axios.post('/api/marktradar/lagebericht/anweisung-pruefen',
            { text: radarNewsPromptZusatz.value }, { timeout: 120000 })
        anweisungPruefung.value = data
    } catch (e) {
        anweisungPruefung.value = {
            befunde: [{ art: 'wirkungslos', text: e.response?.data?.error || e.message }],
            vorschlag: '',
        }
    } finally {
        anweisungLaeuft.value = false
    }
}

function anweisungUebernehmen() {
    radarNewsPromptZusatz.value = anweisungPruefung.value.vorschlag
    radarSpeichern('radarNewsPromptZusatz')
    anweisungPruefung.value = null
}
let radarNewsThemen = ref(['crypto'])
let radarNewsLaenge = ref('mittel')
let radarNewsXModell = ref('grok-4.6')
/* Umfangs- und Darstellungsregler. Überall heisst 0 bzw. leer „Vorgabe der
   gewählten Länge" — wer nichts einstellt, bekommt exakt das bisherige
   Verhalten. Dieselben Werte stehen auch in der Schnellleiste auf
   /nachrichten; beide schreiben in dieselben Spalten. */
let radarNewsLayout = ref('dossier')
/** Eigene Anweisungen an die Berichts-KI. Leer = Bericht wie gehabt. */
let radarNewsPromptZusatz = ref('')
let radarNewsPunkte = ref(0)
let radarNewsTokenBudget = ref(0)
let radarNewsVideoTiefe = ref('normal')
let radarNewsVideoTokens = ref(0)

/* 0 ist kein Wert, sondern „Vorgabe der Länge" — deshalb zeigen die Felder
   dann „auto" statt einer nackten Null, wie in der Schnellleiste auf
   /nachrichten auch. Dafür kein `v-model`, sondern Wert und Änderung getrennt. */
function grenzeZahl(wert, max) {
    return Math.max(0, Math.min(max, Math.round(Number(wert) || 0)))
}
// radarPicycleAlarm gibt es nicht mehr als eigenen Schalter — ob gemeldet wird,
// steht in der Kanalwahl unter „Meldungen". Die Spalte bleibt in der Datenbank
// stehen, wird aber nicht mehr gelesen oder geschrieben.
let radarPicycleSchwelle = ref(0)
let radarFundingDivergenz = ref(15)
/* Welche Märkte der Divergenz-Alarm beobachtet. Leer = die eigenen Märkte,
   wie vor der Auswahl — die Vorgabe darf nicht stillschweigend auf „keine"
   kippen, sonst schweigt ein bestehender Alarm nach dem Update. */
let radarDivergenzSymbole = ref('')
let berichtLaeuft = ref(false)
let berichtMeldung = ref('')
let berichtFehler = ref(false)

/**
 * Was ein Lauf ungefähr kostet — aus den tatsächlich eingestellten Werten,
 * nicht als feste Zahl im Text. Grundlage: Claude-Bericht rund 6 000 Token
 * ein und 900 aus; Video bei Gemini rund 100 Token je Sekunde in niedriger
 * und 300 in Standardauflösung, angenommene 20 Minuten Länge.
 *
 * Bewusst eine Spanne und ein „ungefähr": Videolängen schwanken zwischen fünf
 * und sechzig Minuten, und eine auf den Rappen genaue Zahl wäre hier gelogen.
 */
const kostenSchaetzung = computed(() => {
    const bericht = 0.05                       // Opus 4.6: 6k ein + 900 aus
    const proSekunde = radarNewsAufloesung.value === 'standard' ? 300 : 100
    const proVideo = (20 * 60 * proSekunde / 1e6) * 0.30   // Gemini 0,30 $/Mio.
    const videos = Math.max(0, Math.min(10, Number(radarNewsVideos.value) || 0))
    return { gesamt: bericht + videos * proVideo, proVideo, bericht, videos }
})

let radarArschlochfilter = ref(true)
/* Der NEUE Arschlochfilter: Truth Social automatisch + Stichwörter (eine je
   Zeile). Der alte Sammelschalter oben drüber heisst jetzt „Temporär
   ausschliessen" — gleiche Technik, ehrlicherer Name. */
let radarArschlochAn = ref(true)
let radarArschlochWoerter = ref('')

/* Nachrichtenquellen — serverseitige Liste, deshalb eigene Endpunkte statt
   der generischen Tabellen-Route: die URL kommt vom Nutzer und muss vor dem
   Speichern gegen interne Ziele geprüft werden (server/net-guard.js). */
let newsQuellen = ref([])
let newsVorschlaege = ref([])
let neueQuelle = ref({ art: 'youtube', name: '', url: '' })
let newsMeldung = ref('')
let newsFehler = ref(false)
let newsTestet = ref(false)

function loadRadarSettings() {
    const s = currentUser.value || {}
    radarRsiSymbols.value = s.radarRsiSymbols || ''
    radarKalenderLaender.value = s.radarKalenderLaender || 'USD,JPY'
    radarKalenderImpact.value = s.radarKalenderImpact || 'medium'
    radarArschlochfilter.value = Number(s.radarArschlochfilter ?? 1) === 1
    livetradingAn.value = Number(s.livetradingAn ?? 1) === 1
    radarNewsAuto.value = Number(s.radarNewsAuto ?? 1) === 1
    radarNewsStunde.value = Number(s.radarNewsStunde ?? 12)
    radarNewsVideos.value = Number(s.radarNewsVideos ?? 3)
    radarNewsModel.value = s.radarNewsModel || ''
    radarNewsAufloesung.value = s.radarNewsAufloesung || 'niedrig'
    radarNewsBerichtProvider.value = s.radarNewsBerichtProvider || ''
    radarNewsBerichtModell.value = s.radarNewsBerichtModell || ''
    radarNewsRhythmus.value = ['woechentlich', 'manuell'].includes(s.radarNewsRhythmus)
        ? s.radarNewsRhythmus : 'taeglich'
    radarNewsWochentag.value = Math.max(1, Math.min(7, Number(s.radarNewsWochentag ?? 1)))
    radarNewsUpdates.value = Math.max(0, Math.min(2, Number(s.radarNewsUpdates) || 0))
    radarNewsMailVoll.value = Number(s.radarNewsMailVoll ?? 0) === 1
    radarNewsBerichtAufbewahrung.value = ['manuell', 'tag', 'woche', 'monat']
        .includes(s.radarNewsBerichtAufbewahrung) ? s.radarNewsBerichtAufbewahrung : 'manuell'
    radarNewsChartFrische.value = ['tag', 'woche', 'monat'].includes(s.radarNewsChartFrische)
        ? s.radarNewsChartFrische : 'woche'
    {
        // Wie `leseUpdateStunden` auf dem Server: sortiert und geklemmt. Fehlt
        // eine Stunde, bleibt die Vorgabe stehen — ein leeres Auswahlfeld wäre
        // ein Wert, den niemand gewählt hat.
        const st = String(s.radarNewsUpdateStunden || '18,21').split(',')
            .map(x => x.trim()).filter(x => x !== '')
            .map(x => Math.max(0, Math.min(23, Number(x) || 0)))
            .sort((a, b) => a - b)
        radarNewsUpdateStunde1.value = Number.isFinite(st[0]) ? st[0] : 18
        radarNewsUpdateStunde2.value = Number.isFinite(st[1]) ? st[1] : 21
    }
    radarNewsThemen.value = String(s.radarNewsThemen || 'crypto').split(',')
        .map(t => t.trim()).filter(t => ['crypto', 'finanzen', 'tech', 'chartanalyse'].includes(t))
    if (!radarNewsThemen.value.length) radarNewsThemen.value = ['crypto']
    radarNewsLaenge.value = ['kurz', 'mittel', 'lang'].includes(s.radarNewsLaenge) ? s.radarNewsLaenge : 'mittel'
    radarNewsXModell.value = s.radarNewsXModell || 'grok-4.6'
    // Grenzen wie auf dem Server (budgetsAus/punkteVorgabe/videoTiefeAus in
    // server/marktradar-news.js) — die Oberfläche soll ihm keinen Unsinn schicken.
    // Unbekannt (auch das kurzzeitig gespeicherte „zeitung") → dossier, die Vorgabe.
    radarNewsLayout.value = ['dossier', 'kombiniert', 'artikel', 'kacheln'].includes(s.radarNewsLayout)
        ? s.radarNewsLayout : 'dossier'
    radarNewsPromptZusatz.value = s.radarNewsPromptZusatz || ''
    radarNewsPunkte.value = Math.max(0, Math.min(12, Number(s.radarNewsPunkte) || 0))
    radarNewsTokenBudget.value = Math.max(0, Math.min(60000, Number(s.radarNewsTokenBudget) || 0))
    radarNewsVideoTiefe.value = ['knapp', 'normal', 'ausfuehrlich'].includes(s.radarNewsVideoTiefe)
        ? s.radarNewsVideoTiefe : 'normal'
    radarNewsVideoTokens.value = Math.max(0, Math.min(4000, Number(s.radarNewsVideoTokens) || 0))
    radarArschlochAn.value = Number(s.radarArschlochAn ?? 1) === 1
    radarArschlochWoerter.value = s.radarArschlochWoerter ?? 'Donald Trump'
    radarPicycleSchwelle.value = Number(s.radarPicycleSchwelle ?? 0)
    radarFundingDivergenz.value = Number(s.radarFundingDivergenz ?? 15)
    radarDivergenzSymbole.value = s.radarDivergenzSymbole || ''
    ladeNewsQuellen()
}

/**
 * Speichert GENAU EIN Feld.
 *
 * Vorher schrieb diese Funktion die ganze Gruppe auf einmal — mit der Folge,
 * dass eine Änderung an der Länderliste den Arschlochfilter mit dem Stand
 * überschrieb, den die Seite beim Laden gesehen hatte. Stand die Seite länger
 * offen oder wurde der Wert anderswo geändert, kippte er stillschweigend
 * zurück. Ein Feld, ein Schreibvorgang.
 */
async function radarSpeichern(feld) {
    const alle = {
        radarRsiSymbols: radarRsiSymbols.value.toUpperCase().replace(/\s+/g, ''),
        radarKalenderLaender: radarKalenderLaender.value.toUpperCase().replace(/\s+/g, ''),
        radarKalenderImpact: radarKalenderImpact.value,
        radarArschlochfilter: radarArschlochfilter.value ? 1 : 0,
        livetradingAn: livetradingAn.value ? 1 : 0,
        radarNewsAuto: radarNewsAuto.value ? 1 : 0,
        radarNewsStunde: radarNewsStunde.value,
        radarNewsModel: radarNewsModel.value.trim(),
        radarNewsAufloesung: radarNewsAufloesung.value,
        radarNewsBerichtProvider: radarNewsBerichtProvider.value,
        radarNewsBerichtModell: radarNewsBerichtModell.value.trim(),
        radarNewsRhythmus: radarNewsRhythmus.value,
        radarNewsWochentag: Math.max(1, Math.min(7, Number(radarNewsWochentag.value) || 1)),
        radarNewsUpdates: Math.max(0, Math.min(2, Number(radarNewsUpdates.value) || 0)),
        radarNewsMailVoll: radarNewsMailVoll.value ? 1 : 0,
        radarNewsBerichtAufbewahrung: radarNewsBerichtAufbewahrung.value,
        radarNewsChartFrische: radarNewsChartFrische.value,
        // Immer beide Stunden schreiben, auch bei nur einer Aktualisierung:
        // Die Anzahl entscheidet, wie viele davon gelten — so bleibt die zweite
        // Wahl erhalten, wenn jemand kurz auf „eine" stellt und zurück.
        radarNewsUpdateStunden: [radarNewsUpdateStunde1.value, radarNewsUpdateStunde2.value]
            .map(h => Math.max(0, Math.min(23, Number(h) || 0))).join(','),
        // Reihenfolge festnageln, damit die Kapitel immer gleich sortiert sind
        radarNewsThemen: ['crypto', 'finanzen', 'tech', 'chartanalyse'].filter(t => radarNewsThemen.value.includes(t)).join(','),
        radarNewsLaenge: radarNewsLaenge.value,
        radarNewsXModell: radarNewsXModell.value.trim() || 'grok-4.6',
        radarArschlochAn: radarArschlochAn.value ? 1 : 0,
        radarArschlochWoerter: radarArschlochWoerter.value,
        radarPicycleSchwelle: Math.max(0, Math.min(50, Number(radarPicycleSchwelle.value) || 0)),
        radarFundingDivergenz: Math.max(0, Math.min(100, Number(radarFundingDivergenz.value) || 0)),
        radarDivergenzSymbole: radarDivergenzSymbole.value,
        // Hart begrenzen, nicht bloss im Eingabefeld: der Server deckelt
        // ohnehin bei zehn, und eine Zahl anzuzeigen, die nie gilt, wäre gelogen
        radarNewsVideos: Math.max(0, Math.min(10, Number(radarNewsVideos.value) || 0)),
        radarNewsLayout: radarNewsLayout.value,
        // Gleicher Deckel wie der Server (ZUSATZ_MAX in marktradar-news.js) —
        // ein Feld, das mehr annimmt als gilt, belügt den Schreibenden
        radarNewsPromptZusatz: radarNewsPromptZusatz.value.trim().slice(0, 2000),
        radarNewsPunkte: Math.max(0, Math.min(12, Number(radarNewsPunkte.value) || 0)),
        radarNewsTokenBudget: Math.max(0, Math.min(60000, Number(radarNewsTokenBudget.value) || 0)),
        radarNewsVideoTiefe: radarNewsVideoTiefe.value,
        radarNewsVideoTokens: Math.max(0, Math.min(4000, Number(radarNewsVideoTokens.value) || 0)),
    }
    const daten = feld ? { [feld]: alle[feld] } : alle
    await dbUpdateSettings(daten)
    // Den lokalen Stand nachziehen, sonst schreibt der nächste Speichervorgang
    // wieder gegen einen veralteten currentUser
    if (currentUser.value) Object.assign(currentUser.value, daten)
    radarMeldung.value = 'Gespeichert.'
    setTimeout(() => { radarMeldung.value = '' }, 2500)
}

/* Der Bericht kostet Geld — deshalb ausschliesslich auf ausdrücklichen
   Knopfdruck, mit sichtbarer Rückmeldung darüber, was er verbraucht hat. */
async function berichtJetzt() {
    berichtLaeuft.value = true
    berichtMeldung.value = ''
    berichtFehler.value = false
    try {
        const { data } = await axios.post('/api/marktradar/lagebericht/erzeugen')
        if (data.uebersprungen) {
            berichtMeldung.value = 'Zuletzt vor Kurzem erzeugt — höchstens alle fünf Minuten.'
        } else if (data.fehler) {
            berichtMeldung.value = data.fehler
            berichtFehler.value = true
        } else {
            berichtMeldung.value = `Fertig: ${data.beitraege} Beiträge, ${data.videos} Video(s), `
                + `${data.tokens} Token via ${data.provider}/${data.modell}`
                + (data.kostenUsd ? ` — ${data.kostenUsd.toFixed(4)} USD` : '')
                + (data.geminiFehler ? ` · Gemini: ${data.geminiFehler}` : '')
        }
    } catch (e) {
        berichtMeldung.value = e.response?.data?.error || e.message
        berichtFehler.value = true
    } finally {
        berichtLaeuft.value = false
    }
}

async function ladeNewsQuellen() {
    try {
        const { data } = await axios.get('/api/marktradar/news/sources')
        newsQuellen.value = data.quellen || []
        // Vorschläge nur zeigen, solange sie nicht schon eingetragen sind
        const vorhanden = new Set(newsQuellen.value.map(q => q.url))
        newsVorschlaege.value = (data.vorschlaege || []).filter(v => !vorhanden.has(v.url))
    } catch (e) {
        newsQuellen.value = []
    }
}

function meldung(text, fehler = false) {
    newsMeldung.value = text
    newsFehler.value = fehler
    setTimeout(() => { newsMeldung.value = '' }, 6000)
}

async function quelleTesten() {
    newsTestet.value = true
    try {
        // `art` mitschicken: Telegram braucht den anderen Leser, X wird nur
        // auf Handle-Form geprüft (jede echte Suche kostet)
        const { data } = await axios.post('/api/marktradar/news/test', {
            url: neueQuelle.value.url, art: neueQuelle.value.art,
        })
        meldung(data.hinweis || `${data.anzahl} Einträge gefunden — z.B. „${(data.beispiel[0] || '').slice(0, 60)}"`)
    } catch (e) {
        meldung(e.response?.data?.error || e.message, true)
    } finally {
        newsTestet.value = false
    }
}

async function quelleAnlegen() {
    try {
        await axios.post('/api/marktradar/news/sources', neueQuelle.value)
        neueQuelle.value = { art: 'youtube', name: '', url: '' }
        await ladeNewsQuellen()
        meldung('Quelle hinzugefügt.')
    } catch (e) {
        meldung(e.response?.data?.error || e.message, true)
    }
}

async function quelleAendern(q, felder) {
    try {
        await axios.put(`/api/marktradar/news/sources/${q.id}`, felder)
        await ladeNewsQuellen()
    } catch (e) {
        meldung(e.response?.data?.error || e.message, true)
    }
}

async function quelleLoeschen(q) {
    if (!confirm(`Quelle „${q.name || q.url}" mitsamt ihren Beiträgen löschen?`)) return
    try {
        await axios.delete(`/api/marktradar/news/sources/${q.id}`)
        await ladeNewsQuellen()
    } catch (e) {
        meldung(e.response?.data?.error || e.message, true)
    }
}

async function vorschlagUebernehmen(v) {
    neueQuelle.value = { art: v.art, name: v.name, url: v.url, laerm: v.laerm }
    await quelleAnlegen()
}

async function kalenderHolen() {
    radarHolt.value = true
    radarMeldung.value = ''
    try {
        const { data } = await axios.post('/api/marktradar/kalender/holen')
        radarMeldung.value = data.uebersprungen
            // Der Feed ist gedrosselt — ein „zu früh" ist kein Fehler
            ? 'Zuletzt vor Kurzem geholt — der Feed wird höchstens alle paar Minuten gefragt.'
            : `${data.gesehen} Termine gesehen, ${data.neu} neu.`
    } catch (e) {
        radarMeldung.value = e.response?.data?.error || e.message
    } finally {
        radarHolt.value = false
    }
}

/* LIVE-RECORDER — serverseitige Aufzeichnung, deshalb eigene Felder mit
   explizitem Speichern (der Server übernimmt sie erst beim Neuabgleich). */
let recExpanded = ref(false)
let recEnabled = ref(false)
let recSymbols = ref('')
let recDays = ref(14)
let recFrameMs = ref(1000)
let recRows = ref(200)
let recRangePct = ref(1)
let recAllLiq = ref(false)
let recSaving = ref(false)
let recResult = ref(null)
let recStatus = ref(null)

function loadRecorderSettings() {
    const s = currentUser.value || {}
    recEnabled.value = !!Number(s.liveRecordEnabled)
    recSymbols.value = s.liveRecordSymbols || ''
    recDays.value = Number(s.liveRecordDays) || 14
    recFrameMs.value = Number(s.liveRecordFrameMs) || 1000
    recRows.value = Number(s.liveRecordRows) || 200
    recRangePct.value = Number(s.liveRecordRangePct) || 1
    recAllLiq.value = !!Number(s.liveRecordAllLiq)
}

async function loadRecorderStatus() {
    try {
        const { data } = await axios.get('/api/live/recorder/status')
        recStatus.value = data
    } catch (e) {
        recStatus.value = null
    }
}

async function saveRecorderSettings() {
    recSaving.value = true
    recResult.value = null
    try {
        await dbUpdateSettings({
            liveRecordEnabled: recEnabled.value ? 1 : 0,
            liveRecordSymbols: recSymbols.value.toUpperCase().replace(/\s+/g, ''),
            liveRecordDays: recDays.value,
            liveRecordFrameMs: recFrameMs.value,
            liveRecordRows: recRows.value,
            liveRecordRangePct: recRangePct.value,
            liveRecordAllLiq: recAllLiq.value ? 1 : 0,
        })
        const { data } = await axios.post('/api/live/recorder/reload')
        await loadRecorderStatus()
        recResult.value = { success: true, message: `Gespeichert — ${data.laufend} Symbol(e) werden aufgezeichnet.` }
    } catch (e) {
        recResult.value = { success: false, message: e.response?.data?.error || e.message }
    } finally {
        recSaving.value = false
        setTimeout(() => recResult.value = null, 6000)
    }
}

const recBytesGesamt = computed(() =>
    (recStatus.value?.gespeichert || []).reduce((sum, r) => sum + (r.bytes || 0), 0))

const fmtBytes = (b) => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB'
    : b >= 1024 ? (b / 1024).toFixed(0) + ' kB' : b + ' B'

/* ESP32 DISPLAY SETTINGS */
let esp32Expanded = ref(false)
let esp32KeySet = ref(false)
let esp32ApiKeyDisplay = ref('')
let esp32SaveLoading = ref(false)
let esp32SaveResult = ref(null)
let esp32Filter = ref('month')

async function loadEsp32Settings() {
    try {
        const res = await axios.get('/api/esp32/settings')
        esp32KeySet.value = res.data.esp32ApiKeySet || false
        if (esp32KeySet.value && !esp32ApiKeyDisplay.value) {
            esp32ApiKeyDisplay.value = '••••••••••••••••••••••••••••••••'
        }
    } catch (e) {
        console.error('ESP32 settings load error:', e)
    }
}

async function saveEsp32Filter() {
    try {
        await dbUpdateSettings({ esp32Filter: esp32Filter.value })
        esp32SaveResult.value = { success: true, message: 'Filter gespeichert — Anzeigen übernehmen beim nächsten Abruf.' }
        setTimeout(() => esp32SaveResult.value = null, 5000)
    } catch (e) {
        esp32SaveResult.value = { success: false, message: e.message }
    }
}

async function generateEsp32Key() {
    esp32SaveLoading.value = true
    esp32SaveResult.value = null
    try {
        const res = await axios.post('/api/esp32/settings', { regenerate: true })
        esp32ApiKeyDisplay.value = res.data.plainKey || ''
        esp32KeySet.value = true
        esp32SaveResult.value = { success: true, message: 'Neuer Key generiert — einmalig sichtbar. Jetzt kopieren!' }
        setTimeout(() => esp32SaveResult.value = null, 10000)
    } catch (e) {
        esp32SaveResult.value = { success: false, message: e.message }
    }
    esp32SaveLoading.value = false
}

async function clearEsp32Key() {
    try {
        await axios.delete('/api/esp32/key')
        esp32KeySet.value = false
        esp32ApiKeyDisplay.value = ''
    } catch (e) {
        alert('Fehler: ' + e.message)
    }
}

// ── Sicherheit: optionales Passwort-Gate ──
let authExpanded = ref(false)
let authEnabled = ref(false)
let authCurrentPassword = ref('')
let authNewPassword = ref('')
let authNewPassword2 = ref('')
let authSaveLoading = ref(false)
let authSaveResult = ref(null)

async function loadAuthStatus() {
    try {
        const { data } = await axios.get('/api/auth/status')
        authEnabled.value = !!data.authEnabled
    } catch (e) {
        authEnabled.value = false
    }
}

async function saveAuthPassword() {
    authSaveResult.value = null
    if (authNewPassword.value.length < 6) {
        authSaveResult.value = { success: false, message: 'Passwort muss mindestens 6 Zeichen haben.' }
        return
    }
    if (authNewPassword.value !== authNewPassword2.value) {
        authSaveResult.value = { success: false, message: 'Passwörter stimmen nicht überein.' }
        return
    }
    authSaveLoading.value = true
    try {
        await axios.post('/api/auth/set-password', {
            currentPassword: authCurrentPassword.value,
            newPassword: authNewPassword.value
        })
        authEnabled.value = true
        authCurrentPassword.value = ''
        authNewPassword.value = ''
        authNewPassword2.value = ''
        authSaveResult.value = { success: true, message: 'Passwortschutz aktiv.' }
        setTimeout(() => authSaveResult.value = null, 5000)
    } catch (e) {
        authSaveResult.value = { success: false, message: e.response?.data?.error || e.message }
    }
    authSaveLoading.value = false
}

async function logout() {
    try {
        await axios.post('/api/logout')
    } catch (e) { /* egal — danach neu laden */ }
    window.location.reload()
}

async function disableAuth() {
    authSaveResult.value = null
    if (!confirm('Passwortschutz wirklich deaktivieren? Danach hat jeder mit Zugriff aufs Netzwerk vollen Zugang.')) return
    authSaveLoading.value = true
    try {
        await axios.post('/api/auth/disable', { currentPassword: authCurrentPassword.value })
        authEnabled.value = false
        authCurrentPassword.value = ''
        authSaveResult.value = { success: true, message: 'Passwortschutz deaktiviert.' }
        setTimeout(() => authSaveResult.value = null, 5000)
    } catch (e) {
        authSaveResult.value = { success: false, message: e.response?.data?.error || e.message }
    }
    authSaveLoading.value = false
}

async function loadDbConfig() {
    try {
        const res = await axios.get('/api/db-config')
        dbType.value = res.data.type || 'sqlite'
        if (res.data.type === 'postgresql') {
            dbHost.value = res.data.host || 'localhost'
            dbPort.value = res.data.port || 5432
            dbUser.value = res.data.user || 'tradejournal'
            dbDatabase.value = res.data.database || 'tradejournal'
            dbHasPassword.value = res.data.hasPassword || false
        }
    } catch (e) {
        console.error('Fehler beim Laden der DB-Konfiguration:', e)
    }
}

async function testDbConnection() {
    dbTestLoading.value = true
    dbTestResult.value = null
    try {
        const res = await axios.post('/api/db-config/test', {
            host: dbHost.value,
            port: dbPort.value,
            user: dbUser.value,
            password: dbPassword.value,
            database: dbDatabase.value
        })
        dbTestResult.value = res.data
    } catch (e) {
        dbTestResult.value = { ok: false, message: e.message }
    }
    dbTestLoading.value = false
}

async function saveDbConfig() {
    dbSaveResult.value = null
    try {
        const data = { type: dbType.value }
        if (dbType.value === 'postgresql') {
            data.host = dbHost.value
            data.port = dbPort.value
            data.user = dbUser.value
            data.password = dbPassword.value
            data.database = dbDatabase.value
        }
        const res = await axios.put('/api/db-config', data)
        dbSaveResult.value = { ok: true, message: res.data.message }
    } catch (e) {
        dbSaveResult.value = { ok: false, message: t('common.errorPrefix') + e.message }
    }
}

async function restartServer() {
    dbRestartLoading.value = true
    try {
        // Bestätigungs-Token holen (nur von localhost erlaubt) und mitsenden
        const { data: tok } = await axios.get('/api/restart/token')
        await axios.post('/api/restart', { confirmToken: tok?.token })
    } catch (e) {
        // Connection will drop during restart — that's expected.
        // 403 = nicht von localhost: Neustart muss lokal auf dem Server erfolgen.
        if (e.response?.status === 403) {
            dbRestartLoading.value = false
            dbSaveResult.value = { ok: false, message: 'Neustart nur direkt auf dem Server (localhost) möglich.' }
            return
        }
    }
    // Wait for server to come back
    let retries = 0
    while (retries < 20) {
        await new Promise(r => setTimeout(r, 1500))
        try {
            await axios.get('/api/db/settings')
            // Server is back — reload page to get new session cookie
            window.location.reload()
            return
        } catch (e) {
            retries++
        }
    }
    dbRestartLoading.value = false
    dbSaveResult.value = { ok: false, message: t('common.serverNotResponding') }
}

async function exportDb() {
    dbExportLoading.value = true
    dbMigrationResult.value = null
    try {
        const res = await axios.get('/api/db-export')
        const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `tradejournal-backup-${new Date().toISOString().slice(0,10)}.json`
        a.click()
        URL.revokeObjectURL(url)
        dbMigrationResult.value = { ok: true, message: t('settings.exportSuccess') }
    } catch (e) {
        dbMigrationResult.value = { ok: false, message: t('settings.exportFailed') + e.message }
    }
    dbExportLoading.value = false
}

async function importDb() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
        const file = e.target.files[0]
        if (!file) return
        dbImportLoading.value = true
        dbMigrationResult.value = null
        try {
            const text = await file.text()
            const data = JSON.parse(text)
            const res = await axios.post('/api/db-import', data, {
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            })
            if (res.data.ok) {
                const counts = Object.entries(res.data.imported).map(([t, n]) => `${t}: ${n}`).join(', ')
                dbMigrationResult.value = { ok: true, message: t('settings.importSuccess', { counts }) }
            } else {
                dbMigrationResult.value = { ok: false, message: res.data.error || t('settings.importFailed') }
            }
        } catch (e) {
            dbMigrationResult.value = { ok: false, message: t('settings.importFailed') + ': ' + e.message }
        }
        dbImportLoading.value = false
    }
    input.click()
}

let localTimeframes = reactive(new Set())
let customTimeframes = reactive([])
let newCustomTf = ref('')

/* TAGS */
let tagGroups = reactive([])
let newGroupName = ref('')
let newGroupColor = ref('#6c757d')
let newTagName = ref({}) // keyed by group id
let editingGroup = ref(null)
let editGroupName = ref('')
let editGroupColor = ref('')

onMounted(async () => {
    await useInitTooltip()
    await ladeBenachrichtigungen()
})

/* PROFILE */
async function uploadProfileAvatar(event) {
    const file = event.target.files[0];
    profileAvatar = file
}

async function deleteAvatar() {
    await dbUpdateSettings({ avatar: '' })
    profileAvatar = null
    await useCheckCurrentUser()
    renderProfile.value += 1
    console.log(' -> Avatar gelöscht')
}

async function updateProfile() {
    console.log(" update profile")
    return new Promise(async (resolve, reject) => {
        console.log("\nUPDATING PROFILE")
        // Always save username
        await dbUpdateSettings({ username: username.value || '' })

        if (profileAvatar != null) {
            const reader = new FileReader()
            reader.onloadend = async () => {
                await dbUpdateSettings({ avatar: reader.result })
                await useCheckCurrentUser()
                await (renderProfile.value += 1)
                console.log(" -> Profile updated")
                resolve()
            }
            reader.readAsDataURL(profileAvatar)
        } else {
            await useCheckCurrentUser()
            await (renderProfile.value += 1)
            resolve()
        }
    })
}

/* BITUNIX API */
async function loadBitunixConfig() {
    try {
        const response = await axios.get('/api/bitunix/config')
        bitunixApiKey.value = response.data.apiKey || ''
        bitunixImportStartDate.value = response.data.apiImportStartDate || ''
        if (response.data.hasSecret) {
            bitunixSecretKey.value = '••••••••'
        }
    } catch (error) {
        console.log(' -> Error loading Bitunix config: ' + error)
    }
}

async function saveBitunixConfig() {
    try {
        const data = { apiKey: bitunixApiKey.value, apiImportStartDate: bitunixImportStartDate.value }
        if (bitunixSecretKey.value && bitunixSecretKey.value !== '••••••••') {
            data.secretKey = bitunixSecretKey.value
        }
        await axios.post('/api/bitunix/config', data)
        alert(t('settings.bitunixSaved'))
    } catch (error) {
        alert(t('settings.savingConfigError') + error.message)
    }
}

async function testBitunixConnection() {
    bitunixTestLoading.value = true
    bitunixTestResult.value = null
    try {
        const response = await axios.post('/api/bitunix/test')
        if (response.data.ok) {
            bitunixTestResult.value = 'success'
        } else {
            bitunixTestResult.value = 'error'
        }
    } catch (error) {
        bitunixTestResult.value = 'error'
    }
    bitunixTestLoading.value = false
}

/* BITGET API */
async function loadBitgetConfig() {
    try {
        const response = await axios.get('/api/bitget/config')
        bitgetApiKey.value = response.data.apiKey || ''
        bitgetImportStartDate.value = response.data.apiImportStartDate || ''
        if (response.data.hasSecret) {
            bitgetSecretKey.value = '••••••••'
        }
        if (response.data.hasPassphrase) {
            bitgetPassphrase.value = '••••••••'
        }
    } catch (error) {
        console.log(' -> Error loading Bitget config: ' + error)
    }
}

const bitgetImporting = ref(false)

async function saveBitgetConfig() {
    try {
        const data = { apiKey: bitgetApiKey.value, apiImportStartDate: bitgetImportStartDate.value }
        if (bitgetSecretKey.value && bitgetSecretKey.value !== '••••••••') {
            data.secretKey = bitgetSecretKey.value
        }
        if (bitgetPassphrase.value && bitgetPassphrase.value !== '••••••••') {
            data.passphrase = bitgetPassphrase.value
        }
        await axios.post('/api/bitget/config', data)
        alert(t('settings.bitgetSaved'))

        // Auto-trigger historical import if start date is set
        if (bitgetImportStartDate.value) {
            bitgetImporting.value = true
            try {
                const result = await useQuickApiImport('bitget')
                if (result.count > 0) {
                    sendNotification('importFertig', 'Bitget Import', result.message || t('messages.importCount', { count: result.count }))
                } else {
                    sendNotification('importFertig', 'Bitget Import', result.message || t('messages.noNewTrades'))
                }
            } catch (importError) {
                console.log(' -> Bitget auto-import error:', importError.message)
                sendNotification('importFertig', 'Bitget Import', t('messages.importFailed') + (importError.response?.data?.error || importError.message))
            }
            bitgetImporting.value = false
        }
    } catch (error) {
        alert(t('settings.savingConfigError') + error.message)
    }
}

let bitgetTestError = ref('')

async function testBitgetConnection() {
    bitgetTestLoading.value = true
    bitgetTestResult.value = null
    bitgetTestError.value = ''
    try {
        const response = await axios.post('/api/bitget/test')
        if (response.data.ok) {
            bitgetTestResult.value = 'success'
        } else {
            bitgetTestResult.value = 'error'
            bitgetTestError.value = response.data.error || t('settings.unknownError')
        }
    } catch (error) {
        bitgetTestResult.value = 'error'
        bitgetTestError.value = error.response?.data?.error || error.message || t('common.connectionFailed')
    }
    bitgetTestLoading.value = false
}

/* ==================== PIONEX ==================== */
let pionexApiKey = ref('')
let pionexSecretKey = ref('')
let pionexImportStartDate = ref('')
let pionexTestResult = ref(null)
let pionexTestLoading = ref(false)
let pionexTestError = ref('')
let pionexSubExpanded = ref(false)
const pionexImporting = ref(false)

async function loadPionexConfig() {
    try {
        const response = await axios.get('/api/pionex/config')
        pionexApiKey.value = response.data.apiKey || ''
        pionexImportStartDate.value = response.data.apiImportStartDate || ''
        if (response.data.hasSecret) {
            pionexSecretKey.value = '••••••••'
        }
    } catch (error) {
        console.log(' -> Error loading Pionex config: ' + error)
    }
}

async function savePionexConfig() {
    try {
        const data = { apiKey: pionexApiKey.value, apiImportStartDate: pionexImportStartDate.value }
        if (pionexSecretKey.value && pionexSecretKey.value !== '••••••••') {
            data.secretKey = pionexSecretKey.value
        }
        await axios.post('/api/pionex/config', data)
        alert(t('settings.pionexSaved'))

        // Auto-Import wenn Startdatum gesetzt
        if (pionexImportStartDate.value) {
            pionexImporting.value = true
            try {
                const result = await useQuickApiImport('pionex')
                if (result.count > 0) {
                    sendNotification('importFertig', 'Pionex Import', result.message || t('messages.importCount', { count: result.count }))
                } else {
                    sendNotification('importFertig', 'Pionex Import', result.message || t('messages.noNewTrades'))
                }
            } catch (importError) {
                console.log(' -> Pionex auto-import error:', importError.message)
                sendNotification('importFertig', 'Pionex Import', t('messages.importFailed') + (importError.response?.data?.error || importError.message))
            }
            pionexImporting.value = false
        }
    } catch (error) {
        alert(t('settings.savingConfigError') + error.message)
    }
}

async function testPionexConnection() {
    pionexTestLoading.value = true
    pionexTestResult.value = null
    pionexTestError.value = ''
    try {
        const response = await axios.post('/api/pionex/test')
        if (response.data.ok) {
            pionexTestResult.value = 'success'
        } else {
            pionexTestResult.value = 'error'
            pionexTestError.value = response.data.error || t('settings.unknownError')
        }
    } catch (error) {
        pionexTestResult.value = 'error'
        pionexTestError.value = error.response?.data?.error || error.message || t('common.connectionFailed')
    }
    pionexTestLoading.value = false
}

/* TAGS MANAGEMENT */
let nextGroupId = 1
let nextTagId = 1

async function loadTags() {
    try {
        const settings = await dbGetSettings()
        const saved = settings.tags
        tagGroups.length = 0
        if (Array.isArray(saved) && saved.length > 0) {
            saved.forEach(g => tagGroups.push(g))
        }
        // Calculate next IDs from existing data
        tagGroups.forEach(g => {
            const gNum = parseInt(g.id.replace('group_', ''))
            if (gNum >= nextGroupId) nextGroupId = gNum + 1
            g.tags.forEach(t => {
                const tNum = parseInt(t.id.replace('tag_', ''))
                if (tNum >= nextTagId) nextTagId = tNum + 1
            })
        })
    } catch (error) {
        console.log(' -> Error loading tags: ' + error)
    }
}

async function saveTags() {
    try {
        await dbUpdateSettings({ tags: JSON.parse(JSON.stringify(tagGroups)) })
        console.log(' -> Tags saved')
    } catch (error) {
        alert('Fehler beim Speichern der Tags: ' + error.message)
    }
}

function addGroup() {
    const name = newGroupName.value.trim()
    if (!name) return
    tagGroups.push({
        id: 'group_' + nextGroupId++,
        name: name,
        color: newGroupColor.value,
        tags: []
    })
    newGroupName.value = ''
    newGroupColor.value = '#6c757d'
    saveTags()
}

function startEditGroup(group) {
    editingGroup.value = group.id
    editGroupName.value = group.name
    editGroupColor.value = group.color
}

function saveEditGroup(group) {
    group.name = editGroupName.value.trim() || group.name
    group.color = editGroupColor.value
    editingGroup.value = null
    saveTags()
}

function cancelEditGroup() {
    editingGroup.value = null
}

function removeGroup(groupId) {
    const idx = tagGroups.findIndex(g => g.id === groupId)
    if (idx === 0) return // Erste Gruppe (Strategie) ist nicht löschbar
    if (idx !== -1) {
        tagGroups.splice(idx, 1)
        saveTags()
    }
}

function addTag(group) {
    const name = (newTagName.value[group.id] || '').trim()
    if (!name) return
    group.tags.push({
        id: 'tag_' + nextTagId++,
        name: name
    })
    newTagName.value[group.id] = ''
    saveTags()
}

function removeTag(group, tagId) {
    const idx = group.tags.findIndex(t => t.id === tagId)
    if (idx !== -1) {
        group.tags.splice(idx, 1)
        saveTags()
    }
}

/* IMPORTS MANAGEMENT */
let importsList = reactive([])
let importsLoading = ref(true)
let deleteConfirm = ref(null) // dateUnix of item being confirmed for deletion
let expandedImport = ref(null) // dateUnix of expanded import row
let importsNotes = reactive([]) // all notes for evaluated check

async function loadImports() {
    importsLoading.value = true
    try {
        const results = await dbFind('trades', { descending: 'dateUnix', limit: 10000 })
        importsList.length = 0

        const broker = selectedBroker.value
        results.forEach(r => {
            if (broker && r.trades && Array.isArray(r.trades)) {
                // Filter trades within the day to only the selected broker
                const brokerTrades = r.trades.filter(t => t.broker === broker)
                if (brokerTrades.length === 0) return // skip days with no trades for this broker
                // Clone and replace trades array with filtered version
                const filtered = { ...r, trades: brokerTrades }
                importsList.push(filtered)
            } else {
                importsList.push(r)
            }
        })

        // Load notes to check which trades have evaluations
        const notes = await dbFind('notes', { limit: 10000 })
        importsNotes.length = 0
        notes.forEach(n => importsNotes.push(n))
    } catch (error) {
        console.log(' -> Error loading imports: ' + error)
    }
    importsLoading.value = false
}

// Importe nach Monat gruppieren
const expandedMonths = reactive(new Set())
const importsGroupedByMonth = computed(() => {
    const groups = {}
    importsList.forEach(data => {
        const d = dayjs.unix(data.dateUnix)
        const monthKey = d.format('YYYY-MM')
        if (!groups[monthKey]) {
            groups[monthKey] = { key: monthKey, label: d.format('MMMM YYYY'), days: [], tradeCount: 0, evaluatedCount: 0 }
        }
        const tc = getTradeCount(data)
        groups[monthKey].days.push(data)
        groups[monthKey].tradeCount += tc
        groups[monthKey].evaluatedCount += getEvaluatedCount(data)
    })
    return Object.values(groups).sort((a, b) => b.key.localeCompare(a.key))
})

function toggleMonth(monthKey) {
    if (expandedMonths.has(monthKey)) expandedMonths.delete(monthKey)
    else expandedMonths.add(monthKey)
}

function toggleImportExpand(dateUnix) {
    expandedImport.value = expandedImport.value === dateUnix ? null : dateUnix
}

function getTradesForDay(data) {
    if (!data.trades || !Array.isArray(data.trades)) return []
    return data.trades
}

function isTradeEvaluated(tradeId) {
    return importsNotes.some(n => n.tradeId === tradeId)
}

function getTradeCount(data) {
    return data.trades && Array.isArray(data.trades) ? data.trades.length : 0
}

function getEvaluatedCount(data) {
    if (!data.trades || !Array.isArray(data.trades)) return 0
    return data.trades.filter(t => isTradeEvaluated(t.id)).length
}

function formatTradePnl(trade) {
    const pnl = parseFloat(trade.netProceeds || trade.grossProceeds || 0)
    return (pnl >= 0 ? '+' : '') + pnl.toFixed(2)
}

function formatTradeSide(trade) {
    if (trade.strategy === 'long' || trade.side === 'B') return 'LONG'
    if (trade.strategy === 'short' || trade.side === 'SS') return 'SHORT'
    return trade.side || ''
}

async function confirmDeleteImport(dateUnix) {
    deleteConfirm.value = dateUnix
}

async function cancelDeleteImport() {
    deleteConfirm.value = null
}

async function executeDeleteImport(dateUnix) {
    try {
        const broker = selectedBroker.value || 'bitunix'
        // Find and delete trade (broker-aware)
        const existing = await dbFirst('trades', { equalTo: { dateUnix: dateUnix, broker: broker } })
        if (existing) {
            await dbDelete('trades', existing.objectId)
            console.log(' -> Deleted trade for dateUnix ' + dateUnix + ' (broker: ' + broker + ')')

            // Reset lastApiImport so deleted trades can be re-imported
            try {
                await axios.post(`/api/${broker}/last-import`, { timestamp: 0 })
                console.log(` -> Reset ${broker} lastApiImport for re-import`)
            } catch (e) {
                console.log(' -> Could not reset lastApiImport:', e.message)
            }
        }
        // Delete related excursions
        try {
            await dbDeleteWhere('excursions', { equalTo: { dateUnix: dateUnix } })
        } catch (e) {
            logWarn('settings-view', 'Excursions konnten nicht gelöscht werden', e)
        }

        // Kontostand-Cache aktualisieren nach Trade-Loeschung
        try {
            const broker = selectedBroker.value || 'bitunix'
            await refreshAccountBalance({ broker, force: true })
        } catch (e) {
            logWarn('settings-view', 'refreshAccountBalance nach Delete fehlgeschlagen', e)
        }

        deleteConfirm.value = null
        await loadImports()
    } catch (error) {
        alert('Fehler beim Löschen: ' + error.message)
    }
}

/* POPUP SETTING */
async function loadPopupSetting() {
    showTradePopups.value = currentUser.value?.showTradePopups !== 0
}

async function savePopupSetting() {
    try {
        await dbUpdateSettings({ showTradePopups: showTradePopups.value ? 1 : 0 })
        currentUser.value.showTradePopups = showTradePopups.value ? 1 : 0
        console.log(' -> Popup-Einstellung gespeichert:', showTradePopups.value)
    } catch (error) {
        console.error(' -> Fehler beim Speichern der Popup-Einstellung:', error)
    }
}

/* TRADE TYPE THRESHOLDS */
async function saveTradeTypeThresholds() {
    try {
        await dbUpdateSettings({
            scalpMaxMinutes: scalpMaxMinutes.value,
            daytradeMaxHours: daytradeMaxHours.value
        })
        currentUser.value.scalpMaxMinutes = scalpMaxMinutes.value
        currentUser.value.daytradeMaxHours = daytradeMaxHours.value
        console.log(' -> Trade-Typ-Schwellwerte gespeichert')
    } catch (error) {
        console.error(' -> Fehler beim Speichern der Trade-Typ-Schwellwerte:', error)
    }
}

/* BINANCE CHART SETTING */
async function loadBinanceSetting() {
    enableBinanceChart.value = currentUser.value?.enableBinanceChart === 1
}

async function saveBinanceSetting() {
    try {
        await dbUpdateSettings({ enableBinanceChart: enableBinanceChart.value ? 1 : 0 })
        currentUser.value.enableBinanceChart = enableBinanceChart.value ? 1 : 0
        console.log(' -> Binance-Chart-Einstellung gespeichert:', enableBinanceChart.value)
    } catch (error) {
        console.error(' -> Fehler beim Speichern der Binance-Chart-Einstellung:', error)
    }
}

/* BROWSER NOTIFICATIONS */
async function saveNotificationSetting() {
    try {
        if (browserNotifications.value) {
            const granted = await requestNotificationPermission()
            if (!granted) {
                browserNotifications.value = false
                return
            }
        }
        await dbUpdateSettings({ browserNotifications: browserNotifications.value ? 1 : 0 })
        currentUser.value.browserNotifications = browserNotifications.value ? 1 : 0
        console.log(' -> Benachrichtigungs-Einstellung gespeichert:', browserNotifications.value)
    } catch (error) {
        console.error(' -> Fehler beim Speichern der Benachrichtigungs-Einstellung:', error)
    }
}

/* ================= BENACHRICHTIGUNGEN ================= */
/*
 * Das Register kommt vom Server (`/api/benachrichtigungen/typen`) — genau wie
 * die Modell-Liste. So muss ein neuer Meldungstyp nur dort eingetragen werden
 * und taucht hier automatisch auf, statt in zwei Listen gepflegt zu werden,
 * die zuverlässig auseinanderlaufen.
 */
const meldeTypen = ref([])
const kanalWahl = ref({})

/** Reihenfolge der Gruppen in der Anzeige. */
const MELDE_GRUPPEN = ['markt', 'handel', 'system']
const typenNachGruppe = computed(() => MELDE_GRUPPEN
    .map(g => ({ id: g, typen: meldeTypen.value.filter(t => t.gruppe === g) }))
    .filter(g => g.typen.length))

/** Schwelle je Ereignis — die beiden, die eine haben, hängen an eigenen Spalten. */
const SCHWELLEN = {
    picycleVorwarnung: {
        ref: () => radarPicycleSchwelle,
        spalte: 'radarPicycleSchwelle',
        optionen: [[0, 'Nur bei der Kreuzung'], [3, 'ab 3 % Abstand'], [5, 'ab 5 % Abstand'],
        [10, 'ab 10 % Abstand'], [20, 'ab 20 % Abstand']],
    },
    fundingDivergenz: {
        ref: () => radarFundingDivergenz,
        spalte: 'radarFundingDivergenz',
        optionen: [[0, 'Aus'], [10, 'ab 10 Punkten p.a.'], [15, 'ab 15 Punkten p.a.'],
        [25, 'ab 25 Punkten p.a.'], [50, 'ab 50 Punkten p.a.']],
    },
}

/* ── Divergenz-Alarm: welche Märkte ──────────────────────────────────────
 *
 * Gespeichert wird eine Symbolliste, ausgewählt wird sie aber aus den Märkten,
 * die Binance wirklich führt: ein getipptes Symbol, das es nicht gibt, meldet
 * sich nie — und niemand käme darauf, dass ein Tippfehler der Grund ist.
 *
 * Leere Auswahl heisst „deine Märkte" und nicht „keine". Der Alarm hatte vor
 * der Auswahl genau dieses Verhalten; wer nichts anfasst, soll nichts merken.
 */
const divergenzOffen = ref(false)
const divergenzSuche = ref('')
const divergenzMaerkte = ref([])
const divergenzLaedt = ref(false)

/** Höchstens so viele Märkte — der Server nimmt ohnehin nicht mehr an. */
const DIVERGENZ_MAX = 40

const divergenzGewaehlt = computed(() => String(radarDivergenzSymbole.value || '')
    .split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean))

/** BTCUSDT → BTC. Das USDT dahinter trägt keine Information, kostet aber Platz. */
const kurzCoin = (s) => String(s).replace(/USDT$/, '')

const divergenzLabel = computed(() => divergenzGewaehlt.value.map(kurzCoin).join(', '))

/**
 * Die Liste unter dem Suchfeld. Gewählte Märkte stehen oben — sonst sucht man
 * nach dem Abwählen quer durch tausend Zeilen nach dem, was man gerade
 * angehakt hatte.
 */
const divergenzTreffer = computed(() => {
    const q = divergenzSuche.value.trim().toUpperCase()
    const gewaehlt = divergenzGewaehlt.value
    const passt = (s) => !q || s.includes(q)
    const rest = divergenzMaerkte.value.filter(s => passt(s) && !gewaehlt.includes(s))
    return [...gewaehlt.filter(passt), ...rest].slice(0, 60)
})

async function divergenzOeffnen() {
    divergenzOffen.value = !divergenzOffen.value
    if (!divergenzOffen.value || divergenzMaerkte.value.length) return
    divergenzLaedt.value = true
    try {
        const meta = await loadSymbolMeta('futures')
        divergenzMaerkte.value = meta
            .map(m => String(m.symbol || '').toUpperCase())
            .filter(s => s.endsWith('USDT'))
            .sort()
    } catch (e) {
        console.error(' -> Marktliste nicht ladbar:', e)
    } finally {
        divergenzLaedt.value = false
    }
}

async function divergenzUmschalten(symbol) {
    const gewaehlt = divergenzGewaehlt.value
    const neu = gewaehlt.includes(symbol)
        ? gewaehlt.filter(s => s !== symbol)
        : [...gewaehlt, symbol].slice(0, DIVERGENZ_MAX)
    radarDivergenzSymbole.value = neu.join(',')
    await radarSpeichern('radarDivergenzSymbole')
}

async function divergenzLeeren() {
    radarDivergenzSymbole.value = ''
    await radarSpeichern('radarDivergenzSymbole')
}

function kanalAn(id, kanal) {
    const e = kanalWahl.value[id] || {}
    // Ohne gespeicherte Wahl: Browser an, E-Mail aus — E-Mail ist immer eine
    // bewusste Entscheidung, sonst verschickt ein Update ungefragt Post.
    return e[kanal] !== undefined ? Boolean(e[kanal]) : kanal === 'browser'
}

async function setzeKanal(id, kanal, wert) {
    // Beim Einschalten des Browser-Kanals gleich die Erlaubnis holen —
    // sonst hakt man etwas an, das der Browser stumm verwirft.
    if (kanal === 'browser' && wert) await requestNotificationPermission()
    kanalWahl.value = {
        ...kanalWahl.value,
        [id]: { ...(kanalWahl.value[id] || {}), [kanal]: Boolean(wert) },
    }
    try {
        await dbUpdateSettings({ benachrichtigungen: kanalWahl.value })
        if (currentUser.value) currentUser.value.benachrichtigungen = kanalWahl.value
    } catch (e) {
        console.error(' -> Kanalwahl nicht gespeichert:', e)
    }
}

// ── E-Mail-Zugang ────────────────────────────────────────────────────────
const mail = ref({
    mailAktiv: 0, mailHost: '', mailPort: 587, mailSicherheit: 'starttls',
    mailUser: '', mailVon: '', mailAn: '', mailPasswort: '', mailPasswortSet: false,
})
const mailTestLaeuft = ref(false)
const mailMeldung = ref('')
const mailFehler = ref(false)

/**
 * Vorlagen für die verbreiteten Anbieter. Port und Verschlüsselung zu
 * verwechseln ist der häufigste Grund, warum ein SMTP-Zugang „einfach nicht
 * geht" — die Knöpfe nehmen das Raten heraus.
 */
const MAIL_VORLAGEN = [
    { name: 'Gmail', mailHost: 'smtp.gmail.com', mailPort: 465, mailSicherheit: 'tls' },
    { name: 'Outlook', mailHost: 'smtp-mail.outlook.com', mailPort: 587, mailSicherheit: 'starttls' },
    { name: 'GMX', mailHost: 'mail.gmx.net', mailPort: 587, mailSicherheit: 'starttls' },
]

function mailVorlage(v) {
    mail.value.mailHost = v.mailHost
    mail.value.mailPort = v.mailPort
    mail.value.mailSicherheit = v.mailSicherheit
}

async function ladeMailKonfig() {
    try {
        const { data } = await axios.get('/api/mail/settings')
        mail.value = { ...data, mailPasswort: data.mailPasswortSet ? '••••••••' : '' }
    } catch (e) {
        console.error(' -> Mail-Einstellungen nicht ladbar:', e)
    }
}

async function speichereMail() {
    mailMeldung.value = ''
    try {
        await axios.post('/api/mail/settings', mail.value)
        mailFehler.value = false
        mailMeldung.value = 'Gespeichert.'
        await ladeMailKonfig()
    } catch (e) {
        mailFehler.value = true
        mailMeldung.value = e.response?.data?.error || e.message
    }
}

async function testeMail() {
    mailTestLaeuft.value = true
    mailMeldung.value = ''
    try {
        // Erst speichern: sonst testet der Server eine ältere Konfiguration
        // als die, die auf dem Bildschirm steht.
        await axios.post('/api/mail/settings', mail.value)
        await axios.post('/api/mail/test')
        mailFehler.value = false
        mailMeldung.value = 'Testmail verschickt — schau ins Postfach.'
    } catch (e) {
        mailFehler.value = true
        mailMeldung.value = e.response?.data?.error || e.message
    } finally {
        mailTestLaeuft.value = false
    }
}

async function ladeBenachrichtigungen() {
    try {
        const { data } = await axios.get('/api/benachrichtigungen/typen')
        meldeTypen.value = data.typen || []
    } catch (e) {
        console.error(' -> Meldungs-Register nicht ladbar:', e)
    }
    const roh = currentUser.value?.benachrichtigungen
    kanalWahl.value = roh && typeof roh === 'object' && !Array.isArray(roh) ? { ...roh } : {}
    await ladeMailKonfig()
}

// Load imports on mount
/* KONTOSTAND (per broker) */
const balanceLoading = ref(false)
const apiBalanceValue = ref(null)

async function loadBalanceFromApi() {
    const broker = selectedBroker.value || 'bitunix'
    balanceLoading.value = true
    apiBalanceValue.value = null
    try {
        // 1. Get current balance from exchange API
        const response = await axios.get(`/api/${broker}/balance`)
        if (!response.data.ok) {
            alert('API Fehler: ' + (response.data.error || 'Unbekannter Fehler'))
            balanceLoading.value = false
            return
        }
        const apiBalance = response.data.balance
        apiBalanceValue.value = apiBalance

        // Subtract unrealized P&L of open positions — otherwise the start
        // balance would absorb it and double-count once the positions close.
        const unrealized = (Number(response.data.crossUnrealizedPNL) || 0)
            + (Number(response.data.isolationUnrealizedPNL) || 0)
            + (Number(response.data.unrealizedPL) || 0)
        const realizedEquity = apiBalance - unrealized

        // 2. Calculate all-time net P&L for this broker
        const trades = await dbFind('trades', { equalTo: { broker }, limit: 100000 })
        let totalNetPnL = 0
        for (const day of trades) {
            if (day.pAndL && typeof day.pAndL === 'object') {
                const np = Number(day.pAndL.netProceeds)
                if (Number.isFinite(np)) totalNetPnL += np
            }
        }

        // 3. Start-Einzahlung = realized equity - alle Journal-P&L
        const calculatedStart = realizedEquity - totalNetPnL
        startBalance.value = Math.round(calculatedStart * 100) / 100

        const bonus = Number(response.data.bonus) || 0
        console.log(` -> ${broker}: API=${apiBalance.toFixed(2)} (Bonus: ${bonus.toFixed(2)}), unrealized=${unrealized.toFixed(2)}, realized=${realizedEquity.toFixed(2)}, P&L=${totalNetPnL.toFixed(2)}, Start=${calculatedStart.toFixed(2)}`)
    } catch (error) {
        alert('Kontostand konnte nicht geladen werden: ' + (error.response?.data?.error || error.message))
    }
    balanceLoading.value = false
}

async function saveBalances() {
    try {
        const broker = selectedBroker.value || 'bitunix'
        const start = parseFloat(startBalance.value) || 0

        // Save start balance per broker (no offset needed — Dashboard calculates current from P&L)
        const existingBalances = currentUser.value?.balances || {}
        const balances = { ...existingBalances, [broker]: { start } }

        await dbUpdateSettings({ balances, startBalance: start })
        currentUser.value.balances = balances
        currentUser.value.startBalance = start

        apiBalanceValue.value = null

        console.log(` -> Start-Einzahlung gespeichert für ${broker}:`, start)
    } catch (error) {
        alert('Fehler beim Speichern: ' + error.message)
    }
}

/* TIMEFRAMES */
function toggleTimeframe(value) {
    if (localTimeframes.has(value)) {
        localTimeframes.delete(value)
    } else {
        localTimeframes.add(value)
    }
}

async function saveTimeframes() {
    try {
        const arr = [...localTimeframes]
        const custom = customTimeframes.map(tf => ({ value: tf.value, label: tf.label }))
        await dbUpdateSettings({ tradeTimeframes: arr, customTimeframes: custom })
        currentUser.value.tradeTimeframes = arr
        currentUser.value.customTimeframes = custom
        // Globales reactive Array aktualisieren
        selectedTradeTimeframes.splice(0)
        arr.forEach(v => selectedTradeTimeframes.push(v))
        console.log(' -> Timeframes gespeichert:', arr, 'custom:', custom)
    } catch (error) {
        alert('Fehler beim Speichern: ' + error.message)
    }
}

// Timeframe-Gruppen für die Anzeige
const timeframeGroups = computed(() => {
    const groups = [t('timeframes.minutes'), t('timeframes.hours'), t('timeframes.days')]
    if (customTimeframes.length > 0) groups.push(t('timeframes.custom'))
    return groups
})
function timeframesByGroup(group) {
    if (group === t('timeframes.custom')) return customTimeframes
    return allTradeTimeframes.value.filter(tf => tf.group === group)
}
function addCustomTimeframe() {
    const label = newCustomTf.value.trim()
    if (!label) return
    const value = 'custom_' + label.replace(/\s+/g, '_').toLowerCase()
    if (allTradeTimeframes.value.some(tf => tf.value === value) || customTimeframes.some(tf => tf.value === value)) return
    customTimeframes.push({ value, label, group: 'custom' })
    localTimeframes.add(value)
    newCustomTf.value = ''
    saveTimeframes()
}
function removeCustomTimeframe(tf) {
    const idx = customTimeframes.findIndex(c => c.value === tf.value)
    if (idx !== -1) customTimeframes.splice(idx, 1)
    localTimeframes.delete(tf.value)
    saveTimeframes()
}

onBeforeMount(async () => {
    // Settings direkt von der API laden (nicht auf currentUser verlassen,
    // da das Layout's useInitParse() evtl. noch nicht fertig ist)
    let settings = null
    try {
        settings = await dbGetSettings()
        currentUser.value = settings
        username.value = settings.username || ''
        // Load balances for current broker (with fallback to legacy fields)
        const broker = selectedBroker.value || 'bitunix'
        const balances = settings.balances || {}
        if (balances[broker]) {
            startBalance.value = balances[broker].start || 0
        } else {
            startBalance.value = settings.startBalance || 0
        }
        // "Aktueller Kontostand" stays empty — only used for initial offset calculation
        currentBalance.value = ''
        showTradePopups.value = settings.showTradePopups !== 0
        scalpMaxMinutes.value = settings.scalpMaxMinutes ?? 15
        daytradeMaxHours.value = settings.daytradeMaxHours ?? 24
        enableBinanceChart.value = settings.enableBinanceChart === 1
        selectedLanguage.value = settings.language || 'de'
        betaAusblenden.value = Number(settings.betaAusblenden ?? 0) === 1
        livetradingMobil.value = Number(settings.livetradingMobil ?? 0) === 1
        startseiteAn.value = Number(settings.startseiteAn ?? 1) === 1
        browserNotifications.value = settings.browserNotifications !== 0
        // Timeframes laden
        const saved = settings.tradeTimeframes || []
        localTimeframes.clear()
        if (Array.isArray(saved)) {
            saved.forEach(v => localTimeframes.add(v))
        }
        // Custom Timeframes laden
        customTimeframes.splice(0)
        const savedCustom = settings.customTimeframes || []
        if (Array.isArray(savedCustom)) {
            savedCustom.forEach(tf => customTimeframes.push({ value: tf.value, label: tf.label, group: 'custom' }))
        }
    } catch (error) {
        console.log(' -> Error loading settings:', error)
        username.value = currentUser.value?.username || ''
        const brokerFb = selectedBroker.value || 'bitunix'
        const balancesFb = currentUser.value?.balances || {}
        if (balancesFb[brokerFb]) {
            startBalance.value = balancesFb[brokerFb].start || 0
        } else {
            startBalance.value = currentUser.value?.startBalance || 0
        }
        currentBalance.value = ''
    }
    // KI-Settings über verschlüsselten Endpoint laden.
    // `loadModelLists()` MUSS hier mitlaufen: ohne die Listen zeigt das
    // Auswahlfeld nur das gespeicherte Modell, und die Auswahl ist praktisch
    // tot (Anbieter wechseln half nicht — die Listen wurden nur für Ollama
    // nachgeladen).
    await Promise.all([loadAiSettings(), loadAiTokenStats(), loadModelLists()])
    if (aiProvider.value === 'ollama') {
        await loadOllamaModels()
    }
    // Falls kein Modell gesetzt, Default setzen
    if (!aiModel.value) {
        const models = getModelsForProvider()
        aiModel.value = models.length > 0 ? models[0] : ''
    }

    await loadBitunixConfig()
    await loadBitgetConfig()
    await loadPionexConfig()
    await loadTags()
    await loadImports()
    await loadPopupSetting()
    await loadDbConfig()
    await loadFluxSettings()
    await loadEsp32Settings()
    await loadAuthStatus()
    esp32Filter.value = currentUser.value?.esp32Filter || 'month'
    loadRecorderSettings()
    loadRadarSettings()
    await loadRecorderStatus()
    loadAgentSettings()

    // Query-Parameter: ?section=api → API-Sektion aufklappen
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get('section') === 'api') {
        apiExpanded.value = true
        bitunixSubExpanded.value = true
        bitgetSubExpanded.value = true
    }
})

</script>

<template>
    <div class="row mt-2">
        <div class="row">
            <div class="col-12 col-md-10" style="padding-left: 2rem;">

                <!-- Bereiche: die Seite ist zu lang, um sie am Stück zu lesen -->
                <ul class="nav nav-tabs settings-nav mb-3">
                    <li v-for="b in BEREICHE" :key="b.id" class="nav-item">
                        <a class="nav-link" :class="{ active: bereich === b.id }"
                            href="#" @click.prevent="bereichWechseln(b.id)">
                            <i :class="b.icon" class="me-1"></i>{{ t('settings.area_' + b.id) }}
                        </a>
                    </li>
                </ul>
                <!--=============== Layout & Style ===============-->
                <div v-show="bereich === 'allgemein'">
                <div class="d-flex align-items-center pointerClass" @click="layoutExpanded = !layoutExpanded">
                    <i class="uil me-2" :class="layoutExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">{{ t('settings.layoutAndStyle') }}</p>
                </div>

                <div v-show="layoutExpanded" class="row align-items-center mt-2 ms-3">

                    <!-- Sprache / Language -->
                    <div class="col-12 col-md-4">
                        {{ t('settings.languageLabel') }}
                    </div>
                    <div class="col-12 col-md-8">
                        <select class="form-select" v-model="selectedLanguage" @change="changeLanguage(selectedLanguage)">
                            <option value="de">Deutsch</option>
                            <option value="en">English</option>
                        </select>
                    </div>

                    <!-- Username -->
                    <div class="col-12 col-md-4 mt-2">
                        {{ t('settings.username') }}
                    </div>
                    <div class="col-12 col-md-8">
                        <input type="text" class="form-control" v-model="username" :placeholder="t('settings.usernamePlaceholder')" />
                    </div>

                    <!-- Profile Picture -->
                    <div class="col-12 col-md-4 mt-2">
                        {{ t('settings.profilePicture') }}
                    </div>
                    <div class="col-12 col-md-8 mt-2">
                        <div class="d-flex align-items-center gap-2 mb-2">
                            <img v-if="currentUser?.avatar" :src="currentUser.avatar" class="rounded-circle" style="width: 40px; height: 40px; object-fit: cover;" />
                            <img v-else src="../assets/icon.png" class="rounded-circle" style="width: 40px; height: 40px; object-fit: cover;" />
                            <button v-if="currentUser?.avatar" type="button" class="btn btn-outline-danger btn-sm" @click="deleteAvatar">
                                <i class="uil uil-trash-alt me-1"></i>{{ t('common.remove') }}
                            </button>
                        </div>
                        <input type="file" @change="uploadProfileAvatar" />
                    </div>

                    <!-- Startseite ein-/ausschalten (Landing-Page + Modus-Tab) -->
                    <div class="col-12 mt-4">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="startseiteAnToggle"
                                v-model="startseiteAn" @change="startseiteSpeichern(startseiteAn)">
                            <label class="form-check-label" for="startseiteAnToggle">{{ t('settings.startpageOn') }}</label>
                        </div>
                        <p class="fw-lighter small mb-0">{{ t('settings.startpageOnHint') }}</p>
                    </div>

                    <!-- Beta-Funktionen ausblenden (Strategien/Research) -->
                    <div class="col-12 mt-3">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="betaAusblendenToggle"
                                v-model="betaAusblenden" @change="kiSpeichern('betaAusblenden', betaAusblenden ? 1 : 0)">
                            <label class="form-check-label" for="betaAusblendenToggle">{{ t('settings.hideBeta') }}</label>
                        </div>
                        <p class="fw-lighter small mb-0">{{ t('settings.hideBetaHint') }}</p>
                    </div>

                    <!-- Live-Trading-Fenster auf dem Handy zeigen -->
                    <div class="col-12 mt-3">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="livetradingMobilToggle"
                                v-model="livetradingMobil" @change="kiSpeichern('livetradingMobil', livetradingMobil ? 1 : 0)">
                            <label class="form-check-label" for="livetradingMobilToggle">{{ t('settings.livetradingMobile') }}</label>
                        </div>
                        <p class="fw-lighter small mb-0">{{ t('settings.livetradingMobileHint') }}</p>
                    </div>

                    <div class="col-12 mt-3 mb-3">
                        <button type="button" v-on:click="updateProfile" class="btn btn-success">{{ t('common.save') }}</button>
                    </div>
                </div>

                </div>
                <div v-show="bereich === 'journal'">
                <hr />

                <!--=============== KONTOSTAND ===============-->
                <div class="d-flex align-items-center pointerClass" @click="balanceExpanded = !balanceExpanded">
                    <i class="uil me-2" :class="balanceExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">{{ t('settings.balance') }}</p>
                </div>
                <div v-show="balanceExpanded" class="mt-2 ms-3 row align-items-center">
                    <p class="fw-lighter" v-html="t('settings.balanceDescription', { broker: (selectedBroker || 'bitunix').charAt(0).toUpperCase() + (selectedBroker || 'bitunix').slice(1) })"></p>
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">{{ t('settings.startDeposit') }}</div>
                        <div class="col-12 col-md-8">
                            <div class="input-group">
                                <input type="number" class="form-control" v-model="startBalance" :placeholder="t('settings.startDepositPlaceholder')" step="0.01" />
                                <button type="button" class="btn btn-outline-primary" @click="loadBalanceFromApi" :disabled="balanceLoading">
                                    <span v-if="balanceLoading" class="spinner-border spinner-border-sm" style="width: 0.7rem; height: 0.7rem;"></span>
                                    <span v-else><i class="uil uil-cloud-download me-1"></i>{{ t('settings.calculateFromApi') }}</span>
                                </button>
                            </div>
                            <small v-if="apiBalanceValue !== null" class="text-success">{{ t('settings.apiBalance', { value: apiBalanceValue.toFixed(2) }) }}</small>
                            <small v-else class="text-muted">{{ t('settings.manualOrApi') }}</small>
                        </div>
                    </div>
                    <div class="mt-3 mb-3">
                        <button type="button" v-on:click="saveBalances" class="btn btn-success">{{ t('common.save') }}</button>
                    </div>
                </div>

                </div>
                <div v-show="bereich === 'journal'">
                <hr />

                <!--=============== API ANBINDUNG ===============-->
                <div class="d-flex align-items-center pointerClass" @click="apiExpanded = !apiExpanded">
                    <i class="uil me-2" :class="apiExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">{{ t('settings.apiConnection') }}</p>
                </div>
                <div v-show="apiExpanded" class="mt-2 ms-3">
                    <p class="fw-lighter">{{ t('settings.apiConnectionDescription') }}</p>

                    <!-- BITUNIX -->
                    <div class="mb-3" style="border: var(--border-subtle); border-radius: var(--border-radius); overflow: hidden;">
                        <div class="d-flex align-items-center pointerClass px-3 py-2" @click="bitunixSubExpanded = !bitunixSubExpanded"
                            style="background-color: var(--black-bg-5);">
                            <i class="uil me-2" :class="bitunixSubExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                            <strong>Bitunix</strong>
                            <span v-if="bitunixApiKey" class="ms-2 badge bg-success" style="font-size: 0.65rem;">{{ t('common.configured') }}</span>
                        </div>
                        <div v-show="bitunixSubExpanded" class="row align-items-center px-3 py-3">
                            <div class="row mt-1">
                                <div class="col-12 col-md-4">API Key</div>
                                <div class="col-12 col-md-8">
                                    <input type="text" class="form-control" v-model="bitunixApiKey" :placeholder="t('settings.apiKeyPlaceholder')" />
                                </div>
                            </div>
                            <div class="row mt-2">
                                <div class="col-12 col-md-4">Secret Key</div>
                                <div class="col-12 col-md-8">
                                    <input type="password" class="form-control" v-model="bitunixSecretKey" :placeholder="t('settings.secretKeyPlaceholder')" />
                                </div>
                            </div>
                            <div class="row mt-2">
                                <div class="col-12 col-md-4">{{ t('settings.importFromDate') }}</div>
                                <div class="col-12 col-md-8">
                                    <input type="date" class="form-control" v-model="bitunixImportStartDate" />
                                    <small class="text-muted">{{ t('settings.importFromDateHint') }}</small>
                                </div>
                            </div>
                            <div class="mt-3">
                                <button type="button" v-on:click="saveBitunixConfig" class="btn btn-success me-2">{{ t('common.save') }}</button>
                                <button type="button" v-on:click="testBitunixConnection" class="btn btn-outline-primary" :disabled="bitunixTestLoading">
                                    <span v-if="bitunixTestLoading">Testing...</span>
                                    <span v-else>{{ t('common.testConnection') }}</span>
                                </button>
                                <span v-if="bitunixTestResult === 'success'" class="ms-2 text-success">{{ t('common.connected') }}</span>
                                <span v-if="bitunixTestResult === 'error'" class="ms-2 text-danger">{{ t('common.connectionFailed') }}</span>
                            </div>
                        </div>
                    </div>

                    <!-- BITGET -->
                    <div class="mb-3" style="border: var(--border-subtle); border-radius: var(--border-radius); overflow: hidden;">
                        <div class="d-flex align-items-center pointerClass px-3 py-2" @click="bitgetSubExpanded = !bitgetSubExpanded"
                            style="background-color: var(--black-bg-5);">
                            <i class="uil me-2" :class="bitgetSubExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                            <strong>Bitget</strong>
                            <span v-if="bitgetApiKey" class="ms-2 badge bg-success" style="font-size: 0.65rem;">{{ t('common.configured') }}</span>
                        </div>
                        <div v-show="bitgetSubExpanded" class="row align-items-center px-3 py-3">
                            <div class="row mt-1">
                                <div class="col-12 col-md-4">API Key</div>
                                <div class="col-12 col-md-8">
                                    <input type="text" class="form-control" v-model="bitgetApiKey" :placeholder="t('settings.apiKeyPlaceholder')" />
                                </div>
                            </div>
                            <div class="row mt-2">
                                <div class="col-12 col-md-4">Secret Key</div>
                                <div class="col-12 col-md-8">
                                    <input type="password" class="form-control" v-model="bitgetSecretKey" :placeholder="t('settings.secretKeyPlaceholder')" />
                                </div>
                            </div>
                            <div class="row mt-2">
                                <div class="col-12 col-md-4">Passphrase</div>
                                <div class="col-12 col-md-8">
                                    <input type="password" class="form-control" v-model="bitgetPassphrase" :placeholder="t('settings.passphrasePlaceholder')" />
                                    <small class="text-muted">{{ t('settings.passphraseHint') }}</small>
                                </div>
                            </div>
                            <div class="row mt-2">
                                <div class="col-12 col-md-4">{{ t('settings.importFromDate') }}</div>
                                <div class="col-12 col-md-8">
                                    <input type="date" class="form-control" v-model="bitgetImportStartDate" />
                                    <small class="text-muted">{{ t('settings.importFromDateHint') }}</small>
                                </div>
                            </div>
                            <div class="mt-3">
                                <button type="button" v-on:click="saveBitgetConfig" class="btn btn-success me-2" :disabled="bitgetImporting">
                                    <span v-if="bitgetImporting" class="spinner-border spinner-border-sm me-1" style="width: 0.7rem; height: 0.7rem;"></span>
                                    {{ bitgetImporting ? t('common.importing') : t('common.save') }}
                                </button>
                                <button type="button" v-on:click="testBitgetConnection" class="btn btn-outline-primary" :disabled="bitgetTestLoading">
                                    <span v-if="bitgetTestLoading">Testing...</span>
                                    <span v-else>{{ t('common.testConnection') }}</span>
                                </button>
                                <span v-if="bitgetTestResult === 'success'" class="ms-2 text-success"><i class="uil uil-check-circle"></i> Verbunden</span>
                                <span v-if="bitgetTestResult === 'error'" class="ms-2 text-danger"><i class="uil uil-exclamation-triangle"></i> {{ t('common.failed') }}</span>
                            </div>
                            <div v-if="bitgetTestResult === 'error' && bitgetTestError" class="mt-2">
                                <div class="p-2" style="background: rgba(255,0,0,0.1); border-radius: var(--border-radius); font-size: 0.85rem;">
                                    <strong>Fehler:</strong> {{ bitgetTestError }}
                                    <div v-if="bitgetTestError.includes('40012')" class="mt-2 text-muted" style="font-size: 0.8rem;">
                                        <strong>Mögliche Ursachen:</strong>
                                        <ul class="mb-0 mt-1">
                                            <li>API Key, Secret Key oder Passphrase sind falsch</li>
                                            <li>IP-Whitelist: Dein Server-IP ist nicht in der API-Key-Konfiguration freigegeben</li>
                                            <li>API-Key-Typ: Stelle sicher, dass "HMAC" als Verschlüsselungsmethode ausgewählt wurde</li>
                                            <li>Berechtigungen: Der API Key braucht "Futures" Leserechte</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- PIONEX -->
                    <div class="mb-3" style="border: var(--border-subtle); border-radius: var(--border-radius); overflow: hidden;">
                        <div class="d-flex align-items-center pointerClass px-3 py-2" @click="pionexSubExpanded = !pionexSubExpanded"
                            style="background-color: var(--black-bg-5);">
                            <i class="uil me-2" :class="pionexSubExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                            <strong>Pionex</strong>
                            <span v-if="pionexApiKey" class="ms-2 badge bg-success" style="font-size: 0.65rem;">{{ t('common.configured') }}</span>
                        </div>
                        <div v-show="pionexSubExpanded" class="row align-items-center px-3 py-3">
                            <div class="row mt-1">
                                <div class="col-12 col-md-4">API Key</div>
                                <div class="col-12 col-md-8">
                                    <input type="text" class="form-control" v-model="pionexApiKey" :placeholder="t('settings.apiKeyPlaceholder')" />
                                </div>
                            </div>
                            <div class="row mt-2">
                                <div class="col-12 col-md-4">Secret Key</div>
                                <div class="col-12 col-md-8">
                                    <input type="password" class="form-control" v-model="pionexSecretKey" :placeholder="t('settings.secretKeyPlaceholder')" />
                                </div>
                            </div>
                            <div class="row mt-2">
                                <div class="col-12 col-md-4">{{ t('settings.importFromDate') }}</div>
                                <div class="col-12 col-md-8">
                                    <input type="date" class="form-control" v-model="pionexImportStartDate" />
                                    <small class="text-muted">{{ t('settings.importFromDateHint') }}</small>
                                </div>
                            </div>
                            <div class="mt-3">
                                <button type="button" v-on:click="savePionexConfig" class="btn btn-success me-2" :disabled="pionexImporting">
                                    <span v-if="pionexImporting" class="spinner-border spinner-border-sm me-1" style="width: 0.7rem; height: 0.7rem;"></span>
                                    {{ pionexImporting ? t('common.importing') : t('common.save') }}
                                </button>
                                <button type="button" v-on:click="testPionexConnection" class="btn btn-outline-primary" :disabled="pionexTestLoading">
                                    <span v-if="pionexTestLoading">Testing...</span>
                                    <span v-else>{{ t('common.testConnection') }}</span>
                                </button>
                                <span v-if="pionexTestResult === 'success'" class="ms-2 text-success"><i class="uil uil-check-circle"></i> Verbunden</span>
                                <span v-if="pionexTestResult === 'error'" class="ms-2 text-danger"><i class="uil uil-exclamation-triangle"></i> {{ t('common.failed') }}</span>
                            </div>
                            <div v-if="pionexTestResult === 'error' && pionexTestError" class="mt-2">
                                <div class="p-2" style="background: rgba(255,0,0,0.1); border-radius: var(--border-radius); font-size: 0.85rem;">
                                    <strong>Fehler:</strong> {{ pionexTestError }}
                                    <div class="mt-2 text-muted" style="font-size: 0.8rem;">
                                        <strong>Mögliche Ursachen:</strong>
                                        <ul class="mb-0 mt-1">
                                            <li>API Key oder Secret Key sind falsch</li>
                                            <li>IP-Whitelist: Dein Server-IP ist nicht freigegeben (optional bei Pionex)</li>
                                            <li>Berechtigungen: Der API Key braucht "Lesen aktivieren" (Read)</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                </div>
                <div v-show="bereich === 'journal'">
                <hr />

                <!--=============== BEWERTUNG ===============-->
                <div class="d-flex align-items-center pointerClass" @click="bewertungExpanded = !bewertungExpanded">
                    <i class="uil me-2" :class="bewertungExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">{{ t('settings.evaluation') }}</p>
                </div>
                <div v-show="bewertungExpanded" class="mt-2 ms-3">

                    <!--=============== TAGS (Unterabschnitt) ===============-->
                    <div class="d-flex align-items-center pointerClass mb-1" @click="subTagsExpanded = !subTagsExpanded">
                        <i class="uil me-1" :class="subTagsExpanded ? 'uil-angle-down' : 'uil-angle-right'" style="font-size: 1.1rem;"></i>
                        <p class="fs-6 fw-bold mb-0">{{ t('settings.tagsSection') }}</p>
                    </div>
                    <div v-show="subTagsExpanded">
                    <p class="fw-lighter">{{ t('settings.tagsDescription') }}</p>

                    <!-- Existing groups -->
                    <div v-for="group in tagGroups" :key="group.id" class="mb-3 p-3" :style="{ borderLeft: '4px solid ' + group.color, background: 'var(--bg-card)' }">
                        <!-- Group header -->
                        <div class="d-flex align-items-center mb-2">
                            <template v-if="editingGroup === group.id">
                                <input type="text" class="form-control form-control-sm me-2" style="max-width: 200px;" v-model="editGroupName" @keyup.enter="saveEditGroup(group)" />
                                <input type="color" class="form-control form-control-color form-control-sm me-2" v-model="editGroupColor" />
                                <button class="btn btn-success btn-sm me-1" @click="saveEditGroup(group)"><i class="uil uil-check"></i></button>
                                <button class="btn btn-outline-secondary btn-sm" @click="cancelEditGroup"><i class="uil uil-times"></i></button>
                            </template>
                            <template v-else>
                                <span class="fw-bold me-2">{{ group.name }}</span>
                                <span class="badge me-2" :style="{ backgroundColor: group.color }">{{ group.tags.length }} Tags</span>
                                <button v-if="tagGroups.indexOf(group) !== 0" class="btn btn-outline-secondary btn-sm me-1" @click="startEditGroup(group)"><i class="uil uil-pen"></i></button>
                                <button v-if="tagGroups.indexOf(group) !== 0" class="btn btn-outline-danger btn-sm" @click="removeGroup(group.id)"><i class="uil uil-trash-alt"></i></button>
                                <span v-else class="badge bg-secondary ms-1" style="font-size: 0.65rem;"><i class="uil uil-lock-alt me-1"></i>{{ t('common.mandatory') }}</span>
                            </template>
                        </div>

                        <!-- Tags in group -->
                        <div class="d-flex flex-wrap gap-1 mb-2">
                            <span v-for="tag in group.tags" :key="tag.id" class="badge d-flex align-items-center" :style="{ backgroundColor: group.color }">
                                {{ tag.name }}
                                <i class="uil uil-times ms-1 pointerClass" @click="removeTag(group, tag.id)"></i>
                            </span>
                        </div>

                        <!-- Add tag input -->
                        <div class="d-flex">
                            <input type="text" class="form-control form-control-sm me-2" style="max-width: 200px;" :placeholder="t('settings.newTagPlaceholder')" v-model="newTagName[group.id]" @keyup.enter="addTag(group)" />
                            <button class="btn btn-outline-primary btn-sm" @click="addTag(group)">+ Tag</button>
                        </div>
                    </div>

                    <!-- Add new group -->
                    <div class="mt-3 p-3" style="border: 1px dashed var(--border-color); background: var(--bg-card);">
                        <div class="d-flex align-items-center">
                            <input type="text" class="form-control form-control-sm me-2" style="max-width: 200px;" :placeholder="t('settings.newGroupPlaceholder')" v-model="newGroupName" @keyup.enter="addGroup" />
                            <input type="color" class="form-control form-control-color form-control-sm me-2" v-model="newGroupColor" />
                            <button class="btn btn-outline-success btn-sm" @click="addGroup">+ Gruppe</button>
                        </div>
                    </div>

                    </div><!-- /subTagsExpanded -->

                    <hr />

                    <!--=============== TIMEFRAMES (Unterabschnitt) ===============-->
                    <div class="d-flex align-items-center pointerClass mb-1" @click="subTimeframesExpanded = !subTimeframesExpanded">
                        <i class="uil me-1" :class="subTimeframesExpanded ? 'uil-angle-down' : 'uil-angle-right'" style="font-size: 1.1rem;"></i>
                        <p class="fs-6 fw-bold mb-0">{{ t('settings.timeframesSection') }}</p>
                    </div>
                    <div v-show="subTimeframesExpanded">
                    <p class="fw-lighter">{{ t('settings.timeframesDescription') }}</p>
                    <div v-for="group in timeframeGroups" :key="group" class="mb-2">
                        <label class="fw-lighter text-uppercase small mb-1">{{ group }}</label>
                        <div class="d-flex flex-wrap gap-1">
                            <template v-if="group === t('timeframes.custom')">
                                <span v-for="tf in timeframesByGroup(group)" :key="tf.value"
                                    class="tag-badge d-flex align-items-center" :class="{ active: localTimeframes.has(tf.value) }"
                                    v-on:click="toggleTimeframe(tf.value)">{{ tf.label }}
                                    <i class="uil uil-times ms-1" style="font-size: 0.75rem; cursor: pointer;" @click.stop="removeCustomTimeframe(tf)"></i>
                                </span>
                            </template>
                            <template v-else>
                                <span v-for="tf in timeframesByGroup(group)" :key="tf.value"
                                    class="tag-badge" :class="{ active: localTimeframes.has(tf.value) }"
                                    v-on:click="toggleTimeframe(tf.value)">{{ tf.label }}</span>
                            </template>
                        </div>
                    </div>
                    <!-- Eigenen Timeframe hinzufügen -->
                    <div class="d-flex mt-2 mb-2">
                        <input type="text" class="form-control form-control-sm me-2" style="max-width: 200px;" :placeholder="t('timeframes.egCustom')" v-model="newCustomTf" @keyup.enter="addCustomTimeframe" />
                        <button class="btn btn-outline-primary btn-sm" @click="addCustomTimeframe">{{ t('timeframes.addCustom') }}</button>
                    </div>
                    <div class="mt-3 mb-3">
                        <button type="button" v-on:click="saveTimeframes" class="btn btn-success">{{ t('common.save') }}</button>
                    </div>

                    </div><!-- /subTimeframesExpanded -->

                    <hr />

                    <!--=============== TRADE-TYP AUTO-ERKENNUNG (Unterabschnitt) ===============-->
                    <div class="d-flex align-items-center pointerClass mb-1" @click="subTradeTypeExpanded = !subTradeTypeExpanded">
                        <i class="uil me-1" :class="subTradeTypeExpanded ? 'uil-angle-down' : 'uil-angle-right'" style="font-size: 1.1rem;"></i>
                        <p class="fs-6 fw-bold mb-0">{{ t('settings.tradeTypeAutoDetection') }}</p>
                    </div>
                    <div v-show="subTradeTypeExpanded">
                    <p class="fw-lighter">{{ t('settings.tradeTypeAutoDetectionDescription') }}</p>
                    <div class="row g-2 align-items-end">
                        <div class="col-auto">
                            <label class="form-label small mb-0">{{ t('settings.scalpMaxMinutes') }}</label>
                            <input type="number" class="form-control form-control-sm" style="max-width: 100px;"
                                v-model.number="scalpMaxMinutes" min="1" max="1440" />
                        </div>
                        <div class="col-auto">
                            <label class="form-label small mb-0">{{ t('settings.daytradeMaxHours') }}</label>
                            <input type="number" class="form-control form-control-sm" style="max-width: 100px;"
                                v-model.number="daytradeMaxHours" min="1" max="720" />
                        </div>
                        <div class="col-auto">
                            <button class="btn btn-success btn-sm" @click="saveTradeTypeThresholds">{{ t('common.save') }}</button>
                        </div>
                    </div>
                    <small class="text-muted">{{ t('settings.tradeTypeThresholdHint') }}</small>

                    </div><!-- /subTradeTypeExpanded -->

                    <hr />

                    <!--=============== POPUPS (Unterabschnitt) ===============-->
                    <div class="d-flex align-items-center pointerClass mb-1" @click="subPopupsExpanded = !subPopupsExpanded">
                        <i class="uil me-1" :class="subPopupsExpanded ? 'uil-angle-down' : 'uil-angle-right'" style="font-size: 1.1rem;"></i>
                        <p class="fs-6 fw-bold mb-0">{{ t('settings.popupsAndNotifications') }}</p>
                    </div>
                    <div v-show="subPopupsExpanded">
                    <p class="fw-lighter">{{ t('settings.popupsDescription') }}</p>
                    <div class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" id="popupToggle" v-model="showTradePopups" @change="savePopupSetting">
                        <label class="form-check-label" for="popupToggle">{{ t('settings.enablePopups') }}</label>
                    </div>
                    <!-- Der Hauptschalter für Benachrichtigungen steht jetzt im
                         eigenen Bereich „Benachrichtigungen", zusammen mit der
                         Kanalwahl je Ereignis und dem E-Mail-Versand. -->
                    </div><!-- /subPopupsExpanded -->
                </div>

                </div>
                <div v-show="bereich === 'ki'">

                <!-- Zweite Reiter-Ebene: je KI-Funktion ein Bereich. Vorher lag
                     das über drei obere Reiter verstreut. -->
                <ul class="nav nav-tabs settings-nav mb-3">
                    <li v-for="b in KI_BEREICHE" :key="b.id" class="nav-item">
                        <a class="nav-link" :class="{ active: kiBereich === b.id }"
                            href="#" @click.prevent="kiBereichWechseln(b.id)">
                            <i :class="b.icon" class="me-1"></i>{{ t('settings.ki.tab_' + b.id) }}
                        </a>
                    </li>
                </ul>

                <!--=============== ÜBERSICHT ===============-->
                <div v-show="kiBereich === 'uebersicht'">
                    <KiUebersicht v-if="kiBereich === 'uebersicht'" @gehe-zu="kiBereichWechseln" />
                </div>

                <!--=============== ALLGEMEIN: Zugang ===============-->
                <div v-show="kiBereich === 'allgemein'">
                <div class="d-flex align-items-center pointerClass" @click="kiExpanded = !kiExpanded">
                    <i class="uil me-2" :class="kiExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">{{ t('settings.kiAgent') }}</p>
                </div>
                <div v-show="kiExpanded" class="mt-2 ms-3">
                    <!-- KI aktivieren/deaktivieren -->
                    <div class="form-check form-switch mb-2">
                        <input class="form-check-input" type="checkbox" id="aiEnabledToggle"
                            :checked="currentUser?.aiEnabled !== false && currentUser?.aiEnabled !== 0"
                            @change="toggleAiEnabled($event.target.checked)">
                        <label class="form-check-label" for="aiEnabledToggle">{{ t('settings.aiEnabled') }}</label>
                    </div>
                    <small class="text-muted d-block mb-3">{{ t('settings.aiEnabledHint') }}</small>

                    <div v-show="currentUser?.aiEnabled !== false && currentUser?.aiEnabled !== 0">
                    <p class="fw-lighter">{{ t('settings.kiDescription') }}</p>

                    <!-- Anbieter -->
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">{{ t('settings.provider') }}</div>
                        <div class="col-12 col-md-8">
                            <select class="form-select" v-model="aiProvider" @change="onProviderChange">
                                <option v-for="a in anbieterListe" :key="a.id" :value="a.id">{{ anbieterName(a) }}</option>
                                <!-- Ein gespeicherter, nicht mehr angebotener Anbieter würde das
                                     Feld sonst leer erscheinen lassen. -->
                                <option v-if="aiProvider && !aktuellerAnbieter" :value="aiProvider">
                                    {{ aiProvider }} ({{ t('settings.providerRetired') }})
                                </option>
                            </select>
                        </div>
                    </div>

                    <!-- Ollama URL (nur bei Ollama) -->
                    <div v-if="aiProvider === 'ollama'" class="row mt-2">
                        <div class="col-12 col-md-4">{{ t('settings.ollamaUrl') }}</div>
                        <div class="col-12 col-md-8">
                            <input type="text" class="form-control" v-model="aiOllamaUrl" placeholder="http://localhost:11434" />
                            <small class="text-muted">{{ t('settings.ollamaUrlHint') }}</small>
                        </div>
                    </div>

                    <!-- Basis-URL: eigener Anbieter (Pflicht) und Qwen (Vorbelegung) -->
                    <div v-if="aktuellerAnbieter?.urlSpalte" class="row mt-2">
                        <div class="col-12 col-md-4">{{ t('settings.customUrl') }}</div>
                        <div class="col-12 col-md-8">
                            <input type="text" class="form-control" v-model="anbieterUrl"
                                :placeholder="aiProvider === 'qwen'
                                    ? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
                                    : 'https://api.groq.com/openai/v1'" />
                            <small class="text-muted">
                                {{ aiProvider === 'qwen' ? t('settings.qwenUrlHint') : t('settings.customUrlHint') }}
                            </small>
                        </div>
                    </div>

                    <!-- Modell -->
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">{{ t('settings.model') }}</div>
                        <div class="col-12 col-md-8">
                            <select class="form-select" v-model="aiModel">
                                <option v-for="m in getModelsForProvider()" :key="m" :value="m">{{ m }}</option>
                            </select>
                            <small v-if="aiProvider === 'ollama' && ollamaModels.length === 0" class="text-warning">
                                {{ t('settings.loadModelsHint') }}
                            </small>
                            <ModelManager :provider="aiProvider" :ollama-url="aiOllamaUrl"
                                @geaendert="modelleGeaendert" />
                        </div>
                    </div>

                    <!-- API Key (nur bei Online-Providern) -->
                    <div v-if="aiProvider !== 'ollama'" class="row mt-2">
                        <div class="col-12 col-md-4">
                            {{ t('settings.apiKeyLabel') }}
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                <i class="uil uil-lock me-1"></i>{{ t('settings.encryptedStored') }}
                                {{ t('settings.ki.keysHint') }}
                            </small>
                        </div>
                        <div class="col-12 col-md-8">
                            <!-- Alle Anbieter auf einmal statt nur der gerade gewählte.
                                 Vorher hing das Feld am Anbieter-Auswahlfeld: Wer einen
                                 zweiten Schlüssel eintragen wollte, musste dafür den
                                 Anbieter umstellen — und beim Speichern wurde der
                                 Hauptanbieter gleich mit umgestellt. Genau so ist hier
                                 schon einmal versehentlich Perplexity zum Hauptanbieter
                                 geworden. -->
                            <table class="table table-sm align-middle mb-1">
                                <tbody>
                                    <tr v-for="a in anbieterListe.filter(x => x.brauchtKey !== false && x.id !== 'ollama')"
                                        :key="a.id">
                                        <td style="width:11rem;">
                                            {{ anbieterName(a) }}
                                            <span v-if="a.id === aiProvider" class="badge bg-secondary ms-1">
                                                {{ t('settings.ki.mainProvider') }}
                                            </span>
                                        </td>
                                        <td>
                                            <div class="input-group input-group-sm">
                                                <input type="password" class="form-control" v-model="aiKeys[a.id]"
                                                    :placeholder="t('settings.apiKeyInputPlaceholder')"
                                                    @focus="e => { if ((aiKeys[a.id] || '').includes('•')) e.target.select() }" />
                                                <button v-if="aiKeys[a.id]" class="btn btn-outline-secondary" type="button"
                                                    @click="aiKeys[a.id] = ''" :title="t('settings.deleteKey')">
                                                    <i class="uil uil-times"></i>
                                                </button>
                                            </div>
                                        </td>
                                        <td class="text-end" style="width:8rem;">
                                            <a v-if="a.keyUrl" :href="'https://' + a.keyUrl" target="_blank"
                                                rel="noopener noreferrer" class="small">
                                                {{ t('settings.ki.console') }} <i class="uil uil-external-link-alt"></i>
                                            </a>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Guthaben-Status: kein Anbieter verrät sein Restguthaben über
                         den API-Key. Gezeigt wird, was der Server WEISS — scheiterte
                         ein Aufruf an fehlendem Guthaben, steht das hier, bis wieder
                         einer gelingt. Der Konsole-Link führt zum echten Kontostand. -->
                    <div class="row mt-3">
                        <div class="col-12 col-md-4">
                            {{ t('settings.ki.quotaTitle') }}
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                {{ t('settings.ki.quotaHint') }}
                            </small>
                        </div>
                        <div class="col-12 col-md-8">
                            <table v-if="guthabenListe.length" class="table table-sm align-middle mb-1">
                                <tbody>
                                    <tr v-for="g in guthabenListe.filter(x => x.keySet && x.id !== 'ollama')" :key="g.id">
                                        <td>
                                            {{ anbieterName(g) }}
                                            <span v-if="g.aktiv" class="badge bg-secondary ms-1">
                                                {{ t('settings.ki.mainProvider') }}
                                            </span>
                                        </td>
                                        <td>
                                            <span v-if="g.leer" class="text-danger" :title="g.meldung">
                                                <i class="uil uil-exclamation-triangle"></i>
                                                {{ t('settings.ki.quotaEmpty') }}
                                                <small v-if="g.seit">{{ t('settings.ki.quotaSince', { zeit: zeitpunkt(g.seit) }) }}</small>
                                            </span>
                                            <span v-else-if="g.okSeit" class="text-success">
                                                <i class="uil uil-check-circle"></i>
                                                {{ t('settings.ki.quotaOk') }}
                                                <small class="text-muted">{{ t('settings.ki.quotaLast', { zeit: zeitpunkt(g.okSeit) }) }}</small>
                                            </span>
                                            <span v-else class="text-muted">{{ t('settings.ki.quotaNone') }}</span>
                                        </td>
                                        <td class="text-end">
                                            <a v-if="g.keyUrl" :href="'https://' + g.keyUrl" target="_blank"
                                                rel="noopener noreferrer" class="small">
                                                {{ t('settings.ki.console') }} <i class="uil uil-external-link-alt"></i>
                                            </a>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                            <span v-else class="small text-muted">{{ t('settings.ki.noKeys') }}</span>
                            <button class="btn btn-outline-secondary btn-sm" @click="ladeGuthaben">
                                <i class="uil uil-sync"></i> {{ t('settings.ki.refresh') }}
                            </button>
                        </div>
                    </div>

                    <!-- Temperatur -->
                    <div class="row mt-3">
                        <div class="col-12 col-md-4">{{ t('settings.creativity') }}</div>
                        <div class="col-12 col-md-8">
                            <div class="d-flex align-items-center gap-2">
                                <input type="range" class="form-range flex-grow-1" v-model="aiTemperature"
                                    min="0" max="1" step="0.1" :disabled="modellOhneTemperatur" />
                                <span class="badge bg-secondary" style="min-width: 40px;">{{ aiTemperature }}</span>
                            </div>
                            <small v-if="modellOhneTemperatur" class="text-warning">
                                {{ t('settings.temperatureIgnored', { model: aiModel }) }}
                            </small>
                            <small v-else class="text-muted">{{ t('settings.creativityFactual') }}</small>
                        </div>
                    </div>

                    <!-- Max Tokens -->
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">{{ t('settings.maxTextLength') }}</div>
                        <div class="col-12 col-md-8">
                            <input type="number" class="form-control" v-model="aiMaxTokens" min="500" max="4000" step="100" />
                            <small class="text-muted">{{ t('settings.maxTokensHint') }}</small>
                        </div>
                    </div>

                    <!-- Buttons -->
                    <div class="mt-3 mb-3">
                        <button type="button" @click="saveAiSettings" class="btn btn-success me-2">{{ t('common.save') }}</button>
                        <button type="button" @click="testAiConnection" class="btn btn-outline-primary" :disabled="aiTestLoading">
                            <span v-if="aiTestLoading">
                                <span class="spinner-border spinner-border-sm me-1"></span>{{ t('common.testing') }}
                            </span>
                            <span v-else>{{ t('common.testConnection') }}</span>
                        </button>
                        <span v-if="aiTestResult" class="ms-2" :class="aiTestResult.success ? 'text-success' : 'text-danger'">
                            {{ aiTestResult.message }}
                        </span>
                    </div>

                    <!-- Token-Statistiken -->
                    <div v-if="aiTokenStats?.total?.totalTokens > 0" class="mt-2 mb-3">
                        <p class="fw-bold small mb-2"><i class="uil uil-processor me-1"></i>{{ t('kiAgent.aiTokenUsage') }}</p>
                        <table class="table table-sm table-borderless mb-0" style="font-size: 0.8rem; max-width: 500px;">
                            <tbody>
                                <tr>
                                    <td class="text-muted">{{ t('kiAgent.totalTokens') }}</td>
                                    <td class="text-end fw-bold">{{ (aiTokenStats?.total?.totalTokens || 0).toLocaleString() }}</td>
                                </tr>
                                <tr v-for="(data, provider) in (aiTokenStats?.byProvider || {})" :key="provider">
                                    <td class="text-muted ps-3">{{ provider.charAt(0).toUpperCase() + provider.slice(1) }}</td>
                                    <td class="text-end">{{ (data.totalTokens || 0).toLocaleString() }}</td>
                                </tr>
                                <tr class="border-top" style="border-color: var(--grey-color) !important;">
                                    <td class="text-muted" style="font-size: 0.75rem;">
                                        {{ t('kiAgent.reports') }}: {{ aiTokenStats?.counts?.reports || 0 }} ·
                                        {{ t('kiAgent.chatMessages') }}: {{ aiTokenStats?.counts?.chatMessages || 0 }} ·
                                        {{ t('kiAgent.tradeReviews') }}: {{ aiTokenStats?.counts?.tradeReviews || 0 }} ·
                                        Agent: {{ aiTokenStats?.counts?.agentSessions || 0 }} ·
                                        {{ t('settings.ki.tab_nachrichten') }}: {{ aiTokenStats?.counts?.lageberichte || 0 }} ·
                                        {{ t('settings.ki.tab_strategie') }}: {{ aiTokenStats?.counts?.strategieLaeufe || 0 }}
                                    </td>
                                    <td></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    </div><!-- /v-show aiEnabled -->
                </div>
                </div><!-- /kiBereich allgemein -->

                <!--=============== BERICHTE ===============-->
                <div v-show="kiBereich === 'berichte'">
                    <!-- Keine Überschrift: Der aktive Reiter darüber trägt
                         denselben Namen, und zweimal dasselbe Wort untereinander
                         erklärt nichts, was der Reiter nicht schon sagt. -->
                    <p class="fw-lighter">{{ t('settings.ki.berichteHint') }}</p>

                    <div class="row mt-3">
                        <div class="col-12 col-md-4">
                            {{ t('settings.ki.providerFor') }}
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                {{ t('settings.ki.providerForHint') }}
                            </small>
                        </div>
                        <div class="col-12 col-md-8">
                            <AnbieterWahl :provider="aiBerichtProvider" :modell="aiBerichtModell"
                                :modell-listen="modellListen" :global-provider="aiProvider" :global-modell="aiModel"
                                @update:provider="w => { aiBerichtProvider = w; aiBerichtModell = ''; kiSpeichern('aiBerichtProvider', w); kiSpeichern('aiBerichtModell', '') }"
                                @update:modell="w => { aiBerichtModell = w; kiSpeichern('aiBerichtModell', w) }" />
                        </div>
                    </div>

                    <!-- Bericht-Prompt -->
                    <div class="row mt-3">
                        <div class="col-12 col-md-4">{{ t('settings.reportStyle') }}</div>
                        <div class="col-12 col-md-8">
                            <select class="form-select mb-2" v-model="aiReportPromptPreset" @change="onPromptPresetChange">
                                <option v-for="p in promptPresets" :key="p.value" :value="p.value">{{ p.label }}</option>
                            </select>
                            <textarea class="form-control" v-model="aiReportPrompt" rows="3" :placeholder="t('settings.reportPromptPlaceholder')"></textarea>
                            <small class="text-muted">{{ t('settings.reportPromptHint') }}</small>
                        </div>
                    </div>

                    <!-- Chat/Rückfragen -->
                    <div class="row mt-3">
                        <div class="col-12 col-md-4">{{ t('settings.reportChat') }}</div>
                        <div class="col-12 col-md-8">
                            <div class="form-check form-switch">
                                <input class="form-check-input" type="checkbox" id="aiChatToggle" v-model="aiChatEnabled">
                                <label class="form-check-label" for="aiChatToggle">{{ t('settings.enableChat') }}</label>
                            </div>
                            <small class="text-muted">{{ t('settings.enableChatHint') }}</small>
                        </div>
                    </div>

                    <!-- Screenshots: das Feld wurde gespeichert und gelesen, hatte
                         aber seit Längerem gar kein Bedienelement mehr — der
                         Schalter war unsichtbar auf seinem letzten Stand eingefroren. -->
                    <div class="row mt-3">
                        <div class="col-12 col-md-4">
                            {{ t('settings.ki.screenshots') }}
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                {{ t('settings.ki.screenshotsHint') }}
                            </small>
                        </div>
                        <div class="col-12 col-md-8">
                            <div class="form-check form-switch">
                                <input class="form-check-input" type="checkbox" id="aiScreenshotsToggle"
                                    v-model="aiScreenshots">
                                <label class="form-check-label" for="aiScreenshotsToggle">
                                    {{ t('settings.ki.screenshotsLabel') }}
                                </label>
                            </div>
                        </div>
                    </div>

                    <div class="mt-3">
                        <button type="button" @click="saveAiSettings" class="btn btn-success">{{ t('common.save') }}</button>
                        <span v-if="aiTestResult" class="ms-2" :class="aiTestResult.success ? 'text-success' : 'text-danger'">
                            {{ aiTestResult.message }}
                        </span>
                    </div>
                </div>

                <!--=============== AGENT ===============-->
                <div v-show="kiBereich === 'agent'">
                    <p class="fs-5 fw-bold mb-1">{{ t('settings.ki.tab_agent') }}</p>
                    <p class="fw-lighter">{{ t('settings.ki.agentHint') }}</p>

                    <div class="row mt-3">
                        <div class="col-12 col-md-4">
                            {{ t('settings.ki.providerFor') }}
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                {{ t('settings.ki.agentProviderHint') }}
                            </small>
                        </div>
                        <div class="col-12 col-md-8">
                            <AnbieterWahl :provider="aiAgentProvider" :modell="aiAgentModell"
                                :modell-listen="modellListen" :global-provider="aiProvider" :global-modell="aiModel"
                                @update:provider="w => { aiAgentProvider = w; aiAgentModell = ''; kiSpeichern('aiAgentProvider', w); kiSpeichern('aiAgentModell', '') }"
                                @update:modell="w => { aiAgentModell = w; kiSpeichern('aiAgentModell', w) }" />
                            <router-link to="/ki-agent" class="btn btn-outline-secondary btn-sm mt-2">
                                <i class="uil uil-robot me-1"></i>{{ t('settings.ki.openAgent') }}
                            </router-link>
                        </div>
                    </div>

                    <div class="row mt-3">
                        <div class="col-12 col-md-4">
                            {{ t('settings.ki.agentBudget') }}
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                {{ t('settings.ki.agentBudgetHint') }}
                            </small>
                        </div>
                        <div class="col-12 col-md-8">
                            <input type="number" class="form-control" style="max-width: 180px;"
                                min="10000" step="10000" v-model.number="aiAgentTokenBudget"
                                @change="kiSpeichern('aiAgentTokenBudget', Math.max(10000, Number(aiAgentTokenBudget) || 80000))" />
                        </div>
                    </div>
                </div>

                <div v-show="kiBereich === 'bilder'">
                <hr />

                <!--=============== SHARE CARDS (FLUX.2 + Gemini) ===============-->
                <div class="d-flex align-items-center pointerClass" @click="fluxExpanded = !fluxExpanded">
                    <i class="uil me-2" :class="fluxExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">Share-Karten</p>
                </div>
                <div v-show="fluxExpanded" class="mt-2 ms-3">
                    <p class="fw-lighter">Erstelle stylische Share-Bilder für deine Trades mit KI-Bildgenerierung.</p>

                    <!-- Provider Selection -->
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">Bild-Provider</div>
                        <div class="col-12 col-md-8">
                            <div class="d-flex gap-4">
                                <div class="form-check">
                                    <input class="form-check-input" type="radio" id="provFlux" value="flux" v-model="shareCardProvider" />
                                    <label class="form-check-label" for="provFlux">FLUX.2 <small class="text-muted">(Black Forest Labs)</small></label>
                                </div>
                                <div class="form-check">
                                    <input class="form-check-input" type="radio" id="provGemini" value="gemini" v-model="shareCardProvider" />
                                    <label class="form-check-label" for="provGemini">Google Gemini <small class="text-muted">(Nano Banana)</small></label>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- FLUX-specific settings -->
                    <div v-show="shareCardProvider === 'flux'">
                        <div class="row mt-3">
                            <div class="col-12 col-md-4">{{ t('settings.fluxApiKey') }}</div>
                            <div class="col-12 col-md-8">
                                <div class="input-group">
                                    <input type="password" class="form-control" v-model="fluxApiKey" placeholder="bfl-..."
                                           @focus="e => { if (fluxApiKey.includes('•')) e.target.select() }" />
                                    <button v-if="fluxApiKey" class="btn btn-outline-secondary" type="button"
                                            @click="fluxApiKey = ''">
                                        <i class="uil uil-times"></i>
                                    </button>
                                </div>
                                <small class="text-muted">
                                    <i class="uil uil-lock me-1"></i>{{ t('settings.encryptedStored') }}
                                    — <a href="https://api.bfl.ai" target="_blank" rel="noopener" class="text-info">api.bfl.ai</a>
                                </small>
                            </div>
                        </div>
                        <div class="row mt-2">
                            <div class="col-12 col-md-4">{{ t('settings.fluxModel') }}</div>
                            <div class="col-12 col-md-8">
                                <select class="form-select" v-model="fluxModel">
                                    <option v-for="m in fluxModels" :key="m.value" :value="m.value">{{ m.label }}</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- Gemini-specific settings -->
                    <div v-show="shareCardProvider === 'gemini'">
                        <div class="row mt-3">
                            <div class="col-12 col-md-4">Gemini API-Key</div>
                            <div class="col-12 col-md-8">
                                <div class="input-group">
                                    <input type="password" class="form-control" v-model="geminiImageApiKey" placeholder="AIza..."
                                           @focus="e => { if (geminiImageApiKey.includes('•')) e.target.select() }" />
                                    <button v-if="geminiImageApiKey" class="btn btn-outline-secondary" type="button"
                                            @click="geminiImageApiKey = ''">
                                        <i class="uil uil-times"></i>
                                    </button>
                                </div>
                                <small class="text-muted">
                                    <i class="uil uil-lock me-1"></i>{{ t('settings.encryptedStored') }}
                                    — <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" class="text-info">aistudio.google.com</a>
                                </small>
                            </div>
                        </div>
                        <div class="row mt-2">
                            <div class="col-12 col-md-4">Gemini Modell</div>
                            <div class="col-12 col-md-8">
                                <select class="form-select" v-model="geminiImageModel">
                                    <option v-for="m in geminiImageModels" :key="m.value" :value="m.value">{{ m.label }}</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- Shared settings (always visible) -->
                    <hr class="my-3" />

                    <!-- Display Name -->
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">{{ t('settings.fluxDisplayName') }}</div>
                        <div class="col-12 col-md-8">
                            <input type="text" class="form-control" v-model="fluxDisplayName" :placeholder="t('settings.usernamePlaceholder')" />
                            <small class="text-muted">{{ t('settings.fluxDisplayNameHint') }}</small>
                        </div>
                    </div>

                    <!-- Avatar -->
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">{{ t('settings.fluxAvatar') }}</div>
                        <div class="col-12 col-md-8">
                            <div class="form-check">
                                <input type="checkbox" class="form-check-input" id="fluxUseCustomAvatarCheck" v-model="fluxUseCustomAvatar" />
                                <label class="form-check-label" for="fluxUseCustomAvatarCheck">{{ t('settings.fluxUseCustomAvatar') }}</label>
                            </div>
                            <div v-if="fluxUseCustomAvatar" class="mt-2">
                                <div class="d-flex align-items-center gap-2">
                                    <img v-if="fluxAvatar" :src="fluxAvatar" class="rounded-circle" style="width: 40px; height: 40px; object-fit: cover;" />
                                    <input type="file" class="form-control form-control-sm" accept="image/*" @change="onFluxAvatarUpload" />
                                    <button v-if="fluxAvatar" class="btn btn-outline-secondary btn-sm" @click="fluxAvatar = ''">
                                        <i class="uil uil-times"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Buttons -->
                    <div class="mt-3 mb-3">
                        <button type="button" @click="saveFluxSettings" class="btn btn-success me-2">{{ t('common.save') }}</button>
                        <button v-if="shareCardProvider === 'flux'" type="button" @click="testFluxConnection" class="btn btn-outline-primary" :disabled="fluxTestLoading">
                            <span v-if="fluxTestLoading">
                                <span class="spinner-border spinner-border-sm me-1"></span>{{ t('common.testing') }}
                            </span>
                            <span v-else>{{ t('common.testConnection') }}</span>
                        </button>
                        <button v-if="shareCardProvider === 'gemini'" type="button" @click="testGeminiConnection" class="btn btn-outline-primary" :disabled="geminiTestLoading">
                            <span v-if="geminiTestLoading">
                                <span class="spinner-border spinner-border-sm me-1"></span>{{ t('common.testing') }}
                            </span>
                            <span v-else>{{ t('common.testConnection') }}</span>
                        </button>
                        <span v-if="shareCardProvider === 'flux' && fluxTestResult" class="ms-2" :class="fluxTestResult.success ? 'text-success' : 'text-danger'">
                            {{ fluxTestResult.message }}
                        </span>
                        <span v-if="shareCardProvider === 'gemini' && geminiTestResult" class="ms-2" :class="geminiTestResult.success ? 'text-success' : 'text-danger'">
                            {{ geminiTestResult.message }}
                        </span>
                    </div>
                </div>

                </div><!-- /kiBereich bilder -->

                <!--=============== STRATEGIE ===============-->
                <div v-show="kiBereich === 'strategie'">

                <div class="row mb-3">
                    <div class="col-12 col-md-4">
                        {{ t('settings.ki.providerFor') }}
                        <small class="d-block text-muted" style="font-size:0.78rem;">
                            {{ t('settings.ki.strategieProviderHint') }}
                        </small>
                    </div>
                    <div class="col-12 col-md-8">
                        <AnbieterWahl :provider="aiStrategieProvider" :modell="aiStrategieModell"
                            :modell-listen="modellListen" :global-provider="aiProvider" :global-modell="aiModel"
                            @update:provider="w => { aiStrategieProvider = w; aiStrategieModell = ''; kiSpeichern('aiStrategieProvider', w); kiSpeichern('aiStrategieModell', '') }"
                            @update:modell="w => { aiStrategieModell = w; kiSpeichern('aiStrategieModell', w) }" />
                    </div>
                </div>

                <!--=============== STRATEGIE-AGENTEN ===============-->
                <div class="d-flex align-items-center pointerClass" @click="agentExpanded = !agentExpanded">
                    <i class="uil me-2" :class="agentExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">{{ t('settings.ki.strat.title') }}</p>
                    <span v-if="agentKillSwitch" class="ms-2 badge bg-danger" style="font-size: 0.65rem;">{{ t('settings.ki.strat.killActive') }}</span>
                    <span v-else-if="agentLiveEnabled" class="ms-2 badge bg-warning text-dark" style="font-size: 0.65rem;">{{ t('settings.ki.strat.liveOn') }}</span>
                </div>
                <div v-show="agentExpanded" class="mt-2 ms-3">
                    <p class="fw-lighter">
                        {{ t('settings.ki.strat.intro') }} <a href="/agent/strategies">{{ t('settings.ki.strat.link') }}</a>. {{ t('settings.ki.strat.intro2') }}
                    </p>

                    <div class="row align-items-center mt-3">
                        <div class="col-12 col-md-4">{{ t('settings.ki.strat.kill') }}</div>
                        <div class="col-12 col-md-8">
                            <div class="form-check form-switch">
                                <input class="form-check-input" type="checkbox" v-model="agentKillSwitch" />
                            </div>
                            <small class="text-muted">{{ t('settings.ki.strat.killHint') }}</small>
                        </div>
                    </div>

                    <div class="row align-items-center mt-3">
                        <div class="col-12 col-md-4">{{ t('settings.ki.strat.allowLive') }}</div>
                        <div class="col-12 col-md-8">
                            <div class="form-check form-switch">
                                <input class="form-check-input" type="checkbox" v-model="agentLiveEnabled" />
                            </div>
                            <small class="text-muted">
                                {{ t('settings.ki.strat.allowLiveHint') }}
                            </small>
                        </div>
                    </div>

                    <div v-if="agentLiveEnabled" class="alert alert-danger py-2 mt-2">
                        <i class="uil uil-exclamation-triangle me-1"></i>
                        {{ t('settings.ki.strat.liveWarn') }}
                    </div>

                    <div class="row align-items-center mt-3">
                        <div class="col-12 col-md-4">{{ t('settings.ki.strat.maxLev') }}</div>
                        <div class="col-12 col-md-8">
                            <input type="number" min="1" max="125" class="form-control" style="max-width: 10rem;"
                                v-model.number="agentMaxLeverage" />
                            <small class="text-muted">
                                {{ t('settings.ki.strat.maxLevHint') }}
                            </small>
                        </div>
                    </div>

                    <div class="row align-items-center mt-3">
                        <div class="col-12 col-md-4">{{ t('settings.ki.strat.minPaper') }}</div>
                        <div class="col-12 col-md-8">
                            <input type="number" min="0" max="1000" class="form-control" style="max-width: 10rem;"
                                v-model.number="agentMinPaperTrades" />
                            <small class="text-muted">
                                {{ t('settings.ki.strat.minPaperHint') }}
                            </small>
                        </div>
                    </div>

                    <div class="row align-items-center mt-3">
                        <div class="col-12 col-md-4">{{ t('settings.ki.strat.budget') }}</div>
                        <div class="col-12 col-md-8">
                            <input type="number" min="0" step="0.1" class="form-control" style="max-width: 10rem;"
                                v-model.number="agentLlmBudget" />
                            <small class="text-muted">
                                {{ t('settings.ki.strat.budgetHint') }}
                            </small>
                        </div>
                    </div>

                    <div class="row mt-3">
                        <div class="col-12">
                            <button class="btn btn-success" :disabled="agentSaving" @click="saveAgentSettings">
                                {{ t('common.save') }}
                            </button>
                            <span v-if="agentResult" class="ms-3"
                                :class="agentResult.success ? 'text-success' : 'text-danger'">
                                {{ agentResult.message }}
                            </span>
                        </div>
                    </div>
                </div>

                </div><!-- /kiBereich strategie -->

                <!--=============== NACHRICHTEN ===============-->
                <div v-show="kiBereich === 'nachrichten'">
                    <p class="fw-lighter">{{ t('settings.ki.nachrichtenHint') }}</p>
                    <!--=============== LAGEBERICHT ===============-->
                    <hr class="mt-4" />
                    <p class="fw-bold mb-1">{{ t('settings.ki.news.title') }}</p>
                    <p class="fw-lighter">{{ t('settings.ki.news.intro1') }}</p>
                    <p class="fw-lighter">
                        {{ t('settings.ki.news.intro2') }}
                        <code>{{ currentUser?.aiProvider || '—' }} / {{ currentUser?.aiModel || '—' }}</code>
                        {{ t('settings.ki.news.intro2b') }}
                    </p>
                    <p class="fw-lighter">{{ t('settings.ki.news.intro3') }}</p>

                    <div class="row align-items-center mt-2">
                        <div class="col-12 col-md-4">
                            {{ t('settings.ki.news.autoLabel') }}
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                {{ t('settings.ki.news.autoHint') }}
                            </small>
                        </div>
                        <div class="col-12 col-md-8 d-flex align-items-center gap-2 flex-wrap">
                            <!-- Bootstrap-Schalter wie im Rest der KI-Sektion; der
                                 eigene `.switch` bleibt dem Marktradar vorbehalten. -->
                            <div class="form-check form-switch mb-0">
                                <input class="form-check-input" type="checkbox" id="radarNewsAutoToggle"
                                    v-model="radarNewsAuto" @change="radarSpeichern('radarNewsAuto')">
                            </div>
                            <select class="form-select form-select-sm" style="max-width:8.5rem;"
                                v-model="radarNewsRhythmus" :disabled="!radarNewsAuto" @change="radarSpeichern('radarNewsRhythmus')">
                                <option value="taeglich">{{ t('settings.ki.news.daily') }}</option>
                                <option value="woechentlich">{{ t('settings.ki.news.weekly') }}</option>
                                <option value="manuell">{{ t('settings.ki.news.manual') }}</option>
                            </select>
                            <select v-if="radarNewsRhythmus === 'woechentlich'" class="form-select form-select-sm" style="max-width:8.5rem;"
                                v-model.number="radarNewsWochentag" :disabled="!radarNewsAuto" @change="radarSpeichern('radarNewsWochentag')">
                                <option v-for="(tag, i) in wochentagNamen" :key="i" :value="i + 1">{{ tag }}</option>
                            </select>
                            <!-- Bei „nur manuell" gibt es keine Stunde: Der Takt
                                 erzeugt nichts, ein Uhrzeitfeld daneben würde
                                 etwas anderes behaupten. -->
                            <select v-if="radarNewsRhythmus !== 'manuell'" class="form-select form-select-sm" style="max-width:8rem;"
                                v-model.number="radarNewsStunde" :disabled="!radarNewsAuto" @change="radarSpeichern('radarNewsStunde')">
                                <option v-for="h in 24" :key="h - 1" :value="h - 1">
                                    {{ String(h - 1).padStart(2, '0') }}:00
                                </option>
                            </select>
                            <span v-if="radarNewsRhythmus !== 'manuell'" class="small text-muted">
                                {{ currentUser?.timeZone || t('settings.ki.news.localTime') }}
                            </span>
                            <span v-else class="small text-muted">{{ t('settings.ki.news.manualHint') }}</span>
                        </div>
                    </div>

                    <!-- Zwischenmeldungen. Sie setzen auf dem Bericht des Tages auf —
                         nicht um ihn umzuschreiben, sondern um zu melden, was
                         seither dazukam. Bei „nur manuell" nicht wählbar: ohne
                         automatischen Bericht gibt es nichts, worauf sie
                         aufsetzen könnten. Von Hand geht es weiterhin über den
                         Knopf auf der Nachrichtenseite. -->
                    <div v-if="radarNewsRhythmus !== 'manuell'" class="row align-items-center mt-3">
                        <div class="col-12 col-md-4">
                            {{ t('settings.ki.news.updatesLabel') }}
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                {{ t('settings.ki.news.updatesHint') }}
                            </small>
                        </div>
                        <div class="col-12 col-md-8 d-flex align-items-center gap-2 flex-wrap">
                            <select class="form-select form-select-sm" style="max-width:9.5rem;"
                                v-model.number="radarNewsUpdates" :disabled="!radarNewsAuto"
                                @change="radarSpeichern('radarNewsUpdates')">
                                <option :value="0">{{ t('settings.ki.news.updates0') }}</option>
                                <option :value="1">{{ t('settings.ki.news.updates1') }}</option>
                                <option :value="2">{{ t('settings.ki.news.updates2') }}</option>
                            </select>
                            <select v-if="radarNewsUpdates >= 1" class="form-select form-select-sm" style="max-width:8rem;"
                                v-model.number="radarNewsUpdateStunde1" :disabled="!radarNewsAuto"
                                @change="radarSpeichern('radarNewsUpdateStunden')">
                                <option v-for="h in 24" :key="h - 1" :value="h - 1">
                                    {{ String(h - 1).padStart(2, '0') }}:00
                                </option>
                            </select>
                            <select v-if="radarNewsUpdates >= 2" class="form-select form-select-sm" style="max-width:8rem;"
                                v-model.number="radarNewsUpdateStunde2" :disabled="!radarNewsAuto"
                                @change="radarSpeichern('radarNewsUpdateStunden')">
                                <option v-for="h in 24" :key="h - 1" :value="h - 1">
                                    {{ String(h - 1).padStart(2, '0') }}:00
                                </option>
                            </select>
                            <span v-if="radarNewsUpdates" class="small text-muted">
                                {{ t('settings.ki.news.updatesCost') }}
                            </span>
                        </div>
                    </div>

                    <!-- Was in der Benachrichtigungs-Mail steht. Sie kommt nur,
                         wenn „Lagebericht fertig" unter Benachrichtigungen auf
                         Mail steht — deshalb der Verweis darauf statt eines
                         zweiten Schalters, der dasselbe noch einmal regelt. -->
                    <div class="row align-items-center mt-3">
                        <div class="col-12 col-md-4">
                            {{ t('settings.ki.news.mailLabel') }}
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                {{ t('settings.ki.news.mailHint') }}
                            </small>
                        </div>
                        <div class="col-12 col-md-8 d-flex align-items-center gap-2 flex-wrap">
                            <div class="form-check form-switch mb-0">
                                <input class="form-check-input" type="checkbox" id="radarNewsMailVollToggle"
                                    v-model="radarNewsMailVoll" @change="radarSpeichern('radarNewsMailVoll')">
                            </div>
                            <label class="mb-0" for="radarNewsMailVollToggle">
                                {{ radarNewsMailVoll ? t('settings.ki.news.mailFull') : t('settings.ki.news.mailShort') }}
                            </label>
                        </div>
                    </div>

                    <!-- Aufbewahrung. Steht bei der Mail und nicht bei den
                         Quellen: Es geht um die erzeugten Berichte, nicht um
                         die eingesammelten Beiträge — die haben ihre eigenen
                         30 Tage im Abruf. -->
                    <div class="row align-items-center mt-3">
                        <div class="col-12 col-md-4">
                            {{ t('settings.ki.news.keepLabel') }}
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                {{ t('settings.ki.news.keepHint') }}
                            </small>
                        </div>
                        <div class="col-12 col-md-8">
                            <select class="form-select form-select-sm" style="max-width:10rem;"
                                v-model="radarNewsBerichtAufbewahrung"
                                @change="radarSpeichern('radarNewsBerichtAufbewahrung')">
                                <option value="manuell">{{ t('settings.ki.news.keepManual') }}</option>
                                <option value="tag">{{ t('settings.ki.news.keepDay') }}</option>
                                <option value="woche">{{ t('settings.ki.news.keepWeek') }}</option>
                                <option value="monat">{{ t('settings.ki.news.keepMonth') }}</option>
                            </select>
                        </div>
                    </div>

                    <div class="row align-items-center mt-3">
                        <div class="col-12 col-md-4">
                            {{ t('settings.ki.news.topicsLabel') }}
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                {{ t('settings.ki.news.topicsHint') }}
                            </small>
                        </div>
                        <div class="col-12 col-md-8 d-flex align-items-center gap-3 flex-wrap">
                            <label v-for="(bez, th) in themenNamen" :key="th"
                                class="d-flex align-items-center gap-1 mb-0">
                                <input type="checkbox" :value="th" v-model="radarNewsThemen"
                                    :disabled="radarNewsThemen.length === 1 && radarNewsThemen.includes(th)"
                                    @change="radarSpeichern('radarNewsThemen')">
                                <span>{{ bez }}</span>
                            </label>
                            <!-- Nur sinnvoll, wenn das Kapitel überhaupt gewählt
                                 ist — sonst steht hier ein Regler für etwas,
                                 das gar nicht erzeugt wird. -->
                            <select v-if="radarNewsThemen.includes('chartanalyse')"
                                class="form-select form-select-sm" style="max-width:13rem;"
                                v-model="radarNewsChartFrische" :title="t('settings.ki.news.chartHint')"
                                @change="radarSpeichern('radarNewsChartFrische')">
                                <option value="tag">{{ t('settings.ki.news.chartTag') }}</option>
                                <option value="woche">{{ t('settings.ki.news.chartWoche') }}</option>
                                <option value="monat">{{ t('settings.ki.news.chartMonat') }}</option>
                            </select>
                            <select class="form-select form-select-sm" style="max-width:10rem;"
                                v-model="radarNewsLaenge" @change="radarSpeichern('radarNewsLaenge')">
                                <option value="kurz">{{ t('news.len.kurz') }} — {{ t('news.lenSub.kurz') }}</option>
                                <option value="mittel">{{ t('news.len.mittel') }} — {{ t('news.lenSub.mittel') }}</option>
                                <option value="lang">{{ t('news.len.lang') }} — {{ t('news.lenSub.lang') }}</option>
                            </select>
                        </div>
                    </div>

                    <!-- Darstellung des fertigen Berichts. Wirkt sofort, auch auf
                         bereits erzeugte Berichte — es ist reine Anzeige. -->
                    <div class="row align-items-center mt-3">
                        <div class="col-12 col-md-4">
                            {{ t('settings.ki.news.layoutLabel') }}
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                {{ t('settings.ki.news.layoutHint') }}
                            </small>
                        </div>
                        <div class="col-12 col-md-8 d-flex align-items-center gap-3 flex-wrap">
                            <label v-for="l in ['dossier', 'kombiniert', 'artikel', 'kacheln']" :key="l"
                                class="d-flex align-items-center gap-1 mb-0">
                                <input type="radio" :value="l" v-model="radarNewsLayout"
                                    @change="radarSpeichern('radarNewsLayout')">
                                <span>{{ t('news.layout.' + l) }}
                                    <small class="text-muted">— {{ t('news.layoutSub.' + l) }}</small></span>
                            </label>
                        </div>
                    </div>

                    <!-- Eigene Anweisungen an die Berichts-KI. Bewusst NUR hier
                         und nicht auf der Nachrichtenseite: Das ist nichts, was
                         man zwischen zwei Berichten umwirft, und ein Prompt-Feld
                         neben dem Erzeugen-Knopf lädt genau dazu ein. -->
                    <div class="row mt-3">
                        <div class="col-12 col-md-4">
                            {{ t('settings.ki.news.customLabel') }}
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                {{ t('settings.ki.news.customHint') }}
                            </small>
                        </div>
                        <div class="col-12 col-md-8">
                            <textarea class="form-control form-control-sm" rows="4" maxlength="2000"
                                v-model="radarNewsPromptZusatz"
                                :placeholder="t('settings.ki.news.customPlaceholder')"
                                @change="radarSpeichern('radarNewsPromptZusatz')"></textarea>
                            <small class="d-block text-muted mt-1" style="font-size:0.75rem;">
                                {{ t('settings.ki.news.customLimits', {
                                    n: radarNewsPromptZusatz.length, max: 2000,
                                }) }}
                            </small>

                            <!-- Prüfen, bevor es einen bezahlten Lauf kostet.
                                 Ob ein Satz überhaupt wirkt, sah man bisher
                                 erst am fertigen Bericht — und bei dem, was an
                                 den Grundregeln abprallt, nie. -->
                            <div class="d-flex align-items-center gap-2 mt-2 flex-wrap">
                                <button type="button" class="btn btn-sm btn-outline-secondary"
                                    :disabled="anweisungLaeuft || !radarNewsPromptZusatz.trim()"
                                    @click="anweisungPruefen">
                                    <span v-if="anweisungLaeuft" class="spinner-border spinner-border-sm me-1"></span>
                                    <i v-else class="uil uil-check-circle me-1"></i>
                                    {{ t('settings.ki.news.checkBtn') }}
                                </button>
                                <small class="text-muted" style="font-size:0.75rem;">
                                    {{ t('settings.ki.news.checkHint') }}
                                </small>
                            </div>

                            <div v-if="anweisungPruefung" class="mt-2 p-2"
                                style="border:1px solid var(--border-color,#2a2a30);border-radius:.4rem;">
                                <div v-for="(b, i) in anweisungPruefung.befunde" :key="i"
                                    class="d-flex gap-2 align-items-start mb-1">
                                    <span class="badge" :class="{
                                        'text-bg-success': b.art === 'wirkt',
                                        'text-bg-secondary': b.art === 'wirkungslos',
                                        'text-bg-warning': b.art === 'gegenregel',
                                    }" style="font-size:.68rem;">{{ t('settings.ki.news.mark.' + b.art) }}</span>
                                    <span style="font-size:.8rem;">{{ b.text }}</span>
                                </div>
                                <div v-if="anweisungPruefung.vorschlag" class="mt-2">
                                    <div class="text-muted" style="font-size:.75rem;">
                                        {{ t('settings.ki.news.suggestion') }}
                                    </div>
                                    <div style="font-size:.82rem;white-space:pre-wrap;">{{ anweisungPruefung.vorschlag }}</div>
                                    <div class="d-flex gap-2 mt-2">
                                        <button type="button" class="btn btn-sm btn-outline-primary"
                                            :disabled="anweisungPruefung.vorschlag === radarNewsPromptZusatz.trim()"
                                            @click="anweisungUebernehmen">
                                            {{ t('settings.ki.news.apply') }}
                                        </button>
                                        <button type="button" class="btn btn-sm btn-outline-secondary"
                                            @click="anweisungPruefung = null">
                                            {{ t('settings.ki.news.discard') }}
                                        </button>
                                    </div>
                                </div>
                                <small v-if="anweisungPruefung.kostenUsd" class="d-block text-muted mt-2"
                                    style="font-size:.72rem;">
                                    {{ anweisungPruefung.modell }} · {{ useKostenAnzeige(anweisungPruefung.kostenUsd) }}
                                </small>
                            </div>
                        </div>
                    </div>

                    <!-- Umfang: Meldungen je Kapitel und der Token-Deckel. Beide
                         leer/0 = die oben gewählte Länge entscheidet. -->
                    <div class="row align-items-center mt-3">
                        <div class="col-12 col-md-4">
                            {{ t('settings.ki.news.scopeLabel') }}
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                {{ t('settings.ki.news.scopeHint') }}
                            </small>
                        </div>
                        <div class="col-12 col-md-8 d-flex align-items-center gap-2 flex-wrap">
                            <span class="small">{{ t('news.points') }}</span>
                            <input type="number" min="0" max="12" step="1" class="form-control form-control-sm"
                                style="max-width:6rem;" :placeholder="t('news.auto')"
                                :value="radarNewsPunkte || ''"
                                @change="radarNewsPunkte = grenzeZahl($event.target.value, 12); radarSpeichern('radarNewsPunkte')" />
                            <span class="small ms-2">{{ t('news.budget') }}</span>
                            <input type="number" min="0" max="60000" step="500" class="form-control form-control-sm"
                                style="max-width:7rem;" :placeholder="t('news.auto')"
                                :value="radarNewsTokenBudget || ''"
                                @change="radarNewsTokenBudget = grenzeZahl($event.target.value, 60000); radarSpeichern('radarNewsTokenBudget')" />
                            <span class="small text-muted">{{ t('settings.ki.news.scopeAuto') }}</span>
                        </div>
                    </div>

                    <div class="row align-items-center mt-3">
                        <div class="col-12 col-md-4">
                            {{ t('settings.ki.news.researchLabel') }}
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                {{ t('settings.ki.news.researchHint') }}
                            </small>
                        </div>
                        <div class="col-12 col-md-8 d-flex align-items-center gap-2 flex-wrap">
                            <span class="small text-muted">{{ t('settings.ki.news.grokModel') }}</span>
                            <input class="form-control form-control-sm" style="max-width:12rem;"
                                v-model="radarNewsXModell" @change="radarSpeichern('radarNewsXModell')">
                            <span class="small text-muted">{{ t('settings.ki.news.perplexityModel') }}</span>
                            <select class="form-select form-select-sm" style="max-width:10rem;"
                                v-model="radarNewsRechercheModell"
                                @change="kiSpeichern('radarNewsRechercheModell', radarNewsRechercheModell)">
                                <option value="sonar">sonar</option>
                                <option value="sonar-pro">sonar-pro</option>
                            </select>
                        </div>
                    </div>

                    <div class="row align-items-center mt-3">
                        <div class="col-12 col-md-4">
                            {{ t('settings.ki.news.videosLabel') }}
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                {{ t('settings.ki.news.videosHint') }}
                            </small>
                        </div>
                        <div class="col-12 col-md-8 d-flex align-items-center gap-2">
                            <input type="number" class="form-control" style="max-width:6rem;" min="0" max="10"
                                v-model.number="radarNewsVideos" @change="radarSpeichern('radarNewsVideos')" />
                            <!-- Aus dem Modellkatalog des Projekts statt freies
                                 Textfeld: ein Tippfehler hier fiele erst beim
                                 ersten Videolauf auf, und der kostet Geld. -->
                            <select class="form-select" style="max-width:16rem;"
                                v-model="radarNewsModel" @change="radarSpeichern('radarNewsModel')">
                                <option value="">{{ t('settings.ki.news.geminiDefault') }}</option>
                                <!-- Ein gespeichertes Modell, das der Katalog nicht (mehr) führt,
                                     bleibt wählbar — sonst stünde das Feld leer da und der
                                     nächste Speichervorgang hätte die Einstellung gelöscht. -->
                                <option v-if="radarNewsModel && !(modellListen.gemini || []).includes(radarNewsModel)"
                                    :value="radarNewsModel">
                                    {{ radarNewsModel }} {{ t('settings.ki.news.notInCatalog') }}
                                </option>
                                <option v-for="m in (modellListen.gemini || [])" :key="m" :value="m">{{ m }}</option>
                            </select>
                        </div>
                    </div>

                    <!-- Wie ausführlich Gemini beschreibt. Der Token-Deckel dahinter
                         begrenzt nur die AUSGABE — der Preis eines Videos entsteht
                         auf der Eingabeseite (Länge × Auflösung). -->
                    <div class="row align-items-center mt-3">
                        <div class="col-12 col-md-4">
                            {{ t('settings.ki.news.videoDepthLabel') }}
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                {{ t('news.videoDepthHint') }}
                            </small>
                        </div>
                        <div class="col-12 col-md-8 d-flex align-items-center gap-2 flex-wrap">
                            <select class="form-select form-select-sm" style="max-width:18rem;"
                                v-model="radarNewsVideoTiefe" @change="radarSpeichern('radarNewsVideoTiefe')">
                                <option v-for="v in ['knapp', 'normal', 'ausfuehrlich']" :key="v" :value="v">
                                    {{ t('news.depth.' + v) }} — {{ t('news.depthSub.' + v) }}
                                </option>
                            </select>
                            <span class="small ms-2">{{ t('news.budget') }}</span>
                            <input type="number" min="0" max="4000" step="100" class="form-control form-control-sm"
                                style="max-width:6.5rem;" :placeholder="t('news.auto')"
                                :value="radarNewsVideoTokens || ''"
                                @change="radarNewsVideoTokens = grenzeZahl($event.target.value, 4000); radarSpeichern('radarNewsVideoTokens')" />
                            <span class="small text-muted">{{ t('settings.ki.news.videoTokensHint') }}</span>
                        </div>
                    </div>

                    <div class="row align-items-center mt-3">
                        <div class="col-12 col-md-4">
                            {{ t('settings.ki.news.reportModelLabel') }}
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                {{ t('settings.ki.news.reportModelHint') }}
                            </small>
                        </div>
                        <div class="col-12 col-md-8">
                            <AnbieterWahl :provider="radarNewsBerichtProvider" :modell="radarNewsBerichtModell"
                                :modell-listen="modellListen" :global-provider="aiProvider" :global-modell="aiModel"
                                @update:provider="w => { radarNewsBerichtProvider = w; radarNewsBerichtModell = ''; radarSpeichern('radarNewsBerichtProvider'); radarSpeichern('radarNewsBerichtModell') }"
                                @update:modell="w => { radarNewsBerichtModell = w; radarSpeichern('radarNewsBerichtModell') }" />
                        </div>
                    </div>

                    <div class="row align-items-center mt-3">
                        <div class="col-12 col-md-4">
                            {{ t('settings.ki.news.resolutionLabel') }}
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                {{ t('settings.ki.news.resolutionHint') }}
                            </small>
                        </div>
                        <div class="col-12 col-md-8">
                            <select class="form-select form-select-sm" style="max-width:22rem;"
                                v-model="radarNewsAufloesung" @change="radarSpeichern('radarNewsAufloesung')">
                                <option value="niedrig">{{ t('settings.ki.news.resolutionLow') }}</option>
                                <option value="standard">{{ t('settings.ki.news.resolutionStd') }}</option>
                            </select>
                        </div>
                    </div>

                    <div class="mt-3">
                        <button class="btn btn-outline-primary btn-sm" :disabled="berichtLaeuft" @click="berichtJetzt">
                            <span v-if="berichtLaeuft" class="spinner-border spinner-border-sm me-2"></span>
                            {{ t('settings.ki.news.generateNow') }}
                        </button>
                        <span class="ms-2 small text-muted">
                            {{ t('settings.ki.news.costAbout') }}
                            <strong>{{ useKostenAnzeige(kostenSchaetzung.gesamt) }}</strong>
                            <span v-if="kostenSchaetzung.videos">
                                {{ t('settings.ki.news.costSplit', {
                                    text: useKostenZahl(kostenSchaetzung.bericht),
                                    n: kostenSchaetzung.videos,
                                    proVideo: useKostenZahl(kostenSchaetzung.proVideo),
                                }) }}
                            </span>
                            <span v-else>{{ t('settings.ki.news.costNoVideos') }}</span>
                        </span>
                        <div v-if="berichtMeldung" class="small mt-2" :class="berichtFehler ? 'text-danger' : 'text-muted'">
                            {{ berichtMeldung }}
                        </div>
                    </div>
                </div><!-- /kiBereich nachrichten -->

                </div><!-- /bereich ki -->
                <div v-show="bereich === 'live'">
                <hr />

                <!--=============== LIVE-TRADING-FENSTER ===============-->
                <div class="d-flex align-items-center pointerClass" @click="livetradingExpanded = !livetradingExpanded">
                    <i class="uil me-2" :class="livetradingExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">Live-Trading-Fenster</p>
                </div>
                <div v-show="livetradingExpanded" class="mt-2 ms-3">
                    <p class="fw-lighter">Ein eigener Arbeitsplatz für die Stunden, in denen du tatsächlich handelst — Kachelraster mit eigenem Layout, unabhängig vom Marktradar. Wer nur beobachtet, schaltet die Seite hier ab; dann verschwinden auch der Startknopf auf dem Marktradar und der Menüeintrag.</p>

                    <div class="form-check form-switch mt-2">
                        <input class="form-check-input" type="checkbox" id="livetradingToggle"
                            v-model="livetradingAn" @change="radarSpeichern('livetradingAn')">
                        <label class="form-check-label" for="livetradingToggle">Live-Trading-Fenster anzeigen</label>
                    </div>
                </div>

                <hr />

                <!--=============== LIVE-ANALYSE ===============-->
                <div class="d-flex align-items-center pointerClass" @click="liveExpanded = !liveExpanded">
                    <i class="uil me-2" :class="liveExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">Live-Analyse · Heatmap / Bookmap</p>
                </div>
                <div v-show="liveExpanded" class="mt-2 ms-3">
                    <p class="fw-lighter">Standardwerte für die Live-Ansicht. Änderungen im Seitenmenü der Live-Analyse landen ebenfalls hier — beides schreibt in dieselben Einstellungen. Die Daten kommen live vom öffentlichen Binance-Marktdaten-Stream; es wird nichts aufgezeichnet, die Historie beginnt beim Öffnen der Seite.</p>

                    <div class="row align-items-center mt-2">
                        <div class="col-12 col-md-4">Markt</div>
                        <div class="col-12 col-md-8">
                            <select class="form-select" v-model="liveMarket">
                                <option value="futures">USDⓈ-M Futures (Perpetual)</option>
                                <option value="spot">Spot</option>
                            </select>
                        </div>
                    </div>

                    <div class="row align-items-center mt-2">
                        <div class="col-12 col-md-4">
                            Preisband
                            <small class="d-block text-muted" style="font-size:0.78rem;">Sichtbarer Bereich um den Mittelkurs</small>
                        </div>
                        <div class="col-12 col-md-8">
                            <select class="form-select" v-model.number="liveViewPct">
                                <option v-for="p in VIEW_PCT_OPTIONS" :key="p" :value="p">± {{ p }} %</option>
                            </select>
                        </div>
                    </div>

                    <div class="row align-items-center mt-2">
                        <div class="col-12 col-md-4">
                            Spaltentakt
                            <small class="d-block text-muted" style="font-size:0.78rem;">Zeit, die eine Pixelspalte abdeckt</small>
                        </div>
                        <div class="col-12 col-md-8">
                            <select class="form-select" v-model.number="liveFrameMs">
                                <option v-for="f in FRAME_MS_OPTIONS" :key="f" :value="f">{{ f }} ms</option>
                            </select>
                        </div>
                    </div>

                    <div class="row align-items-center mt-2">
                        <div class="col-12 col-md-4">
                            Historie im Speicher
                            <small class="d-block text-muted" style="font-size:0.78rem;">Länger = mehr Arbeitsspeicher</small>
                        </div>
                        <div class="col-12 col-md-8">
                            <select class="form-select" v-model.number="liveHistoryMin">
                                <option v-for="h in HISTORY_MIN_OPTIONS" :key="h" :value="h">{{ h }} Minuten</option>
                            </select>
                        </div>
                    </div>

                    <div class="row align-items-center mt-2">
                        <div class="col-12 col-md-4">Farbrampe</div>
                        <div class="col-12 col-md-8">
                            <select class="form-select" v-model="liveRamp">
                                <option value="viridis">Viridis (violett → grün → gelb)</option>
                                <option value="bookmap">Klassisch (blau → grün → gelb → rot)</option>
                                <option value="journal">Journal (Blauton)</option>
                            </select>
                        </div>
                    </div>

                    <div class="row align-items-center mt-2">
                        <div class="col-12 col-md-4">
                            Farbskala
                            <small class="d-block text-muted" style="font-size:0.78rem;">Fest = Bilder über Zeit und Symbole vergleichbar</small>
                        </div>
                        <div class="col-12 col-md-8">
                            <div class="input-group">
                                <select class="form-select" v-model="liveColorMode">
                                    <option value="auto">Automatisch (95. Perzentil)</option>
                                    <option value="fixed">Fester Sättigungswert</option>
                                </select>
                                <input v-if="liveColorMode === 'fixed'" class="form-control" type="number" min="0"
                                    step="0.1" v-model.number="liveColorRef" placeholder="z.B. 50" />
                            </div>
                        </div>
                    </div>

                    <div class="row align-items-center mt-2">
                        <div class="col-12 col-md-4">
                            Vorlauf beim Öffnen
                            <small class="d-block text-muted" style="font-size:0.78rem;">Nur aus eigener Aufzeichnung — Binance liefert keine vergangene Orderbuch-Tiefe</small>
                        </div>
                        <div class="col-12 col-md-8">
                            <select class="form-select" v-model.number="livePrefillMin">
                                <option :value="0">Aus (leer starten)</option>
                                <option :value="5">5 Minuten</option>
                                <option :value="15">15 Minuten</option>
                                <option :value="30">30 Minuten</option>
                                <option :value="60">60 Minuten</option>
                            </select>
                        </div>
                    </div>

                    <div class="row align-items-center mt-2">
                        <div class="col-12 col-md-4">
                            Liquiditätsschwelle
                            <small class="d-block text-muted" style="font-size:0.78rem;">Blendet schwache Liquidität aus — nur die Wände bleiben</small>
                        </div>
                        <div class="col-12 col-md-8 d-flex align-items-center gap-2">
                            <input type="range" class="form-range" min="0" max="0.9" step="0.05"
                                v-model.number="liveThreshold" />
                            <span style="min-width:3rem;">{{ Math.round(liveThreshold * 100) }} %</span>
                        </div>
                    </div>

                    <div class="row align-items-center mt-2">
                        <div class="col-12 col-md-4">
                            Punkte zusammenfassen
                            <small class="d-block text-muted" style="font-size:0.78rem;">Bündelt Handelspunkte zu Blasen und bestimmt zugleich deren Grösse. Ganz links bleibt jede Spalte einzeln — dann verschmelzen die Punkte zu einem Band.</small>
                        </div>
                        <div class="col-12 col-md-8 d-flex align-items-center gap-2">
                            <input type="range" class="form-range" min="1" max="30" step="1"
                                v-model.number="liveDotStep" />
                            <span style="min-width:4rem;">{{ liveDotStep === 1 ? 'aus' : liveDotStep + ' px' }}</span>
                        </div>
                    </div>

                    <div class="row align-items-center mt-3">
                        <div class="col-12 col-md-4">Verhalten</div>
                        <div class="col-12 col-md-8">
                            <div class="form-check">
                                <input class="form-check-input" type="checkbox" id="liveAutoFollowChk"
                                    v-model="liveAutoFollow" />
                                <label class="form-check-label" for="liveAutoFollowChk">
                                    Preisachse folgt dem Mittelkurs
                                    <small class="d-block text-muted" style="font-size:0.78rem;">Aus = feste Achse, im Chart mit Ziehen verschiebbar</small>
                                </label>
                            </div>
                            <div class="form-check mt-2">
                                <input class="form-check-input" type="checkbox" id="liveProfileChk"
                                    v-model="liveShowProfile" />
                                <label class="form-check-label" for="liveProfileChk">Volumenprofil einblenden</label>
                            </div>
                            <div class="form-check mt-2">
                                <input class="form-check-input" type="checkbox" id="liveLiqChk"
                                    v-model="liveShowLiquidations" />
                                <label class="form-check-label" for="liveLiqChk">
                                    Zwangsliquidationen einzeichnen
                                    <small class="d-block text-muted" style="font-size:0.78rem;">Nur Futures — tatsächlich ausgeführte Liquidationen als Rauten</small>
                                </label>
                            </div>
                            <div class="form-check mt-2">
                                <input class="form-check-input" type="checkbox" id="livePauseBgChk"
                                    v-model="livePauseInBackground" />
                                <label class="form-check-label" for="livePauseBgChk">
                                    Im Hintergrund pausieren
                                    <small class="d-block text-muted" style="font-size:0.78rem;">Empfohlen: der Browser drosselt versteckte Tabs, sonst verzerrt sich die Zeitachse</small>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                </div>
                <div v-show="bereich === 'live'">
                <hr />

                <!--=============== MARKTRADAR ===============-->
                <div class="d-flex align-items-center pointerClass" @click="radarExpanded = !radarExpanded">
                    <i class="uil me-2" :class="radarExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">Marktradar · Kacheln</p>
                </div>
                <div v-show="radarExpanded" class="mt-2 ms-3">
                    <p class="fw-lighter">Betrifft die Kacheln auf der Seite „Marktradar". Was sichtbar ist, wie gross und in welcher Reihenfolge, stellst du direkt dort ein — das bleibt je Gerät gespeichert.</p>

                    <div class="row align-items-center mt-2">
                        <div class="col-12 col-md-4">
                            RSI-Symbole
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                Leer lassen: die Kachel nimmt die umsatzstärksten Märkte oder deine eigenen Trades.
                                Eine Liste hier (z.B. <code>BTCUSDT, ETHUSDT</code>) sticht beides.
                            </small>
                        </div>
                        <div class="col-12 col-md-8">
                            <input type="text" class="form-control" v-model="radarRsiSymbols"
                                placeholder="BTCUSDT, ETHUSDT, SOLUSDT" @change="radarSpeichern('radarRsiSymbols')" />
                        </div>
                    </div>

                    <!-- Pi-Cycle- und Funding-Divergenz-Alarm stehen jetzt unter
                         Einstellungen → Benachrichtigungen, zusammen mit allen
                         übrigen Meldungen und der Wahl zwischen Browser und E-Mail. -->

                    <div class="row align-items-center mt-3">
                        <div class="col-12 col-md-4">
                            Kalender · Länder
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                Währungskürzel des Wirtschaftskalenders, z.B. <code>USD, JPY, EUR</code>.
                            </small>
                        </div>
                        <div class="col-12 col-md-8">
                            <input type="text" class="form-control" v-model="radarKalenderLaender"
                                placeholder="USD, JPY" @change="radarSpeichern('radarKalenderLaender')" />
                        </div>
                    </div>

                    <div class="row align-items-center mt-3">
                        <div class="col-12 col-md-4">
                            Kalender · ab welcher Wirkung
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                „Mittel" schliesst hohe Wirkung mit ein — es ist eine Untergrenze.
                            </small>
                        </div>
                        <div class="col-12 col-md-8">
                            <select class="form-select" v-model="radarKalenderImpact" @change="radarSpeichern('radarKalenderImpact')">
                                <option value="all">Alle Termine</option>
                                <option value="medium">Mittel und hoch</option>
                                <option value="high">Nur hohe Wirkung</option>
                            </select>
                        </div>
                    </div>

                    <div class="mt-3">
                        <button class="btn btn-outline-primary btn-sm" :disabled="radarHolt" @click="kalenderHolen">
                            <span v-if="radarHolt" class="spinner-border spinner-border-sm me-2"></span>
                            Kalender jetzt holen
                        </button>
                        <span v-if="radarMeldung" class="ms-2 small text-muted">{{ radarMeldung }}</span>
                    </div>

                    <!--=============== NACHRICHTENQUELLEN ===============-->
                    <hr class="mt-4" />
                    <p class="fw-bold mb-1">Nachrichtenquellen</p>
                    <p class="fw-lighter">
                        YouTube-Kanäle, RSS-Adressen, Telegram-Kanäle und X-Accounts für die Nachrichten-Seite.
                        Was du als <strong>Ausschluss</strong> markierst, blendet „Temporär ausschliessen" aus —
                        und holt es gar nicht erst ab. Es werden nur Titel, Verweis und Zeitpunkt gespeichert,
                        keine Volltexte.
                    </p>
                    <p class="fw-lighter" style="font-size:0.82rem;">
                        <strong>Zu X:</strong> läuft über die bezahlte Grok-Suche (xAI) — als Adresse genügt der
                        Handle, z.B. <code>@saylor</code>. Alle X-Quellen zusammen kosten EINE Suche je Abruflauf
                        (rund 0,5 Rappen plus Token), gedrosselt auf höchstens eine Suche alle vier Stunden.
                        Voraussetzung ist ein xAI-Schlüssel unter „KI-Einstellungen". Gratis-Umwege (Nitter-Spiegel)
                        sind tot — geprüft am 16.08.2026.
                    </p>

                    <div class="row align-items-center mb-2">
                        <div class="col-12 col-md-3">
                            <label class="fw-lighter">Temporär ausschliessen</label>
                        </div>
                        <div class="col-12 col-md-9">
                            <label class="switch">
                                <input type="checkbox" v-model="radarArschlochfilter" @change="radarSpeichern('radarArschlochfilter')">
                                <span class="slider round"></span>
                            </label>
                            <span class="ms-2 small text-muted">
                                {{ radarArschlochfilter ? 'An — als Ausschluss markierte Quellen bleiben aussen vor' : 'Aus — alle aktiven Quellen werden geholt' }}
                            </span>
                        </div>
                    </div>

                    <!-- Der NEUE Arschlochfilter: automatisch Truth Social, dazu
                         Stichwörter. Wirkt auf Liste UND Berichtsgrundlage —
                         gespeichert bleibt alles, eine geänderte Liste greift
                         also auch rückwirkend. -->
                    <div class="row mb-2">
                        <div class="col-12 col-md-3">
                            <label class="fw-lighter">Arschlochfilter</label>
                            <small class="d-block text-muted" style="font-size:0.78rem;">
                                Filtert Truth Social automatisch. Beiträge, die eines der Stichwörter
                                enthalten (ein Begriff je Zeile), verschwinden aus Liste und Lagebericht.
                            </small>
                        </div>
                        <div class="col-12 col-md-9">
                            <label class="switch">
                                <input type="checkbox" v-model="radarArschlochAn" @change="radarSpeichern('radarArschlochAn')">
                                <span class="slider round"></span>
                            </label>
                            <textarea class="form-control form-control-sm mt-2" rows="3" style="max-width:26rem;"
                                v-model="radarArschlochWoerter" :disabled="!radarArschlochAn"
                                placeholder="Donald Trump&#10;Michael Saylor"
                                @change="radarSpeichern('radarArschlochWoerter')"></textarea>
                        </div>
                    </div>

                    <table class="table table-sm align-middle" v-if="newsQuellen.length">
                        <thead>
                            <tr>
                                <th style="width:6rem;">Art</th>
                                <th>Name</th>
                                <th>Adresse</th>
                                <th style="width:5rem;" class="text-center">Aktiv</th>
                                <th style="width:6rem;" class="text-center"
                                    title="Temporär ausschliessen: Quelle wird weder geholt noch angezeigt, solange der Schalter oben an ist.">
                                    Ausschluss</th>
                                <th style="width:5rem;" class="text-center" title="Nur YouTube: sollen die Videos dieser Quelle an Gemini gehen? Jedes kostet 3–10 Rappen.">Videos</th>
                                <th style="width:7rem;"></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="q in newsQuellen" :key="q.id">
                                <td class="text-muted">{{ q.art }}</td>
                                <td>{{ q.name || '—' }}</td>
                                <td class="text-truncate" style="max-width:22rem;">
                                    <span :title="q.url">{{ q.url }}</span>
                                    <div v-if="q.letzterFehler" class="small" style="color:rgb(250,190,60);">
                                        {{ q.letzterFehler }}
                                    </div>
                                </td>
                                <td class="text-center">
                                    <input type="checkbox" :checked="!!q.enabled"
                                        @change="quelleAendern(q, { enabled: $event.target.checked ? 1 : 0 })">
                                </td>
                                <td class="text-center">
                                    <input type="checkbox" :checked="!!q.laerm"
                                        @change="quelleAendern(q, { laerm: $event.target.checked ? 1 : 0 })">
                                </td>
                                <td class="text-center">
                                    <!-- Nur bei YouTube sinnvoll: alles andere hat keine Videos -->
                                    <input v-if="q.art === 'youtube'" type="checkbox"
                                        :checked="Number(q.videoAnalyse ?? 1) === 1"
                                        @change="quelleAendern(q, { videoAnalyse: $event.target.checked ? 1 : 0 })">
                                    <span v-else class="text-muted">—</span>
                                </td>
                                <td class="text-end">
                                    <button class="btn btn-outline-danger btn-sm" @click="quelleLoeschen(q)">
                                        <i class="uil uil-trash"></i>
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>

                    <div class="row g-2 align-items-center">
                        <div class="col-6 col-md-2">
                            <select class="form-select form-select-sm" v-model="neueQuelle.art">
                                <option value="youtube">YouTube</option>
                                <option value="rss">RSS</option>
                                <option value="telegram">Telegram</option>
                                <option value="truth">Truth Social</option>
                                <option value="x">X (via Grok)</option>
                            </select>
                        </div>
                        <div class="col-6 col-md-3">
                            <input class="form-control form-control-sm" v-model="neueQuelle.name" placeholder="Name">
                        </div>
                        <div class="col-12 col-md-5">
                            <input class="form-control form-control-sm" v-model="neueQuelle.url"
                                :placeholder="neueQuelle.art === 'x' ? '@handle'
                                    : neueQuelle.art === 'telegram' ? 'https://t.me/s/kanalname'
                                        : 'https://www.youtube.com/feeds/videos.xml?channel_id=…'">
                        </div>
                        <div class="col-12 col-md-2 d-flex gap-1">
                            <button class="btn btn-outline-secondary btn-sm" :disabled="newsTestet"
                                @click="quelleTesten">Test</button>
                            <button class="btn btn-outline-primary btn-sm" @click="quelleAnlegen">Hinzufügen</button>
                        </div>
                    </div>
                    <div v-if="newsMeldung" class="small mt-2" :class="newsFehler ? 'text-danger' : 'text-muted'">
                        {{ newsMeldung }}
                    </div>

                    <p class="fw-lighter mt-3" style="font-size:0.82rem;">
                        <i class="uil uil-brain me-1"></i>
                        Rhythmus, Themen, Länge und die Modellwahl des Lageberichts stehen jetzt unter
                        <a href="#" @click.prevent="bereichWechseln('ki'); kiBereichWechseln('nachrichten')">
                            KI · Nachrichten</a>.
                    </p>

                    <div v-if="newsVorschlaege.length" class="mt-2 small">
                        <span class="text-muted me-2">Vorschläge:</span>
                        <button v-for="v in newsVorschlaege" :key="v.url"
                            class="btn btn-outline-secondary btn-sm me-1 mb-1" @click="vorschlagUebernehmen(v)">
                            {{ v.name }}<span v-if="v.laerm" class="ms-1 text-muted">(Lärm)</span>
                        </button>
                    </div>

                </div>

                <hr />

                <!--=============== LIVE-RECORDER ===============-->
                <div class="d-flex align-items-center pointerClass" @click="recExpanded = !recExpanded">
                    <i class="uil me-2" :class="recExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">Live-Aufzeichnung · Orderbuch mitschneiden</p>
                    <span v-if="recStatus?.laufend?.length" class="badge bg-success ms-2">
                        {{ recStatus.laufend.length }} aktiv
                    </span>
                </div>
                <div v-show="recExpanded" class="mt-2 ms-3">
                    <p class="fw-lighter">Der Server schneidet das Orderbuch der gewählten Symbole dauerhaft mit, damit du die Heatmap später zu einem abgeschlossenen Trade nochmal ansehen kannst. Läuft unabhängig vom Browser.</p>

                    <div class="mb-3 p-2" style="background: var(--black-bg-3, #1a1a2e); border-radius: var(--border-radius, 6px); font-size: 0.85rem;">
                        <div class="fw-semibold mb-1" style="color: var(--white-75);">Bevor du es einschaltest</div>
                        <ul class="mb-0 ps-3">
                            <li><b>Rückwirkend geht nichts.</b> Nur Symbole auf dieser Liste werden aufgezeichnet — für einen Trade in einem anderen Symbol gibt es keine Historie.</li>
                            <li>Ein Container-Neustart (z.B. beim Update) reisst ein Loch in die Aufzeichnung.</li>
                            <li>Platzbedarf: rund <b>7 MB pro Symbol und Tag</b> in der Datenbank.</li>
                            <li>Aufgezeichnet wird immer <b>USDⓈ-M Futures</b>, unabhängig davon, welchen Markt du oben zum Anschauen gewählt hast.</li>
                        </ul>
                    </div>

                    <div class="form-check mb-2">
                        <input class="form-check-input" type="checkbox" id="recEnabledChk" v-model="recEnabled" />
                        <label class="form-check-label" for="recEnabledChk">Aufzeichnung aktiv</label>
                    </div>

                    <div class="row align-items-center mt-2">
                        <div class="col-12 col-md-4">
                            Symbole
                            <small class="d-block text-muted" style="font-size:0.78rem;">Kommagetrennt, max. 10</small>
                        </div>
                        <div class="col-12 col-md-8">
                            <input class="form-control" type="text" v-model="recSymbols" placeholder="BTCUSDT,SOLUSDT" />
                        </div>
                    </div>

                    <div class="row align-items-center mt-2">
                        <div class="col-12 col-md-4">Aufbewahrung</div>
                        <div class="col-12 col-md-8">
                            <select class="form-select" v-model.number="recDays">
                                <option :value="3">3 Tage</option>
                                <option :value="7">7 Tage</option>
                                <option :value="14">14 Tage</option>
                                <option :value="30">30 Tage</option>
                                <option :value="90">90 Tage</option>
                            </select>
                        </div>
                    </div>

                    <div class="row align-items-center mt-2">
                        <div class="col-12 col-md-4">
                            Auflösung
                            <small class="d-block text-muted" style="font-size:0.78rem;">Feiner = mehr Speicher</small>
                        </div>
                        <div class="col-12 col-md-8">
                            <div class="input-group">
                                <select class="form-select" v-model.number="recFrameMs">
                                    <option :value="500">500 ms / Spalte</option>
                                    <option :value="1000">1 s / Spalte</option>
                                    <option :value="2000">2 s / Spalte</option>
                                </select>
                                <select class="form-select" v-model.number="recRows">
                                    <option :value="120">120 Zeilen</option>
                                    <option :value="200">200 Zeilen</option>
                                    <option :value="400">400 Zeilen</option>
                                </select>
                                <select class="form-select" v-model.number="recRangePct">
                                    <option :value="0.5">± 0.5 %</option>
                                    <option :value="1">± 1 %</option>
                                    <option :value="2">± 2 %</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <hr class="my-3" style="border-color: var(--black-bg-3, #1a1a2e);" />

                    <p class="fw-bold mb-1">Zwangsliquidationen sammeln</p>
                    <p class="fw-lighter mb-2" style="font-size: 0.88rem;">
                        Schneidet über <b>eine einzige Verbindung</b> die Zwangsliquidationen der
                        <b>Top-Symbole</b> mit (BTC, ETH, SOL, XRP, BNB) — unabhängig von der
                        Symbolliste oben und unabhängig davon, ob die Orderbuch-Aufzeichnung läuft.
                        Binance gibt Liquidationen nicht rückwirkend heraus: was nicht mitgeschrieben
                        wird, ist endgültig weg. Sie dienen als Vergleichsmaterial, um berechnete
                        Liquidationszonen gegen die Wirklichkeit prüfen zu können.
                    </p>
                    <p class="fw-lighter mb-2" style="font-size: 0.88rem;">
                        Der Speicherbedarf ist winzig (wenige Byte je Ereignis). Weil die Daten so
                        klein und nicht nachbestellbar sind, werden sie <b>ein Jahr</b> aufbewahrt
                        statt nur den oben eingestellten Zeitraum.
                    </p>

                    <div class="form-check mb-2">
                        <input class="form-check-input" type="checkbox" id="recAllLiqChk" v-model="recAllLiq" />
                        <label class="form-check-label" for="recAllLiqChk">Liquidationen der Top-Symbole mitschneiden</label>
                    </div>

                    <div v-if="recStatus?.sammelstrom" class="mb-2 p-2"
                         style="background: var(--black-bg-3, #1a1a2e); border-radius: var(--border-radius, 6px); font-size: 0.85rem;">
                        <span :class="recStatus.sammelstrom.verbunden ? 'text-success' : 'text-danger'">
                            {{ recStatus.sammelstrom.verbunden ? 'verbunden' : 'getrennt' }}
                        </span>
                        · {{ recStatus.sammelstrom.ereignisse }} Ereignisse seit Serverstart
                        <span v-if="recStatus.sammelstrom.letztes" class="text-muted">
                            · zuletzt {{ new Date(recStatus.sammelstrom.letztes).toLocaleTimeString() }}
                        </span>
                    </div>

                    <div class="mt-3 d-flex gap-2 align-items-center">
                        <button class="btn btn-primary" @click="saveRecorderSettings" :disabled="recSaving">
                            <span v-if="recSaving" class="spinner-border spinner-border-sm me-1"></span>
                            Speichern &amp; übernehmen
                        </button>
                        <button class="btn btn-outline-secondary" @click="loadRecorderStatus">Status aktualisieren</button>
                        <span v-if="recResult" :class="recResult.success ? 'text-success' : 'text-danger'">
                            {{ recResult.message }}
                        </span>
                    </div>

                    <div v-if="recStatus" class="mt-3">
                        <table class="table table-dark table-sm" style="font-size:0.82rem;">
                            <thead>
                                <tr><th>Symbol</th><th>Verbindung</th><th>Aufgezeichnet</th><th>Speicher</th></tr>
                            </thead>
                            <tbody>
                                <tr v-for="r in recStatus.gespeichert" :key="r.symbol + r.market">
                                    <td>{{ r.symbol }}</td>
                                    <td>
                                        <span v-if="recStatus.laufend.some(l => l.symbol === r.symbol)" class="text-success">läuft</span>
                                        <span v-else class="text-muted">gestoppt</span>
                                    </td>
                                    <td>{{ r.stunden }} Stunde(n)</td>
                                    <td>{{ fmtBytes(r.bytes) }}</td>
                                </tr>
                                <tr v-for="l in recStatus.laufend.filter(l => !recStatus.gespeichert.some(g => g.symbol === l.symbol))" :key="'l' + l.symbol">
                                    <td>{{ l.symbol }}</td>
                                    <td><span :class="l.synchron ? 'text-success' : 'text-warning'">{{ l.synchron ? 'läuft' : 'synchronisiert…' }}</span></td>
                                    <td>läuft an</td>
                                    <td>—</td>
                                </tr>
                                <tr v-if="!recStatus.gespeichert.length && !recStatus.laufend.length">
                                    <td colspan="4" class="text-muted">Noch nichts aufgezeichnet</td>
                                </tr>
                            </tbody>
                        </table>
                        <div v-if="recBytesGesamt" class="text-muted" style="font-size:0.8rem;">
                            Gesamt in der Datenbank: {{ fmtBytes(recBytesGesamt) }}
                        </div>
                    </div>
                </div>

                </div>
                <div v-show="bereich === 'journal'">
                <hr />

                <!--=============== ESP32 DISPLAY ===============-->
                <div class="d-flex align-items-center pointerClass" @click="esp32Expanded = !esp32Expanded">
                    <i class="uil me-2" :class="esp32Expanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">Externe Anzeigen · ESP32 / Widget / Desklet</p>
                    <span v-if="esp32KeySet" class="badge bg-success ms-2">aktiv</span>
                </div>
                <div v-show="esp32Expanded" class="mt-2 ms-3">
                    <p class="fw-lighter">Zeige deine Trading-Daten auf externen Anzeigen: ESP32-TFT-Displays, dem Android-Homescreen-Widget und dem Linux-Desklet. Alle nutzen denselben read-only Endpoint mit dem API-Key unten — sie funktionieren auch bei aktivem Passwortschutz.</p>

                    <!-- Hardware-Übersicht -->
                    <div class="mb-3 p-2" style="background: var(--black-bg-3, #1a1a2e); border-radius: var(--border-radius, 6px); font-size: 0.85rem;">
                        <div class="fw-semibold mb-2" style="color: var(--white-75);">ESP32-Boards (Firmware im Repo)</div>
                        <table class="table table-dark table-sm mb-0" style="font-size:0.8rem;">
                            <thead>
                                <tr>
                                    <th>Board</th>
                                    <th>Display</th>
                                    <th>Touch</th>
                                    <th>MCU</th>
                                    <th>Firmware-Ordner</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td><strong>ESP32-2432S028</strong><br><small class="text-muted">Cheap Yellow Display</small></td>
                                    <td>ILI9341 2.8"</td>
                                    <td>Resistiv (XPT2046)</td>
                                    <td>ESP32</td>
                                    <td><code>ESP32-2432S028/</code></td>
                                </tr>
                                <tr>
                                    <td><strong>Waveshare ESP32-S3</strong><br><small class="text-muted">Touch-LCD-2.8</small></td>
                                    <td>ST7789T3 2.8"</td>
                                    <td>Kapazitiv (CST328)</td>
                                    <td>ESP32-S3</td>
                                    <td><code>ESP32-Waveshare/</code></td>
                                </tr>
                            </tbody>
                        </table>
                        <div class="mt-2" style="color: var(--white-50);">
                            Flash-Anleitung: <code>cd &lt;firmware-ordner&gt;</code> → <code>pio run -e esp32dev --target upload</code>
                        </div>
                        <div class="mt-2 pt-2" style="color: var(--white-75); border-top: 1px solid var(--black-bg-1, #2a2a3e);">
                            Weitere Clients (gleicher Key):
                            <span class="d-block mt-1" style="color: var(--white-50);">
                                · <strong>Android-Widget</strong> — Homescreen-Widget (<code>android-widget/</code>)<br>
                                · <strong>Linux-Desklet</strong> — Cinnamon-Desklet (<code>desklet/</code>)
                            </span>
                        </div>
                    </div>

                    <!-- API-Info -->
                    <div class="mb-3 p-2" style="background: var(--black-bg-3, #1a1a2e); border-radius: var(--border-radius, 6px); font-size: 0.85rem;">
                        <div><span style="color: var(--white-50);">Endpoint:</span> <code>GET /api/esp32/display</code></div>
                        <div><span style="color: var(--white-50);">Header:</span> <code>X-ESP32-Key: &lt;key&gt;</code></div>
                        <div class="mt-1" style="color: var(--white-50);">Liefert: heutiger PnL, Gesamt-PnL, Win-Rate, offene Positionen, laufende Bots</div>
                    </div>

                    <div class="row align-items-center mt-2">
                        <div class="col-12 col-md-4">API-Key</div>
                        <div class="col-12 col-md-8">
                            <div class="input-group">
                                <input type="text" class="form-control font-monospace"
                                    :value="esp32ApiKeyDisplay"
                                    readonly
                                    :placeholder="esp32KeySet ? '(gesetzt — neu generieren zum Anzeigen)' : '(kein Key gesetzt)'" />
                                <button v-if="esp32ApiKeyDisplay && !esp32ApiKeyDisplay.startsWith('•')"
                                    class="btn btn-outline-secondary" type="button"
                                    @click="navigator.clipboard.writeText(esp32ApiKeyDisplay)"
                                    title="Kopieren">
                                    <i class="uil uil-copy"></i>
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Zeitraum-Filter -->
                    <div class="row align-items-center mt-2">
                        <div class="col-12 col-md-4">
                            Zeitraum
                            <small class="d-block text-muted" style="font-size:0.78rem;">Anzeigen übernehmen automatisch</small>
                        </div>
                        <div class="col-12 col-md-8">
                            <div class="input-group">
                                <select class="form-select" v-model="esp32Filter">
                                    <option value="month">Aktueller Monat</option>
                                    <option value="week">Aktuelle Woche</option>
                                    <option value="year">Aktuelles Jahr</option>
                                    <option value="all">Gesamtzeitraum</option>
                                </select>
                                <button class="btn btn-outline-primary" type="button" @click="saveEsp32Filter">
                                    Speichern
                                </button>
                            </div>
                        </div>
                    </div>

                    <div class="mt-3 d-flex gap-2">
                        <button class="btn btn-primary" @click="generateEsp32Key" :disabled="esp32SaveLoading">
                            <span v-if="esp32SaveLoading" class="spinner-border spinner-border-sm me-1"></span>
                            {{ esp32KeySet ? 'Key neu generieren' : 'Key generieren' }}
                        </button>
                        <button v-if="esp32KeySet" class="btn btn-outline-danger" @click="clearEsp32Key">
                            Key löschen
                        </button>
                    </div>

                    <div v-if="esp32SaveResult" class="mt-2">
                        <small :class="esp32SaveResult.success ? 'text-success' : 'text-danger'">
                            <i class="uil me-1" :class="esp32SaveResult.success ? 'uil-check' : 'uil-exclamation-triangle'"></i>
                            {{ esp32SaveResult.message }}
                        </small>
                    </div>
                </div>

                </div>
                <div v-show="bereich === 'allgemein'">
                <hr />

                <!--=============== SICHERHEIT / PASSWORT-GATE ===============-->
                <div class="d-flex align-items-center pointerClass" @click="authExpanded = !authExpanded">
                    <i class="uil me-2" :class="authExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">Sicherheit · Passwortschutz</p>
                    <span class="badge ms-2" :class="authEnabled ? 'bg-success' : 'bg-secondary'">
                        {{ authEnabled ? 'aktiv' : 'aus' }}
                    </span>
                </div>
                <div v-show="authExpanded" class="mt-2 ms-3">
                    <p class="fw-lighter">
                        Optionaler Login-Schutz. <strong>Nur nötig, wenn die App im Netzwerk/öffentlich erreichbar ist</strong>
                        (z. B. <code>CTJ_HOST=0.0.0.0</code> oder Cloud-Server). Für reinen lokalen Betrieb nicht erforderlich.
                        Für echten Cloud-Betrieb zusätzlich HTTPS via Reverse-Proxy/VPN verwenden.
                    </p>

                    <div v-if="authEnabled" class="row mt-2">
                        <div class="col-12 col-md-4">Aktuelles Passwort</div>
                        <div class="col-12 col-md-8">
                            <input type="password" class="form-control" v-model="authCurrentPassword"
                                autocomplete="current-password" placeholder="(zum Ändern/Deaktivieren)" />
                        </div>
                    </div>

                    <div class="row mt-2">
                        <div class="col-12 col-md-4">{{ authEnabled ? 'Neues Passwort' : 'Passwort' }}</div>
                        <div class="col-12 col-md-8">
                            <input type="password" class="form-control" v-model="authNewPassword"
                                autocomplete="new-password" placeholder="mindestens 6 Zeichen" />
                        </div>
                    </div>
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">Passwort bestätigen</div>
                        <div class="col-12 col-md-8">
                            <input type="password" class="form-control" v-model="authNewPassword2"
                                autocomplete="new-password" placeholder="Passwort wiederholen" />
                        </div>
                    </div>

                    <div class="mt-3 d-flex gap-2">
                        <button class="btn btn-primary" @click="saveAuthPassword" :disabled="authSaveLoading">
                            <span v-if="authSaveLoading" class="spinner-border spinner-border-sm me-1"></span>
                            {{ authEnabled ? 'Passwort ändern' : 'Passwortschutz aktivieren' }}
                        </button>
                        <button v-if="authEnabled" class="btn btn-outline-danger" @click="disableAuth" :disabled="authSaveLoading">
                            Deaktivieren
                        </button>
                        <button v-if="authEnabled" class="btn btn-outline-secondary ms-auto" @click="logout">
                            <i class="uil uil-signout me-1"></i>Abmelden
                        </button>
                    </div>

                    <div v-if="authSaveResult" class="mt-2">
                        <small :class="authSaveResult.success ? 'text-success' : 'text-danger'">
                            <i class="uil me-1" :class="authSaveResult.success ? 'uil-check' : 'uil-exclamation-triangle'"></i>
                            {{ authSaveResult.message }}
                        </small>
                    </div>
                </div>

                </div>
                <div v-show="bereich === 'allgemein'">
                <hr />

                <!--=============== DATENBANK ===============-->
                <div class="d-flex align-items-center pointerClass" @click="dbExpanded = !dbExpanded">
                    <i class="uil me-2" :class="dbExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">{{ t('settings.database') }}</p>
                    <span class="badge ms-2" :class="dbType === 'postgresql' ? 'bg-primary' : 'bg-secondary'">
                        {{ dbType === 'postgresql' ? 'PostgreSQL' : 'SQLite' }}
                    </span>
                </div>
                <div v-show="dbExpanded" class="mt-2 ms-3">
                    <p class="fw-lighter">{{ t('settings.dbDescription') }}</p>

                    <!-- DB-Typ -->
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">{{ t('settings.dbType') }}</div>
                        <div class="col-12 col-md-8">
                            <select class="form-select" v-model="dbType">
                                <option value="sqlite">{{ t('settings.sqliteLocal') }}</option>
                                <option value="postgresql">{{ t('settings.postgresRemote') }}</option>
                            </select>
                        </div>
                    </div>

                    <!-- PostgreSQL Provider-Info -->
                    <div v-if="dbType === 'postgresql'" class="mt-3 p-3" style="background: var(--black-bg-2); border-radius: var(--border-radius); border: 1px solid var(--white-10);">
                        <div class="d-flex align-items-center pointerClass" @click="pgProvidersExpanded = !pgProvidersExpanded">
                            <i class="uil me-1" :class="pgProvidersExpanded ? 'uil-angle-down' : 'uil-angle-right'" style="font-size: 1.1rem;"></i>
                            <span class="fw-bold small"><i class="uil uil-info-circle me-1"></i>{{ t('settings.pgProviderTitle') }}</span>
                        </div>
                        <div v-show="pgProvidersExpanded" class="mt-2">
                            <p class="fw-lighter small mb-2">{{ t('settings.pgProviderDesc') }}</p>
                            <table class="table table-sm table-borderless mb-0" style="font-size: 0.82rem;">
                                <thead>
                                    <tr style="color: var(--white-50);">
                                        <th>{{ t('settings.pgProvider') }}</th>
                                        <th>Free Tier</th>
                                        <th>{{ t('settings.pgFeature') }}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td><a href="https://neon.tech" target="_blank" class="text-decoration-none">Neon <i class="uil uil-external-link-alt" style="font-size: 0.75rem;"></i></a></td>
                                        <td>512 MB</td>
                                        <td>Branching, Autoscaling</td>
                                    </tr>
                                    <tr>
                                        <td><a href="https://supabase.com" target="_blank" class="text-decoration-none">Supabase <i class="uil uil-external-link-alt" style="font-size: 0.75rem;"></i></a></td>
                                        <td>500 MB</td>
                                        <td>Auth, API, Realtime</td>
                                    </tr>
                                    <tr>
                                        <td><a href="https://aiven.io" target="_blank" class="text-decoration-none">Aiven <i class="uil uil-external-link-alt" style="font-size: 0.75rem;"></i></a></td>
                                        <td>1 GB</td>
                                        <td>{{ t('settings.pgAivenFeature') }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- PostgreSQL-Felder -->
                    <template v-if="dbType === 'postgresql'">
                        <div class="row mt-2">
                            <div class="col-12 col-md-4">Host</div>
                            <div class="col-12 col-md-8">
                                <input type="text" class="form-control" v-model="dbHost" :placeholder="t('settings.hostPlaceholder')" />
                            </div>
                        </div>
                        <div class="row mt-2">
                            <div class="col-12 col-md-4">Port</div>
                            <div class="col-12 col-md-8">
                                <input type="number" class="form-control" v-model="dbPort" placeholder="5432" />
                            </div>
                        </div>
                        <div class="row mt-2">
                            <div class="col-12 col-md-4">{{ t('settings.user') }}</div>
                            <div class="col-12 col-md-8">
                                <input type="text" class="form-control" v-model="dbUser" placeholder="tradejournal" />
                            </div>
                        </div>
                        <div class="row mt-2">
                            <div class="col-12 col-md-4">{{ t('settings.password') }}</div>
                            <div class="col-12 col-md-8">
                                <input type="password" class="form-control" v-model="dbPassword" :placeholder="dbHasPassword ? t('settings.passwordSaved') : t('settings.password')" />
                            </div>
                        </div>
                        <div class="row mt-2">
                            <div class="col-12 col-md-4">{{ t('settings.databaseName') }}</div>
                            <div class="col-12 col-md-8">
                                <input type="text" class="form-control" v-model="dbDatabase" placeholder="tradejournal" />
                            </div>
                        </div>
                    </template>

                    <!-- Buttons -->
                    <div class="mt-3 mb-3">
                        <button type="button" @click="saveDbConfig" class="btn btn-success me-2">{{ t('common.save') }}</button>
                        <button v-if="dbType === 'postgresql'" type="button" @click="testDbConnection" class="btn btn-outline-primary" :disabled="dbTestLoading">
                            <span v-if="dbTestLoading">
                                <span class="spinner-border spinner-border-sm me-1"></span>{{ t('common.testing') }}
                            </span>
                            <span v-else>{{ t('common.testConnection') }}</span>
                        </button>
                        <span v-if="dbTestResult" class="ms-2" :class="dbTestResult.ok ? 'text-success' : 'text-danger'">
                            {{ dbTestResult.message }}
                        </span>
                        <span v-if="dbSaveResult" class="ms-2" :class="dbSaveResult.ok ? 'text-success' : 'text-danger'">
                            {{ dbSaveResult.message }}
                        </span>
                    </div>

                    <div v-if="dbSaveResult?.ok" class="mt-2">
                        <button type="button" @click="restartServer" class="btn btn-warning btn-sm" :disabled="dbRestartLoading">
                            <span v-if="dbRestartLoading">
                                <span class="spinner-border spinner-border-sm me-1"></span>{{ t('settings.serverRestarting') }}
                            </span>
                            <span v-else><i class="uil uil-redo me-1"></i>{{ t('settings.restartServerBtn') }}</span>
                        </button>
                    </div>

                    <!-- Export / Import -->
                    <div class="mt-3 pt-3" style="border-top: 1px solid var(--white-10);">
                        <p class="fw-bold mb-2">{{ t('settings.backup') }}</p>
                        <p class="fw-lighter small">{{ t('settings.backupDescription') }}</p>
                        <div class="d-flex align-items-center gap-2">
                            <button type="button" @click="exportDb" class="btn btn-outline-primary btn-sm" :disabled="dbExportLoading">
                                <span v-if="dbExportLoading">
                                    <span class="spinner-border spinner-border-sm me-1"></span>{{ t('settings.exporting') }}
                                </span>
                                <span v-else><i class="uil uil-export me-1"></i>{{ t('settings.export') }}</span>
                            </button>
                            <button type="button" @click="importDb" class="btn btn-outline-warning btn-sm" :disabled="dbImportLoading">
                                <span v-if="dbImportLoading">
                                    <span class="spinner-border spinner-border-sm me-1"></span>{{ t('settings.importingData') }}
                                </span>
                                <span v-else><i class="uil uil-import me-1"></i>{{ t('settings.import') }}</span>
                            </button>
                        </div>
                        <span v-if="dbMigrationResult" class="small mt-1 d-block" :class="dbMigrationResult.ok ? 'text-success' : 'text-danger'">
                            {{ dbMigrationResult.message }}
                        </span>
                    </div>
                </div>

                </div>
                <div v-show="bereich === 'journal'">
                <hr />

                <!--=============== OHLC-CHART ===============-->
                <div class="d-flex align-items-center pointerClass" @click="chartExpanded = !chartExpanded">
                    <i class="uil me-2" :class="chartExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">OHLC-Chart</p>
                </div>
                <div v-show="chartExpanded" class="mt-2 ms-3">
                    <p class="fw-lighter">{{ t('settings.ohlcDescription') }}</p>
                    <div class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" id="binanceToggle" v-model="enableBinanceChart" @change="saveBinanceSetting">
                        <label class="form-check-label" for="binanceToggle">{{ t('settings.enableBinanceChart') }}</label>
                    </div>
                </div>

                </div>
                <div v-show="bereich === 'allgemein'">
                <hr />

                <!--=============== IMPORTE ===============-->
                <div class="d-flex align-items-center pointerClass" @click="importsExpanded = !importsExpanded">
                    <i class="uil me-2" :class="importsExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">{{ t('settings.imports') }}</p>
                    <span class="badge bg-secondary ms-2">{{ importsList.length }}</span>
                </div>
                <div v-show="importsExpanded" class="mt-2 ms-3">
                    <p class="fw-lighter">{{ t('settings.importsDescription') }}</p>

                    <div>
                        <div v-if="importsLoading" class="text-center">
                            <div class="spinner-border spinner-border-sm" role="status"></div>
                        </div>

                        <div v-else-if="importsList.length === 0">
                            <p class="text-muted">{{ t('settings.noImports') }}</p>
                        </div>

                        <div v-else>
                            <!-- Monat-Gruppen -->
                            <div v-for="month in importsGroupedByMonth" :key="month.key" class="mb-2">
                                <!-- Monats-Header -->
                                <div class="d-flex align-items-center gap-2 p-2 pointerClass"
                                    style="background: var(--black-bg-5, #141422); border-radius: var(--border-radius, 6px);"
                                    @click="toggleMonth(month.key)">
                                    <i class="uil" :class="expandedMonths.has(month.key) ? 'uil-angle-down' : 'uil-angle-right'"></i>
                                    <span class="fw-bold">{{ month.label }}</span>
                                    <span class="badge bg-secondary">{{ month.days.length }} {{ month.days.length === 1 ? 'Tag' : 'Tage' }}</span>
                                    <span class="badge bg-secondary">{{ month.tradeCount }} {{ t('common.trades') }}</span>
                                    <span v-if="month.evaluatedCount === month.tradeCount && month.tradeCount > 0"
                                        class="badge bg-success">{{ t('settings.allEvaluated') }}</span>
                                    <span v-else-if="month.evaluatedCount > 0"
                                        class="badge bg-warning text-dark">{{ month.evaluatedCount }}/{{ month.tradeCount }}</span>
                                </div>

                                <!-- Tage innerhalb des Monats -->
                                <div v-show="expandedMonths.has(month.key)" class="ps-3 mt-1">
                                    <div v-for="data in month.days" :key="data.dateUnix" class="import-row mb-1">
                                        <!-- Import Day Header -->
                                        <div class="d-flex align-items-center justify-content-between p-2 pointerClass"
                                            style="background: var(--black-bg-3, #1a1a2e); border-radius: var(--border-radius, 6px);"
                                            @click="toggleImportExpand(data.dateUnix)">
                                            <div class="d-flex align-items-center gap-2">
                                                <i class="uil" :class="expandedImport === data.dateUnix ? 'uil-angle-down' : 'uil-angle-right'"></i>
                                                <span class="fw-bold">{{ useDateCalFormat(data.dateUnix) }}</span>
                                                <span class="badge bg-secondary">{{ getTradeCount(data) }} {{ t('common.trades') }}</span>
                                                <span v-if="getEvaluatedCount(data) === getTradeCount(data) && getTradeCount(data) > 0"
                                                    class="badge bg-success">{{ t('settings.allEvaluated') }}</span>
                                                <span v-else-if="getEvaluatedCount(data) > 0"
                                                    class="badge bg-warning text-dark">{{ t('settings.xOfYEvaluated', { x: getEvaluatedCount(data), y: getTradeCount(data) }) }}</span>
                                                <span v-else-if="getTradeCount(data) > 0"
                                                    class="badge bg-secondary" style="opacity: 0.6;">{{ t('settings.notEvaluated') }}</span>
                                            </div>
                                            <div>
                                                <span v-if="deleteConfirm === data.dateUnix" @click.stop>
                                                    <span class="me-2 small">{{ t('settings.sure') }}</span>
                                                    <button class="btn btn-danger btn-sm me-1" @click.stop="executeDeleteImport(data.dateUnix)">{{ t('common.yes') }}</button>
                                                    <button class="btn btn-outline-secondary btn-sm" @click.stop="cancelDeleteImport">{{ t('common.no') }}</button>
                                                </span>
                                                <i v-else class="uil uil-trash-alt pointerClass text-danger" @click.stop="confirmDeleteImport(data.dateUnix)"></i>
                                            </div>
                                        </div>

                                        <!-- Expanded: Individual Trades -->
                                        <div v-if="expandedImport === data.dateUnix" class="ps-4 pe-2 py-2">
                                            <div v-for="trade in getTradesForDay(data)" :key="trade.id"
                                                class="d-flex align-items-center justify-content-between py-1"
                                                style="border-bottom: 1px solid var(--white-10, rgba(255,255,255,0.05));">
                                                <div class="d-flex align-items-center gap-2">
                                                    <strong>{{ trade.symbol }}</strong>
                                                    <span class="badge" :class="trade.strategy === 'long' || trade.side === 'B' ? 'bg-success' : 'bg-danger'">
                                                        {{ formatTradeSide(trade) }}
                                                    </span>
                                                    <span class="fw-bold" :class="parseFloat(trade.netProceeds || trade.grossProceeds || 0) >= 0 ? 'greenTrade' : 'redTrade'">
                                                        {{ formatTradePnl(trade) }} USDT
                                                    </span>
                                                </div>
                                                <div class="d-flex align-items-center gap-2">
                                                    <span v-if="isTradeEvaluated(trade.id)" class="badge bg-success">
                                                        <i class="uil uil-check me-1"></i>Bewertet
                                                    </span>
                                                    <a v-else :href="'/playbook?tradeId=' + trade.id" class="btn btn-sm btn-outline-primary py-0 px-2">
                                                        <i class="uil uil-pen me-1"></i>Bewerten
                                                    </a>
                                                </div>
                                            </div>
                                            <div v-if="getTradesForDay(data).length === 0" class="text-muted small py-1">
                                                Keine einzelnen Trades gefunden.
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                </div>

                <!--=============== BENACHRICHTIGUNGEN ===============-->
                <div v-show="bereich === 'benachrichtigungen'">
                <hr />
                <p class="fs-5 fw-bold mb-1">{{ t('settings.benachrichtigungen.titel') }}</p>
                <p class="fw-lighter" style="font-size:0.85rem;">
                    {{ t('settings.benachrichtigungen.einleitung') }}
                </p>

                <!-- Hauptschalter: ohne ihn ist der ganze Browser-Kanal stumm -->
                <div class="form-check form-switch mt-3">
                    <input class="form-check-input" type="checkbox" id="notificationToggle"
                        v-model="browserNotifications" @change="saveNotificationSetting">
                    <label class="form-check-label" for="notificationToggle">
                        {{ t('settings.browserNotifications') }}
                    </label>
                </div>
                <small class="text-muted">{{ t('settings.browserNotificationsHint') }}</small>

                <!-- Matrix: je Ereignis eine Zeile, je Kanal ein Häkchen -->
                <div class="table-responsive mt-4">
                    <table class="table table-sm align-middle mb-0">
                        <thead>
                            <tr>
                                <th style="min-width:15rem;">{{ t('settings.benachrichtigungen.ereignis') }}</th>
                                <th class="text-center" style="width:7rem;">{{ t('settings.benachrichtigungen.browser') }}</th>
                                <th class="text-center" style="width:7rem;">{{ t('settings.benachrichtigungen.email') }}</th>
                                <th style="min-width:13rem;">{{ t('settings.benachrichtigungen.schwelle') }}</th>
                                <th style="min-width:13rem;">{{ t('settings.benachrichtigungen.maerkte') }}</th>
                            </tr>
                        </thead>
                        <tbody v-for="g in typenNachGruppe" :key="g.id">
                            <tr>
                                <td colspan="5" class="fw-bold text-muted pt-3" style="font-size:0.78rem; text-transform:uppercase; letter-spacing:0.04em;">
                                    {{ t('settings.benachrichtigungen.gruppe_' + g.id) }}
                                </td>
                            </tr>
                            <tr v-for="typ in g.typen" :key="typ.id">
                                <td>
                                    {{ t('settings.benachrichtigungen.typ_' + typ.id) }}
                                    <small class="d-block text-muted" style="font-size:0.76rem;">
                                        {{ t('settings.benachrichtigungen.hinweis_' + typ.id) }}
                                    </small>
                                </td>
                                <td class="text-center">
                                    <input class="form-check-input" type="checkbox"
                                        :checked="kanalAn(typ.id, 'browser')" :disabled="!browserNotifications"
                                        @change="setzeKanal(typ.id, 'browser', $event.target.checked)">
                                </td>
                                <td class="text-center">
                                    <input v-if="typ.email" class="form-check-input" type="checkbox"
                                        :checked="kanalAn(typ.id, 'email')" :disabled="!mail.mailAktiv"
                                        @change="setzeKanal(typ.id, 'email', $event.target.checked)">
                                    <span v-else class="text-muted" :title="t('settings.benachrichtigungen.nurBrowser')">—</span>
                                </td>
                                <td>
                                    <select v-if="SCHWELLEN[typ.id]" class="form-select form-select-sm"
                                        v-model.number="SCHWELLEN[typ.id].ref().value"
                                        @change="radarSpeichern(SCHWELLEN[typ.id].spalte)">
                                        <option v-for="[wert, text] in SCHWELLEN[typ.id].optionen"
                                            :key="wert" :value="wert">{{ text }}</option>
                                    </select>
                                </td>
                                <!-- Märkte: bisher nur die Divergenz beobachtet
                                     einzelne Coins. Leer = die eigenen Märkte. -->
                                <td>
                                    <div v-if="typ.id === 'fundingDivergenz'" class="position-relative">
                                        <button type="button" class="form-select form-select-sm text-start divWahlKnopf"
                                            :disabled="!radarFundingDivergenz" @click="divergenzOeffnen">
                                            <span v-if="divergenzGewaehlt.length">{{ divergenzLabel }}</span>
                                            <span v-else class="text-muted">{{ t('settings.benachrichtigungen.divergenzEigene') }}</span>
                                        </button>
                                        <template v-if="divergenzOffen">
                                            <div class="divWahlHinter" @click="divergenzOffen = false"></div>
                                            <div class="divWahl">
                                                <input type="text" class="form-control form-control-sm mb-2"
                                                    v-model="divergenzSuche" :placeholder="t('settings.benachrichtigungen.divergenzSuche')" />
                                                <div class="divWahlZeile" @click="divergenzLeeren">
                                                    <i class="uil me-2" :class="divergenzGewaehlt.length ? 'uil-square-full text-muted' : 'uil-check-square text-success'"></i>
                                                    {{ t('settings.benachrichtigungen.divergenzEigene') }}
                                                </div>
                                                <div v-if="divergenzLaedt" class="text-muted px-1 py-2" style="font-size:0.8rem;">
                                                    {{ t('settings.benachrichtigungen.divergenzLaedt') }}
                                                </div>
                                                <div v-for="s in divergenzTreffer" :key="s" class="divWahlZeile"
                                                    @click="divergenzUmschalten(s)">
                                                    <i class="uil me-2" :class="divergenzGewaehlt.includes(s) ? 'uil-check-square text-success' : 'uil-square-full text-muted'"></i>
                                                    {{ kurzCoin(s) }}
                                                </div>
                                                <div class="text-muted px-1 pt-2" style="font-size:0.75rem;">
                                                    {{ t('settings.benachrichtigungen.divergenzAnzahl', { n: divergenzGewaehlt.length, max: DIVERGENZ_MAX }) }}
                                                </div>
                                            </div>
                                        </template>
                                        <small class="d-block text-muted mt-1" style="font-size:0.72rem;">
                                            {{ t('settings.benachrichtigungen.divergenzHinweis') }}
                                        </small>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p class="fw-lighter mt-2" style="font-size:0.8rem;">
                    {{ t('settings.benachrichtigungen.kanalHinweis') }}
                </p>

                <!--=============== E-MAIL ===============-->
                <hr class="mt-4" />
                <p class="fs-5 fw-bold mb-1">{{ t('settings.benachrichtigungen.mailTitel') }}</p>
                <p class="fw-lighter" style="font-size:0.85rem;">
                    {{ t('settings.benachrichtigungen.mailEinleitung') }}
                </p>

                <div class="form-check form-switch mt-2">
                    <input class="form-check-input" type="checkbox" id="mailAktivToggle"
                        :checked="mail.mailAktiv === 1"
                        @change="mail.mailAktiv = $event.target.checked ? 1 : 0; speichereMail()">
                    <label class="form-check-label" for="mailAktivToggle">
                        {{ t('settings.benachrichtigungen.mailAktiv') }}
                    </label>
                </div>

                <div class="d-flex align-items-center gap-2 flex-wrap mt-3">
                    <span class="text-muted" style="font-size:0.8rem;">{{ t('settings.benachrichtigungen.vorlage') }}</span>
                    <button v-for="v in MAIL_VORLAGEN" :key="v.name" type="button"
                        class="btn btn-sm btn-outline-secondary" @click="mailVorlage(v)">{{ v.name }}</button>
                </div>

                <div class="row align-items-center mt-3">
                    <div class="col-12 col-md-4">{{ t('settings.benachrichtigungen.host') }}</div>
                    <div class="col-12 col-md-8 d-flex gap-2 flex-wrap">
                        <input type="text" class="form-control" style="max-width:18rem;"
                            v-model="mail.mailHost" placeholder="smtp.example.com" />
                        <input type="number" class="form-control" style="max-width:7rem;"
                            v-model.number="mail.mailPort" placeholder="587" />
                        <select class="form-select" style="max-width:11rem;" v-model="mail.mailSicherheit">
                            <option value="tls">TLS (465)</option>
                            <option value="starttls">STARTTLS (587)</option>
                            <option value="keine">ohne</option>
                        </select>
                    </div>
                </div>

                <div class="row align-items-center mt-2">
                    <div class="col-12 col-md-4">{{ t('settings.benachrichtigungen.zugang') }}</div>
                    <div class="col-12 col-md-8 d-flex gap-2 flex-wrap">
                        <input type="text" class="form-control" style="max-width:18rem;"
                            v-model="mail.mailUser" :placeholder="t('settings.benachrichtigungen.benutzer')" />
                        <input type="password" class="form-control" style="max-width:14rem;"
                            v-model="mail.mailPasswort" :placeholder="t('settings.benachrichtigungen.passwort')" />
                    </div>
                </div>

                <div class="row align-items-center mt-2">
                    <div class="col-12 col-md-4">{{ t('settings.benachrichtigungen.adressen') }}</div>
                    <div class="col-12 col-md-8 d-flex gap-2 flex-wrap">
                        <input type="email" class="form-control" style="max-width:18rem;"
                            v-model="mail.mailVon" :placeholder="t('settings.benachrichtigungen.von')" />
                        <input type="email" class="form-control" style="max-width:18rem;"
                            v-model="mail.mailAn" :placeholder="t('settings.benachrichtigungen.an')" />
                    </div>
                </div>

                <div class="d-flex align-items-center gap-2 flex-wrap mt-3">
                    <button type="button" class="btn btn-sm btn-primary" @click="speichereMail">
                        {{ t('settings.benachrichtigungen.speichern') }}
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-primary"
                        :disabled="mailTestLaeuft" @click="testeMail">
                        {{ mailTestLaeuft ? t('settings.benachrichtigungen.testLaeuft') : t('settings.benachrichtigungen.test') }}
                    </button>
                    <span v-if="mailMeldung" :class="mailFehler ? 'text-danger' : 'text-success'"
                        style="font-size:0.85rem;">{{ mailMeldung }}</span>
                </div>
                <p class="fw-lighter mt-2" style="font-size:0.8rem;">
                    {{ t('settings.benachrichtigungen.passwortHinweis') }}
                </p>
                </div>

            </div>
        </div>

    </div>
</template>

<style scoped>
/* Coin-Auswahl des Divergenz-Alarms. Eigenes Aufklappfeld statt eines
   <select multiple>: aus über 500 Perps sucht man ohne Suchfeld nicht, und
   ein mehrzeiliges Auswahlfeld sprengt die Tabellenzeile. */
.divWahlKnopf {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* Fängt den Klick daneben ab — sonst bliebe die Liste offen stehen. */
.divWahlHinter {
    position: fixed;
    inset: 0;
    z-index: 1040;
}

.divWahl {
    position: absolute;
    z-index: 1050;
    top: calc(100% + 0.25rem);
    right: 0;
    width: 15rem;
    max-height: 18rem;
    overflow-y: auto;
    padding: 0.5rem;
    border-radius: var(--border-radius, 0.5rem);
    background: var(--black-bg-3, #1e1e2f);
    border: 1px solid var(--white-38, rgba(255, 255, 255, 0.15));
    box-shadow: var(--shadow-sm, 0 2px 8px rgba(0, 0, 0, 0.3));
}

.divWahlZeile {
    padding: 0.25rem;
    border-radius: 0.25rem;
    cursor: pointer;
    font-size: 0.82rem;
    white-space: nowrap;
    color: var(--white-87, rgba(255, 255, 255, 0.87));
    user-select: none;
}

.divWahlZeile:hover {
    background: var(--white-38, rgba(255, 255, 255, 0.08));
}
</style>
