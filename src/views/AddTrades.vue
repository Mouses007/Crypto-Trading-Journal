<script setup>
import { onMounted, ref } from 'vue';
import { spinnerLoadingPage, executions, existingImports, blotter, pAndL, tradesData, timeZoneTrade, existingTradesArray, trades as globalTrades } from '../stores/globals';
import { useDecimalsArithmetic } from '../utils/utils';
import { useImportTrades, useUploadTrades, useGetExistingTradesArray, useCreateBlotter, useCreatePnL } from '../utils/addTrades'
import { useCreatedDateFormat, useDateCalFormat } from '../utils/utils';
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue';
import axios from 'axios'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
dayjs.extend(utc)
import timezone from 'dayjs/plugin/timezone.js'
dayjs.extend(timezone)

spinnerLoadingPage.value = false

const importMode = ref('csv')
const apiStartDate = ref(dayjs().subtract(7, 'day').format('YYYY-MM-DD'))
const apiEndDate = ref(dayjs().format('YYYY-MM-DD'))
const apiImportLoading = ref(false)
const apiImportError = ref('')

onMounted(async () => {
    await useGetExistingTradesArray()
})

async function importFromApi() {
    apiImportLoading.value = true
    apiImportError.value = ''

    try {
        // Convert dates to UTC millisecond timestamps (Bitunix API expects ms)
        const startTime = dayjs.utc(apiStartDate.value).startOf('day').valueOf()
        const endTime = dayjs.utc(apiEndDate.value).endOf('day').valueOf()

        // Fetch all pages
        let allPositions = []
        let skip = 0
        let hasMore = true

        while (hasMore) {
            const response = await axios.get('/api/bitunix/positions', {
                params: { startTime, endTime, skip, limit: 100 }
            })

            if (response.data.code !== 0) {
                throw new Error(response.data.msg || 'API error')
            }

            const positions = response.data.data?.positionList || []
            allPositions = allPositions.concat(positions)

            if (positions.length < 100) {
                hasMore = false
            } else {
                skip += 100
            }
        }

        if (allPositions.length === 0) {
            apiImportError.value = 'Keine Positionen für den ausgewählten Zeitraum gefunden.'
            apiImportLoading.value = false
            return
        }

        // Convert API positions to tradesData format
        tradesData.length = 0
        allPositions.forEach(pos => {
            const grossPL = parseFloat(pos.realizedPNL || 0)
            const fee = Math.abs(parseFloat(pos.fee || 0)) + Math.abs(parseFloat(pos.funding || 0))
            // Use mtime (close time) for trade date, fall back to ctime (open time)
            const closeTime = parseInt(pos.mtime || pos.ctime)
            const openTime = parseInt(pos.ctime)

            tradesData.push({
                Account: 'bitunix',
                DateUTC: dayjs(closeTime).utc().format('YYYY-MM-DD HH:mm:ss'),
                EntryDateUTC: dayjs(openTime).utc().format('YYYY-MM-DD HH:mm:ss'),
                Symbol: pos.symbol || 'FUTURES',
                Type: 'futures',
                GrossProceeds: grossPL,
                Fee: fee,
                NetProceeds: grossPL - fee,
                TrxId: pos.positionId || '',
                Side: pos.side === 'LONG' ? 'B' : 'SS',
                EntryPrice: parseFloat(pos.entryPrice || 0),
                ClosePrice: parseFloat(pos.closePrice || 0),
                Quantity: parseFloat(pos.maxQty || 1),
                Leverage: pos.leverage || '',
                IncomingAsset: 'USDT',
                OutgoingAsset: 'USDT',
            })
        })

        // Create trades from the API data
        spinnerLoadingPage.value = true

        // Group tradesData by day and create trade objects
        for (let key in executions) delete executions[key]
        const trades = {}
        existingImports.length = 0

        tradesData.forEach((row, i) => {
            let dateUnix = dayjs.utc(row.DateUTC).startOf('day').unix()

            if (!trades[dateUnix]) trades[dateUnix] = []
            if (!executions[dateUnix]) executions[dateUnix] = []

            const entryTime = dayjs.utc(row.EntryDateUTC).unix()
            const exitTime = dayjs.utc(row.DateUTC).unix()

            const isGrossWin = row.GrossProceeds > 0
            const isNetWin = row.NetProceeds > 0

            const tradeObj = {
                id: `t${dateUnix}_${i}_${row.TrxId || i}`,
                account: 'bitunix',
                broker: 'bitunix',
                td: dateUnix,
                currency: 'USDT',
                type: 'futures',
                side: row.Side || (isGrossWin ? 'B' : 'SS'),
                strategy: (row.Side === 'B' || (!row.Side && isGrossWin)) ? 'long' : 'short',
                symbol: row.Symbol,
                buyQuantity: row.Quantity || 1,
                sellQuantity: row.Quantity || 1,
                entryPrice: row.EntryPrice || 0,
                exitPrice: row.ClosePrice || 0,
                entryTime: entryTime,
                exitTime: exitTime,
                grossProceeds: row.GrossProceeds,
                netProceeds: row.NetProceeds,
                commission: row.Fee,
                sec: 0, taf: 0, nscc: 0, nasdaq: 0,
                grossSharePL: row.GrossProceeds,
                netSharePL: row.NetProceeds,
                grossWins: isGrossWin ? row.GrossProceeds : 0,
                grossLoss: isGrossWin ? 0 : row.GrossProceeds,
                netWins: isNetWin ? row.NetProceeds : 0,
                netLoss: isNetWin ? 0 : row.NetProceeds,
                grossWinsCount: isGrossWin ? 1 : 0,
                grossLossCount: isGrossWin ? 0 : 1,
                netWinsCount: isNetWin ? 1 : 0,
                netLossCount: isNetWin ? 0 : 1,
                grossWinsQuantity: isGrossWin ? (row.Quantity || 1) : 0,
                grossLossQuantity: isGrossWin ? 0 : (row.Quantity || 1),
                netWinsQuantity: isNetWin ? (row.Quantity || 1) : 0,
                netLossQuantity: isNetWin ? 0 : (row.Quantity || 1),
                grossSharePLWins: isGrossWin ? row.GrossProceeds : 0,
                grossSharePLLoss: isGrossWin ? 0 : row.GrossProceeds,
                netSharePLWins: isNetWin ? row.NetProceeds : 0,
                netSharePLLoss: isNetWin ? 0 : row.NetProceeds,
                highGrossSharePLWin: isGrossWin ? row.GrossProceeds : 0,
                highGrossSharePLLoss: isGrossWin ? 0 : row.GrossProceeds,
                highNetSharePLWin: isNetWin ? row.NetProceeds : 0,
                highNetSharePLLoss: isNetWin ? 0 : row.NetProceeds,
                executionsCount: 1,
                tradesCount: 1,
                openPosition: false,
            }

            trades[dateUnix].push(tradeObj)
            executions[dateUnix].push({ ...tradeObj, trade: tradeObj.id })
        })

        // Filter out already imported dates
        for (let i = 0; i < existingTradesArray.length; i++) {
            const existingDate = existingTradesArray[i]
            if (trades[existingDate]) {
                console.log(" -> Already imported date " + existingDate)
                existingImports.push(existingDate)
                delete trades[existingDate]
                delete executions[existingDate]
            }
        }

        // Check if anything left to import
        if (Object.keys(trades).length === 0) {
            apiImportError.value = 'Alle Positionen in diesem Zeitraum wurden bereits importiert.'
            spinnerLoadingPage.value = false
            apiImportLoading.value = false
            return
        }

        // Write trades to the global trades object
        for (let key in globalTrades) delete globalTrades[key]
        Object.assign(globalTrades, trades)

        await useCreateBlotter()
        await useCreatePnL()

        spinnerLoadingPage.value = false
        console.log(" -> Imported " + allPositions.length + " positions from Bitunix API (" + Object.keys(trades).length + " new days)")

    } catch (error) {
        apiImportError.value = error.message || 'Import von API fehlgeschlagen'
        spinnerLoadingPage.value = false
    }

    apiImportLoading.value = false
}

