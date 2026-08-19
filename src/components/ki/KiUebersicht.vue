<template>
    <div class="kiUeb">
        <div v-if="laedt" class="text-muted small py-3">
            <span class="spinner-border spinner-border-sm me-2"></span>{{ t('kiUebersicht.laedt') }}
        </div>
        <div v-else-if="fehler" class="alert alert-danger py-2 small">{{ fehler }}</div>

        <template v-else>
            <!-- ── Kennzahlen ─────────────────────────────────────────── -->
            <div class="kuGrid mb-4">
                <div class="kuZelle">
                    <div class="kuWert">{{ geld(daten.verbrauch.heute.kostenUsd) }}</div>
                    <div class="kuLabel">{{ t('kiUebersicht.heute') }}</div>
                    <div class="kuExtra">{{ t('kiUebersicht.laeufe', { n: daten.verbrauch.heute.laeufe }) }}</div>
                </div>
                <div class="kuZelle">
                    <div class="kuWert">{{ geld(daten.verbrauch.monat.kostenUsd) }}</div>
                    <div class="kuLabel">{{ t('kiUebersicht.monat') }}</div>
                    <div class="kuExtra">{{ t('kiUebersicht.laeufe', { n: daten.verbrauch.monat.laeufe }) }}</div>
                </div>
                <div class="kuZelle">
                    <div class="kuWert">{{ (daten.verbrauch.dreissigTage.totalTokens || 0).toLocaleString() }}</div>
                    <div class="kuLabel">{{ t('kiUebersicht.tokens30') }}</div>
                    <div class="kuExtra">{{ geld(daten.verbrauch.dreissigTage.kostenUsd) }}</div>
                </div>
                <div class="kuZelle">
                    <div class="kuWert" :class="{ 'kuAktiv': laeuftWas }">{{ aktiveAutomatiken }}</div>
                    <div class="kuLabel">{{ t('kiUebersicht.aktiveAutomatiken') }}</div>
                    <div class="kuExtra">
                        <span v-if="laeuftWas" class="kuPunkt"></span>
                        {{ laeuftWas ? t('kiUebersicht.laeuftGerade') : t('kiUebersicht.ruhe') }}
                    </div>
                </div>
            </div>

            <!-- ── Verlauf ────────────────────────────────────────────── -->
            <h6 class="kuTitel">{{ t('kiUebersicht.verlaufTitel') }}</h6>
            <p class="kuHinweis">{{ t('kiUebersicht.verlaufHinweis') }}</p>
            <div v-if="hatVerlauf" ref="verlaufEl" class="kuVerlauf"></div>
            <p v-else class="text-muted small mb-4">{{ t('kiUebersicht.keinVerbrauch') }}</p>

            <!-- ── Funktionen ─────────────────────────────────────────── -->
            <h6 class="kuTitel">{{ t('kiUebersicht.funktionenTitel') }}</h6>
            <p class="kuHinweis">{{ t('kiUebersicht.funktionenHinweis') }}</p>
            <div class="table-responsive mb-4">
                <table class="table table-sm align-middle kuTabelle">
                    <thead>
                        <tr>
                            <th>{{ t('kiUebersicht.spalteFunktion') }}</th>
                            <th>{{ t('kiUebersicht.spalteModell') }}</th>
                            <th class="text-end">{{ t('kiUebersicht.spalte30') }}</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="f in daten.funktionen" :key="f.id">
                            <td>{{ t(f.titelKey) }}</td>
                            <td>
                                <!-- Die Sammelzeile hat kein Modell, sondern die Schlüssel,
                                     unter denen gebucht wurde — sonst stünde dort nur „—". -->
                                <span v-if="f.schluessel" class="kuModell">{{ f.schluessel.join(', ') }}</span>
                                <template v-else>
                                    <span class="kuModell">{{ f.provider || '—' }}<template v-if="f.modell">/{{ f.modell }}</template></span>
                                    <span v-if="f.folgtGlobal" class="badge bg-secondary ms-2 kuBadge">
                                        {{ t('kiUebersicht.folgtGlobal') }}
                                    </span>
                                </template>
                            </td>
                            <td class="text-end">
                                <template v-if="f.verbrauch30.laeufe">
                                    {{ geld(f.verbrauch30.kostenUsd) }}
                                    <span class="kuExtra d-block">{{ t('kiUebersicht.laeufe', { n: f.verbrauch30.laeufe }) }}</span>
                                </template>
                                <span v-else class="text-muted">—</span>
                            </td>
                            <td class="text-end">
                                <a v-if="f.bereich" href="#" class="kuLink" @click.prevent="$emit('gehe-zu', f.bereich)">
                                    {{ t('kiUebersicht.einstellen') }}
                                </a>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- ── Automatiken ────────────────────────────────────────── -->
            <h6 class="kuTitel">{{ t('kiUebersicht.automatikenTitel') }}</h6>
            <p class="kuHinweis">{{ t('kiUebersicht.automatikenHinweis') }}</p>
            <div class="table-responsive">
                <table class="table table-sm align-middle kuTabelle">
                    <thead>
                        <tr>
                            <th>{{ t('kiUebersicht.spalteAutomatik') }}</th>
                            <th>{{ t('kiUebersicht.spalteTakt') }}</th>
                            <th>{{ t('kiUebersicht.spalteLetzter') }}</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="a in daten.automatiken" :key="a.id" :class="{ kuAus: !a.an }">
                            <td>
                                {{ t(a.titelKey) }}
                                <span v-if="a.kostet" class="badge bg-warning text-dark ms-2 kuBadge">
                                    {{ t('kiUebersicht.kostet') }}
                                </span>
                                <span v-if="!a.an" class="badge bg-secondary ms-2 kuBadge">
                                    {{ t('kiUebersicht.aus') }}
                                </span>
                            </td>
                            <!-- Wo ein Zeitplan steht, ersetzt er den Takt: „täglich"
                                 und „täglich ab 12 Uhr" untereinander sagt zweimal
                                 dasselbe, einmal davon unvollständig. -->
                            <td>{{ a.zeitplan ? zeitplanText(a.zeitplan) : t(a.taktKey) }}</td>
                            <td>
                                <span v-if="a.letzterLauf">{{ zeitpunkt(a.letzterLauf) }}</span>
                                <span v-else class="text-muted">{{ t('kiUebersicht.nochNie') }}</span>
                                <span v-if="a.fehler" class="kuFehler d-block" :title="a.fehler">
                                    <i class="uil uil-exclamation-triangle"></i> {{ a.fehler.slice(0, 60) }}
                                </span>
                            </td>
                            <td class="text-end">
                                <a v-if="a.bereich" href="#" class="kuLink" @click.prevent="$emit('gehe-zu', a.bereich)">
                                    {{ t('kiUebersicht.einstellen') }}
                                </a>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </template>
    </div>
