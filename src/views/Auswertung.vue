<script setup>
import { computed, onBeforeMount, watch, nextTick } from 'vue'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue'
import NoData from '../components/NoData.vue'
import { spinnerLoadingPage, auswertungMounted } from '../stores/ui.js'
import { amountCase } from '../stores/filters.js'
import { filteredTrades, auswertungNotes, satisfactionArray, satisfactionTradeArray, tags, availableTags } from '../stores/trades.js'
import { useChartFormat, useThousandCurrencyFormat } from '../utils/formatters.js'
import { useMountAuswertung } from '../utils/mountOrchestration.js'
import { useGaugeChart, useHorizontalBarChart, useStressLineChart, useRadarChart } from '../utils/charts'

onBeforeMount(async () => {
    await useMountAuswertung()
})

// ========== COMPUTED: Basis-Daten ==========

// Alle Trades als flaches Array
const allTrades = computed(() => {
    let result = []
    filteredTrades.forEach(day => {
        if (day.trades && day.trades.length > 0) {
            day.trades.forEach(t => result.push(t))
        }
    })
    return result
})

// Note-Lookup by tradeId
const notesByTradeId = computed(() => {
    let map = {}
    auswertungNotes.forEach(n => {
        if (n.tradeId) map[n.tradeId] = n
    })
    return map
})

// Tags-Lookup by tradeId → Array von tag_ids
const tagsByTradeId = computed(() => {
    let map = {}
    tags.forEach(t => {
        if (t.tradeId) {
            let parsed = t.tags
            if (typeof parsed === 'string') {
                try { parsed = JSON.parse(parsed) } catch (e) { parsed = [] }
            }
            map[t.tradeId] = Array.isArray(parsed) ? parsed : []
        }
    })
    return map
})

// Tag-ID → Name Mapping aus availableTags
const tagIdToName = computed(() => {
    let map = {}
    uniqueAvailableTags.value.forEach(group => {
        if (group.tags) {
            group.tags.forEach(tag => {
                map[tag.id] = tag.name
            })
        }
    })
    return map
})

// Tag-ID → Gruppen-Name Mapping
const tagIdToGroup = computed(() => {
    let map = {}
    uniqueAvailableTags.value.forEach(group => {
        if (group.tags) {
            group.tags.forEach(tag => {
                map[tag.id] = group.name
            })
        }
    })
    return map
})

// ========== GAUGES ==========

// 1) Long/Short Ratio
const longShortRatio = computed(() => {
    const trades = allTrades.value
    if (trades.length === 0) return 50
    const longCount = trades.filter(t => t.strategy === 'long').length
    return Math.round((longCount / trades.length) * 100)
})

const longShortStats = computed(() => {
    const trades = allTrades.value
    const longTrades = trades.filter(t => t.strategy === 'long')
    const shortTrades = trades.filter(t => t.strategy === 'short')
    return {
        longCount: longTrades.length,
        shortCount: shortTrades.length,
        longWinRate: longTrades.length > 0 ? Math.round((longTrades.filter(t => t[amountCase.value + 'Wins'] > 0).length / longTrades.length) * 100) : 0,
        shortWinRate: shortTrades.length > 0 ? Math.round((shortTrades.filter(t => t[amountCase.value + 'Wins'] > 0).length / shortTrades.length) * 100) : 0,
    }
})

// 2) Zufriedenheitsrate
const satisfactionRate = computed(() => {
    const allSat = [...satisfactionArray, ...satisfactionTradeArray]
    if (allSat.length === 0) return 0
    const satisfied = allSat.filter(s => s.satisfaction == true || s.satisfaction == 1).length
    return Math.round((satisfied / allSat.length) * 100)
})

// 3) Journal-Vollständigkeit
const completenessRate = computed(() => {
    const trades = allTrades.value
    if (trades.length === 0) return 0
    let filledCount = 0
    trades.forEach(t => {
        const note = notesByTradeId.value[t.id]
        const tag = tagsByTradeId.value[t.id]
        if (note && (note.playbook || note.timeframe || note.entryStressLevel > 0 || note.emotionLevel > 0 || note.feelings || note.entryNote)) {
            filledCount++
        } else if (tag && tag.length > 0) {
            filledCount++
        }
    })
    return Math.round((filledCount / trades.length) * 100)
})

// ========== TAG-BASIERTE STRATEGIE-AUSWERTUNG ==========

