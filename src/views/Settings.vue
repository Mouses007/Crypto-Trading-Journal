<script setup>
import { onBeforeMount, onMounted, ref, reactive, computed } from 'vue';
import { useDateCalFormat } from '../utils/formatters.js';
import { useCheckCurrentUser, useInitTooltip } from '../utils/utils';
import { allTradeTimeframes, selectedTradeTimeframes, selectedBroker } from '../stores/filters.js';
import { currentUser, renderProfile } from '../stores/settings.js';
import { dbUpdateSettings, dbGetSettings, dbFind, dbFirst, dbDelete, dbDeleteWhere } from '../utils/db.js'
import axios from 'axios'
import dayjs from 'dayjs'
import { requestNotificationPermission } from '../utils/notify'
import { logWarn } from '../utils/logger.js'
import { useQuickApiImport } from '../utils/quickImport.js'
import { sendNotification } from '../utils/notify.js'

let profileAvatar = null
let username = ref('')
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
let enableBinanceChart = ref(false)
let browserNotifications = ref(true)
let importsExpanded = ref(false)
let layoutExpanded = ref(false)
let balanceExpanded = ref(false)
let timeframesExpanded = ref(false)
let apiExpanded = ref(false)
let tagsExpanded = ref(false)
let bewertungExpanded = ref(false)
let chartExpanded = ref(false)
let kiExpanded = ref(false)
let reparaturExpanded = ref(false)
let dbExpanded = ref(false)

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
let aiKeys = reactive({ openai: '', anthropic: '', gemini: '', deepseek: '' })
let aiOllamaUrl = ref('http://localhost:11434')
let aiTemperature = ref(0.7)
let aiMaxTokens = ref(1500)
let aiScreenshots = ref(false)
let aiChatEnabled = ref(true)
let aiReportPrompt = ref('')
let aiReportPromptPreset = ref('kurz')
let aiTestLoading = ref(false)
let aiTestResult = ref(null)
let ollamaModels = ref([])

const promptPresets = [
    { value: 'custom', label: 'Eigener Prompt', prompt: '' },
    { value: 'kurz', label: 'Kurz & knapp', prompt: 'Halte den Bericht kurz und prägnant. Maximal 3-4 Sätze pro Abschnitt. Fokussiere dich auf die wichtigsten Erkenntnisse.' },
    { value: 'coach', label: 'Strenger Coach', prompt: 'Sei sehr direkt und kritisch. Beschönige nichts. Sprich Schwächen und Fehler klar an. Gib konkrete Verbesserungsvorschläge wie ein strenger Trading-Coach.' },
    { value: 'anfaenger', label: 'Anfänger-freundlich', prompt: 'Erkläre alle Kennzahlen und Begriffe einfach und verständlich. Gib grundlegende Trading-Tipps. Verwende eine ermutigende Sprache.' },
    { value: 'psychologie', label: 'Psychologie-Fokus', prompt: 'Lege besonderen Fokus auf die psychologischen Aspekte: Stress, Emotionen, Disziplin, Overtrading. Analysiere Verhaltensmuster und emotionale Trigger.' },
    { value: 'risiko', label: 'Risiko-Analyse', prompt: 'Fokussiere dich auf Risikomanagement: Positionsgrößen, Risk/Reward, Drawdowns, maximale Verlustserien. Bewerte die Risikokontrolle kritisch.' }
]

function onPromptPresetChange() {
    const preset = promptPresets.find(p => p.value === aiReportPromptPreset.value)
    if (preset && preset.value !== 'custom') {
        aiReportPrompt.value = preset.prompt
    }
}

// Aktueller Key für den gewählten Provider
const currentApiKey = computed({
    get: () => aiKeys[aiProvider.value] || '',
    set: (val) => { aiKeys[aiProvider.value] = val }
})

const openaiModels = ['gpt-4o-mini', 'gpt-4o']
const anthropicModels = ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001']
const geminiModels = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro']
const deepseekModels = ['deepseek-chat', 'deepseek-reasoner']

const availableModels = {
    ollama: () => ollamaModels.value,
    openai: () => openaiModels,
    anthropic: () => anthropicModels,
    gemini: () => geminiModels,
    deepseek: () => deepseekModels
}

function getModelsForProvider() {
    const fn = availableModels[aiProvider.value]
    return fn ? fn() : []
}

async function loadOllamaModels() {
    try {
        const res = await axios.get('/api/ollama/status', { params: { url: aiOllamaUrl.value } })
        ollamaModels.value = res.data.models || []
    } catch (e) {
        ollamaModels.value = []
    }
}

