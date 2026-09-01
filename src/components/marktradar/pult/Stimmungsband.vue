<script setup>
/**
 * Stimmungsband — die oberste Zeile des Marktradar-Pults.
 *
 * ## Warum aus vier Kacheln eine Zeile wird
 *
 * Fear & Greed, Altcoin-Saison, BTC-Dominanz und die ETF-Flüsse haben im Raster
 * je einen eigenen Kasten, obwohl ihr ganzer Inhalt eine Zahl auf einer festen
 * Skala ist. Vier Kästen für vier Zahlen ist Verpackung, kein Instrument — und
 * schlimmer: nebeneinander gelesen sagt keiner davon, ob sein Wert gerade
 * gewöhnlich oder auffällig ist.
 *
 * Auf einer Achse steht genau das da. Fear & Greed und Altcoin-Saison laufen
 * beide von 0 bis 100 mit benannten Enden, also bekommen sie eine Skala mit
 * Nadel und beschrifteten Rändern. Die Randbereiche sind eingefärbt, die Mitte
 * nicht: „extrem" ist die Aussage, „mittel" ist keine.
 *
 * ## Was hier NICHT steht
 *
 * Der Vergleich mit der eigenen Vergangenheit („so tief war es zuletzt im
 * März"). Das wäre die stärkere Aussage, aber sie braucht je Messgrösse einen
 * belastbaren Bezugszeitraum — für Fear & Greed liegt der vor (`historie`), für
 * die ETF-Flüsse nicht. Eine Skala, die bei der Hälfte der Werte raten müsste,
 * ist schlechter als eine, die ehrlich nur den Stand zeigt.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
    fng: { type: Object, default: null },
    altseason: { type: Object, default: null },
    dom: { type: Object, default: null },
    etf: { type: Object, default: null },
})

const { t } = useI18n()

/*
 * Dieselben fünf Zonen und dieselben Farben wie `KachelFearGreed.vue`.
 *
 * Der erste Entwurf färbte hier BEIDE Enden rot, nach dem Gedanken „extrem ist
 * die Aussage". Das widerspricht der Kachel — sie färbt Angst rot und Gier
 * grün — und derselbe Wert darf nicht an zwei Stellen verschieden aussehen.
 * Wessen Deutung die richtige ist, ist eine andere Frage; sie wird an EINER
 * Stelle beantwortet, und das ist die Kachel.
 */
const FNG_ZONEN = [
    { bis: 24, farbe: '#d13b3b' },
    { bis: 44, farbe: '#e07a3b' },
    { bis: 55, farbe: '#c9b53b' },
    { bis: 75, farbe: '#7cb342' },
    { bis: 100, farbe: '#26be96' },
]

/*
 * Altcoin-Saison: die drei Farben aus `KachelAltseason.vue`, mit ihren
 * Schwellen. Sie bewerten nicht (weder Seite ist gut oder schlecht), sie
 * benennen — Bitcoin-Orange links, Altcoin-Blau rechts, Grau für dazwischen.
 *
 * Vorher stand hier eine graue Achse mit zwei Strichen, nach dem Gedanken „eine
 * Richtung ist keine Wertung". Das war richtig gedacht und im Ergebnis falsch:
 * neben der farbigen Fear-&-Greed-Skala sah das leer aus, als fehlten Daten.
 * Eine Farbe darf identifizieren, ohne zu urteilen.
 */
const ALT_STREIFEN = [
    { von: 0, breite: 25, farbe: '#f7931a' },
    { von: 25, breite: 50, farbe: '#9aa0aa' },
    { von: 75, breite: 25, farbe: '#01B4FF' },
]

/** Zonen als Breitenanteile für die Skala. */
const FNG_STREIFEN = FNG_ZONEN.map((z, i) => ({
    farbe: z.farbe,
    von: i === 0 ? 0 : FNG_ZONEN[i - 1].bis,
    breite: z.bis - (i === 0 ? 0 : FNG_ZONEN[i - 1].bis),
}))

const fngWert = computed(() => {
    const v = Number(props.fng?.aktuell?.wert)
    return Number.isFinite(v) ? v : null
})

/** Veränderung zum Vortag — die Richtung sagt mehr als der Stand allein. */
const fngDelta = computed(() => {
    const a = Number(props.fng?.aktuell?.wert)
    const g = Number(props.fng?.gestern?.wert)
    return Number.isFinite(a) && Number.isFinite(g) ? a - g : null
})

const altWert = computed(() => {
    const v = Number(props.altseason?.index)
    return Number.isFinite(v) ? v : null
})

const domPct = computed(() => {
    const v = Number(props.dom?.jetzt?.pct)
    return Number.isFinite(v) ? v : null
})

const domDelta = computed(() => {
    const v = Number(props.dom?.delta7)
    return Number.isFinite(v) ? v : null
})

/** Nettofluss des jüngsten erfassten Tages, in Millionen Dollar. */
const etfTag = computed(() => {
    const v = Number(props.etf?.gesamt?.fluss1)
    return Number.isFinite(v) ? v : null
})

const geldMio = (v) => {
    if (v === null) return '—'
    const n = v / 1e6
    const vz = n >= 0 ? '+' : '−'
    return Math.abs(n) >= 1000
        ? `${vz}${(Math.abs(n) / 1000).toFixed(2)} Mrd`
        : `${vz}${Math.abs(n).toFixed(0)} Mio`
}

