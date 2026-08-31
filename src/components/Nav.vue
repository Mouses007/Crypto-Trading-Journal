<script setup>
import { onMounted, computed } from 'vue';
import { useToggleMobileMenu, useExport } from '../utils/utils.js'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
import { useInitTooltip } from "../utils/utils.js";
import { useRoute, useRouter } from 'vue-router'
import { pageById } from "../config/menu.js"
import ModeSwitcher from './ModeSwitcher.vue'
import { pageId, screenType, appMode, privacyMode } from "../stores/ui.js"
import { currentUser, renderProfile } from "../stores/settings.js"
import { version } from '../../package.json';
import { selectedDateRange, selectedPeriodRange, selectedGrossNet, selectedPositions, selectedMonth } from "../stores/filters.js"
import { filteredTradesTrades } from "../stores/trades.js"
import { useDateCalFormat } from "../utils/formatters.js"
import dayjs from '../utils/dayjs-setup.js'

// Pages that have filters
const filterPages = ['dashboard', 'daily', 'calendar', 'screenshots', 'auswertung']

// Compact filter summary for navbar
const filterSummary = computed(() => {
    if (!filterPages.includes(pageId.value)) return ''

    const parts = []

    // Zeitraum / Monat
    if (['dashboard', 'auswertung'].includes(pageId.value) && selectedPeriodRange.value) {
        parts.push(selectedPeriodRange.value.label || '')
    } else if (['daily', 'calendar'].includes(pageId.value) && selectedMonth.value) {
        const m = dayjs.unix(selectedMonth.value.start)
        if (m.isValid()) parts.push(m.format('MMM YYYY'))
    }

    // Brutto/Netto
    if (selectedGrossNet.value === 'gross') parts.push(t('options.gross'))
    else if (selectedGrossNet.value === 'net') parts.push(t('options.net'))

    // Positionen
    if (selectedPositions.value && selectedPositions.value.length > 0 && selectedPositions.value.length < 2) {
        parts.push(selectedPositions.value[0] === 'long' ? 'Long' : 'Short')
    }

    return parts.filter(Boolean).join(' · ')
})

const aiActive = computed(() => currentUser.value?.aiEnabled !== false && currentUser.value?.aiEnabled !== 0)

const pages = computed(() => {
    const all = [{
        id: "dashboard",
        name: t('nav.dashboard'),
        icon: "uil uil-apps"
    },
    {
        id: "daily",
        name: t('nav.dailyView'),
        icon: "uil uil-signal-alt-3"
    },
    {
        id: "calendar",
        name: t('nav.calendar'),
        icon: "uil uil-calendar-alt"
    },
    {
        id: "screenshots",
        name: t('nav.screenshots'),
        icon: "uil uil-image-v"
    },
    {
        id: "incoming",
        name: t('nav.pendingTrades'),
        icon: "uil uil-arrow-circle-down"
    },
    {
        id: "playbook",
        name: t('nav.playbook'),
        icon: "uil uil-compass"
    },
    {
        id: "auswertung",
        name: t('nav.evaluation'),
        icon: "uil uil-chart-pie"
    },
    {
        id: "kiAgent",
        name: t('nav.kiAgent'),
        icon: "uil uil-robot"
    },
    {
        id: "addTrades",
        name: t('nav.manualImport'),
        icon: "uil uil-plus-circle"
    },
    {
        id: "settings",
        name: t('nav.settings'),
        icon: "uil uil-sliders-v-alt"
    },
    {
        id: "addExcursions",
        name: t('nav.addExcursions'),
        icon: "uil uil-refresh"
    },
    {
        id: "imports",
        name: t('settings.imports'),
        icon: "uil uil-import"
    }]
    return all.filter(p => p.id !== 'kiAgent' || aiActive.value)
})

const route = useRoute()

// Seitentitel + Icon der aktuellen Seite. Fällt auf die zentrale Registry und
// zuletzt auf route.meta zurück — sonst wirft jede Seite, die nicht im lokalen
// `pages`-Array steht (z.B. /liquidity), beim Rendern einen TypeError.
const currentPage = computed(() => {
    const hit = pages.value.find(p => p.id === pageId.value)
    if (hit) return hit
    const reg = pageById(pageId.value)
    return {
        icon: reg?.icon || 'uil uil-file-alt',
        name: reg?.titleKey ? t(reg.titleKey)
            : (route.meta?.titleKey ? t(route.meta.titleKey) : (route.meta?.title || ''))
    }
})

onMounted(async () => {
    await useInitTooltip()
})

