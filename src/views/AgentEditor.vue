<script setup>
/**
 * Strategie-Editor.
 *
 * Hier entstehen Strategien ohne eine Zeile Code: Bausteine zusammenstellen,
 * prüfen lassen, backtesten. Der Server führt die Beschreibung mit einem festen
 * Interpreter aus — es wird nichts erzeugt und nichts ausgewertet, was von hier
 * kommt.
 *
 * Der Aufbau folgt dem Lebenslauf eines Setups, weil Strategien so gedacht
 * werden: Was löst aus? Was muss dabei stimmen? Wann steige ich ein? Was bricht
 * ab? Wo liegen Stop und Ziel?
 */
import { ref, computed, onBeforeMount, nextTick } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { spinnerLoadingPage } from '../stores/ui.js'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue'
import ZahlOderParam from '../components/ZahlOderParam.vue'
import { logError } from '../utils/logger.js'
import { apiFehlerText } from '../utils/apiError.js'
import { useAgentTimelineChart } from '../utils/charts.js'

const { t } = useI18n()

const bausteine = ref({ indikatoren: [], signale: [], einstieg: [], vergleiche: [], anker: [], ziele: [],
    vwapAnker: [], muster: [] })

/** VWAP-Anker als Klartext. Schlüssel: vwapAnchorSession, vwapAnchorSwingHigh, … */
const ankerLabel = (a) => t('strategies.vwapAnchor' + a.charAt(0).toUpperCase() + a.slice(1))
const vorlagen = ref([])
const liste = ref([])
const meldung = ref('')
const fehler = ref('')
const pruefung = ref(null)

const entwurf = ref(null)
const istNeu = ref(false)
const speichert = ref(false)

// ── Backtest direkt aus dem Editor ──────────────────────────────────────
const test = ref({ symbol: 'BTCUSDT', timeframe: '1h', tage: 180 })
const testLaeuft = ref(false)
const testErgebnis = ref(null)

const ZEITEINHEITEN = ['5m', '15m', '30m', '1h', '4h', '1d']

// ── Im Gespräch bauen, direkt im Editor ─────────────────────────────────
// Derselbe Endpunkt wie die Seite „Neue Strategie", aber die Antwort landet
// im offenen Regelwerk statt in einem eigenen Entwurf. Der Gewinn ist nicht
// der Chat — den gab es schon —, sondern dass man SIEHT, welches Feld ein
// Satz verändert hat.
// Einfach- vs. Expertenmodus. Im Einfachmodus stehen die Sätze und die
// einstellbaren Werte — alles, was man zum Beurteilen und Nachjustieren
// braucht. Die Bausteine selbst sind Expertensache.
const einfach = ref(true)
const chatOffen = ref(true)
const chatVerlauf = ref([])
const chatEingabe = ref('')
const chatLaeuft = ref(false)
const chatFehler = ref('')
const chatFragen = ref([])
const chatNichtUmsetzbar = ref([])
const chatGeaendert = ref([])
const chatDraftId = ref(0)
const saetze = ref([])

/** Welche Abschnitte des Regelwerks hat die Antwort angefasst? */
function abschnitteDiff(alt, neu) {
    const schluessel = new Set([...Object.keys(alt || {}), ...Object.keys(neu || {})])
    const raus = []
    for (const k of schluessel) {
        if (JSON.stringify(alt?.[k]) !== JSON.stringify(neu?.[k])) raus.push(k)
    }
    return raus
}

/** Hebt einen Formularblock hervor, wenn die letzte Antwort ihn angefasst hat. */
function chatBetrifft(schluessel) {
    const liste = Array.isArray(schluessel) ? schluessel : [schluessel]
    return liste.some((k) => chatGeaendert.value.includes(k))
}

/** Beim Wechsel des Regelwerks gehoert das Gespraech zurueckgesetzt — sonst
 *  bezieht sich der Verlauf auf eine andere Strategie als die offene. */
function chatZuruecksetzen() {
    chatVerlauf.value = []
    chatFragen.value = []
    chatNichtUmsetzbar.value = []
    chatGeaendert.value = []
    chatFehler.value = ''
    chatEingabe.value = ''
    chatDraftId.value = 0
}

function frageUebernehmen(frage) {
    chatEingabe.value = chatEingabe.value ? `${chatEingabe.value}\n${frage} ` : `${frage} `
}

async function chatSenden() {
    const text = chatEingabe.value.trim()
    if (!text || chatLaeuft.value) return
    chatLaeuft.value = true
    chatFehler.value = ''
    chatVerlauf.value.push({ role: 'user', content: text })
    const gesendet = text
    chatEingabe.value = ''

    try {
        const r = await axios.post('/api/strategies/builder/rules/chat', {
            draftId: chatDraftId.value,
            message: gesendet,
            // Der aktuelle Stand geht mit, sonst überschreibt die Antwort
            // stillschweigend, was gerade von Hand geändert wurde.
            rules: entwurf.value?.rules || null,
        })
        chatVerlauf.value.push({ role: 'assistant', content: r.data.antwort })
        chatFragen.value = r.data.offeneFragen || []
        chatNichtUmsetzbar.value = r.data.nichtUmsetzbar || []
        chatDraftId.value = r.data.draftId || chatDraftId.value

        if (r.data.regeln) {
            const alt = entwurf.value.rules
            const neu = r.data.regeln
            chatGeaendert.value = abschnitteDiff(alt, neu)
            // Name und Kurzname gehören dem Nutzer — die überschreibt der Chat
            // nicht, sonst heisst die Strategie nach jeder Rückfrage anders.
            entwurf.value.rules = neu
            await pruefen()
        } else {
            chatGeaendert.value = []
        }
    } catch (e) {
        chatFehler.value = apiFehlerText(e, t('strategies.builderFailed'), t)
        chatVerlauf.value.pop()
        chatEingabe.value = gesendet
    } finally {
        chatLaeuft.value = false
    }
}

// ── Weitergeben: Export, Import, Vorlagen aufräumen ─────────────────────
const importFeld = ref(null)
const versteckteVorlagen = ref([])

/** Strategie als Datei sichern — reine Beschreibung, kein Handelsverlauf. */
async function exportieren(row) {
    fehler.value = ''
    try {
        const r = await axios.get(`/api/strategies/rules/${row.id}/export`)
        const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `strategie-${row.strategyId}-v${r.data.strategie?.version || 1}.json`
        a.click()
        URL.revokeObjectURL(url)
        meldung.value = t('strategies.exported', { name: row.name })
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.exportFailed'), t)
    }
}

async function importDatei(ereignis) {
    const datei = ereignis.target.files?.[0]
    // Feld sofort leeren, sonst löst dieselbe Datei beim zweiten Mal nichts aus.
    ereignis.target.value = ''
    if (!datei) return
    fehler.value = ''
    meldung.value = ''
    try {
        const text = await datei.text()
        let paket
        try { paket = JSON.parse(text) } catch { throw new Error(t('strategies.importNoJson')) }
        const r = await axios.post('/api/strategies/rules/import', { paket })
        await laden()
        meldung.value = r.data.umbenannt
            ? t('strategies.importedRenamed', { id: r.data.strategyId })
            : t('strategies.imported', { id: r.data.strategyId })
    } catch (e) {
        fehler.value = e.response ? apiFehlerText(e, t('strategies.importFailed'), t) : e.message
    }
}

/**
 * Vorlage aus der Auswahl nehmen. Sie steht im Code und wird nicht gelöscht —
 * das ist Absicht: eine Vorlage, die jemand ausblendet, soll später wieder
 * auftauchen können, ohne dass sie jemand neu schreiben muss.
 */
