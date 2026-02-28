<script setup>
import { onBeforeMount, onMounted, computed, reactive, ref, watch, nextTick } from 'vue';
import NoData from '../components/NoData.vue';
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue';
import Screenshot from '../components/Screenshot.vue'
import ShareCardModal from '../components/ShareCardModal.vue'
import { spinnerLoadingPage, modalDailyTradeOpen, markerAreaOpen, spinnerSetups, spinnerSetupsText, hasData, saveButton, spinnerLoadMore, endOfList, timeZoneTrade, idCurrentType, idCurrentNumber, tabGettingScreenshots, scrollToDateUnix } from '../stores/ui.js';
import { amountCase, selectedGrossNet, selectedTagIndex, filteredSuggestions } from '../stores/filters.js';
import { calendarData, filteredTrades, screenshots, screenshot, tradeScreenshotChanged, excursion, tradeExcursionChanged, tradeExcursionId, tradeExcursionDateUnix, tradeId, excursions, itemTradeIndex, tradeIndex, tradeIndexPrevious, availableTags, tradeTagsChanged, tagInput, tags, tradeTags, showTagsList, tradeTagsId, tradeTagsDateUnix, newTradeTags, notes, tradeNote, tradeNoteChanged, tradeNoteDateUnix, tradeNoteId, availableTagsArray, screenshotsInfos, satisfactionTradeArray, satisfactionArray } from '../stores/trades.js';
import { currentUser, apis } from '../stores/settings.js';

import { useI18n } from 'vue-i18n'
const { t } = useI18n()

import { useCreatedDateFormat, useTwoDecCurrencyFormat, useTimeFormat, useTimeDuration, useDecimalsArithmetic, useDateCalFormat, useSwingDuration, useStartOfDay } from '../utils/formatters.js';
import { useMountDaily, useGetSelectedRange, useLoadMore, useCheckVisibleScreen } from '../utils/mountOrchestration.js';
import { useInitTooltip, useInitTab } from '../utils/utils';

import { useSetupImageUpload, useSaveScreenshot, useGetScreenshots, useSelectedScreenshotFunction } from '../utils/screenshots';

import { useGetExcursions, useGetTags, useGetAvailableTags, useUpdateAvailableTags, useUpdateTags, useFindHighestIdNumber, useFindHighestIdNumberTradeTags, useUpdateNote, useGetNotes, useGetTagInfo, useCreateAvailableTagsArray, useFilterSuggestions, useTradeTagsChange, useFilterTags, useToggleTagsDropdown, useResetTags, useDailySatisfactionChange } from '../utils/daily';

import { useCandlestickChart } from '../utils/charts';

import { useGetMFEPrices } from '../utils/addTrades';
import { sanitizeHtml } from '../utils/sanitize';

/* MODULES */
import { dbFirst, dbCreate, dbUpdate } from '../utils/db.js'
import dayjs from '../utils/dayjs-setup.js'
import axios from 'axios'
import { useCreateOHLCV } from '../utils/addTrades';


/* SHARE CARD */
const shareCardOpen = ref(false)
const shareCardTrade = ref(null)

function openShareCard() {
    const dayData = filteredTrades[itemTradeIndex.value]
    const trade = dayData?.trades?.[tradeIndex.value]
    if (!trade) return

    // Build a trade object with all needed fields for the share card
    // Leverage: prefer tradingMeta (from incoming_positions), fallback to trade field
    const lev = tradingMeta.value?.leverage || trade.leverage || 0

    // Collect tag names — only from "Strategie" group (first group)
    const stratGroup = availableTags.length > 0 ? availableTags[0] : null
    const stratTagIds = stratGroup ? new Set(stratGroup.tags.map(t => t.id)) : new Set()
    const tagNames = tradeTags.filter(t => stratTagIds.has(t.id)).map(t => t.name).filter(Boolean)

    // RRR from tradingMeta
    const rrr = tradingMeta.value?.rrr || ''

    shareCardTrade.value = {
        symbol: trade.symbol || '',
        strategy: trade.strategy || (trade.side === 'SS' || trade.side === 'BC' ? 'short' : 'long'),
        entryPrice: trade.entryPrice || 0,
        exitPrice: trade.exitPrice || 0,
        netProceeds: trade.netProceeds || 0,
        grossProceeds: trade.grossProceeds || 0,
        leverage: lev,
        commission: trade.commission || 0,
        fundingFee: trade.fundingFee || 0,
        dateUnix: dayData.dateUnix || 0,
        entryTime: trade.entryTime || dayData.dateUnix || 0,
        exitTime: trade.exitTime || 0,
        tagNames,
        rrr
    }
    shareCardOpen.value = true
}

// Open share card directly from table row — look up tags + tradingMeta from data
function openShareCardFromRow(dayIndex, tradeIdx) {
    const dayData = filteredTrades[dayIndex]
    const trade = dayData?.trades?.[tradeIdx]
    if (!trade) return

    const tradeId = trade.id

    // Look up tags for this trade — only from "Strategie" group (first group)
    const tagNames = []
    const stratGroup = availableTags.length > 0 ? availableTags[0] : null
    const stratTagIds = stratGroup ? new Set(stratGroup.tags.map(t => t.id)) : new Set()
    const findTags = tags.find(obj => obj.tradeId == tradeId)
    if (findTags && findTags.tags) {
        for (const tagId of findTags.tags) {
            if (!stratTagIds.has(tagId)) continue
            const info = useGetTagInfo(tagId)
            if (info.tagName) tagNames.push(info.tagName)
        }
    }

    // Look up tradingMetadata from notes
    const tradeNote = notes.find(obj => obj.tradeId == tradeId)
    const meta = tradeNote?.tradingMetadata || null
    const lev = meta?.leverage || trade.leverage || 0
    const rrr = meta?.rrr || ''

    shareCardTrade.value = {
        symbol: trade.symbol || '',
        strategy: trade.strategy || (trade.side === 'SS' || trade.side === 'BC' ? 'short' : 'long'),
        entryPrice: trade.entryPrice || 0,
        exitPrice: trade.exitPrice || 0,
        netProceeds: trade.netProceeds || 0,
        grossProceeds: trade.grossProceeds || 0,
        leverage: lev,
        commission: trade.commission || 0,
        fundingFee: trade.fundingFee || 0,
        dateUnix: dayData.dateUnix || 0,
        entryTime: trade.entryTime || dayData.dateUnix || 0,
        exitTime: trade.exitTime || 0,
        tagNames,
        rrr
    }
    shareCardOpen.value = true
}

const dailyTabs = [{
    id: "trades",
    label: "Trades",
    target: "#tradesNav"
},
{
    id: "blotter",
    label: "Blotter",
    target: "#blotterNav"
},
{
    id: "screenshots",
    label: "Screenshots",
    target: "#screenshotsNav"
},
]

let tradesModal = null
let tagsModal = null
let tagsModalOpen = ref(false)

function closeTradeModal() {
    tradesModal.hide()
    modalDailyTradeOpen.value = false
}

const stripHtml = (html) => {
    if (!html) return ''
    return html.replace(/<[^>]*>/g, '').trim()
}

let tradeSatisfactionId
let tradeSatisfaction
let tradeSatisfactionDateUnix

// Trading Metadata (aus notes.tradingMetadata)
const tradingMeta = ref(null)

// ===== TRADING METADATA HELPERS =====
function hasTradingMetadata(meta) {
    if (!meta) return false
    return (meta.fills?.length > 0) || meta.sl != null || meta.tp != null
        || meta.positionSize || (meta.tpslHistory?.length > 0) || meta.rrr
}

// Filter tpslHistory: remove entries recorded after the last fill (position close)
// These are artifacts from polling that detected SL/TP removal after position was already closed
function getFilteredTpslHistory(meta) {
    if (!meta?.tpslHistory?.length) return []
    if (!meta.fills?.length) return meta.tpslHistory
    // Find the last fill timestamp (= position close time), add 60s buffer
    const lastFillTime = Math.max(...meta.fills.map(f => parseInt(f.time || 0)))
    if (!lastFillTime) return meta.tpslHistory
    const cutoff = lastFillTime + 60000 // 60s tolerance
    return meta.tpslHistory.filter(h => h.time <= cutoff)
}

function getEntryFillsFromMeta(fills, side) {
    if (!fills || !Array.isArray(fills)) return []
    return fills.filter(f => !f.reduceOnly)
}

function getAvgEntryPriceFromMeta(fills, side) {
    const entryFills = getEntryFillsFromMeta(fills, side)
    if (entryFills.length === 0) return 0
    let totalValue = 0, totalQty = 0
    for (const f of entryFills) {
        totalValue += parseFloat(f.qty || 0) * parseFloat(f.price || 0)
        totalQty += parseFloat(f.qty || 0)
    }
    return totalQty > 0 ? totalValue / totalQty : 0
}

function formatMetaFillTime(timestamp) {
    return dayjs(parseInt(timestamp)).tz(timeZoneTrade.value).format('DD.MM. HH:mm')
}

function getFillBadgeType(fill, idx, allFills) {
    if (fill.reduceOnly) {
        // Prüfen ob alle Close-Fills zusammen die Position komplett schließen
        const openQty = allFills.filter(f => !f.reduceOnly).reduce((sum, f) => sum + parseFloat(f.qty || 0), 0)
        const totalClosedQty = allFills.filter(f => f.reduceOnly).reduce((sum, f) => sum + parseFloat(f.qty || 0), 0)
        return totalClosedQty >= openQty ? 'close' : 'partialClose'
    }
    if (idx === 0 || allFills.slice(0, idx).every(f => f.reduceOnly)) return 'initial'
    return 'compound'
}

// Fills nach Zeitstempel (Minutengenau) + Richtung gruppieren
function groupFillsByMinute(fills, timeField = 'time') {
    if (!fills || fills.length === 0) return []
    const groups = []
    let current = null
    for (let i = 0; i < fills.length; i++) {
        const fill = fills[i]
        const minute = dayjs(parseInt(fill[timeField])).tz(timeZoneTrade.value).format('YYYY-MM-DD HH:mm')
        const key = minute + '_' + (fill.reduceOnly ? '1' : '0')
        if (current && current.key === key) {
            current.fills.push(fill)
        } else {
            current = { key, fills: [fill], time: fill[timeField], reduceOnly: fill.reduceOnly }
            groups.push(current)
        }
    }
    return groups.map((g, gIdx) => {
        const totalQty = g.fills.reduce((s, f) => s + parseFloat(f.qty || 0), 0)
        const totalValue = g.fills.reduce((s, f) => s + parseFloat(f.qty || 0) * parseFloat(f.price || 0), 0)
        const totalFee = g.fills.reduce((s, f) => s + parseFloat(f.fee || 0), 0)
        return {
            ...g,
            totalQty,
            avgPrice: totalQty > 0 ? totalValue / totalQty : 0,
            totalValue,
            totalFee,
            isGroup: g.fills.length > 1,
            // Badge: erster Fill-Index in der Gesamtliste für getFillBadgeType
            firstFillIdx: fills.indexOf(g.fills[0])
        }
    })
}

const expandedFillGroups = ref(new Set())
const tpslCollapsedIds = ref([])
function toggleTpSlHistory(id) {
    const idx = tpslCollapsedIds.value.indexOf(id)
    if (idx >= 0) { tpslCollapsedIds.value.splice(idx, 1) } else { tpslCollapsedIds.value.push(id) }
}
function toggleFillGroup(key) {
    if (expandedFillGroups.value.has(key)) {
        expandedFillGroups.value.delete(key)
    } else {
        expandedFillGroups.value.add(key)
    }
}

