<script setup>
import { onMounted, computed } from 'vue';
import { useToggleMobileMenu, useExport } from '../utils/utils.js'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
import { useInitTooltip } from "../utils/utils.js";
import { pageId, screenType } from "../stores/ui.js"
import { currentUser, renderProfile } from "../stores/settings.js"
import { version } from '../../package.json';
import { selectedDateRange, selectedPeriodRange, selectedGrossNet, selectedPositions, selectedMonth, selectedBroker } from "../stores/filters.js"
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

const pages = computed(() => [{
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
}
])

onMounted(async () => {
    await useInitTooltip()
})

const navAdd = (param) => {
    window.location.href = "/" + param;
};


</script>

<template>
    <div class="justify-content-between navbar">
        <div class="col-6">
            <span v-if="screenType == 'mobile'">
                <a v-on:click="useToggleMobileMenu">
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
</template>