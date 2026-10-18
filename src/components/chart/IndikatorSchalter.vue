<!--
  Schnelleinstellungen aller Indikatoren des aktiven Charts, über der
  Momentum-Box: je Indikator ein Schalter für ein/aus (wie das Auge in der
  Legende), dazu seine sinnvollen Unterschalter — beim VWAP Vector die Module
  (sonst 114 Felder im Dialog), bei RSI der gleitende Durchschnitt, bei den
  Strategie- und Nachbau-Indikatoren Long/Short/Labels/Signale. Unterschalter
  erscheinen nur, solange der Indikator an ist. Ein Schalter kann mehrere
  Parameter zusammenfassen (Swing-VWAP Hoch + Tief); er gilt als an, wenn
  alle an sind, und ein Klick setzt alle gleich. Klick auf den Titel klappt
  die Box ein und aus (im Browser gemerkt).
-->
<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { kurzname, saubereParams } from '../../utils/chart/indikatorRegister.js'

const props = defineProps({ panel: { type: Object, required: true } })
const emit = defineEmits(['aendere', 'umschalten', 'volumen'])
const { t } = useI18n()

// Texte: VWAP-Vector-Module unter chart.vvBox, alle anderen unter chart.indBox.
const VV = (key, p, extra = {}) => ({ key, p, text: 'chart.vvBox.k_' + key, tipp: 'chart.vvBox.s_' + key, ...extra })
const IB = (key, p, extra = {}) => ({ key, p, text: 'chart.indBox.k_' + key, ...extra })

/** Unterschalter je Typ, in Zeilen gruppiert (`g` = Zeilentitel, null = ohne). */
const UNTER = {
    vwapVector: [
        { g: 'chart.vvBox.g_kerzen', schalter: [VV('pvsra', ['showVector']), VV('eng', ['showEng']), VV('zonen', ['showVliq'])] },
        { g: 'chart.vvBox.g_vwap', schalter: [VV('tag', ['showDaily']), VV('woche', ['showWeekly']), VV('monat', ['showMonthly']), VV('swing', ['showSwingHi', 'showSwingLo']), VV('athAtl', ['showATH', 'showATL'])] },
        { g: 'chart.vvBox.g_ema', schalter: [VV('ema', ['showEma21', 'showEma50', 'showEma200']), VV('htf', ['showMtfE1', 'showMtfE2', 'showMtfE3'], { alle: false, ein: ['showMtfE1', 'showMtfE2'] })] },
        { g: 'chart.vvBox.g_marken', schalter: [VV('fib', ['showFib']), VV('pocPer', ['showPocPer']), VV('pocC', ['showPocC']), VV('dopen', ['showDOpen'])] },
        { g: 'chart.vvBox.g_labels', schalter: [VV('lVwap', ['labelVWAPS']), VV('lEma', ['labelEMAS']), VV('lPoc', ['pocPerLbl']), VV('lDopen', ['dOpenLbl'])] },
    ],
    rsi: [{ g: null, schalter: [IB('ma', ['maAn'])] }],
    lsob: [{ g: null, schalter: [IB('long', ['sigLong']), IB('short', ['sigShort']), IB('verworfen', ['sigVerworfen'])] }],
    guss: [{ g: null, schalter: [IB('long', ['sigLong']), IB('short', ['sigShort']), IB('verworfen', ['sigVerworfen']), IB('emas', ['gussEmas'])] }],
    lsobCv: [{ g: null, schalter: [IB('long', ['cvLong']), IB('short', ['cvShort']), IB('signale', ['cvSignale']), IB('labels', ['cvLabels']), IB('vorwarn', ['cvVorwarn'])] }],
    gussCv: [{ g: null, schalter: [IB('long', ['zeigeLong']), IB('short', ['zeigeShort']), IB('emas', ['zeigeEmas'])] }],
}

const SPEICHER = 'ctj.chart.indBoxOffen'
const offen = ref((() => { try { return localStorage.getItem(SPEICHER) !== '0' } catch { return true } })())
watch(offen, (v) => { try { localStorage.setItem(SPEICHER, v ? '1' : '0') } catch { /* privat */ } })

const liste = computed(() => props.panel?.indikatoren || [])
const volumenAn = computed(() => props.panel?.volumen !== false)
const name = (i) => kurzname(i.typ, i.params, t('chart.ind.' + i.typ + '.kurz'))

/** An = alle Parameter an; bei `alle: false` (HTF-EMAs, eine davon ist ab Werk aus) genügt einer. */
function an(i, s) {
    const p = saubereParams(i.typ, i.params)
    return s.alle === false ? s.p.some((k) => p[k] === true) : s.p.every((k) => p[k] === true)
}
function schalte(i, s) {
    const neu = !an(i, s)
    const keys = neu && s.ein ? s.ein : s.p
    emit('aendere', i.id, Object.fromEntries(keys.map((k) => [k, neu])))
}
</script>

<template>
    <div class="ibox">
        <button class="kopf" :aria-expanded="offen" :title="t(offen ? 'chart.indBox.zu' : 'chart.indBox.auf')" @click="offen = !offen">
            <span>{{ t('chart.indBox.titel') }}</span>
            <i :class="offen ? 'uil uil-angle-down' : 'uil uil-angle-up'"></i>
        </button>
        <div v-if="offen" class="inhalt">
            <div class="zeile">
                <button class="chip haupt" :class="{ an: volumenAn }" :aria-pressed="volumenAn" @click="emit('volumen')">{{ t('chart.volumen') }}</button>
                <template v-for="i in liste" :key="i.id">
                    <button v-if="!UNTER[i.typ]" class="chip haupt" :class="{ an: i.sichtbar !== false }" :aria-pressed="i.sichtbar !== false"
                        @click="emit('umschalten', i.id)">{{ name(i) }}</button>
                </template>
            </div>
            <div v-for="i in liste.filter((x) => UNTER[x.typ])" :key="i.id" class="block">
                <div class="zeile">
                    <button class="chip haupt" :class="{ an: i.sichtbar !== false }" :aria-pressed="i.sichtbar !== false"
                        @click="emit('umschalten', i.id)">{{ name(i) }}</button>
                    <template v-if="i.sichtbar !== false && UNTER[i.typ].length === 1 && !UNTER[i.typ][0].g">
                        <button v-for="s in UNTER[i.typ][0].schalter" :key="s.key" class="chip" :class="{ an: an(i, s) }" :aria-pressed="an(i, s)"
                            :title="s.tipp ? t(s.tipp) : ''" @click="schalte(i, s)">{{ t(s.text) }}</button>
                    </template>
                </div>
                <template v-if="i.sichtbar !== false && (UNTER[i.typ].length > 1 || UNTER[i.typ][0].g)">
                    <div v-for="(z, n) in UNTER[i.typ]" :key="n" class="zeile">
                        <span class="gruppe">{{ z.g ? t(z.g) : '' }}</span>
                        <button v-for="s in z.schalter" :key="s.key" class="chip" :class="{ an: an(i, s) }" :aria-pressed="an(i, s)"
                            :title="s.tipp ? t(s.tipp) : ''" @click="schalte(i, s)">{{ t(s.text) }}</button>
                    </div>
                </template>
            </div>
        </div>
    </div>
</template>

<style scoped>
.ibox {
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
    gap: 6px;
    margin-top: 2px;
}
.block {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 6px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
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
.chip.haupt { font-weight: 600; }
</style>
