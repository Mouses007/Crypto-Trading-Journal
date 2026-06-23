<script setup>
import { onMounted, ref, computed } from 'vue';
import { spinnerLoadingPage, timeZoneTrade } from '../stores/ui.js';
import { executions, existingImports, blotter, pAndL, tradesData, existingTradesArray, trades as globalTrades } from '../stores/trades.js';
import { selectedBroker } from '../stores/filters.js';
import { useDecimalsArithmetic, useCreatedDateFormat, useDateCalFormat } from '../utils/formatters.js';
import { useImportTrades, useUploadTrades, useGetExistingTradesArray, useCreateBlotter, useCreatePnL } from '../utils/addTrades'
import { buildTradeObj, saveManualTrade, useQuickApiImport } from '../utils/quickImport.js'
import { refreshAccountBalance } from '../stores/accountBalance.js'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue';
import axios from 'axios'
import dayjs from '../utils/dayjs-setup.js'
import { sendNotification } from '../utils/notify.js'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

spinnerLoadingPage.value = false

const importMode = ref('manual')

// ===== Manuelle Futures-Trade-Eingabe =====
const manual = ref({
    symbol: '', side: 'B', date: dayjs().format('YYYY-MM-DD'), entryDate: '',
    entryPrice: '', exitPrice: '', qty: '', netPL: '', fee: '', leverage: ''
})
const manualSaving = ref(false)
const manualMsg = ref(null)   // { ok, text }

async function addManualTrade() {
    manualMsg.value = null
    const sym = (manual.value.symbol || '').trim().toUpperCase()
    if (!sym) { manualMsg.value = { ok: false, text: 'Symbol fehlt' }; return }
    if (manual.value.netPL === '' || isNaN(parseFloat(manual.value.netPL))) {
        manualMsg.value = { ok: false, text: 'Netto-PnL fehlt' }; return
    }
    manualSaving.value = true
    try {
        const fee = Math.abs(parseFloat(manual.value.fee || 0)) || 0
        const netPL = parseFloat(manual.value.netPL)
        const grossPL = netPL + fee   // Brutto = Netto + Gebühren
        const qty = parseFloat(manual.value.qty || 1) || 1
        const closeDay = dayjs.utc(manual.value.date)
        const dateUnix = closeDay.startOf('day').unix()
        const exitTime = closeDay.hour(12).minute(0).second(0).unix()
        const entryTime = manual.value.entryDate
            ? dayjs.utc(manual.value.entryDate).hour(12).minute(0).second(0).unix()
            : exitTime

        const tradeObj = buildTradeObj({
            id: `t${dateUnix}_0_manual${Date.now()}`,
            broker: broker.value, td: dateUnix, side: manual.value.side, quantity: qty,
            entryTime, exitTime,
            entryPrice: parseFloat(manual.value.entryPrice || 0) || 0,
            exitPrice: parseFloat(manual.value.exitPrice || 0) || 0,
            symbol: sym, grossPL, netPL, fee, tradingFee: fee, fundingFee: 0,
            isGrossWin: grossPL > 0, isNetWin: netPL > 0,
        })
        if (manual.value.leverage) tradeObj.leverage = parseFloat(manual.value.leverage)

        await saveManualTrade(tradeObj)
        try { await refreshAccountBalance({ broker: broker.value, force: true }) } catch (_) { /* egal */ }

        manualMsg.value = { ok: true, text: `Gespeichert: ${sym} ${manual.value.side === 'B' ? 'Long' : 'Short'} ${netPL >= 0 ? '+' : ''}${netPL} USDT (${manual.value.date})` }
        // PnL-bezogene Felder zurücksetzen, Symbol/Datum für schnelle Mehrfacheingabe behalten
        manual.value.netPL = ''; manual.value.fee = ''; manual.value.entryPrice = ''; manual.value.exitPrice = ''; manual.value.qty = ''
    } catch (e) {
        manualMsg.value = { ok: false, text: 'Fehler beim Speichern: ' + (e?.message || e) }
    }
    manualSaving.value = false
}
const apiStartDate = ref(dayjs().subtract(7, 'day').format('YYYY-MM-DD'))
const apiEndDate = ref(dayjs().format('YYYY-MM-DD'))
const apiImportLoading = ref(false)
const apiImportError = ref('')

