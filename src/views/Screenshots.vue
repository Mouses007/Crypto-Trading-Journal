<script setup>
import { ref, reactive, computed, onBeforeMount, onMounted } from 'vue'
import NoData from '../components/NoData.vue';
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue';
import Screenshot from '../components/Screenshot.vue';
import { spinnerLoadMore, spinnerLoadingPage, expandedScreenshot } from '../stores/ui.js';
import { screenshots } from '../stores/trades.js';
import { useMountScreenshots, useCheckVisibleScreen, useLoadMore } from '../utils/mountOrchestration.js';
import { endOfList } from '../stores/ui.js';
import { sanitizeHtml } from '../utils/sanitize';
import axios from 'axios'

// Screenshot-Filter: 'alle' | 'entry' | 'closing'
const screenshotFilter = ref('alle')

const filteredScreenshots = computed(() => {
    if (screenshotFilter.value === 'alle') return screenshots
    return screenshots.filter(s => {
        const side = s.side || ''
        const name = s.name || ''
        if (screenshotFilter.value === 'entry') {
            // Eröffnung: B (Long Buy) oder SS (Short Sell), aber NICHT _closing im Namen
            return (side === 'B' || side === 'SS') && !name.includes('_closing')
        } else if (screenshotFilter.value === 'closing') {
            // Abschluss: BC (Buy Cover) oder Name enthält _closing
            return side === 'BC' || name.includes('_closing')
        }
        return true
    })
})

// KI-Bewertung State
const reviewLoading = reactive({})   // { screenshotId: true }
const reviewError = reactive({})     // { screenshotId: 'error' }
const reviewPopupId = ref(null)      // welcher Screenshot-Popup offen ist

