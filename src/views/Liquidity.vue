<script setup>
/**
 * Live-Analyse: Binance-Orderbuch-Heatmap / Bookmap.
 *
 * Die View hält nur Layout und Kopfzeile — Datenschicht und Zeichnen stecken in
 * <LiquidityHeatmap>. Einstellungen (Symbol, Band, Takt) kommen aus dem
 * Live-Store und werden im Seitenmenü bedient.
 */
import { ref, computed, onMounted } from 'vue'
import LiquidityHeatmap from '../components/LiquidityHeatmap.vue'
import PageInfo from '../components/PageInfo.vue'
import {
    liveSymbol, liveMarket, liveRamp, liveFrozen, liveAutoFollow,
    liveMode, replayFrom, replayTo, replayLabel, RAMP_OPTIONS,
} from '../stores/live.js'
import dayjs from '../utils/dayjs-setup.js'

const status = ref('idle')
const heatmapRef = ref(null)

const isReplay = computed(() => liveMode.value === 'replay')

const replaySpanne = computed(() => {
    if (!replayFrom.value || !replayTo.value) return ''
    const f = dayjs(replayFrom.value), t = dayjs(replayTo.value)
    return `${f.format('DD.MM. HH:mm')} – ${t.format('HH:mm')}`
})

function zurueckZuLive() {
    liveMode.value = 'live'
    replayLabel.value = ''
    // Query-Parameter entfernen, damit ein Reload nicht wieder in die Wiedergabe springt
    window.history.replaceState({}, '', '/liquidity')
}

/**
 * Einstieg aus dem Journal: /liquidity?replay=1&symbol=…&from=…&to=…
 * Der Knopf im Trade-Modal baut genau diesen Link.
 */
onMounted(() => {
    const p = new URLSearchParams(window.location.search)
    if (p.get('replay') !== '1') return
    const from = Number(p.get('from')), to = Number(p.get('to'))
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return
    if (p.get('symbol')) liveSymbol.value = p.get('symbol').toUpperCase()
    if (p.get('market')) liveMarket.value = p.get('market')
    replayFrom.value = from
    replayTo.value = to
    replayLabel.value = p.get('label') || ''
    liveMode.value = 'replay'
})

const statusLabel = {
    idle: 'Bereit', connecting: 'Verbinde', syncing: 'Synchronisiere',
    live: 'Live', reconnecting: 'Neuverbindung', paused: 'Pausiert', error: 'Fehler',
    loading: 'Lade Aufzeichnung', replay: 'Wiedergabe', empty: 'Keine Aufzeichnung',
}
</script>

<template>
    <div class="liveWrap">
        <div class="liveHeader">
            <div class="liveTitle">
                <span class="liveSymbol">{{ liveSymbol }}</span>
                <span class="liveMarket">{{ liveMarket === 'futures' ? 'Perp' : 'Spot' }}</span>
                <span :class="['liveDot', 'dot-' + status]"></span>
                <span class="liveState">{{ statusLabel[status] || status }}</span>
                <span v-if="isReplay" class="replayInfo">
                    {{ replayLabel ? replayLabel + ' · ' : '' }}{{ replaySpanne }}
                </span>
            </div>
            <div class="liveActions">
                <button v-if="isReplay" type="button" class="ctl-pill active-warn" @click="zurueckZuLive">
                    <i class="uil uil-history"></i>Wiedergabe verlassen
                </button>
                <button v-if="!isReplay" type="button" :class="['ctl-pill', liveFrozen ? 'active-warn' : '']"
                    :title="liveFrozen ? 'Weiterlaufen lassen' : 'Ansicht einfrieren (Aufzeichnung läuft weiter)'"
                    @click="liveFrozen = !liveFrozen">
                    <i :class="liveFrozen ? 'uil uil-play' : 'uil uil-pause'"></i>
                    {{ liveFrozen ? 'Weiter' : 'Pause' }}
                </button>
                <button type="button" :class="['ctl-pill', liveAutoFollow ? 'active' : '']"
                    title="Preisachse folgt dem Mittelkurs (Doppelklick im Chart setzt zurück)"
                    @click="liveAutoFollow = !liveAutoFollow">
                    <i class="uil uil-crosshair"></i>Auto-Achse
                </button>
                <span class="ctl-sep"></span>
                <button v-for="r in RAMP_OPTIONS" :key="r.id" type="button"
                    :class="['ctl-pill', liveRamp === r.id ? 'active' : '']" @click="liveRamp = r.id">
                    {{ r.label }}
                </button>
                <span class="ctl-sep"></span>
                <PageInfo section="info.bookmap" />
            </div>
        </div>

        <div class="liveCanvasWrap">
            <LiquidityHeatmap ref="heatmapRef" @status="status = $event.state" />
        </div>

        <!-- Zeitleiste nur in der Wiedergabe -->
        <div v-if="isReplay && heatmapRef?.replayCols" class="replayBar">
            <span class="replayTime">{{ heatmapRef.replayTimeLabel || '—' }}</span>
            <input v-model.number="heatmapRef.replayPos" type="range" min="0.02" max="1" step="0.002"
                class="replayRange" title="Zeitpunkt im aufgezeichneten Fenster" />
            <span class="replayHint">{{ heatmapRef.replayCols }} Spalten</span>
        </div>
    </div>
</template>

<style scoped>
.liveWrap {
    display: flex;
    flex-direction: column;
    /* Höhe füllt den Inhaltsbereich; die Canvas-Grösse kommt aus dem
       ResizeObserver, nicht aus einer festen Pixelangabe. */
    height: calc(100vh - 7.5rem);
    /* dvh folgt der ein- und ausfahrenden Browserleiste auf dem Handy — mit
       reinem vh ragt der Chart unter die Adressleiste. */
    height: calc(100dvh - 7.5rem);
    min-height: 340px;
}

@media (max-width: 767.98px) {
    .liveWrap {
        height: calc(100dvh - 6.5rem);
        min-height: 300px;
    }
}













.replayInfo {
    font-size: 0.78rem;
    color: var(--blue-color);
    margin-left: 0.3rem;
}

.replayBar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-top: 0.45rem;
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--white-18);
    border-radius: var(--border-radius);
    background: var(--black-bg-3);
}

.replayRange {
    flex: 1;
    accent-color: var(--blue-color);
    cursor: pointer;
}

.replayTime {
    font-variant-numeric: tabular-nums;
    font-size: 0.82rem;
    color: var(--white-87);
    min-width: 4.5rem;
}

.replayHint {
    font-size: 0.72rem;
    color: var(--white-38);
}


.liveCanvasWrap {
    position: relative;
    /* Eigener Stapelkontext: die Canvas-Ebenen darin haben z-index 1–4 und
       lagen sonst im Wurzelkontext — auf dem Handy schoben sie sich damit
       über das ausgefahrene Seitenmenü. */
    z-index: 0;
    isolation: isolate;
    flex: 1;
    min-height: 0;
    border: 1px solid var(--white-18);
    border-radius: var(--border-radius);
    background: #0a0a0a;
    overflow: hidden;
}
</style>
