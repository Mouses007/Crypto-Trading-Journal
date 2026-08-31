/**
 * mountOrchestration.js — View mount functions and orchestration logic.
 * Extracted from utils.js to break circular dependencies.
 * This is a top-level orchestrator: imports from many modules but nothing
 * should import from it except Vue components and trades.js (useRefreshTrades).
 */
import { nextTick } from 'vue'
import { pageId, spinnerLoadingPage, dashboardChartsMounted, dashboardIdMounted, barChartNegativeTagGroups, timeZoneTrade, hasData, renderData, dailyPagination, dailyQueryLimit, endOfList, renderingCharts, spinnerLoadMore, auswertungMounted, screenshotsPagination } from "../stores/ui.js"
import { selectedRange, selectedDateRange, selectedMonth, selectedAccounts, selectedPeriodRange } from "../stores/filters.js"
import { filteredTrades, availableTags, groups } from "../stores/trades.js"
import { useCalculateProfitAnalysis, useGetFilteredTrades, useGetFilteredTradesForDaily, useGroupTrades, useTotalTrades } from "./trades.js"
/*
 * Dynamisch, siehe SidebarFilters.vue: `charts.js` zieht das
 * ECharts-Vollbundle nach. Diese Datei ist ueber die Filterleiste am Layout
 * erreichbar; ein statischer Import legte ECharts in jedes Start-Bundle.
 * Geladen wird es genau dann, wenn ein Diagramm gezeichnet werden soll.
 */
let chartsModul = null
async function holeCharts() {
    if (!chartsModul) chartsModul = await import('./charts.js')
    return chartsModul
}
const useECharts = async (p) => (await holeCharts()).useECharts(p)

/**
 * Alle Journal-Diagramme der aktuellen Seite entsorgen.
 *
 * ECharts 5 hält jede Instanz in einer modulglobalen Registry, aus der nur
 * dispose() entfernt. Die Journal-Views ersetzen ihre Chart-Knoten beim
 * Seitenwechsel UND bei jedem Filterlauf (v-bind:key="renderData") — ohne
 * dispose blieben die alten Instanzen samt abgehängtem DOM und Canvas-Puffern
 * für immer referenziert (~5–10 Instanzen je Navigation). Die Kacheln machen
 * es längst richtig; dies ist dasselbe für den Alt-Pfad.
 *
 * Synchron: Die Knoten müssen eingesammelt werden, SOLANGE sie noch im
 * Dokument stehen (darum onBeforeUnmount, nicht onUnmounted); dispose über
 * die Registry funktioniert danach auch abgehängt. Ist charts.js noch nie
 * geladen worden, wurde auch nie ein Diagramm gebaut — nichts zu tun.
 */
export function useDisposeJournalCharts() {
    if (!chartsModul) return
    const knoten = Array.from(document.querySelectorAll('.chartClass, .chartIdCardClass, #candlestickChart'))
    if (knoten.length) chartsModul.disposeCharts(knoten)
}
const useRenderDoubleLineChart = async (...a) => (await holeCharts()).useRenderDoubleLineChart(...a)
const useRenderPieChart = async (...a) => (await holeCharts()).useRenderPieChart(...a)
import { useGetScreenshots, useGetScreenshotsPagination } from './screenshots.js'
import { useLoadCalendar } from "./calendar.js"
import { useGetAvailableTags, useGetExcursions, useGetSatisfactions, useGetTags, useGetNotes, useGetAuswertungNotes } from "./daily.js"
import { useInitTab, useInitTooltip, useInitPopover, useGetAPIS } from "./utils.js"
import dayjs from './dayjs-setup.js'

/**************************************
* MOUNT
**************************************/

/*
 * Abbruch-Marke gegen konkurrierende Mount-Ketten.
 *
 * Die useMount*-Funktionen sind lange await-Ketten und schreiben alle in
 * DIESELBEN globalen Stores (selectedRange, filteredTrades, groups, Spinner).
 * Wer während eines laufenden Mounts die Seite wechselte, startete eine zweite
 * Kette — und wessen Abruf zuletzt zurückkam, dessen Zeitfenster stand in
 * filteredTrades: die neue Seite konnte Trades mit dem Filter der alten
 * zeigen, und der Spinner verschwand, während die andere Kette noch lud.
 * Gleiches Muster wie `laufendeAnfrage` in useKachelRaster.js: jede Kette
 * nimmt sich eine Nummer und hört nach jedem Schritt auf, sobald eine jüngere
 * läuft — kein Fehler, die jüngere übernimmt Spinner und Stores.
 */
let mountGeneration = 0

