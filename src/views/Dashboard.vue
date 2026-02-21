<script setup>
import { computed, onBeforeMount, ref } from 'vue'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue';
import { spinnerLoadingPage, dashboardIdMounted, renderData, dashboardChartsMounted, hasData, barChartNegativeTagGroups, timeZoneTrade } from '../stores/ui.js'
import { selectedDashTab, amountCase, amountCapital, selectedRatio, selectedBroker } from '../stores/filters.js'
import { totals, profitAnalysis, satisfactionArray, satisfactionTradeArray, availableTags, groups, filteredTradesTrades } from '../stores/trades.js'
import { currentUser } from '../stores/settings.js'
import { dbFind } from '../utils/db.js'
import dayjs from '../utils/dayjs-setup.js'
import { useThousandCurrencyFormat, useTwoDecCurrencyFormat, useXDecCurrencyFormat, useThousandFormat, useXDecFormat } from '../utils/formatters.js';
import { useMountDashboard } from '../utils/mountOrchestration.js';
import NoData from '../components/NoData.vue';

const dashTabs = [{
    id: "overviewTab",
    label: "Übersicht",
    target: "#overviewNav"
},
{
    id: "tradesTab",
    label: "Performance",
    target: "#tradesNav"
},
{
    id: "timeTab",
    label: "Zeit & Datum",
    target: "#timeNav"
},
{
    id: "setupsTab",
    label: "Setups",
    target: "#setupsNav"
},
{
    id: "financialsTab",
    label: "Finanzen",
    target: "#financialsNav"
}
]
amountCapital.value = amountCase.value ? amountCase.value.charAt(0).toUpperCase() + amountCase.value.slice(1) : ''

const ratioCompute = computed(() => {
    let ratio = {}
    if (localStorage.getItem('selectedRatio') == 'appt') {
        ratio.shortName = "APPT"
        ratio.name = "Ø Gewinn pro Trade"
        ratio.value = useTwoDecCurrencyFormat(totals[amountCase.value + 'Proceeds'] / totals.trades)
        ratio.tooltipTitle = '<div>Ø Gewinn pro Trade</div><div>APPT = Erlöse &divide; Anzahl Trades</div><div>Erlöse: ' + useThousandCurrencyFormat(totals[amountCase.value + 'Proceeds']) + '</div><div>Trades: ' + useThousandFormat(totals.trades) + '</div>'
    }
    if (localStorage.getItem('selectedRatio') == 'profitFactor') {
        ratio.shortName = "Profitfaktor"
        ratio.name = "Profitfaktor"
        let wins = parseFloat(totals[amountCase.value + 'Wins']).toFixed(2)
        let loss = parseFloat(-totals[amountCase.value + 'Loss']).toFixed(2)
        let profitFactor = 0
        //console.log("wins " + wins + " and loss " + loss)
        if (loss != 0) {
            profitFactor = wins / loss
            //console.log(" -> profitFactor "+profitFactor)
        }
        ratio.value = useXDecFormat(profitFactor, 2)
        ratio.tooltipTitle = '<div>Profitfaktor = Gewinne &divide; Verluste</div><div>Gewinne: ' + useThousandCurrencyFormat(totals[amountCase.value + 'Wins']) + '</div><div>Verluste: ' + useThousandCurrencyFormat(totals[amountCase.value + 'Loss']) + '</div>'
    }
    return ratio
})

const hasSatisfactionData = computed(() => satisfactionArray.length > 0 || satisfactionTradeArray.length > 0)

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

