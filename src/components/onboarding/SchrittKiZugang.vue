<script setup>
/**
 * Onboarding-Schritt "KI-Zugang" — bewusst NICHT aus Settings.vue extrahiert:
 * der dortige KI-Bereich ist eng mit Berichts-Presets, Task-Provider-
 * Zuordnungen und Share-Card-Einstellungen verwoben. Hier nur das Nötigste:
 * Anbieter wählen, Schlüssel eintragen, Modell wählen.
 *
 * Bereits vorhandene Werte bleiben erhalten: `/api/ai/settings` liefert Keys
 * maskiert zurück, `/api/ai/settings` (POST) ignoriert serverseitig jeden
 * Wert, der ein "•" enthält (`server/ollama-api.js`) — ein unverändert
 * gelassenes Feld überschreibt also nichts.
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'

const { t } = useI18n()

const anbieterListe = ref([])
const modellListen = ref({})
// Ollama führt keinen Katalog in `/api/ai/models` (server/ai-models.js: `modelle: []`,
// "kommen vom Ollama-Server selbst") — die echte Liste kommt separat aus
// `/api/ollama/status`, genau wie in Settings.vue (`loadOllamaModels()`).
const ollamaModels = ref([])
const aiProvider = ref('ollama')
const aiModel = ref('')
const aiKeys = reactive({})
const geladen = ref(false)

const aktuellerAnbieter = computed(() => anbieterListe.value.find(a => a.id === aiProvider.value) || null)
/**
 * Ein gespeichertes Modell, das nicht (mehr) in der Liste steht, würde das
 * Auswahlfeld sonst leer erscheinen lassen und beim nächsten Speichern still
 * verschwinden — dieselbe Absicherung wie Settings.vue `getModelsForProvider()`.
 */
const modelle = computed(() => {
    const liste = aiProvider.value === 'ollama' ? ollamaModels.value : (modellListen.value[aiProvider.value] || [])
    if (aiModel.value && !liste.includes(aiModel.value)) return [aiModel.value, ...liste]
    return liste
})
const schonEingerichtet = computed(() => {
    const wert = aiKeys[aiProvider.value]
    return aiProvider.value === 'ollama' || (!!wert && wert.includes('•'))
})

async function ladeOllamaModelle() {
    try {
        const res = await axios.get('/api/ollama/status')
        ollamaModels.value = res.data.models || []
    } catch (e) {
        ollamaModels.value = []
    }
}

onMounted(async () => {
    try {
        const [modelleRes, settingsRes] = await Promise.all([
            axios.get('/api/ai/models'),
            axios.get('/api/ai/settings'),
            ladeOllamaModelle(),
        ])
        anbieterListe.value = modelleRes.data.anbieter || []
        modellListen.value = modelleRes.data.modelle || {}
        aiProvider.value = settingsRes.data.aiProvider || 'ollama'
        aiModel.value = settingsRes.data.aiModel || ''
        for (const [id, wert] of Object.entries(settingsRes.data.keys || {})) aiKeys[id] = wert || ''
    } catch (e) {
        // Ohne Vorbelegung bleibt der Schritt einfach leer — kein Blocker.
    } finally {
        geladen.value = true
    }
})

/**
 * Nur speichern, wenn der Nutzer den Schritt aktiv genutzt hat. Ein Fehlschlag
 * wird NICHT geschluckt — der Elternteil (OnboardingAssistent.vue) fängt ihn
 * ab und zeigt ihn an, statt den Assistenten trotzdem als erledigt zu
 * markieren und wegzuleiten.
 */
async function uebernehmen() {
    if (!geladen.value) return
    await axios.post('/api/ai/settings', {
        aiProvider: aiProvider.value,
        aiModel: aiModel.value,
        keys: { ...aiKeys },
    })
}

defineExpose({ uebernehmen })
</script>

<template>
    <div class="onboarding-schritt">
        <h3>{{ t('onboarding.ki.title') }}</h3>
        <p class="text-muted">{{ t('onboarding.ki.intro') }}</p>

        <div class="mb-3">
            <label class="form-label small">{{ t('settings.provider') }}</label>
            <select class="form-select" v-model="aiProvider">
                <option v-for="a in anbieterListe" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
        </div>

        <div v-if="aktuellerAnbieter?.brauchtKey" class="mb-3">
            <label class="form-label small">{{ t('settings.apiKeyLabel') }}</label>
            <input type="password" class="form-control" v-model="aiKeys[aiProvider]"
                :placeholder="schonEingerichtet ? t('onboarding.ki.keySetHint') : 'sk-...'">
        </div>

        <div v-if="modelle.length" class="mb-1">
            <label class="form-label small">{{ t('settings.model') }}</label>
            <select class="form-select" v-model="aiModel">
                <option v-for="m in modelle" :key="m" :value="m">{{ m }}</option>
            </select>
        </div>

        <p v-if="schonEingerichtet" class="small text-success mt-2">
            <i class="uil uil-check-circle"></i> {{ t('onboarding.ki.alreadySet') }}
        </p>
    </div>
</template>
