<script setup>
import { computed, onBeforeMount, onMounted, onUnmounted, ref, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue';
import { spinnerLoadingPage, dashboardIdMounted, renderData, dashboardChartsMounted, hasData, barChartNegativeTagGroups, timeZoneTrade } from '../stores/ui.js'
import { selectedDashTab, amountCase, amountCapital, selectedRatio, selectedBroker } from '../stores/filters.js'
import { totals, profitAnalysis, satisfactionArray, satisfactionTradeArray, availableTags, groups, filteredTradesTrades, excursions } from '../stores/trades.js'
import { currentUser } from '../stores/settings.js'
import { dbFind } from '../utils/db.js'
import dayjs from '../utils/dayjs-setup.js'
import { useThousandCurrencyFormat, useTwoDecCurrencyFormat, useXDecCurrencyFormat, useThousandFormat, useXDecFormat } from '../utils/formatters.js';
import { useMountDashboard } from '../utils/mountOrchestration.js';
import NoData from '../components/NoData.vue';

const { t } = useI18n()

// ========== Karten-Konfiguration ==========
const CARD_STORAGE_KEY = 'dashboard_hidden_cards'
const hiddenCards = reactive(new Set(JSON.parse(localStorage.getItem(CARD_STORAGE_KEY) || '[]')))
const showConfigDropdown = ref(false)

const cardDefinitions = computed(() => [
    { key: 'accountBalance', label: t('dashboard.accountBalance') },
    { key: 'metrics', label: t('dashboard.metrics') },
    { key: 'fees', label: t('dashboard.fees') },
    { key: 'cumulativePnl', label: t('dashboard.cumulativePnlChart') },
    { key: 'appt', label: 'APPT' },
    { key: 'winRate', label: t('dashboard.winRate') },
    { key: 'tradingPerformance', label: t('dashboard.tradingPerformance') },
    { key: 'byWeekday', label: t('dashboard.byWeekday', { metric: '' }).replace(/[()]/g, '').trim() },
    { key: 'byEntryTime', label: t('dashboard.byEntryTime', { metric: '' }).replace(/[()]/g, '').trim() },
    { key: 'byDuration', label: t('dashboard.byDuration', { metric: '' }).replace(/[()]/g, '').trim() },
    { key: 'heatmap', label: t('dashboard.heatmapTitle') },
    { key: 'byPosition', label: t('dashboard.byPosition', { metric: '' }).replace(/[()]/g, '').trim() },
    { key: 'byStrategy', label: t('dashboard.byStrategy', { metric: '' }).replace(/[()]/g, '').trim() },
    { key: 'tradeTypeStats', label: t('dashboard.tradeTypeStats') },
    { key: 'strategyTagStats', label: t('dashboard.strategyTagStats') },
    { key: 'bySymbol', label: t('dashboard.bySymbol', { metric: '' }).replace(/[()]/g, '').trim() },
    { key: 'feesBySymbol', label: t('dashboard.feesBySymbol') },
    { key: 'mfeAnalysis', label: t('dashboard.mfeAnalysis') },
])

function toggleCard(key) {
    if (hiddenCards.has(key)) {
        hiddenCards.delete(key)
    } else {
        hiddenCards.add(key)
    }
    localStorage.setItem(CARD_STORAGE_KEY, JSON.stringify([...hiddenCards]))
}

function isVisible(key) {
    return !hiddenCards.has(key)
}

// Dropdown schließen bei Klick außerhalb
const configRef = ref(null)
function onClickOutside(e) {
    if (showConfigDropdown.value && configRef.value && !configRef.value.contains(e.target)) {
        showConfigDropdown.value = false
    }
}

onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))

const dashTabs = computed(() => [{
    id: "overviewTab",
    label: t('dashboard.overview'),
    target: "#overviewNav"
},
{
    id: "tradesTab",
    label: t('dashboard.performance'),
    target: "#tradesNav"
},
{
    id: "timeTab",
    label: t('dashboard.timeAndDate'),
    target: "#timeNav"
},
{
    id: "setupsTab",
    label: t('dashboard.setups'),
    target: "#setupsNav"
},
{
    id: "financialsTab",
    label: t('dashboard.finances'),
    target: "#financialsNav"
}
])
amountCapital.value = amountCase.value ? amountCase.value.charAt(0).toUpperCase() + amountCase.value.slice(1) : ''

const ratioCompute = computed(() => {
    let ratio = {}
    if (localStorage.getItem('selectedRatio') == 'appt') {
        ratio.shortName = "APPT"
        ratio.name = t('dashboard.avgProfitPerTrade')
        ratio.value = useTwoDecCurrencyFormat(totals.trades ? (totals[amountCase.value + 'Proceeds'] / totals.trades) : 0)
        ratio.tooltipTitle = '<div>' + t('dashboard.avgProfitPerTrade') + '</div><div>' + t('dashboard.apptFormula') + '</div><div>' + t('dashboard.proceeds') + ': ' + useThousandCurrencyFormat(totals[amountCase.value + 'Proceeds']) + '</div><div>Trades: ' + useThousandFormat(totals.trades) + '</div>'
    }
    if (localStorage.getItem('selectedRatio') == 'profitFactor') {
        ratio.shortName = t('options.profitFactor')
        ratio.name = t('options.profitFactor')
        let wins = parseFloat(totals[amountCase.value + 'Wins']).toFixed(2)
        let loss = parseFloat(-totals[amountCase.value + 'Loss']).toFixed(2)
        let profitFactor = 0
        //console.log("wins " + wins + " and loss " + loss)
        if (loss != 0) {
            profitFactor = wins / loss
            //console.log(" -> profitFactor "+profitFactor)
        }
        ratio.value = useXDecFormat(profitFactor, 2)
        ratio.tooltipTitle = '<div>' + t('dashboard.profitFactorFormula') + '</div><div>' + t('dashboard.gains') + ': ' + useThousandCurrencyFormat(totals[amountCase.value + 'Wins']) + '</div><div>' + t('dashboard.losses') + ': ' + useThousandCurrencyFormat(totals[amountCase.value + 'Loss']) + '</div>'
    }
    return ratio
})

