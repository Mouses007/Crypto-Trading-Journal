<script setup>
import { onMounted, ref, computed } from 'vue';
import { useRouter } from 'vue-router'
import { spinnerLoadingPage, timeZoneTrade } from '../stores/ui.js';
import { executions, existingImports, blotter, pAndL, tradesData, existingTradesArray, trades as globalTrades } from '../stores/trades.js';
import { selectedBroker } from '../stores/filters.js';
import { useDecimalsArithmetic, useCreatedDateFormat, useDateCalFormat } from '../utils/formatters.js';
import { useImportTrades, useUploadTrades, useGetExistingTradesArray, useCreateBlotter, useCreatePnL } from '../utils/addTrades'
import { buildTradeObj, saveManualTrade, useQuickApiImport, createBitunixTradeObj, createBitgetTradeObj } from '../utils/quickImport.js'
import { refreshAccountBalance } from '../stores/accountBalance.js'
import { istGewinn } from '../../shared/gewinn.js'
import { useVerlassenSchutz } from '../composables/useVerlassenSchutz.js'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue';
import axios from 'axios'
import dayjs from '../utils/dayjs-setup.js'
import { sendNotification } from '../utils/notify.js'
import { useI18n } from 'vue-i18n'

const router = useRouter()

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

/*
 * Symbol und Datum bleiben nach dem Speichern absichtlich stehen (schnelle
 * Mehrfacheingabe) — sie zählen deshalb NICHT als ungespeicherte Eingabe.
 * Alles andere schon: wer Preise und PnL getippt hat und wegnavigiert, hat die
 * Arbeit verloren.
 */
useVerlassenSchutz(() => ['entryPrice', 'exitPrice', 'qty', 'netPL', 'fee', 'leverage']
    .some((f) => String(manual.value[f] ?? '').trim() !== ''),
    () => t('common.unsavedLeave'))

/*
 * Ein leeres Feld ist keine Null.
 *
 * Vorher lief jede Zahl durch `parseFloat(x || 0) || 0` bzw. `|| 1`. Eine
 * vergessene Gebühr wurde damit stillschweigend zu 0, eine vergessene Menge zu
 * 1 — und der Trade wurde mit grüner Erfolgsmeldung gespeichert. Der Fehler
 * fiel erst Wochen später in der Auswertung auf, wenn überhaupt.
 *
 * Leer bleibt erlaubt (nicht jedes Feld ist bekannt), aber etwas Getipptes,
 * das keine Zahl ergibt, ist ab jetzt ein Fehler und keine Null.
 *
 * @returns {number|null} null = leer gelassen
 */
function zahlOderNull(wert, feldName, fehler) {
    const roh = String(wert ?? '').trim()
    if (roh === '') return null
    const n = Number(roh.replace(',', '.'))   // Komma-Eingabe ist gemeint, nicht verworfen
    if (!Number.isFinite(n)) { fehler.push(t('addTrades.manualNotANumber', { feld: feldName })); return null }
    return n
}

