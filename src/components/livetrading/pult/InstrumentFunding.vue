<script setup>
/**
 * Funding, verdichtet auf Instrumentengrösse.
 *
 * Die Kachel `KachelFunding.vue` zeigt eine sortierbare Liste über bis zu
 * hundert Märkte — richtig für das Raster, unbrauchbar für eine Leiste von
 * knapp vier Zentimetern Höhe. Hier zählen nur drei Fragen: *was zahle ich
 * gerade auf meinem Symbol*, *wann ist die nächste Zahlung*, und *wo sind die
 * Extreme, an denen es kippen könnte*.
 *
 * Angeschrieben wird immer die auf ein Jahr hochgerechnete Rate MIT Einheit und
 * Takt. Das ist keine Zierde: eine Jahresrate von −900 % liest sich wie ein
 * Fehler, bis danebensteht, dass es −0,10 % je Stunde sind. Eine Zahl ohne
 * Einheit ist hier schon einmal als Fehler verworfen worden.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { liveSymbol } from '../../../stores/live.js'

const props = defineProps({
    daten: { type: Object, default: null },
    symbol: { type: String, default: '' },
    jetzt: { type: Number, default: 0 },
})

const { t } = useI18n()

const kurz = (s) => String(s || '').replace(/USDT$/, '')

/** Die Zeile des gewählten Symbols — erst bei den eigenen, dann marktweit. */
const meine = computed(() => {
    const d = props.daten
    if (!d || !props.symbol) return null
    return (d.eigene || []).find(r => r.symbol === props.symbol)
        || (d.alle || []).find(r => r.symbol === props.symbol)
        || null
})

const extremeOben = computed(() => (props.daten?.oben || []).slice(0, 2))
const extremeUnten = computed(() => (props.daten?.unten || []).slice(0, 2))

const jahr = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)} %`)
const farbe = (v) => (v === null || v === undefined ? '' : v >= 0 ? 'schlecht' : 'gut')

/** Countdown bis zur nächsten Zahlung — vorher ist die Rate nur eine Ansage. */
const bisZahlung = computed(() => {
    const ms = Number(meine.value?.naechsteZahlung) || 0
    if (!ms) return null
    const rest = ms - props.jetzt
    if (rest <= 0) return null
    const std = Math.floor(rest / 3600000)
    const min = Math.floor((rest % 3600000) / 60000)
    return `${std}:${String(min).padStart(2, '0')}`
})

const takt = computed(() => {
    const h = Number(meine.value?.intervallStunden)
    return Number.isFinite(h) && h > 0 ? `${h} h` : null
})
</script>

<template>
    <div class="ifWrap">
        <!-- Das eigene Symbol steht oben und gross: es ist das einzige, das Geld kostet -->
        <div class="ifMeine">
            <span class="ifSym">{{ kurz(symbol) }}</span>
            <span class="ifWert" :class="farbe(meine?.jahresRate)">{{ jahr(meine?.jahresRate) }}</span>
            <span class="ifEinheit">{{ t('livetrading.pult.proJahr') }}</span>
            <span v-if="takt" class="ifTakt">{{ takt }}</span>
            <span v-if="bisZahlung" class="ifZahlung">
                <i class="uil uil-clock"></i>{{ bisZahlung }}
            </span>
        </div>

        <!-- Die Bitunix-Rate daneben: gehandelt wird dort, nicht auf Binance -->
        <div v-if="meine?.bitunix" class="ifBitunix">
            <span class="ifLabel">{{ t('livetrading.pult.bitunix') }}</span>
            <span :class="farbe(meine.bitunix.jahresRate)">{{ jahr(meine.bitunix.jahresRate) }}</span>
        </div>

        <!-- Extreme: dort sitzt die überfüllte Seite -->
        <div class="ifExtreme">
            <div class="ifSpalte">
                <span v-for="r in extremeOben" :key="r.symbol" class="ifZeile" @click="liveSymbol = r.symbol">
                    <span class="ifExtSym">{{ kurz(r.symbol) }}</span>
                    <b class="schlecht">{{ jahr(r.jahresRate) }}</b>
                </span>
            </div>
            <div class="ifSpalte">
                <span v-for="r in extremeUnten" :key="r.symbol" class="ifZeile" @click="liveSymbol = r.symbol">
                    <span class="ifExtSym">{{ kurz(r.symbol) }}</span>
                    <b class="gut">{{ jahr(r.jahresRate) }}</b>
                </span>
            </div>
        </div>
    </div>
</template>

<style scoped>
.ifWrap { display: flex; flex-direction: column; gap: 0.35rem; }

.ifMeine {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    flex-wrap: wrap;
}

.ifSym { font-size: 0.78rem; color: var(--white-60); }

.ifWert {
    font-size: 1.15rem;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
}

.ifEinheit, .ifTakt {
    font-size: 0.6rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--white-38);
}

.ifZahlung {
    margin-left: auto;
    font-size: 0.68rem;
    font-variant-numeric: tabular-nums;
    color: var(--white-60);
}

.ifZahlung i { margin-right: 0.2rem; }

.ifBitunix {
    display: flex;
    gap: 0.4rem;
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
}

.ifLabel {
    font-size: 0.6rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--white-38);
}

.ifExtreme {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 0.8rem;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    padding-top: 0.3rem;
}

.ifSpalte { display: flex; flex-direction: column; gap: 0.1rem; }

.ifZeile {
    display: flex;
    justify-content: space-between;
    gap: 0.4rem;
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
}

.ifZeile:hover .ifExtSym { color: var(--blue-color); }
.ifExtSym { color: var(--white-60); }

.gut { color: #26be96; }
.schlecht { color: #ff5f56; }
</style>