const hasSatisfactionData = computed(() => satisfactionArray.length > 0 || satisfactionTradeArray.length > 0)
const hasRRRData = computed(() => {
    const rVal = profitAnalysis[amountCase.value + 'R']
    return rVal && !isNaN(rVal) && rVal > 0
})

const todayStats = computed(() => {
    const tz = timeZoneTrade.value || 'Europe/Brussels'
    const todayStart = dayjs().tz(tz).startOf('day').unix()
    const todayEnd = dayjs().tz(tz).endOf('day').unix()

    let total = 0, wins = 0, losses = 0, pnl = 0
    for (const trade of filteredTradesTrades) {
        if (trade.td >= todayStart && trade.td <= todayEnd) {
            total++
            const gp = trade.grossProceeds || 0
            pnl += gp
            if (gp > 0) wins++
            else losses++
        }
    }
    return { total, wins, losses, pnl }
})

// All-time net P&L for selected broker (loaded on mount, independent of date filter)
const allTimeNetPnL = ref(0)
const allTimeVolume = ref(0)
const last30dVolume = ref(0)

async function loadAllTimeNetPnL() {
    const broker = selectedBroker.value || 'bitunix'
    const allTrades = await dbFind('trades', { equalTo: { broker }, limit: 100000 })
    let totalNet = 0
    let totalVol = 0
    let vol30d = 0
    const cutoff30d = dayjs().subtract(30, 'day').unix()

    for (const day of allTrades) {
        if (day.pAndL && typeof day.pAndL === 'object') {
            totalNet += day.pAndL.netProceeds || 0
        }
        // Volumen aus den Einzeltrades berechnen: qty × entryPrice
        if (day.trades && Array.isArray(day.trades)) {
            for (const trade of day.trades) {
                const qty = Math.max(trade.buyQuantity || 0, trade.sellQuantity || 0)
                const price = trade.entryPrice || 0
                const vol = qty * price
                totalVol += vol
                if (day.dateUnix >= cutoff30d) {
                    vol30d += vol
                }
            }
        }
    }
    allTimeNetPnL.value = totalNet
    allTimeVolume.value = totalVol
    last30dVolume.value = vol30d
}

const accountBalance = computed(() => {
    const broker = selectedBroker.value || 'bitunix'
    const balances = currentUser.value?.balances || {}
    let start = 0
    if (balances[broker]) {
        start = balances[broker].start || 0
    } else {
        start = currentUser.value?.startBalance || 0
    }
    if (!start) return null
    // Current balance = start deposit + all-time net P&L (fees included)
    const current = start + allTimeNetPnL.value
    const pnl = current - start
    const perf = start > 0 ? ((current / start) - 1) * 100 : 0
    return { start, current, pnl, perf }
})

// Trade-Typ Statistik (Scalptrade / Daytrade / Swingtrade)
const tradeTypeLabels = { scalp: 'Scalptrade', day: 'Daytrade', swing: 'Swingtrade' }
const tradeTypeColors = { scalp: '#f59e0b', day: '#3b82f6', swing: '#8b5cf6' }

const tradeTypeStats = computed(() => {
    if (!groups.tradeType || Object.keys(groups.tradeType).length === 0) return []

    const stats = []

    for (const [type, trades] of Object.entries(groups.tradeType)) {
        if (!trades || trades.length === 0) continue

        let wins = 0, losses = 0, totalPnl = 0, grossWins = 0, grossLoss = 0

        trades.forEach(t => {
            const pnl = t.netProceeds || 0
            totalPnl += pnl
            if (pnl >= 0) { wins++; grossWins += pnl }
            else { losses++; grossLoss += Math.abs(pnl) }
        })

        const count = trades.length
        const winRate = count > 0 ? (wins / count * 100) : 0
        const avgPnl = count > 0 ? totalPnl / count : 0
        const profitFactor = grossLoss > 0 ? grossWins / grossLoss : grossWins > 0 ? Infinity : 0

        stats.push({
            type,
            label: tradeTypeLabels[type] || type,
            color: tradeTypeColors[type] || '#6b7280',
            count, wins, losses, winRate, totalPnl, avgPnl, profitFactor
        })
    }

    stats.sort((a, b) => b.totalPnl - a.totalPnl)
    return stats
})

// Strategie-Tag Statistik (Retest EMA, Guss, etc.)
const strategyTagStats = computed(() => {
    const stratGroup = availableTags.length > 0 ? availableTags[0] : null
    if (!stratGroup || !groups.tags) return []

    const stratTagIds = new Set(stratGroup.tags.map(t => t.id))
    const stats = []

    for (const tagId of Object.keys(groups.tags)) {
        if (!stratTagIds.has(tagId)) continue
        const trades = groups.tags[tagId]
        if (!trades || trades.length === 0) continue

        let tagName = tagId, tagColor = stratGroup.color
        let wins = 0, losses = 0, totalPnl = 0, grossWins = 0, grossLoss = 0

        trades.forEach(t => {
            if (t.tagName) tagName = t.tagName
            const pnl = t.netProceeds || 0
            totalPnl += pnl
            if (pnl >= 0) { wins++; grossWins += pnl }
            else { losses++; grossLoss += Math.abs(pnl) }
        })

        const tagDef = stratGroup.tags.find(t => t.id === tagId)
        if (tagDef && tagDef.color) tagColor = tagDef.color

        const count = trades.length
        const winRate = count > 0 ? (wins / count * 100) : 0
        const avgPnl = count > 0 ? totalPnl / count : 0
        const profitFactor = grossLoss > 0 ? grossWins / grossLoss : grossWins > 0 ? Infinity : 0

        stats.push({ tagName, tagColor, count, wins, losses, winRate, totalPnl, avgPnl, profitFactor })
    }

    stats.sort((a, b) => b.totalPnl - a.totalPnl)
    return stats
})

