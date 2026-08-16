<script setup>
/**
 * Coin-Rangliste — eine fertige Strategie über ein ganzes Coin-Universum.
 *
 * Die Seite fragt den Fortschritt ab, statt an einem Ereignisstrom zu hängen:
 * ein Lauf dauert Minuten, und ein Seitenwechsel darf ihn nicht töten. Der
 * Server arbeitet ihn im Hintergrund ab; hier wird nur gezeigt, wie weit er ist.
 *
 * Die wichtigste Anzeige ist nicht die Tabelle, sondern der Satz darüber: bei
 * hundert getesteten Coins sieht immer irgendeiner hervorragend aus. Ohne die
 * Nullverteilung daneben wäre die Rangliste eine Einladung, Rauschen zu handeln.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const strategien = ref([])
const universen = ref([])
const quellen = ref(null)
const laeufe = ref([])

const form = ref({
    strategyId: '',
    timeframe: '',
    // 360 Tage als Vorgabe, nicht 180: weil der Zeitraum geteilt wird, braucht
    // JEDE Hälfte für sich 30 Trades. Auf 1h liefern 180 Tage nur gut 20 — die
    // ganze Rangliste wäre dann „zu wenige Trades".
    tage: 360,
    art: 'top',
    n: 100,
    symbole: '',
    nurHandelbar: true,
    thema: '',
})

const vorschlag = ref(null)
const probe = ref(null)
const fehler = ref('')
const laden = ref(false)
const lauf = ref(null)
const zeilen = ref([])
let pollTimer = null

const belastbare = computed(() => zeilen.value.filter((z) => z.klasse === 'belastbar'))
const uebrige = computed(() => zeilen.value.filter((z) => z.klasse !== 'belastbar'))
const laeuftGerade = computed(() => ['wartet', 'laeuft', 'pausiert'].includes(lauf.value?.status))

const zahl = (v, n = 2) => (Number.isFinite(Number(v)) ? Number(v).toFixed(n) : '—')
const datum = (ms) => (ms ? new Date(Number(ms)).toLocaleDateString() : '—')

/** Ampel der Prüfhälfte — grün bestätigt, gelb zu dünn, rot gekippt. */
function ampel(z) {
    if (z.bestaetigt) return { farbe: 'greenTrade', text: t('rangliste.bestaetigt') }
    if (Number(z.bTrades) < 30) return { farbe: 'text-warning', text: t('rangliste.duenn') }
    return { farbe: 'redTrade', text: t('rangliste.gekippt') }
}

async function ladeGrunddaten() {
    try {
        const [s, u, l] = await Promise.all([
            axios.get('/api/strategies/registry'),
            axios.get('/api/rangliste/universen'),
            axios.get('/api/rangliste/laeufe'),
        ])
        strategien.value = s.data?.strategies || []
        universen.value = u.data || []
        laeufe.value = l.data || []
        if (!form.value.strategyId && strategien.value.length) {
            form.value.strategyId = strategien.value[0].id
            await holeVorschlag()
        }
        // Ein noch laufender Lauf wird sofort übernommen — auch wenn ihn eine
        // andere Sitzung gestartet hat.
        const offen = laeufe.value.find((x) => ['wartet', 'laeuft', 'pausiert'].includes(x.status))
        if (offen) oeffne(offen.id)
        else if (laeufe.value.length) oeffne(laeufe.value[0].id)
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    }
    axios.get('/api/rangliste/universen/quellen')
        .then((r) => { quellen.value = r.data })
        .catch(() => { quellen.value = null })
}

async function holeVorschlag() {
    vorschlag.value = null
    if (!form.value.strategyId) return
    try {
        const r = await axios.get('/api/rangliste/zeiteinheit', {
            params: { strategyId: form.value.strategyId, tage: form.value.tage },
        })
        vorschlag.value = r.data
        if (r.data.timeframe) form.value.timeframe = r.data.timeframe
    } catch { /* ohne Vorschlag wählt der Nutzer selbst */ }
}

const kiLaeuft = ref(false)
const kiErgebnis = ref(null)

