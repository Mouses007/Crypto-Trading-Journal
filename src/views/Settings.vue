<script setup>
import { onBeforeMount, onMounted, ref, reactive } from 'vue';
import { useCheckCurrentUser, useInitTooltip, useDateCalFormat } from '../utils/utils';
import { currentUser, renderProfile, allTradeTimeframes, selectedTradeTimeframes } from '../stores/globals';
import { dbUpdateSettings, dbGetSettings, dbFind, dbFirst, dbDelete, dbDeleteWhere } from '../utils/db.js'
import axios from 'axios'
import dayjs from 'dayjs'

let profileAvatar = null
let username = ref('')
let startBalance = ref(0)
let currentBalance = ref(0)
let bitunixApiKey = ref('')
let bitunixSecretKey = ref('')
let bitunixTestResult = ref(null)
let bitunixTestLoading = ref(false)
let showTradePopups = ref(true)
let enableBinanceChart = ref(false)
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

/* KI-AGENT SETTINGS */
let aiProvider = ref('ollama')
let aiModel = ref('')
let aiApiKey = ref('')
let aiOllamaUrl = ref('http://localhost:11434')
let aiTemperature = ref(0.7)
let aiMaxTokens = ref(1500)
let aiTestLoading = ref(false)
let aiTestResult = ref(null)
let ollamaModels = ref([])

const openaiModels = ['gpt-4o-mini', 'gpt-4o']
const anthropicModels = ['claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001']

const availableModels = {
    ollama: () => ollamaModels.value,
    openai: () => openaiModels,
    anthropic: () => anthropicModels
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
        await dbUpdateSettings({
            aiProvider: aiProvider.value,
            aiModel: aiModel.value,
            aiApiKey: aiApiKey.value,
            aiOllamaUrl: aiOllamaUrl.value || 'http://localhost:11434',
            aiTemperature: parseFloat(aiTemperature.value) || 0.7,
            aiMaxTokens: parseInt(aiMaxTokens.value) || 1500
        })
        currentUser.value.aiProvider = aiProvider.value
        currentUser.value.aiModel = aiModel.value
        currentUser.value.aiOllamaUrl = aiOllamaUrl.value
        currentUser.value.aiTemperature = aiTemperature.value
        currentUser.value.aiMaxTokens = aiMaxTokens.value
        console.log(' -> KI-Einstellungen gespeichert')
        aiTestResult.value = { success: true, message: 'Gespeichert!' }
        setTimeout(() => aiTestResult.value = null, 3000)
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
            apiKey: aiApiKey.value,
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
        aiApiKey.value = ''
        loadOllamaModels()
    }
}
let localTimeframes = reactive(new Set())

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
        if (response.data.hasSecret) {
            bitunixSecretKey.value = '••••••••'
        }
    } catch (error) {
        console.log(' -> Error loading Bitunix config: ' + error)
    }
}

