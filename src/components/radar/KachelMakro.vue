<script setup>
/**
 * Kachel „Makro-Umfeld" — was ausserhalb von Krypto gerade passiert.
 *
 * Alle übrigen Radar-Kacheln sind krypto-intern. Fällt Bitcoin, weil die
 * Nasdaq fällt, konnte das bisher keine davon sagen — man suchte die Ursache
 * im Krypto-Markt, wo sie nicht lag. Diese Kachel schliesst die Lücke.
 *
 * Zwei Eigenheiten, die bewusst so sind:
 *
 * 1. Die Kopfzeile ist die KOPPLUNG, nicht der Kurs. „Nasdaq −1 %" allein ist
 *    Dekoration, solange offen bleibt, ob Krypto gerade daran hängt.
 * 2. Die Farbe zeigt Rückenwind oder Gegenwind FÜR KRYPTO, nicht die Richtung
 *    des jeweiligen Marktes. Ein steigender Dollar ist deshalb rot — er ist
 *    Gegenwind, auch wenn der Wert steigt.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
})

const { t } = useI18n()

const ROT = 'rgb(255, 95, 86)'
const GRUEN = 'rgb(38, 190, 150)'
const GRAU = 'rgba(255, 255, 255, 0.45)'

// Steigender Dollar = knappere globale Liquidität = Gegenwind. Deshalb wird
// bei DXY die Farblogik gedreht (die ZAHL bleibt selbstverständlich echt).
const GEDREHT = new Set(['dxy'])

const maerkte = computed(() => props.daten?.maerkte || [])
const korr = computed(() => props.daten?.korrelation || {})
const stable = computed(() => props.daten?.stablecoins || {})

const kopplung = computed(() => t('marktradar.makro.corr_' + (korr.value.deutung || 'unbekannt')))

function farbe(m) {
    if (!Number.isFinite(m.deltaPct) || m.deltaPct === 0) return GRAU
    const gut = GEDREHT.has(m.id) ? m.deltaPct < 0 : m.deltaPct > 0
    return gut ? GRUEN : ROT
}

const pfeil = (v) => (!Number.isFinite(v) || v === 0 ? '—' : v > 0 ? '▲' : '▼')
const pct = (v) => (!Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)} %`)

const preis = (v) => (!Number.isFinite(v) ? '—'
    : v >= 1000 ? v.toLocaleString('de-CH', { maximumFractionDigits: 0 })
        : v.toFixed(2))

const mrd = (v) => (!Number.isFinite(v) ? '—'
    : `${v > 0 ? '+' : v < 0 ? '−' : ''}${(Math.abs(v) / 1e9).toFixed(1)} Mrd`)

const stableFarbe = computed(() => {
    const d = stable.value.deltaUsd
    if (!Number.isFinite(d) || d === 0) return GRAU
    return d > 0 ? GRUEN : ROT
})

// Die Dominanz wird NUR zerlegt gezeigt: als blosse Zahl wäre sie nicht
// deutbar, weil sie schon steigt, wenn allein die Kurse fallen.
const dom = computed(() => props.daten?.dominanz || null)
const punkte = (v) => (!Number.isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`)
</script>

<template>
    <div v-if="daten" class="mkWrap" :class="{ gross }">
        <!-- Die eigentliche Aussage: hängt Krypto gerade an den Aktien? -->
        <div class="mkKopplung">
            <span class="mkKopplungText">{{ kopplung }}</span>
            <span v-if="Number.isFinite(korr.nasdaq)" class="mkR">r = {{ korr.nasdaq.toFixed(2) }}</span>
        </div>

        <div class="mkListe">
            <div v-for="m in maerkte" :key="m.id" class="mkZeile">
                <span class="mkName">
                    {{ t('marktradar.makro.' + m.id) }}
                    <span v-if="m.offen === false" class="mkZu" :title="t('marktradar.makro.closedHint')">
                        {{ t('marktradar.makro.closed') }}
                    </span>
                </span>
                <span v-if="!m.verfuegbar" class="mkFehlt">—</span>
                <span v-else class="mkWert">
                    <span class="mkPreis">{{ preis(m.preis) }}</span>
                    <span :style="{ color: farbe(m) }">{{ pfeil(m.deltaPct) }} {{ pct(m.deltaPct) }}</span>
                </span>
            </div>

            <div class="mkZeile mkStable">
                <span class="mkName">{{ t('marktradar.makro.stableFlow', { tage: stable.tage || 30 }) }}</span>
                <span v-if="!stable.verfuegbar" class="mkFehlt">—</span>
                <span v-else class="mkWert" :style="{ color: stableFarbe }">
                    {{ mrd(stable.deltaUsd) }} $
                    <span class="mkStablePct">({{ pct(stable.deltaPct) }})</span>
                </span>
            </div>
        </div>

        <!-- Ohne diese Zeile liest man die Farbe als Marktrichtung — und wundert
             sich, warum ein steigender Dollar rot ist. -->
        <p class="mkLegende">
            <span class="mkPunkt" :style="{ color: GRUEN }">●</span>
            <span>{{ t('marktradar.makro.legendGut') }}</span>
            <span class="mkPunkt" :style="{ color: ROT }">●</span>
            <span>{{ t('marktradar.makro.legendSchlecht') }}</span>
            <span class="mkLegendeNote">{{ t('marktradar.makro.legendHinweis') }}</span>
        </p>

        <template v-if="gross">
            <div class="mkDetails">
                <div class="mkDetailZeile">
                    <span>{{ t('marktradar.makro.corrNasdaq') }}</span>
                    <b>{{ Number.isFinite(korr.nasdaq) ? korr.nasdaq.toFixed(2) : '—' }}</b>
                </div>
                <div class="mkDetailZeile">
                    <span>{{ t('marktradar.makro.corrDxy') }}</span>
                    <b>{{ Number.isFinite(korr.dxy) ? korr.dxy.toFixed(2) : '—' }}</b>
                </div>
                <div class="mkDetailZeile">
                    <span>{{ t('marktradar.makro.corrPoints') }}</span>
                    <b>{{ korr.punkte || 0 }}</b>
                </div>
                <div v-if="stable.verfuegbar" class="mkDetailZeile">
                    <span>{{ t('marktradar.makro.stableTotal') }}</span>
                    <b>{{ (stable.jetztUsd / 1e9).toFixed(0) }} Mrd $</b>
                </div>
            </div>

            <!-- Dominanz nur zerlegt: ein Anstieg kann reiner Kurseffekt sein -->
            <div v-if="dom" class="mkDom">
                <div class="mkDomKopf">
                    {{ t('marktradar.makro.domTitle', { tage: dom.tage }) }}
                </div>
                <div class="mkDomZeile">
                    <span>{{ dom.vorherPct.toFixed(2) }} % → {{ dom.jetztPct.toFixed(2) }} %</span>
                    <b>{{ punkte(dom.deltaPunkte) }} {{ t('marktradar.makro.domPoints') }}</b>
                </div>
                <div class="mkDomAufteilung">
                    <span>
                        {{ t('marktradar.makro.domFromSupply') }}
                        <b>{{ punkte(dom.mengePunkte) }}</b>
                    </span>
                    <span>
                        {{ t('marktradar.makro.domFromPrice') }}
                        <b>{{ punkte(dom.kursPunkte) }}</b>
                    </span>
                </div>
                <p class="mkDomHinweis">{{ t('marktradar.makro.domHint') }}</p>
            </div>
            <p class="mkQuelle">{{ t('marktradar.makro.source') }}</p>
        </template>
    </div>
</template>

<style scoped>
.mkWrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.mkKopplung {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.55rem;
}

.mkKopplungText {
    font-size: 0.98rem;
    font-weight: 600;
    color: var(--white-87);
}

.mkWrap.gross .mkKopplungText {
    font-size: 1.15rem;
}

.mkR {
    font-size: 0.78rem;
    color: var(--white-60);
    font-variant-numeric: tabular-nums;
}

.mkListe {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
}

.mkZeile {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.6rem;
    font-size: 0.86rem;
    padding: 0.1rem 0;
}

.mkStable {
    margin-top: 0.35rem;
    padding-top: 0.35rem;
    border-top: 1px solid var(--white-12, rgba(255, 255, 255, 0.08));
}

.mkName {
    color: var(--white-60);
}

.mkZu {
    margin-left: 0.3rem;
    padding: 0 0.28rem;
    border-radius: 3px;
    background: var(--black-bg-12, rgba(255, 255, 255, 0.08));
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: help;
}

.mkWert {
    display: flex;
    gap: 0.5rem;
    font-variant-numeric: tabular-nums;
    color: var(--white-87);
}

.mkPreis {
    color: var(--white-87);
}

.mkStablePct {
    opacity: 0.75;
}

.mkFehlt {
    color: var(--white-60);
}

.mkLegende {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.25rem 0.4rem;
    margin: 0.5rem 0 0;
    font-size: 0.72rem;
    color: var(--white-60);
    opacity: 0.85;
}

.mkPunkt {
    font-size: 0.6rem;
    line-height: 1;
}

.mkLegendeNote {
    opacity: 0.75;
}

.mkLegendeNote::before {
    content: '· ';
}

.mkDetails {
    margin-top: 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
}

.mkDetailZeile {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    font-size: 0.84rem;
    color: var(--white-60);
}

.mkDetailZeile b {
    color: var(--white-87);
    font-variant-numeric: tabular-nums;
}

.mkDom {
    margin-top: 0.9rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--white-12, rgba(255, 255, 255, 0.08));
}

.mkDomKopf {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--white-60);
    margin-bottom: 0.25rem;
}

.mkDomZeile {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    font-size: 0.9rem;
    color: var(--white-87);
    font-variant-numeric: tabular-nums;
}

.mkDomAufteilung {
    display: flex;
    gap: 1.2rem;
    margin-top: 0.25rem;
    font-size: 0.84rem;
    color: var(--white-60);
    flex-wrap: wrap;
}

.mkDomAufteilung b {
    color: var(--white-87);
    font-variant-numeric: tabular-nums;
}

.mkDomHinweis {
    margin: 0.35rem 0 0;
    font-size: 0.76rem;
    color: var(--white-60);
}

.mkQuelle {
    margin: 0.7rem 0 0;
    font-size: 0.78rem;
    color: var(--white-60);
}
</style>
