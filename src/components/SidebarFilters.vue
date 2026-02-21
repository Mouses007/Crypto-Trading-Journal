<script setup>
import { ref, computed, onMounted, nextTick } from "vue"
import { useMonthFormat, useDateCalFormat, useDateCalFormatMonth } from "../utils/formatters.js"
import { useMountCalendar, useMountDashboard, useMountDaily, useMountAuswertung, useCheckVisibleScreen } from "../utils/mountOrchestration.js"
import { pageId, timeZoneTrade, hasData } from "../stores/ui.js"
import { periodRange, positions, timeFrames, ratios, grossNet, plSatisfaction, selectedPositions, selectedTimeFrame, selectedRatio, selectedAccounts, selectedGrossNet, selectedPlSatisfaction, selectedDateRange, selectedMonth, selectedPeriodRange, tempSelectedPlSatisfaction, amountCase, amountCapital, selectedTags } from "../stores/filters.js"
import { tags, availableTags } from "../stores/trades.js"
import { useECharts } from "../utils/charts.js"
import { useRefreshScreenshot } from "../utils/screenshots"
import { useInitTooltip } from "../utils/utils.js"
import dayjs from '../utils/dayjs-setup.js'

/*============================================
    FILTER CONFIG PER PAGE
============================================*/
const filters = {
    "dashboard": ["periodRange", "grossNet", "positions", "timeFrame", "ratio", "tags"],
    "calendar": ["month", "grossNet", "plSatisfaction"],
    "daily": ["month", "grossNet", "positions", "tags"],
    "screenshots": ["grossNet", "positions", "tags"],
    "auswertung": ["periodRange", "positions", "tags"],
}

const filterPages = ["dashboard", "daily", "calendar", "screenshots", "auswertung"]
const showFilters = computed(() => filterPages.includes(pageId.value))

// Collapsible state
const filtersOpen = ref(false)

// Tooltip descriptions for info icons
const tooltips = {
    periodRange: "Zeitraum der angezeigten Trades",
    month: "Monat der angezeigten Trades",
    grossNet: "Brutto- oder Nettodaten anzeigen",
    positions: "Long, Short oder beide Positionen",
    timeFrame: "Balken-Darstellung: Trades pro Tag, Woche oder Monat zusammenfassen",
    ratio: "Kennzahl: Profitfaktor oder APPT",
    plSatisfaction: "PnL oder Zufriedenheit im Kalender",
    tags: "Nach Tags filtern",
}

/*============================================
    TAGS
============================================*/
const filteredTagGroups = computed(() => {
    if (pageId.value === 'dashboard') {
        return availableTags.filter(g => g.name !== 'Trade Abschluss')
    }
    return availableTags
})

const dashboardTags = computed(() => {
    const t = []
    for (const group of filteredTagGroups.value) {
        for (const tag of group.tags) {
            t.push(tag)
        }
    }
    return t
})

function inputDashTag(value) {
    if (value === 'all') {
        selectedTags.value = ['t000t', ...dashboardTags.value.map(t => t.id)]
    } else if (value === 't000t') {
        selectedTags.value = ['t000t']
    } else {
        selectedTags.value = [value]
    }
}

const dashTagSelectValue = computed(() => {
    const allIds = dashboardTags.value.map(t => t.id)
    const allSelected = allIds.length > 0 && allIds.every(id => selectedTags.value.includes(id)) && selectedTags.value.includes('t000t')
    if (allSelected) return 'all'
    if (selectedTags.value.length === 1 && selectedTags.value[0] !== 't000t') return selectedTags.value[0]
    if (selectedTags.value.length === 1 && selectedTags.value[0] === 't000t') return 't000t'
    return 'all'
})

let allTagsSelected = ref(false)

const checkAllTagsSelected = () => {
    let temp = []
    for (let i = 0; i < availableTags.length; i++) {
        for (let j = 0; j < availableTags[i].tags.length; j++) {
            temp.push(availableTags[i].tags[j].id)
        }
    }
    allTagsSelected.value = (temp.length + 1) === selectedTags.value.length
}

