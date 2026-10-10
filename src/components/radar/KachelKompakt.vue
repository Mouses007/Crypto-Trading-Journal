<script setup>
/**
 * Kompakt — die Nebenkacheln des Live-Fensters in einer Karte.
 *
 * Im Handelsfenster sind Bookmap und Liquidationskarte die Arbeitsflächen;
 * alles andere ist Nachschlagen. Als je eigene Kachel kostet das Nachschlagen
 * zwei Bildschirmreihen und ebenso viele Kopfzeilen, Knöpfe und Rahmen. Hier
 * steht jede Quelle als EINE Zeile: Beschriftung, die eine Zahl, auf die es
 * ankommt, und höchstens eine Nebenangabe.
 *
 * Holt nichts selbst. Die Seite reicht über `quellen` die Nutzlasten der
 * übrigen Kacheln durch — dieselben Abrufe, dieselben Takte, auch wenn die
 * Kacheln selbst ausgeblendet sind (`immerLaden` in `Livetrading.vue`). Wer
 * eine Zeile anklickt, bekommt die volle Kachel in der Gross-Ansicht: dort
 * liegen auch die Knöpfe, die Geld kosten (KI-Einordnung), damit sie hier
 * nicht aus Versehen gedrückt werden.
 *
 * Fehlt eine Quelle (noch nicht geladen, Fremdquelle gestört), fehlt ihre
 * Zeile — eine Zeile voller Striche wäre Platz ohne Aussage.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from '../../utils/dayjs-setup.js'
import { lageZu } from '../../../shared/handelszeiten.js'
import { liveSymbol } from '../../stores/live.js'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
    /** Kachel-Id → Nutzlast der übrigen Kacheln */
    quellen: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['oeffne'])
const { t } = useI18n()

const q = (id) => props.quellen?.[id] || null

// Uhr für Countdown und Sitzungsphase — Minutenauflösung reicht hier
const jetzt = ref(Date.now())
let uhr = null
const tick = () => { if (!document.hidden) jetzt.value = Date.now() }
onMounted(() => { uhr = setInterval(tick, 15000); document.addEventListener('visibilitychange', tick) })
onBeforeUnmount(() => { clearInterval(uhr); document.removeEventListener('visibilitychange', tick) })

const kurz = (s) => String(s || '').replace(/USDT$/, '')
const vz = (v, stellen = 2) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—'
    : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Number(v)).toFixed(stellen)}`)
const farbe = (v) => (v === null || v === undefined || Number(v) === 0 ? '' : Number(v) > 0 ? 'kpPlus' : 'kpMinus')
const geld = (v) => {
    const a = Math.abs(Number(v) || 0)
    if (a >= 1e6) return `${(a / 1e6).toFixed(2)} M`
    if (a >= 1e3) return `${(a / 1e3).toFixed(1)} k`
    return a.toFixed(0)
}
const rest = (ms) => {
    const m = Math.max(0, Math.round(ms / 60000))
    return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`
}

// ── Sitzung ───────────────────────────────────────────────────────────────
const sitzung = computed(() => {
    const p = q('positionen')
    if (!p) return null
    return {
        hinweis: p.hinweis || '',
        gesamt: Number(p.gesamtUsd) || 0,
        real: Number(p.realisiertUsd) || 0,
        offen: Number(p.unrealisiertUsd) || 0,
        anzahl: (p.offen || []).length,
        trades: Number(p.tradeAnzahl) || 0,
        verlust: p.plan?.verlustAnteil ?? null,
        verletzt: Boolean(p.plan?.verletzt),
    }
})

// ── Zeit und Termine ──────────────────────────────────────────────────────
const zeit = computed(() => {
    const k = q('kalender')
    const alle = k?.ereignisse || null
    const feiertage = alle ? alle.filter(e => String(e.impact || '').toLowerCase() === 'holiday') : null
    const l = lageZu(jetzt.value, { ereignisse: alle, feiertage: feiertage?.length ? feiertage : null })
    const warn = l.warnungen.find(w => w.stufe === 'hoch') || l.warnungen[0] || null
    return { lage: l, warn, naechste: l.naechste[0] || null }
})
const zeitName = (id) => t('livetrading.handelszeiten.' + id)

