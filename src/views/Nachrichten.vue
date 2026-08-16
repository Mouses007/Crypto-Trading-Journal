<script setup>
/**
 * Seite „Nachrichten" im Modus Live-Analyse.
 *
 * Bewusst eine eigene Seite und keine Kachel im Marktradar: Der Marktradar
 * beantwortet „in welcher Lage sitze ich" mit Zahlen, hier geht es um Text —
 * gelesen wird anders als geschaut, und beides in ein Kachelraster zu pressen
 * hätte beidem geschadet.
 *
 * Drei Teile, in der Reihenfolge, in der man sie morgens braucht:
 * 1. **Lagebericht** — was die KI aus den Beiträgen destilliert hat
 * 2. **Termine** — was heute und diese Woche ansteht
 * 3. **Beiträge** — die Rohquellen, mit Verweis aufs Original
 *
 * Der Wirtschaftskalender gehört hierher und nicht in den Marktradar: ein
 * FOMC-Protokoll ist eine Nachricht mit Datum, keine Kennzahl.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import dayjs from '../utils/dayjs-setup.js'
import { timeZoneTrade } from '../stores/ui.js'
import { spinnerLoadingPage } from '../stores/globals.js'
// Dasselbe Overlay wie im Marktradar — ein Muster für beide Seiten
import RadarOverlay from '../components/RadarOverlay.vue'
import PageInfo from '../components/PageInfo.vue'

const { t, locale } = useI18n()

/** Wochentag in der Oberflächensprache — „Montag" statt „Monday". */
function wochentag(ms) {
    const d = dayjs(ms).tz(zone())
    return new Intl.DateTimeFormat(locale.value === 'en' ? 'en-GB' : 'de-CH', { weekday: 'long' })
        .format(new Date(d.year(), d.month(), d.date())) + ', ' + d.format('DD.MM.')
}

/** Rückblick: einen Tag. So bleiben die heute veröffentlichten Ist-Werte stehen. */
const RUECKBLICK_MS = 24 * 60 * 60 * 1000
const ZEITRAEUME = [
    { tage: 1, key: 'today' },
    { tage: 3, key: 'd3' },
    { tage: 7, key: 'w1' },
    { tage: 14, key: 'w2' },
    { tage: 30, key: 'm1' },
]
/**
 * Wirkungsstufen. „Ab mittel" heisst Untergrenze, nicht Punktauswahl — sonst
 * müsste man zwei Stufen einzeln anklicken, um das Naheliegende zu bekommen.
 * Zur Einordnung, was die Wahl ausmacht (Woche vom 16.08.2026, alle Quellen):
 * nur hoch 8 · ab mittel 21 · alle 96 Termine.
 */
const STUFEN = [
    { wert: 'high', key: 'high' },
    { wert: 'medium', key: 'medium' },
    { wert: 'all', key: 'all' },
]
/** Die acht Währungsräume, die der Feed überhaupt führt. */
const LAENDER = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CAD', 'AUD', 'NZD']

const SPEICHER = 'nachrichten_kalender_tage'
const SPEICHER_IMPACT = 'nachrichten_kalender_impact'
const SPEICHER_LAENDER = 'nachrichten_kalender_laender'
const SPEICHER_TEILUNG = 'nachrichten_teilung'
const SPEICHER_HOEHE = 'nachrichten_hoehen'
const SPEICHER_QUELLEN = 'nachrichten_quellen_aus'
const SPEICHER_MENGE = 'nachrichten_menge'
const SPEICHER_VIDEOS = 'nachrichten_videos_offen'
/** Wie viele Meldungen die Liste führt. Mehr als 200 lässt der Server nicht zu. */
const MENGEN = [20, 40, 100, 200]

// Je Gerät gemerkt, wie der übrige Live-Bereich es auch hält
const zeitraum = ref(Number(localStorage.getItem(SPEICHER)) || 14)
const impact = ref(localStorage.getItem(SPEICHER_IMPACT) || 'medium')
const laender = ref((localStorage.getItem(SPEICHER_LAENDER) || 'USD,JPY').split(',').filter(Boolean))

/** Spaltenverhältnis in Prozent für die linke Spalte (Termine). */
const teilung = ref(Number(localStorage.getItem(SPEICHER_TEILUNG)) || 50)
/** Höhe der beiden Listen in Pixel; 0 heisst „so hoch wie nötig". */
const hoehen = ref(JSON.parse(localStorage.getItem(SPEICHER_HOEHE) || '{"termine":0,"beitraege":0}'))
/** Abgewählte Quellen — nur für die Anzeige, geholt werden sie trotzdem. */
const quellenAus = ref((localStorage.getItem(SPEICHER_QUELLEN) || '').split(',').filter(Boolean))
const menge = ref(Number(localStorage.getItem(SPEICHER_MENGE)) || 40)
/**
 * Videoliste ein- oder ausgeklappt. Zugeklappt als Vorgabe: sie ist die
 * Abrechnung, nicht der Bericht — man sieht sie nach, wenn man wissen will,
 * was ein Lauf gekostet hat. Der Zustand bleibt je Gerät erhalten.
 */
const videosOffen = ref(localStorage.getItem(SPEICHER_VIDEOS) === '1')

function videosUmschalten() {
    videosOffen.value = !videosOffen.value
    localStorage.setItem(SPEICHER_VIDEOS, videosOffen.value ? '1' : '0')
}

const bericht = ref(null)
const verlauf = ref([])
const beitraege = ref([])
const termine = ref([])
const kalenderInfo = ref({})
const newsInfo = ref({})
/**
 * Vollständiger Bestand INKLUSIVE Videos — nur zum Nachschlagen im Fenster.
 * Die sichtbare Liste lässt Videos bewusst weg, aber ein Berichtspunkt, der
 * sich auf einen YouTube-Kanal beruft, muss trotzdem auf etwas zeigen können.
 */
const alleBeitraege = ref([])
const laeuft = ref(false)
/** Welcher Punkt steht gerade im Fenster? -1 = keiner. */
const offenerPunkt = ref(-1)
const punktImFenster = computed(() =>
    offenerPunkt.value >= 0 ? (bericht.value?.punkte || [])[offenerPunkt.value] || null : null)

