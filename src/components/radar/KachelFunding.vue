<script setup>
/**
 * Kachel „Funding-Raten".
 *
 * Zeigt, wo die überfüllte Seite sitzt: eine positive Rate heisst, Longs zahlen
 * an Shorts — je höher, desto teurer wird das Halten und desto anfälliger ist
 * die Seite für eine Auflösung. Angezeigt wird die auf ein Jahr hochgerechnete
 * Rate, weil 0,03 % je Zahlung niemandem etwas sagt, 32 % im Jahr aber schon.
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { liveSymbol } from '../../stores/live.js'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
})

const { t } = useI18n()

const TOP_N = [10, 50, 100]
const emit = defineEmits(['params'])

const sortierung = ref('rate')
const absteigend = ref(true)

const kurz = (s) => s.replace(/USDT$/, '')

const liste = computed(() => {
    const alle = props.daten?.alle || []
    const feld = sortierung.value
    return [...alle].sort((a, b) => {
        const va = a[feld] ?? 0, vb = b[feld] ?? 0
        return absteigend.value ? vb - va : va - vb
    })
})

function sortiere(feld) {
    if (sortierung.value === feld) absteigend.value = !absteigend.value
    else { sortierung.value = feld; absteigend.value = true }
}

const proz = (v) => `${(v * 100).toFixed(3)} %`
const jahr = (v) => `${(v * 100).toFixed(1)} %`
// Für die eigenen Märkte: Binance-, Bybit- oder Bitunix-Wert kann fehlen
const pa = (v) => (v === null || v === undefined ? '—' : jahr(v))
const farbe = (v) => (v === null || v === undefined ? 'muted' : v >= 0 ? 'hoch' : 'tief')

/** Erklärung am Divergenz-Marker — sonst steht dort ein Δ ohne Sinn. */
const divTitel = (r) => t('marktradar.funding.divergenzHinweis', {
    binance: jahr(r.jahresRate),
    bybit: jahr(r.bybitJahresRate),
})
const vol = (v) => (v >= 1e9 ? `${(v / 1e9).toFixed(1)} Mrd` : `${Math.round(v / 1e6)} Mio`)

/** Countdown bis zur nächsten Zahlung — die Rate wird erst dann fällig. */
function bisZahlung(ms) {
    if (!ms) return '—'
    const rest = ms - Date.now()
    if (rest <= 0) return '—'
    const std = Math.floor(rest / 3600000)
    const min = Math.floor((rest % 3600000) / 60000)
    return `${std}:${String(min).padStart(2, '0')}`
}
</script>

