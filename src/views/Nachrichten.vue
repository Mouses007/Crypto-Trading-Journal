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
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import axios from 'axios'
import dayjs from '../utils/dayjs-setup.js'
import { timeZoneTrade } from '../stores/ui.js'
import { spinnerLoadingPage, currentUser } from '../stores/globals.js'
import { dbUpdateSettings } from '../utils/db.js'
import { useKostenAnzeige } from '../utils/formatters.js'
import { sendNotification } from '../utils/notify.js'
// Dasselbe Overlay wie im Marktradar — ein Muster für beide Seiten
import RadarOverlay from '../components/RadarOverlay.vue'
import PageInfo from '../components/PageInfo.vue'

const { t, locale } = useI18n()
const router = useRouter()

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
const SPEICHER_SCHNELL = 'nachrichten_schnell_offen'
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

// Videoliste des Berichts ohne Livestreams: die sollen gar nicht erwähnt
// werden (Nutzerwunsch). Neue Berichte loggen sie serverseitig nicht mehr;
// der Filter hier räumt auch die Altbestände in schon gespeicherten
// Berichten weg.
const sichtbareVideos = computed(() =>
    (bericht.value?.videos_liste || []).filter(v => v.ergebnis !== 'Livestream'))
const verlauf = ref([])
/** Der jüngste Bericht — Rückkehrpunkt, wenn im Archiv geblättert wurde. */
const aktuellerBericht = ref(null)
/** Archivliste ein-/ausgeklappt. */
const archivOffen = ref(false)
/** Zwei-Klick-Löschen im Archiv: merkt sich, welche Zeile bestätigt werden muss. */
const archivLoeschId = ref(0)
/** Aufgeklappte Video-Stichpunkte in der Beitragsliste (Beitrags-IDs). */
const aufgeklappt = ref([])
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

/** Kapitel des Berichts — leer bei Berichten aus der Zeit vor den Kapiteln. */
const kapitelListe = computed(() =>
    (bericht.value?.kapitel || []).filter(k => k && (k.lage || k.punkte?.length)))

/**
 * Zeitung statt Kachelwand.
 *
 * Vorher standen ALLE Punkte als gleich grosse Kacheln in drei Spalten unter
 * dem Bericht — bei drei Kapiteln à fünf Punkten sind das fünfzehn Karten, die
 * jede Gewichtung einebnen und den Zeitungssatz darüber zur Dekoration machen.
 * Jetzt gilt die Aufteilung einer echten Seite: ein paar Top-Meldungen oben, der
 * Rest als Artikel in seinem Kapitel.
 *
 * `wichtigkeit` liefert das Modell ohnehin schon mit — es wurde bislang nur
 * für einen farbigen Rahmen benutzt.
 *
 * Der Index in die FLACHE Liste wird mitgeführt: das Belegfenster adressiert
 * Punkte darüber, und die Kapitel-Punkte sind dieselben Objekte.
 *
 * Vier Modi, weil drei zu wenig waren:
 *
 *   kombiniert — Top-Meldungen als Kachel, der Rest als Artikel (Vorgabe)
 *   artikel    — reine Zeitung, gar keine Kacheln
 *   kacheln    — alles als Kachel, wie vor dem Umbau
 *   dossier    — Tabellen, Kennzahlen und Bilder statt Fliesstext
 *
 * Das Dossier ist keine vierte Anordnung derselben Absätze, sondern eine andere
 * Frage an denselben Bericht: nicht „lies mich", sondern „überflieg mich". Es
 * zeigt zuerst das Nachschlagbare — den gemessenen Marktstand, die Termine der
 * nächsten Stunden, die wörtlichen Kennzahlen je Kapitel — und erst darunter
 * die Meldungen, jede mit Bild, Kennzahlen und Belegzahl in einer Zeile. Alles
 * daraus liegt bereits vor; erfunden oder nachgeladen wird nichts.
 *
 * Vorgabe ist `dossier`. Ein unbekannter Wert (etwa das kurzzeitig gespeicherte
 * „zeitung") fällt ebenfalls darauf zurück.
 */
const LAYOUTS = ['dossier', 'kombiniert', 'artikel', 'kacheln']
/** Was gilt, solange nichts gewählt wurde — und wohin ein unbekannter Wert fällt. */
const LAYOUT_VORGABE = 'dossier'
/** Sinnbild je Spalte der Abwägung — Richtung, nicht Wertung. */
const WAAGE_ICON = {
    dafuer: 'uil-arrow-growth',
    dagegen: 'uil-chart-down',
    offen: 'uil-question-circle',
}

const LAYOUT_ICON = {
    kombiniert: 'uil-newspaper',
    artikel: 'uil-align-left',
    kacheln: 'uil-apps',
    dossier: 'uil-table',
}

const layoutModus = computed(() => {
    const l = currentUser.value?.radarNewsLayout
    return LAYOUTS.includes(l) ? l : LAYOUT_VORGABE
})

const punkteMitIndex = computed(() =>
    (bericht.value?.punkte || []).map((p, i) => ({ p, i })))

/** Top-Meldungen (intern „Aufmacher“): die als „hoch" markierten Punkte, höchstens drei. */
const aufmacher = computed(() => {
    if (layoutModus.value === 'kacheln') return punkteMitIndex.value
    if (layoutModus.value === 'artikel' || layoutModus.value === 'dossier') return []
    return punkteMitIndex.value.filter(({ p }) => p.wichtigkeit === 'hoch').slice(0, 3)
})

/** Alles, was keine Top-Meldung ist — nach Kapitel getrennt, in Berichtsreihenfolge. */
function artikelZuThema(thema) {
    if (layoutModus.value === 'kacheln' || layoutModus.value === 'dossier') return []
    const oben = new Set(aufmacher.value.map(a => a.i))
    return punkteMitIndex.value.filter(({ p, i }) => !oben.has(i) && (p.thema || '') === thema)
}

/**
 * Punkte ohne Kapitelzuordnung — Altbestand und der Fall, dass das Modell ein
 * `thema` vergisst. Ohne diesen Auffang verschwänden sie spurlos aus der
 * Ansicht, und das wäre schlimmer als ein Punkt an der falschen Stelle.
 */
const artikelOhneKapitel = computed(() => {
    if (layoutModus.value === 'kacheln' || layoutModus.value === 'dossier') return []
    const bekannt = new Set(kapitelListe.value.map(k => k.thema))
    const oben = new Set(aufmacher.value.map(a => a.i))
    return punkteMitIndex.value.filter(({ p, i }) => !oben.has(i) && !bekannt.has(p.thema || ''))
})

/**
 * Die Abwägung des Berichts: was stützt, was belastet, woran es sich entscheidet.
 *
 * Steht in JEDER Darstellung ganz oben — sie ist keine Frage des Layouts,
 * sondern der schnellste Weg zu der Frage, wegen der man den Bericht überhaupt
 * öffnet. Berichte von vor dem Umbau haben sie nicht; dann fehlt der Kasten,
 * statt mit leeren Spalten Vollständigkeit vorzutäuschen.
 */
const lagebild = computed(() => {
    const l = bericht.value?.lagebild
    if (!l) return null
    const spalten = [
        { key: 'dafuer', eintraege: l.dafuer || [] },
        { key: 'dagegen', eintraege: l.dagegen || [] },
        { key: 'offen', eintraege: l.offen || [] },
    ].filter(s => s.eintraege.length)
    return spalten.length ? spalten : null
})

/**
 * Kapitel für die Dossier-Ansicht — mit ALLEN ihren Punkten.
 *
 * Anders als in der Zeitung wird hier nichts nach oben gezogen: Ein Dossier,
 * das seine wichtigste Meldung an zwei Stellen führt, lässt den Leser zweimal
 * dasselbe lesen. Die Wichtigkeit steht stattdessen als Marke an der Zeile.
 *
 * Punkte ohne bekanntes Kapitel bekommen ein letztes, namenloses Kapitel —
 * derselbe Auffang wie in der Zeitungsansicht, aus demselben Grund.
 */
const dossierKapitel = computed(() => {
    if (layoutModus.value !== 'dossier') return []
    const bekannt = new Set(kapitelListe.value.map(k => k.thema))
    const liste = kapitelListe.value.map(k => ({
        ...k,
        eintraege: punkteMitIndex.value.filter(({ p }) => (p.thema || '') === k.thema),
    }))
    const rest = punkteMitIndex.value.filter(({ p }) => !bekannt.has(p.thema || ''))
    if (rest.length) liste.push({ thema: '', ueberschrift: '', lage: '', eintraege: rest })
    return liste
})

/**
 * Balkenbreite eines Marktwerts — leer, wenn er keine feste Spanne hat.
 *
 * Nur Werte, die von Haus aus zwischen 0 und 100 liegen (Fear & Greed,
 * Dominanz, Long-Anteil, Altseason-Index), tragen serverseitig eine `skala`.
 * Einen Balken für eine Fundingrate zu zeichnen hiesse, eine Obergrenze zu
 * erfinden, die es nicht gibt.
 */
function balken(w) {
    const v = Number(w?.skala)
    return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) + '%' : ''
}

/**
 * Die wörtlichen Zahlen eines Kapitels als Tabellenzeilen.
 *
 * Sie stehen im Dossier zusätzlich zur Meldung, nicht statt ihrer: In der
 * Meldung sind sie Teil eines Satzes, hier lassen sie sich untereinander
 * vergleichen — und das ist der einzige Teil des Berichts, den man nachrechnen
 * kann. Woher jede Zahl stammt, bleibt über den Meldungstitel sichtbar; ein
 * Klick öffnet dieselbe Belegansicht wie überall sonst.
 */
function kennzahlenZeilen(eintraege) {
    const zeilen = []
    for (const { p, i } of eintraege || []) {
        for (const z of (p.kennzahlen || []).slice(0, 3)) {
            if (z && z.wert) zeilen.push({ wert: z.wert, was: z.was || '', titel: p.titel, i })
        }
    }
    return zeilen.slice(0, 12)
}

/**
 * Videobeschreibung in Absatz und Stichpunkte zerlegen.
 *
 * Die ausführliche Stufe liefert erst zwei bis drei Sätze, dann Zeilen mit
 * „- ". Beides als ein Textblock zu zeigen, wäre eine Wand; als reine Liste
 * ginge die Einordnung verloren.
 */
function videoText(text) {
    const zeilen = String(text || '').split('\n').map(z => z.trim()).filter(Boolean)
    return {
        absatz: zeilen.filter(z => !z.startsWith('-')).join(' '),
        punkte: zeilen.filter(z => z.startsWith('-')).map(z => z.replace(/^-\s*/, '')),
    }
}

/** Zeigt die Seite gerade einen alten Bericht aus dem Archiv? */
// „aus dem Archiv" gilt nur für Berichte AUSSERHALB der Kette des Tages —
// eine zugeklappte Zwischenmeldung von heute Mittag ist kein Archivfund.
const zeigtArchiv = computed(() => Boolean(
    bericht.value && aktuellerBericht.value
    && bericht.value.id !== aktuellerBericht.value.id
    && !kette.value.some(z => z.id === bericht.value.id)))

