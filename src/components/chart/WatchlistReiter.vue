<script setup>
/**
 * Watchlist mit Live-Kursen. Kurse kommen per `miniTicker` direkt von Binance
 * (ein Stream je Markt, nur für die Symbole der Liste); 24h-Veränderung ist
 * Schluss gegen Eröffnung des rollierenden 24h-Fensters — dieselbe Zahl, die
 * Binance selbst anzeigt.
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { BinanceStream, buildMiniTickerUrl } from '../../utils/binanceStream.js'
import axios from 'axios'

const props = defineProps({
    watchlists: { type: Array, default: () => [] },
    aktivesSymbol: { type: String, default: '' },
    aktiverMarkt: { type: String, default: 'futures' },
})
const emit = defineEmits(['waehle', 'aendere', 'neu', 'loesche'])
const { t } = useI18n()

const listeId = ref(null)
const kurse = ref({})            // `${markt}|${symbol}` → { c, o }
let streams = []

const liste = computed(() => props.watchlists.find((w) => w.id === listeId.value) || props.watchlists[0] || null)
const symbole = computed(() => liste.value?.symbole || [])
const enthaeltAktives = computed(() => symbole.value.some((s) => s.symbol === props.aktivesSymbol && s.markt === props.aktiverMarkt))

watch(() => props.watchlists, (w) => {
    if (!w.find((x) => x.id === listeId.value)) listeId.value = w[0]?.id ?? null
}, { immediate: true })

function verbinde() {
    for (const s of streams) s.stop()
    streams = []
    for (const markt of ['futures', 'spot']) {
        const syms = symbole.value.filter((s) => s.markt === markt).map((s) => s.symbol)
        const url = buildMiniTickerUrl(syms, markt)
        if (!url) continue
        const st = new BinanceStream({
            url,
            silenceLimitMs: 30_000,
            onMessage: (m) => {
                const d = m?.data
                if (!d?.s) return
                kurse.value = { ...kurse.value, [`${markt}|${d.s}`]: { c: Number(d.c), o: Number(d.o) } }
            },
        })
        st.connect()
        streams.push(st)
        // Startkurse sofort, nicht erst beim ersten Tick — sonst steht „—" da, bis jedes Symbol einmal gehandelt hat.
        axios.get('/api/chart/ticker', { params: { markt, symbole: syms.join(',') } }).then(({ data }) => {
            const neu = { ...kurse.value }
            for (const [sym, k] of Object.entries(data.kurse || {})) if (!neu[`${markt}|${sym}`]) neu[`${markt}|${sym}`] = k
            kurse.value = neu
        }).catch(() => { /* der Stream füllt nach */ })
    }
}

watch(() => symbole.value.map((s) => s.markt + s.symbol).join(','), verbinde, { immediate: true })
onBeforeUnmount(() => { for (const s of streams) s.stop() })

function kurs(s) {
    return kurse.value[`${s.markt}|${s.symbol}`]
}

function stellen(c) {
    if (!c) return 2
    return c >= 1000 ? 2 : c >= 10 ? 3 : c >= 1 ? 4 : Math.min(8, 3 - Math.floor(Math.log10(c)))
}

function aenderung(s) {
    const k = kurs(s)
    return k && k.o ? ((k.c - k.o) / k.o) * 100 : null
}

function fuegeHinzu() {
    if (!liste.value || enthaeltAktives.value) return
    emit('aendere', liste.value.id, [...symbole.value, { symbol: props.aktivesSymbol, markt: props.aktiverMarkt }])
}

function entferne(s) {
    emit('aendere', liste.value.id, symbole.value.filter((x) => !(x.symbol === s.symbol && x.markt === s.markt)))
}

function verschiebe(i, richtung) {
    const neu = [...symbole.value]
    const j = i + richtung
    if (j < 0 || j >= neu.length) return
    ;[neu[i], neu[j]] = [neu[j], neu[i]]
    emit('aendere', liste.value.id, neu)
}

