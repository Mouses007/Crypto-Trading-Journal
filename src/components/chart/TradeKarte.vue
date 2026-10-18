<script setup>
/**
 * Karte zu einem Journal-Trade, geöffnet per Klick auf seinen Marker im Chart:
 * Ergebnis, R, Dauer, Stop/Ziel, Notizen, Playbook, Tags — und der Sprung in
 * die Tagesansicht des Journals, wo Screenshots und Bewertung liegen.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import dayjs from '../../utils/dayjs-setup.js'
import { timeZoneTrade, scrollToDateUnix } from '../../stores/ui.js'
import { selectedMonth, selectedMonthPreset } from '../../stores/filters.js'
import { dauerText } from '../../utils/chart/zeichnungen/geometrie.js'

const props = defineProps({
    trade: { type: Object, required: true },
    formatPreis: { type: Function, required: true },
})
const emit = defineEmits(['schliesse'])
const { t } = useI18n()
const router = useRouter()

const tr = computed(() => props.trade)
const dauer = computed(() => (tr.value.ausstieg ? dauerText(tr.value.ausstieg.t - tr.value.einstieg.t) : null))
const zeit = (ms) => dayjs(ms).format('DD.MM.YY HH:mm')
const geld = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)} USDT`)

/*
 * Die Tagesansicht zeigt nur den gewählten Monat (Monatsfilter) — ohne ihn
 * umzustellen, landete der Sprung auf „Keine Daten". Danach scrollt sie über
 * `scrollToDateUnix` zum Tag, wie beim Klick im Kalender.
 */
function zumJournal() {
    const tz = timeZoneTrade.value || 'UTC'
    const tag = tr.value.tag || dayjs(tr.value.ausstieg?.t || tr.value.einstieg.t).tz(tz).startOf('day').unix()
    const start = dayjs.unix(tag).tz(tz).startOf('month').unix()
    const ende = dayjs.unix(tag).tz(tz).endOf('month').unix()
    selectedMonth.value = { start, end: ende }
    selectedMonthPreset.value = 'custom'
    try {
        localStorage.setItem('selectedMonth', JSON.stringify(selectedMonth.value))
        localStorage.setItem('selectedMonthPreset', 'custom')
    } catch { /* ohne Speicher geht der Sprung trotzdem */ }
    scrollToDateUnix.value = tag
    router.push('/daily')
}
</script>

<template>
    <div class="tradeKarte" @mousedown.stop @pointerdown.stop>
        <div class="kopf">
            <span class="richtung" :class="tr.richtung">{{ tr.richtung === 'long' ? 'Long' : 'Short' }}</span>
            <span class="broker">{{ tr.broker }}</span>
            <button class="zu" @click="emit('schliesse')"><i class="uil uil-times"></i></button>
        </div>
        <div class="ergebnis" :class="(tr.netto ?? 0) >= 0 ? 'greenTrade' : 'redTrade'">
            {{ geld(tr.netto) }}
            <span v-if="tr.r != null" class="r">{{ tr.r >= 0 ? '+' : '' }}{{ tr.r.toFixed(2) }} R</span>
        </div>
        <table><tbody>
            <tr><td>{{ t('chart.trade.einstieg') }}</td><td>{{ formatPreis(tr.einstieg.p) }}</td><td>{{ zeit(tr.einstieg.t) }}</td></tr>
            <tr v-if="tr.ausstieg"><td>{{ t('chart.trade.ausstieg') }}</td><td>{{ formatPreis(tr.ausstieg.p) }}</td><td>{{ zeit(tr.ausstieg.t) }}</td></tr>
            <tr v-if="tr.anfangsStop"><td>{{ t('chart.trade.stop') }}</td><td>{{ formatPreis(tr.anfangsStop) }}</td><td></td></tr>
            <tr v-if="tr.tp"><td>{{ t('chart.trade.ziel') }}</td><td>{{ formatPreis(tr.tp) }}</td><td></td></tr>
            <tr v-if="dauer"><td>{{ t('chart.trade.dauer') }}</td><td colspan="2">{{ dauer }}</td></tr>
            <tr v-if="tr.gebuehren || tr.funding"><td>{{ t('chart.trade.kosten') }}</td>
                <td colspan="2">{{ (tr.gebuehren || 0).toFixed(2) }} + {{ (tr.funding || 0).toFixed(2) }} Funding</td></tr>
        </tbody></table>
        <div v-if="tr.r == null && tr.ausstieg" class="hinweis">{{ t('chart.trade.keinR') }}</div>
        <template v-if="tr.notiz">
            <div v-if="tr.notiz.playbook" class="feld"><b>Playbook</b> {{ tr.notiz.playbook }}</div>
            <div v-if="tr.notiz.einstieg" class="feld"><b>{{ t('chart.trade.notizEinstieg') }}</b> {{ tr.notiz.einstieg }}</div>
            <div v-if="tr.notiz.ausstieg" class="feld"><b>{{ t('chart.trade.notizAusstieg') }}</b> {{ tr.notiz.ausstieg }}</div>
            <div v-if="tr.notiz.regelTreu != null && tr.notiz.regelTreu >= 0" class="feld">
                <b>{{ t('chart.trade.regelTreu') }}</b> {{ tr.notiz.regelTreu === 1 ? t('chart.trade.ja') : t('chart.trade.nein') }}</div>
        </template>
        <div v-if="tr.tags?.length" class="tags"><span v-for="g in tr.tags" :key="g" class="tag">{{ g }}</span></div>
        <button class="btn btn-sm btn-outline-secondary w-100 mt-2" @click="zumJournal">
            <i class="uil uil-book-alt"></i> {{ t('chart.trade.zumJournal') }}</button>
    </div>
</template>

<style scoped>
.tradeKarte {
    position: absolute;
    top: 34px;
    right: 70px;
    z-index: 7;
    width: 280px;
    max-width: calc(100% - 80px);
    max-height: calc(100% - 50px);
    overflow-y: auto;
    background: var(--black-bg-5, #1e222d);
    border: 1px solid var(--white-18);
    border-radius: 8px;
    padding: 10px;
    box-shadow: var(--shadow-sm);
    font-size: 12px;
}

.kopf {
    display: flex;
    align-items: center;
    gap: 8px;
}

.richtung {
    font-weight: 600;
    padding: 0 6px;
    border-radius: 3px;
}

.richtung.long {
    background: rgba(38, 166, 154, 0.2);
    color: var(--green);
}

.richtung.short {
    background: rgba(255, 105, 96, 0.2);
    color: var(--red-color);
}

.broker {
    color: var(--grey-text);
    flex: 1;
}

.zu {
    background: transparent;
    border: none;
    color: var(--grey-text);
}

.ergebnis {
    font-size: 16px;
    font-weight: 600;
    margin: 6px 0;
}

.ergebnis .r {
    font-size: 13px;
    margin-left: 8px;
}

table {
    width: 100%;
}

td {
    padding: 1px 4px 1px 0;
    color: var(--white-87, #ddd);
}

td:first-child {
    color: var(--grey-text);
}

.hinweis {
    color: var(--grey-text);
    font-size: 11px;
    margin-top: 4px;
}

.feld {
    margin-top: 6px;
    white-space: pre-wrap;
}

.feld b {
    color: var(--grey-text);
    font-weight: 500;
    display: block;
}

.tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
}

.tag {
    background: var(--white-10);
    border-radius: 3px;
    padding: 0 5px;
    font-size: 11px;
}
</style>
