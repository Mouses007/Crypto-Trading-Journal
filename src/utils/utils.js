import { useRoute } from "vue-router";
import { nextTick } from 'vue';
import { pageId, timeZoneTrade, currentUser, renderData, screenshotsPagination, selectedItem, sideMenuMobileOut, spinnerLoadingPage, dashboardChartsMounted, dashboardIdMounted, hasData, renderingCharts, screenType, dailyQueryLimit, dailyPagination, endOfList, spinnerLoadMore, windowIsScrolled, legacy, idCurrent, idPrevious, idCurrentType, idCurrentNumber, idPreviousType, idPreviousNumber, tabGettingScreenshots, countdownInterval, countdownSeconds, barChartNegativeTagGroups, auswertungMounted } from "../stores/ui.js"
import { periodRange, selectedDashTab, selectedPeriodRange, selectedPositions, selectedTimeFrame, selectedRatio, selectedAccount, selectedGrossNet, selectedPlSatisfaction, selectedBroker, selectedDateRange, selectedMonth, selectedAccounts, amountCase, selectedRange, selectedTags, selectedTradeTimeframes } from "../stores/filters.js"
import { tags, filteredTrades, screenshots, screenshotsInfos, availableTags, groups } from "../stores/trades.js"
import { apis, layoutStyle } from "../stores/settings.js"
import { useECharts } from './charts.js';
import { useDeleteScreenshot, useGetScreenshots } from '../utils/screenshots.js'
import { useDeleteTrade, useDeleteExcursions } from "./trades.js";
import { useGetAvailableTags, useGetTags } from "./daily.js";
import { useStartOfDay } from './formatters.js'

/* MODULES */
import { dbGetSettings, dbUpdateSettings } from './db.js'
import dayjs from './dayjs-setup.js'
import axios from 'axios'
import i18n from '../i18n'
const _t = (key) => i18n.global.t(key)

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
                    renderData.value += 1
                    await nextTick()
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
            label: _t('options.total'),
            start: 0,
            end: 0
        }, {
            value: "thisWeek",
            label: _t('options.thisWeek'),
            start: Number(dayjs().tz(timeZoneTrade.value).startOf('week').add(1, 'day').unix()), // we need to transform as number because later it's stringified and this becomes date format and note unix format
            end: Number(dayjs().tz(timeZoneTrade.value).endOf('week').add(1, 'day').unix())
        }, {
            value: "lastWeek",
            label: _t('options.lastWeek'),
            start: Number(dayjs().tz(timeZoneTrade.value).subtract(1, 'week').startOf('week').add(1, 'day').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).subtract(1, 'week').endOf('week').add(1, 'day').unix())
        }, {
            value: "lastWeekTilNow",
            label: _t('options.lastWeekTilNow'),
            start: Number(dayjs().tz(timeZoneTrade.value).subtract(1, 'week').startOf('week').add(1, 'day').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).endOf('week').add(1, 'day').unix())
        }, {
            value: "thisMonth",
            label: _t('options.thisMonth'),
            start: Number(dayjs().tz(timeZoneTrade.value).startOf('month').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).endOf('month').unix())
        }, {
            value: "lastMonth",
            label: _t('options.lastMonth'),
            start: Number(dayjs().tz(timeZoneTrade.value).subtract(1, 'month').startOf('month').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).subtract(1, 'month').endOf('month').unix())
        }, {
            value: "lastMonthTilNow",
            label: _t('options.lastMonthTilNow'),
            start: Number(dayjs().tz(timeZoneTrade.value).subtract(1, 'month').startOf('month').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).endOf('month').unix())
        }, {
            value: "lastThreeMonths",
            label: _t('options.lastThreeMonths'),
            start: Number(dayjs().tz(timeZoneTrade.value).subtract(3, 'month').startOf('month').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).subtract(1, 'month').endOf('month').unix())
        }, {
            value: "lastThreeMonthsTilNow",
            label: _t('options.lastThreeMonthsTilNow'),
            start: Number(dayjs().tz(timeZoneTrade.value).subtract(3, 'month').startOf('month').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).endOf('month').unix())
        }, {
            value: "thisYear",
            label: _t('options.thisYear'),
            start: Number(dayjs().tz(timeZoneTrade.value).startOf('year').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).endOf('year').unix())
        }, {
            value: "lastYear",
            label: _t('options.lastYear'),
            start: Number(dayjs().tz(timeZoneTrade.value).subtract(1, 'year').startOf('year').unix()),
            end: Number(dayjs().tz(timeZoneTrade.value).subtract(1, 'year').endOf('year').unix())
        }, {
            value: "custom",
            label: _t('options.custom'),
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

/* Mount/orchestration functions: see src/utils/mountOrchestration.js */

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

        } else {
            // Auto-sync: Neue Tags die in Settings erstellt wurden automatisch in den Filter aufnehmen
            await useGetAvailableTags()
            const currentSelected = localStorage.getItem('selectedTags').split(",")
            let added = false
            for (const group of availableTags) {
                for (const tag of group.tags) {
                    if (!currentSelected.includes(tag.id)) {
                        currentSelected.push(tag.id)
                        added = true
                    }
                }
            }
            if (added) {
                selectedTags.value = currentSelected
                localStorage.setItem('selectedTags', selectedTags.value)
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

/* Formatter functions: see src/utils/formatters.js */

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
/* Formatter functions moved to src/utils/formatters.js */



