<script setup>
/**
 * Vue-Hülle um LiveFeed (Daten) und HeatmapRenderer (Zeichnen).
 *
 * Bewusst KEINE Reaktivität auf Ring, Orderbuch oder Renderer: Vue würde
 * Proxies um die TypedArrays legen und der Hot Path bräche zusammen. Reaktiv
 * sind nur Skalare für die Statusanzeige.
 *
 * Einstellungen kommen direkt aus dem Live-Store (wie SidebarFilters die
 * Journal-Filter liest), nicht über Props — die Bedienelemente sitzen im
 * Seitenmenü und in der Kopfzeile, also in ganz anderen Komponenten.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { LiveFeed } from '../utils/liveFeed.js'
import { HeatmapRenderer } from '../utils/heatmapRenderer.js'
import { loadReplay } from '../utils/replaySource.js'
import { TradeRing } from '../utils/tradeRing.js'
import { followMid } from '../../shared/priceBins.js'
import { timeZoneTrade } from '../stores/ui.js'
import {
    liveSymbol, liveMarket, liveViewPct, liveFrameMs, liveHistoryMin, liveRamp,
    liveShowProfile, livePauseInBackground, liveColorMode, liveColorRef,
    liveAutoFollow, liveFrozen, liveAutoRefValue, liveThreshold, liveShowLiquidations, liveDotStep, liveProfileW, liveShowVolumeBars,
    liveMode, replayFrom, replayTo, livePrefillMin, VIEW_PCT_OPTIONS,
} from '../stores/live.js'
import dayjs from '../utils/dayjs-setup.js'

const emit = defineEmits(['status'])

const { t, locale } = useI18n()

/**
 * Der Renderer ist Vue-frei und kann kein useI18n(). Die Canvas-Texte werden
 * ihm deshalb hier übersetzt übergeben — einmal beim Einhängen und erneut,
 * wenn die Sprache wechselt.
 */
const canvasLabels = () => ({
    coverage: t('live.coverage'), traded: t('live.traded'), max: t('live.max'),
    liquidity: t('live.liquidity'), toMid: t('live.toMid'),
    noRecording: t('live.noRecording'), volumePer: t('live.volumePer', { n: '{n}' }),
    bought: t('live.bought'), sold: t('live.sold'), sum: t('live.sum'),
    buyerShare: t('live.buyerShare'),
})

const wrapEl = ref(null)
const heatEl = ref(null)
const overlayEl = ref(null)
const uiEl = ref(null)

const status = ref('idle')
const statusDetail = ref('')
/** Scrub-Position in der Wiedergabe: 0 = Anfang, 1 = Ende des Zeitfensters. */
const replayPos = ref(1)
const replayCols = ref(0)
const replayTimeLabel = ref('')

defineExpose({ replayPos, replayCols, replayTimeLabel })

// Nicht-reaktiver Zustand
let feed = null
let replay = null          // { ring, frameMs, cols } im Wiedergabe-Modus
let emptyTrades = new TradeRing(1)
let renderer = null
let ro = null
let raf = null
let resizeTimer = null
let normTimer = null
let view = null            // { lo, hi } in absoluten Bucket-Indizes
let cursor = null
// Basiswährung fürs Etikett im Profil-Tooltip: BTCUSDT → BTC. Die Mengen aus
// dem Trade-Stream sind in dieser Einheit, nicht in USDT.
const baseAsset = computed(
    () => (liveSymbol.value || '').replace(/(USDT|USDC|BUSD|USD)$/, '') || '')
let drag = null            // { y, lo, hi } während des vertikalen Ziehens
let frozenHead = null      // Ring-Position, an der die Ansicht eingefroren wurde
let framesSinceFreeze = 0
let dirtyHeat = false
let dirtyOverlay = false
let dirtyUi = false

const formatTime = (ms) => dayjs(ms).tz(timeZoneTrade.value || dayjs.tz.guess()).format('HH:mm:ss')

