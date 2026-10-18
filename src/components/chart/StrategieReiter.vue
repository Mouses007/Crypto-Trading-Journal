<script setup>
/**
 * Seitenleiste „Strategien" für das aktive Panel: welche Instanzen dieses
 * Symbol führen (einzeln ausblendbar), „jetzt erkennen" mit einer Instanz oder
 * einer Strategie in Vorgabe-Einstellung, und gespeicherte Backtests zum
 * Einblenden ihrer Trades.
 *
 * Instanzen tragen immer Strategie + Symbol + Zeiteinheit im Namen — eine
 * Nummer allein sagt niemandem etwas.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'

const props = defineProps({
    panel: { type: Object, required: true },
    daten: { type: Object, default: null },
    vorschau: { type: Object, default: null },
    backtest: { type: Object, default: null },
})
const emit = defineEmits(['filter', 'vorschau', 'backtest'])
const { t } = useI18n()

const strategien = ref([])
const wahl = ref('')                 // 'i:<id>' oder 's:<strategyId>'
const laeuft = ref(false)
const fehler = ref('')
const btLaedt = ref(null)

const filter = computed(() => props.panel.strategieFilter || {})
const verborgen = computed(() => new Set(filter.value.verborgen || []))
const instanzen = computed(() => props.daten?.instanzen || [])
const passendeStrategien = computed(() => strategien.value.filter((s) => s.supportedTimeframes?.includes(props.panel.interval)))

function anzahl(art, id) {
    return (props.daten?.[art] || []).filter((x) => x.instanceId === id).length
}

function schalteInstanz(id) {
    const v = new Set(verborgen.value)
    if (v.has(id)) v.delete(id); else v.add(id)
    emit('filter', { ...filter.value, verborgen: [...v] })
}

async function erkenne() {
    if (!wahl.value) return
    laeuft.value = true
    fehler.value = ''
    try {
        const [art, id] = [wahl.value.slice(0, 1), wahl.value.slice(2)]
        const body = { symbol: props.panel.symbol, timeframe: props.panel.interval, market: props.panel.markt }
        if (art === 'i') body.instanceId = Number(id); else body.strategyId = id
        const { data } = await axios.post('/api/chart/strategie/erkennen', body)
        emit('vorschau', data)
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    } finally {
        laeuft.value = false
    }
}

async function zeigeBacktest(b) {
    if (props.backtest?.id === b.id) { emit('backtest', null); return }
    btLaedt.value = b.id
    try {
        const { data } = await axios.get(`/api/chart/strategie/backtest/${b.id}`)
        emit('backtest', data)
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    } finally {
        btLaedt.value = null
    }
}

const datum = (ms) => (ms ? new Date(ms).toLocaleDateString() : '—')

onMounted(async () => {
    try {
        const { data } = await axios.get('/api/strategies/registry')
        strategien.value = data.strategies || []
    } catch { /* ohne Liste bleibt die Instanzauswahl */ }
})
</script>