/*
 * Die Kette des Tages: Tagesbericht plus seine Zwischenmeldungen.
 *
 * Gezeigt wird immer nur EINER ausgeschrieben — der jüngste. Die älteren
 * stehen als zugeklappte Zeile darüber, mit Uhrzeit und Schlagzeile; ein Klick
 * tauscht, welcher offen ist. Nach Mitternacht ist der Tag archiviert: `vorTag`
 * ist gesetzt, nichts liegt offen, und die Zeilen des Vortags stehen
 * zugeklappt da statt einer leeren Seite.
 */
const kette = ref([])
const vorTag = ref(false)

/** Kettenzeilen ohne die, die gerade ausgeschrieben dasteht. */
const ketteZeilen = computed(() => kette.value.map(z => ({
    ...z,
    offen: Boolean(bericht.value && bericht.value.id === z.id),
})))

/** Name der Zeile: „Tagesbericht" oder „Zwischenmeldung 2". */
function ketteName(z) {
    return z.art === 'update' ? t('news.updateMark', { n: z.updateNr || 1 }) : t('news.dailyReport')
}

/** Zugeklappte Zeile anklicken: diese öffnen — oder die offene zuklappen. */
function ketteUmschalten(z) {
    if (bericht.value && bericht.value.id === z.id) { bericht.value = null; return }
    oeffneAusArchiv(z.id)
}

const THEMA_NAME = { crypto: 'Crypto', finanzen: 'Finanzen', tech: 'Tech', chartanalyse: 'Chartanalyse' }

/** Einen Bericht aus dem Archiv in die Ansicht holen. */
async function oeffneAusArchiv(id) {
    try {
        const { data } = await axios.get('/api/marktradar/lagebericht/' + id)
        bericht.value = data.bericht
        offenerPunkt.value = -1
        archivOffen.value = false
    } catch (e) {
        meldung.value = e.response?.data?.error || e.message
        fehler.value = true
    }
}

function zurueckZumAktuellen() {
    bericht.value = aktuellerBericht.value
    offenerPunkt.value = -1
}

/**
 * Löschen aus dem Archiv — zweistufig wie bei den gespeicherten KI-Berichten:
 * erster Klick fragt, zweiter löscht. Ein `confirm()` je Zeile wäre lästig.
 */
async function archivLoeschen(id) {
    if (archivLoeschId.value !== id) {
        archivLoeschId.value = id
        setTimeout(() => { if (archivLoeschId.value === id) archivLoeschId.value = 0 }, 4000)
        return
    }
    archivLoeschId.value = 0
    try {
        const { data } = await axios.delete('/api/marktradar/lagebericht/' + id)
        meldung.value = t('news.deleted', { n: data.verbleibend })
        // Stand der gelöschte Bericht gerade in der Ansicht, zurück zum jüngsten
        if (bericht.value?.id === id) {
            bericht.value = null
            offenerPunkt.value = -1
        }
        await ladeAlles()
    } catch (e) {
        meldung.value = e.response?.data?.error || e.message
        fehler.value = true
    }
}

/** Video-Stichpunkte einer Zeile auf- oder zuklappen. */
function klappeUm(id) {
    const i = aufgeklappt.value.indexOf(id)
    if (i >= 0) aufgeklappt.value.splice(i, 1)
    else aufgeklappt.value.push(id)
}

// ── Schnell-Einstellungen des Berichts ───────────────────────────────────
// Die wichtigsten Regler direkt auf der Seite statt nur in den Einstellungen:
// Rhythmus, Themen, Länge. Gespeichert wird serverseitig (ein Feld je Klick,
// gleiche Vorsicht wie `radarSpeichern` in den Einstellungen) — sie gelten
// für den NÄCHSTEN Bericht, der bestehende bleibt stehen.
const nRhythmus = ref('taeglich')
/* Nur zur Anzeige: wie viele Aktualisierungen der Takt fährt. Eingestellt wird
   das in den Einstellungen — es ist ein Zeitplan, keine Form des Berichts. */
const nUpdates = ref(0)
const nThemen = ref(['crypto'])
const nLaenge = ref('mittel')
const nLayout = ref(LAYOUT_VORGABE)
const nVideoTiefe = ref('normal')
const nBudget = ref(0)
const nPunkte = ref(0)

function ladeBerichtOptionen() {
    const s = currentUser.value || {}
    nRhythmus.value = ['woechentlich', 'manuell'].includes(s.radarNewsRhythmus)
        ? s.radarNewsRhythmus : 'taeglich'
    nUpdates.value = Math.max(0, Math.min(2, Number(s.radarNewsUpdates) || 0))
    nThemen.value = String(s.radarNewsThemen || 'crypto').split(',')
        .map(t => t.trim()).filter(t => ['crypto', 'finanzen', 'tech', 'chartanalyse'].includes(t))
    if (!nThemen.value.length) nThemen.value = ['crypto']
    nLaenge.value = ['kurz', 'mittel', 'lang'].includes(s.radarNewsLaenge) ? s.radarNewsLaenge : 'mittel'
    nLayout.value = LAYOUTS.includes(s.radarNewsLayout) ? s.radarNewsLayout : LAYOUT_VORGABE
    nVideoTiefe.value = ['knapp', 'normal', 'ausfuehrlich'].includes(s.radarNewsVideoTiefe)
        ? s.radarNewsVideoTiefe : 'normal'
    nBudget.value = Number(s.radarNewsTokenBudget) || 0
    nPunkte.value = Number(s.radarNewsPunkte) || 0
}

/*
 * Die Reglerreihe ist zugeklappt, bis man sie braucht.
 *
 * Mit ausgeschriebenen Beschriftungen sind es acht Gruppen — dauerhaft
 * ausgeklappt schöben sie den Bericht unter die Bildschirmkante. Zugeklappt
 * steht dieselbe Auskunft in einer Zeile Klartext: was eingestellt ist, sieht
 * man immer, nur ändern kostet einen Klick.
 *
 * Muster wie bei `videosOffen` in derselben Datei: Zustand im localStorage,
 * weil er zum Gerät gehört und nicht in die Datenbank.
 */
const schnellOffen = ref(localStorage.getItem(SPEICHER_SCHNELL) === '1')

/**
 * Zu den vollen Einstellungen springen — direkt in den richtigen Reiter.
 *
 * Die Seite merkt sich ihren Reiter im localStorage (`settingsBereich` /
 * `settingsKiBereich`), also wird er hier gesetzt, bevor der Router dorthin
 * wechselt. Ohne das landet man auf „Allgemein" und sucht sich durch zwei
 * Reiterreihen.
 */
function zuDenEinstellungen() {
    try {
        localStorage.setItem('settingsBereich', 'ki')
        localStorage.setItem('settingsKiBereich', 'nachrichten')
    } catch (_) { /* privater Modus: dann eben der zuletzt offene Reiter */ }
    router.push('/settings')
}

function schnellUmschalten() {
    schnellOffen.value = !schnellOffen.value
    localStorage.setItem(SPEICHER_SCHNELL, schnellOffen.value ? '1' : '0')
}

/** Die Einstellungen als ein Satz — „täglich · Crypto + Finanzen · Mittel · …". */
const schnellZusammenfassung = computed(() => {
    const teile = [
        RHYTHMUS_NAME[nRhythmus.value](),
        nThemen.value.map(th => THEMA_NAME[th] || th).join(' + '),
        // Eine eigene Meldungszahl setzt die Länge ausser Kraft — dann steht
        // sie hier auch nicht mehr, sonst widerspricht die Zeile sich selbst.
        nPunkte.value ? `${nPunkte.value} ${t('news.points')}` : t('news.len.' + nLaenge.value),
        t('news.layout.' + nLayout.value),
        `${t('news.quickVideos')} ${t('news.depth.' + nVideoTiefe.value).toLowerCase()}`,
    ]
    if (nBudget.value) teile.push(`${nBudget.value} ${t('news.budget')}`)
    if (nUpdates.value && nRhythmus.value !== 'manuell') {
        teile.push(t('news.updatesN', { n: nUpdates.value }))
    }
    return teile.join(' · ')
})

/**
 * Zahlenregler speichern.
 *
 * 0 heisst überall „Vorgabe der Länge" — deshalb wird eine geleerte Eingabe zu
 * 0 und nicht zu NaN. Die Grenzen sind dieselben wie auf dem Server; sie hier
 * zu wiederholen ist Absicht: der Server muss ihnen trauen können, ohne dass
 * die Oberfläche vorher Unsinn schickt.
 *
 * Bewusst zwei getrennte Funktionen statt einer, der man die Ref mitgibt: im
 * Template entpackt Vue Refs automatisch, eine übergebene `nPunkte` käme dort
 * als blosse Zahl an und `ref.value = n` liefe wirkungslos ins Leere — der Wert
 * landete in der Datenbank, aber die Ansicht bliebe stehen.
 */
function grenze(wert, max) {
    return Math.max(0, Math.min(max, Math.round(Number(wert) || 0)))
}

function setzeBudget(wert) {
    nBudget.value = grenze(wert, 60000)
    speichereOption('radarNewsTokenBudget', nBudget.value)
}

function setzePunkte(wert) {
    nPunkte.value = grenze(wert, 12)
    speichereOption('radarNewsPunkte', nPunkte.value)
}

async function speichereOption(feld, wert) {
    await dbUpdateSettings({ [feld]: wert })
    if (currentUser.value) currentUser.value[feld] = wert
}

/* Die drei Rhythmen mit ihrer Beschriftung. Als Funktionen, damit ein
   Sprachwechsel nicht an einer eingefrorenen Zeichenkette vorbeiläuft. */
const RHYTHMUS_NAME = {
    taeglich: () => t('news.daily'),
    woechentlich: () => t('news.weekly'),
    manuell: () => t('news.manual'),
}

function setzeRhythmus(w) {
    if (nRhythmus.value === w) return
    nRhythmus.value = w
    speichereOption('radarNewsRhythmus', w)
}

function toggleThema(t) {
    const i = nThemen.value.indexOf(t)
    if (i >= 0) {
        if (nThemen.value.length === 1) return   // mindestens ein Thema
        nThemen.value.splice(i, 1)
    } else nThemen.value.push(t)
    // Reihenfolge festnageln — die Kapitel sollen immer gleich sortiert sein
    const geordnet = ['crypto', 'finanzen', 'tech', 'chartanalyse'].filter(x => nThemen.value.includes(x))
    nThemen.value = geordnet
    speichereOption('radarNewsThemen', geordnet.join(','))
}

function setzeLaenge(w) {
    if (nLaenge.value === w) return
    nLaenge.value = w
    speichereOption('radarNewsLaenge', w)
}

// ── KI-Guthaben ──────────────────────────────────────────────────────────
// Scheiterte ein Aufruf an fehlendem Guthaben, steht das serverseitig fest —
// hier wird es sichtbar gemacht: Banner über dem Bericht, dazu höchstens alle
// zwölf Stunden eine Browser-Benachrichtigung (sofern erlaubt).
const guthabenLeer = ref([])
/** Letzter gescheiterter Berichtslauf — kommt aus dem Anspruchs-Vermerk. */
const letzterFehlschlag = ref(null)

