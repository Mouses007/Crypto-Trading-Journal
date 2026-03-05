<script setup>
import { ref, reactive, onBeforeMount, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue'
import { spinnerLoadingPage } from '../stores/ui.js'
import { aiReportGenerating, aiReportError, aiReportLastSavedId, aiReportLabel, aiReportCountBefore } from '../stores/settings.js'
import { selectedBroker } from '../stores/filters.js'
import axios from 'axios'
import { useExportReportPdf } from '../utils/pdfExport'
import { sanitizeHtml } from '../utils/sanitize'
import { logError, logWarn } from '../utils/logger.js'
import dayjs from '../utils/dayjs-setup.js'
import { sendNotification } from '../utils/notify'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// Status
const aiOnline = ref(false)
const aiProvider = ref('ollama')
const aiModel = ref('')
// loading und errorMsg sind global (überleben Tab-Wechsel im SPA)
const loading = aiReportGenerating
const errorMsg = aiReportError

// Zeitraum
const periodType = ref('month')
const selectedMonth = ref(dayjs().format('YYYY-MM'))
const selectedWeekStart = ref(dayjs().startOf('week').format('YYYY-MM-DD'))
const customStart = ref(dayjs().startOf('month').format('YYYY-MM-DD'))
const customEnd = ref(dayjs().format('YYYY-MM-DD'))

// Gespeicherte Berichte
const savedReports = reactive([])
const expandedReports = reactive(new Set())
const deleteConfirmId = ref(null)

// Tabs
const currentTab = ref('reports') // 'reports' | 'agent'

// Report-Stil Quick-Selection (alle außer 'custom')
const reportStylePresets = [
    { value: 'kurz', icon: 'uil-bolt', prompt: 'Halte den Bericht kurz und prägnant. Maximal 3-4 Sätze pro Abschnitt. Fokussiere dich auf die wichtigsten Erkenntnisse.' },
    { value: 'standard', icon: 'uil-file-alt', prompt: 'Erstelle einen ausgewogenen Trading-Bericht mit allen wichtigen Kennzahlen, Stärken, Schwächen und konkreten Verbesserungsvorschlägen. Nutze eine sachliche, professionelle Sprache.' },
    { value: 'coach', icon: 'uil-shield-exclamation', prompt: 'Sei sehr direkt und kritisch. Beschönige nichts. Sprich Schwächen und Fehler klar an. Gib konkrete Verbesserungsvorschläge wie ein strenger Trading-Coach.' },
    { value: 'psychologie', icon: 'uil-brain', prompt: 'Lege besonderen Fokus auf die psychologischen Aspekte: Stress, Emotionen, Disziplin, Overtrading. Analysiere Verhaltensmuster und emotionale Trigger.' }
]
const selectedReportStyle = ref('standard')

// Chat
const chatEnabled = ref(true)
const chatMessages = reactive({}) // { reportId: [{ id, role, content, createdAt }] }
const chatInput = reactive({}) // { reportId: 'text' }
const chatLoading = reactive({}) // { reportId: true/false }
const chatError = reactive({}) // { reportId: 'error msg' }

// ==================== AGENT STATE ====================
const agentSessions = reactive([])
const agentCurrentSessionId = ref(null)
const agentMessages = reactive([]) // Current session messages
const agentInput = ref('')
const agentLoading = ref(false)
const agentError = ref('')
const agentSteps = reactive([]) // Live SSE steps during agent run
const agentExpandedTools = reactive(new Set())
const agentDeleteConfirmId = ref(null)

// Token-Verbrauch pro Provider (nur Reports auf dieser Seite)
const tokensByProvider = computed(() => {
    const result = {}
    for (const r of savedReports) {
        const p = r.provider || 'unknown'
        if (r.totalTokens > 0) {
            result[p] = (result[p] || 0) + (r.totalTokens || 0)
        }
    }
    return result
})

// Globale Token-Statistik (alle Quellen: Reports + Chat + Trade-Reviews + Screenshot-Reviews)
const globalTokenStats = ref(null)

async function loadGlobalTokenStats() {
    try {
        const res = await axios.get('/api/ai/token-stats')
        globalTokenStats.value = res.data
    } catch (e) {
        logWarn('ki-agent', 'Token-Stats konnten nicht geladen werden', e)
    }
}

// Geschätzte Kosten pro Provider (basierend auf bekannten Preisen pro 1M Tokens)
// Preise in USD pro 1M Tokens: [input, output]
const MODEL_PRICES = {
    // OpenAI
    'gpt-4o':           [2.50, 10.00],
    'gpt-4o-mini':      [0.15, 0.60],
    'gpt-4-turbo':      [10.00, 30.00],
    'gpt-4':            [30.00, 60.00],
    'gpt-3.5-turbo':    [0.50, 1.50],
    'o1':               [15.00, 60.00],
    'o1-mini':          [3.00, 12.00],
    'o3-mini':          [1.10, 4.40],
    // Anthropic
    'claude-opus-4-6':   [5.00, 25.00],
    'claude-sonnet-4-6': [3.00, 15.00],
    'claude-sonnet-4-5': [3.00, 15.00],
    'claude-opus-4-0':   [15.00, 75.00],
    'claude-opus-4':     [15.00, 75.00],
    'claude-haiku-4-5':  [1.00, 5.00],
    'claude-haiku-3-5':  [0.80, 4.00],
    'claude-3-5-sonnet': [3.00, 15.00],
    'claude-3-haiku':    [0.25, 1.25],
    'claude-3-opus':     [15.00, 75.00],
    // Gemini
    'gemini-2.0-flash':  [0.10, 0.40],
    'gemini-1.5-flash':  [0.075, 0.30],
    'gemini-1.5-pro':    [1.25, 5.00],
    'gemini-2.0-pro':    [1.25, 10.00],
    // DeepSeek
    'deepseek-chat':     [0.14, 0.28],
    'deepseek-reasoner': [0.55, 2.19],
}

// Preis für ein Modell finden (fuzzy match)
function getModelPrice(model) {
    if (!model) return null
    const m = model.toLowerCase()
    // Exakter Match
    for (const [key, price] of Object.entries(MODEL_PRICES)) {
        if (m === key || m.startsWith(key)) return price
    }
    // Teilmatch (z.B. "claude-sonnet-4-5-20250929" → "claude-sonnet-4-5")
    for (const [key, price] of Object.entries(MODEL_PRICES)) {
        if (m.includes(key)) return price
    }
    return null
}

// Gesamtkosten berechnen (aus globalTokenStats — alle Quellen inkl. Agent)
const estimatedCostByProvider = computed(() => {
    const result = {}
    const bp = globalTokenStats.value?.byProvider || {}
    for (const [provider, data] of Object.entries(bp)) {
        let cost = 0
        // Versuche modellbasierte Berechnung
        for (const [model, mData] of Object.entries(data.models || {})) {
            const price = getModelPrice(model)
            if (price) {
                cost += (mData.promptTokens || 0) / 1_000_000 * price[0]
                cost += (mData.completionTokens || 0) / 1_000_000 * price[1]
            } else {
                // Fallback: Durchschnittspreis schätzen (Input $5, Output $15 pro 1M — Claude-Sonnet-Niveau)
                cost += (mData.promptTokens || 0) / 1_000_000 * 5
                cost += (mData.completionTokens || 0) / 1_000_000 * 15
            }
        }
        if (cost > 0) result[provider] = cost
    }
    return result
})

// Offsets: bisheriger Verbrauch vor Token-Tracking (≈58K Tokens / ~$0.50 vor Implementierung)
const AI_TOKEN_OFFSET = 58000
const AI_COST_OFFSET = 0.50
const totalEstimatedCost = computed(() => {
    return AI_COST_OFFSET + Object.values(estimatedCostByProvider.value).reduce((sum, c) => sum + c, 0)
})

const providerColors = { ollama: '#6c757d', openai: '#10a37f', anthropic: '#7c5cfc', gemini: '#4285f4', deepseek: '#0066ff' }
const providerNames = { ollama: 'Ollama', openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini', deepseek: 'DeepSeek' }

// Zeitraum als Unix berechnen
const dateRange = computed(() => {
    const type = periodType.value
    if (type === 'week') {
        const start = dayjs(selectedWeekStart.value).startOf('day')
        const end = start.add(6, 'day').endOf('day')
        return {
            startDate: start.unix(),
            endDate: end.unix(),
            label: t('kiAgent.weekLabel', { range: `${start.format('DD.MM.')} – ${end.format('DD.MM.YYYY')}` })
        }
    } else if (type === 'month') {
        const start = dayjs(selectedMonth.value + '-01').startOf('day')
        const end = start.endOf('month')
        return {
            startDate: start.unix(),
            endDate: end.unix(),
            label: start.format('MMMM YYYY')
        }
    } else if (type === 'halfyear') {
        const now = dayjs()
        const start = now.subtract(6, 'month').startOf('day')
        const end = now.endOf('day')
        return {
            startDate: start.unix(),
            endDate: end.unix(),
            label: `${start.format('DD.MM.YYYY')} – ${end.format('DD.MM.YYYY')}`
        }
    } else if (type === 'year') {
        const start = dayjs().startOf('year')
        const end = dayjs().endOf('day')
        return {
            startDate: start.unix(),
            endDate: end.unix(),
            label: t('kiAgent.yearLabel', { year: start.format('YYYY') })
        }
    } else {
        return {
            startDate: dayjs(customStart.value).startOf('day').unix(),
            endDate: dayjs(customEnd.value).endOf('day').unix(),
            label: `${dayjs(customStart.value).format('DD.MM.YYYY')} – ${dayjs(customEnd.value).format('DD.MM.YYYY')}`
        }
    }
})

// Provider-Label
const providerLabel = computed(() => {
    const labels = { ollama: 'Ollama', openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini', deepseek: 'DeepSeek' }
    return labels[aiProvider.value] || aiProvider.value
})

// Modell-Label (kurzer Name für Badge)
const modelLabel = computed(() => {
    if (!aiModel.value) return providerLabel.value
    // Kürze lange Modellnamen: "claude-sonnet-4-5-20250929" → "claude-sonnet-4-5"
    let name = aiModel.value
    name = name.replace(/[-:]\d{8,}$/, '') // Entferne Datums-Suffixe
    return name
})

// KI Status prüfen
async function checkStatus() {
    try {
        const res = await axios.get('/api/ai/status')
        aiOnline.value = res.data.online
        aiProvider.value = res.data.provider || 'ollama'
        aiModel.value = res.data.model || ''
    } catch (e) {
        aiOnline.value = false
    }
}

// Gespeicherte Berichte laden (gefiltert nach gewählter Börse)
async function loadReports() {
    try {
        const params = {}
        if (selectedBroker.value) params.broker = selectedBroker.value
        const res = await axios.get('/api/ai/reports', { params })
        savedReports.splice(0, savedReports.length, ...res.data)
    } catch (e) {
        logError('ki-agent', 'Fehler beim Laden der Berichte', e)
    }
}

// Bericht generieren (Server speichert automatisch)
async function generateReport() {
    if (loading.value) return // Doppelklick verhindern

    loading.value = true
    errorMsg.value = ''
    const label = dateRange.value.label
    aiReportLabel.value = label
    aiReportCountBefore.value = savedReports.length

    try {
        // Stil-Prompt für Quick-Selection mitschicken
        const stylePreset = reportStylePresets.find(p => p.value === selectedReportStyle.value)
        const res = await axios.post('/api/ai/report', {
            startDate: dateRange.value.startDate,
            endDate: dateRange.value.endDate,
            label,
            broker: selectedBroker.value || null,
            promptOverride: stylePreset?.prompt || null
        }, { timeout: 600000 })

        // Berichte neu laden und neuen aufklappen
        await loadReports()
        if (res.data.savedId) {
            expandedReports.add(res.data.savedId)
        }

        // Browser-Benachrichtigung
        sendNotification(t('kiAgent.reportReady'), t('kiAgent.reportCreated', { label }))
    } catch (e) {
        // Server hat evtl. schon gespeichert bevor der Frontend-Request abbrach
        try {
            await loadReports()
        } catch (reloadError) {
            logWarn('ki-agent', 'Berichte konnten nach Fehler nicht neu geladen werden', reloadError)
        }
        errorMsg.value = e.response?.data?.error || e.message || t('kiAgent.errorGenerating')
    }

    loading.value = false
}

// Bericht löschen
async function deleteReport(id) {
    try {
        await axios.delete(`/api/ai/reports/${id}`)
        expandedReports.delete(id)
        deleteConfirmId.value = null
        await loadReports()
    } catch (e) {
        logError('ki-agent', 'Fehler beim Löschen', e)
    }
}

// Bericht auf-/zuklappen
function toggleReport(id) {
    if (expandedReports.has(id)) {
        expandedReports.delete(id)
    } else {
        expandedReports.add(id)
        // Chat-Nachrichten laden wenn noch nicht vorhanden
        if (chatEnabled.value && !chatMessages[id]) {
            loadChatMessages(id)
        }
    }
}

// PDF Export
function downloadPdf(report) {
    if (!report.report) return
    useExportReportPdf(report.report, report.label, report.reportData || null)
}

// Datum formatieren
function formatDate(dateStr) {
    return dayjs(dateStr).format('DD.MM.YYYY HH:mm')
}

// Chat-Nachrichten laden
async function loadChatMessages(reportId) {
    try {
        const res = await axios.get(`/api/ai/reports/${reportId}/messages`)
        chatMessages[reportId] = res.data
    } catch (e) {
        chatMessages[reportId] = []
    }
}

// Chat-Nachricht senden
async function sendChatMessage(reportId) {
    const msg = (chatInput[reportId] || '').trim()
    if (!msg) return

    chatLoading[reportId] = true
    chatError[reportId] = ''

    try {
        const res = await axios.post(`/api/ai/reports/${reportId}/chat`, {
            message: msg
        }, { timeout: 600000 })

        chatInput[reportId] = ''
        // Nachrichten neu laden
        await loadChatMessages(reportId)
    } catch (e) {
        chatError[reportId] = e.response?.data?.error || e.message || t('kiAgent.chatRequestFailed')
    }

    chatLoading[reportId] = false
}

// Chat-Verlauf löschen
async function clearChat(reportId) {
    try {
        await axios.delete(`/api/ai/reports/${reportId}/messages`)
        chatMessages[reportId] = []
    } catch (e) {
        logError('ki-agent', 'Chat löschen fehlgeschlagen', e)
    }
}

// Chat-Setting laden
async function loadChatSetting() {
    try {
        const res = await axios.get('/api/ai/settings')
        chatEnabled.value = res.data.aiChatEnabled !== false
    } catch (e) {
        chatEnabled.value = true
    }
}

// Markdown → HTML (verbesserter Parser)
function markdownToHtml(md) {
    if (!md) return ''
    let html = md
        .replace(/^### (.+)$/gm, '<h5 class="mt-2 mb-1">$1</h5>')
        .replace(/^## (.+)$/gm, '<h4 class="report-section-title mt-3 mb-1">$1</h4>')
        .replace(/^# (.+)$/gm, '<h3 class="mt-3 mb-2">$1</h3>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul class="mb-1">${match}</ul>`)

    // Absätze (leere Blöcke filtern)
    html = html.split('\n\n').map(p => {
        const trimmed = p.trim()
        if (!trimmed) return ''
        if (trimmed.startsWith('<h') || trimmed.startsWith('<ul')) return trimmed
        return `<p>${trimmed}</p>`
    }).filter(Boolean).join('\n')

    return sanitizeHtml(html)
}

// ==================== AGENT FUNCTIONS ====================

async function loadAgentSessions() {
    try {
        const { data } = await axios.get('/api/ai/agent/sessions')
        agentSessions.splice(0, agentSessions.length, ...data)
    } catch (err) {
        logWarn('KiAgent', 'Failed to load agent sessions: ' + err.message)
    }
}

async function loadAgentSession(sessionId) {
    try {
        const { data } = await axios.get(`/api/ai/agent/sessions/${sessionId}`)
        agentCurrentSessionId.value = sessionId
        agentMessages.splice(0, agentMessages.length, ...(data.messages || []))
        agentSteps.splice(0)
        agentError.value = ''
    } catch (err) {
        agentError.value = 'Session konnte nicht geladen werden: ' + err.message
    }
}

function startNewAgentSession() {
    agentCurrentSessionId.value = null
    agentMessages.splice(0)
    agentSteps.splice(0)
    agentError.value = ''
    agentInput.value = ''
}

async function deleteAgentSession(sessionId) {
    try {
        await axios.delete(`/api/ai/agent/sessions/${sessionId}`)
        const idx = agentSessions.findIndex(s => s.id === sessionId)
        if (idx >= 0) agentSessions.splice(idx, 1)
        if (agentCurrentSessionId.value === sessionId) {
            startNewAgentSession()
        }
        agentDeleteConfirmId.value = null
    } catch (err) {
        agentError.value = 'Löschen fehlgeschlagen: ' + err.message
    }
}

async function sendAgentMessage() {
    const msg = agentInput.value.trim()
    if (!msg || agentLoading.value) return

    agentInput.value = ''
    agentLoading.value = true
    agentError.value = ''
    agentSteps.splice(0)

    // Add user message to UI immediately
    agentMessages.push({ role: 'user', content: msg, createdAt: new Date().toISOString() })

    try {
        const response = await fetch('/api/ai/agent/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: agentCurrentSessionId.value,
                message: msg
            })
        })

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() // Keep incomplete line

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue
                try {
                    const event = JSON.parse(line.slice(6))
                    handleAgentSSE(event)
                } catch { /* ignore parse errors */ }
            }
        }
    } catch (err) {
        agentError.value = 'Agent-Fehler: ' + err.message
    } finally {
        agentLoading.value = false
    }
}

function handleAgentSSE(event) {
    switch (event.type) {
        case 'session':
            agentCurrentSessionId.value = event.sessionId
            break
        case 'thinking':
            agentSteps.push({ type: 'thinking', iteration: event.iteration })
            break
        case 'tool_call':
            agentSteps.push({ type: 'tool_call', name: event.name, params: event.params })
            break
        case 'tool_result':
            agentSteps.push({ type: 'tool_result', name: event.name, resultPreview: event.resultPreview })
            break
        case 'answer':
            agentMessages.push({ role: 'assistant', content: event.content, createdAt: new Date().toISOString() })
            break
        case 'warning':
            agentSteps.push({ type: 'warning', content: event.content })
            break
        case 'error':
            agentError.value = event.content
            break
        case 'done':
            // Refresh sessions list
            loadAgentSessions()
            break
    }
}

function toggleAgentTool(index) {
    if (agentExpandedTools.has(index)) {
        agentExpandedTools.delete(index)
    } else {
        agentExpandedTools.add(index)
    }
}

function formatToolParams(params) {
    if (!params) return ''
    return Object.entries(params)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(', ')
}

const route = useRoute()
const vueRouter = useRouter()

// Capture agent prompt from query param BEFORE any async work
const pendingAgentPrompt = route.query.agentPrompt || null

onBeforeMount(async () => {
    spinnerLoadingPage.value = false

    // Switch tab immediately if agent prompt is pending
    if (pendingAgentPrompt) {
        currentTab.value = 'agent'
    }

    // Clean URL immediately (remove query param so it doesn't retrigger)
    if (route.query.agentPrompt) {
        vueRouter.replace({ path: route.path })
    }

    // Clean up any stale Bootstrap modal backdrops from previous page
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove())
    document.body.classList.remove('modal-open')
    document.body.style.removeProperty('overflow')
    document.body.style.removeProperty('padding-right')

    await Promise.all([checkStatus(), loadChatSetting()])
    await Promise.all([loadReports(), loadGlobalTokenStats(), loadAgentSessions()])

    // Auto-start agent after data is loaded (use setTimeout for DOM readiness)
    if (pendingAgentPrompt) {
        startNewAgentSession()
        agentInput.value = pendingAgentPrompt
        setTimeout(() => sendAgentMessage(), 150)
    }
})
</script>