// KI Trade-Bewertung
const aiTradeReview = ref('')
const aiTradeReviewLoading = ref(false)
const aiTradeReviewError = ref('')
const aiTradeReviewOpen = ref(false)
const aiTradeReviewTokens = ref(null) // { promptTokens, completionTokens, totalTokens }
const autoStartReview = ref(false)

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

async function loadTradeReview(tradeId) {
    aiTradeReview.value = ''
    aiTradeReviewError.value = ''
    aiTradeReviewOpen.value = false
    try {
        const { data } = await axios.get(`/api/ai/trade-review/${tradeId}`)
        if (data.review) {
            aiTradeReview.value = data.review
            aiTradeReviewOpen.value = true
            // Chat-Messages auch laden
            loadTradeReviewChat(tradeId)
        }
    } catch (e) {
        // Silent fail
    }
}

async function requestTradeReview() {
    if (aiTradeReviewLoading.value) return
    const trade = filteredTrades[itemTradeIndex.value].trades[tradeIndex.value]
    const dateUnix = filteredTrades[itemTradeIndex.value].dateUnix

    aiTradeReviewLoading.value = true
    aiTradeReviewError.value = ''

    try {
        const { data } = await axios.post('/api/ai/trade-review', {
            tradeId: trade.id,
            dateUnix,
            tradeData: {
                symbol: trade.symbol,
                side: trade.side,
                entryPrice: trade.entryPrice,
                exitPrice: trade.exitPrice,
                buyQuantity: trade.buyQuantity,
                sellQuantity: trade.sellQuantity,
                grossSharePL: trade.grossSharePL,
                netProceeds: trade.netProceeds,
                entryTime: trade.entryTime,
                exitTime: trade.exitTime
            }
        }, { timeout: 120000 })

        aiTradeReview.value = data.review
        aiTradeReviewOpen.value = true
        aiTradeReviewTokens.value = data.tokenUsage || null
    } catch (e) {
        aiTradeReviewError.value = e.response?.data?.error || e.message || t('daily.reviewFailed')
    }
    aiTradeReviewLoading.value = false
}

// Trade-Review Chat (Rückfragen)
const tradeReviewChat = reactive({})        // { tradeId: [messages] }
const tradeReviewChatInput = reactive({})   // { tradeId: 'text' }
const tradeReviewChatLoading = reactive({}) // { tradeId: true/false }
const tradeReviewChatError = reactive({})   // { tradeId: 'error msg' }

function currentTradeId() {
    try {
        return filteredTrades[itemTradeIndex.value].trades[tradeIndex.value].id
    } catch (e) { return null }
}

async function loadTradeReviewChat(tradeId) {
    if (!tradeId) return
    try {
        const { data } = await axios.get(`/api/ai/trade-review/${tradeId}/messages`)
        tradeReviewChat[tradeId] = Array.isArray(data) ? data : []
    } catch (e) {
        tradeReviewChat[tradeId] = []
    }
}

async function sendTradeReviewChat() {
    const tradeId = currentTradeId()
    if (!tradeId) return
    const msg = (tradeReviewChatInput[tradeId] || '').trim()
    if (!msg) return

    tradeReviewChatLoading[tradeId] = true
    tradeReviewChatError[tradeId] = ''

    try {
        await axios.post(`/api/ai/trade-review/${tradeId}/chat`, {
            message: msg
        }, { timeout: 600000 })

        tradeReviewChatInput[tradeId] = ''
        await loadTradeReviewChat(tradeId)
    } catch (e) {
        tradeReviewChatError[tradeId] = e.response?.data?.error || e.message || t('daily.chatFailed')
    }
    tradeReviewChatLoading[tradeId] = false
}

async function clearTradeReviewChat() {
    const tradeId = currentTradeId()
    if (!tradeId) return
    try {
        await axios.delete(`/api/ai/trade-review/${tradeId}/messages`)
        tradeReviewChat[tradeId] = []
    } catch (e) { /* silent */ }
}


let ohlcArray = [] // array used for charts
let ohlcv = [] // array used for MFE / excursion calculation (same as in addTrades.js)


const candlestickChartFailureMessage = ref(null)
const apiIndex = ref(-1)
const apiKey = ref(null)
const apiSource = ref(null)

onBeforeMount(async () => {

})
onMounted(async () => {
    await useMountDaily()
    await useInitTooltip()
    useCreateAvailableTagsArray()

    // Nach dem Laden: Scroll zum angeforderten Tag (z.B. vom Kalender)
    if (scrollToDateUnix.value) {
        await nextTick()
        scrollToTradeCard(scrollToDateUnix.value)
    }

    tradesModal = new bootstrap.Modal("#tradesModal")
    document.getElementById("tradesModal").addEventListener('shown.bs.modal', async (event) => {
        const caller = event.relatedTarget
        const index = caller.dataset.index
        const index2 = caller.dataset.indextwo
        clickTradesModal(index, index2, index2)
    })

    tagsModal = new bootstrap.Modal("#tagsModal")
    document.getElementById("tagsModal").addEventListener('shown.bs.modal', async (event) => {
        tagsModalOpen.value = true
        showTagsList.value = ''
        const caller = event.relatedTarget
        const index = caller.dataset.index
        clickTagsModal(index)
    })
    document.getElementById("tagsModal").addEventListener('hidden.bs.modal', () => {
        tagsModalOpen.value = false
        showTagsList.value = ''
    })
})

// Watch for calendar day click → scroll to trade card (für Mini-Kalender innerhalb Daily)
watch(scrollToDateUnix, async (dateUnix) => {
    if (!dateUnix) return
    if (spinnerLoadingPage.value) return // Wird von onMounted übernommen
    await nextTick()
    scrollToTradeCard(dateUnix)
})

function scrollToTradeCard(dateUnix) {
    const tryScroll = (attempts = 0) => {
        const el = document.getElementById('daily-card-' + dateUnix)
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            scrollToDateUnix.value = null
        } else if (attempts < 5) {
            setTimeout(() => tryScroll(attempts + 1), 100)
        } else {
            scrollToDateUnix.value = null
        }
    }
    tryScroll()
}


/**************
 * MODAL INTERACTION
 ***************/
let loadScreenshots = false
let initCandleChart = true // needed to init or not candlestickCharts in useCandlestickChart

