<script setup>
/**
 * Zeichenteil der Liquidationskarte.
 *
 * Herausgezogen aus `src/views/Liquidations.vue`, damit dieselbe Karte auch als
 * Kachel im Live-Trading-Fenster stehen kann. Hier liegt ALLES, was mit Daten,
 * Rechnen und Zeichnen zu tun hat; Kopfzeile und Fusszeile bleiben bei der
 * Seite, weil sie in einer Kachel keinen Platz haben und dort der Kachelrahmen
 * dieselbe Aufgabe übernimmt.
 *
 * Bewusst NICHT reaktiv gehalten, was TypedArrays enthält (`source`,
 * `renderer`, `hist`) — dieselbe Entscheidung wie in der Bookmap: Vue soll
 * Matrizen mit Zehntausenden Zellen nicht in Proxys wickeln.
 *
 * Die Seite liest Zustand und Stand über `defineExpose` aus, statt sie per
 * Ereignis nach oben zu schicken: es sind Anzeigewerte, die jederzeit abgefragt
 * werden können, keine Ereignisse, auf die man reagieren müsste.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { LeverageMapSource } from '../utils/leverageMapSource.js'
import { buildLeverageHistory } from '../utils/leverageMap.js'
import { LeverageMapRenderer } from '../utils/leverageMapRenderer.js'
import {
    liveSymbol,
    levMapTier, levMapHours, levMapSpanPct, levMapMmr, levMapMmrQuelle, levMapWeights, levMapView, levMapThreshold, levMapProfileW,
} from '../stores/live.js'
import { aktualisiereMarginRate } from '../utils/marginRate.js'
import dayjs from '../utils/dayjs-setup.js'

/**
 * Eigene Vorgaben statt der Einstellungen aus dem Seitenmenü.
 *
 * Gesetzt nur von der Kachel im Live-Trading-Fenster, die auf Daytrading
 * ausgelegt ist. Die eigenständige Seite übergibt nichts und arbeitet weiter
 * mit `levMapHours`/`levMapSpanPct` — eine Kachel darf die Einstellung einer
 * Seite nicht umschreiben. Auch das Zoomen bleibt bei gesetzter Vorgabe lokal.
 */
const props = defineProps({
    /** Beobachtetes Zeitfenster in Stunden; null = Einstellung benutzen. */
    stunden: { type: Number, default: null },
    /** Angezeigtes Preisband in Prozent; null = Einstellung benutzen. */
    spannePct: { type: Number, default: null },
})

const { t } = useI18n()

const wrapEl = ref(null)
const canvasEl = ref(null)
const status = ref('idle')
const statusDetail = ref('')
const stand = ref(0)

// Nicht reaktiv: enthalten TypedArrays
let source = null
let renderer = null
let hist = null            // Verlaufsmatrix, nur im Heatmap-Modus
let ro = null
let resizeTimer = null

// Auf Summe 1 normiert: die Gewichte gehen multiplikativ in Tooltip-Beträge
// und Abdeckungs-% ein. Roh (Summe 100) wären alle absoluten Werte im Modus
// „Alle" rund 100-fach überhöht — die Optik war davon nie betroffen (p98-
// Normierung), nur die Zahlen.
const gewichte = computed(() => {
    const roh = String(levMapWeights.value || '40,30,20,10').split(',').map(x => Number(x) || 0)
    const summe = roh.reduce((a, b) => a + b, 0)
    return summe > 0 ? roh.map(x => x / summe) : roh.map(() => 1 / (roh.length || 1))
})

const zeitstempel = computed(() => (stand.value ? new Date(stand.value).toLocaleTimeString() : '—'))

const formatTime = (ms) => dayjs(ms).format('HH:mm')

/** Eigene Spanne, sobald eine Vorgabe gesetzt ist — sonst gilt die Einstellung. */
const lokaleSpanne = ref(props.spannePct)

/** Angezeigtes Preisband und beobachtetes Fenster — Vorgabe schlägt Einstellung. */
const spanne = computed(() => props.spannePct != null ? lokaleSpanne.value : levMapSpanPct.value)
const stundenEff = computed(() => props.stunden != null ? props.stunden : levMapHours.value)

/**
 * Erfasste Spanne der Karte. Bewusst grösser als die ANGEZEIGTE: 10x
 * liquidiert erst bei −9,6 %, das muss im Raster stehen, auch wenn man gerade
 * auf ±2 % hineingezoomt hat. Dadurch kostet Zoomen keine Neuberechnung —
 * gezoomt wird nur der Ausschnitt, den der Renderer zeichnet.
 */
const erfassung = () => Math.max(12, spanne.value)