/**
 * Verweise zum Punkt. Erste Wahl sind die Einzelbelege, die das Modell
 * benannt hat. Fehlen sie — etwa bei älteren Berichten —, wird über den
 * Quellennamen zurückgefallen: besser die Beiträge der genannten Quelle als
 * ein Name ohne Verweis, den niemand nachschlagen kann.
 */
/**
 * Quellennamen vergleichen, ohne an Kleinigkeiten zu scheitern.
 *
 * Die KI schreibt „Real Vision", unsere Quelle heisst „Real Vision (Makro)" —
 * ein einfaches `includes` in eine Richtung findet das nicht. Deshalb: Klammer-
 * zusätze abschneiden, kleinschreiben, und in BEIDE Richtungen prüfen.
 */
function quelleTrifft(genannt, name) {
    const norm = (s) => String(s || '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
    const a = norm(genannt), b = norm(name)
    if (!a || !b) return false
    return a.includes(b) || b.includes(a)
}

/**
 * Bild zu einem Punkt: das erste Vorschaubild unter seinen Belegen.
 *
 * Bewusst keine eigene Bildersuche und schon gar keine Erzeugung — was hier
 * erscheint, hat die Quelle selbst mitgeliefert (geteilter Chart, Titelbild,
 * Video-Vorschau). Damit bleibt der Bericht das, was er sein soll: eine
 * Zusammenfassung von Belegen, nicht eine eigene Bildstrecke.
 */
function punktBild(p) {
    return (p?.belege || []).find(b => b.bild)?.bild || ''
}

const belegeZumPunkt = computed(() => {
    const p = punktImFenster.value
    if (!p) return { liste: [], hergeleitet: false }
    if (p.belege?.length) return { liste: p.belege, hergeleitet: false }

    const genannt = String(p.quelle || '').toLowerCase()
    if (!genannt) return { liste: [], hergeleitet: false }

    // Zweite Wahl: die Beiträge, aus denen dieser Bericht entstand.
    const ausBericht = (bericht.value?.beitraege_liste || [])
        .filter(b => quelleTrifft(genannt, b.quelle))
    if (ausBericht.length) return { liste: ausBericht, hergeleitet: true }

    // Dritte Wahl: der aktuelle Bestand. Bei älteren Berichten, die noch ohne
    // Beitragsliste entstanden, ist das die einzige Möglichkeit, überhaupt auf
    // etwas Klickbares zu zeigen — überschneidet sich bei frischen Berichten
    // ohnehin weitgehend mit dem, was verwendet wurde.
    const ausBestand = alleBeitraege.value
        .filter(b => quelleTrifft(genannt, b.quelle))
        .slice(0, 6)
    return { liste: ausBestand, hergeleitet: ausBestand.length > 0 }
})
const holt = ref(false)
const meldung = ref('')
const fehler = ref(false)

const ART_ICON = { youtube: 'uil uil-youtube', truth: 'uil uil-megaphone', x: 'uil uil-twitter', rss: 'uil uil-rss' }
const IMPACT_FARBE = { high: '#ff5f56', medium: '#e8a33d', low: '#9aa0aa', holiday: '#6b7280' }

const zone = () => timeZoneTrade.value || dayjs.tz.guess()
const zeit = (ms) => dayjs(ms).tz(zone()).format('HH:mm')
const jetzt = Date.now()

/** Termine nach Tagen gruppiert — die Woche als Ganzes lesbar. */
const nachTagen = computed(() => {
    const map = new Map()
    for (const e of termine.value) {
        const k = dayjs(e.dateUnix).tz(zone()).format('YYYY-MM-DD')
        if (!map.has(k)) map.set(k, { tag: e.dateUnix, ereignisse: [] })
        map.get(k).ereignisse.push(e)
    }
    return [...map.values()]
})

/**
 * Reicht der eigene Bestand über den gewählten Zeitraum? Der Feed führt immer
 * nur die laufende Woche; wer „1 Monat" wählt, sieht deshalb ab Woche zwei
 * nichts mehr — und darf das nicht für einen leeren Kalender halten.
 */
const bestandKuerzer = computed(() => {
    const bis = Number(kalenderInfo.value?.bestandBis) || 0
    if (!bis) return false
    return bis < Date.now() + zeitraum.value * 24 * 60 * 60 * 1000 - 12 * 60 * 60 * 1000
})

/** Der nächste Termin bekommt einen Countdown — alles andere nur die Uhrzeit. */
const naechsterTermin = computed(() => termine.value.find(e => e.dateUnix >= jetzt) || null)

/** Welche Quellen liefern gerade Beiträge? Reihenfolge nach Menge. */
const quellenListe = computed(() => {
    const zaehl = {}
    for (const b of beitraege.value) zaehl[b.quelle] = (zaehl[b.quelle] || 0) + 1
    return Object.entries(zaehl).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }))
})

/**
 * Anzeige-Filter, kein Abruf-Filter: Abwählen blendet aus, holt aber weiter.
 * Wer eine Quelle dauerhaft loswerden will, schaltet sie in den Einstellungen
 * ab — dann kostet sie auch keine Abrufe mehr.
 */
const sichtbareBeitraege = computed(() =>
    beitraege.value.filter(b => !quellenAus.value.includes(b.quelle)))

function setzeMenge(n) {
    if (menge.value === n) return
    menge.value = n
    localStorage.setItem(SPEICHER_MENGE, String(n))
    ladeAlles()
}

function toggleQuelle(name) {
    const i = quellenAus.value.indexOf(name)
    if (i >= 0) quellenAus.value.splice(i, 1)
    else quellenAus.value.push(name)
    localStorage.setItem(SPEICHER_QUELLEN, quellenAus.value.join(','))
}

/**
 * Ist-Wert gegen Prognose. Bewusst nur „über/unter der Erwartung" und keine
 * Deutung als gut oder schlecht — ob eine höhere Inflation den Markt hebt oder
 * drückt, hängt von der Lage ab und nicht von der Zahl.
 */
function istBesser(e) {
    const zahl = (s) => {
        const m = String(s || '').replace(/[^\d.,-]/g, '').replace(',', '.')
        const n = Number.parseFloat(m)
        return Number.isFinite(n) ? n : null
    }
    const ist = zahl(e.actual), prog = zahl(e.forecast)
    if (ist === null || prog === null || ist === prog) return null
    return ist > prog
}

