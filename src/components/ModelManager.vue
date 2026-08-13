<script setup>
/**
 * Modelle verwalten.
 *
 * Zwei getrennte Welten hinter einer Oberfläche:
 *
 *   Cloud-Anbieter — die Liste ist reine Bequemlichkeit. Der Anbieter kennt
 *     seine Modelle, die App muss sie nur anbieten können. Darum: frei
 *     bearbeitbar, mit den eingebauten Namen als Ausgangspunkt.
 *   Ollama — die Liste ist eine Tatsache. Verfügbar ist, was auf der Platte
 *     liegt. Darum: vom Server geholt, mit Laden und Löschen.
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { apiFehlerText } from '../utils/apiError.js'

const { t } = useI18n()

const props = defineProps({
    provider: { type: String, required: true },
    ollamaUrl: { type: String, default: '' },
})
const emit = defineEmits(['geaendert'])

const offen = ref(false)
const listen = ref({})
const standard = ref({})
const ohneSampling = ref([])
const ollamaModelle = ref([])
const neuerName = ref('')
const angebot = ref(null)      // vom Anbieter geholte Liste
const holtAngebot = ref(false)
const fehler = ref('')
const meldung = ref('')
const laedt = ref(false)

// Download-Fortschritt
const download = ref(null)
let strom = null

const istOllama = computed(() => props.provider === 'ollama')
const eigene = computed(() => listen.value[props.provider] || [])
const abweichend = computed(() => {
    const s = standard.value[props.provider] || []
    return eigene.value.length !== s.length || eigene.value.some((m, i) => m !== s[i])
})

const mb = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : Math.round(b / 1048576) + ' MB')
const istOhneSampling = (m) => ohneSampling.value.some((p) => String(m).startsWith(p))

async function laden() {
    fehler.value = ''
    try {
        const r = await axios.get('/api/ai/models')
        listen.value = r.data.modelle
        standard.value = r.data.standard
        ohneSampling.value = r.data.ohneSampling || []
        if (istOllama.value) await ollamaLaden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('settings.modelsLoadFailed'), t)
    }
}

async function ollamaLaden() {
    try {
        const r = await axios.get('/api/ollama/models', { params: { url: props.ollamaUrl || undefined } })
        ollamaModelle.value = r.data.models || []
    } catch (e) {
        ollamaModelle.value = []
        fehler.value = apiFehlerText(e, t('settings.ollamaUnreachable'), t)
    }
}

async function oeffnen() {
    offen.value = !offen.value
    if (offen.value) await laden()
}

watch(() => props.provider, () => { if (offen.value) laden() })

async function speichern(neueListe) {
    laedt.value = true
    fehler.value = ''
    try {
        const r = await axios.put(`/api/ai/models/${props.provider}`, { modelle: neueListe })
        listen.value = r.data.modelle
        emit('geaendert', listen.value[props.provider] || [])
    } catch (e) {
        fehler.value = apiFehlerText(e, t('settings.modelsSaveFailed'), t)
    } finally {
        laedt.value = false
    }
}

function hinzufuegen() {
    const name = neuerName.value.trim()
    if (!name) return
    if (eigene.value.includes(name)) { neuerName.value = ''; return }
    speichern([...eigene.value, name])
    neuerName.value = ''
}

const entfernen = (m) => speichern(eigene.value.filter((x) => x !== m))

/** Den Katalog des Anbieters holen — abtippen ist eine Fehlerquelle. */
async function angebotHolen() {
    holtAngebot.value = true
    fehler.value = ''
    try {
        const r = await axios.get('/api/ai/models/available', { params: { provider: props.provider } })
        angebot.value = r.data.modelle || []
        if (!angebot.value.length) fehler.value = t('settings.providerNoModels')
    } catch (e) {
        angebot.value = null
        fehler.value = apiFehlerText(e, t('settings.providerFetchFailed'), t)
    } finally {
        holtAngebot.value = false
    }
}

const uebernehmen = (m) => speichern([...eigene.value, m])
const alleUebernehmen = () => speichern([...new Set([...eigene.value, ...(angebot.value || [])])])
const zuruecksetzen = () => speichern([])

// ── Ollama: laden und löschen ───────────────────────────────────────────

/**
 * Der Download läuft über SSE, weil ein Modell etliche GB gross sein kann.
 * Ohne Fortschritt wäre minutenlang nicht zu unterscheiden, ob es lädt oder
 * hängt.
 */
