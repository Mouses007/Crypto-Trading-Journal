<script setup>
/**
 * Ein Zahlenfeld, das wahlweise an einen Strategie-Parameter gebunden werden
 * kann — dieselbe Wahl, die der Regel-Interpreter kennt: entweder ein fester
 * Wert oder `{ param: 'name' }`.
 *
 * Gebaut, weil im Editor bisher nur feste Auswahllisten standen. Eine Liste mit
 * sieben Perioden sieht harmlos aus, macht aber alles Übrige unerreichbar: die
 * Engine liest z. B. bei MACD `fast`/`slow`/`signal`, ohne Feld blieben die
 * stumm auf 12/26/9 stehen — sichtbar war das nirgends.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps({
    /** Objekt, in dem der Wert steht (z. B. der Indikator-Eintrag). */
    ziel: { type: Object, required: true },
    /** Feldname innerhalb von `ziel`. */
    feld: { type: String, required: true },
    /** Wert, den die Engine ohne Angabe benutzt — wird als Platzhalter gezeigt. */
    standard: { type: Number, default: 14 },
    schritt: { type: Number, default: 1 },
    titel: { type: String, default: '' },
    /** Namen der Strategie-Parameter, an die gebunden werden kann. */
    params: { type: Array, default: () => [] },
})
const emit = defineEmits(['aendern'])

const wert = computed(() => props.ziel[props.feld])
const istParam = computed(() => Boolean(wert.value && typeof wert.value === 'object' && wert.value.param !== undefined))
const paramName = computed(() => (istParam.value ? wert.value.param : ''))

function setzen(neu) {
    props.ziel[props.feld] = neu
    emit('aendern')
}

function zahlSetzen(roh) {
    const n = Number(roh)
    // Leeres Feld heisst „Standard der Engine", nicht 0 — eine Periode 0 wäre
    // sonst eine stille Fehlkonfiguration.
    setzen(roh === '' || !Number.isFinite(n) ? props.standard : n)
}

function umschalten() {
    if (istParam.value) setzen(props.standard)
    else if (props.params.length) setzen({ param: props.params[0] })
}
</script>

<template>
    <div class="d-flex" style="min-width:0">
        <select v-if="istParam" class="form-select form-select-sm"
            :title="titel || t('strategies.fromParamShort')"
            :value="paramName"
            @change="setzen({ param: $event.target.value })">
            <option v-for="pk in params" :key="pk" :value="pk">{{ pk }}</option>
        </select>
        <input v-else type="number" class="form-control form-control-sm"
            :step="schritt" :placeholder="String(standard)" :title="titel"
            :value="wert" @change="zahlSetzen($event.target.value)" />
        <button v-if="params.length" type="button"
            class="btn btn-sm px-1 flex-shrink-0"
            :class="istParam ? 'btn-primary' : 'btn-outline-secondary'"
            :title="t('strategies.fromParamShort')"
            @click="umschalten">ƒ</button>
    </div>
</template>