<template>
    <SpinnerLoadingPage />
    <div class="row mt-2">
        <div v-show="!spinnerLoadingPage">

            <!-- Tab-Switcher -->
            <ul class="nav nav-pills mb-3" style="gap: 0.3rem;">
                <li class="nav-item">
                    <a class="nav-link" :class="{ active: currentTab === 'reports' }" href="#" @click.prevent="currentTab = 'reports'">
                        <i class="uil uil-file-alt me-1"></i>{{ t('kiAgent.tabReports') }}
                    </a>
                </li>
                <li class="nav-item">
                    <a class="nav-link" :class="{ active: currentTab === 'agent' }" href="#" @click.prevent="currentTab = 'agent'">
                        <i class="uil uil-brain me-1"></i>{{ t('kiAgent.tabAgent') }}
                    </a>
                </li>
            </ul>

            <!-- ==================== REPORTS TAB ==================== -->
            <div v-show="currentTab === 'reports'">

            <!-- Header -->
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h5 class="mb-0">
                    <i class="uil uil-file-alt me-2"></i>{{ t('kiAgent.createReport') }}
                </h5>
                <div class="d-flex align-items-center gap-2">
                    <span class="text-muted small" :title="t('kiAgent.totalTokensHint')">
                        <i class="uil uil-processor me-1"></i>{{ (AI_TOKEN_OFFSET + (globalTokenStats?.total?.totalTokens || Object.values(tokensByProvider).reduce((s, v) => s + v, 0) || 0)).toLocaleString() }} {{ t('kiAgent.tokens') }}
                    </span>
                    <span v-if="totalEstimatedCost > 0" class="ki-cost-badge" :title="t('kiAgent.estimatedCostTitle', { cost: totalEstimatedCost.toFixed(4) })">
                        <i class="uil uil-dollar-sign"></i>~{{ totalEstimatedCost < 0.01 ? totalEstimatedCost.toFixed(4) : totalEstimatedCost.toFixed(2) }}
                        <span class="ki-cost-hint">{{ t('kiAgent.estimated') }}</span>
                    </span>
                    <span class="badge" :class="aiOnline ? 'bg-success' : 'bg-danger'">
                        {{ aiOnline ? modelLabel + ' ' + t('kiAgent.online') : providerLabel + ' ' + t('kiAgent.offline') }}
                    </span>
                    <button class="btn btn-sm btn-outline-secondary" @click="checkStatus" :title="t('kiAgent.checkStatus')">
                        <i class="uil uil-sync"></i>
                    </button>
                </div>
            </div>

            <!-- Offline Warnung -->
            <div v-if="!aiOnline" class="dailyCard text-center py-4 mb-3">
                <i class="uil uil-exclamation-triangle text-warning" style="font-size: 2rem;"></i>
                <p class="mt-2 mb-1">{{ t('kiAgent.providerNotReachable') }}</p>
                <small v-if="aiProvider === 'ollama'" class="text-muted">
                    {{ t('kiAgent.ollamaDockerHint') }} <code>docker start ollama</code>
                </small>
                <small v-else class="text-muted" v-html="t('kiAgent.checkApiKey', { link: '<a href=\'/settings\'>' + t('nav.settings') + '</a>' })">
                </small>
            </div>

            <!-- Konfiguration -->
            <div v-if="aiOnline" class="dailyCard mb-3" style="height: auto; padding: 0.6em 1em;">
                <div class="row align-items-end g-2">

                    <!-- Zeitraum-Typ -->
                    <div class="col-auto">
                        <label class="form-label small text-muted">{{ t('kiAgent.period') }}</label>
                        <select v-model="periodType" class="form-select form-select-sm">
                            <option value="week">{{ t('kiAgent.periodWeek') }}</option>
                            <option value="month">{{ t('kiAgent.periodMonth') }}</option>
                            <option value="halfyear">{{ t('kiAgent.periodHalfYear') }}</option>
                            <option value="year">{{ t('kiAgent.periodYear') }}</option>
                            <option value="custom">{{ t('options.custom') }}</option>
                        </select>
                    </div>

                    <!-- Woche -->
                    <div v-if="periodType === 'week'" class="col-auto">
                        <label class="form-label small text-muted">{{ t('kiAgent.weekOf') }}</label>
                        <input type="date" v-model="selectedWeekStart" class="form-control form-control-sm">
                    </div>

                    <!-- Monat -->
                    <div v-if="periodType === 'month'" class="col-auto">
                        <label class="form-label small text-muted">{{ t('kiAgent.periodMonth') }}</label>
                        <input type="month" v-model="selectedMonth" class="form-control form-control-sm">
                    </div>

                    <!-- Custom Range -->
                    <div v-if="periodType === 'custom'" class="col-auto">
                        <label class="form-label small text-muted">{{ t('kiAgent.from') }}</label>
                        <input type="date" v-model="customStart" class="form-control form-control-sm">
                    </div>
                    <div v-if="periodType === 'custom'" class="col-auto">
                        <label class="form-label small text-muted">{{ t('kiAgent.to') }}</label>
                        <input type="date" v-model="customEnd" class="form-control form-control-sm">
                    </div>

                    <!-- Button -->
                    <div class="col-auto">
                        <button class="btn btn-sm btn-primary" @click="generateReport" :disabled="loading">
                            <span v-if="loading" class="spinner-border spinner-border-sm me-1"></span>
                            <i v-else class="uil uil-file-alt me-1"></i>
                            {{ loading ? t('kiAgent.generating') : t('kiAgent.generate') }}
                        </button>
                    </div>
                </div>

                <!-- Stil Quick-Selection -->
                <div class="d-flex align-items-center gap-2 mt-2 pt-2" style="border-top: 1px solid var(--white-18, rgba(255,255,255,0.08));">
                    <span class="text-muted small me-1"><i class="uil uil-palette me-1"></i>{{ t('kiAgent.reportStyle') }}:</span>
                    <button v-for="preset in reportStylePresets" :key="preset.value"
                        class="report-style-btn"
                        :class="{ active: selectedReportStyle === preset.value }"
                        @click="selectedReportStyle = preset.value"
                        :disabled="loading">
                        <i class="uil me-1" :class="preset.icon"></i>{{ t('settings.prompt_' + preset.value) }}
                    </button>
                </div>
            </div>

            <!-- Lade-Animation -->
            <div v-if="loading" class="dailyCard text-center py-5">
                <div class="spinner-border text-primary mb-3" role="status" style="width: 3rem; height: 3rem;">
                    <span class="visually-hidden">{{ t('common.loading') }}</span>
                </div>
                <p class="text-muted">{{ t('kiAgent.analyzing') }}</p>
                <small class="text-muted">{{ t('kiAgent.analyzeHint') }}</small>
            </div>

            <!-- Fehler -->
            <div v-if="errorMsg" class="alert alert-danger">
                <i class="uil uil-exclamation-circle me-1"></i>{{ errorMsg }}
            </div>

            <!-- Gespeicherte Berichte -->
            <div v-if="savedReports.length === 0 && !loading" class="dailyCard text-center py-4">
                <i class="uil uil-file-search-alt text-muted" style="font-size: 2rem;"></i>
                <p class="text-muted mt-2 mb-0">{{ t('kiAgent.noReports') }}</p>
            </div>

            <div v-for="report in savedReports" :key="report.id" class="dailyCard mb-2" style="height: auto;">
                <!-- Klickbarer Header -->
                <div class="d-flex justify-content-between align-items-center pointerClass" @click="toggleReport(report.id)">
                    <div class="d-flex align-items-center">
                        <i class="uil me-1" :class="expandedReports.has(report.id) ? 'uil-angle-down' : 'uil-angle-right'"></i>
                        <i class="uil uil-file-check-alt me-1"></i>
                        <span class="fw-bold me-2">{{ report.label }}</span>
                        <span class="badge bg-secondary me-2" style="font-size: 0.7rem;">{{ report.provider }}</span>
                        <span v-if="report.promptPreset" class="badge me-2" style="font-size: 0.65rem; background-color: var(--blue-color, #4a90d9); opacity: 0.8;">{{ report.promptPreset }}</span>
                        <span class="text-muted small">{{ formatDate(report.createdAt) }}</span>
                    </div>
                    <div class="d-flex align-items-center gap-1">
                        <!-- Kompakte Stats wenn zugeklappt -->
                        <span v-if="report.reportData && !expandedReports.has(report.id)" class="text-muted small me-2 d-none d-md-inline">
                            {{ report.reportData.tradeCount }} {{ t('common.trades') }} · {{ report.reportData.winRate }}% WR ·
                            <span :class="parseFloat(report.reportData.totalNetProceeds) >= 0 ? 'greenTrade' : 'redTrade'">
                                {{ report.reportData.totalNetProceeds }} USDT
                            </span>
                        </span>
                        <button class="btn btn-sm btn-outline-light" @click.stop="downloadPdf(report)" title="PDF">
                            <i class="uil uil-file-download"></i>
                        </button>
                        <!-- Löschen -->
                        <button v-if="deleteConfirmId !== report.id" class="btn btn-sm btn-outline-danger" @click.stop="deleteConfirmId = report.id" :title="t('kiAgent.deleteReport')">
                            <i class="uil uil-trash-alt"></i>
                        </button>
                        <span v-else class="d-flex align-items-center gap-1" @click.stop>
                            <button class="btn btn-sm btn-danger" @click="deleteReport(report.id)">{{ t('common.yes') }}</button>
                            <button class="btn btn-sm btn-outline-secondary" @click="deleteConfirmId = null">{{ t('common.no') }}</button>
                        </span>
                    </div>
                </div>

                <!-- Ausklappbarer Inhalt -->
                <div v-show="expandedReports.has(report.id)">
                    <!-- Datenbasis -->
                    <div v-if="report.reportData && report.reportData.tradeCount" class="row mt-2 mb-2 py-2" style="border-top: 1px solid var(--border-color, #333); border-bottom: 1px solid var(--border-color, #333);">
                        <div class="col-6 col-md-3 text-center">
                            <div class="text-muted small">{{ t('common.trades') }}</div>
                            <div class="fw-bold">{{ report.reportData.tradeCount }}</div>
                        </div>
                        <div class="col-6 col-md-3 text-center">
                            <div class="text-muted small">{{ t('dashboard.winRate') }}</div>
                            <div class="fw-bold">{{ report.reportData.winRate }}%</div>
                        </div>
                        <div class="col-6 col-md-3 text-center">
                            <div class="text-muted small">{{ t('dashboard.netPnl') }}</div>
                            <div class="fw-bold" :class="parseFloat(report.reportData.totalNetProceeds) >= 0 ? 'greenTrade' : 'redTrade'">
                                {{ report.reportData.totalNetProceeds }} USDT
                            </div>
                        </div>
                        <div class="col-6 col-md-3 text-center">
                            <div class="text-muted small">{{ t('options.profitFactor') }}</div>
                            <div class="fw-bold">{{ report.reportData.profitFactor }}</div>
                        </div>
                    </div>

                    <!-- Bericht-Text -->
                    <div class="report-content" v-html="markdownToHtml(report.report)"></div>

                    <!-- Token-Verbrauch -->
                    <div class="d-flex align-items-center gap-3 mt-2 pt-2 text-muted small" style="border-top: 1px solid var(--border-color, #333);">
                        <span><i class="uil uil-processor me-1"></i>{{ report.model || '—' }}</span>
                        <span>{{ t('kiAgent.prompt') }}: {{ report.totalTokens > 0 ? report.promptTokens?.toLocaleString() : '—' }}</span>
                        <span>{{ t('kiAgent.response') }}: {{ report.totalTokens > 0 ? report.completionTokens?.toLocaleString() : '—' }}</span>
                        <span class="fw-bold">{{ t('kiAgent.total') }}: {{ report.totalTokens > 0 ? report.totalTokens?.toLocaleString() + ' ' + t('kiAgent.tokens') : '—' }}</span>
                    </div>

                    <!-- Chat / Rückfragen -->
                    <div v-if="chatEnabled && aiOnline" class="chat-section mt-3 pt-3" style="border-top: 1px solid var(--border-color, #333);">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <span class="small fw-bold"><i class="uil uil-comment-dots me-1"></i>{{ t('kiAgent.followUp') }}</span>
                            <button v-if="chatMessages[report.id]?.length > 0" class="btn btn-sm btn-outline-secondary" @click="clearChat(report.id)" :title="t('kiAgent.clearChat')">
                                <i class="uil uil-trash-alt me-1"></i>{{ t('kiAgent.clearChat') }}
                            </button>
                        </div>

                        <!-- Chat-Verlauf -->
                        <div v-if="chatMessages[report.id]?.length > 0" class="chat-messages mb-2">
                            <div v-for="msg in chatMessages[report.id]" :key="msg.id" class="chat-msg mb-2" :class="'chat-msg-' + msg.role">
                                <div class="d-flex align-items-center gap-1 mb-1">
                                    <i class="uil" :class="msg.role === 'user' ? 'uil-user' : 'uil-robot'"></i>
                                    <span class="small fw-bold">{{ msg.role === 'user' ? t('kiAgent.you') : t('kiAgent.ai') }}</span>
                                    <span class="text-muted small ms-1">{{ formatDate(msg.createdAt) }}</span>
                                    <span v-if="msg.role === 'assistant' && msg.totalTokens > 0" class="text-muted small ms-auto">{{ msg.totalTokens }} {{ t('kiAgent.tokens') }}</span>
                                </div>
                                <div v-if="msg.role === 'user'" class="chat-bubble chat-bubble-user">{{ msg.content }}</div>
                                <div v-else class="chat-bubble chat-bubble-ai report-content" v-html="markdownToHtml(msg.content)"></div>
                            </div>
                        </div>

                        <!-- Loading -->
                        <div v-if="chatLoading[report.id]" class="text-center py-3">
                            <span class="spinner-border spinner-border-sm me-1"></span>
                            <span class="text-muted small">{{ t('kiAgent.aiThinking') }}</span>
                        </div>

                        <!-- Error -->
                        <div v-if="chatError[report.id]" class="alert alert-danger py-1 px-2 small mb-2">
                            {{ chatError[report.id] }}
                        </div>

                        <!-- Input -->
                        <div class="d-flex gap-2 align-items-end">
                            <textarea class="form-control form-control-sm chat-input" rows="3" :placeholder="t('kiAgent.askFollowUp')"
                                v-model="chatInput[report.id]"
                                @keydown.enter.exact.prevent="sendChatMessage(report.id)"
                                :disabled="chatLoading[report.id]"></textarea>
                            <button class="btn btn-sm btn-primary" style="height: 2.4rem;" @click="sendChatMessage(report.id)" :disabled="chatLoading[report.id] || !(chatInput[report.id] || '').trim()">
                                <i class="uil uil-message"></i>
                            </button>
                        </div>
                        <small class="text-muted mt-1">{{ t('kiAgent.chatInputHint') }}</small>
                    </div>
                </div>
            </div>

        </div> <!-- end reports tab -->

            <!-- ==================== AGENT TAB ==================== -->
            <div v-show="currentTab === 'agent'">

                <!-- Header -->
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <h5 class="mb-0">
                        <i class="uil uil-brain me-2"></i>{{ t('kiAgent.agentTitle') }}
                    </h5>
                    <div class="d-flex align-items-center gap-2">
                        <span class="badge" :class="aiOnline ? 'bg-success' : 'bg-danger'">
                            {{ aiOnline ? modelLabel + ' ' + t('kiAgent.online') : providerLabel + ' ' + t('kiAgent.offline') }}
                        </span>
                        <button class="btn btn-sm btn-outline-primary" @click="startNewAgentSession" :title="t('kiAgent.newSession')">
                            <i class="uil uil-plus me-1"></i>{{ t('kiAgent.newSession') }}
                        </button>
                    </div>
                </div>

                <!-- Offline -->
                <div v-if="!aiOnline" class="dailyCard text-center py-4 mb-3">
                    <i class="uil uil-exclamation-triangle text-warning" style="font-size: 2rem;"></i>
                    <p class="mt-2 mb-1">{{ t('kiAgent.providerNotReachable') }}</p>
                </div>

                <div v-if="aiOnline" class="row">
                    <!-- Session-Liste (links) -->
                    <div class="col-12 col-md-3 mb-3">
                        <div class="dailyCard" style="height: auto; max-height: 70vh; overflow-y: auto; padding: 0.5em;">
                            <div class="small fw-bold mb-2"><i class="uil uil-history me-1"></i>{{ t('kiAgent.sessions') }}</div>
                            <div v-if="agentSessions.length === 0" class="text-muted small text-center py-2">
                                {{ t('kiAgent.noSessions') }}
                            </div>
                            <div v-for="s in agentSessions" :key="s.id"
                                class="agent-session-item p-2 mb-1 rounded pointerClass"
                                :class="{ 'agent-session-active': agentCurrentSessionId === s.id }"
                                @click="loadAgentSession(s.id)">
                                <div class="small fw-bold text-truncate" style="max-width: 100%;">{{ s.title || 'Session ' + s.id }}</div>
                                <div class="d-flex justify-content-between align-items-center">
                                    <span class="text-muted" style="font-size: 0.65rem;">{{ formatDate(s.updatedAt || s.createdAt) }}</span>
                                    <span v-if="agentDeleteConfirmId !== s.id"
                                        class="text-danger" style="font-size: 0.7rem; cursor: pointer;"
                                        @click.stop="agentDeleteConfirmId = s.id">
                                        <i class="uil uil-trash-alt"></i>
                                    </span>
                                    <span v-else class="d-flex gap-1" @click.stop>
                                        <button class="btn btn-danger" style="font-size: 0.6rem; padding: 0 0.3rem;" @click="deleteAgentSession(s.id)">{{ t('common.yes') }}</button>
                                        <button class="btn btn-outline-secondary" style="font-size: 0.6rem; padding: 0 0.3rem;" @click="agentDeleteConfirmId = null">{{ t('common.no') }}</button>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Chat-Bereich (rechts) -->
                    <div class="col-12 col-md-9">
                        <div class="dailyCard" style="height: auto; min-height: 50vh; display: flex; flex-direction: column; padding: 0.8em;">

                            <!-- Chat-Verlauf -->
                            <div class="agent-chat-messages flex-grow-1 mb-3" style="overflow-y: auto; max-height: 60vh;">
                                <div v-if="agentMessages.length === 0 && !agentLoading" class="text-center text-muted py-5">
                                    <i class="uil uil-brain" style="font-size: 3rem; opacity: 0.3;"></i>
                                    <p class="mt-2 mb-0">{{ t('kiAgent.agentWelcome') }}</p>
                                    <small>{{ t('kiAgent.agentHint') }}</small>
                                </div>

                                <template v-for="(msg, idx) in agentMessages" :key="idx">
                                    <!-- User Message -->
                                    <div v-if="msg.role === 'user'" class="chat-msg mb-2">
                                        <div class="d-flex align-items-center gap-1 mb-1">
                                            <i class="uil uil-user"></i>
                                            <span class="small fw-bold">{{ t('kiAgent.you') }}</span>
                                        </div>
                                        <div class="chat-bubble chat-bubble-user">{{ msg.content }}</div>
                                    </div>

                                    <!-- Tool Messages -->
                                    <div v-if="msg.role === 'tool'" class="agent-tool-step mb-1 ms-3">
                                        <div class="d-flex align-items-center gap-1 pointerClass" @click="toggleAgentTool(idx)">
                                            <i class="uil uil-cog" style="color: #a78bfa;"></i>
                                            <span class="small" style="color: #a78bfa;">{{ msg.toolName }}</span>
                                            <i class="uil" :class="agentExpandedTools.has(idx) ? 'uil-angle-down' : 'uil-angle-right'" style="font-size: 0.7rem;"></i>
                                        </div>
                                        <div v-if="agentExpandedTools.has(idx)" class="agent-tool-detail mt-1 p-2 rounded" style="background: rgba(167, 139, 250, 0.08); font-size: 0.75rem; max-height: 200px; overflow-y: auto;">
                                            <pre style="white-space: pre-wrap; word-break: break-word; margin: 0; color: var(--white-60);">{{ msg.content?.substring(0, 2000) }}</pre>
                                        </div>
                                    </div>

                                    <!-- Assistant Message -->
                                    <div v-if="msg.role === 'assistant'" class="chat-msg mb-2">
                                        <div class="d-flex align-items-center gap-1 mb-1">
                                            <i class="uil uil-robot"></i>
                                            <span class="small fw-bold">{{ t('kiAgent.agent') }}</span>
                                        </div>
                                        <div class="chat-bubble chat-bubble-ai report-content" v-html="markdownToHtml(msg.content)"></div>
                                    </div>
                                </template>

                                <!-- Live Steps (during agent run) -->
                                <div v-if="agentLoading" class="ms-3 mb-2">
                                    <div v-for="(step, si) in agentSteps" :key="si" class="agent-live-step mb-1">
                                        <template v-if="step.type === 'thinking'">
                                            <span class="spinner-border spinner-border-sm me-1" style="width: 0.7rem; height: 0.7rem;"></span>
                                            <span class="text-muted small">{{ t('kiAgent.agentThinking') }} ({{ step.iteration }})</span>
                                        </template>
                                        <template v-if="step.type === 'tool_call'">
                                            <i class="uil uil-cog me-1" style="color: #a78bfa;"></i>
                                            <span class="small" style="color: #a78bfa;">{{ step.name }}</span>
                                            <span class="text-muted small ms-1">({{ formatToolParams(step.params) }})</span>
                                        </template>
                                        <template v-if="step.type === 'tool_result'">
                                            <i class="uil uil-check-circle me-1" style="color: #34d399;"></i>
                                            <span class="small" style="color: #34d399;">{{ step.name }}: {{ step.resultPreview }}</span>
                                        </template>
                                        <template v-if="step.type === 'warning'">
                                            <i class="uil uil-exclamation-triangle me-1 text-warning"></i>
                                            <span class="small text-warning">{{ step.content }}</span>
                                        </template>
                                    </div>
                                    <div class="text-center py-2">
                                        <span class="spinner-border spinner-border-sm me-1"></span>
                                        <span class="text-muted small">{{ t('kiAgent.agentWorking') }}</span>
                                    </div>
                                </div>
                            </div>

                            <!-- Error -->
                            <div v-if="agentError" class="alert alert-danger py-1 px-2 small mb-2">
                                {{ agentError }}
                            </div>

                            <!-- Input -->
                            <div class="d-flex gap-2 align-items-end mt-auto">
                                <textarea class="form-control form-control-sm chat-input" rows="2"
                                    :placeholder="t('kiAgent.agentPlaceholder')"
                                    v-model="agentInput"
                                    @keydown.enter.exact.prevent="sendAgentMessage"
                                    :disabled="agentLoading || !aiOnline"></textarea>
                                <button class="btn btn-sm btn-primary" style="height: 2.4rem;"
                                    @click="sendAgentMessage"
                                    :disabled="agentLoading || !agentInput.trim() || !aiOnline">
                                    <i class="uil uil-message"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div> <!-- end agent tab -->

        </div>
    </div>
