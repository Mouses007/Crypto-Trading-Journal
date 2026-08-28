<script setup>
/**
 * Laufband der Liquidationen — die Fusszeile des Pults.
 *
 * ## Warum es NICHT läuft
 *
 * Der erste Entwurf war ein echtes Laufband im Sinne der Börsenticker: Text,
 * der von rechts nach links wandert. Zwei Gründe dagegen, und beide wiegen
 * schwerer als das Bild. Erstens tauscht der Abruf alle fünf Sekunden den
 * Inhalt aus, und eine laufende Animation setzt dabei zurück — man liest einen
 * halben Eintrag und er springt weg. Zweitens muss man bei einem laufenden Band
 * *warten*, bis die interessante Zeile vorbeikommt; hier soll ein Blick nach
 * unten genügen.
 *
 * Also steht es still: die jüngsten Ereignisse links, die Summen ganz links
 * daneben, dazwischen die Minutenbalken. Das einzig Bewegte bleibt der Inhalt
 * selbst — und Bewegung ist damit ein Signal statt Dekoration.
 *
 * Seitenkonvention wie überall im Projekt: `seite === 1` heisst SHORT
 * liquidiert (Kaufdruck, grün), 0 heisst LONG liquidiert (Verkaufsdruck, rot).
 * Nicht drehen — siehe `server/liq-ticker.js`.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from '../../../utils/dayjs-setup.js'

const props = defineProps({
    daten: { type: Object, default: null },
    /** Wie viele Einzelereignisse nebeneinander passen. */
    anzahl: { type: Number, default: 7 },
})

const { t } = useI18n()

const gesamt = computed(() => props.daten?.gesamt || { longUsd: 0, shortUsd: 0, anzahl: 0 })
const jeMinute = computed(() => props.daten?.jeMinute || [])
const letzte = computed(() => (props.daten?.letzte || []).slice(0, props.anzahl))

/** Höchster Minutenwert als Bezug — sonst hat die Säulenhöhe kein Mass. */
const spitze = computed(() => Math.max(1,
    ...jeMinute.value.map(m => (m.longUsd || 0) + (m.shortUsd || 0))))

const geld = (v) => {
    const n = Math.abs(Number(v) || 0)
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)} M`
    if (n >= 1e3) return `${Math.round(n / 1e3)} K`
    return String(Math.round(n))
}

const zeit = (ms) => dayjs(ms).format('HH:mm:ss')
const kurz = (s) => String(s || '').replace(/USDT$/, '')
</script>

<template>
    <div class="tTape">
        <div class="tKopf">{{ t('livetrading.pult.liq') }}</div>

        <!-- Summen des Fensters: die eigentliche Aussage -->
        <div class="tSummen">
            <span class="tSumme">
                <span class="tSummeLabel">{{ t('livetrading.liq.longWeg') }}</span>
                <b class="schlecht">{{ geld(gesamt.longUsd) }}</b>
            </span>
            <span class="tSumme">
                <span class="tSummeLabel">{{ t('livetrading.liq.shortWeg') }}</span>
                <b class="gut">{{ geld(gesamt.shortUsd) }}</b>
            </span>
        </div>

        <!-- Minutenbalken: wo im Fenster der Schub lag -->
        <div v-if="jeMinute.length" class="tBalken">
            <span v-for="m in jeMinute" :key="m.t" class="tSpalte"
                :title="`${zeit(m.t)} · ${geld(m.longUsd + m.shortUsd)} $`">
                <span class="tAnteil tShort" :style="{ height: (m.shortUsd / spitze * 100) + '%' }"></span>
                <span class="tAnteil tLong" :style="{ height: (m.longUsd / spitze * 100) + '%' }"></span>
            </span>
        </div>

        <!-- Die jüngsten Einzelereignisse, neuestes links -->
        <div class="tListe">
            <span v-for="(e, i) in letzte" :key="e.t + '_' + i" class="tEintrag">
                <span class="tZeit">{{ zeit(e.t) }}</span>
                <span class="tSym">{{ kurz(e.symbol) }}</span>
                <span :class="e.seite === 1 ? 'gut' : 'schlecht'">{{ geld(e.usd) }}</span>
            </span>
            <span v-if="!letzte.length" class="tLeer">{{ t('livetrading.pult.keineLiq') }}</span>
        </div>
    </div>
</template>

<style scoped>
.tTape {
    display: flex;
    align-items: stretch;
    height: 34px;
    border-top: 1px solid var(--pTrenn);
    overflow: hidden;
}

.tKopf {
    flex: none;
    display: flex;
    align-items: center;
    padding: 0 0.7rem;
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--white-38);
    border-right: 1px solid var(--pTrenn);
}

.tSummen {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0 0.7rem;
    border-right: 1px solid var(--pTrenn);
}

.tSumme { display: flex; align-items: baseline; gap: 0.3rem; font-size: 0.72rem; }
.tSummeLabel { font-size: 0.6rem; color: var(--white-38); }
.tSumme b { font-variant-numeric: tabular-nums; }

/* Säulen von der Mitte weg wäre hübscher und schlechter: gestapelt liest man
   die Gesamtwucht der Minute, und genau die ist die Frage. */
.tBalken {
    flex: none;
    display: flex;
    align-items: flex-end;
    gap: 1px;
    padding: 0 0.7rem;
    height: 100%;
    border-right: 1px solid var(--pTrenn);
}

.tSpalte {
    display: flex;
    flex-direction: column-reverse;
    justify-content: flex-start;
    width: 3px;
    height: 68%;
    align-self: center;
}

.tAnteil { width: 100%; display: block; }
.tShort { background: #26be96; }
.tLong { background: #ff5f56; }

.tListe {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: 0.9rem;
    padding: 0 0.7rem;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
}

.tEintrag {
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
}

.tZeit { color: var(--white-38); }
.tSym { color: var(--white-60); }
.tLeer { font-size: 0.72rem; color: var(--white-38); }

.gut { color: #26be96; }
.schlecht { color: #ff5f56; }
</style>