async function addManualTrade() {
    manualMsg.value = null
    const sym = (manual.value.symbol || '').trim().toUpperCase()
    if (!sym) { manualMsg.value = { ok: false, text: t('addTrades.manualSymbolMissing') }; return }

    const fehler = []
    const netPLRoh = zahlOderNull(manual.value.netPL, t('addTrades.manualFieldNetPL'), fehler)
    if (netPLRoh === null && !fehler.length) fehler.push(t('addTrades.manualNetPLMissing'))

    const feeRoh = zahlOderNull(manual.value.fee, t('addTrades.manualFieldFee'), fehler)
    const qtyRoh = zahlOderNull(manual.value.qty, t('addTrades.manualFieldQty'), fehler)
    const einRoh = zahlOderNull(manual.value.entryPrice, t('addTrades.manualFieldEntry'), fehler)
    const ausRoh = zahlOderNull(manual.value.exitPrice, t('addTrades.manualFieldExit'), fehler)
    const hebelRoh = zahlOderNull(manual.value.leverage, t('addTrades.manualFieldLeverage'), fehler)

    if (qtyRoh !== null && qtyRoh <= 0) fehler.push(t('addTrades.manualQtyPositive'))
    if (einRoh !== null && einRoh < 0) fehler.push(t('addTrades.manualPricePositive'))
    if (ausRoh !== null && ausRoh < 0) fehler.push(t('addTrades.manualPricePositive'))
    if (hebelRoh !== null && hebelRoh <= 0) fehler.push(t('addTrades.manualLeveragePositive'))

    // Ein Abschluss in der Zukunft ist immer ein Tippfehler im Datumsfeld.
    const abschluss = dayjs.utc(manual.value.date)
    if (!abschluss.isValid()) fehler.push(t('addTrades.manualDateInvalid'))
    else if (abschluss.startOf('day').isAfter(dayjs.utc().startOf('day'))) fehler.push(t('addTrades.manualDateFuture'))

    if (manual.value.entryDate) {
        const ein = dayjs.utc(manual.value.entryDate)
        if (!ein.isValid()) fehler.push(t('addTrades.manualEntryDateInvalid'))
        else if (abschluss.isValid() && ein.startOf('day').isAfter(abschluss.startOf('day'))) {
            fehler.push(t('addTrades.manualEntryAfterExit'))
        }
    }

    if (fehler.length) { manualMsg.value = { ok: false, text: fehler.join(' · ') }; return }

    /*
     * Plausibilität nur als WARNUNG, nicht als Sperre: bei Teilausstiegen,
     * nachgezogenen Stopps oder Gebührenrabatten kann das Vorzeichen des PnL
     * der reinen Preisrichtung echt widersprechen. Wer das weiss, soll
     * speichern können — er soll es nur einmal gesehen haben.
     */
    let warnung = ''
    if (einRoh !== null && ausRoh !== null && einRoh > 0 && ausRoh > 0 && netPLRoh !== null && netPLRoh !== 0) {
        const richtungLong = manual.value.side === 'B'
        const preisGewinn = richtungLong ? (ausRoh > einRoh) : (ausRoh < einRoh)
        if (preisGewinn !== (netPLRoh > 0)) warnung = ' — ' + t('addTrades.manualPnlMismatch')
    }

    manualSaving.value = true
    try {
        const fee = feeRoh === null ? 0 : Math.abs(feeRoh)
        const netPL = netPLRoh
        const grossPL = netPL + fee   // Brutto = Netto + Gebühren
        const qty = qtyRoh === null ? 1 : qtyRoh
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
            entryPrice: einRoh === null ? 0 : einRoh,
            exitPrice: ausRoh === null ? 0 : ausRoh,
            symbol: sym, grossPL, netPL, fee, tradingFee: fee, fundingFee: 0,
            isGrossWin: istGewinn(grossPL), isNetWin: istGewinn(netPL),
        })
        if (hebelRoh !== null) tradeObj.leverage = hebelRoh

        await saveManualTrade(tradeObj)
        try { await refreshAccountBalance({ broker: broker.value, force: true }) } catch (_) { /* egal */ }

        manualMsg.value = {
            ok: true,
            text: t('addTrades.manualSaved', {
                symbol: sym,
                seite: manual.value.side === 'B' ? t('addTrades.manualLong') : t('addTrades.manualShort'),
                pnl: `${netPL >= 0 ? '+' : ''}${netPL}`,
                datum: manual.value.date,
            }) + warnung,
        }
        // PnL-bezogene Felder zurücksetzen, Symbol/Datum für schnelle Mehrfacheingabe behalten
        manual.value.netPL = ''; manual.value.fee = ''; manual.value.entryPrice = ''; manual.value.exitPrice = ''; manual.value.qty = ''
    } catch (e) {
        manualMsg.value = { ok: false, text: t('addTrades.manualSaveFailed') + ' ' + (e?.message || e) }
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

async function importFromApi() {
    apiImportLoading.value = true
    apiImportError.value = ''

    // Pionex: Bots werden über useQuickApiImport importiert (inkl. PnL-Breakdown-
    // Backfill bestehender Bots). Datumsfelder sind hier irrelevant — der Server
    // nutzt lastApiImport / apiImportStartDate.
    if (isPionex.value) {
        try {
            const result = await useQuickApiImport('pionex')
            sendNotification('importFertig', 'Pionex Import', result.message || t('messages.importCount', { count: result.count || 0 }))
        } catch (error) {
            apiImportError.value = error.response?.data?.error || error.message || t('addTrades.importFailed')
            sendNotification('importFertig', 'Pionex Import', t('messages.importFailed') + (error.message || ''))
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
            sendNotification('importFertig', `${brokerLabel.value} Import`, t('addTrades.noPositionsFound'))
            apiImportLoading.value = false
            return
        }

        /*
         * EIN Bauplan für Trade-Objekte, nicht zwei.
         *
         * Hier standen bis zum Audit vom 28.08.2026 zwei eigene Parser plus
         * ein von Hand nachgebautes Trade-Objekt — eine Feld-für-Feld-Kopie
         * von `buildTradeObj`, die drei Korrekturen nicht mitbekommen hatte:
         *   - `realizedPNL` ist bei Bitunix bereits der fertige Wallet-Delta,
         *     hier wurden Gebühr UND Funding ein zweites Mal abgezogen,
         *   - `Math.abs` auf dem Funding machte erhaltenes Funding zu Kosten,
         *   - `tradingFee`/`fundingFee` fehlten im Objekt, weshalb die
         *     Funding-Zeile der Kennzahlen-Kachel lautlos verschwand.
         *
         * Die Rechnung steht jetzt nur noch in `quickImport.js`. Wer sie
         * ändert, ändert beide Importwege.
         */
        spinnerLoadingPage.value = true

        for (let key in executions) delete executions[key]
        const trades = {}
        existingImports.length = 0
        tradesData.length = 0

        allPositions.forEach((pos, i) => {
            const tradeObj = currentBroker === 'bitget'
                ? createBitgetTradeObj(pos, i)
                : createBitunixTradeObj(pos, i)

            const dateUnix = tradeObj.td
            if (!trades[dateUnix]) trades[dateUnix] = []
            if (!executions[dateUnix]) executions[dateUnix] = []

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
            sendNotification('importFertig', `${brokerLabel.value} Import`, t('messages.noNewTrades'))
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
        sendNotification('importFertig', `${brokerLabel.value} Import`, t('messages.positionsImported', { count: allPositions.length, days: Object.keys(trades).length }))

    } catch (error) {
        apiImportError.value = error.message || t('addTrades.importFailed')
        sendNotification('importFertig', `${brokerLabel.value} Import`, t('messages.importFailed') + (error.message || t('common.error')))
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
                            <td v-bind:class="[blot.grossProceeds >= 0 ? 'greenTrade' : 'redTrade']">
                                {{ (blot.grossProceeds).toFixed(2) }}</td>
                            <td>{{ (blot.fees).toFixed(2) }}</td>
                            <td v-bind:class="[blot.netProceeds >= 0 ? 'greenTrade' : 'redTrade']">
                                {{ (blot.netProceeds).toFixed(2) }}</td>
                            <td>{{ blot.grossWinsCount }}</td>
                            <td>{{ blot.grossLossCount }}</td>
                            <td>{{ blot.trades }}</td>
                        </tr>
                        <tr v-if="index != null" class="sumRow">
                            <td>{{ t('common.total') }}</td>
                            <td v-bind:class="[pAndL[index].grossProceeds >= 0 ? 'greenTrade' : 'redTrade']">
                                {{ (pAndL[index].grossProceeds).toFixed(2) }}</td>
                            <td>{{ (pAndL[index].fees).toFixed(2) }}</td>
                            <td v-bind:class="[pAndL[index].netProceeds >= 0 ? 'greenTrade' : 'redTrade']">
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

        <!-- `type="cancel"` gibt es nicht; der Browser faellt auf `submit`
             zurueck. Und `location.href` startet die ganze App neu. -->
        <button type="button" @click="router.push('/dashboard')"
            class="btn btn-outline-secondary btn-sm me-2">{{ t('common.cancel') }}</button>

    </div>
</template>
