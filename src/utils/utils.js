import { useRoute } from "vue-router";
import { nextTick } from 'vue';
import { pageId, timeZoneTrade, currentUser, periodRange, selectedDashTab, renderData, selectedPeriodRange, selectedPositions, selectedTimeFrame, selectedRatio, selectedAccount, selectedGrossNet, selectedPlSatisfaction, selectedBroker, selectedDateRange, selectedMonth, selectedAccounts, amountCase, screenshotsPagination, selectedItem, sideMenuMobileOut, spinnerLoadingPage, dashboardChartsMounted, dashboardIdMounted, hasData, renderingCharts, screenType, selectedRange, dailyQueryLimit, dailyPagination, endOfList, spinnerLoadMore, windowIsScrolled, legacy, selectedTags, tags, filteredTrades, idCurrent, idPrevious, idCurrentType, idCurrentNumber, idPreviousType, idPreviousNumber, screenshots, screenshotsInfos, tabGettingScreenshots, apis, layoutStyle, countdownInterval, countdownSeconds, barChartNegativeTagGroups, availableTags, groups, selectedTradeTimeframes, auswertungMounted } from "../stores/globals.js"
import { useECharts, useRenderDoubleLineChart, useRenderPieChart } from './charts.js';
import { useDeleteScreenshot, useGetScreenshots, useGetScreenshotsPagination } from '../utils/screenshots.js'
import { useCalculateProfitAnalysis, useGetFilteredTrades, useGetFilteredTradesForDaily, useGroupTrades, useTotalTrades, useDeleteTrade, useDeleteExcursions } from "./trades.js";
import { useLoadCalendar } from "./calendar.js";
import { useGetAvailableTags, useGetExcursions, useGetSatisfactions, useGetTags, useGetNotes, useGetAuswertungNotes } from "./daily.js";

/* MODULES */
import { dbGetSettings, dbUpdateSettings } from './db.js'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
dayjs.extend(utc)
import isoWeek from 'dayjs/plugin/isoWeek.js'
dayjs.extend(isoWeek)
import timezone from 'dayjs/plugin/timezone.js'
dayjs.extend(timezone)
import duration from 'dayjs/plugin/duration.js'
dayjs.extend(duration)
import updateLocale from 'dayjs/plugin/updateLocale.js'
dayjs.extend(updateLocale)
import localizedFormat from 'dayjs/plugin/localizedFormat.js'
dayjs.extend(localizedFormat)
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
dayjs.extend(customParseFormat)
import axios from 'axios'

/**************************************
* INITS
**************************************/

