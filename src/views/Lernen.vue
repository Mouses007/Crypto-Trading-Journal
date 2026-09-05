<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { dbFind, dbCreate, dbUpdate, dbDelete } from '../utils/db.js'
import { boxVerteilung, BOX_MIN } from '../../shared/leitner.js'
import { useLernSitzung, GRADE_BUTTONS } from '../composables/useLernSitzung.js'
import { werteAus as lernstatistikAuswerten } from '../utils/lernStatistik.js'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue'
import { spinnerLoadingPage } from '../stores/ui.js'
import { logWarn } from '../utils/logger.js'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const reiter = computed(() => route.params.reiter || null) // null = Sitzung, 'karten' = Verwaltung, 'statistik' = Auswertung

const karten = ref([])       // quiz_karten
const fortschritt = ref([])  // quiz_fortschritt

/**
 * Ladefehler beim Start — sichtbar statt als Dauerspinner.
 *
 * Ohne `finally` blieb `spinnerLoadingPage` bei einer abgelehnten Zusage auf
 * `true` stehen: die Seite drehte sich für immer, ohne zu sagen warum. Die
 * Schwesterkomponente `KachelQuiz.vue` macht es seit jeher richtig — genau
 * die Art Abweichung, die dieses Audit überall gefunden hat.
 */
const ladeFehler = ref('')

async function ladeAlles() {
    spinnerLoadingPage.value = true
    ladeFehler.value = ''
    try {
        const [k, f] = await Promise.all([
            dbFind('quiz_karten', { ascending: 'id' }),
            dbFind('quiz_fortschritt', {}),
        ])
        karten.value = k
        fortschritt.value = f
        /*
         * Erst NACH dem Laden: die Warteschlange wird aus den geladenen Karten
         * aufgelöst, vorher gäbe es nichts aufzulösen.
         *
         * Und ausdrücklich NUR im Erfolgsfall. Stand der Aufruf hinter dem
         * `finally`, lief er auch nach einem Fehlschlag — dann war `karten`
         * leer, keine gespeicherte Karten-ID liess sich auflösen, und der
         * Aufräumzweig in `stelleSitzungHer` löschte die halb abgearbeitete
         * Runde, die die Persistenz gerade retten sollte. Ein Netzhänger kostete
         * so 40 bewertete Karten.
         */
        stelleSitzungHer()
    } catch (e) {
        ladeFehler.value = e?.message || String(e)
        logWarn('lernen', 'Karten laden fehlgeschlagen', e)
    } finally {
        spinnerLoadingPage.value = false
    }
}
onMounted(ladeAlles)

const fortschrittByKarte = computed(() => {
    const m = {}
    for (const f of fortschritt.value) m[f.kartenId] = f
    return m
})

// Alle Karten mit ihrem Fortschritt zusammengeführt (auch ausgeblendete —
// ihre bisherigen Bewertungen bleiben reale Lerngeschichte, siehe Statistik).
const alleEintraege = computed(() => karten.value
    .map(k => ({ karte: k, fortschritt: fortschrittByKarte.value[k.objectId] || null })))

// aktive (nicht ausgeblendete) Karten — Grundlage für Sitzung und Fälligkeit
const aktiveEintraege = computed(() => alleEintraege.value.filter(x => Number(x.karte.aktiv) !== 0))

const boxen = computed(() => boxVerteilung(aktiveEintraege.value.map(x => x.fortschritt || {})))

const faelligeEintraege = computed(() => {
    const jetzt = Date.now()
    return aktiveEintraege.value.filter(x => jetzt >= Number(x.fortschritt?.faelligAm ?? 0))
})

// ── Statistik ───────────────────────────────────────────────────────────
const statistik = computed(() => lernstatistikAuswerten(alleEintraege.value, Date.now()))
const proTagMax = computed(() => Math.max(1, ...statistik.value.proTag.map(t => t.anzahl)))

// ── Sitzung ─────────────────────────────────────────────────────────────
/*
 * Sitzungslogik liegt in `useLernSitzung` — dieselbe Quelle, aus der sich auch
 * die Startseiten-Kachel bedient. Was hier bleibt, ist das, was es dort nicht
 * gibt: die Runde übersteht ein Neuladen, und sie lässt sich per Tastatur
 * bedienen. `sichereSitzung` ist eine Funktionsdeklaration und damit auch
 * hier oben schon verwendbar.
 */
