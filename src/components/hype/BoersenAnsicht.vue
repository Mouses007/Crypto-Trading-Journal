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

        <!-- Neue Listungen der letzten Wochen. -->
        <div class="bwAbschnitt">
            <div class="bwTitel">{{ t('hypeBoersen.neuTitel') }}</div>
            <p v-if="!daten?.listungen?.length" class="bwGrau small">{{ t('hypeBoersen.neuLeer') }}</p>
            <div v-else class="table-responsive">
                <table class="table table-sm align-middle bwTabelle">
                    <thead>
                        <tr>
                            <th>{{ t('hypeBoersen.spalteDatum') }}</th>
                            <th>{{ t('hypeBoersen.spalteBoerse') }}</th>
                            <th>{{ t('hypeBoersen.spalteToken') }}</th>
                            <th>{{ t('hypeBoersen.spalteRadar') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="z in daten.listungen" :key="z.id" :class="{ blass: !istTreffer(z) }">
                            <td class="text-nowrap">{{ zeitpunkt(z.gesehenAm) }}</td>
                            <td><span class="bwStufe" :class="stufeVon(z.boerse)">{{ boerseName(z.boerse) }}</span></td>
                            <td><strong>{{ z.symbol }}</strong> <span v-if="z.chain" class="bwKette">{{ z.chain }}</span></td>
                            <td :title="z.treffer === 'kuerzel' ? t('hypeBoersen.kuerzelTitel') : ''">
                                <template v-if="istTreffer(z) && z.radarSeit">
                                    <i class="uil uil-check-circle text-success me-1"></i>{{ t('hypeBoersen.vorher', { n: tageText((z.gesehenAm - z.radarSeit) / 86400e3) }) }}
                                    <span v-if="z.treffer === 'kuerzel'" class="bwGrau">({{ t('hypeBoersen.ueberKuerzel') }})</span>
                                </template>
                                <span v-else-if="z.treffer === 'namensgleich'" class="bwGrau">{{ t('hypeBoersen.namensvetter') }}</span>
                                <span v-else-if="z.radarGesehen" class="bwGrau">{{ t('hypeBoersen.nurGesehen') }}</span>
                                <span v-else class="bwGrau">—</span>
                            </td>
                        </tr>
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
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { logWarn } from '../../utils/logger.js'

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
const nachId = computed(() => new Map((daten.value?.boersen || []).map((b) => [b.id, b])))
const boerseName = (id) => nachId.value.get(id)?.name || id
const stufeVon = (id) => nachId.value.get(id)?.stufe || ''
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
.bwKette {
    font-size: .782rem;
    color: var(--grey-color, #9aa0a6);
    margin-left: .3rem;
}
.bwStufe {
    display: inline-block;
    font-size: .74rem;
    padding: .02rem .4rem;
    border-radius: 4px;
    margin-right: .25rem;
    background: var(--white-10, rgba(255, 255, 255, .08));
}
.bwStufe.alpha { color: #e0b030; }
.bwStufe.mittel { color: var(--blue-color, #4da3ff); }
.bwStufe.gross { color: #4caf50; }
.bwTabelle a {
    text-decoration: none;
}
</style>
