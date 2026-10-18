<script setup>
/**
 * Seitenleiste „Alarme": die Alarme des aktiven Symbols (oder aller), neuer
 * Preis-Alarm zum aktuellen Kurs, Ein/Aus, Ändern, Löschen, Verlauf der
 * Auslösungen und ein Test der Push-Kanäle.
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { alarme, beschreibe, aendereAlarm, loescheAlarm } from '../../stores/chartAlarme.js'

const props = defineProps({
    symbol: { type: String, required: true },
    markt: { type: String, default: 'futures' },
    kurs: { type: Number, default: null },
})
const emit = defineEmits(['neu', 'bearbeite'])
const { t } = useI18n()

const alle = ref(false)
const offen = ref(null)
const testStand = ref('')

const liste = computed(() => (alle.value ? alarme.value : alarme.value.filter((a) => a.symbol === props.symbol)))
const zeit = (ms) => (ms ? new Date(ms).toLocaleString() : '—')

async function test() {
    testStand.value = '…'
    try {
        await axios.post('/api/chart/alarme/test')
        testStand.value = t('chart.alarm.testOk')
    } catch (e) {
        testStand.value = e.response?.data?.error || e.message
    }
}

function loesche(a) {
    if (window.confirm(t('chart.alarm.loeschenFrage', { was: `${a.symbol} ${beschreibe(a)}` }))) loescheAlarm(a.id)
}
</script>

<template>
    <div class="alarmReiter">
        <button class="btn btn-sm btn-outline-primary" @click="emit('neu', kurs)">
            <i class="uil uil-bell"></i> {{ t('chart.alarm.neuPreis', { symbol }) }}
        </button>
        <div class="tipp">{{ t('chart.alarm.tipp') }}</div>
        <label class="alle"><input v-model="alle" type="checkbox" /> {{ t('chart.alarm.alleSymbole') }}</label>
        <div v-if="!liste.length" class="leer">{{ t('chart.alarm.leer') }}</div>
        <div v-for="a in liste" :key="a.id" class="alarm" :class="{ aus: !a.aktiv }">
            <div class="zeile" @click="offen = offen === a.id ? null : a.id">
                <span class="sym">{{ a.symbol }}<small v-if="a.markt === 'spot'"> Spot</small></span>
                <span class="was">{{ beschreibe(a) }}</span>
                <span class="werkzeug" @click.stop>
                    <button :title="t(a.aktiv ? 'chart.alarm.ausschalten' : 'chart.alarm.einschalten')"
                        @click="aendereAlarm(a.id, { aktiv: !a.aktiv })">
                        <i :class="a.aktiv ? 'uil uil-bell' : 'uil uil-bell-slash'"></i></button>
                    <button :title="t('chart.einstellungen')" @click="emit('bearbeite', a)"><i class="uil uil-pen"></i></button>
                    <button :title="t('chart.entfernen')" @click="loesche(a)"><i class="uil uil-trash-alt"></i></button>
                </span>
            </div>
            <div v-if="offen === a.id" class="details">
                <div>{{ a.einmalig ? t('chart.alarm.einmalig') : t('chart.alarm.wiederholend', { min: a.bedingung.sperreMin ?? 15 }) }}</div>
                <div v-if="a.notiz">{{ a.notiz }}</div>
                <div>{{ t('chart.alarm.zuletzt') }}: {{ zeit(a.ausgeloestAm) }} ({{ a.anzahlAusgeloest }}×)</div>
                <div v-for="(v, i) in [...a.verlauf].reverse().slice(0, 5)" :key="i" class="verlauf">{{ zeit(v.t) }} · {{ v.p }}</div>
            </div>
        </div>
        <div class="testZeile">
            <button class="btn btn-sm btn-link p-0" @click="test">{{ t('chart.alarm.test') }}</button>
            <small>{{ testStand }}</small>
        </div>
    </div>
</template>

<style scoped>
.alarmReiter {
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
    min-height: 0;
    font-size: 12px;
}

.tipp,
.leer {
    color: var(--grey-text);
    font-size: 11px;
}

.alle {
    display: flex;
    gap: 6px;
    align-items: center;
}

.alarm {
    border-radius: 4px;
}

.alarm.aus {
    opacity: 0.5;
}

.zeile {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
}

.zeile:hover {
    background: var(--white-10);
}

.sym {
    font-weight: 500;
}

.was {
    flex: 1;
    color: var(--grey-text);
}

.werkzeug button {
    background: transparent;
    border: none;
    color: var(--grey-text);
    padding: 0 3px;
}

.werkzeug button:hover {
    color: var(--white-87, #eee);
}

.details {
    padding: 2px 8px 6px 14px;
    color: var(--grey-text);
    font-size: 11px;
}

.testZeile {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 6px;
}
</style>