// Live-Feed und Wiedergabe füllen denselben Ringtyp — der Renderer bekommt
// deshalb in beiden Fällen dieselben Argumente.
const isReplay = () => liveMode.value === 'replay'
const currentRing = () => (isReplay() ? replay?.ring : feed?.ring)
const currentTrades = () => (isReplay() ? emptyTrades : feed?.trades)
const currentLiquidations = () => (isReplay() ? emptyTrades : feed?.liquidations)
const currentFrameMs = () => (isReplay() ? (replay?.frameMs || liveFrameMs.value) : liveFrameMs.value)

/**
 * Bezugspunkt zum Zeichnen. Live: eingefroren der gemerkte Head, sonst der
 * aktuelle. Wiedergabe: die Scrub-Position auf der Zeitleiste.
 */
const anchor = () => {
    if (isReplay()) {
        const ring = replay?.ring
        if (!ring) return null
        return Math.max(1, Math.min(ring.cap, Math.round(replayPos.value * ring.cap)))
    }
    return liveFrozen.value && frozenHead !== null ? frozenHead : null
}

/**
 * Mid an der aktuellen Position. In einer Aufzeichnung können Spalten leer sein
 * (Recorder war aus) — dann rückwärts bis zur letzten belegten Spalte suchen,
 * statt das Sichtfenster gar nicht erst zu setzen.
 */
function midAtAnchor(ring) {
    const head = anchor() ?? ring.head
    const grenze = Math.min(ring.count, ring.cap)
    for (let i = 0; i < grenze; i++) {
        const mid = ring.mid[ring.colFrom(head, i)]
        if (mid) return mid
    }
    return 0
}

/** Letzte Spalte mit Daten — Startpunkt der Zeitleiste. */
function letzteDatenSpalte(ring) {
    for (let c = ring.cap - 1; c >= 0; c--) if (ring.mid[c]) return c
    return -1
}

function setStatus(state, detail) {
    status.value = state
    statusDetail.value = detail || ''
    emit('status', { state, detail })
}

/** Sichtfenster nachführen; liefert true, wenn die Heatmap neu gezeichnet werden muss. */
function updateView(force = false) {
    const ring = currentRing()
    if (!ring) return false
    const mid = midAtAnchor(ring)
    if (!mid) return false

    const wanted = Math.round((mid * (liveViewPct.value / 100) * 2) / ring.bucketSize)
    const rowsView = Math.max(20, Math.min(wanted, ring.rows))
    const midBucket = Math.round(mid / ring.bucketSize)

    if (!view || force) {
        const half = rowsView >> 1
        view = { lo: midBucket - half, hi: midBucket + (rowsView - half) }
        return true
    }
    if ((view.hi - view.lo) !== rowsView) {
        // Zoom: Mitte des aktuellen Ausschnitts halten, nicht auf den Mid springen
        const center = Math.round((view.lo + view.hi) / 2)
        const half = rowsView >> 1
        view = { lo: center - half, hi: center + (rowsView - half) }
        return true
    }
    if (!liveAutoFollow.value) return false

    const next = followMid(view, midBucket, rowsView)
    view = { lo: next.lo, hi: next.hi }
    return next.shifted
}

function loop() {
    raf = requestAnimationFrame(loop)
    const ring = currentRing()
    if (document.hidden || !renderer || !ring || !view) return
    const head = anchor()
    const frameMs = currentFrameMs()
    if (dirtyHeat) {
        renderer.drawHeat(ring, view, head)
        dirtyHeat = false
        dirtyOverlay = true
    }
    if (dirtyOverlay) {
        renderer.drawOverlay({
            ring, trades: currentTrades(), liquidations: currentLiquidations(),
            view, anchor: head, frameMs, bucketSize: ring.bucketSize,
            formatTime, showProfile: liveShowProfile.value,
            showLiquidations: liveShowLiquidations.value && !isReplay(),
            // Nur live bekannt — in der Aufzeichnung ist die Reichweite nicht mitgespeichert
            coverage: !isReplay() && feed?.book?.coverLo
                ? { lo: feed.book.coverLo, hi: feed.book.coverHi }
                : null,
        })
        dirtyOverlay = false
        dirtyUi = true
    }
    if (dirtyUi) {
        renderer.drawUi(cursor, {
            ring, view, anchor: head, bucketSize: ring.bucketSize, frameMs, formatTime,
            baseLabel: baseAsset.value,
        })
        dirtyUi = false
    }
}

