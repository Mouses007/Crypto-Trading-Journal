<script setup>
/**
 * Bot-Dashboard — dedizierte Übersicht für Grid-/Bot-Trades (aktuell Pionex).
 *
 * Wird in Dashboard.vue gerendert, wenn der ART-Filter auf "Bot" steht.
 * Konsumiert `filteredTradesTrades` (bereits auf Bots gefiltert via Kategorie-
 * Filter in trades.js) und berechnet bot-spezifische KPIs eigenständig —
 * unabhängig von der Futures-Totals-Pipeline.
 *
 * Relevante Bot-Felder pro Trade (aus createPionexTradeObj / pionex-api.js):
 *   botType (futures_grid | spot_grid | smart_copy), symbol, leverage,
 *   investment (initQuoteInvestment), netSharePL (= totalRealizedProfit, echter
 *   Wallet-Delta), grossSharePL (Grid-Profit vor Gebühren), tradingFee,
 *   fundingFee (signiert: + erhalten / − bezahlt), entryTime/exitTime, strategy.
 */
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import axios from 'axios'
import { filteredTradesTrades } from '../stores/trades.js'
import { amountCase, selectedBroker } from '../stores/filters.js'
import {
    useTwoDecCurrencyFormat, useThousandCurrencyFormat, useThousandFormat,
    useXDecFormat, useTwoDecFormat
} from '../utils/formatters.js'
import dayjs from '../utils/dayjs-setup.js'

// ===== Helpers =====

// Symbol-Inversion korrigieren: Pionex liefert teils USDT als base
// (z.B. "USDTSOL" statt "SOLUSDT"). .PERP-Suffix strippen.
function displaySymbol(s) {
    if (!s) return '—'
    let out = String(s).replace('.PERP', '').replace('.perp', '')
    if (out.startsWith('USDT') && out.length > 4) out = out.slice(4) + 'USDT'
    return out
}

const BOT_TYPE_LABEL = {
    futures_grid: 'Futures-Grid',
    spot_grid: 'Spot-Grid',
    smart_copy: 'Smart-Copy',
    grid: 'Grid',
}
function botTypeLabel(t) {
    return BOT_TYPE_LABEL[t] || (t || 'Bot')
}

// PnL eines laufenden Bots einheiten-bewusst: USDT → Währungsformat, Coin-M
// (margined in z.B. SOL) → nativ in der Coin mit Vorzeichen.
function fmtBotPnL(p) {
    const v = p.unrealizedPNL || 0
    if (p.marginCoin && p.marginCoin !== 'USDT') {
        return `${v >= 0 ? '+' : ''}${v.toFixed(4)} ${p.marginCoin}`
    }
    return useTwoDecCurrencyFormat(v)
}

function fmtDuration(seconds) {
    if (!seconds || seconds < 0) return '—'
    const d = Math.floor(seconds / 86400)
    const h = Math.floor((seconds % 86400) / 3600)
    if (d > 0) return `${d}d ${h}h`
    const m = Math.floor((seconds % 3600) / 60)
    return `${h}h ${m}m`
}

// Coin-M-Bot (coin-margined, invers) erkennen + gehandelte Coin ableiten.
//  - Bestehende Importe: invertiertes Symbol "USDTSOL"/"USDTBTC" (Symbol beginnt mit USDT).
//  - Neue Importe (nach Server-Fix): coinM/marginCoin-Feld am Trade.
// PnL ist bei Coin-M in der Coin (SOL/BTC), NICHT USDT → eigene Sektion, aus den
// USDT-Summen herausgehalten.
function botCoin(t) {
    if (!t) return null
    if (t.coinM || (t.marginCoin && t.marginCoin !== 'USDT')) {
        return (t.marginCoin || String(t.symbol || '').replace(/USDT/i, '')) || null
    }
    const s = String(t.symbol || '').toUpperCase()
    if (s.startsWith('USDT') && s.length > 4) return s.slice(4)
    return null
}
function isCoinM(t) { return botCoin(t) !== null }