async function pruefeGuthaben() {
    try {
        const { data } = await axios.get('/api/ai/guthaben')
        guthabenLeer.value = (data.anbieter || []).filter(a => a.keySet && a.leer)
    } catch { guthabenLeer.value = [] }
    if (!guthabenLeer.value.length) return

    // Höchstens alle zwölf Stunden. Ob überhaupt gemeldet wird, entscheidet
    // sendNotification anhand der Kanalwahl — vorher stand diese Prüfung hier
    // von Hand nachgebaut und ging dabei am Hauptschalter vorbei.
    const zuletzt = Number(localStorage.getItem('nachrichten_guthaben_notif')) || 0
    if (Date.now() - zuletzt < 12 * 60 * 60 * 1000) return
    localStorage.setItem('nachrichten_guthaben_notif', String(Date.now()))
    sendNotification('kiGuthabenLeer', t('news.quotaTitle'),
        guthabenLeer.value.map(a => a.name).join(', '))
}

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

/**
 * Was in den nächsten Stunden ansteht — die Kopfzeile des Dossiers.
 *
 * Bewusst aus dem LIVE geladenen Kalender und nicht aus dem Bericht: ein Termin
 * ist erst dann interessant, wenn er noch bevorsteht, und ein Bericht von heute
 * Mittag weiss um 20 Uhr nichts mehr über den Abend. Es gilt dieselbe Auswahl
 * (Wirkung, Länder), die unten in der Terminliste eingestellt ist — zwei
 * Filtergedanken auf einer Seite wären einer zu viel.
 */
/*
 * Die naechsten Termine fuer die Dossier-Kachel.
 *
 * 36 Stunden sind das Fenster, das zum Bericht passt. An einem ruhigen Tag
 * steht darin aber genau ein Eintrag — und weil daneben die Marktdaten-Tabelle
 * mit einem Dutzend Zeilen haengt, ist die Kachel dann zu neun Zehnteln leer.
 * Deshalb wird das Fenster geoeffnet, bis wenigstens MIN_TERMINE zusammen-
 * kommen. Die Fusszeile sagt dann, welches Fenster gilt: eine Kachel, die
 * heimlich sieben Tage zeigt, waehrend "naechste 36 Stunden" darunter steht,
 * ist schlimmer als eine leere.
 *
 * Steht gar nichts im Bestand, faellt die Kachel weg (`v-if` unten) und die
 * Marktdaten-Tabelle bekommt die volle Breite.
 */
const MIN_TERMINE = 3
const TERMIN_FENSTER = [36, 24 * 7, 24 * 30]

const naechsteTermine = computed(() => {
    const kommend = termine.value.filter(e => e.dateUnix >= jetzt)
    for (const stunden of TERMIN_FENSTER) {
        const liste = kommend.filter(e => e.dateUnix < jetzt + stunden * 60 * 60 * 1000).slice(0, 6)
        if (liste.length >= MIN_TERMINE) return { liste, stunden }
    }
    return { liste: kommend.slice(0, 6), stunden: 0 }   // 0 = alles, was dasteht
})

/**
 * Uhrzeit fuer die Kachel — mit Datum, sobald das Fenster ueber die 36 Stunden
 * hinausgeht. "01:00" allein beantwortet bei sieben Tagen nicht, welcher Tag.
 */
const terminZeit = (ms) => (naechsteTermine.value.stunden === 36
    ? zeit(ms)
    : dayjs(ms).tz(zone()).format('DD.MM. ') + zeit(ms))

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
            axios.get('/api/marktradar/news', { params: { limit: 100 } }),
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
            aktuellerBericht.value = b.value.data.bericht
            // Wer gerade im Archiv liest, wird vom Zehn-Minuten-Takt nicht
            // zurück auf den jüngsten Bericht geworfen
            if (!zeigtArchiv.value) bericht.value = b.value.data.bericht
            kette.value = b.value.data.kette || []
            vorTag.value = Boolean(b.value.data.vomVortag)
            verlauf.value = b.value.data.verlauf || []
            letzterFehlschlag.value = b.value.data.letzterFehlschlag || null
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
        // Der Abruf zieht alle Quellen und ggf. die bezahlte X-Suche nach —
        // mit zwanzig Sekunden bricht er mitten im Einsammeln ab.
        const { data } = await axios.post('/api/marktradar/news/holen', null, { timeout: 3 * 60 * 1000 })
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
        bericht.value = null
        offenerPunkt.value = -1
        await ladeAlles()
    } catch (e) {
        meldung.value = e.response?.data?.error || e.message
        fehler.value = true
    }
}

/**
 * Bericht erzeugen oder fortschreiben.
 *
 * Beide Wege durch dieselbe Funktion, weil sich hinterher nur die Adresse
 * unterscheidet: Bremse, Meldung, Guthabenprüfung und das Zurückspringen aus
 * dem Archiv sind identisch. Was die Aktualisierung anders macht, entscheidet
 * der Server — er kennt den bisherigen Bericht.
 */
async function berichtErzeugen(aktualisieren = false) {
    laeuft.value = true
    meldung.value = ''
    fehler.value = false
    // Woran man erkennt, dass doch noch etwas ankam, falls die Leitung aufgibt.
    const vorherId = aktuellerBericht.value?.id || 0
    try {
        const { data } = await axios.post(aktualisieren
            ? '/api/marktradar/lagebericht/aktualisieren'
            : '/api/marktradar/lagebericht/erzeugen',
        // 20 Sekunden sind die HAUSVORGABE (`axios.defaults.timeout` in
        // utils/db.js) und für diesen Knopf schlicht falsch: Ein Bericht
        // braucht Videoanalyse, Recherche und ein Modell, das mehrere tausend
        // Token schreibt — gemessen zwei bis drei Minuten. Der Browser gab
        // vorher nach 20 Sekunden auf und meldete „timeout of 20000ms
        // exceeded", während der Server ungerührt weiterschrieb und den
        // Bericht auch ablieferte. Der Fehler war also keiner, sondern eine
        // Lüge über einen Lauf, der lief.
        { timeout: 10 * 60 * 1000 })
        if (data.uebersprungen) {
            meldung.value = t('news.digestThrottled')
        } else if (data.fehler) {
            meldung.value = data.fehler
            fehler.value = true
        } else {
            meldung.value = t(data.art === 'update' ? 'news.updateDone' : 'news.digestDone', {
                n: data.beitraege, v: data.videos, tok: data.tokens,
                p: data.punkte || 0, r: data.recherchen || 0,
                modell: `${data.provider}/${data.modell}`,
            }) + (data.kostenUsd ? ` · ${data.kostenUsd.toFixed(4)} USD` : '')
                + (data.geminiFehler ? ` · Gemini: ${data.geminiFehler}` : '')
            // Frisch erzeugt heisst: den neuen Bericht zeigen, auch wenn
            // vorher im Archiv geblättert wurde
            bericht.value = null
        }
        await ladeAlles()
    } catch (e) {
        /*
         * Abgebrochene Leitung heisst NICHT abgebrochener Lauf.
         *
         * Der Server schreibt weiter, auch wenn der Browser aufgibt (Timeout,
         * Netzwechsel, geschlossener Deckel). Statt einen roten Fehler zu
         * zeigen, für den es keinen Beleg gibt, wird nachgesehen: alle 15
         * Sekunden, bis ein neuer Bericht dasteht — höchstens zehn Minuten.
         */
        if (e.code === 'ECONNABORTED' || e.message?.includes('timeout')) {
            meldung.value = t('news.stillRunning')
            const bis = Date.now() + 10 * 60 * 1000
            while (Date.now() < bis) {
                await new Promise(r => setTimeout(r, 15000))
                await ladeAlles()
                if ((aktuellerBericht.value?.id || 0) !== vorherId) {
                    meldung.value = t('news.arrivedLate')
                    bericht.value = aktuellerBericht.value
                    break
                }
            }
        } else {
            meldung.value = e.response?.data?.error || e.message
            fehler.value = true
        }
    } finally {
        laeuft.value = false
        // Ein gescheiterter Lauf ist der Moment, in dem ein leeres Guthaben
        // sichtbar wird — direkt nachsehen statt auf den nächsten Seitenaufruf warten
        pruefeGuthaben()
    }
}

/*
 * Die Einstellungen kommen asynchron.
 *
 * `ladeBerichtOptionen()` allein in `onMounted` lief zu früh: `currentUser` war
 * dann meist noch leer, die Regler behielten ihre Vorgabewerte und zeigten
 * nach jedem Neuladen „täglich · Crypto · Mittel", egal was gespeichert war.
 * Aufgefallen ist es erst, seit die Zusammenfassungszeile den Zustand
 * ausschreibt — die Pillen sahen mit den Vorgaben zufällig richtig aus.
 *
 * Bewusst flach beobachtet: `speichereOption` ändert eine EIGENSCHAFT von
 * `currentUser`, das löst hier nichts aus. Sonst würde jede Änderung sofort
 * wieder überschrieben.
 */
watch(currentUser, ladeBerichtOptionen, { immediate: true })

// ── Chart-Bilder gross ansehen ───────────────────────────────────────────
// Klick auf ein Chart-Bild der Chartanalyse öffnet es bildschirmfüllend;
// der Link zum Quell-Artikel wandert in die Fusszeile des Overlays.
const grossesBild = ref(null)   // {url, quelle} oder null

function schliesseBildBeiEsc(e) {
    if (e.key === 'Escape') grossesBild.value = null
}

