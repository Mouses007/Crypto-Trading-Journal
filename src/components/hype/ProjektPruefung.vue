<template>
    <div class="pp">
        <div class="ppKopf">
            <span class="ppTitel">{{ t('hypeProjekt.titel') }}</span>
            <span v-if="daten && daten.note !== null && daten.note !== undefined" class="ppNote" :class="notenKlasse(daten.note)"
                :title="t('hypeProjekt.noteTitel')">{{ daten.note }}</span>
            <span v-else-if="daten" class="ppNote leer" :title="t('hypeProjekt.keineNoteTitel')">—</span>
            <InfoTipp schluessel="hypeProjekt.info" breit />
            <span v-if="daten?.geprueftAm" class="ppZeit">{{ t('hypeProjekt.geprueftAm', { z: zeitpunkt(daten.geprueftAm) }) }}</span>
            <button v-if="kandidat?.contract || kandidat?.symbol" type="button" class="ctl-pill klein ms-auto"
                :disabled="laedt" @click.stop="pruefen(Boolean(daten))">
                <span v-if="laedt" class="spinner-border spinner-border-sm me-1"></span>
                <i v-else class="uil uil-search-alt me-1"></i>{{ daten ? t('hypeProjekt.neuPruefen') : t('hypeProjekt.pruefen') }}
            </button>
        </div>

        <p v-if="fehler" class="ppFehler">{{ fehler }}</p>
        <p v-else-if="!daten && !laedt" class="ppLeer">{{ t('hypeProjekt.nochNicht') }}</p>

        <template v-if="daten">
            <!-- Befunde: was für und was gegen Substanz spricht, getrennt.
                 „info" steht für sich — Bot-Schutz, unbekannte Domain-Endung:
                 Dinge, die nicht prüfbar waren und deshalb nichts kosten. -->
            <div class="ppBefunde">
                <div v-if="befundeVon('plus').length">
                    <div class="ppSpalte plus"><i class="uil uil-plus-circle"></i> {{ t('hypeProjekt.dafuer') }}</div>
                    <ul><li v-for="(b, i) in befundeVon('plus')" :key="i">{{ b.text }}</li></ul>
                </div>
                <div v-if="befundeVon('minus').length">
                    <div class="ppSpalte minus"><i class="uil uil-minus-circle"></i> {{ t('hypeProjekt.dagegen') }}</div>
                    <ul><li v-for="(b, i) in befundeVon('minus')" :key="i">{{ b.text }}</li></ul>
                </div>
                <div v-if="befundeVon('info').length">
                    <div class="ppSpalte"><i class="uil uil-info-circle"></i> {{ t('hypeProjekt.hinweise') }}</div>
                    <ul><li v-for="(b, i) in befundeVon('info')" :key="i">{{ b.text }}</li></ul>
                </div>
            </div>

            <dl class="ppFakten">
                <template v-if="daten.webseite?.url">
                    <dt>{{ t('hypeProjekt.webseite') }}</dt>
                    <dd>
                        <a v-if="aussen(daten.webseite.url)" :href="aussen(daten.webseite.url)" target="_blank"
                            rel="noopener noreferrer nofollow">{{ hostVon(daten.webseite.url) }} ↗</a>
                        <span v-if="daten.webseite.titel" class="ppGrau"> · {{ daten.webseite.titel }}</span>
                        <span v-if="daten.webseite.status && daten.webseite.status !== 'ok'" class="ppGrau">
                            · {{ t('hypeProjekt.status_' + daten.webseite.status) }}</span>
                        <span v-if="daten.webseite.plattform" class="ppGrau"> · {{ t('hypeProjekt.plattform', { p: daten.webseite.plattform }) }}</span>
                    </dd>
                </template>
                <template v-if="daten.webseite && hatZahl(daten.webseite.domainAlterTage)">
                    <dt>{{ t('hypeProjekt.domainAlter') }}</dt>
                    <dd>{{ tageText(daten.webseite.domainAlterTage) }}</dd>
                </template>
                <template v-if="kanalListe.length">
                    <dt>{{ t('hypeProjekt.kanaele') }}</dt>
                    <dd>
                        <template v-for="k in kanalListe" :key="k.typ">
                            <a :href="k.url" target="_blank" rel="noopener noreferrer nofollow" class="me-2">{{ k.typ }} ↗</a>
                        </template>
                    </dd>
                </template>
                <template v-if="daten.github">
                    <dt>GitHub</dt>
                    <dd>
                        <a v-if="aussen(daten.github.link)" :href="aussen(daten.github.link)" target="_blank"
                            rel="noopener noreferrer nofollow">{{ githubName }} ↗</a>
                        <span v-if="daten.github.konto" class="ppGrau">
                            · {{ t('hypeProjekt.ghKonto', { a: tageText(daten.github.konto.alterTage), r: daten.github.konto.oeffentlicheRepos, f: daten.github.konto.follower }) }}
                        </span>
                        <div v-if="daten.github.repo" class="ppGrau">
                            {{ t('hypeProjekt.ghRepo', { s: daten.github.repo.sterne, p: tageText(daten.github.repo.letzterPushTage) }) }}
                            <span v-if="daten.github.repo.istFork"> · {{ t('hypeProjekt.ghFork') }}</span>
                        </div>
                        <div v-if="daten.github.fruehereProjekte?.length">
                            {{ t('hypeProjekt.ghFrueher') }}:
                            <span v-for="(p, i) in daten.github.fruehereProjekte" :key="p.name">{{ i ? ', ' : '' }}{{ p.name }} ★{{ p.sterne }}</span>
                        </div>
                    </dd>
                </template>
                <template v-if="daten.ersteller?.wallet">
                    <dt>{{ t('hypeProjekt.ersteller') }}</dt>
                    <dd>
                        <a :href="'https://pump.fun/profile/' + encodeURIComponent(daten.ersteller.wallet)" target="_blank"
                            rel="noopener noreferrer nofollow" :title="daten.ersteller.wallet">{{ kurzAdresse(daten.ersteller.wallet) }} ↗</a>
                        <span v-if="hatZahl(daten.ersteller.andere)" class="ppGrau">
                            · {{ t('hypeProjekt.erstellerBilanz', {
                                n: daten.ersteller.andere + (daten.ersteller.vollstaendig === false ? '+' : ''),
                                g: daten.ersteller.graduiert, h: daten.ersteller.letzte24h }) }}
                        </span>
                        <span v-if="daten.ersteller.besteMarktkapUsd" class="ppGrau">
                            · {{ t('hypeProjekt.erstellerBeste', { m: geld(daten.ersteller.besteMarktkapUsd) }) }}</span>
                        <div v-if="daten.ersteller.beispiele?.length" class="ppGrau">
                            {{ t('hypeProjekt.erstellerBeispiele') }}:
                            <span v-for="(b, i) in daten.ersteller.beispiele" :key="b.mint">{{ i ? ', ' : '' }}{{ b.symbol || kurzAdresse(b.mint) }}</span>
                        </div>
                    </dd>
                </template>
            </dl>
            <p v-if="daten.auszug" class="ppAuszug">„{{ daten.auszug }}"</p>
        </template>
    </div>