// Schnellzugriff auf den KI-Agenten (Chat-Reiter des KI-Coachs) — von jeder
// Seite aus, damit eine Frage an den Agenten keinen Umweg über das Menü braucht.
const router = useRouter()
function openAgent() {
    router.push({ path: '/ki-coach', query: { tab: 'agent', sourcePage: pageId.value } })
}

// Datenschutz-/Zensur-Modus: verbirgt Kontostände und Zahlen im Journal.
function togglePrivacy() {
    privacyMode.value = !privacyMode.value
    localStorage.setItem('privacyMode', privacyMode.value ? '1' : '0')
}

const navAdd = (param) => {
    window.location.href = "/" + param;
};


</script>

<template>
    <!-- Titel oben, Modus-Navigation darunter. -->
    <div class="justify-content-between navbar nav-pull-up">
        <div class="col-9 d-flex align-items-center">
            <span v-if="screenType == 'mobile'" class="d-flex align-items-center">
                <a v-on:click="useToggleMobileMenu" class="mobile-menu-toggle">
                    <i class="fa fa-bars me-2"></i>
                    <i v-bind:class="currentPage.icon" class="me-1"></i>{{ currentPage.name }}
                    <span v-if="filterSummary" class="nav-filter-info">{{ filterSummary }}</span>
                </a>
            </span>
            <span v-else class="d-flex align-items-center">
                <i v-bind:class="currentPage.icon" class="me-1"></i>{{ currentPage.name }}
                <span v-if="filterSummary" class="nav-filter-info">{{ filterSummary }}</span>
            </span>
        </div>
        <div class="col-3 ms-auto text-end d-flex align-items-center justify-content-end gap-2">
            <!-- Zensur-Modus: verbirgt Kontostände und Zahlen (für Screenshots). -->
            <button v-if="appMode === 'journal'" type="button"
                :class="['btn', 'btn-sm', 'privacy-toggle', privacyMode ? 'active' : '']"
                :title="privacyMode ? t('nav.showNumbers') : t('nav.hideNumbers')"
                @click="togglePrivacy">
                <i :class="privacyMode ? 'fa fa-eye-slash' : 'fa fa-eye'"></i>
            </button>
            <!-- Schnellzugriff: KI-Agent (Chat) direkt öffnen. route.name statt
                 pageId, weil pageId erst beim Mount der Zielseite gesetzt wird
                 und bei SPA-Navigation einen Tick hinterherhinkt. -->
            <button v-if="aiActive && route.name !== 'kiAgent'" type="button" class="btn btn-sm privacy-toggle"
                :title="t('nav.kiAgent')" @click="openAgent">
                <i class="uil uil-robot"></i>
            </button>
            <span v-if="pageId === 'dashboard'">
                <button class="btn btn-secondary btn-sm dropdown-toggle" type="button"
                    data-bs-toggle="dropdown" aria-expanded="false">Export
                </button>
                <ul class="dropdown-menu dropdown-menu-end">
                    <li><a class="dropdown-item"
                            @click="useExport('json', useDateCalFormat(selectedDateRange.start), useDateCalFormat(selectedDateRange.end), filteredTradesTrades)">JSON</a>
                    </li>
                    <li><a class="dropdown-item"
                            @click="useExport('csv', useDateCalFormat(selectedDateRange.start), useDateCalFormat(selectedDateRange.end), filteredTradesTrades)">CSV</a>
                    </li>
                </ul>
            </span>
        </div>
    </div>
    <!-- Breite Modus-Leiste unter dem Titel: Icon + Text nebeneinander. -->
    <ModeSwitcher variant="wide" />
</template>

<style scoped>
/* Seitentitel mit etwas Abstand nach oben. */
.nav-pull-up {
    margin-top: 16px;
}

/* Icon-Buttons rechts (Zensur-Modus, KI-Agent) links neben Export. */
.privacy-toggle {
    border: 1px solid var(--white-18);
    background: transparent;
    color: var(--white-70);
    padding: 0.28rem 0.6rem;
    border-radius: 8px;
    line-height: 1;
    transition: all 0.15s ease;
}
.privacy-toggle:hover {
    color: var(--white-87);
    border-color: var(--blue-color, #01B4FF);
}
.privacy-toggle.active {
    background: var(--blue-color, #01B4FF);
    border-color: var(--blue-color, #01B4FF);
    color: #fff;
}

/* Keine Linie zwischen Titel und Modus-Leiste — die einzige Trennlinie sitzt
   UNTER den Buttons (in ModeSwitcher). */
.navbar {
    border-bottom: none;
}
</style>