function bis(ms) {
    const rest = ms - Date.now()
    if (rest < 0) return null
    const std = Math.floor(rest / 3600000)
    const min = Math.floor((rest % 3600000) / 60000)
    return std >= 24 ? `${Math.floor(std / 24)} d` : std ? `${std} h ${min} min` : `${min} min`
}

async function ladeAlles() {
    spinnerLoadingPage.value = true
    try {
        const [b, n, alleN, k] = await Promise.allSettled([
            axios.get('/api/marktradar/lagebericht'),
            axios.get('/api/marktradar/news', { params: { limit: menge.value } }),
            axios.get('/api/marktradar/news', { params: { limit: 100, mitVideos: 1 } }),
            axios.get('/api/marktradar/kalender', {
                params: {
                    // Der Rückblick ist bewusst fest: Termine von heute Morgen
                    // tragen inzwischen ihren Ist-Wert, und genau der ist das
                    // Interessante daran. Wählbar ist die Vorausschau.
                    von: Date.now() - RUECKBLICK_MS,
                    bis: Date.now() + zeitraum.value * 24 * 60 * 60 * 1000,
                    // Leere Länderliste heisst beim Server: alle
                    laender: laender.value.join(','),
                    impact: impact.value,
                },
            }),
        ])
        if (b.status === 'fulfilled') {
            bericht.value = b.value.data.bericht
            verlauf.value = b.value.data.verlauf || []
        }
        if (n.status === 'fulfilled') {
            beitraege.value = n.value.data.beitraege || []
            newsInfo.value = n.value.data
        }
        if (alleN.status === 'fulfilled') alleBeitraege.value = alleN.value.data.beitraege || []
        if (k.status === 'fulfilled') {
            termine.value = k.value.data.ereignisse || []
            kalenderInfo.value = k.value.data
        }
    } finally {
        spinnerLoadingPage.value = false
    }
}

function setzeZeitraum(tage) {
    if (zeitraum.value === tage) return
    zeitraum.value = tage
    localStorage.setItem(SPEICHER, String(tage))
    ladeAlles()
}

function setzeImpact(wert) {
    impact.value = wert
    localStorage.setItem(SPEICHER_IMPACT, wert)
    ladeAlles()
}

/** Land an- oder abwählen. Keins gewählt heisst: alle zeigen. */
function toggleLand(land) {
    const i = laender.value.indexOf(land)
    if (i >= 0) laender.value.splice(i, 1)
    else laender.value.push(land)
    localStorage.setItem(SPEICHER_LAENDER, laender.value.join(','))
    ladeAlles()
}

/**
 * Spaltenteilung ziehen. Bewusst mit Zeigerereignissen statt Maus, damit es
 * auf dem Tablet genauso geht; Grenzen bei 25/75 Prozent, weil eine Spalte
 * unter einem Viertel Breite nicht mehr lesbar ist.
 */
function starteTeilung(ev) {
    ev.preventDefault()
    const raster = ev.currentTarget.parentElement
    const bewege = (e) => {
        const r = raster.getBoundingClientRect()
        const pct = ((e.clientX - r.left) / r.width) * 100
        teilung.value = Math.max(25, Math.min(75, Math.round(pct)))
    }
    const ende = () => {
        localStorage.setItem(SPEICHER_TEILUNG, String(teilung.value))
        window.removeEventListener('pointermove', bewege)
        window.removeEventListener('pointerup', ende)
    }
    window.addEventListener('pointermove', bewege)
    window.addEventListener('pointerup', ende)
}

/** Höhe einer Liste ziehen. 0 = automatisch, sonst Pixel. */
function starteHoehe(ev, welche) {
    ev.preventDefault()
    const liste = ev.currentTarget.previousElementSibling
    const start = ev.clientY
    const anfang = liste.getBoundingClientRect().height
    const bewege = (e) => {
        hoehen.value[welche] = Math.max(120, Math.round(anfang + (e.clientY - start)))
    }
    const ende = () => {
        localStorage.setItem(SPEICHER_HOEHE, JSON.stringify(hoehen.value))
        window.removeEventListener('pointermove', bewege)
        window.removeEventListener('pointerup', ende)
    }
    window.addEventListener('pointermove', bewege)
    window.addEventListener('pointerup', ende)
}

/** Doppelklick auf den Anfasser: zurück auf automatische Höhe. */
function hoeheZuruecksetzen(welche) {
    hoehen.value[welche] = 0
    localStorage.setItem(SPEICHER_HOEHE, JSON.stringify(hoehen.value))
}

async function beitraegeHolen() {
    holt.value = true
    meldung.value = ''
    try {
        const { data } = await axios.post('/api/marktradar/news/holen')
        meldung.value = data.uebersprungen
            ? t('news.throttled')
            : t('news.fetched', { gesehen: data.gesehen, neu: data.neu })
        await ladeAlles()
    } catch (e) {
        meldung.value = e.response?.data?.error || e.message
        fehler.value = true
    } finally {
        holt.value = false
    }
}

/**
 * Der Bericht kostet Geld — deshalb nur auf ausdrücklichen Knopfdruck, und
 * hinterher steht sichtbar da, was er verbraucht hat.
 */
/**
 * Bericht verwerfen. Fragt vorher, denn er hat Geld gekostet — und löscht
 * bewusst NUR den Bericht: Beiträge und bereits bezahlte Videozusammenfassungen
 * bleiben liegen, sonst zahlt der nächste Lauf sie ein zweites Mal.
 */
async function berichtLoeschen() {
    if (!bericht.value) return
    if (!confirm(t('news.deleteConfirm'))) return
    try {
        const { data } = await axios.delete('/api/marktradar/lagebericht/' + (bericht.value.id || ''))
        meldung.value = t('news.deleted', { n: data.verbleibend })
        offenerPunkt.value = -1
        await ladeAlles()
    } catch (e) {
        meldung.value = e.response?.data?.error || e.message
        fehler.value = true
    }
}