// Markdown → HTML (einfacher Parser wie in KiAgent.vue)
function markdownToHtml(md) {
    if (!md) return ''
    let html = md
        .replace(/^### (.+)$/gm, '<h6 class="mt-2 mb-1">$1</h6>')
        .replace(/^## (.+)$/gm, '<h5 class="mt-2 mb-1">$1</h5>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul class="mb-1">${match}</ul>`)

    html = html.split('\n\n').map(p => {
        const trimmed = p.trim()
        if (!trimmed) return ''
        if (trimmed.startsWith('<h') || trimmed.startsWith('<ul')) return trimmed
        return `<p>${trimmed}</p>`
    }).filter(Boolean).join('\n')

    return sanitizeHtml(html)
}

// KI-Bewertung anfordern
async function requestReview(item) {
    const id = item.objectId
    if (reviewLoading[id]) return

    reviewLoading[id] = true
    reviewError[id] = ''

    try {
        // objectId → DB id (api-routes mappt das)
        const res = await axios.post('/api/ai/screenshot-review', {
            screenshotId: id
        }, { timeout: 120000 })

        // Bewertung lokal in das screenshots-Array schreiben
        item.aiReview = res.data.review
        reviewPopupId.value = id
    } catch (e) {
        reviewError[id] = e.response?.data?.error || e.message || 'Bewertung fehlgeschlagen'
        // Fehler kurz anzeigen dann weg
        setTimeout(() => { reviewError[id] = '' }, 5000)
    }

    reviewLoading[id] = false
}

// Popup öffnen (vorhandene Bewertung anzeigen)
function showReview(id) {
    reviewPopupId.value = reviewPopupId.value === id ? null : id
}

// Popup schliessen
function closeReview() {
    reviewPopupId.value = null
}

onBeforeMount(async () => {

})

onMounted(async () => {
    await useMountScreenshots()
    window.addEventListener('scroll', () => {
        let scrollFromTop = window.scrollY
        let visibleScreen = (window.innerHeight + 200) // adding 200 so that loads before getting to bottom
        let documentHeight = document.documentElement.scrollHeight
        let difference = documentHeight - (scrollFromTop + visibleScreen)
        if (difference <= 0) {
            if (!spinnerLoadMore.value && !spinnerLoadingPage.value && !endOfList.value && expandedScreenshot.value == null) {
                useLoadMore()
            }
        }
    })
    useCheckVisibleScreen()
})

</script>

<template>
    <SpinnerLoadingPage />
    <div v-show="!spinnerLoadingPage" class="screenshots-grid mt-2 mb-2">

        <!-- Screenshot-Typ Filter -->
        <div class="ss-filter-bar mb-2">
            <button :class="['ss-filter-btn', screenshotFilter === 'alle' && 'active']"
                @click="screenshotFilter = 'alle'">
                Alle
            </button>
            <button :class="['ss-filter-btn', screenshotFilter === 'entry' && 'active']"
                @click="screenshotFilter = 'entry'">
                <i class="uil uil-arrow-up-right me-1"></i>Eröffnung
            </button>
            <button :class="['ss-filter-btn', screenshotFilter === 'closing' && 'active']"
                @click="screenshotFilter = 'closing'">
                <i class="uil uil-arrow-down-left me-1"></i>Abschluss
            </button>
        </div>

        <div v-if="filteredScreenshots.length == 0">
            <NoData />
        </div>
        <div class="row">
            <div v-for="(itemScreenshot, index) in filteredScreenshots" class="col-12 col-md-6 col-xl-4 mt-2">
                <div class="dailyCard" v-bind:id="itemScreenshot.objectId">
                    <div class="row">
                        <Screenshot :screenshot-data="itemScreenshot" show-title source="screenshots" :index="index"/>
                    </div>

                    <!-- Buttons: Playbook + KI-Bewertung -->
                    <div class="px-2 pb-2 pt-1 d-flex align-items-center gap-2 flex-wrap">
                        <!-- Playbook Link -->
                        <a v-if="itemScreenshot.name"
                            :href="'/playbook?tradeId=' + encodeURIComponent(itemScreenshot.name)"
                            class="playbook-link-btn">
                            <i class="uil uil-compass me-1"></i>Playbook
                        </a>

                        <!-- KI-Bewertung Button -->
                        <button v-if="!itemScreenshot.aiReview"
                            class="ss-review-btn"
                            :disabled="reviewLoading[itemScreenshot.objectId]"
                            @click="requestReview(itemScreenshot)">
                            <span v-if="reviewLoading[itemScreenshot.objectId]" class="spinner-border spinner-border-sm me-1" style="width: 0.7rem; height: 0.7rem;"></span>
                            <i v-else class="uil uil-robot me-1"></i>
                            {{ reviewLoading[itemScreenshot.objectId] ? 'Analysiert...' : 'KI-Bewertung' }}
                        </button>

                        <!-- Bewertung vorhanden: Badge zum Anzeigen -->
                        <button v-if="itemScreenshot.aiReview"
                            class="ss-review-badge"
                            @click="showReview(itemScreenshot.objectId)">
                            <i class="uil uil-robot me-1"></i>Bewertung
                            <i class="uil" :class="reviewPopupId === itemScreenshot.objectId ? 'uil-angle-up' : 'uil-angle-down'" style="font-size: 0.7rem;"></i>
                        </button>

                        <!-- Fehler -->
                        <span v-if="reviewError[itemScreenshot.objectId]" class="ss-review-error">
                            {{ reviewError[itemScreenshot.objectId] }}
                        </span>
                    </div>

                    <!-- Bewertungs-Popup (aufklappbar) -->
                    <div v-if="reviewPopupId === itemScreenshot.objectId && itemScreenshot.aiReview" class="ss-review-popup">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <span class="fw-bold small"><i class="uil uil-robot me-1"></i>KI-Bewertung</span>
                            <div class="d-flex align-items-center gap-2">
                                <!-- Neu bewerten Button -->
                                <button class="btn btn-sm btn-outline-secondary ss-rebtn"
                                    :disabled="reviewLoading[itemScreenshot.objectId]"
                                    @click="requestReview(itemScreenshot)"
                                    title="Neu bewerten">
                                    <span v-if="reviewLoading[itemScreenshot.objectId]" class="spinner-border spinner-border-sm" style="width: 0.6rem; height: 0.6rem;"></span>
                                    <i v-else class="uil uil-sync"></i>
                                </button>
                                <button class="btn-close btn-close-white btn-sm" @click="closeReview" style="font-size: 0.6rem;"></button>
                            </div>
                        </div>
                        <div class="ss-review-content" v-html="markdownToHtml(itemScreenshot.aiReview)"></div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Load more spinner -->
        <div v-if="spinnerLoadMore" class="d-flex justify-content-center mt-3">
            <div class="spinner-border text-blue" role="status"></div>
        </div>
    </div>
</template>

<style scoped>
/* Screenshot-Typ Filter */
.ss-filter-bar {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
}

.ss-filter-btn {
    display: inline-flex;
    align-items: center;
    font-size: 0.78rem;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--white-18);
    border-radius: 6px;
    color: var(--white-60);
    background: transparent;
    cursor: pointer;
    transition: all 0.15s;
}

.ss-filter-btn:hover {
    border-color: var(--white-38);
    color: var(--white-87);
}

.ss-filter-btn.active {
    border-color: var(--blue-color, #6cb4ee);
    color: var(--blue-color, #6cb4ee);
    background: rgba(108, 180, 238, 0.1);
}

/* Kompaktere Karten im Screenshots-Grid */
.screenshots-grid :deep(.cardFirstLine) h5 {
    font-size: 0.85rem;
    margin-bottom: 0;
}

.screenshots-grid :deep(.col-12.mt-2 span) {
    font-size: 0.78rem;
}

.screenshots-grid :deep(.imgContainer) {
    max-height: 250px;
    overflow: hidden;
}

.screenshots-grid :deep(.uil) {
    font-size: 0.95rem;
}

/* KI-Bewertung Button */
.ss-review-btn {
    display: inline-flex;
    align-items: center;
    font-size: 12px;
    padding: 2px 8px;
    border: 1px solid var(--white-38);
    border-radius: 4px;
    color: var(--white-60);
    background: transparent;
    cursor: pointer;
    transition: all 0.15s;
}

.ss-review-btn:hover:not(:disabled) {
    border-color: #7c5cfc;
    color: #7c5cfc;
}

.ss-review-btn:disabled {
    opacity: 0.6;
    cursor: wait;
}

/* Bewertung-Badge (wenn vorhanden) */
.ss-review-badge {
    display: inline-flex;
    align-items: center;
    font-size: 12px;
    padding: 2px 8px;
    border: 1px solid #7c5cfc;
    border-radius: 4px;
    color: #7c5cfc;
    background: rgba(124, 92, 252, 0.1);
    cursor: pointer;
    transition: all 0.15s;
}

.ss-review-badge:hover {
    background: rgba(124, 92, 252, 0.2);
}

/* Fehler */
.ss-review-error {
    font-size: 11px;
    color: #f87171;
}

/* Bewertungs-Popup */
.ss-review-popup {
    border-top: 1px solid var(--white-18);
    padding: 0.6rem 0.75rem;
    background: var(--black-bg-2, #1a1a1a);
    border-radius: 0 0 var(--border-radius) var(--border-radius);
}

.ss-rebtn {
    font-size: 0.65rem;
    padding: 0.1rem 0.35rem;
    line-height: 1;
}

/* Bewertungs-Content */
.ss-review-content :deep(h5),
.ss-review-content :deep(h6) {
    font-size: 0.8rem;
    color: var(--blue-color, #6cb4ee);
    margin-top: 0.4rem;
    margin-bottom: 0.2rem;
}

.ss-review-content :deep(p) {
    font-size: 0.78rem;
    line-height: 1.45;
    color: var(--white-87);
    margin-bottom: 0.3rem;
}

.ss-review-content :deep(ul) {
    padding-left: 1rem;
    margin-bottom: 0.3rem;
}

.ss-review-content :deep(li) {
    font-size: 0.78rem;
    color: var(--white-87);
    margin-bottom: 0.1rem;
}

.ss-review-content :deep(strong) {
    color: var(--white-100, #fff);
}
</style>