function applySize() {
    if (!wrapEl.value || !renderer) return
    const rect = wrapEl.value.getBoundingClientRect()
    if (rect.width < 10 || rect.height < 10) return
    renderer.resize(rect.width, rect.height)
    dirtyHeat = true
}

/** Wiedergabe: Zeitraum laden, Ring füllen, ans Ende springen. */
async function startReplay() {
    stopFeed()
    replay = null
    view = null
    replayCols.value = 0
    setStatus('loading')
    try {
        const result = await loadReplay({
            symbol: liveSymbol.value, market: liveMarket.value,
            from: replayFrom.value, to: replayTo.value,
        })
        if (!result.ring) {
            setStatus('empty', result.hinweis)
            return
        }
        replay = result
        replayCols.value = result.cols
        // Ans Ende der tatsächlich vorhandenen Daten springen, nicht ans Ende
        // des angefragten Fensters — das kann grösstenteils leer sein.
        const letzte = letzteDatenSpalte(result.ring)
        if (letzte < 0) {
            setStatus('empty', 'Der Zeitraum enthält keine aufgezeichneten Spalten')
            return
        }
        replayPos.value = Math.min(1, (letzte + 1) / result.ring.cap)
        updateView(true)
        if (view) renderer?.recalcNorm(replay.ring, view, anchor())
        updateReplayLabel()
        dirtyHeat = true
        setStatus('replay', result.hinweis)
    } catch (error) {
        setStatus('error', error.response?.data?.error || error.message)
    }
}

function updateReplayLabel() {
    const ring = replay?.ring
    if (!ring) { replayTimeLabel.value = ''; return }
    const col = ring.colFrom(anchor(), 0)
    replayTimeLabel.value = ring.ts[col] ? formatTime(ring.ts[col]) : ''
}

async function startFeed() {
    stopFeed()
    replay = null
    view = null
    frozenHead = null
    liveFrozen.value = false
    feed = new LiveFeed({
        symbol: liveSymbol.value,
        market: liveMarket.value,
        frameMs: liveFrameMs.value,
        historyMin: liveHistoryMin.value,
        pauseInBackground: livePauseInBackground.value,
        prefillMin: livePrefillMin.value,
        onStatus: (state, detail) => setStatus(state, detail),
        onFrame: () => {
            if (liveFrozen.value) {
                // Der Ring läuft weiter — irgendwann überschreibt er den
                // eingefrorenen Ausschnitt. Vorher selbst auftauen.
                framesSinceFreeze++
                if (framesSinceFreeze > feed.ring.cap - renderer.cols - 10) unfreeze()
                return
            }
            const shifted = updateView()
            dirtyHeat = true
            if (shifted) renderer?.recalcNorm(feed.ring, view, anchor())
        },
    })
    await feed.start()
}

function stopFeed() {
    feed?.stop()
    feed = null
}

function unfreeze() {
    liveFrozen.value = false
    frozenHead = null
    framesSinceFreeze = 0
    updateView()
    dirtyHeat = true
}

// ── Interaktion ─────────────────────────────────────────────

function onPointerMove(event) {
    if (!wrapEl.value) return
    // getBoundingClientRect statt offsetX: bleibt bei Transformationen korrekt
    const rect = wrapEl.value.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    if (drag && feed?.ring && view) {
        const rowsView = view.hi - view.lo
        const rowH = renderer.plotH / rowsView
        const shift = Math.round((y - drag.y) / rowH)
        view = { lo: drag.lo + shift, hi: drag.hi + shift }
        dirtyHeat = true
        return
    }
    cursor = { x, y }
    dirtyUi = true
}

