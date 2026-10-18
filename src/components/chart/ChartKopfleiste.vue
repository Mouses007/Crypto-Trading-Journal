<script setup>
/**
 * Kopfleiste des Chart-Arbeitsplatzes. Wirkt immer auf das AKTIVE Panel
 * (blau umrandet); Raster, Synchronisation und Layouts gelten für alle.
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SymbolSuche from './SymbolSuche.vue'
import { INTERVALLE, INTERVALLE_SICHTBAR } from '../../utils/chart/kerzenQuelle.js'

const props = defineProps({
    panel: { type: Object, required: true },
    raster: { type: String, default: '1' },
    sync: { type: Object, required: true },
    layouts: { type: Array, default: () => [] },
    layoutId: { type: Number, default: null },
    seitenleisteOffen: { type: Boolean, default: true },
    telefon: { type: Boolean, default: false },
})
const emit = defineEmits(['panel', 'indikatoren', 'raster', 'sync', 'layoutWechsel', 'layoutNeu', 'layoutUmbenennen', 'layoutLoeschen', 'seitenleiste', 'foto'])
const { t } = useI18n()

const suche = ref(null)
const mehrOffen = ref(false)
const layoutOffen = ref(false)
const syncOffen = ref(false)

const RASTER = [
    { id: '1', icon: 'uil uil-square-full' },
    { id: '2h', icon: 'uil uil-columns' },
    { id: '2v', icon: 'uil uil-web-grid-alt' },
    { id: '4', icon: 'uil uil-apps' },
]
const SKALEN = ['normal', 'log', 'prozent']

const verborgeneIntervalle = computed(() => INTERVALLE.filter((i) => !INTERVALLE_SICHTBAR.includes(i)))
const aktuellesLayout = computed(() => props.layouts.find((l) => l.id === props.layoutId))

function intervall(i) {
    emit('panel', { interval: i })
    mehrOffen.value = false
}

function neuesLayout() {
    const n = window.prompt(t('chart.layoutName'), t('chart.layoutNeuVorgabe'))
    if (n) emit('layoutNeu', n)
    layoutOffen.value = false
}

function umbenennen() {
    const n = window.prompt(t('chart.layoutName'), aktuellesLayout.value?.name || '')
    if (n) emit('layoutUmbenennen', n)
    layoutOffen.value = false
}

function loeschen() {
    if (props.layouts.length <= 1) return
    if (window.confirm(t('chart.layoutLoeschenFrage', { name: aktuellesLayout.value?.name || '' }))) emit('layoutLoeschen')
    layoutOffen.value = false
}

defineExpose({ oeffneSuche: () => suche.value?.oeffne() })
</script>

<template>
    <div class="kopfleiste">
        <SymbolSuche ref="suche" :symbol="panel.symbol" :markt="panel.markt" @waehle="emit('panel', $event)" />

        <div class="gruppe">
            <button v-for="i in INTERVALLE_SICHTBAR" :key="i" class="tf" :class="{ an: panel.interval === i }"
                @click="intervall(i)">{{ i }}</button>
            <div class="aufklapp">
                <button class="tf" :class="{ an: verborgeneIntervalle.includes(panel.interval) }" @click="mehrOffen = !mehrOffen">
                    {{ verborgeneIntervalle.includes(panel.interval) ? panel.interval : '…' }}
                </button>
                <div v-if="mehrOffen" class="menue">
                    <button v-for="i in verborgeneIntervalle" :key="i" class="tf" :class="{ an: panel.interval === i }"
                        @click="intervall(i)">{{ i }}</button>
                </div>
            </div>
        </div>

        <div class="gruppe">
            <button v-for="s in SKALEN" :key="s" class="tf" :class="{ an: (panel.skala || 'normal') === s }"
                :title="t('chart.skala.' + s)" @click="emit('panel', { skala: s })">{{ t('chart.skalaKurz.' + s) }}</button>
        </div>

        <div class="gruppe">
            <button class="tf" :title="t('chart.indikatorenTitel')" @click="emit('indikatoren')">
                <i class="uil uil-chart-growth"></i> {{ t('chart.indikatoren') }}
            </button>
        </div>

        <slot />

        <div class="rechts">
            <div v-if="!telefon" class="gruppe">
                <button v-for="r in RASTER" :key="r.id" class="tf" :class="{ an: raster === r.id }"
                    :title="t('chart.raster.' + r.id)" @click="emit('raster', r.id)"><i :class="r.icon"></i></button>
                <div class="aufklapp">
                    <button class="tf" :class="{ an: syncOffen }" :title="t('chart.sync.titel')" @click="syncOffen = !syncOffen">
                        <i class="uil uil-link-h"></i>
                    </button>
                    <div v-if="syncOffen" class="menue rechtsbuendig spalte">
                        <label v-for="k in ['kreuz', 'zeit', 'symbol', 'interval']" :key="k" class="schalter">
                            <input type="checkbox" :checked="sync[k]" @change="emit('sync', { [k]: $event.target.checked })" />
                            {{ t('chart.sync.' + k) }}
                        </label>
                    </div>
                </div>
            </div>

            <div class="aufklapp">
                <button class="tf layout" @click="layoutOffen = !layoutOffen" :title="t('chart.layouts')">
                    <i class="uil uil-window"></i> {{ aktuellesLayout?.name || '…' }}
                </button>
                <div v-if="layoutOffen" class="menue rechtsbuendig spalte">
                    <button v-for="l in layouts" :key="l.id" class="eintrag" :class="{ an: l.id === layoutId }"
                        @click="emit('layoutWechsel', l.id); layoutOffen = false">{{ l.name }}</button>
                    <hr />
                    <button class="eintrag" @click="neuesLayout"><i class="uil uil-plus"></i> {{ t('chart.layoutNeu') }}</button>
                    <button class="eintrag" @click="umbenennen"><i class="uil uil-pen"></i> {{ t('chart.layoutUmbenennen') }}</button>
                    <button class="eintrag" :disabled="layouts.length <= 1" @click="loeschen"><i class="uil uil-trash-alt"></i>
                        {{ t('chart.layoutLoeschen') }}</button>
                </div>
            </div>

            <button class="tf" :title="t('chart.foto')" @click="emit('foto')"><i class="uil uil-camera"></i></button>
            <button class="tf" :class="{ an: seitenleisteOffen }" :title="t('chart.seitenleiste')"
                @click="emit('seitenleiste')"><i class="uil uil-sidebar"></i></button>
        </div>
    </div>
</template>

<style scoped>
.kopfleiste {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    padding: 6px 4px;
}

.gruppe {
    display: flex;
    align-items: center;
    gap: 2px;
    padding-left: 8px;
    border-left: 1px solid var(--white-10);
}

.rechts {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
}

.tf {
    background: transparent;
    border: none;
    color: var(--grey-text);
    font-size: 12px;
    padding: 3px 7px;
    border-radius: 4px;
    white-space: nowrap;
}

.tf:hover {
    color: var(--white-87, #eee);
    background: var(--white-10);
}

.tf.an {
    color: var(--blue-color);
    background: rgba(1, 180, 255, 0.1);
}

.aufklapp {
    position: relative;
}

.menue {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 30;
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    width: 170px;
    background: var(--black-bg-5, #1e222d);
    border: 1px solid var(--white-18);
    border-radius: 8px;
    padding: 6px;
    box-shadow: var(--shadow-sm);
}

.menue.rechtsbuendig {
    left: auto;
    right: 0;
}

.menue.spalte {
    flex-direction: column;
    flex-wrap: nowrap;
    width: 210px;
}

.menue hr {
    margin: 4px 0;
    border-color: var(--white-18);
}

.eintrag {
    background: transparent;
    border: none;
    color: var(--white-87, #ddd);
    text-align: left;
    font-size: 12px;
    padding: 5px 8px;
    border-radius: 4px;
}

.eintrag:hover:not(:disabled) {
    background: var(--white-10);
}

.eintrag.an {
    color: var(--blue-color);
}

.eintrag:disabled {
    opacity: 0.4;
}

.schalter {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 12px;
    color: var(--white-87, #ddd);
    padding: 4px 6px;
    cursor: pointer;
}
</style>
