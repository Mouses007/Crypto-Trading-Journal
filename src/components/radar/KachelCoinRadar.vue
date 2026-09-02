<script setup>
/**
 * Kachel „Coin-Radar Top 10".
 *
 * Beantwortet im Handelsfenster die eine Frage, für die man sonst die Seite
 * wechseln müsste: *was lässt sich gerade überhaupt handeln.* Die Rangfolge
 * kommt unverändert aus dem letzten fertigen Coin-Radar-Lauf — diese Kachel
 * rechnet nichts nach und stösst **keinen** Lauf an. Ein Lauf kostet 42
 * Sekunden und 360 Gewichtspunkte des Binance-Budgets; das aus einer Kachel
 * heraus alle paar Minuten auszulösen, wäre der sichere Weg in die Sperre.
 *
 * Angezeigt wird deshalb immer ein *Stand*, nie ein Live-Wert — und wie alt er
 * ist, steht daneben. Ein zwei Stunden alter Rang ist im Live-Trading etwas
 * anderes als ein zwei Minuten alter, und das darf die Kachel nicht
 * verschweigen.
 *
 * Die Beständigkeit (Rangkorrelation zum vorigen Lauf) steht bewusst OBEN und
 * nicht im Kleingedruckten, genau wie auf der Coin-Radar-Seite: eine
 * Rangliste, die ihre eigene Vorhersagekraft verschweigt, ist gefährlicher als
 * gar keine. Steht sie tief, ist die Reihenfolge grösstenteils Rauschen.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { liveSymbol } from '../../stores/live.js'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
})

const { t } = useI18n()

const kurz = (s) => String(s || '').replace(/USDT$/, '')

/** Im Raster reichen zehn Zeilen; gross zeigt, was der Lauf sonst noch hergibt. */
const liste = computed(() => (props.daten?.zeilen || []).slice(0, 10))

const lauf = computed(() => props.daten?.lauf || null)

/**
 * Alter des Laufs in Minuten.
 *
 * `beendetAm` und nicht `erstelltAm`: der Lauf dauert eine Dreiviertelminute,
 * und was zählt, ist der Zeitpunkt, zu dem die Zahlen vollständig waren.
 */
const alterMin = computed(() => {
    const ts = Number(lauf.value?.beendetAm) || 0
    if (!ts) return null
    return Math.max(0, Math.round((Date.now() - ts) / 60000))
})

const alterText = computed(() => {
    const m = alterMin.value
    if (m === null) return ''
    if (m < 60) return t('livetrading.coinradar.vorMin', { m })
    return t('livetrading.coinradar.vorStd', { h: (m / 60).toFixed(1) })
})

/** Ab einer Stunde ist der Stand im Handelsfenster nicht mehr frisch. */
const alterAuf = computed(() => (alterMin.value ?? 0) >= 60)

const kor = computed(() => {
    const w = lauf.value?.rangkorrelation
    return Number.isFinite(Number(w)) ? Number(w) : null
})

/**
 * Die Beständigkeit in Worte — dieselbe Einteilung wie auf der Coin-Radar-Seite.
 * Eine blosse Zahl zwischen 0 und 1 sagt niemandem, ob sie gut ist.
 */
const korText = computed(() => {
    const w = kor.value
    if (w === null) return ''
    if (w >= 0.7) return t('livetrading.coinradar.korHoch')
    if (w >= 0.4) return t('livetrading.coinradar.korMittel')
    return t('livetrading.coinradar.korTief')
})

const korKlasse = computed(() => {
    const w = kor.value
    if (w === null) return 'muted'
    return w >= 0.7 ? 'gut' : w >= 0.4 ? 'mittel' : 'schwach'
})

const zahl = (w, n = 1) => (Number.isFinite(Number(w)) ? Number(w).toFixed(n) : '—')
const proz = (w, n = 1) => (Number.isFinite(Number(w)) ? `${Number(w).toFixed(n)} %` : '—')

/** Umsatz kurz — dieselbe Schreibweise wie in der Funding-Kachel. */
const umsatz = (v) => {
    const w = Number(v) || 0
    if (w >= 1e9) return `${(w / 1e9).toFixed(1)} Mrd`
    if (w >= 1e6) return `${Math.round(w / 1e6)} Mio`
    return `${Math.round(w / 1e3)} Tsd`
}

/** Note 0–100 einfärben — ab 70 auffällig, unter 50 gedämpft. */
const noteKlasse = (n) => (n >= 70 ? 'gut' : n >= 50 ? 'mittel' : 'schwach')

/**
 * Klick wechselt das Symbol des ganzen Fensters.
 *
 * Das ist der Grund, warum die Kachel hier steht und nicht nur auf der
 * Coin-Radar-Seite: von „der steht oben" zu „ich sehe sein Orderbuch" ist es
 * ein Klick, ohne Seitenwechsel und ohne die Sitzung aus den Augen zu lassen.
 */
function waehle(symbol) {
    if (symbol) liveSymbol.value = symbol
}
</script>