async function vorlageAusblenden(v) {
    const neu = [...new Set([...versteckteVorlagen.value, v.key])]
    await vorlagenSpeichern(neu)
}

async function vorlagenZurueckholen() {
    await vorlagenSpeichern([])
}

async function vorlagenSpeichern(liste2) {
    try {
        await axios.put('/api/db/settings', { strategyHiddenTemplates: liste2 })
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    }
}

async function laden() {
    try {
        const [b, l] = await Promise.all([
            axios.get('/api/strategies/rules/blocks'),
            axios.get('/api/strategies/rules'),
        ])
        bausteine.value = b.data.bausteine
        vorlagen.value = b.data.vorlagen
        versteckteVorlagen.value = b.data.versteckteVorlagen || []
        liste.value = l.data
    } catch (e) {
        logError('AgentEditor', 'Laden fehlgeschlagen', e)
        fehler.value = apiFehlerText(e, t('strategies.loadFailed'), t)
    }
}

onBeforeMount(async () => {
    spinnerLoadingPage.value = true
    await laden()
    spinnerLoadingPage.value = false
})

/** Alle Referenzen, die in einem Vergleich stehen dürfen. */
const referenzen = computed(() => [
    ...(bausteine.value.anker || []),
    ...(entwurf.value?.rules.indicators || []).map((i) => i.id),
])

const parameterNamen = computed(() => (entwurf.value?.rules.params || []).map((p) => p.key))

/** Farbe der Marktphasen-Badge: Trend blau, Seitwärts gelb, Rest neutral. */
function marktKlasse(markt) {
    const m = String(markt || '').toLowerCase()
    if (m.startsWith('seitwärts')) return 'marktSeitwaerts'
    if (m.startsWith('trend') || m.startsWith('bullentrend')) return 'marktTrend'
    return 'marktNeutral'
}

function ausVorlage(v) {
    istNeu.value = true
    entwurf.value = {
        strategyId: v.key,
        name: v.titel,
        description: v.beschreibung,
        rules: JSON.parse(JSON.stringify(v.rules)),
    }
    testErgebnis.value = null
    chatZuruecksetzen()
    pruefen()
}

function leer() {
    istNeu.value = true
    entwurf.value = {
        strategyId: '', name: '', description: '',
        rules: {
            timeframes: ['1h'], direction: 'long', warmupCandles: 300,
            params: [], indicators: [], signal: { type: 'pivotHigh', left: 5, right: 2 },
            // `signalPrice` als Vorgabe: ein frisches Regelwerk soll LAUFFÄHIG
            // starten — ein leerer Anker begrüsste den Nutzer sonst mit einem
            // kryptischen Validierungsfehler, bevor er irgendetwas getan hat.
            signalFilters: [], entry: { type: 'touch', anchor: 'signalPrice', from: 'above' },
            invalidations: [{ type: 'timeout', code: 'zu_lang', candles: 20 }],
            stopLoss: { anchor: 'correctionLow', offsetPct: 0.3 },
            takeProfit: { mode: 'rr', rr: 2 },
            breakEvenAtR: 1,
        },
    }
    testErgebnis.value = null
    pruefung.value = null
    chatZuruecksetzen()
}

function bearbeiten(row) {
    istNeu.value = false
    entwurf.value = {
        id: row.id, strategyId: row.strategyId, name: row.name,
        description: row.description, rules: JSON.parse(JSON.stringify(row.rules)),
    }
    testErgebnis.value = null
    chatZuruecksetzen()
    pruefen()
}

/** Prüfung ohne Speichern — zeigt Fehler, während man baut. */
async function pruefen() {
    if (!entwurf.value) return
    try {
        const r = await axios.post('/api/strategies/rules/validate', {
            rules: { ...entwurf.value.rules, id: entwurf.value.strategyId || 'entwurf', name: entwurf.value.name },
        })
        pruefung.value = r.data
        saetze.value = r.data.saetze || []
    } catch (e) {
        pruefung.value = null
        saetze.value = []
    }
}

// ── Bausteine hinzufügen und entfernen ──────────────────────────────────
const r = () => entwurf.value.rules

function indikatorHinzu() {
    const n = r().indicators.length + 1
    r().indicators.push({ id: `ema${n}`, type: 'ema', period: 20 })
    pruefen()
}
const indikatorWeg = (i) => { r().indicators.splice(i, 1); pruefen() }

function paramHinzu() {
    r().params.push({ key: `wert${r().params.length + 1}`, type: 'number', label: '', default: 1, min: 0, max: 100, step: 0.1 })
    pruefen()
}
const paramWeg = (i) => { r().params.splice(i, 1); pruefen() }

function bedingungHinzu(liste) {
    r()[liste].push({ left: 'close', op: 'gt', right: referenzen.value[0] || 'close', code: '' })
    pruefen()
}
const bedingungWeg = (l, i) => { r()[l].splice(i, 1); pruefen() }

function abbruchHinzu(typ) {
    if (typ === 'timeout') r().invalidations.push({ type: 'timeout', code: 'zu_lang', candles: 20 })
    else r().invalidations.push({ type: 'condition', code: 'abbruch', when: { op: 'isBullish' } })
    pruefen()
}
const abbruchWeg = (i) => { r().invalidations.splice(i, 1); pruefen() }

const zeiteinheitAn = (tf) => {
    const l = r().timeframes
    const i = l.indexOf(tf)
    if (i >= 0) l.splice(i, 1); else l.push(tf)
    pruefen()
}

/** Referenz kann Text (Anker/Indikator) oder Parameter sein. */
function refText(ref) {
    if (ref && typeof ref === 'object') return ref.param ? `param:${ref.param}` : String(ref.value ?? '')
    return String(ref ?? '')
}
function refSetzen(obj, feld, wert) {
    obj[feld] = wert.startsWith('param:') ? { param: wert.slice(6) } : wert
    pruefen()
}

// ── Speichern, Kopieren, Löschen ────────────────────────────────────────
async function sichern() {
    speichert.value = true
    fehler.value = ''
    meldung.value = ''
    try {
        const daten = {
            strategyId: entwurf.value.strategyId,
            name: entwurf.value.name,
            description: entwurf.value.description,
            rules: entwurf.value.rules,
        }
        if (istNeu.value) {
            const a = await axios.post('/api/strategies/rules', daten)
            entwurf.value.id = a.data.id
            istNeu.value = false
            meldung.value = t('strategies.editorSaved', { id: a.data.strategyId })
        } else {
            await axios.put(`/api/strategies/rules/${entwurf.value.id}`, daten)
            meldung.value = t('strategies.saved')
        }
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    } finally {
        speichert.value = false
    }
}

const loeschFrage = ref(null)
async function loeschen(row) {
    try {
        await axios.delete(`/api/strategies/rules/${row.id}`)
        loeschFrage.value = null
        if (entwurf.value?.id === row.id) entwurf.value = null
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.deleteFailed'), t)
    }
}

async function kopieren(row) {
    try {
        await axios.post(`/api/strategies/rules/${row.id}/duplicate`)
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    }
}

// ── Test ────────────────────────────────────────────────────────────────
// ── Chart zum Testlauf ──────────────────────────────────────────────────
// Der Wert liegt nicht in den gehandelten Trades, sondern in den VERWORFENEN
// Setups: sie zeigen, wo die Regel angesprungen ist und warum daraus nichts
// wurde. Eine Zahl im Trichter sagt „12 mal zone_broken" — der Chart zeigt wo.
let editorChart = null
const chartMeldung = ref('')