function herunterladen() {
    const name = neuerName.value.trim()
    if (!name || download.value) return
    fehler.value = ''
    meldung.value = ''
    download.value = { name, status: t('settings.starting'), fertig: 0, gesamt: 0 }

    // POST mit SSE-Antwort — dafür fetch statt EventSource (das kann nur GET).
    const abbruch = new AbortController()
    strom = abbruch
    fetch('/api/ollama/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url: props.ollamaUrl || undefined }),
        signal: abbruch.signal,
    }).then(async (r) => {
        if (!r.ok || !r.body) {
            const d = await r.json().catch(() => ({}))
            throw new Error(d.error || `HTTP ${r.status}`)
        }
        const leser = r.body.getReader()
        const dec = new TextDecoder()
        let rest = ''
        for (;;) {
            const { done, value } = await leser.read()
            if (done) break
            rest += dec.decode(value, { stream: true })
            const teile = rest.split('\n\n')
            rest = teile.pop() || ''
            for (const t2 of teile) {
                const zeile = t2.split('\n').find((z) => z.startsWith('data: '))
                if (!zeile) continue
                let o
                try { o = JSON.parse(zeile.slice(6)) } catch { continue }
                if (o.fehler) throw new Error(o.fehler)
                if (o.fertigGesamt) {
                    meldung.value = t('settings.modelDownloaded', { name })
                    neuerName.value = ''
                    await ollamaLaden()
                    emit('geaendert', ollamaModelle.value.map((m) => m.name))
                    continue
                }
                download.value = { name, status: o.status || '', fertig: o.fertig || 0, gesamt: o.gesamt || 0 }
            }
        }
    }).catch((e) => {
        if (e.name !== 'AbortError') fehler.value = e.message
    }).finally(() => {
        download.value = null
        strom = null
    })
}

function abbrechen() {
    strom?.abort()
    download.value = null
}

onBeforeUnmount(abbrechen)

const loeschFrage = ref(null)
async function ollamaLoeschen(name) {
    try {
        await axios.delete('/api/ollama/models', { data: { name, url: props.ollamaUrl || undefined } })
        loeschFrage.value = null
        await ollamaLaden()
        emit('geaendert', ollamaModelle.value.map((m) => m.name))
    } catch (e) {
        fehler.value = apiFehlerText(e, t('settings.deleteFailed'), t)
    }
}

const prozent = computed(() => {
    const d = download.value
    return d && d.gesamt > 0 ? Math.round((d.fertig / d.gesamt) * 100) : 0
})
</script>

