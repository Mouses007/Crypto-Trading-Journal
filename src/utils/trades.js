import { pageId, spinnerLoadingPage, queryLimit, timeZoneTrade, hasData, dailyPagination, dailyQueryLimit, endOfList, selectedItem } from "../stores/ui.js"
import { selectedRange, selectedDateRange, selectedPositions, selectedAccounts, selectedTags, selectedBroker, selectedTradeCategory, daysBack } from "../stores/filters.js"
import { filteredTrades, filteredTradesTrades, pAndL, blotter, totals, totalsByDate, groups, profitAnalysis, timeFrame, satisfactionArray, satisfactionTradeArray, tags, filteredTradesDaily, excursions, availableTags, imports } from "../stores/trades.js"
import { useDateTimeFormat } from "./formatters.js";
import { splitFunding } from "./funding.js";
import { neueSummen, summiereTrade, leiteKennzahlenAb } from "./totals-kern.js";
/* useRefreshTrades moved to mountOrchestration.js */
import { useCreateBlotter, useCreatePnL } from "./addTrades.js"
import { dbFind, dbFirst, dbDelete, dbDeleteWhere } from './db.js'
import { refreshAccountBalance } from '../stores/accountBalance.js'
import axios from 'axios'

/* MODULES */
import dayjs from './dayjs-setup.js'
import _ from 'lodash'
import { useGetTagInfo } from "./daily.js";

let trades = []

