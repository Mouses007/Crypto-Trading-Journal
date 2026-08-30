<script setup>
/**
 * Seiten-Wrapper für den gemeinsamen Onboarding-Ablauf. Der Kontext kommt aus
 * der Query (`?kontext=setup|update|manuell`, Default 'update' — der
 * Auto-Trigger im Router leitet ohne Query hierher um): Setup.vue hängt sich
 * mit `?kontext=setup` an, der manuelle Button in Settings.vue mit
 * `?kontext=manuell`. Nur im Update-Fall lohnen sich Release-Notes — bei
 * einer Neuinstallation oder einem manuellen Aufruf gibt es kein "was ist
 * neu seit deinem letzten Besuch".
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import OnboardingAssistent from '../components/onboarding/OnboardingAssistent.vue'

const route = useRoute()
const { t } = useI18n()

const kontext = computed(() => ['setup', 'update', 'manuell'].includes(route.query.kontext) ? route.query.kontext : 'update')
const rueckkehrPfad = computed(() => route.query.rueckkehr || '/dashboard')

const releaseNotes = ref('')
const releaseName = ref('')

onMounted(async () => {
    if (kontext.value !== 'update') return
    try {
        const { data } = await axios.get('/api/update/check')
        releaseNotes.value = data.releaseNotes || ''
        releaseName.value = data.releaseName || ''
    } catch (e) {
        // Kein Blocker — der Assistent funktioniert auch ohne Notes.
    }
})
</script>

<template>
    <div class="update-assistent-container">
        <div v-if="releaseNotes" class="release-notes">
            <p class="release-name">{{ t('onboarding.whatsNew') }}{{ releaseName ? ' — ' + releaseName : '' }}</p>
            <div class="release-body">{{ releaseNotes }}</div>
        </div>
        <OnboardingAssistent :kontext="kontext" :rueckkehr-pfad="rueckkehrPfad" />
    </div>
</template>

<style scoped>
.update-assistent-container {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    background: var(--black-bg-color, #0d1117);
    padding: 2rem;
}

.release-notes {
    background: var(--black-bg-2-color, #161b22);
    border: 1px solid var(--white-10, rgba(255, 255, 255, 0.1));
    border-radius: 12px;
    max-width: 620px;
    width: 100%;
    padding: 1rem 1.5rem;
}

.release-name {
    font-weight: 600;
    color: var(--white-color, #e6edf3);
    margin-bottom: 0.5rem;
}

.release-body {
    white-space: pre-wrap;
    font-size: 0.85rem;
    color: var(--white-50, rgba(255, 255, 255, 0.6));
    max-height: 8rem;
    overflow-y: auto;
}
</style>
