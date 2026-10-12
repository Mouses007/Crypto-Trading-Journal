<script setup>
/**
 * Ergebnis einer Tiefensuche (`GET /api/coin-radar/tiefensuche`): Verträge,
 * Vertrags- und Halterprüfung, Projektprüfung.
 *
 * Steht an zwei Stellen — in der Einzelprüfung des Coin-Radars (gesucht nach
 * Symbol) und in der Frühphase auf der Karte eines Tokens, auf den ein Alarm
 * zeigt (gesucht nach Vertrag). Beide Antworten haben dieselbe Form.
 */
import { useI18n } from 'vue-i18n'
import ProjektPruefung from './ProjektPruefung.vue'

defineProps({
    daten: { type: Object, required: true },
    /** Kopf mit dem gefundenen Coin — in der Einzelprüfung steht er schon darüber. */
    mitKopf: { type: Boolean, default: false },
})
const { t } = useI18n()

const pct = (w) => (w === null || w === undefined || !Number.isFinite(Number(w)) ? '—' : `${Number(w).toFixed(Number(w) < 10 ? 1 : 0)} %`)
const zahlKurz = (w) => (w === null || w === undefined || !Number.isFinite(Number(w)) ? '—'
    : (Number(w) >= 1e6 ? `${(Number(w) / 1e6).toFixed(1)} Mio` : (Number(w) >= 1e3 ? `${(Number(w) / 1e3).toFixed(0)} k` : String(Number(w)))))
const geldKurz = (w) => `${zahlKurz(w)} USD`
const devText = (r) => (r.devPct !== null && r.devPct !== undefined ? pct(r.devPct) : (r.devUnterPct ? '< ' + pct(r.devUnterPct) : '—'))
</script>

<template>
    <div class="tsErgebnis">
        <p v-if="!daten.gefunden" class="small mb-0">{{ t('coinradar.tsNichtGefunden') }}</p>
        <template v-else>
            <!-- Welcher Coin gefunden wurde: bei Suche über das Kürzel kann es ein anderer sein als gemeint. -->
            <div v-if="mitKopf && (daten.coin?.name || daten.coin?.symbol)" class="tsKopf">
                <img v-if="daten.coin.bild" :src="daten.coin.bild" alt="" class="tsBild">
                <strong>{{ daten.coin.name || daten.coin.symbol }}</strong>
                <span v-if="daten.coin.symbol" class="tsGrau">{{ daten.coin.symbol }}</span>
                <span v-if="daten.coin.rang" class="tsGrau">#{{ daten.coin.rang }}</span>
                <a v-if="daten.coin.coingeckoUrl" :href="daten.coin.coingeckoUrl" target="_blank" rel="noopener noreferrer">CoinGecko ↗</a>
            </div>
            <div class="tsBlock">
                <div class="tsTitel">{{ t('coinradar.tsVertrag') }}</div>
                <div v-if="!daten.gewaehlt" class="small">{{ t('coinradar.tsNichtPruefbar') }}</div>
                <div v-for="v in daten.vertraege" :key="v.chain + v.contract" class="tsZeile"
                    :class="{ gewaehlt: daten.gewaehlt && v.contract === daten.gewaehlt.contract }">
                    <span class="tsKette">{{ v.chain }}</span>
                    <code>{{ v.contract }}</code>
                    <span v-if="v.liquiditaetUsd" class="tsGrau">{{ t('coinradar.tsLiq') }} {{ geldKurz(v.liquiditaetUsd) }}<template v-if="v.dex"> · {{ v.dex }}</template></span>
                    <span v-else-if="!v.pruefbar" class="tsGrau">{{ t('coinradar.tsKetteNichtPruefbar') }}</span>
                    <a v-if="v.url" :href="v.url" target="_blank" rel="noopener noreferrer">DexScreener ↗</a>
                </div>
            </div>
            <div v-if="daten.gewaehlt" class="tsBlock">
                <div class="tsTitel">{{ t('coinradar.tsRisiko') }}</div>
                <p v-if="daten.risikoFehler" class="small mb-1">{{ daten.risikoFehler }}</p>
                <template v-else-if="daten.risiko">
                    <p class="small mb-1" :class="daten.risiko.ko ? 'text-danger' : 'tsGut'">
                        {{ daten.risiko.ko ? t('coinradar.tsKo', { g: daten.risiko.ko.text }) : t('coinradar.tsOk') }}
                    </p>
                    <p class="small mb-1 tsGrau">
                        {{ t('coinradar.tsHalter') }} {{ zahlKurz(daten.risiko.halter) }}
                        · {{ t('coinradar.tsTop10') }} {{ pct(daten.risiko.top10Pct) }}
                        · {{ t('coinradar.tsInsider') }} {{ pct(daten.risiko.insiderPct) }}
                        · {{ t('coinradar.tsDev') }} {{ devText(daten.risiko) }}
                    </p>
                    <ul class="tsBefunde">
                        <li v-for="(b, i) in daten.risiko.befunde" :key="i" :class="b.art">{{ b.art === 'minus' ? '−' : (b.art === 'plus' ? '+' : 'i') }} {{ b.text }}</li>
                    </ul>
                </template>
            </div>
            <div class="tsBlock">
                <div class="tsTitel">{{ t('coinradar.tsProjekt') }}</div>
                <ProjektPruefung v-if="daten.projekt" :projekt="daten.projekt" />
                <p v-else class="small mb-0">—</p>
            </div>
        </template>
    </div>
</template>

<style scoped>
.tsErgebnis { margin-top: .6rem; padding-top: .6rem; border-top: 1px solid var(--white-10, rgba(255, 255, 255, .1)); display: grid; gap: .75rem; }
.tsKopf { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; font-size: .9rem; }
.tsBild { width: 20px; height: 20px; border-radius: 50%; }
.tsTitel { font-size: .75rem; letter-spacing: .05em; text-transform: uppercase; color: var(--grey-text, #8a9199); margin-bottom: .3rem; }
.tsZeile { display: flex; gap: .6rem; align-items: baseline; flex-wrap: wrap; font-size: .85rem; padding: .1rem 0; opacity: .7; }
.tsZeile.gewaehlt { opacity: 1; }
.tsZeile code { font-size: .8rem; word-break: break-all; }
.tsKette { min-width: 5.5rem; font-weight: 600; }
.tsGrau { color: var(--grey-text, #8a9199); }
.tsGut { color: var(--green, #26a69a); }
.tsBefunde { list-style: none; padding: 0; margin: 0; font-size: .85rem; }
.tsBefunde li.minus { color: var(--red-color, #FF6960); }
.tsBefunde li.info { color: var(--grey-text, #8a9199); }
</style>