const {
    phase, warteschlange, aktuellerIndex, antwortSichtbar, erklaerungOffen,
    sitzungRichtig, sitzungSchwer, sitzungFalsch, wiedervorgelegt,
    aktuellerEintrag, aktuelleBox, hatErklaerung,
    sitzungStarten, antwortZeigen, erklaerungUmschalten, bewerten,
    karteAusblenden, sitzungBeenden, sitzungZurueck,
} = useLernSitzung({
    faelligeEintraege,
    fortschritt,
    onZustand: () => sichereSitzung(),
})

/*
 * Die laufende Sitzung übersteht ein Neuladen.
 *
 * Der Fortschritt lag schon immer in der Datenbank — ein Gerätewechsel kostet
 * nichts. Die SITZUNG lebte aber nur im Speicher: ein F5 mitten in einer
 * 40-Karten-Runde warf auf den Startbildschirm zurück, und die bereits
 * bewerteten Karten waren aus der Warteschlange verschwunden.
 *
 * Gesichert werden nur IDs und Zähler, keine Objektkopien: die Einträge
 * hängen an `karten`/`fortschritt` und werden beim Wiederherstellen frisch
 * aufgelöst. Eine eingefrorene Kopie wäre nach dem Neuladen veraltet.
 *
 * `localStorage`, nicht `sessionStorage`: wer den Tab schliesst und in der
 * Mittagspause weitermacht, soll dort weitermachen, wo er war.
 */
const SITZUNG_KEY = 'lernenSitzung'

function sichereSitzung() {
    try {
        if (phase.value !== 'review') { localStorage.removeItem(SITZUNG_KEY); return }
        localStorage.setItem(SITZUNG_KEY, JSON.stringify({
            kartenIds: warteschlange.value.map(e => e.karte.objectId),
            index: aktuellerIndex.value,
            richtig: sitzungRichtig.value,
            falsch: sitzungFalsch.value,
            schwer: sitzungSchwer.value,
            wiedervorgelegt: [...wiedervorgelegt.value],
            gesichertAm: Date.now(),
        }))
    } catch { /* voller Speicher darf die Sitzung nicht abbrechen */ }
}

/** Älter als das: die Runde ist vorbei, auch wenn sie nie beendet wurde. */
const SITZUNG_MAX_ALTER_MS = 12 * 60 * 60 * 1000

function stelleSitzungHer() {
    /*
     * Zweiter Riegel gegen den Datenverlust aus `ladeAlles`: ohne geladene
     * Karten liesse sich unten keine ID auflösen, und der Aufräumzweig würde
     * eine völlig intakte Runde wegwerfen. Nichts wissen ist kein Grund zu
     * löschen.
     */
    if (!karten.value.length) return

    let roh
    try { roh = JSON.parse(localStorage.getItem(SITZUNG_KEY) || 'null') } catch { roh = null }
    if (!roh || !Array.isArray(roh.kartenIds) || !roh.kartenIds.length) return
    if (Date.now() - Number(roh.gesichertAm || 0) > SITZUNG_MAX_ALTER_MS) {
        localStorage.removeItem(SITZUNG_KEY)
        return
    }

    /*
     * Karten neu auflösen. Was inzwischen gelöscht oder ausgeblendet wurde,
     * fällt dabei heraus — die Runde wird kürzer, statt auf eine Karte zu
     * zeigen, die es nicht mehr gibt.
     */
    const nachId = new Map(aktiveEintraege.value.map(e => [e.karte.objectId, e]))
    const liste = roh.kartenIds.map(id => nachId.get(id)).filter(Boolean)
    if (!liste.length) { localStorage.removeItem(SITZUNG_KEY); return }

    warteschlange.value = liste
    aktuellerIndex.value = Math.min(Math.max(0, Number(roh.index) || 0), liste.length - 1)
    sitzungRichtig.value = Number(roh.richtig) || 0
    sitzungFalsch.value = Number(roh.falsch) || 0
    sitzungSchwer.value = Number(roh.schwer) || 0
    wiedervorgelegt.value = new Set(Array.isArray(roh.wiedervorgelegt) ? roh.wiedervorgelegt : [])
    antwortSichtbar.value = false
    erklaerungOffen.value = false
    phase.value = 'review'
}

/*
 * Tastaturbedienung der Kartensitzung: Die Sitzung wird in Serie bedient
 * (aufdecken → bewerten, dutzende Male) — nur mit der Maus ist das spürbar
 * langsamer. Ziffern 1–4 bewerten die aufgedeckte Karte (Reihenfolge der
 * Knöpfe in `GRADE_BUTTONS`); das Aufdecken selbst hängt am fokussierbaren
 * Reveal-Element (Enter/Leertaste). Eingabefelder bleiben unberührt.
 */