export function useInitTab(param) {
    console.log("\nINIT TAB for " + param)

    let hideCurrentTab = false
    let htmlIdCurrent
    let htmlIdPrevious
    let firstTimeClick
    idCurrent.value = undefined // we set (back) to undefined because when click on modal on daily, we hide the tabs so we need to reinitiate them
    idPrevious.value = undefined

    var triggerTabList = [].slice.call(document.querySelectorAll('#nav-tab button'))
    //console.log("trigger tab list "+triggerTabList)
    var self = // is.value needed or else could not call function inside eventlistener


        triggerTabList.forEach((triggerEl) => {
            //console.log("triggerEl "+triggerEl.getAttribute('id'))
            /*var tabTrigger = new bootstrap.Tab(triggerEl)
            triggerEl.addEventListener('click', function(event) {
                console.log("clicking")
                //event.preventDefault()
                //tabTrigger.show()
            })*/
            if (param == "dashboard") {
                // GET TAB ID THAT IS CLICKED
                //console.log(" -> triggerTabList Dashboard")
                triggerEl.addEventListener('shown.bs.tab', async (event) => {
                    //console.log("target " + event.target.getAttribute('id')) // newly activated tab
                    selectedDashTab.value = event.target.getAttribute('id')
                    console.log("selected tab " + selectedDashTab.value)
                    localStorage.setItem('selectedDashTab', event.target.getAttribute('id'))
                    await (renderData.value += 1)
                    await useECharts("init")
                    //console.log("related" + event.relatedTarget) // previous active tab
                })
            }

            if (param == "daily") {
                // GET TAB ID THAT IS CLICKED

                //console.log(" -> triggerTabList Daily")
                let idClicked
                triggerEl.addEventListener('click', async (event) => {
                    /*if (idClicked == event.target.getAttribute('id')) {
                        console.log(" already clicked")
                    } else {
                        console.log(" first time clicked")
                        idClicked = event.target.getAttribute('id')
                    }
                    console.log(" -> Click on " + event.target.getAttribute('id'))
                    */
                    if (idCurrent.value != undefined) idPrevious.value = idCurrent.value // in case it's not on page load and we already are clicking on tabs, then inform that the previsous clicked tab (wich is for the moment current) should now become previous

                    idCurrent.value = event.target.getAttribute('id')


                    if (idPrevious.value == undefined) {
                        firstTimeClick = true
                        idPrevious.value = idCurrent.value //on page load, first time we click
                        hideCurrentTab = !hideCurrentTab // is.value counter intuitive but because further down we toggle hidCurrentTab, i need to toggle here if its first time click on load or else down there it would be hide true the first time. So here we set true so that further down, on first time click on page load it becomes false

                    }

                    //console.log(" -> id Current: " + idCurrent.value + " and previous: " + idPrevious.value)

                    idCurrentType.value = idCurrent.value.split('-')[0]
                    idCurrentNumber.value = idCurrent.value.split('-')[1]
                    idPreviousType.value = idPrevious.value.split('-')[0]
                    idPreviousNumber.value = idPrevious.value.split('-')[1]
                    htmlIdCurrent = "#" + idCurrentType.value + "Nav-" + idCurrentNumber.value
                    htmlIdPrevious = "#" + idPreviousType.value + "Nav-" + idPreviousNumber.value

                    //console.log(" -> Daily tab click on "+idCurrentType.value + " - index "+idCurrentNumber.value)
                    //console.log(" -> filtered trades "+JSON.stringify(filteredTrades[idCurrentNumber.value]))

                    if (idCurrentType.value === "screenshots") {
                        let screenshotsDate = filteredTrades[idCurrentNumber.value].dateUnix
                        // Match by dateUnixDay or by startOfDay(dateUnix) for timezone robustness
                        let index = screenshotsInfos.findIndex(obj =>
                            obj.dateUnixDay == screenshotsDate ||
                            useStartOfDay(obj.dateUnix) == screenshotsDate
                        )
                        if (index != -1) {
                            let queryDate = screenshotsInfos[index].dateUnixDay
                            if (screenshots.length == 0 || (screenshots.length > 0 && screenshots[0].dateUnixDay != queryDate)) {
                                console.log("  --> getting Screenshots")
                                await (tabGettingScreenshots.value = true)
                                await useGetScreenshots(true, queryDate)
                                await (tabGettingScreenshots.value = false)
                            } else {
                                console.log("  --> Screenshots already stored")
                            }
                        } else {
                            console.log("  --> No screenshots")
                        }
                    }

                    if (idCurrent.value == idPrevious.value) {
                        hideCurrentTab = !hideCurrentTab;

                        if (hideCurrentTab) { // hide content
                            document.querySelector(htmlIdCurrent).classList.remove('show');
                            document.querySelector(htmlIdCurrent).classList.remove('active');
                            document.getElementById(idCurrent.value).classList.remove('active');
                        } else { // show content
                            document.querySelector(htmlIdCurrent).classList.add('show');
                            document.querySelector(htmlIdCurrent).classList.add('active');
                            document.getElementById(idCurrent.value).classList.add('active');
                        }
                    } else {
                        hideCurrentTab = false;

                        // In case of a different tab click, reset the previous tab
                        document.querySelector(htmlIdPrevious).classList.remove('show');
                        document.querySelector(htmlIdPrevious).classList.remove('active');
                        document.getElementById(idPrevious.value).classList.remove('active');
                    }

                })
            }
        })


}

export function useInitParse() {
    return useInitApp()
}

export function useInitApp() {
    return new Promise(async (resolve, reject) => {
        console.log("\nINITIATING APP")
        try {
            const settings = await dbGetSettings()
            currentUser.value = settings
            // Timeframes aus Settings laden
            selectedTradeTimeframes.splice(0)
            const tfs = settings.tradeTimeframes || []
            if (Array.isArray(tfs)) {
                tfs.forEach(v => selectedTradeTimeframes.push(v))
            }
            console.log(" -> Settings loaded")
        } catch (error) {
            console.log(" -> Error loading settings: " + error)
            currentUser.value = {}
        }
        resolve()
    })
}