async function clickTradesModal(param1, param2, param3) {
    //param1 : itemTradeIndex : index inside filteredtrades. This is only defined on first click/when we open modal and not on next or previous
    //param2 : also called tradeIndex, is the index inside the trades (= index of itemTrade.trades)
    //param3 : tradeIndex back or next, so with -1 or +1. On modal open, param3 = param2
    //console.log(" param 3 "+JSON.stringify(param3))
    //console.log("param1 " + param1)
    //console.log("param2 " + param2)
    //console.log("param3 " + param3)
    //console.log(" clicking ")

    if (markerAreaOpen.value == true) {
        alert("Bitte speichere deine Screenshot-Markierung")
        return
    } else {
        await (spinnerSetups.value = true)

        if (tradeNoteChanged.value) {
            await useUpdateNote()
            await useGetNotes()
        }

        if (tradeExcursionChanged.value) {
            await updateExcursions()
        }

        if (tradeTagsChanged.value) {
            await Promise.all([useUpdateAvailableTags(), useUpdateTags()])
            await Promise.all([useGetTags(), useGetAvailableTags()])
            useCreateAvailableTagsArray()
        }

        if (tradeScreenshotChanged.value) {
            await useSaveScreenshot()
        }


        tradeNoteChanged.value = false
        tradeExcursionChanged.value = false
        tradeScreenshotChanged.value = false
        tradeTagsChanged.value = false

        showTagsList.value = ''


        if (param1 === undefined && param2 === undefined && param3 === undefined) {
            //console.log(" -> Closing Modal")
            await (spinnerSetups.value = false)

            itemTradeIndex.value = undefined
            tradeIndexPrevious.value = undefined
            tradeIndex.value = undefined

            tradeNoteChanged.value = false
            tradeExcursionChanged.value = false
            tradeScreenshotChanged.value = false
            tradeTagsChanged.value = false

            showTagsList.value = ''

            tradesModal.hide()
            await (modalDailyTradeOpen.value = false) //this is important because we use itemTradeIndex on filteredTrades and if change month, this causes problems. So only show modal content when clicked on open modal/v-if
            await useInitTab("daily")
            loadScreenshots = false
            initCandleChart = true
        }
        else {
            //console.log(" -> Opening Modal or clicking next/back")
            itemTradeIndex.value = Number(param1)
            tradeIndexPrevious.value = Number(param2)
            tradeIndex.value = Number(param3)

            apiIndex.value = -1
            let databentoIndex = apis.findIndex(obj => obj.provider === "databento")
            let polygonIndex = apis.findIndex(obj => obj.provider === "polygon")

            if (databentoIndex > -1 && apis[databentoIndex].key != "") {
                apiIndex.value = databentoIndex
                apiSource.value = "databento"
            } else if (polygonIndex > -1 && apis[polygonIndex].key != "") {
                apiIndex.value = polygonIndex
                apiSource.value = "polygon"
            }

            let awaitClick = async () => {

                modalDailyTradeOpen.value = true

                if (loadScreenshots === false) {
                    let screenshotsDate = filteredTrades[param1].dateUnix

                    if (screenshots.length == 0 || (screenshots.length > 0 && screenshots[0].dateUnixDay != screenshotsDate)) {
                        console.log("  --> getting Screenshots")
                        await useGetScreenshots(true, screenshotsDate)
                    } else {
                        console.log("  --> Screenshots already stored")
                    }
                    loadScreenshots = true
                }

                let filteredTradeId = filteredTrades[itemTradeIndex.value].trades[param3].id
                await Promise.all([resetExcursion(), useResetTags()])

                //For setups I have added setups into filteredTrades. For screenshots and excursions I need to find so I create on each modal page a screenshot and excursion object
                let tradeDateUnix = filteredTrades[itemTradeIndex.value].dateUnix
                let findScreenshot = screenshots.find(obj => obj.name == filteredTradeId)
                    || screenshots.find(obj => obj.dateUnixDay == tradeDateUnix)
                // If not in full screenshots, check screenshotsInfos and load full data
                if (!findScreenshot) {
                    let infoMatch = screenshotsInfos.find(obj => obj.dateUnixDay == tradeDateUnix)
                    if (infoMatch) {
                        await useGetScreenshots(true, infoMatch.dateUnixDay)
                        findScreenshot = screenshots.find(obj => obj.name == filteredTradeId)
                            || screenshots.find(obj => obj.dateUnixDay == tradeDateUnix)
                    }
                }
                for (let key in screenshot) delete screenshot[key]
                candlestickChartFailureMessage.value = null // to avoid message when screenshot is present

                if (findScreenshot) {
                    for (let key in findScreenshot) {
                        screenshot[key] = findScreenshot[key]
                    }
                } else {
                    screenshot.side = null
                    screenshot.type = null
                }

                /* GET OHLC / CANDLESTICK CHARTS */
                let loadChart = false
                let filteredTradesObject = filteredTrades[itemTradeIndex.value].trades[param3]

                // Timeframe aus der Note des Trades holen, oder 15m als Default
                let tradeNote_ = notes.find(obj => obj.tradeId == filteredTradeId)
                let chartInterval = (tradeNote_ && tradeNote_.timeframe) ? tradeNote_.timeframe : '15m'

                // Binance-Chart (kein API-Key nötig)
                if (currentUser.value?.enableBinanceChart) {
                    apiSource.value = "binance"
                    loadChart = true
                }
                // Fallback: Databento/Polygon
                else if (apiIndex.value != -1) {
                    apiKey.value = apis[apiIndex.value].key
                    if (apiKey.value) {
                        loadChart = true
                    }
                }

                if (loadChart) {
                    try {
                        candlestickChartFailureMessage.value = null
                        let ohlcTimestamps
                        let ohlcPrices
                        let ohlcVolumes

                        // Cache-Key enthält auch das Interval
                        let cacheIndex = ohlcArray.findIndex(obj => obj.date == filteredTradesObject.td && obj.symbol == filteredTradesObject.symbol && obj.interval == chartInterval)

                        if (cacheIndex != -1) {
                            console.log(" -> Symbol/date/interval exists in ohlcArray cache")
                            ohlcTimestamps = ohlcArray[cacheIndex].ohlcTimestamps
                            ohlcPrices = ohlcArray[cacheIndex].ohlcPrices
                            ohlcVolumes = ohlcArray[cacheIndex].ohlcVolumes
                        } else {
                            console.log(" -> Fetching OHLC data for " + filteredTradesObject.symbol + " (" + chartInterval + ")")
                            await getOHLC(filteredTradesObject.td, filteredTradesObject.symbol, filteredTradesObject.type, chartInterval, filteredTradesObject.entryTime)
                            cacheIndex = ohlcArray.findIndex(obj => obj.date === filteredTradesObject.td && obj.symbol === filteredTradesObject.symbol && obj.interval == chartInterval)
                            if (cacheIndex != -1) {
                                ohlcTimestamps = ohlcArray[cacheIndex].ohlcTimestamps
                                ohlcPrices = ohlcArray[cacheIndex].ohlcPrices
                                ohlcVolumes = ohlcArray[cacheIndex].ohlcVolumes
                            } else {
                                console.log(" -> Problem beim Laden der OHLC-Daten")
                            }
                        }

                        if (ohlcTimestamps) {
                            // tradingMetadata an Trade anhängen für Chart-Erweiterungen (SL/TP/Fills)
                            if (tradeNote_ && tradeNote_.tradingMetadata) {
                                filteredTradesObject._tradingMeta = tradeNote_.tradingMetadata
                            }
                            await useCandlestickChart(ohlcTimestamps, ohlcPrices, ohlcVolumes, filteredTradesObject, initCandleChart)
                            initCandleChart = false
                        }
                    } catch (error) {
                        if (error.response && error.response.status === 429) {
                            candlestickChartFailureMessage.value = "Zu viele Anfragen, versuche es später erneut"
                        } else if (error.response && error.response.status === 400) {
                            candlestickChartFailureMessage.value = "Chart nicht verfügbar für dieses Symbol"
                        } else if (error.response) {
                            candlestickChartFailureMessage.value = error.response.statusText
                        } else {
                            candlestickChartFailureMessage.value = error.message || String(error)
                        }
                        console.error(error)
                    }
                } else {
                    candlestickChartFailureMessage.value = null
                }

                //We differentiate
                //1- tags on daily page : they are a function of available tags
                //2- tags in modal (here): they need to have id and name because if we add a new tag, we need the json with id and name
                let findTags = tags.find(obj => obj.tradeId == filteredTradeId)
                if (findTags) {
                    findTags.tags.forEach(element => {
                        // Skip wenn Tag schon in tradeTags existiert
                        if (tradeTags.findIndex(t => t.id === element) !== -1) return
                        for (let obj of availableTags) {
                            for (let tag of obj.tags) {
                                if (tag.id === element) {
                                    tradeTags.push({ id: tag.id, name: tag.name })
                                    return  // Gefunden, nicht weiter suchen
                                }
                            }
                        }
                    });
                }

                let noteIndex = notes.findIndex(obj => obj.tradeId == filteredTradeId)
                tradeNote.value = null
                tradingMeta.value = null
                if (noteIndex != -1) {
                    tradeNote.value = stripHtml(notes[noteIndex].note)
                    tradingMeta.value = notes[noteIndex].tradingMetadata || null
                }

                // KI-Bewertung laden (non-blocking)
                loadTradeReview(filteredTradeId)

                let findExcursion = excursions.filter(obj => obj.tradeId == filteredTradeId)
                if (findExcursion.length) {
                    findExcursion[0].stopLoss != null ? excursion.stopLoss = findExcursion[0].stopLoss : null
                    findExcursion[0].maePrice != null ? excursion.maePrice = findExcursion[0].maePrice : null
                    findExcursion[0].mfePrice != null ? excursion.mfePrice = findExcursion[0].mfePrice : null
                    //console.log(" tradeExcursion "+JSON.stringify(tradeExcursion))
                }

                //let findSatisfaction = excursions.filter(obj => obj.tradeId == filteredTradeId)
                console.log(" satisfactionTradeArray "+JSON.stringify(satisfactionArray))
                if (findExcursion.length) {
                    findExcursion[0].stopLoss != null ? excursion.stopLoss = findExcursion[0].stopLoss : null
                    findExcursion[0].maePrice != null ? excursion.maePrice = findExcursion[0].maePrice : null
                    findExcursion[0].mfePrice != null ? excursion.mfePrice = findExcursion[0].mfePrice : null
                }

                // Auto-MFE: Berechne aus 1m Binance-Daten wenn noch nicht gesetzt
                if (apiSource.value === "binance" && currentUser.value?.enableBinanceChart && !excursion.mfePrice) {
                    let autoMfe = await calcMfeFromOhlc(null, null, filteredTradesObject)
                    if (autoMfe !== null) {
                        excursion.mfePrice = autoMfe
                        tradeExcursionDateUnix.value = filteredTrades[itemTradeIndex.value].dateUnix
                        tradeExcursionId.value = filteredTradeId
                        tradeExcursionChanged.value = true
                        saveButton.value = true
                        console.log(" -> Auto-MFE berechnet: " + autoMfe)
                    }
                }

                //if (firstTimeOpen) firstTimeOpen = false
            }
            await awaitClick()
            await (spinnerSetups.value = false)
            tagInput.value = ''
            saveButton.value = false
            await useInitTooltip()

            // Auto-Start KI-Bewertung (wenn aus der Zeile geklickt)
            if (autoStartReview.value) {
                autoStartReview.value = false
                requestTradeReview()
            }
        }

    }

}

const clickTagsModal = (param1) => {
    itemTradeIndex.value = Number(param1)
    tradeTags.length = 0
    // Set context for useUpdateTags — daily-level tags use dateUnix as tradeId
    tradeTagsId.value = null
    tradeTagsDateUnix.value = filteredTrades[itemTradeIndex.value].dateUnix
    let findTags = tags.find(obj => obj.tradeId == filteredTrades[itemTradeIndex.value].dateUnix.toString())
    if (findTags) {
        findTags.tags.forEach(element => {
            for (let obj of availableTags) {
                for (let tag of obj.tags) {
                    if (tag.id === element) {
                        let temp = {}
                        temp.id = tag.id
                        temp.name = tag.name
                        tradeTags.push(temp)
                    }
                }
            }
        });
    }
}

const saveDailyTags = async () => {
    if (tradeTagsChanged.value) {
        await Promise.all([useUpdateAvailableTags(), useUpdateTags()])
        await Promise.all([useGetTags(), useGetAvailableTags()])
    }
    tradeTagsChanged.value = false
    closeTagsModal()
}

const toggleTagsModalDropdown = () => {
    selectedTagIndex.value = -1
    showTagsList.value = showTagsList.value === 'tagsModal' ? '' : 'tagsModal'
    if (showTagsList.value === 'tagsModal') {
        filteredSuggestions.splice(0)
        for (const group of availableTags) {
            for (const tag of group.tags) {
                filteredSuggestions.push(tag)
            }
        }
    }
}

const onTagsModalInput = () => {
    selectedTagIndex.value = -1
    filteredSuggestions.splice(0)
    for (const group of availableTags) {
        for (const tag of group.tags) {
            if (tagInput.value === '' || tag.name.toLowerCase().startsWith(tagInput.value.toLowerCase())) {
                filteredSuggestions.push(tag)
            }
        }
    }
    showTagsList.value = (tagInput.value !== '' && filteredSuggestions.length > 0) ? 'tagsModal' : ''
}

const closeTagsModal = async () => {
    tradeTags.length = 0
    tagsModal.hide()
}

const checkDate = ((param1, param2) => {
    //console.log("param 1 "+param1)
    //console.log("param 2 "+param2)
    let tdDateUnix = dayjs(param1 * 1000).tz(timeZoneTrade.value)
    let tradeDateUnix = dayjs(param2 * 1000).tz(timeZoneTrade.value)
    let check = tdDateUnix.isSame(tradeDateUnix, 'day')
    return check
})

/**************
 * SATISFACTION
 ***************/



async function tradeSatisfactionChange(param1, param2) {
    tradeSatisfactionId = param1.id
    tradeSatisfactionDateUnix = param1.td
    tradeSatisfaction = param2
    param1.satisfaction = tradeSatisfaction
    await updateTradeSatisfaction()

}

async function updateTradeSatisfaction() {
    console.log("\nUPDATING OR SAVING TRADES SATISFACTION")
    return new Promise(async (resolve, reject) => {
        const existing = await dbFirst("satisfactions", {
            equalTo: { tradeId: tradeSatisfactionId }
        })
        if (existing) {
            console.log(" -> Updating satisfaction")
            await dbUpdate("satisfactions", existing.objectId, {
                satisfaction: tradeSatisfaction
            })
            console.log(' -> Updated satisfaction with id ' + existing.objectId + " to " + tradeSatisfaction)
        } else {
            console.log(" -> Saving satisfaction")
            const result = await dbCreate("satisfactions", {
                dateUnix: tradeSatisfactionDateUnix,
                tradeId: tradeSatisfactionId,
                satisfaction: tradeSatisfaction
            })
            console.log(' -> Added new satisfaction with id ' + result.objectId)
        }
        resolve()
    })
}

/**************
 * EXCURSIONS
 ***************/

function tradeExcursionClicked() {
    //console.log("click")
    tradeExcursionChanged.value = true
    saveButton.value = true
}
function tradeExcursionChange(param1, param2) {
    console.log("param 1: " + param1 + " param2: " + param2)
    if (param2 == "stopLoss") {
        if (param1) {
            excursion.stopLoss = parseFloat(param1)
        } else {
            excursion.stopLoss = null
        }

    }
    if (param2 == "maePrice") {
        excursion.maePrice = parseFloat(param1)
    }
    if (param2 == "mfePrice") {
        excursion.mfePrice = parseFloat(param1)
    }
    tradeExcursionDateUnix.value = filteredTrades[itemTradeIndex.value].dateUnix
    tradeExcursionId.value = filteredTrades[itemTradeIndex.value].trades[tradeIndex.value].id
    //console.log("Excursion has changed: " + JSON.stringify(excursion))

}

async function updateExcursions() {
    console.log("\nUPDATING OR SAVING EXCURSIONS")
    return new Promise(async (resolve, reject) => {

        if (excursion.stopLoss != null || excursion.maePrice != null || excursion.mfePrice != null) {
            spinnerSetups.value = true
            const existing = await dbFirst("excursions", {
                equalTo: { tradeId: tradeExcursionId.value }
            })
            const excursionData = {
                stopLoss: excursion.stopLoss == null || excursion.stopLoss == '' ? null : excursion.stopLoss,
                maePrice: excursion.maePrice == null || excursion.maePrice == '' ? null : excursion.maePrice,
                mfePrice: excursion.mfePrice == null || excursion.mfePrice == '' ? null : excursion.mfePrice
            }
            if (existing) {
                console.log(" -> Updating excursions")
                await dbUpdate("excursions", existing.objectId, excursionData)
                console.log(' -> Updated excursions with id ' + existing.objectId)
                await useGetSelectedRange()
                await useGetExcursions()
            } else {
                console.log(" -> Saving excursions")
                excursionData.dateUnix = tradeExcursionDateUnix.value
                excursionData.tradeId = tradeExcursionId.value
                const result = await dbCreate("excursions", excursionData)
                console.log(' -> Added new excursion with id ' + result.objectId)
                await useGetSelectedRange()
                await useGetExcursions()
                tradeId.value = tradeExcursionId.value
            }

        }
        resolve()


    })
}


