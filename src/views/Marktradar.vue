<script setup>
/**
 * Marktradar — Kachelraster zur Marktlage.
 *
 * Aufgabenteilung: **die Seite holt, die Kachel zeichnet.** Die Gross-Ansicht
 * ist eine zweite Instanz derselben Kachel-Komponente und bekommt dieselben
 * Daten gereicht — ohne diese Trennung würde jedes Aufklappen die Fremdquelle
 * ein zweites Mal fragen.
 *
 * Unsichtbare Kacheln werden gar nicht erst geladen. Ausblenden spart damit
 * nicht nur Platz, sondern auch Anfragen an Fremdquellen.
 */
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Sortable from 'sortablejs'
import PageInfo from '../components/PageInfo.vue'
import RadarKachel from '../components/RadarKachel.vue'
import RadarOverlay from '../components/RadarOverlay.vue'
import KachelFearGreed from '../components/radar/KachelFearGreed.vue'
import KachelDominanz from '../components/radar/KachelDominanz.vue'
import KachelFunding from '../components/radar/KachelFunding.vue'
import KachelLsOi from '../components/radar/KachelLsOi.vue'
import KachelRsi from '../components/radar/KachelRsi.vue'
import KachelMarkt from '../components/radar/KachelMarkt.vue'
import KachelRainbow from '../components/radar/KachelRainbow.vue'
import KachelLiq24 from '../components/radar/KachelLiq24.vue'
import KachelRegime from '../components/radar/KachelRegime.vue'
import KachelAltseason from '../components/radar/KachelAltseason.vue'
import KachelPiCycle from '../components/radar/KachelPiCycle.vue'
import { liveSymbol } from '../stores/live.js'
// Für die Alarm-Einstellungen: currentUser hält den Einstellungssatz
import { currentUser } from '../stores/globals.js'
import { sendNotification } from '../utils/notify.js'
import { KACHELN, sortiereKacheln } from '../config/marktradar.js'
import { useHiddenCards } from '../composables/useHiddenCards.js'

const { t } = useI18n()

/** Kachel-Id → Komponente. Neue Kacheln werden hier eingehängt. */
const KOMPONENTEN = {
    fng: KachelFearGreed,
    dom: KachelDominanz,
    funding: KachelFunding,
    lsoi: KachelLsOi,
    rsi: KachelRsi,
    markt: KachelMarkt,
    rainbow: KachelRainbow,
    liq24: KachelLiq24,
    regime: KachelRegime,
    altseason: KachelAltseason,
    picycle: KachelPiCycle,
}

const { hiddenCards, reihenfolge, groessen, toggleCard, isVisible, setzeReihenfolge, setzeGroesse } =
    useHiddenCards('marktradar_hidden_cards')

/** Vorgabehöhe einer Kachel, wenn der Nutzer nichts gezogen hat. */
const STANDARD_HOEHE = 270

/**
 * Zusatzparameter einzelner Kacheln (Zeiteinheit, Quelle …). Kommen aus den
 * Bedienelementen IN der Kachel und überleben das Neuladen — sonst müsste man
 * seine Zeiteinheit nach jedem Seitenwechsel neu einstellen.
 */
const PARAM_KEY = 'marktradar_params'
/**
 * Einmalige Umstellung: wer die Seite vor der Vereinheitlichung benutzt hat,
 * trägt noch eine eigene Ranglisten-Grösse im Speicher — die würde die neue
 * Vorgabe (Top 50) für immer überstimmen. Der Marker sorgt dafür, dass genau
 * einmal aufgeräumt wird, ohne die übrigen Einstellungen anzutasten.
 */
const PARAM_VERSION = '2'
const kachelParams = reactive((() => {
    try {
        const roh = JSON.parse(localStorage.getItem(PARAM_KEY) || 'null')
        return roh && typeof roh === 'object' && !Array.isArray(roh) ? roh : {}
    } catch {
        return {}
    }
})())

/**
 * Anzeige-Einstellungen (Ansicht, Zeitfenster, Flächenmass): werden gemerkt,
 * lösen aber KEINEN neuen Abruf aus — sie ändern nur, wie vorhandene Daten
 * gezeichnet werden. Ein Abruf je Umschaltung würde die Fremdquellen ohne
 * Not belasten.
 */
function setzeAnzeige(id, wert) {
    kachelParams[id] = { ...(kachelParams[id] || {}), ...wert }
    localStorage.setItem(PARAM_KEY, JSON.stringify(kachelParams))
}

