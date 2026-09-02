<script setup>
/**
 * Bedienung der Liquidationskarte in ihrer Kopfzeile.
 *
 * Zwei Regler: **Ansicht** und **Fenster**. Die Ansicht, weil Verteilung und
 * Verlauf zwei verschiedene Fragen beantworten („wo liegen die Zonen jetzt"
 * gegen „wie sind sie entstanden und was wurde abgeräumt") und man im Handel
 * zwischen beiden springt. Das Fenster, weil es die Aussagekraft der ganzen
 * Karte bestimmt: das Modell erkennt Positionen nur daran, dass das offene
 * Interesse STEIGT — was vor dem Fensteranfang eröffnet wurde, bleibt
 * unsichtbar. Genau das meldet die Karte als „Abdeckung 3,2 %".
 *
 * Hebelstufe und Schwelle bleiben auf `/liquidations`: die verfügbaren Stufen
 * hängen am Symbol (sie kommen aus den Brackets der Börse) und wären in einer
 * Kopfzeile eine Liste, die sich unter der Hand ändert.
 *
 * ## Warum das Fenster über `params` läuft und nicht über den Store
 *
 * `levMapHours` gehört der eigenen Seite. Die Kachel setzt bewusst eine eigene
 * Daytrading-Vorgabe (24 h statt 48), und diese Trennung soll bleiben — sonst
 * verstellt ein Griff im Handelsfenster die Seite mit. `params` ist der dafür
 * vorgesehene Weg: pro Kachel gespeichert (localStorage), und weil die Kachel
 * keinen `endpunkt` hat, löst ein neuer Wert auch keinen Abruf aus.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { levMapView } from '../../../stores/live.js'

const props = defineProps({
    params: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['params'])

const { t } = useI18n()

/**
 * 24 h deckt die Positionierung über Nacht ab und braucht 288 Punkte — das
 * bleibt unter der 500er-Grenze des Endpunkts, die Karte behält also die
 * 5-Minuten-Auflösung. Ab 48 h fällt sie auf 15-Minuten-Punkte zurück.
 */
const STUNDEN_OPTIONEN = [6, 12, 24, 48]

const stunden = computed(() => Number(props.params?.stunden) || 24)
</script>

<template>
    <span class="radarCardCtlLabel">{{ t('levmap.viewLabel') }}</span>
    <button type="button" :class="['radarCardCtl', levMapView !== 'history' ? 'active' : '']"
        :title="t('levmap.viewDistTitle')" @click="levMapView = 'dist'">
        {{ t('levmap.viewDist') }}
    </button>
    <button type="button" :class="['radarCardCtl', levMapView === 'history' ? 'active' : '']"
        :title="t('levmap.viewHistoryTitle')" @click="levMapView = 'history'">
        {{ t('levmap.viewHistory') }}
    </button>

    <span class="radarCardCtlLabel">{{ t('levmap.window') }}</span>
    <select class="radarCardSel" :title="t('levmap.windowTitle')"
        :value="stunden"
        @change="emit('params', { stunden: Number($event.target.value) })">
        <option v-for="h in STUNDEN_OPTIONEN" :key="h" :value="h">{{ h }} h</option>
    </select>
</template>
