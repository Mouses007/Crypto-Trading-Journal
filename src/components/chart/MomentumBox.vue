<script setup>
/**
 * Das Info-Panel des Momentum Radar (Pine des Users, Ansicht „Ausführlich")
 * für die Seitenleiste des Charts: Kopfzeile mit Urteil, SWING/DAY-Setup,
 * Herkunft des Volumens, VWAP-Lage mit Geldfluss, 4h-Struktur und die
 * Zeitebenen W bis 5m.
 *
 * Gerechnet wird auf dem Server (`server/momentum-radar.js`, dieselbe Route
 * wie die Live-Trading-Kachel). Inhalt wie im Pine, Form als Karte: Setups als
 * Kacheln, die Herkunft als geteilter Balken, der Geldfluss als Zeiger um die
 * Null, und jede Zeitebene als Leiste von −100 bis +100 mit den Zonen ±50 —
 * „fast Long-Zone" sagt, DASS es knapp ist, der Punkt auf der Leiste, WIE knapp.
 * Farben der Zeitebenen und der Signale wie im Pine (Gruppe 6/7).
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
const F = { long: '#4caf50', short: '#ef5350', longS: '#00e676', shortS: '#ff1744', grau: '#787b86', rein: '#4caf50', raus: '#ef5350', fut: '#8e6cef', spot: '#26a69a' }
const TF_FARBE = { '1w': '#ffd54f', '1d': '#ffffff', '4h': '#ba68c8', '1h': '#ffa726', '15m': '#bdbdbd', '5m': '#bdbdbd' }
const NAME = { '1w': 'W', '1d': 'D', '4h': '4h', '1h': '1h', '15m': '15m', '5m': '5m' }
const seite = (d) => (d > 0 ? 'long' : d < 0 ? 'short' : 'neutral')

// ── Kopf und Setups ───────────────────────────────────────────────────────
const status = computed(() => daten.value?.status ?? 0)
const statusText = computed(() => t('livetrading.momentum.status_' + (status.value > 0 ? 'long' : status.value < 0 ? 'short' : 'warten')))
const modusText = computed(() => t('livetrading.momentum.modus_' + (daten.value?.modus || 'swing')))
const setup = (d) => t('livetrading.momentum.setup_' + (d > 0 ? 'long' : d < 0 ? 'short' : 'kein'))

// ── Herkunft ──────────────────────────────────────────────────────────────
const MF_MIN = 5
const her = computed(() => daten.value?.herkunft || {})
const fluss = computed(() => daten.value?.geldfluss || {})
const futPct = computed(() => (her.value.anteil == null ? null : Math.round(her.value.anteil * 100)))
const herkunft = computed(() => {
    const d = daten.value
    if (!d) return { text: '', art: 'neutral' }
    if (d.spotStatus === 'gestoert') return { text: t('livetrading.momentum.herkunft_gestoert'), art: 'neutral' }
    if (!d.spotVerfuegbar || her.value.anteil == null) return { text: t('livetrading.momentum.herkunft_keinSpot'), art: 'neutral' }
    if (her.value.urteil === 'futures') return { text: t('livetrading.momentum.herkunft_futures'), art: 'futures' }
    if (her.value.urteil === 'spot') {
        // Spot-Anteil hoch sagt nur, DASS Spot handelt — die Richtung kommt aus seinem Geldfluss.
        const s = fluss.value.spot
        const offen = s == null || Math.abs(s) < MF_MIN
        const richtung = offen ? t('chart.mbox.richtungOffen') : s > 0 ? t('chart.mbox.kauft') : t('chart.mbox.verkauft')
        return { text: `${t('chart.mbox.spotHoch')} · ${richtung}`, art: offen ? 'neutral' : s > 0 ? 'long' : 'short' }
    }
    if (!her.value.urteil) return { text: t('livetrading.momentum.herkunft_unbekannt'), art: 'neutral' }
    return { text: t('livetrading.momentum.herkunft_normal'), art: 'neutral' }
})

// ── VWAP und Geldfluss ────────────────────────────────────────────────────
const pfeil = (d) => (d > 0 ? '▲' : d < 0 ? '▼' : '•')
const vw = computed(() => daten.value?.vwap || {})
const istZahl = (x) => typeof x === 'number' && Number.isFinite(x)
/** Abstand des Kurses zum VWAP in Prozent: + = Kurs darüber. */
const abstand = (v) => (istZahl(v) && v !== 0 && istZahl(vw.value.preis) ? ((vw.value.preis - v) / v) * 100 : null)
const vwapZeilen = computed(() => [
    { name: 'W', a: abstand(vw.value.woche), kurs: vw.value.woche },
    { name: 'M', a: abstand(vw.value.monat), kurs: vw.value.monat },
])
const prozent = (w) => (w == null ? '—' : `${w > 0 ? '+' : ''}${w.toFixed(Math.abs(w) < 10 ? 2 : 1)} %`)
const mfWert = computed(() => fluss.value.wert)
const mfText = computed(() => (mfWert.value == null ? '—' : `${mfWert.value >= 0 ? '+' : ''}${mfWert.value.toFixed(1)}`))
const mfFarbe = computed(() => (her.value.urteil === 'futures' ? F.fut : (mfWert.value ?? 0) >= 0 ? F.rein : F.raus))
/** Geldfluss als Balken ab der Mitte: ±60 (Extrembereich im Pine) füllt eine Hälfte. */
const mfBalken = computed(() => {
    const w = mfWert.value
    if (w == null) return null
    const anteil = Math.min(1, Math.abs(w) / 60) * 50
    return w >= 0 ? { left: '50%', width: anteil + '%' } : { left: 50 - anteil + '%', width: anteil + '%' }
})

