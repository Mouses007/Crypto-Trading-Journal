<script setup>
/**
 * Liquidationskarte — wo würden gehebelte Positionen zwangsweise geschlossen.
 *
 * Bewusst eine EIGENE Seite und kein Overlay über der Bookmap: dort liegen
 * gemessene Daten (ruhende Orders, echte Trades), hier ein Modell mit
 * unbeobachtbaren Annahmen. Beides übereinander zu legen würde die Grenze
 * zwischen Messung und Rechnung verwischen.
 *
 * Der Rückwärts-Backtest vom 31.08.2026 (scripts/levmap-backtest.mjs, 4.900
 * aufgezeichnete Liquidationen über 5 Symbole) ergab: mit GEMESSENEN
 * Stufengewichten Lift 1,38× gegenüber Zufall, mit den geratenen
 * Vorgabe-Gewichten nur 0,48× — erst die Kalibrierung aus den eigenen
 * Aufzeichnungen macht die Karte besser als Raten. Diese Zahlen stehen in der
 * Fusszeile — eine Karte, die ihre eigene Treffsicherheit verschweigt, lädt
 * zum Überschätzen ein.
 *
 * Das Zeichnen selbst liegt in `src/components/HebelkartenCanvas.vue`, damit
 * dieselbe Karte auch als Kachel im Live-Trading-Fenster stehen kann. Hier
 * bleiben nur Kopf- und Fusszeile — in einer Kachel übernimmt deren Aufgabe der
 * Kachelrahmen.
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PageInfo from '../components/PageInfo.vue'
import HebelkartenCanvas from '../components/HebelkartenCanvas.vue'
import { liveSymbol, levMapView } from '../stores/live.js'

const { t } = useI18n()

/** Zustand und Stand kommen aus dem Zeichenteil (siehe dessen `defineExpose`). */
const karte = ref(null)

const status = computed(() => karte.value?.status || 'idle')
const zeitstempel = computed(() => karte.value?.zeitstempel || '—')

/**
 * Long/Short-Konten-Ratio als Prozentpaar. Konten, nicht Kapital — die Zahl
 * sagt, welche Seite überfüllt ist, und damit, welche Zonenseite der Karte
 * die schwerere ist. Bei fehlender Antwort (der Abruf ist serverseitig ein
 * stilles `.catch`) verschwindet der Balken kommentarlos.
 */
const ratio = computed(() => {
    const r = karte.value?.accountRatio
    if (!(r?.long > 0) || !(r?.short > 0)) return null
    const summe = r.long + r.short
    return {
        long: Math.round((r.long / summe) * 1000) / 10,
        short: Math.round((r.short / summe) * 1000) / 10,
    }
})
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

        <HebelkartenCanvas ref="karte" />

        <div class="levFoot">
            <span>{{ t('levmap.measured') }}</span>
            <span v-if="ratio" class="ratioWrap" :title="t('levmap.accountRatioTitle')">
                <span class="ratioLabel">{{ t('levmap.accountRatio') }}</span>
                <span class="ratioBalken">
                    <span class="ratioLong" :style="{ width: ratio.long + '%' }"></span>
                    <span class="ratioShort" :style="{ width: ratio.short + '%' }"></span>
                </span>
                <span class="ratioZahl">L {{ ratio.long.toFixed(1) }} % / S {{ ratio.short.toFixed(1) }} %</span>
            </span>
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
    /* dvh folgt der ein- und ausfahrenden Browserleiste auf dem Handy — mit
       reinem vh ragt die Karte unter die Adressleiste (wie in Liquidity.vue) */
    height: calc(100dvh - 90px);
    min-height: 420px;
}

@media (max-width: 767.98px) {
    .levWrap {
        height: calc(100dvh - 6.5rem);
        /* 420 px erzwangen auf kleinen Geräten einen Überstand nach unten */
        min-height: 300px;
    }
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

/* Konten-Ratio: Balkenmuster wie .lsBalken in KachelLsOi, auf Fusszeilen-
   Format eingedampft (10 px statt 16, keine Innenbeschriftung). */
.ratioWrap {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    white-space: nowrap;
    cursor: help;
}

.ratioLabel {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.68rem;
}

.ratioBalken {
    display: inline-flex;
    width: 72px;
    height: 10px;
    border-radius: 3px;
    overflow: hidden;
}

.ratioLong {
    background: rgba(38, 190, 150, 0.55);
}

.ratioShort {
    background: rgba(255, 95, 86, 0.55);
}

.ratioZahl {
    font-variant-numeric: tabular-nums;
}
</style>
