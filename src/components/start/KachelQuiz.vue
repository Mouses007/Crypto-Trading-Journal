<script setup>
/**
 * Kachel „Quiz" — Kurzstatus UND Sitzung des Lern-Karteikastens (Leitner).
 *
 * Self-supplying wie `KachelHandelszeiten.vue`: holt sich selbst über
 * `dbFind`, unabhängig von der Journal-Datenversorgung der Startseite (siehe
 * `startseite.js`-Kopfkommentar zu `endpunkt: null`).
 *
 * ## Klein zeigt, gross übt
 *
 * In der Rastergrösse steht nur der Kurzstatus (fällig heute, Boxen, Serie) —
 * `RadarKachel` öffnet die Gross-Ansicht schon automatisch bei jedem Klick auf
 * eine `eigenstaendig`-Kachel, dafür braucht diese Komponente keinen eigenen
 * Code. In der Gross-Ansicht läuft eine ECHTE Sitzung: Frage, Antwort
 * aufdecken, bewerten, nächste Karte — dieselbe Rechnung wie `Lernen.vue`
 * (`shared/leitner.js:auswerten`, keine zweite Zählweise), nur ohne
 * Seitenwechsel. Die erste Fassung verlinkte stattdessen auf `/lernen` — das
 * riss aus der Übersicht heraus, obwohl der Platz für ein paar Karten längst
 * da war.
 *
 * Jede Gross-Ansicht ist ein FRISCHER Mount (RadarOverlay rendert eine zweite
 * Instanz, siehe Startseite.vue-Kommentar „Gross: dieselbe Komponente,
 * dieselben Daten"). Für self-supplying Kacheln bedeutet das: ein zweiter,
 * unabhängiger Abruf beim Öffnen — dasselbe Verhalten wie bei
 * `KachelHandelszeiten.vue`, und die Sitzung startet dadurch jedes Mal sauber
 * bei „Übersicht", nicht mitten in einer alten Karte.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { dbFind } from '../../utils/db.js'
import { boxVerteilung } from '../../../shared/leitner.js'
import { useLernSitzung, GRADE_BUTTONS } from '../../composables/useLernSitzung.js'
import { lernserie } from '../../utils/lernStatistik.js'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
})

const { t } = useI18n()
const router = useRouter()

const geladen = ref(false)
const karten = ref([])
const fortschritt = ref([])

async function laden() {
    try {
        const [k, f] = await Promise.all([
            dbFind('quiz_karten', { ascending: 'id' }),
            dbFind('quiz_fortschritt', {}),
        ])
        karten.value = k
        fortschritt.value = f
    } catch (e) {
        console.warn(' -> Kachel Quiz: laden fehlgeschlagen:', e?.message)
    } finally {
        geladen.value = true
    }
}

/**
 * Verständigt die kompakte Kachel, wenn die Gross-Ansicht eine Bewertung
 * geschrieben hat — die beiden sind laut Kopfkommentar zwei GETRENNTE
 * Instanzen mit je eigenem Abruf, sonst bliebe „66 fällig" auf der Kachel
 * stehen, obwohl die Sitzung längst welche abgearbeitet und in die DB
 * geschrieben hat (geprüft: der Schreibvorgang selbst lief sauber, nur die
 * Anzeige der anderen Instanz zog nicht nach). Ein `CustomEvent` reicht —
 * kein Store nötig für zwei Instanzen einer einzigen Kachel.
 */
const QUIZ_EVENT = 'quiz-fortschritt-geaendert'

onMounted(() => {
    laden()
    // Nur die kompakte Instanz hört zu: die Gross-Ansicht mitten in einer
    // Sitzung neu zu laden, könnte die laufende Reihenfolge durcheinander
    // bringen — die kompakte Instanz zeigt ohnehin nur den Kurzstatus.
    if (!props.gross) window.addEventListener(QUIZ_EVENT, laden)
})
onBeforeUnmount(() => {
    if (!props.gross) window.removeEventListener(QUIZ_EVENT, laden)
})

const fortschrittByKarte = computed(() => {
    const m = {}
    for (const f of fortschritt.value) m[f.kartenId] = f
    return m
})

/** Ausgeblendete Karten zählen nicht mit — ihre Historie fliesst trotzdem in
 *  die Serie ein (dieselbe Regel wie in `Lernen.vue`: vergangene Bewertungen
 *  bleiben reale Lerngeschichte). */
