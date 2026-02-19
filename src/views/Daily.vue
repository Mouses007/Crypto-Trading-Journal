<script setup>
import { onBeforeMount, onMounted, computed, reactive, ref, watch, nextTick } from 'vue';
import Filters from '../components/Filters.vue'
import NoData from '../components/NoData.vue';
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue';
import Screenshot from '../components/Screenshot.vue'
import { spinnerLoadingPage, modalDailyTradeOpen, markerAreaOpen, spinnerSetups, spinnerSetupsText, hasData, saveButton, spinnerLoadMore, endOfList, timeZoneTrade, idCurrentType, idCurrentNumber, tabGettingScreenshots, scrollToDateUnix } from '../stores/ui.js';
import { amountCase, selectedGrossNet, selectedTagIndex, filteredSuggestions } from '../stores/filters.js';
import { calendarData, filteredTrades, screenshots, screenshot, tradeScreenshotChanged, excursion, tradeExcursionChanged, tradeExcursionId, tradeExcursionDateUnix, tradeId, excursions, itemTradeIndex, tradeIndex, tradeIndexPrevious, availableTags, tradeTagsChanged, tagInput, tags, tradeTags, showTagsList, tradeTagsId, tradeTagsDateUnix, newTradeTags, notes, tradeNote, tradeNoteChanged, tradeNoteDateUnix, tradeNoteId, availableTagsArray, screenshotsInfos, satisfactionTradeArray, satisfactionArray } from '../stores/trades.js';
import { currentUser, apis } from '../stores/settings.js';

import { useCreatedDateFormat, useTwoDecCurrencyFormat, useTimeFormat, useTimeDuration, useDecimalsArithmetic, useDateCalFormat, useSwingDuration, useStartOfDay } from '../utils/formatters.js';
import { useMountDaily, useGetSelectedRange, useLoadMore, useCheckVisibleScreen } from '../utils/mountOrchestration.js';
import { useInitTooltip, useInitTab } from '../utils/utils';

import { useSetupImageUpload, useSaveScreenshot, useGetScreenshots, useSelectedScreenshotFunction } from '../utils/screenshots';

import { useGetExcursions, useGetTags, useGetAvailableTags, useUpdateAvailableTags, useUpdateTags, useFindHighestIdNumber, useFindHighestIdNumberTradeTags, useUpdateNote, useGetNotes, useGetTagInfo, useCreateAvailableTagsArray, useFilterSuggestions, useTradeTagsChange, useFilterTags, useToggleTagsDropdown, useResetTags, useDailySatisfactionChange } from '../utils/daily';

import { useCandlestickChart } from '../utils/charts';

import { useGetMFEPrices } from '../utils/addTrades';

/* MODULES */
import { dbFirst, dbCreate, dbUpdate } from '../utils/db.js'
import dayjs from '../utils/dayjs-setup.js'
import axios from 'axios'
import { useCreateOHLCV } from '../utils/addTrades';


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

const stripHtml = (html) => {
    if (!html) return ''
    return html.replace(/<[^>]*>/g, '').trim()
}

