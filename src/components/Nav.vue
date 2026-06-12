<script setup>
import { onMounted, computed, ref } from 'vue';
import axios from 'axios'
import { useToggleMobileMenu, useExport } from '../utils/utils.js'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
import { useInitTooltip } from "../utils/utils.js";
import { pageId, screenType } from "../stores/ui.js"
import { currentUser, renderProfile } from "../stores/settings.js"
import { version } from '../../package.json';
import { selectedDateRange, selectedPeriodRange, selectedGrossNet, selectedPositions, selectedMonth, selectedBroker, brokers } from "../stores/filters.js"
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

// ===== Börsen-Buttons (nur Börsen mit hinterlegter API) =====
const configuredBrokers = ref([])

async function loadConfiguredBrokers() {
    const result = []
    for (const b of brokers) {
        try {
            const { data } = await axios.get(`/api/${b.value}/config`)
            if (data && (data.apiKey || data.hasSecret)) result.push(b)
        } catch (_) { /* Broker ohne Config-Endpoint/Key → überspringen */ }
    }
    // Fallback: ist gar keine API hinterlegt, zeige trotzdem alle, damit man
    // nicht festsitzt (z.B. frische Installation).
    configuredBrokers.value = result.length ? result : brokers.slice()
}

function switchBroker(value) {
    if (selectedBroker.value === value) return
    selectedBroker.value = value
    localStorage.setItem('selectedBroker', value)
    window.location.reload()
}

onMounted(async () => {
    await loadConfiguredBrokers()
    await useInitTooltip()
})

const navAdd = (param) => {
    window.location.href = "/" + param;
};


</script>

<template>
    <div class="justify-content-between navbar nav-pull-up">
        <div class="col-6">
            <span v-if="screenType == 'mobile'" class="d-flex align-items-center">
                <a v-on:click="useToggleMobileMenu" class="mobile-menu-toggle">
                    <i class="fa fa-bars me-2"></i>
                    <i v-bind:class="pages.filter(item => item.id == pageId)[0].icon" class="me-1"></i>{{
                        pages.filter(item => item.id == pageId)[0].name }}
                    <span v-if="filterSummary" class="nav-filter-info">{{ filterSummary }}</span>
                </a>
            </span>
            <span v-else>
                <i v-bind:class="pages.filter(item => item.id == pageId)[0].icon" class="me-1"></i>{{
                    pages.filter(item => item.id == pageId)[0].name }}
                <span v-if="filterSummary" class="nav-filter-info">{{ filterSummary }}</span>
            </span>
        </div>
        <div class="col-6 ms-auto text-end">
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
    <!-- Börsen-Buttons unter dem Seitentitel (nur Börsen mit hinterlegter API) -->
    <div v-if="configuredBrokers.length > 1" class="broker-switch d-flex align-items-center gap-1 px-2 pt-1 pb-2">
        <button v-for="b in configuredBrokers" :key="b.value" type="button"
            @click="switchBroker(b.value)"
            :class="['btn', 'btn-sm', 'broker-pill', selectedBroker === b.value ? 'active' : '']">
            {{ b.label }}
        </button>
    </div>
</template>

<style scoped>
.broker-switch {
    flex-wrap: wrap;
    /* Pillen sitzen jetzt unter dem Titel → nur leichter Abstand nach oben */
    margin-top: -0.1rem;
}

/* Trennlinie unter die Pillen ziehen (statt unter die Navbar), damit
   die Börsen-Buttons zwischen Titel und Linie liegen. */
.navbar:has(+ .broker-switch) {
    border-bottom: none;
}
.broker-switch {
    border-bottom: 1px solid var(--white-18);
    padding-bottom: calc(0.55rem + 15px) !important;
}

/* Seitentitel oben, mit etwas Abstand nach oben. */
.nav-pull-up {
    margin-top: 0.85rem;
}
.broker-pill {
    font-size: 0.78rem;
    padding: 0.15rem 0.7rem;
    border-radius: 999px;
    border: 1px solid var(--white-10, rgba(255, 255, 255, 0.15));
    background: transparent;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
    line-height: 1.4;
    transition: all 0.15s ease;
}
.broker-pill:hover {
    border-color: var(--blue-color, #3b82f6);
    color: var(--white-87, rgba(255, 255, 255, 0.9));
}
.broker-pill.active {
    background: var(--blue-color, #3b82f6);
    border-color: var(--blue-color, #3b82f6);
    color: #fff;
    font-weight: 600;
}
</style>