// ── Struktur ──────────────────────────────────────────────────────────────
function kurs(x) {
    if (!istZahl(x)) return '—'
    return x >= 1000 ? Math.round(x).toLocaleString('de-CH').replace(/['’]/g, ' ') : x >= 1 ? x.toFixed(2) : x.toPrecision(4)
}
const struktur = computed(() => daten.value?.struktur || null)

// ── Zeitebenen ────────────────────────────────────────────────────────────
const ZUSTAND = { long: 'zLong', short: 'zShort', fastLong: 'zFastLong', fastShort: 'zFastShort', neutral: 'zNeutral' }
const zustand = (z) => (z.zustand ? t('chart.mbox.' + (ZUSTAND[z.zustand] || 'zNeutral')) : '—')
const zeitebenen = computed(() => daten.value?.zeitebenen || [])
/** Position auf der Leiste −100…+100 (über ±100 = ausgereizt, am Rand festgehalten). */
const position = (w) => (istZahl(w) ? Math.max(0, Math.min(100, (w + 100) / 2)) : null)
</script>

<template>
    <div class="mbox">
        <div v-if="fehler && !daten" class="hinweis">{{ fehler }}</div>
        <div v-else-if="!daten" class="hinweis"><span class="spinner-border spinner-border-sm"></span></div>
        <template v-else>
            <!-- Kopf: das Urteil -->
            <div class="kopf" :class="'k-' + seite(status)">
                <span class="punkt"></span>
                <span class="status">{{ statusText }}</span>
                <span class="modus">{{ modusText }}</span>
            </div>

            <!-- Setups -->
            <div class="zwei">
                <div class="kachel" :title="t('chart.mbox.tipSwing')">
                    <div class="klein">SWING <span>D · 4h · 1h</span></div>
                    <div class="pille" :class="'p-' + seite(daten.swing)">{{ setup(daten.swing) }}</div>
                </div>
                <div class="kachel" :title="t('chart.mbox.tipDay')">
                    <div class="klein">DAY <span>15m · 5m</span></div>
                    <div class="pille" :class="'p-' + seite(daten.day)">{{ setup(daten.day) }}</div>
                </div>
            </div>

            <!-- Herkunft: geteilter Balken Futures | Spot -->
            <div class="kachel" :title="t('chart.mbox.tipHerkunft')">
                <div class="klein zeile">
                    <span>{{ t('livetrading.momentum.herkunft') }}</span>
                    <b :class="'t-' + herkunft.art">{{ herkunft.text }}</b>
                </div>
                <div v-if="futPct != null" class="split">
                    <div class="fut" :class="{ treibt: her.urteil === 'futures' }" :style="{ width: futPct + '%' }"><span>Fut {{ futPct }}%</span></div>
                    <div class="spot" :style="{ width: 100 - futPct + '%' }"><span v-if="100 - futPct >= 14">Spot {{ 100 - futPct }}%</span></div>
                </div>
            </div>

            <!-- VWAP und Geldfluss -->
            <div class="zwei">
                <div class="kachel" :title="t('chart.mbox.tipVwap')">
                    <div class="klein">VWAP</div>
                    <div v-for="v in vwapZeilen" :key="v.name" class="vwap" :title="v.name + '-VWAP ' + kurs(v.kurs)">
                        <span class="vName">{{ v.name }}</span>
                        <span :class="v.a == null ? 't-neutral' : v.a >= 0 ? 't-long' : 't-short'">{{ pfeil(v.a == null ? 0 : v.a >= 0 ? 1 : -1) }} {{ prozent(v.a) }}</span>
                    </div>
                </div>
                <div class="kachel" :title="t('chart.mbox.tipVwap')">
                    <div class="klein">{{ t('livetrading.momentum.fluss') }}</div>
                    <div class="mfZahl" :style="{ color: mfFarbe }">{{ mfText }}</div>
                    <div class="mfLeiste">
                        <div class="mitte"></div>
                        <div v-if="mfBalken" class="mfBalken" :style="{ ...mfBalken, background: mfFarbe }"></div>
                    </div>
                </div>
            </div>

            <!-- Struktur 4h -->
            <div class="kachel struktur" :title="t('chart.mbox.tipStruktur')">
                <span class="klein">{{ t('livetrading.momentum.struktur') }} <span>4h</span></span>
                <template v-if="struktur && struktur.richtung && struktur.level != null">
                    <span class="marke" :class="'p-' + seite(struktur.richtung)">{{ struktur.choch ? 'CHoCH' : 'BOS' }} {{ pfeil(struktur.richtung) }}</span>
                    <b>{{ kurs(struktur.level) }}</b>
                    <small>{{ t('livetrading.momentum.vorKerzen', { n: struktur.alterKerzen ?? '?' }) }}</small>
                </template>
                <small v-else>{{ t('livetrading.momentum.keinBruch') }}</small>
                <small v-if="struktur" class="ema" :class="'t-' + seite(struktur.emaRichtung)">EMA50 {{ pfeil(struktur.emaRichtung) }}</small>
            </div>

            <!-- Zeitebenen: Welle auf der Leiste −100 … +100 -->
            <div class="kachel leiter" :title="t('chart.mbox.tipTf')">
                <div class="klein zeile"><span>{{ t('chart.mbox.zeitebenen') }}</span><span class="skala">Long −50 · 0 · +50 Short</span></div>
                <div v-for="z in zeitebenen" :key="z.tf" class="tf" :title="`${NAME[z.tf] || z.tf}: ${z.wert != null ? z.wert.toFixed(1) : '—'} · ${zustand(z)}`">
                    <span class="tfName" :style="{ color: TF_FARBE[z.tf] || '#bdbdbd', borderColor: TF_FARBE[z.tf] || '#bdbdbd' }">{{ NAME[z.tf] || z.tf }}</span>
                    <div class="bahn">
                        <div class="null"></div>
                        <div v-if="position(z.wert) != null" class="wert" :class="'w-' + seite(z.dir)" :style="{ left: position(z.wert) + '%' }"></div>
                    </div>
                    <span class="tfText" :class="'t-' + seite(z.dir)">{{ zustand(z) }}</span>
                </div>
            </div>

            <div v-if="radarTf !== interval" class="fussnote">{{ t('chart.mbox.radarTf', { tf: radarTf }) }}</div>
        </template>
    </div>
</template>

<style scoped>
.mbox {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 11.5px;
    color: var(--white-87, #e6e6e6);
}

.hinweis {
    color: var(--grey-text);
    padding: 10px;
    text-align: center;
}

/* ── Kopf ─────────────────────────────────────────────── */
.kopf {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: linear-gradient(135deg, rgba(158, 158, 158, 0.18), rgba(158, 158, 158, 0.04));
}

.kopf .status {
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 0.04em;
    flex: 1;
}

.kopf .modus {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 2px 7px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.08);
    color: var(--grey-text);
}

.kopf .punkt {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #9e9e9e;
}

.kopf.k-long {
    background: linear-gradient(135deg, rgba(0, 230, 118, 0.28), rgba(0, 230, 118, 0.05));
    border-color: rgba(0, 230, 118, 0.35);
}

.kopf.k-short {
    background: linear-gradient(135deg, rgba(255, 23, 68, 0.28), rgba(255, 23, 68, 0.05));
    border-color: rgba(255, 23, 68, 0.35);
}

.kopf.k-long .punkt {
    background: #00e676;
    box-shadow: 0 0 8px #00e676;
    animation: puls 2s infinite;
}

.kopf.k-short .punkt {
    background: #ff1744;
    box-shadow: 0 0 8px #ff1744;
    animation: puls 2s infinite;
}

@keyframes puls {
    50% { opacity: 0.45; }
}

/* ── Kacheln ──────────────────────────────────────────── */
.zwei {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
}

.kachel {
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 7px;
    padding: 6px 8px;
    min-width: 0;
}

.klein {
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--grey-text);
    margin-bottom: 4px;
}

.klein span {
    text-transform: none;
    letter-spacing: 0;
    opacity: 0.7;
}

.klein.zeile {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    align-items: baseline;
}

.klein.zeile b {
    text-transform: none;
    letter-spacing: 0;
    font-size: 11px;
    font-weight: 600;
    text-align: right;
}

.pille {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-weight: 600;
    font-size: 11px;
}

.p-long { background: rgba(76, 175, 80, 0.22); color: #69f0ae; }
.p-short { background: rgba(239, 83, 80, 0.22); color: #ff8a80; }
.p-neutral { background: rgba(120, 123, 134, 0.2); color: #b0b4bd; }

.t-long { color: #69f0ae; }
.t-short { color: #ff8a80; }
.t-neutral { color: #b0b4bd; }
.t-futures { color: #b39ddb; }

/* ── Herkunft ─────────────────────────────────────────── */
.split {
    display: flex;
    height: 16px;
    border-radius: 8px;
    overflow: hidden;
    font-size: 9.5px;
    font-weight: 600;
}

.split > div {
    display: flex;
    align-items: center;
    justify-content: center;
    white-space: nowrap;
    overflow: hidden;
}

.split .fut {
    background: rgba(142, 108, 239, 0.35);
    color: #d1c4e9;
}

.split .fut.treibt {
    background: rgba(142, 108, 239, 0.75);
    color: #fff;
}

.split .spot {
    background: rgba(38, 166, 154, 0.45);
    color: #b2dfdb;
}

/* ── VWAP und Geldfluss ───────────────────────────────── */
.vwap {
    display: flex;
    justify-content: space-between;
    font-variant-numeric: tabular-nums;
    line-height: 1.5;
}

.vName {
    color: var(--grey-text);
    font-weight: 600;
}

.mfZahl {
    font-size: 16px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
}

.mfLeiste {
    position: relative;
    height: 5px;
    margin-top: 5px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.07);
}

.mfLeiste .mitte {
    position: absolute;
    left: 50%;
    top: -2px;
    bottom: -2px;
    width: 1px;
    background: rgba(255, 255, 255, 0.35);
}

.mfBalken {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 3px;
}

/* ── Struktur ─────────────────────────────────────────── */
.struktur {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 7px;
}

.struktur .klein {
    margin: 0;
}

.marke {
    padding: 1px 7px;
    border-radius: 9px;
    font-weight: 600;
    font-size: 10.5px;
}

.struktur b {
    font-variant-numeric: tabular-nums;
}

.struktur small {
    color: var(--grey-text);
}

.struktur .ema {
    margin-left: auto;
}

/* ── Zeitebenen ───────────────────────────────────────── */
.skala {
    font-size: 9px;
}

.tf {
    display: grid;
    grid-template-columns: 30px 1fr 84px;
    align-items: center;
    gap: 7px;
    height: 20px;
}

.tfName {
    font-weight: 700;
    font-size: 10.5px;
    text-align: center;
    border-left: 2px solid;
    padding-left: 2px;
}

.bahn {
    position: relative;
    height: 8px;
    border-radius: 4px;
    /* −100…−50 Long-Zone (grün), −50…+50 neutral, +50…+100 Short-Zone (rot) */
    background: linear-gradient(90deg,
        rgba(76, 175, 80, 0.32) 0%, rgba(76, 175, 80, 0.32) 25%,
        rgba(255, 255, 255, 0.06) 25%, rgba(255, 255, 255, 0.06) 75%,
        rgba(239, 83, 80, 0.32) 75%, rgba(239, 83, 80, 0.32) 100%);
}

.bahn .null {
    position: absolute;
    left: 50%;
    top: -2px;
    bottom: -2px;
    width: 1px;
    background: rgba(255, 255, 255, 0.3);
}

.bahn .wert {
    position: absolute;
    top: 50%;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    border: 2px solid #151a26;
    background: #b0b4bd;
}

.bahn .w-long {
    background: #00e676;
    box-shadow: 0 0 6px rgba(0, 230, 118, 0.7);
}

.bahn .w-short {
    background: #ff1744;
    box-shadow: 0 0 6px rgba(255, 23, 68, 0.7);
}

.tfText {
    font-size: 10.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: right;
}

.fussnote {
    font-size: 10px;
    color: var(--grey-text);
}
</style>
