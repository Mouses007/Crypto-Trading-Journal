<script setup>
/**
 * Symbol- und Darstellungsauswahl der Live-Analyse. Sitzt im Seitenmenü,
 * dort wo im Journal die Filter stehen.
 *
 * Alle drei Seiten teilen sich denselben Symbolblock — samt der Vorbelegungs-
 * kaskade (offene Position → gespeicherte Wahl → BTCUSDT), die man sonst
 * dreimal pflegen müsste. Nur der Teil darunter unterscheidet sich, gesteuert
 * über `variant`.
 */
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { selectedBroker } from '../stores/filters.js'
import { currentUser } from '../stores/settings.js'
import { loadSymbolMeta } from '../utils/liveSymbols.js'
import {
    liveSymbol, liveMarket, liveViewPct, liveFrameMs, liveShowProfile,
    liveColorMode, liveColorRef, liveAutoRefValue, liveThreshold, liveShowLiquidations, liveDotStep, liveProfileW, liveShowVolumeBars,
    livePauseInBackground, liveMode,
    levMapTier, levMapHours, levMapSpanPct, levMapView, levMapThreshold, levMapMmr, levMapMmrQuelle, levMapProfileW,
    VIEW_PCT_OPTIONS, FRAME_MS_OPTIONS, FAVORITE_SYMBOLS,
} from '../stores/live.js'
import { LEVERAGE_TIERS } from '../utils/leverageMap.js'
import { mmrHerkunft } from '../utils/marginRate.js'

const props = defineProps({
    /** 'bookmap' | 'levmap' | 'oi' — bestimmt, was unter dem Symbolblock steht. */
    variant: { type: String, default: 'bookmap' },
})

/**
 * Markt, der für DIESE Seite gilt. Liquidationskarte und Open Interest gibt es
 * nur für Futures — Spot hat weder offenes Interesse noch Hebel noch
 * Zwangsliquidationen. Die Marktwahl der Bookmap darf hier deshalb nicht
 * durchschlagen, sonst lädt die Seite eine Symbolliste, mit der ihr Endpoint
 * gar nichts anfangen kann.
 */
const effektiverMarkt = computed(() => (props.variant === 'bookmap' ? liveMarket.value : 'futures'))

/**
 * In der Wiedergabe sind mehrere Regler wirkungslos: der Takt steckt in der
 * Aufzeichnung, und Handelspunkte, Volumenprofil und Volumen-Säulen brauchen
 * aggTrades, die nicht mitgeschnitten werden. Bedienbar aussehen sollen sie
 * dann nicht — das las sich bisher wie ein Defekt.
 */
const istWiedergabe = computed(() => props.variant === 'bookmap' && liveMode.value === 'replay')

const TIERS = LEVERAGE_TIERS
const LEV_HOURS = [6, 12, 24, 48, 96]
const LEV_SPANS = [1, 2, 4, 8, 12, 20, 40]

/**
 * Voreinstellungen plus der aktuelle Wert. Das Mausrad zoomt stufenlos; ohne
 * diesen Einschub stünde die Auswahl nach dem Scrollen leer da.
 */
const spanOptionen = computed(() => {
    const s = new Set(LEV_SPANS)
    s.add(Number(levMapSpanPct.value))
    return [...s].sort((a, b) => a - b)
})
const OI_HOURS = [6, 12, 24, 48, 96, 240]

const { t } = useI18n()

/** 300000 → „300k", 2000000 → „2 Mio" — Stufengrenzen sind grobe Zahlen. */
function kurzBetrag(n) {
    if (n >= 1e6) return `${+(n / 1e6).toFixed(n % 1e6 ? 1 : 0)} Mio`
    if (n >= 1e3) return `${Math.round(n / 1e3)}k`
    return String(n)
}

/**
 * Was unter dem Feld steht. Die Rate selbst sagt nichts darüber, ob sie
 * gerade von der Börse kam, aus dem Zwischenspeicher stammt oder von der
 * Ersatzquelle — genau das entscheidet aber, wie ernst man die Zonen nimmt.
 */
const mmrHinweis = computed(() => {
    if (levMapMmrQuelle.value === 'manuell') return t('levmap.mmrHintManual')
    const h = mmrHerkunft.value
    if (h.zustand === 'laedt') return t('levmap.mmrLoading')
    if (h.zustand === 'fehler') return t('levmap.mmrFailed')
    if (h.zustand !== 'da') return t('levmap.mmrHintAuto')

    const teile = [t('levmap.mmrFrom', { quelle: h.quelle === 'bybit' ? 'Bybit' : 'Binance' })]
    if (h.obergrenze) teile.push(t('levmap.mmrUpTo', { n: kurzBetrag(h.obergrenze) }))
    if (h.ersatz) teile.push(t('levmap.mmrSubstitute'))
    if (h.veraltet) teile.push(t('levmap.mmrStale'))
    return teile.join(' · ')
})