/**
 * Verlaufsmatrix neu rechnen. Bewusst getrennt vom Zeichnen: das ist der teure
 * Teil (einmal vorwärts über alle Kerzen) und darf nicht an jeder Mausbewegung
 * hängen.
 */
function baueVerlauf() {
    hist = null
    if (levMapView.value !== 'history' || !source?.points.length || !source.map) return
    const letzte = source.points[source.points.length - 1]
    if (!(letzte.c > 0)) return
    const gew = levMapTier.value === 'all'
        ? gewichte.value
        : source.map.tiers.map((_, i) => (i === Number(levMapTier.value) ? 1 : 0))
    hist = buildLeverageHistory(source.points, {
        mid: letzte.c, bucketSize: source.map.bucketSize,
        spanPct: erfassung(), mmr: levMapMmr.value,
        weights: gew, seed: false,
    })
}

function zeichne() {
    if (!renderer || !source) return
    renderer.setThreshold(levMapThreshold.value)
    renderer.setProfileWidth(levMapView.value === 'history' ? levMapProfileW.value : 0)
    if (levMapView.value === 'history') {
        renderer.drawHistory({
            hist, viewPct: spanne.value, formatTime, hinweis: statusDetail.value,
        })
        return
    }
    const map = source.map
    // Letzter Schlusskurs direkt — nicht über rowFor/priceAt, das würde den
    // Preis unnötig auf das Bucket-Raster runden.
    const mid = source.points.length ? source.points[source.points.length - 1].c : 0
    renderer.draw({
        map,
        mid,
        viewPct: spanne.value,
        tier: levMapTier.value === 'all' ? 'all' : Number(levMapTier.value),
        weights: gewichte.value,
        hinweis: statusDetail.value,
    })
}

function applySize() {
    if (!wrapEl.value || !renderer) return
    const rect = wrapEl.value.getBoundingClientRect()
    if (rect.width < 10 || rect.height < 10) return
    renderer.resize(rect.width, rect.height)
    zeichne()
}

function setzeEtiketten() {
    renderer?.setLabels({
        title: t('levmap.title'), long: t('levmap.long'), short: t('levmap.short'),
        swept: t('levmap.swept'), mass: t('levmap.mass'), window: t('levmap.window'),
        mmr: t('levmap.mmr'), noData: t('levmap.noData'), toMid: t('live.toMid'),
        history: t('levmap.history'), price: t('levmap.price'),
        coverage: t('levmap.coverage'), thinWindow: t('levmap.thinWindow'),
    })
}

onMounted(async () => {
    renderer = new LeverageMapRenderer(canvasEl.value)
    setzeEtiketten()
    await nextTick()
    applySize()

    ro = new ResizeObserver(() => {
        clearTimeout(resizeTimer)
        resizeTimer = setTimeout(applySize, 120)
    })
    ro.observe(wrapEl.value)

    source = new LeverageMapSource({
        symbol: liveSymbol.value,
        hours: stundenEff.value,
        spanPct: erfassung(),
        mmr: levMapMmr.value,
        onStatus: (s, d) => { status.value = s; statusDetail.value = d || ''; if (s !== 'ready') zeichne() },
        onMap: () => { stand.value = source?.map?.ts || 0; baueVerlauf(); zeichne() },
    })
    await source.start()
})

onBeforeUnmount(() => {
    ro?.disconnect()
    clearTimeout(resizeTimer)
    source?.stop()
    source = null
    renderer = null
})

// Symbol/Fenster brauchen neue Daten, Stufe/Spanne/Margin nur eine neue Rechnung
watch([liveSymbol, stundenEff], () => {
    source?.update({ symbol: liveSymbol.value, hours: stundenEff.value })
})

/**
 * Wartungsmarge nachziehen. Bewusst ohne `await`: der Abruf setzt `levMapMmr`,
 * und der Beobachter darunter baut die Karte dann neu. Würde hier gewartet,
 * hinge das erste Bild an einer fremden Börse.
 */
watch([liveSymbol, levMapMmrQuelle], () => aktualisiereMarginRate(liveSymbol.value), { immediate: true })
// Neu rechnen nur, wenn sich die ERFASSTE Spanne ändert. Reines Hineinzoomen
// bleibt innerhalb des Rasters und braucht bloss einen neuen Anstrich.
watch([spanne, levMapMmr], () => {
    if (!source) return
    const neu = erfassung()
    if (neu !== source.spanPct || levMapMmr.value !== source.mmr) {
        source.spanPct = neu
        source.mmr = levMapMmr.value
        source.rebuild()
    } else {
        zeichne()
    }
})
watch(levMapProfileW, zeichne)
watch([levMapTier, levMapWeights, levMapView], () => { baueVerlauf(); zeichne() })
// Nur eine Zeichenfrage — die Matrix bleibt, es wird lediglich weniger gemalt
watch(levMapThreshold, zeichne)