const termin = computed(() => {
    const k = q('kalender')
    if (!k) return null
    const e = (k.ereignisse || []).find(x => x.dateUnix > jetzt.value
        && String(x.impact || '').toLowerCase() !== 'holiday')
    return { e, stunden: k.stunden || 8 }
})

// ── Markt am gewählten Symbol ─────────────────────────────────────────────
const mechanik = computed(() => {
    const m = q('mechanik')
    if (!m) return null
    return { ...m.faktoren, state: m.state, fenster: m.fenster }
})
const MECH_FARBE = {
    LONG_SQUEEZE_RISK: 'kpMinus', DELEVERAGING: 'kpMinus', SHORT_SQUEEZE_RISK: 'kpPlus',
    LONG_AUFBAU: 'kpBlau', SHORT_AUFBAU: 'kpBlau',
}

const liq = computed(() => {
    const l = q('liqticker')
    if (!l) return null
    const g = l.gesamt || { longUsd: 0, shortUsd: 0, anzahl: 0 }
    const summe = g.longUsd + g.shortUsd
    return { ...g, minuten: l.fensterMinuten || 15, longAnteil: summe ? g.longUsd / summe : null, stumm: !l.aufzeichnungAn }
})

const lsoi = computed(() => q('lsoi')?.jetzt || null)

const funding = computed(() => {
    const f = q('funding')
    if (!f) return null
    const eigen = (f.eigene || []).find(r => r.symbol === liveSymbol.value)
        || (f.alle || []).find(r => r.symbol === liveSymbol.value) || null
    return { eigen, oben: (f.oben || [])[0] || null, unten: (f.unten || [])[0] || null }
})
const pa = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)} %`)

// ── Aussenwelt ────────────────────────────────────────────────────────────
const INDIZES = [['sp500', 'ES'], ['nasdaq', 'NQ'], ['russell', 'RTY'], ['dxy', 'DXY']]
const indizes = computed(() => {
    const m = q('indizes')?.maerkte
    if (!m) return null
    const zeilen = INDIZES.map(([id, name]) => {
        const x = m[id]
        const d = x?.preis && x?.vorherClose ? ((x.preis - x.vorherClose) / x.vorherClose) * 100 : null
        return { id, name, d }
    }).filter(z => z.d !== null)
    return zeilen.length ? zeilen : null
})

// ── Einordnung ────────────────────────────────────────────────────────────
const coins = computed(() => (q('coinradar')?.zeilen || []).slice(0, props.gross ? 10 : 5))

const handelslage = computed(() => {
    const h = q('handelslage')
    if (!h) return null
    return h.leer || !h.ueberschrift ? { leer: true } : { lage: h.lage, text: h.ueberschrift, stand: h.stand }
})
const gesamtlage = computed(() => {
    const g = q('lage')
    return g && !g.leer && g.ueberschrift ? { text: g.ueberschrift, stand: g.stand } : null
})
const alter = (ms) => {
    if (!ms) return ''
    const m = Math.max(0, Math.round((jetzt.value - ms) / 60000))
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`
}

const LAGE_FARBE = { trend_auf: 'kpPlus', trend_ab: 'kpMinus', nachrichtenrisiko: 'kpGelb', quetsche: 'kpGelb' }

/** Coin-Radar: Klick auf den Coin wählt ihn wie in der eigenen Kachel. */
function waehle(symbol) { liveSymbol.value = symbol }
</script>