/**
 * Fensterlänge lesbar beschriften. „240 h" rechnet im Kopf niemand in zehn
 * Tage um, und ab dieser Grösse ist der Tag die Einheit, in der man denkt.
 * Volle Wochen werden als Wochen ausgewiesen, alles Krumme bleibt bei Tagen.
 */
function fensterLabel(h) {
    if (h < 24) return `${h} h`
    if (h % 168 === 0) {
        const w = h / 168
        return w === 1 ? t('levmap.oneWeek') : t('levmap.weeks', { n: w })
    }
    if (h % 24 === 0) {
        const d = h / 24
        return d === 1 ? t('levmap.oneDay') : t('levmap.days', { n: d })
    }
    return `${h} h`
}

const query = ref('')
const symbols = ref([])
const loading = ref(false)
const open = ref(false)

const matches = computed(() => {
    const q = query.value.trim().toUpperCase()
    const all = symbols.value
    if (!q) return FAVORITE_SYMBOLS.map(s => all.find(x => x.symbol === s)).filter(Boolean)
    // Präfix-Treffer zuerst, danach Teiltreffer
    const prefix = all.filter(s => s.symbol.startsWith(q))
    const rest = all.filter(s => !s.symbol.startsWith(q) && s.symbol.includes(q))
    return [...prefix, ...rest].slice(0, 30)
})

async function loadSymbols() {
    loading.value = true
    const all = await loadSymbolMeta(effektiverMarkt.value)
    // Nur USDT-Paare — alles andere ist für dieses Journal Beiwerk
    symbols.value = all.filter(s => s.quote === 'USDT')
    loading.value = false
}

/** Broker-Symbole normalisieren: BTCUSDT_UMCBL, BTC_USDT_PERP → BTCUSDT */
function normalizeSymbol(raw) {
    return (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(UMCBL|DMCBL|CMCBL|PERP|SWAP)$/, '')
}

/** Vorbelegung: offene Position → zuletzt gewählt → BTCUSDT */
async function resolveDefaultSymbol() {
    const known = (s) => s && symbols.value.some(x => x.symbol === s)
    if (currentUser.value?.liveSymbol) return   // gespeicherte Nutzerwahl hat Vorrang
    // Ohne gewählte Börse gibt es nichts abzufragen (frische Installation)
    if (!selectedBroker.value) {
        if (!known(liveSymbol.value)) liveSymbol.value = 'BTCUSDT'
        return
    }
    try {
        const { data } = await axios.get(`/api/${selectedBroker.value}/open-positions`)
        const list = Array.isArray(data) ? data : (data?.positions || [])
        const candidate = normalizeSymbol(list[0]?.symbol)
        if (known(candidate)) { liveSymbol.value = candidate; return }
    } catch (e) {
        // Keine API hinterlegt oder Börse offline → stillschweigend weiter
    }
    if (!known(liveSymbol.value)) liveSymbol.value = 'BTCUSDT'
}

const fmtRef = (v) => (v ? (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(v < 10 ? 2 : 1)) : '—')

/**
 * Wie viel Zeit steckt in einer Blase? Das Raster ist in Pixeln angegeben, eine
 * Spalte ist genau ein Pixel — also entspricht die Rasterbreite direkt so vielen
 * Spalten, und mit dem Takt ergibt das die Zeitspanne.
 */
const dotStepHint = computed(() => {
    if (liveDotStep.value <= 1) return t('live.dotStepHintOff')
    const sekunden = liveDotStep.value * liveFrameMs.value / 1000
    const zeit = sekunden >= 60
        ? (sekunden / 60).toFixed(sekunden % 60 ? 1 : 0) + ' min'
        : (sekunden >= 10 ? Math.round(sekunden) : sekunden.toFixed(1)) + ' s'
    return t('live.dotStepHint', { time: zeit })
})

function choose(symbol) {
    liveSymbol.value = symbol
    query.value = ''
    open.value = false
}

async function switchMarket(market) {
    if (liveMarket.value === market) return
    liveMarket.value = market
    await loadSymbols()
}

watch(effektiverMarkt, loadSymbols)

onMounted(async () => {
    await loadSymbols()
    await resolveDefaultSymbol()
})
</script>