</template>

<script setup>
/**
 * KI-Übersicht — was läuft, wo, wann, und was kostet es.
 *
 * Die Seite zeigt nur an. Jede Einstellung bleibt in ihrem Reiter; von hier
 * führt je Zeile ein Verweis dorthin. Ein zweiter Ort zum Ändern wäre ein
 * zweiter Ort, an dem etwas veraltet.
 */
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import * as echarts from 'echarts'
import { useKostenAnzeige } from '../../utils/formatters.js'
import { logWarn } from '../../utils/logger.js'

const { t, locale } = useI18n()
defineEmits(['gehe-zu'])

const laedt = ref(true)
const fehler = ref('')
const daten = ref(null)
const verlaufEl = ref(null)
let diagramm = null

const geld = (usd) => useKostenAnzeige(usd) || '—'

const aktiveAutomatiken = computed(() =>
    (daten.value?.automatiken || []).filter((a) => a.an && a.kostet).length)

const laeuftWas = computed(() =>
    Boolean(daten.value?.laeuft?.agent) || Number(daten.value?.laeuft?.engine?.aktiveLaeufe) > 0)

const hatVerlauf = computed(() => (daten.value?.verbrauch?.verlauf || []).length > 0)

function zeitpunkt(ms) {
    if (!ms) return ''
    return new Date(Number(ms)).toLocaleString(locale.value === 'en' ? 'en-GB' : 'de-CH', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    })
}

function zeitplanText(z) {
    const stunde = String(z.stunde).padStart(2, '0')
    if (z.rhythmus === 'woechentlich') {
        const tage = t('kiUebersicht.wochentage').split(',')
        return t('kiUebersicht.zeitplanWoche', { tag: tage[(z.wochentag - 1) % 7] || '', stunde })
    }
    return t('kiUebersicht.zeitplanTag', { stunde })
}

async function laden() {
    laedt.value = true
    fehler.value = ''
    try {
        const res = await axios.get('/api/ai/uebersicht')
        daten.value = res.data
        await nextTick()
        zeichne()
    } catch (e) {
        logWarn('ki-uebersicht', 'Übersicht konnte nicht geladen werden', e)
        fehler.value = t('kiUebersicht.fehler')
    } finally {
        laedt.value = false
    }
}