export async function useMountDashboard() {
    const meine = ++mountGeneration
    const veraltet = () => meine !== mountGeneration
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
        if (veraltet()) return
        await useGetFilteredTrades()
        console.log(" -> Filtered trades done")
        if (veraltet()) return
        await useTotalTrades()
        console.log(" -> Total trades done")
        await useGroupTrades()
        console.log(" -> Group trades done")
        await useCalculateProfitAnalysis()
        console.log(" -> Profit analysis done")
        if (veraltet()) return
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
        if (hasData.value && !veraltet()) {
            console.log("\nBUILDING CHARTS")
            dashboardChartsMounted.value = true
            // Alte Instanzen entsorgen, BEVOR :key="renderData" die Knoten ersetzt
            useDisposeJournalCharts()
            renderData.value += 1
            await nextTick()
            if (veraltet()) return
            await useECharts("init")
        }
    } catch (error) {
        console.error("DASHBOARD MOUNT ERROR:", error)
        if (!veraltet()) spinnerLoadingPage.value = false
    }
}

export async function useMountDaily() {
    const meine = ++mountGeneration
    const veraltet = () => meine !== mountGeneration
    try {
        console.log("\MOUNTING DAILY")
        console.time("  --> Duration mount daily");
        dailyPagination.value = 0
        dailyQueryLimit.value = 3
        endOfList.value = false
        spinnerLoadingPage.value = true
        await useGetSelectedRange()
        await Promise.all([useGetExcursions(), useGetSatisfactions(), useGetTags(), useGetAvailableTags(), useGetNotes(), useGetAPIS()])
        if (veraltet()) return
        await useGetFilteredTrades()
        if (veraltet()) return
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
        if (!veraltet()) spinnerLoadingPage.value = false
    }
}

export async function useMountCalendar(param) {
    const meine = ++mountGeneration
    const veraltet = () => meine !== mountGeneration
    console.log("\MOUNTING CALENDAR")
    console.time("  --> Duration mount calendar");
    spinnerLoadingPage.value = true
    try {
        await useGetSelectedRange()
        console.log(" -> selectedRange:", JSON.stringify(selectedRange.value))
        console.log(" -> selectedMonth:", JSON.stringify(selectedMonth.value))
        await Promise.all([useGetTags(), useGetAvailableTags()])
        if (veraltet()) return
        await useGetFilteredTrades()
        console.log(" -> filteredTrades count:", filteredTrades.length)
        if (veraltet()) return
        await useLoadCalendar() // if param (true), then its coming from next or filter so we need to get filteredTrades (again)
    } catch (error) {
        console.error("MOUNT CALENDAR ERROR:", error)
    }
    if (veraltet()) return
    spinnerLoadingPage.value = false
    console.timeEnd("  --> Duration mount calendar")
}

export async function useMountScreenshots() {
    const meine = ++mountGeneration
    const veraltet = () => meine !== mountGeneration
    try {
        spinnerLoadingPage.value = true
        console.log("\MOUNTING SCREENSHOTS")
        console.time("  --> Duration mount screenshots");
        useGetScreenshotsPagination()
        await useGetSelectedRange()
        await Promise.all([useGetTags(), useGetAvailableTags()])
        if (veraltet()) return
        await useGetScreenshots(false)
        console.timeEnd("  --> Duration mount screenshots")
        useInitPopover()
    } catch (error) {
        console.error("SCREENSHOTS MOUNT ERROR:", error)
    } finally {
        // Eine überholte Kette darf den Spinner der jüngeren nicht löschen.
        if (!veraltet()) spinnerLoadingPage.value = false
    }
}

export async function useMountAuswertung() {
    const meine = ++mountGeneration
    const veraltet = () => meine !== mountGeneration
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
        if (veraltet()) return
        await useGetFilteredTrades()
        if (veraltet()) return

        spinnerLoadingPage.value = false
        auswertungMounted.value = true

        await nextTick()
        useInitTooltip()
    } catch (error) {
        console.error("AUSWERTUNG MOUNT ERROR:", error)
        if (!veraltet()) spinnerLoadingPage.value = false
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
    spinnerLoadingPage.value = true
    if (pageId.value == "dashboard") {
        await useMountDashboard()
    } else if (pageId.value == "daily") {
        await useMountDaily()
    } else if (pageId.value == "calendar") {
        await useMountCalendar()
    } else {
        window.location.href = "/dashboard"
    }
}

export async function useGetSelectedRange() {
    if (pageId.value == "dashboard" || pageId.value == "auswertung") {
        // 'Gesamt' (all): IMMER {0,0} erzwingen, unabhängig von einem evtl.
        // veralteten selectedDateRange (Label/Range-Desync). Sonst wird trotz
        // "Gesamt"-Anzeige nach einem alten Monat gefiltert → leere Liste.
        if (selectedPeriodRange.value?.value === 'all') {
            selectedRange.value = { start: 0, end: 0 }
        } else {
            selectedRange.value = selectedDateRange.value
        }
    } else if (pageId.value == "calendar") {
        selectedRange.value = {}
        selectedRange.value.start = dayjs.unix(selectedMonth.value.start).tz(timeZoneTrade.value).startOf('year').unix()
        selectedRange.value.end = selectedMonth.value.end
    }
    else {
        selectedRange.value = selectedMonth.value
    }
}