function onPointerDown(event) {
    if (event.button !== 0 || !view) return
    const rect = wrapEl.value.getBoundingClientRect()
    drag = { y: event.clientY - rect.top, lo: view.lo, hi: view.hi }
    // Ziehen heisst: der Nutzer will selbst bestimmen, wo die Achse steht
    if (liveAutoFollow.value) liveAutoFollow.value = false
}

function onPointerUp() {
    drag = null
}

function onPointerLeave() {
    drag = null
    cursor = null
    dirtyUi = true
}

function onWheel(event) {
    event.preventDefault()
    const index = VIEW_PCT_OPTIONS.indexOf(liveViewPct.value)
    const current = index >= 0 ? index : VIEW_PCT_OPTIONS.findIndex(v => v >= liveViewPct.value)
    const next = Math.max(0, Math.min(VIEW_PCT_OPTIONS.length - 1, current + (event.deltaY > 0 ? 1 : -1)))
    liveViewPct.value = VIEW_PCT_OPTIONS[next]
}

function onDoubleClick() {
    liveAutoFollow.value = true
    if (liveFrozen.value) unfreeze()
    updateView(true)
    dirtyHeat = true
}

// ── Lebenszyklus ────────────────────────────────────────────

onMounted(async () => {
    renderer = new HeatmapRenderer({ heat: heatEl.value, overlay: overlayEl.value, ui: uiEl.value })
    renderer.setRamp(liveRamp.value)
    renderer.setColorScale(liveColorMode.value, liveColorRef.value)
    renderer.setThreshold(liveThreshold.value)
    renderer.setDotStep(liveDotStep.value)
    renderer.setLabels(canvasLabels())
    renderer.setProfileWidth(liveProfileW.value)
    renderer.setVolumeBarsVisible(liveShowVolumeBars.value)
    renderer.setProfileVisible(liveShowProfile.value)
    await nextTick()
    applySize()

    ro = new ResizeObserver(() => {
        // Während des Ziehens feuert der Observer sehr oft — die Reallokation
        // des Offscreen-Canvas deshalb entprellen.
        clearTimeout(resizeTimer)
        resizeTimer = setTimeout(applySize, 100)
    })
    ro.observe(wrapEl.value)

    normTimer = setInterval(() => {
        const ring = currentRing()
        if (!ring || !view || !renderer) return
        renderer?.recalcNorm(ring, view, anchor())
        // Vorschlagswert für „Auto-Wert übernehmen" in den Einstellungen
        liveAutoRefValue.value = renderer.currentRef
    }, 1000)

    window.addEventListener('mouseup', onPointerUp)
    loop()
    await (isReplay() ? startReplay() : startFeed())
})

onBeforeUnmount(() => {
    cancelAnimationFrame(raf)
    raf = null
    ro?.disconnect()
    ro = null
    clearTimeout(resizeTimer)
    clearInterval(normTimer)
    window.removeEventListener('mouseup', onPointerUp)
    stopFeed()
    renderer = null
    view = null
})

