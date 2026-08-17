<script setup>
/**
 * Kachel „Positionen & Plan".
 *
 * Die einzige Kachel, die nicht den Markt zeigt, sondern **dich**. Offene
 * Positionen, was die Sitzung bisher gekostet oder gebracht hat, und wie weit
 * der vorher gefasste Plan schon aufgebraucht ist.
 *
 * ## Realisiert und unrealisiert stehen getrennt
 *
 * Sie zu addieren wäre die naheliegende Vereinfachung und genau die falsche:
 * der realisierte Teil steht fest, der unrealisierte ändert sich beim nächsten
 * Tick. Wer beides in eine Zahl wirft, hält einen schwebenden Buchgewinn für
 * Ergebnis. Die Summe steht trotzdem da — als dritter Wert, nicht an ihrer
 * Stelle.
 *
 * ## Der Plan-Balken zählt am realisierten Teil
 *
 * Ein Höchstverlust ist eine Grenze für das, was wirklich verloren ist. Würde
 * eine offene Position mitzählen, riss der Balken bei jedem Rücksetzer und man
 * würde aus einer Position geworfen, die sich noch dreht. Das offene Risiko
 * steht deshalb separat darunter.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
    params: { type: Object, default: () => ({}) },
})

const { t } = useI18n()

const plan = computed(() => props.daten?.plan || {})
const offen = computed(() => (props.daten?.offen || []).slice(0, props.gross ? 12 : 4))

const geld = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(Number(v) || 0).toFixed(2)} $`
const farbe = (v) => (Number(v) || 0) >= 0 ? 'greenTrade' : 'redTrade'

/** Balkenbreite in Prozent, bei 100 gekappt — darüber zählt nur noch „drüber". */
const breite = (anteil) => anteil == null ? 0 : Math.min(100, anteil * 100)

/** Ab 70 Prozent wird der Balken gelb, ab 100 rot. Vorwarnen, nicht melden. */
function balkenKlasse(anteil) {
    if (anteil == null) return ''
    if (anteil >= 1) return 'ueber'
    if (anteil >= 0.7) return 'nah'
    return ''
}

function seiteText(p) {
    const s = String(p.side || p.positionSide || '').toUpperCase()
    if (s.includes('LONG') || s === 'BUY') return 'LONG'
    if (s.includes('SHORT') || s === 'SELL') return 'SHORT'
    return s || '—'
}

const zahl = (v) => Number(v) || 0
</script>