async function chartZeichnen() {
    chartMeldung.value = ''
    const erg = testErgebnis.value
    if (!erg) return
    try {
        // Kerzen so viele, wie der getestete Zeitraum umfasst — gedeckelt, sonst
        // wird der Chart unlesbar und der Abruf unnötig gross.
        const proTag = { '5m': 288, '15m': 96, '30m': 48, '1h': 24, '4h': 6, '1d': 1 }[test.value.timeframe] || 24
        const limit = Math.min(1000, Math.max(120, Math.round(proTag * Number(test.value.tage))))
        const k = await axios.get('/api/binance/klines', {
            params: { symbol: test.value.symbol.toUpperCase(), interval: test.value.timeframe, market: 'futures', limit },
        })
        const candles = k.data.map((c) => ({ t: Number(c[0]), o: +c[1], h: +c[2], l: +c[3], c: +c[4] }))
        if (!candles.length) { chartMeldung.value = t('strategies.timelineNoData'); return }

        await nextTick()
        editorChart?.dispose()
        editorChart = useAgentTimelineChart('editorChart', candles, erg.setups || [], erg.trades || [])
        if (!erg.setups?.length && !erg.trades?.length) {
            chartMeldung.value = t('strategies.chartNothingFound')
        }
    } catch (e) {
        logError('AgentEditor', 'Chart fehlgeschlagen', e)
        chartMeldung.value = t('strategies.chartFailed')
    }
}

async function testen() {
    if (!entwurf.value?.id) {
        fehler.value = t('strategies.saveBeforeTest')
        return
    }
    testLaeuft.value = true
    fehler.value = ''
    testErgebnis.value = null
    try {
        const toTs = Date.now()
        const a = await axios.post('/api/strategies/backtest', {
            strategyId: entwurf.value.strategyId,
            symbol: test.value.symbol.toUpperCase(),
            timeframe: test.value.timeframe,
            fromTs: toTs - Number(test.value.tage) * 86400000,
            toTs,
            startEquity: 1000,
            label: entwurf.value.name,
            risk: { cooldownMinutes: 0, minRR: 0 },
            save: false,
        })
        testErgebnis.value = a.data
        await chartZeichnen()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.backtestFailed'), t)
    } finally {
        testLaeuft.value = false
    }
}

const zahl = (v, n = 2) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '–' : Number(v).toFixed(n))
const sortiert = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1])
</script>

