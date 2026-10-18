<!--
  Schnellschalter für den VWAP Vector des aktiven Charts — die Module ein und
  aus, ohne den Einstellungsdialog mit seinen 114 Feldern zu öffnen. Ein
  Schalter kann mehrere Parameter zusammenfassen (Swing-VWAP Hoch + Tief);
  er gilt als an, wenn alle an sind, und ein Klick setzt alle gleich.
  Nur sichtbar, wenn auf dem Chart ein VWAP Vector liegt. Ein Klick auf den
  Titel klappt die Box ein und aus (gemerkt im Browser).
-->
<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({ panel: { type: Object, required: true } })
const emit = defineEmits(['aendere'])
const { t } = useI18n()

const GRUPPEN = [
    { key: 'kerzen', schalter: [{ key: 'pvsra', p: ['showVector'] }, { key: 'eng', p: ['showEng'] }, { key: 'zonen', p: ['showVliq'] }] },
    { key: 'vwap', schalter: [
        { key: 'tag', p: ['showDaily'] }, { key: 'woche', p: ['showWeekly'] }, { key: 'monat', p: ['showMonthly'] },
        { key: 'swing', p: ['showSwingHi', 'showSwingLo'] }, { key: 'athAtl', p: ['showATH', 'showATL'] },
    ] },
    { key: 'ema', schalter: [{ key: 'ema', p: ['showEma21', 'showEma50', 'showEma200'] }, { key: 'htf', p: ['showMtfE1', 'showMtfE2', 'showMtfE3'], alle: false }] },
    { key: 'marken', schalter: [
        { key: 'fib', p: ['showFib'] }, { key: 'pocPer', p: ['showPocPer'] }, { key: 'pocC', p: ['showPocC'] }, { key: 'dopen', p: ['showDOpen'] },
    ] },
    { key: 'labels', schalter: [
        { key: 'lVwap', p: ['labelVWAPS'] }, { key: 'lEma', p: ['labelEMAS'] }, { key: 'lPoc', p: ['pocPerLbl'] }, { key: 'lDopen', p: ['dOpenLbl'] },
    ] },
]

const SPEICHER = 'ctj.chart.vvBoxOffen'
const offen = ref((() => { try { return localStorage.getItem(SPEICHER) !== '0' } catch { return true } })())
watch(offen, (v) => { try { localStorage.setItem(SPEICHER, v ? '1' : '0') } catch { /* privat */ } })

const instanz = computed(() => (props.panel?.indikatoren || []).find((i) => i.typ === 'vwapVector' && i.sichtbar !== false) || null)

/** An = alle Parameter an; bei `alle: false` (HTF-EMAs, eine davon ist ab Werk aus) genügt einer. */
function an(s) {
    const p = instanz.value?.params || {}
    return s.alle === false ? s.p.some((k) => p[k] === true) : s.p.every((k) => p[k] === true)
}
function schalte(s) {
    const i = instanz.value
    if (!i) return
    const neu = !an(s)
    // Beim Einschalten der HTF-EMAs nur die ersten zwei (wie ab Werk), beim Ausschalten alle.
    const keys = neu && s.key === 'htf' ? ['showMtfE1', 'showMtfE2'] : s.p
    emit('aendere', i.id, Object.fromEntries(keys.map((k) => [k, neu])))
}
</script>

<template>
    <div v-if="instanz" class="vvs">
        <button class="kopf" :aria-expanded="offen" :title="t(offen ? 'chart.vvBox.zu' : 'chart.vvBox.auf')" @click="offen = !offen">
            <span>{{ t('chart.vvBox.titel') }}</span>
            <i :class="offen ? 'uil uil-angle-down' : 'uil uil-angle-up'"></i>
        </button>
        <div v-if="offen" class="inhalt">
            <div v-for="g in GRUPPEN" :key="g.key" class="zeile">
                <span class="gruppe">{{ t('chart.vvBox.g_' + g.key) }}</span>
                <button v-for="s in g.schalter" :key="s.key" class="chip" :class="{ an: an(s) }" :aria-pressed="an(s)"
                    :title="t('chart.vvBox.s_' + s.key)" @click="schalte(s)">{{ t('chart.vvBox.k_' + s.key) }}</button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.vvs {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    margin-bottom: 6px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.02);
    font-size: 11px;
}
.kopf {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    background: transparent;
    border: none;
    padding: 0;
    color: var(--grey-text);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-size: 10px;
    cursor: pointer;
}
.kopf:hover { color: #e6e6e6; }
.kopf i { font-size: 20px; line-height: 14px; }
.inhalt {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 2px;
}
.zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
}
.gruppe {
    width: 46px;
    flex-shrink: 0;
    color: var(--grey-text);
}
.chip {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: transparent;
    color: var(--grey-text);
    border-radius: 10px;
    padding: 1px 8px;
    font-size: 11px;
    line-height: 16px;
    cursor: pointer;
}
.chip:hover { border-color: rgba(1, 180, 255, 0.5); }
.chip.an {
    background: rgba(1, 180, 255, 0.18);
    border-color: rgba(1, 180, 255, 0.6);
    color: #e6e6e6;
}
</style>