<template>
    <div class="strategieReiter">
        <div class="abschnitt">{{ t('chart.str.instanzen') }}</div>
        <div v-if="!instanzen.length" class="leer">{{ t('chart.str.keineInstanz', { symbol: panel.symbol }) }}</div>
        <label v-for="i in instanzen" :key="i.id" class="instanz">
            <input type="checkbox" :checked="!verborgen.has(i.id)" @change="schalteInstanz(i.id)" />
            <span class="name">{{ i.strategieName }} · {{ panel.symbol }} · {{ (i.timeframes || [i.timeframe]).join('/') }}</span>
            <span class="modus" :class="i.modus">{{ i.modus }}</span>
            <small>{{ anzahl('setups', i.id) }} S · {{ anzahl('trades', i.id) }} T</small>
        </label>
        <label class="instanz">
            <input type="checkbox" :checked="!!filter.alleZeiteinheiten"
                @change="emit('filter', { ...filter, alleZeiteinheiten: $event.target.checked })" />
            <span class="name">{{ t('chart.str.alleZeiteinheiten') }}</span>
        </label>

        <div class="abschnitt">{{ t('chart.str.erkennen') }}</div>
        <select v-model="wahl" class="form-select form-select-sm">
            <option value="">{{ t('chart.str.waehlen') }}</option>
            <optgroup v-if="instanzen.length" :label="t('chart.str.instanzen')">
                <option v-for="i in instanzen" :key="i.id" :value="'i:' + i.id">{{ i.strategieName }} · {{ panel.symbol }} ·
                    {{ i.timeframe }} ({{ i.modus }})</option>
            </optgroup>
            <optgroup :label="t('chart.str.strategienVorgabe')">
                <option v-for="s in passendeStrategien" :key="s.id" :value="'s:' + s.id">{{ s.name }}</option>
            </optgroup>
        </select>
        <button class="btn btn-sm btn-outline-primary" :disabled="!wahl || laeuft" @click="erkenne">
            <span v-if="laeuft" class="spinner-border spinner-border-sm"></span>
            <template v-else><i class="uil uil-search-alt"></i> {{ t('chart.str.jetztErkennen', { tf: panel.interval }) }}</template>
        </button>
        <div v-if="fehler" class="fehler">{{ fehler }}</div>
        <div v-if="vorschau" class="ergebnis">
            <div><b>{{ vorschau.strategieName }}</b> · {{ vorschau.timeframe }} · {{ vorschau.kerzen }} {{ t('chart.str.kerzen') }}</div>
            <div>{{ t('chart.str.setupsGefunden', { n: vorschau.setups.length }) }}
                <template v-if="vorschau.gefunden != null"> · {{ t('chart.str.kandidaten', { n: vorschau.gefunden }) }}</template>
            </div>
            <div v-if="vorschau.overlays?.zonen">{{ t('chart.str.zonen', { n: vorschau.overlays.zonen.length }) }}
                · {{ t('chart.str.trend') }} {{ vorschau.overlays.trend?.ebene1 > 0 ? '↑' : vorschau.overlays.trend?.ebene1 < 0 ? '↓' : '–' }}
                / {{ vorschau.overlays.trend?.ebene2 > 0 ? '↑' : vorschau.overlays.trend?.ebene2 < 0 ? '↓' : '–' }}</div>
            <div v-if="vorschau.overlays?.hinweis === 'htfFehlt'" class="fehler">{{ t('chart.str.htfFehlt') }}</div>
            <button class="btn btn-sm btn-link p-0" @click="emit('vorschau', null)">{{ t('chart.str.vorschauWeg') }}</button>
        </div>

        <div class="abschnitt">{{ t('chart.str.backtests') }}</div>
        <div v-if="!(daten?.backtests || []).length" class="leer">{{ t('chart.str.keinBacktest') }}</div>
        <div v-for="b in daten?.backtests || []" :key="b.id" class="backtest" :class="{ an: backtest?.id === b.id }"
            @click="zeigeBacktest(b)">
            <span class="name">{{ b.label || b.strategieName }} · {{ b.timeframe }}</span>
            <small>{{ datum(b.von) }}–{{ datum(b.bis) }}</small>
            <small v-if="b.anzahl != null">{{ b.anzahl }} T<template v-if="b.summeR != null"> · {{ b.summeR >= 0 ? '+' : '' }}{{
                b.summeR.toFixed(1) }} R</template></small>
            <span v-if="btLaedt === b.id" class="spinner-border spinner-border-sm"></span>
        </div>
    </div>
</template>

<style scoped>
.strategieReiter {
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
    min-height: 0;
    font-size: 12px;
}

.abschnitt {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--grey-text);
    margin-top: 6px;
}

.leer {
    color: var(--grey-text);
}

.instanz {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    cursor: pointer;
}

.instanz .name {
    flex: 1;
}

.instanz small {
    color: var(--grey-text);
    width: 100%;
    padding-left: 20px;
}

.modus {
    font-size: 10px;
    padding: 0 4px;
    border-radius: 3px;
    background: var(--white-10);
}

.modus.live {
    background: rgba(255, 105, 96, 0.25);
    color: var(--red-color);
}

.modus.shadow {
    color: var(--blue-color);
}

.fehler {
    color: var(--red-color);
    font-size: 11px;
}

.ergebnis {
    background: var(--white-10);
    border-radius: 6px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.backtest {
    display: flex;
    flex-direction: column;
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
}

.backtest:hover {
    background: var(--white-10);
}

.backtest.an {
    background: rgba(255, 152, 0, 0.15);
}

.backtest small {
    color: var(--grey-text);
}
</style>