<template>
    <SpinnerLoadingPage />
    <div v-show="!spinnerLoadingPage" class="row mt-3 ps-3 pe-3">
        <div class="col-12 col-xl-11">

            <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
                <h5 class="mb-0 me-auto">{{ t('strategies.editorTitle') }}</h5>
                <button type="button" class="ctl-pill" @click="leer">
                    <i class="uil uil-plus me-1"></i>{{ t('strategies.emptyStrategy') }}
                </button>
                <!-- Import über ein verstecktes Dateifeld: ein Klick, kein Dialog. -->
                <input ref="importFeld" type="file" accept="application/json,.json"
                    class="d-none" @change="importDatei" />
                <button type="button" class="ctl-pill" @click="importFeld?.click()">
                    <i class="uil uil-upload-alt me-1"></i>{{ t('strategies.importStrategy') }}
                </button>
            </div>

            <div class="alert alert-secondary py-2 small">
                <i class="uil uil-info-circle me-1"></i>{{ t('strategies.editorIntro') }}
            </div>
            <div v-if="meldung" class="alert alert-info py-2">{{ meldung }}</div>
            <div v-if="fehler" class="alert alert-danger py-2">{{ fehler }}</div>

            <!-- ══ Vorlagen ══ -->
            <div v-if="!entwurf && versteckteVorlagen.length" class="alert alert-secondary py-2 small d-flex align-items-center gap-2">
                <span>{{ t('strategies.templatesHidden', { n: versteckteVorlagen.length }) }}</span>
                <button class="btn btn-sm btn-outline-secondary py-0 ms-auto" @click="vorlagenZurueckholen">
                    {{ t('strategies.templatesRestore') }}
                </button>
            </div>
            <div v-if="!entwurf" class="row g-3 mb-3">
                <div v-for="v in vorlagen" :key="v.key" class="col-12 col-md-4">
                    <div class="dailyCard p-3 h-100 d-flex flex-column position-relative">
                        <button class="btn btn-sm btn-link text-muted vorlageWeg" :title="t('strategies.templateHide')"
                            @click="vorlageAusblenden(v)"><i class="uil uil-times"></i></button>
                        <strong>{{ v.titel }}</strong>
                        <div v-if="v.markt" class="mt-1">
                            <span class="badge marktBadge" :class="marktKlasse(v.markt)">
                                <i class="uil uil-chart-line me-1"></i>{{ v.markt }}
                            </span>
                        </div>
                        <p class="small text-muted flex-grow-1 mt-1">{{ v.beschreibung }}</p>
                        <button class="btn btn-sm btn-outline-primary" @click="ausVorlage(v)">
                            {{ t('strategies.useTemplate') }}
                        </button>
                    </div>
                </div>
            </div>

            <!-- ══ Editor ══ -->
            <template v-if="entwurf">
                <div class="dailyCard p-3 mb-3">
                    <div class="row g-2 mb-3">
                        <div class="col-12 col-md-3">
                            <label class="form-label small mb-1">{{ t('strategies.shortName') }}</label>
                            <input v-model="entwurf.strategyId" class="form-control form-control-sm"
                                :disabled="!istNeu" placeholder="meine_strategie" @change="pruefen" />
                        </div>
                        <div class="col-12 col-md-4">
                            <label class="form-label small mb-1">{{ t('strategies.name') }}</label>
                            <input v-model="entwurf.name" class="form-control form-control-sm" @change="pruefen" />
                        </div>
                        <div class="col-12 col-md-5">
                            <label class="form-label small mb-1">{{ t('strategies.descriptionLabel') }}</label>
                            <input v-model="entwurf.description" class="form-control form-control-sm" />
                        </div>
                        <div class="col-12 col-md-6">
                            <label class="form-label small mb-1">{{ t('strategies.timeframes') }}</label><br>
                            <span v-for="tf in ZEITEINHEITEN" :key="tf"
                                :class="['badge me-1 pointerClass', entwurf.rules.timeframes.includes(tf) ? 'bg-primary' : 'bg-dark']"
                                @click="zeiteinheitAn(tf)">{{ tf }}</span>
                        </div>
                        <div class="col-6 col-md-3">
                            <label class="form-label small mb-1">{{ t('strategies.direction') }}</label>
                            <select v-model="entwurf.rules.direction" class="form-select form-select-sm" @change="pruefen">
                                <option value="long">Long</option>
                                <option value="short">Short</option>
                                <!-- Beide: die Erkennung läuft je Richtung einmal.
                                     Kostet doppelte Rechenzeit, spart die
                                     Zwillingsstrategie. -->
                                <option value="both">{{ t('strategies.directionBoth') }}</option>
                            </select>
                        </div>
                    </div>

                    <!-- ══ Einfach oder Experte ══
                         Im Einfachmodus stehen die Sätze und die einstellbaren
                         Werte; die Bausteine selbst bleiben verborgen. Wer eine
                         Strategie beurteilen will, muss sie lesen können — nicht
                         entziffern. -->
                    <div class="d-flex align-items-center gap-2 mb-2">
                        <div class="btn-group btn-group-sm">
                            <button class="btn" :class="einfach ? 'btn-primary' : 'btn-outline-secondary'"
                                @click="einfach = true">{{ t('strategies.modeSimple') }}</button>
                            <button class="btn" :class="!einfach ? 'btn-primary' : 'btn-outline-secondary'"
                                @click="einfach = false">{{ t('strategies.modeExpert') }}</button>
                        </div>
                        <small class="text-muted">{{ einfach ? t('strategies.modeSimpleHint') : t('strategies.modeExpertHint') }}</small>
                    </div>

                    <!-- ══ Was diese Strategie tut ══ -->
                    <div v-if="saetze.length" class="saetzeKarte mb-3">
                        <div class="d-flex align-items-center gap-2 mb-2">
                            <i class="uil uil-book-open"></i>
                            <strong class="small">{{ t('strategies.rulesInWords') }}</strong>
                        </div>
                        <div v-for="s in saetze" :key="s.titel" class="satzZeile">
                            <span class="satzTitel">{{ s.titel }}</span>
                            <span>{{ s.text }}</span>
                        </div>
                        <p class="small text-muted mb-0 mt-2">{{ t('strategies.rulesInWordsHint') }}</p>
                    </div>

                    <!-- ══ Im Gespräch bauen ══
                         Der Chat sitzt bewusst IM Editor: er schreibt in
                         dasselbe Regelwerk, das die Felder darunter zeigen.
                         Vorher lagen Gespräch und Formular auf zwei Seiten —
                         man sah nie, was ein Satz eigentlich verändert hat. -->
                    <div class="chatPanel mb-3">
                        <div class="d-flex align-items-center gap-2 mb-2">
                            <i class="uil uil-comment-alt-lines chatIcon"></i>
                            <strong>{{ t('strategies.chatTitle') }}</strong>
                            <span v-if="chatGeaendert.length" class="badge bg-primary">
                                {{ t('strategies.chatChanged', { n: chatGeaendert.length }) }}
                            </span>
                            <button class="btn btn-sm btn-outline-secondary ms-auto py-0"
                                @click="chatOffen = !chatOffen">
                                {{ chatOffen ? t('strategies.chatHide') : t('strategies.chatShow') }}
                            </button>
                        </div>

                        <template v-if="chatOffen">
                            <p class="block-hint">{{ t('strategies.chatHint') }}</p>

                            <div v-if="chatVerlauf.length" class="chatVerlauf mb-2">
                                <div v-for="(m, i) in chatVerlauf" :key="i"
                                    :class="['chatZeile', m.role === 'user' ? 'chatNutzer' : 'chatModell']">
                                    {{ m.content }}
                                </div>
                            </div>

                            <!-- Rückfragen: anklickbar, damit man sie direkt beantwortet
                                 statt sie abzutippen. -->
                            <div v-if="chatFragen.length" class="mb-2">
                                <div class="small text-muted mb-1">{{ t('strategies.chatOpenQuestions') }}</div>
                                <button v-for="(f, i) in chatFragen" :key="i" type="button"
                                    class="btn btn-sm btn-outline-primary me-1 mb-1 text-start"
                                    @click="frageUebernehmen(f)">{{ f }}</button>
                            </div>

                            <!-- Was sich mit den Bausteinen nicht ausdrücken lässt.
                                 Muss stehen bleiben: sonst hält man eine Lücke für
                                 umgesetzt. -->
                            <div v-if="chatNichtUmsetzbar.length" class="alert alert-warning py-2 px-3 small mb-2">
                                <strong>{{ t('strategies.chatNotExpressible') }}</strong>
                                <ul class="mb-0 ps-3">
                                    <li v-for="(n, i) in chatNichtUmsetzbar" :key="i">{{ n }}</li>
                                </ul>
                            </div>

                            <div v-if="chatFehler" class="alert alert-danger py-2 px-3 small mb-2">{{ chatFehler }}</div>

                            <div class="d-flex gap-2">
                                <textarea v-model="chatEingabe" class="form-control form-control-sm" rows="2"
                                    :placeholder="t('strategies.chatPlaceholder')"
                                    :disabled="chatLaeuft"
                                    @keydown.enter.exact.prevent="chatSenden"></textarea>
                                <button class="btn btn-sm btn-primary flex-shrink-0" :disabled="chatLaeuft || !chatEingabe.trim()"
                                    @click="chatSenden">
                                    <span v-if="chatLaeuft" class="spinner-border spinner-border-sm"></span>
                                    <span v-else>{{ t('strategies.chatSend') }}</span>
                                </button>
                            </div>
                        </template>
                    </div>

                    <!-- Prüfung -->
                    <div v-if="pruefung && !pruefung.ok" class="alert alert-warning py-2 small mb-3">
                        <strong>{{ t('strategies.notYetValid') }}</strong>
                        <ul class="mb-0 ps-3">
                            <li v-for="(f, i) in pruefung.fehler" :key="i">{{ f }}</li>
                        </ul>
                    </div>
                    <div v-else-if="pruefung?.hinweise?.length" class="alert alert-secondary py-2 small mb-3">
                        <ul class="mb-0 ps-3"><li v-for="(h, i) in pruefung.hinweise" :key="i">{{ h }}</li></ul>
                    </div>

                    <!-- ── 1. Parameter ── -->
                    <div class="block" :class="{ blockGeaendert: chatBetrifft('params') }">
                        <div class="block-title">
                            <span class="nr">1</span>{{ t('strategies.blockParams') }}
                            <button class="btn btn-sm btn-outline-secondary py-0 ms-auto" @click="paramHinzu">+</button>
                        </div>
                        <p class="block-hint">{{ t('strategies.blockParamsHint') }}</p>
                        <div v-for="(p, i) in entwurf.rules.params" :key="i" class="row g-1 mb-1 align-items-center">
                            <div class="col-3"><input v-model="p.key" class="form-control form-control-sm" placeholder="name" @change="pruefen" /></div>
                            <div class="col-4"><input v-model="p.label" class="form-control form-control-sm" :placeholder="t('strategies.labelPlaceholder')" /></div>
                            <div class="col-2">
                                <select v-model="p.type" class="form-select form-select-sm" @change="pruefen">
                                    <option value="number">{{ t('strategies.typeNumber') }}</option>
                                    <option value="integer">{{ t('strategies.typeInteger') }}</option>
                                    <option value="boolean">{{ t('strategies.typeBoolean') }}</option>
                                </select>
                            </div>
                            <div class="col-1"><input v-model.number="p.default" type="number" class="form-control form-control-sm" @change="pruefen" /></div>
                            <div class="col-1"><input v-model.number="p.min" type="number" class="form-control form-control-sm" @change="pruefen" /></div>
                            <div class="col-1 d-flex gap-1">
                                <input v-model.number="p.max" type="number" class="form-control form-control-sm" @change="pruefen" />
                                <button class="btn btn-sm btn-outline-danger py-0" @click="paramWeg(i)"><i class="uil uil-times"></i></button>
                            </div>
                        </div>
                    </div>

                    <!-- ── 2. Indikatoren ── -->
                    <div v-if="!einfach" class="block" :class="{ blockGeaendert: chatBetrifft('indicators') }">
                        <div class="block-title">
                            <span class="nr">2</span>{{ t('strategies.blockIndicators') }}
                            <button class="btn btn-sm btn-outline-secondary py-0 ms-auto" @click="indikatorHinzu">+</button>
                        </div>
                        <p class="block-hint">{{ t('strategies.blockIndicatorsHint') }}</p>
                        <div v-for="(ind, i) in entwurf.rules.indicators" :key="i" class="row g-1 mb-1">
                            <div class="col-4"><input v-model="ind.id" class="form-control form-control-sm" @change="pruefen" /></div>
                            <div class="col-3">
                                <select v-model="ind.type" class="form-select form-select-sm" @change="pruefen">
                                    <option v-for="x in bausteine.indikatoren" :key="x" :value="x">{{ t('strategies.ind_' + x) }}</option>
                                </select>
                            </div>
                            <div class="col-4">
                                <!-- VWAP braucht statt einer Periode einen Anker; das Band
                                     zusätzlich den Faktor der Standardabweichung. -->
                                <template v-if="['vwap','vwapBand'].includes(ind.type)">
                                    <div class="d-flex gap-1">
                                        <select v-model="ind.anchor" class="form-select form-select-sm" @change="pruefen">
                                            <option v-for="a in (bausteine.vwapAnker || [])" :key="a" :value="a">
                                                {{ ankerLabel(a) }}
                                            </option>
                                        </select>
                                        <input v-if="ind.anchor === 'rolling'" v-model.number="ind.period" type="number" min="2"
                                            class="form-control form-control-sm" style="max-width:5rem" @change="pruefen" />
                                        <!-- Swing-Anker: Pivot-Stärke und welche Fächerlinie gemeint ist.
                                             Ohne diese Felder hinge die Linie stumm auf ihren Vorgaben. -->
                                        <template v-if="['swingHigh','swingLow'].includes(ind.anchor)">
                                            <ZahlOderParam :ziel="ind" feld="pivot" :standard="20"
                                                :titel="t('strategies.vwapPivot')" :params="parameterNamen" @aendern="pruefen" />
                                            <select v-model.number="ind.nth" class="form-select form-select-sm"
                                                style="max-width:5rem" :title="t('strategies.vwapNth')" @change="pruefen">
                                                <option v-for="n in [1,2,3]" :key="n" :value="n">{{ n }}.</option>
                                            </select>
                                        </template>
                                        <select v-if="ind.type === 'vwapBand'" class="form-select form-select-sm"
                                            style="max-width:7rem" :value="refText(ind.mult)"
                                            :title="t('strategies.vwapMultHint')"
                                            @change="refSetzen(ind, 'mult', $event.target.value)">
                                            <option v-for="m in [1,1.5,2,2.5,3,-1,-1.5,-2,-2.5,-3]" :key="m" :value="String(m)">{{ m }}σ</option>
                                            <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ pk }}</option>
                                        </select>
                                    </div>
                                </template>
                                <!-- Die Tageseröffnung hat keine Einstellung — ein
                                     Periodenfeld daneben wäre eine Lüge. -->
                                <template v-else-if="ind.type === 'dayOpen'">
                                    <span class="text-muted small">{{ t('strategies.noSetting') }}</span>
                                </template>
                                <!-- MACD, Bollinger und Stochastik haben eigene
                                     Kennzahlen. Die Engine liest sie längst
                                     (rule-engine.js baueIndikatoren) — ohne
                                     Felder blieben sie stumm auf ihren
                                     Standardwerten stehen, ohne dass man es
                                     sieht. -->
                                <template v-else-if="['macd','macdSignal','macdHist'].includes(ind.type)">
                                    <div class="d-flex gap-1">
                                        <ZahlOderParam :ziel="ind" feld="fast" :standard="12"
                                            :titel="t('strategies.macdFast')" :params="parameterNamen" @aendern="pruefen" />
                                        <ZahlOderParam :ziel="ind" feld="slow" :standard="26"
                                            :titel="t('strategies.macdSlow')" :params="parameterNamen" @aendern="pruefen" />
                                        <ZahlOderParam :ziel="ind" feld="signal" :standard="9"
                                            :titel="t('strategies.macdSignalP')" :params="parameterNamen" @aendern="pruefen" />
                                    </div>
                                </template>
                                <template v-else-if="['bollUpper','bollMiddle','bollLower'].includes(ind.type)">
                                    <div class="d-flex gap-1">
                                        <ZahlOderParam :ziel="ind" feld="period" :standard="20"
                                            :titel="t('strategies.bollPeriod')" :params="parameterNamen" @aendern="pruefen" />
                                        <ZahlOderParam :ziel="ind" feld="mult" :standard="2" :schritt="0.1"
                                            :titel="t('strategies.bollMult')" :params="parameterNamen" @aendern="pruefen" />
                                        <select v-model="ind.basis" class="form-select form-select-sm"
                                            style="max-width:5.5rem" :title="t('strategies.bollBasis')" @change="pruefen">
                                            <option value="sma">SMA</option>
                                            <option value="ema">EMA</option>
                                        </select>
                                    </div>
                                </template>
                                <template v-else-if="['stochK','stochD'].includes(ind.type)">
                                    <div class="d-flex gap-1">
                                        <ZahlOderParam :ziel="ind" feld="period" :standard="14"
                                            :titel="t('strategies.stochPeriod')" :params="parameterNamen" @aendern="pruefen" />
                                        <ZahlOderParam :ziel="ind" feld="smoothK" :standard="3"
                                            :titel="t('strategies.stochSmoothK')" :params="parameterNamen" @aendern="pruefen" />
                                        <ZahlOderParam :ziel="ind" feld="smoothD" :standard="3"
                                            :titel="t('strategies.stochSmoothD')" :params="parameterNamen" @aendern="pruefen" />
                                    </div>
                                </template>
                                <!-- Alle übrigen: eine Periode, aber frei
                                     wählbar statt sieben fester Stufen. -->
                                <ZahlOderParam v-else :ziel="ind" feld="period" :standard="14"
                                    :titel="t('strategies.periodLabel')" :params="parameterNamen" @aendern="pruefen" />
                            </div>
                            <div class="col-1"><button class="btn btn-sm btn-outline-danger py-0 w-100" @click="indikatorWeg(i)"><i class="uil uil-times"></i></button></div>
                        </div>
                    </div>

                    <!-- ── 3. Signal ── -->
                    <div v-if="!einfach" class="block" :class="{ blockGeaendert: chatBetrifft('signal') }">
                        <div class="block-title"><span class="nr">3</span>{{ t('strategies.blockSignal') }}</div>
                        <p class="block-hint">{{ t('strategies.blockSignalHint') }}</p>
                        <div class="row g-1">
                            <div class="col-4">
                                <select v-model="entwurf.rules.signal.type" class="form-select form-select-sm" @change="pruefen">
                                    <option v-for="s in bausteine.signale" :key="s" :value="s">{{ t('strategies.signal_' + s) }}</option>
                                </select>
                            </div>
                            <template v-if="['pivotHigh','pivotLow'].includes(entwurf.rules.signal.type)">
                                <div class="col-4">
                                    <input v-model.number="entwurf.rules.signal.left" type="number" min="1" class="form-control form-control-sm"
                                        :placeholder="t('strategies.leftBars')" @change="pruefen" />
                                </div>
                                <div class="col-4">
                                    <input v-model.number="entwurf.rules.signal.right" type="number" min="1" class="form-control form-control-sm"
                                        :placeholder="t('strategies.rightBars')" @change="pruefen" />
                                </div>
                            </template>
                            <!-- Berührung einer Linie, die vorher schon gehalten hat:
                                 Linie + wie oft vorher. „2" heisst dritte Berührung. -->
                            <template v-else-if="entwurf.rules.signal.type === 'levelTouch'">
                                <div class="col-4">
                                    <select class="form-select form-select-sm" :value="refText(entwurf.rules.signal.line)"
                                        :title="t('strategies.touchLine')"
                                        @change="refSetzen(entwurf.rules.signal, 'line', $event.target.value)">
                                        <option value="">–</option>
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                                <div class="col-4">
                                    <ZahlOderParam :ziel="entwurf.rules.signal" feld="minPrevTouches" :standard="2"
                                        :titel="t('strategies.touchPrev')" :params="parameterNamen" @aendern="pruefen" />
                                </div>
                                <div class="col-4 offset-4 mt-1 d-flex gap-1">
                                    <ZahlOderParam :ziel="entwurf.rules.signal" feld="separation" :standard="3"
                                        :titel="t('strategies.touchSeparation')" :params="parameterNamen" @aendern="pruefen" />
                                    <ZahlOderParam :ziel="entwurf.rules.signal" feld="window" :standard="200"
                                        :titel="t('strategies.touchWindow')" :params="parameterNamen" @aendern="pruefen" />
                                </div>
                            </template>
                            <!-- Kerzenmuster als Auslöser: Muster + Gegenkerzen davor.
                                 Die Engine liest beides längst, im Formular fehlten sie. -->
                            <template v-else-if="entwurf.rules.signal.type === 'pattern'">
                                <div class="col-4">
                                    <select v-model="entwurf.rules.signal.pattern" class="form-select form-select-sm" @change="pruefen">
                                        <option v-for="m in (bausteine.muster || [])" :key="m" :value="m">
                                            {{ t('strategies.muster_' + m) }}
                                        </option>
                                    </select>
                                </div>
                                <div class="col-4">
                                    <ZahlOderParam :ziel="entwurf.rules.signal" feld="prevOpposite" :standard="0"
                                        :titel="t('strategies.prevOpposite')" :params="parameterNamen" @aendern="pruefen" />
                                </div>
                            </template>
                            <template v-else>
                                <div class="col-4">
                                    <select class="form-select form-select-sm" :value="refText(entwurf.rules.signal.a)"
                                        @change="refSetzen(entwurf.rules.signal, 'a', $event.target.value)">
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                                <div class="col-4">
                                    <select class="form-select form-select-sm" :value="refText(entwurf.rules.signal.b)"
                                        @change="refSetzen(entwurf.rules.signal, 'b', $event.target.value)">
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                            </template>
                        </div>
                    </div>

                    <!-- ── 4. Signalfilter ── -->
                    <div v-if="!einfach" class="block" :class="{ blockGeaendert: chatBetrifft('signalFilters') }">
                        <div class="block-title">
                            <span class="nr">4</span>{{ t('strategies.blockFilters') }}
                            <button class="btn btn-sm btn-outline-secondary py-0 ms-auto" @click="bedingungHinzu('signalFilters')">+</button>
                        </div>
                        <p class="block-hint">{{ t('strategies.blockFiltersHint') }}</p>
                        <div v-for="(b, i) in entwurf.rules.signalFilters" :key="i" class="row g-1 mb-1">
                            <div class="col-3">
                                <select class="form-select form-select-sm" :value="refText(b.left)"
                                    @change="refSetzen(b, 'left', $event.target.value)">
                                    <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                </select>
                            </div>
                            <div class="col-3">
                                <select v-model="b.op" class="form-select form-select-sm" @change="pruefen">
                                    <option v-for="o in bausteine.vergleiche" :key="o" :value="o">{{ t('strategies.op_' + o) }}</option>
                                </select>
                            </div>
                            <div class="col-3">
                                <!-- Der Berührungszähler hat keine rechte Seite — nur die Linie links. -->
                                <select v-if="b.op !== 'priorTouchesGte'" class="form-select form-select-sm" :value="refText(b.right)"
                                    @change="refSetzen(b, 'right', $event.target.value)">
                                    <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ t('strategies.fromParam', { name: pk }) }}</option>
                                </select>
                                <div v-else class="d-flex gap-1">
                                    <ZahlOderParam :ziel="b" feld="separation" :standard="3"
                                        :titel="t('strategies.touchSeparation')" :params="parameterNamen" @aendern="pruefen" />
                                    <ZahlOderParam :ziel="b" feld="window" :standard="200"
                                        :titel="t('strategies.touchWindow')" :params="parameterNamen" @aendern="pruefen" />
                                </div>
                            </div>
                            <div class="col-2">
                                <ZahlOderParam v-if="b.op === 'priorTouchesGte'" :ziel="b" feld="value" :standard="2"
                                    :titel="t('strategies.touchPrev')" :params="parameterNamen" @aendern="pruefen" />
                                <select v-else-if="['distancePctGt','distancePctLt','isBullish','isBearish'].includes(b.op)"
                                    class="form-select form-select-sm" :value="refText(b.value)"
                                    @change="refSetzen(b, 'value', $event.target.value)">
                                    <option v-for="n in [0,0.5,1,2,2.5,5,10]" :key="n" :value="String(n)">{{ n }}</option>
                                    <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ pk }}</option>
                                </select>
                            </div>
                            <div class="col-1"><button class="btn btn-sm btn-outline-danger py-0 w-100" @click="bedingungWeg('signalFilters', i)"><i class="uil uil-times"></i></button></div>
                        </div>
                    </div>

                    <!-- ── 5. Einstieg ── -->
                    <div v-if="!einfach" class="block" :class="{ blockGeaendert: chatBetrifft('entry') }">
                        <div class="block-title"><span class="nr">5</span>{{ t('strategies.blockEntry') }}</div>
                        <p class="block-hint">{{ t('strategies.blockEntryHint') }}</p>
                        <div class="row g-1">
                            <div class="col-4">
                                <select v-model="entwurf.rules.entry.type" class="form-select form-select-sm" @change="pruefen">
                                    <option v-for="e in bausteine.einstieg" :key="e" :value="e">{{ t('strategies.entry_' + e) }}</option>
                                </select>
                            </div>
                            <template v-if="entwurf.rules.entry.type === 'touch'">
                                <div class="col-4">
                                    <select class="form-select form-select-sm" :value="refText(entwurf.rules.entry.anchor)"
                                        @change="refSetzen(entwurf.rules.entry, 'anchor', $event.target.value)">
                                        <option value="">–</option>
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                                <div class="col-4">
                                    <select v-model="entwurf.rules.entry.from" class="form-select form-select-sm" @change="pruefen">
                                        <option value="above">{{ t('strategies.fromAbove') }}</option>
                                        <option value="below">{{ t('strategies.fromBelow') }}</option>
                                    </select>
                                </div>
                            </template>
                        </div>
                    </div>

                    <!-- ── 6. Abbruchgründe ── -->
                    <div v-if="!einfach" class="block" :class="{ blockGeaendert: chatBetrifft('invalidations') }">
                        <div class="block-title">
                            <span class="nr">6</span>{{ t('strategies.blockInvalidations') }}
                            <button class="btn btn-sm btn-outline-secondary py-0 ms-auto me-1" @click="abbruchHinzu('condition')">
                                + {{ t('strategies.condition') }}
                            </button>
                            <button class="btn btn-sm btn-outline-secondary py-0" @click="abbruchHinzu('timeout')">
                                + {{ t('strategies.timeout') }}
                            </button>
                        </div>
                        <p class="block-hint">{{ t('strategies.blockInvalidationsHint') }}</p>
                        <div v-for="(v, i) in entwurf.rules.invalidations" :key="i" class="row g-1 mb-1">
                            <div class="col-3"><input v-model="v.code" class="form-control form-control-sm" :placeholder="t('strategies.reasonCode')" @change="pruefen" /></div>
                            <template v-if="v.type === 'timeout'">
                                <div class="col-8">
                                    <select class="form-select form-select-sm" :value="refText(v.candles)"
                                        @change="refSetzen(v, 'candles', $event.target.value)">
                                        <option v-for="n in [3,5,10,15,20,30,50]" :key="n" :value="String(n)">{{ t('strategies.afterCandles', { n }) }}</option>
                                        <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ t('strategies.fromParam', { name: pk }) }}</option>
                                    </select>
                                </div>
                            </template>
                            <template v-else>
                                <div class="col-3">
                                    <select class="form-select form-select-sm" :value="refText(v.when.left)"
                                        @change="refSetzen(v.when, 'left', $event.target.value)">
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                                <div class="col-3">
                                    <select v-model="v.when.op" class="form-select form-select-sm" @change="pruefen">
                                        <option v-for="o in bausteine.vergleiche" :key="o" :value="o">{{ t('strategies.op_' + o) }}</option>
                                    </select>
                                </div>
                                <div class="col-2">
                                    <ZahlOderParam v-if="v.when.op === 'priorTouchesGte'" :ziel="v.when" feld="value" :standard="2"
                                        :titel="t('strategies.touchPrev')" :params="parameterNamen" @aendern="pruefen" />
                                    <select v-else class="form-select form-select-sm" :value="refText(v.when.right)"
                                        @change="refSetzen(v.when, 'right', $event.target.value)">
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                            </template>
                            <div class="col-1"><button class="btn btn-sm btn-outline-danger py-0 w-100" @click="abbruchWeg(i)"><i class="uil uil-times"></i></button></div>
                        </div>
                    </div>

                    <!-- ── 7. Stop und Ziel ── -->
                    <div v-if="!einfach" class="block" :class="{ blockGeaendert: chatBetrifft(['stopLoss','takeProfit','breakEvenAtR']) }">
                        <div class="block-title"><span class="nr">7</span>{{ t('strategies.blockExit') }}</div>
                        <div class="row g-1 mb-2">
                            <div class="col-2 small pt-1">{{ t('strategies.stop') }}</div>
                            <div class="col-4">
                                <select class="form-select form-select-sm" :value="refText(entwurf.rules.stopLoss.anchor)"
                                    @change="refSetzen(entwurf.rules.stopLoss, 'anchor', $event.target.value)">
                                    <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                </select>
                            </div>
                            <div class="col-4">
                                <select class="form-select form-select-sm" :value="refText(entwurf.rules.stopLoss.offsetPct)"
                                    @change="refSetzen(entwurf.rules.stopLoss, 'offsetPct', $event.target.value)">
                                    <option v-for="n in [0,0.1,0.2,0.3,0.5,1,2]" :key="n" :value="String(n)">{{ n }} % {{ t('strategies.beyond') }}</option>
                                    <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ t('strategies.fromParam', { name: pk }) }}</option>
                                </select>
                            </div>
                        </div>
                        <div class="row g-1">
                            <div class="col-2 small pt-1">{{ t('strategies.target') }}</div>
                            <div class="col-4">
                                <select v-model="entwurf.rules.takeProfit.mode" class="form-select form-select-sm" @change="pruefen">
                                    <option v-for="z in bausteine.ziele" :key="z" :value="z">{{ t('strategies.tp_' + z) }}</option>
                                </select>
                            </div>
                            <div class="col-4">
                                <select v-if="entwurf.rules.takeProfit.mode === 'rr'" class="form-select form-select-sm"
                                    :value="refText(entwurf.rules.takeProfit.rr)"
                                    @change="refSetzen(entwurf.rules.takeProfit, 'rr', $event.target.value)">
                                    <option v-for="n in [1,1.5,2,2.5,3,4,5]" :key="n" :value="String(n)">{{ n }} R</option>
                                    <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ t('strategies.fromParam', { name: pk }) }}</option>
                                </select>
                                <select v-else-if="entwurf.rules.takeProfit.mode === 'anchor'" class="form-select form-select-sm"
                                    :value="refText(entwurf.rules.takeProfit.anchor)"
                                    @change="refSetzen(entwurf.rules.takeProfit, 'anchor', $event.target.value)">
                                    <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                </select>
                            </div>
                            <div class="col-2">
                                <input v-model.number="entwurf.rules.breakEvenAtR" type="number" step="0.5" min="0"
                                    class="form-control form-control-sm" :title="t('strategies.breakEvenTitle')" @change="pruefen" />
                            </div>
                        </div>
                    </div>

                    <div class="d-flex gap-2 mt-3">
                        <button class="btn btn-sm btn-success" :disabled="speichert || (pruefung && !pruefung.ok)" @click="sichern">
                            <i class="uil uil-save me-1"></i>{{ t('common.save') }}
                        </button>
                        <button class="btn btn-sm btn-outline-secondary" @click="entwurf = null">{{ t('common.cancel') }}</button>
                    </div>
                </div>

                <!-- ══ Test ══ -->
                <div class="dailyCard p-3 mb-3">
                    <div class="section-title mb-2">{{ t('strategies.testNow') }}</div>
                    <div class="row g-2 align-items-end">
                        <div class="col-4 col-md-3">
                            <label class="form-label small mb-1">{{ t('strategies.symbol') }}</label>
                            <input v-model="test.symbol" class="form-control form-control-sm" />
                        </div>
                        <div class="col-4 col-md-2">
                            <label class="form-label small mb-1">{{ t('strategies.timeframe') }}</label>
                            <select v-model="test.timeframe" class="form-select form-select-sm">
                                <option v-for="tf in entwurf.rules.timeframes" :key="tf" :value="tf">{{ tf }}</option>
                            </select>
                        </div>
                        <div class="col-4 col-md-2">
                            <label class="form-label small mb-1">{{ t('strategies.days') }}</label>
                            <input v-model.number="test.tage" type="number" min="30" max="720" class="form-control form-control-sm" />
                        </div>
                        <div class="col-12 col-md-2">
                            <button class="btn btn-sm btn-success w-100" :disabled="testLaeuft" @click="testen">
                                <span v-if="testLaeuft" class="spinner-border spinner-border-sm"></span>
                                <span v-else>{{ t('strategies.run') }}</span>
                            </button>
                        </div>
                    </div>

                    <div v-if="testErgebnis" class="mt-3">
                        <!-- Der Chart zum Testlauf. Kräftig = gehandelt, blass
                             gestrichelt = erkannt und verworfen. -->
                        <div class="mb-2">
                            <div class="d-flex align-items-center gap-2 mb-1">
                                <i class="uil uil-chart-line"></i>
                                <strong class="small">{{ t('strategies.chartTitle') }}</strong>
                                <span v-if="testErgebnis.setups?.length" class="badge bg-dark">
                                    {{ t('strategies.chartSetups', { n: testErgebnis.setups.length }) }}
                                </span>
                            </div>
                            <p class="small text-muted mb-1">{{ t('strategies.chartHint') }}</p>
                            <div id="editorChart" class="editorChart"></div>
                            <div v-if="chartMeldung" class="small text-muted">{{ chartMeldung }}</div>
                        </div>

                        <div v-if="!testErgebnis.stats.trades" class="text-muted small">
                            {{ testErgebnis.stats.hinweis || t('strategies.noTradesInPeriod') }}
                        </div>
                        <div v-else class="row g-2">
                            <div class="col-4 col-md-2" v-for="k in [
                                { l: t('strategies.kpiTrades'), v: testErgebnis.stats.trades },
                                { l: t('strategies.kpiWinRate'), v: zahl(testErgebnis.stats.winRate, 1) + ' %' },
                                { l: t('strategies.kpiExpectancy'), v: zahl(testErgebnis.stats.expectancyR) + ' R',
                                  farbe: testErgebnis.stats.expectancyR >= 0 },
                                { l: t('strategies.kpiProfitFactor'), v: zahl(testErgebnis.stats.profitFactor) },
                                { l: t('strategies.kpiNetPnl'), v: zahl(testErgebnis.stats.netPnl), farbe: testErgebnis.stats.netPnl >= 0 },
                                { l: t('strategies.kpiMaxDd'), v: zahl(testErgebnis.stats.maxDrawdownPct, 1) + ' %' },
                            ]" :key="k.l">
                                <div class="text-center p-2">
                                    <div class="kpi-label">{{ k.l }}</div>
                                    <div class="kpi-value" :class="k.farbe === undefined ? '' : (k.farbe ? 'greenTrade' : 'redTrade')">{{ k.v }}</div>
                                </div>
                            </div>
                        </div>
                        <div v-if="testErgebnis.funnel" class="row mt-2">
                            <div class="col-12 col-md-6">
                                <div class="section-title mb-1">{{ t('strategies.funnel') }}</div>
                                <table class="table table-sm table-borderless mb-0">
                                    <tbody>
                                        <tr v-for="k in ['setupsDetected','triggered','executed']" :key="k">
                                            <td class="small">{{ t('strategies.bt_' + k) }}</td>
                                            <td class="text-end small"><strong>{{ testErgebnis.funnel[k] }}</strong></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <div class="col-12 col-md-6">
                                <div class="section-title mb-1">{{ t('strategies.whyLost') }}</div>
                                <table class="table table-sm table-borderless mb-0">
                                    <tbody>
                                        <tr v-for="[g, n] in sortiert(testErgebnis.funnel.invalidated)" :key="g">
                                            <td class="small">{{ g }}</td>
                                            <td class="text-end small">{{ n }}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </template>

            <!-- ══ Eigene Strategien ══ -->
            <div v-if="liste.length" class="dailyCard p-3">
                <div class="section-title mb-2">{{ t('strategies.myStrategies') }}</div>
                <div class="table-responsive">
                    <table class="table table-sm table-borderless mb-0">
                        <tbody>
                            <tr v-for="s in liste" :key="s.id">
                                <td class="small pointerClass" @click="bearbeiten(s)"><strong>{{ s.name }}</strong></td>
                                <td class="small text-muted">{{ s.strategyId }}</td>
                                <td class="small">
                                    <span class="badge" :class="s.geladen ? 'bg-success' : 'bg-danger'">
                                        {{ s.geladen ? t('strategies.loaded') : t('strategies.notLoaded') }}
                                    </span>
                                </td>
                                <td class="small text-muted">{{ (s.rules.timeframes || []).join(', ') }}</td>
                                <td class="text-end" style="white-space: nowrap;">
                                    <button class="btn btn-sm btn-outline-secondary py-0 me-1" :title="t('strategies.exportTitle')"
                                        @click="exportieren(s)"><i class="uil uil-download-alt"></i></button>
                                    <button class="btn btn-sm btn-outline-secondary py-0 me-1" :title="t('strategies.duplicate')"
                                        @click="kopieren(s)"><i class="uil uil-copy"></i></button>
                                    <template v-if="loeschFrage === s.id">
                                        <button class="btn btn-sm btn-danger py-0 me-1" @click="loeschen(s)">{{ t('common.yes') }}</button>
                                        <button class="btn btn-sm btn-outline-secondary py-0" @click="loeschFrage = null">{{ t('common.no') }}</button>
                                    </template>
                                    <button v-else class="btn btn-sm btn-outline-danger py-0" @click="loeschFrage = s.id">
                                        <i class="uil uil-trash-alt"></i>
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.dailyCard {
    height: auto;
}