</template>

<script setup>
/**
 * Projektprüfung eines Hype-Radar-Funds: Webseite, Domain-Alter, GitHub,
 * Ersteller-Vorgeschichte — und eine Substanz-Note daraus.
 *
 * Die Note steht bewusst NEBEN Hype- und Sicherheitsnote und wird mit keiner
 * verrechnet: Ein Token kann laut sein und nichts dahinter haben, oder still
 * und gut gebaut. Genau diese Spannung soll sichtbar bleiben.
 *
 * Bekommt die gespeicherte Prüfung als `projekt` (aus Lauf oder Frühphase);
 * fehlt sie, prüft ein Klick auf Abruf (`/api/hype-radar/projekt`, 24 h
 * zwischengespeichert, eine erzwungene Prüfung frühestens nach 5 Minuten).
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import InfoTipp from '../InfoTipp.vue'
import { sichereUrl } from '../../utils/sanitize.js'

const props = defineProps({
    /** Kurzfassung einer gespeicherten Prüfung, oder null. */
    projekt: { type: Object, default: null },
    /** {symbol, name, chain, contract} — für eine Prüfung auf Abruf. */
    kandidat: { type: Object, default: null },
})
const emit = defineEmits(['geprueft'])

const { t, locale } = useI18n()

const eigenes = ref(null)
const laedt = ref(false)
const fehler = ref('')

// Ein neuer Kandidat in derselben Instanz (Zeilen werden wiederverwendet):
// das eigene Ergebnis gehört zum alten.
watch(() => props.kandidat?.contract || props.kandidat?.symbol, () => { eigenes.value = null; fehler.value = '' })

const daten = computed(() => eigenes.value || (props.projekt && Object.keys(props.projekt).length ? props.projekt : null))

let anfrage = 0
async function pruefen(neu) {
    const k = props.kandidat
    if (!k) return
    const meine = ++anfrage
    laedt.value = true
    fehler.value = ''
    try {
        const r = await axios.get('/api/hype-radar/projekt', {
            params: { symbol: k.symbol || '', name: k.name || '', chain: k.chain || '', contract: k.contract || '', neu: neu ? '1' : undefined },
        })
        if (meine !== anfrage) return
        eigenes.value = r.data
        emit('geprueft', r.data)
    } catch (e) {
        if (meine !== anfrage) return
        fehler.value = e.response?.data?.error || t('hypeProjekt.fehler')
    } finally {
        if (meine === anfrage) laedt.value = false
    }
}