// Börsen mit Bot-Unterstützung. Bitunix/Bitget bieten (noch) keine Bots →
// eigene "Coming soon"-Ansicht statt leerer Tabelle.
const BOT_BROKERS = ['pionex']
const BROKER_LABEL = { bitunix: 'Bitunix', bitget: 'Bitget', pionex: 'Pionex' }
const comingSoon = computed(() => {
    const b = selectedBroker.value
    return !!b && !BOT_BROKERS.includes(b)
})
const comingSoonLabel = computed(() => BROKER_LABEL[selectedBroker.value] || selectedBroker.value)

// ===== Datenbasis =====
const allBots = computed(() => filteredTradesTrades.filter(t => t && t.botType))
// USDT-margined Bots → $-Stats. Coin-M separat (Coin-Einheiten).
const bots = computed(() => allBots.value.filter(t => !isCoinM(t)))
const coinMBots = computed(() => allBots.value.filter(t => isCoinM(t)))

// Netto vs. Brutto je nach amountCase-Filter (net/gross)
const isNet = computed(() => amountCase.value !== 'gross')
function pl(t) {
    return isNet.value ? (t.netSharePL ?? 0) : (t.grossSharePL ?? 0)
}

// Coin-M-Bots je Coin (SOL/BTC) nativ aggregieren
const coinMGroups = computed(() => {
    const map = new Map()
    for (const t of coinMBots.value) {
        const coin = botCoin(t) || '?'
        const e = map.get(coin) || { coin, count: 0, net: 0, gross: 0, fees: 0, funding: 0, wins: 0, losses: 0 }
        e.count++
        e.net += t.netSharePL ?? 0
        e.gross += t.grossSharePL ?? 0
        e.fees += t.tradingFee ?? 0
        e.funding += t.fundingFee ?? 0
        const p = pl(t)
        if (p > 0) e.wins++; else if (p < 0) e.losses++
        map.set(coin, e)
    }
    return [...map.values()].sort((a, b) => b.count - a.count)
})
function fmtCoin(v, coin) {
    return `${v >= 0 ? '+' : ''}${(v ?? 0).toFixed(4)} ${coin}`
}

// ===== Aggregierte KPIs =====
const stats = computed(() => {
    const list = bots.value
    let net = 0, gross = 0, tradingFee = 0, fundingFee = 0, investment = 0
    let fundingPaid = 0, fundingReceived = 0
    let wins = 0, losses = 0, levSum = 0, levCount = 0, durSum = 0, durCount = 0
    let best = null, worst = null
    const symbols = new Set()
    for (const t of list) {
        const p = pl(t)
        net += t.netSharePL ?? 0
        gross += t.grossSharePL ?? 0
        tradingFee += t.tradingFee ?? 0
        const f = t.fundingFee ?? 0
        fundingFee += f
        if (f >= 0) fundingReceived += f; else fundingPaid += f
        investment += t.investment ?? 0
        if (p > 0) wins++; else if (p < 0) losses++
        if (t.leverage > 0) { levSum += t.leverage; levCount++ }
        const dur = (t.exitTime ?? 0) - (t.entryTime ?? 0)
        if (dur > 0) { durSum += dur; durCount++ }
        symbols.add(displaySymbol(t.symbol))
        if (!best || p > pl(best)) best = t
        if (!worst || p < pl(worst)) worst = t
    }
    const count = list.length
    const profit = isNet.value ? net : gross
    return {
        count,
        symbols: symbols.size,
        net, gross, tradingFee, fundingFee, fundingPaid, fundingReceived, investment,
        profit,
        roi: investment > 0 ? (net / investment) * 100 : 0,
        winRate: count > 0 ? (wins / count) * 100 : 0,
        wins, losses,
        avgLeverage: levCount > 0 ? levSum / levCount : 0,
        avgDuration: durCount > 0 ? durSum / durCount : 0,
        avgProfit: count > 0 ? profit / count : 0,
        best, worst,
    }
})