let takt = null
onMounted(() => {
    ladeAlles()
    pruefeGuthaben()
    // Zehn Minuten reichen: Feeds ändern sich langsamer als Kurse
    takt = setInterval(() => { if (!document.hidden) ladeAlles() }, 10 * 60 * 1000)
    window.addEventListener('keydown', schliesseBildBeiEsc)
})
onBeforeUnmount(() => {
    if (takt) clearInterval(takt)
    window.removeEventListener('keydown', schliesseBildBeiEsc)
})
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
                <!-- Aktualisieren steht vor „Neu erzeugen": Es ist der
                     häufigere und der billigere Weg — was der Bericht schon
                     gelesen hat, wird nicht ein zweites Mal bezahlt. Ohne
                     bestehenden Bericht gibt es nichts fortzuschreiben. -->
                <button v-if="bericht" type="button" class="ctl-pill" :disabled="laeuft"
                    :title="t('news.updateHint')" @click="berichtErzeugen(true)">
                    <i class="uil uil-sync-exclamation"></i>{{ t('news.updateDigest') }}
                </button>
                <button type="button" class="ctl-pill accent" :disabled="laeuft" @click="berichtErzeugen(false)">
                    <i class="uil uil-robot"></i>{{ laeuft ? t('news.working') : t('news.makeDigest') }}
                </button>
                <span class="ctl-sep"></span>
                <PageInfo section="info.nachrichten" />
            </div>
        </div>

        <!-- Die wichtigsten Berichts-Regler direkt auf der Seite. Sie gelten
             für den nächsten Bericht; der angezeigte bleibt unverändert. -->
        <!-- Zugeklappt steht hier eine Zeile Klartext: man sieht, was eingestellt
             ist, ohne dass acht Reglergruppen Platz fressen. -->
        <div class="nwSchnellKopf">
            <button type="button" class="ctl-pill klein nwSchnellKnopf"
                :class="{ active: schnellOffen }" :aria-expanded="schnellOffen"
                :title="schnellOffen ? t('news.quickClose') : t('news.quickOpen')"
                @click="schnellUmschalten">
                <i class="uil" :class="schnellOffen ? 'uil-angle-down' : 'uil-angle-right'"></i>
                <span>{{ t('news.quickTitle') }}</span>
            </button>
            <!-- Der Weg zu allem, was hier NICHT steht: Wochentag, Modelle,
                 Videoauflösung, Zwischenmeldungen, Aufbewahrung. Bisher stand
                 dazu nur ein Satz unter den Reglern — als Hinweis, nicht als
                 Weg. -->
            <button v-if="schnellOffen" type="button" class="ctl-pill klein" :title="t('news.toSettings')"
                @click="zuDenEinstellungen">
                <i class="uil uil-sliders-v-alt"></i>
            </button>
            <span v-if="!schnellOffen" class="nwSchnellZeile" @click="schnellUmschalten">
                {{ schnellZusammenfassung }}
            </span>
        </div>

        <div v-if="schnellOffen" class="nwSchnell" :title="t('news.quickHint')">
            <button v-for="r in ['taeglich', 'woechentlich', 'manuell']" :key="r" type="button"
                class="ctl-pill klein" :class="{ active: nRhythmus === r }" @click="setzeRhythmus(r)">
                {{ RHYTHMUS_NAME[r]() }}
            </button>
            <span class="nwTrenner"></span>
            <button v-for="(bez, th) in THEMA_NAME" :key="th" type="button"
                class="ctl-pill klein" :class="{ active: nThemen.includes(th) }" @click="toggleThema(th)">
                {{ bez }}
            </button>
            <span class="nwTrenner"></span>
            <!-- Zweizeilige Pillen: das Wort allein („Mittel", „Knapp") sagt
                 niemandem, was sich ändert — die Zeile darunter schon. -->
            <button v-for="l in ['kurz', 'mittel', 'lang']" :key="l" type="button"
                class="ctl-pill klein zwei" :class="{ active: nLaenge === l }" @click="setzeLaenge(l)">
                <b>{{ t('news.len.' + l) }}</b>
                <!-- Sobald „Meldungen" auf einem eigenen Wert steht, gilt die
                     Zahl der Länge nicht mehr — dann wäre sie schlicht gelogen. -->
                <small>{{ nPunkte ? t('news.ownValue') : t('news.lenSub.' + l) }}</small>
            </button>
            <span class="nwTrenner"></span>
            <!-- Darstellung. Wirkt sofort, auch auf den angezeigten Bericht —
                 es ist reine Anzeige, der Bericht selbst ändert sich nicht. -->
            <button v-for="l in LAYOUTS" :key="l" type="button"
                class="ctl-pill klein zwei" :class="{ active: nLayout === l }"
                @click="nLayout = l; speichereOption('radarNewsLayout', l)">
                <b><i class="uil" :class="LAYOUT_ICON[l]"></i>
                    {{ t('news.layout.' + l) }}</b>
                <small>{{ t('news.layoutSub.' + l) }}</small>
            </button>
            <span class="nwTrenner"></span>
            <!-- Videotiefe: der einzige Regler hier, der Geld je Lauf kostet. -->
            <button v-for="v in ['knapp', 'normal', 'ausfuehrlich']" :key="v" type="button"
                class="ctl-pill klein zwei" :class="{ active: nVideoTiefe === v }"
                :title="t('news.videoDepthHint')"
                @click="nVideoTiefe = v; speichereOption('radarNewsVideoTiefe', v)">
                <b><i class="uil uil-youtube"></i>{{ t('news.depth.' + v) }}</b>
                <small>{{ t('news.depthSub.' + v) }}</small>
            </button>
            <span class="nwTrenner"></span>
            <!-- Zahlenregler. 0 ist kein Wert, sondern „Vorgabe der Länge" —
                 deshalb steht dann „auto" im Feld statt einer nackten Null. -->
            <label class="nwZahlFeld" :title="t('news.budgetHint')">
                <span>{{ t('news.budget') }}</span>
                <input type="number" min="0" max="60000" step="500"
                    :value="nBudget || ''" :placeholder="t('news.auto')"
                    @change="setzeBudget($event.target.value)" />
            </label>
            <label class="nwZahlFeld" :title="t('news.pointsHint')">
                <span>{{ t('news.points') }}</span>
                <input type="number" min="0" max="12" step="1"
                    :value="nPunkte || ''" :placeholder="t('news.auto')"
                    @change="setzePunkte($event.target.value)" />
            </label>
            <p class="nwSchnellFuss">{{ t('news.moreInSettings') }}</p>
        </div>

        <p v-if="meldung" class="nwMeldung" :class="{ fehler }">{{ meldung }}</p>

        <!-- KI-Guthaben aufgebraucht: ohne diesen Hinweis sieht ein leerer
             Anbieter wie ein kaputter Bericht aus. -->
        <p v-if="guthabenLeer.length" class="nwWarnung nwGuthaben">
            <i class="uil uil-exclamation-triangle"></i>
            {{ t('news.quotaEmpty', { liste: guthabenLeer.map(a => a.name).join(', ') }) }}
        </p>

        <!-- Gescheiterter Berichtslauf. Vorher stand so etwas nur im Serverlog —
             ein ausgefallener Tagesbericht sah aus wie „heute nichts passiert". -->
        <p v-if="letzterFehlschlag" class="nwWarnung nwGuthaben">
            <i class="uil uil-exclamation-triangle"></i>
            {{ t('news.lastFailure', {
                zeit: dayjs(letzterFehlschlag.zeit).tz(zone()).format('DD.MM. HH:mm'),
                text: letzterFehlschlag.text,
            }) }}
        </p>

        <!--=============== LAGEBERICHT ===============-->
        <!-- Die Kette des Tages. Jede Zeile ist ein Bericht: die offene steht
             darunter ausgeschrieben, die anderen als eine Zeile mit Uhrzeit.
             Ein Klick tauscht. Nach Mitternacht ist nichts offen — der Tag ist
             archiviert, aber die Zeilen bleiben erreichbar. -->
        <div v-if="ketteZeilen.length > 1 || vorTag" class="nwKette">
            <p v-if="vorTag" class="nwKetteHinweis">
                <i class="uil uil-archive"></i>{{ t('news.archivedAtMidnight') }}
            </p>
            <button v-for="z in ketteZeilen" :key="z.id" type="button"
                class="nwKetteZeile" :class="{ offen: z.offen }" @click="ketteUmschalten(z)">
                <i class="uil" :class="z.offen ? 'uil-angle-down' : 'uil-angle-right'"></i>
                <span class="nwKetteZeit">{{ dayjs(z.erstelltAm).format('HH:mm') }}</span>
                <span class="nwKetteName" :class="{ update: z.art === 'update' }">{{ ketteName(z) }}</span>
                <span class="nwKetteTitel">{{ z.ueberschrift || '—' }}</span>
                <span class="nwKetteTag">{{ dayjs(z.erstelltAm).format('DD.MM.') }}</span>
            </button>
        </div>

        <section class="nwKarte nwBericht nwZeitung">
            <template v-if="bericht">
                <div class="nwBerichtKopf">
                    <span class="nwMarke">{{ t('news.briefing') }}</span>
                    <span class="nwZeitpunkt">{{ dayjs(bericht.erstelltAm).format('DD.MM.YYYY, HH:mm') }}</span>
                    <!-- Eine Aktualisierung ist ein eigener Bericht, kein
                         nachgebessertes Original — der Leser muss sehen, dass
                         er den Nachtrag vor sich hat. -->
                    <span v-if="bericht.art === 'update'" class="nwUpdateMarke">
                        {{ t('news.updateMark', { n: bericht.updateNr || 1 }) }}
                    </span>
                    <!-- Die Zwischenmeldung enthält den Tagesbericht NICHT mehr
                         (sie meldet nur, was seither dazukam) — ohne diesen
                         Sprung wäre er für den Leser verschwunden. -->
                    <button v-if="bericht.art === 'update' && bericht.basisId" type="button"
                        class="ctl-pill klein" @click="oeffneAusArchiv(bericht.basisId)">
                        <i class="uil uil-newspaper"></i>{{ t('news.toBase') }}
                    </button>
                    <span v-for="th in String(bericht.themen || '').split(',').filter(Boolean)"
                        :key="th" class="nwThema">{{ THEMA_NAME[th] || th }}</span>
                    <span v-if="zeigtArchiv" class="nwArchivMarke">{{ t('news.fromArchive') }}</span>
                    <button v-if="zeigtArchiv" type="button" class="ctl-pill klein" style="margin-left:auto;"
                        @click="zurueckZumAktuellen">
                        <i class="uil uil-arrow-left"></i>{{ t('news.backToCurrent') }}
                    </button>
                    <button type="button" class="ctl-pill klein" :style="zeigtArchiv ? {} : { marginLeft: 'auto' }"
                        :class="{ active: archivOffen }" @click="archivOffen = !archivOffen">
                        <i class="uil uil-archive"></i>{{ t('news.archive') }}
                        <span class="nwAnzahl">{{ verlauf.length }}</span>
                    </button>
                    <button type="button" class="nwLoeschen" :title="t('news.delete')" @click="berichtLoeschen">
                        <i class="uil uil-trash-alt"></i>
                    </button>
                </div>

                <!-- Archiv: die letzten Berichte, öffnen und löschen je Zeile.
                     Löschen zweistufig — erster Klick fragt, zweiter löscht. -->
                <div v-if="archivOffen" class="nwArchiv">
                    <div v-if="!verlauf.length" class="nwLeer klein"><span>{{ t('news.archiveEmpty') }}</span></div>
                    <button v-for="v in verlauf" :key="v.id" type="button" class="nwArchivZeile"
                        :class="{ aktiv: bericht && bericht.id === v.id }" @click="oeffneAusArchiv(v.id)">
                        <span class="nwArchivDatum">{{ dayjs(v.erstelltAm).format('DD.MM.YYYY HH:mm') }}</span>
                        <span class="nwArchivTitel">{{ v.ueberschrift || '—' }}</span>
                        <span class="nwArchivMeta">
                            <template v-if="v.art === 'update'">{{ t('news.updateShort', { n: v.updateNr || 1 }) }} · </template>
                            {{ v.beitraege }} · {{ v.ausloeser }}
                            <template v-if="v.kostenUsd"> · {{ useKostenAnzeige(v.kostenUsd) }}</template>
                        </span>
                        <span class="nwArchivLoeschen" :class="{ scharf: archivLoeschId === v.id }"
                            :title="t('news.delete')" @click.stop="archivLoeschen(v.id)">
                            <i class="uil" :class="archivLoeschId === v.id ? 'uil-question-circle' : 'uil-trash-alt'"></i>
                            <template v-if="archivLoeschId === v.id">{{ t('news.confirmDelete') }}</template>
                        </span>
                    </button>
                </div>

                <h2 class="nwUeberschrift">{{ bericht.ueberschrift }}</h2>
                <p class="nwLage">{{ bericht.lage }}</p>

                <!-- Abwägung: dafür / dagegen / woran es sich entscheidet.
                     Jede Zeile sagt, ob sie eine Tatsache aus den Quellen ist
                     oder eine Deutung — ohne diese Marke wäre der Kasten nur
                     eine hübschere Meinung. Gilt für alle Darstellungen. -->
                <section v-if="lagebild" class="nwWaage">
                    <div v-for="sp in lagebild" :key="sp.key" class="nwWaageSpalte" :class="sp.key">
                        <h3 class="nwWaageKopf">
                            <i class="uil" :class="WAAGE_ICON[sp.key]"></i>{{ t('news.balance.' + sp.key) }}
                        </h3>
                        <ul class="nwWaageListe">
                            <li v-for="(e, ei) in sp.eintraege" :key="ei">
                                <span class="nwArt" :class="e.art">{{ t('news.tag.' + e.art) }}</span>
                                <span class="nwWaageText">{{ e.text }}</span>
                            </li>
                        </ul>
                    </div>
                </section>

                <!--=============== DOSSIER ===============-->
                <!-- Nachschlagen statt lesen: oben das Messbare als Tabelle,
                     darunter je Kapitel die Zahlen und die Meldungen. Klick auf
                     eine Zeile öffnet dasselbe Belegfenster wie überall sonst. -->
                <div v-if="layoutModus === 'dossier'" class="nwDossier">
                    <!-- Faellt einer der beiden Kaesten weg, teilt sich der andere
                         die Zeile nicht mit einer Luecke, sondern nimmt sie ganz. -->
                    <div class="nwDoKopfzeile"
                        :class="{ nwDoEinzeln: !(bericht.markt && bericht.markt.length) || !naechsteTermine.liste.length }">
                        <!-- Der gemessene Marktstand VON DAMALS. Ältere Berichte
                             haben ihn nicht gespeichert — dann fehlt die Tabelle,
                             statt hier die Zahlen von heute zu zeigen. -->
                        <section v-if="bericht.markt && bericht.markt.length" class="nwDoBlock">
                            <h3 class="nwDoTitel">
                                <i class="uil uil-chart-line"></i>{{ t('news.marketState') }}
                            </h3>
                            <table class="nwDoTab">
                                <thead>
                                    <tr>
                                        <th>{{ t('news.measure') }}</th>
                                        <th>{{ t('news.level') }}</th>
                                        <th>{{ t('news.reading') }}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="(w, wi) in bericht.markt" :key="wi">
                                        <td class="nwDoWas">{{ w.was }}</td>
                                        <td class="nwDoWert">
                                            <b>{{ w.wert }}</b>
                                            <span v-if="balken(w)" class="nwDoBalken">
                                                <i :style="{ width: balken(w) }"></i>
                                            </span>
                                        </td>
                                        <td class="nwDoZusatz">{{ w.zusatz || '—' }}</td>
                                    </tr>
                                </tbody>
                            </table>
                            <p class="nwDoFuss">{{ t('news.marketStateHint') }}</p>
                        </section>

                        <!-- Was noch bevorsteht — live aus dem Kalender, mit der
                             Auswahl, die unten in der Terminliste eingestellt ist.
                             Steht nichts an, faellt der ganze Kasten weg. -->
                        <section v-if="naechsteTermine.liste.length" class="nwDoBlock">
                            <h3 class="nwDoTitel">
                                <i class="uil uil-calendar-alt"></i>{{ t('news.upcoming') }}
                            </h3>
                            <table class="nwDoTab">
                                <thead>
                                    <tr>
                                        <th>{{ t('news.time') }}</th>
                                        <th>{{ t('news.country') }}</th>
                                        <th>{{ t('news.event') }}</th>
                                        <th>{{ t('news.forecast') }}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="e in naechsteTermine.liste" :key="e.extId">
                                        <!-- Zeit und Land in GETRENNTEN Spalten: nebeneinander
                                             las sich "01:00 USD" wie ein Geldbetrag. -->
                                        <td class="nwDoZeit">
                                            <i class="nwPunktFarbe" :style="{ background: IMPACT_FARBE[e.impact] }"></i>
                                            {{ terminZeit(e.dateUnix) }}
                                        </td>
                                        <td class="nwDoLand">{{ e.land }}</td>
                                        <td>{{ e.titel }}</td>
                                        <td class="nwDoWert">
                                            <b v-if="e.forecast">{{ e.forecast }}</b>
                                            <span v-else>—</span>
                                            <span v-if="e.previous" class="nwDoVor">{{ e.previous }}</span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                            <p class="nwDoFuss">
                                {{ naechsteTermine.stunden === 36
                                    ? t('news.upcomingHint')
                                    : t('news.upcomingHintWide', { n: naechsteTermine.liste.length }) }}
                            </p>
                        </section>
                    </div>

                    <section v-for="(k, ki) in dossierKapitel" :key="'do' + ki" class="nwDoKapitel">
                        <div class="nwDoKapitelKopf">
                            <span class="nwDoNummer">{{ ki + 1 }}</span>
                            <span class="nwThema klein">{{ THEMA_NAME[k.thema] || k.thema || t('news.misc') }}</span>
                            <h3 v-if="k.ueberschrift">{{ k.ueberschrift }}</h3>
                        </div>
                        <p v-if="k.lage" class="nwDoLage">{{ k.lage }}</p>

                        <!-- Charts der recherchierten Analysen, wie in der
                             Zeitungsansicht; Klick öffnet sie gross. -->
                        <div v-if="k.bilder && k.bilder.length" class="nwChartBilder">
                            <img v-for="(b, bi) in k.bilder" :key="bi" :src="b.url"
                                loading="lazy" referrerpolicy="no-referrer" class="pointerClass"
                                @click="grossesBild = b"
                                @error="e => { e.target.style.display = 'none' }" />
                        </div>

                        <!-- Die wörtlichen Zahlen des Kapitels, untereinander
                             vergleichbar. Klick springt zur Meldung dahinter. -->
                        <table v-if="kennzahlenZeilen(k.eintraege).length" class="nwDoTab nwDoZahlen">
                            <thead>
                                <tr>
                                    <th>{{ t('news.figure') }}</th>
                                    <th>{{ t('news.figureWhat') }}</th>
                                    <th>{{ t('news.figureFrom') }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="(z, zi) in kennzahlenZeilen(k.eintraege)" :key="zi"
                                    class="pointerClass" @click="offenerPunkt = z.i">
                                    <td class="nwDoWert"><b>{{ z.wert }}</b></td>
                                    <td>{{ z.was }}</td>
                                    <td class="nwDoHer">{{ z.titel }}</td>
                                </tr>
                            </tbody>
                        </table>

                        <article v-for="{ p, i } in k.eintraege" :key="i" class="nwDoMeldung"
                            :class="{ hoch: p.wichtigkeit === 'hoch' }" @click="offenerPunkt = i">
                            <img v-if="punktBild(p)" class="nwDoBild" :src="punktBild(p)" alt=""
                                loading="lazy" referrerpolicy="no-referrer"
                                @error="$event.target.style.display = 'none'" />
                            <div class="nwDoInhalt">
                                <h4 class="nwDoMeldungTitel">
                                    {{ p.titel }}
                                    <span v-if="p.wichtigkeit === 'hoch'" class="nwWichtig">
                                        {{ t('news.important') }}
                                    </span>
                                    <!-- In einer Zwischenmeldung ist alles neu;
                                         markiert wird deshalb der Sonderfall:
                                         Das hier stand heute Morgen anders. -->
                                    <span v-if="p.korrektur === true" class="nwNeuMarke">{{ t('news.fixMark') }}</span>
                                </h4>
                                <p class="nwDoMeldungText">{{ p.text }}</p>
                                <p class="nwDoMeldungFuss">
                                    <span class="nwPunktQuelle">{{ p.quelle }}</span>
                                    <span v-for="(z, zi) in (p.kennzahlen || []).slice(0, 3)" :key="zi"
                                        class="nwZahl"><b>{{ z.wert }}</b><span>{{ z.was }}</span></span>
                                    <span v-if="p.belege && p.belege.length" class="nwBelegZahl">
                                        <i class="uil uil-link"></i>{{ p.belege.length }}
                                    </span>
                                </p>
                            </div>
                        </article>
                    </section>
                </div>

                <!-- Top-Meldungen: nur die als „hoch" markierten Punkte, höchstens
                     drei. Im Kachel-Layout stehen hier wie früher alle. Der
                     volle Text samt Belegen steht im Fenster. -->
                <div v-if="aufmacher.length" class="nwPunkte" :class="{ aufmacher: layoutModus !== 'kacheln' }">
                    <article v-for="{ p, i } in aufmacher" :key="i" class="nwPunkt"
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
                                <span v-if="p.thema" class="nwThema klein">{{ THEMA_NAME[p.thema] || p.thema }}</span>
                                <span v-if="p.wichtigkeit === 'hoch'" class="nwWichtig">
                                    {{ t('news.important') }}
                                </span>
                                <span v-if="p.korrektur === true" class="nwNeuMarke">{{ t('news.fixMark') }}</span>
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

                <!-- Zeitungsteil: je Thema ein Kapitel mit Spaltensatz. Alte
                     Berichte ohne Kapitel zeigen wie bisher nur die Lage. -->
                <div v-for="(k, ki) in (layoutModus === 'dossier' ? [] : kapitelListe)" :key="ki"
                    class="nwKapitel">
                    <div class="nwKapitelKopf">
                        <span class="nwKapitelThema">{{ THEMA_NAME[k.thema] || k.thema }}</span>
                        <h3 class="nwKapitelTitel">{{ k.ueberschrift }}</h3>
                    </div>
                    <p class="nwKapitelText" :class="{ erste: ki === 0 }">{{ k.lage }}</p>

                    <!-- Chart-Grafiken aus den recherchierten Analysen (nur
                         Chartanalyse-Kapitel). Klick öffnet das Bild gross im
                         Overlay; tote Bild-URLs verschwinden still. -->
                    <div v-if="k.bilder && k.bilder.length" class="nwChartBilder">
                        <img v-for="(b, bi) in k.bilder" :key="bi" :src="b.url"
                            loading="lazy" referrerpolicy="no-referrer" class="pointerClass"
                            @click="grossesBild = b"
                            @error="e => { e.target.style.display = 'none' }" />
                    </div>

                    <!-- Die Punkte des Kapitels als Artikel im laufenden Satz.
                         Anklickbar wie die Kacheln vorher: das Belegfenster ist
                         der Ort, an dem nachgeschlagen wird, nicht die Ansicht. -->
                    <article v-for="{ p, i } in artikelZuThema(k.thema)" :key="i" class="nwArtikel"
                        @click="offenerPunkt = i">
                        <h4 class="nwArtikelTitel">{{ p.titel }}</h4>
                        <p class="nwArtikelText">{{ p.text }}</p>
                        <p v-if="p.kennzahlen && p.kennzahlen.length" class="nwArtikelZahlen">
                            <span v-for="(z, n) in p.kennzahlen.slice(0, 3)" :key="n" class="nwZahl">
                                <b>{{ z.wert }}</b><span>{{ z.was }}</span>
                            </span>
                        </p>
                        <p class="nwArtikelFuss">
                            <span class="nwPunktQuelle">{{ p.quelle }}</span>
                            <span v-if="p.belege && p.belege.length" class="nwBelegZahl">
                                <i class="uil uil-link"></i>{{ p.belege.length }}
                            </span>
                        </p>
                    </article>
                </div>

                <!-- Punkte, deren Thema zu keinem Kapitel passt (Altbestand,
                     oder das Modell hat die Kennung vergessen). Lieber unter
                     einer neutralen Überschrift als gar nicht. -->
                <div v-if="artikelOhneKapitel.length" class="nwKapitel">
                    <div class="nwKapitelKopf">
                        <span class="nwKapitelThema">{{ t('news.misc') }}</span>
                    </div>
                    <article v-for="{ p, i } in artikelOhneKapitel" :key="i" class="nwArtikel"
                        @click="offenerPunkt = i">
                        <h4 class="nwArtikelTitel">{{ p.titel }}</h4>
                        <p class="nwArtikelText">{{ p.text }}</p>
                        <p class="nwArtikelFuss">
                            <span class="nwPunktQuelle">{{ p.quelle }}</span>
                        </p>
                    </article>
                </div>


                <!-- Was mit den Videos geschah. Eine blosse „0" liess offen, ob
                     keine da waren, keine analysiert werden durften oder die
                     Analyse scheiterte — bei bis zu zehn Rappen je Video ist
                     das der Unterschied zwischen sparsam und kaputt. -->
                <div v-if="sichtbareVideos.length" class="nwVideos">
                    <button type="button" class="nwVideosKopf" :aria-expanded="videosOffen"
                        @click="videosUmschalten">
                        <i class="uil" :class="videosOffen ? 'uil-angle-down' : 'uil-angle-right'"></i>
                        {{ t('news.videosHeader') }}
                        <span class="nwVideosZahl">{{ sichtbareVideos.length }}</span>
                    </button>
                    <div v-for="(vi, k) in (videosOffen ? sichtbareVideos : [])" :key="k"
                        class="nwVideoEintrag">
                        <a class="nwVideo" :href="vi.url" target="_blank" rel="noopener noreferrer">
                            <i class="uil uil-youtube"></i>
                            <span class="nwBelegQuelle">{{ vi.quelle }}</span>
                            <span class="nwBelegTitel">{{ vi.titel }}</span>
                            <!-- Drei Zustände, die man auseinanderhalten muss:
                                 heute bezahlt, früher bezahlt (gratis wiederverwendet),
                                 gescheitert. Nur so sieht man, wofür Geld floss. -->
                            <span class="nwVideoErgebnis"
                                :class="vi.ergebnis === 'ok' ? 'ok' : (vi.ergebnis === 'übernommen' ? 'alt' : 'schlecht')">
                                {{ vi.ergebnis === 'ok' ? useKostenAnzeige(vi.kostenUsd)
                                    : (vi.ergebnis === 'übernommen' ? t('news.videoReused') : vi.ergebnis) }}
                            </span>
                        </a>
                        <!-- Wofür bezahlt wurde: die Beschreibung selbst. Bis
                             v3.7.1 stand hier nur der Preis — man sah, DASS ein
                             Video angesehen wurde, aber nie, was drinstand.
                             Ältere Berichte haben kein `text`, dort bleibt es
                             wie bisher bei der Zeile darüber. -->
                        <div v-if="vi.text" class="nwVideoText">
                            <p v-if="videoText(vi.text).absatz">{{ videoText(vi.text).absatz }}</p>
                            <ul v-if="videoText(vi.text).punkte.length">
                                <li v-for="(z, n) in videoText(vi.text).punkte" :key="n">{{ z }}</li>
                            </ul>
                        </div>
                    </div>
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
                    <span v-if="bericht.kostenUsd"> · {{ useKostenAnzeige(bericht.kostenUsd) }}</span>
                </p>
            </template>

            <div v-else class="nwLeer">
                <i class="uil uil-newspaper"></i>
                <span>{{ ketteZeilen.length ? t('news.pickFromChain') : t('news.noDigest') }}</span>
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
                <p v-if="punktImFenster.korrektur === true" class="nwWichtigGross neu">
                    {{ t('news.fixMark') }}
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

        <div class="nwSpalten"
            :style="{ gridTemplateColumns: `minmax(0, ${teilung}fr) minmax(0, ${100 - teilung}fr)` }">
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
                    <span v-if="newsInfo.stichwortGefiltert" class="nwCountdown"
                        :title="t('news.filteredHint')">
                        {{ t('news.filtered', { n: newsInfo.stichwortGefiltert }) }}
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
                        <span v-if="b.art === 'youtube'" class="nwVideoMarke">{{ t('news.video') }}</span>
                        <span class="nwZeit">{{ dayjs(b.publishedAt).tz(zone()).format('DD.MM. HH:mm') }}</span>
                    </div>
                    <div class="nwBeitragTitel">{{ b.titel }}</div>
                    <!-- Video-Stichpunkte: zusammengeklappt zwei Zeilen, der
                         Pfeil klappt auf — der Link daneben öffnet weiter das
                         Original. Ohne Stichpunkte (noch nicht angesehen)
                         bleibt nur der Titel. -->
                    <div v-if="b.zusammenfassung" class="nwBeitragFassung"
                        :class="{ zu: !aufgeklappt.includes(b.id) }">
                        <span class="nwKiMarke">{{ t('news.aiMark') }}</span>{{ b.zusammenfassung }}
                    </div>
                    <div v-else-if="b.auszug" class="nwVorschau">{{ b.auszug }}</div>
                    <button v-if="b.zusammenfassung && b.zusammenfassung.length > 120" type="button"
                        class="nwKlappe" @click.prevent="klappeUm(b.id)">
                        <i class="uil" :class="aufgeklappt.includes(b.id) ? 'uil-angle-up' : 'uil-angle-down'"></i>
                        {{ aufgeklappt.includes(b.id) ? t('news.collapse') : t('news.expand') }}
                    </button>
                </a>
                </div>

                <div class="nwGriff" :title="t('news.resizeHint')"
                    @pointerdown="starteHoehe($event, 'beitraege')"
                    @dblclick="hoeheZuruecksetzen('beitraege')"></div>
            </section>
        </div>

        <!-- Chart-Bild in gross. Teleport nach body, damit kein Vorfahre mit
             transform/overflow das Overlay einfängt. Klick daneben schliesst,
             Escape ebenso (Listener im Setup). -->
        <Teleport to="body">
            <div v-if="grossesBild" class="nwBildOverlay" @click.self="grossesBild = null">
                <button type="button" class="nwBildZu" @click="grossesBild = null">
                    <i class="uil uil-times"></i>
                </button>
                <img :src="grossesBild.url" referrerpolicy="no-referrer" @click.stop />
                <a v-if="grossesBild.quelle" class="nwBildQuelle" :href="grossesBild.quelle"
                    target="_blank" rel="noopener" @click.stop>
                    <i class="uil uil-external-link-alt"></i>
                    {{ grossesBild.quelle.replace(/^https?:\/\//, '').split('/')[0] }} — {{ t('news.openArticle') }}
                </a>
            </div>
        </Teleport>
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

/* Schnell-Einstellungen des Berichts: Rhythmus · Themen · Länge */
.nwSchnell {
    display: flex;
    align-items: stretch;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin: 0 0 0.7rem;
}

/* Zugeklappter Zustand: Zahnrad plus eine Zeile Klartext. */
.nwSchnellKopf {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 0.5rem;
}

.nwSchnellZeile {
    font-size: 0.76rem;
    color: var(--white-60, rgba(255, 255, 255, 0.6));
    cursor: pointer;
}

.nwSchnellZeile:hover {
    color: var(--white-87);
}

.nwSchnellFuss {
    flex-basis: 100%;
    margin: 0.15rem 0 0;
    font-size: 0.7rem;
    color: var(--white-50, rgba(255, 255, 255, 0.5));
}

/* Zweizeilige Pille: fettes Schlagwort, darunter was es bewirkt. */
.ctl-pill.zwei {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.05rem;
    line-height: 1.2;
    text-align: left;
}

.ctl-pill.zwei small {
    font-size: 0.62rem;
    opacity: 0.7;
}

/*
 * Die Zahlenfelder. Ohne diese Regeln erben die `input[type=number]` die
 * Vorgabe des Browsers und stehen weiss in der dunklen Leiste — genau das war
 * der Fall, seit die Felder eingebaut wurden.
 */
.nwZahlFeld {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0;
    padding: 0.15rem 0.5rem 0.15rem 0.7rem;
    border: 1px solid var(--white-18, rgba(255, 255, 255, 0.15));
    border-radius: 999px;
    font-size: 0.72rem;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
    white-space: nowrap;
}

.nwZahlFeld input {
    width: 4.2rem;
    padding: 0.1rem 0.35rem;
    border: 1px solid var(--white-12, rgba(255, 255, 255, 0.1));
    border-radius: 6px;
    background: var(--black-bg-7, rgba(0, 0, 0, 0.25));
    color: var(--white-87);
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
    /* Die Pfeilchen fressen die halbe Feldbreite und werden hier nie benutzt. */
    appearance: textfield;
    -moz-appearance: textfield;
}

.nwZahlFeld input::-webkit-outer-spin-button,
.nwZahlFeld input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
}

.nwZahlFeld input:focus {
    outline: none;
    border-color: var(--blue-color, #01B4FF);
}

.nwZahlFeld input::placeholder {
    color: var(--white-40, rgba(255, 255, 255, 0.4));
    font-style: italic;
}

.nwGuthaben {
    margin: 0 0 0.7rem;
    padding: 0.45rem 0.7rem;
    border-radius: var(--border-radius, 6px);
    background: rgba(250, 190, 60, 0.1);
    border: 1px solid rgba(250, 190, 60, 0.35);
}

/* Ohne `min-width: 0` besteht ein Grid-Element auf seiner Min-Content-Breite —
   die Spur darf dann schrumpfen, der Inhalt nicht, und die Seite wird breiter
   als der Bildschirm. Die Terminzeilen kürzen stattdessen mit Auslassungspunkten. */
.nwKarte {
    min-width: 0;
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

/* Drei Spalten ab 900 px, zwei ab 600, darunter eine. Die Kacheln sind seit
   dem Zeitungsteil die Kurzfassung — der volle Text steht oben im Artikel
   und im Fenster, deshalb dürfen sie schmaler sein als früher. */
.nwPunkte {
    display: grid;
    grid-template-columns: 1fr;
    align-items: start;
    gap: 0.6rem;
}

@media (min-width: 600px) {
    .nwPunkte {
        grid-template-columns: 1fr 1fr;
    }
}

@media (min-width: 900px) {
    .nwPunkte {
        grid-template-columns: repeat(3, 1fr);
    }
}

/* ── Zeitungsoptik des Berichts ──
   Serifen-Schlagzeile, feine Doppellinie unter dem Kopf, Kapitel mit
   Spitzmarke und Spaltensatz — gelesen werden soll er wie ein Artikel,
   nicht wie ein Dashboard. */
.nwZeitung .nwBerichtKopf {
    padding-bottom: 0.5rem;
    border-bottom: 3px double var(--white-30, rgba(255, 255, 255, 0.3));
    flex-wrap: wrap;
}

.nwZeitung .nwUeberschrift {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1.7rem;
    line-height: 1.25;
    margin: 0.8rem 0 0.4rem;
}

.nwZeitung .nwLage {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1.02rem;
    font-style: italic;
    color: var(--white-75, rgba(255, 255, 255, 0.78));
    border-bottom: 1px solid var(--white-12, rgba(255, 255, 255, 0.1));
    padding-bottom: 0.8rem;
}

.nwThema {
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    background: rgba(90, 150, 250, 0.14);
    color: #7aa8f0;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

.nwThema.klein {
    font-size: 0.62rem;
    padding: 0.05rem 0.4rem;
}

/* Die Kette des Tages: eine Zeile je Bericht, die offene hervorgehoben.
   Bewusst flach und ohne Karte — sie ist ein Inhaltsverzeichnis, nicht der
   Inhalt, und darf dem Bericht darunter nicht die Aufmerksamkeit nehmen. */
.nwKette {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0 0 0.6rem;
}

.nwKetteHinweis {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0 0 0.3rem;
    color: var(--grey-color);
    font-size: 0.78rem;
}

.nwKetteZeile {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    padding: 0.4rem 0.7rem;
    border: 1px solid transparent;
    border-radius: var(--border-radius);
    background: var(--black-bg-soft, rgba(255, 255, 255, 0.03));
    color: var(--white-2, #d5d7dc);
    font-size: 0.82rem;
    text-align: left;
    cursor: pointer;
}

.nwKetteZeile:hover {
    border-color: var(--grey-color);
}

.nwKetteZeile.offen {
    border-color: var(--blue-color);
    background: rgba(1, 180, 255, 0.08);
}

.nwKetteZeit {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
}

.nwKetteName {
    padding: 0.05rem 0.45rem;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.06);
    font-size: 0.72rem;
    white-space: nowrap;
}

.nwKetteName.update {
    background: rgba(87, 190, 129, 0.16);
    color: #57be81;
}

/* Die Schlagzeile darf die Zeile nicht sprengen — eine Zeile, ein Bericht. */
.nwKetteTitel {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--grey-color);
}

.nwKetteTag {
    color: var(--grey-color);
    font-size: 0.74rem;
}

@media (max-width: 640px) {
    .nwKetteTitel,
    .nwKetteTag {
        display: none;
    }
}

/* Aktualisierung und Neu-Marke: bewusst in Grün statt im Orange der
   Wichtig-Marke — sie beantworten verschiedene Fragen („zählt das viel" gegen
   „kannte ich das schon"), und zwei gleichfarbige Marken nebeneinander würden
   wie eine aussehen. */
.nwUpdateMarke,
.nwNeuMarke {
    padding: 0.05rem 0.45rem;
    border-radius: 3px;
    background: rgba(87, 190, 129, 0.16);
    color: #57be81;
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
}

.nwUpdateMarke {
    border-radius: 999px;
    font-size: 0.7rem;
}

.nwArchivMarke {
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    background: rgba(232, 163, 61, 0.16);
    color: #e8a33d;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.nwKapitel {
    margin: 0.9rem 0 0;
}

.nwKapitelKopf {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin-bottom: 0.35rem;
}

.nwKapitelThema {
    flex: 0 0 auto;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #7aa8f0;
}

.nwKapitelTitel {
    margin: 0;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--white-87);
    line-height: 1.3;
}

/* Spaltensatz wie im Blatt: zwei Textspalten mit feiner Trennlinie. Nur am
   breiten Bildschirm — auf dem Telefon liest sich eine Spalte besser. */
.nwKapitelText {
    margin: 0 0 0.6rem;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 0.95rem;
    line-height: 1.65;
    color: var(--white-75, rgba(255, 255, 255, 0.78));
    text-align: justify;
    hyphens: auto;
}

/* Bilderleiste der Chartanalyse: Grafiken aus den recherchierten Artikeln,
   seitlich scrollbar statt das Zeitungslayout zu sprengen. */
.nwChartBilder {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
    margin: 0.2rem 0 0.9rem;
    padding-bottom: 0.25rem;
}
.nwChartBilder img {
    height: 140px;
    max-width: 260px;
    object-fit: cover;
    border-radius: 6px;
    border: 1px solid var(--white-18, rgba(255, 255, 255, 0.15));
    display: block;
}

@media (min-width: 900px) {
    .nwKapitelText {
        columns: 2;
        column-gap: 2rem;
        column-rule: 1px solid var(--white-12, rgba(255, 255, 255, 0.1));
    }
}

/*
 * Die Punkte als Artikel im Spaltensatz — der eigentliche Zeitungsteil.
 *
 * `break-inside: avoid` ist hier nicht Kosmetik: ohne die Regel reisst der
 * Spaltenumbruch einen Artikel mitten im Absatz auseinander, und die
 * Zwischenüberschrift steht am Fuss der linken Spalte über dem Text, der
 * rechts oben weitergeht. Genau das lässt Spaltensatz billig aussehen.
 */
@media (min-width: 900px) {
    .nwKapitel {
        columns: 2;
        column-gap: 2rem;
        column-rule: 1px solid var(--white-12, rgba(255, 255, 255, 0.1));
    }

    /* Kopf und Vorspann laufen über die volle Breite, erst danach bricht es. */
    .nwKapitelKopf {
        column-span: all;
    }

    /* Der Vorspann bringt seinen eigenen Spaltensatz schon mit — im nun
       ebenfalls spaltigen Kapitel ergäbe das vier Spalten. */
    .nwKapitelText {
        columns: auto;
        column-span: all;
    }
}

.nwArtikel {
    break-inside: avoid;
    margin: 0 0 1.1rem;
    cursor: pointer;
}

.nwArtikelTitel {
    margin: 0 0 0.25rem;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 0.98rem;
    font-weight: 700;
    line-height: 1.25;
    color: var(--white-87);
}

.nwArtikel:hover .nwArtikelTitel {
    color: var(--blue-color, #01B4FF);
}

.nwArtikelText {
    margin: 0;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 0.9rem;
    line-height: 1.6;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
    text-align: justify;
    hyphens: auto;
}

.nwArtikelZahlen {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.7rem;
    margin: 0.4rem 0 0;
}

.nwArtikelFuss {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.3rem 0 0;
    font-family: system-ui, sans-serif;
    font-size: 0.66rem;
    color: var(--white-50, rgba(255, 255, 255, 0.5));
}

/* Top-Meldungen: höchstens drei, deshalb nie mehr als drei Spalten — und auf dem
   Telefon nebeneinander unlesbar, dort bleibt es beim Stapel aus `.nwPunkte`. */
.nwPunkte.aufmacher {
    margin-bottom: 1.4rem;
}

/* Initiale im ersten Kapitel — das eine Zeitungs-Detail, das sofort wirkt. */
.nwKapitelText.erste::first-letter {
    float: left;
    font-size: 3.1em;
    line-height: 0.85;
    padding: 0.06em 0.12em 0 0;
    font-weight: 700;
    color: var(--white-87);
}

/*
 * ── Abwägung „dafür / dagegen / offen" ───────────────────────────────────
 *
 * Drei Spalten, farblich nur an der Kante unterschieden. Ganze Spalten grün
 * und rot einzufärben würde die Abwägung zur Ampel machen — sie ist aber
 * genau das Gegenteil: eine Gegenüberstellung, die der Leser selbst gewichtet.
 */
.nwWaage {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.7rem;
    margin: 0 0 1.2rem;
}

@media (min-width: 820px) {
    .nwWaage {
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }
}

.nwWaageSpalte {
    min-width: 0;
    padding: 0.6rem 0.75rem 0.7rem;
    border: 1px solid var(--white-12, rgba(255, 255, 255, 0.1));
    border-top: 2px solid var(--white-18, rgba(255, 255, 255, 0.2));
    border-radius: var(--border-radius, 8px);
    background: rgba(255, 255, 255, 0.022);
}

.nwWaageSpalte.dafuer {
    border-top-color: #4caf7d;
}

.nwWaageSpalte.dagegen {
    border-top-color: #ff5f56;
}

.nwWaageSpalte.offen {
    border-top-color: #7aa8f0;
}

.nwWaageKopf {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0 0 0.5rem;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--white-60);
}

.nwWaageSpalte.dafuer .nwWaageKopf i {
    color: #4caf7d;
}

.nwWaageSpalte.dagegen .nwWaageKopf i {
    color: #ff5f56;
}

.nwWaageSpalte.offen .nwWaageKopf i {
    color: #7aa8f0;
}

.nwWaageListe {
    margin: 0;
    padding: 0;
    list-style: none;
}

.nwWaageListe li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35rem;
    padding: 0.3rem 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    font-size: 0.84rem;
    line-height: 1.5;
    color: var(--white-75, rgba(255, 255, 255, 0.75));
}

.nwWaageListe li:last-child {
    border-bottom: none;
    padding-bottom: 0;
}

.nwWaageText {
    flex: 1 1 150px;
    min-width: 0;
}

/* Fakt oder Einschätzung — die Marke, die den Kasten überhaupt erst brauchbar
   macht. „Fakt" bewusst nüchtern und nicht grün: es ist eine Herkunftsangabe,
   kein Gütesiegel. */
.nwArt {
    flex: 0 0 auto;
    padding: 0.05rem 0.35rem;
    border-radius: 3px;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    border: 1px solid transparent;
}

.nwArt.fakt {
    background: rgba(255, 255, 255, 0.09);
    border-color: var(--white-18, rgba(255, 255, 255, 0.18));
    color: var(--white-87);
}

.nwArt.einschaetzung {
    background: transparent;
    border-color: var(--white-12, rgba(255, 255, 255, 0.14));
    color: var(--white-50, rgba(255, 255, 255, 0.5));
}

/*
 * ── Dossier ──────────────────────────────────────────────────────────────
 *
 * Die vierte Darstellung. Sie verzichtet auf den Zeitungssatz (Serifen,
 * Spalten, Initiale) und setzt stattdessen auf das, was sich überfliegen
 * lässt: Tabellen mit rechtsbündigen Zahlen, Bilder links neben der Meldung,
 * eine Marke für „wichtig". Serifen wären hier falsch — sie laden zum Lesen
 * ein, und das Dossier will nachgeschlagen werden.
 */
.nwDossier {
    margin-top: 0.4rem;
}

/* Marktstand und Termine nebeneinander, ab 1000 px. Darunter untereinander:
   eine Tabelle mit vier Spalten auf 375 px ist keine Tabelle mehr. */
.nwDoKopfzeile {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    /* Nicht strecken. Der Marktstand hat ein Dutzend Zeilen, die Termine an
       einem ruhigen Tag zwei — bei `stretch` erbt der kurze Kasten die Hoehe
       des langen und besteht zu neun Zehnteln aus Leere. Zwei Kaesten
       ungleicher Hoehe sind ehrlicher als ein aufgeblasener. */
    align-items: start;
    gap: 0.9rem;
    margin-bottom: 1.2rem;
}

@media (min-width: 1000px) {
    .nwDoKopfzeile {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }

    .nwDoKopfzeile.nwDoEinzeln {
        grid-template-columns: minmax(0, 1fr);
    }
}

.nwDoBlock {
    min-width: 0;
    border: 1px solid var(--white-12, rgba(255, 255, 255, 0.1));
    border-radius: var(--border-radius, 8px);
    background: rgba(255, 255, 255, 0.022);
    padding: 0.7rem 0.8rem 0.5rem;
    overflow-x: auto;
}

.nwDoTitel {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0 0 0.5rem;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--white-60);
}

.nwDoTitel i {
    color: var(--blue-color, #01B4FF);
    font-size: 0.95rem;
}

.nwDoTab {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
    /* Zahlen mit gleicher Ziffernbreite — sonst tanzen die Spalten */
    font-variant-numeric: tabular-nums;
}

.nwDoTab th {
    padding: 0 0.5rem 0.35rem 0;
    text-align: left;
    font-size: 0.66rem;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--white-50, rgba(255, 255, 255, 0.5));
    border-bottom: 1px solid var(--white-12, rgba(255, 255, 255, 0.12));
    white-space: nowrap;
}

.nwDoTab td {
    padding: 0.4rem 0.5rem 0.4rem 0;
    vertical-align: top;
    color: var(--white-75, rgba(255, 255, 255, 0.75));
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    line-height: 1.35;
}

.nwDoTab tbody tr:last-child td {
    border-bottom: none;
}

.nwDoTab tbody tr:hover td {
    background: rgba(255, 255, 255, 0.03);
}

.nwDoWas {
    color: var(--white-87);
    font-weight: 600;
    white-space: nowrap;
}

.nwDoWert b {
    color: var(--white-87);
    font-weight: 700;
    white-space: nowrap;
}

.nwDoZusatz,
.nwDoHer {
    color: var(--white-50, rgba(255, 255, 255, 0.5));
    font-size: 0.78rem;
}

/* Balken hinter den Werten mit fester Spanne (0–100). Bewusst dünn und
   einfarbig: er zeigt die Lage in der Spanne, keine Wertung. */
.nwDoBalken {
    display: block;
    height: 3px;
    margin-top: 0.28rem;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.09);
    overflow: hidden;
}

.nwDoBalken i {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--blue-color, #01B4FF);
}

.nwDoZeit {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    color: var(--white-87);
    font-weight: 600;
}

.nwDoLand {
    white-space: nowrap;
    font-weight: 500;
    color: var(--white-50, rgba(255, 255, 255, 0.5));
}

/* Der Vorwert in Klammern hinter der Prognose — ohne ihn sagt „0,5 %" nichts. */
.nwDoVor {
    margin-left: 0.35rem;
    color: var(--white-50, rgba(255, 255, 255, 0.5));
    font-size: 0.76rem;
}

.nwDoVor::before {
    content: '(';
}

.nwDoVor::after {
    content: ')';
}

.nwDoFuss {
    margin: 0.45rem 0 0;
    font-size: 0.68rem;
    color: var(--white-50, rgba(255, 255, 255, 0.45));
}

/* ── Kapitel im Dossier ── */
.nwDoKapitel {
    margin: 0 0 1.6rem;
    padding-top: 0.9rem;
    border-top: 1px solid var(--white-12, rgba(255, 255, 255, 0.1));
}

.nwDoKapitelKopf {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
}

.nwDoKapitelKopf h3 {
    flex: 1 1 100%;
    margin: 0.1rem 0 0;
    font-size: 1.08rem;
    font-weight: 700;
    line-height: 1.3;
    color: var(--white-87);
}

.nwDoNummer {
    flex: 0 0 auto;
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 4px;
    background: rgba(90, 150, 250, 0.16);
    color: #7aa8f0;
    font-size: 0.74rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
}

.nwDoLage {
    margin: 0 0 0.8rem;
    font-size: 0.9rem;
    line-height: 1.6;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
}

/* Kennzahlentabelle des Kapitels: eigener Rahmen, damit sie sich von den
   Meldungen darunter absetzt — sie ist ein Nachschlagewerk, kein Text. */
.nwDoZahlen {
    margin: 0 0 1rem;
    border: 1px solid var(--white-12, rgba(255, 255, 255, 0.1));
    border-radius: var(--border-radius, 8px);
    background: rgba(255, 255, 255, 0.022);
}

.nwDoZahlen th:first-child,
.nwDoZahlen td:first-child {
    padding-left: 0.7rem;
}

.nwDoZahlen th:last-child,
.nwDoZahlen td:last-child {
    padding-right: 0.7rem;
}

.nwDoZahlen th {
    padding-top: 0.5rem;
}

/* ── Meldung: Bild links, Text rechts ── */
.nwDoMeldung {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.7rem;
    padding: 0.7rem 0.75rem;
    margin-bottom: 0.5rem;
    border: 1px solid var(--white-12, rgba(255, 255, 255, 0.09));
    border-left: 3px solid transparent;
    border-radius: var(--border-radius, 8px);
    background: rgba(255, 255, 255, 0.018);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
}

.nwDoMeldung:hover {
    background: rgba(255, 255, 255, 0.045);
    border-color: var(--white-18, rgba(255, 255, 255, 0.2));
}

/* „Wichtig" nur als Kante plus Marke — eine ganze Karte einzufärben macht
   drei wichtige Meldungen zur Wand. */
.nwDoMeldung.hoch {
    border-left-color: #e8a33d;
}

@media (min-width: 700px) {
    .nwDoMeldung {
        grid-template-columns: 132px minmax(0, 1fr);
        align-items: start;
    }

    /* Ohne Bild darf der Text die ganze Breite haben */
    .nwDoMeldung:not(:has(> .nwDoBild)) {
        grid-template-columns: minmax(0, 1fr);
    }
}

.nwDoBild {
    width: 100%;
    height: 88px;
    object-fit: cover;
    border-radius: 6px;
    border: 1px solid var(--white-12, rgba(255, 255, 255, 0.12));
    display: block;
}

.nwDoInhalt {
    min-width: 0;
}

.nwDoMeldungTitel {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin: 0 0 0.3rem;
    font-size: 0.95rem;
    font-weight: 700;
    line-height: 1.3;
    color: var(--white-87);
}

.nwDoMeldung:hover .nwDoMeldungTitel {
    color: var(--blue-color, #01B4FF);
}

.nwDoMeldungText {
    margin: 0;
    font-size: 0.86rem;
    line-height: 1.55;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
}

.nwDoMeldungFuss {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem 0.6rem;
    margin: 0.5rem 0 0;
    font-size: 0.68rem;
    color: var(--white-50, rgba(255, 255, 255, 0.5));
}

.nwDoMeldungFuss .nwPunktQuelle {
    flex: 0 1 auto;
    max-width: 40%;
}

/* ── Archivliste ── */
.nwArchiv {
    margin: 0.6rem 0 0.2rem;
    border: 1px solid var(--white-12, rgba(255, 255, 255, 0.1));
    border-radius: var(--border-radius, 6px);
    overflow: hidden;
}

.nwArchivZeile {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    width: 100%;
    padding: 0.45rem 0.7rem;
    background: none;
    border: 0;
    border-bottom: 1px solid var(--white-12, rgba(255, 255, 255, 0.06));
    color: var(--white-70, rgba(255, 255, 255, 0.7));
    font-size: 0.82rem;
    text-align: left;
    cursor: pointer;
}

.nwArchivZeile:last-child {
    border-bottom: 0;
}

.nwArchivZeile:hover,
.nwArchivZeile.aktiv {
    background: rgba(255, 255, 255, 0.05);
    color: var(--white-87);
}

.nwArchivDatum {
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
    color: var(--white-60);
}

.nwArchivTitel {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
}

.nwArchivMeta {
    flex: 0 0 auto;
    color: var(--white-60);
    font-size: 0.74rem;
    white-space: nowrap;
}

.nwArchivLoeschen {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    color: var(--white-60);
}

.nwArchivLoeschen:hover {
    color: rgb(255, 120, 110);
    background: rgba(255, 95, 86, 0.12);
}

.nwArchivLoeschen.scharf {
    color: rgb(255, 120, 110);
    background: rgba(255, 95, 86, 0.12);
    font-size: 0.74rem;
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
   damit ein Hochformat-Bild die Kachel nicht in die Länge zieht — seit den
   drei Spalten flacher als früher. */
.nwPunktBild {
    width: calc(100% + 1.6rem);
    margin: -0.7rem -0.8rem 0.2rem;
    height: 90px;
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

.nwWichtigGross.neu {
    background: rgba(87, 190, 129, 0.16);
    color: #57be81;
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

/* Fünf Zeilen je Kachel — sie ist seit dem Zeitungsteil der Anriss, nicht
   mehr der ganze Absatz. Der volle Text steht im Fenster. */
.nwPunktText {
    display: -webkit-box;
    -webkit-line-clamp: 5;
    line-clamp: 5;
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

/*
 * Die Videobeschreibung. Eingerückt und abgesetzt, damit die Zeile darüber
 * weiterhin als Kostenzeile lesbar bleibt — bei „ausführlich" sind das schnell
 * zwölf Stichpunkte, die sonst mit der nächsten Videozeile verschmelzen.
 */
.nwVideoEintrag {
    padding: 0.15rem 0;
}

.nwVideoText {
    margin: 0.1rem 0 0.5rem 1.35rem;
    padding-left: 0.7rem;
    border-left: 2px solid var(--white-12, rgba(255, 255, 255, 0.1));
    font-size: 0.78rem;
    line-height: 1.5;
    color: var(--white-60, rgba(255, 255, 255, 0.62));
}

.nwVideoText p {
    margin: 0 0 0.35rem;
}

.nwVideoText ul {
    margin: 0;
    padding-left: 1rem;
}

.nwVideoText li {
    margin: 0.1rem 0;
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
/* `minmax(0, 1fr)` statt `1fr`: eine fr-Spur ist sonst mindestens so breit wie
   ihr Inhalt, und die Terminzeilen (Uhrzeit, Land, Titel ohne Umbruch) kommen
   auf gut 450 px. Auf dem Telefon schob das die ganze Seite waagerecht weg. */
.nwSpalten {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
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
        grid-template-columns: minmax(0, 1fr) !important;
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
    /* `display` ist Pflicht, nicht Kosmetik: In der Terminliste ist der Punkt
       ein Flex-Kind und bekommt seine Masse; in der Dossier-Tabelle steht er
       inline, und dort ignoriert der Browser width/height ersatzlos — die
       Wichtigkeits-Farbe fehlte dort schlicht. */
    display: inline-block;
    vertical-align: middle;
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
    grid-template-areas: 'bild kopf' 'bild titel' 'bild text' 'bild klappe';
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
    /* Stichpunkte der Videoanalyse: die Zeilenumbrüche sind der Inhalt */
    white-space: pre-line;
}

/* Zugeklappt: zwei Zeilen Anriss, der Rest hinter dem Pfeil */
.nwBeitragFassung.zu {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.nwKlappe {
    grid-area: klappe;
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    margin-top: 0.15rem;
    padding: 0;
    background: none;
    border: 0;
    font-size: 0.74rem;
    color: var(--white-60);
    cursor: pointer;
}

.nwKlappe:hover {
    color: var(--white-87);
}

.nwVideoMarke {
    padding: 0.02rem 0.35rem;
    border-radius: 3px;
    background: rgba(255, 95, 86, 0.14);
    color: rgb(255, 140, 130);
    font-size: 0.66rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
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

<!-- Unscoped: das Bild-Overlay wird per Teleport nach body gerendert,
     ausserhalb des Scoped-Bereichs dieser Komponente. -->
<style>
.nwBildOverlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(0, 0, 0, 0.88);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.7rem;
    padding: 2rem;
    cursor: zoom-out;
}
.nwBildOverlay img {
    max-width: min(96vw, 1700px);
    max-height: 82vh;
    object-fit: contain;
    border-radius: 8px;
    box-shadow: 0 10px 50px rgba(0, 0, 0, 0.7);
    cursor: default;
}
.nwBildZu {
    position: absolute;
    top: 16px;
    right: 20px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.25);
    color: #fff;
    border-radius: 8px;
    font-size: 1.15rem;
    line-height: 1;
    padding: 0.35rem 0.55rem;
    cursor: pointer;
}
.nwBildZu:hover {
    background: rgba(255, 255, 255, 0.22);
}
.nwBildQuelle {
    color: rgba(255, 255, 255, 0.75);
    font-size: 0.85rem;
    text-decoration: none;
}
.nwBildQuelle:hover {
    color: #fff;
    text-decoration: underline;
}
</style>
