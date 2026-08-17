<script setup>
/**
 * Kachel „Handelszeiten".
 *
 * Die einzige Kachel im Live-Fenster, die keine Frage nach dem Markt
 * beantwortet, sondern nach der Uhr: *ist jetzt eine gute Zeit?* Krypto läuft
 * durch, aber der Takt kommt von den Aktienmärkten — um 9:30 New Yorker Zeit
 * reisst die Kassaeröffnung Spreads auf und dreht Kurse, und wer da mitten
 * hinein einsteigt, handelt gegen Maschinen.
 *
 * Rechnet selbst statt zu fragen (`endpunkt: null`): der Countdown tickt
 * sekündlich, ein Endpunkt dafür wäre absurd. Die Logik liegt in
 * `shared/handelszeiten.js`, damit Server und Browser dieselbe Rechnung
 * benutzen — und damit sie einen Selbsttest haben kann.
 *
 * Kalendertermine kommen später von aussen dazu (Kachel „Termine"); solange
 * keine da sind, bleiben die kalendergebundenen Warnfenster stumm, statt jeden
 * Werktag um 8:30 grundlos zu leuchten.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from '../../utils/dayjs-setup.js'
import { lageZu } from '../../../shared/handelszeiten.js'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
    params: { type: Object, default: () => ({}) },
})

const { t } = useI18n()

const jetzt = ref(Date.now())
let takt = null

/**
 * Sekundentakt, aber nur solange die Seite sichtbar ist. Ein Countdown im
 * Hintergrund weiterzuzählen kostet nichts Sichtbares und weckt bei jedem Tick
 * das Neuzeichnen.
 */
function tick() {
    if (!document.hidden) jetzt.value = Date.now()
}

onMounted(() => {
    takt = setInterval(tick, 1000)
    document.addEventListener('visibilitychange', tick)
})
onBeforeUnmount(() => {
    clearInterval(takt)
    document.removeEventListener('visibilitychange', tick)
})

/** Termine und Feiertage reicht die Seite durch, sobald es sie gibt. */
const lage = computed(() => lageZu(jetzt.value, {
    ereignisse: props.daten?.ereignisse || null,
    feiertage: props.daten?.feiertage || null,
}))

const warnung = computed(() => {
    const w = lage.value.warnungen
    // Die schärfste zuerst — bei zwei gleichzeitigen zählt die höhere Stufe
    return w.find(x => x.stufe === 'hoch') || w[0] || null
})

const naechste = computed(() => lage.value.naechste.slice(0, props.gross ? 4 : 2))

