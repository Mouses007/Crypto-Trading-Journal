<script setup>
/**
 * Kachel „Kontostand".
 *
 * Zeigt denselben Wert wie das Dashboard: Startguthaben + realisierter Netto-P&L
 * (geschlossene Trades) + unrealisierter P&L der offenen Positionen + Broker-
 * Bonus. Die Rechnung ist wortgleich zu `Dashboard.vue` (accountBalance), damit
 * beide Seiten nie auseinanderlaufen.
 *
 * Self-supplying: die Komponente holt selbst nichts, sie liest aus den Stores,
 * die die Startseite beim Mount befüllt und im Takt frisch hält. `daten` bleibt
 * daher ungenutzt.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { currentUser, selectedBroker, incomingPositions } from '../../stores/globals.js'
import { allTimeNetPnL, displayBonus } from '../../stores/accountBalance.js'

defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
})

const { t } = useI18n()

const broker = computed(() => selectedBroker.value || 'bitunix')

/** Σ unrealisierter P&L der offenen Positionen des aktiven Brokers. */
const openUnrealizedPnL = computed(() => {
    let sum = 0
    for (const p of incomingPositions) {
        if (p.status !== 'open') continue
        if (p.broker && p.broker !== broker.value) continue
        const v = Number(p.unrealizedPNL)
        if (Number.isFinite(v)) sum += v
    }
    return sum
})

/** Startguthaben aus den Einstellungen (pro Broker, sonst global). */
const start = computed(() => {
    const balances = currentUser.value?.balances || {}
    if (balances[broker.value]) return balances[broker.value].start || 0
    return currentUser.value?.startBalance || 0
})

const konto = computed(() => {
    const s = start.value
    if (!s) return null
    const bonus = displayBonus.value || 0
    const current = s + allTimeNetPnL.value + openUnrealizedPnL.value + bonus
    const pnl = current - s - bonus
    const perf = s > 0 ? (((current - bonus) / s) - 1) * 100 : 0
    return { start: s, current, pnl, perf, bonus }
})

const geld = (n) => Number(n || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const proz = (n) => (n >= 0 ? '+' : '') + Number(n || 0).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %'
</script>

<template>
    <div class="ksWrap" :class="{ gross }">
        <template v-if="konto">
            <div class="ksHaupt">{{ geld(konto.current) }} <span class="ksWaehrung">USDT</span></div>
            <div class="ksZeilen">
                <span class="ksPnl" :class="konto.pnl >= 0 ? 'up' : 'down'">
                    {{ konto.pnl >= 0 ? '+' : '' }}{{ geld(konto.pnl) }}
                </span>
                <span class="ksPerf" :class="konto.perf >= 0 ? 'up' : 'down'">{{ proz(konto.perf) }}</span>
            </div>
            <div v-if="gross || konto.bonus" class="ksDetail">
                <div><span>{{ t('startseite.kontostand.start') }}</span><b>{{ geld(konto.start) }}</b></div>
                <div v-if="konto.bonus"><span>{{ t('startseite.kontostand.bonus') }}</span><b>{{ geld(konto.bonus) }}</b></div>
                <div><span>{{ t('startseite.kontostand.broker') }}</span><b>{{ broker }}</b></div>
            </div>
        </template>

        <div v-else class="ksLeer">
            <i class="uil uil-wallet"></i>
            <span>{{ t('startseite.kontostand.leer') }}</span>
        </div>
    </div>
</template>

<style scoped>
.ksWrap {
    display: flex;
    flex-direction: column;
    justify-content: center;
    height: 100%;
    min-height: 140px;
    gap: 0.35rem;
    padding: 0.2rem 0.3rem;
}

.ksHaupt {
    font-size: 1.9rem;
    font-weight: 700;
    color: var(--white-87);
    line-height: 1.1;
}

.ksWrap.gross .ksHaupt {
    font-size: 2.6rem;
}

.ksWaehrung {
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--white-60);
    margin-left: 0.25rem;
}

.ksZeilen {
    display: flex;
    align-items: baseline;
    gap: 0.9rem;
    font-size: 1rem;
    font-weight: 600;
}

.ksPnl.up,
.ksPerf.up {
    color: rgb(38, 190, 150);
}

.ksPnl.down,
.ksPerf.down {
    color: rgb(255, 95, 86);
}

.ksDetail {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 1.2rem;
    margin-top: 0.5rem;
    font-size: 0.82rem;
    color: var(--white-60);
}

.ksDetail b {
    margin-left: 0.4rem;
    color: var(--white-87);
}

.ksLeer {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    height: 100%;
    color: var(--white-60);
    font-size: 0.85rem;
    text-align: center;
}

.ksLeer i {
    font-size: 1.6rem;
}
</style>