<template>
    <div class="mt-2">
        <button class="btn btn-sm btn-outline-secondary" @click="oeffnen">
            <i class="uil" :class="offen ? 'uil-angle-up' : 'uil-angle-down'"></i>
            {{ t('settings.manageModels') }}
        </button>

        <div v-if="offen" class="modelle mt-2 p-3">
            <div v-if="fehler" class="alert alert-danger py-2 small">{{ fehler }}</div>
            <div v-if="meldung" class="alert alert-success py-2 small">{{ meldung }}</div>

            <!-- ══ Ollama: was auf der Platte liegt ══ -->
            <template v-if="istOllama">
                <p class="small text-muted mb-2">{{ t('settings.ollamaModelsHint') }}</p>

                <table v-if="ollamaModelle.length" class="table table-sm table-borderless mb-2">
                    <tbody>
                        <tr v-for="m in ollamaModelle" :key="m.name">
                            <td class="small"><span class="mono">{{ m.name }}</span></td>
                            <td class="small text-muted">{{ m.parameter }} {{ m.quantisierung }}</td>
                            <td class="small text-muted text-end">{{ mb(m.groesseBytes) }}</td>
                            <td class="text-end" style="white-space: nowrap; width: 6rem;">
                                <template v-if="loeschFrage === m.name">
                                    <button class="btn btn-sm btn-danger py-0 me-1"
                                        @click="ollamaLoeschen(m.name)">{{ t('common.yes') }}</button>
                                    <button class="btn btn-sm btn-outline-secondary py-0"
                                        @click="loeschFrage = null">{{ t('common.no') }}</button>
                                </template>
                                <button v-else class="btn btn-sm btn-outline-danger py-0"
                                    :title="t('settings.deleteModel')" @click="loeschFrage = m.name">
                                    <i class="uil uil-trash-alt"></i>
                                </button>
                            </td>
                        </tr>
                    </tbody>
                </table>
                <p v-else class="small text-muted">{{ t('settings.noOllamaModels') }}</p>

                <div v-if="download" class="mb-2">
                    <div class="d-flex align-items-center gap-2 small">
                        <span class="me-auto">{{ download.name }} — {{ download.status }}</span>
                        <span v-if="download.gesamt">{{ mb(download.fertig) }} / {{ mb(download.gesamt) }}</span>
                        <button class="btn btn-sm btn-outline-danger py-0" @click="abbrechen">
                            {{ t('common.cancel') }}
                        </button>
                    </div>
                    <div class="progress mt-1" style="height: 6px;">
                        <div class="progress-bar" :style="{ width: prozent + '%' }"></div>
                    </div>
                </div>

                <div class="d-flex gap-2">
                    <input v-model="neuerName" class="form-control form-control-sm"
                        :placeholder="t('settings.ollamaPullPlaceholder')"
                        :disabled="!!download" @keydown.enter.prevent="herunterladen" />
                    <button class="btn btn-sm btn-success" :disabled="!!download || !neuerName.trim()"
                        @click="herunterladen">
                        <i class="uil uil-download-alt me-1"></i>{{ t('settings.download') }}
                    </button>
                </div>
                <small class="text-muted">{{ t('settings.ollamaPullHint') }}</small>
            </template>

            <!-- ══ Cloud-Anbieter: freie Liste ══ -->
            <template v-else>
                <p class="small text-muted mb-2">{{ t('settings.cloudModelsHint') }}</p>

                <div v-for="m in eigene" :key="m" class="d-flex align-items-center gap-2 mb-1">
                    <span class="mono small me-auto">{{ m }}</span>
                    <span v-if="istOhneSampling(m)" class="badge bg-dark"
                        :title="t('settings.noSamplingHint')">{{ t('settings.noSampling') }}</span>
                    <button class="btn btn-sm btn-outline-danger py-0" @click="entfernen(m)">
                        <i class="uil uil-times"></i>
                    </button>
                </div>

                <div class="d-flex gap-2 mt-3">
                    <button class="btn btn-sm btn-outline-primary" :disabled="holtAngebot"
                        @click="angebotHolen">
                        <span v-if="holtAngebot" class="spinner-border spinner-border-sm me-1"></span>
                        <i v-else class="uil uil-cloud-download me-1"></i>{{ t('settings.fetchFromProvider') }}
                    </button>
                    <button v-if="angebot" class="btn btn-sm btn-outline-secondary" @click="angebot = null">
                        {{ t('common.close') }}
                    </button>
                </div>

                <div v-if="angebot" class="angebot mt-2 p-2">
                    <div class="d-flex align-items-center mb-1">
                        <span class="small text-muted me-auto">
                            {{ t('settings.providerOffers', { n: angebot.length }) }}
                        </span>
                        <button class="btn btn-sm btn-outline-primary py-0" @click="alleUebernehmen">
                            {{ t('settings.addAll') }}
                        </button>
                    </div>
                    <div v-for="m in angebot" :key="m" class="d-flex align-items-center gap-2 py-1">
                        <span class="mono small me-auto" :class="{ 'text-muted': eigene.includes(m) }">{{ m }}</span>
                        <span v-if="istOhneSampling(m)" class="badge bg-dark">{{ t('settings.noSampling') }}</span>
                        <span v-if="eigene.includes(m)" class="small text-muted">{{ t('settings.alreadyInList') }}</span>
                        <button v-else class="btn btn-sm btn-outline-primary py-0" @click="uebernehmen(m)">
                            <i class="uil uil-plus"></i>
                        </button>
                    </div>
                </div>

                <div class="d-flex gap-2 mt-2">
                    <input v-model="neuerName" class="form-control form-control-sm"
                        :placeholder="t('settings.modelNamePlaceholder')"
                        @keydown.enter.prevent="hinzufuegen" />
                    <button class="btn btn-sm btn-outline-primary" :disabled="laedt || !neuerName.trim()"
                        @click="hinzufuegen">
                        <i class="uil uil-plus"></i>
                    </button>
                    <button v-if="abweichend" class="btn btn-sm btn-outline-secondary"
                        :disabled="laedt" @click="zuruecksetzen">
                        {{ t('settings.resetList') }}
                    </button>
                </div>
            </template>
        </div>
    </div>
</template>

<style scoped>
.modelle {
    border: 1px solid var(--white-12, rgba(255, 255, 255, 0.1));
    border-radius: var(--border-radius, 6px);
    background: var(--black-bg-5, rgba(0, 0, 0, 0.2));
}

.mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8rem;
}

.angebot {
    border: 1px solid var(--white-12, rgba(255, 255, 255, 0.1));
    border-radius: var(--border-radius, 6px);
    max-height: 40vh;
    overflow-y: auto;
}
</style>