const alleEintraege = computed(() => karten.value
    .map(k => ({ karte: k, fortschritt: fortschrittByKarte.value[k.objectId] || null })))
const aktiveEintraege = computed(() => alleEintraege.value.filter(x => Number(x.karte.aktiv) !== 0))

const faelligeEintraege = computed(() => {
    const jetzt = Date.now()
    return aktiveEintraege.value.filter(x => jetzt >= Number(x.fortschritt?.faelligAm ?? 0))
})

const boxen = computed(() => boxVerteilung(aktiveEintraege.value.map(x => x.fortschritt || {})))
// Ausgeblendete Karten zählen hier NICHT mit — sonst stünde auf der Kachel
// eine andere Kartenzahl als auf der Statistik-Seite (`uebersicht.gesamt` in
// lernStatistik.js zählt ebenfalls nur die aktiven).
const kartenZahl = computed(() => aktiveEintraege.value.length)
const boxenGesamt = computed(() => Object.values(boxen.value).reduce((a, b) => a + b, 0))
const serie = computed(() => lernserie(alleEintraege.value, Date.now()))

function karteAnlegen() {
    router.push('/lernen/karten')
}

// ── Sitzung (nur in der Gross-Ansicht bedient) ───────────────────────────
/*
 * Dieselbe Quelle wie die Lernseite (`useLernSitzung`) — und zwar seit dem
 * 05.09.2026 auch wirklich. Vorher stand hier eine Handkopie, die den Audit-Fix
 * vom 28.08.2026 nie bekommen hatte: „Schwer" zählte als Treffer, wurde nicht
 * wiedervorgelegt, und ein fehlgeschlagener Schreibvorgang flog ungefangen
 * durch. Hinter gleicher Beschriftung stand also unterschiedliches Verhalten,
 * je nachdem wo man bewertete.
 *
 * `onGeaendert` ist der Grund, warum das Composable diesen Rückruf hat: die
 * kompakte Instanz ist eine ANDERE Instanz (siehe Kopfkommentar) und erfährt
 * nur über dieses Ereignis, dass sich der Stand geändert hat.
 */
const {
    phase, warteschlange, aktuellerIndex, antwortSichtbar, erklaerungOffen,
    sitzungRichtig, sitzungSchwer, sitzungFalsch,
    aktuellerEintrag, aktuelleBox, hatErklaerung,
    sitzungStarten, antwortZeigen, erklaerungUmschalten, bewerten,
    karteAusblenden, sitzungBeenden, sitzungZurueck,
} = useLernSitzung({
    faelligeEintraege,
    fortschritt,
    onGeaendert: () => window.dispatchEvent(new CustomEvent(QUIZ_EVENT)),
})
</script>