watch([liveSymbol, liveMarket, liveFrameMs, liveHistoryMin], () => {
    if (!isReplay()) startFeed()
})
watch([liveMode, replayFrom, replayTo], () => {
    isReplay() ? startReplay() : startFeed()
})
watch(replayPos, () => {
    updateView()
    updateReplayLabel()
    dirtyHeat = true
})
watch(liveRamp, (name) => { renderer?.setRamp(name); dirtyHeat = true })
watch([liveColorMode, liveColorRef], ([mode, value]) => {
    renderer?.setColorScale(mode, value)
    dirtyHeat = true
})
watch(liveThreshold, (value) => { renderer?.setThreshold(value); dirtyHeat = true })
// Punkte liegen auf der Overlay-Ebene — die Heatmap muss dafür nicht neu
watch(liveDotStep, (value) => { renderer?.setDotStep(value); dirtyOverlay = true })
watch(locale, () => { renderer?.setLabels(canvasLabels()); dirtyOverlay = true })
// Breite ändert die Plotbreite → Heatmap muss komplett neu
watch(liveProfileW, (value) => { renderer?.setProfileWidth(value); dirtyHeat = true })
// Säulen nehmen Höhe vom Chart → Heatmap muss neu
watch(liveShowVolumeBars, (v) => { renderer?.setVolumeBarsVisible(v); dirtyHeat = true })
watch(liveViewPct, () => { updateView(); dirtyHeat = true })
watch(liveShowProfile, (visible) => {
    // Die Spur ändert die Plotbreite → Heatmap muss komplett neu gezeichnet werden
    renderer?.setProfileVisible(visible)
    dirtyHeat = true
})
watch(liveShowLiquidations, () => { dirtyOverlay = true })
watch(liveAutoFollow, (on) => { if (on) { updateView(true); dirtyHeat = true } })
watch(liveFrozen, (frozen) => {
    if (frozen) {
        frozenHead = feed?.ring?.head ?? null
        framesSinceFreeze = 0
    } else {
        frozenHead = null
        framesSinceFreeze = 0
        updateView()
    }
    dirtyHeat = true
})
</script>

<template>
    <div ref="wrapEl" class="heatWrap" @mousemove="onPointerMove" @mousedown="onPointerDown"
        @mouseleave="onPointerLeave" @wheel="onWheel" @dblclick="onDoubleClick"
        :class="{ dragging: !!drag }">
        <canvas ref="heatEl" class="layer layerHeat"></canvas>
        <canvas ref="overlayEl" class="layer layerOverlay"></canvas>
        <canvas ref="uiEl" class="layer layerUi"></canvas>

        <div v-if="status !== 'live' && status !== 'replay'" class="heatBadge">
            <span v-if="status === 'error'" class="text-danger">{{ statusDetail || 'Fehler' }}</span>
            <span v-else-if="status === 'empty'" class="text-warning">
                <i class="uil uil-info-circle me-1"></i>{{ statusDetail || 'Keine Aufzeichnung' }}
            </span>
            <span v-else>
                <span class="spinner-border spinner-border-sm me-2"></span>
                <span v-if="status === 'connecting'">Verbinde…</span>
                <span v-else-if="status === 'syncing'">Synchronisiere Orderbuch…</span>
                <span v-else-if="status === 'reconnecting'">Verbindung verloren — neuer Versuch…</span>
                <span v-else-if="status === 'paused'">Pausiert (Tab im Hintergrund)</span>
                <span v-else-if="status === 'loading'">Lade Aufzeichnung…</span>
                <span v-else>Starte…</span>
            </span>
        </div>
        <div v-if="liveFrozen" class="heatBadge frozen">
            <i class="uil uil-pause me-1"></i>Eingefroren — Aufzeichnung läuft weiter
        </div>
        <div v-else-if="!liveAutoFollow" class="heatBadge manual">
            <i class="uil uil-lock me-1"></i>Feste Preisachse — Doppelklick für Auto
        </div>
    </div>
</template>

<style scoped>
.heatWrap {
    position: absolute;
    inset: 0;
    cursor: crosshair;
}

.heatWrap.dragging {
    cursor: grabbing;
}

.layer {
    position: absolute;
    inset: 0;
    display: block;
}

.layerHeat { z-index: 1; }
.layerOverlay { z-index: 2; }
.layerUi { z-index: 3; }

.heatBadge {
    position: absolute;
    top: 0.6rem;
    left: 0.7rem;
    z-index: 4;
    font-size: 0.78rem;
    color: var(--white-70);
    background: rgba(0, 0, 0, 0.55);
    border-radius: 999px;
    padding: 0.2rem 0.7rem;
    pointer-events: none;
}

.heatBadge.frozen {
    color: #ffc107;
}

.heatBadge.manual {
    color: var(--white-60);
}
</style>
