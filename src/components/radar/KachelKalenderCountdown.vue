<script setup>
/**
 * Kachel „Termine".
 *
 * Nicht der ganze Wirtschaftskalender — nur was in den nächsten Stunden kommt,
 * mit Restzeit. Der Unterschied ist der Zweck: auf der Nachrichtenseite blättert
 * man durch die Woche, hier will man wissen, ob in zwanzig Minuten eine Zahl
 * kommt, die den Markt kippt.
 *
 * Der Countdown läuft im Browser weiter, ohne dass nachgeladen wird — die
 * Termine stehen fest, nur die Restzeit schrumpft.
 *
 * **Wichtig für die Deutung:** steht die Liste leer, kann das zwei Dinge heissen
 * — nichts los, oder alles weggefiltert. `gesamtImZeitraum` unterscheidet
 * beides, und die Kachel sagt es auch. Ohne diese Zeile hält man einen
 * scharfen Länderfilter für einen ruhigen Tag.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from '../../utils/dayjs-setup.js'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
    params: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['params'])

const { t } = useI18n()

const STUNDEN = [4, 8, 24]

const jetzt = ref(Date.now())
let takt = null

onMounted(() => {
    takt = setInterval(() => { if (!document.hidden) jetzt.value = Date.now() }, 1000)
})
onBeforeUnmount(() => clearInterval(takt))

const ereignisse = computed(() => {
    const liste = props.daten?.ereignisse || []
    return liste
        // Termine, die mehr als 30 Minuten vorbei sind, fallen raus: die
        // veröffentlichte Zahl interessiert kurz nach, danach nicht mehr
        .filter(e => e.dateUnix > jetzt.value - 30 * 60 * 1000)
        .map(e => ({
            ...e,
            restMs: e.dateUnix - jetzt.value,
            vorbei: e.dateUnix <= jetzt.value,
        }))
        .slice(0, props.gross ? 20 : 5)
})

const alleGefiltert = computed(() =>
    !ereignisse.value.length && Number(props.daten?.gesamtImZeitraum || 0) > 0)

/** „in 18 min" bzw. „in 3 h 05" — unter einer Minute auf Sekunden. */
function restText(ms) {
    if (ms <= 0) return t('livetrading.kalender.jetzt')
    const s = Math.round(ms / 1000)
    if (s < 60) return t('livetrading.kalender.inSek', { s })
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    if (h > 0) return t('livetrading.kalender.inStd', { h, m: String(m).padStart(2, '0') })
    return t('livetrading.kalender.inMin', { m })
}

/** Ab zwanzig Minuten vorher wird die Zeile dringend. */
const dringend = (e) => !e.vorbei && e.restMs <= 20 * 60 * 1000

const stufe = (impact) => String(impact || '').toLowerCase()
</script>

<template>
    <div v-if="daten" class="kdWrap" :class="{ gross }">
        <div class="kdKopf">
            <span class="kdLabel">{{ t('livetrading.kalender.fenster') }}</span>
            <button v-for="s in STUNDEN" :key="s" type="button"
                :class="['ctl-pill', Number(daten.stunden) === s ? 'active' : '']"
                @click.stop="emit('params', { stunden: s })">{{ s }} h</button>
        </div>

        <div v-if="ereignisse.length" class="kdListe">
            <div v-for="e in ereignisse" :key="e.extId"
                :class="['kdZeile', { vorbei: e.vorbei, dringend: dringend(e) }]">
                <span :class="['kdImpact', 'impact-' + stufe(e.impact)]"
                    :title="t('livetrading.kalender.impact_' + stufe(e.impact))"></span>
                <span class="kdLand">{{ e.land }}</span>
                <span class="kdTitel">{{ e.titel }}</span>
                <span class="kdRest">{{ restText(e.restMs) }}</span>
                <span class="kdUhr">{{ dayjs(e.dateUnix).format('HH:mm') }}</span>
            </div>
        </div>

        <!-- Der Unterschied, der in eine Kachel gehört -->
        <div v-else-if="alleGefiltert" class="kdLeer">
            {{ t('livetrading.kalender.allesGefiltert', { n: daten.gesamtImZeitraum }) }}
        </div>
        <div v-else class="kdLeer">{{ t('livetrading.kalender.nichtsLos') }}</div>

        <div v-if="gross && daten.letzterFehler" class="kdFehler">{{ daten.letzterFehler }}</div>
    </div>
</template>

<style scoped>
.kdWrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    gap: 0.3rem;
}

.kdKopf {
    display: flex;
    align-items: center;
    gap: 0.3rem;
}

.kdLabel {
    font-size: 0.74rem;
    color: var(--white-60);
}

.kdListe {
    display: flex;
    flex-direction: column;
    gap: 0.12rem;
    overflow-y: auto;
    min-height: 0;
}

.kdZeile {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    font-size: 0.8rem;
    padding: 0.12rem 0.2rem;
    border-radius: 4px;
}

.kdZeile.dringend {
    background: rgba(255, 201, 60, 0.14);
}

.kdZeile.vorbei {
    opacity: 0.45;
}

.kdImpact {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: 0 0 auto;
    background: var(--white-60);
}

.kdImpact.impact-high { background: #ff6b7a; }
.kdImpact.impact-medium { background: #ffc93c; }
.kdImpact.impact-low { background: rgba(255, 255, 255, 0.35); }
.kdImpact.impact-holiday { background: #01B4FF; }

.kdLand {
    font-weight: 700;
    font-size: 0.7rem;
    color: var(--white-60);
    min-width: 2.1rem;
}

.kdTitel {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--white-87);
}

.kdRest {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: var(--white-87);
    white-space: nowrap;
}

.kdZeile.dringend .kdRest { color: #ffc93c; }

.kdUhr {
    font-variant-numeric: tabular-nums;
    font-size: 0.72rem;
    color: var(--white-60);
    min-width: 2.5rem;
    text-align: right;
}

.kdLeer {
    margin: auto 0;
    font-size: 0.8rem;
    color: var(--white-60);
    text-align: center;
    padding: 0.5rem;
}

.kdFehler {
    font-size: 0.7rem;
    color: #ff6b7a;
}
</style>