<template>
    <!-- ── Gross: echte Sitzung ──────────────────────────────────────── -->
    <div v-if="gross" class="qzGross">
        <template v-if="!geladen">
            <div class="qzLadend"><span class="spinner-border spinner-border-sm"></span></div>
        </template>

        <template v-else-if="!karten.length">
            <div class="qzLeer qzLeerGross">
                <i class="uil uil-graduation-hat"></i>
                <span>{{ t('lernen.start.keineKarten') }}</span>
                <button type="button" class="ctl-pill" @click="karteAnlegen">
                    {{ t('lernen.start.karteAnlegen') }}
                </button>
            </div>
        </template>

        <template v-else-if="phase === 'start'">
            <h5 class="mb-1">{{ t('lernen.start.faelligTitel') }}</h5>
            <div class="lernen-faellig-count mb-3">{{ faelligeEintraege.length }}</div>

            <div v-if="boxenGesamt" class="lernen-box-bar mb-2">
                <div v-for="n in [1, 2, 3, 4]" :key="n" class="lernen-box-seg" :class="'box-' + n"
                    :style="{ flex: (Math.max(boxen[n] || 0, 0.001)) + ' 1 0' }">
                    <span v-if="boxen[n]">{{ boxen[n] }}</span>
                </div>
            </div>
            <div v-if="boxenGesamt" class="lernen-box-legend mb-3">
                <span v-for="n in [1, 2, 3, 4]" :key="n" class="lernen-box-legend-item">
                    <span class="lernen-dot" :class="'box-' + n"></span>{{ t('lernen.start.box', { n }) }}: {{ boxen[n] || 0 }}
                </span>
            </div>
            <div v-if="serie > 0" class="qzSerie mb-3">
                <i class="uil uil-fire"></i>{{ t('lernen.statistik.serieTage', { n: serie }) }}
            </div>

            <button v-if="faelligeEintraege.length" type="button" class="ctl-pill qzStart" @click="sitzungStarten">
                <i class="uil uil-play"></i>{{ t('lernen.start.starten') }}
            </button>
            <p v-else class="text-muted mb-0">{{ t('lernen.start.faelligNone') }}</p>
        </template>

        <template v-else-if="phase === 'review' && aktuellerEintrag">
            <div class="lernen-statusleiste">
                <span>{{ t('lernen.review.fortschritt', { aktuell: aktuellerIndex + 1, gesamt: warteschlange.length }) }}
                    · {{ t('lernen.start.box', { n: aktuelleBox }) }}</span>
                <span class="lernen-statusleiste-aktionen">
                    <button type="button" class="lernen-statusleiste-icon"
                        :title="t('lernen.review.ausblendenHint')" @click="karteAusblenden">
                        <i class="uil uil-eye-slash"></i>
                    </button>
                    <button type="button" class="lernen-statusleiste-btn" @click="sitzungBeenden">
                        {{ t('lernen.review.abbrechen') }}
                    </button>
                </span>
            </div>

            <div class="lernen-karteikarte">
                <div class="lernen-card-box">
                    <div class="lernen-frage">{{ aktuellerEintrag.karte.frage }}</div>
                </div>
                <div class="lernen-trennlinie"></div>

                <div v-if="!antwortSichtbar" class="lernen-reveal" @click="antwortZeigen">
                    <div class="lernen-reveal-mark">?</div>
                    <div class="lernen-reveal-text">{{ t('lernen.review.antwortZeigen') }}</div>
                </div>
                <template v-else>
                    <div class="lernen-card-box lernen-card-box-antwort">
                        <div class="lernen-antwort">{{ aktuellerEintrag.karte.antwort }}</div>
                        <!-- Gleiche Erklärung wie auf der Lernseite, gleiche Begründung
                             gegen InfoTipp (siehe dort) — nur eben aus dem Composable. -->
                        <button v-if="hatErklaerung" type="button" class="lernen-erklaerung-knopf"
                            :aria-expanded="erklaerungOffen" @click="erklaerungUmschalten">
                            <i class="uil" :class="erklaerungOffen ? 'uil-angle-up' : 'uil-info-circle'"></i>
                            {{ erklaerungOffen ? t('lernen.review.erklaerungZu') : t('lernen.review.erklaerungAuf') }}
                        </button>
                        <div v-if="hatErklaerung && erklaerungOffen" class="lernen-erklaerung">
                            {{ aktuellerEintrag.karte.erklaerung }}
                        </div>
                    </div>
                    <div class="lernen-grade-grid">
                        <button v-for="g in GRADE_BUTTONS" :key="g.grad" type="button" class="lernen-grade-btn" :class="g.klasse"
                            @click="bewerten(g.grad)">
                            {{ t('lernen.review.' + g.key) }}
                        </button>
                    </div>
                </template>
            </div>
        </template>

        <template v-else-if="phase === 'summary'">
            <h5 class="mb-3">{{ t('lernen.summary.titel') }}</h5>
            <div class="d-flex justify-content-center gap-5 mb-4">
                <div>
                    <div class="greenTrade lernen-summary-value">{{ sitzungRichtig }}</div>
                    <div class="text-muted small">{{ t('lernen.summary.richtig') }}</div>
                </div>
                <!-- Eigene Spalte wie auf der Lernseite: „Schwer" unter „richtig"
                     zu verbuchen machte die Quote genau bei den Karten zu gut,
                     die noch nicht sitzen. -->
                <div v-if="sitzungSchwer">
                    <div class="lernen-summary-value lernen-summary-schwer">{{ sitzungSchwer }}</div>
                    <div class="text-muted small">{{ t('lernen.summary.schwer') }}</div>
                </div>
                <div>
                    <div class="redTrade lernen-summary-value">{{ sitzungFalsch }}</div>
                    <div class="text-muted small">{{ t('lernen.summary.falsch') }}</div>
                </div>
            </div>
            <button type="button" class="ctl-pill" @click="sitzungZurueck">{{ t('lernen.summary.fertig') }}</button>
        </template>
    </div>

    <!-- ── Klein: Kurzstatus, Klick öffnet die Gross-Ansicht (RadarKachel) ── -->
    <div v-else class="qzWrap">
        <template v-if="geladen && karten.length">
            <div class="qzHaupt" :class="{ qzHauptRuhig: !faelligeEintraege.length }">
                {{ faelligeEintraege.length }}
            </div>
            <div class="qzLabel">
                {{ faelligeEintraege.length ? t('startseite.quiz.faellig') : t('lernen.start.faelligNone') }}
            </div>

            <div v-if="boxenGesamt" class="qzBoxBar">
                <div v-for="n in [1, 2, 3, 4]" :key="n" class="qzBoxSeg" :class="'box-' + n"
                    :style="{ flex: (Math.max(boxen[n] || 0, 0.001)) + ' 1 0' }">
                    <span v-if="boxen[n]">{{ boxen[n] }}</span>
                </div>
            </div>

            <div class="qzZeilen">
                <span class="qzGesamt">{{ kartenZahl }} {{ t('startseite.quiz.karten') }}</span>
                <span v-if="serie > 0" class="qzSerie">
                    <i class="uil uil-fire"></i>{{ t('lernen.statistik.serieTage', { n: serie }) }}
                </span>
            </div>

            <!-- Kein Klick-Handler: der Klick bubbelt zu `.radarCardBody`
                 hoch, das öffnet die Gross-Ansicht schon (siehe Kopfkommentar). -->
            <span class="ctl-pill qzKnopf">
                <i class="uil uil-graduation-hat"></i>{{ t('startseite.quiz.oeffnen') }}
            </span>
        </template>

        <div v-else-if="geladen" class="qzLeer">
            <i class="uil uil-graduation-hat"></i>
            <span>{{ t('lernen.start.keineKarten') }}</span>
        </div>
    </div>