<template>
    <div v-if="daten" class="poWrap" :class="{ gross }">
        <div v-if="daten.hinweis" class="poHinweis">{{ daten.hinweis }}</div>

        <!-- Ergebnis der Sitzung -->
        <div class="poErgebnis">
            <div class="poWert">
                <span class="poLabel">{{ t('livetrading.positionen.realisiert') }}</span>
                <b :class="farbe(daten.realisiertUsd)">{{ geld(daten.realisiertUsd) }}</b>
            </div>
            <div class="poWert">
                <span class="poLabel">{{ t('livetrading.positionen.unrealisiert') }}</span>
                <b :class="farbe(daten.unrealisiertUsd)">{{ geld(daten.unrealisiertUsd) }}</b>
            </div>
            <div class="poWert poGesamt">
                <span class="poLabel">{{ t('livetrading.positionen.gesamt') }}</span>
                <b :class="farbe(daten.gesamtUsd)">{{ geld(daten.gesamtUsd) }}</b>
            </div>
        </div>

        <!-- Plan-Fortschritt -->
        <div v-if="plan.verlustAnteil != null || plan.tradeAnteil != null" class="poPlan">
            <div v-if="plan.verlustAnteil != null" class="poPlanZeile">
                <span class="poPlanLabel">{{ t('livetrading.positionen.verlustgrenze') }}</span>
                <span class="poSchiene">
                    <span :class="['poBalken', balkenKlasse(plan.verlustAnteil)]"
                        :style="{ width: breite(plan.verlustAnteil) + '%' }"></span>
                </span>
                <span class="poPlanZahl">{{ Math.round(plan.verlustAnteil * 100) }} %</span>
            </div>
            <div v-if="plan.tradeAnteil != null" class="poPlanZeile">
                <span class="poPlanLabel">{{ t('livetrading.positionen.tradegrenze') }}</span>
                <span class="poSchiene">
                    <span :class="['poBalken', balkenKlasse(plan.tradeAnteil)]"
                        :style="{ width: breite(plan.tradeAnteil) + '%' }"></span>
                </span>
                <span class="poPlanZahl">{{ daten.tradeAnzahl }}</span>
            </div>
            <div v-if="plan.verletzt" class="poVerletzt">
                {{ t('livetrading.positionen.planVerletzt') }}
            </div>
        </div>
        <div v-else class="poKeinPlan">{{ t('livetrading.positionen.keinPlan') }}</div>

        <!-- Offene Positionen -->
        <div v-if="offen.length" class="poListe">
            <div v-for="p in offen" :key="p.positionId || p.symbol" class="poZeile">
                <span class="poSym">{{ String(p.symbol || '').replace(/USDT$/, '') }}</span>
                <span :class="['poSeite', seiteText(p) === 'LONG' ? 'greenTrade' : 'redTrade']">
                    {{ seiteText(p) }}
                </span>
                <span v-if="zahl(p.leverage)" class="poHebel">{{ zahl(p.leverage) }}×</span>
                <span class="poLuecke"></span>
                <span :class="['poPnl', farbe(p.unrealizedPNL ?? p.unrealizedPnl)]">
                    {{ geld(p.unrealizedPNL ?? p.unrealizedPnl) }}
                </span>
            </div>
        </div>
        <div v-else-if="!daten.hinweis" class="poLeer">
            {{ t('livetrading.positionen.keineOffenen') }}
        </div>

        <div v-if="daten.offenesRisikoUsd < 0" class="poRisiko">
            {{ t('livetrading.positionen.offenesRisiko', { betrag: geld(daten.offenesRisikoUsd) }) }}
        </div>

        <div v-if="gross" class="poFuss">
            {{ t('livetrading.positionen.trennungHinweis') }}
        </div>
    </div>
</template>

<style scoped>
.poWrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    gap: 0.32rem;
}

.poHinweis {
    font-size: 0.74rem;
    color: #ffc93c;
}

.poErgebnis {
    display: flex;
    gap: 0.9rem;
    flex-wrap: wrap;
}

.poWert {
    display: flex;
    flex-direction: column;
    line-height: 1.15;
}

.poLabel {
    font-size: 0.66rem;
    color: var(--white-60);
}

.poWert b {
    font-size: 0.98rem;
    font-variant-numeric: tabular-nums;
}

/* Die Summe ist bewusst leiser als ihre beiden Bestandteile */
.poGesamt b {
    font-size: 0.86rem;
    opacity: 0.85;
}

.poPlan {
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
}

.poPlanZeile {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.72rem;
}

.poPlanLabel {
    color: var(--white-60);
    min-width: 5.2rem;
}

.poSchiene {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.09);
    overflow: hidden;
}

.poBalken {
    display: block;
    height: 100%;
    background: #4ec9a0;
    transition: width 0.3s ease;
}

.poBalken.nah { background: #ffc93c; }
.poBalken.ueber { background: #ff6b7a; }

.poPlanZahl {
    font-variant-numeric: tabular-nums;
    min-width: 2.4rem;
    text-align: right;
    color: var(--white-87);
}

.poVerletzt {
    font-size: 0.76rem;
    font-weight: 600;
    color: #ff6b7a;
}

.poKeinPlan {
    font-size: 0.7rem;
    color: var(--white-60);
}

.poListe {
    display: flex;
    flex-direction: column;
    gap: 0.08rem;
    overflow-y: auto;
    min-height: 0;
}

.poZeile {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    font-size: 0.78rem;
}

.poLuecke { flex: 1; }
.poSym { font-weight: 700; }
.poSeite { font-size: 0.68rem; font-weight: 600; }
.poHebel { font-size: 0.68rem; color: var(--white-60); }
.poPnl { font-variant-numeric: tabular-nums; font-weight: 600; }

.poLeer {
    font-size: 0.78rem;
    color: var(--white-60);
}

.poRisiko {
    font-size: 0.72rem;
    color: #ffc93c;
}

.poFuss {
    margin-top: auto;
    font-size: 0.68rem;
    color: var(--white-60);
}
</style>