<template>
    <div class="kpWrap" :class="{ gross }">
        <!-- Sitzung: das eigene Geld zuerst -->
        <div v-if="sitzung" class="kpZeile" @click="emit('oeffne', 'positionen')">
            <span class="kpLabel">{{ t('livetrading.kompakt.sitzung') }}</span>
            <span v-if="sitzung.hinweis && !sitzung.anzahl && !sitzung.trades" class="kpWert kpLeise">{{ sitzung.hinweis }}</span>
            <span v-else class="kpWert">
                <b :class="farbe(sitzung.gesamt)">{{ vz(sitzung.gesamt) }} $</b>
                <span class="kpNeben">{{ t('livetrading.kompakt.real') }} {{ vz(sitzung.real) }}
                    · {{ t('livetrading.kompakt.offen', { n: sitzung.anzahl }) }} {{ vz(sitzung.offen) }}
                    · {{ t('livetrading.kompakt.trades', { n: sitzung.trades }) }}</span>
            </span>
            <span v-if="sitzung.verlust !== null" class="kpBudget" :class="{ kpUeber: sitzung.verletzt || sitzung.verlust >= 1, kpNah: sitzung.verlust >= 0.7 }"
                :title="t('livetrading.kompakt.budget')">
                <span :style="{ width: Math.min(100, sitzung.verlust * 100) + '%' }"></span>
            </span>
        </div>

        <!-- Zeit: Warnung vor allem anderen -->
        <div class="kpZeile" @click="emit('oeffne', 'handelszeiten')">
            <span class="kpLabel">{{ t('livetrading.kompakt.zeit') }}</span>
            <span v-if="zeit.warn" class="kpWert" :class="zeit.warn.stufe === 'hoch' ? 'kpMinus' : 'kpGelb'">
                <i class="uil uil-exclamation-triangle"></i>
                {{ t('livetrading.handelszeiten.warn_' + zeit.warn.id) }}
                <span class="kpNeben">{{ t('livetrading.handelszeiten.bis', { zeit: dayjs(zeit.warn.bisMs).format('HH:mm') }) }}</span>
            </span>
            <span v-else class="kpWert">
                {{ zeit.lage.phase ? zeitName(zeit.lage.phase.id) : t('livetrading.handelszeiten.ruhe') }}
                <span v-if="zeit.naechste" class="kpNeben">→ {{ zeitName(zeit.naechste.id) }} {{ t('livetrading.kompakt.in', { zeit: rest(zeit.naechste.tMs - jetzt) }) }}</span>
            </span>
        </div>

        <div v-if="termin" class="kpZeile" @click="emit('oeffne', 'kalender')">
            <span class="kpLabel">{{ t('livetrading.kompakt.termin') }}</span>
            <span v-if="termin.e" class="kpWert">
                <span :class="['kpImpact', 'impact-' + String(termin.e.impact || '').toLowerCase()]"></span>
                {{ termin.e.land }} {{ termin.e.titel }}
                <span class="kpNeben">{{ t('livetrading.kompakt.in', { zeit: rest(termin.e.dateUnix - jetzt) }) }} · {{ dayjs(termin.e.dateUnix).format('HH:mm') }}</span>
            </span>
            <span v-else class="kpWert kpLeise">{{ t('livetrading.kompakt.keinTermin', { h: termin.stunden }) }}</span>
        </div>

        <div class="kpTrenner"></div>

        <div v-if="mechanik" class="kpZeile" @click="emit('oeffne', 'mechanik')">
            <span class="kpLabel">{{ t('livetrading.kompakt.mechanik') }} <small>{{ mechanik.fenster }}</small></span>
            <span class="kpWert">
                <b :class="MECH_FARBE[mechanik.state] || 'kpLeise'">{{ t('marktradar.mechanik.state_' + mechanik.state) }}</b>
                <span class="kpNeben">{{ t('livetrading.kompakt.preis') }} <span :class="farbe(mechanik.preisDeltaPct)">{{ vz(mechanik.preisDeltaPct) }} %</span>
                    · OI <span :class="farbe(mechanik.oiDeltaPct)">{{ vz(mechanik.oiDeltaPct) }} %</span></span>
            </span>
        </div>

        <div v-if="liq" class="kpZeile" @click="emit('oeffne', 'liqticker')">
            <span class="kpLabel">{{ t('livetrading.kompakt.liq') }} <small>{{ liq.minuten }}m</small></span>
            <span v-if="liq.stumm" class="kpWert kpLeise">{{ t('livetrading.kompakt.liqAus') }}</span>
            <span v-else class="kpWert">
                <span class="kpMinus">L {{ geld(liq.longUsd) }} $</span>
                · <span class="kpPlus">S {{ geld(liq.shortUsd) }} $</span>
                <span class="kpNeben">{{ t('livetrading.kompakt.ereignisse', { n: liq.anzahl }) }}</span>
            </span>
            <span v-if="liq.longAnteil !== null && !liq.stumm" class="kpSplit">
                <span class="kpSplitL" :style="{ width: liq.longAnteil * 100 + '%' }"></span>
            </span>
        </div>

        <div v-if="lsoi" class="kpZeile" @click="emit('oeffne', 'lsoi')">
            <span class="kpLabel">{{ t('livetrading.kompakt.lsoi') }}</span>
            <span class="kpWert">
                <b>{{ lsoi.ratio?.toFixed(2) ?? '—' }}</b>
                <span class="kpNeben">{{ lsoi.longPct }} / {{ lsoi.shortPct }} %
                    · OI 24h <span :class="farbe(lsoi.oiDelta24hPct)">{{ vz(lsoi.oiDelta24hPct) }} %</span></span>
            </span>
            <span class="kpSplit">
                <span class="kpSplitL kpSplitBlau" :style="{ width: (Number(lsoi.longPct) || 50) + '%' }"></span>
            </span>
        </div>

        <div v-if="funding" class="kpZeile" @click="emit('oeffne', 'funding')">
            <span class="kpLabel">{{ t('livetrading.kompakt.funding') }}</span>
            <span class="kpWert">
                <b v-if="funding.eigen" :class="funding.eigen.jahresRate > 0 ? 'kpMinus' : funding.eigen.jahresRate < 0 ? 'kpPlus' : ''">
                    {{ pa(funding.eigen.jahresRate) }} <small>p.a.</small>
                </b>
                <span class="kpNeben">
                    <template v-if="funding.oben">{{ kurz(funding.oben.symbol) }} <span class="kpMinus">{{ pa(funding.oben.jahresRate) }}</span></template>
                    <template v-if="funding.unten"> · {{ kurz(funding.unten.symbol) }} <span class="kpPlus">{{ pa(funding.unten.jahresRate) }}</span></template>
                </span>
            </span>
        </div>

        <div v-if="indizes" class="kpZeile" @click="emit('oeffne', 'indizes')">
            <span class="kpLabel">{{ t('livetrading.kompakt.indizes') }}</span>
            <span class="kpWert">
                <span v-for="z in indizes" :key="z.id" class="kpIndex">
                    {{ z.name }} <span :class="z.id === 'dxy' ? (z.d > 0 ? 'kpMinus' : 'kpPlus') : farbe(z.d)">{{ vz(z.d) }}</span>
                </span>
            </span>
        </div>

        <div class="kpTrenner"></div>

        <div v-if="coins.length" class="kpZeile kpOhneHover">
            <span class="kpLabel kpKlick" @click="emit('oeffne', 'coinradar')">{{ t('livetrading.kompakt.coinradar') }}</span>
            <span class="kpWert kpCoins">
                <button v-for="z in coins" :key="z.symbol" type="button" class="kpCoin"
                    :class="{ aktiv: z.symbol === liveSymbol }" :title="t('livetrading.coinradar.waehlen', { s: kurz(z.symbol) })"
                    @click.stop="waehle(z.symbol)">
                    {{ kurz(z.symbol) }} <small v-if="Number.isFinite(Number(z.note))">{{ Math.round(z.note) }}</small>
                </button>
            </span>
        </div>

        <div v-if="handelslage" class="kpZeile kpText" @click="emit('oeffne', 'handelslage')">
            <span class="kpLabel">{{ t('livetrading.kompakt.handelslage') }}</span>
            <span v-if="handelslage.leer" class="kpWert kpLeise">{{ t('livetrading.kompakt.einordnen') }} →</span>
            <span v-else class="kpWert">
                <b :class="LAGE_FARBE[handelslage.lage] || ''">{{ t('livetrading.handelslage.lage_' + (handelslage.lage || 'unklar')) }}</b>
                <span class="kpSatz">{{ handelslage.text }}</span>
                <span class="kpNeben">{{ alter(handelslage.stand) }}</span>
            </span>
        </div>

        <div v-if="gesamtlage" class="kpZeile kpText" @click="emit('oeffne', 'lage')">
            <span class="kpLabel">{{ t('livetrading.kompakt.gesamtlage') }}</span>
            <span class="kpWert">
                <span class="kpSatz">{{ gesamtlage.text }}</span>
                <span class="kpNeben">{{ alter(gesamtlage.stand) }}</span>
            </span>
        </div>
    </div>