<template>
    <div class="livePicker">
        <label class="fw-lighter">{{ t('live.symbol') }}</label>
        <!-- Marktwahl nur in der Bookmap: die anderen beiden Seiten sind
             Futures-only, eine Spot-Pille wäre dort eine tote Taste. -->
        <div v-if="variant === 'bookmap'" class="market-pills">
            <button type="button" :class="['cat-pill', liveMarket === 'futures' ? 'active' : '']"
                @click="switchMarket('futures')">{{ t('live.futures') }}</button>
            <button type="button" :class="['cat-pill', liveMarket === 'spot' ? 'active' : '']"
                @click="switchMarket('spot')">{{ t('live.spot') }}</button>
        </div>

        <div class="symbolCurrent">{{ liveSymbol }}</div>
        <input v-model="query" class="sidebar-select mb-1" type="text" :placeholder="t('live.search')"
            @focus="open = true" />
        <div v-if="open || query" class="symbolList">
            <div v-if="loading" class="symbolHint">{{ t('live.loading') }}</div>
            <div v-else-if="!matches.length" class="symbolHint">{{ t('live.noMatch') }}</div>
            <button v-for="s in matches" :key="s.symbol" type="button"
                :class="['symbolItem', s.symbol === liveSymbol ? 'active' : '']" @click="choose(s.symbol)">
                {{ s.symbol }}
            </button>
        </div>

        <template v-if="variant === 'bookmap'">
        <label class="fw-lighter mt-2">{{ t('live.display') }}</label>
        <select v-model.number="liveViewPct" class="sidebar-select mb-1" :title="t('live.bandTitle')">
            <option v-for="p in VIEW_PCT_OPTIONS" :key="p" :value="p">± {{ p }} %</option>
        </select>
        <select v-model.number="liveFrameMs" class="sidebar-select mb-1" :disabled="istWiedergabe"
            :title="istWiedergabe ? t('live.replayLocked') : t('live.frameTitle')">
            <option v-for="f in FRAME_MS_OPTIONS" :key="f" :value="f">{{ t('live.perColumn', { ms: f }) }}</option>
        </select>
        <label :class="['liveToggle', istWiedergabe ? 'liveToggleAus' : '']"
            :title="istWiedergabe ? t('live.replayNoTrades') : null">
            <input type="checkbox" v-model="liveShowProfile" class="me-1" :disabled="istWiedergabe" />{{ t('live.profile') }}
        </label>
        <template v-if="liveShowProfile && !istWiedergabe">
            <label class="fw-lighter mt-1" style="font-size:0.72rem;">
                {{ t('live.laneWidth') }}
                <span class="threshVal">{{ liveProfileW }} px</span>
            </label>
            <input v-model.number="liveProfileW" type="range" min="40" max="320" step="10"
                class="threshRange"
                :title="t('live.laneWidthTitle')" />
        </template>
        <label v-if="liveMarket === 'futures'" class="liveToggle">
            <input type="checkbox" v-model="liveShowLiquidations" class="me-1" />{{ t('live.liquidations') }}
        </label>
        <label :class="['liveToggle', istWiedergabe ? 'liveToggleAus' : '']"
            :title="istWiedergabe ? t('live.replayNoTrades') : t('live.volumeBarsTitle')">
            <input type="checkbox" v-model="liveShowVolumeBars" class="me-1" :disabled="istWiedergabe" />{{ t('live.volumeBars') }}
        </label>
        <label :class="['liveToggle', istWiedergabe ? 'liveToggleAus' : '']"
            :title="istWiedergabe ? t('live.replayLocked') : t('live.pauseBgTitle')">
            <input type="checkbox" v-model="livePauseInBackground" class="me-1" :disabled="istWiedergabe" />{{ t('live.pauseBg') }}
        </label>
        <div v-if="!livePauseInBackground && !istWiedergabe" class="autoRefHint">{{ t('live.pauseBgOffHint') }}</div>
        <div v-if="istWiedergabe" class="autoRefHint">{{ t('live.replayHint') }}</div>

        <label class="fw-lighter mt-2">{{ t('live.colorScale') }}</label>
        <select v-model="liveColorMode" class="sidebar-select mb-1"
            :title="t('live.colorScaleTitle')">
            <option value="auto">{{ t('live.auto') }}</option>
            <option value="fixed">{{ t('live.fixedValue') }}</option>
        </select>
        <div v-if="liveColorMode === 'fixed'" class="colorRefRow">
            <input v-model.number="liveColorRef" type="number" min="0" step="0.1"
                class="sidebar-select" :title="t('live.saturationTitle')" />
            <button type="button" class="refBtn" :disabled="!liveAutoRefValue"
                :title="t('live.takeAutoTitle', { value: fmtRef(liveAutoRefValue) })"
                @click="liveColorRef = Number(liveAutoRefValue.toPrecision(4))">
                <i class="uil uil-import"></i>
            </button>
        </div>
        <div v-else class="autoRefHint">{{ t('live.autoValue', { value: fmtRef(liveAutoRefValue) }) }}</div>

        <label class="fw-lighter mt-2">
            {{ t('live.threshold') }}
            <span class="threshVal">{{ Math.round(liveThreshold * 100) }} %</span>
        </label>
        <input v-model.number="liveThreshold" type="range" min="0" max="0.9" step="0.05"
            class="threshRange" :title="t('live.thresholdTitle')" />

        <template v-if="!istWiedergabe">
            <label class="fw-lighter mt-2">
                {{ t('live.dotStep') }}
                <span class="threshVal">{{ liveDotStep === 1 ? t('live.dotStepOff') : liveDotStep + ' px' }}</span>
            </label>
            <input v-model.number="liveDotStep" type="range" min="1" max="30" step="1"
                class="threshRange"
                :title="t('live.dotStepTitle')" />
            <div class="autoRefHint">{{ dotStepHint }}</div>
        </template>
        </template>

        <!-- ── Liquidationskarte ────────────────────────────── -->
        <template v-if="variant === 'levmap'">
            <label class="fw-lighter mt-2">{{ t('levmap.viewLabel') }}</label>
            <div class="market-pills">
                <button type="button" :class="['cat-pill', levMapView === 'dist' ? 'active' : '']"
                    :title="t('levmap.viewDistTitle')" @click="levMapView = 'dist'">{{ t('levmap.viewDist') }}</button>
                <button type="button" :class="['cat-pill', levMapView === 'history' ? 'active' : '']"
                    :title="t('levmap.viewHistoryTitle')" @click="levMapView = 'history'">{{ t('levmap.viewHistory') }}</button>
            </div>

            <label class="fw-lighter mt-2">{{ t('levmap.tierLabel') }}</label>
            <div class="tierGrid">
                <button type="button" :class="['cat-pill', levMapTier === 'all' ? 'active' : '']"
                    @click="levMapTier = 'all'">{{ t('levmap.allTiers') }}</button>
                <button v-for="(L, i) in TIERS" :key="L" type="button"
                    :class="['cat-pill', String(levMapTier) === String(i) ? 'active' : '']"
                    @click="levMapTier = i">{{ L }}x</button>
            </div>

            <label class="fw-lighter mt-2">{{ t('levmap.windowLabel') }}</label>
            <select v-model.number="levMapHours" class="sidebar-select mb-1" :title="t('levmap.windowTitle')">
                <option v-for="h in LEV_HOURS" :key="h" :value="h">{{ fensterLabel(h) }}</option>
            </select>
            <select v-model.number="levMapSpanPct" class="sidebar-select mb-1" :title="t('levmap.spanTitle')">
                <option v-for="s in spanOptionen" :key="s" :value="s">± {{ s }} %</option>
            </select>
            <div class="autoRefHint">{{ t('levmap.wheelHint') }}</div>

            <template v-if="levMapView === 'history'">
                <label class="fw-lighter mt-2">
                    {{ t('levmap.thresholdLabel') }}
                    <span class="threshVal">{{ Math.round(levMapThreshold * 100) }} %</span>
                </label>
                <input v-model.number="levMapThreshold" type="range" min="0" max="0.9" step="0.05"
                    class="threshRange" :title="t('levmap.thresholdTitle')" />

                <label class="fw-lighter mt-2">
                    {{ t('levmap.profileLabel') }}
                    <span class="threshVal">{{ levMapProfileW }} px</span>
                </label>
                <input v-model.number="levMapProfileW" type="range" min="0" max="260" step="10"
                    class="threshRange" :title="t('levmap.profileTitle')" />
                <div class="autoRefHint">{{ levMapProfileW === 0 ? t('levmap.profileOff') : '' }}</div>
            </template>

            <label class="fw-lighter mt-2">{{ t('levmap.mmr') }}</label>
            <select v-model="levMapMmrQuelle" class="sidebar-select mb-1" :title="t('levmap.mmrSourceTitle')">
                <option value="binance">{{ t('levmap.mmrSourceBinance') }}</option>
                <option value="bybit">{{ t('levmap.mmrSourceBybit') }}</option>
                <option value="manuell">{{ t('levmap.mmrSourceManual') }}</option>
            </select>
            <input v-model.number="levMapMmr" type="number" min="0.0001" max="0.2" step="0.001"
                class="sidebar-select" :disabled="levMapMmrQuelle !== 'manuell'" :title="t('levmap.mmrTitle')" />
            <div class="autoRefHint">{{ mmrHinweis }}</div>
        </template>

        <!-- ── Open Interest ────────────────────────────────── -->
        <template v-if="variant === 'oi'">
            <label class="fw-lighter mt-2">{{ t('levmap.windowLabel') }}</label>
            <select v-model.number="levMapHours" class="sidebar-select mb-1" :title="t('levmap.windowTitle')">
                <option v-for="h in OI_HOURS" :key="h" :value="h">{{ fensterLabel(h) }}</option>
            </select>
        </template>
    </div>