function setzeParams(id, wert) {
    kachelParams[id] = { ...(kachelParams[id] || {}), ...wert }
    localStorage.setItem(PARAM_KEY, JSON.stringify(kachelParams))
    ladeKachel(id, true)
}

if (localStorage.getItem(PARAM_KEY + '_v') !== PARAM_VERSION) {
    for (const eintrag of Object.values(kachelParams)) delete eintrag.n
    localStorage.setItem(PARAM_KEY, JSON.stringify(kachelParams))
    localStorage.setItem(PARAM_KEY + '_v', PARAM_VERSION)
}

const daten = reactive({})     // id → Nutzlast
const zustand = reactive({})   // id → 'idle'|'loading'|'ready'|'veraltet'|'error'
const stand = reactive({})     // id → Zeitpunkt der angezeigten Daten (ms)
const fehler = reactive({})    // id → Meldung

const offeneKachel = ref(null)
const showConfigDropdown = ref(false)
const configRef = ref(null)
const gridEl = ref(null)

let timer = null
let sortable = null
const laufendeAnfrage = {}     // id → Zähler, damit alte Antworten nicht gewinnen

const alleKacheln = computed(() => sortiereKacheln(reihenfolge.value))
const sichtbareKacheln = computed(() => alleKacheln.value.filter(k => isVisible(k.id)))

/** Zustandspunkt der Kopfzeile: der schlechteste aller sichtbaren Kacheln. */
const gesamtZustand = computed(() => {
    const werte = sichtbareKacheln.value.map(k => zustand[k.id] || 'idle')
    for (const stufe of ['error', 'veraltet', 'loading', 'idle']) {
        if (werte.includes(stufe)) return stufe
    }
    return werte.length ? 'ready' : 'idle'
})

const offeneDefinition = computed(() =>
    alleKacheln.value.find(k => k.id === offeneKachel.value) || null)

async function ladeKachel(id, erzwingen = false) {
    const kachel = alleKacheln.value.find(k => k.id === id)
    if (!kachel || !kachel.endpunkt) return

    const meine = (laufendeAnfrage[id] = (laufendeAnfrage[id] || 0) + 1)
    zustand[id] = daten[id] ? zustand[id] : 'loading'
    try {
        const { data } = await axios.get(kachel.endpunkt, {
            params: {
                ...(kachel.params || {}),
                ...(kachel.symbolAbhaengig ? { symbol: liveSymbol.value } : {}),
                ...(kachelParams[id] || {}),
                ...(erzwingen ? { force: 1 } : {}),
            },
        })
        // Eine ältere Antwort darf eine neuere nicht überschreiben
        if (meine !== laufendeAnfrage[id]) return
        daten[id] = data
        stand[id] = data.stand || Date.now()
        fehler[id] = data.hinweis || ''
        zustand[id] = data.veraltet ? 'veraltet' : 'ready'
    } catch (e) {
        if (meine !== laufendeAnfrage[id]) return
        fehler[id] = e.response?.data?.error || e.message
        // Vorhandene Daten stehen lassen — ein Aussetzer soll die Kachel nicht leeren
        zustand[id] = daten[id] ? 'veraltet' : 'error'
    }
}

function ladeFaellige(erzwingen = false) {
    if (document.hidden) return
    const jetzt = Date.now()
    for (const kachel of sichtbareKacheln.value) {
        const alter = jetzt - (stand[kachel.id] || 0)
        if (erzwingen || alter > kachel.intervallMs) ladeKachel(kachel.id, erzwingen)
    }
}

/** Kachel wird eingeblendet → sofort laden, sie hat noch nichts. */
function beiUmschalten(id) {
    toggleCard(id)
    if (isVisible(id) && !daten[id]) ladeKachel(id)
}

/**
 * Grösse einer Kachel im Raster. Breite zählt in Rasterspalten, Höhe in Pixeln —
 * beides aus dem Ziehen am Eckanfasser, sonst die Vorgabe aus der Registry.
 */
function stilFuer(kachel) {
    const g = groessen[kachel.id] || {}
    const spalten = g.spalten || kachel.spalten || 1
    return {
        gridColumn: `span ${spalten}`,
        height: `${g.hoehe || STANDARD_HOEHE}px`,
    }
}

// ── Grösse ziehen ───────────────────────────────────────────
// Sortable hängt am Griff oben links, der Grössen-Anfasser unten rechts hat
// seine eigene Behandlung — dadurch beissen sich Verschieben und Vergrössern
// weder mit der Maus noch am Finger.
let griff = null

