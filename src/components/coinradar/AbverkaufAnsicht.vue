<template>
    <div class="av">
        <div class="avKopf">
            <div class="avStand">
                <span v-if="!einst.an" class="avAus"><i class="uil uil-pause-circle me-1"></i>{{ t('abverkauf.aus') }}</span>
                <span v-else>{{ t('abverkauf.an', { n: einst.intervallMin }) }}</span>
                <span v-if="daten?.stand?.letzter?.am"> · {{ t('abverkauf.letzter', { z: zeitpunkt(daten.stand.letzter.am) }) }}</span>
                <span v-if="daten?.stand?.letzter?.angesehen !== undefined"> · {{ t('abverkauf.angesehen', { n: daten.stand.letzter.angesehen }) }}</span>
                <span v-if="daten?.stand?.letzter?.fehler" class="text-danger"> · {{ daten.stand.letzter.fehler }}</span>
            </div>
            <button type="button" class="ctl-pill ms-auto" @click="einstOffen = !einstOffen">
                <i class="uil uil-setting me-1"></i>{{ t('abverkauf.einstellungen') }}
            </button>
            <button type="button" class="ctl-pill" :disabled="laeuft" @click="pruefen">
                <span v-if="laeuft" class="spinner-border spinner-border-sm me-1"></span>
                <i v-else class="uil uil-sync me-1"></i>{{ laeuft ? t('abverkauf.laeuft') : t('abverkauf.jetzt') }}
            </button>
        </div>

        <!-- Einstellungen -->
        <div v-if="einstOffen" class="avEinst">
            <label class="avSchalter"><input type="checkbox" v-model="form.an"> {{ t('abverkauf.e_an') }}</label>
            <label class="avSchalter" :title="t('abverkauf.e_vorwarnungTitel')"><input type="checkbox" v-model="form.vorwarnung"> {{ t('abverkauf.e_vorwarnung') }}</label>
            <label>{{ t('abverkauf.e_intervall') }} <input v-model.number="form.intervallMin" type="number" min="5" max="120" class="form-control form-control-sm"></label>
            <label :title="t('abverkauf.e_anstiegTitel')">{{ t('abverkauf.e_anstieg') }} <input v-model.number="form.minAnstieg" type="number" min="5" max="500" class="form-control form-control-sm"></label>
            <label :title="t('abverkauf.e_umsatzTitel')">{{ t('abverkauf.e_umsatz') }} <input v-model.number="form.minUmsatzMio" type="number" min="0" step="1" class="form-control form-control-sm"></label>
            <label :title="t('abverkauf.e_schwelleTitel')">{{ t('abverkauf.e_schwelle') }} <input v-model.number="form.schwelle" type="number" min="10" max="100" class="form-control form-control-sm"></label>
            <button type="button" class="ctl-pill active" :disabled="speichert" @click="speichern">{{ t('abverkauf.e_speichern') }}</button>
            <span v-if="einstMeldung" class="small" :class="einstFehler ? 'text-danger' : 'avGrau'">{{ einstMeldung }}</span>
        </div>

        <div v-if="meldung" class="alert py-2 small mt-2" :class="meldungFehler ? 'alert-danger' : 'alert-info'">{{ meldung }}</div>
        <div v-if="ladeFehler" class="text-danger small mt-2">{{ ladeFehler }}</div>

        <p class="avHinweis">{{ t('abverkauf.erklaerung') }}</p>

        <div v-if="daten === null && !ladeFehler" class="text-muted small"><span class="spinner-border spinner-border-sm"></span></div>
        <template v-else-if="daten">
            <p v-if="!wichtige.length" class="avGrau small">{{ t('abverkauf.leer') }}</p>
            <div class="avKarten">
                <div v-for="c in wichtige" :key="c.symbol" class="avKarte" :class="c.phase">
                    <div class="avKarteKopf">
                        <strong class="avName">{{ kurzSymbol(c.symbol) }}</strong>
                        <span class="avPhase" :class="c.phase">{{ t('abverkauf.phase_' + c.phase) }}</span>
                        <span class="avGrau small">{{ t('abverkauf.seit', { z: dauer(Date.now() - c.phaseSeit) }) }}</span>
                        <span class="avNote" :title="t('abverkauf.noteTitel')">{{ t('abverkauf.treibstoff') }} <b>{{ c.note }}</b></span>
                        <span class="ms-auto avLinks">
                            <a v-for="l in links(c)" :key="l.boerse" :href="l.url" target="_blank" rel="noopener noreferrer" class="avLink"
                                :title="l.name">{{ l.kurz }}</a>
                        </span>
                    </div>
                    <div class="avKz">
                        <span><b :class="vz(c.kennzahlen?.anstieg24h)">{{ prozent(c.kennzahlen?.anstieg24h) }}</b> 24h</span>
                        <span>{{ t('abverkauf.vomHoch') }} <b>{{ prozent(c.kennzahlen?.vomHochPct) }}</b></span>
                        <span v-if="c.ungueltigUeber" :title="t('abverkauf.ungueltigTitel')">{{ t('abverkauf.ungueltig') }} <b>{{ kurs(c.ungueltigUeber) }}</b></span>
                        <span>Funding <b :class="vz(-(c.kennzahlen?.funding8h ?? 0))">{{ c.kennzahlen?.funding8h ?? '—' }}{{ c.kennzahlen?.funding8h !== null && c.kennzahlen?.funding8h !== undefined ? ' %/8h' : '' }}</b></span>
                        <span>OI 24h <b>{{ prozent(c.kennzahlen?.oi24h) }}</b></span>
                        <span v-if="c.kennzahlen?.oiVonSpitze !== null && c.kennzahlen?.oiVonSpitze !== undefined">OI {{ t('abverkauf.vonSpitze') }} <b>{{ prozent(c.kennzahlen.oiVonSpitze) }}</b></span>
                        <span>RSI 1h <b>{{ c.kennzahlen?.rsi1h ?? '—' }}</b></span>
                        <span>{{ t('abverkauf.konten') }} <b>{{ c.kennzahlen?.kontenLongPct ?? '—' }}{{ c.kennzahlen?.kontenLongPct !== null && c.kennzahlen?.kontenLongPct !== undefined ? ' %' : '' }}</b></span>
                        <span>Top <b>{{ c.kennzahlen?.topRatio ?? '—' }}</b></span>
                        <span :title="t('abverkauf.takerTitel')">Taker <b>{{ c.kennzahlen?.takerVorher ?? '—' }} → {{ c.kennzahlen?.takerJetzt ?? '—' }}</b></span>
                        <span v-if="c.kennzahlen?.keinSpot">{{ t('abverkauf.keinSpot') }}</span>
                        <span v-else :title="t('abverkauf.futSpotTitel')">Fut/Spot <b>{{ c.kennzahlen?.futSpotFaktor !== null && c.kennzahlen?.futSpotFaktor !== undefined ? c.kennzahlen.futSpotFaktor + '×' : '—' }}</b></span>
                    </div>
                    <div class="avSpalten">
                        <div>
                            <div class="avTitel">{{ t('abverkauf.titelTreibstoff') }}</div>
                            <ul class="avListe"><li v-for="x in c.treibstoff" :key="x.schluessel" class="plus">+ {{ x.text }}</li></ul>
                            <p v-if="!c.treibstoff?.length" class="avGrau small mb-0">—</p>
                        </div>
                        <div>
                            <div class="avTitel">{{ t('abverkauf.titelKippen') }}</div>
                            <ul class="avListe"><li v-for="x in c.kippen" :key="x.schluessel" class="kipp">↘ {{ x.text }}</li></ul>
                            <p v-if="!c.kippen?.length" class="avGrau small mb-0">{{ t('abverkauf.nochKeine') }}</p>
                        </div>
                        <div>
                            <div class="avTitel">{{ t('abverkauf.titelGegen') }}</div>
                            <ul class="avListe"><li v-for="x in c.gegen" :key="x.schluessel" :class="x.sperrt ? 'sperrt' : 'gegen'">{{ x.sperrt ? '⛔' : '!' }} {{ x.text }}</li></ul>
                            <p v-if="!c.gegen?.length" class="avGrau small mb-0">—</p>
                            <p v-if="c.fehlend?.length" class="avGrau small mt-1 mb-0">{{ t('abverkauf.fehlend', { f: c.fehlend.map((f) => t('abverkauf.quelle_' + f)).join(', ') }) }}</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Angesehen, aber ohne Befund -->
            <div v-if="uebrige.length" class="avAbschnitt">
                <button type="button" class="ctl-pill" @click="uebrigeOffen = !uebrigeOffen">
                    <i class="uil me-1" :class="uebrigeOffen ? 'uil-angle-up' : 'uil-angle-down'"></i>{{ t('abverkauf.uebrige', { n: uebrige.length }) }}
                </button>
                <table v-if="uebrigeOffen" class="table table-sm align-middle avTabelle mt-2">
                    <tbody>
                        <tr v-for="c in uebrige" :key="c.symbol">
                            <td><strong>{{ kurzSymbol(c.symbol) }}</strong></td>
                            <td class="text-end">{{ prozent(c.kennzahlen?.anstieg24h) }}</td>
                            <td class="text-end">{{ t('abverkauf.treibstoff') }} {{ c.note }}</td>
                            <td class="avGrau small">{{ (c.treibstoff || []).map((x) => x.text).join(' · ') }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- Erfolgskontrolle -->
            <div class="avAbschnitt">
                <div class="avTitelGross">{{ t('abverkauf.gueteTitel') }}</div>
                <p class="avGrau small mb-1">{{ t('abverkauf.gueteHinweis') }}</p>
                <p v-if="!Object.keys(daten.guete || {}).length" class="avGrau small">{{ t('abverkauf.gueteLeer', { n: daten.offen || 0 }) }}</p>
                <table v-else class="table table-sm align-middle avTabelle">
                    <thead>
                        <tr>
                            <th>{{ t('abverkauf.gHorizont') }}</th>
                            <th>{{ t('abverkauf.gGruppe') }}</th>
                            <th class="text-end">n</th>
                            <th class="text-end" :title="t('abverkauf.gRenditeTitel')">{{ t('abverkauf.gRendite') }}</th>
                            <th class="text-end">{{ t('abverkauf.gFall') }}</th>
                            <th class="text-end" :title="t('abverkauf.gHochTitel')">{{ t('abverkauf.gHoch') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <template v-for="h in ['1h', '4h', '24h']" :key="h">
                            <tr v-for="g in ['spitze', 'kontrolle']" v-show="daten.guete[h]" :key="h + g">
                                <td>{{ g === 'spitze' ? h : '' }}</td>
                                <td>{{ t('abverkauf.g_' + g) }}</td>
                                <td class="text-end">{{ daten.guete[h]?.[g]?.n ?? 0 }}</td>
                                <td class="text-end" :class="vz(-(daten.guete[h]?.[g]?.medianRendite ?? 0))">{{ prozent(daten.guete[h]?.[g]?.medianRendite) }}</td>
                                <td class="text-end">{{ daten.guete[h]?.[g]?.anteilFall ?? '—' }}{{ daten.guete[h]?.[g]?.anteilFall !== null && daten.guete[h]?.[g]?.anteilFall !== undefined ? ' %' : '' }}</td>
                                <td class="text-end">{{ prozent(daten.guete[h]?.[g]?.medianHoch) }}</td>
                            </tr>
                        </template>
                    </tbody>
                </table>
                <p v-if="Object.keys(daten.guete || {}).length && daten.offen" class="avGrau small">{{ t('abverkauf.gueteOffen', { n: daten.offen }) }}</p>
            </div>
        </template>
    </div>
</template>

<script setup>
/**
 * Coin-Radar → Abverkauf.
 *
 * Perpetuals, die hochgepumpt wurden: was an Treibstoff für einen Abverkauf
 * da ist, ob er zu kippen beginnt, und was dagegen spricht. Gerechnet wird auf
 * dem Server (`server/coin-radar/abverkauf*.js`); die Seite zeigt nur.
 */
import { ref, computed, watch, onBeforeUnmount, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { boerseUrl, BOERSE_KURZ, BOERSE_NAME, aktivierteBoersen } from '../../utils/boersenLinks.js'
import { currentUser } from '../../stores/globals.js'
import { logWarn } from '../../utils/logger.js'

const props = defineProps({ aktiv: { type: Boolean, default: false } })
const { t, locale } = useI18n()

const daten = ref(null)
const ladeFehler = ref('')
const meldung = ref('')
const meldungFehler = ref(false)
const gestartet = ref(false)
const laeuft = computed(() => gestartet.value || Boolean(daten.value?.stand?.laeuft))
const einst = computed(() => daten.value?.einst || { an: true, intervallMin: 10 })

let anfrage = 0
async function lade() {
    const meine = ++anfrage
    try {
        const r = await axios.get('/api/coin-radar/abverkauf')
        if (meine !== anfrage) return
        daten.value = r.data
        ladeFehler.value = ''
        if (!r.data?.stand?.laeuft && gestartet.value) {
            gestartet.value = false
            if (!meldungFehler.value) meldung.value = ''
        }
        if (!einstOffen.value) uebernimmForm()
    } catch (e) {
        if (meine !== anfrage) return
        ladeFehler.value = e.response?.data?.error || t('abverkauf.ladeFehler')
        logWarn('abverkauf', 'Abverkaufs-Wache nicht geladen', e)
    }
    plane()
}

async function pruefen() {
    meldung.value = ''
    meldungFehler.value = false
    try {
        await axios.post('/api/coin-radar/abverkauf/lauf')
        gestartet.value = true
        meldung.value = t('abverkauf.gestartet')
    } catch (e) {
        meldung.value = e.response?.data?.error || t('abverkauf.startFehler')
        meldungFehler.value = true
    }
    plane(1500)
}

let uhr = null
function plane(ms) {
    clearTimeout(uhr)
    uhr = null
    if (!props.aktiv) return
    uhr = setTimeout(lade, ms ?? (laeuft.value ? 3000 : 60000))
}
watch(() => props.aktiv, (a) => {
    if (a) lade()
    else { clearTimeout(uhr); uhr = null }
}, { immediate: true })
onBeforeUnmount(() => clearTimeout(uhr))

// ── Einstellungen ───────────────────────────────────────────────────────
const einstOffen = ref(false)
const speichert = ref(false)
const einstMeldung = ref('')
const einstFehler = ref(false)
const form = reactive({ an: true, vorwarnung: false, intervallMin: 10, minAnstieg: 20, minUmsatzMio: 10, schwelle: 45 })
function uebernimmForm() {
    const e = einst.value
    Object.assign(form, {
        an: e.an !== false, vorwarnung: e.vorwarnung === true, intervallMin: e.intervallMin,
        minAnstieg: e.minAnstieg, minUmsatzMio: Math.round((Number(e.minUmsatz) || 0) / 1e6), schwelle: e.schwelle,
    })
}
async function speichern() {
    speichert.value = true
    einstMeldung.value = ''
    einstFehler.value = false
    try {
        await axios.put('/api/coin-radar/einstellungen', { abverkauf: {
            an: form.an, vorwarnung: form.vorwarnung, intervallMin: form.intervallMin, minAnstieg: form.minAnstieg,
            minUmsatz: form.minUmsatzMio === '' ? '' : Number(form.minUmsatzMio) * 1e6, schwelle: form.schwelle,
        } })
        einstMeldung.value = t('abverkauf.e_gespeichert')
        await lade()
        uebernimmForm()
    } catch (e) {
        einstMeldung.value = e.response?.data?.error || t('abverkauf.e_fehler')
        einstFehler.value = true
    } finally {
        speichert.value = false
    }
}

// ── Darstellung ─────────────────────────────────────────────────────────
const wichtige = computed(() => (daten.value?.coins || []).filter((c) => c.phase !== 'keine'))
const uebrige = computed(() => (daten.value?.coins || []).filter((c) => c.phase === 'keine'))
const uebrigeOffen = ref(false)

const kurzSymbol = (s) => String(s || '').replace(/USDT$/, '')
const ok = (x) => typeof x === 'number' && Number.isFinite(x)
const prozent = (x) => (ok(x) ? `${x > 0 ? '+' : ''}${x} %` : '—')
const vz = (x) => (!ok(x) || x === 0 ? '' : x > 0 ? 'text-success' : 'text-danger')
const kurs = (x) => (!ok(x) ? '—' : x >= 1000 ? Math.round(x).toLocaleString('de-CH') : x.toPrecision(5))

/** Links zu den Börsen, auf denen das Perpetual handelt — plus TradingView. */
function links(c) {
    const aktiv = aktivierteBoersen(currentUser.value?.boersenLinks)
    const raus = []
    for (const b of ['bitunix', 'bitget']) {
        if (c.boersen?.[b] && aktiv.includes(b)) raus.push({ boerse: b, url: boerseUrl(b, c.symbol), kurz: BOERSE_KURZ[b], name: BOERSE_NAME[b] })
    }
    if (aktiv.includes('tradingview')) raus.push({ boerse: 'tradingview', url: boerseUrl('tradingview', c.symbol), kurz: 'TV', name: 'TradingView' })
    return raus
}

function dauer(ms) {
    const m = Number(ms) / 60e3
    if (!Number.isFinite(m) || m < 0) return '—'
    if (m < 60) return `${Math.max(1, Math.round(m))} min`
    if (m < 48 * 60) return `${Math.round(m / 60)} h`
    return `${Math.round(m / 1440)} d`
}

const zeitpunkt = (ms) => new Date(Number(ms)).toLocaleString(
    locale.value === 'en' ? 'en-GB' : 'de-CH',
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
</script>

<style scoped>
.avKopf { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
.avStand, .avGrau, .avHinweis { color: var(--grey-color, #9aa0a6); }
.avStand { font-size: .874rem; }
.avAus { color: #e0b030; }
.avHinweis { font-size: .874rem; margin: .6rem 0; }
.avEinst { display: flex; flex-wrap: wrap; gap: .6rem 1rem; align-items: flex-end; margin-top: .6rem; padding: .6rem .75rem;
    border-radius: var(--border-radius, 8px); background: var(--black-bg-2, rgba(255, 255, 255, .03)); font-size: .85rem; }
.avEinst label { display: flex; flex-direction: column; gap: .15rem; }
.avEinst input[type=number] { width: 7rem; }
.avEinst .avSchalter { flex-direction: row; align-items: center; gap: .35rem; }
.avKarten { display: flex; flex-direction: column; gap: .75rem; }
.avKarte { border: 1px solid var(--white-10, rgba(255, 255, 255, .1)); border-radius: var(--border-radius, 8px); padding: .65rem .85rem;
    background: var(--black-bg-2, rgba(255, 255, 255, .03)); }
.avKarte.kippt { border-color: rgba(239, 83, 80, .55); }
.avKarte.ueberdehnt { border-color: rgba(224, 176, 48, .45); }
.avKarteKopf { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
.avName { font-size: 1.1rem; }
.avPhase { font-size: .78rem; padding: .05rem .5rem; border-radius: 10px; font-weight: 600; }
.avPhase.kippt { background: rgba(239, 83, 80, .2); color: #ef5350; }
.avPhase.ueberdehnt { background: rgba(224, 176, 48, .18); color: #e0b030; }
.avNote { font-size: .85rem; }
.avLinks { display: flex; gap: .3rem; }
.avLink { font-size: .74rem; padding: .02rem .4rem; border-radius: 4px; background: var(--white-10, rgba(255, 255, 255, .08)); text-decoration: none; }
.avKz { display: flex; flex-wrap: wrap; gap: .3rem .9rem; font-size: .82rem; color: var(--grey-color, #9aa0a6); margin: .45rem 0; }
.avKz b { color: var(--white-87, #e8eaed); font-weight: 600; }
.avKz b.text-success { color: #4caf50; }
.avKz b.text-danger { color: #ef5350; }
.avSpalten { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: .75rem; }
.avTitel { font-size: .74rem; letter-spacing: .05em; text-transform: uppercase; color: var(--grey-color, #9aa0a6); margin-bottom: .2rem; }
.avTitelGross { font-size: .95rem; font-weight: 600; margin-bottom: .2rem; }
.avListe { list-style: none; padding: 0; margin: 0; font-size: .86rem; }
.avListe li { padding: .05rem 0; }
.avListe li.kipp { color: #ef8a80; }
.avListe li.gegen { color: #e0b030; }
.avListe li.sperrt { color: #ef5350; font-weight: 600; }
.avAbschnitt { margin-top: 1rem; }
.avTabelle { font-size: .88rem; }
</style>