export async function useGetFilteredTrades(param) {
    console.log("\nGETTING FILTERED TRADES")
    try {

        /*============= 3 - Get data from DB =============
         ***************************************************/

        //console.log(" -> Getting trades")
        await useGetTrades()
        //console.log(" trades "+JSON.stringify(trades))


        /*============= 4 - Apply filter to trades =============
         
        * We filter by date range, position, account by looping/creating trades column
        * New variable will be called filteredTrades
        ***************************************************/

        console.log(" -> Filtering trades (" + useDateTimeFormat(selectedRange.value.start) + " - " + useDateTimeFormat(selectedRange.value.end) + ")")
        //spinnerLoadingPageText.value = "Getting trades - Filtering trades"
        //console.log("Range (Date or Call) start " + selectedRange.value.start + " Range (Date or Call) end " + selectedRange.value.end)

        filteredTrades.length = 0
        filteredTradesDaily.length = 0
        filteredTradesTrades.length = 0
        const selectedTagsArray = Object.values(selectedTags.value)
        const selectedTagsSet = new Set(selectedTagsArray)
        const noTagsSelected = selectedTagsSet.has("t000t")

        const tagsByTradeId = new Map()
        const tagsByDateUnix = new Map()
        for (const tagRow of tags) {
            if (tagRow.tradeId != null) {
                tagsByTradeId.set(String(tagRow.tradeId), Array.isArray(tagRow.tags) ? tagRow.tags : [])
            }
            if (tagRow.dateUnix != null) {
                tagsByDateUnix.set(String(tagRow.dateUnix), Array.isArray(tagRow.tags) ? tagRow.tags : [])
            }
        }

        const satisfactionByDateUnix = new Map()
        for (const item of satisfactionArray) {
            satisfactionByDateUnix.set(String(item.dateUnix), item.satisfaction)
        }

        const satisfactionByTradeId = new Map()
        for (const item of satisfactionTradeArray) {
            satisfactionByTradeId.set(String(item.tradeId), item.satisfaction)
        }

        const excursionByTradeId = new Map()
        for (const item of excursions) {
            excursionByTradeId.set(String(item.tradeId), item)
        }

        // Load tradeType from notes table
        //
        // Gebraucht wird hier genau EIN Feld (tradeType). Früher holte diese
        // Zeile bei jedem Filterlauf sämtliche Notizen komplett — mit Fliesstext,
        // Playbook und KI-Auswertung, also Kilobyte je Zeile. Jetzt: nur der
        // Zeitraum, den die geladenen Trades abdecken, und ohne die Textfelder.
        const notesQuery = {
            exclude: ['note', 'title', 'entryNote', 'feelings', 'playbook',
                'closingNote', 'closingFeelings', 'closingPlaybook', 'tradingMetadata',
                'aiReview', 'aiReviewProvider', 'aiReviewModel']
        }
        if (trades.length > 0) {
            // Den Ausschnitt aus den tatsächlich geladenen Trades ableiten statt
            // aus selectedRange — die Imports-Seite lädt z.B. „letzte 20" ohne
            // Zeitraum, da würde ein Filter auf selectedRange Notizen verschlucken.
            let minD = Infinity, maxD = -Infinity
            for (const row of trades) {
                const d = Number(row.dateUnix)
                if (!Number.isFinite(d)) continue
                if (d < minD) minD = d
                if (d > maxD) maxD = d
            }
            if (Number.isFinite(minD) && Number.isFinite(maxD)) {
                notesQuery.greaterThanOrEqualTo = { dateUnix: minD }
                notesQuery.lessThanOrEqualTo = { dateUnix: maxD }
            }
        }
        const allNotes = await dbFind("notes", notesQuery)
        const tradeTypeByTradeId = new Map()
        for (const note of (allNotes || [])) {
            if (note.tradeType && note.tradeType !== '' && note.tradeId) {
                tradeTypeByTradeId.set(String(note.tradeId), note.tradeType)
            }
        }

        const availableTagById = new Map()
        for (const group of availableTags) {
            if (!group?.tags) continue
            for (const tag of group.tags) {
                availableTagById.set(tag.id, tag.name)
            }
        }

        let loopTrades = (param1) => {
            //console.log("param1 "+JSON.stringify(param1))
            if (param1.length > 0) hasData.value = true //I do reverse, that is start with true so that on page load No Data does not appear
            param1.forEach(element => {
                //console.log(" -> Looping "+element.dateUnix)
                //console.log("trades "+JSON.stringify(element.trades))
                //console.log(" element " + JSON.stringify(element))

                if (element.trades) {
                    let temp = _.omit(element, ["trades", "pAndL", "blotter"]) //We recreate trades and pAndL
                    temp.trades = []

                    //we need to get date, month and year in order to compare for calendar creation
                    temp.date = dayjs.unix(element.dateUnix).tz(timeZoneTrade.value).date()
                    temp.month = dayjs.unix(element.dateUnix).tz(timeZoneTrade.value).month()
                    temp.year = dayjs.unix(element.dateUnix).tz(timeZoneTrade.value).year()

                    if (pageId.value == "daily") {

                        //Adding satisfaction for daily page
                        temp.satisfaction = satisfactionByDateUnix.get(String(element.dateUnix)) ?? null
                    }

                    //console.log("element "+JSON.stringify(element))
                    element.trades.forEach(element => {
                        element = _.omit(element, ["excursions"]) //We recreate trades and omit excursions

                        //console.log("element "+JSON.stringify(element))
                        if (element.strategy == "long") {
                            element.priceVar = element.exitPrice - element.entryPrice
                        } else {
                            element.priceVar = element.entryPrice - element.exitPrice
                        }

                        let tradeTagsSelected = false

                        // Bot-Trades (Grid) werden auto-importiert und nie manuell
                        // getaggt. Ein aktiver Tag-Filter (ohne "untagged"/t000t)
                        // würde sie sonst alle ausblenden → Bots vom Tag-Filter
                        // ausnehmen, damit sie immer sichtbar sind.
                        if (element.botType || element.category === 'agent') {
                            tradeTagsSelected = true
                        }

                        //console.log(" tags "+JSON.stringify(tags))
                        //console.log(" element "+JSON.stringify(element))

                        //Check if trade(Id) is present in tags list for Trades
                        const tradeTagIds = tagsByTradeId.get(String(element.id)) || []
                        if (tradeTagIds.length > 0) {

                            //Case/check if tag_id is present in selectedTagsArray
                            if (tradeTagIds.some(tagId => selectedTagsSet.has(tagId))) {
                                tradeTagsSelected = true
                            }
                        }

                        //If not, check if no tags is selected or not
                        else {
                            if (noTagsSelected) {
                                tradeTagsSelected = true
                            }
                        }

                        //Check if trade(Id) is present in tags list for Daily tags
                        const dayTagIds = tagsByDateUnix.get(String(element.td)) || []
                        if (dayTagIds.length > 0) {
                            //console.log(" -> selected tags "+Object.values(selectedTags.value))
                            //console.log(" -> trade tags " + JSON.stringify(tags[dayTagsIndex].tags))
                            //console.log(" includes ? "+selectedTagsArray.some(value => tags[dayTagsIndex].tags.find(obj => obj === value)))

                            //Case/check if tag_id is present in selectedTagsArray
                            if (dayTagIds.some(tagId => selectedTagsSet.has(tagId))) {
                                tradeTagsSelected = true
                            }
                        }

                        //If not, check if no tags is selected or not
                        else {
                            if (noTagsSelected) {
                                tradeTagsSelected = true
                            }
                        }

                        const tradeSatisfaction = satisfactionByTradeId.get(String(element.id)) ?? null

                        // Kategorie-Filter: Futures vs Bot vs Agent.
                        //
                        // Der Agent ist der heikle Fall. Seine Trades sind zum
                        // grossen Teil PAPIER — sie dürfen unter keinen Umständen
                        // in der normalen Ansicht auftauchen, sonst rechnet das
                        // Dashboard simuliertes Geld in die echte Bilanz. Deshalb
                        // ist er die einzige Kategorie, die auch bei „alle"
                        // draussen bleibt: sichtbar NUR, wenn ausdrücklich gewählt.
                        const cat = selectedTradeCategory.value || 'all'
                        const isAgentTrade = element.category === 'agent'
                        const isBotTrade = !!element.botType
                        const categoryMatch = cat === 'agent'
                            ? isAgentTrade
                            : (!isAgentTrade && (cat === 'all' || (cat === 'bot' ? isBotTrade : !isBotTrade)))

                        // Broker-Filter (Börsen-Pille) IMMER anwenden — auch im
                        // Bot-Modus: so hat jede Börse ihre eigene Bot-Seite
                        // (Pionex-Pille → Pionex-Bots, Bitunix → Bitunix-Bots …).
                        // NUR der Konto-Filter (selectedAccounts) wird im Bot-Modus
                        // übersprungen: er ist Futures-orientiert (i.d.R.
                        // ["bitunix","bitget"]) und würde Bots sonst ausblenden.
                        // Konto-Filter wird im Bot-Modus übersprungen. Zusätzlich darf
                        // ein (evtl. veralteter) Konto-Multiselect Trades der aktuell
                        // gewählten Börse NICHT ausblenden — die Börsen-Pille (brokerMatch)
                        // scope't bereits. Sonst fehlen z.B. neue Pionex-Futures, wenn
                        // 'pionex' noch nicht in selectedAccounts steht.
                        const accountMatch = cat === 'bot'
                            || !selectedAccounts.value.length
                            || selectedAccounts.value.includes(element.account)
                            || element.account === selectedBroker.value
                        const brokerMatch = !selectedBroker.value || element.broker === selectedBroker.value

                        if (brokerMatch && categoryMatch && (selectedRange.value.start === 0 && selectedRange.value.end === 0 ? element.td >= selectedRange.value.start : element.td >= selectedRange.value.start && element.td < selectedRange.value.end) && selectedPositions.value.includes(element.strategy) && accountMatch && tradeTagsSelected) {

                            /**
                             * We're using tempArray to be able to group
                             * However, as we want to group only the selected tags, we need to check if tag.id is included in selectedTagsArray
                             */

                            //console.log(" -> trade tags " + JSON.stringify(tags[tagsIndex]))
                            let tempArray = []
                            const seenTagIds = new Set()
                            for (const tagsElement of tradeTagIds) {
                                if (!selectedTagsSet.has(tagsElement) || seenTagIds.has(tagsElement)) continue
                                const tagName = availableTagById.get(tagsElement)
                                if (!tagName) continue
                                seenTagIds.add(tagsElement)
                                tempArray.push({ id: tagsElement, name: tagName })
                            }

                            for (const tagsElement of dayTagIds) {
                                if (!selectedTagsSet.has(tagsElement) || seenTagIds.has(tagsElement)) continue
                                const tagName = availableTagById.get(tagsElement)
                                if (!tagName) continue
                                seenTagIds.add(tagsElement)
                                tempArray.push({ id: tagsElement, name: tagName })
                            }

                            element.tags = tempArray

                            element.satisfaction = tradeSatisfaction


                            element.stopLoss = null
                            element.maePrice = null
                            element.mfePrice = null

                            const tradeExcursion = excursionByTradeId.get(String(element.id))
                            if (tradeExcursion) {
                                if (tradeExcursion.stopLoss) element.stopLoss = tradeExcursion.stopLoss
                                if (tradeExcursion.maePrice) element.maePrice = tradeExcursion.maePrice
                                if (tradeExcursion.mfePrice) element.mfePrice = tradeExcursion.mfePrice
                            }

                            // Attach tradeType from notes
                            element.tradeType = tradeTypeByTradeId.get(String(element.id)) || ''

                            /**
                             * CALC OPTIMIZATION
                             */



                            temp.trades.push(element)

                            filteredTradesTrades.push(element)
                            //console.log(" -> Temp trades "+JSON.stringify(temp.trades))
                        }
                    });
                    /* Just use the once that have recreated trades (or else daily was showing last 3 months and only one month with trades data) */
                    if (temp.trades.length > 0) {
                        filteredTrades.push(temp)
                        filteredTradesDaily.push(temp)
                    }
                }
            });
        }

        //console.log("trades "+JSON.stringify(trades))
        //console.log("filteredTrades "+JSON.stringify(filteredTrades))
        loopTrades(trades)
        //console.log(" selectedRange.value.start "+selectedRange.value.start)
        //console.log(" -> Filtered trades of trades "+JSON.stringify(filteredTradesTrades))
        await useCreateBlotter(true)
        await useCreatePnL()
        //console.log(" Blotter "+JSON.stringify(blotter))
        //console.log(" P and L "+JSON.stringify(pAndL))
        let keys = Object.keys(pAndL)
        //console.log(" keys "+keys)
        const filteredTradeByDateUnix = new Map(
            filteredTrades.map(item => [String(item.dateUnix), item])
        )
        for (const key of keys) {
            const dayTrade = filteredTradeByDateUnix.get(String(key))
            if (!dayTrade) continue
            dayTrade.pAndL = pAndL[key]
            dayTrade.blotter = blotter[key]

        }

        filteredTrades.sort((a, b) => {
            return b.dateUnix - a.dateUnix
        })


        //console.log(" -> Filtered trades " + JSON.stringify(filteredTrades))
        //console.log(" -> Filtered trades daily " + JSON.stringify(filteredTradesDaily))
        //console.log("\nFinished getting filtered trades\n\n")
    } catch (error) {
        console.error("FILTERED TRADES ERROR:", error)
    }
}


