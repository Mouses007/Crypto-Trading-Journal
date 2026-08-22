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
import InfoTipp from './InfoTipp.vue'

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
    /**
     * Kachel versorgt sich selbst (rechnet im Browser oder hängt an einem
     * eigenen Strom) und hat deshalb nie eine `daten`-Nutzlast. Ohne dieses
     * Kennzeichen bliebe sie für immer im Ladezustand stehen. Die Stand-Zeit
     * entfällt dann ebenfalls — „Stand 15:12" wäre bei einer Kachel, die
     * sekündlich selbst rechnet, eine Falschaussage.
     */
    eigenstaendig: { type: Boolean, default: false },
    /**
     * Der Inhalt wird bedient (geschoben, gezoomt, angetippt). Dann darf ein
     * Klick in den Körper NICHT die Gross-Ansicht öffnen — bei einem Canvas,
     * das man mit der Maus schiebt, wäre das unbenutzbar. Die Lupe entfällt
     * ebenfalls, denn eine zweite Instanz würde eine zweite Datenverbindung
     * aufbauen.
     */
    interaktiv: { type: Boolean, default: false },
    /**
     * Schlüssel des Erklärtexts (das kleine „i" neben dem Titel). Kommt aus
     * der Kachel-Registry, die ihn aus dem `titleKey` ableitet. Leer oder ohne
     * hinterlegten Text → kein Symbol, siehe `InfoTipp.vue`.
     */
    infoKey: { type: String, default: '' },
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
            <InfoTipp v-if="infoKey" :schluessel="infoKey" />
            <span :class="['liveDot', 'dot-' + zustand]" :title="t('marktradar.status_' + zustand)"></span>
            <span v-if="!eigenstaendig" class="radarCardStand">{{ standText }}</span>
            <span v-else class="radarCardStand"></span>
            <button type="button" class="radarCardBtn" :title="t('marktradar.refresh')" @click="emit('neuladen')">
                <i class="uil uil-sync"></i>
            </button>
            <button v-if="!interaktiv" type="button" class="radarCardBtn" :title="t('marktradar.enlarge')"
                @click="emit('gross')">
                <i class="uil uil-expand-arrows-alt"></i>
            </button>
        </div>

        <div class="radarCardBody" @click="!interaktiv && (hatDaten || eigenstaendig) && emit('gross')">
            <slot v-if="hatDaten || eigenstaendig"></slot>

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
