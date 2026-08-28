<script setup>
/**
 * Kachel „Winrate".
 *
 * Trefferquote über den aktuell im Journal eingestellten Filter — dieselbe
 * Grundlage wie das Winrate-Diagramm im Dashboard (`charts.js`):
 * `totals[amountCase+'WinsCount'] / totals.trades`. Break-even zählt als
 * Gewinner (Journal-Kanon), das steckt bereits in der Zählung.
 *
 * Self-supplying: liest aus `totals`, das die Startseite beim Mount über
 * `useTotalTrades()` befüllt. `daten` bleibt ungenutzt.
 */
import { computed } from 'vue'
import { journalZustand } from '../../stores/startseite.js'
import { useI18n } from 'vue-i18n'
import { totals, amountCase } from '../../stores/globals.js'

defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
})

const { t } = useI18n()

// 'gross' | 'net' — Vorgabe netto, falls noch nichts gewählt wurde
const modus = computed(() => (amountCase.value === 'gross' ? 'gross' : 'net'))

const anzahl = computed(() => Number(totals.trades) || 0)
const wins = computed(() => Number(totals[modus.value + 'WinsCount']) || 0)
const losses = computed(() => Math.max(0, anzahl.value - wins.value))
const rate = computed(() => (anzahl.value ? (wins.value / anzahl.value) * 100 : 0))

const farbe = computed(() => {
    const r = rate.value
    if (r >= 55) return 'rgb(38, 190, 150)'
    if (r >= 45) return '#c9b53b'
    return 'rgb(255, 95, 86)'
})

const prozent = (n) => Number(n || 0).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
</script>

<template>
    <div class="wrWrap" :class="{ gross }">
        <template v-if="anzahl">
            <div class="wrHaupt" :style="{ color: farbe }">{{ prozent(rate) }} <span>%</span></div>

            <div class="wrBalken">
                <div class="wrBalkenFuell" :style="{ width: rate + '%', background: farbe }"></div>
            </div>

            <div class="wrZeilen">
                <span class="up">{{ wins }} {{ t('startseite.winrate.wins') }}</span>
                <span class="down">{{ losses }} {{ t('startseite.winrate.losses') }}</span>
                <span class="wrGesamt">{{ anzahl }} {{ t('startseite.winrate.trades') }}</span>
            </div>

            <div class="wrModus">{{ t('startseite.winrate.basis_' + modus) }}</div>
        </template>

        <div v-else class="wrLeer">
            <i class="uil uil-chart-pie"></i>
            <span>{{ journalZustand === 'fehler' ? t('startseite.abrufFehler') : t('startseite.winrate.leer') }}</span>
        </div>
    </div>
</template>

<style scoped>
.wrWrap {
    display: flex;
    flex-direction: column;
    justify-content: center;
    height: 100%;
    min-height: 140px;
    gap: 0.5rem;
    padding: 0.2rem 0.3rem;
}

.wrHaupt {
    font-size: 2.2rem;
    font-weight: 700;
    line-height: 1;
}

.wrWrap.gross .wrHaupt {
    font-size: 3rem;
}

.wrHaupt span {
    font-size: 1rem;
    font-weight: 500;
    color: var(--white-60);
}

.wrBalken {
    height: 8px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
}

.wrBalkenFuell {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s ease;
}

.wrZeilen {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 1rem;
    font-size: 0.85rem;
    font-weight: 600;
}

.wrZeilen .up {
    color: rgb(38, 190, 150);
}

.wrZeilen .down {
    color: rgb(255, 95, 86);
}

.wrGesamt {
    color: var(--white-60);
    font-weight: 500;
}

.wrModus {
    font-size: 0.76rem;
    color: var(--white-60);
}

.wrLeer {
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

.wrLeer i {
    font-size: 1.6rem;
}
</style>