// Deduplizierte availableTags (Schutz gegen doppeltes Laden)
const uniqueAvailableTags = computed(() => {
    const seen = new Set()
    return availableTags.filter(group => {
        if (seen.has(group.id || group.name)) return false
        seen.add(group.id || group.name)
        return true
    })
})

// Finde alle Tag-Gruppen und berechne pro Tag: Trades, Wins, PnL
const tagGroupStats = computed(() => {
    const trades = allTrades.value
    const tagMap = tagsByTradeId.value
    const result = []

    uniqueAvailableTags.value.forEach(group => {
        if (!group.tags || group.tags.length === 0) return
        const groupStats = {
            name: group.name,
            color: group.color || '#6c757d',
            tags: []
        }

        group.tags.forEach(tagDef => {
            // Finde alle Trades die diesen Tag haben
            const taggedTrades = trades.filter(t => {
                const tradeTags = tagMap[t.id]
                return tradeTags && tradeTags.includes(tagDef.id)
            })

            if (taggedTrades.length > 0) {
                const wins = taggedTrades.filter(t => t[amountCase.value + 'Wins'] > 0).length
                const pnl = taggedTrades.reduce((sum, t) => sum + (t[amountCase.value + 'Proceeds'] || 0), 0)
                const winRate = Math.round((wins / taggedTrades.length) * 100)
                groupStats.tags.push({
                    name: tagDef.name,
                    count: taggedTrades.length,
                    wins: wins,
                    losses: taggedTrades.length - wins,
                    winRate: winRate,
                    pnl: pnl
                })
            }
        })

        if (groupStats.tags.length > 0) {
            // Sortiere Tags nach Anzahl Trades absteigend
            groupStats.tags.sort((a, b) => b.count - a.count)
            result.push(groupStats)
        }
    })

    return result
})

// Chart-Daten pro Tag-Gruppe (für horizontale Balken)
const tagGroupChartData = computed(() => {
    return tagGroupStats.value.map((group, groupIdx) => {
        return {
            name: group.name,
            color: group.color,
            categories: group.tags.map(t => t.name),
            values: group.tags.map(t => t.count),
            colors: group.tags.map(t =>
                t.winRate >= 50 ? 'rgba(72, 199, 142, 0.85)' : 'rgba(235, 87, 87, 0.85)'
            ),
            chartId: 'hbarTagGroup' + groupIdx
        }
    })
})

// ========== TIMEFRAME ==========

const timeframeChartData = computed(() => {
    const tfMap = {}
    brokerFilteredNotes.value.forEach(n => {
        if (n.timeframe) {
            if (!tfMap[n.timeframe]) tfMap[n.timeframe] = { count: 0, wins: 0 }
            tfMap[n.timeframe].count++
            const trade = allTrades.value.find(t => t.id === n.tradeId)
            if (trade && trade[amountCase.value + 'Wins'] > 0) {
                tfMap[n.timeframe].wins++
            }
        }
    })
    const sorted = Object.entries(tfMap).sort((a, b) => b[1].count - a[1].count)
    return {
        categories: sorted.map(([tf]) => tf),
        values: sorted.map(([, data]) => data.count),
        colors: sorted.map(([, data]) => {
            const winRate = data.count > 0 ? data.wins / data.count : 0
            return winRate >= 0.5 ? 'rgba(72, 199, 142, 0.85)' : 'rgba(255, 193, 7, 0.85)'
        })
    }
})

// ========== STRESS ==========

// Helper: only notes that have a matching trade in filtered (broker-filtered) trades
const brokerFilteredNotes = computed(() => {
    const tradeIds = new Set(allTrades.value.map(t => t.id))
    return auswertungNotes.filter(n => n.tradeId && tradeIds.has(n.tradeId))
})

const stressTimeData = computed(() => {
    const notesWithStress = brokerFilteredNotes.value.filter(n => n.entryStressLevel > 0)
    const sorted = [...notesWithStress].sort((a, b) => a.dateUnix - b.dateUnix)
    return {
        dates: sorted.map(n => useChartFormat(n.dateUnix)),
        entryStress: sorted.map(n => n.entryStressLevel)
    }
})

