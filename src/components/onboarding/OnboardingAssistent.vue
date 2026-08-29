<script setup>
/**
 * Gemeinsamer Onboarding-Schritt-Satz (Standardeinstellungen/KI/News/Mail) —
 * läuft sowohl nach dem Setup-Wizard (`kontext: 'setup'`) als auch als
 * eigenständiger Update-Assistent (`kontext: 'update'`) und manuell über
 * Einstellungen (`kontext: 'manuell'`). Der Kontext steuert nur den
 * Einleitungstext, der Ablauf ist identisch.
 *
 * "Fertig" und "Später" markieren beide die aktuelle Version als gesehen
 * (verhindert, dass der Update-Assistent bei jedem Reload erneut aufploppt)
 * und machen danach einen HARTEN Reload — wie Setup.vue es bereits tut —
 * damit der Router-Cache (`updateAssistantPending`) neu geladen wird statt
 * in eine Redirect-Schleife zu laufen.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import SchrittStandardeinstellungen from './SchrittStandardeinstellungen.vue'
import SchrittKiZugang from './SchrittKiZugang.vue'
import SchrittNewsQuellen from './SchrittNewsQuellen.vue'
import SchrittMailKonfiguration from './SchrittMailKonfiguration.vue'

const props = defineProps({
    kontext: { type: String, default: 'manuell' }, // 'setup' | 'update' | 'manuell'
    rueckkehrPfad: { type: String, default: '/dashboard' },
})

const { t } = useI18n()

const SCHRITTE = 4
const schritt = ref(1)
const beendet = ref(false)

const standardRef = ref(null)
const kiRef = ref(null)

async function markiereGesehen() {
    try {
        await axios.post('/api/setup/update-assistent/gesehen')
    } catch (e) {
        // Nicht blockierend — der manuelle Wiederaufruf bleibt so oder so möglich.
    }
}

function weiter() {
    if (schritt.value < SCHRITTE) schritt.value += 1
    else fertig()
}

function zurueck() {
    if (schritt.value > 1) schritt.value -= 1
}

async function fertig() {
    if (beendet.value) return
    beendet.value = true
    standardRef.value?.uebernehmen()
    await kiRef.value?.uebernehmen()
    await markiereGesehen()
    window.location.href = props.rueckkehrPfad
}

async function spaeter() {
    if (beendet.value) return
    beendet.value = true
    await markiereGesehen()
    window.location.href = props.rueckkehrPfad
}
</script>

<template>
    <div class="onboarding-card">
        <div class="onboarding-header">
            <h2>{{ t(`onboarding.intro.${kontext}Title`) }}</h2>
            <p class="text-muted mb-0">{{ t(`onboarding.intro.${kontext}Text`) }}</p>
            <div class="step-indicator mt-3">
                <div v-for="n in SCHRITTE" :key="n" class="step-dot"
                    :class="{ active: schritt >= n, done: schritt > n }">{{ n }}</div>
            </div>
        </div>

        <div class="onboarding-body">
            <SchrittStandardeinstellungen v-show="schritt === 1" ref="standardRef" />
            <SchrittKiZugang v-show="schritt === 2" ref="kiRef" />
            <div v-show="schritt === 3" class="onboarding-schritt">
                <h3>{{ t('onboarding.news.title') }}</h3>
                <p class="text-muted">{{ t('onboarding.news.intro') }}</p>
                <SchrittNewsQuellen />
            </div>
            <div v-show="schritt === 4" class="onboarding-schritt">
                <h3>{{ t('onboarding.mail.title') }}</h3>
                <p class="text-muted">{{ t('onboarding.mail.intro') }}</p>
                <SchrittMailKonfiguration />
            </div>

            <div class="d-flex gap-2 mt-4">
                <button v-if="schritt > 1" class="btn btn-outline-secondary" @click="zurueck">
                    <i class="uil uil-arrow-left me-1"></i>{{ t('common.back') }}
                </button>
                <button class="btn btn-primary flex-grow-1" @click="weiter" :disabled="beendet">
                    {{ schritt < SCHRITTE ? t('common.next') : t('onboarding.finish') }}
                    <i class="uil uil-arrow-right ms-1"></i>
                </button>
            </div>
            <p class="mt-3 mb-0 text-center">
                <button type="button" class="btn btn-link btn-sm text-muted p-0" :disabled="beendet" @click="spaeter">
                    {{ t('onboarding.later') }}
                </button>
            </p>
        </div>
    </div>
</template>

<style scoped>
.onboarding-card {
    background: var(--black-bg-2-color, #161b22);
    border-radius: 12px;
    border: 1px solid var(--white-10, rgba(255, 255, 255, 0.1));
    max-width: 620px;
    width: 100%;
    overflow: hidden;
}

.onboarding-header {
    text-align: center;
    padding: 2rem 2rem 1rem;
    border-bottom: 1px solid var(--white-10, rgba(255, 255, 255, 0.1));
}

.onboarding-header h2 {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--white-color, #e6edf3);
    margin-bottom: 0.5rem;
}

.step-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
}

.step-dot {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    font-weight: 600;
    border: 2px solid var(--white-10, rgba(255, 255, 255, 0.15));
    color: var(--white-10, rgba(255, 255, 255, 0.3));
}

.step-dot.active {
    border-color: var(--blue-color, #58a6ff);
    color: var(--blue-color, #58a6ff);
    background: rgba(88, 166, 255, 0.1);
}

.step-dot.done {
    border-color: #3fb950;
    color: #3fb950;
    background: rgba(63, 185, 80, 0.1);
}

.onboarding-body {
    padding: 2rem;
}

.onboarding-schritt h3 {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--white-color, #e6edf3);
    margin-bottom: 0.5rem;
}
</style>