const vzProz = (v, n = 2) => v === null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(n)} %`
</script>

<template>
    <div class="sBand">
        <!-- Fear & Greed: die Skala mit den bekanntesten Enden -->
        <div class="sFeld">
            <div class="sKopf">
                <span>{{ t('marktradar.fng.title') }}</span>
                <span class="sZahl">
                    {{ fngWert ?? '—' }}
                    <em v-if="fngDelta !== null" :class="fngDelta >= 0 ? 'gut' : 'schlecht'">
                        {{ fngDelta >= 0 ? '+' : '−' }}{{ Math.abs(fngDelta) }}
                    </em>
                </span>
            </div>
            <div class="sSkala">
                <span v-for="z in FNG_STREIFEN" :key="z.von" class="sStreifen"
                    :style="{ left: z.von + '%', width: z.breite + '%', background: z.farbe }"></span>
                <span v-if="fngWert !== null" class="sNadel" :style="{ left: fngWert + '%' }"></span>
            </div>
            <div class="sEnden">
                <span>{{ t('marktradar.fng.class_extremeFear') }}</span>
                <b>{{ fng?.aktuell?.klasse ? t('marktradar.fng.class_' + fng.aktuell.klasse) : '' }}</b>
                <span>{{ t('marktradar.fng.class_extremeGreed') }}</span>
            </div>
        </div>

        <!-- Altcoin-Saison: dieselbe Bauform, andere Enden -->
        <div class="sFeld">
            <div class="sKopf">
                <span>{{ t('marktradar.altseason.title') }}</span>
                <span class="sZahl">{{ altWert ?? '—' }}</span>
            </div>
            <div class="sSkala">
                <span v-for="z in ALT_STREIFEN" :key="z.von" class="sStreifen"
                    :style="{ left: z.von + '%', width: z.breite + '%', background: z.farbe }"></span>
                <span v-if="altWert !== null" class="sNadel" :style="{ left: altWert + '%' }"></span>
            </div>
            <div class="sEnden">
                <span>{{ t('marktradar.pult.bitcoinSaison') }}</span>
                <b>{{ altseason?.lage ? t('marktradar.altseason.state_' + altseason.lage) : '' }}</b>
                <span>{{ t('marktradar.pult.altSaison') }}</span>
            </div>
        </div>

        <!-- Dominanz und ETF: Zahlen ohne feste Skala, also ohne Skala -->
        <div class="sFeld sSchmal">
            <div class="sKopf"><span>{{ t('marktradar.dom.title') }}</span></div>
            <div class="sGross">{{ domPct === null ? '—' : domPct.toFixed(1) + ' %' }}</div>
            <div class="sFuss">
                <span class="sLabel">{{ t('marktradar.pult.sieben') }}</span>
                <b :class="domDelta === null ? '' : domDelta >= 0 ? 'gut' : 'schlecht'">{{ vzProz(domDelta) }}</b>
            </div>
        </div>

        <div class="sFeld sSchmal">
            <div class="sKopf"><span>{{ t('marktradar.etf.title') }}</span></div>
            <div class="sGross" :class="etfTag === null ? '' : etfTag >= 0 ? 'gut' : 'schlecht'">
                {{ geldMio(etfTag) }}
            </div>
            <div class="sFuss">
                <span class="sLabel">{{ t('marktradar.pult.letzterTag') }}</span>
            </div>
        </div>
    </div>
</template>

<style scoped>
.sBand {
    display: grid;
    /* Die beiden Skalen bekommen den Platz, die beiden Zahlen sind schmal. */
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 170px 170px;
    border-bottom: 1px solid var(--pTrenn);
    background: var(--pChrom);
}

.sFeld {
    padding: 0.32rem 0.6rem 0.4rem;
    min-width: 0;
}

.sFeld + .sFeld { border-left: 1px solid var(--pTrenn); }

.sKopf {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    /* Dieselbe Titel-Farbe wie im Rest des Pults — siehe `--pTitel` in PultRahmen.vue */
    color: var(--pTitel);
}

.sZahl {
    font-size: 1.05rem;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0;
    color: var(--white-87);
}

.sZahl em {
    font-style: normal;
    font-size: 0.72rem;
    margin-left: 0.3rem;
}

/*
 * Die Skala. Eingefärbt sind nur die äusseren Fünftel — dort steht die
 * Aussage. Ein durchgehender Farbverlauf sähe reicher aus und würde behaupten,
 * dass 48 und 52 verschiedene Zustände sind.
 */
.sSkala {
    position: relative;
    height: 8px;
    margin-top: 0.4rem;
    background: rgba(255, 255, 255, 0.07);
}

/* Gedämpft, damit die weisse Nadel darauf noch die hellste Stelle bleibt. */
.sStreifen {
    position: absolute;
    top: 0;
    bottom: 0;
    opacity: 0.55;
}


.sNadel {
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: 2px;
    margin-left: -1px;
    background: #fff;
    transition: left 0.4s ease;
}

.sEnden {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
    margin-top: 0.25rem;
    font-size: 0.6rem;
    color: var(--white-38);
}

.sEnden b {
    color: var(--white-60);
    font-size: 0.68rem;
    text-align: center;
}

.sGross {
    font-size: 1.35rem;
    font-variant-numeric: tabular-nums;
    color: var(--white-87);
    line-height: 1.2;
    margin-top: 0.15rem;
}

.sFuss {
    display: flex;
    gap: 0.35rem;
    align-items: baseline;
    font-size: 0.68rem;
    font-variant-numeric: tabular-nums;
    margin-top: 0.1rem;
}

.sLabel {
    font-size: 0.6rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--white-38);
}

.gut { color: #26be96; }
.schlecht { color: #ff5f56; }
</style>
