<script setup>
import { onMounted, ref, computed } from 'vue';
import { spinnerLoadingPage, timeZoneTrade } from '../stores/ui.js';
import { executions, existingImports, blotter, pAndL, tradesData, existingTradesArray, trades as globalTrades } from '../stores/trades.js';
import { selectedBroker } from '../stores/filters.js';
import { useDecimalsArithmetic, useCreatedDateFormat, useDateCalFormat } from '../utils/formatters.js';
import { useImportTrades, useUploadTrades, useGetExistingTradesArray, useCreateBlotter, useCreatePnL } from '../utils/addTrades'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue';
import axios from 'axios'
import dayjs from '../utils/dayjs-setup.js'
import { sendNotification } from '../utils/notify.js'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

spinnerLoadingPage.value = false

const importMode = ref('csv')
const apiStartDate = ref(dayjs().subtract(7, 'day').format('YYYY-MM-DD'))
const apiEndDate = ref(dayjs().format('YYYY-MM-DD'))
const apiImportLoading = ref(false)
const apiImportError = ref('')

const broker = computed(() => selectedBroker.value || 'bitunix')
const isBitget = computed(() => broker.value === 'bitget')
const brokerLabel = computed(() => broker.value === 'bitget' ? 'Bitget' : 'Bitunix')

onMounted(async () => {
    await useGetExistingTradesArray()
})

/**
 * Parse a single Bitunix API position into tradesData row format.
 */
function parseBitunixPosition(pos) {
    const grossPL = parseFloat(pos.realizedPNL || 0)
    const tradingFee = Math.abs(parseFloat(pos.fee || 0))
    const fundingFee = Math.abs(parseFloat(pos.funding || 0))
    const fee = tradingFee + fundingFee
    const closeTime = parseInt(pos.mtime || pos.ctime)
    const openTime = parseInt(pos.ctime)
    // Bitunix: side is LONG/SHORT or BUY/SELL
    const side = (pos.side === 'LONG' || pos.side === 'BUY') ? 'B' : 'SS'

    return {
        Account: 'bitunix',
        Broker: 'bitunix',
        DateUTC: dayjs(closeTime).utc().format('YYYY-MM-DD HH:mm:ss'),
        EntryDateUTC: dayjs(openTime).utc().format('YYYY-MM-DD HH:mm:ss'),
        Symbol: pos.symbol || 'FUTURES',
        Type: 'futures',
        GrossProceeds: grossPL,
        Fee: fee,
        NetProceeds: grossPL - fee,
        TrxId: pos.positionId || '',
        Side: side,
        EntryPrice: parseFloat(pos.entryPrice || 0),
        ClosePrice: parseFloat(pos.closePrice || 0),
        Quantity: parseFloat(pos.maxQty || 1),
        Leverage: pos.leverage || '',
        IncomingAsset: 'USDT',
        OutgoingAsset: 'USDT',
        TradingFee: tradingFee,
        FundingFee: fundingFee,
    }
}

/**
 * Parse a single Bitget API position into tradesData row format.
 * Bitget fields: positionId, symbol, holdSide, openAvgPrice, closeAvgPrice,
 *                openTotalPos, closeTotalPos, pnl, netProfit, openFee, closeFee,
 *                totalFunding, cTime, uTime
 */
function parseBitgetPosition(pos) {
    const grossPL = parseFloat(pos.pnl || 0)
    const openFee = Math.abs(parseFloat(pos.openFee || 0))
    const closeFee = Math.abs(parseFloat(pos.closeFee || 0))
    const totalFunding = Math.abs(parseFloat(pos.totalFunding || 0))
    const tradingFee = openFee + closeFee
    const fundingFee = totalFunding
    const fee = tradingFee + fundingFee
    const closeTime = parseInt(pos.utime || pos.uTime || pos.ctime || pos.cTime)
    const openTime = parseInt(pos.ctime || pos.cTime)
    // Bitget: holdSide is 'long' or 'short'
    const holdSide = (pos.holdSide || '').toLowerCase()
    const side = holdSide === 'long' ? 'B' : 'SS'
    const netPL = parseFloat(pos.netProfit || 0) || (grossPL - fee)
    const quantity = parseFloat(pos.closeTotalPos || pos.openTotalPos || 1)

    return {
        Account: 'bitget',
        Broker: 'bitget',
        DateUTC: dayjs(closeTime).utc().format('YYYY-MM-DD HH:mm:ss'),
        EntryDateUTC: dayjs(openTime).utc().format('YYYY-MM-DD HH:mm:ss'),
        Symbol: pos.symbol || 'FUTURES',
        Type: 'futures',
        GrossProceeds: grossPL,
        Fee: fee,
        NetProceeds: netPL,
        TrxId: pos.positionId || '',
        Side: side,
        EntryPrice: parseFloat(pos.openAvgPrice || 0),
        ClosePrice: parseFloat(pos.closeAvgPrice || 0),
        Quantity: quantity,
        Leverage: pos.leverage || '',
        IncomingAsset: 'USDT',
        OutgoingAsset: 'USDT',
        TradingFee: tradingFee,
        FundingFee: fundingFee,
    }
}

