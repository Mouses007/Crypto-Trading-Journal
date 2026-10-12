<template>
    <div class="bw">
        <div class="bwKopf">
            <div class="bwStand">
                <span v-if="!einst?.boersenwachtAn" class="bwAus">
                    <i class="uil uil-pause-circle me-1"></i>{{ t('hypeBoersen.aus') }}
                </span>
                <span v-else>{{ t('hypeBoersen.an', { n: einst.boersenwachtIntervallMin || 30 }) }}</span>
                <span v-if="daten?.stand?.letzter?.am"> · {{ t('hypeBoersen.letzter', { z: zeitpunkt(daten.stand.letzter.am) }) }}</span>
                <span v-if="daten?.stand?.letzter?.fehler" class="text-danger"> · {{ daten.stand.letzter.fehler }}</span>
            </div>
            <button type="button" class="ctl-pill ms-auto" :disabled="laeuft" @click="abgleichen">
                <span v-if="laeuft" class="spinner-border spinner-border-sm me-1"></span>
                <i v-else class="uil uil-sync me-1"></i>{{ laeuft ? t('hypeBoersen.laeuft') : t('hypeBoersen.jetzt') }}
            </button>
        </div>

        <!-- Welche Börse lieferte — eine fehlende Börse ist sonst eine stille Lücke. -->
        <div v-if="daten?.boersen?.length" class="bwChips">
            <span v-for="b in daten.boersen" :key="b.id" class="bwChip" :class="{ aus: b.fehler && !b.anzahl, warn: b.fehler && b.anzahl }"
                :title="b.fehler || t('hypeBoersen.chipTitel', { n: b.anzahl, z: b.aktualisiertAm ? zeitpunkt(b.aktualisiertAm) : '—' })">
                {{ b.name }} <span class="bwGrau">{{ b.anzahl || '—' }}</span>
            </span>
        </div>

        <div v-if="meldung" class="alert py-2 small mt-2" :class="meldungFehler ? 'alert-danger' : 'alert-info'">{{ meldung }}</div>
        <div v-if="ladeFehler" class="text-danger small mt-2">{{ ladeFehler }}</div>

        <p class="bwHinweis">{{ t('hypeBoersen.erklaerung') }}</p>

        <!-- Die Zahl, auf die es ankommt: wie früh war der Radar? -->
        <div v-if="daten?.statistik" class="bwStatistik">
            <div v-for="s in ['alpha', 'mittel', 'gross']" :key="s" class="bwKachel">
                <div class="bwKachelTitel">{{ t('hypeBoersen.stufe_' + s) }}</div>
                <div class="bwKachelZahl">{{ daten.statistik[s].erkannt }} / {{ daten.statistik[s].neu }}</div>
                <div class="bwGrau small">
                    {{ t('hypeBoersen.erkannt') }}<template v-if="daten.statistik[s].medianVorlaufTage !== null">
                        · {{ t('hypeBoersen.vorlauf', { n: tageText(daten.statistik[s].medianVorlaufTage) }) }}</template>
                </div>
            </div>
        </div>

        <!-- Auf dem Weg nach oben: Radar-Token auf Alpha oder mittleren Börsen. -->
        <div class="bwAbschnitt">
            <div class="bwTitel">{{ t('hypeBoersen.leiterTitel') }}</div>
            <p class="bwGrau small mb-1">{{ t('hypeBoersen.leiterHinweis') }}</p>
            <p v-if="!daten?.leiter?.length" class="bwGrau small">{{ t('hypeBoersen.leiterLeer') }}</p>
            <div v-else class="table-responsive">
                <table class="table table-sm align-middle bwTabelle">
                    <thead>
                        <tr>
                            <th>{{ t('hypeBoersen.spalteToken') }}</th>
                            <th class="text-end">{{ t('hypeBoersen.spalteBewertung') }}</th>
                            <th>{{ t('hypeBoersen.spalteGemeldet') }}</th>
                            <th>{{ t('hypeBoersen.spalteBoersen') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="l in daten.leiter" :key="l.chain + l.contract" :class="{ oben: l.gross.length }">
                            <td>
                                <strong>{{ l.symbol || kurz(l.contract) }}</strong>
                                <span class="bwKette">{{ l.chain }}</span>
                                <a :href="dexLink(l)" target="_blank" rel="noopener noreferrer" class="ms-1 small">↗</a>
                            </td>
                            <td class="text-end">{{ geld(l.bewertungUsd) }}</td>
                            <td>{{ l.radarSeit ? t('hypeBoersen.vorTagen', { n: tageText((Date.now() - l.radarSeit) / 86400e3) }) : '—' }}</td>
                            <td>
                                <span v-if="l.alpha" class="bwStufe alpha">Alpha</span>
                                <span v-for="m in l.mittel" :key="m" class="bwStufe mittel">{{ m }}</span>
                                <span v-for="g in l.gross" :key="g" class="bwStufe gross">{{ g }}</span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Angekündigt: angelegt, aber noch nicht offen — mit Startzeit, wo die Börse sie nennt. -->
        <div class="bwAbschnitt">
            <div class="bwTitel">{{ t('hypeBoersen.angekuendigtTitel') }}</div>
            <p class="bwGrau small mb-1">{{ t('hypeBoersen.angekuendigtHinweis') }}</p>
            <p v-if="!daten?.angekuendigt?.length" class="bwGrau small">{{ t('hypeBoersen.angekuendigtLeer') }}</p>
            <div v-else class="table-responsive">
                <table class="table table-sm align-middle bwTabelle">
                    <thead>
                        <tr>
                            <th>{{ t('hypeBoersen.spalteStart') }}</th>
                            <th>{{ t('hypeBoersen.spalteBoerse') }}</th>
                            <th>{{ t('hypeBoersen.spalteToken') }}</th>
                            <th :title="t('hypeBoersen.auchAufTitel')">{{ t('hypeBoersen.spalteAuchAuf') }}</th>
                            <th>{{ t('hypeBoersen.spalteRadar') }}</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <template v-for="a in daten.angekuendigt" :key="a.boerse + a.symbol">
                        <tr>
                            <td class="text-nowrap">
                                <template v-if="a.start">{{ zeitpunkt(a.start) }} <span class="bwGrau">· {{ bisDahin(a.start) }}</span></template>
                                <span v-else class="bwGrau">{{ t('hypeBoersen.startOffen') }}</span>
                            </td>
                            <td><span class="bwStufe" :class="stufeVon(a.boerse)">{{ boerseName(a.boerse) }}</span></td>
                            <td><TokenZelle :z="a" /></td>
                            <td><AuchAuf :liste="a.auchAuf" :symbol="a.symbol" /></td>
                            <td :title="a.treffer === 'kuerzel' ? t('hypeBoersen.kuerzelTitel') : ''">
                                <template v-if="istTreffer(a) && a.radarSeit">
                                    <i class="uil uil-check-circle text-success me-1"></i>{{ t('hypeBoersen.gemeldetVor', { n: tageText((Date.now() - a.radarSeit) / 86400e3) }) }}
                                </template>
                                <span v-else-if="a.treffer === 'namensgleich'" class="bwGrau">{{ t('hypeBoersen.namensvetter') }}</span>
                                <span v-else class="bwGrau">—</span>
                            </td>
                            <td class="text-end"><TiefeKnopf :z="a" /></td>
                        </tr>
                        <tr v-if="tiefeOffen === tiefeSchluessel(a)" class="bwTiefeZeile">
                            <td colspan="6"><TiefeInhalt :z="a" /></td>
                        </tr>
                        </template>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Neue Listungen der letzten Wochen. -->
        <div class="bwAbschnitt">
            <div class="bwTitel">{{ t('hypeBoersen.neuTitel') }}</div>
            <p v-if="!daten?.listungen?.length" class="bwGrau small">{{ t('hypeBoersen.neuLeer') }}</p>
            <div v-else class="table-responsive">
                <table class="table table-sm align-middle bwTabelle">
                    <thead>
                        <tr>
                            <th>{{ t('hypeBoersen.spalteDatum') }}</th>
                            <th :title="t('hypeBoersen.handelsStartTitel')">{{ t('hypeBoersen.spalteHandelsStart') }}</th>
                            <th>{{ t('hypeBoersen.spalteBoerse') }}</th>
                            <th>{{ t('hypeBoersen.spalteToken') }}</th>
                            <th :title="t('hypeBoersen.auchAufTitel')">{{ t('hypeBoersen.spalteAuchAuf') }}</th>
                            <th>{{ t('hypeBoersen.spalteRadar') }}</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <template v-for="z in daten.listungen" :key="z.id">
                        <tr :class="{ blass: !istTreffer(z) && tiefeOffen !== tiefeSchluessel(z) }">
                            <td class="text-nowrap">{{ zeitpunkt(z.gesehenAm) }}</td>
                            <td class="text-nowrap">{{ z.handelsStart ? zeitpunkt(z.handelsStart) : '—' }}</td>
                            <td><span class="bwStufe" :class="stufeVon(z.boerse)">{{ boerseName(z.boerse) }}</span></td>
                            <td><TokenZelle :z="z" /></td>
                            <td><AuchAuf :liste="z.auchAuf" :symbol="z.symbol" /></td>
                            <td :title="z.treffer === 'kuerzel' ? t('hypeBoersen.kuerzelTitel') : ''">
                                <template v-if="istTreffer(z) && z.radarSeit">
                                    <i class="uil uil-check-circle text-success me-1"></i>{{ t('hypeBoersen.vorher', { n: tageText((z.gesehenAm - z.radarSeit) / 86400e3) }) }}
                                    <span v-if="z.treffer === 'kuerzel'" class="bwGrau">({{ t('hypeBoersen.ueberKuerzel') }})</span>
                                </template>
                                <span v-else-if="z.treffer === 'namensgleich'" class="bwGrau">{{ t('hypeBoersen.namensvetter') }}</span>
                                <span v-else-if="z.radarGesehen" class="bwGrau">{{ t('hypeBoersen.nurGesehen') }}</span>
                                <span v-else class="bwGrau">—</span>
                            </td>
                            <td class="text-end"><TiefeKnopf :z="z" /></td>
                        </tr>
                        <tr v-if="tiefeOffen === tiefeSchluessel(z)" class="bwTiefeZeile">
                            <td colspan="7"><TiefeInhalt :z="z" /></td>
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
 * Hype-Radar → Börsen.
 *
 * Junge Projekte starten selten auf einer zentralen Börse; sie steigen eine
 * Leiter hinauf: DEX, dann Binance Alpha oder mittlere Börsen, dann die
 * grossen. Die Seite zeigt zwei Dinge:
 *
 *   „Auf dem Weg nach oben"  Radar-Token, die schon auf Alpha oder einer
 *                            mittleren Börse stehen — die Kandidaten für das
 *                            nächste grosse Listing
 *   „Neue Listungen"         was neu dazukam, und ob der Radar es vorher
 *                            gemeldet hatte — der Massstab für „rechtzeitig"
 */
import { ref, reactive, computed, watch, onBeforeUnmount, h, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { logWarn } from '../../utils/logger.js'
import { listungUrl, coingeckoSuche } from '../../utils/boersenLinks.js'
import TiefensucheErgebnis from './TiefensucheErgebnis.vue'

const props = defineProps({
    aktiv: { type: Boolean, default: false },
    einst: { type: Object, default: null },
})
const { t, locale } = useI18n()

const daten = ref(null)
const ladeFehler = ref('')
const meldung = ref('')
const meldungFehler = ref(false)
const gestartet = ref(false)
const laeuft = computed(() => gestartet.value || Boolean(daten.value?.stand?.laeuft))

let anfrage = 0
async function lade() {
    const meine = ++anfrage
    try {
        const r = await axios.get('/api/hype-radar/boersen')
        if (meine !== anfrage) return
        daten.value = r.data
        ladeFehler.value = ''
        if (!r.data?.stand?.laeuft && gestartet.value) {
            gestartet.value = false
            if (!meldungFehler.value) meldung.value = ''
        }
    } catch (e) {
        if (meine !== anfrage) return
        ladeFehler.value = e.response?.data?.error || t('hypeBoersen.ladeFehler')
        logWarn('hype-boersen', 'Börsen konnten nicht geladen werden', e)
    }
    plane()
}

async function abgleichen() {
    meldung.value = ''
    meldungFehler.value = false
    try {
        await axios.post('/api/hype-radar/boersen/lauf')
        gestartet.value = true
        meldung.value = t('hypeBoersen.gestartet')
    } catch (e) {
        meldung.value = e.response?.data?.error || t('hypeBoersen.startFehler')
        meldungFehler.value = true
    }
    plane(1000)
}

let uhr = null
function plane(ms) {
    clearTimeout(uhr)
    uhr = null
    if (!props.aktiv) return
    uhr = setTimeout(lade, ms ?? (laeuft.value ? 3000 : 300000))
}
watch(() => props.aktiv, (a) => {
    if (a) lade()
    else { clearTimeout(uhr); uhr = null }
}, { immediate: true })
onBeforeUnmount(() => clearTimeout(uhr))

// ── Darstellung ─────────────────────────────────────────────────────────
/*
 * Auf welchen anderen Börsen dasselbe Kürzel steht, als Kürzel-Chips in der
 * Farbe der Sprosse. Leer heisst: Erstauftritt unter den beobachteten Börsen.
 * Klassen über `:deep` im Stil — die Elemente entstehen in einer Render-Funktion.
 */
const AuchAuf = defineComponent({
    props: { liste: { type: Array, default: () => [] }, symbol: { type: String, default: '' } },
    setup(p) {
        return () => (p.liste?.length
            ? h('span', { class: 'bwAuch' }, p.liste.map((name) => {
                // Jede Börse ein Link auf ihre Handelsseite, wo es eine gibt (Alpha nur über den Vertrag).
                const url = listungUrl(idNachName.value.get(name), p.symbol)
                const klasse = ['bwStufe', stufeNachName.value.get(name) || '']
                return url
                    ? h('a', { class: klasse, key: name, href: url, target: '_blank', rel: 'noopener noreferrer', title: t('hypeBoersen.handelsseite', { b: name }) }, name)
                    : h('span', { class: klasse, key: name }, name)
            }))
            : h('span', { class: 'bwGrau', title: t('hypeBoersen.erstauftrittTitel') }, t('hypeBoersen.erstauftritt')))
    },
})

/** Kürzel als Link zur Handelsseite der eigenen Börse, dazu CoinGecko und — mit Vertrag — DexScreener. */
const TokenZelle = defineComponent({
    props: { z: { type: Object, required: true } },
    setup(p) {
        return () => {
            const z = p.z
            const url = listungUrl(z.boerse, z.symbol, { chain: z.chain, contract: z.contract })
            const teile = [url
                ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'bwToken', title: t('hypeBoersen.handelsseite', { b: boerseName(z.boerse) }) }, [h('strong', z.symbol)])
                : h('strong', z.symbol)]
            if (z.chain) teile.push(h('span', { class: 'bwKette' }, z.chain))
            teile.push(h('a', { href: coingeckoSuche(z.symbol), target: '_blank', rel: 'noopener noreferrer', class: 'bwNebenLink', title: t('hypeBoersen.coingeckoTitel') }, 'CG'))
            if (z.contract && z.boerse !== 'binance-alpha') {
                teile.push(h('a', { href: `https://dexscreener.com/${encodeURIComponent(z.chain || 'solana')}/${encodeURIComponent(z.contract)}`,
                    target: '_blank', rel: 'noopener noreferrer', class: 'bwNebenLink', title: 'DexScreener' }, 'DEX'))
            }
            return h('span', { class: 'bwTokenZelle' }, teile)
        }
    },
})

// ── Tiefensuche je Zeile ────────────────────────────────────────────────
/*
 * Dieselbe Prüfung wie im Coin-Radar: mit Vertrag nach Vertrag, sonst nach
 * Kürzel über CoinGecko — dann steht im Kopf, WELCHER Coin gefunden wurde,
 * denn bei einem Kürzel wie CENT kann es ein anderer sein als der gelistete.
 */
const tiefeOffen = ref('')
const tiefen = reactive({})
const tiefeSchluessel = (z) => `${z.boerse}|${z.symbol}`
async function tiefensuche(z) {
    const k = tiefeSchluessel(z)
    if (tiefeOffen.value === k) { tiefeOffen.value = ''; return }
    tiefeOffen.value = k
    if (tiefen[k]?.daten || tiefen[k]?.laeuft) return
    tiefen[k] = { laeuft: true, fehler: '', daten: null }
    try {
        const params = z.contract ? { contract: z.contract, chain: z.chain } : { symbol: z.symbol }
        const r = await axios.get('/api/coin-radar/tiefensuche', { params })
        tiefen[k] = { laeuft: false, fehler: '', daten: r.data }
    } catch (e) {
        tiefen[k] = { laeuft: false, fehler: e.response?.data?.error || e.message, daten: null }
    }
}
const TiefeKnopf = defineComponent({
    props: { z: { type: Object, required: true } },
    setup(p) {
        return () => {
            const k = tiefeSchluessel(p.z)
            const offen = tiefeOffen.value === k
            return h('button', { type: 'button', class: ['ctl-pill', 'klein', { active: offen }], title: t('hypeBoersen.tiefeTitel'),
                onClick: () => tiefensuche(p.z) }, [
                tiefen[k]?.laeuft ? h('span', { class: 'spinner-border spinner-border-sm me-1' }) : h('i', { class: 'uil uil-search-plus me-1' }),
                t('coinradar.tsKnopf'),
            ])
        }
    },
})
const TiefeInhalt = defineComponent({
    props: { z: { type: Object, required: true } },
    setup(p) {
        return () => {
            const e = tiefen[tiefeSchluessel(p.z)]
            if (!e || e.laeuft) return h('div', { class: 'bwGrau small' }, [h('span', { class: 'spinner-border spinner-border-sm me-1' }), t('hypeBoersen.tiefeLaeuft')])
            if (e.fehler) return h('div', { class: 'text-warning small' }, e.fehler)
            return h(TiefensucheErgebnis, { daten: e.daten, mitKopf: true })
        }
    },
})

const nachId = computed(() => new Map((daten.value?.boersen || []).map((b) => [b.id, b])))
const boerseName = (id) => nachId.value.get(id)?.name || id
const stufeVon = (id) => nachId.value.get(id)?.stufe || ''
const stufeNachName = computed(() => new Map((daten.value?.boersen || []).map((b) => [b.name, b.stufe])))
const idNachName = computed(() => new Map((daten.value?.boersen || []).map((b) => [b.name, b.id])))

/** „in 3 h", „in 5 Tagen" — oder „läuft", wenn der Start vorbei ist. */
function bisDahin(start) {
    const d = (Number(start) - Date.now()) / 86400e3
    if (!Number.isFinite(d)) return ''
    if (d <= 0) return t('hypeBoersen.startVorbei')
    if (d * 24 < 1) return t('hypeBoersen.inMinuten', { n: Math.max(1, Math.round(d * 1440)) })
    if (d < 1) return t('hypeBoersen.inStunden', { n: Math.round(d * 24) })
    return t('hypeBoersen.inTagen', { n: d < 10 ? String(Math.round(d * 10) / 10) : Math.round(d) })
}
const istTreffer = (z) => z.treffer === 'vertrag' || z.treffer === 'kuerzel'

function geld(n) {
    const z = Number(n)
    if (!Number.isFinite(z) || z <= 0) return '—'
    if (z >= 1e9) return `${(z / 1e9).toFixed(1)} Mrd`
    if (z >= 1e6) return `${(z / 1e6).toFixed(1)} M`
    if (z >= 1e3) return `${Math.round(z / 1e3)} k`
    return String(Math.round(z))
}

function tageText(tage) {
    const d = Number(tage)
    if (!Number.isFinite(d)) return '—'
    if (d < 1) return t('hypeBoersen.stunden', { n: Math.max(1, Math.round(d * 24)) })
    return t('hypeBoersen.tage', { n: d < 10 ? String(Math.round(d * 10) / 10) : Math.round(d) })
}

const kurz = (a) => (String(a || '').length > 12 ? `${String(a).slice(0, 4)}…${String(a).slice(-4)}` : String(a || ''))
const dexLink = (l) => `https://dexscreener.com/${encodeURIComponent(l.chain)}/${encodeURIComponent(l.contract)}`

const zeitpunkt = (ms) => new Date(Number(ms)).toLocaleString(
    locale.value === 'en' ? 'en-GB' : 'de-CH',
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
</script>

<style scoped>
.bwKopf {
    display: flex;
    align-items: center;
    gap: .75rem;
    flex-wrap: wrap;
}
.bwStand, .bwGrau, .bwHinweis {
    color: var(--grey-color, #9aa0a6);
}
.bwStand {
    font-size: .874rem;
}
.bwAus {
    color: #e0b030;
}
.bwChips {
    display: flex;
    flex-wrap: wrap;
    gap: .35rem;
    margin-top: .5rem;
}
.bwChip {
    font-size: .782rem;
    padding: .05rem .45rem;
    border-radius: 10px;
    background: var(--white-10, rgba(255, 255, 255, .08));
}
.bwChip.aus {
    color: var(--red-color, #e05252);
}
.bwChip.warn {
    color: #e0b030;
}
.bwHinweis {
    font-size: .874rem;
    margin: .6rem 0;
}
.bwStatistik {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: .75rem;
    margin-bottom: 1rem;
}
.bwKachel {
    background: var(--black-bg-2, rgba(255, 255, 255, .03));
    border-radius: var(--border-radius, 8px);
    padding: .55rem .75rem;
}
.bwKachelTitel {
    font-size: .82rem;
    font-weight: 600;
}
.bwKachelZahl {
    font-size: 1.35rem;
    font-weight: 600;
}
.bwAbschnitt {
    margin-top: 1rem;
}
.bwTitel {
    font-size: .95rem;
    font-weight: 600;
    margin-bottom: .2rem;
}
.bwTabelle {
    font-size: .92rem;
}
.bwTabelle tr.oben td, .bwTabelle tr.blass td {
    opacity: .55;
}
:deep(.bwGrau) {
    color: var(--grey-color, #9aa0a6);
}
.bwKette {
    font-size: .782rem;
    color: var(--grey-color, #9aa0a6);
    margin-left: .3rem;
}
.bwStufe, :deep(.bwStufe) {
    display: inline-block;
    font-size: .74rem;
    padding: .02rem .4rem;
    border-radius: 4px;
    margin-right: .25rem;
    background: var(--white-10, rgba(255, 255, 255, .08));
}
.bwStufe.alpha, :deep(.bwStufe.alpha) { color: #e0b030; }
.bwStufe.mittel, :deep(.bwStufe.mittel) { color: var(--blue-color, #4da3ff); }
.bwStufe.gross, :deep(.bwStufe.gross) { color: #4caf50; }
.bwTabelle a, :deep(.bwTabelle a), :deep(a.bwStufe), :deep(a.bwToken), :deep(a.bwNebenLink) {
    text-decoration: none;
}
:deep(.bwTokenZelle) { display: inline-flex; align-items: center; gap: .35rem; flex-wrap: wrap; }
:deep(a.bwToken) { color: inherit; }
:deep(a.bwToken:hover), :deep(a.bwStufe:hover) { text-decoration: underline; }
:deep(.bwNebenLink) { font-size: .7rem; padding: 0 .3rem; border-radius: 3px; background: var(--white-10, rgba(255, 255, 255, .08));
    color: var(--grey-color, #9aa0a6); }
:deep(.bwKette) { font-size: .782rem; color: var(--grey-color, #9aa0a6); }
.bwTiefeZeile td { background: var(--black-bg-2, rgba(255, 255, 255, .03)); }
</style>