<template>
    <div v-if="daten" class="crWrap" :class="{ gross }">
        <div class="crKopf">
            <span v-if="kor !== null" class="crKor" :class="korKlasse"
                :title="t('livetrading.coinradar.korTitel')">
                {{ korText }} ({{ zahl(kor, 2) }})
            </span>
            <span v-else class="crKor muted">{{ t('livetrading.coinradar.korFehlt') }}</span>
            <span v-if="alterText" class="crAlter" :class="{ crAlterAuf: alterAuf }">{{ alterText }}</span>
        </div>

        <div v-if="!liste.length" class="crLeer">{{ t('livetrading.coinradar.leer') }}</div>

        <div v-else class="crListe">
            <div class="crZeile crZeileKopf">
                <span class="crRang">#</span>
                <span class="crSym">{{ t('livetrading.coinradar.coin') }}</span>
                <span class="crWert">{{ t('livetrading.coinradar.note') }}</span>
                <span class="crWert">ATR</span>
                <span class="crWert">RVOL</span>
                <template v-if="gross">
                    <span class="crWert">ADX</span>
                    <span class="crWert">{{ t('livetrading.coinradar.funding') }}</span>
                    <span class="crWert crWeit">{{ t('livetrading.coinradar.umsatz') }}</span>
                    <span class="crWert crWeit">{{ t('livetrading.coinradar.boerse') }}</span>
                </template>
            </div>

            <div v-for="z in liste" :key="z.symbol" class="crZeile crKlick"
                :class="{ crAktiv: z.symbol === liveSymbol }"
                :title="t('livetrading.coinradar.waehlen', { s: kurz(z.symbol) })"
                @click.stop="waehle(z.symbol)">
                <span class="crRang">{{ z.rang }}</span>
                <span class="crSym">{{ kurz(z.symbol) }}</span>
                <span class="crWert" :class="noteKlasse(z.note)"><b>{{ z.note }}</b></span>
                <span class="crWert">{{ proz(z.atrPct, 2) }}</span>
                <span class="crWert">{{ zahl(z.rvol, 1) }}</span>
                <template v-if="gross">
                    <span class="crWert">{{ zahl(z.adx, 0) }}</span>
                    <span class="crWert">{{ proz(z.fundingJahresRate, 0) }}</span>
                    <span class="crWert crWeit">{{ umsatz(z.umsatz24h) }}</span>
                    <span class="crWert crWeit">{{ z.besteBoerse || '—' }}</span>
                </template>
            </div>
        </div>
    </div>
</template>

<style scoped>
.crWrap {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    height: 100%;
    min-height: 0;
}

.crKopf {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.7rem;
}

.crKor.gut { color: #4ec9a5; }
.crKor.mittel { color: #e8b04b; }
.crKor.schwach { color: #e07a5f; }
.crKor.muted { color: var(--white-45, rgba(255, 255, 255, 0.45)); }

.crAlter {
    margin-left: auto;
    color: var(--white-45, rgba(255, 255, 255, 0.45));
    white-space: nowrap;
}

/* Wie bei den Indizes: das Alter fällt erst auf, wenn es die erwartete
   Verzögerung überschreitet — im Handelsfenster ist das eine Stunde. */
.crAlter.crAlterAuf { color: #e8b04b; }

.crListe {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
}

/* `minmax(0, …)` in jeder Spur: ein langer Symbolname sprengte das Raster
   sonst in die Breite, statt zu kürzen. */
.crZeile {
    display: grid;
    grid-template-columns: 1.4rem minmax(0, 1fr) minmax(0, 2.4rem) minmax(0, 3.2rem) minmax(0, 2.6rem);
    align-items: center;
    gap: 0.3rem;
    padding: 0.14rem 0.2rem;
    font-size: 0.76rem;
    border-radius: 4px;
}

.crWrap.gross .crZeile {
    grid-template-columns: 1.8rem minmax(0, 1fr) minmax(0, 3rem) minmax(0, 4rem)
        minmax(0, 3.2rem) minmax(0, 3rem) minmax(0, 4.4rem) minmax(0, 5rem) minmax(0, 5rem);
    font-size: 0.82rem;
    padding: 0.22rem 0.3rem;
}

.crZeileKopf {
    font-size: 0.66rem;
    color: var(--white-45, rgba(255, 255, 255, 0.45));
    text-transform: uppercase;
    letter-spacing: 0.03em;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    padding-bottom: 0.2rem;
    margin-bottom: 0.1rem;
}

.crRang {
    color: var(--white-45, rgba(255, 255, 255, 0.45));
    text-align: right;
    font-variant-numeric: tabular-nums;
}

.crSym {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.crWert {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.crWert.gut { color: #4ec9a5; }
.crWert.mittel { color: #e8b04b; }
.crWert.schwach { color: var(--white-60, rgba(255, 255, 255, 0.6)); }

.crKlick { cursor: pointer; }
.crKlick:hover { background: rgba(255, 255, 255, 0.06); }

/* Das gerade gewählte Symbol bleibt markiert, damit man nach einem Blick auf
   die Bookmap wiederfindet, wo man war. */
.crAktiv { background: rgba(90, 160, 255, 0.14); }

.crLeer {
    font-size: 0.75rem;
    color: var(--white-45, rgba(255, 255, 255, 0.45));
}
</style>