/***************************************
 * GETTING DATA FROM PARSE DB
 ***************************************/
export async function useGetTrades(param) {
        console.log("\nGETTING TRADES");
        console.time("  --> Duration getting trades");

        let options = {
            exclude: ["executions", "blotter", "pAndL"]
        }

        if (pageId.value === "imports" || param === "imports") {
            options.descending = "dateUnix"
            options.limit = 20
        }
        else if (pageId.value === "addExcursions") {
            let startD = dayjs().subtract(daysBack.value, 'days').unix()
            let endD = dayjs().unix()
            options.greaterThanOrEqualTo = { dateUnix: startD }
            options.lessThan = { dateUnix: endD }
            options.ascending = "dateUnix"
        }
        else {
            let startD = selectedRange.value.start
            let endD = selectedRange.value.end
            // "Gesamt" filter: start=0, end=0 means all trades — skip date filters
            if (startD === 0 && endD === 0) {
                options.ascending = "dateUnix"
                options.limit = queryLimit.value
            } else {
                options.greaterThanOrEqualTo = { dateUnix: startD }
                options.lessThan = { dateUnix: endD }
                options.ascending = "dateUnix"
                options.limit = queryLimit.value
            }
        }

        const results = await dbFind("trades", options)
        console.timeEnd("  --> Duration getting trades");
        if (results.length > 0) {
            trades = [...results]
            imports.length = 0
            imports.value = [...results]
        } else {
            trades.length = 0
            imports.length = 0
            imports.value = []
        }
}

