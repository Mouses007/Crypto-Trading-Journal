<script setup>
/**
 * Schwebende Leiste über dem Panel für die AUSGEWÄHLTE Zeichnung: Farbe,
 * Strichstärke und -art, Verlängern, Füllung, Text, Sichtbarkeit je
 * Zeiteinheit, Sperren, Alarm, Löschen. Jede Änderung geht direkt an den
 * Speicher — es gibt keinen „Übernehmen"-Knopf, wie bei TradingView.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FARBEN, stilFuer } from '../../utils/chart/zeichnungen/werkzeuge.js'

const props = defineProps({
    zeichnung: { type: Object, required: true },
    interval: { type: String, required: true },
    alarmMoeglich: { type: Boolean, default: false },
})
const emit = defineEmits(['aendere', 'loesche', 'text', 'alarm'])
const { t } = useI18n()

const s = computed(() => stilFuer(props.zeichnung))
const typ = computed(() => props.zeichnung.typ)
const hatFarbe = computed(() => !['position', 'fib'].includes(typ.value))
const hatStrich = computed(() => !['position', 'text'].includes(typ.value))
const hatVerlaengern = computed(() => ['trendlinie', 'rechteck', 'fib'].includes(typ.value))
const hatFuellung = computed(() => ['rechteck', 'kanal'].includes(typ.value))
const hatText = computed(() => ['text', 'horizontale', 'strahlH', 'rechteck'].includes(typ.value))
const nurHier = computed(() => Array.isArray(props.zeichnung.sichtbarAuf) && props.zeichnung.sichtbarAuf.length > 0)

function stil(patch) {
    emit('aendere', { stil: { ...(props.zeichnung.stil || {}), ...patch } })
}

function naechsteBreite() {
    const b = s.value.breite || 1
    stil({ breite: b >= 4 ? 1 : b + 1 })
}

function naechsterStrich() {
    const reihe = ['voll', 'gestrichelt', 'gepunktet']
    stil({ strich: reihe[(reihe.indexOf(s.value.strich || 'voll') + 1) % reihe.length] })
}

function nurDieseZeiteinheit() {
    emit('aendere', { sichtbarAuf: nurHier.value ? null : [props.interval] })
}
</script>

<template>
    <div class="stilLeiste" @mousedown.stop @pointerdown.stop>
        <template v-if="hatFarbe">
            <button v-for="f in FARBEN" :key="f" class="farbe" :class="{ an: s.farbe === f }" :style="{ background: f }"
                @click="stil({ farbe: f })"></button>
            <span class="trenn"></span>
        </template>
        <button v-if="hatStrich" class="k" :title="t('chart.stil.breite')" @click="naechsteBreite">
            <span class="breite" :style="{ height: (s.breite || 1) + 'px' }"></span>
        </button>
        <button v-if="hatStrich" class="k" :title="t('chart.stil.strich.' + (s.strich || 'voll'))" @click="naechsterStrich">
            {{ s.strich === 'gestrichelt' ? '╌' : s.strich === 'gepunktet' ? '┈' : '─' }}
        </button>
        <button v-if="hatVerlaengern" class="k" :class="{ an: s.rechts }" :title="t('chart.stil.rechts')"
            @click="stil({ rechts: !s.rechts })"><i class="uil uil-arrow-to-right"></i></button>
        <button v-if="typ === 'trendlinie'" class="k" :class="{ an: s.links }" :title="t('chart.stil.links')"
            @click="stil({ links: !s.links })"><i class="uil uil-left-arrow-to-left"></i></button>
        <button v-if="hatFuellung" class="k" :class="{ an: s.fuellung }" :title="t('chart.stil.fuellung')"
            @click="stil({ fuellung: !s.fuellung })"><i class="uil uil-tear"></i></button>
        <button v-if="hatText" class="k" :title="t('chart.stil.text')" @click="emit('text')"><i class="uil uil-text"></i></button>
        <span class="trenn"></span>
        <button class="k" :class="{ an: nurHier }" :title="t('chart.stil.nurHier', { tf: interval })" @click="nurDieseZeiteinheit">
            {{ interval }}
        </button>
        <button v-if="alarmMoeglich" class="k" :title="t('chart.stil.alarm')" @click="emit('alarm')"><i class="uil uil-bell"></i></button>
        <button class="k" :class="{ an: zeichnung.gesperrt }" :title="t(zeichnung.gesperrt ? 'chart.stil.entsperren' : 'chart.stil.sperren')"
            @click="emit('aendere', { gesperrt: !zeichnung.gesperrt })">
            <i :class="zeichnung.gesperrt ? 'uil uil-lock' : 'uil uil-unlock'"></i></button>
        <button class="k" :title="t('chart.ausblenden')" @click="emit('aendere', { versteckt: true })"><i class="uil uil-eye-slash"></i></button>
        <button class="k loeschen" :title="t('chart.entfernen')" @click="emit('loesche')"><i class="uil uil-trash-alt"></i></button>
    </div>
</template>

<style scoped>
.stilLeiste {
    /* Rechts oben, vor der Preisachse: links oben steht die Legende. */
    position: absolute;
    top: 6px;
    right: 70px;
    z-index: 6;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 4px 6px;
    background: var(--black-bg-5, #1e222d);
    border: 1px solid var(--white-18);
    border-radius: 8px;
    box-shadow: var(--shadow-sm);
    max-width: calc(100% - 86px);
    overflow-x: auto;
}

.farbe {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid transparent;
    padding: 0;
    flex-shrink: 0;
}

.farbe.an {
    border-color: #fff;
}

.k {
    min-width: 26px;
    height: 24px;
    background: transparent;
    border: none;
    color: var(--grey-text);
    border-radius: 4px;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.k:hover {
    color: var(--white-87, #eee);
    background: var(--white-10);
}

.k.an {
    color: var(--blue-color);
    background: rgba(1, 180, 255, 0.12);
}

.k.loeschen:hover {
    color: var(--red-color);
}

.breite {
    display: block;
    width: 16px;
    background: currentColor;
}

.trenn {
    width: 1px;
    height: 18px;
    background: var(--white-18);
    margin: 0 3px;
    flex-shrink: 0;
}
</style>