function starteGroesse(kachel, ev) {
    if (!gridEl.value) return
    const el = ev.target.closest('[data-kachel]')
    const stil = getComputedStyle(gridEl.value)
    const spaltenBreiten = stil.gridTemplateColumns.split(' ').map(parseFloat)
    const lueckeX = parseFloat(stil.columnGap) || 0
    const g = groessen[kachel.id] || {}

    griff = {
        id: kachel.id,
        x: ev.clientX, y: ev.clientY,
        spalten: g.spalten || kachel.spalten || 1,
        hoehe: el?.getBoundingClientRect().height || STANDARD_HOEHE,
        maxSpalten: spaltenBreiten.length,
        schritt: (spaltenBreiten[0] || 300) + lueckeX,
        el,
    }
    el?.querySelector('.radarCard')?.classList.add('wirdGezogen')
    gridEl.value.classList.add('imGriff')
    window.addEventListener('pointermove', beiGroesse)
    window.addEventListener('pointerup', endeGroesse)
    window.addEventListener('pointercancel', endeGroesse)
}

function beiGroesse(ev) {
    if (!griff) return
    const dx = ev.clientX - griff.x
    const dy = ev.clientY - griff.y
    const spalten = Math.max(1, Math.min(griff.maxSpalten, griff.spalten + Math.round(dx / griff.schritt)))
    const hoehe = Math.max(180, Math.min(1000, Math.round(griff.hoehe + dy)))
    // Während des Ziehens nur im Speicher — geschrieben wird einmal am Ende
    setzeGroesse(griff.id, { spalten, hoehe }, false)
}

function endeGroesse() {
    if (griff) {
        setzeGroesse(griff.id, {}, true)
        griff.el?.querySelector('.radarCard')?.classList.remove('wirdGezogen')
    }
    gridEl.value?.classList.remove('imGriff')
    griff = null
    window.removeEventListener('pointermove', beiGroesse)
    window.removeEventListener('pointerup', endeGroesse)
    window.removeEventListener('pointercancel', endeGroesse)
}

/** Doppelklick auf den Anfasser: zurück auf die Vorgabe aus der Registry. */
function setzeGroesseZurueck(kachel) {
    setzeGroesse(kachel.id, null, true)
}

function onClickOutside(e) {
    if (showConfigDropdown.value && configRef.value && !configRef.value.contains(e.target)) {
        showConfigDropdown.value = false
    }
}

/**
 * Umsortieren. Sortable arbeitet direkt am DOM; wir lesen danach die Reihenfolge
 * aus den data-Attributen und lassen Vue neu zeichnen — die gespeicherte Liste
 * enthält bewusst ALLE Kacheln, auch ausgeblendete, damit sie beim Einblenden
 * wieder an ihrem Platz erscheinen.
 */
function initSortable() {
    if (!gridEl.value) return
    sortable = Sortable.create(gridEl.value, {
        // Die ganze Kopfzeile zieht, nicht nur das Punkteraster: das war 14 × 14
        // Pixel gross und damit selbst mit der Maus kaum zu treffen, am Finger
        // gar nicht. Die Knöpfe darin bleiben Knöpfe (filter).
        handle: '.radarCardHead',
        filter: '.radarCardBtn, button, a',
        preventOnFilter: false,
        animation: 150,
        ghostClass: 'radarGhost',
        // Eigene Zieh-Simulation statt HTML5-Drag-and-drop: die native Variante
        // kennt keine Berührung, und ihr Ghost-Bild sieht in einem Raster mit
        // verschieden grossen Kacheln zerrissen aus.
        forceFallback: true,
        fallbackTolerance: 4,
        // Bei neun Kacheln ist die Seite gut 2400 px hoch — ohne mitlaufenden
        // Bildlauf kommt man von der obersten Reihe nie zur untersten. Der
        // Zusatz `forceAutoScrollFallback` ist Pflicht: ohne ihn bleibt das
        // Scrollen in der Ersatz-Zieh-Simulation wirkungslos.
        scroll: true,
        forceAutoScrollFallback: true,
        scrollSensitivity: 90,
        scrollSpeed: 18,
        bubbleScroll: true,
        onEnd: (evt) => {
            const { oldIndex, newIndex } = evt
            if (oldIndex === newIndex || oldIndex == null || newIndex == null) return

            // WICHTIG: Sortable hat die Knoten im DOM bereits verschoben, Vue
            // weiss davon nichts. Ohne Rücknahme patcht Vue beim nächsten
            // Rendern gegen einen DOM, den es nicht selbst gebaut hat — dann
            // springen Kacheln zurück oder erscheinen doppelt. Also: DOM
            // zurückdrehen, Reihenfolge in den Zustand schreiben, neu rendern
            // lassen. Der Zustand ist die Wahrheit, nicht das DOM.
            // Der Knoten steht jetzt an newIndex und muss zurück an oldIndex.
            // Die Bezugsposition unterscheidet sich je Richtung: nach UNTEN
            // verschoben liegt an oldIndex bereits der Nachrücker, nach OBEN
            // verschoben steht dort noch der alte Nachbar.
            //   runter (old < neu):  vor children[oldIndex] einfügen
            //   rauf   (old > neu):  vor children[oldIndex + 1] einfügen
            // Vertauscht man das, landet der Knoten eine Stelle daneben, Vue
            // rendert dagegen an — und die Kachel sprang zurück. Genau das war
            // der Grund, warum sich Kacheln nur nach OBEN verschieben liessen.
            const eltern = evt.from
            const knoten = evt.item
            const bezug = eltern.children[oldIndex + (oldIndex < newIndex ? 0 : 1)]
            eltern.insertBefore(knoten, bezug || null)

            const sichtbar = sichtbareKacheln.value.map(k => k.id)
            const [bewegt] = sichtbar.splice(oldIndex, 1)
            sichtbar.splice(newIndex, 0, bewegt)

            // Ausgeblendete Kacheln behalten ihren Platz am Ende, damit sie
            // beim Wiedereinblenden nicht wahllos irgendwo auftauchen
            const versteckt = alleKacheln.value.map(k => k.id).filter(id => !sichtbar.includes(id))
            setzeReihenfolge([...sichtbar, ...versteckt])
        },
    })
}