const selectAllTags = () => {
    selectedTags.value = []
    if (allTagsSelected.value) {
        allTagsSelected.value = false
    } else {
        selectedTags.value.push("t000t")
        for (let i = 0; i < availableTags.length; i++) {
            for (let j = 0; j < availableTags[i].tags.length; j++) {
                selectedTags.value.push(availableTags[i].tags[j].id)
            }
        }
        allTagsSelected.value = true
    }
}

// Positions: display label for dropdown
const positionsLabel = computed(() => {
    if (selectedPositions.value.length === positions.value.length) return 'Alle'
    if (selectedPositions.value.length === 0) return 'Keine'
    return selectedPositions.value.map(v => {
        const p = positions.value.find(p => p.value === v)
        return p ? p.label : v
    }).join(', ')
})

/*============================================
    DATE / PERIOD INPUTS
============================================*/
function inputDateRange(param) {
    const filterJson = periodRange.filter(el => el.value == param)[0]
    selectedPeriodRange.value = filterJson
    let temp = {}
    temp.start = selectedPeriodRange.value.start
    temp.end = selectedPeriodRange.value.end
    selectedDateRange.value = temp
}

function inputDateRangeCal(param1, param2) {
    if (param1 === "start") {
        selectedDateRange.value.start = dayjs.tz(param2, timeZoneTrade.value).unix()
    }
    if (param1 === "end") {
        selectedDateRange.value.end = dayjs.tz(param2, timeZoneTrade.value).endOf("day").unix()
    }
    let tempFilter = periodRange.filter(el => el.start == selectedDateRange.value.start && el.end == selectedDateRange.value.end)
    if (tempFilter.length > 0) {
        selectedPeriodRange.value = tempFilter[0]
    } else {
        selectedPeriodRange.value = periodRange.filter(el => el.start == -1)[0]
    }
}

function inputMonth(param1) {
    let temp = {}
    temp.start = dayjs.tz(param1, timeZoneTrade.value).unix()
    temp.end = dayjs.tz(param1, timeZoneTrade.value).endOf("month").unix()
    selectedMonth.value = temp
}

/*============================================
    SAVE / APPLY FILTER
============================================*/
function applyAndClose() {
    filtersOpen.value = false
    saveFilter()
}

async function saveFilter() {
    if (selectedDateRange.value.end < selectedDateRange.value.start) {
        alert("Enddatum kann nicht vor dem Startdatum liegen")
        return
    } else {
        localStorage.setItem('selectedDateRange', JSON.stringify(selectedDateRange.value))
    }

    if (pageId.value === "dashboard" && selectedDateRange.value.end >= selectedDateRange.value.start && hasData.value) {
        useECharts("clear")
    }

    localStorage.setItem('selectedPeriodRange', JSON.stringify(selectedPeriodRange.value))
    localStorage.setItem('selectedAccounts', selectedAccounts.value)

    localStorage.setItem('selectedGrossNet', selectedGrossNet.value)
    amountCase.value = selectedGrossNet.value
    amountCapital.value = selectedGrossNet.value.charAt(0).toUpperCase() + selectedGrossNet.value.slice(1)

    localStorage.setItem('selectedPositions', selectedPositions.value)
    localStorage.setItem('selectedTimeFrame', selectedTimeFrame.value)
    localStorage.setItem('selectedRatio', selectedRatio.value)

    if (pageId.value === "daily" || pageId.value === "calendar") {
        localStorage.setItem('selectedMonth', JSON.stringify(selectedMonth.value))
    }

    localStorage.setItem('selectedTags', selectedTags.value)
    checkAllTagsSelected()

    if (tempSelectedPlSatisfaction.value != null) {
        selectedPlSatisfaction.value = tempSelectedPlSatisfaction.value
        localStorage.setItem('selectedPlSatisfaction', selectedPlSatisfaction.value)
        tempSelectedPlSatisfaction.value = null
    }

    if (pageId.value === "dashboard") {
        useMountDashboard()
    }
    if (pageId.value === "daily") {
        await useMountDaily()
        useCheckVisibleScreen()
    }
    if (pageId.value === "screenshots") {
        await useRefreshScreenshot()
        useCheckVisibleScreen()
    }
    if (pageId.value === "calendar") {
        useMountCalendar(true)
    }
    if (pageId.value === "auswertung") {
        useMountAuswertung()
    }
}