function neueListe() {
    const n = window.prompt(t('chart.watchlistName'), t('chart.watchlistNeuVorgabe'))
    if (n) emit('neu', n)
}

function loescheListe() {
    if (!liste.value || props.watchlists.length <= 1) return
    if (window.confirm(t('chart.watchlistLoeschenFrage', { name: liste.value.name }))) emit('loesche', liste.value.id)
}
</script>

<template>
    <div class="watchlist">
        <div class="kopf">
            <select v-model="listeId" class="form-select form-select-sm">
                <option v-for="w in watchlists" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
            <button class="icon" :title="t('chart.watchlistNeu')" @click="neueListe"><i class="uil uil-plus"></i></button>
            <button class="icon" :title="t('chart.watchlistLoeschen')" :disabled="watchlists.length <= 1" @click="loescheListe"><i
                    class="uil uil-trash-alt"></i></button>
        </div>
        <button class="hinzu" :disabled="enthaeltAktives || !liste" @click="fuegeHinzu">
            <i class="uil uil-star"></i> {{ t('chart.watchlistHinzu', { symbol: aktivesSymbol }) }}
        </button>
        <div class="zeilen">
            <div v-for="(s, i) in symbole" :key="s.markt + s.symbol" class="zeile"
                :class="{ an: s.symbol === aktivesSymbol && s.markt === aktiverMarkt }" @click="emit('waehle', s)">
                <span class="sym">{{ s.symbol }}<small v-if="s.markt === 'spot'"> Spot</small></span>
                <span class="preis">{{ kurs(s) ? kurs(s).c.toFixed(stellen(kurs(s).c)) : '—' }}</span>
                <span class="delta" :class="aenderung(s) == null ? '' : aenderung(s) >= 0 ? 'greenTrade' : 'redTrade'">
                    {{ aenderung(s) == null ? '' : (aenderung(s) >= 0 ? '+' : '') + aenderung(s).toFixed(2) + ' %' }}
                </span>
                <span class="werkzeug" @click.stop>
                    <button class="icon" @click="verschiebe(i, -1)"><i class="uil uil-angle-up"></i></button>
                    <button class="icon" @click="verschiebe(i, 1)"><i class="uil uil-angle-down"></i></button>
                    <button class="icon" @click="entferne(s)"><i class="uil uil-times"></i></button>
                </span>
            </div>
            <div v-if="!symbole.length" class="leer">{{ t('chart.watchlistLeer') }}</div>
        </div>
    </div>
</template>

<style scoped>
.watchlist {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
}

.kopf {
    display: flex;
    gap: 4px;
    align-items: center;
}

.icon {
    background: transparent;
    border: none;
    color: var(--grey-text);
    padding: 2px 5px;
    border-radius: 4px;
}

.icon:hover:not(:disabled) {
    color: var(--white-87, #eee);
    background: var(--white-10);
}

.hinzu {
    background: transparent;
    border: 1px dashed var(--white-18);
    color: var(--grey-text);
    font-size: 11px;
    border-radius: 6px;
    padding: 4px;
}

.hinzu:disabled {
    opacity: 0.4;
}

.zeilen {
    overflow-y: auto;
    min-height: 0;
}

.zeile {
    display: grid;
    grid-template-columns: 1fr auto 64px;
    align-items: center;
    gap: 6px;
    padding: 5px 6px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    position: relative;
}

.zeile:hover {
    background: var(--white-10);
}

.zeile.an {
    background: rgba(1, 180, 255, 0.1);
}

.sym small {
    color: var(--grey-text);
}

.preis {
    text-align: right;
    font-variant-numeric: tabular-nums;
}

.delta {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-size: 11px;
}

.werkzeug {
    display: none;
    position: absolute;
    right: 2px;
    background: var(--black-bg-5, #1e222d);
    border-radius: 4px;
}

.zeile:hover .werkzeug {
    display: flex;
}

.leer {
    color: var(--grey-text);
    font-size: 12px;
    padding: 8px 4px;
}
</style>