</template>

<style scoped>
.livePicker {
    display: flex;
    flex-direction: column;
}

/* Hebelstufen: umbrechendes Raster statt einer Reihe — in der schmalen
   Seitenleiste passen fünf Pillen nicht nebeneinander. */
.tierGrid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
}

/* Eingabefelder im Seitenmenü-Look (dunkel statt Browser-Default-Weiss).
   Lag vorher als toter, scoped Block in SideMenu.vue und griff hier nie. */
.sidebar-select {
    width: 100%;
    background-color: var(--black-bg-7);
    color: var(--white-87);
    border: 1px solid var(--white-18);
    border-radius: 8px;
    font-size: 0.82rem;
    font-weight: 600;
    padding: 0.4rem 0.5rem;
    cursor: pointer;
    transition: all 0.15s;
}

.sidebar-select::placeholder {
    color: var(--white-38);
    font-weight: 400;
}

.sidebar-select:hover {
    background: var(--black-bg-12);
    border-color: var(--white-38);
}

.sidebar-select:focus {
    background-color: var(--black-bg-7);
    color: var(--white-87);
    border-color: var(--blue-color);
    box-shadow: 0 0 0 0.1rem rgba(74, 158, 255, 0.15);
    outline: none;
}

.sidebar-select option {
    background-color: var(--black-bg-7);
    color: var(--white-87);
}