export function useCheckCurrentUser() {
    console.log("\nCHECKING CURRENT USER")
    return new Promise(async (resolve, reject) => {
        await useGetCurrentUser()
        resolve()
    })
}

export const useGetCurrentUser = async () => {
    try {
        const settings = await dbGetSettings()
        currentUser.value = settings
    } catch (error) {
        currentUser.value = {}
    }
}

export function useGetTimeZone() {
    //console.log("Getting timezone")
    timeZoneTrade.value = currentUser.value.hasOwnProperty("timeZone") ? currentUser.value.timeZone : 'America/New_York'
    console.log(" -> TimeZone for Trades: " + timeZoneTrade.value)
}

export async function useGetPeriods() {
    //console.log(" -> Getting periods")
    return new Promise((resolve, reject) => {
        let temp = [{
            value: "all",
            label: "Gesamt",
            start: 0,
            end: 0
        }, {
            value: "thisWeek",
            label: "Diese Woche",
            start: Number(dayjs().tz(timeZoneTrade.value).startOf('week').add(1, 'day').unix()), // we need to transform as number because later it's stringified and this becomes date format and note unix format
            end: Number(dayjs().tz(timeZoneTrade.value).endOf('week').add(1, 'day').unix())
        }, {
            value: "lastWeek",
            label: "Letzte Woche",
            start: Number(dayjs().tz(timeZoneTrade.value).subtract(1, 'week').startOf('week').add(1, 'day').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).subtract(1, 'week').endOf('week').add(1, 'day').unix())
        }, {
            value: "lastWeekTilNow",
            label: "Letzte Woche bis jetzt",
            start: Number(dayjs().tz(timeZoneTrade.value).subtract(1, 'week').startOf('week').add(1, 'day').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).endOf('week').add(1, 'day').unix())
        }, {
            value: "lastTwoWeeks",
            label: "Letzte zwei Wochen",
            start: Number(dayjs().tz(timeZoneTrade.value).subtract(2, 'week').startOf('week').add(1, 'day').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).subtract(1, 'week').endOf('week').add(1, 'day').unix())
        }, {
            value: "lastTwoWeeksTilNow",
            label: "Letzte zwei Wochen bis jetzt",
            start: Number(dayjs().tz(timeZoneTrade.value).subtract(2, 'week').startOf('week').add(1, 'day').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).endOf('week').add(1, 'day').unix())
        }, {
            value: "thisMonth",
            label: "Dieser Monat",
            start: Number(dayjs().tz(timeZoneTrade.value).startOf('month').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).endOf('month').unix())
        }, {
            value: "lastMonth",
            label: "Letzter Monat",
            start: Number(dayjs().tz(timeZoneTrade.value).subtract(1, 'month').startOf('month').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).subtract(1, 'month').endOf('month').unix())
        }, {
            value: "lastMonthTilNow",
            label: "Letzter Monat bis jetzt",
            start: Number(dayjs().tz(timeZoneTrade.value).subtract(1, 'month').startOf('month').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).endOf('month').unix())
        }, {
            value: "lastTwoMonths",
            label: "Letzte zwei Monate",
            start: Number(dayjs().tz(timeZoneTrade.value).subtract(2, 'month').startOf('month').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).subtract(1, 'month').endOf('month').unix())
        }, {
            value: "lastTwoMonthsTilNow",
            label: "Letzte zwei Monate bis jetzt",
            start: Number(dayjs().tz(timeZoneTrade.value).subtract(2, 'month').startOf('month').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).endOf('month').unix())
        }, {
            value: "lastThreeMonths",
            label: "Letzte drei Monate",
            start: Number(dayjs().tz(timeZoneTrade.value).subtract(3, 'month').startOf('month').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).subtract(1, 'month').endOf('month').unix())
        }, {
            value: "lastThreeMonthsTilNow",
            label: "Letzte drei Monate bis jetzt",
            start: Number(dayjs().tz(timeZoneTrade.value).subtract(3, 'month').startOf('month').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).endOf('month').unix())
        }, {
            value: "thisYear",
            label: "Dieses Jahr",
            start: Number(dayjs().tz(timeZoneTrade.value).startOf('year').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).endOf('year').unix())
        }, {
            value: "lastYear",
            label: "Letztes Jahr",
            start: Number(dayjs().tz(timeZoneTrade.value).subtract(1, 'year').startOf('year').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).subtract(1, 'year').endOf('year').unix())
        }, {
            value: "custom",
            label: "Benutzerdefiniert",
            start: -1,
            end: -1
        }]
        periodRange.length = 0
        temp.forEach(element => {
            periodRange.push(element)
        });
        resolve()
    });
}