async function saveAiSettings() {
    try {
        await axios.post('/api/ai/settings', {
            aiProvider: aiProvider.value,
            aiModel: aiModel.value,
            aiOllamaUrl: aiOllamaUrl.value || 'http://localhost:11434',
            aiTemperature: parseFloat(aiTemperature.value) || 0.7,
            aiMaxTokens: parseInt(aiMaxTokens.value) || 1500,
            aiScreenshots: aiScreenshots.value,
            aiChatEnabled: aiChatEnabled.value,
            aiReportPrompt: aiReportPrompt.value,
            keys: {
                openai: aiKeys.openai,
                anthropic: aiKeys.anthropic,
                gemini: aiKeys.gemini,
                deepseek: aiKeys.deepseek
            }
        })
        currentUser.value.aiProvider = aiProvider.value
        currentUser.value.aiModel = aiModel.value
        currentUser.value.aiOllamaUrl = aiOllamaUrl.value
        currentUser.value.aiTemperature = aiTemperature.value
        currentUser.value.aiMaxTokens = aiMaxTokens.value
        console.log(' -> KI-Einstellungen gespeichert')
        aiTestResult.value = { success: true, message: 'Gespeichert!' }
        setTimeout(() => aiTestResult.value = null, 3000)
        // Maskierte Keys neu laden
        await loadAiSettings()
    } catch (error) {
        alert('Fehler beim Speichern: ' + error.message)
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
            ollamaUrl: aiOllamaUrl.value
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
    const models = getModelsForProvider()
    aiModel.value = models.length > 0 ? models[0] : ''
    aiTestResult.value = null
    if (aiProvider.value === 'ollama') {
        loadOllamaModels()
    }
}

async function loadAiSettings() {
    try {
        const res = await axios.get('/api/ai/settings')
        const s = res.data
        aiProvider.value = s.aiProvider || 'ollama'
        aiModel.value = s.aiModel || ''
        aiOllamaUrl.value = s.aiOllamaUrl || 'http://localhost:11434'
        aiTemperature.value = s.aiTemperature ?? 0.7
        aiMaxTokens.value = s.aiMaxTokens || 1500
        aiScreenshots.value = s.aiScreenshots || false
        aiChatEnabled.value = s.aiChatEnabled !== false
        aiReportPrompt.value = s.aiReportPrompt || ''
        // Preset erkennen — Standard: "Kurz & knapp" wenn kein Prompt gespeichert
        const matchedPreset = promptPresets.find(p => p.value !== 'custom' && p.prompt === aiReportPrompt.value)
        if (matchedPreset) {
            aiReportPromptPreset.value = matchedPreset.value
        } else if (!aiReportPrompt.value) {
            aiReportPromptPreset.value = 'kurz'
            aiReportPrompt.value = promptPresets.find(p => p.value === 'kurz').prompt
        } else {
            aiReportPromptPreset.value = 'custom'
        }
        if (s.keys) {
            aiKeys.openai = s.keys.openai || ''
            aiKeys.anthropic = s.keys.anthropic || ''
            aiKeys.gemini = s.keys.gemini || ''
            aiKeys.deepseek = s.keys.deepseek || ''
        }
    } catch (e) {
        console.error('Fehler beim Laden der KI-Settings:', e)
    }
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
        dbSaveResult.value = { ok: false, message: 'Fehler: ' + e.message }
    }
}

async function restartServer() {
    dbRestartLoading.value = true
    try {
        await axios.post('/api/restart')
    } catch (e) {
        // Connection will drop during restart — that's expected
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
    dbSaveResult.value = { ok: false, message: 'Server antwortet nicht. Bitte manuell neu starten.' }
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
        dbMigrationResult.value = { ok: true, message: 'Export erfolgreich heruntergeladen.' }
    } catch (e) {
        dbMigrationResult.value = { ok: false, message: 'Export fehlgeschlagen: ' + e.message }
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
                dbMigrationResult.value = { ok: true, message: `Import erfolgreich! ${counts}` }
            } else {
                dbMigrationResult.value = { ok: false, message: res.data.error || 'Import fehlgeschlagen' }
            }
        } catch (e) {
            dbMigrationResult.value = { ok: false, message: 'Import fehlgeschlagen: ' + e.message }
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
        alert('Bitunix API Einstellungen gespeichert')
    } catch (error) {
        alert('Error saving Bitunix config: ' + error.message)
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
        alert('Bitget API Einstellungen gespeichert')

        // Auto-trigger historical import if start date is set
        if (bitgetImportStartDate.value) {
            bitgetImporting.value = true
            try {
                const result = await useQuickApiImport('bitget')
                if (result.count > 0) {
                    sendNotification('Bitget Import', result.message || `${result.count} Tage importiert.`)
                } else {
                    sendNotification('Bitget Import', result.message || 'Keine neuen Trades gefunden.')
                }
            } catch (importError) {
                console.log(' -> Bitget auto-import error:', importError.message)
                sendNotification('Bitget Import', 'Import fehlgeschlagen: ' + (importError.response?.data?.error || importError.message))
            }
            bitgetImporting.value = false
        }
    } catch (error) {
        alert('Error saving Bitget config: ' + error.message)
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
            bitgetTestError.value = response.data.error || 'Unbekannter Fehler'
        }
    } catch (error) {
        bitgetTestResult.value = 'error'
        bitgetTestError.value = error.response?.data?.error || error.message || 'Verbindung fehlgeschlagen'
    }
    bitgetTestLoading.value = false
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

/* FIX TRADE SIDES */
let fixTradesLoading = ref(false)
let fixTradesResult = ref(null)

async function fixTradeSides() {
    fixTradesLoading.value = true
    fixTradesResult.value = null
    try {
        const response = await axios.post('/api/fix-trade-sides')
        fixTradesResult.value = {
            success: true,
            message: `${response.data.fixed} Trades korrigiert, ${response.data.skipped} übersprungen, ${response.data.mfeReset || 0} MFE-Werte zurückgesetzt.`
        }
        console.log(' -> Trade sides fixed:', response.data)
    } catch (error) {
        fixTradesResult.value = {
            success: false,
            message: 'Fehler: ' + (error.response?.data?.error || error.message)
        }
    } finally {
        fixTradesLoading.value = false
    }
}