function has(f) {
    return filters[pageId.value] && filters[pageId.value].includes(f)
}

onMounted(async () => {
    await nextTick()
    useInitTooltip()
})
</script>

<template>
    <div v-show="showFilters" class="sf-outer">
        <!-- Toggle Header -->
        <div class="sf-header" @click="filtersOpen = !filtersOpen">
            <i class="uil uil-filter me-1"></i>
            <span>Filter</span>
            <i :class="filtersOpen ? 'uil uil-angle-up' : 'uil uil-angle-down'" class="ms-auto"></i>
        </div>

        <!-- Collapsible filter content -->
        <div v-show="filtersOpen" class="sf-body">

            <!-- Zeitraum (periodRange) -->
            <div v-if="has('periodRange')" class="sf-row">
                <span class="sf-info" data-bs-toggle="tooltip" data-bs-placement="right" :title="tooltips.periodRange"><i class="uil uil-info-circle"></i></span>
                <select @input="inputDateRange($event.target.value)" class="form-select form-select-sm sf-select">
                    <option v-for="item in periodRange" :key="item.value" :value="item.value"
                        :selected="item.value == selectedPeriodRange.value">{{ item.label }}</option>
                </select>
            </div>
            <!-- Custom date range -->
            <div v-if="has('periodRange') && selectedPeriodRange.value != 'all'" class="sf-date-range">
                <input type="date" class="form-control form-control-sm sf-date"
                    :value="useDateCalFormat(selectedDateRange.start)"
                    @input="inputDateRangeCal('start', $event.target.value)" />
                <span class="sf-date-sep">-</span>
                <input type="date" class="form-control form-control-sm sf-date"
                    :value="useDateCalFormat(selectedDateRange.end)"
                    @input="inputDateRangeCal('end', $event.target.value)" />
            </div>

            <!-- Monat -->
            <div v-if="has('month')" class="sf-row">
                <span class="sf-info" data-bs-toggle="tooltip" data-bs-placement="right" :title="tooltips.month"><i class="uil uil-info-circle"></i></span>
                <input type="month" class="form-control form-control-sm sf-select"
                    :value="useDateCalFormatMonth(selectedMonth.start)"
                    @input="inputMonth($event.target.value)" />
            </div>

            <!-- Brutto / Netto -->
            <div v-if="has('grossNet')" class="sf-row">
                <span class="sf-info" data-bs-toggle="tooltip" data-bs-placement="right" :title="tooltips.grossNet"><i class="uil uil-info-circle"></i></span>
                <select @input="selectedGrossNet = $event.target.value" class="form-select form-select-sm sf-select">
                    <option v-for="item in grossNet" :key="item.value" :value="item.value"
                        :selected="item.value == selectedGrossNet">{{ item.label }}</option>
                </select>
            </div>

            <!-- Positionen (Dropdown mit Checkboxen) -->
            <div v-if="has('positions')" class="sf-row">
                <span class="sf-info" data-bs-toggle="tooltip" data-bs-placement="right" :title="tooltips.positions"><i class="uil uil-info-circle"></i></span>
                <div class="dropdown sf-dropdown-wrap">
                    <button class="btn btn-sm sf-dropdown-btn dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">
                        {{ positionsLabel }}
                    </button>
                    <ul class="dropdown-menu sf-dropdown-menu">
                        <li v-for="item in positions" :key="item.value" class="form-check sf-check-item">
                            <input class="form-check-input" type="checkbox" :value="item.value" v-model="selectedPositions" :id="'pos-' + item.value">
                            <label class="form-check-label" :for="'pos-' + item.value">{{ item.label }}</label>
                        </li>
                    </ul>
                </div>
            </div>

            <!-- Gruppierung (Timeframe) -->
            <div v-if="has('timeFrame')" class="sf-row">
                <span class="sf-info" data-bs-toggle="tooltip" data-bs-placement="right" :title="tooltips.timeFrame"><i class="uil uil-info-circle"></i></span>
                <select @input="selectedTimeFrame = $event.target.value" class="form-select form-select-sm sf-select">
                    <option v-for="item in timeFrames" :key="item.value" :value="item.value"
                        :selected="item.value == selectedTimeFrame">{{ item.label }}</option>
                </select>
            </div>

            <!-- Ratio -->
            <div v-if="has('ratio')" class="sf-row">
                <span class="sf-info" data-bs-toggle="tooltip" data-bs-placement="right" :title="tooltips.ratio"><i class="uil uil-info-circle"></i></span>
                <select @input="selectedRatio = $event.target.value" class="form-select form-select-sm sf-select">
                    <option v-for="item in ratios" :key="item.value" :value="item.value"
                        :selected="item.value == selectedRatio">{{ item.label }}</option>
                </select>
            </div>

            <!-- P&L / Satisfaction (Calendar) -->
            <div v-if="has('plSatisfaction')" class="sf-row">
                <span class="sf-info" data-bs-toggle="tooltip" data-bs-placement="right" :title="tooltips.plSatisfaction"><i class="uil uil-info-circle"></i></span>
                <select @input="tempSelectedPlSatisfaction = $event.target.value" class="form-select form-select-sm sf-select">
                    <option v-for="item in plSatisfaction" :key="item.value" :value="item.value"
                        :selected="item.value == selectedPlSatisfaction">{{ item.label }}</option>
                </select>
            </div>

            <!-- Tags: Dashboard = simple select -->
            <div v-if="has('tags') && pageId === 'dashboard'" class="sf-row">
                <span class="sf-info" data-bs-toggle="tooltip" data-bs-placement="right" :title="tooltips.tags"><i class="uil uil-info-circle"></i></span>
                <select @input="inputDashTag($event.target.value)" class="form-select form-select-sm sf-select">
                    <option value="all" :selected="dashTagSelectValue == 'all'">Alle Tags</option>
                    <option value="t000t" :selected="dashTagSelectValue == 't000t'">Kein Tag</option>
                    <option v-for="tag in dashboardTags" :key="tag.id" :value="tag.id"
                        :selected="dashTagSelectValue == tag.id">{{ tag.name }}</option>
                </select>
            </div>

            <!-- Tags: Other pages = Dropdown with checkboxes -->
            <div v-if="has('tags') && pageId !== 'dashboard'" class="sf-row">
                <span class="sf-info" data-bs-toggle="tooltip" data-bs-placement="right" :title="tooltips.tags"><i class="uil uil-info-circle"></i></span>
                <div class="dropdown sf-dropdown-wrap">
                    <button class="btn btn-sm sf-dropdown-btn dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">
                        Tags ({{ selectedTags.length }})
                    </button>
                    <ul class="dropdown-menu sf-dropdown-menu sf-tag-dropdown">
                        <li class="sf-tag-actions">
                            <a class="pointerClass sf-tag-toggle" @click="selectAllTags">
                                <span v-if="!allTagsSelected">Alle</span><span v-else>Keine</span>
                            </a>
                        </li>
                        <li class="form-check sf-check-item">
                            <input class="form-check-input" type="checkbox" value="t000t" v-model="selectedTags" id="tag-none">
                            <label class="form-check-label" for="tag-none">Kein Tag</label>
                        </li>
                        <template v-for="group in availableTags" :key="group.name">
                            <li class="sf-tag-group-hdr" :style="'background-color: ' + group.color + ';'">{{ group.name }}</li>
                            <li v-for="item in group.tags" :key="item.id" class="form-check sf-check-item">
                                <input class="form-check-input" type="checkbox" :value="item.id" v-model="selectedTags" :id="'tag-' + item.id">
                                <label class="form-check-label" :for="'tag-' + item.id">{{ item.name }}</label>
                            </li>
                        </template>
                    </ul>
                </div>
            </div>

            <!-- Anwenden Button -->
            <div class="sf-apply-row">
                <button class="btn btn-success btn-sm sf-apply-btn" @click="applyAndClose">
                    <i class="uil uil-check me-1"></i>Anwenden
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.sf-outer {
    margin-top: 0.35rem;
    margin-bottom: 0.35rem;
}