async function berichtErzeugen() {
    laeuft.value = true
    meldung.value = ''
    fehler.value = false
    try {
        const { data } = await axios.post('/api/marktradar/lagebericht/erzeugen')
        if (data.uebersprungen) {
            meldung.value = t('news.digestThrottled')
        } else if (data.fehler) {
            meldung.value = data.fehler
            fehler.value = true
        } else {
            meldung.value = t('news.digestDone', {
                n: data.beitraege, v: data.videos, tok: data.tokens,
                modell: `${data.provider}/${data.modell}`,
            }) + (data.kostenUsd ? ` · ${data.kostenUsd.toFixed(4)} USD` : '')
                + (data.geminiFehler ? ` · Gemini: ${data.geminiFehler}` : '')
        }
        await ladeAlles()
    } catch (e) {
        meldung.value = e.response?.data?.error || e.message
        fehler.value = true
    } finally {
        laeuft.value = false
    }
}

let takt = null
onMounted(() => {
    ladeAlles()
    // Zehn Minuten reichen: Feeds ändern sich langsamer als Kurse
    takt = setInterval(() => { if (!document.hidden) ladeAlles() }, 10 * 60 * 1000)
})
onBeforeUnmount(() => { if (takt) clearInterval(takt) })
</script>

<template>
    <div class="nwSeite">
        <div class="liveHeader">
            <div class="liveTitle">
                <span>{{ t('nav.nachrichten') }}</span>
                <span v-if="bericht" class="liveState">
                    {{ t('news.asOf', { zeit: dayjs(bericht.erstelltAm).format('DD.MM. HH:mm') }) }}
                </span>
            </div>
            <div class="liveActions">
                <button type="button" class="ctl-pill" :disabled="holt" @click="beitraegeHolen">
                    <i class="uil uil-sync"></i>{{ holt ? t('common.loading') : t('news.fetchNow') }}
                </button>
                <button type="button" class="ctl-pill accent" :disabled="laeuft" @click="berichtErzeugen">
                    <i class="uil uil-robot"></i>{{ laeuft ? t('news.working') : t('news.makeDigest') }}
                </button>
                <span class="ctl-sep"></span>
                <PageInfo section="info.nachrichten" />
            </div>
        </div>

        <p v-if="meldung" class="nwMeldung" :class="{ fehler }">{{ meldung }}</p>

        <!--=============== LAGEBERICHT ===============-->
        <section class="nwKarte nwBericht">
            <template v-if="bericht">
                <div class="nwBerichtKopf">
                    <span class="nwMarke">{{ t('news.briefing') }}</span>
                    <span class="nwZeitpunkt">{{ dayjs(bericht.erstelltAm).format('DD.MM.YYYY, HH:mm') }}</span>
                    <button type="button" class="nwLoeschen" :title="t('news.delete')" @click="berichtLoeschen">
                        <i class="uil uil-trash-alt"></i>
                    </button>
                </div>

                <h2 class="nwUeberschrift">{{ bericht.ueberschrift }}</h2>
                <p class="nwLage">{{ bericht.lage }}</p>

                <!-- Kacheln, zwei Spalten. Wichtige Punkte nehmen beide —
                     die Rangfolge ist dann ohne Beschriftung zu sehen. -->
                <div class="nwPunkte">
                    <article v-for="(p, i) in bericht.punkte" :key="i" class="nwPunkt"
                        :class="{ hoch: p.wichtigkeit === 'hoch', offen: offenerPunkt === i }">
                        <button type="button" class="nwPunktKnopf" @click="offenerPunkt = i">
                            <!-- Bild nur, wenn ein Beleg selbst eines mitbringt
                                 (geteilter Chart, Börsen-Screenshot). Nichts wird
                                 erzeugt, nichts kopiert — es zeigt auf das
                                 Original und verschwindet still, wenn es fehlt. -->
                            <img v-if="punktBild(p)" class="nwPunktBild" :src="punktBild(p)" alt=""
                                loading="lazy" @error="$event.target.style.display = 'none'" />
                            <span class="nwPunktKopf">
                                <span class="nwRang">{{ i + 1 }}</span>
                                <span class="nwPunktTitel">{{ p.titel }}</span>
                                <span v-if="p.wichtigkeit === 'hoch'" class="nwWichtig">
                                    {{ t('news.important') }}
                                </span>
                            </span>
                            <span class="nwPunktText">{{ p.text }}</span>
                            <!-- Die Zahlen aus den Quellen, wörtlich. Sie sind
                                 das Einzige am Bericht, was sich nachrechnen
                                 lässt — deshalb stehen sie hervorgehoben da. -->
                            <span v-if="p.kennzahlen && p.kennzahlen.length" class="nwZahlen">
                                <span v-for="(z, k) in p.kennzahlen.slice(0, 3)" :key="k" class="nwZahl">
                                    <b>{{ z.wert }}</b><span>{{ z.was }}</span>
                                </span>
                            </span>
                            <span class="nwPunktFuss">
                                <span class="nwPunktQuelle">{{ p.quelle }}</span>
                                <span v-if="p.belege && p.belege.length" class="nwBelegZahl">
                                    <i class="uil uil-link"></i>{{ p.belege.length }}
                                </span>
                                <i class="uil uil-expand-arrows-alt"></i>
                            </span>
                        </button>
                    </article>
                </div>

                <!-- Was mit den Videos geschah. Eine blosse „0" liess offen, ob
                     keine da waren, keine analysiert werden durften oder die
                     Analyse scheiterte — bei bis zu zehn Rappen je Video ist
                     das der Unterschied zwischen sparsam und kaputt. -->
                <div v-if="bericht.videos_liste && bericht.videos_liste.length" class="nwVideos">
                    <button type="button" class="nwVideosKopf" :aria-expanded="videosOffen"
                        @click="videosUmschalten">
                        <i class="uil" :class="videosOffen ? 'uil-angle-down' : 'uil-angle-right'"></i>
                        {{ t('news.videosHeader') }}
                        <span class="nwVideosZahl">{{ bericht.videos_liste.length }}</span>
                    </button>
                    <a v-for="(vi, k) in (videosOffen ? bericht.videos_liste : [])" :key="k" class="nwVideo"
                        :href="vi.url" target="_blank" rel="noopener noreferrer">
                        <i class="uil uil-youtube"></i>
                        <span class="nwBelegQuelle">{{ vi.quelle }}</span>
                        <span class="nwBelegTitel">{{ vi.titel }}</span>
                        <!-- Drei Zustände, die man auseinanderhalten muss:
                             heute bezahlt, früher bezahlt (gratis wiederverwendet),
                             gescheitert. Nur so sieht man, wofür Geld floss. -->
                        <span class="nwVideoErgebnis"
                            :class="vi.ergebnis === 'ok' ? 'ok' : (vi.ergebnis === 'übernommen' ? 'alt' : 'schlecht')">
                            {{ vi.ergebnis === 'ok' ? ((vi.kostenUsd * 0.8).toFixed(2) + ' CHF')
                                : (vi.ergebnis === 'übernommen' ? t('news.videoReused') : vi.ergebnis) }}
                        </span>
                    </a>
                </div>
                <p v-else-if="!bericht.videos" class="nwHinweis">{{ t('news.noVideos') }}</p>

                <p v-if="bericht.hinweis" class="nwWarnung">
                    <i class="uil uil-exclamation-triangle"></i>{{ bericht.hinweis }}
                </p>

                <p class="nwFuss">
                    <span class="nwKiMarke">{{ t('news.aiMark') }}</span>
                    {{ t('news.digestFooter', {
                        n: bericht.beitraege, v: bericht.videos, nv: bericht.videosNeu || 0,
                        modell: `${bericht.provider}/${bericht.modell}`, tok: bericht.tokens,
                    }) }}
                    <span v-if="bericht.kostenUsd"> · {{ (bericht.kostenUsd * 0.8).toFixed(2) }} CHF</span>
                </p>
            </template>

            <div v-else class="nwLeer">
                <i class="uil uil-newspaper"></i>
                <span>{{ t('news.noDigest') }}</span>
            </div>
        </section>

        <!-- Ein Punkt im Fenster: der volle Text und die Beiträge, auf denen
             er beruht. Erst das macht den Bericht nachprüfbar statt behauptet. -->
        <RadarOverlay v-if="punktImFenster" :titel="punktImFenster.titel"
            :quelle="t('news.evidenceSource')" @schliessen="offenerPunkt = -1">
            <div class="nwFenster">
                <p v-if="punktImFenster.wichtigkeit === 'hoch'" class="nwWichtigGross">
                    {{ t('news.important') }}
                </p>
                <img v-if="punktBild(punktImFenster)" class="nwFensterBild"
                    :src="punktBild(punktImFenster)" alt=""
                    @error="$event.target.style.display = 'none'" />
                <p class="nwFensterText">{{ punktImFenster.text }}</p>
                <div v-if="punktImFenster.kennzahlen && punktImFenster.kennzahlen.length" class="nwZahlen">
                    <span v-for="(z, k) in punktImFenster.kennzahlen" :key="k" class="nwZahl">
                        <b>{{ z.wert }}</b><span>{{ z.was }}</span>
                    </span>
                </div>

                <h4 class="nwFensterTitel">
                    {{ belegeZumPunkt.hergeleitet
                        ? t('news.evidenceDerived', { quelle: punktImFenster.quelle })
                        : t('news.evidence', { n: belegeZumPunkt.liste.length }) }}
                </h4>

                <template v-if="belegeZumPunkt.liste.length">
                    <a v-for="(b, j) in belegeZumPunkt.liste" :key="j" class="nwBeleg"
                        :href="b.url" target="_blank" rel="noopener noreferrer">
                        <i :class="ART_ICON[b.art] || ART_ICON.rss"></i>
                        <span class="nwBelegQuelle">{{ b.quelle }}</span>
                        <span class="nwBelegTitel">{{ b.titel }}</span>
                        <i class="uil uil-external-link-alt"></i>
                    </a>
                </template>
                <p v-else class="nwOhneBeleg">
                    {{ t('news.noEvidence', { quelle: punktImFenster.quelle }) }}
                </p>
            </div>
        </RadarOverlay>

        <div class="nwSpalten" :style="{ gridTemplateColumns: teilung + 'fr ' + (100 - teilung) + 'fr' }">
            <!--=============== TERMINE ===============-->
            <section class="nwKarte">
                <h3 class="nwAbschnitt">
                    <i class="uil uil-calendar-alt"></i>{{ t('news.calendar') }}
                    <span v-if="naechsterTermin" class="nwCountdown">
                        {{ t('news.nextIn', { zeit: bis(naechsterTermin.dateUnix) }) }}
                    </span>
                </h3>

                <div class="nwZeitraum" :title="t('news.rangeHint')">
                    <button v-for="z in ZEITRAEUME" :key="z.tage" type="button"
                        class="ctl-pill" :class="{ active: zeitraum === z.tage }"
                        @click="setzeZeitraum(z.tage)">
                        {{ t('news.range.' + z.key) }}
                    </button>
                </div>

                <div class="nwFilter">
                    <button v-for="s in STUFEN" :key="s.wert" type="button"
                        class="ctl-pill" :class="{ active: impact === s.wert }"
                        :title="t('news.impactHint')" @click="setzeImpact(s.wert)">
                        {{ t('news.impact.' + s.key) }}
                    </button>
                    <span class="nwTrenner"></span>
                    <button v-for="l in LAENDER" :key="l" type="button"
                        class="ctl-pill klein" :class="{ active: laender.includes(l) }"
                        :title="t('news.countryHint')" @click="toggleLand(l)">
                        {{ l }}
                    </button>
                </div>

                <div v-if="!termine.length" class="nwLeer klein">
                    <span>{{ kalenderInfo.gesamtImZeitraum
                        ? t('news.calFiltered', { n: kalenderInfo.gesamtImZeitraum })
                        : t('news.calEmpty') }}</span>
                </div>

                <div v-else class="nwKalender"
                    :style="hoehen.termine ? { maxHeight: hoehen.termine + 'px', overflowY: 'auto' } : {}">
                    <div class="nwSpaltenkopf">
                        <span>{{ t('news.previous') }}</span>
                        <span>{{ t('news.forecast') }}</span>
                        <span>{{ t('news.actual') }}</span>
                    </div>

                    <div v-for="g in nachTagen" :key="g.tag" class="nwTag">
                        <div class="nwTagKopf">{{ wochentag(g.tag) }}</div>
                        <div v-for="e in g.ereignisse" :key="e.extId" class="nwTermin"
                            :class="{ vorbei: e.dateUnix < jetzt }">
                            <i class="nwPunktFarbe" :style="{ background: IMPACT_FARBE[e.impact] }"></i>
                            <span class="nwZeit">{{ zeit(e.dateUnix) }}</span>
                            <span class="nwLand">{{ e.land }}</span>
                            <span class="nwTerminTitel">{{ e.titel }}</span>
                            <!-- Drei Werte, die zusammen erst eine Aussage ergeben:
                                 erwartet, vorher, tatsächlich. Ohne den Vorwert
                                 sagt eine Prognose von 0,5 % nichts. -->
                            <span class="nwWerte">
                                <span v-if="e.previous" class="nwVor" :title="t('news.previous')">
                                    {{ e.previous }}
                                </span>
                                <span v-if="e.forecast" class="nwProg" :title="t('news.forecast')">
                                    {{ e.forecast }}
                                </span>
                                <b v-if="e.actual" class="nwIst"
                                    :class="{ besser: istBesser(e), schlechter: istBesser(e) === false }"
                                    :title="t('news.actual')">{{ e.actual }}</b>
                            </span>
                        </div>
                    </div>
                </div>

                <div class="nwGriff" :title="t('news.resizeHint')"
                    @pointerdown="starteHoehe($event, 'termine')"
                    @dblclick="hoeheZuruecksetzen('termine')"></div>

                <p v-if="bestandKuerzer" class="nwHinweis">
                    {{ t('news.stockUntil', {
                        datum: dayjs(kalenderInfo.bestandBis).tz(zone()).format('DD.MM')
                    }) }}
                </p>
            </section>

            <div class="nwTeiler" :title="t('news.splitHint')" @pointerdown="starteTeilung"></div>

            <!--=============== BEITRÄGE ===============-->
            <section class="nwKarte">
                <h3 class="nwAbschnitt">
                    <i class="uil uil-rss"></i>{{ t('news.posts') }}
                    <span v-if="newsInfo.ausgeblendet && newsInfo.filterAn" class="nwCountdown">
                        {{ t('news.hidden', { n: newsInfo.ausgeblendet }) }}
                    </span>
                </h3>

                <div class="nwFilter">
                    <button v-for="m in MENGEN" :key="m" type="button"
                        class="ctl-pill" :class="{ active: menge === m }"
                        :title="t('news.countHint')" @click="setzeMenge(m)">
                        {{ m }}
                    </button>
                    <span class="nwTrenner"></span>
                    <span class="nwAnzahl">{{ t('news.showing', {
                        n: sichtbareBeitraege.length, gesamt: beitraege.length
                    }) }}</span>
                </div>

                <div v-if="quellenListe.length" class="nwFilter">
                    <button v-for="q in quellenListe" :key="q.name" type="button"
                        class="ctl-pill klein" :class="{ active: !quellenAus.includes(q.name) }"
                        :title="t('news.sourceHint')" @click="toggleQuelle(q.name)">
                        {{ q.name }} <span class="nwAnzahl">{{ q.n }}</span>
                    </button>
                </div>

                <div v-if="!sichtbareBeitraege.length" class="nwLeer klein">
                    <span>{{ beitraege.length ? t('news.allHidden') : t('news.noPosts') }}</span>
                </div>

                <div class="nwListe"
                    :style="hoehen.beitraege ? { maxHeight: hoehen.beitraege + 'px', overflowY: 'auto' } : {}">
                <a v-for="b in sichtbareBeitraege" :key="b.id" class="nwBeitrag" :href="b.url"
                    target="_blank" rel="noopener noreferrer">
                    <!-- Vorschaubild vom Original geladen, nichts kopiert.
                         Fällt es aus (toter Verweis, Blocker), verschwindet es
                         still statt ein kaputtes Symbol zu hinterlassen. -->
                    <img v-if="b.bild" :src="b.bild" class="nwBild" alt=""
                        :loading="sichtbareBeitraege.indexOf(b) < 8 ? 'eager' : 'lazy'"
                        @error="$event.target.style.display = 'none'" />
                    <div class="nwBeitragKopf">
                        <i :class="ART_ICON[b.art] || ART_ICON.rss"></i>
                        <span class="nwQuelle">{{ b.quelle }}</span>
                        <span class="nwZeit">{{ dayjs(b.publishedAt).tz(zone()).format('DD.MM. HH:mm') }}</span>
                    </div>
                    <div class="nwBeitragTitel">{{ b.titel }}</div>
                    <div v-if="b.zusammenfassung" class="nwBeitragFassung">
                        <span class="nwKiMarke">{{ t('news.aiMark') }}</span>{{ b.zusammenfassung }}
                    </div>
                    <div v-else-if="b.auszug" class="nwVorschau">{{ b.auszug }}</div>
                </a>
                </div>

                <div class="nwGriff" :title="t('news.resizeHint')"
                    @pointerdown="starteHoehe($event, 'beitraege')"
                    @dblclick="hoeheZuruecksetzen('beitraege')"></div>
            </section>
        </div>
    </div>