const broker = computed(() => selectedBroker.value || 'bitunix')
const isBitget = computed(() => broker.value === 'bitget')
const isPionex = computed(() => broker.value === 'pionex')
const BROKER_LABEL = { bitunix: 'Bitunix', bitget: 'Bitget', pionex: 'Pionex' }
const brokerLabel = computed(() => BROKER_LABEL[broker.value] || 'Bitunix')

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

    // Pionex: Bots werden über useQuickApiImport importiert (inkl. PnL-Breakdown-
    // Backfill bestehender Bots). Datumsfelder sind hier irrelevant — der Server
    // nutzt lastApiImport / apiImportStartDate.
    if (isPionex.value) {
        try {
            const result = await useQuickApiImport('pionex')
            sendNotification('Pionex Import', result.message || t('messages.importCount', { count: result.count || 0 }))
        } catch (error) {
            apiImportError.value = error.response?.data?.error || error.message || t('addTrades.importFailed')
            sendNotification('Pionex Import', t('messages.importFailed') + (error.message || ''))
        }
        apiImportLoading.value = false
        return
    }

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
                <a class="nav-link" :class="{ active: importMode === 'manual' }" href="#" @click.prevent="importMode = 'manual'">Manuell</a>
            </li>
            <li class="nav-item">
                <a class="nav-link" :class="{ active: importMode === 'api' }" href="#" @click.prevent="importMode = 'api'">{{ t('addTrades.apiImport') }}</a>
            </li>
        </ul>
    </div>

    <!-- Manuelle Eingabe (Futures) -->
    <div v-show="importMode === 'manual'" class="mt-3" style="max-width: 660px;">
        <p class="txt-small">Einzelnen Futures-Trade manuell erfassen — Konto: <strong>{{ brokerLabel }}</strong>. Pflicht: Symbol &amp; Netto-PnL.</p>
        <div class="row g-2 mb-2">
            <div class="col-sm-6">
                <label class="form-label mb-0">Symbol</label>
                <input class="form-control" v-model="manual.symbol" placeholder="BTCUSDT" />
            </div>
            <div class="col-sm-6">
                <label class="form-label mb-0">Richtung</label>
                <select class="form-control" v-model="manual.side">
                    <option value="B">Long</option>
                    <option value="SS">Short</option>
                </select>
            </div>
        </div>
        <div class="row g-2 mb-2">
            <div class="col-sm-6">
                <label class="form-label mb-0">Datum (Ausstieg)</label>
                <input type="date" class="form-control" v-model="manual.date" />
            </div>
            <div class="col-sm-6">
                <label class="form-label mb-0">Einstiegsdatum <span class="text-muted">(optional)</span></label>
                <input type="date" class="form-control" v-model="manual.entryDate" />
            </div>
        </div>
        <div class="row g-2 mb-2">
            <div class="col-sm-6">
                <label class="form-label mb-0">Einstiegspreis <span class="text-muted">(opt.)</span></label>
                <input type="number" step="any" class="form-control" v-model="manual.entryPrice" />
            </div>
            <div class="col-sm-6">
                <label class="form-label mb-0">Ausstiegspreis <span class="text-muted">(opt.)</span></label>
                <input type="number" step="any" class="form-control" v-model="manual.exitPrice" />
            </div>
        </div>
        <div class="row g-2 mb-2">
            <div class="col-sm-4">
                <label class="form-label mb-0">Menge <span class="text-muted">(opt.)</span></label>
                <input type="number" step="any" class="form-control" v-model="manual.qty" />
            </div>
            <div class="col-sm-4">
                <label class="form-label mb-0">Netto-PnL (USDT) *</label>
                <input type="number" step="any" class="form-control" v-model="manual.netPL" placeholder="z.B. 25.40" />
            </div>
            <div class="col-sm-4">
                <label class="form-label mb-0">Gebühren <span class="text-muted">(opt.)</span></label>
                <input type="number" step="any" class="form-control" v-model="manual.fee" />
            </div>
        </div>
        <div class="row g-2 mb-3">
            <div class="col-sm-4">
                <label class="form-label mb-0">Hebel <span class="text-muted">(opt.)</span></label>
                <input type="number" step="any" class="form-control" v-model="manual.leverage" />
            </div>
        </div>
        <button type="button" class="btn btn-success" :disabled="manualSaving" @click="addManualTrade">
            {{ manualSaving ? 'Speichern…' : 'Trade speichern' }}
        </button>
        <div v-if="manualMsg" class="mt-2 small" :class="manualMsg.ok ? 'greenTrade' : 'redTrade'">{{ manualMsg.text }}</div>
    </div>

    <!-- API Import -->
    <div v-show="importMode === 'api'" class="mt-3">
        <p class="txt-small" v-html="t('addTrades.apiDescription', { broker: brokerLabel })"></p>

        <!-- Pionex: Bot-Import (Zeitraum über Einstellungen → kein Datumsfeld) -->
        <div v-if="isPionex" class="mb-3">
            <p class="txt-small text-muted">Pionex-Bots werden importiert (Zeitraum via „Import ab Datum" in den Einstellungen). Bestehende Bots werden dabei um den PnL-Breakdown ergänzt.</p>
            <button type="button" class="btn btn-primary" @click="importFromApi" :disabled="apiImportLoading">
                <span v-if="apiImportLoading">{{ t('addTrades.importingStatus') }}</span>
                <span v-else>Bots importieren</span>
            </button>
        </div>

        <!-- Bitunix / Bitget: Zeitraum-basierter Import -->
        <div v-else class="row mb-3">
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

    <!-- Results (API-Import-Vorschau) -->
    <div v-show="importMode === 'api'" class="mt-3">
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

    <!--BUTTONS (API-Import-Vorschau)-->
    <div v-show="importMode === 'api'">
        <button v-show="Object.keys(executions).length > 0 && !spinnerLoadingPage" type="button"
            v-on:click="useUploadTrades" class="btn btn-success btn-lg me-3">{{ t('common.submit') }}</button>

        <button type="cancel" onclick="location.href = 'dashboard';"
            class="btn btn-outline-secondary btn-sm me-2">{{ t('common.cancel') }}</button>

    </div>
</template>