function tastendruck(e) {
    if (phase.value !== 'review' || !antwortSichtbar.value) return
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) return
    const n = Number(e.key)
    if (n >= 1 && n <= 4) { e.preventDefault(); bewerten(GRADE_BUTTONS[n - 1].grad) }
}
onMounted(() => window.addEventListener('keydown', tastendruck))
onBeforeUnmount(() => window.removeEventListener('keydown', tastendruck))

// ── Kartenverwaltung ────────────────────────────────────────────────────
const KATEGORIEN = ['indikatoren', 'derivate', 'sentiment', 'chartAnalyse', 'risiko', 'markt', 'onchain']
// Schwierigkeitsstufen des Starter-Decks (siehe `niveau` in
// server/default-lernkarten.js). Als Liste, damit eine neue Stufe dort nur
// hier eingetragen werden muss und nicht drei feste Knöpfe im Template braucht.
const NIVEAUS = [1, 2, 3]
const kategorieLabel = (k) => t('lernen.kategorie.' + k)
const boxVonKarte = (kartenId) => Number(fortschrittByKarte.value[kartenId]?.box) || BOX_MIN
const niveauVonKarte = (karte) => Number(karte?.niveau) || 1

const eigeneKarten = computed(() => karten.value.filter(k => k.herkunft !== 'built-in'))

const niveauFilter = ref('alle') // 'alle' | 1 | 2
const builtinKartenAlle = computed(() => karten.value.filter(k => k.herkunft === 'built-in'))
const builtinKarten = computed(() => niveauFilter.value === 'alle'
    ? builtinKartenAlle.value
    : builtinKartenAlle.value.filter(k => niveauVonKarte(k) === niveauFilter.value))

const formOffen = ref(false)
const bearbeiteId = ref(null)
const formFrage = ref('')
const formAntwort = ref('')
/** Optional: warum die Antwort richtig ist. Leer heisst: nichts zu erklaeren. */
const formErklaerung = ref('')
const formKategorie = ref('indikatoren')
const formNiveau = ref(1)

function formOeffnen(karte = null) {
    bearbeiteId.value = karte?.objectId || null
    formFrage.value = karte?.frage || ''
    formAntwort.value = karte?.antwort || ''
    formErklaerung.value = karte?.erklaerung || ''
    formKategorie.value = karte?.kategorie || 'indikatoren'
    formNiveau.value = niveauVonKarte(karte)
    formOffen.value = true
}
function formSchliessen() {
    formOffen.value = false
}

function neueKarteStarten() {
    router.push('/lernen/karten')
    formOeffnen()
}

async function formSpeichern() {
    if (!formFrage.value.trim() || !formAntwort.value.trim()) return

    if (bearbeiteId.value) {
        const patch = { frage: formFrage.value.trim(), antwort: formAntwort.value.trim(), erklaerung: formErklaerung.value.trim(), kategorie: formKategorie.value, niveau: formNiveau.value }
        await dbUpdate('quiz_karten', bearbeiteId.value, patch)
        const k = karten.value.find(x => x.objectId === bearbeiteId.value)
        if (k) Object.assign(k, patch)
    } else {
        const neu = await dbCreate('quiz_karten', {
            frage: formFrage.value.trim(), antwort: formAntwort.value.trim(),
            erklaerung: formErklaerung.value.trim(), kategorie: formKategorie.value,
            niveau: formNiveau.value, herkunft: 'eigen', aktiv: 1,
        })
        karten.value.push(neu)
        const f = await dbCreate('quiz_fortschritt', {
            kartenId: neu.objectId, box: 1, faelligAm: 0, zuletztGesehenAm: 0,
            richtigStreak: 0, gesamtRichtig: 0, gesamtFalsch: 0, historie: '[]',
        })
        fortschritt.value.push(f)
    }
    formSchliessen()
}

async function karteLoeschen(karte) {
    if (!confirm(t('lernen.karten.loeschenConfirm'))) return
    const f = fortschrittByKarte.value[karte.objectId]
    await dbDelete('quiz_karten', karte.objectId)
    if (f) await dbDelete('quiz_fortschritt', f.objectId)
    karten.value = karten.value.filter(k => k.objectId !== karte.objectId)
    if (f) fortschritt.value = fortschritt.value.filter(x => x.objectId !== f.objectId)
}