/* REMOVE DUPLICATE TRADES */
let removeDupsLoading = ref(false)
let removeDupsResult = ref(null)

async function removeDuplicateTrades() {
    removeDupsLoading.value = true
    removeDupsResult.value = null
    try {
        const response = await axios.post('/api/remove-duplicate-trades')
        const d = response.data
        if (d.duplicateRowsDeleted === 0 && d.duplicateTradesRemoved === 0) {
            removeDupsResult.value = { success: true, message: 'Keine Duplikate gefunden.' }
        } else {
            removeDupsResult.value = {
                success: true,
                message: `${d.duplicateTradesRemoved} doppelte Trades entfernt, ${d.duplicateRowsDeleted} doppelte Tage zusammengeführt. ${d.evaluatedKept} bewertete Trades behalten.`
            }
        }
        // Reload imports list
        await loadImports()
    } catch (error) {
        removeDupsResult.value = {
            success: false,
            message: 'Fehler: ' + (error.response?.data?.error || error.message)
        }
    } finally {
        removeDupsLoading.value = false
    }
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

        // 2. Calculate all-time net P&L for this broker
        const trades = await dbFind('trades', { equalTo: { broker }, limit: 100000 })
        let totalNetPnL = 0
        for (const day of trades) {
            if (day.pAndL && typeof day.pAndL === 'object') {
                totalNetPnL += day.pAndL.netProceeds || 0
            }
        }

        // 3. Start-Einzahlung = API-Balance - alle Journal-P&L
        const calculatedStart = apiBalance - totalNetPnL
        startBalance.value = Math.round(calculatedStart * 100) / 100

        console.log(` -> ${broker}: API=${apiBalance.toFixed(2)}, P&L=${totalNetPnL.toFixed(2)}, Start=${calculatedStart.toFixed(2)}`)
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
    const groups = ['Minuten', 'Stunden', 'Tage']
    if (customTimeframes.length > 0) groups.push('Eigene')
    return groups
})
function timeframesByGroup(group) {
    if (group === 'Eigene') return customTimeframes
    return allTradeTimeframes.filter(tf => tf.group === group)
}
function addCustomTimeframe() {
    const label = newCustomTf.value.trim()
    if (!label) return
    const value = 'custom_' + label.replace(/\s+/g, '_').toLowerCase()
    if (allTradeTimeframes.some(tf => tf.value === value) || customTimeframes.some(tf => tf.value === value)) return
    customTimeframes.push({ value, label, group: 'Eigene' })
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
        enableBinanceChart.value = settings.enableBinanceChart === 1
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
            savedCustom.forEach(tf => customTimeframes.push({ value: tf.value, label: tf.label, group: 'Eigene' }))
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
    // KI-Settings über verschlüsselten Endpoint laden
    await loadAiSettings()
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
    await loadTags()
    await loadImports()
    await loadPopupSetting()
    await loadDbConfig()

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
                <!--=============== Layout & Style ===============-->
                <div class="d-flex align-items-center pointerClass" @click="layoutExpanded = !layoutExpanded">
                    <i class="uil me-2" :class="layoutExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">Layout & Stil</p>
                </div>

                <div v-show="layoutExpanded" class="row align-items-center mt-2">

                    <!-- Username -->
                    <div class="col-12 col-md-4">
                        Benutzername
                    </div>
                    <div class="col-12 col-md-8">
                        <input type="text" class="form-control" v-model="username" placeholder="Dein Name..." />
                    </div>

                    <!-- Profile Picture -->
                    <div class="col-12 col-md-4 mt-2">
                        Profilbild
                    </div>
                    <div class="col-12 col-md-8 mt-2">
                        <div class="d-flex align-items-center gap-2 mb-2">
                            <img v-if="currentUser?.avatar" :src="currentUser.avatar" class="rounded-circle" style="width: 40px; height: 40px; object-fit: cover;" />
                            <img v-else src="../assets/icon.png" class="rounded-circle" style="width: 40px; height: 40px; object-fit: cover;" />
                            <button v-if="currentUser?.avatar" type="button" class="btn btn-outline-danger btn-sm" @click="deleteAvatar">
                                <i class="uil uil-trash-alt me-1"></i>Entfernen
                            </button>
                        </div>
                        <input type="file" @change="uploadProfileAvatar" />
                    </div>

                    <div class="col-12 mt-3 mb-3">
                        <button type="button" v-on:click="updateProfile" class="btn btn-success">Speichern</button>
                    </div>
                </div>

                <hr />

                <!--=============== KONTOSTAND ===============-->
                <div class="d-flex align-items-center pointerClass" @click="balanceExpanded = !balanceExpanded">
                    <i class="uil me-2" :class="balanceExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">Kontostand</p>
                </div>
                <div v-show="balanceExpanded" class="mt-2 row align-items-center">
                    <p class="fw-lighter">Dashboard-Kontostand = Start-Einzahlung + alle Trade-Ergebnisse. Klicke <strong>Von API berechnen</strong> um die Start-Einzahlung automatisch aus deinem <strong>{{ (selectedBroker || 'bitunix').charAt(0).toUpperCase() + (selectedBroker || 'bitunix').slice(1) }}</strong>-Kontostand zurückzurechnen.</p>
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">Start-Einzahlung (USDT)</div>
                        <div class="col-12 col-md-8">
                            <div class="input-group">
                                <input type="number" class="form-control" v-model="startBalance" placeholder="z.B. 1000" step="0.01" />
                                <button type="button" class="btn btn-outline-primary" @click="loadBalanceFromApi" :disabled="balanceLoading">
                                    <span v-if="balanceLoading" class="spinner-border spinner-border-sm" style="width: 0.7rem; height: 0.7rem;"></span>
                                    <span v-else><i class="uil uil-cloud-download me-1"></i>Von API berechnen</span>
                                </button>
                            </div>
                            <small v-if="apiBalanceValue !== null" class="text-success">API-Balance: {{ apiBalanceValue.toFixed(2) }} USDT</small>
                            <small v-else class="text-muted">Manuell eingeben oder automatisch von der API berechnen lassen.</small>
                        </div>
                    </div>
                    <div class="mt-3 mb-3">
                        <button type="button" v-on:click="saveBalances" class="btn btn-success">Speichern</button>
                    </div>
                </div>

                <hr />

                <!--=============== API ANBINDUNG ===============-->
                <div class="d-flex align-items-center pointerClass" @click="apiExpanded = !apiExpanded">
                    <i class="uil me-2" :class="apiExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">API Anbindung</p>
                </div>
                <div v-show="apiExpanded" class="mt-2">
                    <p class="fw-lighter">Verbinde deine Börsen-Konten, um Trades automatisch zu importieren.</p>

                    <!-- BITUNIX -->
                    <div class="mb-3" style="border: var(--border-subtle); border-radius: var(--border-radius); overflow: hidden;">
                        <div class="d-flex align-items-center pointerClass px-3 py-2" @click="bitunixSubExpanded = !bitunixSubExpanded"
                            style="background-color: var(--black-bg-5);">
                            <i class="uil me-2" :class="bitunixSubExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                            <strong>Bitunix</strong>
                            <span v-if="bitunixApiKey" class="ms-2 badge bg-success" style="font-size: 0.65rem;">Konfiguriert</span>
                        </div>
                        <div v-show="bitunixSubExpanded" class="row align-items-center px-3 py-3">
                            <div class="row mt-1">
                                <div class="col-12 col-md-4">API Key</div>
                                <div class="col-12 col-md-8">
                                    <input type="text" class="form-control" v-model="bitunixApiKey" placeholder="API Key eingeben" />
                                </div>
                            </div>
                            <div class="row mt-2">
                                <div class="col-12 col-md-4">Secret Key</div>
                                <div class="col-12 col-md-8">
                                    <input type="password" class="form-control" v-model="bitunixSecretKey" placeholder="Secret Key eingeben" />
                                </div>
                            </div>
                            <div class="row mt-2">
                                <div class="col-12 col-md-4">Import ab Datum</div>
                                <div class="col-12 col-md-8">
                                    <input type="date" class="form-control" v-model="bitunixImportStartDate" />
                                    <small class="text-muted">Trades vor diesem Datum werden ignoriert. Leer = alle Trades.</small>
                                </div>
                            </div>
                            <div class="mt-3">
                                <button type="button" v-on:click="saveBitunixConfig" class="btn btn-success me-2">Speichern</button>
                                <button type="button" v-on:click="testBitunixConnection" class="btn btn-outline-primary" :disabled="bitunixTestLoading">
                                    <span v-if="bitunixTestLoading">Testing...</span>
                                    <span v-else>Verbindung testen</span>
                                </button>
                                <span v-if="bitunixTestResult === 'success'" class="ms-2 text-success">Verbunden</span>
                                <span v-if="bitunixTestResult === 'error'" class="ms-2 text-danger">Verbindung fehlgeschlagen</span>
                            </div>
                        </div>
                    </div>

                    <!-- BITGET -->
                    <div class="mb-3" style="border: var(--border-subtle); border-radius: var(--border-radius); overflow: hidden;">
                        <div class="d-flex align-items-center pointerClass px-3 py-2" @click="bitgetSubExpanded = !bitgetSubExpanded"
                            style="background-color: var(--black-bg-5);">
                            <i class="uil me-2" :class="bitgetSubExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                            <strong>Bitget</strong>
                            <span v-if="bitgetApiKey" class="ms-2 badge bg-success" style="font-size: 0.65rem;">Konfiguriert</span>
                        </div>
                        <div v-show="bitgetSubExpanded" class="row align-items-center px-3 py-3">
                            <div class="row mt-1">
                                <div class="col-12 col-md-4">API Key</div>
                                <div class="col-12 col-md-8">
                                    <input type="text" class="form-control" v-model="bitgetApiKey" placeholder="API Key eingeben" />
                                </div>
                            </div>
                            <div class="row mt-2">
                                <div class="col-12 col-md-4">Secret Key</div>
                                <div class="col-12 col-md-8">
                                    <input type="password" class="form-control" v-model="bitgetSecretKey" placeholder="Secret Key eingeben" />
                                </div>
                            </div>
                            <div class="row mt-2">
                                <div class="col-12 col-md-4">Passphrase</div>
                                <div class="col-12 col-md-8">
                                    <input type="password" class="form-control" v-model="bitgetPassphrase" placeholder="API Passphrase eingeben" />
                                    <small class="text-muted">Die Passphrase wird bei der API-Key-Erstellung auf Bitget festgelegt.</small>
                                </div>
                            </div>
                            <div class="row mt-2">
                                <div class="col-12 col-md-4">Import ab Datum</div>
                                <div class="col-12 col-md-8">
                                    <input type="date" class="form-control" v-model="bitgetImportStartDate" />
                                    <small class="text-muted">Trades vor diesem Datum werden ignoriert. Leer = alle Trades.</small>
                                </div>
                            </div>
                            <div class="mt-3">
                                <button type="button" v-on:click="saveBitgetConfig" class="btn btn-success me-2" :disabled="bitgetImporting">
                                    <span v-if="bitgetImporting" class="spinner-border spinner-border-sm me-1" style="width: 0.7rem; height: 0.7rem;"></span>
                                    {{ bitgetImporting ? 'Importiert...' : 'Speichern' }}
                                </button>
                                <button type="button" v-on:click="testBitgetConnection" class="btn btn-outline-primary" :disabled="bitgetTestLoading">
                                    <span v-if="bitgetTestLoading">Testing...</span>
                                    <span v-else>Verbindung testen</span>
                                </button>
                                <span v-if="bitgetTestResult === 'success'" class="ms-2 text-success"><i class="uil uil-check-circle"></i> Verbunden</span>
                                <span v-if="bitgetTestResult === 'error'" class="ms-2 text-danger"><i class="uil uil-exclamation-triangle"></i> Fehlgeschlagen</span>
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
                </div>

                <hr />

                <!--=============== BEWERTUNG ===============-->
                <div class="d-flex align-items-center pointerClass" @click="bewertungExpanded = !bewertungExpanded">
                    <i class="uil me-2" :class="bewertungExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">Bewertung</p>
                </div>
                <div v-show="bewertungExpanded" class="mt-2">

                    <!--=============== TAGS (Unterabschnitt) ===============-->
                    <p class="fs-6 fw-bold mb-1">Tags</p>
                    <p class="fw-lighter">Erstelle Tag-Gruppen und Tags, um deine Trades zu kategorisieren.</p>

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
                                <span v-else class="badge bg-secondary ms-1" style="font-size: 0.65rem;"><i class="uil uil-lock-alt me-1"></i>Pflicht</span>
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
                            <input type="text" class="form-control form-control-sm me-2" style="max-width: 200px;" placeholder="Neuer Tag..." v-model="newTagName[group.id]" @keyup.enter="addTag(group)" />
                            <button class="btn btn-outline-primary btn-sm" @click="addTag(group)">+ Tag</button>
                        </div>
                    </div>

                    <!-- Add new group -->
                    <div class="mt-3 p-3" style="border: 1px dashed var(--border-color); background: var(--bg-card);">
                        <div class="d-flex align-items-center">
                            <input type="text" class="form-control form-control-sm me-2" style="max-width: 200px;" placeholder="Neue Gruppe..." v-model="newGroupName" @keyup.enter="addGroup" />
                            <input type="color" class="form-control form-control-color form-control-sm me-2" v-model="newGroupColor" />
                            <button class="btn btn-outline-success btn-sm" @click="addGroup">+ Gruppe</button>
                        </div>
                    </div>

                    <hr />

                    <!--=============== TIMEFRAMES (Unterabschnitt) ===============-->
                    <p class="fs-6 fw-bold mb-1">Timeframes</p>
                    <p class="fw-lighter">Wähle die Timeframes aus, die du beim Trading verwendest. Diese erscheinen dann in Offene Trades und Playbook.</p>
                    <div v-for="group in timeframeGroups" :key="group" class="mb-2">
                        <label class="fw-lighter text-uppercase small mb-1">{{ group }}</label>
                        <div class="d-flex flex-wrap gap-1">
                            <template v-if="group === 'Eigene'">
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
                        <input type="text" class="form-control form-control-sm me-2" style="max-width: 200px;" placeholder="z.B. 8 Stunden" v-model="newCustomTf" @keyup.enter="addCustomTimeframe" />
                        <button class="btn btn-outline-primary btn-sm" @click="addCustomTimeframe">+ Timeframe</button>
                    </div>
                    <div class="mt-3 mb-3">
                        <button type="button" v-on:click="saveTimeframes" class="btn btn-success">Speichern</button>
                    </div>

                    <hr />

                    <!--=============== POPUPS (Unterabschnitt) ===============-->
                    <p class="fs-6 fw-bold mb-1">Popups & Benachrichtigungen</p>
                    <p class="fw-lighter">Trade-Bewertungs-Popups beim Öffnen und Schließen von Positionen anzeigen.</p>
                    <div class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" id="popupToggle" v-model="showTradePopups" @change="savePopupSetting">
                        <label class="form-check-label" for="popupToggle">Bewertungs-Popups aktivieren</label>
                    </div>
                    <div class="form-check form-switch mt-3">
                        <input class="form-check-input" type="checkbox" id="notificationToggle" v-model="browserNotifications" @change="saveNotificationSetting">
                        <label class="form-check-label" for="notificationToggle">Browser-Benachrichtigungen</label>
                    </div>
                    <small class="text-muted">Desktop-Benachrichtigung wenn ein KI-Bericht fertig ist oder ein API-Import abgeschlossen wurde (nur wenn Tab nicht im Fokus).</small>
                </div>

                <hr />

                <!--=============== KI-AGENT ===============-->
                <div class="d-flex align-items-center pointerClass" @click="kiExpanded = !kiExpanded">
                    <i class="uil me-2" :class="kiExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">KI-Agent</p>
                </div>
                <div v-show="kiExpanded" class="mt-2">
                    <p class="fw-lighter">Konfiguriere den KI-Anbieter für die automatische Berichterstellung. Ollama (lokal, kostenlos) oder Online-KI (OpenAI/Anthropic/Gemini/DeepSeek, benötigt API-Key).</p>

                    <!-- Anbieter -->
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">Anbieter</div>
                        <div class="col-12 col-md-8">
                            <select class="form-select" v-model="aiProvider" @change="onProviderChange">
                                <option value="ollama">Ollama (lokal)</option>
                                <option value="openai">OpenAI</option>
                                <option value="anthropic">Anthropic (Claude)</option>
                                <option value="gemini">Google Gemini</option>
                                <option value="deepseek">DeepSeek</option>
                            </select>
                        </div>
                    </div>

                    <!-- Ollama URL (nur bei Ollama) -->
                    <div v-if="aiProvider === 'ollama'" class="row mt-2">
                        <div class="col-12 col-md-4">Ollama URL</div>
                        <div class="col-12 col-md-8">
                            <input type="text" class="form-control" v-model="aiOllamaUrl" placeholder="http://localhost:11434" />
                            <small class="text-muted">Standard: http://localhost:11434 — Ändere die URL wenn Ollama auf einem anderen Server läuft.</small>
                        </div>
                    </div>

                    <!-- Modell -->
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">Modell</div>
                        <div class="col-12 col-md-8">
                            <select class="form-select" v-model="aiModel">
                                <option v-for="m in getModelsForProvider()" :key="m" :value="m">{{ m }}</option>
                            </select>
                            <small v-if="aiProvider === 'ollama' && ollamaModels.length === 0" class="text-warning">
                                Klicke auf "Verbindung testen" um die Modelle zu laden.
                            </small>
                        </div>
                    </div>

                    <!-- API Key (nur bei Online-Providern) -->
                    <div v-if="aiProvider !== 'ollama'" class="row mt-2">
                        <div class="col-12 col-md-4">API-Key</div>
                        <div class="col-12 col-md-8">
                            <div class="input-group">
                                <input type="password" class="form-control" v-model="currentApiKey" placeholder="API-Key eingeben..."
                                       @focus="e => { if (currentApiKey.includes('•')) e.target.select() }" />
                                <button v-if="currentApiKey" class="btn btn-outline-secondary" type="button"
                                        @click="currentApiKey = ''" title="Key löschen">
                                    <i class="uil uil-times"></i>
                                </button>
                            </div>
                            <small class="text-muted">
                                <i class="uil uil-lock me-1"></i>Verschlüsselt gespeichert.
                                <span v-if="aiProvider === 'openai'"> Von platform.openai.com/api-keys</span>
                                <span v-else-if="aiProvider === 'anthropic'"> Von console.anthropic.com/settings/keys</span>
                                <span v-else-if="aiProvider === 'gemini'"> Von aistudio.google.com/apikey</span>
                                <span v-else-if="aiProvider === 'deepseek'"> Von platform.deepseek.com/api_keys</span>
                            </small>
                        </div>
                    </div>

                    <!-- Temperatur -->
                    <div class="row mt-3">
                        <div class="col-12 col-md-4">Kreativität</div>
                        <div class="col-12 col-md-8">
                            <div class="d-flex align-items-center gap-2">
                                <input type="range" class="form-range flex-grow-1" v-model="aiTemperature" min="0" max="1" step="0.1" />
                                <span class="badge bg-secondary" style="min-width: 40px;">{{ aiTemperature }}</span>
                            </div>
                            <small class="text-muted">0 = sachlich, 1 = kreativ</small>
                        </div>
                    </div>

                    <!-- Max Tokens -->
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">Max. Textlänge</div>
                        <div class="col-12 col-md-8">
                            <input type="number" class="form-control" v-model="aiMaxTokens" min="500" max="4000" step="100" />
                            <small class="text-muted">500–4000 Tokens (ca. 1 Token = 0.75 Wörter)</small>
                        </div>
                    </div>

                    <!-- Bericht-Prompt -->
                    <div class="row mt-3">
                        <div class="col-12 col-md-4">Bericht-Stil</div>
                        <div class="col-12 col-md-8">
                            <select class="form-select mb-2" v-model="aiReportPromptPreset" @change="onPromptPresetChange">
                                <option v-for="p in promptPresets" :key="p.value" :value="p.value">{{ p.label }}</option>
                            </select>
                            <textarea class="form-control" v-model="aiReportPrompt" rows="3" placeholder="Zusätzliche Anweisungen für die KI-Berichterstellung... (leer = Standard-Prompt)"></textarea>
                            <small class="text-muted">Diese Anweisungen werden dem Standard-Prompt hinzugefügt. Hiermit kannst du den Stil, Fokus und Detailgrad des Berichts beeinflussen.</small>
                        </div>
                    </div>

                    <!-- Chat/Rückfragen -->
                    <div class="row mt-3">
                        <div class="col-12 col-md-4">Bericht-Chat</div>
                        <div class="col-12 col-md-8">
                            <div class="form-check form-switch">
                                <input class="form-check-input" type="checkbox" id="aiChatToggle" v-model="aiChatEnabled">
                                <label class="form-check-label" for="aiChatToggle">Rückfragen zu Berichten erlauben</label>
                            </div>
                            <small class="text-muted">Ermöglicht Chat-Rückfragen unter jedem KI-Bericht. Die KI erhält den Bericht als Kontext.</small>
                        </div>
                    </div>

                    <!-- Buttons -->
                    <div class="mt-3 mb-3">
                        <button type="button" @click="saveAiSettings" class="btn btn-success me-2">Speichern</button>
                        <button type="button" @click="testAiConnection" class="btn btn-outline-primary" :disabled="aiTestLoading">
                            <span v-if="aiTestLoading">
                                <span class="spinner-border spinner-border-sm me-1"></span>Teste...
                            </span>
                            <span v-else>Verbindung testen</span>
                        </button>
                        <span v-if="aiTestResult" class="ms-2" :class="aiTestResult.success ? 'text-success' : 'text-danger'">
                            {{ aiTestResult.message }}
                        </span>
                    </div>
                </div>

                <hr />

                <!--=============== DATENBANK ===============-->
                <div class="d-flex align-items-center pointerClass" @click="dbExpanded = !dbExpanded">
                    <i class="uil me-2" :class="dbExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">Datenbank</p>
                    <span class="badge ms-2" :class="dbType === 'postgresql' ? 'bg-primary' : 'bg-secondary'">
                        {{ dbType === 'postgresql' ? 'PostgreSQL' : 'SQLite' }}
                    </span>
                </div>
                <div v-show="dbExpanded" class="mt-2">
                    <p class="fw-lighter">SQLite (lokal, Standard) oder PostgreSQL (remote, z.B. auf NAS/Server). Nach dem Wechsel ist ein Server-Neustart nötig.</p>

                    <!-- DB-Typ -->
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">Datenbank-Typ</div>
                        <div class="col-12 col-md-8">
                            <select class="form-select" v-model="dbType">
                                <option value="sqlite">SQLite (lokal)</option>
                                <option value="postgresql">PostgreSQL (remote)</option>
                            </select>
                        </div>
                    </div>

                    <!-- PostgreSQL-Felder -->
                    <template v-if="dbType === 'postgresql'">
                        <div class="row mt-2">
                            <div class="col-12 col-md-4">Host</div>
                            <div class="col-12 col-md-8">
                                <input type="text" class="form-control" v-model="dbHost" placeholder="z.B. 192.168.1.100" />
                            </div>
                        </div>
                        <div class="row mt-2">
                            <div class="col-12 col-md-4">Port</div>
                            <div class="col-12 col-md-8">
                                <input type="number" class="form-control" v-model="dbPort" placeholder="5432" />
                            </div>
                        </div>
                        <div class="row mt-2">
                            <div class="col-12 col-md-4">Benutzer</div>
                            <div class="col-12 col-md-8">
                                <input type="text" class="form-control" v-model="dbUser" placeholder="tradejournal" />
                            </div>
                        </div>
                        <div class="row mt-2">
                            <div class="col-12 col-md-4">Passwort</div>
                            <div class="col-12 col-md-8">
                                <input type="password" class="form-control" v-model="dbPassword" :placeholder="dbHasPassword ? '(gespeichert)' : 'Passwort'" />
                            </div>
                        </div>
                        <div class="row mt-2">
                            <div class="col-12 col-md-4">Datenbank</div>
                            <div class="col-12 col-md-8">
                                <input type="text" class="form-control" v-model="dbDatabase" placeholder="tradejournal" />
                            </div>
                        </div>
                    </template>

                    <!-- Buttons -->
                    <div class="mt-3 mb-3">
                        <button type="button" @click="saveDbConfig" class="btn btn-success me-2">Speichern</button>
                        <button v-if="dbType === 'postgresql'" type="button" @click="testDbConnection" class="btn btn-outline-primary" :disabled="dbTestLoading">
                            <span v-if="dbTestLoading">
                                <span class="spinner-border spinner-border-sm me-1"></span>Teste...
                            </span>
                            <span v-else>Verbindung testen</span>
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
                                <span class="spinner-border spinner-border-sm me-1"></span>Server wird neu gestartet...
                            </span>
                            <span v-else><i class="uil uil-redo me-1"></i>Server neu starten</span>
                        </button>
                    </div>

                    <!-- Export / Import -->
                    <div class="mt-3 pt-3" style="border-top: 1px solid var(--white-10);">
                        <p class="fw-bold mb-2">Backup</p>
                        <p class="fw-lighter small">Sichert alle Daten (Trades, Screenshots, Einstellungen, API-Keys, KI-Berichte, DB-Konfiguration) als JSON-Backup. API-Keys bleiben verschlüsselt.</p>
                        <div class="d-flex align-items-center gap-2">
                            <button type="button" @click="exportDb" class="btn btn-outline-primary btn-sm" :disabled="dbExportLoading">
                                <span v-if="dbExportLoading">
                                    <span class="spinner-border spinner-border-sm me-1"></span>Exportiere...
                                </span>
                                <span v-else><i class="uil uil-export me-1"></i>Export</span>
                            </button>
                            <button type="button" @click="importDb" class="btn btn-outline-warning btn-sm" :disabled="dbImportLoading">
                                <span v-if="dbImportLoading">
                                    <span class="spinner-border spinner-border-sm me-1"></span>Importiere...
                                </span>
                                <span v-else><i class="uil uil-import me-1"></i>Import</span>
                            </button>
                        </div>
                        <span v-if="dbMigrationResult" class="small mt-1 d-block" :class="dbMigrationResult.ok ? 'text-success' : 'text-danger'">
                            {{ dbMigrationResult.message }}
                        </span>
                    </div>
                </div>

                <hr />

                <!--=============== OHLC-CHART ===============-->
                <div class="d-flex align-items-center pointerClass" @click="chartExpanded = !chartExpanded">
                    <i class="uil me-2" :class="chartExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">OHLC-Chart</p>
                </div>
                <div v-show="chartExpanded" class="mt-2">
                    <p class="fw-lighter">Candlestick-Chart mit Binance-Daten im Trade-Detail anzeigen (kostenlos, kein API-Key nötig).</p>
                    <div class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" id="binanceToggle" v-model="enableBinanceChart" @change="saveBinanceSetting">
                        <label class="form-check-label" for="binanceToggle">Binance OHLC-Chart aktivieren</label>
                    </div>
                </div>

                <hr />

                <!--=============== TRADE-WERKZEUGE ===============-->
                <div class="d-flex align-items-center pointerClass" @click="reparaturExpanded = !reparaturExpanded">
                    <i class="uil me-2" :class="reparaturExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">Trade-Werkzeuge</p>
                </div>
                <div v-show="reparaturExpanded" class="mt-2">
                    <!-- Long/Short Reparatur -->
                    <p class="fw-lighter mb-1">Korrigiert die Long/Short-Zuordnung aller bestehenden Trades anhand von Entry/Exit-Preis und P&L-Richtung.</p>
                    <button class="btn btn-outline-warning btn-sm" @click="fixTradeSides" :disabled="fixTradesLoading">
                        <span v-if="fixTradesLoading">
                            <span class="spinner-border spinner-border-sm me-1" role="status"></span>Repariere...
                        </span>
                        <span v-else><i class="uil uil-wrench me-1"></i>Trades reparieren</span>
                    </button>
                    <div v-if="fixTradesResult" class="mt-2">
                        <div :class="fixTradesResult.success ? 'text-success' : 'text-danger'" class="txt-small">
                            {{ fixTradesResult.message }}
                        </div>
                    </div>

                    <hr class="my-3" style="opacity: 0.15;" />

                    <!-- Duplikate entfernen -->
                    <p class="fw-lighter mb-1">Erkennt und entfernt doppelt importierte Trades. Bewertete Trades (mit Notizen) werden nicht gelöscht.</p>
                    <button class="btn btn-outline-warning btn-sm" @click="removeDuplicateTrades" :disabled="removeDupsLoading">
                        <span v-if="removeDupsLoading">
                            <span class="spinner-border spinner-border-sm me-1" role="status"></span>Suche Duplikate...
                        </span>
                        <span v-else><i class="uil uil-copy me-1"></i>Duplikate entfernen</span>
                    </button>
                    <div v-if="removeDupsResult" class="mt-2">
                        <div :class="removeDupsResult.success ? 'text-success' : 'text-danger'" class="txt-small">
                            {{ removeDupsResult.message }}
                        </div>
                    </div>
                </div>

                <hr />

                <!--=============== IMPORTE ===============-->
                <div class="d-flex align-items-center pointerClass" @click="importsExpanded = !importsExpanded">
                    <i class="uil me-2" :class="importsExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">Importe</p>
                    <span class="badge bg-secondary ms-2">{{ importsList.length }}</span>
                </div>
                <div v-show="importsExpanded" class="mt-2">
                    <p class="fw-lighter">Sei vorsichtig beim Löschen von Importen. Screenshots, Tags, Notizen und Zufriedenheitsbewertungen bleiben erhalten.</p>

                    <div>
                        <div v-if="importsLoading" class="text-center">
                            <div class="spinner-border spinner-border-sm" role="status"></div>
                        </div>

                        <div v-else-if="importsList.length === 0">
                            <p class="text-muted">Keine Importe vorhanden.</p>
                        </div>

                        <div v-else>
                            <div v-for="data in importsList" :key="data.dateUnix" class="import-row mb-1">
                                <!-- Import Day Header -->
                                <div class="d-flex align-items-center justify-content-between p-2 pointerClass"
                                    style="background: var(--black-bg-3, #1a1a2e); border-radius: var(--border-radius, 6px);"
                                    @click="toggleImportExpand(data.dateUnix)">
                                    <div class="d-flex align-items-center gap-2">
                                        <i class="uil" :class="expandedImport === data.dateUnix ? 'uil-angle-down' : 'uil-angle-right'"></i>
                                        <span class="fw-bold">{{ useDateCalFormat(data.dateUnix) }}</span>
                                        <span class="badge bg-secondary">{{ getTradeCount(data) }} Trades</span>
                                        <span v-if="getEvaluatedCount(data) === getTradeCount(data) && getTradeCount(data) > 0"
                                            class="badge bg-success">Alle bewertet</span>
                                        <span v-else-if="getEvaluatedCount(data) > 0"
                                            class="badge bg-warning text-dark">{{ getEvaluatedCount(data) }}/{{ getTradeCount(data) }} bewertet</span>
                                        <span v-else-if="getTradeCount(data) > 0"
                                            class="badge bg-secondary" style="opacity: 0.6;">Nicht bewertet</span>
                                    </div>
                                    <div>
                                        <span v-if="deleteConfirm === data.dateUnix" @click.stop>
                                            <span class="me-2 small">Sicher?</span>
                                            <button class="btn btn-danger btn-sm me-1" @click.stop="executeDeleteImport(data.dateUnix)">Ja</button>
                                            <button class="btn btn-outline-secondary btn-sm" @click.stop="cancelDeleteImport">Nein</button>
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
</template>