/**
 * Bedient wird mit Zeiger-Ereignissen statt Maus-Ereignissen: dieselbe Logik
 * trägt Maus, Stift und Finger — dasselbe Muster wie in der Bookmap.
 *
 * Auf dem Handy gibt es weder Hover noch Mausrad. Ohne das hier gäbe es auf
 * dieser Seite am Telefon gar keine Bedienung: das Fadenkreuz erschiene nie,
 * und die Preisspanne liesse sich überhaupt nicht ändern — für sie gibt es
 * (anders als bei der Bookmap) auch keinen Regler im Seitenmenü.
 */
const zeiger = new Map()   // pointerId → {x, y} in Bildschirmkoordinaten
let pinch = null           // { dist, span } beim Ansetzen des zweiten Fingers

const fingerAbstand = () => {
    const [a, b] = [...zeiger.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Spanne begrenzen und auf zwei Stellen runden — eine Stelle für alle Wege. */
function setzeSpanne(wert) {
    const neu = Math.min(40, Math.max(0.5, wert))
    const gerundet = Math.round(neu * 100) / 100
    // Bei eigener Vorgabe bleibt das Zoomen lokal: sonst verstellte ein
    // Mausrad in der Kachel die Einstellung der eigenständigen Seite.
    if (props.spannePct != null) lokaleSpanne.value = gerundet
    else levMapSpanPct.value = gerundet
}

function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    zeiger.set(e.pointerId, { x: e.clientX, y: e.clientY })
    // Zeiger einfangen, damit das Ziehen auch ausserhalb der Fläche weiterläuft
    try { wrapEl.value?.setPointerCapture(e.pointerId) } catch { /* egal */ }

    if (zeiger.size === 2) {
        pinch = { dist: fingerAbstand(), span: spanne.value }
        return
    }
    // Ohne Hover braucht der Finger sofort ein Fadenkreuz
    onMove(e)
}

function onMove(e) {
    if (!wrapEl.value) return
    if (zeiger.has(e.pointerId)) zeiger.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // Zwei Finger: Auseinanderziehen holt das Preisband enger heran
    if (pinch && zeiger.size >= 2) {
        const ratio = fingerAbstand() / pinch.dist
        if (ratio > 0) setzeSpanne(pinch.span / ratio)
        return
    }

    const rect = wrapEl.value.getBoundingClientRect()
    renderer?.setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    zeichne()
}

function onPointerUp(e) {
    if (e?.pointerId !== undefined) zeiger.delete(e.pointerId)
    else zeiger.clear()
    if (zeiger.size < 2) pinch = null
}

function onLeave(e) {
    // Beim Loslassen eines Fingers meldet der Browser ebenfalls „leave" —
    // das Fadenkreuz soll dann stehen bleiben, sonst blinkt es bei jedem Tipp.
    if (e?.pointerType && e.pointerType !== 'mouse') return
    renderer?.setCursor(null)
    zeichne()
}

/**
 * Mausrad zoomt die Preisachse. Multiplikativ statt in festen Schritten, damit
 * sich das Zoomen bei ±2 % genauso anfühlt wie bei ±20 %.
 */
function onWheel(e) {
    e.preventDefault()
    setzeSpanne(spanne.value * (e.deltaY > 0 ? 1.15 : 1 / 1.15))
}

/**
 * Für die Seite: Verbindungszustand und Stand der Karte. Die Kachel braucht das
 * nicht — dort zeigt der Kachelrahmen den Zustandspunkt.
 */
defineExpose({ status, statusDetail, stand, zeitstempel })
</script>

<template>
    <div ref="wrapEl" class="levCanvasWrap" @pointermove="onMove" @pointerdown="onPointerDown"
        @pointerup="onPointerUp" @pointercancel="onPointerUp" @pointerleave="onLeave"
        @wheel.prevent="onWheel">
        <canvas ref="canvasEl"></canvas>
    </div>
</template>

<style scoped>
.levCanvasWrap {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    background: var(--black-bg-2, #14141f);
    border-radius: var(--border-radius, 6px);
    overflow: hidden;
    cursor: crosshair;
    /* Der Finger setzt das Fadenkreuz und zoomt mit zwei Fingern — die Geste
       darf nicht vorher als Seitenscroll oder Browser-Zoom abgefangen werden. */
    touch-action: none;
}

.levCanvasWrap canvas {
    display: block;
}
</style>