/**************
 * MFE BERECHNUNG
 ***************/

/**
 * Berechnet den MFE-Preis aus 1m-Binance-Daten für maximale Genauigkeit.
 * Long: höchster High zwischen Entry und Exit
 * Short: tiefster Low zwischen Entry und Exit
 */
async function calcMfeFromOhlc(ohlcTimestamps, ohlcPrices, trade) {
    if (!trade.entryTime || !trade.exitTime || !trade.symbol) return null

    const entryMs = trade.entryTime * 1000
    const exitMs = trade.exitTime * 1000
    const isLong = trade.strategy === 'long'

    try {
        // 1m-Daten nur für den Trade-Zeitraum holen (genauer als Chart-Interval)
        const response = await axios.get('/api/binance/klines', {
            params: {
                symbol: trade.symbol.toUpperCase(),
                interval: '1m',
                startTime: entryMs,
                endTime: exitMs,
                limit: 1500
            }
        })

        if (!response.data || response.data.length === 0) return null

        let mfePrice = isLong ? -Infinity : Infinity

        for (let i = 0; i < response.data.length; i++) {
            const kline = response.data[i]
            const high = parseFloat(kline[2])  // high
            const low = parseFloat(kline[3])   // low

            if (isLong && high > mfePrice) mfePrice = high
            if (!isLong && low < mfePrice) mfePrice = low
        }

        if (mfePrice === -Infinity || mfePrice === Infinity) return null
        return mfePrice

    } catch (error) {
        console.log(" -> MFE-Berechnung fehlgeschlagen: " + error.message)
        return null
    }
}

/**************
 * MISC
 ***************/

function resetExcursion() {
    //console.log(" -> Resetting excursion")
    //we need to reset the setup variable each time
    for (let key in excursion) delete excursion[key]
    excursion.stopLoss = null
    excursion.maePrice = null
    excursion.mfePrice = null
}

/**************
 * TAGS
 ***************/


/**************
 * NOTES
 ***************/

const tradeNoteChange = (param) => {
    tradeNote.value = param
    //console.log(" -> New note " + tradeNote.value)
    tradeNoteDateUnix.value = filteredTrades[itemTradeIndex.value].dateUnix
    tradeNoteId.value = filteredTrades[itemTradeIndex.value].trades[tradeIndex.value].id
    //console.log(" tradeNoteId.value " + tradeNoteId.value)
    tradeNoteChanged.value = true
    saveButton.value = true

}

/**************
 * SCREENSHOTS
 ***************/
const filteredScreenshots = (param1, param2) => {
    let screenshotArray = []
    for (let index = 0; index < param1.trades.length; index++) {
        const el1 = param1.trades[index];
        let screenshotsArray = param2 ? screenshots : screenshotsInfos

        for (let index2 = 0; index2 < screenshotsArray.length; index2++) {
            const el2 = screenshotsArray[index2]
            if (screenshotArray.findIndex(obj => obj == el2) != -1) continue // already added
            // Match by name == tradeId
            if (el2.name == el1.id) {
                screenshotArray.push(el2)
            }
            // Match by dateUnixDay (consistent timezone handling)
            else if (el2.dateUnixDay == param1.dateUnix) {
                screenshotArray.push(el2)
            }
            // Fallback: startOfDay comparison
            else if (useStartOfDay(el2.dateUnix) == param1.dateUnix) {
                screenshotArray.push(el2)
            }
        }
    }
    return screenshotArray
}




// Mapping: Timeframe → Binance-kompatibles Interval
const binanceIntervalMap = {
    '1m': '1m', '2m': '3m', '3m': '3m', '5m': '5m',
    '6m': '5m', '10m': '15m', '15m': '15m', '30m': '30m',
    '45m': '1h', '1h': '1h', '2h': '2h', '3h': '4h', '4h': '4h',
    '1D': '1d', '1W': '1w', '1M': '1M'
}

function getOHLC(date, symbol, type, interval, entryTime) {
    if (apiSource.value === "binance") {
        // Binance-kompatibles Interval bestimmen
        const binanceInterval = binanceIntervalMap[interval] || '15m'
        console.log(" -> getting OHLC from Binance for " + symbol + " (" + binanceInterval + ") on " + useDateCalFormat(date))

        return new Promise(async (resolve, reject) => {
            try {
                // Zeitraum: ±6h um den Trade-Einstieg (halber Tag)
                const entryMs = entryTime ? entryTime * 1000 : dayjs(date * 1000).tz(timeZoneTrade.value).startOf('day').add(12, 'hour').valueOf()
                const startTime = dayjs(entryMs).subtract(6, 'hour').valueOf()
                const endTime = dayjs(entryMs).add(6, 'hour').valueOf()

                const response = await axios.get('/api/binance/klines', {
                    params: {
                        symbol: symbol.toUpperCase(),
                        interval: binanceInterval,
                        startTime: startTime,
                        endTime: endTime,
                        limit: 1500
                    }
                })

                let tempArray = {
                    date: date,
                    symbol: symbol,
                    interval: interval,
                    ohlcTimestamps: [],
                    ohlcPrices: [],
                    ohlcVolumes: []
                }

                // Binance klines format: [openTime, open, high, low, close, volume, closeTime, ...]
                for (let i = 0; i < response.data.length; i++) {
                    const kline = response.data[i]
                    tempArray.ohlcTimestamps.push(kline[0]) // openTime in ms
                    // ECharts candlestick: [close, open, low, high]
                    tempArray.ohlcPrices.push([
                        parseFloat(kline[4]),  // close
                        parseFloat(kline[1]),  // open
                        parseFloat(kline[3]),  // low
                        parseFloat(kline[2])   // high
                    ])
                    tempArray.ohlcVolumes.push(parseFloat(kline[5]))
                }

                ohlcArray.push(tempArray)
                console.log(" -> Binance: " + tempArray.ohlcTimestamps.length + " Kerzen geladen (" + binanceInterval + ")")
                resolve()
            } catch (error) {
                console.log(" -> Binance API Error: " + error)
                reject(error)
            }
        })

    } else if (apiSource.value === "databento") {
        console.log(" -> getting OHLC from " + apiSource.value + " for date " + useDateCalFormat(date))

        return new Promise(async (resolve, reject) => {
            let temp = {}
            temp.symbol = symbol

            let databentoSymbol = temp.symbol
            let stype_in = "raw_symbol"
            let toDate = dayjs(date * 1000).tz(timeZoneTrade.value).endOf('day').unix()
            let dataset
            //console.log("toDate "+toDate)
            temp.ohlcv = []

            if (type === "future") {
                dataset = "GLBX.MDP3"
                databentoSymbol = temp.symbol + ".c.0"
                stype_in = "continuous"

            } else if (type === "stock") {
                dataset = "XNAS.ITCH"

            } else if (tradedSymbols[i].secType === "call" || tradedSymbols[i].secType === "put") {

            } else if (tradedSymbols[i].secType === "forex") {

            }

            let data =
            {
                'dataset': dataset,
                'stype_in': stype_in,
                'symbols': databentoSymbol,
                'schema': 'ohlcv-1m',
                'start': date * 1000000000,
                'end': toDate * 1000000000,
                'encoding': 'csv',
                'pretty_px': 'true',
                'pretty_ts': 'true',
                'map_symbols': 'true',
                'username': apiKey.value
            }

            axios.post('/api/databento', data)
                .then(async (response) => {
                    //console.log(" response "+JSON.stringify(response.data))

                    let res = await useCreateOHLCV(response.data, temp)
                    ohlcv.push(res) // used for MFE calculation (same as in addTrades.js)

                    let tempArray = {}
                    tempArray.date = date
                    tempArray.symbol = symbol
                    tempArray.ohlcTimestamps = []
                    tempArray.ohlcPrices = []
                    tempArray.ohlcVolumes = []

                    for (let index = 0; index < res.ohlcv.length; index++) {
                        const element = res.ohlcv[index];

                        let temp = []

                        tempArray.ohlcTimestamps.push(element.t)
                        temp.push(element.c)
                        temp.push(element.o)
                        temp.push(element.l)
                        temp.push(element.h)
                        tempArray.ohlcPrices.push(temp)
                        tempArray.ohlcVolumes.push(element.v)
                    }

                    ohlcArray.push(tempArray)
                    //console.log("ohlcArray "+JSON.stringify(ohlcArray))
                    resolve()
                })
                .catch((error) => {
                    console.log(" -> Error in databento response " + error)
                    reject(error)
                });
        })

    }
    else if (apiSource.value === "polygon") {

        let ticker
        if (type === "put" || type === "call" || type === "option") {
            ticker = "O:" + symbol
        } else if (type === "future") {
            ticker = "I:" + symbol
        } else if (type === "forex") {
            ticker = "C:" + symbol
        } else if (type === "crypto") {
            ticker = "X:" + symbol
        } else {
            ticker = symbol
        }
        console.log("  --> Getting OHLC for ticker " + ticker + " on " + date)

        return new Promise(async (resolve, reject) => {
            await axios.get('/api/polygon/aggs', {
                params: {
                    ticker,
                    from: useDateCalFormat(date),
                    to: useDateCalFormat(date),
                    interval: 1,
                    span: 'minute',
                    adjusted: true,
                    sort: 'asc',
                    limit: 50000
                },
                headers: {
                    'x-polygon-api-key': apiKey.value
                }
            })

                .then((response) => {
                    let tempArray = {}
                    tempArray.date = date
                    tempArray.symbol = symbol
                    tempArray.ohlcTimestamps = []
                    tempArray.ohlcPrices = []
                    tempArray.ohlcVolumes = []

                    let temp = {}
                    temp.symbol = symbol
                    temp.ohlcv = response.data.results
                    ohlcv.push(temp) // used for MFE calculation (same as in addTrades.js)

                    for (let index = 0; index < response.data.results.length; index++) {
                        const element = response.data.results[index];

                        let temp = []

                        tempArray.ohlcTimestamps.push(element.t)
                        temp.push(element.c)
                        temp.push(element.o)
                        temp.push(element.l)
                        temp.push(element.h)
                        tempArray.ohlcPrices.push(temp)
                        tempArray.ohlcVolumes.push(element.v)
                    }

                    ohlcArray.push(tempArray)
                })
                .catch((error) => {
                    reject(error)
                })
                .finally(function () {
                    // always executed
                })

            resolve()

        })
    }

}

</script>