const stressVsPerfData = computed(() => {
    const stressGroups = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [] }
    brokerFilteredNotes.value.forEach(n => {
        if (n.entryStressLevel >= 0 && n.entryStressLevel <= 5) {
            const trade = allTrades.value.find(t => t.id === n.tradeId)
            if (trade) {
                stressGroups[n.entryStressLevel].push(trade)
            }
        }
    })
    const categories = []
    const values = []
    const colors = []
    for (let level = 0; level <= 5; level++) {
        const trades = stressGroups[level]
        if (trades.length > 0) {
            const winCount = trades.filter(t => t[amountCase.value + 'Wins'] > 0).length
            const winRate = Math.round((winCount / trades.length) * 100)
            categories.push('Stress ' + level)
            values.push(winRate)
            colors.push(winRate >= 50 ? 'rgba(72, 199, 142, 0.85)' : 'rgba(235, 87, 87, 0.85)')
        }
    }
    return { categories, values, colors }
})

const avgStress = computed(() => {
    const withStress = brokerFilteredNotes.value.filter(n => n.entryStressLevel > 0)
    if (withStress.length === 0) return 0
    const avg = withStress.reduce((s, n) => s + n.entryStressLevel, 0) / withStress.length
    return avg.toFixed(1)
})

// ========== EMOTIONSLEVEL ==========

const emotionTimeData = computed(() => {
    const notesWithEmotion = brokerFilteredNotes.value.filter(n => n.emotionLevel > 0)
    const sorted = [...notesWithEmotion].sort((a, b) => a.dateUnix - b.dateUnix)
    return {
        dates: sorted.map(n => useChartFormat(n.dateUnix)),
        emotionLevels: sorted.map(n => n.emotionLevel)
    }
})

const emotionVsPerfData = computed(() => {
    const emotionGroups = {}
    for (let i = 0; i <= 10; i++) emotionGroups[i] = []
    brokerFilteredNotes.value.forEach(n => {
        if (n.emotionLevel >= 1 && n.emotionLevel <= 10) {
            const trade = allTrades.value.find(t => t.id === n.tradeId)
            if (trade) {
                emotionGroups[n.emotionLevel].push(trade)
            }
        }
    })
    const categories = []
    const values = []
    const colors = []
    for (let level = 1; level <= 10; level++) {
        const trades = emotionGroups[level]
        if (trades.length > 0) {
            const winCount = trades.filter(t => t[amountCase.value + 'Wins'] > 0).length
            const winRate = Math.round((winCount / trades.length) * 100)
            categories.push('Level ' + level)
            values.push(winRate)
            colors.push(winRate >= 50 ? 'rgba(72, 199, 142, 0.85)' : 'rgba(235, 87, 87, 0.85)')
        }
    }
    return { categories, values, colors }
})

const avgEmotion = computed(() => {
    const withEmotion = brokerFilteredNotes.value.filter(n => n.emotionLevel > 0)
    if (withEmotion.length === 0) return 0
    const avg = withEmotion.reduce((s, n) => s + n.emotionLevel, 0) / withEmotion.length
    return avg.toFixed(1)
})

// ========== VOLLSTÄNDIGKEITS-RADAR ==========

const completenessRadarData = computed(() => {
    const trades = allTrades.value
    if (trades.length === 0) {
        return {
            indicators: [
                { name: 'Playbook', max: 100 }, { name: 'Timeframe', max: 100 },
                { name: 'Stress', max: 100 }, { name: 'Emotionen', max: 100 },
                { name: 'Notizen', max: 100 }, { name: 'Tags', max: 100 }
            ],
            values: [0, 0, 0, 0, 0, 0]
        }
    }
    let playbook = 0, timeframe = 0, stress = 0, emotion = 0, notizen = 0, tagCount = 0
    trades.forEach(t => {
        const note = notesByTradeId.value[t.id]
        const tag = tagsByTradeId.value[t.id]
        if (note) {
            if (note.playbook) playbook++
            if (note.timeframe) timeframe++
            if (note.entryStressLevel > 0) stress++
            if (note.emotionLevel > 0) emotion++
            if (note.entryNote || note.note) notizen++
        }
        if (tag && tag.length > 0) tagCount++
    })
    const total = trades.length
    return {
        indicators: [
            { name: 'Playbook', max: 100 }, { name: 'Timeframe', max: 100 },
            { name: 'Stress', max: 100 }, { name: 'Emotionen', max: 100 },
            { name: 'Notizen', max: 100 }, { name: 'Tags', max: 100 }
        ],
        values: [
            Math.round((playbook / total) * 100),
            Math.round((timeframe / total) * 100),
            Math.round((stress / total) * 100),
            Math.round((emotion / total) * 100),
            Math.round((notizen / total) * 100),
            Math.round((tagCount / total) * 100)
        ]
    }
})

