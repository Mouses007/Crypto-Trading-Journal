<script setup>
/**
 * Onboarding-Schritt "Standardeinstellungen übernehmen?" — rein
 * localStorage-basiert, kein Server-Call nötig. Datengetrieben aus
 * `onboarding-defaults.js`, damit ein künftiger neuer Standard nur ein
 * weiterer Listeneintrag ist, keine Änderung an dieser Komponente.
 */
import { reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import InfoTipp from '../InfoTipp.vue'
import { STANDARD_VORSCHLAEGE } from '../../config/onboarding-defaults.js'

const { t } = useI18n()

/*
 * Vorbelegung: angehakt nur, wenn der Nutzer hier noch nichts Eigenes
 * eingestellt hat (`bereitsAngepasst()` false) — sonst würde ein blosses
 * Durchklicken des Assistenten eine bestehende, selbst gewählte Ansicht ohne
 * Warnung überschreiben.
 */
const angehakt = reactive(Object.fromEntries(
    STANDARD_VORSCHLAEGE.map(v => [v.id, !v.bereitsAngepasst?.()]),
))

/** Wendet alle angehakten Vorschläge an. Vom Elternteil beim "Weiter" gerufen. */
function uebernehmen() {
    for (const vorschlag of STANDARD_VORSCHLAEGE) {
        if (angehakt[vorschlag.id]) vorschlag.anwenden()
    }
}

defineExpose({ uebernehmen })
</script>

<template>
    <div class="onboarding-schritt">
        <h3>{{ t('onboarding.defaults.title') }}</h3>
        <p class="text-muted">{{ t('onboarding.defaults.intro') }}</p>
        <div class="vorschlag-liste">
            <label v-for="v in STANDARD_VORSCHLAEGE" :key="v.id" class="vorschlag-item">
                <input type="checkbox" v-model="angehakt[v.id]">
                <span>
                    {{ t(v.labelKey) }}
                    <InfoTipp :schluessel="v.infoKey" />
                    <small v-if="v.bereitsAngepasst?.()" class="d-block text-muted">
                        {{ t('onboarding.defaults.alreadyCustomized') }}
                    </small>
                </span>
            </label>
        </div>
    </div>
</template>

<style scoped>
.vorschlag-liste {
    margin-top: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.vorschlag-item {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    cursor: pointer;
}

.vorschlag-item input {
    margin-top: 0.2rem;
}
</style>
