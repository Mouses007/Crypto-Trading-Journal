<script setup>
/**
 * Das Info-Panel des Momentum Radar (Pine des Users, Ansicht „Ausführlich")
 * für die Seitenleiste des Charts: Kopfzeile mit Urteil, SWING/DAY-Setup,
 * Herkunft des Volumens, VWAP-Lage mit Geldfluss, 4h-Struktur und die
 * Zeitebenen W bis 5m.
 *
 * Gerechnet wird auf dem Server (`server/momentum-radar.js`, dieselbe Route
 * wie die Live-Trading-Kachel); hier wird nur angeordnet wie im Pine. Farben
 * wie dort: in den Panel-Hintergrund gemischt statt transparent (`f_mix`),
 * damit das Panel blickdicht bleibt.
 *
 * Der Radar rechnet auf 5m/15m/1h/4h. Auf einem anderen Chart wird die
 * nächstliegende genommen (1m/3m → 5m, alles über 4h → 4h) — das Panel
 * beschreibt den Markt, nicht den offenen Chart; nur Swing/Day hängt daran.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'

const props = defineProps({
    symbol: { type: String, required: true },
    interval: { type: String, default: '1h' },
    markt: { type: String, default: 'futures' },
})
const { t } = useI18n()

const RADAR_TF = ['5m', '15m', '1h', '4h']
const MIN = { '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240 }
const radarTf = computed(() => {
    if (RADAR_TF.includes(props.interval)) return props.interval
    const m = MIN[props.interval]
    if (m == null || m > 240) return '4h'
    if (m < 5) return '5m'
    return m <= 15 ? '15m' : m <= 60 ? '1h' : '4h'
})

const daten = ref(null)
const fehler = ref('')
let uhr = null
let nr = 0

async function lade() {
    const meine = ++nr
    if (props.markt === 'spot') { daten.value = null; fehler.value = t('chart.mbox.nurFutures'); return }
    try {
        const { data } = await axios.get('/api/livetrading/momentum', { params: { symbol: props.symbol, tf: radarTf.value } })
        if (meine !== nr) return
        daten.value = data
        fehler.value = ''
    } catch (e) {
        if (meine !== nr) return
        fehler.value = e.response?.data?.error || e.message
    }
}
watch(() => [props.symbol, radarTf.value, props.markt], () => { daten.value = null; lade() })
onMounted(() => { lade(); uhr = setInterval(lade, 60_000) })
onBeforeUnmount(() => clearInterval(uhr))

// ── Farben wie im Pine ────────────────────────────────────────────────────
const PANEL_BG = [0x15, 0x1a, 0x26]
function mix(hex, amt) {
    const n = parseInt(hex.slice(1), 16)
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    return `rgb(${c.map((v, i) => Math.round(PANEL_BG[i] + (v - PANEL_BG[i]) * amt)).join(',')})`
}
const F = { long: '#4caf50', short: '#ef5350', longS: '#00e676', shortS: '#ff1744', grau: '#787b86', rein: '#4caf50', raus: '#c62828', fut: '#8e6cef' }
const richtungBg = (d) => (d > 0 ? mix(F.long, 0.55) : d < 0 ? mix(F.short, 0.55) : mix(F.grau, 0.28))
const CHIP = { '1w': '#ffd54f', '1d': '#ffffff', '4h': '#ba68c8', '1h': '#ffa726', '15m': '#bdbdbd', '5m': '#bdbdbd' }
const NAME = { '1w': 'W', '1d': 'D', '4h': '4h', '1h': '1h', '15m': '15m', '5m': '5m' }

// ── Zeilen ────────────────────────────────────────────────────────────────
const status = computed(() => daten.value?.status ?? 0)
const kopfText = computed(() => `▶ ${t('livetrading.momentum.status_' + (status.value > 0 ? 'long' : status.value < 0 ? 'short' : 'warten'))} · ${t('livetrading.momentum.modus_' + (daten.value?.modus || 'swing'))}`)
const kopfBg = computed(() => (status.value > 0 ? mix(F.longS, 0.8) : status.value < 0 ? mix(F.shortS, 0.8) : mix('#9e9e9e', 0.45)))
const setup = (d) => t('livetrading.momentum.setup_' + (d > 0 ? 'long' : d < 0 ? 'short' : 'kein'))

const MF_MIN = 5
const her = computed(() => daten.value?.herkunft || {})
const fluss = computed(() => daten.value?.geldfluss || {})
const herkunft = computed(() => {
    const d = daten.value
    if (!d) return { text: '', zahl: '', bg: mix(F.grau, 0.25) }
    if (d.spotStatus === 'gestoert') return { text: t('livetrading.momentum.herkunft_gestoert'), zahl: '', bg: mix(F.grau, 0.25) }
    if (!d.spotVerfuegbar || her.value.anteil == null) return { text: t('livetrading.momentum.herkunft_keinSpot'), zahl: '', bg: mix(F.grau, 0.25) }
    const zahl = `Fut ${Math.round(her.value.anteil * 100)}% · Spot ${Math.round(100 - her.value.anteil * 100)}%`
    if (her.value.urteil === 'futures') return { text: t('livetrading.momentum.herkunft_futures'), zahl, bg: mix(F.fut, 0.65) }
    if (her.value.urteil === 'spot') {
        // Spot-Anteil hoch sagt nur, DASS Spot handelt — die Richtung kommt aus seinem Geldfluss.
        const s = fluss.value.spot
        const offen = s == null || Math.abs(s) < MF_MIN
        const richtung = offen ? t('chart.mbox.richtungOffen') : s > 0 ? t('chart.mbox.kauft') : t('chart.mbox.verkauft')
        return { text: `${t('chart.mbox.spotHoch')} · ${richtung}`, zahl, bg: mix(offen ? F.grau : s > 0 ? F.rein : F.raus, 0.6) }
    }
    if (!her.value.urteil) return { text: t('livetrading.momentum.herkunft_unbekannt'), zahl, bg: mix(F.grau, 0.3) }
    return { text: t('livetrading.momentum.herkunft_normal'), zahl, bg: mix(F.grau, 0.3) }
})

const pfeil = (d) => (d > 0 ? '▲' : d < 0 ? '▼' : '•')
const vw = computed(() => daten.value?.vwap || {})
const vwapText = computed(() => `W-VWAP ${pfeil(vw.value.ueberWoche ? 1 : -1)} · M-VWAP ${pfeil(vw.value.ueberMonat ? 1 : -1)}`)
const mfText = computed(() => (fluss.value.wert == null ? '—' : `${fluss.value.wert >= 0 ? '+' : ''}${fluss.value.wert.toFixed(1)}`))
const mfBg = computed(() => mix(her.value.urteil === 'futures' ? F.fut : (fluss.value.wert ?? 0) >= 0 ? F.rein : F.raus, 0.55))

function kurs(x) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return '—'
    return x >= 1000 ? x.toFixed(0) : x >= 1 ? x.toFixed(2) : x.toPrecision(4)
}
const strukturText = computed(() => {
    const s = daten.value?.struktur
    if (!s) return '—'
    const ema = `EMA50 ${pfeil(s.emaRichtung)}`
    if (!s.richtung || s.level == null) return `4h · ${t('livetrading.momentum.keinBruch')} · ${ema}`
    return `4h · ${s.choch ? 'CHoCH' : 'BOS'} ${pfeil(s.richtung)} ${kurs(s.level)} vor ${s.alterKerzen ?? '?'} · ${ema}`
})

const ZUSTAND = { long: 'zLong', short: 'zShort', fastLong: 'zFastLong', fastShort: 'zFastShort', neutral: 'zNeutral' }
const zustand = (z) => (z.zustand ? t('chart.mbox.' + (ZUSTAND[z.zustand] || 'zNeutral')) : '—')
const zeitebenen = computed(() => daten.value?.zeitebenen || [])
</script>

<template>
    <div class="mbox">
        <div v-if="fehler && !daten" class="hinweis">{{ fehler }}</div>
        <div v-else-if="!daten" class="hinweis"><span class="spinner-border spinner-border-sm"></span></div>
        <table v-else class="tabelle">
            <!-- Feste Anteile: in der schmalen Seitenleiste passt die Tabelle immer in die Breite. -->
            <colgroup>
                <col style="width: 23%" />
                <col />
                <col style="width: 31%" />
            </colgroup>
            <tbody>
                <tr>
                    <td colspan="3" class="kopf" :style="{ background: kopfBg }">{{ kopfText }}</td>
                </tr>
                <tr :title="t('chart.mbox.tipSwing')">
                    <td class="label">SWING</td>
                    <td class="mitte">Tag/4h/1h</td>
                    <td class="wert" :style="{ background: richtungBg(daten.swing) }">{{ setup(daten.swing) }}</td>
                </tr>
                <tr :title="t('chart.mbox.tipDay')">
                    <td class="label">DAY</td>
                    <td class="mitte">15m/5m</td>
                    <td class="wert" :style="{ background: richtungBg(daten.day) }">{{ setup(daten.day) }}</td>
                </tr>
                <tr :title="t('chart.mbox.tipHerkunft')">
                    <td class="label">{{ t('livetrading.momentum.herkunft') }}</td>
                    <!-- Urteil und Aufteilung in EINER Zelle: die breite Zahl in einer eigenen
                         Spalte drückte in der schmalen Leiste jede andere Zelle zum Umbruch. -->
                    <td colspan="2" class="text umbruch" :style="{ background: herkunft.bg }">{{ herkunft.text }}<small
                            v-if="herkunft.zahl" class="zahl"> · {{ herkunft.zahl }}</small></td>
                </tr>
                <tr :title="t('chart.mbox.tipVwap')">
                    <td class="label">VWAP</td>
                    <td class="text dunkel umbruch">{{ vwapText }}</td>
                    <td class="wert" :style="{ background: mfBg }">{{ mfText }}</td>
                </tr>
                <tr :title="t('chart.mbox.tipStruktur')">
                    <td class="label">{{ t('livetrading.momentum.struktur') }}</td>
                    <td colspan="2" class="text dunkel umbruch">{{ strukturText }}</td>
                </tr>
                <tr v-for="z in zeitebenen" :key="z.tf" :title="t('chart.mbox.tipTf') + (z.wert != null ? ` (${z.wert.toFixed(1)})` : '')">
                    <td class="chip" :style="{ background: CHIP[z.tf] || '#bdbdbd' }">{{ NAME[z.tf] || z.tf }}</td>
                    <td class="text" :style="{ background: richtungBg(z.dir) }">{{ zustand(z) }}</td>
                    <td class="pfeil" :style="{ background: richtungBg(z.dir) }">{{ z.dir > 0 ? '▲' : z.dir < 0 ? '▼' : '' }}</td>
                </tr>
            </tbody>
        </table>
        <div v-if="daten && radarTf !== interval" class="fussnote">{{ t('chart.mbox.radarTf', { tf: radarTf }) }}</div>
    </div>
</template>

<style scoped>
.mbox {
    font-size: 11px;
    line-height: 1.25;
}

.tabelle {
    width: 100%;
    border-collapse: separate;
    border-spacing: 1px;
    background: rgb(70, 75, 88);
    border-radius: 4px;
    overflow: hidden;
    table-layout: fixed;
}

.tabelle td {
    padding: 3px 5px;
    color: #fff;
    background: #151a26;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.kopf {
    text-align: center;
    font-weight: 600;
    font-size: 12.5px;
    padding: 5px 6px !important;
}

.label {
    color: #cfd3da !important;
}

.mitte {
    color: #9aa3b2 !important;
    text-align: center;
}

.text {
    text-align: center;
}

/* Nur die langen Zeilen dürfen umbrechen — Zustände und Setups bleiben einzeilig. */
.umbruch {
    white-space: normal !important;
}

.dunkel {
    color: #e8eaed !important;
}

.wert,
.zahl {
    text-align: center;
}

.zahl {
    color: #e8eaed;
    opacity: 0.85;
}

.chip {
    color: #000 !important;
    text-align: center;
    font-weight: 600;
}

.pfeil {
    text-align: center;
}

.hinweis {
    color: var(--grey-text);
    padding: 8px;
    text-align: center;
}

.fussnote {
    margin-top: 4px;
    font-size: 10px;
    color: var(--grey-text);
}
</style>