async function aktivUmschalten(karte) {
    const neuerWert = Number(karte.aktiv) === 1 ? 0 : 1
    await dbUpdate('quiz_karten', karte.objectId, { aktiv: neuerWert })
    karte.aktiv = neuerWert
}
</script>

<template>
    <div class="px-3 px-md-4 pb-5">
        <SpinnerLoadingPage />

        <div v-show="!spinnerLoadingPage">
            <!-- ===== SITZUNG ===== -->
            <template v-if="!reiter">
                <div v-if="phase === 'start'" class="dailyCard p-4 lernen-panel">
                    <!-- Ein gescheiterter Abruf sah vorher aus wie „keine Karten
                         vorhanden" — oder die Seite drehte sich fuer immer. -->
                    <div v-if="ladeFehler" class="alert alert-warning py-2 px-3 mb-3 small">
                        {{ t('lernen.ladeFehler') }}
                        <button type="button" class="btn btn-sm btn-outline-secondary ms-2 py-0"
                            @click="ladeAlles">{{ t('common.retry') }}</button>
                    </div>
                    <h5 class="mb-1">{{ t('lernen.start.faelligTitel') }}</h5>
                    <div class="lernen-faellig-count mb-3">{{ faelligeEintraege.length }}</div>

                    <template v-if="karten.length">
                        <div class="lernen-box-bar mb-2">
                            <div v-for="n in [1, 2, 3, 4]" :key="n" class="lernen-box-seg" :class="'box-' + n"
                                :style="{ flex: (Math.max(boxen[n] || 0, 0.001)) + ' 1 0' }">
                                <span v-if="boxen[n]">{{ boxen[n] }}</span>
                            </div>
                        </div>
                        <div class="lernen-box-legend mb-4">
                            <span v-for="n in [1, 2, 3, 4]" :key="n" class="lernen-box-legend-item">
                                <span class="lernen-dot" :class="'box-' + n"></span>{{ t('lernen.start.box', { n }) }}: {{ boxen[n] || 0 }}
                            </span>
                        </div>

                        <button v-if="faelligeEintraege.length" class="btn btn-primary" @click="sitzungStarten">
                            {{ t('lernen.start.starten') }}
                        </button>
                        <p v-else class="text-muted mb-0">{{ t('lernen.start.faelligNone') }}</p>
                    </template>
                    <template v-else>
                        <p class="text-muted">{{ t('lernen.start.keineKarten') }}</p>
                        <button class="btn btn-outline-primary btn-sm" @click="neueKarteStarten">
                            {{ t('lernen.start.karteAnlegen') }}
                        </button>
                    </template>
                </div>

                <div v-else-if="phase === 'review' && aktuellerEintrag" class="lernen-panel lernen-panel-review">
                    <div class="lernen-statusleiste">
                        <span>
                            {{ t('lernen.review.fortschritt', { aktuell: aktuellerIndex + 1, gesamt: warteschlange.length }) }}
                            · {{ t('lernen.niveau', { n: niveauVonKarte(aktuellerEintrag.karte) }) }}
                            · {{ t('lernen.start.box', { n: aktuelleBox }) }}
                        </span>
                        <span class="lernen-statusleiste-aktionen">
                            <!-- Nackter Icon-Knopf: `title=` ist sein einziger Name und
                                 bleibt deshalb auch ohne erweiterte Infos stehen (siehe
                                 Abgrenzung im Kopf von InfoTipp.vue). -->
                            <button class="lernen-statusleiste-icon" :title="t('lernen.review.ausblendenHint')"
                                @click="karteAusblenden">
                                <i class="uil uil-eye-slash"></i>
                            </button>
                            <button class="lernen-statusleiste-btn" @click="sitzungBeenden">
                                {{ t('lernen.review.abbrechen') }}
                            </button>
                        </span>
                    </div>

                    <div class="lernen-karteikarte">
                        <div class="lernen-card-box">
                            <div class="lernen-frage">{{ aktuellerEintrag.karte.frage }}</div>
                        </div>

                        <div class="lernen-trennlinie"></div>

                        <div v-if="!antwortSichtbar" class="lernen-reveal" role="button" tabindex="0"
                            @click="antwortZeigen"
                            @keydown.enter.prevent="antwortZeigen"
                            @keydown.space.prevent="antwortZeigen">
                            <div class="lernen-reveal-mark">?</div>
                            <div class="lernen-reveal-text">{{ t('lernen.review.antwortZeigen') }}</div>
                        </div>
                        <template v-else>
                            <div class="lernen-card-box lernen-card-box-antwort">
                                <div class="lernen-antwort">{{ aktuellerEintrag.karte.antwort }}</div>
                                <!--
                                    Die Antwort steht da, aber nicht warum. Wer eine Karte
                                    nicht wusste, lernt aus der Begründung mehr als aus der
                                    blossen Wiederholung.

                                    Bewusst NICHT `InfoTipp.vue`: das hängt an der
                                    Einstellung `erweiterteInfos` und wäre weg, sobald
                                    jemand die Bedienhilfen abschaltet — eine Erklärung
                                    ist hier aber Lerninhalt, kein Bedienhinweis. Es liest
                                    ausserdem i18n-Schlüssel, während dieser Text pro
                                    Karte in der Datenbank steht (auch bei eigenen Karten).

                                    Ausgeklappt statt immer sichtbar, damit man sich erst
                                    selbst bewertet und dann nachliest.
                                -->
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
                                <button v-for="g in GRADE_BUTTONS" :key="g.grad" class="lernen-grade-btn" :class="g.klasse" @click="bewerten(g.grad)">
                                    {{ t('lernen.review.' + g.key) }}
                                </button>
                            </div>
                        </template>
                    </div>
                </div>

                <div v-else-if="phase === 'summary'" class="dailyCard p-4 lernen-panel text-center">
                    <h5 class="mb-3">{{ t('lernen.summary.titel') }}</h5>
                    <div class="d-flex justify-content-center gap-5 mb-4">
                        <div>
                            <div class="greenTrade lernen-summary-value">{{ sitzungRichtig }}</div>
                            <div class="text-muted small">{{ t('lernen.summary.richtig') }}</div>
                        </div>
                        <!-- „Schwer" hat eine eigene Spalte: es unter „richtig"
                             zu verbuchen machte die Trefferquote systematisch
                             zu gut, und zwar genau bei den Karten, die noch
                             nicht sitzen. -->
                        <div v-if="sitzungSchwer">
                            <div class="lernen-summary-value lernen-summary-schwer">{{ sitzungSchwer }}</div>
                            <div class="text-muted small">{{ t('lernen.summary.schwer') }}</div>
                        </div>
                        <div>
                            <div class="redTrade lernen-summary-value">{{ sitzungFalsch }}</div>
                            <div class="text-muted small">{{ t('lernen.summary.falsch') }}</div>
                        </div>
                    </div>
                    <button class="btn btn-primary" @click="sitzungZurueck">{{ t('lernen.summary.fertig') }}</button>
                </div>
            </template>

            <!-- ===== KARTENVERWALTUNG ===== -->
            <template v-else-if="reiter === 'karten'">
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <h5 class="mb-0">{{ t('lernen.karten.eigene') }}</h5>
                    <button class="btn btn-sm btn-primary" @click="formOeffnen()">
                        <i class="uil uil-plus me-1"></i>{{ t('lernen.karten.neueKarte') }}
                    </button>
                </div>

                <div v-if="formOffen" class="dailyCard p-3 mb-3">
                    <div class="mb-2">
                        <label class="form-label small text-muted">{{ t('lernen.karten.frage') }}</label>
                        <textarea class="form-control" rows="2" v-model="formFrage"></textarea>
                    </div>
                    <div class="mb-2">
                        <label class="form-label small text-muted">{{ t('lernen.karten.antwort') }}</label>
                        <textarea class="form-control" rows="3" v-model="formAntwort"></textarea>
                    </div>
                    <div class="mb-2">
                        <label class="form-label small text-muted">{{ t('lernen.karten.erklaerung') }}</label>
                        <textarea class="form-control" rows="2" v-model="formErklaerung"
                            :placeholder="t('lernen.karten.erklaerungHinweis')"></textarea>
                    </div>
                    <div class="row g-2 mb-3">
                        <div class="col-12 col-sm-8">
                            <label class="form-label small text-muted">{{ t('lernen.karten.kategorieLabel') }}</label>
                            <select class="form-select" v-model="formKategorie">
                                <option v-for="k in KATEGORIEN" :key="k" :value="k">{{ kategorieLabel(k) }}</option>
                            </select>
                        </div>
                        <div class="col-12 col-sm-4">
                            <label class="form-label small text-muted">{{ t('lernen.karten.niveauLabel') }}</label>
                            <select class="form-select" v-model.number="formNiveau">
                                <option v-for="n in NIVEAUS" :key="n" :value="n">{{ t('lernen.niveau', { n }) }}</option>
                            </select>
                        </div>
                    </div>
                    <div class="d-flex gap-2">
                        <!-- :disabled statt stillem return: der Zustand erklärt sich selbst -->
                        <button class="btn btn-primary btn-sm" :disabled="!formFrage.trim() || !formAntwort.trim()"
                            @click="formSpeichern">{{ t('lernen.karten.speichern') }}</button>
                        <button class="btn btn-outline-secondary btn-sm" @click="formSchliessen">{{ t('lernen.karten.abbrechen') }}</button>
                    </div>
                </div>

                <p v-if="!eigeneKarten.length" class="text-muted small mb-4">{{ t('lernen.karten.keineEigenen') }}</p>
                <div v-else class="row g-2 mb-4">
                    <div v-for="k in eigeneKarten" :key="k.objectId" class="col-12">
                        <div class="dailyCard p-3 d-flex justify-content-between align-items-start gap-3" :class="{ 'lernen-inaktiv': Number(k.aktiv) === 0 }">
                            <div class="lernen-karte-text">
                                <div class="fw-semibold">{{ k.frage }}</div>
                                <div class="text-muted small">{{ k.antwort }}</div>
                                <div class="text-muted small mt-1">
                                    {{ t('lernen.niveau', { n: niveauVonKarte(k) }) }} · {{ kategorieLabel(k.kategorie) }} · {{ t('lernen.karten.box', { n: boxVonKarte(k.objectId) }) }}
                                </div>
                            </div>
                            <!-- Ausblenden gibt es auch für eigene Karten: ihr Lernfortschritt ist
                                 genauso wenig ersetzbar wie der einer mitgelieferten, Löschen nimmt ihn mit. -->
                            <div class="d-flex align-items-center gap-1 flex-shrink-0">
                                <div class="form-check form-switch me-1 mb-0" :title="t('lernen.karten.aktivHint')">
                                    <input class="form-check-input" type="checkbox" :checked="Number(k.aktiv) === 1" @change="aktivUmschalten(k)">
                                </div>
                                <button class="btn btn-sm btn-outline-secondary" :title="t('lernen.karten.bearbeiten')" @click="formOeffnen(k)">
                                    <i class="uil uil-edit"></i>
                                </button>
                                <button class="btn btn-sm btn-outline-danger" :title="t('lernen.karten.loeschen')" @click="karteLoeschen(k)">
                                    <i class="uil uil-trash-alt"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
                    <h5 class="mb-0">{{ t('lernen.karten.vorgegeben') }}</h5>
                    <div class="lernen-niveau-filter">
                        <button type="button" class="btn btn-sm" :class="niveauFilter === 'alle' ? 'btn-secondary' : 'btn-outline-secondary'" @click="niveauFilter = 'alle'">{{ t('lernen.karten.filterAlle') }}</button>
                        <button v-for="n in NIVEAUS" :key="n" type="button" class="btn btn-sm" :class="niveauFilter === n ? 'btn-secondary' : 'btn-outline-secondary'" @click="niveauFilter = n">{{ t('lernen.niveau', { n }) }}</button>
                    </div>
                </div>
                <div class="row g-2">
                    <div v-for="k in builtinKarten" :key="k.objectId" class="col-12">
                        <div class="dailyCard p-3 d-flex justify-content-between align-items-start gap-3" :class="{ 'lernen-inaktiv': Number(k.aktiv) === 0 }">
                            <div class="lernen-karte-text">
                                <div class="fw-semibold">{{ k.frage }}</div>
                                <div class="text-muted small">{{ k.antwort }}</div>
                                <div class="text-muted small mt-1">
                                    {{ t('lernen.niveau', { n: niveauVonKarte(k) }) }} · {{ kategorieLabel(k.kategorie) }} · {{ t('lernen.karten.box', { n: boxVonKarte(k.objectId) }) }}
                                </div>
                            </div>
                            <div class="form-check form-switch mt-1 flex-shrink-0" :title="t('lernen.karten.aktivHint')">
                                <input class="form-check-input" type="checkbox" :checked="Number(k.aktiv) === 1" @change="aktivUmschalten(k)">
                            </div>
                        </div>
                    </div>
                </div>
            </template>

            <!-- ===== STATISTIK ===== -->
            <template v-else-if="reiter === 'statistik'">
                <div v-if="!statistik.uebersicht.bewertungenGesamt" class="text-muted text-center py-5">
                    {{ t('lernen.statistik.keineDaten') }}
                </div>
                <template v-else>
                    <div class="row g-3 mb-4">
                        <div class="col-6 col-md-3">
                            <div class="dailyCard p-3 text-center">
                                <div class="lernen-stat-value">{{ statistik.uebersicht.gesamt }}</div>
                                <div class="text-muted small">{{ t('lernen.statistik.gesamtKarten') }}</div>
                            </div>
                        </div>
                        <div class="col-6 col-md-3">
                            <div class="dailyCard p-3 text-center">
                                <div class="lernen-stat-value">{{ statistik.uebersicht.gemeistert }}</div>
                                <div class="text-muted small">{{ t('lernen.statistik.gemeistert') }}</div>
                            </div>
                        </div>
                        <div class="col-6 col-md-3">
                            <div class="dailyCard p-3 text-center">
                                <div class="lernen-stat-value">
                                    {{ statistik.uebersicht.erfolgsquote !== null ? Math.round(statistik.uebersicht.erfolgsquote * 100) + '%' : t('lernen.statistik.erfolgsquoteLeer') }}
                                </div>
                                <div class="text-muted small">{{ t('lernen.statistik.erfolgsquote') }}</div>
                            </div>
                        </div>
                        <div class="col-6 col-md-3">
                            <div class="dailyCard p-3 text-center">
                                <div class="lernen-stat-value">{{ statistik.serie }}</div>
                                <div class="text-muted small">
                                    {{ statistik.serie ? t('lernen.statistik.serieTage', { n: statistik.serie }) : t('lernen.statistik.serieTitel') }}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="dailyCard p-3 mb-4">
                        <h6 class="mb-3">{{ t('lernen.statistik.proTagTitel') }}</h6>
                        <div class="lernen-tage-chart">
                            <div v-for="d in statistik.proTag" :key="d.tag" class="lernen-tage-balken-wrap" :title="d.tag + ': ' + d.anzahl">
                                <div class="lernen-tage-balken" :style="{ height: (6 + (d.anzahl / proTagMax) * 60) + 'px' }"></div>
                            </div>
                        </div>
                    </div>

                    <div class="dailyCard p-3">
                        <h6 class="mb-3">{{ t('lernen.statistik.kategorieTitel') }}</h6>
                        <p v-if="!statistik.kategorien.length" class="text-muted small mb-0">{{ t('lernen.statistik.kategorieLeer') }}</p>
                        <div v-else>
                            <div v-for="k in statistik.kategorien" :key="k.kategorie" class="lernen-kategorie-zeile" :class="{ 'lernen-inaktiv': k.duenn }">
                                <span class="lernen-kategorie-name">{{ kategorieLabel(k.kategorie) }}</span>
                                <div class="lernen-kategorie-bar-wrap">
                                    <div class="lernen-kategorie-bar"
                                        :style="{ width: (k.quote * 100) + '%', background: k.quote >= 0.75 ? '#22c55e' : k.quote >= 0.5 ? '#f59e0b' : '#ef4444' }"></div>
                                </div>
                                <span class="lernen-kategorie-quote">
                                    {{ Math.round(k.quote * 100) }}%<template v-if="k.duenn"> · {{ t('lernen.statistik.duennHinweis') }}</template>
                                </span>
                            </div>
                        </div>
                    </div>
                </template>
            </template>
        </div>
    </div>
