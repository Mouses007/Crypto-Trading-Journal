<script setup>
import { ref, reactive, onBeforeMount, computed } from 'vue'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue'
import { spinnerLoadingPage } from '../stores/globals'
import axios from 'axios'
import { useExportReportPdf } from '../utils/pdfExport'
import dayjs from 'dayjs'

// Status
const aiOnline = ref(false)
const aiProvider = ref('ollama')
const aiModel = ref('')
const loading = ref(false)
const errorMsg = ref('')

// Zeitraum
const periodType = ref('month')
const selectedMonth = ref(dayjs().format('YYYY-MM'))
const customStart = ref(dayjs().startOf('month').format('YYYY-MM-DD'))
const customEnd = ref(dayjs().format('YYYY-MM-DD'))

// Gespeicherte Berichte
const savedReports = reactive([])
const expandedReports = reactive(new Set())
const deleteConfirmId = ref(null)

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
    if (periodType.value === 'month') {
        const start = dayjs(selectedMonth.value + '-01').startOf('day')
        const end = start.endOf('month')
        return {
            startDate: start.unix(),
            endDate: end.unix(),
            label: start.format('MMMM YYYY')
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
        console.error('Fehler beim Laden der Berichte:', e)
    }
}

// Bericht generieren und speichern
async function generateReport() {
    loading.value = true
    errorMsg.value = ''

    try {
        const res = await axios.post('/api/ai/report', {
            startDate: dateRange.value.startDate,
            endDate: dateRange.value.endDate
        }, { timeout: 600000 })

        const report = res.data.report
        const reportData = res.data.data || null
        const tokenUsage = res.data.tokenUsage || null

        // Automatisch speichern
        const saveRes = await axios.post('/api/ai/reports/save', {
            label: dateRange.value.label,
            startDate: dateRange.value.startDate,
            endDate: dateRange.value.endDate,
            provider: res.data.provider || aiProvider.value,
            model: res.data.model || '',
            report,
            reportData,
            tokenUsage
        })

        // Berichte neu laden und neuen aufklappen
        await loadReports()
        if (saveRes.data.id) {
            expandedReports.add(saveRes.data.id)
        }
    } catch (e) {
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
        console.error('Fehler beim Löschen:', e)
    }
}

// Bericht auf-/zuklappen
function toggleReport(id) {
    if (expandedReports.has(id)) {
        expandedReports.delete(id)
    } else {
        expandedReports.add(id)
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

    return html
}

onBeforeMount(async () => {
    spinnerLoadingPage.value = false
    await checkStatus()
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
                            <option value="month">Monat</option>
                            <option value="custom">Benutzerdefiniert</option>
                        </select>
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
</style>