async function importFromApi() {
    apiImportLoading.value = true
    apiImportError.value = ''

    try {
        const startTime = dayjs.utc(apiStartDate.value).startOf('day').valueOf()
        const endTime = dayjs.utc(apiEndDate.value).endOf('day').valueOf()
        const currentBroker = broker.value

        // Fetch positions from selected broker API
        let allPositions = []

        if (currentBroker === 'bitget') {
            // Bitget: server-side pagination is handled by the endpoint
            const response = await axios.get('/api/bitget/positions', {
                params: { startTime, endTime }
            })

            if (response.data.code !== 0) {
                throw new Error(response.data.msg || 'API error')
            }

            allPositions = response.data.data?.positionList || []
        } else {
            // Bitunix: client-side pagination with skip
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
        }

        if (allPositions.length === 0) {
            apiImportError.value = t('addTrades.noPositionsFound')
            sendNotification(`${brokerLabel.value} Import`, t('addTrades.noPositionsFound'))
            apiImportLoading.value = false
            return
        }

        // Convert API positions to tradesData format
        tradesData.length = 0
        allPositions.forEach(pos => {
            if (currentBroker === 'bitget') {
                tradesData.push(parseBitgetPosition(pos))
            } else {
                tradesData.push(parseBitunixPosition(pos))
            }
        })

        // Create trades from the API data
        spinnerLoadingPage.value = true

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
                account: currentBroker,
                broker: currentBroker,
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
        // existingTradesArray contains date strings (YYYY-MM-DD),
        // trades/executions keys are dateUnix numbers
        const existingDateSet = new Set(existingTradesArray)
        for (const dateUnixKey of Object.keys(trades)) {
            const dateStr = dayjs.unix(Number(dateUnixKey)).utc().format('YYYY-MM-DD')
            if (existingDateSet.has(dateStr)) {
                console.log(" -> Already imported date " + dateStr + " (dateUnix=" + dateUnixKey + ")")
                existingImports.push(Number(dateUnixKey))
                delete trades[dateUnixKey]
                delete executions[dateUnixKey]
            }
        }

        // Check if anything left to import
        if (Object.keys(trades).length === 0) {
            apiImportError.value = t('addTrades.allAlreadyImported')
            sendNotification(`${brokerLabel.value} Import`, t('messages.noNewTrades'))
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
        console.log(` -> Imported ${allPositions.length} positions from ${brokerLabel.value} API (${Object.keys(trades).length} new days)`)
        sendNotification(`${brokerLabel.value} Import`, t('messages.positionsImported', { count: allPositions.length, days: Object.keys(trades).length }))

    } catch (error) {
        apiImportError.value = error.message || t('addTrades.importFailed')
        sendNotification(`${brokerLabel.value} Import`, t('messages.importFailed') + (error.message || t('common.error')))
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
                <a class="nav-link" :class="{ active: importMode === 'csv' }" href="#" @click.prevent="importMode = 'csv'">{{ t('addTrades.csvImport') }}</a>
            </li>
            <li class="nav-item">
                <a class="nav-link" :class="{ active: importMode === 'api' }" href="#" @click.prevent="importMode = 'api'">{{ t('addTrades.apiImport') }}</a>
            </li>
        </ul>
    </div>

    <!-- CSV Import -->
    <div v-show="importMode === 'csv'" class="mt-3">
        <p class="txt-small" v-html="t('addTrades.csvDescription', { broker: brokerLabel })"></p>
        <div class="input-group mb-3">
            <input id="tradesInput" type="file" accept=".csv" v-on:change="useImportTrades($event, 'file')" />
        </div>
    </div>

    <!-- API Import -->
    <div v-show="importMode === 'api'" class="mt-3">
        <p class="txt-small" v-html="t('addTrades.apiDescription', { broker: brokerLabel })"></p>
        <div class="row mb-3">
            <div class="col">
                <label class="form-label">{{ t('addTrades.startDate') }}</label>
                <input type="date" class="form-control" v-model="apiStartDate" />
            </div>
            <div class="col">
                <label class="form-label">{{ t('addTrades.endDate') }}</label>
                <input type="date" class="form-control" v-model="apiEndDate" />
            </div>
            <div class="col align-self-end">
                <button type="button" class="btn btn-primary" @click="importFromApi" :disabled="apiImportLoading">
                    <span v-if="apiImportLoading">{{ t('addTrades.importingStatus') }}</span>
                    <span v-else>{{ t('addTrades.importFromApi') }}</span>
                </button>
            </div>
        </div>
        <div v-if="apiImportError" class="alert alert-danger">{{ apiImportError }}</div>
    </div>

    <!-- Results (shared by both modes) -->
    <div class="mt-3">
        <div v-if="existingImports.length != 0">
            {{ t('addTrades.alreadyImported') }} <span v-for="(item, index) in existingImports">
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
                            <td>{{ t('common.total') }}</td>
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
            v-on:click="useUploadTrades" class="btn btn-success btn-lg me-3">{{ t('common.submit') }}</button>

        <button type="cancel" onclick="location.href = 'dashboard';"
            class="btn btn-outline-secondary btn-sm me-2">{{ t('common.cancel') }}</button>

    </div>
</template>
