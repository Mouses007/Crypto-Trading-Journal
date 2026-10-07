<template>
    <div class="fp">
        <!-- Kopf: Stand des letzten Durchgangs und der Knopf für einen von Hand. -->
        <div class="fpKopf">
            <div class="fpStand">
                <span v-if="!einst?.fruehAktiv" class="fpAus">
                    <i class="uil uil-pause-circle me-1"></i>{{ t('hypeFrueh.taktAus') }}
                </span>
                <span v-else>{{ t('hypeFrueh.taktAn', { n: einst.fruehIntervallMin || 15 }) }}</span>
                <span v-if="stand?.letzter?.am"> · {{ t('hypeFrueh.letzter', { z: zeitpunkt(stand.letzter.am) }) }}</span>
                <span v-if="stand?.letzter && !stand.letzter.fehler">
                    · {{ t('hypeFrueh.letzterErgebnis', { b: stand.letzter.beobachtet ?? 0, n: stand.letzter.neu ?? 0, a: stand.letzter.alarme ?? 0 }) }}
                </span>
                <span v-if="stand?.letzter?.fehler" class="text-danger"> · {{ stand.letzter.fehler }}</span>
            </div>
            <div class="fpKnoepfe">
                <label class="fpSchalter">
                    <input type="checkbox" v-model="mitVerworfenen" @change="lade"> {{ t('hypeFrueh.verworfeneZeigen') }}
                </label>
                <button type="button" class="ctl-pill" :disabled="laeuft" @click="durchgang">
                    <span v-if="laeuft" class="spinner-border spinner-border-sm me-1"></span>
                    <i v-else class="uil uil-bolt-alt me-1"></i>{{ laeuft ? t('hypeFrueh.laeuft') : t('hypeFrueh.jetzt') }}
                </button>
                <PageInfo section="info.hypeFrueh" />
            </div>
        </div>

        <!-- Welche Quelle lieferte, welche fiel aus — ohne das sieht eine
             leere Liste aus wie „nichts los". -->
        <div v-if="quellen.length" class="fpQuellen">
            <span v-for="q in quellen" :key="q.name" class="fpQuelle" :class="{ aus: !q.ok }"
                :title="q.ok ? '' : q.fehler">
                <i class="uil" :class="q.ok ? 'uil-check' : 'uil-times'"></i> {{ q.name }}<template v-if="q.ok"> {{ q.anzahl }}</template>
            </span>
        </div>

        <div v-if="meldung" class="alert py-2 small mt-2" :class="meldungFehler ? 'alert-danger' : 'alert-info'">{{ meldung }}</div>

        <p class="fpHinweis">{{ t('hypeFrueh.erklaerung') }}</p>

        <div v-if="ladeFehler" class="text-danger small">{{ ladeFehler }}</div>
        <div v-else-if="zeilen === null" class="text-muted small"><span class="spinner-border spinner-border-sm"></span></div>
        <p v-else-if="!zeilen.length" class="text-muted small">{{ t('hypeFrueh.leer') }}</p>

        <!-- Telefon: Karten -->
        <div v-else-if="istTelefon" class="fpKarten">
            <div v-for="z in zeilen" :key="z.id" class="fpKarte" @click="umschalten(z.id)">
                <div class="fpKarteZeile">
                    <strong>{{ z.symbol || kurz(z.contract) }}</strong>
                    <span class="fpKette">{{ z.chain }}</span>
                    <span class="ms-auto fpNote" :class="notenKlasse(z.note)">{{ z.note }}</span>
                    <i class="uil fpTrend" :class="trendIcon(z.stand?.trend)"></i>
                </div>
                <div class="fpKarteZeile fpGrau">
                    <span>{{ geld(z.stand?.mcap) }} MC</span>
                    <span>{{ geld(z.stand?.liq) }} Liq</span>
                    <span>{{ alter(z.stand?.alterStunden) }}</span>
                    <span v-if="z.projektNote !== null && z.projektNote !== undefined">{{ t('hypeFrueh.substanzKurz') }} {{ z.projektNote }}</span>
                    <span class="badge hypBadge ms-auto" :class="statusKlasse(z.status)">{{ statusText(z) }}</span>
                </div>
                <div v-if="offen === z.id" class="fpDetailKarte" @click.stop>
                    <FruehDetail :z="z" />
                </div>
            </div>
        </div>

        <!-- Desktop: Tabelle -->
        <div v-else class="table-responsive">
            <table class="table table-sm align-middle fpTabelle">
                <thead>
                    <tr>
                        <th>{{ t('hypeFrueh.spalteToken') }}</th>
                        <th class="text-end">{{ t('hypeFrueh.spalteNote') }}</th>
                        <th>{{ t('hypeFrueh.spalteVerlauf') }}</th>
                        <th class="text-end">{{ t('hypeFrueh.spalteSubstanz') }}</th>
                        <th class="text-end">{{ t('hypeFrueh.spalteMcap') }}</th>
                        <th class="text-end">{{ t('hypeFrueh.spalteLiq') }}</th>
                        <th class="text-end">{{ t('hypeFrueh.spalteAlter') }}</th>
                        <th class="text-end">{{ t('hypeFrueh.spalteKaeufer') }}</th>
                        <th class="text-end">{{ t('hypeFrueh.spalteSozial') }}</th>
                        <th>{{ t('hypeFrueh.spalteStatus') }}</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    <template v-for="z in zeilen" :key="z.id">
                        <tr class="fpZeile" @click="umschalten(z.id)">
                            <td>
                                <strong>{{ z.symbol || kurz(z.contract) }}</strong>
                                <span class="fpKette">{{ z.chain }}</span>
                                <span v-if="z.stand?.graduiert === false && istPump(z)" class="fpKurve" :title="t('hypeFrueh.kurveTitel')">
                                    <i class="uil uil-chart-growth"></i></span>
                            </td>
                            <td class="text-end">
                                <span class="fpNote" :class="notenKlasse(z.note)">{{ z.note }}</span>
                                <i class="uil fpTrend" :class="trendIcon(z.stand?.trend)" :title="t('hypeFrueh.trend_' + (z.stand?.trend || 'neu'))"></i>
                            </td>
                            <td><svg v-if="linie(z)" class="fpLinie" viewBox="0 0 60 18" preserveAspectRatio="none"><polyline :points="linie(z)" /></svg></td>
                            <td class="text-end">
                                <span v-if="z.projektNote !== null && z.projektNote !== undefined" :class="notenKlasse(z.projektNote)">{{ z.projektNote }}</span>
                                <span v-else class="fpGrau">—</span>
                            </td>
                            <td class="text-end">{{ geld(z.stand?.mcap) }}</td>
                            <td class="text-end">{{ geld(z.stand?.liq) }}</td>
                            <td class="text-end">{{ alter(z.stand?.alterStunden) }}</td>
                            <td class="text-end">{{ kaeuferText(z.stand) }}</td>
                            <td class="text-end" :title="sozialTitel(z)">{{ sozialText(z) }}</td>
                            <td><span class="badge hypBadge" :class="statusKlasse(z.status)" :title="z.grund || ''">{{ statusText(z) }}</span></td>
                            <td class="text-end"><i class="uil" :class="offen === z.id ? 'uil-angle-up' : 'uil-angle-down'"></i></td>
                        </tr>
                        <tr v-if="offen === z.id" :key="z.id + '-d'">
                            <td colspan="11" class="fpDetail"><FruehDetail :z="z" /></td>
                        </tr>
                    </template>
                </tbody>
            </table>
        </div>
    </div>