/*
 * Nur Adressen nach draussen. `sichereUrl` liesse auch einen relativen Pfad
 * durch — der käme hier aus fremden Token-Metadaten und zeigte in die eigene
 * App.
 */
const aussen = (url) => {
    const s = sichereUrl(url)
    return s && /^https?:\/\//i.test(s) ? s : null
}

const befundeVon = (art) => (daten.value?.befunde || []).filter((b) => b.art === art)

const kanalListe = computed(() => Object.entries(daten.value?.kanaele || {})
    .filter(([, url]) => aussen(url))
    .map(([typ, url]) => ({ typ, url: aussen(url) })))

const githubName = computed(() => {
    const g = daten.value?.github
    if (!g) return ''
    const konto = g.konto?.name || ''
    return g.repo?.name ? `${konto}/${g.repo.name}` : (konto || hostVon(g.link))
})

const hatZahl = (w) => w !== null && w !== undefined && w !== '' && Number.isFinite(Number(w))

function notenKlasse(n) {
    if (n >= 65) return 'gut'
    if (n >= 40) return 'mittel'
    return 'schwach'
}

function hostVon(url) {
    try { return new URL(url).hostname.replace(/^www\./, '') } catch { return String(url || '').slice(0, 40) }
}

const kurzAdresse = (a) => (String(a || '').length > 12 ? `${String(a).slice(0, 4)}…${String(a).slice(-4)}` : String(a || ''))

function tageText(tage) {
    if (!hatZahl(tage)) return '—'
    const d = Number(tage)
    if (d < 1) return t('hypeProjekt.unterTag')
    if (d < 60) return t('hypeProjekt.tage', { n: Math.round(d) })
    if (d < 730) return t('hypeProjekt.monate', { n: Math.round(d / 30) })
    return t('hypeProjekt.jahre', { n: (d / 365).toFixed(1) })
}

function geld(n) {
    const z = Number(n)
    if (!Number.isFinite(z) || z <= 0) return '—'
    if (z >= 1e6) return `${(z / 1e6).toFixed(1)} M`
    if (z >= 1e3) return `${Math.round(z / 1e3)} k`
    return String(Math.round(z))
}

const zeitpunkt = (ms) => new Date(Number(ms)).toLocaleString(
    locale.value === 'en' ? 'en-GB' : 'de-CH',
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
</script>

<style scoped>
.pp {
    font-size: .874rem;
}
.ppKopf {
    display: flex;
    align-items: center;
    gap: .45rem;
    flex-wrap: wrap;
    margin-bottom: .35rem;
}
.ppTitel {
    font-size: .851rem;
    font-weight: 600;
}
.ppNote {
    font-weight: 600;
    font-size: .82rem;
    border-radius: 4px;
    padding: .05rem .4rem;
    background: var(--white-10, rgba(255, 255, 255, .1));
}
.ppNote.gut { color: #4caf50; }
.ppNote.mittel { color: #e0b030; }
.ppNote.schwach { color: var(--red-color, #e05252); }
.ppNote.leer { color: var(--grey-color, #9aa0a6); }
.ppZeit, .ppGrau, .ppLeer {
    color: var(--grey-color, #9aa0a6);
}
.ppZeit {
    font-size: .782rem;
}
.ppLeer, .ppFehler {
    margin-bottom: .25rem;
}
.ppFehler {
    color: var(--red-color, #e05252);
}
.ppBefunde {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: .25rem 1rem;
}
.ppBefunde ul {
    padding-left: 1.1rem;
    margin-bottom: .35rem;
}
.ppSpalte {
    font-size: .805rem;
    font-weight: 600;
    color: var(--grey-color, #9aa0a6);
}
.ppSpalte.plus { color: #4caf50; }
.ppSpalte.minus { color: var(--red-color, #e05252); }
.ppFakten {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: .15rem .75rem;
    margin: .25rem 0 0;
}
.ppFakten dt {
    font-weight: 500;
    color: var(--grey-color, #9aa0a6);
}
.ppFakten dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
}
.ppFakten a {
    text-decoration: none;
}
.ppAuszug {
    margin: .4rem 0 0;
    font-style: italic;
    color: var(--white-60, rgba(255, 255, 255, .6));
    overflow-wrap: anywhere;
}
@media (max-width: 576px) {
    .ppFakten {
        grid-template-columns: 1fr;
    }
    .ppFakten dd {
        margin-bottom: .3rem;
    }
}
</style>