// ========== CHARTS RENDERN ==========
watch(() => auswertungMounted.value, async (newVal) => {
    if (newVal && allTrades.value.length > 0) {
        await nextTick()
        await nextTick()
        renderCharts()
    }
})

// Re-render tag charts when tag data changes (may load after initial render)
watch(() => tagGroupChartData.value, async (newVal) => {
    if (!auswertungMounted.value) return
    await nextTick()
    newVal.forEach(group => {
        if (group.categories.length > 0) {
            useHorizontalBarChart(group.chartId, group.categories, group.values, group.colors)
        }
    })
}, { deep: true })

async function renderCharts() {
    await nextTick()

    // Gauges
    useGaugeChart('gaugeChart1', longShortRatio.value, 'Long-Anteil', [
        [0.3, 'rgba(235, 87, 87, 0.85)'],
        [0.7, 'rgba(255, 193, 7, 0.85)'],
        [1, 'rgba(72, 199, 142, 0.85)']
    ])
    useGaugeChart('gaugeChart2', satisfactionRate.value, 'Zufrieden', [
        [0.3, 'rgba(235, 87, 87, 0.85)'],
        [0.7, 'rgba(255, 193, 7, 0.85)'],
        [1, 'rgba(72, 199, 142, 0.85)']
    ])
    useGaugeChart('gaugeChart3', completenessRate.value, 'Ausgefüllt', [
        [0.3, 'rgba(235, 87, 87, 0.85)'],
        [0.7, 'rgba(255, 193, 7, 0.85)'],
        [1, 'rgba(72, 199, 142, 0.85)']
    ])

    // Tag-Gruppen Charts
    tagGroupChartData.value.forEach(group => {
        if (group.categories.length > 0) {
            useHorizontalBarChart(group.chartId, group.categories, group.values, group.colors)
        }
    })

    // Timeframe
    const tf = timeframeChartData.value
    if (tf.categories.length > 0) {
        useHorizontalBarChart('hbarChart2', tf.categories, tf.values, tf.colors)
    }

    // Stress-Chart
    const stressTime = stressTimeData.value
    if (stressTime.dates.length > 0) {
        useStressLineChart('stressLineChart', stressTime.dates, stressTime.entryStress, { max: 10 })
    }
    const stressPerf = stressVsPerfData.value
    if (stressPerf.categories.length > 0) {
        useHorizontalBarChart('hbarChart3', stressPerf.categories, stressPerf.values, stressPerf.colors)
    }

    // Emotionslevel
    const emotionTime = emotionTimeData.value
    if (emotionTime.dates.length > 0) {
        useStressLineChart('emotionLineChart', emotionTime.dates, emotionTime.emotionLevels, {
            max: 10, color: 'rgba(72, 199, 142, 0.85)', name: 'Emotionslevel'
        })
    }
    const emotionPerf = emotionVsPerfData.value
    if (emotionPerf.categories.length > 0) {
        useHorizontalBarChart('hbarChart4', emotionPerf.categories, emotionPerf.values, emotionPerf.colors)
    }

    // Radar
    const radar = completenessRadarData.value
    useRadarChart('radarChart1', radar.indicators, radar.values)
}

</script>

