<script setup>
/**
 * Rahmen einer Marktradar-Kachel.
 *
 * Kümmert sich um alles, was jede Kachel gleich hat: Überschrift, Zustandspunkt,
 * Stand-Zeit, Griff zum Umsortieren, Lupe, Lade- und Fehlerzustand. Der Inhalt
 * kommt als Slot — die Kachel-Komponenten kennen dadurch weder Zustände noch
 * Bedienung, sie zeichnen nur.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from '../utils/dayjs-setup.js'

const props = defineProps({
    titel: { type: String, required: true },
    icon: { type: String, default: '' },
    /** 'idle' | 'loading' | 'ready' | 'veraltet' | 'error' */
    zustand: { type: String, default: 'idle' },
    /** Zeitpunkt der angezeigten Daten in ms, 0 = noch nichts */
    stand: { type: Number, default: 0 },
    fehler: { type: String, default: '' },
    /** Hat die Kachel Daten? Steuert, ob der Inhalt oder ein Platzhalter kommt. */
    hatDaten: { type: Boolean, default: false },
})

const emit = defineEmits(['gross', 'neuladen', 'groesseStart', 'groesseZurueck'])

const { t } = useI18n()

const standText = computed(() => {
    if (!props.stand) return t('marktradar.never')
    return t('marktradar.asOf', { zeit: dayjs(props.stand).format('HH:mm') })
})
</script>

<template>
    <div class="radarCard" :class="{ 'radarCard--fehler': zustand === 'error' }">
        <div class="radarCardHead">
            <!-- Eigener Griff: auf dem Handy dürfen sich Ziehen und Antippen nicht beissen -->
            <span class="radarGriff" :title="t('marktradar.drag')"><i class="uil uil-draggabledots"></i></span>
            <i v-if="icon" :class="[icon, 'radarCardIcon']"></i>
            <span class="radarCardTitle">{{ titel }}</span>
            <span :class="['liveDot', 'dot-' + zustand]" :title="t('marktradar.status_' + zustand)"></span>
            <span class="radarCardStand">{{ standText }}</span>
            <button type="button" class="radarCardBtn" :title="t('marktradar.refresh')" @click="emit('neuladen')">
                <i class="uil uil-sync"></i>
            </button>
            <button type="button" class="radarCardBtn" :title="t('marktradar.enlarge')" @click="emit('gross')">
                <i class="uil uil-expand-arrows-alt"></i>
            </button>
        </div>

        <div class="radarCardBody" @click="hatDaten && emit('gross')">
            <slot v-if="hatDaten"></slot>

            <div v-else-if="zustand === 'error'" class="radarLeer">
                <i class="uil uil-exclamation-triangle mb-1"></i>
                <span>{{ fehler || t('marktradar.status_error') }}</span>
                <button type="button" class="ctl-pill mt-2" @click.stop="emit('neuladen')">
                    {{ t('marktradar.retry') }}
                </button>
            </div>

            <div v-else class="radarLeer">
                <span class="spinner-border spinner-border-sm"></span>
            </div>
        </div>

        <!-- Anfasser unten rechts: ziehen ändert Breite (in Rasterspalten) und
             Höhe, Doppelklick setzt auf die Vorgabe zurück. -->
        <span class="radarGroesse" :title="t('marktradar.resize')"
            @pointerdown.stop.prevent="emit('groesseStart', $event)"
            @dblclick.stop="emit('groesseZurueck')"></span>
    </div>
</template>