</script>
<template>
    <SpinnerLoadingPage />

    <!-- Import mode tabs -->
    <div class="mt-3">
        <ul class="nav nav-tabs">
            <li class="nav-item">
                <a class="nav-link" :class="{ active: importMode === 'csv' }" href="#" @click.prevent="importMode = 'csv'">CSV Import</a>
            </li>
            <li class="nav-item">
                <a class="nav-link" :class="{ active: importMode === 'api' }" href="#" @click.prevent="importMode = 'api'">API Import</a>
            </li>
        </ul>
    </div>

    <!-- CSV Import -->
    <div v-show="importMode === 'csv'" class="mt-3">
        <p class="txt-small">Importiere deinen Bitunix CSV-Export. Nur Zeilen mit "Futures Profit" und "Futures Loss" werden verarbeitet.</p>
        <div class="input-group mb-3">
            <input id="tradesInput" type="file" accept=".csv" v-on:change="useImportTrades($event, 'file')" />
        </div>
    </div>

    <!-- API Import -->
    <div v-show="importMode === 'api'" class="mt-3">
        <p class="txt-small">Importiere Trades direkt von deinem Bitunix-Konto. Konfiguriere deine API-Schlüssel in den <a href="/settings">Einstellungen</a>.</p>
        <div class="row mb-3">
            <div class="col">
                <label class="form-label">Startdatum</label>
                <input type="date" class="form-control" v-model="apiStartDate" />
            </div>
            <div class="col">
                <label class="form-label">Enddatum</label>
                <input type="date" class="form-control" v-model="apiEndDate" />
            </div>
            <div class="col align-self-end">
                <button type="button" class="btn btn-primary" @click="importFromApi" :disabled="apiImportLoading">
                    <span v-if="apiImportLoading">Importiere...</span>
                    <span v-else>Von API importieren</span>
                </button>
            </div>
        </div>
        <div v-if="apiImportError" class="alert alert-danger">{{ apiImportError }}</div>
    </div>

    <!-- Results (shared by both modes) -->
    <div class="mt-3">
        <div v-if="existingImports.length != 0">
            Folgende Daten sind bereits importiert: <span v-for="(item, index) in existingImports">
                <span v-if="index > 0">, </span>{{ useDateCalFormat(item) }}</span>
        </div>

        <div v-if="Object.keys(blotter).length > 0 && Object.keys(pAndL).length > 0"
            v-for="(execution, index) in executions">
            <div v-if="blotter[index]">
                <h3 class="ml-2 mt-2 text-blue">{{ useCreatedDateFormat(index) }}</h3>
                <table class="table">
                    <thead>
                        <tr>
                            <th scope="col">Symbol</th>
                            <th scope="col">Gross PnL</th>
                            <th scope="col">Fees</th>
                            <th scope="col">Net PnL</th>
                            <th scope="col">Wins</th>
                            <th scope="col">Losses</th>
                            <th scope="col">Trades</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="blot in blotter[index]">
                            <td>{{ blot.symbol }}</td>
                            <td v-bind:class="[blot.grossProceeds > 0 ? 'greenTrade' : 'redTrade']">
                                {{ (blot.grossProceeds).toFixed(2) }}</td>
                            <td>{{ (blot.fees).toFixed(2) }}</td>
                            <td v-bind:class="[blot.netProceeds > 0 ? 'greenTrade' : 'redTrade']">
                                {{ (blot.netProceeds).toFixed(2) }}</td>
                            <td>{{ blot.grossWinsCount }}</td>
                            <td>{{ blot.grossLossCount }}</td>
                            <td>{{ blot.trades }}</td>
                        </tr>
                        <tr v-if="index != null" class="sumRow">
                            <td>Gesamt</td>
                            <td v-bind:class="[pAndL[index].grossProceeds > 0 ? 'greenTrade' : 'redTrade']">
                                {{ (pAndL[index].grossProceeds).toFixed(2) }}</td>
                            <td>{{ (pAndL[index].fees).toFixed(2) }}</td>
                            <td v-bind:class="[pAndL[index].netProceeds > 0 ? 'greenTrade' : 'redTrade']">
                                {{ (pAndL[index].netProceeds).toFixed(2) }}</td>
                            <td>{{ pAndL[index].grossWinsCount }}</td>
                            <td>{{ pAndL[index].grossLossCount }}</td>
                            <td>{{ pAndL[index].trades }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <!--BUTTONS-->
    <div>
        <button v-show="Object.keys(executions).length > 0 && !spinnerLoadingPage" type="button"
            v-on:click="useUploadTrades" class="btn btn-success btn-lg me-3">Absenden</button>

        <button type="cancel" onclick="location.href = 'dashboard';"
            class="btn btn-outline-secondary btn-sm me-2">Abbrechen</button>

    </div>
</template>