/* Collapsible header */
.sf-header {
    display: flex;
    align-items: center;
    padding: 0.4rem 0.5rem;
    cursor: pointer;
    color: var(--white-87);
    font-size: 0.82rem;
    font-weight: 600;
    border: 1px solid var(--white-18);
    border-radius: 8px;
    background: var(--black-bg-7);
    transition: all 0.15s;
    user-select: none;
}

.sf-header:hover {
    background: var(--black-bg-12);
    border-color: var(--white-38);
}

/* Filter body / panel */
.sf-body {
    padding: 0.3rem 0.25rem 0.15rem;
    border: 1px solid var(--white-18);
    border-top: none;
    border-radius: 0 0 8px 8px;
    background: var(--black-bg-5);
    margin-top: -1px;
}

.sf-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0.1rem;
}

.sf-info {
    flex-shrink: 0;
    width: 16px;
    text-align: center;
    color: var(--white-38);
    font-size: 0.85rem;
    cursor: help;
}

.sf-info:hover {
    color: var(--blue-color);
}

.sf-select {
    flex: 1;
    min-width: 0;
    background-color: var(--black-bg-7);
    color: var(--white-87);
    border: 1px solid var(--white-18);
    font-size: 0.75rem;
    padding: 0.18rem 0.3rem;
    border-radius: 6px;
}