</template>

<style scoped>
.nwSeite {
    padding-bottom: 2rem;
}

.nwMeldung {
    margin: 0 0 0.6rem;
    font-size: 0.84rem;
    color: var(--white-60);
}

.nwMeldung.fehler {
    color: rgb(250, 140, 130);
}

.nwKarte {
    background: var(--black-bg-2, #16161d);
    border-radius: var(--border-radius, 8px);
    box-shadow: var(--shadow-sm);
    padding: 1rem 1.1rem;
    margin-bottom: 1rem;
}

/* ── Lagebericht ── */
.nwBerichtKopf {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.5rem;
}

.nwMarke {
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    background: rgba(38, 190, 150, 0.14);
    color: #26be96;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

.nwZeitpunkt {
    font-size: 0.76rem;
    color: var(--white-60);
}

.nwUeberschrift {
    margin: 0 0 0.5rem;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--white-87);
    line-height: 1.3;
}

.nwLage {
    margin: 0 0 1rem;
    font-size: 0.96rem;
    line-height: 1.55;
    color: var(--white-75, rgba(255, 255, 255, 0.75));
}

/* Genau zwei Spalten ab 900 px, darunter eine. Bewusst fest statt `auto-fill`:
   das hätte am breiten Bildschirm drei oder vier Streifen ergeben, und ein
   Absatz von fünf Sätzen liest sich in einer schmalen Spalte schlecht. */
.nwPunkte {
    display: grid;
    grid-template-columns: 1fr;
    align-items: start;
    gap: 0.6rem;
}

@media (min-width: 900px) {
    .nwPunkte {
        grid-template-columns: 1fr 1fr;
    }
}

.nwPunkt {
    border-radius: var(--border-radius, 6px);
    background: rgba(255, 255, 255, 0.025);
    border-left: 3px solid var(--white-12, rgba(255, 255, 255, 0.12));
    overflow: hidden;
    transition: background 0.15s;
}

/* Alle Kacheln gleich breit — wichtige Punkte werden über Farbe und die
   Beschriftung hervorgehoben, nicht über die Breite. Eine Kachel quer über
   beide Spalten riss das Raster auseinander. */

.nwPunkt:hover {
    background: rgba(255, 255, 255, 0.05);
}

.nwPunkt.offen {
    background: rgba(255, 255, 255, 0.05);
}

/* Der ganze Kopf ist der Schalter — ein kleines Pfeilchen zu treffen ist
   auf dem Tablet Glückssache */
.nwPunktKnopf {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.4rem;
    width: 100%;
    padding: 0.7rem 0.8rem 0.6rem;
    background: none;
    border: 0;
    text-align: left;
    color: inherit;
    cursor: pointer;
}

/* Das Bild sitzt bündig in der Kachel, oberhalb des Textes. Feste Höhe,
   damit ein Hochformat-Bild die Kachel nicht in die Länge zieht. */
.nwPunktBild {
    width: calc(100% + 1.6rem);
    margin: -0.7rem -0.8rem 0.2rem;
    height: 150px;
    object-fit: cover;
    display: block;
}

.nwPunktKopf {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
}

.nwPunktFuss {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.1rem;
    color: var(--white-60);
    font-size: 0.74rem;
}

.nwPunktQuelle {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* Kennzahlen: die einzigen nachrechenbaren Angaben im Bericht */
.nwZahlen {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin: 0.1rem 0;
}

.nwZahl {
    display: inline-flex;
    align-items: baseline;
    gap: 0.3rem;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--white-12, rgba(255, 255, 255, 0.12));
    font-size: 0.74rem;
    color: var(--white-60);
}

.nwZahl b {
    font-size: 0.84rem;
    color: var(--white-87);
    font-weight: 600;
}

.nwFensterBild {
    width: 100%;
    max-height: 320px;
    object-fit: cover;
    border-radius: var(--border-radius, 6px);
    margin: 0 0 0.9rem;
}

.nwRang {
    flex: 0 0 auto;
    width: 1.35rem;
    height: 1.35rem;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    color: var(--white-60);
    font-size: 0.72rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
}

.nwPunkt.hoch .nwRang {
    background: rgba(232, 163, 61, 0.18);
    color: #e8a33d;
}

.nwWichtig {
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    background: rgba(232, 163, 61, 0.16);
    color: #e8a33d;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
}

.nwBelegZahl {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
}

/* ── Belege im Fenster ── */
.nwFenster {
    max-width: 760px;
}

.nwWichtigGross {
    display: inline-block;
    margin: 0 0 0.6rem;
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    background: rgba(232, 163, 61, 0.16);
    color: #e8a33d;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.nwFensterText {
    margin: 0 0 1.2rem;
    font-size: 1rem;
    line-height: 1.6;
    color: var(--white-87);
}

.nwFensterTitel {
    margin: 0 0 0.3rem;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--white-60);
}

