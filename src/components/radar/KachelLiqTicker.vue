<script setup>
/**
 * Kachel „Liquidationen (live)".
 *
 * Die letzten Minuten, nicht die letzten 24 Stunden — dafür gibt es die
 * Balkenkachel im Marktradar. Hier zählt, ob GERADE jemand aus einer Position
 * geworfen wird: ein Schub auf einer Seite ist Brennstoff für die Gegenseite.
 *
 * ## Drei Ehrlichkeiten, die in die Kachel gehören
 *
 * 1. **Binance ist eine Stichprobe.** Der Datenstrom liefert höchstens ein
 *    Ereignis pro Sekunde und Symbol. Verhältnisse und Ausschläge stimmen,
 *    absolute Summen sind zu niedrig. Bybit drosselt nicht — deshalb stehen die
 *    Börsen getrennt, statt zu einer Summe verrührt zu werden, die keiner der
 *    beiden entspricht.
 * 2. **Ohne Aufzeichnung kommt nichts.** Der Sammelstrom hängt an einem
 *    Schalter in den Einstellungen. Ist er aus, sieht ein leerer Ticker aus wie
 *    ein ruhiger Markt — das wäre die gefährlichste Falschaussage der ganzen
 *    Seite.
 * 3. **Nur fünf Symbole.** Alles andere liefert der Sammelstrom nicht.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from '../../utils/dayjs-setup.js'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
    params: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['params'])

const { t } = useI18n()

const MINUTEN = [5, 15, 30]

const gesamt = computed(() => props.daten?.gesamt || { longUsd: 0, shortUsd: 0, anzahl: 0 })
const jeMinute = computed(() => props.daten?.jeMinute || [])
const letzte = computed(() => (props.daten?.letzte || []).slice(0, props.gross ? 30 : 6))

/** Höchster Minutenbalken — Bezug für die Balkenhöhe. */
const spitze = computed(() => Math.max(1,
    ...jeMinute.value.map(m => m.longUsd + m.shortUsd)))

/** Läuft die Aufzeichnung überhaupt? Sonst ist ein leerer Ticker bedeutungslos. */
const stumm = computed(() => props.daten
    && !props.daten.aufzeichnungAn)
const ohneSammelstrom = computed(() => props.daten
    && props.daten.aufzeichnungAn && !props.daten.sammelstromAn)

/** Übergewicht einer Seite in Prozent — das eigentliche Signal. */
const uebergewicht = computed(() => {
    const l = gesamt.value.longUsd
    const s = gesamt.value.shortUsd
    const summe = l + s
    if (summe <= 0) return null
    return { seite: l >= s ? 'long' : 'short', anteil: Math.max(l, s) / summe }
})

function geld(v) {
    if (!v) return '0'
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)} M`
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)} k`
    return v.toFixed(0)
}
</script>