/**
 * Die KI schlägt vor, entscheidet aber nichts: das Ergebnis landet im
 * Symbolfeld, wo der Nutzer es sieht und ändern kann. Eine Liste, die direkt in
 * einen zehnminütigen Lauf wandert, hätte niemand geprüft.
 */
async function kiVorschlag() {
    kiErgebnis.value = null
    fehler.value = ''
    kiLaeuft.value = true
    try {
        const r = await axios.post('/api/rangliste/ki-vorschlag', { thema: form.value.thema })
        kiErgebnis.value = r.data
        form.value.symbole = r.data.symbole.join(', ')
        probe.value = null
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    } finally {
        kiLaeuft.value = false
    }
}

async function pruefeUniversum() {
    probe.value = null
    fehler.value = ''
    try {
        const r = await axios.post('/api/rangliste/universen/aufloesen', {
            art: form.value.art, n: form.value.n,
            symbole: form.value.symbole, nurHandelbar: form.value.nurHandelbar,
        })
        probe.value = r.data
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    }
}

async function starten() {
    fehler.value = ''
    laden.value = true
    try {
        const r = await axios.post('/api/rangliste/laeufe', {
            strategyId: form.value.strategyId,
            timeframe: form.value.timeframe,
            tage: form.value.tage,
            art: form.value.art, n: form.value.n,
            symbole: form.value.symbole, nurHandelbar: form.value.nurHandelbar,
            name: form.value.art === 'top' ? `Top ${form.value.n}` : form.value.art,
            timeframeQuelle: vorschlag.value?.timeframe === form.value.timeframe
                ? vorschlag.value.quelle : 'hand',
            timeframeBegruendung: vorschlag.value?.timeframe === form.value.timeframe
                ? vorschlag.value.begruendung : '',
        })
        await ladeGrunddaten()
        oeffne(r.data.laufId)
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    } finally {
        laden.value = false
    }
}

async function abbrechen() {
    if (!lauf.value) return
    try { await axios.post(`/api/rangliste/laeufe/${lauf.value.id}/abbrechen`) } catch { /* egal */ }
}

async function loesche(id) {
    try {
        await axios.delete(`/api/rangliste/laeufe/${id}`)
        if (lauf.value?.id === id) { lauf.value = null; zeilen.value = [] }
        await ladeGrunddaten()
    } catch (e) { fehler.value = e.response?.data?.error || e.message }
}

async function oeffne(id) {
    stopPolling()
    await aktualisiere(id)
    if (laeuftGerade.value) pollTimer = setInterval(() => aktualisiere(id), 2000)
}

async function aktualisiere(id) {
    try {
        const [k, z] = await Promise.all([
            axios.get(`/api/rangliste/laeufe/${id}`),
            axios.get(`/api/rangliste/laeufe/${id}/zeilen`),
        ])
        lauf.value = k.data
        zeilen.value = z.data || []
        if (!laeuftGerade.value) { stopPolling(); await ladeListe() }
    } catch (e) {
        stopPolling()
        fehler.value = e.response?.data?.error || e.message
    }
}

async function ladeListe() {
    try { laeufe.value = (await axios.get('/api/rangliste/laeufe')).data || [] } catch { /* egal */ }
}

function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

onMounted(ladeGrunddaten)
onBeforeUnmount(stopPolling)
</script>