<template>
    <SpinnerLoadingPage />
    <div class="row mt-2">
        <div v-show="!spinnerLoadingPage">
            <div v-if="allTrades.length === 0 && auswertungMounted">
                <NoData />
            </div>
            <div v-else-if="auswertungMounted">

                <!-- ============ REIHE 1: Übersicht Gauges ============ -->
                <div class="row mb-3">
                    <div class="col-12 col-md-4 mb-3 mb-md-0">
                        <div class="dailyCard h-100 text-center">
                            <h6>Long/Short Verhältnis
                                <i class="ps-1 uil uil-info-circle" data-bs-toggle="tooltip" data-bs-html="true"
                                    data-bs-title="Anteil der Long-Trades an allen Trades. 50% = ausgewogenes Verhältnis."></i>
                            </h6>
                            <div id="gaugeChart1" class="chartGaugeClass"></div>
                            <div class="row mt-2">
                                <div class="col-6">
                                    <small class="text-muted">Long ({{ longShortStats.longWinRate }}% Win)</small>
                                    <div class="greenTrade fw-bold">{{ longShortStats.longCount }}</div>
                                </div>
                                <div class="col-6">
                                    <small class="text-muted">Short ({{ longShortStats.shortWinRate }}% Win)</small>
                                    <div class="redTrade fw-bold">{{ longShortStats.shortCount }}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-12 col-md-4 mb-3 mb-md-0">
                        <div class="dailyCard h-100 text-center">
                            <h6>Zufriedenheitsrate
                                <i class="ps-1 uil uil-info-circle" data-bs-toggle="tooltip" data-bs-html="true"
                                    data-bs-title="Anteil der Trades/Tage, bei denen du zufrieden warst."></i>
                            </h6>
                            <div id="gaugeChart2" class="chartGaugeClass"></div>
                            <div class="mt-2">
                                <small class="text-muted">
                                    {{ [...satisfactionArray, ...satisfactionTradeArray].length }} Bewertungen
                                </small>
                            </div>
                        </div>
                    </div>
                    <div class="col-12 col-md-4">
                        <div class="dailyCard h-100 text-center">
                            <h6>Journal-Vollständigkeit
                                <i class="ps-1 uil uil-info-circle" data-bs-toggle="tooltip" data-bs-html="true"
                                    data-bs-title="Anteil der Trades, bei denen du mindestens ein Journal-Feld (Playbook, Timeframe, Stress, Gefühle, Notiz, Tags) ausgefüllt hast."></i>
                            </h6>
                            <div id="gaugeChart3" class="chartGaugeClass"></div>
                            <div class="mt-2">
                                <small class="text-muted">{{ allTrades.length }} Trades insgesamt</small>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ============ REIHE 2: Tag-Gruppen Auswertung (dynamisch) ============ -->
                <div v-if="tagGroupStats.length > 0" class="row mb-3">
                    <div v-for="(group, idx) in tagGroupStats" :key="group.name"
                        :class="tagGroupStats.length === 1 ? 'col-12 mb-3' : 'col-12 col-md-6 mb-3'">
                        <div class="dailyCard h-100">
                            <h6>
                                <span class="me-2" :style="{ color: group.color }">&#9679;</span>
                                {{ group.name }}
                                <i class="ps-1 uil uil-info-circle" data-bs-toggle="tooltip" data-bs-html="true"
                                    :data-bs-title="'Auswertung der Tag-Gruppe &quot;' + group.name + '&quot;. Grün = Win Rate ≥ 50%, Rot = unter 50%. Balken zeigen die Anzahl der Trades.'"></i>
                            </h6>
                            <div :id="tagGroupChartData[idx].chartId" class="chartClass"></div>
                            <!-- Details-Tabelle unter dem Chart -->
                            <div class="mt-2">
                                <table class="table table-sm table-borderless mb-0" style="font-size: 0.85rem;">
                                    <thead>
                                        <tr class="text-muted">
                                            <th>Tag</th>
                                            <th class="text-center">Trades</th>
                                            <th class="text-center">Win%</th>
                                            <th class="text-end">PnL</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr v-for="tag in group.tags" :key="tag.name">
                                            <td>{{ tag.name }}</td>
                                            <td class="text-center">{{ tag.count }}</td>
                                            <td class="text-center" :class="tag.winRate >= 50 ? 'greenTrade' : 'redTrade'">
                                                {{ tag.winRate }}%
                                            </td>
                                            <td class="text-end" :class="tag.pnl >= 0 ? 'greenTrade' : 'redTrade'">
                                                {{ tag.pnl >= 0 ? '+' : '' }}{{ tag.pnl.toFixed(2) }}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
                <div v-else class="row mb-3">
                    <div class="col-12">
                        <div class="dailyCard text-center text-muted py-4">
                            Keine Strategie-Tags vorhanden. Vergib Tags an deine Trades um die Strategie-Auswertung zu sehen.
                        </div>
                    </div>
                </div>

                <!-- ============ REIHE 3: Timeframe & Stress-Verlauf ============ -->
                <div class="row mb-3">
                    <div class="col-12 col-md-6 mb-3 mb-md-0">
                        <div class="dailyCard h-100">
                            <h6>Timeframe-Nutzung
                                <i class="ps-1 uil uil-info-circle" data-bs-toggle="tooltip" data-bs-html="true"
                                    data-bs-title="Welche Chart-Timeframes du am häufigsten verwendest. Grün = Win Rate ≥ 50%, Gelb = unter 50%."></i>
                            </h6>
                            <div v-if="timeframeChartData.categories.length > 0" id="hbarChart2" class="chartClass"></div>
                            <div v-else class="text-center text-muted py-4">Keine Timeframe-Daten. Trage Timeframes in deinen Trade-Notizen ein.</div>
                        </div>
                    </div>
                    <div class="col-12 col-md-6">
                        <div class="dailyCard h-100">
                            <h6>Stresslevel-Verlauf
                                <i class="ps-1 uil uil-info-circle" data-bs-toggle="tooltip" data-bs-html="true"
                                    data-bs-title="Entwicklung deines Stresslevels über die Zeit (1-10)."></i>
                            </h6>
                            <div v-if="stressTimeData.dates.length > 0" id="stressLineChart" class="chartClass"></div>
                            <div v-else class="text-center text-muted py-4">Keine Stress-Daten. Trage Stresslevel in deinen Trade-Notizen ein.</div>
                            <div v-if="stressTimeData.dates.length > 0" class="mt-2 text-center">
                                <small class="text-muted">Ø Stresslevel</small>
                                <div class="fw-bold" style="color: rgba(255, 167, 38, 0.85)">{{ avgStress }}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ============ REIHE 4: Stress vs. Performance & Emotionslevel-Verlauf ============ -->
                <div class="row mb-3">
                    <div class="col-12 col-md-6 mb-3 mb-md-0">
                        <div class="dailyCard h-100">
                            <h6>Stress vs. Win Rate
                                <i class="ps-1 uil uil-info-circle" data-bs-toggle="tooltip" data-bs-html="true"
                                    data-bs-title="Win Rate gruppiert nach Stresslevel. Zeigt ob du unter bestimmtem Stress besser oder schlechter tradest."></i>
                            </h6>
                            <div v-if="stressVsPerfData.categories.length > 0" id="hbarChart3" class="chartClass"></div>
                            <div v-else class="text-center text-muted py-4">Keine Stress-Daten vorhanden</div>
                        </div>
                    </div>
                    <div class="col-12 col-md-6">
                        <div class="dailyCard h-100">
                            <h6>Emotionslevel-Verlauf
                                <i class="ps-1 uil uil-info-circle" data-bs-toggle="tooltip" data-bs-html="true"
                                    data-bs-title="Entwicklung deines Emotionslevels über die Zeit (1-10). Höher = bessere Stimmung."></i>
                            </h6>
                            <div v-if="emotionTimeData.dates.length > 0" id="emotionLineChart" class="chartClass"></div>
                            <div v-else class="text-center text-muted py-4">Keine Emotionslevel-Daten. Trage den Emotionslevel bei deinen Trades ein.</div>
                            <div v-if="emotionTimeData.dates.length > 0" class="mt-2 text-center">
                                <small class="text-muted">Ø Emotionslevel</small>
                                <div class="fw-bold" style="color: rgba(72, 199, 142, 0.85)">{{ avgEmotion }}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ============ REIHE 5: Emotionslevel vs. Performance & Vollständigkeits-Radar ============ -->
                <div class="row mb-3">
                    <div v-if="emotionVsPerfData.categories.length > 0" class="col-12 col-md-6 mb-3 mb-md-0">
                        <div class="dailyCard h-100">
                            <h6>Emotionslevel vs. Win Rate
                                <i class="ps-1 uil uil-info-circle" data-bs-toggle="tooltip" data-bs-html="true"
                                    data-bs-title="Win Rate gruppiert nach Emotionslevel. Zeigt ob du mit besserer Stimmung erfolgreicher tradest."></i>
                            </h6>
                            <div id="hbarChart4" class="chartClass"></div>
                        </div>
                    </div>
                    <div :class="emotionVsPerfData.categories.length > 0 ? 'col-12 col-md-6' : 'col-12 col-md-6 offset-md-3'">
                        <div class="dailyCard h-100">
                            <h6>Vollständigkeits-Radar
                                <i class="ps-1 uil uil-info-circle" data-bs-toggle="tooltip" data-bs-html="true"
                                    data-bs-title="Wie vollständig du dein Trading-Journal führst. Zeigt den Anteil (%) der Trades, bei denen du das jeweilige Feld ausgefüllt hast."></i>
                            </h6>
                            <div id="radarChart1" class="chartClass"></div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    </div>
</template>