.nwBeleg {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.28rem 0;
    font-size: 0.82rem;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
    text-decoration: none;
    border-top: 1px solid var(--white-12, rgba(255, 255, 255, 0.06));
}

.nwBeleg:hover {
    color: var(--white-87);
}

.nwBelegQuelle {
    flex: 0 0 auto;
    font-weight: 600;
    color: var(--white-60);
}

.nwBelegTitel {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.nwOhneBeleg {
    margin: 0;
    padding-top: 0.4rem;
    font-size: 0.8rem;
    color: var(--white-60);
    border-top: 1px solid var(--white-12, rgba(255, 255, 255, 0.06));
}

/* Wichtiges hebt sich ab, ohne zu schreien */
.nwPunkt.hoch {
    border-left-color: #e8a33d;
}

.nwPunktTitel {
    flex: 1 1 auto;
    min-width: 0;
    font-weight: 600;
    color: var(--white-87);
    line-height: 1.35;
}

/* Der ganze Absatz steht in der Kachel — abgeschnitten wird erst, wenn ein
   Punkt aus dem Rahmen fällt (zehn Zeilen), damit eine einzelne Ausreisser-
   Antwort das Raster nicht auseinanderzieht. Der volle Text steht im Fenster. */
.nwPunktText {
    display: -webkit-box;
    -webkit-line-clamp: 10;
    line-clamp: 10;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.55;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
}

.nwFuss {
    margin: 1rem 0 0;
    padding-top: 0.6rem;
    border-top: 1px solid var(--white-12, rgba(255, 255, 255, 0.08));
    font-size: 0.78rem;
    color: var(--white-60);
}

.nwLoeschen {
    margin-left: auto;
    background: none;
    border: 0;
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    color: var(--white-60);
    cursor: pointer;
}

.nwLoeschen:hover {
    color: rgb(255, 120, 110);
    background: rgba(255, 95, 86, 0.12);
}

.nwVideos {
    margin-top: 1rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--white-12, rgba(255, 255, 255, 0.08));
}