</template>

<style scoped>
.qzWrap {
    display: flex;
    flex-direction: column;
    justify-content: center;
    height: 100%;
    min-height: 140px;
    gap: 0.5rem;
    padding: 0.2rem 0.3rem;
}

.qzHaupt {
    font-size: 2.2rem;
    font-weight: 700;
    line-height: 1;
    color: rgb(255, 95, 86);
}

.qzHaupt.qzHauptRuhig { color: rgb(38, 190, 150); }

.qzLabel {
    font-size: 0.85rem;
    color: var(--white-60);
    margin-top: -0.3rem;
}

/* Dieselben Boxenfarben wie in Lernen.vue (dort scoped, hier eine eigene
   Kopie — vier Zeilen, keine Auslagerung wert). */
.qzBoxBar { display: flex; height: 10px; border-radius: 999px; overflow: hidden; background: rgba(255, 255, 255, 0.05); }
.qzBoxSeg { display: flex; align-items: center; justify-content: center; font-size: 0.6rem; color: rgba(0, 0, 0, 0.6); min-width: 2px; }
.qzBoxSeg.box-1 { background: #ef4444; }
.qzBoxSeg.box-2 { background: #f59e0b; }
.qzBoxSeg.box-3 { background: #3b82f6; }
.qzBoxSeg.box-4 { background: #22c55e; }

.qzZeilen {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem 0.9rem;
    font-size: 0.82rem;
}

.qzGesamt { color: var(--white-60); font-weight: 500; }

.qzSerie {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: #f59e0b;
    font-weight: 600;
}

/* Reine Beschriftung, kein eigener Klick — siehe Template-Kommentar. */
.qzKnopf {
    align-self: flex-start;
    margin-top: 0.2rem;
    pointer-events: none;
}

.qzLeer {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    height: 100%;
    color: var(--white-60);
    font-size: 0.85rem;
    text-align: center;
}

.qzLeer i { font-size: 1.6rem; }

/* ── Gross: Sitzung — Klassen mit denselben Namen und Werten wie in
   Lernen.vue (dort scoped, hier eine eigene Kopie, siehe Kopfkommentar). ── */
.qzGross { max-width: 640px; margin: 0 auto; }

.qzLadend { display: flex; justify-content: center; padding: 3rem 0; }

.qzLeerGross { min-height: 220px; }

.lernen-faellig-count { font-size: 2.4rem; font-weight: 700; color: var(--white-87); }

.lernen-box-bar { display: flex; height: 14px; border-radius: 999px; overflow: hidden; background: var(--black-bg-7, rgba(255, 255, 255, 0.05)); }
.lernen-box-seg { display: flex; align-items: center; justify-content: center; font-size: 0.65rem; color: rgba(0, 0, 0, 0.6); min-width: 2px; }
.lernen-box-seg.box-1 { background: #ef4444; }
.lernen-box-seg.box-2 { background: #f59e0b; }
.lernen-box-seg.box-3 { background: #3b82f6; }
.lernen-box-seg.box-4 { background: #22c55e; }

.lernen-box-legend { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; font-size: 0.82rem; }
.lernen-box-legend-item { display: inline-flex; align-items: center; }
.lernen-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 0.4rem; }
.lernen-dot.box-1 { background: #ef4444; }
.lernen-dot.box-2 { background: #f59e0b; }
.lernen-dot.box-3 { background: #3b82f6; }
.lernen-dot.box-4 { background: #22c55e; }

.qzStart { margin-top: 0.3rem; }

.lernen-karteikarte { background: #000; border-radius: var(--border-radius, 8px); overflow: hidden; }

.lernen-statusleiste {
    display: flex; justify-content: space-between; align-items: center;
    padding: 0.6rem 1rem; background: var(--black-bg-5, #1a1a1a);
    font-size: 0.8rem; color: var(--grey-color, rgba(255, 255, 255, 0.6));
}
.lernen-statusleiste-aktionen { display: inline-flex; align-items: center; gap: 0.9rem; }
.lernen-statusleiste-icon {
    background: none; border: none; padding: 0; line-height: 1;
    font-size: 1.05rem; color: var(--grey-color, rgba(255, 255, 255, 0.6));
}
.lernen-statusleiste-icon:hover { color: var(--white-87, rgba(255, 255, 255, 0.9)); }
.lernen-erklaerung-knopf {
    margin-top: 0.9rem; background: none; border: none; padding: 0.15rem 0.4rem;
    font-size: 0.9rem; color: var(--blue-color, #3b82f6);
    display: inline-flex; align-items: center; gap: 0.35rem;
}
.lernen-erklaerung-knopf:hover { text-decoration: underline; }
.lernen-erklaerung { margin-top: 0.9rem; font-size: 0.95rem; line-height: 1.5; color: rgba(255, 255, 255, 0.6); }
.lernen-statusleiste-btn {
    background: none; border: none; padding: 0; font: inherit;
    color: var(--grey-color, rgba(255, 255, 255, 0.6)); text-decoration: underline;
    cursor: pointer;
}

.lernen-card-box { min-height: 220px; display: flex; flex-direction: column; justify-content: center; padding: 2.5rem 1.5rem 1.5rem; text-align: center; }
.lernen-card-box-antwort { min-height: 140px; padding-top: 1.5rem; }
.lernen-frage { font-size: 1.75rem; font-weight: 600; line-height: 1.35; color: var(--white-87); }
.lernen-antwort { font-size: 1.25rem; line-height: 1.5; color: rgba(255, 255, 255, 0.85); }

.lernen-trennlinie { height: 2px; background: #22c55e; margin: 0 1.5rem; }

.lernen-reveal { padding: 1.5rem; text-align: center; cursor: pointer; }
.lernen-reveal-mark { font-size: 1.5rem; color: var(--grey-color, rgba(255, 255, 255, 0.4)); }
.lernen-reveal-text { font-size: 1.1rem; color: var(--grey-color, rgba(255, 255, 255, 0.6)); margin-top: 0.25rem; }

/*
 * Vier Knoepfe nebeneinander brauchen Platz: bei 375 px minus Rahmen bleiben
 * je rund 80 px, und "Vergessen" passt dort nicht mehr. Unter 420 px zwei
 * Reihen zu zwei — lieber zwei Zeilen als abgeschnittene Beschriftungen.
 * `minmax(0, 1fr)`, damit ein langes Wort die Spalte nicht aufblaest.
 */
.lernen-grade-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }

@media (max-width: 420px) {
    .lernen-grade-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.lernen-grade-btn {
    border: none; border-top: 1px solid rgba(255, 255, 255, 0.1); border-right: 1px solid rgba(255, 255, 255, 0.1);
    padding: 0.9rem 0.4rem; font-size: 0.88rem; font-weight: 600;
    background: var(--black-bg-5, #1a1a1a); color: var(--white-87);
    cursor: pointer;
}
.lernen-grade-btn:last-child { border-right: none; }
.lernen-grade-vergessen { color: #ef4444; }
.lernen-grade-schwer { color: #f59e0b; }
.lernen-summary-schwer { color: #f59e0b; }
.lernen-grade-gut { color: #3b82f6; }
.lernen-grade-leicht { color: #22c55e; }
.lernen-grade-btn:active { background: var(--black-bg-7, #262626); }

.lernen-summary-value { font-size: 2rem; font-weight: 700; }
</style>