onMounted(async () => {
    document.addEventListener('click', onClickOutside)
    await nextTick()
    initSortable()
    // Versetzt anfordern statt alle auf einmal: RSI und Altcoin-Saison holen
    // je fünfzig Kerzenreihen, und wenn zwölf Kacheln gleichzeitig loslegen,
    // drosselt Binance — mit halb leeren Kacheln als Ergebnis.
    for (const [i, kachel] of sichtbareKacheln.value.entries()) {
        setTimeout(() => ladeKachel(kachel.id), i * 250)
    }
    timer = setInterval(() => ladeFaellige(false), 30000)
})

/**
 * Pi-Cycle-Alarm. Die Kreuzung der 111-Tage- über die doppelte 350-Tage-Linie
 * ist ein Ereignis, das man nicht verpassen will — und das im Zweifel eintritt,
 * während man etwas anderes tut. Deshalb einmal je Kreuzung eine
 * Benachrichtigung; der Merker verhindert, dass sie bei jedem Seitenaufruf
 * erneut kommt.
 */
const ALARM_KEY = 'marktradar_picycle_alarm'
const VORWARN_KEY = 'marktradar_picycle_vorwarnung'

watch(() => daten.picycle, (d) => {
    if (!d || Number(currentUser.value?.radarPicycleAlarm ?? 1) !== 1) return

    // 1. Die Kreuzung selbst — einmal je Ereignis
    if (d.frisch && d.letzteKreuzung) {
        const marke = String(d.letzteKreuzung.t)
        if (localStorage.getItem(ALARM_KEY) !== marke) {
            localStorage.setItem(ALARM_KEY, marke)
            sendNotification(
                t('marktradar.picycle.title'),
                t('marktradar.picycle.alarm', { datum: new Date(d.letzteKreuzung.t).toLocaleDateString() }),
            )
        }
        return
    }

    /*
     * 2. Vorwarnung, bevor es so weit ist.
     *
     * Die Kreuzung selbst zu melden ist zwar korrekt, kommt aber per
     * Definition zu spät — sie IST das Signal. Wer eine Schwelle setzt,
     * bekommt Vorlauf: nähert sich der Abstand von unten der eingestellten
     * Grenze, meldet sich der Alarm einmal. Der Merker enthält die Schwelle,
     * damit ein Herabsetzen erneut auslösen darf, ein Seitenaufruf aber nicht.
     */
    const schwelle = Number(currentUser.value?.radarPicycleSchwelle ?? 0)
    if (!schwelle || d.jetzt?.abstandPct == null) return
    if (d.jetzt.abstandPct < -schwelle) {
        // Wieder weiter entfernt: Merker löschen, damit die nächste Annäherung zählt
        if (localStorage.getItem(VORWARN_KEY)) localStorage.removeItem(VORWARN_KEY)
        return
    }
    const merker = `${schwelle}|${new Date().getFullYear()}`
    if (localStorage.getItem(VORWARN_KEY) === merker) return
    localStorage.setItem(VORWARN_KEY, merker)
    sendNotification(
        t('marktradar.picycle.title'),
        t('marktradar.picycle.vorwarnung', { pct: Math.abs(d.jetzt.abstandPct), schwelle }),
    )
})