</template>

<style scoped>
.kpWrap {
    display: flex;
    flex-direction: column;
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
    min-height: 0;
    overflow-y: auto;
}

.kpWrap.gross { font-size: 0.92rem; }

.kpZeile {
    position: relative;
    display: grid;
    grid-template-columns: 6.4rem minmax(0, 1fr);
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.2rem 0.3rem;
    border-radius: 4px;
    cursor: pointer;
}

.kpZeile:hover { background: rgba(255, 255, 255, 0.04); }
.kpOhneHover { cursor: default; }
.kpOhneHover:hover { background: none; }
.kpKlick { cursor: pointer; }
.kpKlick:hover { color: var(--white-87); }

.kpLabel {
    color: var(--white-60);
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: nowrap;
}

.kpLabel small { text-transform: none; letter-spacing: 0; color: var(--white-38, rgba(255, 255, 255, 0.38)); }

.kpWert {
    color: var(--white-87);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.kpWert b { font-weight: 600; }
.kpNeben { margin-left: 0.45rem; color: var(--white-60); }
.kpLeise { color: var(--white-60); }

.kpPlus { color: rgb(38, 190, 150); }
.kpMinus { color: rgb(255, 95, 86); }
.kpBlau { color: rgb(90, 156, 255); }
.kpGelb { color: #ffc93c; }

.kpTrenner {
    height: 1px;
    margin: 0.2rem 0.3rem;
    background: rgba(255, 255, 255, 0.07);
}

/* Zwei dünne Mess-Striche unter der Zeile: Budget und Seitenverteilung */
.kpBudget, .kpSplit {
    position: absolute;
    left: calc(6.4rem + 0.8rem);
    right: 0.3rem;
    bottom: 0;
    height: 2px;
    border-radius: 1px;
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
}

.kpBudget > span { display: block; height: 100%; background: rgba(255, 255, 255, 0.45); }
.kpBudget.kpNah > span { background: #ffc93c; }
.kpBudget.kpUeber > span { background: rgb(255, 95, 86); }
.kpSplit { background: rgba(38, 190, 150, 0.6); }
.kpSplitL { display: block; height: 100%; background: rgba(255, 95, 86, 0.75); }
.kpSplit:has(.kpSplitBlau) { background: rgba(255, 255, 255, 0.15); }
.kpSplitL.kpSplitBlau { background: rgba(1, 180, 255, 0.7); }

.kpIndex + .kpIndex { margin-left: 0.6rem; }

.kpImpact {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    margin-right: 0.2rem;
    vertical-align: middle;
    background: rgba(255, 255, 255, 0.35);
}

.kpImpact.impact-high { background: #ff6b7a; }
.kpImpact.impact-medium { background: #ffc93c; }

.kpCoins { display: flex; flex-wrap: wrap; gap: 0.25rem; white-space: normal; }

.kpCoin {
    border: none;
    background: rgba(255, 255, 255, 0.05);
    color: var(--white-87);
    border-radius: 3px;
    padding: 0 0.35rem;
    font-size: 0.74rem;
    line-height: 1.5;
}

.kpCoin small { color: var(--white-60); }
.kpCoin:hover { background: rgba(255, 255, 255, 0.1); }
.kpCoin.aktiv { background: rgba(90, 156, 255, 0.25); }

/* Textzeilen der KI: dürfen zwei Zeilen haben, nicht mehr */
.kpText .kpWert { white-space: normal; }
.kpSatz {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: var(--white-87);
}

.kpText .kpWert b { margin-right: 0.4rem; }
.kpText .kpNeben { margin-left: 0; font-size: 0.7rem; }
.gross .kpSatz { -webkit-line-clamp: 4; }
</style>