// ===== Gruppierung nach Bot-Typ =====
// USDT-Bots nach botType + Coin-M je Coin als eigene Zeilen (in Coin-Einheiten).
const byType = computed(() => {
    const map = new Map()
    for (const t of bots.value) {
        const key = t.botType || 'grid'
        const e = map.get(key) || { key, label: botTypeLabel(key), unit: 'USDT', count: 0, profit: 0, fees: 0, investment: 0 }
        e.count++
        e.profit += pl(t)
        e.fees += (t.tradingFee ?? 0)
        e.investment += (t.investment ?? 0)
        map.set(key, e)
    }
    const rows = [...map.values()]
    // Coin-M: je Coin (SOL/BTC) eigene Zeile, Profit nativ in der Coin
    for (const g of coinMGroups.value) {
        rows.push({
            key: 'coinm_' + g.coin,
            label: `Futures-Grid · Coin-M (${g.coin})`,
            coinM: true,
            unit: g.coin,
            count: g.count,
            profit: isNet.value ? g.net : g.gross,
        })
    }
    return rows.sort((a, b) => b.count - a.count)
})

// ===== Gruppierung nach Symbol =====
const bySymbol = computed(() => {
    const map = new Map()
    for (const t of bots.value) {
        const key = displaySymbol(t.symbol)
        const e = map.get(key) || { symbol: key, count: 0, profit: 0, fees: 0, funding: 0 }
        e.count++
        e.profit += pl(t)
        e.fees += (t.tradingFee ?? 0)
        e.funding += (t.fundingFee ?? 0)
        map.set(key, e)
    }
    return [...map.values()].sort((a, b) => b.profit - a.profit)
})

// ===== Laufende Bots (offene Positionen) =====
// Pro Börse eigene Bot-Seite: offene Bots der AKTUELL gewählten Börse holen.
// Der globale incomingPositions-Store taugt nicht — er enthält nur reguläre
// Futures-Positionen, keine Bot-Metadaten. Aktuell liefert nur Pionex Bots;
// andere Börsen geben hier (gefiltert auf isBot) eine leere Liste zurück.
const runningBots = ref([])
async function fetchRunningBots() {
    const broker = selectedBroker.value || 'pionex'
    try {
        const { data } = await axios.get(`/api/${broker}/open-positions`)
        const list = (data?.positions || []).filter(p => p && (p.isBot || p.botType))
        runningBots.value = list
    } catch (_) { runningBots.value = [] }
}

// ===== Charts =====
const cumChartEl = ref(null)
const symbolChartEl = ref(null)
let cumChart = null
let symbolChart = null

function renderCumChart() {
    if (!cumChartEl.value) return
    if (!cumChart) cumChart = echarts.init(cumChartEl.value)
    const sorted = [...bots.value].sort((a, b) => (a.exitTime || a.td) - (b.exitTime || b.td))
    let acc = 0
    const data = sorted.map(t => {
        acc += pl(t)
        return [dayjs.unix(t.exitTime || t.td).valueOf(), +acc.toFixed(2)]
    })
    cumChart.setOption({
        backgroundColor: 'transparent',
        grid: { left: 55, right: 20, top: 20, bottom: 30 },
        tooltip: {
            trigger: 'axis',
            valueFormatter: v => useTwoDecCurrencyFormat(v),
        },
        xAxis: {
            type: 'time',
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
            axisLabel: { color: 'rgba(255,255,255,0.6)' },
        },
        yAxis: {
            type: 'value',
            axisLabel: { color: 'rgba(255,255,255,0.6)', formatter: v => useThousandFormat(v) },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        },
        series: [{
            type: 'line', data, showSymbol: false, smooth: true,
            lineStyle: { width: 2, color: '#3b82f6' },
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: 'rgba(59,130,246,0.35)' },
                    { offset: 1, color: 'rgba(59,130,246,0.02)' },
                ])
            },
        }],
    })
}