</template>

<style scoped>
.lernen-panel { max-width: 640px; margin: 0 auto; }
.lernen-panel-review { max-width: 820px; }

.lernen-faellig-count { font-size: 2.4rem; font-weight: 700; color: var(--white-87, rgba(255, 255, 255, 0.9)); }

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

.lernen-niveau-filter { display: flex; gap: 0.35rem; }

/*
 * Karteikarte im AnyMemo-Stil: reines Schwarz statt der sonst im Journal
 * üblichen Karten-Grauwerte, eine dünne Statuszeile (Zähler/Level/Box statt
 * bunter Pillen), eine grüne Trennlinie zwischen Frage und Antwortbereich,
 * und ein reiner Text-Trigger ("?" + "Antwort zeigen") statt eines Buttons —
 * das Vorbild kennt dort keine gefüllten Schaltflächen.
 */
.lernen-karteikarte { background: #000; border-radius: var(--border-radius, 8px); overflow: hidden; }

.lernen-statusleiste {
    display: flex; justify-content: space-between; align-items: center;
    padding: 0.6rem 1rem; background: var(--black-bg-5, #1a1a1a);
    font-size: 0.8rem; color: var(--grey-color, rgba(255, 255, 255, 0.6));
}
.lernen-statusleiste-btn {
    background: none; border: none; padding: 0; font: inherit;
    color: var(--grey-color, rgba(255, 255, 255, 0.6)); text-decoration: underline;
}
.lernen-statusleiste-aktionen { display: inline-flex; align-items: center; gap: 0.9rem; }
.lernen-statusleiste-icon {
    background: none; border: none; padding: 0; line-height: 1;
    font-size: 1.05rem; color: var(--grey-color, rgba(255, 255, 255, 0.6));
}
.lernen-statusleiste-icon:hover { color: var(--white-87, rgba(255, 255, 255, 0.9)); }

/* Auslöser der Kartenerklärung — betont zurückhaltend: er soll erst auffallen,
   wenn man die Antwort gelesen hat und etwas offen geblieben ist. */
.lernen-erklaerung-knopf {
    margin-top: 0.9rem; background: none; border: none; padding: 0.15rem 0.4rem;
    font-size: 0.9rem; color: var(--blue-color, #3b82f6);
    display: inline-flex; align-items: center; gap: 0.35rem;
}
.lernen-erklaerung-knopf:hover { text-decoration: underline; }

.lernen-card-box { min-height: 220px; display: flex; flex-direction: column; justify-content: center; padding: 2.5rem 1.5rem 1.5rem; text-align: center; }
.lernen-card-box-antwort { min-height: 140px; padding-top: 1.5rem; }
.lernen-frage { font-size: 1.75rem; font-weight: 600; line-height: 1.35; color: var(--white-87, rgba(255, 255, 255, 0.92)); }
.lernen-antwort { font-size: 1.25rem; line-height: 1.5; color: var(--white-87, rgba(255, 255, 255, 0.85)); }
.lernen-erklaerung { margin-top: 0.9rem; font-size: 0.95rem; line-height: 1.5; color: var(--white-60, rgba(255, 255, 255, 0.6)); }

.lernen-trennlinie { height: 2px; background: #22c55e; margin: 0 1.5rem; }

.lernen-reveal { padding: 1.5rem; text-align: center; cursor: pointer; }
.lernen-reveal-mark { font-size: 1.5rem; color: var(--grey-color, rgba(255, 255, 255, 0.4)); }
.lernen-reveal-text { font-size: 1.1rem; color: var(--grey-color, rgba(255, 255, 255, 0.6)); margin-top: 0.25rem; }

/* Vier Bewertungsstufen, in derselben Farbfolge wie die Box-Legende (1=rot … 4=grün) —
   die Farbe deutet also gleich an, wie weit die Karte damit springt. */
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
    background: var(--black-bg-5, #1a1a1a); color: var(--white-87, rgba(255, 255, 255, 0.9));
}
.lernen-grade-btn:last-child { border-right: none; }
.lernen-grade-vergessen { color: #ef4444; }
.lernen-grade-schwer { color: #f59e0b; }
.lernen-summary-schwer { color: #f59e0b; }
.lernen-grade-gut { color: #3b82f6; }
.lernen-grade-leicht { color: #22c55e; }
.lernen-grade-btn:active { background: var(--black-bg-7, #262626); }

.lernen-summary-value { font-size: 2rem; font-weight: 700; }

.lernen-karte-text { min-width: 0; }
.lernen-inaktiv { opacity: 0.5; }

.lernen-stat-value { font-size: 1.9rem; font-weight: 700; color: var(--white-87, rgba(255, 255, 255, 0.92)); }

.lernen-tage-chart { display: flex; align-items: flex-end; gap: 0.3rem; height: 70px; }
.lernen-tage-balken-wrap { flex: 1; display: flex; align-items: flex-end; height: 100%; }
.lernen-tage-balken { width: 100%; min-height: 2px; border-radius: 2px 2px 0 0; background: var(--blue-color, #3b82f6); }

.lernen-kategorie-zeile { display: grid; grid-template-columns: 9rem minmax(0, 1fr) auto; align-items: center; gap: 0.75rem; padding: 0.4rem 0; font-size: 0.85rem; }
.lernen-kategorie-name { color: var(--white-87, rgba(255, 255, 255, 0.85)); }
.lernen-kategorie-bar-wrap { height: 8px; border-radius: 999px; overflow: hidden; background: var(--black-bg-7, rgba(255, 255, 255, 0.08)); }
.lernen-kategorie-bar { height: 100%; }
.lernen-kategorie-quote { color: var(--grey-color, rgba(255, 255, 255, 0.6)); white-space: nowrap; text-align: right; }
</style>