async function saveBitunixConfig() {
    try {
        const data = { apiKey: bitunixApiKey.value }
        if (bitunixSecretKey.value && bitunixSecretKey.value !== '••••••••') {
            data.secretKey = bitunixSecretKey.value
        }
        await axios.post('/api/bitunix/config', data)
        alert('Bitunix API config saved')
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

async function loadImports() {
    importsLoading.value = true
    try {
        const results = await dbFind('trades', { descending: 'dateUnix', limit: 10000 })
        importsList.length = 0
        results.forEach(r => importsList.push(r))
    } catch (error) {
        console.log(' -> Error loading imports: ' + error)
    }
    importsLoading.value = false
}

async function confirmDeleteImport(dateUnix) {
    deleteConfirm.value = dateUnix
}

async function cancelDeleteImport() {
    deleteConfirm.value = null
}

async function executeDeleteImport(dateUnix) {
    try {
        // Find and delete trade
        const existing = await dbFirst('trades', { equalTo: { dateUnix: dateUnix } })
        if (existing) {
            await dbDelete('trades', existing.objectId)
            console.log(' -> Deleted trade for dateUnix ' + dateUnix)
        }
        // Delete related excursions
        try {
            await dbDeleteWhere('excursions', { equalTo: { dateUnix: dateUnix } })
        } catch (e) { /* ignore */ }

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

// Load imports on mount
/* KONTOSTAND */
async function saveBalances() {
    try {
        const start = parseFloat(startBalance.value) || 0
        const current = parseFloat(currentBalance.value) || 0
        await dbUpdateSettings({ startBalance: start, currentBalance: current })
        currentUser.value.startBalance = start
        currentUser.value.currentBalance = current
        console.log(' -> Kontostände gespeichert: Start', start, '/ Aktuell', current)
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
        await dbUpdateSettings({ tradeTimeframes: arr })
        currentUser.value.tradeTimeframes = arr
        // Globales reactive Array aktualisieren
        selectedTradeTimeframes.splice(0)
        arr.forEach(v => selectedTradeTimeframes.push(v))
        console.log(' -> Timeframes gespeichert:', arr)
    } catch (error) {
        alert('Fehler beim Speichern: ' + error.message)
    }
}

// Timeframe-Gruppen für die Anzeige
const timeframeGroups = ['Minuten', 'Stunden', 'Tage']
function timeframesByGroup(group) {
    return allTradeTimeframes.filter(tf => tf.group === group)
}

onBeforeMount(async () => {
    // Settings direkt von der API laden (nicht auf currentUser verlassen,
    // da das Layout's useInitParse() evtl. noch nicht fertig ist)
    let settings = null
    try {
        settings = await dbGetSettings()
        currentUser.value = settings
        username.value = settings.username || ''
        startBalance.value = settings.startBalance || 0
        currentBalance.value = settings.currentBalance || 0
        showTradePopups.value = settings.showTradePopups !== 0
        enableBinanceChart.value = settings.enableBinanceChart === 1
        // Timeframes laden
        const saved = settings.tradeTimeframes || []
        localTimeframes.clear()
        if (Array.isArray(saved)) {
            saved.forEach(v => localTimeframes.add(v))
        }
    } catch (error) {
        console.log(' -> Error loading settings:', error)
        username.value = currentUser.value?.username || ''
        startBalance.value = currentUser.value?.startBalance || 0
        currentBalance.value = currentUser.value?.currentBalance || 0
    }
    // KI-Settings laden
    aiProvider.value = settings?.aiProvider || 'ollama'
    aiModel.value = settings?.aiModel || ''
    aiApiKey.value = settings?.aiApiKey || ''
    aiOllamaUrl.value = settings?.aiOllamaUrl || 'http://localhost:11434'
    aiTemperature.value = settings?.aiTemperature ?? 0.7
    aiMaxTokens.value = settings?.aiMaxTokens || 1500
    if (aiProvider.value === 'ollama') {
        await loadOllamaModels()
    }
    // Falls kein Modell gesetzt, Default setzen
    if (!aiModel.value) {
        const models = getModelsForProvider()
        aiModel.value = models.length > 0 ? models[0] : ''
    }

    await loadBitunixConfig()
    await loadTags()
    await loadImports()
    await loadPopupSetting()
})

</script>

<template>
    <div class="row mt-2">
        <div class="row justify-content-md-center">
            <div class="col-12 col-md-8">
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
                    <p class="fw-lighter">Start-Kontostand = deine Einzahlung. Aktueller Kontostand = dein heutiger Stand auf Bitunix. Gewinn wird als Differenz berechnet.</p>
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">Start-Kontostand (USDT)</div>
                        <div class="col-12 col-md-8">
                            <input type="number" class="form-control" v-model="startBalance" placeholder="z.B. 1000" step="0.01" />
                        </div>
                    </div>
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">Aktueller Kontostand (USDT)</div>
                        <div class="col-12 col-md-8">
                            <input type="number" class="form-control" v-model="currentBalance" placeholder="z.B. 1150" step="0.01" />
                        </div>
                    </div>
                    <div class="mt-3 mb-3">
                        <button type="button" v-on:click="saveBalances" class="btn btn-success">Speichern</button>
                    </div>
                </div>

                <hr />

                <!--=============== TIMEFRAMES ===============-->
                <div class="d-flex align-items-center pointerClass" @click="timeframesExpanded = !timeframesExpanded">
                    <i class="uil me-2" :class="timeframesExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">Timeframes</p>
                </div>
                <div v-show="timeframesExpanded" class="mt-2 row align-items-center">
                    <p class="fw-lighter">Wähle die Timeframes aus, die du beim Trading verwendest. Diese erscheinen dann in Offene Trades und Playbook.</p>
                    <div v-for="group in timeframeGroups" :key="group" class="mb-2">
                        <label class="fw-lighter text-uppercase small mb-1">{{ group }}</label>
                        <div class="d-flex flex-wrap gap-1">
                            <span v-for="tf in timeframesByGroup(group)" :key="tf.value"
                                class="tag-badge" :class="{ active: localTimeframes.has(tf.value) }"
                                v-on:click="toggleTimeframe(tf.value)">{{ tf.label }}</span>
                        </div>
                    </div>
                    <div class="mt-3 mb-3">
                        <button type="button" v-on:click="saveTimeframes" class="btn btn-success">Speichern</button>
                    </div>
                </div>

                <hr />

                <!--=============== BITUNIX API ===============-->
                <div class="d-flex align-items-center pointerClass" @click="apiExpanded = !apiExpanded">
                    <i class="uil me-2" :class="apiExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">Bitunix API</p>
                </div>
                <div v-show="apiExpanded" class="mt-2 row align-items-center">
                    <p class="fw-lighter">Verbinde dein Bitunix-Konto, um Trades mit allen Details (Symbol, Preise, Richtung) zu importieren.</p>
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">API Key</div>
                        <div class="col-12 col-md-8">
                            <input type="text" class="form-control" v-model="bitunixApiKey" placeholder="Enter API Key" />
                        </div>
                    </div>
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">Secret Key</div>
                        <div class="col-12 col-md-8">
                            <input type="password" class="form-control" v-model="bitunixSecretKey" placeholder="Enter Secret Key" />
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

                <hr />

                <!--=============== TAGS ===============-->
                <div class="d-flex align-items-center pointerClass" @click="tagsExpanded = !tagsExpanded">
                    <i class="uil me-2" :class="tagsExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">Tags</p>
                </div>
                <div v-show="tagsExpanded" class="mt-2">
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
                                <button class="btn btn-outline-secondary btn-sm me-1" @click="startEditGroup(group)"><i class="uil uil-pen"></i></button>
                                <button class="btn btn-outline-danger btn-sm" @click="removeGroup(group.id)"><i class="uil uil-trash-alt"></i></button>
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
                </div>

                <hr />

                <!--=============== BEWERTUNG ===============-->
                <div class="d-flex align-items-center pointerClass" @click="bewertungExpanded = !bewertungExpanded">
                    <i class="uil me-2" :class="bewertungExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">Bewertung</p>
                </div>
                <div v-show="bewertungExpanded" class="mt-2">
                    <p class="fw-lighter">Trade-Bewertungs-Popups beim Öffnen und Schließen von Positionen anzeigen.</p>
                    <div class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" id="popupToggle" v-model="showTradePopups" @change="savePopupSetting">
                        <label class="form-check-label" for="popupToggle">Bewertungs-Popups aktivieren</label>
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

                <!--=============== KI-AGENT ===============-->
                <div class="d-flex align-items-center pointerClass" @click="kiExpanded = !kiExpanded">
                    <i class="uil me-2" :class="kiExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">KI-Agent</p>
                </div>
                <div v-show="kiExpanded" class="mt-2">
                    <p class="fw-lighter">Konfiguriere den KI-Anbieter für die automatische Berichterstellung. Ollama (lokal, kostenlos) oder Online-KI (OpenAI/Anthropic, benötigt API-Key).</p>

                    <!-- Anbieter -->
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">Anbieter</div>
                        <div class="col-12 col-md-8">
                            <select class="form-select" v-model="aiProvider" @change="onProviderChange">
                                <option value="ollama">Ollama (lokal)</option>
                                <option value="openai">OpenAI</option>
                                <option value="anthropic">Anthropic (Claude)</option>
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
                            <input type="password" class="form-control" v-model="aiApiKey" placeholder="API-Key eingeben..." />
                            <small class="text-muted">
                                <span v-if="aiProvider === 'openai'">Von platform.openai.com/api-keys</span>
                                <span v-if="aiProvider === 'anthropic'">Von console.anthropic.com/settings/keys</span>
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

                <!--=============== TRADE-REPARATUR ===============-->
                <div class="d-flex align-items-center pointerClass" @click="reparaturExpanded = !reparaturExpanded">
                    <i class="uil me-2" :class="reparaturExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <p class="fs-5 fw-bold mb-0">Trade-Reparatur</p>
                </div>
                <div v-show="reparaturExpanded" class="mt-2">
                    <p class="fw-lighter">Korrigiert die Long/Short-Zuordnung aller bestehenden Trades anhand von Entry/Exit-Preis und P&L-Richtung.</p>
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

                        <table v-else class="table">
                            <thead>
                                <tr>
                                    <th>Datum</th>
                                    <th class="text-end">Aktion</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="data in importsList" :key="data.dateUnix">
                                    <td>{{ useDateCalFormat(data.dateUnix) }}</td>
                                    <td class="text-end">
                                        <span v-if="deleteConfirm === data.dateUnix">
                                            <span class="me-2">Sicher?</span>
                                            <button class="btn btn-danger btn-sm me-1" @click="executeDeleteImport(data.dateUnix)">Ja</button>
                                            <button class="btn btn-outline-secondary btn-sm" @click="cancelDeleteImport">Nein</button>
                                        </span>
                                        <i v-else class="uil uil-trash-alt pointerClass text-danger" @click="confirmDeleteImport(data.dateUnix)"></i>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        </div>

    </div>
</template>
