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
import axios from 'axios'
import dayjs from '../utils/dayjs-setup.js'
import { dbFind, dbUpdateSettings } from '../utils/db.js'
import { selectedBroker } from './filters.js'
import { currentUser } from './globals.js'

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

/**
 * Aktueller Futures-Bonus (Bitunix Promo-/Referral-Bonus), der im Broker-
 * Wallet mitgezaehlt wird. Wird vom Dashboard-Kontostand-Display addiert,
 * damit die angezeigte Zahl 1:1 mit dem Wallet uebereinstimmt. NICHT in
 * startBalance/Equity-Curve/Drawdown einfliessen lassen — das wuerde die
 * Performance-Statistik verfaelschen (Bonus ist keine echte Trading-Equity).
 */
export const displayBonus = computed(() => cache[getCurrentBroker()]?.bonus ?? 0)

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

    // Debounce: konkurrierende Calls für denselben Broker zusammenfassen.
    // ABER: bei force=true muss der in-flight-Read ignoriert werden, weil der
    // Aufrufer gerade Trades mutiert hat und der laufende Read die Mutation
    // ggf. noch nicht sieht — sonst bleibt der Cache stale.
    if (inflight.has(b) && !force) {
        return inflight.get(b)
    }
    if (inflight.has(b) && force) {
        try { await inflight.get(b) } catch (_) { /* ignore */ }
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
                    const np = Number(day.pAndL.netProceeds)
                    if (Number.isFinite(np)) totalNet += np
                }
                if (day.trades && Array.isArray(day.trades)) {
                    for (const trade of day.trades) {
                        // Bot-Trades (Grid): buyQuantity hält bereits das kumulierte
                        // USDT-Volumen (totalVolume) → NICHT mit Preis multiplizieren,
                        // sonst explodiert das Volumen (Mrd.). Reguläre Trades: qty×Preis.
                        let vol
                        if (trade.botType) {
                            vol = Math.max(Number(trade.buyQuantity) || 0, Number(trade.sellQuantity) || 0)
                        } else {
                            const qty = Math.max(Number(trade.buyQuantity) || 0, Number(trade.sellQuantity) || 0)
                            const price = Number(trade.entryPrice) || 0
                            vol = qty * price
                        }
                        totalVol += vol
                        if (day.dateUnix >= cutoff30d) {
                            vol30d += vol
                        }
                    }
                }
            }
            // Bonus zusaetzlich vom Broker holen (best effort — kein Fehler
            // wenn API gerade down ist, Bonus bleibt dann 0 bzw. Vorwert).
            let bonus = cache[b]?.bonus ?? 0
            try {
                const resp = await axios.get(`/api/${b}/balance`)
                if (resp.data?.ok && Number.isFinite(Number(resp.data.bonus))) {
                    bonus = Number(resp.data.bonus)
                }
            } catch (_) { /* offline / kein API-Key → Bonus bleibt unveraendert */ }

            cache[b] = { totalNet, totalVol, vol30d, bonus, ts: Date.now() }
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

/**
 * Synchronisiert die `startBalance` mit dem aktuellen Broker-Wallet:
 *   startBalance = realizedEquity − Σ netProceeds
 * Das setzt voraus, dass alle Trades sauber importiert sind (Live-Polling
 * + ggf. CSV). Anschliessend stimmt das Dashboard exakt mit der echten
 * Trading-Equity (Wallet ohne Bonus) ueberein.
 *
 * Genutzt von Settings ("Vom API laden") UND dem Dashboard-Sync-Button.
 *
 * @returns {Promise<{ok:true,broker,start,apiBalance,bonus,unrealized,totalNet}>|
 *           {ok:false,error}>}
 */
export async function syncStartBalanceFromBroker() {
    const broker = selectedBroker.value || 'bitunix'
    try {
        const response = await axios.get(`/api/${broker}/balance`)
        if (!response.data?.ok) {
            return { ok: false, error: response.data?.error || 'API-Fehler' }
        }
        const apiBalance = Number(response.data.balance) || 0
        const bonus = Number(response.data.bonus) || 0
        const unrealized = (Number(response.data.crossUnrealizedPNL) || 0)
            + (Number(response.data.isolationUnrealizedPNL) || 0)
            + (Number(response.data.unrealizedPL) || 0)
        const realizedEquity = apiBalance - unrealized

        const trades = await dbFind('trades', { equalTo: { broker }, limit: 100000 })
        let totalNet = 0
        for (const day of trades) {
            if (day.pAndL && typeof day.pAndL === 'object') {
                const np = Number(day.pAndL.netProceeds)
                if (Number.isFinite(np)) totalNet += np
            }
        }

        const calculatedStart = Math.round((realizedEquity - totalNet) * 100) / 100
        const existing = currentUser.value?.balances || {}
        const balances = { ...existing, [broker]: { start: calculatedStart } }
        await dbUpdateSettings({ balances, startBalance: calculatedStart })
        if (currentUser.value) {
            currentUser.value.balances = balances
            currentUser.value.startBalance = calculatedStart
        }

        // Cache invalidieren + neu laden, damit Dashboard sofort den neuen
        // Wert zeigt (allTimeNetPnL ist abhaengig vom Cache, aber der
        // angezeigte Kontostand = startBalance + allTimeNetPnL + bonus).
        invalidateAccountBalance(broker)
        await refreshAccountBalance({ broker, force: true })
        // Sicherstellen, dass der eben frisch geholte Bonus auch im Cache
        // landet (refreshAccountBalance macht einen eigenen Roundtrip, aber
        // wir haben den Wert hier schon — gleiches Resultat).
        if (cache[broker]) cache[broker].bonus = bonus

        console.log(` -> Sync ${broker}: API=${apiBalance.toFixed(2)} (Bonus ${bonus.toFixed(2)}), unreal=${unrealized.toFixed(2)}, P&L=${totalNet.toFixed(2)} → Start=${calculatedStart.toFixed(2)}`)
        return { ok: true, broker, start: calculatedStart, apiBalance, bonus, unrealized, totalNet }
    } catch (e) {
        console.error('syncStartBalanceFromBroker:', e)
        return { ok: false, error: e.response?.data?.error || e.message }
    }
}

// Broker-Wechsel → sicherstellen, dass Werte für den neuen Broker geladen sind
watch(selectedBroker, (newBroker) => {
    if (!newBroker) return
    if (!cache[newBroker]) {
        refreshAccountBalance({ broker: newBroker })
    }
})