.section-title {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--white-60, rgba(255, 255, 255, 0.6));
}

.block {
    border-top: 1px solid var(--white-10,rgba(255, 255, 255, 0.1));
    padding-top: 0.7rem;
    margin-top: 0.7rem;
}

/* Vom letzten Chat-Vorschlag angefasst. Bewusst eine Kante statt einer Füllung:
   sie zeigt den Ort, ohne die Werte darin schwerer lesbar zu machen. */
.block.blockGeaendert {
    border-left: 3px solid var(--blue-color, #01B4FF);
    padding-left: 0.6rem;
    margin-left: -0.6rem;
    background: rgba(1, 180, 255, 0.06);
    border-radius: var(--border-radius, 6px);
}

/* Der Chat ist ein Werkzeug, kein Anhängsel — er bekommt eine eigene Fläche,
   damit er nicht als weitere Formularzeile gelesen wird. */
.vorlageWeg {
    position: absolute;
    top: 0.2rem;
    right: 0.3rem;
    padding: 0 0.3rem;
    line-height: 1;
    text-decoration: none;
}

.editorChart {
    width: 100%;
    height: 340px;
}

.saetzeKarte {
    border: 1px solid var(--white-10,rgba(255, 255, 255, 0.12));
    border-radius: var(--border-radius, 6px);
    padding: 0.75rem;
}

.satzZeile {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    padding: 0.15rem 0;
    font-size: 0.88rem;
}

.satzTitel {
    flex: 0 0 6.5rem;
    color: var(--white-60, rgba(255, 255, 255, 0.6));
    font-size: 0.8rem;
}

.chatPanel {
    border: 1px solid rgba(1, 180, 255, 0.35);
    background: rgba(1, 180, 255, 0.05);
    border-radius: var(--border-radius, 6px);
    padding: 0.75rem;
    margin-top: 0.7rem;
}

.chatIcon {
    color: var(--blue-color, #01B4FF);
    font-size: 1.1rem;
}

.chatVerlauf {
    max-height: 16rem;
    overflow-y: auto;
    border: 1px solid var(--white-10,rgba(255, 255, 255, 0.1));
    border-radius: var(--border-radius, 6px);
    padding: 0.5rem;
}

.chatZeile {
    font-size: 0.85rem;
    padding: 0.35rem 0.55rem;
    margin-bottom: 0.35rem;
    border-radius: var(--border-radius, 6px);
    white-space: pre-wrap;
}

.chatNutzer {
    background: rgba(1, 180, 255, 0.14);
    margin-left: 2rem;
}

.chatModell {
    background: var(--white-10, rgba(255, 255, 255, 0.06));
    margin-right: 2rem;
}

/* Marktphasen-Badge auf den Vorlagen-Karten */
.marktBadge {
    font-weight: 500;
    white-space: normal;
    text-align: left;
}
.marktTrend {
    background: rgba(1, 180, 255, 0.12);
    border: 1px solid rgba(1, 180, 255, 0.45);
    color: rgba(1, 180, 255, 0.95);
}
.marktSeitwaerts {
    background: rgba(240, 196, 25, 0.12);
    border: 1px solid rgba(240, 196, 25, 0.45);
    color: rgba(240, 196, 25, 0.95);
}
.marktNeutral {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.25);
    color: rgba(255, 255, 255, 0.75);
}

.block-title {
    display: flex;
    align-items: center;
    font-size: 0.85rem;
    font-weight: 600;
    margin-bottom: 0.2rem;
}

.block-title .nr {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.3rem;
    height: 1.3rem;
    margin-right: 0.5rem;
    border-radius: 50%;
    background: var(--blue-color, #01B4FF);
    color: #fff;
    font-size: 0.7rem;
}

.block-hint {
    font-size: 0.74rem;
    color: var(--white-50, rgba(255, 255, 255, 0.5));
    margin-bottom: 0.5rem;
}

.kpi-label {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--white-50, rgba(255, 255, 255, 0.5));
}

.kpi-value {
    font-size: 1.1rem;
    font-weight: 600;
}
</style>
