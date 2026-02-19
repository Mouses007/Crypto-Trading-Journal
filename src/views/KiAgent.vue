<script setup>
import { ref, reactive, onBeforeMount, computed } from 'vue'
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

// Chat
const chatEnabled = ref(true)
const chatMessages = reactive({}) // { reportId: [{ id, role, content, createdAt }] }
const chatInput = reactive({}) // { reportId: 'text' }
const chatLoading = reactive({}) // { reportId: true/false }
const chatError = reactive({}) // { reportId: 'error msg' }

// Token-Verbrauch pro Provider
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
            label: `KW ${start.format('DD.MM.')} – ${end.format('DD.MM.YYYY')}`
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
            label: `Jahr ${start.format('YYYY')}`
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

// Gespeicherte Berichte laden
async function loadReports() {
    try {
        const res = await axios.get('/api/ai/reports')
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
        const res = await axios.post('/api/ai/report', {
            startDate: dateRange.value.startDate,
            endDate: dateRange.value.endDate,
            label,
            broker: selectedBroker.value || null
        }, { timeout: 600000 })

        // Berichte neu laden und neuen aufklappen
        await loadReports()
        if (res.data.savedId) {
            expandedReports.add(res.data.savedId)
        }

        // Browser-Benachrichtigung
        sendNotification('KI-Bericht fertig', `Bericht für ${label} wurde erstellt.`)
    } catch (e) {
        // Server hat evtl. schon gespeichert bevor der Frontend-Request abbrach
        try {
            await loadReports()
        } catch (reloadError) {
            logWarn('ki-agent', 'Berichte konnten nach Fehler nicht neu geladen werden', reloadError)
        }
        errorMsg.value = e.response?.data?.error || e.message || 'Fehler bei der Berichterstellung'
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
        chatError[reportId] = e.response?.data?.error || e.message || 'Chat-Anfrage fehlgeschlagen'
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

onBeforeMount(async () => {
    spinnerLoadingPage.value = false
    await Promise.all([checkStatus(), loadChatSetting()])
    await loadReports()
})
</script>

<template>
    <SpinnerLoadingPage />
    <div class="row mt-2">
        <div v-show="!spinnerLoadingPage">

            <!-- Header -->
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h5 class="mb-0">
                    <i class="uil uil-robot me-2"></i>KI-Bericht erstellen
                </h5>
                <div class="d-flex align-items-center gap-2">
                    <span class="text-muted small">
                        <i class="uil uil-processor me-1"></i>{{ (tokensByProvider[aiProvider] || 0).toLocaleString() }} Tokens
                    </span>
                    <span class="badge" :class="aiOnline ? 'bg-success' : 'bg-danger'">
                        {{ aiOnline ? modelLabel + ' Online' : providerLabel + ' Offline' }}
                    </span>
                    <button class="btn btn-sm btn-outline-secondary" @click="checkStatus" title="Status prüfen">
                        <i class="uil uil-sync"></i>
                    </button>
                </div>
            </div>

            <!-- Offline Warnung -->
            <div v-if="!aiOnline" class="dailyCard text-center py-4 mb-3">
                <i class="uil uil-exclamation-triangle text-warning" style="font-size: 2rem;"></i>
                <p class="mt-2 mb-1">KI-Anbieter ist nicht erreichbar.</p>
                <small v-if="aiProvider === 'ollama'" class="text-muted">
                    Starte den Ollama Docker Container: <code>docker start ollama</code>
                </small>
                <small v-else class="text-muted">
                    Prüfe deinen API-Key in den <a href="/settings">Einstellungen</a>.
                </small>
            </div>

            <!-- Konfiguration -->
            <div v-if="aiOnline" class="dailyCard mb-3" style="height: auto; padding: 0.6em 1em;">
                <div class="row align-items-end g-2">

                    <!-- Zeitraum-Typ -->
                    <div class="col-auto">
                        <label class="form-label small text-muted">Zeitraum</label>
                        <select v-model="periodType" class="form-select form-select-sm">
                            <option value="week">Woche</option>
                            <option value="month">Monat</option>
                            <option value="halfyear">Halbjahr</option>
                            <option value="year">Jahr</option>
                            <option value="custom">Benutzerdefiniert</option>
                        </select>
                    </div>

                    <!-- Woche -->
                    <div v-if="periodType === 'week'" class="col-auto">
                        <label class="form-label small text-muted">Woche ab</label>
                        <input type="date" v-model="selectedWeekStart" class="form-control form-control-sm">
                    </div>

                    <!-- Monat -->
                    <div v-if="periodType === 'month'" class="col-auto">
                        <label class="form-label small text-muted">Monat</label>
                        <input type="month" v-model="selectedMonth" class="form-control form-control-sm">
                    </div>

                    <!-- Custom Range -->
                    <div v-if="periodType === 'custom'" class="col-auto">
                        <label class="form-label small text-muted">Von</label>
                        <input type="date" v-model="customStart" class="form-control form-control-sm">
                    </div>
                    <div v-if="periodType === 'custom'" class="col-auto">
                        <label class="form-label small text-muted">Bis</label>
                        <input type="date" v-model="customEnd" class="form-control form-control-sm">
                    </div>

                    <!-- Button -->
                    <div class="col-auto">
                        <button class="btn btn-sm btn-primary" @click="generateReport" :disabled="loading">
                            <span v-if="loading" class="spinner-border spinner-border-sm me-1"></span>
                            <i v-else class="uil uil-file-alt me-1"></i>
                            {{ loading ? 'Wird generiert...' : 'Bericht erstellen' }}
                        </button>
                    </div>
                </div>
            </div>

            <!-- Lade-Animation -->
            <div v-if="loading" class="dailyCard text-center py-5">
                <div class="spinner-border text-primary mb-3" role="status" style="width: 3rem; height: 3rem;">
                    <span class="visually-hidden">Lädt...</span>
                </div>
                <p class="text-muted">KI analysiert deine Trades...</p>
                <small class="text-muted">Das kann 1–3 Minuten dauern.</small>
            </div>

            <!-- Fehler -->
            <div v-if="errorMsg" class="alert alert-danger">
                <i class="uil uil-exclamation-circle me-1"></i>{{ errorMsg }}
            </div>

            <!-- Gespeicherte Berichte -->
            <div v-if="savedReports.length === 0 && !loading" class="dailyCard text-center py-4">
                <i class="uil uil-file-search-alt text-muted" style="font-size: 2rem;"></i>
                <p class="text-muted mt-2 mb-0">Noch keine Berichte erstellt.</p>
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
                            {{ report.reportData.tradeCount }} Trades · {{ report.reportData.winRate }}% WR ·
                            <span :class="parseFloat(report.reportData.totalNetProceeds) >= 0 ? 'greenTrade' : 'redTrade'">
                                {{ report.reportData.totalNetProceeds }} USDT
                            </span>
                        </span>
                        <button class="btn btn-sm btn-outline-light" @click.stop="downloadPdf(report)" title="PDF">
                            <i class="uil uil-file-download"></i>
                        </button>
                        <!-- Löschen -->
                        <button v-if="deleteConfirmId !== report.id" class="btn btn-sm btn-outline-danger" @click.stop="deleteConfirmId = report.id" title="Löschen">
                            <i class="uil uil-trash-alt"></i>
                        </button>
                        <span v-else class="d-flex align-items-center gap-1" @click.stop>
                            <button class="btn btn-sm btn-danger" @click="deleteReport(report.id)">Ja</button>
                            <button class="btn btn-sm btn-outline-secondary" @click="deleteConfirmId = null">Nein</button>
                        </span>
                    </div>
                </div>

                <!-- Ausklappbarer Inhalt -->
                <div v-show="expandedReports.has(report.id)">
                    <!-- Datenbasis -->
                    <div v-if="report.reportData && report.reportData.tradeCount" class="row mt-2 mb-2 py-2" style="border-top: 1px solid var(--border-color, #333); border-bottom: 1px solid var(--border-color, #333);">
                        <div class="col-6 col-md-3 text-center">
                            <div class="text-muted small">Trades</div>
                            <div class="fw-bold">{{ report.reportData.tradeCount }}</div>
                        </div>
                        <div class="col-6 col-md-3 text-center">
                            <div class="text-muted small">Win Rate</div>
                            <div class="fw-bold">{{ report.reportData.winRate }}%</div>
                        </div>
                        <div class="col-6 col-md-3 text-center">
                            <div class="text-muted small">Netto PnL</div>
                            <div class="fw-bold" :class="parseFloat(report.reportData.totalNetProceeds) >= 0 ? 'greenTrade' : 'redTrade'">
                                {{ report.reportData.totalNetProceeds }} USDT
                            </div>
                        </div>
                        <div class="col-6 col-md-3 text-center">
                            <div class="text-muted small">Profit Factor</div>
                            <div class="fw-bold">{{ report.reportData.profitFactor }}</div>
                        </div>
                    </div>

                    <!-- Bericht-Text -->
                    <div class="report-content" v-html="markdownToHtml(report.report)"></div>

                    <!-- Token-Verbrauch -->
                    <div class="d-flex align-items-center gap-3 mt-2 pt-2 text-muted small" style="border-top: 1px solid var(--border-color, #333);">
                        <span><i class="uil uil-processor me-1"></i>{{ report.model || '—' }}</span>
                        <span>Prompt: {{ report.totalTokens > 0 ? report.promptTokens?.toLocaleString() : '—' }}</span>
                        <span>Antwort: {{ report.totalTokens > 0 ? report.completionTokens?.toLocaleString() : '—' }}</span>
                        <span class="fw-bold">Gesamt: {{ report.totalTokens > 0 ? report.totalTokens?.toLocaleString() + ' Tokens' : '—' }}</span>
                    </div>

                    <!-- Chat / Rückfragen -->
                    <div v-if="chatEnabled && aiOnline" class="chat-section mt-3 pt-3" style="border-top: 1px solid var(--border-color, #333);">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <span class="small fw-bold"><i class="uil uil-comment-dots me-1"></i>Rückfragen</span>
                            <button v-if="chatMessages[report.id]?.length > 0" class="btn btn-sm btn-outline-secondary" @click="clearChat(report.id)" title="Chat löschen">
                                <i class="uil uil-trash-alt me-1"></i>Chat löschen
                            </button>
                        </div>

                        <!-- Chat-Verlauf -->
                        <div v-if="chatMessages[report.id]?.length > 0" class="chat-messages mb-2">
                            <div v-for="msg in chatMessages[report.id]" :key="msg.id" class="chat-msg mb-2" :class="'chat-msg-' + msg.role">
                                <div class="d-flex align-items-center gap-1 mb-1">
                                    <i class="uil" :class="msg.role === 'user' ? 'uil-user' : 'uil-robot'"></i>
                                    <span class="small fw-bold">{{ msg.role === 'user' ? 'Du' : 'KI' }}</span>
                                    <span class="text-muted small ms-1">{{ formatDate(msg.createdAt) }}</span>
                                    <span v-if="msg.role === 'assistant' && msg.totalTokens > 0" class="text-muted small ms-auto">{{ msg.totalTokens }} Tokens</span>
                                </div>
                                <div v-if="msg.role === 'user'" class="chat-bubble chat-bubble-user">{{ msg.content }}</div>
                                <div v-else class="chat-bubble chat-bubble-ai report-content" v-html="markdownToHtml(msg.content)"></div>
                            </div>
                        </div>

                        <!-- Loading -->
                        <div v-if="chatLoading[report.id]" class="text-center py-3">
                            <span class="spinner-border spinner-border-sm me-1"></span>
                            <span class="text-muted small">KI denkt nach...</span>
                        </div>

                        <!-- Error -->
                        <div v-if="chatError[report.id]" class="alert alert-danger py-1 px-2 small mb-2">
                            {{ chatError[report.id] }}
                        </div>

                        <!-- Input -->
                        <div class="d-flex gap-2 align-items-end">
                            <textarea class="form-control form-control-sm chat-input" rows="3" placeholder="Rückfrage stellen..."
                                v-model="chatInput[report.id]"
                                @keydown.enter.exact.prevent="sendChatMessage(report.id)"
                                :disabled="chatLoading[report.id]"></textarea>
                            <button class="btn btn-sm btn-primary" style="height: 2.4rem;" @click="sendChatMessage(report.id)" :disabled="chatLoading[report.id] || !(chatInput[report.id] || '').trim()">
                                <i class="uil uil-message"></i>
                            </button>
                        </div>
                        <small class="text-muted mt-1">Enter = Senden, Shift+Enter = Neue Zeile</small>
                    </div>
                </div>
            </div>

        </div>
    </div>
</template>

<style scoped>
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
/* Chat */
.chat-section {
    max-height: 500px;
    display: flex;
    flex-direction: column;
}
.chat-messages {
    max-height: 350px;
    overflow-y: auto;
    padding-right: 0.3rem;
}
.chat-bubble {
    padding: 0.4rem 0.7rem;
    border-radius: 0.6rem;
    font-size: 0.85rem;
    line-height: 1.5;
}
.chat-bubble-user {
    background: var(--blue-color, #6cb4ee);
    color: #fff;
    margin-left: 2rem;
    border-bottom-right-radius: 0.15rem;
    white-space: pre-wrap;
}
.chat-bubble-ai {
    background: var(--black-bg-2, #1e1e1e);
    color: var(--white-87);
    margin-right: 2rem;
    border-bottom-left-radius: 0.15rem;
}
.chat-input {
    resize: vertical;
    min-height: 2.4rem;
}
</style>