</template>

<script setup>
/**
 * Hype-Radar → Frühphase.
 *
 * Die Token, die die Frühphasen-Spur gerade beobachtet: jünger als zwölf
 * Stunden oder unter 50 000 USD Liquidität — also alles, was die Hauptprüfung
 * noch nicht sieht. Die Note misst BESCHLEUNIGUNG (Handel, Käufer, Nennungen
 * gegen den eigenen Verlauf), nicht Grösse; daneben steht die Substanz-Note
 * der Projektprüfung.
 *
 * Die Daten holt die Seite selbst, sobald sie sichtbar ist, und während eines
 * Durchgangs alle drei Sekunden — danach alle zwei Minuten, solange offen.
 */
import { ref, computed, watch, onBeforeUnmount, h, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import PageInfo from '../PageInfo.vue'
import ProjektPruefung from './ProjektPruefung.vue'
import { useIstTelefon } from '../../utils/geraet.js'
import { sichereUrl } from '../../utils/sanitize.js'
import { logWarn } from '../../utils/logger.js'

const props = defineProps({
    /** Ist die Ansicht gerade sichtbar? Nur dann wird geladen und getaktet. */
    aktiv: { type: Boolean, default: false },
    /** Die Hype-Radar-Einstellungen (nur gelesen: Takt an/aus, Intervall). */
    einst: { type: Object, default: null },
})

const { t, locale } = useI18n()
const istTelefon = useIstTelefon()

const zeilen = ref(null)
const stand = ref(null)
const offen = ref(null)
const mitVerworfenen = ref(false)
const ladeFehler = ref('')
const meldung = ref('')
const meldungFehler = ref(false)
const gestartet = ref(false)

const laeuft = computed(() => gestartet.value || Boolean(stand.value?.laeuft))

const quellen = computed(() => Object.entries(stand.value?.letzter?.quellenStand || {})
    .map(([name, q]) => ({ name, ok: q.ok, anzahl: (q.anzahl || 0) + (q.kuerzel || 0), fehler: q.fehler || '' })))

let anfrage = 0
async function lade() {
    const meine = ++anfrage
    try {
        const r = await axios.get('/api/hype-radar/frueh', { params: { alle: mitVerworfenen.value ? '1' : undefined } })
        if (meine !== anfrage) return
        zeilen.value = r.data?.zeilen || []
        stand.value = r.data?.stand || null
        ladeFehler.value = ''
        if (!stand.value?.laeuft) gestartet.value = false
    } catch (e) {
        if (meine !== anfrage) return
        ladeFehler.value = e.response?.data?.error || t('hypeFrueh.ladeFehler')
        logWarn('hype-frueh', 'Frühphase konnte nicht geladen werden', e)
    }
    plane()
}

async function durchgang() {
    meldung.value = ''
    try {
        await axios.post('/api/hype-radar/frueh/lauf')
        gestartet.value = true
        meldung.value = t('hypeFrueh.gestartet')
        meldungFehler.value = false
    } catch (e) {
        meldung.value = e.response?.data?.error || t('hypeFrueh.startFehler')
        meldungFehler.value = true
    }
    plane(1000)
}

// ── Takt: schnell während eines Durchgangs, langsam sonst ───────────────
let uhr = null
function plane(ms) {
    clearTimeout(uhr)
    uhr = null
    if (!props.aktiv) return
    uhr = setTimeout(lade, ms ?? (laeuft.value ? 3000 : 120000))
}
watch(() => props.aktiv, (a) => {
    if (a) lade()
    else { clearTimeout(uhr); uhr = null }
}, { immediate: true })
// Fertig geworden: die Meldung „gestartet" hat sich erledigt.
watch(laeuft, (jetzt, vorher) => { if (vorher && !jetzt && !meldungFehler.value) meldung.value = '' })
onBeforeUnmount(() => clearTimeout(uhr))

function umschalten(id) {
    offen.value = offen.value === id ? null : id
}

// ── Darstellung ─────────────────────────────────────────────────────────
const hatZahl = (w) => w !== null && w !== undefined && w !== '' && Number.isFinite(Number(w))

function geld(n) {
    if (!hatZahl(n)) return '—'
    const z = Number(n)
    if (z >= 1e6) return `${(z / 1e6).toFixed(1)} M`
    if (z >= 1e3) return `${Math.round(z / 1e3)} k`
    return String(Math.round(z))
}

function alter(stunden) {
    if (!hatZahl(stunden)) return '—'
    const s = Number(stunden)
    if (s < 1) return `${Math.max(1, Math.round(s * 60))} min`
    if (s < 48) return `${Math.round(s)} h`
    return `${Math.round(s / 24)} d`
}

const zeitpunkt = (ms) => new Date(Number(ms)).toLocaleString(
    locale.value === 'en' ? 'en-GB' : 'de-CH',
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const kurz = (a) => (String(a || '').length > 12 ? `${String(a).slice(0, 4)}…${String(a).slice(-4)}` : String(a || ''))

const istPump = (z) => z.chain === 'solana' && /pump$/i.test(String(z.contract || ''))

function notenKlasse(n) {
    if (!hatZahl(n)) return ''
    if (n >= 65) return 'gut'
    if (n >= 40) return 'mittel'
    return 'schwach'
}

const trendIcon = (tr) => ({ steigt: 'uil-arrow-up-right steigt', faellt: 'uil-arrow-down-right faellt', gleich: 'uil-arrow-right' }[tr] || 'uil-star')

function statusKlasse(s) {
    if (s === 'reif') return 'bg-success'
    if (s === 'verworfen') return 'bg-danger'
    return 'bg-secondary'
}

function statusText(z) {
    if (z.status === 'verworfen' && z.grund) return t('hypeFrueh.grund_' + z.grund)
    return t('hypeFrueh.status_' + (z.status || 'beobachtet'))
}

/** Verschiedene Käufer gegen verschiedene Verkäufer — oder, wenn das fehlt, die Transaktionen. */
function kaeuferText(s) {
    if (!s) return '—'
    if (hatZahl(s.kaeufer1h)) return `${s.kaeufer1h} / ${hatZahl(s.verkaeufer1h) ? s.verkaeufer1h : '—'}`
    if (hatZahl(s.tx1h)) return t('hypeFrueh.txKurz', { n: s.tx1h })
    return '—'
}

const SOZIAL = ['telegram', 'biz', 'reddit']
const sozialVon = (z) => SOZIAL.filter((p) => (z.quellen || []).includes(p))
const sozialText = (z) => (sozialVon(z).length ? `${sozialVon(z).length}× · ${z.stand?.erw ?? 0}` : '—')
const sozialTitel = (z) => (sozialVon(z).length ? t('hypeFrueh.sozialTitel', { p: sozialVon(z).join(', '), n: z.stand?.erw ?? 0 }) : '')

/** Kleiner Notenverlauf als Polylinie — die Beschleunigung auf einen Blick. */
function linie(z) {
    const v = (z.verlauf || []).filter((x) => hatZahl(x.note))
    if (v.length < 2) return ''
    const n = v.length
    return v.map((x, i) => `${((i / (n - 1)) * 60).toFixed(1)},${(17 - (Number(x.note) / 100) * 16).toFixed(1)}`).join(' ')
}

// ── Detail: Teilnoten, Befunde, Links, Projektprüfung ───────────────────
const TEILNOTEN = ['handel', 'beteiligung', 'sozial', 'team', 'momentum']

const FruehDetail = defineComponent({
    props: { z: { type: Object, required: true } },
    setup(p) {
        // Eine Prüfung von Hand gilt, bis der nächste Abruf eine neuere bringt.
        const eigene = ref(null)
        return () => {
            const z = p.z
            const teil = z.stand?.teilnoten || {}
            const links = []
            for (const w of (z.links?.webseiten || [])) {
                const u = sichereUrl(w)
                if (u && /^https?:/i.test(u)) links.push(h('a', { href: u, target: '_blank', rel: 'noopener noreferrer nofollow', class: 'me-2' }, `${hostVon(u)} ↗`))
            }
            for (const k of (z.links?.kanaele || [])) {
                const u = sichereUrl(k.url)
                if (u && /^https?:/i.test(u)) links.push(h('a', { href: u, target: '_blank', rel: 'noopener noreferrer nofollow', class: 'me-2' }, `${k.typ || hostVon(u)} ↗`))
            }
            const markt = [
                h('a', { href: `https://dexscreener.com/${encodeURIComponent(z.chain)}/${encodeURIComponent(z.contract)}`, target: '_blank', rel: 'noopener noreferrer', class: 'me-2' }, 'DexScreener ↗'),
            ]
            if (istPump(z)) markt.push(h('a', { href: `https://pump.fun/coin/${encodeURIComponent(z.contract)}`, target: '_blank', rel: 'noopener noreferrer', class: 'me-2' }, 'pump.fun ↗'))

            return h('div', { class: 'fpDetailGrid' }, [
                h('div', [
                    h('div', { class: 'fpDetailTitel' }, t('hypeFrueh.teilnoten')),
                    ...TEILNOTEN.map((f) => h('div', { class: 'fpTeil' }, [
                        h('span', { class: 'fpTeilName' }, t('hypeFrueh.teil_' + f)),
                        h('span', { class: 'fpBalken' }, [h('i', { style: { width: `${Math.round(Number(teil[f]) || 0)}%` } })]),
                        h('span', { class: 'fpTeilWert' }, hatZahl(teil[f]) ? String(Math.round(teil[f])) : '—'),
                    ])),
                    h('div', { class: 'fpGrau mt-1' }, `${t('hypeFrueh.quellen')}: ${(z.quellen || []).join(', ') || '—'}`),
                    h('div', { class: 'fpGrau' }, t('hypeFrueh.beobachtetSeit', { z: zeitpunkt(z.ersterBlick) })),
                    h('div', { class: 'mt-2' }, [...markt, ...links]),
                    h('div', { class: 'fpGrau fpVertrag', title: z.contract }, z.contract),
                ]),
                h('div', [
                    h('div', { class: 'fpDetailTitel' }, t('hypeFrueh.befunde')),
                    (z.befunde || []).length
                        ? h('ul', { class: 'fpBefunde' }, z.befunde.map((b, i) => h('li', { key: i, class: b.art }, b.text)))
                        : h('p', { class: 'fpGrau' }, t('hypeFrueh.keineBefunde')),
                ]),
                h('div', [
                    h(ProjektPruefung, {
                        projekt: (eigene.value?.geprueftAm || 0) >= (z.projekt?.geprueftAm || 0) && eigene.value ? eigene.value : z.projekt,
                        kandidat: { symbol: z.symbol, name: z.name, chain: z.chain, contract: z.contract },
                        onGeprueft: (e) => { eigene.value = e },
                    }),
                ]),
            ])
        }
    },
})

function hostVon(url) {
    try { return new URL(url).hostname.replace(/^www\./, '') } catch { return String(url || '').slice(0, 30) }
}
</script>

<style scoped>
.fpKopf {
    display: flex;
    align-items: center;
    gap: .75rem;
    flex-wrap: wrap;
}
.fpStand {
    font-size: .874rem;
    color: var(--grey-color, #9aa0a6);
}
.fpAus {
    color: #e0b030;
}
.fpKnoepfe {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: .5rem;
}
.fpSchalter {
    font-size: .851rem;
    color: var(--grey-color, #9aa0a6);
    display: flex;
    align-items: center;
    gap: .3rem;
    cursor: pointer;
}
.fpQuellen {
    display: flex;
    flex-wrap: wrap;
    gap: .35rem;
    margin-top: .5rem;
}
.fpQuelle {
    font-size: .782rem;
    padding: .05rem .45rem;
    border-radius: 10px;
    background: var(--white-10, rgba(255, 255, 255, .08));
}
.fpQuelle.aus {
    color: var(--red-color, #e05252);
}
.fpHinweis {
    font-size: .874rem;
    color: var(--grey-color, #9aa0a6);
    margin: .6rem 0;
}
.fpTabelle {
    font-size: .92rem;
}
.fpZeile {
    cursor: pointer;
}
.fpZeile:hover {
    background: rgba(255, 255, 255, .03);
}
.fpKette, .fpGrau {
    color: var(--grey-color, #9aa0a6);
}
.fpKette {
    font-size: .782rem;
    margin-left: .4rem;
}
.fpKurve {
    margin-left: .3rem;
    color: #e0b030;
}
.fpNote {
    font-weight: 600;
}
.gut { color: #4caf50; }
.mittel { color: #e0b030; }
.schwach { color: var(--grey-color, #9aa0a6); }
.fpTrend {
    margin-left: .25rem;
    color: var(--grey-color, #9aa0a6);
}
.fpTrend.steigt { color: #4caf50; }
.fpTrend.faellt { color: var(--red-color, #e05252); }
.fpLinie {
    width: 60px;
    height: 18px;
    display: block;
}
.fpLinie polyline {
    fill: none;
    stroke: var(--blue-color, #4da3ff);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
}
.fpDetail {
    background: rgba(255, 255, 255, .02);
}
.fpKarten {
    display: flex;
    flex-direction: column;
    gap: .5rem;
}
.fpKarte {
    background: var(--black-bg-2, rgba(255, 255, 255, .03));
    border-radius: var(--border-radius, 8px);
    padding: .55rem .7rem;
}
.fpKarteZeile {
    display: flex;
    align-items: center;
    gap: .5rem;
    flex-wrap: wrap;
    font-size: .874rem;
}
.fpDetailKarte {
    font-size: .874rem;
    margin-top: .5rem;
    border-top: 1px solid var(--white-10, rgba(255, 255, 255, .1));
    padding-top: .5rem;
}
.hypBadge {
    font-size: .713rem;
    font-weight: 500;
}
.fpDetail :deep(.fpDetailGrid), .fpDetailKarte :deep(.fpDetailGrid) {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1.25rem;
    padding: .35rem .25rem;
}
:deep(.fpDetailTitel) {
    font-size: .851rem;
    font-weight: 600;
    margin-bottom: .35rem;
}
:deep(.fpTeil) {
    display: flex;
    align-items: center;
    gap: .5rem;
    font-size: .851rem;
    margin-bottom: .15rem;
}
:deep(.fpTeilName) {
    width: 6.5rem;
}
:deep(.fpTeilWert) {
    width: 2rem;
    text-align: right;
}
:deep(.fpBalken) {
    flex: 1;
    height: 5px;
    background: rgba(255, 255, 255, .07);
    border-radius: 3px;
    overflow: hidden;
}
:deep(.fpBalken i) {
    display: block;
    height: 100%;
    background: var(--blue-color, #4da3ff);
}
:deep(.fpBefunde) {
    font-size: .874rem;
    padding-left: 1.1rem;
    margin-bottom: .25rem;
}
:deep(.fpBefunde li.plus)::marker { color: #4caf50; }
:deep(.fpBefunde li.minus)::marker { color: var(--red-color, #e05252); }
:deep(.fpGrau) {
    color: var(--grey-color, #9aa0a6);
    font-size: .851rem;
}
:deep(.fpVertrag) {
    font-family: monospace;
    font-size: .75rem;
    overflow-wrap: anywhere;
}
:deep(a) {
    text-decoration: none;
}
</style>
