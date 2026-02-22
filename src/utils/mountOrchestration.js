/**
 * mountOrchestration.js — View mount functions and orchestration logic.
 * Extracted from utils.js to break circular dependencies.
 * This is a top-level orchestrator: imports from many modules but nothing
 * should import from it except Vue components and trades.js (useRefreshTrades).
 */
import { nextTick } from 'vue'
import { pageId, spinnerLoadingPage, dashboardChartsMounted, dashboardIdMounted, barChartNegativeTagGroups, timeZoneTrade, hasData, renderData, dailyPagination, dailyQueryLimit, endOfList, renderingCharts, spinnerLoadMore, auswertungMounted, screenshotsPagination } from "../stores/ui.js"
import { selectedRange, selectedDateRange, selectedMonth, selectedAccounts } from "../stores/filters.js"
import { filteredTrades, availableTags, groups } from "../stores/trades.js"
import { useCalculateProfitAnalysis, useGetFilteredTrades, useGetFilteredTradesForDaily, useGroupTrades, useTotalTrades } from "./trades.js"
import { useECharts, useRenderDoubleLineChart, useRenderPieChart } from './charts.js'
import { useGetScreenshots, useGetScreenshotsPagination } from './screenshots.js'
import { useLoadCalendar } from "./calendar.js"
import { useGetAvailableTags, useGetExcursions, useGetSatisfactions, useGetTags, useGetNotes, useGetAuswertungNotes } from "./daily.js"
import { useInitTab, useInitTooltip, useInitPopover, useGetAPIS } from "./utils.js"
import dayjs from './dayjs-setup.js'

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
    try {
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
    } catch (error) {
        console.error("DAILY MOUNT ERROR:", error)
        spinnerLoadingPage.value = false
    }
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
    try {
        spinnerLoadingPage.value = true
        console.log("\MOUNTING SCREENSHOTS")
        console.time("  --> Duration mount screenshots");
        useGetScreenshotsPagination()
        await useGetSelectedRange()
        await Promise.all([useGetTags(), useGetAvailableTags()])
        await useGetScreenshots(false)
        console.timeEnd("  --> Duration mount screenshots")
        useInitPopover()
    } catch (error) {
        console.error("SCREENSHOTS MOUNT ERROR:", error)
    } finally {
        spinnerLoadingPage.value = false
    }
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

export async function useRefreshTrades() {
    console.log("\nREFRESHING INFO")
    await (spinnerLoadingPage.value = true)
    if (pageId.value == "dashboard") {
        useMountDashboard()
    } else if (pageId.value == "daily") {
        useMountDaily()
    } else if (pageId.value == "calendar") {
        useMountCalendar()
    } else {
        window.location.href = "/dashboard"
    }
}

export async function useGetSelectedRange() {
    if (pageId.value == "dashboard" || pageId.value == "auswertung") {
        selectedRange.value = selectedDateRange.value
    } else if (pageId.value == "calendar") {
        selectedRange.value = {}
        selectedRange.value.start = dayjs.unix(selectedMonth.value.start).tz(timeZoneTrade.value).startOf('year').unix()
        selectedRange.value.end = selectedMonth.value.end
    }
    else {
        selectedRange.value = selectedMonth.value
    }
}