// Symbolwechsel im Seitenmenü: nur die Kacheln neu holen, die daran hängen
watch(liveSymbol, () => {
    for (const kachel of sichtbareKacheln.value) {
        if (kachel.symbolAbhaengig) ladeKachel(kachel.id, true)
    }
})

onBeforeUnmount(() => {
    document.removeEventListener('click', onClickOutside)
    endeGroesse()
    clearInterval(timer)
    sortable?.destroy()
    sortable = null
})
</script>

<template>
    <div class="radarWrap">
        <div class="liveHeader">
            <div class="liveTitle">
                <span class="liveSymbol">{{ t('marktradar.title') }}</span>
                <span :class="['liveDot', 'dot-' + gesamtZustand]"></span>
                <span class="liveState">{{ t('marktradar.status_' + gesamtZustand) }}</span>
            </div>
            <div class="liveActions">
                <div ref="configRef" class="position-relative">
                    <button type="button" class="ctl-pill" @click="showConfigDropdown = !showConfigDropdown">
                        <i class="uil uil-apps"></i>{{ t('marktradar.cards') }}
                    </button>
                    <div v-if="showConfigDropdown" class="card-config-dropdown">
                        <div class="card-config-title">{{ t('auswertung.visibleCards') }}</div>
                        <div v-for="kachel in alleKacheln" :key="kachel.id" class="card-config-item"
                            @click="beiUmschalten(kachel.id)">
                            <i class="uil me-2"
                                :class="isVisible(kachel.id) ? 'uil-check-square text-success' : 'uil-square-full text-muted'"></i>
                            {{ t(kachel.titleKey) }}
                        </div>
                    </div>
                </div>
                <button type="button" class="ctl-pill" @click="ladeFaellige(true)">
                    <i class="uil uil-sync"></i>{{ t('marktradar.refreshAll') }}
                </button>
                <span class="ctl-sep"></span>
                <PageInfo section="info.marktradar" />
            </div>
        </div>

        <div ref="gridEl" class="radarGrid">
            <div v-for="kachel in sichtbareKacheln" :key="kachel.id" :data-kachel="kachel.id"
                :style="stilFuer(kachel)">
                <RadarKachel :titel="t(kachel.titleKey)" :icon="kachel.icon" :zustand="zustand[kachel.id] || 'idle'"
                    :stand="stand[kachel.id] || 0" :fehler="fehler[kachel.id] || ''" :hat-daten="!!daten[kachel.id]"
                    @gross="offeneKachel = kachel.id" @neuladen="ladeKachel(kachel.id, true)"
                    @groesse-start="starteGroesse(kachel, $event)" @groesse-zurueck="setzeGroesseZurueck(kachel)">
                    <component :is="KOMPONENTEN[kachel.id]" :daten="daten[kachel.id]" :gross="false"
                        :params="kachelParams[kachel.id] || {}"
                        @params="setzeParams(kachel.id, $event)"
                        @anzeige="setzeAnzeige(kachel.id, $event)" />
                </RadarKachel>
            </div>
        </div>

        <div v-if="!sichtbareKacheln.length" class="radarLeer">{{ t('marktradar.allHidden') }}</div>

        <!-- Gross: dieselbe Komponente, dieselben Daten, nur mit mehr Platz -->
        <RadarOverlay v-if="offeneKachel && daten[offeneKachel]" :titel="t(offeneDefinition.titleKey)"
            :quelle="offeneDefinition.quelle" @schliessen="offeneKachel = null">
            <component :is="KOMPONENTEN[offeneKachel]" :daten="daten[offeneKachel]" :gross="true"
                :params="kachelParams[offeneKachel] || {}"
                @params="setzeParams(offeneKachel, $event)"
                @anzeige="setzeAnzeige(offeneKachel, $event)" />
        </RadarOverlay>
    </div>
</template>

<style scoped>
.radarWrap {
    display: flex;
    flex-direction: column;
    /* Anders als die Chart-Seiten hat der Radar keine feste Höhe: das Raster
       darf wachsen und die Seite scrollen. */
    min-height: 300px;
}
</style>
