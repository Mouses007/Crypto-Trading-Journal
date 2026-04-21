/**
 * Account-Balance Store
 *
 * Hält einen reaktiven, per-Broker gecachten All-Time-Net-P&L (Σ netProceeds)
 * plus All-Time-Volume, den das Dashboard und andere Views für den Kontostand-
 * Wert brauchen. Statt den Wert nur einmal beim Mount des Dashboards zu
 * berechnen (und danach stale zu bleiben), wird er hier zentral gehalten und
 * nach jeder Mutation gezielt invalidiert.
 *
 * Public API:
 *   - allTimeNetPnL         → computed, aktueller Broker
 *   - allTimeVolume         → computed, aktueller Broker
 *   - last30dVolume         → computed, aktueller Broker
 *   - refreshAccountBalance({ broker, force }) → Cache-Update fuer Broker
 *   - invalidateAccountBalance(broker?)        → Cache fuer Broker ungueltig
 *                                                machen (naechster read lazy laedt)
 *
 * Refresh-Trigger (aufrufer):
 *   - App-/Dashboard-Mount
 *   - Global-Polling-Tick (alle 60s)
 *   - Nach createTradeFromClosedPosition (Trade-Insert)
 *   - Nach useTransferClosingMetadata (Bewertungs-Abschluss)
 *   - Nach useQuickApiImport / CSV-Import
 *   - selectedBroker-Watcher (Broker-Wechsel)
 */
import { ref, reactive, computed, watch } from 'vue'
import dayjs from '../utils/dayjs-setup.js'
import { dbFind } from '../utils/db.js'
import { selectedBroker } from './filters.js'

// Per-Broker-Cache: { bitunix: { totalNet, totalVol, vol30d, ts }, bitget: {...} }
const cache = reactive({})
const loading = ref(false)

function getCurrentBroker() {
    return selectedBroker.value || 'bitunix'
}

export const allTimeNetPnL = computed(() => cache[getCurrentBroker()]?.totalNet ?? 0)
export const allTimeVolume = computed(() => cache[getCurrentBroker()]?.totalVol ?? 0)
export const last30dVolume = computed(() => cache[getCurrentBroker()]?.vol30d ?? 0)
export const accountBalanceLoading = computed(() => loading.value)

// Kleine Debounce-Map pro Broker, um konkurrierende Refreshes zu serialisieren
const inflight = new Map()

/**
 * Lädt alle Trade-Tage für den Broker und berechnet Netto-PnL + Volumen.
 * @param {Object} opts
 * @param {string} [opts.broker] — overriden (default: selectedBroker)
 * @param {boolean} [opts.force] — Cache ignorieren, neu laden
 */
export async function refreshAccountBalance({ broker, force = false } = {}) {
    const b = broker || getCurrentBroker()

    // Debounce: konkurrierende Calls für denselben Broker zusammenfassen
    if (inflight.has(b)) {
        return inflight.get(b)
    }

    const task = (async () => {
        try {
            loading.value = true
            const allTrades = await dbFind('trades', { equalTo: { broker: b }, limit: 100000 })
            let totalNet = 0
            let totalVol = 0
            let vol30d = 0
            const cutoff30d = dayjs().subtract(30, 'day').unix()

            for (const day of allTrades) {
                if (day.pAndL && typeof day.pAndL === 'object') {
                    totalNet += day.pAndL.netProceeds || 0
                }
                if (day.trades && Array.isArray(day.trades)) {
                    for (const trade of day.trades) {
                        const qty = Math.max(trade.buyQuantity || 0, trade.sellQuantity || 0)
                        const price = trade.entryPrice || 0
                        const vol = qty * price
                        totalVol += vol
                        if (day.dateUnix >= cutoff30d) {
                            vol30d += vol
                        }
                    }
                }
            }
            cache[b] = { totalNet, totalVol, vol30d, ts: Date.now() }
        } finally {
            loading.value = false
            inflight.delete(b)
        }
    })()

    inflight.set(b, task)
    return task
}

/**
 * Invalidiert den Cache für einen Broker (oder alle). Nachfolgende Reads
 * liefern 0, bis refreshAccountBalance() wieder lädt.
 */
export function invalidateAccountBalance(broker = null) {
    if (broker) {
        delete cache[broker]
    } else {
        for (const k of Object.keys(cache)) delete cache[k]
    }
}

// Broker-Wechsel → sicherstellen, dass Werte für den neuen Broker geladen sind
watch(selectedBroker, (newBroker) => {
    if (!newBroker) return
    if (!cache[newBroker]) {
        refreshAccountBalance({ broker: newBroker })
    }
})