/**
 * Kosten je Tag, gestapelt nach Funktion.
 *
 * Gestapelt und nicht als Linien: die Frage ist „wofür ging das Geld", und
 * dafür muss man die Anteile eines Tages nebeneinander sehen, nicht zehn
 * Kurven übereinander.
 */
function zeichne() {
    if (!verlaufEl.value || !hatVerlauf.value) return
    const verlauf = daten.value.verbrauch.verlauf
    const faktor = daten.value.waehrung?.faktor || 1
    const code = daten.value.waehrung?.faktor ? daten.value.waehrung.code : 'USD'

    const funktionen = [...new Set(verlauf.flatMap((v) => Object.keys(v.jeFunktion)))]
    const serien = funktionen.map((f) => ({
        name: f,
        type: 'bar',
        stack: 'gesamt',
        emphasis: { focus: 'series' },
        data: verlauf.map((v) => Number(((v.jeFunktion[f] || 0) * faktor).toFixed(4))),
    }))

    diagramm?.dispose()
    diagramm = echarts.init(verlaufEl.value)
    diagramm.setOption({
        grid: { left: 50, right: 12, top: 30, bottom: 40 },
        tooltip: {
            trigger: 'axis', axisPointer: { type: 'shadow' },
            valueFormatter: (v) => `${Number(v).toFixed(2)} ${code}`,
        },
        legend: { type: 'scroll', top: 0, textStyle: { color: '#9aa0a6', fontSize: 10 } },
        xAxis: {
            type: 'category',
            data: verlauf.map((v) => v.tag.slice(5)),
            axisLabel: { color: '#9aa0a6', fontSize: 10 },
        },
        yAxis: {
            type: 'value',
            axisLabel: { color: '#9aa0a6', fontSize: 10, formatter: (v) => `${v} ${code}` },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,.06)' } },
        },
        series: serien,
    })
}

const beiGroesse = () => diagramm?.resize()

onMounted(() => {
    laden()
    window.addEventListener('resize', beiGroesse)
})
onBeforeUnmount(() => {
    window.removeEventListener('resize', beiGroesse)
    diagramm?.dispose()
})

// Sprachwechsel: die Achsen tragen übersetzte Einheiten
watch(locale, () => zeichne())

defineExpose({ laden })
</script>

<style scoped>
.kuTitel {
    font-size: .95rem;
    font-weight: 600;
    margin-bottom: .15rem;
}

.kuHinweis {
    font-size: .78rem;
    color: var(--grey-color, #9aa0a6);
    margin-bottom: .6rem;
}

.kuGrid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: .75rem;
}

.kuZelle {
    background: var(--black-bg-2, rgba(255, 255, 255, .03));
    border-radius: var(--border-radius, 8px);
    padding: .7rem .85rem;
}

.kuWert {
    font-size: 1.25rem;
    font-weight: 600;
    line-height: 1.2;
}

.kuWert.kuAktiv {
    color: var(--blue-color, #4da3ff);
}

.kuLabel {
    font-size: .78rem;
    color: var(--grey-color, #9aa0a6);
}

.kuExtra {
    font-size: .72rem;
    color: var(--grey-color, #9aa0a6);
}

.kuPunkt {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--blue-color, #4da3ff);
    margin-right: 4px;
    animation: kuPuls 1.6s ease-in-out infinite;
}

@keyframes kuPuls {
    0%, 100% { opacity: 1 }
    50% { opacity: .25 }
}

/* Bewegung abschalten, wo der Nutzer das wünscht — der Punkt bleibt sichtbar,
   er hört nur auf zu blinken. */
@media (prefers-reduced-motion: reduce) {
    .kuPunkt { animation: none }
}

.kuVerlauf {
    width: 100%;
    height: 220px;
    margin-bottom: 1.25rem;
}

.kuTabelle {
    font-size: .82rem;
}

.kuTabelle th {
    font-weight: 600;
    color: var(--grey-color, #9aa0a6);
    font-size: .75rem;
}

.kuModell {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .78rem;
}

.kuBadge {
    font-size: .62rem;
    font-weight: 500;
    vertical-align: middle;
}

.kuAus {
    opacity: .55;
}

.kuFehler {
    font-size: .72rem;
    color: var(--red-color, #e06c75);
}

.kuLink {
    font-size: .78rem;
    text-decoration: none;
    white-space: nowrap;
}
</style>