/** Verbleibende Zeit als „2 h 14 min" bzw. „7 min 12 s" unter einer Stunde. */
function restText(ms) {
    const s = Math.max(0, Math.round(ms / 1000))
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`
    return `${m} min ${String(s % 60).padStart(2, '0')} s`
}

const uhr = (ms) => dayjs(ms).format('HH:mm')

/** Beschriftung einer Phase oder Marke; beide liegen im selben i18n-Block. */
const name = (id) => t('livetrading.handelszeiten.' + id)

/**
 * Farbe der Kachel. Grün heisst nicht „gutes Setup", sondern nur: keine
 * bekannte Zeitfalle. Das steht auch so in der Fusszeile.
 */
const ampel = computed(() => {
    if (warnung.value?.stufe === 'hoch') return 'rot'
    if (warnung.value) return 'gelb'
    if (!lage.value.terminmarktOffen) return 'grau'
    return 'gruen'
})

/** Band der Sitzungen: nur was heute noch kommt bzw. gerade läuft. */
const band = computed(() => lage.value.phasenHeute
    .filter(p => p.bis > jetzt.value - 60 * 60 * 1000)
    .slice(0, props.gross ? 8 : 4))
</script>

<template>
    <div class="hzWrap" :class="['ampel-' + ampel, { gross }]">
        <!-- Warnband: im Handelsfenster die wichtigste Zeile der Seite -->
        <div v-if="warnung" class="hzWarn" :class="'stufe-' + warnung.stufe">
            <i class="uil uil-exclamation-triangle"></i>
            <span class="hzWarnText">{{ t('livetrading.handelszeiten.warn_' + warnung.id) }}</span>
            <span class="hzWarnBis">{{ t('livetrading.handelszeiten.bis', { zeit: uhr(warnung.bisMs) }) }}</span>
        </div>

        <div class="hzKopf">
            <span class="hzPhase">
                {{ lage.phase ? name(lage.phase.id) : t('livetrading.handelszeiten.ruhe') }}
            </span>
            <span v-if="lage.ueberlappung" class="hzUeberlappung">
                {{ t('livetrading.handelszeiten.ueberlappung') }}
            </span>
        </div>

        <!-- Countdown auf das nächste Ereignis -->
        <div v-if="naechste.length" class="hzNaechste">
            <div v-for="n in naechste" :key="n.art + n.id" class="hzZeile">
                <span class="hzZeileName">{{ name(n.id) }}</span>
                <span class="hzZeileRest">{{ restText(n.inMs) }}</span>
                <span class="hzZeileUhr">{{ uhr(n.tMs) }}</span>
            </div>
        </div>

        <!-- Sitzungsband -->
        <div v-if="gross && band.length" class="hzBand">
            <div v-for="p in band" :key="p.id + p.von" class="hzBandStueck" :class="{ aktiv: p.aktiv }">
                <span class="hzBandName">{{ name(p.id) }}</span>
                <span class="hzBandZeit">{{ uhr(p.von) }}–{{ uhr(p.bis) }}</span>
            </div>
        </div>

        <div class="hzFuss">
            <span v-if="!lage.terminmarktOffen">{{ t('livetrading.handelszeiten.cmeZu') }}</span>
            <span v-else-if="lage.feiertag">{{ t('livetrading.handelszeiten.feiertag') }}</span>
            <span v-else-if="lage.feiertagUnbekannt">{{ t('livetrading.handelszeiten.feiertagUnbekannt') }}</span>
            <span v-else>{{ t('livetrading.handelszeiten.normal') }}</span>
        </div>
    </div>
</template>

<style scoped>
.hzWrap {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    height: 100%;
    padding: 0.1rem 0.15rem;
    overflow: hidden;
}

.hzWarn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.5rem;
    border-radius: var(--border-radius);
    font-size: 0.82rem;
    font-weight: 600;
}

.hzWarn.stufe-hoch {
    background: rgba(220, 53, 69, 0.18);
    color: #ff6b7a;
}

.hzWarn.stufe-mittel {
    background: rgba(255, 193, 7, 0.15);
    color: #ffc93c;
}

.hzWarnText {
    flex: 1;
    min-width: 0;
}

.hzWarnBis {
    opacity: 0.8;
    font-weight: 400;
    white-space: nowrap;
}

.hzKopf {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
}

.hzPhase {
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--white-87);
}

.ampel-gruen .hzPhase { color: #4ec9a0; }
.ampel-gelb .hzPhase { color: #ffc93c; }
.ampel-rot .hzPhase { color: #ff6b7a; }
.ampel-grau .hzPhase { color: var(--white-60); }

.hzUeberlappung {
    font-size: 0.72rem;
    padding: 0.05rem 0.35rem;
    border-radius: 999px;
    background: rgba(1, 180, 255, 0.18);
    color: #01B4FF;
}

.hzNaechste {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
}

.hzZeile {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.84rem;
}

.hzZeileName {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--white-60);
}

.hzZeileRest {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: var(--white-87);
}

.hzZeileUhr {
    font-variant-numeric: tabular-nums;
    font-size: 0.76rem;
    color: var(--white-60);
    min-width: 2.6rem;
    text-align: right;
}

.hzBand {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    margin-top: 0.2rem;
    overflow-y: auto;
    min-height: 0;
}

.hzBandStueck {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.78rem;
    padding: 0.1rem 0.3rem;
    border-radius: 4px;
    color: var(--white-60);
}

.hzBandStueck.aktiv {
    background: rgba(255, 255, 255, 0.07);
    color: var(--white-87);
    font-weight: 600;
}

.hzBandZeit {
    font-variant-numeric: tabular-nums;
}

.hzFuss {
    margin-top: auto;
    font-size: 0.72rem;
    color: var(--white-60);
}
</style>