<template>
<div class="row mt-2">
    <div class="col-12">
        <div class="dailyCard p-3 mb-3">
            <div class="section-title mb-1">
                <i class="uil uil-list-ol-alt me-1"></i>{{ t('rangliste.title') }}
            </div>
            <p class="text-muted small mb-0">{{ t('rangliste.hint') }}</p>
        </div>

        <div v-if="fehler" class="alert alert-danger py-2 px-3 small">{{ fehler }}</div>

        <!-- ══ Einstellungen ══ -->
        <div class="dailyCard p-3 mb-3">
            <div class="row g-2 align-items-end mb-2">
                <div class="col-12 col-md-4">
                    <label class="form-label small mb-1">{{ t('rangliste.strategie') }}</label>
                    <select v-model="form.strategyId" class="form-select form-select-sm" @change="holeVorschlag">
                        <option v-for="s in strategien" :key="s.id" :value="s.id">{{ s.name }}</option>
                    </select>
                </div>
                <div class="col-6 col-md-2">
                    <label class="form-label small mb-1">{{ t('rangliste.zeitraum') }}</label>
                    <input v-model.number="form.tage" type="number" min="14" max="720"
                           class="form-control form-control-sm" @change="holeVorschlag" />
                </div>
                <div class="col-6 col-md-2">
                    <label class="form-label small mb-1">{{ t('rangliste.zeiteinheit') }}</label>
                    <select v-model="form.timeframe" class="form-select form-select-sm">
                        <option v-for="tf in (vorschlag?.kandidaten || [])" :key="tf" :value="tf">{{ tf }}</option>
                    </select>
                </div>
            </div>

            <!-- Der Vorschlag steht MIT Begründung da: eine Zeiteinheit, die aus
                 dem Nichts vorgeschlagen wird, übernimmt man blind. -->
            <div v-if="vorschlag?.begruendung" class="alert alert-secondary py-2 px-3 small mb-2">
                <i class="uil uil-lightbulb-alt me-1"></i>{{ vorschlag.begruendung }}
            </div>
            <div v-if="vorschlag?.knapp?.length" class="alert alert-warning py-2 px-3 small mb-2">
                <i class="uil uil-exclamation-triangle me-1"></i>
                <span v-for="k in vorschlag.knapp" :key="k.timeframe" class="me-2">
                    <strong>{{ k.timeframe }}</strong>: {{ k.text }}
                </span>
            </div>

            <hr class="my-3" />

            <!-- ══ Universum ══ -->
            <div class="section-title mb-2">{{ t('rangliste.universum') }}</div>
            <p v-if="quellen" class="text-muted small mb-2">
                {{ t('rangliste.quellen', quellen) }}
            </p>
            <div class="row g-2 align-items-end mb-2">
                <div class="col-12 col-md-4">
                    <select v-model="form.art" class="form-select form-select-sm" @change="probe = null">
                        <option value="bitunix">{{ t('rangliste.artBitunix') }}</option>
                        <option value="top">{{ t('rangliste.artTop') }}</option>
                        <option value="manuell">{{ t('rangliste.artManuell') }}</option>
                        <option value="ki">{{ t('rangliste.artKi') }}</option>
                    </select>
                </div>
                <div v-if="form.art === 'top'" class="col-6 col-md-2">
                    <label class="form-label small mb-1">{{ t('rangliste.anzahl') }}</label>
                    <input v-model.number="form.n" type="number" min="5" max="250"
                           class="form-control form-control-sm" />
                </div>
                <div v-if="form.art === 'ki'" class="col-12 col-md-4">
                    <label class="form-label small mb-1">{{ t('rangliste.kiThema') }}</label>
                    <div class="input-group input-group-sm">
                        <input v-model="form.thema" type="text" class="form-control"
                               placeholder="RWA" @keyup.enter="kiVorschlag" />
                        <button class="btn btn-outline-secondary" :disabled="kiLaeuft || !form.thema"
                                @click="kiVorschlag">
                            <span v-if="kiLaeuft" class="spinner-border spinner-border-sm"></span>
                            <span v-else>{{ t('rangliste.kiVorschlagen') }}</span>
                        </button>
                    </div>
                </div>
                <div v-if="form.art === 'manuell' || form.art === 'ki'" class="col-12 col-md-6">
                    <label class="form-label small mb-1">{{ t('rangliste.symbole') }}</label>
                    <input v-model="form.symbole" type="text" class="form-control form-control-sm"
                           placeholder="BTCUSDT, ETHUSDT" />
                </div>
                <div class="col-12 col-md-3">
                    <div class="form-check">
                        <input v-model="form.nurHandelbar" class="form-check-input" type="checkbox" id="nurH" />
                        <label class="form-check-label small" for="nurH">{{ t('rangliste.nurHandelbar') }}</label>
                    </div>
                </div>
                <div class="col-12 col-md-2">
                    <button class="btn btn-sm btn-outline-secondary w-100" @click="pruefeUniversum">
                        {{ t('rangliste.pruefen') }}
                    </button>
                </div>
            </div>

            <!-- Was das Modell vorgeschlagen hat UND was davon nicht ging.
                 Eine still gekürzte Liste wäre eine Behauptung über
                 Vollständigkeit, die niemand nachprüfen kann. -->
            <div v-if="kiErgebnis" class="alert alert-secondary py-2 px-3 small mb-2">
                <strong>{{ kiErgebnis.name }}</strong> — {{ kiErgebnis.begruendung }}
                <div v-if="kiErgebnis.verworfen.length" class="text-warning mt-1">
                    {{ t('rangliste.kiVerworfen', {
                        n: kiErgebnis.verworfen.length,
                        gesamt: kiErgebnis.gesamtVorschlaege,
                    }) }}
                    <span class="text-muted">{{ kiErgebnis.verworfen.slice(0, 8).join(', ') }}</span>
                </div>
                <div class="text-muted mt-1">
                    {{ kiErgebnis.provider }}/{{ kiErgebnis.modell }} ·
                    {{ kiErgebnis.tokens }} Token · {{ kiErgebnis.kostenUsd.toFixed(4) }} USD
                </div>
            </div>

            <div v-if="probe" class="alert alert-secondary py-2 px-3 small mb-2">
                <strong>{{ t('rangliste.gefunden', { n: probe.anzahl }) }}</strong>
                <span class="text-muted ms-1">
                    {{ t('rangliste.ausgeschlossen', {
                        ohneHistorie: probe.ohneHistorie.length,
                        ohneMarkt: probe.ohneMarkt.length,
                        nichtHandelbar: probe.nichtHandelbar.length,
                    }) }}
                </span>
            </div>

            <button class="btn btn-sm btn-primary" :disabled="laden || laeuftGerade || !form.timeframe"
                    @click="starten">
                <span v-if="laden" class="spinner-border spinner-border-sm me-1"></span>
                {{ t('rangliste.starten') }}
            </button>
        </div>

        <!-- ══ Fortschritt ══ -->
        <div v-if="lauf" class="dailyCard p-3 mb-3">
            <div class="d-flex justify-content-between align-items-center mb-2">
                <div>
                    <strong>{{ lauf.universumName }}</strong>
                    <span class="text-muted small ms-2">
                        {{ lauf.strategyId }} · {{ lauf.timeframe }} ·
                        {{ datum(lauf.fromTs) }} – {{ datum(lauf.toTs) }}
                    </span>
                </div>
                <div>
                    <span class="badge me-2"
                          :class="lauf.status === 'fertig' ? 'bg-success'
                                : lauf.status === 'fehler' ? 'bg-danger'
                                : lauf.status === 'abgebrochen' ? 'bg-secondary' : 'bg-primary'">
                        {{ t('rangliste.st_' + lauf.status) }}
                    </span>
                    <button v-if="laeuftGerade" class="btn btn-sm btn-outline-danger" @click="abbrechen">
                        {{ t('rangliste.abbrechen') }}
                    </button>
                </div>
            </div>
            <div v-if="laeuftGerade" class="progress mb-1" style="height: 6px">
                <div class="progress-bar" role="progressbar"
                     :style="{ width: (lauf.gesamt ? (lauf.fortschritt / lauf.gesamt * 100) : 0) + '%' }"></div>
            </div>
            <div class="small text-muted">
                {{ t('rangliste.fortschritt', { fertig: lauf.fortschritt, gesamt: lauf.gesamt }) }}
                <span v-if="lauf.timeframeBegruendung" class="ms-2">· {{ lauf.timeframeBegruendung }}</span>
            </div>
        </div>

        <!-- ══ Die Beurteilung — wichtiger als die Tabelle ══ -->
        <div v-if="lauf?.nullverteilung?.satz" class="alert py-2 px-3 small mb-3"
             :class="lauf.nullverteilung.umtopfen && lauf.nullverteilung.umtopfen.anteilUeberBeobachtet < 0.05
                     ? 'alert-success' : 'alert-warning'">
            <div class="fw-bold mb-1">
                <i class="uil uil-dice-six me-1"></i>{{ t('rangliste.beurteilung') }}
            </div>
            {{ lauf.nullverteilung.satz }}
        </div>

        <!-- ══ Rangliste ══ -->
        <div v-if="belastbare.length" class="dailyCard p-3 mb-3">
            <div class="table-responsive">
                <table class="table table-sm table-hover align-middle mb-0">
                    <thead><tr>
                        <th style="width:3rem">{{ t('rangliste.rang') }}</th>
                        <th>{{ t('rangliste.symbol') }}</th>
                        <th class="text-end">{{ t('rangliste.trades') }}</th>
                        <th class="text-end">{{ t('rangliste.ohneTop') }}</th>
                        <th class="text-end">{{ t('rangliste.erwartung') }}</th>
                        <th class="text-end">{{ t('rangliste.maxDd') }}</th>
                        <th class="text-end">{{ t('rangliste.pruefhaelfte') }}</th>
                        <th></th>
                    </tr></thead>
                    <tbody>
                        <tr v-for="z in belastbare" :key="z.id">
                            <td class="text-muted">{{ z.rangA }}</td>
                            <td><strong>{{ z.symbol }}</strong></td>
                            <td class="text-end small">{{ z.aTrades }}</td>
                            <td class="text-end small" :class="z.aOhneTopR >= 0 ? 'greenTrade' : 'redTrade'">
                                {{ zahl(z.aOhneTopR) }} R
                            </td>
                            <td class="text-end small text-muted">{{ zahl(z.aExpectancyR) }} R</td>
                            <td class="text-end small text-muted">{{ zahl(z.aMaxDdPct, 1) }} %</td>
                            <td class="text-end small" :class="z.bOhneTopR >= 0 ? 'greenTrade' : 'redTrade'">
                                {{ zahl(z.bOhneTopR) }} R
                                <span class="text-muted">({{ z.bTrades }})</span>
                            </td>
                            <td class="small" :class="ampel(z).farbe">{{ ampel(z).text }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- ══ Unter der Trennlinie — sichtbar, aber ohne Rang ══ -->
        <div v-if="uebrige.length" class="dailyCard p-3 mb-3">
            <p class="text-muted small mb-2">{{ t('rangliste.unterTrennlinie') }}</p>
            <div class="table-responsive">
                <table class="table table-sm align-middle mb-0">
                    <tbody>
                        <tr v-for="z in uebrige" :key="z.id">
                            <td style="width:9rem">
                                <span class="badge bg-secondary">{{ t('rangliste.k_' + z.klasse) }}</span>
                            </td>
                            <td><strong>{{ z.symbol }}</strong></td>
                            <td class="text-end small">{{ z.aTrades }} {{ t('rangliste.trades') }}</td>
                            <td class="text-end small text-muted">{{ zahl(z.aOhneTopR) }} R</td>
                            <td class="small text-muted">
                                <span v-if="z.klasse === 'datenluecke'">
                                    {{ zahl(z.abdeckungPct, 0) }} % · ab {{ datum(z.historieAb) }}
                                </span>
                                <span v-else-if="z.fehler">{{ z.fehler }}</span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- ══ Frühere Läufe ══ -->
        <div class="dailyCard p-3 mb-3">
            <div class="section-title mb-2">{{ t('rangliste.laeufe') }}</div>
            <p v-if="!laeufe.length" class="text-muted small mb-0">{{ t('rangliste.keineLaeufe') }}</p>
            <div v-else class="table-responsive">
                <table class="table table-sm table-hover align-middle mb-0">
                    <tbody>
                        <tr v-for="l in laeufe" :key="l.id" style="cursor:pointer" @click="oeffne(l.id)">
                            <td class="small">{{ l.universumName }}</td>
                            <td class="small text-muted">{{ l.strategyId }} · {{ l.timeframe }}</td>
                            <td class="small text-muted">{{ datum(l.fromTs) }} – {{ datum(l.toTs) }}</td>
                            <td class="small">{{ t('rangliste.st_' + l.status) }}</td>
                            <td class="small text-muted">{{ l.fortschritt }}/{{ l.gesamt }}</td>
                            <td class="text-end">
                                <button class="btn btn-sm btn-outline-danger py-0 px-1"
                                        @click.stop="loesche(l.id)">
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