.market-pills {
    display: flex;
    gap: 0.4rem;
    margin: 0.3rem 0 0.5rem;
}

.cat-pill {
    font-size: 0.75rem;
    padding: 0.15rem 0.7rem;
    /* Rundung wie die Menü-Buttons (8px). */
    border-radius: 8px;
    border: 1px solid var(--white-18, rgba(255, 255, 255, 0.15));
    background: transparent;
    color: var(--white-70);
    cursor: pointer;
    transition: all 0.15s ease;
}

.cat-pill.active {
    background: var(--blue-color);
    border-color: var(--blue-color);
    color: #fff;
    font-weight: 600;
}

.symbolCurrent {
    font-size: 1rem;
    font-weight: 600;
    color: var(--white-87);
    margin-bottom: 0.3rem;
}

.symbolList {
    max-height: 190px;
    overflow-y: auto;
    border: 1px solid var(--white-18);
    border-radius: 8px;
    margin-bottom: 0.4rem;
}

.symbolItem {
    display: block;
    width: 100%;
    text-align: left;
    font-size: 0.78rem;
    padding: 0.22rem 0.5rem;
    border: none;
    background: transparent;
    color: var(--white-70);
    cursor: pointer;
}

.symbolItem:hover {
    background: var(--black-bg-12);
    color: var(--white-87);
}

.symbolItem.active {
    color: var(--blue-color);
    font-weight: 600;
}

.symbolHint {
    font-size: 0.75rem;
    color: var(--white-38);
    padding: 0.3rem 0.5rem;
}

.liveToggle {
    font-size: 0.78rem;
    color: var(--white-70);
    cursor: pointer;
}

/* Wirkungslos in der Wiedergabe — sichtbar bleiben, aber nicht bedienbar wirken */
.liveToggleAus {
    opacity: 0.4;
    cursor: not-allowed;
}

.colorRefRow {
    display: flex;
    gap: 0.3rem;
}

.refBtn {
    flex-shrink: 0;
    border: 1px solid var(--white-18);
    border-radius: 8px;
    background: transparent;
    color: var(--white-70);
    padding: 0 0.5rem;
    cursor: pointer;
}

.refBtn:hover:not(:disabled) {
    border-color: var(--blue-color);
    color: var(--white-87);
}

.refBtn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.autoRefHint {
    font-size: 0.72rem;
    color: var(--white-38);
}

.threshVal {
    color: var(--blue-color);
    margin-left: 0.3rem;
}

.threshRange {
    width: 100%;
    accent-color: var(--blue-color);
    cursor: pointer;
}
</style>