export function useGetFilteredTradesForDaily() {
    // Dedupe-Set basierend auf dateUnix der bereits gerenderten Trades.
    // Hintergrund: useGetFilteredTrades() (im Mount) befuellt sowohl filteredTrades
    // als auch filteredTradesDaily komplett. useLoadMore() wuerde sonst die ersten
    // dailyQueryLimit Eintraege erneut anhaengen -> doppelte Tageskarten / verzerrte Summen.
    const seen = new Set(filteredTrades.map(t => String(t.dateUnix)))
    for (let index = dailyPagination.value; index < (dailyPagination.value + dailyQueryLimit.value); index++) {
        const element = filteredTradesDaily[index];
        if (!element) {
            endOfList.value = true
        } else if (!seen.has(String(element.dateUnix))) {
            filteredTrades.push(element)
            seen.add(String(element.dateUnix))
        }
    }
    dailyPagination.value = dailyPagination.value + dailyQueryLimit.value
}

/*============= Prepare Trades (#4) =============

* Here we are going to create general totals
* Create a list of all trades needed for grouping by date but also by strategy, price, etc.
* Create totals per date needed for grouping monthly, weekly and daily
***************************************/

/* List of all trades inside trades column (needed for grouping) */
let temp1 = []
/* 1b - Create a json that we push to totals */
let temp2 = {}
/* Totals per date */
let temp3 = {}

export async function useTotalTrades() {
    console.log("\nCREATING TOTAL TRADES")
        /* Variables */
        temp1 = []
        temp2 = {}
        temp3 = {}

        var totalLocateFees = 0
        var totalSoftwareFees = 0
        var totalBankingFees = 0

        /*============= 1- CREATING GENERAL TOTALS =============

        * needed for dashboard
        * we start by iterating trades to created totals
        * Note: during iteration, we will also push to create a list of trades needed for grouping
        * Then we prepare a json that we push to totals
        */

        /* 1a - In each filtered trade, we will iterate trade to create totals.
         * Die eigentliche Summierung lebt NaN-fest und getestet in
         * totals-kern.js — hier wird nur noch gesammelt. */
        const summe = neueSummen()
        filteredTrades.forEach((element, index) => {
            // Other fees
            if (element.cashJournal != undefined && Object.keys(element.cashJournal).length > 0) {
                totalLocateFees += element.cashJournal.locate || 0
                totalSoftwareFees += element.cashJournal.software || 0
                totalBankingFees += element.cashJournal?.banking?.fee || 0
            }

            element.trades.forEach(el => {
                /*============= NOTE - Creating list of trades =============

                * at the same time, we will push each trade inside trades
                * way.value we have a list of trades that we can group
                * according to grouping need (per date but also entry, strategy, etc.)
                */
                temp1.push(el)
                summiereTrade(summe, el)
            })
        })

        /* 1b - Create a json that we push to totals: Summenfelder aus dem
         * Kern, abgeleitete Kennzahlen (Winrate, Durchschnitte) ebenso. */
        temp2 = { ...summe, ...leiteKennzahlenAb(summe) }
        temp2.quantity = summe.buyQuantity + summe.sellQuantity

        /*******************
         * Other fees (leben auf Tagesebene, nicht im Trade — daher hier)
         *******************/
        temp2.locateFees = totalLocateFees
        temp2.softwareFees = totalSoftwareFees
        temp2.bankingFees = totalBankingFees
        temp2.otherFees = totalLocateFees + totalSoftwareFees + totalBankingFees
        temp2.netFeesProceeds = summe.netProceeds - temp2.otherFees
        temp2.netProceedsEstimations = 0
        temp2.netWinsEstimations = 0
        temp2.netLossEstimations = 0
        for (let key in totals) delete totals[key]
        Object.assign(totals, temp2)
        //console.log(" -> TOTALS " + JSON.stringify(totals))



        /*============= 2- RECREATING TOTALS BY DATE =============
         *
         * Create totals per date needed for grouping monthly, weekly and daily
         */

        //console.log("temp2 "+JSON.stringify(temp2))
        let objectY = _
            .chain(temp1)
            .orderBy(["td"], ["asc"])
            .groupBy("td")
            .value()
        const keys3 = Object.keys(objectY);
        //console.log(" keys 3 "+keys3)
        for (const key3 of keys3) {
            var tempTrades = objectY[key3]

            // Dieselbe Summierung wie bei den globalen Totalen — bewusst aus
            // EINER Quelle (totals-kern.js), damit Totale und Tagesgruppen
            // nicht mehr auseinanderdriften können (daher kam der Funding-Bug).
            const tag = neueSummen()
            tempTrades.forEach(element => summiereTrade(tag, element))
            temp3[key3] = { ...tag }

            /*******************
             * Financials — Tagesgruppen tragen den Wert der ersten Zeile,
             * nicht die Summe (bisheriges Verhalten)
             *******************/
            temp3[key3].financials = tempTrades[0].financials
        }
        //console.log(" temp 3 " + JSON.stringify(temp3))
        for (let key in totalsByDate) delete totalsByDate[key]
        Object.assign(totalsByDate, temp3)
        console.log(" -> TOTALS BY DATE (length) " + Object.keys(totalsByDate).length)
        console.log(" -> temp1 trades count: " + temp1.length + ", unique td values: " + new Set(temp1.map(t => t.td)).size)
}

