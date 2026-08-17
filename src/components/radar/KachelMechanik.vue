<script setup>
/**
 * Kachel „Marktmechanik" — regelbasierter Marktzustand aus Preis, Open
 * Interest, Funding und den eigenen Liquidations-Aufzeichnungen.
 *
 * Der Zustand wird auf dem Server bestimmt (marktmechanik.js, ohne KI) und
 * kommt als Schlüssel; hier wird nur übersetzt und eingefärbt. Die Farblogik
 * folgt dem Rest des Radars: rot = Longs unter Druck, grün = Shorts.
 *
 * In der Gross-Ansicht kann eine KI den Zustand ERKLÄREN (Knopf) — sie
 * bestimmt ihn nie. Der Text ist Einordnung, keine Handelsempfehlung.
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
})

const { t } = useI18n()
const emit = defineEmits(['params'])

const FENSTER = ['15m', '1h', '4h']

const ROT = 'rgb(255, 95, 86)'
const GRUEN = 'rgb(38, 190, 150)'
const BLAU = 'rgb(90, 156, 255)'
const GRAU = 'rgba(255, 255, 255, 0.45)'

const STATE_FARBE = {
    LONG_SQUEEZE_RISK: ROT,
    SHORT_SQUEEZE_RISK: GRUEN,
    DELEVERAGING: ROT,
    LONG_AUFBAU: BLAU,
    SHORT_AUFBAU: BLAU,
    NEUTRAL: GRAU,
}

const f = computed(() => props.daten?.faktoren || {})
const stateFarbe = computed(() => STATE_FARBE[props.daten?.state] || GRAU)

const liqSumme = computed(() => (f.value.liqLongUsd || 0) + (f.value.liqShortUsd || 0))
const liqLongAnteil = computed(() => (liqSumme.value ? (f.value.liqLongUsd / liqSumme.value) * 100 : 50))

const pct = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)} %`)
const geld = (v) => (v === null || v === undefined ? '—'
    : v >= 1e9 ? `${(v / 1e9).toFixed(2)} Mrd` : v >= 1e6 ? `${(v / 1e6).toFixed(1)} Mio` : `${Math.round(v / 1000)}k`)
const pfeil = (v) => (v === null || v === undefined || v === 0 ? '—' : v > 0 ? '▲' : '▼')
const deltaFarbe = (v) => (v === null || v === undefined || v === 0 ? GRAU : v > 0 ? GRUEN : ROT)

// ── KI-Erklärung (nur Gross-Ansicht, nur per Knopf) ──────────────────────
const erklaerung = ref(null)
const erklaerungLaedt = ref(false)
const erklaerungFehler = ref(null)

async function holeErklaerung() {
    if (erklaerungLaedt.value || !props.daten) return
    erklaerungLaedt.value = true
    erklaerungFehler.value = null
    try {
        const r = await axios.get('/api/marktradar/mechanik-erklaerung', {
            params: { symbol: props.daten.symbol, fenster: props.daten.fenster },
        })
        erklaerung.value = r.data
    } catch (e) {
        erklaerungFehler.value = e.response?.data?.error || e.message
    } finally {
        erklaerungLaedt.value = false
    }
}

// Zustandswechsel macht den alten Text hinfällig — anzeigen wäre gelogen,
// automatisch neu holen wäre ungefragtes Geld ausgeben. Also: leeren.
watch(() => props.daten?.state, () => { erklaerung.value = null; erklaerungFehler.value = null })
</script>

<template>
    <div v-if="daten" class="mxWrap" :class="{ gross }">
        <div class="mxLeiste">
            <span class="mxLeisteLabel">{{ t('marktradar.mechanik.window') }}</span>
            <button v-for="fe in FENSTER" :key="fe" type="button"
                :class="['ctl-pill', daten.fenster === fe ? 'active' : '']"
                @click.stop="emit('params', { fenster: fe })">{{ fe }}</button>
            <!-- Die Kachel folgt der Symbolwahl — der Chip sagt, WEN sie beurteilt -->
            <span class="mxSymbol">{{ daten.symbol?.replace(/USDT$/, '') }}</span>
        </div>

        <div class="mxBadge" :style="{ borderColor: stateFarbe, color: stateFarbe }">
            {{ t('marktradar.mechanik.state_' + daten.state) }}
        </div>

        <div class="mxFaktoren">
            <div class="mxZeile">
                <span class="mxLabel">{{ t('marktradar.mechanik.factor_preis') }}</span>
                <span class="mxWert" :style="{ color: deltaFarbe(f.preisDeltaPct) }">
                    {{ pfeil(f.preisDeltaPct) }} {{ pct(f.preisDeltaPct) }}
                </span>
            </div>
            <div class="mxZeile">
                <span class="mxLabel">{{ t('marktradar.mechanik.factor_oi') }}</span>
                <span class="mxWert" :style="{ color: deltaFarbe(f.oiDeltaPct) }">
                    {{ pfeil(f.oiDeltaPct) }} {{ pct(f.oiDeltaPct) }}
                </span>
            </div>
            <div class="mxZeile">
                <span class="mxLabel">{{ t('marktradar.mechanik.factor_funding') }}</span>
                <span class="mxWert" :style="{ color: f.fundingRate > 0 ? ROT : f.fundingRate < 0 ? GRUEN : GRAU }">
                    {{ f.fundingJahresRate === null || f.fundingJahresRate === undefined ? '—' : `${f.fundingJahresRate > 0 ? '+' : ''}${f.fundingJahresRate.toFixed(1)} % p.a.` }}
                </span>
            </div>

            <template v-if="f.liqVerfuegbar">
                <div class="mxZeile">
                    <span class="mxLabel">{{ t('marktradar.mechanik.factor_liq') }}</span>
                    <span class="mxWert">
                        <span :style="{ color: ROT }">{{ geld(f.liqLongUsd) }}</span>
                        /
                        <span :style="{ color: GRUEN }">{{ geld(f.liqShortUsd) }}</span>
                        <span v-if="f.liqSpikeFaktor >= 2" class="mxSpike">{{ t('marktradar.mechanik.spike') }}</span>
                    </span>
                </div>
                <div class="mxBalken" v-if="liqSumme">
                    <div :style="{ width: liqLongAnteil + '%', background: ROT }"></div>
                    <div :style="{ width: (100 - liqLongAnteil) + '%', background: GRUEN }"></div>
                </div>
            </template>
            <div v-else class="mxLiqFehlt">{{ t('marktradar.mechanik.liqFehlt') }}</div>
        </div>

        <template v-if="gross">
            <!-- Welche Faktoren haben das Urteil getragen? -->
            <div v-if="daten.gruende?.length" class="mxGruende">
                <span v-for="g in daten.gruende" :key="g" class="mxGrund">
                    {{ t('marktradar.mechanik.grund_' + g) }}
                </span>
            </div>

            <div class="mxKi">
                <button v-if="!erklaerung && !erklaerungLaedt" type="button" class="ctl-pill"
                    @click.stop="holeErklaerung">
                    <i class="uil uil-robot"></i> {{ t('marktradar.mechanik.erklaeren') }}
                </button>
                <p v-if="erklaerungLaedt" class="mxKiStatus">{{ t('marktradar.mechanik.erklaerungLaedt') }}</p>
                <p v-if="erklaerungFehler" class="mxKiFehler">{{ erklaerungFehler }}</p>
                <template v-if="erklaerung">
                    <p class="mxKiText">{{ erklaerung.text }}</p>
                    <p class="mxKiHinweis">{{ t('marktradar.mechanik.erklaerungHinweis') }}
                        <span v-if="erklaerung.model" class="mxKiModell">· {{ erklaerung.model }}</span>
                    </p>
                </template>
            </div>

            <p class="mxQuelle">{{ t('marktradar.mechanik.source') }}</p>
        </template>
    </div>
</template>

<style scoped>
.mxWrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.mxLeiste {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    padding-bottom: 0.35rem;
}

.mxLeiste .ctl-pill {
    padding: 0.05rem 0.45rem;
    font-size: 0.74rem;
}

.mxLeisteLabel {
    font-size: 0.72rem;
    color: var(--white-60);
    margin-right: 0.15rem;
}

.mxSymbol {
    margin-left: auto;
    font-size: 0.86rem;
    font-weight: 600;
    color: rgb(90, 156, 255);
}

.mxBadge {
    align-self: flex-start;
    border: 1px solid;
    border-radius: var(--border-radius, 6px);
    padding: 0.2rem 0.6rem;
    font-size: 0.95rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    margin-bottom: 0.5rem;
}

.mxWrap.gross .mxBadge {
    font-size: 1.15rem;
}

.mxFaktoren {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
}

.mxZeile {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    font-size: 0.86rem;
    padding: 0.08rem 0;
}

.mxLabel {
    color: var(--white-60);
}

.mxWert {
    font-variant-numeric: tabular-nums;
    color: var(--white-87);
}

.mxSpike {
    margin-left: 0.35rem;
    padding: 0 0.3rem;
    border-radius: 3px;
    background: rgba(255, 95, 86, 0.18);
    color: rgb(255, 95, 86);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.mxBalken {
    display: flex;
    height: 8px;
    margin-top: 0.25rem;
    border-radius: 3px;
    overflow: hidden;
}

.mxLiqFehlt {
    font-size: 0.76rem;
    color: var(--white-60);
    margin-top: 0.25rem;
}

.mxGruende {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.7rem;
}

.mxGrund {
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    background: var(--black-bg-12, rgba(255, 255, 255, 0.07));
    font-size: 0.76rem;
    color: var(--white-87);
}

.mxKi {
    margin-top: 0.8rem;
}

.mxKiStatus,
.mxKiFehler {
    margin: 0.4rem 0 0;
    font-size: 0.82rem;
    color: var(--white-60);
}

.mxKiFehler {
    color: rgb(255, 95, 86);
}

.mxKiText {
    margin: 0.5rem 0 0;
    font-size: 0.9rem;
    line-height: 1.45;
    color: var(--white-87);
}

.mxKiHinweis {
    margin: 0.25rem 0 0;
    font-size: 0.74rem;
    color: var(--white-60);
}

.mxKiModell {
    opacity: 0.7;
}

.mxQuelle {
    margin: 0.7rem 0 0;
    font-size: 0.78rem;
    color: var(--white-60);
}
</style>