</template>

<style scoped>
/* Report-Style Quick-Selection */
.report-style-btn {
    display: inline-flex;
    align-items: center;
    font-size: 0.78rem;
    padding: 0.2rem 0.55rem;
    border: 1px solid var(--white-18, rgba(255,255,255,0.15));
    border-radius: 4px;
    color: var(--white-60, rgba(255,255,255,0.6));
    background: transparent;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
}
.report-style-btn:hover:not(:disabled) {
    border-color: var(--blue-color, #6cb4ee);
    color: var(--blue-color, #6cb4ee);
}
.report-style-btn.active {
    border-color: var(--blue-color, #6cb4ee);
    color: var(--blue-color, #6cb4ee);
    background: rgba(108, 180, 238, 0.1);
}
.report-style-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

/* Kosten-Badge */
.ki-cost-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.72rem;
    padding: 0.15rem 0.5rem;
    border: 1px solid rgba(245, 158, 11, 0.3);
    border-radius: 4px;
    color: #f59e0b;
    background: rgba(245, 158, 11, 0.08);
    cursor: default;
}

.ki-cost-hint {
    font-size: 0.6rem;
    opacity: 0.6;
    font-style: italic;
}

.report-content :deep(h3) {
    color: var(--white-87);
    font-size: 1.1rem;
    margin-top: 0.8rem;
    margin-bottom: 0.4rem;
}
.report-content :deep(h4.report-section-title) {
    font-size: 1rem;
    color: var(--blue-color, #6cb4ee);
    border-bottom: 1px solid var(--border-color, #333);
    padding-bottom: 0.3rem;
    margin-top: 1rem;
    margin-bottom: 0.4rem;
}
.report-content :deep(h4) {
    font-size: 1rem;
    margin-top: 0.8rem;
    margin-bottom: 0.3rem;
}
.report-content :deep(h5) {
    font-size: 0.9rem;
    color: var(--white-60);
    margin-top: 0.5rem;
    margin-bottom: 0.2rem;
}
.report-content :deep(p) {
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--white-87);
    margin-bottom: 0.4rem;
}
.report-content :deep(ul) {
    padding-left: 1.2rem;
    margin-bottom: 0.4rem;
}
.report-content :deep(li) {
    font-size: 0.85rem;
    color: var(--white-87);
    margin-bottom: 0.15rem;
}
.report-content :deep(strong) {
    color: var(--white-100, #fff);
}
/* Chat-CSS ist in style-dark.css global */

/* Tab-Styling */
.nav-pills .nav-link {
    color: var(--white-60);
    background: transparent;
    border: 1px solid var(--border-color, #333);
    font-size: 0.85rem;
    padding: 0.3rem 0.8rem;
}
.nav-pills .nav-link.active {
    color: #fff;
    background: var(--blue-color, #4a90d9);
    border-color: var(--blue-color, #4a90d9);
}

/* Agent Session List */
.agent-session-item {
    border: 1px solid transparent;
    transition: all 0.15s;
}
.agent-session-item:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: var(--border-color, #333);
}
.agent-session-active {
    background: rgba(74, 144, 217, 0.15) !important;
    border-color: var(--blue-color, #4a90d9) !important;
}

/* Agent Tool Steps */
.agent-live-step {
    display: flex;
    align-items: center;
    padding: 0.15rem 0;
}
.agent-tool-step {
    border-left: 2px solid rgba(167, 139, 250, 0.3);
    padding-left: 0.5rem;
}

</style>