export async function useGroupTrades() {
    console.log("\nGROUPING TRADES")
        /*============= 3- MISC GROUPING =============

        * Miscelanious grouping of trades by entry, price, etc.
        */
        var thousand = 1000
        var million = 1000000

        /*******************
         * GROUP BY DAY OF WEEK
         *******************/

        groups.day = _
            .groupBy(temp1, t => dayjs.unix(t.entryTime).day()); //temp1 is json array with trades and is created during totals
        //console.log("day  "+JSON.stringify(groups.day))

        /*******************
         * GROUP BY MONTH OF YEAR
         *******************/
        var b = _
            .groupBy(temp1, t => dayjs.unix(t.entryTime).month());
        //console.log("b "+JSON.stringify(b))

        /*******************
         * GROUP BY ENTRY TIMEFRAME
         *******************/
        groups.timeframe = _(temp1)
            .groupBy(x => {
                var secondTimeFrame = timeFrame.value
                var msTimeFrame = secondTimeFrame * 60 * 1000; /*ms*/

                //console.log("entry time " + dayjs.unix(x.entryTime).format("HH:mm"))
                //console.log(" -> Entrytime "+x.entryTime)
                let entryTF = Math.floor(x.entryTime / secondTimeFrame) * secondTimeFrame
                //console.log("  --> entryTF "+entryTF)
                var entryTimeTF = dayjs(Math.floor((+dayjs.unix(x.entryTime)) / msTimeFrame) * msTimeFrame);
                //console.log("  --> entryTimeTF "+entryTimeTF)
                return entryTimeTF.tz(timeZoneTrade.value).format("HH:mm")
            })
            .toPairs()
            .sortBy(0)
            .fromPairs()
            .value()

        //console.log("timeframe " + JSON.stringify(groups.timeframe))

        /* ==== Group by trade duration ==== */
        groups.duration = _(temp1)
            .orderBy(x => x.exitTime - x.entryTime)
            .groupBy(t => {
                // under 1mn, 1mn-2mn, 2-5mn, 5-10mn, 10-20mn, 20-40mn, 40-60mn, above 60mn
                var tradeDuration = t.exitTime - t.entryTime // in seconds  
                var tradeDurationDiv = tradeDuration / 60

                var floorDurationSeconds
                if (tradeDurationDiv < 1) {
                    floorDurationSeconds = 0 // 0-1mn
                }
                if (tradeDurationDiv >= 1 && tradeDurationDiv < 2) {
                    floorDurationSeconds = 1 // 1-2mn
                }
                if (tradeDurationDiv >= 2 && tradeDurationDiv < 5) {
                    floorDurationSeconds = 2 // 2-5mn
                }
                if (tradeDurationDiv >= 5 && tradeDurationDiv < 10) {
                    floorDurationSeconds = 5 // 5-10mn
                }
                if (tradeDurationDiv >= 10 && tradeDurationDiv < 20) {
                    floorDurationSeconds = 10 // 10-20mn
                }
                if (tradeDurationDiv >= 20 && tradeDurationDiv < 40) {
                    floorDurationSeconds = 20 // 20-40mn
                }
                if (tradeDurationDiv >= 40 && tradeDurationDiv < 60) {
                    floorDurationSeconds = 40 // 40-60mn
                }
                if (tradeDurationDiv >= 60) {
                    floorDurationSeconds = 60 // >60mn
                }
                //console.log(" -> duration " + dayjs.duration(tradeDuration * 1000).format('HH:mm:ss') + " - interval in seconds " + floorDurationSeconds + " - formated interval " + dayjs.duration(floorDurationSeconds * 1000).format('HH:mm:ss'))

                return floorDurationSeconds
            })
            .toPairs()
            .sortBy(0)
            .fromPairs()
            .value()
        //console.log("d "+JSON.stringify(groups.duration))



        /*******************
         * GROUP BY NUMBER OF TRADES
         *******************/
        groups.trades = _(temp3)
            .groupBy(x => {
                let ceilTrades
                // under 5, 6-10, 11-15, 16-20, 21-30, above 30 trades
                if (x.trades <= 30) {
                    var range = 5
                    ceilTrades = (Math.ceil(x.trades / range) * range);
                }
                if (x.trades > 30) {
                    ceilTrades = 30
                }
                //console.log(" -> trades " + x.trades +" and interval "+ceilTrades)

                return ceilTrades
            })
            .value()

        //console.log("trades " + JSON.stringify(groups.trades))

        /*******************
         * GROUP BY NUMBER OF EXECUTIONS PER TRADE
         *******************/
        groups.executions = _(temp1)
            .groupBy('executionsCount')
            .value()

        //console.log("executions " + JSON.stringify(groups.executions))

        /*******************
        * GROUP BY POSITION
        *******************/
        groups.position = _(temp1)
            .groupBy('strategy')
            .value()
        //console.log("group by position " + JSON.stringify(groups.position))

        /*******************
        * GROUP BY TRADE TYPE (scalp/day/swing)
        *******************/
        groups.tradeType = _(temp1)
            .filter(t => t.tradeType && t.tradeType !== '')
            .groupBy('tradeType')
            .value()

        /*******************
        * GROUP BY TAGS
        *******************/
        //console.log(" temp1 " + JSON.stringify(temp1))
        //console.log(" tags " + JSON.stringify(tags))

        // Flatten the array of tags and add the id and name properties to each tag object
        const flattenedData = temp1.reduce((acc, obj) => {
            if (obj.tags) {
                obj.tags.forEach(tag => {
                    acc.push({ ...obj, tag });
                });
            } else {
                acc.push({ ...obj, tag: { id: 'no_tags', name: 'No Tags' } });
            }
            return acc;
        }, []);

        // Group by tag id
        //console.log(" flattenedData "+JSON.stringify(flattenedData))
        flattenedData.forEach(element => {
           let tagInfo = useGetTagInfo(element.tag.id) 
           //console.log(" tagInfo "+JSON.stringify(tagInfo))
           element.tag.groupName = tagInfo.tagGroupName
           element.tag.groupId = tagInfo.tagGroupId
        });
        const groupByTag = _.groupBy(flattenedData, 'tag.id');

        // Convert the grouped data object to an object with the desired structure
        const result = Object.keys(groupByTag).reduce((acc, key) => {
            acc[key] = groupByTag[key].map(obj => ({
                tagName: obj.tag.name,
                tagGroupName: obj.tag.groupName,
                ...obj
            }));
            return acc;
        }, {});

        groups.tags = result
        //console.log("tags " + JSON.stringify(groups.tags))

        /****
         * Group by group tags and then create groups by these groups to get the tags
         */
        const groupByTagGroup = _.groupBy(flattenedData, 'tag.groupId');

        // Convert the grouped data object to an object with the desired structure
        const result2 = Object.keys(groupByTagGroup).reduce((acc, key) => {
            acc[key] = groupByTagGroup[key].map(obj => ({
                tagName: obj.tag.name,
                tagGroupName: obj.tag.groupName,
                ...obj
            }));
            return acc;
        }, {});

        //console.log(" groupByTagGroup "+JSON.stringify(groupByTagGroup))
        for (let key in result2) {
            groups[key] = _.groupBy(result2[key], 'tag.id');
        }
        
        //console.log(" groups "+JSON.stringify(groups))

        /*******************
         * GROUP BY SYMBOL
         *******************/
        groups.symbols = _(temp1)
            .groupBy('symbol')
            .value()

        /*******************
         * GROUP BY PUBLIC FLOAT
         *******************/
        let path = "financials.publicFloat";
        groups.shareFloat = _(temp1)
            .filter(object => _.has(object, path))
            .groupBy(x => {
                let ceilFloor
                var publicFloatFinviz = x.financials.publicFloat.finviz
                if (publicFloatFinviz != "-") {
                    //console.log("public float (finviz) " + JSON.stringify(publicFloatFinviz))

                    // under 10M, 10-20M, 20-30, 30-50, above 50M float
                    if (publicFloatFinviz < 20 * million) {
                        var range = 5 * 1000000
                        ceilFloor = (Math.floor(publicFloatFinviz / range) * range);
                    }
                    if ((publicFloatFinviz >= 20 * million) && (publicFloatFinviz < 50 * million)) {
                        var range = 10 * 1000000
                        ceilFloor = (Math.floor(publicFloatFinviz / range) * range);
                    }
                    if (publicFloatFinviz >= 50 * million) {
                        ceilFloor = 50 * million
                    }
                    //console.log(" -> trades " + x.trades +" and interval "+ceilFloor)

                    return ceilFloor
                }
            })
            .value()

        //console.log("group by share float " + JSON.stringify(groups.shareFloat))

        /*******************
         * GROUP BY MARKET CAP
         *******************/
        groups.mktCap = _(temp1)
            .filter(object => _.has(object, path))
            .groupBy(x => {
                let ceilTrades
                var mktCap = x.financials.mktCap
                if (mktCap != null) {
                    //console.log("mktCap " + mktCap)
                    //Mega-cap: Market cap of $200 billion and greater
                    //Big-cap: $10 billion and greater
                    //Mid-cap: $2 billion to $10 billion
                    //Small-cap: $300 million to $2 billion
                    //Micro-cap: $50 million to $300 million
                    //Nano-cap: Under $50 million
                    if (mktCap <= 50 * 1000000) {
                        ceilTrades = 50 * 1000000
                    }
                    if (mktCap > 50 * 1000000 && mktCap <= 300 * 1000000) {
                        ceilTrades = 300 * 1000000
                    }
                    if (mktCap > 300 * 1000000 && mktCap <= 2000 * 1000000) {
                        ceilTrades = 2000 * 1000000
                    }
                    if (mktCap > 2000 * 1000000 && mktCap <= 10000 * 1000000) {
                        ceilTrades = 10000 * 1000000
                    }
                    if (mktCap > 10000 * 1000000) {
                        ceilTrades = 10001 * 1000000
                    }
                    //console.log(" -> interval "+ceilTrades)

                    return ceilTrades
                }
            })
            .value()

        //console.log("group by mktCap " + JSON.stringify(groups.mktCap))


        /*******************
         * GROUP BY ENTRYPRICE
         *******************/
        groups.entryPrice = _(temp1)
            .groupBy(x => {
                // under 5, 5-9.99, 10-14.99, 15-19.99, 20-29.99, above 30 trades
                let floorNum
                if (x.entryPrice < 30) {
                    var range = 5
                    floorNum = (Math.floor(x.entryPrice / range) * range);
                }
                if (x.entryPrice >= 30) {
                    floorNum = 30
                }
                //console.log(" -> Entry price "+x.entryPrice+" and interval "+floor)

                return floorNum
            })
            .value()
        //console.log("group by entryprice " + JSON.stringify(groups.entryPrice))
}