function renderSymbolChart() {
    if (!symbolChartEl.value) return
    if (!symbolChart) symbolChart = echarts.init(symbolChartEl.value)
    const top = bySymbol.value.slice(0, 12)
    symbolChart.setOption({
        backgroundColor: 'transparent',
        grid: { left: 80, right: 20, top: 10, bottom: 25 },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => useTwoDecCurrencyFormat(v) },
        xAxis: {
            type: 'value',
            axisLabel: { color: 'rgba(255,255,255,0.6)', formatter: v => useThousandFormat(v) },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        },
        yAxis: {
            type: 'category',
            inverse: true,
            data: top.map(s => s.symbol),
            axisLabel: { color: 'rgba(255,255,255,0.7)' },
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
        },
        series: [{
            type: 'bar',
            data: top.map(s => ({
                value: +s.profit.toFixed(2),
                itemStyle: { color: s.profit >= 0 ? '#22c55e' : '#ef4444', borderRadius: 3 },
            })),
            barMaxWidth: 18,
        }],
    })
}

function renderAll() {
    nextTick(() => { renderCumChart(); renderSymbolChart() })
}

function onResize() {
    cumChart?.resize()
    symbolChart?.resize()
}

// ECharts liest die Container-Breite beim init(); steht das Layout zu diesem
// Zeitpunkt noch nicht (Tab-Pane/Flex), rendert der Chart zu schmal. Ein
// ResizeObserver korrigiert die Breite, sobald der Container sie erhält.
let ro = null
let pollTimer = null
onMounted(() => {
    renderAll()
    fetchRunningBots()
    // Live-Update der laufenden Bots (uPnL/Profit) alle 30s
    pollTimer = setInterval(fetchRunningBots, 30000)
    window.addEventListener('resize', onResize)
    ro = new ResizeObserver(onResize)
    if (cumChartEl.value) ro.observe(cumChartEl.value)
    if (symbolChartEl.value) ro.observe(symbolChartEl.value)
})
onBeforeUnmount(() => {
    window.removeEventListener('resize', onResize)
    ro?.disconnect()
    if (pollTimer) clearInterval(pollTimer)
    cumChart?.dispose(); symbolChart?.dispose()
})
watch([bots, amountCase], renderAll, { deep: false })
</script>