// MFE Analyse: Verlust-Trades die zwischenzeitlich im Plus waren
const mfeAnalysisStats = computed(() => {
    const prefix = amountCase.value // 'gross' oder 'net'
    const result = {
        totalLossTrades: 0,
        lossTradesWithMfe: 0,
        percentage: 0,
        totalMfeProfit: 0,
        totalRealizedLoss: 0,
        trades: []
    }
    if (!filteredTradesTrades || filteredTradesTrades.length === 0 || !excursions || excursions.length === 0) return result

    // Excursions-Map für schnellen Lookup
    const excMap = new Map()
    excursions.forEach(e => { if (e.tradeId) excMap.set(e.tradeId, e) })

    filteredTradesTrades.forEach(trade => {
        const proceeds = trade[prefix + 'Proceeds'] || 0
        if (proceeds >= 0) return // nur Verlust-Trades

        result.totalLossTrades++

        const exc = excMap.get(trade.id)
        if (!exc || !exc.mfePrice) return

        // War der Trade zwischenzeitlich im Plus?
        const isLong = trade.strategy === 'long'
        const wasInProfit = isLong
            ? exc.mfePrice > trade.entryPrice
            : exc.mfePrice < trade.entryPrice

        if (!wasInProfit) return

        result.lossTradesWithMfe++

        // Berechne verschenkten Gewinn
        const mfeProfit = isLong
            ? (exc.mfePrice - trade.entryPrice) * (trade.buyQuantity || 0)
            : (trade.entryPrice - exc.mfePrice) * (trade.buyQuantity || 0)
        const realizedLoss = Math.abs(proceeds)

        result.totalMfeProfit += mfeProfit
        result.totalRealizedLoss += realizedLoss

        result.trades.push({
            symbol: trade.symbol || '',
            date: trade.td || trade.entryTime,
            strategy: trade.strategy,
            mfeProfit,
            realizedLoss,
            mfePrice: exc.mfePrice,
            entryPrice: trade.entryPrice,
            exitPrice: trade.exitPrice
        })
    })

    result.percentage = result.totalLossTrades > 0
        ? (result.lossTradesWithMfe / result.totalLossTrades * 100)
        : 0

    // Sortiert nach verschenktem Gewinn (mfeProfit) absteigend
    result.trades.sort((a, b) => b.mfeProfit - a.mfeProfit)

    return result
})

const feeStats = computed(() => {
    const totalFees = totals.fees || 0
    const tradeCount = totals.trades || 0
    const grossWins = totals.grossWins || 0
    const grossProceeds = totals.grossProceeds || 0
    const perTrade = tradeCount > 0 ? totalFees / tradeCount : 0
    // Gebühren-Impact: Anteil der Gebühren am Brutto-Gewinn (nur wenn positiv)
    const impactPercent = grossWins > 0 ? (totalFees / grossWins) * 100 : 0
    // Brutto vs. Netto Differenz als Prozent
    const bruttoNetDiff = grossProceeds !== 0 ? (totalFees / Math.abs(grossProceeds)) * 100 : 0
    return { totalFees, perTrade, impactPercent, bruttoNetDiff, tradeCount }
})

onBeforeMount(async () => {
    barChartNegativeTagGroups.length = 0
    await loadAllTimeNetPnL()
    await useMountDashboard()
    //console.log(" availableTags "+JSON.stringify(availableTags))
    //console.log(" groups "+JSON.stringify(groups))

    //getting the "id" of barChartNegative based on the tag groups
    
    //console.log(" barChartNegativeTagGroups "+JSON.stringify(barChartNegativeTagGroups.value))
})


</script>