<template>
    <SpinnerLoadingPage />
    <div v-if="!spinnerLoadingPage && filteredTrades" class="row mt-2 mb-2">
        <div v-if="!hasData">
            <NoData />
        </div>
        <div v-show="hasData">
            <!-- added v-if instead v-show because need to wait for patterns to load -->
            <div class="row">
                <!-- ============ CARD ============ -->
                <div class="col-12">
                    <!-- v-show insead of v-if or else init tab does not work cause div is not created until spinner is false-->
                    <div v-for="(itemTrade, index) in filteredTrades" class="row mt-2" :id="'daily-card-' + itemTrade.dateUnix">
                        <div class="col-12">
                            <div class="dailyCard">
                                <div class="row">
                                    <!-- ============ PART 1 ============ -->
                                    <!-- Line 1 : Date and P&L -->
                                    <!--<input id="providers" type="text" class="form-control" placeholder="Fournisseur*" autocomplete="off"/>-->


                                    <div class="col-12 cardFirstLine mb-2">
                                        <div class="row">
                                            <div class="col-12 col-lg-auto">{{ useCreatedDateFormat(itemTrade.dateUnix)
                                                }}

                                            </div>

                                        </div>
                                        <div>
                                            <!-- Tags display removed -->
                                        </div>
                                    </div>

                                    <!-- Stats bar -->
                                    <div class="col-12 mb-1">
                                        <div class="daily-stats-bar">
                                            <span class="stats-item"><span class="stats-label">Trades</span> {{ itemTrade.pAndL.trades }}</span>
                                            <span class="stats-divider">|</span>
                                            <span class="stats-item"><span class="stats-label">Wins</span> <span class="greenTrade">{{ itemTrade.pAndL.grossWinsCount }}</span></span>
                                            <span class="stats-divider">|</span>
                                            <span class="stats-item"><span class="stats-label">Losses</span> <span class="redTrade">{{ itemTrade.pAndL.grossLossCount }}</span></span>
                                            <span class="stats-divider">|</span>
                                            <span class="stats-item"><span class="stats-label">Fees</span> {{ useTwoDecCurrencyFormat(itemTrade.pAndL.fees) }}</span>
                                            <span class="stats-divider">|</span>
                                            <span class="stats-item"><span class="stats-label">PnL(g)</span> <span :class="itemTrade.pAndL.grossProceeds > 0 ? 'greenTrade' : 'redTrade'">{{ useTwoDecCurrencyFormat(itemTrade.pAndL.grossProceeds) }}</span></span>
                                        </div>
                                    </div>

                                    <!-- end PART 1 -->

                                    <!-- ============ PART 2 ============ -->
                                    <div v-if="!modalDailyTradeOpen" class="col-12 table-responsive">
                                        <nav>
                                            <!--------------------
                                            TABS
                                            --------------------->

                                            <!--Trades-->
                                            <div class="nav nav-tabs mb-2" id="nav-tab" role="tablist">
                                                <button :class="['nav-link', index === 0 ? 'active' : '']" v-bind:id="'trades-' + index"
                                                    data-bs-toggle="tab" v-bind:data-bs-target="'#tradesNav-' + index"
                                                    type="button" role="tab" aria-controls="nav-overview"
                                                    aria-selected="true">Trades
                                                </button>

                                                <!--Blotter-->
                                                <button class="nav-link" v-bind:id="'blotter-' + index"
                                                    data-bs-toggle="tab" v-bind:data-bs-target="'#blotterNav-' + index"
                                                    type="button" role="tab" aria-controls="nav-overview"
                                                    aria-selected="true">Blotter
                                                </button>

                                                <!--Screenshots tab removed - thumbnails now shown in trade detail modal-->

                                            </div>
                                        </nav>
                                        <div class="tab-content" id="nav-tabContent">

                                            <!-- TRADES TAB -->
                                            <div :class="['tab-pane', 'fade', 'txt-small', index === 0 ? 'show active' : '']" v-bind:id="'tradesNav-' + index"
                                                role="tabpanel" aria-labelledby="nav-overview-tab">
                                                <table class="table">
                                                    <thead>
                                                        <tr>
                                                            <th scope="col">Symbol</th>
                                                            <th scope="col"></th>
                                                            <th scope="col">Vol<i class="ps-1 uil uil-info-circle"
                                                                    data-bs-toggle="tooltip"
                                                                    :data-bs-title="t('daily.volTooltip')"></i>
                                                            </th>
                                                            <th scope="col">Position</th>
                                                            <th scope="col">{{ t('daily.entry') }}</th>
                                                            <th scope="col">PnL/Stk<i class="ps-1 uil uil-info-circle"
                                                                    data-bs-toggle="tooltip"
                                                                    :data-bs-title="t('daily.pnlPerUnitTooltip')"></i>
                                                            </th>
                                                            <th scope="col">PnL(n)</th>
                                                            <th scope="col"></th>
                                                            <th scope="col"></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>

                                                        <!-- the page loads faster than the video blob => check if blob, that is after slash, is not null, and then load -->
                                                        <!--<tr v-if="/[^/]*$/.exec(videoBlob)[0]!='null'&&trade.videoStart&&trade.videoEnd">-->

                                                        <tr v-for="(trade, index2) in itemTrade.trades"
                                                            data-bs-toggle="modal" data-bs-target="#tradesModal"
                                                            class="pointerClass" :data-index="index"
                                                            :data-indextwo="index2">

                                                            <!--Symbol-->
                                                            <td class="align-middle">{{ trade.symbol }}</td>

                                                            <!--KI-Bewertung + Share Quick-Buttons-->
                                                            <td v-if="currentUser?.aiEnabled !== false && currentUser?.aiEnabled !== 0" @click.stop="" class="align-middle">
                                                                <div class="d-flex align-items-center gap-1">
                                                                    <button class="ai-quick-btn"
                                                                        data-bs-toggle="modal" data-bs-target="#tradesModal"
                                                                        :data-index="index" :data-indextwo="index2"
                                                                        @click="autoStartReview = true">
                                                                        <i class="uil uil-robot me-1"></i>{{ t('daily.aiReview') }}
                                                                    </button>
                                                                    <button class="ai-quick-btn share-quick-btn"
                                                                        @click="openShareCardFromRow(index, index2)">
                                                                        <i class="uil uil-image-share"></i>
                                                                    </button>
                                                                </div>
                                                            </td>

                                                            <!--Vol-->
                                                            <td>{{ trade.buyQuantity + trade.sellQuantity }}</td>

                                                            <!--Position-->
                                                            <td>
                                                                {{
                                                                    trade.strategy.charAt(0).toUpperCase() +
                                                                    trade.strategy.slice(1)
                                                                }}
                                                            </td>

                                                            <!--Entry-->
                                                            <td>
                                                                <span v-if="trade.tradesCount == 0"><span
                                                                        v-if="trade.openPosition">{{ t('daily.open') }}<i
                                                                            class="ps-1 uil uil-info-circle"
                                                                            data-bs-toggle="tooltip" data-bs-html="true"
                                                                            v-bind:data-bs-title="t('daily.swingOpenedOn', { date: useDateCalFormat(trade.entryTime) })"></i></span><span
                                                                        v-else>{{ t('daily.closed') }}<i class="ps-1 uil uil-info-circle"
                                                                            data-bs-toggle="tooltip" data-bs-html="true"
                                                                            v-bind:data-bs-title="t('daily.swingClosedOn', { date: useDateCalFormat(trade.exitTime) })"></i></span></span><span
                                                                    v-else>{{ useTimeFormat(trade.entryTime) }}<span
                                                                        v-if="checkDate(trade.td, trade.entryTime) == false"><i
                                                                            class="ps-1 uil uil-info-circle"
                                                                            data-bs-toggle="tooltip" data-bs-html="true"
                                                                            v-bind:data-bs-title="t('daily.swingFrom', { date: useDateCalFormat(trade.entryTime) })"></i></span></span>
                                                            </td>

                                                            <!--P&L/Vol-->
                                                            <td>
                                                                <span v-if="trade.tradesCount == 0"></span><span
                                                                    v-else-if="trade.type == 'forex'">-</span><span
                                                                    v-else
                                                                    v-bind:class="[trade.grossSharePL > 0 ? 'greenTrade' : 'redTrade']">{{
                                                                        useTwoDecCurrencyFormat(trade.grossSharePL)
                                                                    }}</span>
                                                            </td>

                                                            <!--P&L-->
                                                            <td>
                                                                <span v-if="trade.tradesCount == 0"></span><span v-else
                                                                    v-bind:class="[trade.netProceeds > 0 ? 'greenTrade' : 'redTrade']">
                                                                    {{ useTwoDecCurrencyFormat(trade.netProceeds)
                                                                    }}</span>
                                                            </td>

                                                            <!-- Satisfaction display removed -->

                                                            <td>
                                                                <span
                                                                    v-if="screenshotsInfos.findIndex(f => f.name == trade.id) != -1">
                                                                    <i class="uil uil-image-v"></i>
                                                                </span>
                                                            </td>

                                                        </tr>
                                                    </tbody>
                                                </table>
                                            </div>

                                            <!-- BLOTTER TAB -->
                                            <div class="tab-pane fade txt-small" v-bind:id="'blotterNav-' + index"
                                                role="tabpanel" aria-labelledby="nav-overview-tab">
                                                <table v-bind:id="'table' + index" class="table">
                                                    <thead>
                                                        <tr>
                                                            <th scope="col">Symbol</th>
                                                            <th scope="col">Vol</th>
                                                            <th scope="col">PnL(g)</th>
                                                            <th scope="col">Total Fees</th>
                                                            <th scope="col">PnL(n)</th>
                                                            <th scope="col">Wins</th>
                                                            <th scope="col">Losses</th>
                                                            <th scope="col">Trades</th>
                                                            <th scope="col">Executions</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        <tr v-for="blot in itemTrade.blotter">

                                                            <td>{{ blot.symbol }}</td>
                                                            <td>{{ useDecimalsArithmetic(blot.buyQuantity,
                                                                blot.sellQuantity) }}</td>
                                                            <td
                                                                v-bind:class="[blot.grossProceeds > 0 ? 'greenTrade' : 'redTrade']">
                                                                {{ useTwoDecCurrencyFormat(blot.grossProceeds) }}</td>
                                                            <td>{{ useTwoDecCurrencyFormat(blot.fees) }}</td>
                                                            <td
                                                                v-bind:class="[blot[amountCase + 'Proceeds'] > 0 ? 'greenTrade' : 'redTrade']">
                                                                {{ useTwoDecCurrencyFormat(blot.netProceeds) }}</td>
                                                            <td>{{ blot.grossWinsCount }}</td>
                                                            <td>{{ blot.grossLossCount }}</td>
                                                            <td>{{ blot.trades }}</td>
                                                            <td>{{ blot.executions }}</td>
                                                        </tr>
                                                    </tbody>
                                                </table>
                                            </div>

                                            <!-- Screenshots tab content removed -->


                                        </div>
                                    </div>
                                    <!-- end PART 2 -->

                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <!-- end card-->
            </div>

            <!-- Load more spinner -->
            <div v-if="spinnerLoadMore" class="d-flex justify-content-center mt-3">
                <div class="spinner-border text-blue" role="status"></div>
            </div>

        </div>
    </div>

    <!-- ============ TRADES MODAL ============ -->
    <div class="modal fade" id="tradesModal" data-bs-backdrop="static" data-bs-keyboard="false" tabindex="-1"
        aria-labelledby="exampleModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-xl">
            <div class="modal-content">
                <div v-if="modalDailyTradeOpen" style="position: relative;">
                    <!-- Close button top right -->
                    <button type="button" class="btn-close btn-close-white" style="position: absolute; top: 12px; right: 16px; z-index: 10;" aria-label="Close" @click="closeTradeModal"></button>

                    <!-- Candlestick Chart (Binance / Databento / Polygon) -->
                    <div v-show="!candlestickChartFailureMessage && (currentUser?.enableBinanceChart || apiIndex != -1)" id="candlestickChart"
                        class="candlestickClass">
                    </div>
                    <div class="container mt-2 text-center" v-show="candlestickChartFailureMessage">{{
                        candlestickChartFailureMessage }}</div>

                    <!-- *** Table *** -->
                    <div class="mt-3 table-responsive">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th scope="col">Symbol</th>
                                    <th scope="col">Vol</th>
                                    <th scope="col">Position</th>
                                    <th scope="col">{{ t('daily.entry') }}</th>
                                    <th scope="col">Price</th>
                                    <th scope="col">Ausstieg</th>
                                    <th scope="col">Price</th>
                                    <th scope="col">Dauer</th>
                                    <th scope="col">PnL/Vol</th>
                                    <th scope="col">PnL(n)</th>
                                </tr>
                            </thead>
                            <tbody>
                                <!-- the page loads faster than the video blob => check if blob, that is after slash, is not null, and then load -->
                                <tr>
                                    <td>{{ filteredTrades[itemTradeIndex].trades[tradeIndex].symbol }}</td>
                                    <td>{{ filteredTrades[itemTradeIndex].trades[tradeIndex].buyQuantity +
                                        filteredTrades[itemTradeIndex].trades[tradeIndex].sellQuantity }}
                                    </td>
                                    <td>{{ filteredTrades[itemTradeIndex].trades[tradeIndex].side == 'B' ? 'Long' :
                                        'Short'
                                        }}</td>

                                    <td>
                                        <span
                                            v-if="filteredTrades[itemTradeIndex].trades[tradeIndex].tradesCount == 0"><span
                                                v-if="filteredTrades[itemTradeIndex].trades[tradeIndex].openPosition">Offen<i
                                                    class="ps-1 uil uil-info-circle" data-bs-toggle="tooltip"
                                                    data-bs-html="true"
                                                    v-bind:data-bs-title="'Swing trade opened on ' + useDateCalFormat(filteredTrades[itemTradeIndex].trades[tradeIndex].entryTime)"></i></span><span
                                                v-else>Geschlossen<i class="ps-1 uil uil-info-circle"
                                                    data-bs-toggle="tooltip" data-bs-html="true"
                                                    v-bind:data-bs-title="'Swing trade closed on ' + useDateCalFormat(filteredTrades[itemTradeIndex].trades[tradeIndex].exitTime)"></i></span></span><span
                                            v-else>{{
                                                useTimeFormat(filteredTrades[itemTradeIndex].trades[tradeIndex].entryTime)
                                            }}<span
                                                v-if="checkDate(filteredTrades[itemTradeIndex].trades[tradeIndex].td, filteredTrades[itemTradeIndex].trades[tradeIndex].entryTime) == false"><i
                                                    class="ps-1 uil uil-info-circle" data-bs-toggle="tooltip"
                                                    data-bs-html="true"
                                                    v-bind:data-bs-title="'Swing trade from ' + useDateCalFormat(filteredTrades[itemTradeIndex].trades[tradeIndex].entryTime)"></i></span></span>
                                    </td>

                                    <!--Entry Price-->
                                    <td><span
                                            v-if="filteredTrades[itemTradeIndex].trades[tradeIndex].tradesCount == 0"></span><span
                                            v-else-if="filteredTrades[itemTradeIndex].trades[tradeIndex].type == 'forex'">{{
                                                (filteredTrades[itemTradeIndex].trades[tradeIndex].entryPrice).toFixed(5)
                                            }}</span><span v-else>{{
                                                useTwoDecCurrencyFormat(filteredTrades[itemTradeIndex].trades[tradeIndex].entryPrice)
                                            }}<span
                                                v-if="checkDate(filteredTrades[itemTradeIndex].trades[tradeIndex].td, filteredTrades[itemTradeIndex].trades[tradeIndex].entryTime) == false"><i
                                                    class="ps-1 uil uil-info-circle" data-bs-toggle="tooltip"
                                                    data-bs-html="true"
                                                    v-bind:data-bs-title="'Swing trade from ' + useDateCalFormat(filteredTrades[itemTradeIndex].trades[tradeIndex].entryTime)"></i></span></span>
                                    </td>

                                    <!--Exit-->
                                    <td><span
                                            v-if="filteredTrades[itemTradeIndex].trades[tradeIndex].tradesCount == 0"></span><span
                                            v-else>{{
                                                useTimeFormat(filteredTrades[itemTradeIndex].trades[tradeIndex].exitTime)
                                            }}</span></td>


                                    <!--Exit Price-->
                                    <td><span
                                            v-if="filteredTrades[itemTradeIndex].trades[tradeIndex].tradesCount == 0"></span><span
                                            v-else-if="filteredTrades[itemTradeIndex].trades[tradeIndex].type == 'forex'">{{
                                                (filteredTrades[itemTradeIndex].trades[tradeIndex].exitPrice).toFixed(5)
                                            }}</span><span v-else>{{
                                                useTwoDecCurrencyFormat(filteredTrades[itemTradeIndex].trades[tradeIndex].exitPrice)
                                            }}</span></td>

                                    <!--Duration-->
                                    <td><span
                                            v-if="filteredTrades[itemTradeIndex].trades[tradeIndex].tradesCount == 0"></span><span
                                            v-else><span
                                                v-if="checkDate(filteredTrades[itemTradeIndex].trades[tradeIndex].td, filteredTrades[itemTradeIndex].trades[tradeIndex].entryTime) == false">{{
                                                    useSwingDuration(filteredTrades[itemTradeIndex].trades[tradeIndex].exitTime
                                                        -
                                                        filteredTrades[itemTradeIndex].trades[tradeIndex].entryTime)
                                                }}</span><span v-else>{{
                                                    useTimeDuration(filteredTrades[itemTradeIndex].trades[tradeIndex].exitTime
                                                        -
                                                        filteredTrades[itemTradeIndex].trades[tradeIndex].entryTime)
                                                }}</span></span>
                                    </td>

                                    <!--P&L/Vol-->
                                    <td>
                                        <span
                                            v-if="filteredTrades[itemTradeIndex].trades[tradeIndex].tradesCount == 0"></span><span
                                            v-else-if="filteredTrades[itemTradeIndex].trades[tradeIndex].type == 'forex'"></span><span
                                            v-else
                                            v-bind:class="[(filteredTrades[itemTradeIndex].trades[tradeIndex].grossSharePL) > 0 ? 'greenTrade' : 'redTrade']">{{
                                                useTwoDecCurrencyFormat(filteredTrades[itemTradeIndex].trades[tradeIndex].grossSharePL)
                                            }}</span>
                                    </td>

                                    <!--P&L-->
                                    <td><span
                                            v-if="filteredTrades[itemTradeIndex].trades[tradeIndex].tradesCount == 0"></span><span
                                            v-else
                                            v-bind:class="[filteredTrades[itemTradeIndex].trades[tradeIndex].netProceeds > 0 ? 'greenTrade' : 'redTrade']">
                                            {{
                                                useTwoDecCurrencyFormat(filteredTrades[itemTradeIndex].trades[tradeIndex].netProceeds)
                                            }}</span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- *** TRADING METADATA *** -->
                    <div v-if="tradingMeta && hasTradingMetadata(tradingMeta)" class="mx-2 mt-2 mb-1 trading-meta-daily p-3">
                        <div class="d-flex align-items-center mb-2">
                            <i class="uil uil-layers me-2" style="color: var(--grey-color, #6b7280); font-size: 1rem;"></i>
                            <span class="fw-bold small">{{ t('incoming.fills') }}</span>
                            <span v-if="getEntryFillsFromMeta(tradingMeta.fills, filteredTrades[itemTradeIndex]?.trades[tradeIndex]?.side).length > 1"
                                class="text-muted small ms-2">
                                ({{ getEntryFillsFromMeta(tradingMeta.fills, filteredTrades[itemTradeIndex]?.trades[tradeIndex]?.side).length }} {{ t('incoming.fillEntries') }})
                            </span>
                            <span v-if="getEntryFillsFromMeta(tradingMeta.fills, filteredTrades[itemTradeIndex]?.trades[tradeIndex]?.side).length > 0"
                                class="ms-auto fw-bold" style="font-size: 0.85rem;">
                                {{ t('incoming.fillAvgPrice') }}: {{ getAvgEntryPriceFromMeta(tradingMeta.fills, filteredTrades[itemTradeIndex]?.trades[tradeIndex]?.side).toFixed(5) }}
                            </span>
                        </div>

                        <!-- Fills Table -->
                        <div v-if="tradingMeta.fills && tradingMeta.fills.length > 0">
                            <table class="table table-sm table-borderless mb-1" style="font-size: 0.8rem; color: var(--white-80);">
                                <tbody>
                                    <template v-for="(group, gIdx) in groupFillsByMinute(tradingMeta.fills)" :key="group.key">
                                        <!-- Gruppierte Zeile -->
                                        <tr :class="group.reduceOnly ? 'text-danger' : ''"
                                            :style="group.isGroup ? 'cursor: pointer;' : ''"
                                            @click="group.isGroup && toggleFillGroup(group.key)">
                                            <td class="text-muted ps-0" style="width: 100px;">
                                                <span v-if="group.isGroup" style="font-size: 0.6rem; margin-right: 2px;">{{ expandedFillGroups.has(group.key) ? '▼' : '▶' }}</span>
                                                {{ formatMetaFillTime(group.time) }}
                                            </td>
                                            <td style="width: 80px;" class="text-end">{{ group.totalQty }}</td>
                                            <td class="text-muted px-1">&times;</td>
                                            <td style="width: 90px;">{{ group.isGroup ? group.avgPrice.toFixed(5) : parseFloat(group.fills[0].price) }}</td>
                                            <td class="text-muted px-1">=</td>
                                            <td class="text-end" style="width: 90px;">{{ group.totalValue.toFixed(2) }}</td>
                                            <td>
                                                <span v-if="getFillBadgeType(group.fills[0], group.firstFillIdx, tradingMeta.fills) === 'close'"
                                                    class="badge bg-danger" style="font-size: 0.65rem;">{{ t('incoming.fillClose') }}</span>
                                                <span v-else-if="getFillBadgeType(group.fills[0], group.firstFillIdx, tradingMeta.fills) === 'partialClose'"
                                                    class="badge bg-warning text-dark" style="font-size: 0.65rem;">{{ t('incoming.fillPartialClose') }}</span>
                                                <span v-else-if="getFillBadgeType(group.fills[0], group.firstFillIdx, tradingMeta.fills) === 'initial'"
                                                    class="badge bg-secondary" style="font-size: 0.65rem;">{{ t('incoming.fillInitial') }}</span>
                                                <span v-else
                                                    class="badge bg-info" style="font-size: 0.65rem;">{{ t('incoming.fillCompound') }}</span>
                                                <span v-if="group.isGroup" class="text-muted ms-1" style="font-size: 0.6rem;">({{ group.fills.length }})</span>
                                            </td>
                                            <td class="text-end text-muted pe-0" style="width: 90px;">{{ t('incoming.fillFee') }}: {{ group.totalFee.toFixed(4) }}</td>
                                        </tr>
                                        <!-- Aufgeklappte Einzel-Fills -->
                                        <template v-if="group.isGroup && expandedFillGroups.has(group.key)">
                                            <tr v-for="(fill, fIdx) in group.fills" :key="group.key + '_' + fIdx"
                                                :class="fill.reduceOnly ? 'text-danger' : ''" style="opacity: 0.6; font-size: 0.7rem;">
                                                <td class="ps-0" style="width: 100px; padding-left: 1rem !important;"></td>
                                                <td style="width: 80px;" class="text-end">{{ parseFloat(fill.qty) }}</td>
                                                <td class="text-muted px-1">&times;</td>
                                                <td style="width: 90px;">{{ parseFloat(fill.price) }}</td>
                                                <td class="text-muted px-1">=</td>
                                                <td class="text-end" style="width: 90px;">{{ (parseFloat(fill.qty) * parseFloat(fill.price)).toFixed(2) }}</td>
                                                <td></td>
                                                <td class="text-end text-muted pe-0" style="width: 90px;">{{ t('incoming.fillFee') }}: {{ parseFloat(fill.fee || 0).toFixed(4) }}</td>
                                            </tr>
                                        </template>
                                    </template>
                                </tbody>
                            </table>

                            <!-- Totals row -->
                            <div v-if="getEntryFillsFromMeta(tradingMeta.fills, filteredTrades[itemTradeIndex]?.trades[tradeIndex]?.side).length > 1"
                                class="d-flex justify-content-between border-top pt-1 mt-1"
                                style="font-size: 0.8rem; border-color: var(--white-20) !important;">
                                <span class="text-muted">
                                    {{ t('incoming.fillTotal') }}:
                                    <strong class="text-white">{{ getEntryFillsFromMeta(tradingMeta.fills, filteredTrades[itemTradeIndex]?.trades[tradeIndex]?.side).reduce((sum, f) => sum + parseFloat(f.qty || 0), 0) }}</strong>
                                </span>
                                <span class="text-muted">
                                    {{ t('incoming.fillFee') }}:
                                    <strong class="text-white">{{ tradingMeta.fills.reduce((sum, f) => sum + parseFloat(f.fee || 0), 0).toFixed(4) }}</strong>
                                </span>
                            </div>

                            <!-- Position Size row -->
                            <div v-if="tradingMeta.positionSize"
                                class="d-flex justify-content-between border-top pt-1 mt-1"
                                style="font-size: 0.8rem; border-color: var(--white-20) !important;">
                                <span class="text-muted">
                                    {{ t('incoming.positionSize') }}:
                                    <span class="text-white">{{ parseFloat(tradingMeta.margin || 0).toFixed(2) }}</span>
                                    <span class="text-muted"> &times; </span>
                                    <span class="text-white">{{ tradingMeta.leverage }}x</span>
                                    <span class="text-muted"> = </span>
                                    <strong class="text-white">{{ parseFloat(tradingMeta.positionSize).toFixed(2) }} USDT</strong>
                                </span>
                            </div>
                        </div>

                        <!-- SL / BE / TP Row -->
                        <div v-if="tradingMeta.sl || tradingMeta.tp || tradingMeta.breakeven"
                            class="d-flex gap-3 mt-2 pt-2 border-top"
                            style="font-size: 0.8rem; border-color: var(--white-20) !important;">
                            <span v-if="tradingMeta.sl">
                                <span class="fw-bold"
                                    :class="!tradingMeta.slAboveBreakeven ? 'text-danger' : ''"
                                    :style="tradingMeta.slAboveBreakeven ? 'color: #86efac' : ''">
                                    SL: {{ tradingMeta.sl }}
                                </span>
                                <span v-if="tradingMeta.slQty" class="text-muted ms-1">({{ tradingMeta.slQty }})</span>
                            </span>
                            <span v-if="tradingMeta.breakeven">
                                <span class="text-muted fw-bold">BE: {{ parseFloat(tradingMeta.breakeven).toFixed(2) }}</span>
                            </span>
                            <span v-if="tradingMeta.tp">
                                <span class="fw-bold" style="color: #f59e0b;">TP: {{ tradingMeta.tp }}</span>
                                <span v-if="tradingMeta.tpQty" class="text-muted ms-1">({{ tradingMeta.tpQty }})</span>
                            </span>
                            <span v-if="tradingMeta.rrr" class="ms-auto">
                                <span class="fw-bold" style="color: #a78bfa;">RRR 1:{{ tradingMeta.rrr }}</span>
                            </span>
                        </div>

                        <!-- SL/TP Protocol History -->
                        <div v-if="getFilteredTpslHistory(tradingMeta).length > 0"
                            class="mt-2 pt-2 border-top"
                            style="font-size: 0.75rem; border-color: var(--white-20) !important;">
                            <div class="text-muted mb-1 pointerClass" @click.stop="toggleTpSlHistory('daily')">
                                <i class="uil uil-history me-1"></i>SL/TP Protokoll
                                <i :class="tpslCollapsedIds.includes('daily') ? 'uil-angle-down' : 'uil-angle-up'" class="uil ms-1" style="font-size: 1.3rem; vertical-align: middle;"></i>
                            </div>
                            <template v-if="!tpslCollapsedIds.includes('daily')">
                                <div v-for="(histEntry, idx) in getFilteredTpslHistory(tradingMeta)" :key="'hist-'+idx"
                                    class="d-flex align-items-center gap-2 mb-1">
                                    <span class="text-muted" style="width: 90px;">{{ dayjs(histEntry.time).tz(timeZoneTrade.value).format('DD.MM. HH:mm') }}</span>
                                    <span :class="histEntry.type === 'SL' ? (tradingMeta.slAboveBreakeven ? '' : 'text-danger') : (histEntry.action === 'triggered' ? 'text-success fw-bold' : '')"
                                        :style="histEntry.type === 'SL' && tradingMeta.slAboveBreakeven ? 'color: #86efac' : (histEntry.type === 'TP' && histEntry.action !== 'triggered' ? 'color: #f59e0b' : '')">
                                        {{ histEntry.type }}
                                    </span>
                                    <template v-if="histEntry.action === 'set'">
                                        <span class="text-muted">&rarr;</span>
                                        <span class="text-white">{{ histEntry.newVal }}</span>
                                        <span class="badge bg-secondary" style="font-size: 0.6rem;">Gesetzt</span>
                                    </template>
                                    <template v-else-if="histEntry.action === 'moved'">
                                        <span class="text-muted" style="text-decoration: line-through;">{{ histEntry.oldVal }}</span>
                                        <span class="text-muted">&rarr;</span>
                                        <span class="text-white">{{ histEntry.newVal }}</span>
                                        <span class="badge bg-warning text-dark" style="font-size: 0.6rem;">Verschoben</span>
                                    </template>
                                    <template v-else-if="histEntry.action === 'triggered'">
                                        <span class="text-success" style="text-decoration: line-through;">{{ histEntry.oldVal }}</span>
                                        <span class="text-success">&rarr;</span>
                                        <span class="text-success fw-bold">Ausgelöst &#x2713;</span>
                                    </template>
                                    <template v-else-if="histEntry.action === 'removed'">
                                        <span class="text-muted" style="text-decoration: line-through;">{{ histEntry.oldVal }}</span>
                                        <span class="text-muted">&rarr; entfernt</span>
                                    </template>
                                </div>
                            </template>
                        </div>
                    </div>

                    <!-- *** VARIABLES *** -->
                    <div class="mt-1 mb-2 row align-items-center ms-1 me-1 tradeSetup">
                        <div class="col-12">
                            <div class="row">
                                <!-- First line -->
                                <div class="col-12" v-show="!spinnerSetups">
                                    <div class="row align-items-center">

                                        <!-- Satisfaction removed - managed in Incoming/Playbook -->


                                        <!-- Tags (read-only) -->
                                        <div class="col-8">
                                            <label class="form-label txt-small mb-1" style="color: var(--white-60);">Tags</label>
                                            <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px; min-height: 30px;">
                                                <span v-for="(tag, index) in tradeTags" :key="index"
                                                    class="tag txt-small"
                                                    :style="{ 'background-color': useGetTagInfo(tag.id).groupColor }">
                                                    {{ tag.name }}
                                                </span>
                                                <span v-if="!tradeTags.length" class="txt-small" style="color: var(--white-40);">–</span>
                                            </div>
                                        </div>
                                        <!-- MFE -->
                                        <div class="col-3">
                                            <label class="form-label txt-small mb-1" style="color: var(--white-60);">
                                                {{ t('daily.mfePrice') }}
                                                <i class="uil uil-info-circle pointerClass" style="font-size: 0.85rem;"
                                                    data-bs-toggle="tooltip" data-bs-placement="top"
                                                    :title="t('daily.mfeTooltip')"></i>
                                            </label>
                                            <input type="number" class="form-control form-control-sm" placeholder="MFE"
                                                        style="font-size: small;" v-bind:value="excursion.mfePrice"
                                                        v-on:click="tradeExcursionClicked"
                                                        v-on:change="tradeExcursionChange($event.target.value, 'mfePrice')">
                                        </div>
                                        <!-- Delete
                                        <div class="col-1">
                                            <i v-on:click="useDeleteSetup(filteredTrades[itemTradeIndex].dateUnix, filteredTrades[itemTradeIndex].trades[tradeIndex])"
                                                class="ps-2 uil uil-trash-alt pointerClass"></i>
                                        </div> -->
                                    </div>
                                </div>

                                <!-- Second line -->
                                <div class="col-12 mt-2" v-show="!spinnerSetups && tradeNote">
                                    <label class="form-label txt-small mb-1" style="color: var(--white-60);">{{ t('daily.note') }}</label>
                                    <div class="trade-note-readonly">{{ tradeNote }}</div>
                                </div>

                                <!-- KI Trade-Bewertung -->
                                <div class="col-12 mt-2" v-show="!spinnerSetups && currentUser?.aiEnabled !== false && currentUser?.aiEnabled !== 0">
                                    <div class="ai-trade-review-section">
                                        <div class="d-flex align-items-center gap-2">
                                            <button class="ai-review-btn share-card-btn"
                                                @click="openShareCard">
                                                <i class="uil uil-image-share me-1"></i>
                                                {{ t('daily.shareCard') }}
                                            </button>
                                            <button class="ai-review-btn"
                                                :disabled="aiTradeReviewLoading"
                                                @click="requestTradeReview">
                                                <span v-if="aiTradeReviewLoading" class="spinner-border spinner-border-sm me-1" style="width: 0.7rem; height: 0.7rem;"></span>
                                                <i v-else class="uil uil-robot me-1"></i>
                                                {{ aiTradeReviewLoading ? t('daily.aiAnalyzing') : (aiTradeReview ? t('daily.aiReReview') : t('daily.aiReview')) }}
                                            </button>
                                            <button v-if="aiTradeReview && !aiTradeReviewLoading"
                                                class="ai-review-toggle"
                                                @click="aiTradeReviewOpen = !aiTradeReviewOpen">
                                                <i class="uil" :class="aiTradeReviewOpen ? 'uil-angle-up' : 'uil-angle-down'"></i>
                                            </button>
                                        </div>
                                        <span v-if="aiTradeReviewTokens && !aiTradeReviewLoading" class="text-muted ms-2" style="font-size: 0.7rem;">
                                            <i class="uil uil-processor"></i> {{ (aiTradeReviewTokens.totalTokens || 0).toLocaleString() }} Tokens
                                        </span>
                                        <span v-if="aiTradeReviewError" class="ai-review-error">{{ aiTradeReviewError }}</span>
                                        <div v-if="aiTradeReview && aiTradeReviewOpen" class="ai-review-result mt-2">
                                            <div class="ai-review-content" v-html="markdownToHtml(aiTradeReview)"></div>
                                        </div>

                                        <!-- Chat / Rückfragen (außerhalb ai-review-result für besseren Kontrast) -->
                                        <div v-if="aiTradeReview && aiTradeReviewOpen" class="trade-chat-section mt-3 pt-3" style="border-top: 1px solid var(--border-color, #333);">
                                            <div class="d-flex justify-content-between align-items-center mb-2">
                                                <span class="small fw-bold"><i class="uil uil-comment-dots me-1"></i>{{ t('daily.chatFollowUp') }}</span>
                                                <button v-if="tradeReviewChat[currentTradeId()]?.length > 0"
                                                    class="btn btn-sm btn-outline-secondary"
                                                    @click="clearTradeReviewChat()"
                                                    :title="t('daily.chatClear')">
                                                    <i class="uil uil-trash-alt me-1"></i>{{ t('daily.chatClear') }}
                                                </button>
                                            </div>

                                            <!-- Chat-Verlauf -->
                                            <div v-if="tradeReviewChat[currentTradeId()]?.length > 0" class="chat-messages mb-2">
                                                <div v-for="msg in tradeReviewChat[currentTradeId()]" :key="msg.id"
                                                    class="chat-msg mb-2" :class="'chat-msg-' + msg.role">
                                                    <div class="d-flex align-items-center gap-1 mb-1">
                                                        <i class="uil" :class="msg.role === 'user' ? 'uil-user' : 'uil-robot'"></i>
                                                        <span class="small fw-bold">{{ msg.role === 'user' ? 'Du' : 'KI' }}</span>
                                                        <span class="text-muted small ms-1">{{ dayjs(msg.createdAt).format('DD.MM. HH:mm') }}</span>
                                                        <span v-if="msg.role === 'assistant' && msg.totalTokens > 0" class="text-muted small ms-auto">{{ msg.totalTokens }} Tokens</span>
                                                    </div>
                                                    <div v-if="msg.role === 'user'" class="chat-bubble chat-bubble-user">{{ msg.content }}</div>
                                                    <div v-else class="chat-bubble chat-bubble-ai ai-review-content" v-html="markdownToHtml(msg.content)"></div>
                                                </div>
                                            </div>

                                            <!-- Loading -->
                                            <div v-if="tradeReviewChatLoading[currentTradeId()]" class="text-center py-3">
                                                <span class="spinner-border spinner-border-sm me-1"></span>
                                                <span class="text-muted small">{{ t('daily.chatThinking') }}</span>
                                            </div>

                                            <!-- Error -->
                                            <div v-if="tradeReviewChatError[currentTradeId()]" class="alert alert-danger py-1 px-2 small mb-2">
                                                {{ tradeReviewChatError[currentTradeId()] }}
                                            </div>

                                            <!-- Input -->
                                            <div class="d-flex gap-2 align-items-end">
                                                <textarea class="form-control form-control-sm chat-input" rows="2"
                                                    :placeholder="t('daily.chatPlaceholder')"
                                                    v-model="tradeReviewChatInput[currentTradeId()]"
                                                    @keydown.enter.exact.prevent="sendTradeReviewChat()"
                                                    :disabled="tradeReviewChatLoading[currentTradeId()]"></textarea>
                                                <button class="btn btn-sm btn-primary" style="height: 2.4rem;"
                                                    @click="sendTradeReviewChat()"
                                                    :disabled="tradeReviewChatLoading[currentTradeId()] || !(tradeReviewChatInput[currentTradeId()] || '').trim()">
                                                    <i class="uil uil-message"></i>
                                                </button>
                                            </div>
                                            <small class="text-muted mt-1">Enter = {{ t('daily.chatFollowUp') }}</small>
                                        </div>
                                    </div>
                                </div>

                                <!-- Navigation + Screenshot Thumbnail -->
                                <div class="col-12 mt-3" v-show="!spinnerSetups">
                                    <div class="row align-items-end">
                                        <div class="col-4 text-start">
                                            <button
                                                v-show="filteredTrades[itemTradeIndex].trades.hasOwnProperty(tradeIndex - 1)"
                                                class="btn btn-outline-primary btn-sm ms-3 mb-2"
                                                v-on:click="clickTradesModal(itemTradeIndex, tradeIndex, tradeIndex - 1)"
                                                v-bind:disabled="spinnerSetups == true">
                                                <i class="fa fa-chevron-left me-2"></i></button>
                                        </div>
                                        <div class="col-4 text-center">
                                            <button v-if="saveButton" class="btn btn-outline-success btn-sm"
                                                v-on:click="clickTradesModal()">{{ t('daily.closeAndSave') }}</button>
                                            <button v-else class="btn btn-outline-primary btn-sm"
                                                v-on:click="clickTradesModal()">{{ t('daily.closeModal') }}</button>
                                        </div>
                                        <div class="col-4 text-end d-flex justify-content-end align-items-end gap-2">
                                            <!-- Screenshot Thumbnail -->
                                            <img v-if="screenshot.annotatedBase64 || screenshot.originalBase64"
                                                :src="screenshot.annotatedBase64 || screenshot.originalBase64"
                                                class="screenshot-thumb pointerClass"
                                                data-bs-toggle="modal" data-bs-target="#fullScreenModal"
                                                @click="useSelectedScreenshotFunction(-1, 'dailyModal', screenshot)"
                                                title="Screenshot vergrößern" />
                                            <button
                                                v-show="filteredTrades[itemTradeIndex].trades.hasOwnProperty(tradeIndex + 1)"
                                                class="btn btn-outline-primary btn-sm me-3 mb-2"
                                                v-on:click="clickTradesModal(itemTradeIndex, tradeIndex, tradeIndex + 1)"
                                                v-bind:disabled="spinnerSetups == true">
                                                <i class="fa fa-chevron-right ms-2"></i></button>
                                        </div>
                                    </div>
                                </div>

                                <!-- Spinner -->
                                <div v-show="spinnerSetups" class="col-12">
                                    <div class="d-flex justify-content-center">
                                        <div class="spinner-border spinner-border-sm text-blue" role="status"></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <hr>
                </div>
            </div>
        </div>
    </div>

    <!-- ============ TAGS MODAL ============ -->
    <div class="modal fade" id="tagsModal" data-bs-backdrop="static" data-bs-keyboard="false" tabindex="-1"
        aria-labelledby="exampleModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-xl">
            <div class="modal-content" v-if="tagsModalOpen">
                <!-- Tags -->
                <div class="container col mt-4">
                    <div class="form-control dropdown form-select" style="height: auto;">
                        <div style="display: flex; align-items: center; flex-wrap: wrap;">
                            <span v-for="(tag, index) in tradeTags" :key="index" class="tag txt-small"
                                :style="{ 'background-color': useGetTagInfo(tag.id).groupColor }"
                                @click="useTradeTagsChange('remove', index)">
                                {{ tag.name }}<span class="remove-tag">×</span>
                            </span>

                            <input type="text" v-model="tagInput" @input="onTagsModalInput"
                                @keydown.enter.prevent="useTradeTagsChange('add', tagInput)"
                                @keydown.tab.prevent="useTradeTagsChange('add', tagInput)"
                                class="form-control tag-input" :placeholder="t('daily.addTag')">
                            <div class="clickable-area" v-on:click="toggleTagsModalDropdown">
                            </div>
                        </div>
                    </div>

                    <ul class="dropdown-menu-tags" v-show="showTagsList === 'tagsModal'">
                        <span v-for="group in availableTags">
                            <h6 class="p-1 mb-0" :style="'background-color: ' + group.color + ';'"
                                v-show="useFilterSuggestions(group.id).filter(obj => obj.id == group.id)[0].tags.length > 0">
                                {{ group.name }}</h6>
                            <li v-for="(suggestion, index) in useFilterSuggestions(group.id).filter(obj => obj.id == group.id)[0].tags"
                                :key="index" :class="{ active: index === selectedTagIndex }"
                                @click="useTradeTagsChange('addFromDropdownMenu', suggestion)"
                                class="dropdown-item dropdown-item-tags">
                                <span class="ms-2">{{ suggestion.name }}</span>
                            </li>
                        </span>
                    </ul>
                </div>
                <div class="col text-center mt-4 mb-4">
                    <button class="btn btn-outline-primary btn-sm" v-on:click="closeTagsModal">Schließen</button>
                    <button class="btn btn-outline-success btn-sm ms-4" v-on:click="saveDailyTags()">Save</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Share Card Modal (Teleport to body to escape Bootstrap focus trap) -->
    <Teleport to="body">
        <ShareCardModal :trade="shareCardTrade" :visible="shareCardOpen" @close="shareCardOpen = false" />
    </Teleport>

