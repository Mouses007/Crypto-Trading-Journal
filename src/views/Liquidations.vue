<script setup>
/**
 * Liquidationskarte — wo würden gehebelte Positionen zwangsweise geschlossen.
 *
 * Bewusst eine EIGENE Seite und kein Overlay über der Bookmap: dort liegen
 * gemessene Daten (ruhende Orders, echte Trades), hier ein Modell mit
 * unbeobachtbaren Annahmen. Beides übereinander zu legen würde die Grenze
 * zwischen Messung und Rechnung verwischen.
 *
 * Der Rückwärts-Backtest vom 13.08.2026 über 9.734 aufgezeichnete
 * Liquidationen ergab Lift 1,54× gegenüber Zufall (Kontrolle 0,99×, reine
 * Hebelgeometrie 1,11×). Diese Zahl steht in der Fusszeile — eine Karte, die
 * ihre eigene Treffsicherheit verschweigt, lädt zum Überschätzen ein.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import PageInfo from '../components/PageInfo.vue'
import { LeverageMapSource } from '../utils/leverageMapSource.js'
import { buildLeverageHistory } from '../utils/leverageMap.js'
import { LeverageMapRenderer } from '../utils/leverageMapRenderer.js'
import {
    liveSymbol,
    levMapTier, levMapHours, levMapSpanPct, levMapMmr, levMapWeights, levMapView, levMapThreshold, levMapProfileW,
} from '../stores/live.js'
import dayjs from '../utils/dayjs-setup.js'

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

/**
 * Erfasste Spanne der Karte. Bewusst grösser als die ANGEZEIGTE: 10x
 * liquidiert erst bei −9,6 %, das muss im Raster stehen, auch wenn man gerade
 * auf ±2 % hineingezoomt hat. Dadurch kostet Zoomen keine Neuberechnung —
 * gezoomt wird nur der Ausschnitt, den der Renderer zeichnet.
 */
const erfassung = () => Math.max(12, levMapSpanPct.value)

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
            hist, viewPct: levMapSpanPct.value, formatTime, hinweis: statusDetail.value,
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
        viewPct: levMapSpanPct.value,
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
        hours: levMapHours.value,
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
watch([liveSymbol, levMapHours], () => {
    source?.update({ symbol: liveSymbol.value, hours: levMapHours.value })
})
// Neu rechnen nur, wenn sich die ERFASSTE Spanne ändert. Reines Hineinzoomen
// bleibt innerhalb des Rasters und braucht bloss einen neuen Anstrich.
watch([levMapSpanPct, levMapMmr], () => {
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

function onMove(e) {
    const rect = wrapEl.value.getBoundingClientRect()
    renderer?.setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    zeichne()
}
function onLeave() { renderer?.setCursor(null); zeichne() }

/**
 * Mausrad zoomt die Preisachse. Multiplikativ statt in festen Schritten, damit
 * sich das Zoomen bei ±2 % genauso anfühlt wie bei ±20 %.
 */
function onWheel(e) {
    e.preventDefault()
    const faktor = e.deltaY > 0 ? 1.15 : 1 / 1.15
    const neu = Math.min(40, Math.max(0.5, levMapSpanPct.value * faktor))
    levMapSpanPct.value = Math.round(neu * 100) / 100
}
</script>

<template>
    <div class="levWrap">
        <div class="liveHeader">
            <div class="liveTitle">
                <span class="liveSymbol">{{ liveSymbol }}</span>
                <!-- immer Perp: diese Seite gibt es für Spot nicht -->
                <span class="liveMarket">Perp</span>
                <span :class="['liveDot', 'dot-' + status]"></span>
                <span class="liveState">{{ t('levmap.status_' + status) }}</span>
                <span class="modelBadge" :title="t('levmap.modelHint')">{{ t('levmap.model') }}</span>
            </div>
            <!-- Bedienelemente sitzen im Seitenmenü, wie bei der Bookmap -->
            <div class="liveActions">
                <span class="viewHint">{{ levMapView === 'history' ? t('levmap.viewHistory') : t('levmap.viewDist') }}</span>
                <span class="ctl-sep"></span>
                <PageInfo section="info.levmap" />
            </div>
        </div>

        <div ref="wrapEl" class="levCanvasWrap" @mousemove="onMove" @mouseleave="onLeave"
            @wheel.prevent="onWheel">
            <canvas ref="canvasEl"></canvas>
        </div>

        <div class="levFoot">
            <span>{{ t('levmap.measured') }}</span>
            <span class="levStamp">{{ t('levmap.asOf') }} {{ zeitstempel }}</span>
        </div>
    </div>
</template>

<style scoped>
.viewHint {
    font-size: 0.75rem;
    color: var(--white-50, rgba(255, 255, 255, 0.5));
}

.levWrap {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 90px);
    min-height: 420px;
}

.levCanvasWrap {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    background: var(--black-bg-2, #14141f);
    border-radius: var(--border-radius, 6px);
    overflow: hidden;
    cursor: crosshair;
}

.levCanvasWrap canvas {
    display: block;
}

.modelBadge {
    margin-left: 0.6rem;
    padding: 0.1rem 0.45rem;
    font-size: 0.68rem;
    letter-spacing: 0.04em;
    border-radius: 999px;
    color: rgb(250, 190, 60);
    border: 1px solid rgba(250, 190, 60, 0.45);
    background: rgba(250, 190, 60, 0.08);
    cursor: help;
}


.levFoot {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.4rem 0.2rem 0;
    font-size: 0.74rem;
    color: var(--white-50, rgba(255, 255, 255, 0.5));
}

.levStamp {
    white-space: nowrap;
}
</style>