/***************************************
         * GETTING AND CALCULATING MFE
         ***************************************/
//get data from excursions db
export async function useCalculateProfitAnalysis(param) {
    console.log("\nCALCULATING PROFIT ANALYSIS")
        //console.log(" -> Getting MFE Prices")
        let mfePricesArray = []
        for (let key in profitAnalysis) delete profitAnalysis[key]
        mfePricesArray = excursions
        //console.log("  --> MFE prices array "+JSON.stringify(mfePricesArray))
        /*console.log(" -> Getting average quantity")
        let averageQuantity = totals.quantity / 2 / totals.trades
        console.log("  --> Average quantity "+averageQuantity)*/
        //console.log(" totals "+JSON.stringify(totals))
        if (JSON.stringify(totals) != '{}') {
            //console.log(" -> Calculating profit loss ratio risk&reward and MFE")
            //console.log(" -> Calculating gross and net Average Win Per Share")
            profitAnalysis.grossAvWinPerShare = totals.grossWinsCount ? (totals.grossSharePLWins / totals.grossWinsCount) : 0
            profitAnalysis.netAvWinPerShare = totals.netWinsCount ? (totals.netSharePLWins / totals.netWinsCount) : 0
            //console.log("  --> Gross average win per share "+grossAvWinPerShare+" and net "+netAvWinPerShare)

            //console.log(" -> Calculating gross and net Average Loss Per Share")
            profitAnalysis.grossAvLossPerShare = totals.grossLossCount ? (-totals.grossSharePLLoss / totals.grossLossCount) : 0
            profitAnalysis.netAvLossPerShare = totals.netLossCount ? (-totals.netSharePLLoss / totals.netLossCount) : 0
            //console.log("  --> Gross Average Loss Per Share "+grossAvLossPerShare+" and net "+netAvLossPerShare)

            //console.log(" -> Calculating gross and net Highest Win Per Share")
            profitAnalysis.grossHighWinPerShare = totals.highGrossSharePLWin
            profitAnalysis.netHighWinPerShare = totals.highNetSharePLWin
            //console.log("  --> Gross Highest Win Per Share "+grossHighWinPerShare+" and net stop loss "+netHighWinPerShare)

            //console.log(" -> Calculating gross and net Highest Loss Per Share")
            profitAnalysis.grossHighLossPerShare = -totals.highGrossSharePLLoss
            profitAnalysis.netHighLossPerShare = -totals.highNetSharePLLoss
            //console.log("  --> Gross Highest Loss Per Share "+grossHighLossPerShare+" and net stop loss "+netHighLossPerShare)

            //console.log(" -> Calculating gross and net R")
            profitAnalysis.grossR = profitAnalysis.grossAvLossPerShare ? (profitAnalysis.grossAvWinPerShare / profitAnalysis.grossAvLossPerShare) : 0
            profitAnalysis.netR = profitAnalysis.netAvLossPerShare ? (profitAnalysis.netAvWinPerShare / profitAnalysis.netAvLossPerShare) : 0
            //console.log("  --> Gross R " + profitAnalysis.grossR + " and net R " + profitAnalysis.netR)

            //console.log(" -> Calculating gross and net mfe R")
            //console.log(" -> Filtered trades "+JSON.stringify(filteredTrades.trades))
            let grossMfeRArray = []
            let netMfeRArray = []

            mfePricesArray.forEach(element => {

                //console.log(" -> Filtered trades "+JSON.stringify(filteredTrades))
                if (filteredTrades.length > 0) {
                    //console.log(" filteredTrades "+JSON.stringify(filteredTrades))
                    //console.log(" date unix "+element.dateUnix)
                    let tradeFilter = filteredTrades.find(x => x.dateUnix == element.dateUnix)
                    //console.log(" tradeFilter "+JSON.stringify(tradeFilter))
                    if (tradeFilter != undefined) {
                        //console.log(" tradeFilter " + JSON.stringify(tradeFilter))
                        let trade = tradeFilter.trades.find(x => x.id == element.tradeId)
                        if (trade != undefined) {
                            //console.log(" -> Trade " + JSON.stringify(trade))
                            let tradeEntryPrice = trade.entryPrice
                            //console.log(" Entry price " + tradeEntryPrice + " | MFE Price " + element.mfePrice)
                            let entryMfeDiff
                            trade.strategy == "long" ? entryMfeDiff = (element.mfePrice - tradeEntryPrice) : entryMfeDiff = (tradeEntryPrice - element.mfePrice)
                            // Convert price difference to dollar P&L (critical for crypto where qty != 1)
                            let qty = trade.buyQuantity || trade.sellQuantity || 1
                            let mfeDollar = entryMfeDiff * qty
                            let grossMfeR = profitAnalysis.grossAvLossPerShare ? (mfeDollar / profitAnalysis.grossAvLossPerShare) : 0
                            //console.log("  --> Strategy "+trade.strategy+", entry price : "+tradeEntryPrice+", mfe price "+element.mfePrice+", diff "+entryMfeDiff+", mfeDollar "+mfeDollar+" and grosmfe R "+grossMfeR)
                            grossMfeRArray.push(grossMfeR)
                            let netMfeR = profitAnalysis.netAvLossPerShare ? (mfeDollar / profitAnalysis.netAvLossPerShare) : 0
                            netMfeRArray.push(netMfeR)
                        }
                    }
                }
            })
            //console.log("  --> Gross mfeArray " + grossMfeRArray + " and net " + netMfeRArray)

            //console.log(" -> Getting gross and net win rate")
            let grossWin = totals.probGrossWins
            let netWin = totals.probNetWins
            //console.log("  --> Gross win "+grossWin+" and net win "+netWin)

            //console.log(" -> Calculating gross and net current expected return")
            let grossCurrExpectReturn = profitAnalysis.grossR * grossWin
            let netCurrExpectReturn = profitAnalysis.netR * netWin
            //console.log("  --> Gross current expected return "+grossCurrExpectReturn+" and net "+netCurrExpectReturn)

            //console.log(" -> Calculating mfe expected return")
            const takeProfitRLevels = []
            for (let index = 1; index <= 20; index += 0.5) {
                takeProfitRLevels.push(index)

            }

            let profitTakingAnalysis = []
            let grossMfeRArrayLength = grossMfeRArray.length
            let netMfeRArrayLength = netMfeRArray.length
            let previousGrossExpectReturn = 0
            let previousNetExpectReturn = 0
            let tempGrossMfeR
            let tempGrossExpectedReturn = 0
            let tempNetMfeR
            let tempNetExpectedReturn = 0
            takeProfitRLevels.forEach(element => {
                let temp = {}
                let occurenceGross = grossMfeRArray.filter(x => x >= element).length
                let occurenceNet = netMfeRArray.filter(x => x >= element).length
                temp.rLevel = element
                temp.winRateGross = grossMfeRArrayLength ? (occurenceGross / grossMfeRArrayLength) : 0
                temp.grossExpectReturn = temp.winRateGross * element
                temp.winRateNet = netMfeRArrayLength ? (occurenceNet / netMfeRArrayLength) : 0
                temp.netExpectReturn = temp.winRateNet * element
                if (temp.grossExpectReturn > previousGrossExpectReturn) {
                    previousGrossExpectReturn = temp.grossExpectReturn
                    tempGrossMfeR = element
                    tempGrossExpectedReturn = temp.grossExpectReturn
                }
                if (temp.netExpectReturn > previousNetExpectReturn) {
                    previousNetExpectReturn = temp.netExpectReturn
                    tempNetMfeR = element
                    tempNetExpectedReturn = temp.netExpectReturn
                }
                profitTakingAnalysis.push(temp)
            });
            //console.log("  --> Profit Taking Analysis "+JSON.stringify(profitTakingAnalysis))
            //console.table(profitTakingAnalysis)
            profitAnalysis.grossMfeR = null
            profitAnalysis.netMfeR = null
            // Require at least 10 trades with excursion data for statistical significance
            const MIN_MFE_TRADES = 10
            if (grossMfeRArrayLength >= MIN_MFE_TRADES && tempGrossExpectedReturn > grossCurrExpectReturn) profitAnalysis.grossMfeR = tempGrossMfeR
            if (netMfeRArrayLength >= MIN_MFE_TRADES && tempNetExpectedReturn > netCurrExpectReturn) profitAnalysis.netMfeR = tempNetMfeR

            //console.log("  --> Gross MFE " + profitAnalysis.grossMfeR + " and net " + profitAnalysis.netMfeR)
            //console.log("  --> Profit analysis " + JSON.stringify(profitAnalysis))
        }

}