</template>

<style scoped>
/* KI Quick-Button in Trade-Zeile */
.ai-quick-btn {
    display: inline-flex;
    align-items: center;
    font-size: 0.78rem;
    padding: 0.25rem 0.6rem;
    border: 1px solid var(--white-38, rgba(255,255,255,0.38));
    border-radius: 6px;
    color: var(--white-60, rgba(255,255,255,0.6));
    background: transparent;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
}

.ai-quick-btn:hover {
    border-color: #7c5cfc;
    color: #7c5cfc;
}

.share-quick-btn {
    padding: 0.25rem 0.45rem;
    border-color: rgba(99, 102, 241, 0.4);
    color: rgba(99, 102, 241, 0.7);
}
.share-quick-btn:hover {
    border-color: #6366f1;
    color: #6366f1;
}

/* KI Trade-Bewertung */
.ai-trade-review-section {
    border-top: 1px solid var(--white-18, rgba(255,255,255,0.12));
    padding-top: 0.5rem;
}

.ai-review-btn {
    display: inline-flex;
    align-items: center;
    font-size: 0.78rem;
    padding: 0.25rem 0.6rem;
    border: 1px solid var(--white-38, rgba(255,255,255,0.38));
    border-radius: 6px;
    color: var(--white-60, rgba(255,255,255,0.6));
    background: transparent;
    cursor: pointer;
    transition: all 0.15s;
}