.nwVideosKopf {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0;
    background: none;
    border: 0;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--white-60);
    margin-bottom: 0.2rem;
    cursor: pointer;
}

.nwVideosKopf:hover {
    color: var(--white-87);
}

.nwVideosZahl {
    padding: 0 0.35rem;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.08);
    font-size: 0.68rem;
}

.nwVideo {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.2rem 0;
    font-size: 0.82rem;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
    text-decoration: none;
}

.nwVideo:hover {
    color: var(--white-87);
}

.nwVideoErgebnis {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.nwVideoErgebnis.ok {
    color: #26be96;
}

.nwVideoErgebnis.alt {
    color: var(--white-60);
}

.nwVideoErgebnis.schlecht {
    color: rgb(250, 190, 60);
}

.nwWarnung {
    margin: 0.6rem 0 0;
    font-size: 0.82rem;
    color: rgb(250, 190, 60);
}

.nwKiMarke {
    display: inline-block;
    margin-right: 0.35rem;
    padding: 0 0.35rem;
    border-radius: 3px;
    background: rgba(240, 196, 25, 0.16);
    color: rgba(240, 196, 25, 0.95);
    font-size: 0.7rem;
}

/* ── Zwei Spalten, auf schmalem Schirm untereinander ── */
.nwSpalten {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    align-items: start;
    position: relative;
}

/* Teiler zwischen den Spalten — sichtbar erst beim Darüberfahren, damit er
   im Ruhezustand nicht als Trennlinie missverstanden wird */
.nwTeiler {
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 10px;
    margin-left: -5px;
    cursor: col-resize;
    touch-action: none;
    z-index: 2;
}

.nwTeiler::after {
    content: '';
    position: absolute;
    left: 4px;
    top: 10%;
    bottom: 10%;
    width: 2px;
    background: var(--white-12, rgba(255, 255, 255, 0.1));
    opacity: 0;
    transition: opacity 0.15s;
}

.nwTeiler:hover::after {
    opacity: 1;
}

/* Höhen-Anfasser unter jeder Liste */
.nwGriff {
    height: 10px;
    margin-top: 0.3rem;
    cursor: row-resize;
    touch-action: none;
    border-radius: 3px;
}

.nwGriff::after {
    content: '';
    display: block;
    width: 42px;
    height: 3px;
    margin: 3px auto;
    border-radius: 2px;
    background: var(--white-12, rgba(255, 255, 255, 0.12));
}

.nwGriff:hover::after {
    background: var(--white-38, rgba(255, 255, 255, 0.32));
}

.nwAnzahl {
    opacity: 0.55;
}

@media (max-width: 991px) {
    /* Auf schmalem Schirm untereinander — dann ist eine Spaltenteilung
       gegenstandslos, und der Teiler würde nur im Weg liegen */
    .nwSpalten {
        grid-template-columns: 1fr !important;
    }

    .nwTeiler {
        display: none;
    }
}

.nwAbschnitt {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0 0 0.7rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--white-87);
}

