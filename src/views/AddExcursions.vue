<script setup>
import { onBeforeMount, ref, onMounted, nextTick } from 'vue';
import { apis, imports, excursions, spinnerLoadingPage, daysMargin, daysBack } from '../stores/globals';
import { useGetExcursions } from '../utils/daily';
import { useDateCalFormat, useGetAPIS, usePageRedirect } from '../utils/utils';
import { useGetTrades } from '../utils/trades';
import { useGetOHLCV, useGetMFEPrices, useUpdateMfePrices } from '../utils/addTrades';
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue';
/* MODULES */
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

spinnerLoadingPage.value = false

const apiIndex = ref(-1)
const apiSource = ref(null)
let ohlc = []
let dateArray = ref([])
let tradesArray = []
let tradedSymbols = []
let tradedStartDate = null
let tradedEndDate = null
let mfePrices = []

onBeforeMount(async () => {
    await useGetAPIS()
    //console.log(" imports " + JSON.stringify(imports.value))
    //console.log(" excursions " + JSON.stringify(excursions))
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

    checkMFEDates()
})

const checkMFEDates = async () => {
    await Promise.all([useGetTrades(), useGetExcursions()])
    dateArray.value.length = 0
    tradesArray = []
    if (imports.value.length > 0) {
        imports.value.forEach(async (element) => {

            let index = excursions.findIndex(obj => obj.dateUnix == element.dateUnix)
            if (index == -1) {

                if (dayjs(element.dateUnix * 1000).isBefore(dayjs().subtract(daysMargin.value, 'days'))) {
                    console.log("  --> Excursion date does not exist " + useDateCalFormat(element.dateUnix))

                    //console.log(" element "+JSON.stringify(element))
                    dateArray.value.push(element.dateUnix)
                    element.trades.forEach(element => {
                        tradesArray.push(element)
                    });
                    if (!tradedStartDate) {
                        tradedStartDate = element.dateUnix
                    } else {
                        if (element.dateUnix < tradedStartDate) tradedStartDate = element.dateUnix
                    }

                    if (!tradedEndDate) {
                        tradedEndDate = element.dateUnix
                    } else {
                        if (element.dateUnix > tradedEndDate) tradedEndDate = element.dateUnix
                    }

                    element.trades.forEach(el => {
                        let index = tradedSymbols.findIndex(obj => obj.symbol == el.symbol)
                        if (index == -1) {
                            let temp = {}
                            temp.symbol = el.symbol
                            temp.secType = el.type
                            tradedSymbols.push(temp)
                        }

                    });
                    //console.log(" tradedSymbols " + JSON.stringify(tradedSymbols))
                    //console.log(" tradedStartDate " + tradedStartDate)
                    //console.log(" tradedEndDate " + tradedEndDate)

                } else {
                    console.log("  --> Excursion date does not exist " + useDateCalFormat(element.dateUnix) + " but does not comply with margin")
                }

            } else {
                console.log("  --> Excursion date exists " + useDateCalFormat(element.dateUnix))
            }
        });
    } else {
        console.log(" -> No Imports for the period")
    }
}

const updateMFEPrices = async () => {
    return new Promise(async (resolve, reject) => {
        spinnerLoadingPage.value = true
        mfePrices = []
        ohlc = await useGetOHLCV(apiSource.value, "manual", tradedSymbols, tradedStartDate, tradedEndDate)
        //console.log(" ohlc " + JSON.stringify(ohlc))
        for (const element of tradesArray) {
            //console.log(" element " + JSON.stringify(element))
            if (element.openPosition == false) {
                mfePrices = await useGetMFEPrices(element, element.entryTime, element.entryPrice, element, ohlc)
            }
        }
        console.log("mfePrices " + JSON.stringify(mfePrices))
        if (mfePrices.length > 0) {
            await useUpdateMfePrices(null, null, mfePrices)
        }
        spinnerLoadingPage.value = false
        usePageRedirect("daily")
    })
}

</script>
<template>
    <SpinnerLoadingPage />
    <div class="row mt-2" v-show="!spinnerLoadingPage">
        <div>
            <div v-if="apiIndex != -1">
                <div class="col-3">

                </div>
                <div class="col-3">

                </div>

                <div>
                    <p style="display: inline-flex; align-items: center; flex-wrap: wrap;">
                        Für die letzten
                        <input type="number" class="form-control ms-2 me-2 inputText" v-model="daysBack"
                            v-on:input="checkMFEDates()" />
                        Tage mit einem
                        <input type="number" class="form-control ms-2 me-2 inputText" v-model="daysMargin"
                            v-on:input="checkMFEDates()" style="width: 70px;vertical-align: baseline;" />
                            Tag
                        <span v-if="daysMargin > 1" class="me-1">e</span><span v-else class="me-1"></span>
                        Puffer,
                        <span v-if="dateArray.length > 0">fehlen die MFE-Preise für folgende
                            Daten: <span v-for="(item, index) in dateArray">
                                <span v-if="index > 0">, </span>{{ useDateCalFormat(item) }}</span></span>
                        <span v-else class="ms-1">alle MFE-Preise sind aktuell.</span>
                    </p>
                </div>

                <!--BUTTONS-->

                <button v-show="dateArray.length > 0 && !spinnerLoadingPage" type="button" v-on:click="updateMFEPrices"
                    class="btn btn-success btn-lg me-3">Hinzufügen</button>

                <button type="cancel" onclick="location.href = 'dashboard';"
                    class="btn btn-outline-secondary btn-sm me-2">Abbrechen</button>

            </div>
            <div v-else>Um MFE-Preise automatisch hinzuzufügen, trage deinen API-Schlüssel in den <a href="/settings">Einstellungen</a> ein.</div>

        </div>
    </div>
</template>