.sf-select:focus {
    background-color: var(--black-bg-7);
    color: var(--white-87);
    border-color: var(--blue-color);
    box-shadow: 0 0 0 0.1rem rgba(74, 158, 255, 0.15);
}

.sf-select option {
    background-color: var(--black-bg-7);
    color: var(--white-87);
}

/* Date range */
.sf-date-range {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    padding: 0 0.1rem 0.1rem 20px;
}

.sf-date {
    flex: 1;
    min-width: 0;
    font-size: 0.68rem;
    padding: 0.12rem 0.2rem;
}

.sf-date-sep {
    color: var(--white-38);
    font-size: 0.7rem;
    flex-shrink: 0;
}

/* Dropdown (Positionen, Tags) */
.sf-dropdown-wrap {
    flex: 1;
    min-width: 0;
}

.sf-dropdown-btn {
    width: 100%;
    text-align: left;
    background-color: var(--black-bg-7);
    color: var(--white-87);
    border: 1px solid var(--white-18);
    font-size: 0.75rem;
    padding: 0.18rem 0.3rem;
    border-radius: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sf-dropdown-btn:hover,
.sf-dropdown-btn:focus {
    background-color: var(--black-bg-7);
    color: var(--white-87);
    border-color: var(--blue-color);
}

.sf-dropdown-btn::after {
    display: none;
}

.sf-dropdown-menu {
    min-width: 140px;
    padding: 0.3rem;
    max-height: 200px;
    overflow-y: auto;
}

.sf-check-item {
    padding: 0.08rem 0.4rem 0.08rem 1.5rem;
    font-size: 0.75rem;
}

.sf-check-item .form-check-input {
    width: 0.75em;
    height: 0.75em;
    margin-top: 0.2em;
}

.sf-check-item .form-check-label {
    font-size: 0.75rem;
    color: var(--white-87);
}

/* Tag dropdown extras */
.sf-tag-dropdown {
    min-width: 180px;
}

.sf-tag-actions {
    text-align: right;
    padding: 0.1rem 0.4rem;
    border-bottom: 1px solid var(--white-18);
    margin-bottom: 0.1rem;
}

.sf-tag-toggle {
    font-size: 0.68rem;
    color: var(--blue-color);
}

.sf-tag-toggle:hover {
    color: var(--blue-active-color);
}

.sf-tag-group-hdr {
    font-size: 0.62rem;
    font-weight: 600;
    padding: 0.08rem 0.35rem;
    border-radius: 3px;
    margin: 0.15rem 0.2rem 0.05rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
}

/* Apply button */
.sf-apply-row {
    padding: 0.25rem 0.1rem 0.1rem;
}

.sf-apply-btn {
    width: 100%;
    font-size: 0.72rem;
    padding: 0.22rem 0;
    border-radius: 6px;
}
</style>