export async function useInitQuill(param) {
    return new Promise((resolve, reject) => {
        //console.log("param " + param)
        let quillEditor
        if (param != undefined) {
            quillEditor = '#quillEditor' + param
        } else {
            quillEditor = '#quillEditor'
        }
        //console.log("quilEditor " + quillEditor)
        let quill = new Quill(quillEditor, {
            modules: {
                toolbar: [
                    [{ header: [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    [{ 'indent': '-1' }, { 'indent': '+1' }],
                    ['image'],
                ]
            },
            theme: 'snow'
        });
        quill.root.setAttribute('spellcheck', true)
        //console.log("quill " + quill)

        quill.on('text-change', () => {
            if (pageId.value == "addScreenshot") {
                setupUpdate.value.checkList = document.querySelector(".ql-editor").innerHTML
                //console.log("setup " + JSON.stringify(setupUpdate.value))
            }

        });
        resolve()
    })
}


export function useInitPopover() {
    console.log(" -> Init Popover");

    var popoverTriggerList

    const getTriggerList = () => {
        popoverTriggerList = document.querySelectorAll('[data-bs-toggle="popover"]');
        popoverTriggerList.forEach(function (popoverTriggerEl) {

            new bootstrap.Popover(popoverTriggerEl);
        });
    }

    getTriggerList()

    var popDel;

    document.addEventListener('click', async function (e) {
        if (e.target.classList.contains('popoverDelete')) {
            popDel = e.target;
            document.querySelectorAll('.popoverDelete').forEach(function (popDelete) {
                if (popDelete !== popDel) {
                    const popoverInstance = bootstrap.Popover.getInstance(popDelete);
                    if (popoverInstance) {
                        popoverInstance.hide();
                    }
                }
            });
        }

        if (e.target.classList.contains('popoverYes')) {
            document.querySelectorAll('.popoverDelete').forEach(function (popDelete) {
                if (popDelete === popDel) {
                    bootstrap.Popover.getInstance(popDelete).hide();
                }
            });
            if (pageId.value == "notes") {
                deleteNote.value();
            }
            if (pageId.value == "screenshots" || pageId.value == "daily") {
                useDeleteScreenshot();
            }
            if (pageId.value === "imports") {
                await useDeleteTrade()
                await useDeleteExcursions()
            }
        }

        if (e.target.classList.contains('popoverNo')) {
            document.querySelectorAll('.popoverDelete').forEach(function (popDelete) {
                if (popDelete === popDel) {
                    //console.log(" popDelete " + popDelete.classList)
                    //console.log(" popDel " + popDel.classList)
                    bootstrap.Popover.getInstance(popDelete).hide();
                }
            });
            selectedItem.value = null;
        }
    });
}

export function useInitTooltip() {
    //console.log(" -> Init Tooltip")
    let tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'))
    tooltipTriggerList.map((tooltipTriggerEl) => {
        return new bootstrap.Tooltip(tooltipTriggerEl)
    })

}

/**************************************
* MOUNT 
**************************************/
export async function useMountDashboard() {
    try {
        console.log("\MOUNTING DASHBOARD")
        console.time("  --> Duration mount dashboard");
        spinnerLoadingPage.value = true
        dashboardChartsMounted.value = false
        dashboardIdMounted.value = false
        barChartNegativeTagGroups.value = []
        await useGetSelectedRange()
        console.log(" -> Selected range done")
        await Promise.all([useGetExcursions(), useGetSatisfactions(), useGetTags()])
        console.log(" -> Excursions/satisfactions/tags done")
        await useGetFilteredTrades()
        console.log(" -> Filtered trades done")
        await useTotalTrades()
        console.log(" -> Total trades done")
        await useGroupTrades()
        console.log(" -> Group trades done")
        await useCalculateProfitAnalysis()
        console.log(" -> Profit analysis done")
        spinnerLoadingPage.value = false
        dashboardIdMounted.value = true
        useInitTab("dashboard")
        await nextTick()
        useInitTooltip()
        availableTags.forEach(element => {
            let index = Object.keys(groups).indexOf(element.id);
            if (index != -1) {
                let temp = {}
                temp.id = element.id
                temp.name = element.name
                barChartNegativeTagGroups.value.push(temp)
            }
        });
        console.timeEnd("  --> Duration mount dashboard");
        if (hasData.value) {
            console.log("\nBUILDING CHARTS")
            dashboardChartsMounted.value = true
            renderData.value += 1
            await nextTick()
            await useECharts("init")
        }
    } catch (error) {
        console.error("DASHBOARD MOUNT ERROR:", error)
        spinnerLoadingPage.value = false
    }
}

export async function useMountDaily() {
    console.log("\MOUNTING DAILY")
    console.time("  --> Duration mount daily");
    dailyPagination.value = 0
    dailyQueryLimit.value = 3
    endOfList.value = false
    spinnerLoadingPage.value = true
    await useGetSelectedRange()
    await Promise.all([useGetExcursions(), useGetSatisfactions(), useGetTags(), useGetAvailableTags(), useGetNotes(), useGetAPIS()])
    await useGetFilteredTrades()
    spinnerLoadingPage.value = false
    console.timeEnd("  --> Duration mount daily")
    useInitTab("daily")
    useRenderDoubleLineChart()
    useRenderPieChart()
    useLoadCalendar()
    useGetScreenshots(true)
    useInitPopover()
    renderingCharts.value = false

    //useInitPopover()


}

export async function useMountCalendar(param) {
    console.log("\MOUNTING CALENDAR")
    console.time("  --> Duration mount calendar");
    spinnerLoadingPage.value = true
    try {
        await useGetSelectedRange()
        console.log(" -> selectedRange:", JSON.stringify(selectedRange.value))
        console.log(" -> selectedMonth:", JSON.stringify(selectedMonth.value))
        await Promise.all([useGetTags(), useGetAvailableTags()])
        await useGetFilteredTrades()
        console.log(" -> filteredTrades count:", filteredTrades.length)
        await useLoadCalendar() // if param (true), then its coming from next or filter so we need to get filteredTrades (again)
    } catch (error) {
        console.error("MOUNT CALENDAR ERROR:", error)
    }
    spinnerLoadingPage.value = false
    console.timeEnd("  --> Duration mount calendar")
}

export async function useMountScreenshots() {
    spinnerLoadingPage.value = true
    console.log("\MOUNTING SCREENSHOTS")
    console.time("  --> Duration mount screenshots");
    useGetScreenshotsPagination()
    await useGetSelectedRange()
    await Promise.all([useGetTags(), useGetAvailableTags()])
    await useGetScreenshots(false)
    console.timeEnd("  --> Duration mount screenshots")
    useInitPopover()
}

export async function useMountAuswertung() {
    try {
        console.log("\nMOUNTING AUSWERTUNG")
        spinnerLoadingPage.value = true
        auswertungMounted.value = false

        await useGetSelectedRange()
        await Promise.all([
            useGetAuswertungNotes(),
            useGetSatisfactions(),
            useGetTags()
        ])
        // useGetAvailableTags() wird bereits im Dashboard-Layout geladen
        await useGetFilteredTrades()

        spinnerLoadingPage.value = false
        auswertungMounted.value = true

        await nextTick()
        useInitTooltip()
    } catch (error) {
        console.error("AUSWERTUNG MOUNT ERROR:", error)
        spinnerLoadingPage.value = false
    }
}

export function useCheckVisibleScreen() {
    let visibleScreen = (window.innerHeight) // adding 200 so that loads before getting to bottom
    let documentHeight = document.documentElement.scrollHeight
    //console.log("visible screen " + visibleScreen)
    //console.log("documentHeight " + documentHeight)
    if (visibleScreen >= documentHeight) {
        useLoadMore()
    }
}

export async function useLoadMore() {
    console.log("  --> Loading more")
    spinnerLoadMore.value = true

    if (pageId.value == "daily") {
        await useGetFilteredTradesForDaily()
        await Promise.all([useRenderDoubleLineChart(), useRenderPieChart()])
        await useInitTab("daily")
        //await (renderingCharts.value = false)
    }

    if (pageId.value == "screenshots") {
        await useGetScreenshots(false)
    }

    spinnerLoadMore.value = false

}

export function useCheckIfWindowIsScrolled() {
    window.addEventListener('scroll', () => {
        windowIsScrolled.value = window.scrollY > 100;
    });
}

/**************************************
* MISC
**************************************/
export function usePageId() {
    const route = useRoute()
    pageId.value = route.name
    console.log("\n======== " + pageId.value.charAt(0).toUpperCase() + pageId.value.slice(1) + " Page/View ========\n")
    return pageId.value
}

export function useGetSelectedRange() {
    return new Promise(async (resolve, reject) => {
        if (pageId.value == "dashboard" || pageId.value == "auswertung") {
            selectedRange.value = selectedDateRange.value
        } else if (pageId.value == "calendar") {
            selectedRange.value = {}
            selectedRange.value.start = dayjs.unix(selectedMonth.value.start).tz(timeZoneTrade.value).startOf('year').unix()
            selectedRange.value.end = selectedMonth.value.end
            //console.log("SelectedRange "+JSON.stringify(selectedRange.value))
        }
        else {
            selectedRange.value = selectedMonth.value
        }
        //console.log("SelectedRange "+JSON.stringify(selectedRange.value))
        resolve()
    })
}

export function useScreenType() {
    let screenWidth = (window.innerWidth > 0) ? window.innerWidth : screen.width
    screenType.value = (screenWidth >= 992) ? 'computer' : 'mobile'
}

export async function useSetValues() {
    return new Promise(async (resolve, reject) => {
        console.log(" -> Setting selected local storage")
        //console.log("Period Range "+JSON.stringify(periodRange))
        //console.log("now "+dayjs().tz(timeZoneTrade.value).startOf('month').unix())
        if (!localStorage.getItem('selectedDashTab')) localStorage.setItem('selectedDashTab', 'overviewTab')
        selectedDashTab.value = localStorage.getItem('selectedDashTab')

        if (Object.is(localStorage.getItem('selectedPositions'), null)) localStorage.setItem('selectedPositions', ["long", "short"])
        selectedPositions.value = localStorage.getItem('selectedPositions').split(",")

        if (!localStorage.getItem('selectedTimeFrame')) localStorage.setItem('selectedTimeFrame', "daily")
        selectedTimeFrame.value = localStorage.getItem('selectedTimeFrame')

        if (!localStorage.getItem('selectedRatio') || localStorage.getItem('selectedRatio') === 'apps') localStorage.setItem('selectedRatio', "appt")
        selectedRatio.value = localStorage.getItem('selectedRatio')

        if (!localStorage.getItem('selectedAccount')) localStorage.setItem('selectedAccount', "all")
        selectedAccount.value = localStorage.getItem('selectedAccount')

        if (!localStorage.getItem('selectedGrossNet')) localStorage.setItem('selectedGrossNet', "gross")
        selectedGrossNet.value = localStorage.getItem('selectedGrossNet')

        if (!localStorage.getItem('selectedPlSatisfaction')) localStorage.setItem('selectedPlSatisfaction', "pl")
        selectedPlSatisfaction.value = localStorage.getItem('selectedPlSatisfaction')

        if (!localStorage.getItem('selectedBroker')) localStorage.setItem('selectedBroker', "bitunix")
        selectedBroker.value = localStorage.getItem('selectedBroker')

        if (!localStorage.getItem('selectedDateRange')) localStorage.setItem('selectedDateRange', JSON.stringify({ start: periodRange.filter(element => element.value == 'thisYear')[0].start, end: periodRange.filter(element => element.value == 'thisYear')[0].end }))
        selectedDateRange.value = JSON.parse(localStorage.getItem('selectedDateRange'))

        if (!localStorage.getItem('selectedPeriodRange')) {
            let tempFilter = periodRange.filter(element => element.start == selectedDateRange.value.start && element.end == selectedDateRange.value.end)
            //console.log("selectedDateRange.value "+JSON.stringify(selectedDateRange.value))
            //console.log("tempFilter  "+tempFilter)
            if (tempFilter.length > 0) {
                localStorage.setItem('selectedPeriodRange', JSON.stringify(tempFilter[0]))
            } else {
                console.log(" -> Custom range in vue")
                localStorage.setItem('selectedPeriodRange', JSON.stringify(periodRange.filter(element => element.start == -1)[0]))
            }
        }
        selectedPeriodRange.value = JSON.parse(localStorage.getItem('selectedPeriodRange'))

        if (!localStorage.getItem('selectedMonth')) localStorage.setItem('selectedMonth', JSON.stringify({ start: periodRange.filter(element => element.value == 'thisMonth')[0].start, end: periodRange.filter(element => element.value == 'thisMonth')[0].end }))
        selectedMonth.value = JSON.parse(localStorage.getItem('selectedMonth'))

        if (Object.is(localStorage.getItem('selectedAccounts'), null) && currentUser.value && currentUser.value.hasOwnProperty("accounts") && currentUser.value.accounts.length > 0) {
            currentUser.value.accounts.forEach(element => {
                selectedAccounts.value.push(element.value)
            });
            //console.log("selected accounts " + JSON.stringify(selectedAccounts))
            localStorage.setItem('selectedAccounts', selectedAccounts.value)
            selectedAccounts.value = localStorage.getItem('selectedAccounts').split(",")
        }

        let selectedTagsNull = Object.is(localStorage.getItem('selectedTags'), null)
        console.log("selectedTagsNull " + selectedTagsNull)
        if (selectedTagsNull) {
            await useGetTags()
            if (selectedTagsNull) {
                console.log("selected tags is null — selecting all tags")
                selectedTags.value.push("t000t")
                // Alle verfügbaren Tags auch auswählen
                await useGetAvailableTags()
                for (const group of availableTags) {
                    for (const tag of group.tags) {
                        selectedTags.value.push(tag.id)
                    }
                }

                tags.length = 0 // I'm already reseting in useGetPatterns but for some reason it would not be fast enough for this case
                localStorage.setItem('selectedTags', selectedTags.value)
                console.log("selectedTags " + JSON.stringify(selectedTags.value))
            }

        }


        amountCase.value = localStorage.getItem('selectedGrossNet')
        //console.log('amount case '+amountCase.value)
        resolve()
    })
}

export function useEditItem(param) {
    sessionStorage.setItem('editItemId', param);
    if (pageId.value == "entries") {
        window.location.href = "/addEntry"
    }
    if (pageId.value == "screenshots") {
        sessionStorage.setItem('screenshotsPagination', screenshotsPagination.value);
        sessionStorage.setItem('screenshotIdToEdit', param) //We use this to scroll to watched id on screenshots page. We e rase it in scrollToScreenshot

        window.location.href = "/addScreenshot"
    }
}

export function usePageRedirect(param) {
    if (param) {
        window.location.href = "/" + param
    }
    if (pageId.value == "daily") {
        window.location.href = "/daily"
    }

}

export function useToggleMobileMenu() {
    let element = document.getElementById("sideMenu");
    element.classList.toggle("toggleSideMenu");
    sideMenuMobileOut.value = !sideMenuMobileOut.value
    console.log("sideMenuMobileOut " + sideMenuMobileOut.value)
}

export function useCapitalizeFirstLetter(param) {
    return param.charAt(0).toUpperCase() + param.slice(1)
}

export function returnToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}


export const useGetLegacy = async () => {
    console.log(" -> Getting legacy information")
    return new Promise(async (resolve, reject) => {
        // Legacy is no longer tracked in single-user mode
        console.log("  --> Legacy skipped (single-user)")
        resolve()
    })
}

export const useUpdateLegacy = async (param1) => {
    console.log("\n -> Updating legacy information")
    return new Promise(async (resolve, reject) => {
        // Legacy is no longer tracked in single-user mode
        resolve()
    })
}

export const useGetAPIS = async () => {
    console.log("\n -> Getting APIS")
    apis.length = 0
    return new Promise(async (resolve, reject) => {
        const settings = await dbGetSettings()
        if (settings && settings.apis != undefined) {
            for (let index = 0; index < settings.apis.length; index++) {
                const element = settings.apis[index];
                apis.push(element)
            }
        }
        resolve()
    })
}

export const useGetLayoutStyle = async () => {
    console.log("\n -> Getting Layout Style")
    layoutStyle.length = 0
    return new Promise(async (resolve, reject) => {
        const settings = await dbGetSettings()
        if (settings && settings.layoutStyle != undefined) {
            for (let index = 0; index < settings.layoutStyle.length; index++) {
                const element = settings.layoutStyle[index];
                layoutStyle.push(element)
            }
        }
        resolve()
    })
}

export const useExport = async (param1, param2, param3, param4) => {
    // Convert the JSON object to a string
    let blobData
    let exportName = param2 
    if (param3 != null){
        exportName = exportName + "_" + param3
    }
    
    let exportExt
    let csvSeparation = ";"

    if (param1 == "json") {
        const jsonData = JSON.stringify(param4, null, 2);

        // Create a blob from the JSON string
        blobData = new Blob([jsonData], { type: "application/json" });
        exportExt = ".json"

    }
    if (param1 == "csv") {
        // Extract the header row from the JSON object
        const headers = Object.keys(param4[0]);
        const csvRows = [headers.join(csvSeparation)];

        // Convert the JSON object to a CSV string
        param4.forEach(row => {
            const csvRow = headers.map(header => {
                return row[header];
            }).join(csvSeparation);
            csvRows.push(csvRow);
        });

        // Create a blob from the CSV string
        const csvString = csvRows.join("\n");
        blobData = new Blob([csvString], { type: "text/csv" });
        exportExt = ".csv"

    }

    // Create a link element to download the file
    const url = URL.createObjectURL(blobData);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportName + "" + exportExt
    a.click();

    // Release the blob URL
    URL.revokeObjectURL(url);
}
/**************************************
* DATE FORMATS
**************************************/
export function useDateNumberFormat(param) {
    return Number(Math.trunc(param)) //we have to use /1000 and not unix because or else does not take into account tz
}

export function useDateCalFormat(param) {
    return dayjs.unix(param).tz(timeZoneTrade.value).format("YYYY-MM-DD")
}

export function useDateCalFormatMonth(param) {
    return dayjs.unix(param).tz(timeZoneTrade.value).format("YYYY-MM")
}

export function useTimeFormat(param) {
    return dayjs.unix(param).tz(timeZoneTrade.value).format("HH:mm:ss")
}

export function useTimeFormatFromDate(param) {
    return dayjs(param).tz(timeZoneTrade.value).format("HH:mm:ss")
}

export function useTimeDuration(param) {
    return dayjs.duration(param * 1000).format("HH:mm:ss")
}

export function useSwingDuration(param) {
    let duration = Number(dayjs.duration(param * 1000).format("D"))
    let period
    duration > 1 ? period = "days" : period = "day"
    return (duration + " " + period)
}

export function useHourMinuteFormat(param) {
    return dayjs.unix(param).tz(timeZoneTrade.value).format("HH:mm")
}

export function useDateTimeFormat(param) {
    return dayjs.unix(param).tz(timeZoneTrade.value).format("YYYY-MM-DD HH:mm:ss")
}

export function useChartFormat(param) {
    return dayjs.unix(param).tz(timeZoneTrade.value).format("D.M.YYYY")
}

export function useMonthFormat(param) {
    return dayjs.unix(param).tz(timeZoneTrade.value).format("MMMM YYYY")
}

export function useMonthFormatShort(param) {
    return dayjs.unix(param).tz(timeZoneTrade.value).format("MMM YY")
}

export function useCreatedDateFormat(param) {
    return dayjs.unix(param).tz(timeZoneTrade.value).format("ddd DD MMMM YYYY")
}

export function useDatetimeLocalFormat(param) {
    return dayjs.tz(param * 1000, timeZoneTrade.value).format("YYYY-MM-DDTHH:mm:ss") //here we ne
}

export function useStartOfDay(param) {
    return dayjs(param * 1000).tz(timeZoneTrade.value).startOf("day").unix()
}
/**************************************
* NUMBER FORMATS
**************************************/
export function useThousandCurrencyFormat(param) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, style: 'currency', currency: 'USD' }).format(param)
}

export function useThousandFormat(param) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(param)
}

export function useTwoDecCurrencyFormat(param) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, style: 'currency', currency: 'USD' }).format(param)
}

export function useThreeDecCurrencyFormat(param) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3, style: 'currency', currency: 'USD' }).format(param)
}

export function useXDecCurrencyFormat(param, param2) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: param2, style: 'currency', currency: 'USD' }).format(param)
}

export function useTwoDecFormat(param) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(param)
}

export function useXDecFormat(param, param2) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: param2 }).format(param)
}

export function useOneDecPercentFormat(param) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, style: 'percent' }).format(param)
}

export function useTwoDecPercentFormat(param) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, style: 'percent' }).format(param)
}

export function useFormatBytes(param, decimals = 2) {
    if (param === 0) return '0 bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['param', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(param) / Math.log(k));
    return parseFloat((param / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function useDecimalsArithmetic(param1, param2) {
    //https://flaviocopes.com/javascript-decimal-arithmetics/
    return ((param1.toFixed(6) * 100) + (param2.toFixed(6) * 100)) / 100
}



