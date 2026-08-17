<script setup>
/**
 * Anbieter- und Modellwahl für EINE KI-Funktion.
 *
 * Vorher stand dieses Paar dreimal ausgeschrieben in den Einstellungen
 * (global, Lagebericht, Share-Karten) — und wäre mit der Wahl je Funktion auf
 * sechs angewachsen. Die Listen kamen dabei aus derselben Quelle, aber die
 * Sonderfälle nicht: Der Lagebericht zeigte gespeicherte Modelle, die der
 * Katalog nicht mehr führt, gar nicht mehr an, und ein Speichervorgang hätte
 * die Einstellung stillschweigend gelöscht.
 *
 * Leere Wahl heisst „nimm den global eingestellten Anbieter". Damit das nicht
 * geraten werden muss, steht der tatsächlich greifende Stand als Text daneben.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps({
    /** Gewählter Anbieter, '' = global */
    provider: { type: String, default: '' },
    /** Gewähltes Modell, '' = Standard des Anbieters */
    modell: { type: String, default: '' },
    /** Modell-Listen je Anbieter, wie sie `/api/ai/models` liefert */
    modellListen: { type: Object, default: () => ({}) },
    /** Was gilt, wenn nichts gewählt ist — nur zur Anzeige */
    globalProvider: { type: String, default: '' },
    globalModell: { type: String, default: '' },
    /** false blendet den „Global"-Eintrag aus (für die globale Wahl selbst) */
    erlaubeGlobal: { type: Boolean, default: true },
    disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:provider', 'update:modell'])

const anbieter = computed(() => Object.keys(props.modellListen))

/**
 * Modelle des gewählten Anbieters. Ein gespeichertes Modell, das der Katalog
 * nicht (mehr) führt, bleibt vorne in der Liste — sonst stünde das Feld leer
 * da und der nächste Speichervorgang hätte die Einstellung gelöscht.
 */
const modelle = computed(() => {
    const liste = props.modellListen[props.provider] || []
    if (props.modell && !liste.includes(props.modell)) return [props.modell, ...liste]
    return liste
})

function setzeAnbieter(wert) {
    emit('update:provider', wert)
    // Modell mitziehen: ein Modellname aus einem anderen Haus wäre bei jedem
    // Aufruf ein 404. Leer lassen heisst „Standard des neuen Anbieters".
    emit('update:modell', '')
}
</script>

<template>
    <div class="d-flex gap-2 flex-wrap align-items-center">
        <select class="form-select form-select-sm" style="max-width:12rem;" :disabled="disabled"
            :value="provider" @change="setzeAnbieter($event.target.value)">
            <option v-if="erlaubeGlobal" value="">{{ t('settings.ki.useGlobal') }}</option>
            <option v-for="a in anbieter" :key="a" :value="a">{{ a }}</option>
        </select>

        <select class="form-select form-select-sm" style="max-width:16rem;"
            :disabled="disabled || (!provider && erlaubeGlobal)"
            :value="modell" @change="emit('update:modell', $event.target.value)">
            <option value="">{{ t('settings.ki.defaultModel') }}</option>
            <option v-for="m in modelle" :key="m" :value="m">{{ m }}</option>
        </select>

        <!-- Was tatsächlich greift. Ohne diese Zeile ist „Global" eine
             Behauptung, die man nur durch Ausprobieren prüfen kann. -->
        <small v-if="!provider && erlaubeGlobal" class="text-muted">
            {{ t('settings.ki.currentlyGlobal', {
                anbieter: globalProvider || '—',
                modell: globalModell || t('settings.ki.defaultModel'),
            }) }}
        </small>
    </div>
</template>
