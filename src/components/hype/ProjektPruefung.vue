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
            <!-- Eine Liste, Warnungen zuerst. Die Fakten dahinter (Domain-Alter,
                 Sterne, Ersteller-Bilanz) stehen bereits in den Befunden; die
                 Links darunter tragen die Einzelheiten im Tooltip. -->
            <ul v-if="befunde.length" class="ppBefunde">
                <li v-for="(b, i) in befunde" :key="i" :class="b.art">
                    <span class="ppZeichen">{{ ZEICHEN[b.art] || '·' }}</span>{{ b.text }}
                </li>
            </ul>
            <div v-if="links.length" class="ppLinks">
                <a v-for="l in links" :key="l.url" :href="l.url" :title="l.titel" target="_blank"
                    rel="noopener noreferrer nofollow">{{ l.text }} ↗</a>
            </div>
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

/* Warnungen zuerst: bei jungen Token wiegt ein Minus schwerer als ein Plus. */
const ZEICHEN = { minus: '−', plus: '+', info: 'i' }
const REIHE = ['minus', 'plus', 'info']
const befunde = computed(() => [...(daten.value?.befunde || [])]
    .sort((a, b) => REIHE.indexOf(a.art) - REIHE.indexOf(b.art)))

/** Webseite, Kanäle, GitHub, Ersteller — eine Zeile, Einzelheiten im Tooltip. */
const links = computed(() => {
    const d = daten.value
    if (!d) return []
    const raus = []
    const w = d.webseite || {}
    if (aussen(w.url)) {
        raus.push({
            url: aussen(w.url), text: hostVon(w.url),
            titel: [w.titel,
                hatZahl(w.domainAlterTage) ? `${t('hypeProjekt.domainAlter')}: ${tageText(w.domainAlterTage)}` : '',
                w.plattform ? t('hypeProjekt.plattform', { p: w.plattform }) : ''].filter(Boolean).join(' · '),
        })
    }
    for (const [typ, url] of Object.entries(d.kanaele || {})) {
        if (typ === 'github' && d.github) continue
        if (aussen(url)) raus.push({ url: aussen(url), text: typ, titel: url })
    }
    const g = d.github
    if (g && aussen(g.link)) {
        raus.push({
            url: aussen(g.link), text: `GitHub ${githubName.value}`,
            titel: [
                g.konto ? t('hypeProjekt.ghKonto', { a: tageText(g.konto.alterTage), r: g.konto.oeffentlicheRepos, f: g.konto.follower }) : '',
                g.repo ? t('hypeProjekt.ghRepo', { s: g.repo.sterne, p: tageText(g.repo.letzterPushTage) }) + (g.repo.istFork ? ` · ${t('hypeProjekt.ghFork')}` : '') : '',
                g.fruehereProjekte?.length ? `${t('hypeProjekt.ghFrueher')}: ${g.fruehereProjekte.map((p) => `${p.name} ★${p.sterne}`).join(', ')}` : '',
            ].filter(Boolean).join('\n'),
        })
    }
    const e = d.ersteller
    if (e?.wallet) {
        raus.push({
            url: `https://pump.fun/profile/${encodeURIComponent(e.wallet)}`,
            text: `${t('hypeProjekt.ersteller')} ${kurzAdresse(e.wallet)}`,
            titel: [
                e.wallet,
                hatZahl(e.andere) ? t('hypeProjekt.erstellerBilanz', {
                    n: e.andere + (e.vollstaendig === false ? '+' : ''), g: e.graduiert, h: e.letzte24h }) : '',
                e.besteMarktkapUsd ? t('hypeProjekt.erstellerBeste', { m: geld(e.besteMarktkapUsd) }) : '',
                e.beispiele?.length ? `${t('hypeProjekt.erstellerBeispiele')}: ${e.beispiele.map((b) => b.symbol || kurzAdresse(b.mint)).join(', ')}` : '',
            ].filter(Boolean).join('\n'),
        })
    }
    return raus
})

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
    list-style: none;
    padding-left: 0;
    margin-bottom: .3rem;
}
.ppBefunde li {
    display: flex;
    gap: .45rem;
    margin-bottom: .1rem;
}
.ppZeichen {
    flex: 0 0 .8rem;
    font-weight: 700;
    text-align: center;
    color: var(--grey-color, #9aa0a6);
}
.ppBefunde li.plus .ppZeichen { color: #4caf50; }
.ppBefunde li.minus .ppZeichen { color: var(--red-color, #e05252); }
.ppLinks {
    display: flex;
    flex-wrap: wrap;
    gap: .2rem .8rem;
}
.ppLinks a {
    text-decoration: none;
}
.ppAuszug {
    margin: .4rem 0 0;
    font-style: italic;
    color: var(--white-60, rgba(255, 255, 255, .6));
    overflow-wrap: anywhere;
}
</style>