<template>
    <div v-if="daten" class="ltWrap" :class="{ gross }">
        <div class="ltKopf">
            <button v-for="m in MINUTEN" :key="m" type="button"
                :class="['ctl-pill', Number(daten.fensterMinuten) === m ? 'active' : '']"
                @click.stop="emit('params', { minuten: m })">{{ m }} min</button>
            <span class="ltLuecke"></span>
            <span class="ltAnzahl">{{ t('livetrading.liq.anzahl', { n: gesamt.anzahl }) }}</span>
        </div>

        <!-- Aufzeichnung aus: das MUSS dastehen, sonst liest man Stille als Ruhe -->
        <div v-if="stumm" class="ltWarn">
            <i class="uil uil-exclamation-triangle"></i>
            {{ t('livetrading.liq.aufzeichnungAus') }}
        </div>
        <div v-else-if="ohneSammelstrom" class="ltHinweis">
            {{ t('livetrading.liq.keinSammelstrom') }}
        </div>

        <div class="ltSummen">
            <div class="ltSumme">
                <span class="ltSeiteLabel redTrade">{{ t('livetrading.liq.longs') }}</span>
                <b class="redTrade">{{ geld(gesamt.longUsd) }} $</b>
            </div>
            <div class="ltSumme">
                <span class="ltSeiteLabel greenTrade">{{ t('livetrading.liq.shorts') }}</span>
                <b class="greenTrade">{{ geld(gesamt.shortUsd) }} $</b>
            </div>
        </div>

        <div v-if="uebergewicht" class="ltUebergewicht"
            :class="uebergewicht.seite === 'long' ? 'redTrade' : 'greenTrade'">
            {{ t('livetrading.liq.uebergewicht_' + uebergewicht.seite,
                 { pct: Math.round(uebergewicht.anteil * 100) }) }}
        </div>

        <!-- Balken je Minute: Longs nach unten (rot), Shorts nach oben (grün) -->
        <div v-if="jeMinute.length" class="ltBalken">
            <div v-for="m in jeMinute" :key="m.t" class="ltSpalte"
                :title="dayjs(m.t).format('HH:mm') + ' · ' + m.anzahl">
                <span class="ltBalkenShort"
                    :style="{ height: (m.shortUsd / spitze * 100) + '%' }"></span>
                <span class="ltBalkenLong"
                    :style="{ height: (m.longUsd / spitze * 100) + '%' }"></span>
            </div>
        </div>

        <!-- Das Band: neueste zuerst -->
        <div v-if="letzte.length" class="ltBand">
            <div v-for="(e, i) in letzte" :key="e.t + '_' + i" class="ltZeile">
                <span class="ltZeit">{{ dayjs(e.t).format('HH:mm:ss') }}</span>
                <span class="ltSym">{{ e.symbol.replace(/USDT$/, '') }}</span>
                <span :class="['ltBetrag', e.seite === 1 ? 'greenTrade' : 'redTrade']">
                    {{ geld(e.usd) }} $
                </span>
                <span class="ltSeite">
                    {{ e.seite === 1 ? t('livetrading.liq.shortWeg') : t('livetrading.liq.longWeg') }}
                </span>
                <span class="ltBoerse">{{ e.boerse === 'bybit' ? 'Bybit' : 'Binance' }}</span>
            </div>
        </div>
        <div v-else-if="!stumm" class="ltLeer">{{ t('livetrading.liq.ruhig') }}</div>

        <div v-if="gross" class="ltFuss">
            {{ t('livetrading.liq.quellenHinweis') }}
            <span v-if="!daten.quellen?.bybit">· {{ t('livetrading.liq.bybitStill') }}</span>
        </div>
    </div>
</template>

<style scoped>
.ltWrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    gap: 0.28rem;
}

.ltKopf {
    display: flex;
    align-items: center;
    gap: 0.3rem;
}

.ltLuecke { flex: 1; }

.ltAnzahl {
    font-size: 0.72rem;
    color: var(--white-60);
}

.ltWarn {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.76rem;
    font-weight: 600;
    color: #ff6b7a;
    background: rgba(220, 53, 69, 0.14);
    border-radius: var(--border-radius);
    padding: 0.22rem 0.4rem;
}

.ltHinweis {
    font-size: 0.72rem;
    color: #ffc93c;
}

.ltSummen {
    display: flex;
    gap: 0.8rem;
}

.ltSumme {
    display: flex;
    flex-direction: column;
    line-height: 1.15;
}

.ltSeiteLabel {
    font-size: 0.68rem;
    opacity: 0.8;
}

.ltSumme b {
    font-size: 0.98rem;
    font-variant-numeric: tabular-nums;
}

.ltUebergewicht {
    font-size: 0.76rem;
    font-weight: 600;
}

.ltBalken {
    display: flex;
    align-items: center;
    gap: 1px;
    height: 34px;
    flex: 0 0 auto;
}

.ltSpalte {
    flex: 1;
    min-width: 2px;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
}

.ltBalkenShort {
    background: #4ec9a0;
    align-self: stretch;
    min-height: 0;
}

.ltBalkenLong {
    background: #ff6b7a;
    align-self: stretch;
    min-height: 0;
}

.ltBand {
    display: flex;
    flex-direction: column;
    gap: 0.06rem;
    overflow-y: auto;
    min-height: 0;
}

.ltZeile {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    font-size: 0.74rem;
    font-variant-numeric: tabular-nums;
}

.ltZeit { color: var(--white-60); }
.ltSym { font-weight: 700; min-width: 2.6rem; }
.ltBetrag { font-weight: 600; min-width: 4rem; }

.ltSeite {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--white-60);
}

.ltBoerse {
    font-size: 0.66rem;
    color: var(--white-60);
    opacity: 0.7;
}

.ltLeer {
    margin: auto 0;
    text-align: center;
    font-size: 0.8rem;
    color: var(--white-60);
}

.ltFuss {
    margin-top: auto;
    font-size: 0.68rem;
    color: var(--white-60);
}
</style>