.ai-review-btn:hover:not(:disabled) {
    border-color: #7c5cfc;
    color: #7c5cfc;
}

.ai-review-btn:disabled {
    opacity: 0.6;
    cursor: wait;
}

.ai-review-toggle {
    display: inline-flex;
    align-items: center;
    font-size: 1rem;
    padding: 0.1rem 0.3rem;
    border: 1px solid var(--white-18, rgba(255,255,255,0.12));
    border-radius: 4px;
    color: var(--white-60, rgba(255,255,255,0.6));
    background: transparent;
    cursor: pointer;
    transition: all 0.15s;
}

.ai-review-toggle:hover {
    border-color: var(--white-38, rgba(255,255,255,0.38));
    color: var(--white-87, rgba(255,255,255,0.87));
}

.ai-review-error {
    display: block;
    font-size: 0.72rem;
    color: #f87171;
    margin-top: 0.25rem;
}

.ai-review-result {
    background: var(--black-bg-2, #1a1a1a);
    border: 1px solid var(--white-18, rgba(255,255,255,0.12));
    border-radius: 6px;
    padding: 0.6rem 0.75rem;
}

.ai-review-content :deep(h5),
.ai-review-content :deep(h6) {
    font-size: 0.82rem;
    color: var(--blue-color, #6cb4ee);
    margin-top: 0.4rem;
    margin-bottom: 0.2rem;
}

.ai-review-content :deep(p) {
    font-size: 0.8rem;
    line-height: 1.45;
    color: var(--white-87, rgba(255,255,255,0.87));
    margin-bottom: 0.3rem;
}

.ai-review-content :deep(ul) {
    padding-left: 1rem;
    margin-bottom: 0.3rem;
}

.ai-review-content :deep(li) {
    font-size: 0.8rem;
    color: var(--white-87, rgba(255,255,255,0.87));
    margin-bottom: 0.1rem;
}

.ai-review-content :deep(strong) {
    color: var(--white-100, #fff);
}

.trading-meta-daily {
    background: var(--black-bg-5);
    border: none;
    border-radius: var(--border-radius, 6px);
}
.trading-meta-daily .table {
    margin-bottom: 0;
}
.trading-meta-daily .table td {
    padding: 0.15rem 0.3rem;
    vertical-align: middle;
    border: none;
}

.trade-note-readonly {
    font-size: 0.85rem;
    color: var(--white-87, rgba(255,255,255,0.87));
    background: var(--black-bg-5, #0d0d0d);
    border-radius: var(--border-radius, 6px);
    padding: 0.4rem 0.6rem;
    white-space: pre-wrap;
    word-break: break-word;
}

.screenshot-thumb {
    width: 120px;
    height: 80px;
    object-fit: cover;
    border-radius: 4px;
    border: 1px solid rgba(255,255,255,0.1);
    margin-bottom: 0.5rem;
    transition: opacity 0.15s;
}
.screenshot-thumb:hover {
    opacity: 0.8;
    border-color: rgba(255,255,255,0.3);
}
</style>