.nwCountdown {
    margin-left: auto;
    font-size: 0.76rem;
    font-weight: 400;
    color: var(--white-60);
}

.nwFilter {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    margin-bottom: 0.6rem;
    flex-wrap: wrap;
}

.nwFilter .ctl-pill {
    padding: 0.05rem 0.45rem;
    font-size: 0.72rem;
}

.nwFilter .ctl-pill.klein {
    font-size: 0.68rem;
    letter-spacing: 0.02em;
}

.nwTrenner {
    width: 1px;
    height: 14px;
    margin: 0 0.3rem;
    background: var(--white-12, rgba(255, 255, 255, 0.15));
}

.nwZeitraum {
    display: flex;
    gap: 0.2rem;
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
}

.nwZeitraum .ctl-pill {
    padding: 0.05rem 0.5rem;
    font-size: 0.74rem;
}

/* ── Termine ── */
.nwSpaltenkopf {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--white-60);
    opacity: 0.7;
}

.nwSpaltenkopf span {
    min-width: 3.2rem;
    text-align: right;
}

.nwTagKopf {
    margin: 0.8rem 0 0.25rem;
    font-size: 0.76rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--white-60);
    border-bottom: 1px solid var(--white-12, rgba(255, 255, 255, 0.08));
}

.nwTermin {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.22rem 0;
    font-size: 0.86rem;
}

.nwTermin.vorbei {
    opacity: 0.45;
}

.nwPunktFarbe {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: 0 0 auto;
}

.nwZeit {
    font-variant-numeric: tabular-nums;
    color: var(--white-60);
}

.nwLand {
    font-weight: 600;
    color: var(--white-87);
}

.nwTerminTitel {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
}

.nwWerte {
    margin-left: auto;
    padding-left: 0.5rem;
    display: flex;
    gap: 0.5rem;
    font-variant-numeric: tabular-nums;
    color: var(--white-60);
    white-space: nowrap;
}

.nwWerte > * {
    min-width: 3.2rem;
    text-align: right;
}

.nwVor {
    opacity: 0.55;
}

.nwProg {
    color: var(--white-75, rgba(255, 255, 255, 0.75));
}

.nwIst {
    color: var(--white-87);
}

/* Über oder unter der Erwartung — ohne Wertung, nur als Richtung */
.nwIst.besser {
    color: #26be96;
}

.nwIst.schlechter {
    color: #ff5f56;
}

/* ── Beiträge ── */
.nwBeitrag {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-areas: 'bild kopf' 'bild titel' 'bild text';
    column-gap: 0.6rem;
    padding: 0.45rem 0;
    border-bottom: 1px solid var(--white-12, rgba(255, 255, 255, 0.07));
    text-decoration: none;
    color: inherit;
}

.nwBeitrag:hover {
    background: rgba(255, 255, 255, 0.03);
}

.nwBild {
    grid-area: bild;
    width: 84px;
    height: 52px;
    object-fit: cover;
    border-radius: 4px;
    align-self: start;
}

.nwBeitragKopf {
    grid-area: kopf;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.74rem;
    color: var(--white-60);
}

.nwQuelle {
    font-weight: 600;
}

.nwBeitragKopf .nwZeit {
    margin-left: auto;
}

.nwBeitragTitel {
    grid-area: titel;
    font-size: 0.9rem;
    line-height: 1.35;
    color: var(--white-87);
}

/* Vorschau: drei Zeilen, sauber abgeschnitten. Mehr wäre eine Volltextkopie
   fremder Inhalte — der ganze Text steht beim Original. */
.nwVorschau {
    grid-area: text;
    margin-top: 0.15rem;
    font-size: 0.82rem;
    line-height: 1.45;
    color: var(--white-60);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.nwBeitragFassung {
    grid-area: text;
    margin-top: 0.2rem;
    font-size: 0.84rem;
    line-height: 1.45;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
}

.nwHinweis {
    margin: 0.7rem 0 0;
    font-size: 0.78rem;
    color: var(--white-60);
    line-height: 1.4;
}

.nwLeer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    padding: 2.2rem 1rem;
    text-align: center;
    color: var(--white-60);
    font-size: 0.88rem;
}

.nwLeer.klein {
    padding: 1.2rem 0.5rem;
    font-size: 0.84rem;
}

.nwLeer i {
    font-size: 1.8rem;
    opacity: 0.45;
}
</style>