<template>
    <div class="bot-dashboard">
        <!-- Börse ohne Bot-Unterstützung → Coming soon -->
        <div v-if="comingSoon" class="dailyCard text-center py-5">
            <i class="uil uil-robot" style="font-size:2.5rem;opacity:0.4;"></i>
            <div class="mt-2"><strong>Bot-Tracking für {{ comingSoonLabel }} kommt bald</strong></div>
            <div class="text-muted small mt-1">Aktuell werden Trading-Bots nur für Pionex unterstützt.</div>
            <span class="coinm-badge mt-2 d-inline-block" style="background:rgba(59,130,246,0.18);color:#3b82f6;">COMING SOON</span>
        </div>

        <div v-else-if="stats.count === 0 && coinMGroups.length === 0" class="dailyCard text-center py-5">
            <i class="uil uil-robot" style="font-size:2.5rem;opacity:0.4;"></i>
            <div class="mt-2 text-muted">Keine Bot-Trades im gewählten Zeitraum.</div>
        </div>

        <template v-else>
            <!-- ===== KPI-Kacheln ===== -->
            <div class="row g-3 mb-3">
                <div class="col-6 col-md-3">
                    <div class="dailyCard h-100 kpi">
                        <div class="kpi-label">{{ isNet ? 'Netto-Profit' : 'Brutto-Profit' }}</div>
                        <div class="kpi-value" :class="stats.profit >= 0 ? 'greenTrade' : 'redTrade'">
                            {{ useTwoDecCurrencyFormat(stats.profit) }}
                        </div>
                        <div class="kpi-sub">{{ stats.count }} Bots · {{ stats.symbols }} Symbole</div>
                    </div>
                </div>
                <div class="col-6 col-md-3">
                    <div class="dailyCard h-100 kpi">
                        <div class="kpi-label">ROI (auf Investment)</div>
                        <div class="kpi-value" :class="stats.roi >= 0 ? 'greenTrade' : 'redTrade'">
                            {{ useTwoDecFormat(stats.roi) }}%
                        </div>
                        <div class="kpi-sub">Investment {{ useThousandCurrencyFormat(stats.investment) }}</div>
                    </div>
                </div>
                <div class="col-6 col-md-3">
                    <div class="dailyCard h-100 kpi">
                        <div class="kpi-label">Win-Rate (Bots)</div>
                        <div class="kpi-value">{{ useTwoDecFormat(stats.winRate) }}%</div>
                        <div class="kpi-sub greenTrade d-inline">{{ stats.wins }}W</div>
                        <span class="kpi-sub"> / </span>
                        <span class="kpi-sub redTrade">{{ stats.losses }}L</span>
                    </div>
                </div>
                <div class="col-6 col-md-3">
                    <div class="dailyCard h-100 kpi">
                        <div class="kpi-label">⌀ Hebel / Laufzeit</div>
                        <div class="kpi-value">{{ useXDecFormat(stats.avgLeverage, 1) }}×</div>
                        <div class="kpi-sub">⌀ Laufzeit {{ fmtDuration(stats.avgDuration) }}</div>
                    </div>
                </div>
            </div>

            <div class="row g-3 mb-3">
                <!-- ===== Profit-Aufschlüsselung ===== -->
                <div class="col-12 col-lg-4">
                    <div class="dailyCard h-100">
                        <div class="card-title-sm">Profit-Aufschlüsselung</div>
                        <table class="table-bot">
                            <tbody>
                                <tr>
                                    <td>Grid-Profit (Brutto)</td>
                                    <td class="text-end" :class="stats.gross >= 0 ? 'greenTrade' : 'redTrade'">
                                        {{ useTwoDecCurrencyFormat(stats.gross) }}</td>
                                </tr>
                                <tr>
                                    <td>Trading-Gebühren</td>
                                    <td class="text-end redTrade">−{{ useTwoDecCurrencyFormat(stats.tradingFee) }}</td>
                                </tr>
                                <tr>
                                    <td>Funding erhalten</td>
                                    <td class="text-end greenTrade">{{ useTwoDecCurrencyFormat(stats.fundingReceived) }}</td>
                                </tr>
                                <tr>
                                    <td>Funding bezahlt</td>
                                    <td class="text-end redTrade">{{ useTwoDecCurrencyFormat(stats.fundingPaid) }}</td>
                                </tr>
                                <tr class="border-top-row">
                                    <td><strong>Netto-Profit</strong></td>
                                    <td class="text-end" :class="stats.net >= 0 ? 'greenTrade' : 'redTrade'">
                                        <strong>{{ useTwoDecCurrencyFormat(stats.net) }}</strong></td>
                                </tr>
                                <tr>
                                    <td>⌀ pro Bot</td>
                                    <td class="text-end" :class="stats.avgProfit >= 0 ? 'greenTrade' : 'redTrade'">
                                        {{ useTwoDecCurrencyFormat(stats.avgProfit) }}</td>
                                </tr>
                            </tbody>
                        </table>
                        <div v-if="stats.best || stats.worst" class="mt-2 pt-2 best-worst">
                            <div v-if="stats.best" class="d-flex justify-content-between small">
                                <span class="text-muted">Bester Bot</span>
                                <span><strong>{{ displaySymbol(stats.best.symbol) }}</strong>
                                    <span class="greenTrade ms-1">{{ useTwoDecCurrencyFormat(pl(stats.best)) }}</span></span>
                            </div>
                            <div v-if="stats.worst" class="d-flex justify-content-between small mt-1">
                                <span class="text-muted">Schlechtester Bot</span>
                                <span><strong>{{ displaySymbol(stats.worst.symbol) }}</strong>
                                    <span class="redTrade ms-1">{{ useTwoDecCurrencyFormat(pl(stats.worst)) }}</span></span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ===== Nach Bot-Typ ===== -->
                <div class="col-12 col-lg-4">
                    <div class="dailyCard h-100">
                        <div class="card-title-sm">Nach Bot-Typ</div>
                        <table class="table-bot">
                            <thead>
                                <tr><th>Typ</th><th class="text-end">Anz.</th><th class="text-end">Profit</th></tr>
                            </thead>
                            <tbody>
                                <tr v-for="row in byType" :key="row.key">
                                    <td>{{ row.label }}
                                        <span v-if="row.coinM" class="coinm-badge">COIN-M</span>
                                    </td>
                                    <td class="text-end">{{ row.count }}</td>
                                    <td class="text-end" :class="row.profit >= 0 ? 'greenTrade' : 'redTrade'">
                                        {{ row.unit === 'USDT' ? useTwoDecCurrencyFormat(row.profit) : fmtCoin(row.profit, row.unit) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- ===== Laufende Bots ===== -->
                <div class="col-12 col-lg-4">
                    <div class="dailyCard h-100">
                        <div class="card-title-sm">Laufende Bots <span class="text-muted">({{ runningBots.length }})</span></div>
                        <div v-if="runningBots.length === 0" class="text-muted small py-2">Keine laufenden Bots.</div>
                        <table v-else class="table-bot">
                            <thead>
                                <tr><th>Symbol</th><th class="text-end">Hebel</th><th class="text-end">Markt</th><th class="text-end">PnL</th></tr>
                            </thead>
                            <tbody>
                                <tr v-for="p in runningBots" :key="p.positionId">
                                    <td>{{ displaySymbol(p.symbol) }}
                                        <span v-if="p.coinM" class="coinm-badge">COIN-M</span>
                                        <span class="text-muted d-block" style="font-size:0.7rem;">{{ botTypeLabel(p.botType) }} · {{ p.side }}</span>
                                    </td>
                                    <td class="text-end">{{ p.leverage ? useXDecFormat(p.leverage, 0) + '×' : '—' }}</td>
                                    <td class="text-end text-muted">{{ p.markPrice ? useXDecFormat(p.markPrice, p.markPrice < 1 ? 4 : 2) : '—' }}</td>
                                    <td class="text-end" :class="(p.unrealizedPNL || 0) >= 0 ? 'greenTrade' : 'redTrade'">
                                        {{ fmtBotPnL(p) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- ===== Coin-M Bots (Coin-margined, PnL in Coin-Einheiten) ===== -->
            <div v-if="coinMGroups.length" class="row g-3 mb-3">
                <div class="col-12">
                    <div class="dailyCard">
                        <div class="card-title-sm">
                            Coin-M Bots <span class="coinm-badge">COIN-M</span>
                            <span class="text-muted ms-1" style="font-size:0.78rem;font-weight:400;">— margined &amp; abgerechnet in der Coin (nicht in USDT-Summen enthalten)</span>
                        </div>
                        <table class="table-bot">
                            <thead>
                                <tr>
                                    <th>Coin</th>
                                    <th class="text-end">Bots</th>
                                    <th class="text-end">W/L</th>
                                    <th class="text-end">Grid (Brutto)</th>
                                    <th class="text-end">Gebühren</th>
                                    <th class="text-end">Funding</th>
                                    <th class="text-end">Netto</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="g in coinMGroups" :key="g.coin">
                                    <td><strong>{{ g.coin }}</strong></td>
                                    <td class="text-end">{{ g.count }}</td>
                                    <td class="text-end"><span class="greenTrade">{{ g.wins }}</span>/<span class="redTrade">{{ g.losses }}</span></td>
                                    <td class="text-end" :class="g.gross >= 0 ? 'greenTrade' : 'redTrade'">{{ fmtCoin(g.gross, g.coin) }}</td>
                                    <td class="text-end text-muted">{{ fmtCoin(-Math.abs(g.fees), g.coin) }}</td>
                                    <td class="text-end" :class="g.funding >= 0 ? 'greenTrade' : 'redTrade'">{{ fmtCoin(g.funding, g.coin) }}</td>
                                    <td class="text-end" :class="g.net >= 0 ? 'greenTrade' : 'redTrade'"><strong>{{ fmtCoin(g.net, g.coin) }}</strong></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- ===== Kumulierter Profit ===== -->
            <div class="row g-3 mb-3">
                <div class="col-12">
                    <div class="dailyCard">
                        <div class="card-title-sm">Kumulierter {{ isNet ? 'Netto' : 'Brutto' }}-Profit</div>
                        <div ref="cumChartEl" class="chart-box" style="height:300px;"></div>
                    </div>
                </div>
            </div>

            <!-- ===== Profit je Symbol ===== -->
            <div class="row g-3 mb-3">
                <div class="col-12 col-lg-6">
                    <div class="dailyCard h-100">
                        <div class="card-title-sm">Profit je Symbol (Top 12)</div>
                        <div ref="symbolChartEl" class="chart-box" style="height:340px;"></div>
                    </div>
                </div>
                <div class="col-12 col-lg-6">
                    <div class="dailyCard h-100">
                        <div class="card-title-sm">Symbol-Details</div>
                        <div class="table-scroll">
                            <table class="table-bot">
                                <thead>
                                    <tr><th>Symbol</th><th class="text-end">Bots</th><th class="text-end">Profit</th>
                                        <th class="text-end">Gebühren</th><th class="text-end">Funding</th></tr>
                                </thead>
                                <tbody>
                                    <tr v-for="s in bySymbol" :key="s.symbol">
                                        <td>{{ s.symbol }}</td>
                                        <td class="text-end">{{ s.count }}</td>
                                        <td class="text-end" :class="s.profit >= 0 ? 'greenTrade' : 'redTrade'">
                                            {{ useTwoDecCurrencyFormat(s.profit) }}</td>
                                        <td class="text-end text-muted">{{ useTwoDecCurrencyFormat(s.fees) }}</td>
                                        <td class="text-end" :class="s.funding >= 0 ? 'greenTrade' : 'redTrade'">
                                            {{ useTwoDecCurrencyFormat(s.funding) }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </template>
    </div>
</template>

<style scoped>
.kpi-label {
    font-size: 0.78rem;
    color: var(--white-60, rgba(255, 255, 255, 0.6));
    margin-bottom: 0.25rem;
}
.kpi-value {
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.1;
}
.kpi-sub {
    font-size: 0.72rem;
    color: var(--white-50, rgba(255, 255, 255, 0.5));
}
.card-title-sm {
    font-size: 0.95rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
}
.table-bot {
    width: 100%;
    font-size: 0.83rem;
    border-collapse: collapse;
}
.table-bot th {
    font-size: 0.72rem;
    text-transform: uppercase;
    color: var(--white-50, rgba(255, 255, 255, 0.5));
    font-weight: 600;
    padding-bottom: 0.35rem;
}
.table-bot td {
    padding: 0.28rem 0;
    border-bottom: 1px solid var(--white-06, rgba(255, 255, 255, 0.05));
}
.border-top-row td {
    border-top: 1px solid var(--white-10, rgba(255, 255, 255, 0.15));
    padding-top: 0.5rem;
}
.best-worst {
    border-top: 1px solid var(--white-10, rgba(255, 255, 255, 0.1));
}
.table-scroll {
    max-height: 340px;
    overflow-y: auto;
}
.coinm-badge {
    display: inline-block;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    padding: 0.05rem 0.3rem;
    margin-left: 0.35rem;
    border-radius: 4px;
    background: rgba(245, 158, 11, 0.18);
    color: #f59e0b;
    vertical-align: middle;
}
.chart-box {
    width: 100%;
}
</style>