<template>
    <SpinnerLoadingPage />
    <div class="row mt-2">

        <div v-show="!spinnerLoadingPage">
            <div v-if="!hasData">
                <NoData />
            </div>
            <div v-else>
                <div class="d-flex align-items-center mb-2">
                    <nav class="flex-grow-1">
                        <div class="nav nav-tabs" id="nav-tab" role="tablist">
                            <button v-for="dashTab in dashTabs" :key="dashTab.id"
                                :class="'nav-link ' + (selectedDashTab == dashTab.id ? 'active' : '')" :id="dashTab.id"
                                data-bs-toggle="tab" :data-bs-target="dashTab.target" type="button" role="tab"
                                aria-controls="nav-overview" aria-selected="true">{{ dashTab.label }}</button>
                        </div>
                    </nav>
                    <div ref="configRef" class="position-relative ms-2">
                        <button class="btn btn-sm btn-outline-secondary" @click="showConfigDropdown = !showConfigDropdown">
                            <i class="uil uil-setting"></i>
                        </button>
                        <div v-if="showConfigDropdown" class="card-config-dropdown">
                            <div class="card-config-title">{{ t('auswertung.visibleCards') }}</div>
                            <div v-for="card in cardDefinitions" :key="card.key" class="card-config-item" @click="toggleCard(card.key)">
                                <i class="uil me-2" :class="isVisible(card.key) ? 'uil-check-square text-success' : 'uil-square-full text-muted'"></i>
                                {{ card.label }}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="tab-content" id="nav-tabContent">

                    <!-- ============ OVERVIEW ============ -->
                    <div v-bind:class="'tab-pane fade ' + (selectedDashTab == 'overviewTab' ? 'active show' : '')"
                        id="overviewNav" role="tabpanel" aria-labelledby="nav-overview-tab">
                        <!-- ============ 3-COLUMN OVERVIEW ============ -->
                        <div v-if="dashboardIdMounted" class="col-12 mb-3">
                            <div class="row">

                                <!-- ===== LINKE SPALTE: Kontostand + Donuts ===== -->
                                <div v-if="isVisible('accountBalance')" class="col-12 col-xl-4 mb-3 mb-xl-0">
                                    <div class="dailyCard h-100">
                                        <h6>{{ t('dashboard.accountBalance') }}</h6>

                                        <!-- Kontostand wenn gesetzt -->
                                        <div v-if="accountBalance" class="text-center py-3">
                                            <div class="fs-2 fw-bold" :class="accountBalance.pnl >= 0 ? 'greenTrade' : 'redTrade'">
                                                {{ useTwoDecCurrencyFormat(accountBalance.current) }}
                                            </div>
                                            <div class="dashInfoTitle mb-1">{{ t('dashboard.currentBalance') }}</div>
                                            <div class="fs-5" :class="accountBalance.perf >= 0 ? 'greenTrade' : 'redTrade'">
                                                {{ accountBalance.perf >= 0 ? '+' : '' }}{{ accountBalance.perf.toFixed(1) }}%
                                            </div>
                                        </div>

                                        <!-- Platzhalter wenn nicht gesetzt -->
                                        <div v-else class="text-center py-3">
                                            <div class="text-muted mb-1"><i class="uil uil-wallet fs-3"></i></div>
                                            <div class="text-muted small">{{ t('dashboard.configureBalance') }}</div>
                                        </div>

                                        <!-- Trading-Volumen -->
                                        <div v-if="allTimeVolume > 0" class="mt-2 pt-2" style="border-top: 1px solid var(--white-10);">
                                            <table class="stats-table w-100">
                                                <tbody>
                                                    <tr>
                                                        <td class="text-muted small">{{ t('dashboard.volume30d') }}</td>
                                                        <td class="text-end fw-bold small">{{ useThousandCurrencyFormat(last30dVolume) }}</td>
                                                    </tr>
                                                    <tr>
                                                        <td class="text-muted small">{{ t('dashboard.volumeTotal') }}</td>
                                                        <td class="text-end fw-bold small">{{ useThousandCurrencyFormat(allTimeVolume) }}</td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>

                                        <hr />

                                        <!-- Donuts nebeneinander -->
                                        <div class="row text-center">
                                            <div :class="(hasSatisfactionData || hasRRRData) ? ((hasSatisfactionData && hasRRRData) ? 'col-4' : 'col-6') : 'col-12'">
                                                <div v-bind:key="renderData" id="pieChart1" class="chartIdCardClass"></div>
                                            </div>
                                            <div v-if="hasSatisfactionData" :class="hasRRRData ? 'col-4' : 'col-6'">
                                                <div v-bind:key="renderData" id="pieChart2" class="chartIdCardClass"></div>
                                            </div>
                                            <div v-if="hasRRRData" :class="hasSatisfactionData ? 'col-4' : 'col-6'">
                                                <div v-bind:key="renderData" id="pieChart3" class="chartIdCardClass"></div>
                                            </div>
                                        </div>

                                        <!-- Tages Trade Zähler -->
                                        <div v-if="todayStats.total > 0" class="text-center mt-2 pt-2" style="border-top: 1px solid var(--white-10);">
                                            <div class="small text-muted mb-1">{{ t('common.today') }}</div>
                                            <div class="d-flex justify-content-center align-items-center gap-3">
                                                <span class="fw-bold">{{ todayStats.total }} <span class="text-muted fw-normal">{{ t('common.trades') }}</span></span>
                                                <span class="greenTrade">{{ todayStats.wins }} <i class="uil uil-arrow-up"></i></span>
                                                <span class="redTrade">{{ todayStats.losses }} <i class="uil uil-arrow-down"></i></span>
                                            </div>
                                            <div class="mt-1" :class="todayStats.pnl >= 0 ? 'greenTrade' : 'redTrade'">
                                                <small class="fw-bold">{{ todayStats.pnl >= 0 ? '+' : '' }}{{ useTwoDecCurrencyFormat(todayStats.pnl) }}</small>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- ===== MITTLERE SPALTE: Kennzahlen ===== -->
                                <div v-if="isVisible('metrics')" class="col-12 col-xl-4 mb-3 mb-xl-0">
                                    <div class="dailyCard h-100">
                                        <h6>{{ t('dashboard.metrics') }}</h6>
                                        <table class="stats-table w-100">
                                            <tbody>
                                                <tr>
                                                    <td>{{ t('dashboard.cumulativePnl') }}
                                                        <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" :data-bs-title="t('dashboard.cumulativePnlTooltip')"></i>
                                                    </td>
                                                    <td class="text-end fw-bold" :class="totals[amountCase + 'Proceeds'] >= 0 ? 'greenTrade' : 'redTrade'">
                                                        {{ useThousandCurrencyFormat(totals[amountCase + 'Proceeds']) }}
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td>
                                                        {{ ratioCompute.shortName }}
                                                        <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" :data-bs-title="ratioCompute.tooltipTitle"></i>
                                                    </td>
                                                    <td class="text-end fw-bold">{{ ratioCompute.value }}</td>
                                                </tr>
                                                <tr>
                                                    <td>{{ t('dashboard.plRatio') }}
                                                        <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" :data-bs-title="t('dashboard.plRatioTooltip')"></i>
                                                    </td>
                                                    <td class="text-end fw-bold">
                                                        <span v-if="!isNaN(profitAnalysis[amountCase + 'R'])">{{ (profitAnalysis[amountCase + 'R']).toFixed(2) }}</span>
                                                        <span v-else>-</span>
                                                    </td>
                                                </tr>
                                                <tr v-if="profitAnalysis[amountCase + 'MfeR'] != null">
                                                    <td>{{ t('dashboard.mfePlRatio') }}
                                                        <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" :data-bs-title="t('dashboard.mfePlRatioTooltip')"></i>
                                                    </td>
                                                    <td class="text-end fw-bold">{{ (profitAnalysis[amountCase + 'MfeR']).toFixed(2) }}</td>
                                                </tr>
                                                <tr class="stats-separator"><td colspan="2"><hr /></td></tr>
                                                <tr>
                                                    <td class="greenTrade">{{ t('dashboard.avgWinPerTrade') }}</td>
                                                    <td class="text-end">
                                                        <span v-if="!isNaN(profitAnalysis[amountCase + 'AvWinPerShare'])">{{ useTwoDecCurrencyFormat(profitAnalysis[amountCase + 'AvWinPerShare']) }}</span>
                                                        <span v-else>-</span>
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td class="redTrade">{{ t('dashboard.avgLossPerTrade') }}</td>
                                                    <td class="text-end">
                                                        <span v-if="!isNaN(profitAnalysis[amountCase + 'AvLossPerShare'])">{{ useTwoDecCurrencyFormat(profitAnalysis[amountCase + 'AvLossPerShare']) }}</span>
                                                        <span v-else>-</span>
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td class="greenTrade">{{ t('dashboard.maxWin') }}</td>
                                                    <td class="text-end">
                                                        <span v-if="profitAnalysis[amountCase + 'HighWinPerShare'] > 0">{{ useTwoDecCurrencyFormat(profitAnalysis[amountCase + 'HighWinPerShare']) }}</span>
                                                        <span v-else>-</span>
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td class="redTrade">{{ t('dashboard.maxLoss') }}</td>
                                                    <td class="text-end">
                                                        <span v-if="profitAnalysis[amountCase + 'HighLossPerShare'] > 0">{{ useTwoDecCurrencyFormat(profitAnalysis[amountCase + 'HighLossPerShare']) }}</span>
                                                        <span v-else>-</span>
                                                    </td>
                                                </tr>
                                                <tr class="stats-separator"><td colspan="2"><hr /></td></tr>
                                                <tr>
                                                    <td>{{ t('common.trades') }}</td>
                                                    <td class="text-end fw-bold">{{ useThousandFormat(totals.trades) }}</td>
                                                </tr>
                                                <tr>
                                                    <td class="greenTrade">{{ t('dashboard.winTrades') }}</td>
                                                    <td class="text-end">{{ totals[amountCase + 'WinsCount'] }}</td>
                                                </tr>
                                                <tr>
                                                    <td class="redTrade">{{ t('dashboard.lossTrades') }}</td>
                                                    <td class="text-end">{{ totals[amountCase + 'LossCount'] }}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                <!-- ===== RECHTE SPALTE: Gebühren ===== -->
                                <div v-if="isVisible('fees')" class="col-12 col-xl-4">
                                    <div class="dailyCard h-100">
                                        <h6>{{ t('dashboard.fees') }}</h6>

                                        <!-- Gesamtgebühren -->
                                        <div class="text-center py-3">
                                            <div class="fs-2 fw-bold text-warning">
                                                {{ useTwoDecCurrencyFormat(feeStats.totalFees) }}
                                            </div>
                                            <div class="dashInfoTitle">{{ t('dashboard.totalFees') }}</div>
                                        </div>

                                        <!-- Visueller Balken: Anteil am Brutto-Gewinn -->
                                        <div v-if="feeStats.impactPercent > 0" class="mb-3 px-2">
                                            <div class="d-flex justify-content-between small mb-1">
                                                <span>{{ t('dashboard.feeShareOfGross') }}</span>
                                                <span class="fw-bold">{{ feeStats.impactPercent.toFixed(1) }}%</span>
                                            </div>
                                            <div class="fee-bar-bg">
                                                <div class="fee-bar-fill" :style="{ width: Math.min(feeStats.impactPercent, 100) + '%' }"></div>
                                            </div>
                                        </div>

                                        <hr />

                                        <!-- Detail-Tabelle -->
                                        <table class="stats-table w-100">
                                            <tbody>
                                                <tr>
                                                    <td>{{ t('dashboard.avgPerTrade') }}</td>
                                                    <td class="text-end fw-bold">{{ useTwoDecCurrencyFormat(feeStats.perTrade) }}</td>
                                                </tr>
                                                <tr>
                                                    <td>{{ t('dashboard.tradingFees') }}
                                                        <i class="ps-1 uil uil-info-circle" style="font-size: 0.75rem; opacity: 0.5;" data-bs-toggle="tooltip" data-bs-html="true" :data-bs-title="t('dashboard.tradingFeesTooltip')"></i>
                                                    </td>
                                                    <td class="text-end">{{ useTwoDecCurrencyFormat(totals.tradingFees || totals.commission || 0) }}</td>
                                                </tr>
                                                <tr v-if="(totals.fundingPaid || 0) > 0">
                                                    <td>{{ t('dashboard.fundingPaid') }}
                                                        <i class="ps-1 uil uil-info-circle" style="font-size: 0.75rem; opacity: 0.5;" data-bs-toggle="tooltip" data-bs-html="true" :data-bs-title="t('dashboard.fundingFeesTooltip')"></i>
                                                    </td>
                                                    <td class="text-end">{{ useTwoDecCurrencyFormat(totals.fundingPaid) }}</td>
                                                </tr>
                                                <tr v-if="(totals.fundingReceived || 0) > 0">
                                                    <td>{{ t('dashboard.fundingReceived') }}
                                                        <i class="ps-1 uil uil-info-circle" style="font-size: 0.75rem; opacity: 0.5;" data-bs-toggle="tooltip" data-bs-html="true" :data-bs-title="t('dashboard.fundingFeesTooltip')"></i>
                                                    </td>
                                                    <td class="text-end greenTrade">-{{ useTwoDecCurrencyFormat(totals.fundingReceived) }}</td>
                                                </tr>
                                                <tr v-if="(totals.otherCommission || 0) > 0">
                                                    <td>{{ t('dashboard.regulatoryFees') }}</td>
                                                    <td class="text-end">{{ useTwoDecCurrencyFormat(totals.otherCommission) }}</td>
                                                </tr>
                                                <tr v-if="(totals.otherFees || 0) > 0">
                                                    <td>{{ t('dashboard.otherFees') }}</td>
                                                    <td class="text-end">{{ useTwoDecCurrencyFormat(totals.otherFees) }}</td>
                                                </tr>
                                            </tbody>
                                        </table>

                                        <!-- Brutto vs. Netto -->
                                        <hr />
                                        <table class="stats-table w-100">
                                            <tbody>
                                                <tr>
                                                    <td class="fw-bold">{{ t('dashboard.grossPnl') }}</td>
                                                    <td class="text-end fw-bold" :class="totals.grossProceeds >= 0 ? 'greenTrade' : 'redTrade'">{{ useTwoDecCurrencyFormat(totals.grossProceeds || 0) }}</td>
                                                </tr>
                                                <tr>
                                                    <td class="fw-bold">{{ t('dashboard.netPnl') }}</td>
                                                    <td class="text-end fw-bold" :class="totals.netProceeds >= 0 ? 'greenTrade' : 'redTrade'">{{ useTwoDecCurrencyFormat(totals.netProceeds || 0) }}</td>
                                                </tr>
                                                <tr>
                                                    <td class="text-muted">{{ t('dashboard.feeDifference') }}</td>
                                                    <td class="text-end text-warning">{{ useTwoDecCurrencyFormat(feeStats.totalFees) }}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                            </div>
                        </div>

                        <!-- ============ LINE 3 : TOTAL CHARTS ============ -->
                        <div class="col-12">
                            <div class="row">
                                <!-- KUMULIERTER G/V -->
                                <div v-if="isVisible('cumulativePnl')" class="col-12 mb-3">
                                    <div class="dailyCard">
                                        <h6>{{ t('dashboard.cumulativePnlChart') }}
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" :data-bs-title="t('dashboard.cumulativePnlChartTooltip')"></i>
                                        </h6>
                                        <div v-bind:key="renderData" id="lineBarChart1" class="chartClass"></div>
                                    </div>
                                </div>

                                <!-- APPT/APPS/PROFIT FACTOR CHART -->
                                <div v-if="isVisible('appt')" class="col-12 col-xl-6 mb-3">
                                    <div class="dailyCard">
                                        <h6>{{ ratioCompute.name }} <span
                                                v-if="ratioCompute.shortName === 'APPT'">({{ ratioCompute.shortName
                                                }})</span></h6>
                                        <div v-bind:key="renderData" id="barChart1" class="chartClass"></div>
                                    </div>
                                </div>

                                <!-- WIN LOSS CHART -->
                                <div v-if="isVisible('winRate')" class="col-12 col-xl-6 mb-3">
                                    <div class="dailyCard">
                                        <h6>{{ t('dashboard.winRate') }}
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" :data-bs-title="t('dashboard.winRateTooltip')"></i>
                                        </h6>
                                        <!--<div class="text-center" v-if="!dashboardChartsMounted">
                                    <div class="spinner-border text-blue" role="status"></div>
                                </div>-->
                                        <div v-bind:key="renderData" id="barChart2" class="chartClass"></div>
                                    </div>
                                </div>

                                <!-- RISK REWARD CHART
                    <div class="col-12 col-xl-6 mb-3">
                        <div class="dailyCard">
                            <h6>Risk & Reward</h6>
                            <div class="text-center" v-if="!dashboardChartsMounted">
                                <div class="spinner-border text-blue" role="status"></div>
                            </div>
                            <div v-bind:key="renderData" id="boxPlotChart1" class="chartClass"></div>
                        </div>
                    </div>-->

                            </div>
                        </div>

                    </div>

                    <!-- ============ TIME ============ -->
                    <div v-bind:class="'tab-pane fade ' + (selectedDashTab == 'timeTab' ? 'active show' : '')"
                        id="timeNav" role="tabpanel" aria-labelledby="nav-time-tab">
                        <div class="col-12">
                            <div class="row">
                                <!-- GROUP BY DAY OF WEEK -->
                                <div v-if="isVisible('byWeekday')" class="col-12 col-xl-4 mb-3">
                                    <div class="dailyCard">
                                        <h6>{{ t('dashboard.byWeekday', { metric: ratioCompute.shortName }) }}
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" :data-bs-title="t('dashboard.byWeekdayTooltip')"></i>
                                        </h6>
                                        <div v-bind:key="renderData" id="weekdayChart1" class="chartClass"></div>
                                    </div>
                                </div>

                                <!-- GROUP BY TIMEFRAME -->
                                <div v-if="isVisible('byEntryTime')" class="col-12 col-xl-4 mb-3">
                                    <div class="dailyCard">
                                        <h6>{{ t('dashboard.byEntryTime', { metric: ratioCompute.shortName }) }}
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" :data-bs-title="t('dashboard.byEntryTimeTooltip')"></i>
                                        </h6>
                                        <div v-bind:key="renderData" id="entryTimeChart1" class="chartClass"></div>
                                    </div>
                                </div>

                                <!-- GROUP BY DURATION -->
                                <div v-if="isVisible('byDuration')" class="col-12 col-xl-4 mb-3">
                                    <div class="dailyCard">
                                        <h6>{{ t('dashboard.byDuration', { metric: ratioCompute.shortName }) }}
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" :data-bs-title="t('dashboard.byDurationTooltip')"></i>
                                        </h6>
                                        <div v-bind:key="renderData" id="durationChart1" class="chartClass"></div>
                                    </div>
                                </div>


                                <!-- HEATMAP: WEEKDAY × HOUR -->
                                <div v-if="isVisible('heatmap')" class="col-12 mb-3">
                                    <div class="dailyCard">
                                        <h6>{{ t('dashboard.heatmapTitle') }}
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" :data-bs-title="t('dashboard.heatmapTooltip')"></i>
                                        </h6>
                                        <div v-bind:key="renderData" id="heatmapChart1" class="chartClass" style="height: 280px;"></div>
                                    </div>
                                </div>

                                <!-- SCATTER WINS
                                <div class="col-12">
                                    <div class="dailyCard">
                                        <h6>Scatter Wins</h6>
                                        <div v-bind:key="renderData" id="scatterChart1" class="chartClass"></div>
                                    </div>
                                </div>

                                SCATTER LOSSES
                                <div class="col-12">
                                    <div class="dailyCard">
                                        <h6>Scatter Losses</h6>
                                        <div v-bind:key="renderData" id="scatterChart2" class="chartClass"></div>
                                    </div>
                                </div>-->

                            </div>
                        </div>
                    </div>

                    <!-- ============ TRADES (Trading Performance) ============ -->
                    <div v-bind:class="'tab-pane fade ' + (selectedDashTab == 'tradesTab' ? 'active show' : '')"
                        id="tradesNav" role="tabpanel" aria-labelledby="nav-trades-tab">
                        <div class="col-12">
                            <div class="row">

                                <!-- TRADING PERFORMANCE CHART -->
                                <div v-if="isVisible('tradingPerformance')" class="col-12 mb-3">
                                    <div class="dailyCard">
                                        <h6>{{ t('dashboard.tradingPerformance') }}
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" :data-bs-title="t('dashboard.tradingPerformanceTooltip')"></i>
                                        </h6>
                                        <div v-bind:key="renderData" id="perfChart1" class="chartClass" style="height: 550px;"></div>
                                    </div>
                                </div>

                                <!-- MFE ANALYSE: Verlust-Trades die im Plus waren -->
                                <div v-if="isVisible('mfeAnalysis') && mfeAnalysisStats.lossTradesWithMfe > 0" class="col-12 mb-3">
                                    <div class="dailyCard">
                                        <h6>{{ t('dashboard.mfeAnalysis') }}
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" :data-bs-title="t('dashboard.mfeAnalysisTooltip')"></i>
                                        </h6>

                                        <!-- Zusammenfassung -->
                                        <div class="d-flex flex-wrap gap-3 mb-3">
                                            <div class="d-flex align-items-center gap-2">
                                                <span class="text-muted">{{ t('dashboard.lossTradesInProfit') }}:</span>
                                                <span class="fw-bold redTrade">
                                                    {{ mfeAnalysisStats.lossTradesWithMfe }} / {{ mfeAnalysisStats.totalLossTrades }}
                                                    <span class="txt-small">({{ mfeAnalysisStats.percentage.toFixed(0) }}%)</span>
                                                </span>
                                            </div>
                                            <div class="d-flex align-items-center gap-2">
                                                <span class="text-muted">{{ t('dashboard.givenBackProfit') }}:</span>
                                                <span class="fw-bold greenTrade">{{ useTwoDecCurrencyFormat(mfeAnalysisStats.totalMfeProfit) }}</span>
                                            </div>
                                            <div class="d-flex align-items-center gap-2">
                                                <span class="text-muted">{{ t('dashboard.realizedLoss') }}:</span>
                                                <span class="fw-bold redTrade">-{{ useTwoDecCurrencyFormat(mfeAnalysisStats.totalRealizedLoss) }}</span>
                                            </div>
                                        </div>

                                        <!-- Detail-Tabelle -->
                                        <div class="table-responsive">
                                            <table class="table table-sm table-borderless trade-type-table mb-0">
                                                <thead>
                                                    <tr>
                                                        <th>{{ t('dashboard.symbol') }}</th>
                                                        <th>{{ t('dashboard.date') }}</th>
                                                        <th class="text-center">{{ t('dashboard.side') }}</th>
                                                        <th class="text-end">Entry</th>
                                                        <th class="text-end">MFE</th>
                                                        <th class="text-end">Exit</th>
                                                        <th class="text-end">{{ t('dashboard.maxReachedProfit') }}</th>
                                                        <th class="text-end">{{ t('dashboard.realizedLoss') }}</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr v-for="(row, idx) in mfeAnalysisStats.trades" :key="idx">
                                                        <td>{{ row.symbol }}</td>
                                                        <td class="text-muted">{{ dayjs.unix(row.date).tz(timeZoneTrade).format('DD.MM.YY HH:mm') }}</td>
                                                        <td class="text-center">
                                                            <span class="trade-type-badge" :style="{ background: row.strategy === 'long' ? '#22c55e' : '#ef4444' }">
                                                                {{ row.strategy === 'long' ? 'Long' : 'Short' }}
                                                            </span>
                                                        </td>
                                                        <td class="text-end text-muted">{{ useXDecFormat(row.entryPrice, 4) }}</td>
                                                        <td class="text-end greenTrade">{{ useXDecFormat(row.mfePrice, 4) }}</td>
                                                        <td class="text-end redTrade">{{ useXDecFormat(row.exitPrice, 4) }}</td>
                                                        <td class="text-end fw-bold greenTrade">{{ useTwoDecCurrencyFormat(row.mfeProfit) }}</td>
                                                        <td class="text-end fw-bold redTrade">-{{ useTwoDecCurrencyFormat(row.realizedLoss) }}</td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>

                            </div>
                        </div>
                    </div>

                    <!-- ============ SETUPS ============ -->
                    <div v-bind:class="'tab-pane fade ' + (selectedDashTab == 'setupsTab' ? 'active show' : '')"
                        id="setupsNav" role="tabpanel" aria-labelledby="nav-setups-tab">
                        <div class="col-12">
                            <div class="row">

                                <!-- GROUP BY POSITION -->
                                <div v-if="isVisible('byPosition')" class="col-12 col-xl-6 mb-3">
                                    <div class="dailyCard">
                                        <h6>{{ t('dashboard.byPosition', { metric: ratioCompute.shortName }) }}
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" :data-bs-title="t('dashboard.byPositionTooltip')"></i>
                                        </h6>
                                        <div v-bind:key="renderData" id="positionChart1" class="chartClass" style="height: 160px !important;"></div>
                                    </div>
                                </div>

                                <!-- GROUP BY TAGS -->
                                <div v-if="isVisible('byStrategy')" class="col-12 col-xl-6 mb-3">
                                    <div class="dailyCard">
                                        <h6>{{ t('dashboard.byStrategy', { metric: ratioCompute.shortName }) }}
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" :data-bs-title="t('dashboard.byStrategyTooltip')"></i>
                                        </h6>
                                        <div v-bind:key="renderData" id="strategyChart1" class="chartClass" style="height: 160px !important;"></div>
                                    </div>
                                </div>

                                <!-- TRADE-TYP STATISTIK -->
                                <div class="col-12 mb-3" v-if="tradeTypeStats.length > 0 && isVisible('tradeTypeStats')">
                                    <div class="dailyCard">
                                        <h6>{{ t('dashboard.tradeTypeStats') }}
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" :data-bs-title="t('dashboard.tradeTypeStatsTooltip')"></i>
                                        </h6>
                                        <div class="table-responsive">
                                            <table class="table table-sm table-borderless trade-type-table mb-0">
                                                <thead>
                                                    <tr>
                                                        <th>{{ t('dashboard.tradeType') }}</th>
                                                        <th class="text-center">Trades</th>
                                                        <th class="text-center">{{ t('dashboard.winRate') }}</th>
                                                        <th class="text-end">∅ P&L</th>
                                                        <th class="text-end">{{ t('dashboard.netPnl') }}</th>
                                                        <th class="text-end">{{ t('options.profitFactor') }}</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr v-for="row in tradeTypeStats" :key="row.type">
                                                        <td>
                                                            <span class="trade-type-badge" :style="{ background: row.color }">{{ row.label }}</span>
                                                        </td>
                                                        <td class="text-center">
                                                            <span class="text-muted">{{ row.count }}</span>
                                                            <span class="txt-small text-muted ms-1">({{ row.wins }}W / {{ row.losses }}L)</span>
                                                        </td>
                                                        <td class="text-center">
                                                            <div class="d-flex align-items-center justify-content-center gap-1">
                                                                <div class="winrate-bar">
                                                                    <div class="winrate-fill" :style="{ width: row.winRate + '%' }"></div>
                                                                </div>
                                                                <span class="txt-small" :class="row.winRate >= 50 ? 'greenTrade' : 'redTrade'">{{ row.winRate.toFixed(0) }}%</span>
                                                            </div>
                                                        </td>
                                                        <td class="text-end" :class="row.avgPnl >= 0 ? 'greenTrade' : 'redTrade'">{{ useTwoDecCurrencyFormat(row.avgPnl) }}</td>
                                                        <td class="text-end fw-bold" :class="row.totalPnl >= 0 ? 'greenTrade' : 'redTrade'">{{ useTwoDecCurrencyFormat(row.totalPnl) }}</td>
                                                        <td class="text-end">
                                                            <span :class="row.profitFactor >= 1 ? 'greenTrade' : 'redTrade'">
                                                                {{ row.profitFactor === Infinity ? '∞' : useXDecFormat(row.profitFactor, 2) }}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>

                                <!-- STRATEGIE-TAG STATISTIK -->
                                <div class="col-12 mb-3" v-if="strategyTagStats.length > 0 && isVisible('strategyTagStats')">
                                    <div class="dailyCard">
                                        <h6>{{ t('dashboard.strategyTagStats') }}
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" :data-bs-title="t('dashboard.strategyTagStatsTooltip')"></i>
                                        </h6>
                                        <div class="table-responsive">
                                            <table class="table table-sm table-borderless trade-type-table mb-0">
                                                <thead>
                                                    <tr>
                                                        <th>{{ t('dashboard.strategy') }}</th>
                                                        <th class="text-center">Trades</th>
                                                        <th class="text-center">{{ t('dashboard.winRate') }}</th>
                                                        <th class="text-end">∅ P&L</th>
                                                        <th class="text-end">{{ t('dashboard.netPnl') }}</th>
                                                        <th class="text-end">{{ t('options.profitFactor') }}</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr v-for="row in strategyTagStats" :key="row.tagName">
                                                        <td>
                                                            <span class="trade-type-badge" :style="{ background: row.tagColor }">{{ row.tagName }}</span>
                                                        </td>
                                                        <td class="text-center">
                                                            <span class="text-muted">{{ row.count }}</span>
                                                            <span class="txt-small text-muted ms-1">({{ row.wins }}W / {{ row.losses }}L)</span>
                                                        </td>
                                                        <td class="text-center">
                                                            <div class="d-flex align-items-center justify-content-center gap-1">
                                                                <div class="winrate-bar">
                                                                    <div class="winrate-fill" :style="{ width: row.winRate + '%' }"></div>
                                                                </div>
                                                                <span class="txt-small" :class="row.winRate >= 50 ? 'greenTrade' : 'redTrade'">{{ row.winRate.toFixed(0) }}%</span>
                                                            </div>
                                                        </td>
                                                        <td class="text-end" :class="row.avgPnl >= 0 ? 'greenTrade' : 'redTrade'">{{ useTwoDecCurrencyFormat(row.avgPnl) }}</td>
                                                        <td class="text-end fw-bold" :class="row.totalPnl >= 0 ? 'greenTrade' : 'redTrade'">{{ useTwoDecCurrencyFormat(row.totalPnl) }}</td>
                                                        <td class="text-end">
                                                            <span :class="row.profitFactor >= 1 ? 'greenTrade' : 'redTrade'">
                                                                {{ row.profitFactor === Infinity ? '∞' : useXDecFormat(row.profitFactor, 2) }}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>

                            </div>
                        </div>
                    </div>

                    <!-- ============ FINANCIALS ============ -->
                    <div v-bind:class="'tab-pane fade ' + (selectedDashTab == 'financialsTab' ? 'active show' : '')"
                        id="financialsNav" role="tabpanel" aria-labelledby="nav-financials-tab">
                        <div class="col-12">
                            <div class="row">

                                <!-- GROUP BY SYMBOL -->
                                <div v-if="isVisible('bySymbol')" class="col-12 col-xl-6 mb-3">
                                    <div class="dailyCard">
                                        <h6>{{ t('dashboard.bySymbol', { metric: ratioCompute.shortName }) }}
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" :data-bs-title="t('dashboard.bySymbolTooltip')"></i>
                                        </h6>
                                        <div v-bind:key="renderData" id="symbolChart1" class="chartClass"></div>
                                    </div>
                                </div>

                                <!-- GROUP BY FLOAT
                        <div class="col-12 col-xl-4 mb-3">
                            <div class="dailyCard">
                                <h6>Group by Share Float</h6>
                                <div class="text-center" v-if="!dashboardChartsMounted">
                                    <div class="spinner-border text-blue" role="status"></div>
                                </div>
                                <div v-bind:key="renderData" id="barChartNegative12" class="chartClass"></div>
                            </div>
                        </div>-->

                                <!-- GROUP BY MARKET CAP
                        <div class="col-12 col-xl-4 mb-3">
                            <div class="dailyCard">
                                <h6>Group by Market Cap</h6>
                                <div class="text-center" v-if="!dashboardChartsMounted">
                                    <div class="spinner-border text-blue" role="status"></div>
                                </div>
                                <div v-bind:key="renderData" id="barChartNegative14" class="chartClass"></div>
                            </div>
                        </div>-->

                                <!-- FEES BY SYMBOL -->
                                <div v-if="isVisible('feesBySymbol')" class="col-12 col-xl-6 mb-3">
                                    <div class="dailyCard">
                                        <h6>{{ t('dashboard.feesBySymbol') }}
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" :data-bs-title="t('dashboard.feesBySymbolTooltip')"></i>
                                        </h6>
                                        <div v-bind:key="renderData" id="feesChart1" class="chartClass"></div>
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

<style scoped>
.card-config-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 1000;
    min-width: 250px;
    max-height: 70vh;
    overflow-y: auto;
    background: var(--black-bg-3, #1e1e2f);
    border: 1px solid var(--white-38, rgba(255, 255, 255, 0.15));
    border-radius: var(--border-radius, 0.5rem);
    box-shadow: var(--shadow-sm, 0 2px 8px rgba(0, 0, 0, 0.3));
    padding: 0.5rem 0;
}
.card-config-title {
    padding: 0.4rem 0.75rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--white-38, rgba(255, 255, 255, 0.38));
}
.card-config-item {
    padding: 0.4rem 0.75rem;
    cursor: pointer;
    font-size: 0.85rem;
    color: var(--white-87, rgba(255, 255, 255, 0.87));
    user-select: none;
}
.card-config-item:hover {
    background: var(--white-38, rgba(255, 255, 255, 0.08));
}
</style>