async function loadAllTimeNetPnL() {
    const broker = selectedBroker.value || 'bitunix'
    const allTrades = await dbFind('trades', { equalTo: { broker }, limit: 100000 })
    let totalNet = 0
    for (const day of allTrades) {
        if (day.pAndL && typeof day.pAndL === 'object') {
            totalNet += day.pAndL.netProceeds || 0
        }
    }
    allTimeNetPnL.value = totalNet
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
                <nav>
                    <div class="nav nav-tabs mb-2" id="nav-tab" role="tablist">
                        <button v-for="dashTab in dashTabs" :key="dashTab.id"
                            :class="'nav-link ' + (selectedDashTab == dashTab.id ? 'active' : '')" :id="dashTab.id"
                            data-bs-toggle="tab" :data-bs-target="dashTab.target" type="button" role="tab"
                            aria-controls="nav-overview" aria-selected="true">{{ dashTab.label }}</button>
                    </div>
                </nav>

                <div class="tab-content" id="nav-tabContent">

                    <!-- ============ OVERVIEW ============ -->
                    <div v-bind:class="'tab-pane fade ' + (selectedDashTab == 'overviewTab' ? 'active show' : '')"
                        id="overviewNav" role="tabpanel" aria-labelledby="nav-overview-tab">
                        <!-- ============ 3-COLUMN OVERVIEW ============ -->
                        <div v-if="dashboardIdMounted" class="col-12 mb-3">
                            <div class="row">

                                <!-- ===== LINKE SPALTE: Kontostand + Donuts ===== -->
                                <div class="col-12 col-xl-4 mb-3 mb-xl-0">
                                    <div class="dailyCard h-100">
                                        <h6>Kontostand</h6>

                                        <!-- Kontostand wenn gesetzt -->
                                        <div v-if="accountBalance" class="text-center py-3">
                                            <div class="fs-2 fw-bold" :class="accountBalance.pnl >= 0 ? 'greenTrade' : 'redTrade'">
                                                {{ useTwoDecCurrencyFormat(accountBalance.current) }}
                                            </div>
                                            <div class="dashInfoTitle mb-1">Aktueller Stand</div>
                                            <div class="fs-5" :class="accountBalance.perf >= 0 ? 'greenTrade' : 'redTrade'">
                                                {{ accountBalance.perf >= 0 ? '+' : '' }}{{ accountBalance.perf.toFixed(1) }}%
                                            </div>
                                        </div>

                                        <!-- Platzhalter wenn nicht gesetzt -->
                                        <div v-else class="text-center py-3">
                                            <div class="text-muted mb-1"><i class="uil uil-wallet fs-3"></i></div>
                                            <div class="text-muted small">Kontostand in Einstellungen konfigurieren</div>
                                        </div>

                                        <hr />

                                        <!-- Donuts nebeneinander -->
                                        <div class="row text-center">
                                            <div :class="hasSatisfactionData ? 'col-6' : 'col-12'">
                                                <div v-bind:key="renderData" id="pieChart1" class="chartIdCardClass"></div>
                                            </div>
                                            <div v-if="hasSatisfactionData" class="col-6">
                                                <div v-bind:key="renderData" id="pieChart2" class="chartIdCardClass"></div>
                                            </div>
                                        </div>

                                        <!-- Tages Trade Zähler -->
                                        <div v-if="todayStats.total > 0" class="text-center mt-2 pt-2" style="border-top: 1px solid var(--white-10);">
                                            <div class="small text-muted mb-1">Heute</div>
                                            <div class="d-flex justify-content-center align-items-center gap-3">
                                                <span class="fw-bold">{{ todayStats.total }} <span class="text-muted fw-normal">Trades</span></span>
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
                                <div class="col-12 col-xl-4 mb-3 mb-xl-0">
                                    <div class="dailyCard h-100">
                                        <h6>Kennzahlen</h6>
                                        <table class="stats-table w-100">
                                            <tbody>
                                                <tr>
                                                    <td>Kumulierter PnL
                                                        <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" data-bs-title="Summe aller Gewinne und Verluste im gewählten Zeitraum"></i>
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
                                                    <td>P/L Ratio
                                                        <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" data-bs-title="Verhältnis von Ø Gewinn zu Ø Verlust pro Trade. Wert &gt; 1 bedeutet, dass Gewinntrades im Schnitt größer sind als Verlusttrades."></i>
                                                    </td>
                                                    <td class="text-end fw-bold">
                                                        <span v-if="!isNaN(profitAnalysis[amountCase + 'R'])">{{ (profitAnalysis[amountCase + 'R']).toFixed(2) }}</span>
                                                        <span v-else>-</span>
                                                    </td>
                                                </tr>
                                                <tr v-if="profitAnalysis[amountCase + 'MfeR'] != null">
                                                    <td>MFE P/L Ratio</td>
                                                    <td class="text-end fw-bold">{{ (profitAnalysis[amountCase + 'MfeR']).toFixed(2) }}</td>
                                                </tr>
                                                <tr class="stats-separator"><td colspan="2"><hr /></td></tr>
                                                <tr>
                                                    <td class="greenTrade">Ø Gewinn/Trade</td>
                                                    <td class="text-end">
                                                        <span v-if="!isNaN(profitAnalysis[amountCase + 'AvWinPerShare'])">{{ useTwoDecCurrencyFormat(profitAnalysis[amountCase + 'AvWinPerShare']) }}</span>
                                                        <span v-else>-</span>
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td class="redTrade">Ø Verlust/Trade</td>
                                                    <td class="text-end">
                                                        <span v-if="!isNaN(profitAnalysis[amountCase + 'AvLossPerShare'])">{{ useTwoDecCurrencyFormat(profitAnalysis[amountCase + 'AvLossPerShare']) }}</span>
                                                        <span v-else>-</span>
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td class="greenTrade">Max Gewinn</td>
                                                    <td class="text-end">
                                                        <span v-if="profitAnalysis[amountCase + 'HighWinPerShare'] > 0">{{ useTwoDecCurrencyFormat(profitAnalysis[amountCase + 'HighWinPerShare']) }}</span>
                                                        <span v-else>-</span>
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td class="redTrade">Max Verlust</td>
                                                    <td class="text-end">
                                                        <span v-if="profitAnalysis[amountCase + 'HighLossPerShare'] > 0">{{ useTwoDecCurrencyFormat(profitAnalysis[amountCase + 'HighLossPerShare']) }}</span>
                                                        <span v-else>-</span>
                                                    </td>
                                                </tr>
                                                <tr class="stats-separator"><td colspan="2"><hr /></td></tr>
                                                <tr>
                                                    <td>Trades</td>
                                                    <td class="text-end fw-bold">{{ useThousandFormat(totals.trades) }}</td>
                                                </tr>
                                                <tr>
                                                    <td>Executions</td>
                                                    <td class="text-end">{{ useThousandFormat(totals.executions) }}</td>
                                                </tr>
                                                <tr>
                                                    <td class="greenTrade">Gewinn-Trades</td>
                                                    <td class="text-end">{{ totals[amountCase + 'WinsCount'] }}</td>
                                                </tr>
                                                <tr>
                                                    <td class="redTrade">Verlust-Trades</td>
                                                    <td class="text-end">{{ totals[amountCase + 'LossCount'] }}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                <!-- ===== RECHTE SPALTE: Gebühren ===== -->
                                <div class="col-12 col-xl-4">
                                    <div class="dailyCard h-100">
                                        <h6>Gebühren</h6>

                                        <!-- Gesamtgebühren -->
                                        <div class="text-center py-3">
                                            <div class="fs-2 fw-bold text-warning">
                                                {{ useTwoDecCurrencyFormat(feeStats.totalFees) }}
                                            </div>
                                            <div class="dashInfoTitle">Gesamte Gebühren</div>
                                        </div>

                                        <!-- Visueller Balken: Anteil am Brutto-Gewinn -->
                                        <div v-if="feeStats.impactPercent > 0" class="mb-3 px-2">
                                            <div class="d-flex justify-content-between small mb-1">
                                                <span>Anteil an Bruttogewinnen</span>
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
                                                    <td>Ø pro Trade</td>
                                                    <td class="text-end fw-bold">{{ useTwoDecCurrencyFormat(feeStats.perTrade) }}</td>
                                                </tr>
                                                <tr>
                                                    <td>Kommission</td>
                                                    <td class="text-end">{{ useTwoDecCurrencyFormat(totals.commission || 0) }}</td>
                                                </tr>
                                                <tr v-if="(totals.otherCommission || 0) > 0">
                                                    <td>Regulatorische Gebühren</td>
                                                    <td class="text-end">{{ useTwoDecCurrencyFormat(totals.otherCommission) }}</td>
                                                </tr>
                                                <tr v-if="(totals.otherFees || 0) > 0">
                                                    <td>Sonstige Gebühren</td>
                                                    <td class="text-end">{{ useTwoDecCurrencyFormat(totals.otherFees) }}</td>
                                                </tr>
                                            </tbody>
                                        </table>

                                        <!-- Brutto vs. Netto -->
                                        <hr />
                                        <table class="stats-table w-100">
                                            <tbody>
                                                <tr>
                                                    <td class="fw-bold">Brutto PnL</td>
                                                    <td class="text-end fw-bold" :class="totals.grossProceeds >= 0 ? 'greenTrade' : 'redTrade'">{{ useTwoDecCurrencyFormat(totals.grossProceeds || 0) }}</td>
                                                </tr>
                                                <tr>
                                                    <td class="fw-bold">Netto PnL</td>
                                                    <td class="text-end fw-bold" :class="totals.netProceeds >= 0 ? 'greenTrade' : 'redTrade'">{{ useTwoDecCurrencyFormat(totals.netProceeds || 0) }}</td>
                                                </tr>
                                                <tr>
                                                    <td class="text-muted">Differenz (Gebühren)</td>
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
                                <div class="col-12 mb-3">
                                    <div class="dailyCard">
                                        <h6>Kumulierter PnL
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" data-bs-title="Balken zeigen den Tagesgewinn/-verlust. Die Linie zeigt den kumulierten Gesamtverlauf über den Zeitraum."></i>
                                        </h6>
                                        <div v-bind:key="renderData" id="lineBarChart1" class="chartClass"></div>
                                    </div>
                                </div>

                                <!-- APPT/APPS/PROFIT FACTOR CHART -->
                                <div class="col-12 col-xl-6 mb-3">
                                    <div class="dailyCard">
                                        <h6>{{ ratioCompute.name }} <span
                                                v-if="ratioCompute.name != 'Profitfaktor'">({{ ratioCompute.shortName
                                                }})</span></h6>
                                        <div v-bind:key="renderData" id="barChart1" class="chartClass"></div>
                                    </div>
                                </div>

                                <!-- WIN LOSS CHART -->
                                <div class="col-12 col-xl-6 mb-3">
                                    <div class="dailyCard">
                                        <h6>Win Rate
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" data-bs-title="Anteil der Gewinntrades an der Gesamtzahl der Trades pro Zeitabschnitt."></i>
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
                                <div class="col-12 col-xl-4 mb-3">
                                    <div class="dailyCard">
                                        <h6>Nach Wochentag ({{ ratioCompute.shortName }})
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" data-bs-title="Performance gruppiert nach Wochentag des Trade-Einstiegs. Zeigt, an welchen Tagen du am besten/schlechtesten tradest."></i>
                                        </h6>
                                        <div v-bind:key="renderData" id="weekdayChart1" class="chartClass"></div>
                                    </div>
                                </div>

                                <!-- GROUP BY TIMEFRAME -->
                                <div class="col-12 col-xl-4 mb-3">
                                    <div class="dailyCard">
                                        <h6>Nach Einstiegszeit ({{ ratioCompute.shortName }})
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" data-bs-title="Performance gruppiert nach Uhrzeit des Trade-Einstiegs. Zeigt, zu welchen Tageszeiten du am besten/schlechtesten tradest."></i>
                                        </h6>
                                        <div v-bind:key="renderData" id="entryTimeChart1" class="chartClass"></div>
                                    </div>
                                </div>

                                <!-- GROUP BY DURATION -->
                                <div class="col-12 col-xl-4 mb-3">
                                    <div class="dailyCard">
                                        <h6>Nach Haltedauer ({{ ratioCompute.shortName }})
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" data-bs-title="Performance gruppiert nach Haltedauer (Einstieg bis Ausstieg). Zeigt, ob du mit kürzeren oder längeren Trades besser fährst."></i>
                                        </h6>
                                        <div v-bind:key="renderData" id="durationChart1" class="chartClass"></div>
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
                                <div class="col-12 mb-3">
                                    <div class="dailyCard">
                                        <h6>Trading Performance
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" data-bs-title="<b>PnL</b>: Gewinn/Verlust pro Trade<br><b>Equity</b>: Kumulative Equity-Kurve<br><b>High Water Mark</b>: Bisheriger Höchststand<br><b>Drawdown</b>: Rückgang vom Höchststand"></i>
                                        </h6>
                                        <div v-bind:key="renderData" id="perfChart1" class="chartClass" style="height: 550px;"></div>
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
                                <div class="col-12 col-xl-6 mb-3">
                                    <div class="dailyCard">
                                        <h6>Nach Position ({{ ratioCompute.shortName }})
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" data-bs-title="Performance gruppiert nach Long/Short. Zeigt, ob du in eine Richtung besser tradest."></i>
                                        </h6>
                                        <div v-bind:key="renderData" id="positionChart1" class="chartClass"></div>
                                    </div>
                                </div>

                                <!-- GROUP BY TAGS -->
                                <div class="col-12 col-xl-6 mb-3">
                                    <div class="dailyCard">
                                        <h6>Nach Strategie ({{ ratioCompute.shortName }})
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" data-bs-title="Performance gruppiert nach Strategie-Tags (erste Tag-Gruppe). Zeigt, welche Strategien profitabel sind."></i>
                                        </h6>
                                        <div v-bind:key="renderData" id="strategyChart1" class="chartClass"></div>
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
                                <div class="col-12 col-xl-6 mb-3">
                                    <div class="dailyCard">
                                        <h6>Nach Symbol ({{ ratioCompute.shortName }})
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" data-bs-title="Performance pro Symbol, sortiert nach Profitabilität."></i>
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
                                <div class="col-12 col-xl-6 mb-3">
                                    <div class="dailyCard">
                                        <h6>Gebühren nach Symbol
                                            <i class="ps-1 uil uil-info-circle" data-bs-custom-class="tooltipLargeLeft" data-bs-toggle="tooltip" data-bs-html="true" data-bs-title="Gesamte Handelsgebühren (Kommissionen) pro Symbol. Zeigt, wo die meisten Kosten anfallen."></i>
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