// `calculateSatisfaction` stand hier bis zum Audit vom 19.08.2026: nirgends
// aufgerufen, und die Funktion wies einer nicht deklarierten Variablen
// (`mfePricesArray`) zu — ein Aufruf hätte im Strict-Modus einen
// ReferenceError geworfen. Ersatzlos entfernt.

/* useRefreshTrades moved to src/utils/mountOrchestration.js */

/***************************************
* IMPORTS
***************************************/

export const useDeleteTrade = async () => {
    const existing = await dbFirst("trades", {
        equalTo: { dateUnix: selectedItem.value }
    })

    if (existing) {
        const broker = existing.broker || 'bitunix'
        await dbDelete("trades", existing.objectId)
        console.log('  --> Deleted trade with id ' + existing.objectId + ' (broker: ' + broker + ')')

        // Reset lastApiImport so deleted trades can be re-imported
        try {
            await axios.post(`/api/${broker}/last-import`, { timestamp: 0 })
            console.log(`  --> Reset ${broker} lastApiImport for re-import`)
        } catch (e) {
            console.log('  --> Could not reset lastApiImport:', e.message)
        }

        // Kontostand-Cache aktualisieren — Geloeschter Trade muss aus der
        // Summe verschwinden.
        try {
            await refreshAccountBalance({ broker, force: true })
        } catch (e) {
            console.log('  --> refreshAccountBalance nach Trade-Delete fehlgeschlagen:', e?.message)
        }

        useGetTrades("imports")
    } else {
        alert("There was problem with deleting trade")
        throw new Error("There was problem with deleting trade")
    }
}

export const useDeleteExcursions = async () => {
    try {
        await dbDeleteWhere("excursions", {
            equalTo: { dateUnix: selectedItem.value }
        })
        console.log('  --> Deleted excursions for dateUnix ' + selectedItem.value)
    } catch (error) {
        alert("There was a problem with deleting excursions")
        throw error
    }
}