<template>
    <div v-if="daten" class="fWrap">
        <div class="fLeiste">
            <span class="fLeisteLabel">{{ t('marktradar.top') }}</span>
            <button v-for="n in TOP_N" :key="n" type="button"
                :class="['ctl-pill', daten.n === n ? 'active' : '']"
                @click.stop="emit('params', { n })">{{ n }}</button>
            <span class="fLeisteTrenner"></span>
            <button type="button"
                :class="['ctl-pill', (daten.rang || 'volumen') === 'volumen' ? 'active' : '']"
                @click.stop="emit('params', { rang: 'volumen' })">{{ t('marktradar.funding.byVolume') }}</button>
            <button type="button"
                :class="['ctl-pill', daten.rang === 'mcap' ? 'active' : '']"
                @click.stop="emit('params', { rang: 'mcap' })">{{ t('marktradar.funding.byMcap') }}</button>
        </div>
        <!-- Klein: zuerst DEINE Märkte. Die Extreme des Gesamtmarkts sitzen
             fast immer in Mikro-Werten, die niemand handelt — die stehen
             deshalb kleiner darunter. -->
        <div v-if="!gross" class="fKlein">
            <template v-if="(daten.eigene || []).length">
                <div class="fKopf">
                    <span>{{ t('marktradar.funding.yours') }}</span>
                    <span class="fLegende">Binance · Bitunix</span>
                </div>
                <div class="fEigene">
                    <div v-for="r in (daten.eigene || []).slice(0, 8)" :key="r.symbol" class="fZeile"
                        @click.stop="liveSymbol = r.symbol">
                        <span class="fSym">{{ kurz(r.symbol) }}</span>
                        <span class="fWerte">
                            <span class="fWert" :class="farbe(r.jahresRate)">{{ pa(r.jahresRate) }}</span>
                            <span class="fWert" :class="farbe(r.bitunix?.jahresRate)">{{ pa(r.bitunix?.jahresRate) }}</span>
                        </span>
                    </div>
                </div>
            </template>

            <div class="fExtreme">
                <div class="fExtrem">
                    <span class="fExtremKopf hoch">{{ t('marktradar.funding.longsPay') }}</span>
                    <span v-for="r in (daten.oben || []).slice(0, 2)" :key="r.symbol" class="fExtremZeile"
                        @click.stop="liveSymbol = r.symbol">
                        {{ kurz(r.symbol) }} <b class="hoch">{{ jahr(r.jahresRate) }}</b>
                    </span>
                </div>
                <div class="fExtrem">
                    <span class="fExtremKopf tief">{{ t('marktradar.funding.shortsPay') }}</span>
                    <span v-for="r in (daten.unten || []).slice(0, 2)" :key="r.symbol" class="fExtremZeile"
                        @click.stop="liveSymbol = r.symbol">
                        {{ kurz(r.symbol) }} <b class="tief">{{ jahr(r.jahresRate) }}</b>
                    </span>
                </div>
            </div>
        </div>

        <!-- Gross: die volle Liste, nach jeder Spalte sortierbar -->
        <div v-else class="fTabelleWrap">
            <!-- Deine Märkte mit beiden Börsen: Binance zeigt die Marktbreite,
                 Bitunix die Rate, die die eigene Position wirklich zahlt -->
            <div v-if="(daten.eigene || []).length" class="fEigeneGross">
                <div class="fKopf"><span>{{ t('marktradar.funding.yours') }}</span></div>
                <table class="fTabelle">
                    <thead>
                        <tr>
                            <th>{{ t('marktradar.funding.symbol') }}</th>
                            <th class="r">Binance {{ t('marktradar.funding.annual') }}</th>
                            <th class="r">Bybit {{ t('marktradar.funding.annual') }}</th>
                            <th class="r">Bitunix {{ t('marktradar.funding.annual') }}</th>
                            <th class="r">{{ t('marktradar.funding.interval') }}</th>
                            <th class="r">{{ t('marktradar.funding.next') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="r in daten.eigene" :key="'eigene-' + r.symbol" @click="liveSymbol = r.symbol">
                            <td>
                                {{ kurz(r.symbol) }}
                                <span v-if="r.divergenz != null" class="fDiv" :title="divTitel(r)">Δ</span>
                            </td>
                            <td class="r" :class="farbe(r.jahresRate)">{{ pa(r.jahresRate) }}</td>
                            <td class="r" :class="farbe(r.bybitJahresRate)">{{ pa(r.bybitJahresRate) }}</td>
                            <td class="r" :class="farbe(r.bitunix?.jahresRate)">{{ pa(r.bitunix?.jahresRate) }}</td>
                            <td class="r muted">{{ r.bitunix ? `${r.bitunix.intervallStunden} h` : '—' }}</td>
                            <td class="r muted">{{ bisZahlung(r.bitunix?.naechsteZahlung || r.naechsteZahlung) }}</td>
                        </tr>
                    </tbody>
                </table>
                <p class="fQuelle fEigeneNote">{{ t('marktradar.funding.yoursNote') }}</p>
            </div>
            <table class="fTabelle">
                <thead>
                    <tr>
                        <th @click="sortiere('symbol')">{{ t('marktradar.funding.symbol') }}</th>
                        <th class="r" @click="sortiere('rate')">{{ t('marktradar.funding.rate') }}</th>
                        <th class="r" @click="sortiere('jahresRate')">{{ t('marktradar.funding.annual') }}</th>
                        <th class="r" @click="sortiere('volumen24h')">{{ t('marktradar.funding.volume') }}</th>
                        <th class="r">{{ t('marktradar.funding.next') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="r in liste" :key="r.symbol" @click="liveSymbol = r.symbol">
                        <td>
                            {{ kurz(r.symbol) }}
                            <span v-if="r.divergenz != null" class="fDiv" :title="divTitel(r)">Δ</span>
                        </td>
                        <td class="r" :class="r.rate >= 0 ? 'hoch' : 'tief'">{{ proz(r.rate) }}</td>
                        <td class="r" :class="r.rate >= 0 ? 'hoch' : 'tief'">{{ jahr(r.jahresRate) }}</td>
                        <td class="r muted">{{ vol(r.volumen24h) }}</td>
                        <td class="r muted">{{ bisZahlung(r.naechsteZahlung) }}</td>
                    </tr>
                </tbody>
            </table>
            <p class="fQuelle">{{ t(daten.rang === 'mcap' ? 'marktradar.funding.sourceMcap' : 'marktradar.funding.source', { n: daten.gezaehlt }) }}</p>
        </div>
    </div>
</template>

<style scoped>
.fWrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.fLeiste {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    padding-bottom: 0.3rem;
}

.fLeiste .ctl-pill {
    padding: 0.05rem 0.45rem;
    font-size: 0.74rem;
}

.fLeisteLabel {
    font-size: 0.72rem;
    color: var(--white-60);
    margin-right: 0.15rem;
}

.fLeisteTrenner {
    width: 1px;
    align-self: stretch;
    margin: 0.1rem 0.25rem;
    background: var(--white-12, rgba(255, 255, 255, 0.12));
}

.fKlein {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.fEigene {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    column-gap: 0.9rem;
    flex: 1 1 auto;
    align-content: start;
}

.fExtreme {
    display: flex;
    gap: 0.9rem;
    margin-top: 0.4rem;
    padding-top: 0.35rem;
    border-top: 1px solid var(--white-12, rgba(255, 255, 255, 0.08));
    font-size: 0.76rem;
    color: var(--white-60);
}

.fExtrem {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.fExtremKopf {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.85;
}

.fExtremZeile {
    cursor: pointer;
    white-space: nowrap;
}

.fExtremZeile b {
    font-variant-numeric: tabular-nums;
}

.fKopf {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 0.25rem;
}

.fLegende {
    font-size: 0.66rem;
    text-transform: none;
    letter-spacing: 0;
    color: var(--white-60);
}

.fWerte {
    display: flex;
    gap: 0.5rem;
}

.fWerte .fWert {
    min-width: 3.4rem;
    text-align: right;
}

.fEigeneGross {
    margin-bottom: 0.9rem;
}

.fEigeneNote {
    margin-top: 0.35rem;
}

/* Divergenz-Marker: fällt auf, ohne die Zahlen zu übertönen — die Zeile bleibt
   lesbar, das Δ ist nur der Hinweis „hier lohnt der zweite Blick". */
.fDiv {
    display: inline-block;
    margin-left: 0.3rem;
    padding: 0 0.22rem;
    border-radius: 3px;
    font-size: 0.7rem;
    font-weight: 600;
    color: rgb(240, 180, 60);
    background: rgba(240, 180, 60, 0.14);
    cursor: help;
}

.fZeile {
    display: flex;
    justify-content: space-between;
    gap: 0.4rem;
    padding: 0.12rem 0;
    font-size: 0.86rem;
    cursor: pointer;
}

.fZeile:hover {
    background: var(--black-bg-12, rgba(255, 255, 255, 0.05));
}

.fSym {
    color: var(--white-87);
}

.fWert {
    font-variant-numeric: tabular-nums;
}

.hoch {
    color: rgb(255, 95, 86);
}

.tief {
    color: rgb(38, 190, 150);
}

.muted {
    color: var(--white-60);
}

/* Auf schmalen Schirmen scrollt die Tabelle waagerecht, statt zu zerfliessen */
.fTabelleWrap {
    overflow-x: auto;
}

.fTabelle {
    width: 100%;
    min-width: 420px;
    border-collapse: collapse;
    font-size: 0.88rem;
}

.fTabelle th {
    position: sticky;
    top: 0;
    background: var(--black-bg-3);
    text-align: left;
    font-size: 0.76rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--white-60);
    padding: 0.3rem 0.4rem;
    cursor: pointer;
    white-space: nowrap;
}

.fTabelle td {
    padding: 0.22rem 0.4rem;
    border-top: 1px solid var(--white-12, rgba(255, 255, 255, 0.07));
    font-variant-numeric: tabular-nums;
}

.fTabelle tbody tr {
    cursor: pointer;
}

.fTabelle tbody tr:hover {
    background: var(--black-bg-12, rgba(255, 255, 255, 0.05));
}

.r {
    text-align: right;
}

.fQuelle {
    margin: 0.6rem 0 0;
    font-size: 0.8rem;
    color: var(--white-60);
}
</style>
