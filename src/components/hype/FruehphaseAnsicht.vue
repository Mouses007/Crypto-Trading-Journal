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
                <button type="button" class="ctl-pill" :disabled="laeuft" @click="durchgang">
                    <span v-if="laeuft" class="spinner-border spinner-border-sm me-1"></span>
                    <i v-else class="uil uil-bolt-alt me-1"></i>{{ laeuft ? t('hypeFrueh.laeuft') : t('hypeFrueh.jetzt') }}
                </button>
            </div>
        </div>

        <!-- Welche Quelle lieferte, welche fiel aus — ohne das sieht eine
             leere Liste aus wie „nichts los". -->
        <div v-if="quellen.length" class="fpQuellen">
            <span v-for="q in quellen" :key="q.name" class="fpQuelle" :class="{ aus: !q.ok, teils: q.ok && q.fehler }"
                :title="q.fehler">
                <i class="uil" :class="q.ok ? 'uil-check' : 'uil-times'"></i> {{ q.text }}
            </span>
        </div>

        <div v-if="meldung" class="alert py-2 small mt-2" :class="meldungFehler ? 'alert-danger' : 'alert-info'">{{ meldung }}</div>

        <p class="fpHinweis">{{ t('hypeFrueh.erklaerung') }}</p>

        <div v-if="ladeFehler" class="text-danger small">{{ ladeFehler }}</div>
        <div v-else-if="daten === null" class="text-muted small"><span class="spinner-border spinner-border-sm"></span></div>
        <template v-else>
            <!-- ── Kandidaten: nur, was alle Bedingungen erfüllt ─────────────── -->
            <section class="fpBlock">
                <div class="fpBlockKopf">
                    <span class="fpBlockTitel"><i class="uil uil-bullseye me-1"></i>{{ t('hypeFrueh.kandidatenTitel') }}</span>
                    <span class="fpZahl">{{ daten.kandidaten.length }}</span>
                    <span class="fpGrau small">{{ t('hypeFrueh.kandidatenRegel', { n: daten.schwelle }) }}</span>
                </div>
                <p v-if="!daten.kandidaten.length" class="fpGrau small mb-1">{{ t('hypeFrueh.kandidatenLeer') }}</p>
                <div v-else class="fpKandidaten">
                    <FruehKarte v-for="z in daten.kandidaten" :key="'k' + z.id" :z="z" @stern="sternUmschalten" />
                </div>
                <!-- Warum die Liste so kurz ist: die erste Bedingung, an der jeder Token scheitert. -->
                <p v-if="trichterText" class="fpGrau small mt-2 mb-0">{{ trichterText }}</p>
            </section>

            <!-- ── Beobachtungsliste: die Favoriten mit Stern ──────────────── -->
            <section class="fpBlock">
                <div class="fpBlockKopf">
                    <span class="fpBlockTitel"><i class="uil uil-star me-1"></i>{{ t('hypeFrueh.beobachtungTitel') }}</span>
                    <span class="fpZahl">{{ daten.beobachtung.length }}</span>
                </div>
                <p v-if="!daten.beobachtung.length" class="fpGrau small mb-0">{{ t('hypeFrueh.beobachtungLeer') }}</p>
                <div v-else class="fpKandidaten">
                    <template v-for="b in daten.beobachtung" :key="'f' + b.favorit.id">
                        <FruehKarte v-if="b.zeile" :z="b.zeile" @stern="sternUmschalten" />
                        <FavoritKarte v-else :f="b.favorit" @stern="favoritEntfernen" />
                    </template>
                </div>
            </section>

            <!-- ── Alle beobachteten: die Rohliste, nur auf Klick ──────────── -->
            <section class="fpBlock">
                <div class="fpBlockKopf">
                    <button type="button" class="ctl-pill" @click="rohUmschalten">
                        <i class="uil me-1" :class="rohOffen ? 'uil-angle-up' : 'uil-list-ul'"></i>
                        {{ rohOffen ? t('hypeFrueh.alleVerbergen') : t('hypeFrueh.alleZeigen', { n: daten.beobachtet }) }}
                    </button>
                    <label v-if="rohOffen" class="fpSchalter ms-auto">
                        <input type="checkbox" v-model="mitVerworfenen" @change="lade"> {{ t('hypeFrueh.verworfeneZeigen') }}
                    </label>
                </div>
                <template v-if="rohOffen">
                    <p class="fpGrau small mt-2">{{ t('hypeFrueh.alleHinweis') }}</p>
                    <div v-if="zeilen === null" class="text-muted small"><span class="spinner-border spinner-border-sm"></span></div>
                    <p v-else-if="!zeilen.length" class="text-muted small">{{ t('hypeFrueh.leer') }}</p>

                    <!-- Telefon: Karten -->
                    <div v-else-if="istTelefon" class="fpListe">
                        <div v-for="z in zeilen" :key="z.id" class="fpKarte" :class="{ fpDuenn: z.duenn }" :title="z.duenn ? t('hypeFrueh.duennTitel') : null" @click="umschalten(z.id)">
                            <div class="fpKarteZeile">
                                <SternKnopf :z="z" @stern="sternUmschalten" />
                                <strong>{{ z.symbol || kurz(z.contract) }}</strong>
                                <span class="fpKette">{{ z.chain }}</span>
                                <FruehSignale :z="z" />
                                <span class="ms-auto fpNote" :class="notenKlasse(z.note)">{{ z.note }}</span>
                                <i class="uil fpTrend" :class="trendIcon(z.stand?.trend)"></i>
                            </div>
                            <div class="fpKarteZeile fpGrau">
                                <span>{{ geld(z.stand?.mcap) }} MC</span>
                                <span v-if="halterVon(z) !== null">{{ halterVon(z) }} {{ t('hypeFrueh.halterKurz') }}</span>
                                <span>{{ alter(z.stand?.alterStunden) }}</span>
                                <span v-if="z.projektNote !== null && z.projektNote !== undefined">{{ t('hypeFrueh.substanzKurz') }} {{ z.projektNote }}</span>
                                <span class="badge hypBadge ms-auto" :class="statusKlasse(z.status, z.kandidat?.ja)" :title="warumNicht(z)">{{ statusText(z) }}</span>
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
                                    <th class="text-end" :title="t('hypeFrueh.spalteHalterTitel')">{{ t('hypeFrueh.spalteHalter') }}</th>
                                    <th class="text-end">{{ t('hypeFrueh.spalteAlter') }}</th>
                                    <th class="text-end" :title="t('hypeFrueh.spalteHandelTitel')">{{ t('hypeFrueh.spalteHandel') }}</th>
                                    <th class="text-end">{{ t('hypeFrueh.spalteSozial') }}</th>
                                    <th>{{ t('hypeFrueh.spalteStatus') }}</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                <template v-for="z in zeilen" :key="z.id">
                                    <tr class="fpZeile" :class="{ fpDuenn: z.duenn }" :title="z.duenn ? t('hypeFrueh.duennTitel') : null" @click="umschalten(z.id)">
                                        <td>
                                            <SternKnopf :z="z" @stern="sternUmschalten" />
                                            <strong>{{ z.symbol || kurz(z.contract) }}</strong>
                                            <span class="fpKette">{{ z.chain }}</span>
                                            <span v-if="z.stand?.aufKurve" class="fpKurve" :title="t('hypeFrueh.kurveTitel')">
                                                <i class="uil uil-chart-growth"></i></span>
                                            <FruehSignale :z="z" />
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
                                        <td class="text-end">{{ halterVon(z) ?? '—' }}</td>
                                        <td class="text-end">{{ alter(z.stand?.alterStunden) }}</td>
                                        <td class="text-end">{{ kaeuferText(z.stand) }}</td>
                                        <td class="text-end" :title="sozialTitel(z)">{{ sozialText(z) }}</td>
                                        <td><span class="badge hypBadge" :class="statusKlasse(z.status, z.kandidat?.ja)" :title="warumNicht(z)">{{ statusText(z) }}</span></td>
                                        <td class="text-end"><i class="uil" :class="offen === z.id ? 'uil-angle-up' : 'uil-angle-down'"></i></td>
                                    </tr>
                                    <tr v-if="offen === z.id" :key="z.id + '-d'">
                                        <td colspan="11" class="fpDetail"><FruehDetail :z="z" /></td>
                                    </tr>
                                </template>
                            </tbody>
                        </table>
                    </div>
                </template>
            </section>
        </template>

        <!-- Erfolgskontrolle: findet die Note unter gleich gut geprüften Token
             die besseren? Jeder Spitzen-Token gegen einen Partner aus demselben
             Durchgang (meldefähig, unter der Note, gleicher Zustand, ähnliches
             Alter); das Feld ist die Grundrate. Jeder Anteil mit Nenner. -->
        <div class="fpGuete">
            <div class="fpDetailTitel">{{ t('hypeFrueh.gueteTitel') }}</div>
            <p class="fpGrau small mb-1">{{ t('hypeFrueh.gueteHinweis') }}</p>
            <!-- Ohne eine einzige Messung keine leere Tabelle, sondern ein Satz. -->
            <p v-if="!gueteGemessen" class="fpGrau small mb-0">
                <!-- Das Leerzeichen in der Interpolation: am Anfang eines <template> verschluckt Vue es. -->
                {{ t('hypeFrueh.gueteLeer') }}{{ gueteOffen ? ` ${t('hypeFrueh.gueteOffen', { n: gueteOffen })}.` : '' }}
            </p>
            <div v-else class="table-responsive">
                <table class="table table-sm fpTabelle mb-1">
                    <thead>
                        <tr>
                            <th></th><th>{{ t('hypeFrueh.gueteGruppe') }}</th><th class="text-end">n</th>
                            <th class="text-end">{{ t('hypeFrueh.gueteVerdoppelt') }}</th>
                            <th class="text-end">{{ t('hypeFrueh.gueteLebt') }}</th>
                            <th class="text-end">{{ t('hypeFrueh.gueteKurve') }}</th>
                            <th class="text-end">{{ t('hypeFrueh.gueteRendite') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <template v-for="hz in guete.jeHorizont" :key="hz.horizont">
                            <tr v-for="(g, i) in ['spitze', 'kontrolle', 'feld']" :key="hz.horizont + g">
                                <td><strong v-if="!i">{{ hz.horizont }}</strong></td>
                                <td>{{ t('hypeFrueh.gueteGruppe_' + g) }}</td>
                                <td class="text-end">{{ hz[g]?.n ?? 0 }}</td>
                                <td class="text-end">{{ anteilKn(hz[g]?.verdoppelt) }}</td>
                                <td class="text-end">{{ anteilKn(hz[g]?.lebt) }}</td>
                                <td class="text-end">{{ anteilKn(hz[g]?.kurve) }}</td>
                                <td class="text-end">{{ prozent(hz[g]?.medianRendite) }}<span v-if="hz[g]?.nRendite" class="fpGrau"> ({{ hz[g].nRendite }})</span></td>
                            </tr>
                            <tr>
                                <td></td>
                                <td colspan="6" class="fpGrau small">
                                    <span v-for="(z, j) in urteilZeilen(hz)" :key="j">{{ j ? ' · ' : '' }}{{ z }}</span>
                                    · {{ t('hypeFrueh.guetePaare', { n: hz.paare || 0 }) }}
                                    · {{ t('hypeFrueh.gueteOffen', { n: hz.offen }) }}{{ hz.altbestand ? ` · ${t('hypeFrueh.gueteAltbestand', { n: hz.altbestand })}` : '' }}
                                </td>
                            </tr>
                        </template>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>

<script setup>
/**
 * Hype-Radar → Frühphase.
 *
 * Drei Teile, vom Wichtigsten zum Rohen:
 *
 * - **Kandidaten**: nur, was alle Bedingungen erfüllt (Vertrag und Projekt
 *   geprüft, belastbare Note, laufender Handel, Note ab der eingestellten
 *   Schwelle, im letzten Durchgang gemessen) — ausführlich, mit Verlauf.
 *   Darunter ein Satz, woran die übrigen scheitern: eine leere Liste ist sonst
 *   nicht von einer kaputten zu unterscheiden.
 * - **Beobachtungsliste**: die Favoriten (Stern). Der Stern legt einen
 *   gewöhnlichen Hype-Radar-Favoriten an; der Wachhund beobachtet ihn mit
 *   seinen Regeln weiter, auch wenn die Frühphase ihn fallen lässt.
 * - **Alle beobachteten**: die Rohliste, nur auf Klick.
 *
 * Bis 10.10.2026 zeigte die Seite nur die Rohliste — 141 Token, von denen
 * ein strenger Filter vier übrig liess.
 *
 * Die Daten holt die Seite selbst, sobald sie sichtbar ist, und während eines
 * Durchgangs alle drei Sekunden — danach alle zwei Minuten, solange offen.
 */
import { ref, computed, watch, onBeforeUnmount, h, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import ProjektPruefung from './ProjektPruefung.vue'
import { useIstTelefon } from '../../utils/geraet.js'
import { logWarn } from '../../utils/logger.js'

const props = defineProps({
    /** Ist die Ansicht gerade sichtbar? Nur dann wird geladen und getaktet. */
    aktiv: { type: Boolean, default: false },
    /** Die Hype-Radar-Einstellungen (nur gelesen: Takt an/aus, Intervall). */
    einst: { type: Object, default: null },
})
/** `favoriten`: ein Stern wurde gesetzt oder entfernt — die Übersicht lädt ihre Liste neu. */
const emit = defineEmits(['favoriten'])

const { t, te, locale } = useI18n()
const istTelefon = useIstTelefon()

const daten = ref(null)
const stand = ref(null)
const offen = ref(null)
const rohOffen = ref(false)
const mitVerworfenen = ref(false)
const ladeFehler = ref('')
const meldung = ref('')
const meldungFehler = ref(false)
const gestartet = ref(false)

const laeuft = computed(() => gestartet.value || Boolean(stand.value?.laeuft))
const zeilen = computed(() => (rohOffen.value ? (daten.value?.zeilen ?? null) : null))

/*
 * X (Grok) läuft seltener als die Durchgänge und kostet — sein Chip kommt
 * deshalb aus der letzten X-Abfrage, nicht aus dem letzten Durchgang, und
 * nennt Zeit und Preis.
 */
const quellen = computed(() => {
    const liste = Object.entries(stand.value?.letzter?.quellenStand || {})
        .filter(([name]) => name !== 'x')
        .map(([name, q]) => {
            // `te` vor `t`: ein fehlender Schlüssel käme sonst als Schlüssel zurück.
            const titel = te('hypeFrueh.quelleName_' + name) ? t('hypeFrueh.quelleName_' + name) : name
            // „30/140": bei den Käufern sagt erst der Nenner, ob alle gemessen wurden.
            const zahl = q.von ? `${q.anzahl || 0}/${q.von}` : `${(q.anzahl || 0) + (q.kuerzel || 0)}`
            return { name, ok: q.ok, fehler: q.fehler || '', text: q.ok ? `${titel} ${zahl}` : titel }
        })
    const x = stand.value?.x
    if (x) {
        liste.push({
            name: 'x', ok: x.ok, fehler: x.fehler || '',
            text: x.ok
                ? t('hypeFrueh.xChip', { n: x.token ?? 0, k: Number(x.kostenUsd || 0).toFixed(3), z: zeitpunkt(x.am) })
                : 'X (Grok)',
        })
    }
    return liste
})

/*
 * Der Trichter: je Token die ERSTE Bedingung, die fehlt — in der Reihenfolge,
 * in der `kandidatStatus` prüft. Die Summe ist die Zahl der beobachteten.
 */
const TRICHTER_REIHE = ['veraltet', 'verworfen', 'note', 'ungeprueft', 'duenn', 'projekt', 'handel']
const trichterText = computed(() => {
    const tr = daten.value?.trichter || {}
    const teile = TRICHTER_REIHE.filter((g) => tr[g]).map((g) => t('hypeFrueh.trichter_' + g, { n: tr[g], s: daten.value.schwelle }))
    if (!teile.length) return ''
    return t('hypeFrueh.trichterSatz', { n: daten.value.beobachtet, teile: teile.join(', ') })
})

let anfrage = 0
async function lade() {
    const meine = ++anfrage
    try {
        const r = await axios.get('/api/hype-radar/frueh', {
            params: { roh: rohOffen.value ? '1' : undefined, alle: rohOffen.value && mitVerworfenen.value ? '1' : undefined },
        })
        if (meine !== anfrage) return
        daten.value = {
            kandidaten: r.data?.kandidaten || [],
            beobachtung: r.data?.beobachtung || [],
            zeilen: r.data?.zeilen || [],
            trichter: r.data?.trichter || {},
            beobachtet: r.data?.beobachtet ?? 0,
            schwelle: r.data?.schwelle ?? 50,
        }
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

function rohUmschalten() {
    rohOffen.value = !rohOffen.value
    if (!rohOffen.value) offen.value = null
    lade()
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

// ── Stern: ein gewöhnlicher Hype-Radar-Favorit ──────────────────────────
async function sternUmschalten(z) {
    try {
        if (z.favoritId) {
            await axios.delete(`/api/hype-radar/favoriten/${z.favoritId}`)
        } else {
            await axios.post('/api/hype-radar/favoriten', {
                symbol: z.symbol || kurz(z.contract), name: z.name || '', chain: z.chain, contractAddress: z.contract,
            })
        }
        emit('favoriten')
        await lade()
    } catch (e) {
        meldung.value = t('hypeFrueh.sternFehler')
        meldungFehler.value = true
        logWarn('hype-frueh', 'Stern konnte nicht umgeschaltet werden', e)
    }
}

async function favoritEntfernen(f) {
    try {
        await axios.delete(`/api/hype-radar/favoriten/${f.id}`)
        emit('favoriten')
        await lade()
    } catch (e) {
        meldung.value = t('hypeFrueh.sternFehler')
        meldungFehler.value = true
        logWarn('hype-frueh', 'Favorit konnte nicht entfernt werden', e)
    }
}

// ── Takt: schnell während eines Durchgangs, langsam sonst ───────────────
let uhr = null
function plane(ms) {
    clearTimeout(uhr)
    uhr = null
    if (!props.aktiv) return
    uhr = setTimeout(lade, ms ?? (laeuft.value ? 3000 : 120000))
}
const guete = ref(null)
async function ladeGuete() {
    try {
        guete.value = (await axios.get('/api/hype-radar/frueh/guete')).data
    } catch (e) {
        logWarn('hype-frueh', 'Erfolgskontrolle konnte nicht geladen werden', e)
    }
}
const gueteGemessen = computed(() => (guete.value?.jeHorizont || []).some((h) => h.anzahl > 0))
const gueteOffen = computed(() => (guete.value?.jeHorizont || []).reduce((a, h) => a + (h.offen || 0), 0))
const prozent = (w) => (w === null || w === undefined ? '—' : `${w > 0 ? '+' : ''}${Math.round(w)} %`)
/** Anteil mit Zähler und Nenner — „30 %" ohne „von wie vielen" ist bei zehn Token eine Behauptung. */
const anteilKn = (a) => (!a || !a.n ? '—' : `${Math.round((a.k / a.n) * 100)} % (${a.k}/${a.n})`)
/** Je Frage das Urteil des gepaarten Tests, mit den unstimmigen Paaren und dem p-Wert. */
function urteilZeilen(hz) {
    if (!hz?.urteil?.length || hz.urteil[0] === 'zuWenig') return [t('hypeFrueh.guete_zuWenig')]
    const frage = { treffer: 'verdoppelt', lebt: 'lebt', kurve: 'kurve' }
    return hz.urteil.map((u) => {
        const v = hz.vergleich?.[frage[u.split('_')[0]]]
        const zusatz = v ? ` (${v.nurSpitze}:${v.nurKontrolle}${v.p !== null && v.p !== undefined ? `, p = ${v.p < 0.001 ? '< 0,001' : v.p.toFixed(3).replace('.', ',')}` : ''})` : ''
        return (te(`hypeFrueh.guete_${u}`) ? t(`hypeFrueh.guete_${u}`) : u) + zusatz
    })
}

watch(() => props.aktiv, (a) => {
    if (a && !guete.value) ladeGuete()
}, { immediate: true })

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

const dauer = (ms) => alter(Number(ms) / 3600e3)

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

function statusKlasse(s, kandidat = false) {
    if (s === 'verworfen') return 'bg-danger'
    if (kandidat) return 'bg-primary'
    if (s === 'reif') return 'bg-success'
    return 'bg-secondary'
}

function statusText(z) {
    if (z.status === 'verworfen' && z.grund) return t('hypeFrueh.grund_' + z.grund)
    if (z.kandidat?.ja) return t('hypeFrueh.status_kandidat')
    return t('hypeFrueh.status_' + (z.status || 'beobachtet'))
}

/** Warum ein Token (noch) kein Kandidat ist — die erste fehlende Bedingung. */
function warumNicht(z) {
    if (z.status === 'verworfen') return z.grund ? t('hypeFrueh.grund_' + z.grund) : ''
    if (!z.kandidat || z.kandidat.ja) return z.kandidat?.ja ? t('hypeFrueh.istKandidat') : ''
    return t('hypeFrueh.keinKandidat', { g: t('hypeFrueh.bedingung_' + z.kandidat.grund, { s: daten.value?.schwelle ?? 50 }) })
}

/** Verschiedene Käufer gegen verschiedene Verkäufer — oder, wenn das fehlt, die Transaktionen. */
function kaeuferText(s) {
    if (!s) return '—'
    if (hatZahl(s.kaeufer1h)) return `${s.kaeufer1h} / ${hatZahl(s.verkaeufer1h) ? s.verkaeufer1h : '—'}`
    if (hatZahl(s.tx1h)) return t('hypeFrueh.txKurz', { n: s.tx1h })
    return '—'
}

const SOZIAL = ['telegram', 'biz', 'reddit', 'x']
const sozialVon = (z) => SOZIAL.filter((p) => (z.quellen || []).includes(p))
const SOZIAL_KURZ = { telegram: 'TG', biz: '/biz/', reddit: 'Reddit', x: 'X' }
const sozialText = (z) => (sozialVon(z).length ? sozialVon(z).map((p) => SOZIAL_KURZ[p]).join(' · ') : '—')
const sozialTitel = (z) => (sozialVon(z).length ? t('hypeFrueh.sozialTitel', { p: sozialVon(z).join(', '), n: z.stand?.erw ?? 0 }) : '')

/** Kleiner Notenverlauf als Polylinie — die Beschleunigung auf einen Blick. */
function linie(z) {
    const v = (z.verlauf || []).filter((x) => hatZahl(x.note))
    if (v.length < 2) return ''
    const n = v.length
    return v.map((x, i) => `${((i / (n - 1)) * 60).toFixed(1)},${(17 - (Number(x.note) / 100) * 16).toFixed(1)}`).join(' ')
}

/** Die zuletzt GEMESSENE Halterzahl — gemessen wird nicht in jedem Durchgang. */
function halterVon(z) {
    if (hatZahl(z.stand?.halter)) return Number(z.stand.halter)
    const v = [...(z.verlauf || [])].reverse().find((x) => hatZahl(x.halter))
    return v ? Number(v.halter) : null
}

/** Zuwachs der Halter je Stunde zwischen den letzten beiden Messungen, oder null. */
function halterJeStunde(z) {
    const v = (z.verlauf || []).filter((x) => hatZahl(x.halter))
    if (v.length < 2) return null
    const [a, b] = v.slice(-2)
    const stunden = (Number(b.ts) - Number(a.ts)) / 3600e3
    return stunden > 0 ? (Number(b.halter) - Number(a.halter)) / stunden : null
}

const dexLink = (chain, contract) => `https://dexscreener.com/${encodeURIComponent(chain)}/${encodeURIComponent(contract)}`

// ── Bausteine ───────────────────────────────────────────────────────────
/*
 * Die Signale, die ein Terminal zuerst zeigt, als drei kleine Zeichen am
 * Token: Krone = King of the Hill, Brieftasche = beobachtete Wallets haben
 * gekauft, Gebäude = schon auf Binance Alpha oder einer Börse.
 */
const FruehSignale = defineComponent({
    props: { z: { type: Object, required: true } },
    setup(p) {
        return () => {
            const z = p.z
            const teile = []
            if (hatZahl(z.stand?.kothMin)) {
                teile.push(h('i', { class: 'uil uil-crown fpSignal koth', title: t('hypeFrueh.signalKoth', { m: Math.max(1, Math.round(z.stand.kothMin)) }) }))
            }
            if (z.stand?.smart?.wallets > 0) {
                teile.push(h('span', { class: 'fpSignal smart', title: t('hypeFrueh.signalSmart', { n: z.stand.smart.wallets, namen: (z.stand.smart.namen || []).join(', ') }) },
                    [h('i', { class: 'uil uil-wallet' }), String(z.stand.smart.wallets)]))
            }
            const l = z.leiter || {}
            const boersen = [...(l.alpha ? ['Binance Alpha'] : []), ...(l.mittel || []), ...(l.gross || [])]
            if (boersen.length) {
                teile.push(h('i', { class: 'uil uil-building fpSignal boerse', title: t('hypeFrueh.signalBoerse', { b: boersen.join(', ') }) }))
            }
            return teile.length ? h('span', { class: 'fpSignale' }, teile) : null
        }
    },
})

/** Der Stern: beobachten oder nicht mehr beobachten. Klick öffnet die Zeile nicht. */
const SternKnopf = defineComponent({
    props: { z: { type: Object, required: true } },
    emits: ['stern'],
    setup(p, { emit: sende }) {
        return () => h('button', {
            type: 'button', class: 'fpSternKnopf',
            title: p.z.favoritId ? t('hypeFrueh.sternAus') : t('hypeFrueh.sternAn'),
            'aria-label': p.z.favoritId ? t('hypeFrueh.sternAus') : t('hypeFrueh.sternAn'),
            onClick: (ev) => { ev.stopPropagation(); sende('stern', p.z) },
        }, [h('i', { class: ['uil', p.z.favoritId ? 'uil-favorite aktiv' : 'uil-star'] })])
    },
})

/*
 * Verlauf von Note und Bewertung über die Zeit — die x-Achse nach Uhrzeit,
 * nicht nach Aufnahme: Der Takt ist einstellbar, und gleich verteilte Punkte
 * täuschten gleichmässige Abstände vor. Die Bewertung ist auf ihre eigene
 * Spanne gestreckt (gestrichelt), die Note auf 0–100.
 */
const VerlaufDiagramm = defineComponent({
    props: { verlauf: { type: Array, default: () => [] } },
    setup(p) {
        return () => {
            const v = (p.verlauf || []).filter((x) => hatZahl(x.ts)).sort((a, b) => a.ts - b.ts)
            if (v.length < 2) return h('div', { class: 'fpGrau small' }, t('hypeFrueh.verlaufEinzeln'))
            const B = 300
            const H = 70
            const t0 = Number(v[0].ts)
            const t1 = Number(v[v.length - 1].ts)
            const x = (ts) => (t1 > t0 ? ((Number(ts) - t0) / (t1 - t0)) * (B - 4) + 2 : B / 2)
            const noten = v.filter((s) => hatZahl(s.note))
            const notenLinie = noten.map((s) => `${x(s.ts).toFixed(1)},${(H - 2 - (Number(s.note) / 100) * (H - 4)).toFixed(1)}`).join(' ')
            const mc = v.filter((s) => hatZahl(s.mcap) && Number(s.mcap) > 0)
            const lo = Math.min(...mc.map((s) => Number(s.mcap)))
            const hi = Math.max(...mc.map((s) => Number(s.mcap)))
            const yMc = (w) => (hi > lo ? H - 2 - ((Number(w) - lo) / (hi - lo)) * (H - 4) : H / 2)
            const mcLinie = mc.length >= 2 ? mc.map((s) => `${x(s.ts).toFixed(1)},${yMc(s.mcap).toFixed(1)}`).join(' ') : ''
            const mcErst = mc.length ? Number(mc[0].mcap) : null
            const mcLetzt = mc.length ? Number(mc[mc.length - 1].mcap) : null
            const mcAend = mcErst && mcLetzt ? Math.round(((mcLetzt - mcErst) / mcErst) * 100) : null
            return h('div', { class: 'fpVerlauf' }, [
                h('svg', { class: 'fpVerlaufSvg', viewBox: `0 0 ${B} ${H}`, preserveAspectRatio: 'none', role: 'img',
                    'aria-label': t('hypeFrueh.verlaufTitel') }, [
                    h('line', { x1: 0, x2: B, y1: H - 2 - 0.5 * (H - 4), y2: H - 2 - 0.5 * (H - 4), class: 'fpVerlaufMitte' }),
                    mcLinie ? h('polyline', { points: mcLinie, class: 'fpVerlaufMc' }) : null,
                    notenLinie ? h('polyline', { points: notenLinie, class: 'fpVerlaufNote' }) : null,
                ]),
                h('div', { class: 'fpVerlaufLegende' }, [
                    h('span', [h('i', { class: 'fpStrich note' }), ` ${t('hypeFrueh.verlaufNote', { a: noten[0]?.note ?? '—', b: noten[noten.length - 1]?.note ?? '—' })}`]),
                    mc.length ? h('span', [h('i', { class: 'fpStrich mc' }),
                        ` ${t('hypeFrueh.verlaufMcap', { a: geld(mcErst), b: geld(mcLetzt) })}${mcAend !== null ? ` (${mcAend > 0 ? '+' : ''}${mcAend} %)` : ''}`]) : null,
                    h('span', { class: 'ms-auto' }, t('hypeFrueh.verlaufSpanne', { n: v.length, d: dauer(t1 - t0) })),
                ]),
            ])
        }
    },
})

const TEILNOTEN = ['handel', 'beteiligung', 'sozial', 'team', 'momentum']

/** Teilnoten, Kennzahlen, Links, Befunde und Projektprüfung eines Tokens. */
const FruehDetail = defineComponent({
    props: { z: { type: Object, required: true } },
    setup(p) {
        // Eine Prüfung von Hand gilt, bis der nächste Abruf eine neuere bringt.
        const eigene = ref(null)
        return () => {
            const z = p.z
            const teil = z.stand?.teilnoten || {}
            // Webseite und Kanäle zeigt die Projektprüfung — hier nur, wo gehandelt wird.
            const markt = [
                h('a', { href: dexLink(z.chain, z.contract), target: '_blank', rel: 'noopener noreferrer', class: 'me-2' }, 'DexScreener ↗'),
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
                    h('div', { class: 'fpGrau mt-1' }, kennzahlen(z)),
                    h('div', { class: 'fpGrau' }, `${t('hypeFrueh.quellen')}: ${(z.quellen || []).join(', ') || '—'}`),
                    h('div', { class: 'fpGrau' }, t('hypeFrueh.beobachtetSeit', { z: zeitpunkt(z.ersterBlick) })),
                    h('div', { class: 'mt-2' }, markt),
                    // X-Belege: die Posts, auf denen die Zählung beruht — zum Nachsehen,
                    // ob da Menschen reden oder ein Ring.
                    z.stand?.x?.belege?.length ? h('div', { class: 'fpGrau mt-1' }, [
                        t('hypeFrueh.xAutoren', { n: z.stand.x.autoren }) + ' ',
                        ...z.stand.x.belege.filter((u) => /^https:\/\/(x|twitter)\.com\//i.test(u)).map((u, i) =>
                            h('a', { href: u, target: '_blank', rel: 'noopener noreferrer nofollow', class: 'me-2' }, `${i + 1} ↗`)),
                    ]) : null,
                    h('div', { class: 'fpGrau fpVertrag', title: z.contract }, z.contract),
                ]),
                h('div', [
                    h('div', { class: 'fpDetailTitel' }, t('hypeFrueh.befunde')),
                    (z.befunde || []).length
                        ? h('ul', { class: 'befundListe' }, sortiereBefunde(z.befunde).map((b, i) =>
                            h('li', { key: i, class: b.art }, [h('span', { class: 'befundZeichen' }, ZEICHEN[b.art] || '·'), b.text])))
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

/** Die wichtigsten Zahlen eines Kandidaten als Kacheln — „—" heisst nicht gemessen. */
function kennzahlKacheln(z) {
    const s = z.stand || {}
    const proStunde = halterJeStunde(z)
    const kacheln = [
        [t('hypeFrueh.kzBewertung'), hatZahl(s.mcap) ? `${geld(s.mcap)} USD` : '—'],
        [t('hypeFrueh.kzLiquiditaet'), s.aufKurve ? t('hypeFrueh.kzKurve') : (hatZahl(s.liq) ? `${geld(s.liq)} USD` : '—')],
        [t('hypeFrueh.kzHandel'), hatZahl(s.tx1h) ? t('hypeFrueh.txKurz', { n: s.tx1h }) : '—'],
        [t('hypeFrueh.kzKaeufer'), hatZahl(s.kaeufer1h) ? `${s.kaeufer1h} / ${hatZahl(s.verkaeufer1h) ? s.verkaeufer1h : '—'}` : '—'],
        [t('hypeFrueh.kzHalter'), halterVon(z) !== null
            ? `${halterVon(z)}${proStunde !== null ? ` (${proStunde >= 0 ? '+' : ''}${Math.round(proStunde)}/h)` : ''}` : '—'],
        [t('hypeFrueh.kzKurs1h'), hatZahl(s.aend1h) ? `${s.aend1h > 0 ? '+' : ''}${Math.round(s.aend1h)} %` : '—'],
        [t('hypeFrueh.kzAlter'), alter(s.alterStunden)],
    ]
    return kacheln.map(([name, wert]) => h('div', { class: 'fpKz' }, [h('span', { class: 'fpKzWert' }, wert), h('span', { class: 'fpKzName' }, name)]))
}

/** Ein Kandidat (oder Favorit mit Frühphasen-Zeile), ausführlich. */
const FruehKarte = defineComponent({
    props: { z: { type: Object, required: true } },
    emits: ['stern'],
    setup(p, { emit: sende }) {
        return () => {
            const z = p.z
            const s = z.stand || {}
            return h('div', { class: ['fpKandidat', { fpDuenn: z.duenn && !z.kandidat?.ja }] }, [
                h('div', { class: 'fpKandidatKopf' }, [
                    h(SternKnopf, { z, onStern: (x) => sende('stern', x) }),
                    h('strong', { class: 'fpKandidatName' }, z.symbol || kurz(z.contract)),
                    h('span', { class: 'fpKette' }, z.chain),
                    z.name && z.name !== z.symbol ? h('span', { class: 'fpGrau fpLangName' }, z.name) : null,
                    s.aufKurve ? h('span', { class: 'fpKurve', title: t('hypeFrueh.kurveTitel') }, [h('i', { class: 'uil uil-chart-growth' })]) : null,
                    h(FruehSignale, { z }),
                    h('span', { class: ['badge hypBadge', statusKlasse(z.status, z.kandidat?.ja)], title: warumNicht(z) }, statusText(z)),
                    h('span', { class: 'fpKandidatNote', title: t('hypeFrueh.trend_' + (s.trend || 'neu')) }, [
                        h('span', { class: ['fpNote', notenKlasse(z.note)] }, String(z.note)),
                        h('i', { class: ['uil fpTrend', trendIcon(s.trend)] }),
                    ]),
                ]),
                // Nicht (mehr) Kandidat — z. B. in der Beobachtungsliste: warum.
                !z.kandidat?.ja && warumNicht(z) ? h('div', { class: 'fpGrau small' }, warumNicht(z)) : null,
                h('div', { class: 'fpKennzahlen' }, kennzahlKacheln(z)),
                h(VerlaufDiagramm, { verlauf: z.verlauf }),
                h(FruehDetail, { z }),
            ])
        }
    },
})

/** Ein Favorit, den die Frühphase nicht mehr führt: der Stand des Wachhunds. */
const FavoritKarte = defineComponent({
    props: { f: { type: Object, required: true } },
    emits: ['stern'],
    setup(p, { emit: sende }) {
        return () => {
            const f = p.f
            const d = f.letzteDaten || {}
            return h('div', { class: 'fpKandidat' }, [
                h('div', { class: 'fpKandidatKopf' }, [
                    h('button', {
                        type: 'button', class: 'fpSternKnopf', title: t('hypeFrueh.sternAus'), 'aria-label': t('hypeFrueh.sternAus'),
                        onClick: () => sende('stern', f),
                    }, [h('i', { class: 'uil uil-favorite aktiv' })]),
                    h('strong', { class: 'fpKandidatName' }, f.symbol || kurz(f.contractAddress)),
                    h('span', { class: 'fpKette' }, f.chain),
                    f.name && f.name !== f.symbol ? h('span', { class: 'fpGrau fpLangName' }, f.name) : null,
                    f.contractAddress ? h('a', { href: dexLink(f.chain, f.contractAddress), target: '_blank', rel: 'noopener noreferrer', class: 'ms-auto small' }, 'DexScreener ↗') : null,
                ]),
                h('div', { class: 'fpGrau small' }, t('hypeFrueh.beobachtungNichtMehr')),
                hatZahl(d.ts) ? h('div', { class: 'fpKennzahlen' }, [
                    [t('hypeFrueh.kzPreis'), hatZahl(d.preis) ? `${Number(d.preis).toPrecision(3)} USD` : '—'],
                    [t('hypeFrueh.kzLiquiditaet'), hatZahl(d.liq) ? `${geld(d.liq)} USD` : '—'],
                    [t('hypeFrueh.kzKurs24h'), hatZahl(d.aenderung24h) ? `${d.aenderung24h > 0 ? '+' : ''}${Math.round(d.aenderung24h)} %` : '—'],
                    [t('hypeFrueh.kzStand'), zeitpunkt(d.ts)],
                ].map(([name, wert]) => h('div', { class: 'fpKz' }, [h('span', { class: 'fpKzWert' }, wert), h('span', { class: 'fpKzName' }, name)])))
                    : h('div', { class: 'fpGrau small' }, t('hypeFrueh.beobachtungNochKeinStand')),
            ])
        }
    },
})

/** Liquidität, Halter und Halterbild in einer Zeile — „—" heisst nicht gemessen. */
function kennzahlen(z) {
    const r = z.stand?.risiko || {}
    const pz = (w) => (hatZahl(w) ? `${Math.round(w)} %` : '—')
    const teile = [
        `${t('hypeFrueh.spalteLiq')} ${z.stand?.aufKurve ? t('hypeFrueh.kzKurve') : geld(z.stand?.liq)}`,
        `${t('hypeFrueh.spalteHalter')} ${halterVon(z) ?? '—'}`,
        `Insider ${pz(r.insiderPct)}`,
        `Top-10 ${pz(r.top10Pct)}`,
        `Dev ${pz(r.devPct)}`,
    ]
    const l = z.leiter || {}
    const boersen = [...(l.alpha ? ['Binance Alpha'] : []), ...(l.mittel || []), ...(l.gross || [])]
    if (boersen.length) teile.push(`${t('hypeFrueh.boersen')}: ${boersen.join(', ')}`)
    return teile.join(' · ')
}

/* Warnungen zuerst: bei Frühphasen-Token wiegt ein Minus schwerer als ein Plus. */
const ZEICHEN = { minus: '−', plus: '+', info: 'i' }
const sortiereBefunde = (b) => [...b].sort((x, y) => ['minus', 'plus', 'info'].indexOf(x.art) - ['minus', 'plus', 'info'].indexOf(y.art))
</script>

<style scoped>
/* Note aus zu wenigen Messungen: steht unten, wird nicht gemeldet. */
.fpDuenn {
    opacity: .55;
}
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
/* Geliefert, aber nicht vollständig (z. B. Teilabfragen gedrosselt) — der Hinweis steht im Tooltip. */
.fpQuelle.teils {
    color: #e0b030;
}
.fpHinweis {
    font-size: .874rem;
    color: var(--grey-color, #9aa0a6);
    margin: .6rem 0;
}
/* ── Blöcke: Kandidaten, Beobachtungsliste, Rohliste ── */
.fpBlock {
    margin-top: 1rem;
}
.fpBlockKopf {
    display: flex;
    align-items: baseline;
    gap: .5rem;
    flex-wrap: wrap;
    margin-bottom: .5rem;
}
.fpBlockTitel {
    font-weight: 600;
    font-size: 1rem;
}
.fpZahl {
    font-size: .782rem;
    padding: 0 .45rem;
    border-radius: 10px;
    background: var(--white-10, rgba(255, 255, 255, .08));
}
.fpKandidaten {
    display: flex;
    flex-direction: column;
    gap: .75rem;
}
.fpKandidat {
    background: var(--black-bg-2, rgba(255, 255, 255, .03));
    border: 1px solid var(--white-10, rgba(255, 255, 255, .08));
    border-radius: var(--border-radius, 8px);
    padding: .7rem .85rem;
    min-width: 0;
}
.fpKandidatKopf {
    display: flex;
    align-items: center;
    gap: .5rem;
    flex-wrap: wrap;
    margin-bottom: .35rem;
}
.fpKandidatName {
    font-size: 1.05rem;
}
.fpLangName {
    font-size: .851rem;
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.fpKandidatNote {
    margin-left: auto;
    font-size: 1.25rem;
}
.fpKennzahlen {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 7.5rem), 1fr));
    gap: .4rem;
    margin: .5rem 0;
}
:deep(.fpKz) {
    display: flex;
    flex-direction: column;
    background: rgba(255, 255, 255, .03);
    border-radius: 6px;
    padding: .3rem .5rem;
    min-width: 0;
}
:deep(.fpKzWert) {
    font-weight: 600;
    font-size: .92rem;
    overflow-wrap: anywhere;
}
:deep(.fpKzName) {
    font-size: .74rem;
    color: var(--grey-color, #9aa0a6);
}
:deep(.fpSternKnopf) {
    background: none;
    border: 0;
    padding: 0 .1rem;
    color: var(--grey-color, #9aa0a6);
    cursor: pointer;
    line-height: 1;
}
:deep(.fpSternKnopf .aktiv) {
    color: #e0b030;
}
:deep(.fpVerlauf) {
    margin: .35rem 0 .6rem;
}
:deep(.fpVerlaufSvg) {
    width: 100%;
    height: 70px;
    display: block;
    background: rgba(255, 255, 255, .02);
    border-radius: 6px;
}
:deep(.fpVerlaufNote) {
    fill: none;
    stroke: var(--blue-color, #4da3ff);
    stroke-width: 1.8;
    vector-effect: non-scaling-stroke;
}
:deep(.fpVerlaufMc) {
    fill: none;
    stroke: #4caf50;
    stroke-width: 1.4;
    stroke-dasharray: 4 3;
    vector-effect: non-scaling-stroke;
}
:deep(.fpVerlaufMitte) {
    stroke: rgba(255, 255, 255, .08);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
}
:deep(.fpVerlaufLegende) {
    display: flex;
    flex-wrap: wrap;
    gap: .25rem 1rem;
    font-size: .782rem;
    color: var(--grey-color, #9aa0a6);
    margin-top: .2rem;
}
:deep(.fpStrich) {
    display: inline-block;
    width: 14px;
    height: 0;
    vertical-align: middle;
    border-top: 2px solid var(--blue-color, #4da3ff);
}
:deep(.fpStrich.mc) {
    border-top: 2px dashed #4caf50;
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
:deep(.fpKette) {
    color: var(--grey-color, #9aa0a6);
    font-size: .782rem;
}
.fpSignale, :deep(.fpSignale) {
    margin-left: .35rem;
    display: inline-flex;
    gap: .3rem;
    align-items: center;
}
:deep(.fpSignal) {
    font-size: .82rem;
    color: var(--grey-color, #9aa0a6);
}
:deep(.fpSignal.koth) { color: #e0b030; }
:deep(.fpSignal.smart) { color: #4caf50; font-weight: 600; }
:deep(.fpSignal.boerse) { color: var(--blue-color, #4da3ff); }
.fpGuete {
    margin-top: 1.25rem;
}
.fpKurve, :deep(.fpKurve) {
    margin-left: .3rem;
    color: #e0b030;
}
.fpNote, :deep(.fpNote) {
    font-weight: 600;
}
.gut, :deep(.gut) { color: #4caf50; }
.mittel, :deep(.mittel) { color: #e0b030; }
.schwach, :deep(.schwach) { color: var(--grey-color, #9aa0a6); }
.fpTrend, :deep(.fpTrend) {
    margin-left: .25rem;
    color: var(--grey-color, #9aa0a6);
}
.fpTrend.steigt, :deep(.fpTrend.steigt) { color: #4caf50; }
.fpTrend.faellt, :deep(.fpTrend.faellt) { color: var(--red-color, #e05252); }
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
.fpListe {
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
.hypBadge, :deep(.hypBadge) {
    font-size: .713rem;
    font-weight: 500;
}
:deep(.fpDetailGrid) {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
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
:deep(.befundListe) {
    list-style: none;
    padding-left: 0;
    margin-bottom: .25rem;
    font-size: .874rem;
}
:deep(.befundListe li) {
    display: flex;
    gap: .45rem;
    margin-bottom: .1rem;
}
:deep(.befundZeichen) {
    flex: 0 0 .8rem;
    font-weight: 700;
    text-align: center;
    color: var(--grey-color, #9aa0a6);
}
:deep(.befundListe li.plus .befundZeichen) { color: #4caf50; }
:deep(.befundListe li.minus .befundZeichen) { color: var(--red-color, #e05252); }
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
