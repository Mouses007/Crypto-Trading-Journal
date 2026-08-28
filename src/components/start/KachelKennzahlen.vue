<script setup>
/**
 * Kachel „Kennzahlen" — die wichtigsten KPIs aus `totals`.
 *
 * Self-supplying: liest `totals` (globals), das die Startseite beim Mount aus
 * dem getesteten Summenkern befüllt. `daten` bleibt ungenutzt. Dieselben Größen
 * wie die Kennzahlen-Karte im Dashboard: Netto-PnL, Profit-Faktor,
 * Erwartungswert, Ø Gewinn/Verlust, Gebühren.
 */
import { computed } from 'vue'
import { journalZustand } from '../../stores/startseite.js'
import { useI18n } from 'vue-i18n'
import { totals } from '../../stores/globals.js'

defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
})

const { t } = useI18n()

const trades = computed(() => Number(totals.trades) || 0)
const netto = computed(() => Number(totals.netProceeds) || 0)
const gebuehren = computed(() => Number(totals.fees) || 0)
const funding = computed(() => Number(totals.fundingFees) || 0)
const avgWin = computed(() => Number(totals.avgNetWins) || 0)
const avgLoss = computed(() => Number(totals.avgNetLoss) || 0)

/** Profit-Faktor = Σ Gewinne / |Σ Verluste|. */
const profitFaktor = computed(() => {
    const wins = Number(totals.netWins) || 0
    const loss = Math.abs(Number(totals.netLoss) || 0)
    if (!loss) return wins > 0 ? Infinity : 0
    return wins / loss
})

/** Erwartungswert je Trade (APPT). */
const erwartung = computed(() => (trades.value ? netto.value / trades.value : 0))

const geld = (n) => Number(n || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pf = (n) => (n === Infinity ? '∞' : Number(n || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

const kacheln = computed(() => [
    { label: t('startseite.kennzahlen.netto'), wert: (netto.value >= 0 ? '+' : '') + geld(netto.value), klasse: netto.value >= 0 ? 'up' : 'down' },
    { label: t('startseite.kennzahlen.profitFaktor'), wert: pf(profitFaktor.value), klasse: profitFaktor.value >= 1 ? 'up' : 'down' },
    { label: t('startseite.kennzahlen.erwartung'), wert: (erwartung.value >= 0 ? '+' : '') + geld(erwartung.value), klasse: erwartung.value >= 0 ? 'up' : 'down' },
    { label: t('startseite.kennzahlen.avgWin'), wert: '+' + geld(Math.abs(avgWin.value)), klasse: 'up' },
    // avgNetLoss kommt aus dem Kern als positiver Betrag → als Verlust mit Minus zeigen
    { label: t('startseite.kennzahlen.avgLoss'), wert: '−' + geld(Math.abs(avgLoss.value)), klasse: 'down' },
    { label: t('startseite.kennzahlen.gebuehren'), wert: geld(gebuehren.value), klasse: 'neutral', extra: funding.value ? t('startseite.kennzahlen.funding') + ' ' + (funding.value >= 0 ? '+' : '') + geld(funding.value) : '' },
])
</script>

<template>
    <div class="knWrap" :class="{ gross }">
        <div v-if="trades" class="knGrid">
            <div v-for="k in kacheln" :key="k.label" class="knItem">
                <div class="knWert" :class="k.klasse">{{ k.wert }}</div>
                <div class="knLabel">{{ k.label }}</div>
                <div v-if="k.extra" class="knExtra">{{ k.extra }}</div>
            </div>
        </div>
        <div v-else class="knLeer">
            <i class="uil uil-calculator-alt"></i>
            <span>{{ journalZustand === 'fehler' ? t('startseite.abrufFehler') : t('startseite.kennzahlen.leer') }}</span>
        </div>
    </div>
</template>

<style scoped>
.knWrap {
    height: 100%;
    min-height: 140px;
    display: flex;
}

.knGrid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem 0.9rem;
    width: 100%;
    align-content: center;
}

.knWrap.gross .knGrid {
    grid-template-columns: repeat(3, 1fr);
    gap: 0.9rem 1.4rem;
}

.knItem {
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
}

.knWert {
    font-size: 1.15rem;
    font-weight: 700;
    line-height: 1.1;
}

.knWrap.gross .knWert {
    font-size: 1.5rem;
}

.knWert.up {
    color: rgb(38, 190, 150);
}

.knWert.down {
    color: rgb(255, 95, 86);
}

.knWert.neutral {
    color: var(--white-87);
}

.knLabel {
    font-size: 0.74rem;
    color: var(--white-60);
}

.knExtra {
    font-size: 0.7rem;
    color: var(--white-60);
    opacity: 0.85;
}

.knLeer {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    width: 100%;
    color: var(--white-60);
    font-size: 0.85rem;
}

.knLeer i {
    font-size: 1.6rem;
}
</style>