let tradeSatisfactionId
let tradeSatisfaction
let tradeSatisfactionDateUnix


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
                            await getOHLC(filteredTradesObject.td, filteredTradesObject.symbol, filteredTradesObject.type, chartInterval)
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
                            await useCandlestickChart(ohlcTimestamps, ohlcPrices, ohlcVolumes, filteredTradesObject, initCandleChart)
                            initCandleChart = false
                        }
                    } catch (error) {
                        if (error.response && error.response.status === 429) {
                            candlestickChartFailureMessage.value = "Zu viele Anfragen, versuche es später erneut"
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
                if (noteIndex != -1) {
                    tradeNote.value = stripHtml(notes[noteIndex].note)
                }

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

function getOHLC(date, symbol, type, interval) {
    if (apiSource.value === "binance") {
        // Binance-kompatibles Interval bestimmen
        const binanceInterval = binanceIntervalMap[interval] || '15m'
        console.log(" -> getting OHLC from Binance for " + symbol + " (" + binanceInterval + ") on " + useDateCalFormat(date))

        return new Promise(async (resolve, reject) => {
            try {
                // Zeitraum: ganzer Tag der Trade-Eröffnung
                const startTime = dayjs(date * 1000).tz(timeZoneTrade.value).startOf('day').valueOf()
                const endTime = dayjs(date * 1000).tz(timeZoneTrade.value).endOf('day').valueOf()

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
                                                <i v-on:click="useDailySatisfactionChange(itemTrade.dateUnix, true, itemTrade)"
                                                    v-bind:class="[itemTrade.satisfaction == true ? 'greenTrade' : '', 'uil', 'uil-thumbs-up', 'ms-2', 'me-1', 'pointerClass']"></i>
                                                <i v-on:click="useDailySatisfactionChange(itemTrade.dateUnix, 'neutral', itemTrade)"
                                                    v-bind:class="[itemTrade.satisfaction == 'neutral' ? 'neutralTrade' : '', 'uil', 'uil-thumbs-up', 'me-1', 'pointerClass']"
                                                    style="transform: rotate(-90deg); display: inline-block;"></i>
                                                <i v-on:click="useDailySatisfactionChange(itemTrade.dateUnix, false, itemTrade)"
                                                    v-bind:class="[itemTrade.satisfaction == false ? 'redTrade' : '', 'uil', 'uil-thumbs-down', 'pointerClass']"></i>

                                                <i v-show="tags.filter(obj => obj.tradeId == itemTrade.dateUnix.toString()).length == 0 || (tags.filter(obj => obj.tradeId == itemTrade.dateUnix.toString()).length > 0 && tags.filter(obj => obj.tradeId == itemTrade.dateUnix.toString())[0].tags.length === 0)"
                                                    data-bs-toggle="modal" data-bs-target="#tagsModal"
                                                    :data-index="index" class="ms-2 uil uil-tag-alt pointerClass"></i>

                                            </div>

                                        </div>
                                        <div>
                                            <span
                                                v-for="tags in tags.filter(obj => obj.tradeId == itemTrade.dateUnix.toString())">
                                                <span v-for="tag in tags.tags.slice(0, 7)"
                                                    class="tag txt-small pointerClass"
                                                    :style="{ 'background-color': useGetTagInfo(tag).groupColor }"
                                                    data-bs-toggle="modal" data-bs-target="#tagsModal"
                                                    :data-index="index">{{
                                                        useGetTagInfo(tag).tagName
                                                    }}
                                                </span>
                                                <span v-show="tags.tags.length > 7">+{{
                                                    tags.tags.length
                                                    - 7 }}</span>
                                            </span>
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
                                                            <th scope="col">Vol<i class="ps-1 uil uil-info-circle"
                                                                    data-bs-toggle="tooltip"
                                                                    data-bs-title="Total number of securities during the trade (bought + sold or shorted + covered)"></i>
                                                            </th>
                                                            <th scope="col">Position</th>
                                                            <th scope="col">Einstieg</th>
                                                            <th scope="col">PnL/Stk<i class="ps-1 uil uil-info-circle"
                                                                    data-bs-toggle="tooltip"
                                                                    data-bs-title="PnL per unit of security traded (bought or shorted)"></i>
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


                                                            <td>{{ trade.symbol }}</td>

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
                                                                        v-if="trade.openPosition">Offen<i
                                                                            class="ps-1 uil uil-info-circle"
                                                                            data-bs-toggle="tooltip" data-bs-html="true"
                                                                            v-bind:data-bs-title="'Swing trade opened on ' + useDateCalFormat(trade.entryTime)"></i></span><span
                                                                        v-else>Geschlossen<i class="ps-1 uil uil-info-circle"
                                                                            data-bs-toggle="tooltip" data-bs-html="true"
                                                                            v-bind:data-bs-title="'Swing trade closed on ' + useDateCalFormat(trade.exitTime)"></i></span></span><span
                                                                    v-else>{{ useTimeFormat(trade.entryTime) }}<span
                                                                        v-if="checkDate(trade.td, trade.entryTime) == false"><i
                                                                            class="ps-1 uil uil-info-circle"
                                                                            data-bs-toggle="tooltip" data-bs-html="true"
                                                                            v-bind:data-bs-title="'Swing trade from ' + useDateCalFormat(trade.entryTime)"></i></span></span>
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

                                                            <td>
                                                                <span v-if="trade.satisfaction == true">
                                                                    <i class="greenTrade uil uil-thumbs-up"></i>
                                                                </span>
                                                                <span v-if="trade.satisfaction == false">
                                                                    <i class="redTrade uil uil-thumbs-down"></i>
                                                                </span>
                                                            </td>

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
                <div v-if="modalDailyTradeOpen">
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
                                    <th scope="col">Einstieg</th>
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

                    <!-- *** VARIABLES *** -->
                    <div class="mt-1 mb-2 row align-items-center ms-1 me-1 tradeSetup">
                        <div class="col-12">
                            <div class="row">
                                <!-- First line -->
                                <div class="col-12" v-show="!spinnerSetups">
                                    <div class="row align-items-center">

                                        <!-- Satisfaction -->
                                        <div class="col-1">
                                            <label class="form-label txt-small mb-1" style="color: var(--white-60);">&nbsp;</label><br>
                                            <i v-on:click="tradeSatisfactionChange(filteredTrades[itemTradeIndex].trades[tradeIndex], true)"
                                                v-bind:class="[filteredTrades[itemTradeIndex].trades[tradeIndex].satisfaction == true ? 'greenTrade' : '', 'uil', 'uil-thumbs-up', 'pointerClass', 'me-1']"></i>
                                            <i v-on:click="tradeSatisfactionChange(filteredTrades[itemTradeIndex].trades[tradeIndex], 'neutral')"
                                                v-bind:class="[filteredTrades[itemTradeIndex].trades[tradeIndex].satisfaction == 'neutral' ? 'neutralTrade' : '', 'uil', 'uil-thumbs-up', 'pointerClass', 'me-1']"
                                                style="transform: rotate(-90deg); display: inline-block;"></i>
                                            <i v-on:click="tradeSatisfactionChange(filteredTrades[itemTradeIndex].trades[tradeIndex], false)"
                                                v-bind:class="[filteredTrades[itemTradeIndex].trades[tradeIndex].satisfaction == false ? 'redTrade' : '', 'uil', 'uil-thumbs-down', 'pointerClass']"></i>
                                        </div>


                                        <!-- Tags -->
                                        <div class="container-tags col-8">
                                            <label class="form-label txt-small mb-1" style="color: var(--white-60);">Tags</label>
                                            <div class="form-control dropdown form-select" style="height: auto;">
                                                <div style="display: flex; align-items: center; flex-wrap: wrap;">
                                                    <span v-for="(tag, index) in tradeTags" :key="index"
                                                        class="tag txt-small"
                                                        :style="{ 'background-color': useGetTagInfo(tag.id).groupColor }"
                                                        @click="useTradeTagsChange('remove', index)">
                                                        {{ tag.name }}<span class="remove-tag">×</span>
                                                    </span>

                                                    <input type="text" v-model="tagInput" @input="useFilterTags"
                                                        @keydown.enter.prevent="useTradeTagsChange('add', tagInput)"
                                                        @keydown.tab.prevent="useTradeTagsChange('add', tagInput)"
                                                        class="form-control tag-input" placeholder="Tag hinzufügen">
                                                    <div class="clickable-area" v-on:click="useToggleTagsDropdown">
                                                    </div>
                                                </div>
                                            </div>

                                            <ul class="dropdown-menu-tags" v-show="showTagsList === 'daily'">
                                                <span v-for="group in availableTags">
                                                    <h6 class="p-1 mb-0"
                                                        :style="'background-color: ' + group.color + ';'"
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
                                        <!-- MFE -->
                                        <div class="col-3">
                                            <label class="form-label txt-small mb-1" style="color: var(--white-60);">
                                                MFE Preis
                                                <i class="uil uil-info-circle pointerClass" style="font-size: 0.85rem;"
                                                    data-bs-toggle="tooltip" data-bs-placement="top"
                                                    title="Maximum Favorable Excursion: Bester Preis w&#228;hrend des Trades. Long = h&#246;chster High, Short = tiefster Low. Wird automatisch aus Binance 1m-Daten berechnet."></i>
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
                                <div class="col-12 mt-2" v-show="!spinnerSetups">
                                    <textarea class="form-control" placeholder="Notiz" id="floatingTextarea"
                                        v-bind:value="tradeNote"
                                        @input="tradeNoteChange($event.target.value)"></textarea>
                                </div>

                                <!-- Screenshot Icon-Button -->
                                <div class="col-12 mt-2" v-show="!spinnerSetups && screenshot.originalBase64">
                                    <span class="pointerClass" style="font-size: 1.3rem;"
                                        data-bs-toggle="modal" data-bs-target="#fullScreenModal"
                                        @click="useSelectedScreenshotFunction(-1, 'dailyModal', screenshot)">
                                        <i class="uil uil-image me-1"></i>
                                        <span class="txt-small" style="color: var(--white-60);">Screenshot</span>
                                    </span>
                                </div>

                                <!-- Forth line -->
                                <div class="col-12 mt-3" v-show="!spinnerSetups">
                                    <input class="screenshotFile" type="file"
                                        @change="useSetupImageUpload($event, filteredTrades[itemTradeIndex].trades[tradeIndex].entryTime, filteredTrades[itemTradeIndex].trades[tradeIndex].symbol, filteredTrades[itemTradeIndex].trades[tradeIndex].side)" />
                                </div>


                                <!-- Fifth line -->
                                <div class="col-12 mt-3" v-show="!spinnerSetups">
                                    <div class="row">
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
                                                v-on:click="clickTradesModal()">Schließen
                                                & Speichern</button>
                                            <button v-else class="btn btn-outline-primary btn-sm"
                                                v-on:click="clickTradesModal()">Schließen</button>
                                        </div>
                                        <div v-show="filteredTrades[itemTradeIndex].trades.hasOwnProperty(tradeIndex + 1)"
                                            class="ms-auto col-4 text-end">
                                            <button class="btn btn-outline-primary btn-sm me-3 mb-2"
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
                                class="form-control tag-input" placeholder="Tag hinzufügen">
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

</template>