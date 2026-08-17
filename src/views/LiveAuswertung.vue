<script setup>
/**
 * Auswertung der Handelssitzungen.
 *
 * Vier Fragen, in dieser Reihenfolge, weil sie aufeinander aufbauen:
 *
 *   1. Halte ich mich an meinen Plan — und werde ich besser?
 *   2. Nützt der Plan überhaupt etwas?
 *   3. Zu welchen Zeiten handle ich gut, zu welchen schlecht?
 *   4. Kippt es mit der Dauer oder mit der Zahl der Trades?
 *
 * Gerechnet wird in `src/utils/sitzungStatistik.js` — hier wird nur gezeichnet.
 * Dieselbe Trennung wie zwischen Marktradar-Seite und Kachel.
 *
 * **Dünne Gruppen stehen grau.** Bei drei Sitzungen an einem Dienstag ist
 * „Dienstag kostet dich Geld" Rauschen. Das Modul markiert solche Gruppen mit
 * `duenn`, und hier bleiben sie sichtbar, aber ohne den Anspruch einer Aussage —
 * dasselbe Vorgehen wie in der Regime-Kachel.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import PageInfo from '../components/PageInfo.vue'
import { dbFind } from '../utils/db.js'
import { werteAus, MIN_GRUPPE } from '../utils/sitzungStatistik.js'

const { t } = useI18n()

const sitzungen = ref([])
const laedt = ref(true)
const fehler = ref('')

const a = computed(() => werteAus(sitzungen.value))

async function lade() {
    laedt.value = true
    fehler.value = ''
    try {
        sitzungen.value = await dbFind('live_sessions', { descending: 'startUnix', limit: 500 })
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    } finally {
        laedt.value = false
    }
}

const geld = (v) => `${Number(v) >= 0 ? '+' : '−'}${Math.abs(Number(v) || 0).toFixed(2)} $`
const farbe = (v) => (Number(v) || 0) >= 0 ? 'greenTrade' : 'redTrade'
const proz = (v) => v == null ? '—' : `${Math.round(v * 100)} %`

/** Balkenbreite relativ zum grössten Betrag einer Reihe. */
function breite(wert, reihe) {
    const max = Math.max(1, ...reihe.map(x => Math.abs(x.pnlJeSitzung)))
    return `${Math.min(100, Math.abs(wert) / max * 100)}%`
}

onMounted(lade)
</script>

<template>
    <div class="awWrap">
        <div class="liveHeader">
            <div class="liveTitle">
                <span class="liveSymbol">{{ t('liveAuswertung.title') }}</span>
            </div>
            <div class="liveActions">
                <button type="button" class="ctl-pill" @click="lade">
                    <i class="uil uil-sync"></i>{{ t('marktradar.refreshAll') }}
                </button>
                <span class="ctl-sep"></span>
                <PageInfo section="info.liveAuswertung" />
            </div>
        </div>

        <div v-if="fehler" class="awFehler">{{ fehler }}</div>
        <div v-if="laedt" class="awLeer"><span class="spinner-border spinner-border-sm"></span></div>
        <div v-else-if="!a.gesamt.anzahl" class="awLeer">{{ t('liveAuswertung.keine') }}</div>

        <template v-else>
            <!-- Kopfzahlen -->
            <div class="awKopf">
                <div class="awKennzahl">
                    <span class="awLabel">{{ t('liveAuswertung.sitzungen') }}</span>
                    <b>{{ a.gesamt.anzahl }}</b>
                </div>
                <div class="awKennzahl">
                    <span class="awLabel">{{ t('liveAuswertung.gesamtPnl') }}</span>
                    <b :class="farbe(a.gesamt.pnlUsd)">{{ geld(a.gesamt.pnlUsd) }}</b>
                </div>
                <div class="awKennzahl">
                    <span class="awLabel">{{ t('liveAuswertung.disziplin') }}</span>
                    <b :class="{ awDuenn: a.disziplin.duenn }">{{ proz(a.disziplin.quote) }}</b>
                </div>
                <div class="awKennzahl">
                    <span class="awLabel">{{ t('liveAuswertung.trades') }}</span>
                    <b>{{ a.gesamt.trades }}</b>
                </div>
            </div>

            <!-- 1. Disziplin über die Zeit -->
            <section class="awBlock">
                <h3>{{ t('liveAuswertung.h_disziplin') }}</h3>
                <p v-if="!a.disziplin.anzahl" class="awHinweis">{{ t('liveAuswertung.keinPlan') }}</p>
                <template v-else>
                    <p v-if="a.disziplin.duenn" class="awHinweis">
                        {{ t('liveAuswertung.duenn', { n: MIN_GRUPPE }) }}
                    </p>
                    <div class="awVerlauf">
                        <span v-for="(p, i) in a.disziplin.punkte" :key="i"
                            :class="['awPunkt', p.gehalten ? 'ok' : 'weg']"
                            :title="`${new Date(p.t).toLocaleString()} · ${p.gehalten ? '✓' : '✗'}`"></span>
                    </div>
                    <p class="awText">
                        {{ t('liveAuswertung.gehaltenVon', { gehalten: a.disziplin.gehalten, von: a.disziplin.anzahl }) }}
                    </p>
                    <ul v-if="a.disziplin.gruende.verlust || a.disziplin.gruende.trades" class="awGruende">
                        <li v-if="a.disziplin.gruende.verlust">
                            {{ t('liveAuswertung.grundVerlust', { n: a.disziplin.gruende.verlust }) }}
                        </li>
                        <li v-if="a.disziplin.gruende.trades">
                            {{ t('liveAuswertung.grundTrades', { n: a.disziplin.gruende.trades }) }}
                        </li>
                    </ul>
                </template>
            </section>

            <!-- 2. Mit Plan gegen ohne Plan -->
            <section class="awBlock">
                <h3>{{ t('liveAuswertung.h_plan') }}</h3>
                <div class="awVergleich">
                    <div class="awSeite" :class="{ awDuenn: a.plan.mit.duenn }">
                        <span class="awLabel">{{ t('liveAuswertung.mitPlan', { n: a.plan.mit.anzahl }) }}</span>
                        <b :class="farbe(a.plan.mit.pnlJeSitzung)">{{ geld(a.plan.mit.pnlJeSitzung) }}</b>
                        <span class="awKlein">{{ t('liveAuswertung.jeSitzung') }}</span>
                    </div>
                    <div class="awSeite" :class="{ awDuenn: a.plan.ohne.duenn }">
                        <span class="awLabel">{{ t('liveAuswertung.ohnePlan', { n: a.plan.ohne.anzahl }) }}</span>
                        <b :class="farbe(a.plan.ohne.pnlJeSitzung)">{{ geld(a.plan.ohne.pnlJeSitzung) }}</b>
                        <span class="awKlein">{{ t('liveAuswertung.jeSitzung') }}</span>
                    </div>
                </div>
                <p v-if="a.plan.unterschiedJeSitzung != null" class="awText">
                    {{ t('liveAuswertung.unterschied', { betrag: geld(a.plan.unterschiedJeSitzung) }) }}
                </p>
                <p v-else class="awHinweis">{{ t('liveAuswertung.vergleichZuDuenn', { n: MIN_GRUPPE }) }}</p>
            </section>

            <!-- 3. Tageszeit und Wochentag -->
            <section class="awBlock">
                <h3>{{ t('liveAuswertung.h_zeit') }}</h3>
                <div class="awReihe">
                    <div class="awSpalte">
                        <h4>{{ t('liveAuswertung.startstunde') }}</h4>
                        <div v-for="x in a.zeit.stunden" :key="x.stunde"
                            class="awZeile" :class="{ awDuenn: x.duenn }">
                            <span class="awZeileName">{{ String(x.stunde).padStart(2, '0') }}:00</span>
                            <span class="awSchiene">
                                <span :class="['awBalken', x.pnlJeSitzung >= 0 ? 'plus' : 'minus']"
                                    :style="{ width: breite(x.pnlJeSitzung, a.zeit.stunden) }"></span>
                            </span>
                            <span :class="['awZeileWert', farbe(x.pnlJeSitzung)]">{{ geld(x.pnlJeSitzung) }}</span>
                            <span class="awZeileN">{{ x.anzahl }}</span>
                        </div>
                    </div>
                    <div class="awSpalte">
                        <h4>{{ t('liveAuswertung.wochentag') }}</h4>
                        <div v-for="x in a.zeit.wochentage" :key="x.tag"
                            class="awZeile" :class="{ awDuenn: x.duenn }">
                            <span class="awZeileName">{{ x.name }}</span>
                            <span class="awSchiene">
                                <span :class="['awBalken', x.pnlJeSitzung >= 0 ? 'plus' : 'minus']"
                                    :style="{ width: breite(x.pnlJeSitzung, a.zeit.wochentage) }"></span>
                            </span>
                            <span :class="['awZeileWert', farbe(x.pnlJeSitzung)]">{{ geld(x.pnlJeSitzung) }}</span>
                            <span class="awZeileN">{{ x.anzahl }}</span>
                        </div>
                    </div>
                </div>
                <p class="awHinweis">{{ t('liveAuswertung.zeitHinweis', { n: MIN_GRUPPE }) }}</p>
            </section>

            <!-- 4. Dauer und Überhandeln -->
            <section class="awBlock">
                <h3>{{ t('liveAuswertung.h_umfang') }}</h3>
                <div class="awReihe">
                    <div class="awSpalte">
                        <h4>{{ t('liveAuswertung.dauer') }}</h4>
                        <div v-for="x in a.umfang.dauer" :key="x.id"
                            class="awZeile" :class="{ awDuenn: x.duenn }">
                            <span class="awZeileName">{{ x.label }}</span>
                            <span class="awSchiene">
                                <span :class="['awBalken', x.pnlJeSitzung >= 0 ? 'plus' : 'minus']"
                                    :style="{ width: breite(x.pnlJeSitzung, a.umfang.dauer) }"></span>
                            </span>
                            <span :class="['awZeileWert', farbe(x.pnlJeSitzung)]">{{ geld(x.pnlJeSitzung) }}</span>
                            <span class="awZeileN">{{ x.anzahl }}</span>
                        </div>
                    </div>
                    <div class="awSpalte">
                        <h4>{{ t('liveAuswertung.tradeZahl') }}</h4>
                        <div v-for="x in a.umfang.trades" :key="x.id"
                            class="awZeile" :class="{ awDuenn: x.duenn }">
                            <span class="awZeileName">{{ x.label }}</span>
                            <span class="awSchiene">
                                <span :class="['awBalken', x.pnlJeSitzung >= 0 ? 'plus' : 'minus']"
                                    :style="{ width: breite(x.pnlJeSitzung, a.umfang.trades) }"></span>
                            </span>
                            <span :class="['awZeileWert', farbe(x.pnlJeSitzung)]">{{ geld(x.pnlJeSitzung) }}</span>
                            <span class="awZeileN">{{ x.anzahl }}</span>
                        </div>
                    </div>
                </div>
            </section>
        </template>
    </div>
</template>

<style scoped>
.awWrap {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    min-height: 300px;
}

.awKopf {
    display: flex;
    gap: 1.4rem;
    flex-wrap: wrap;
    padding: 0.5rem 0.7rem;
    border-radius: var(--border-radius);
    background: rgba(255, 255, 255, 0.04);
}

.awKennzahl {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
}

.awKennzahl b {
    font-size: 1.15rem;
    font-variant-numeric: tabular-nums;
}

.awLabel {
    font-size: 0.7rem;
    color: var(--white-60);
}

.awKlein {
    font-size: 0.66rem;
    color: var(--white-60);
}

.awBlock {
    padding: 0.6rem 0.7rem;
    border-radius: var(--border-radius);
    background: rgba(255, 255, 255, 0.03);
}

.awBlock h3 {
    font-size: 0.95rem;
    margin: 0 0 0.4rem;
    color: var(--white-87);
}

.awBlock h4 {
    font-size: 0.76rem;
    color: var(--white-60);
    margin: 0 0 0.25rem;
}

.awReihe {
    display: flex;
    gap: 1.6rem;
    flex-wrap: wrap;
}

.awSpalte {
    flex: 1;
    min-width: 15rem;
}

.awZeile {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.78rem;
    padding: 0.05rem 0;
}

.awZeileName {
    min-width: 3.6rem;
    color: var(--white-87);
}

.awSchiene {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.07);
    overflow: hidden;
}

.awBalken { display: block; height: 100%; }
.awBalken.plus { background: #4ec9a0; }
.awBalken.minus { background: #ff6b7a; }

.awZeileWert {
    font-variant-numeric: tabular-nums;
    min-width: 5rem;
    text-align: right;
}

.awZeileN {
    font-size: 0.68rem;
    color: var(--white-60);
    min-width: 1.4rem;
    text-align: right;
}

/* Zu wenige Sitzungen: sichtbar, aber ohne den Anspruch einer Aussage. */
.awDuenn {
    opacity: 0.45;
}

.awVerlauf {
    display: flex;
    gap: 2px;
    flex-wrap: wrap;
    margin-bottom: 0.3rem;
}

.awPunkt {
    width: 11px;
    height: 11px;
    border-radius: 2px;
}

.awPunkt.ok { background: #4ec9a0; }
.awPunkt.weg { background: #ff6b7a; }

.awVergleich {
    display: flex;
    gap: 1.6rem;
    flex-wrap: wrap;
}

.awSeite {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
}

.awSeite b {
    font-size: 1.05rem;
    font-variant-numeric: tabular-nums;
}

.awText {
    font-size: 0.8rem;
    color: var(--white-87);
    margin: 0.3rem 0 0;
}

.awHinweis {
    font-size: 0.72rem;
    color: var(--white-60);
    margin: 0.25rem 0 0;
}

.awGruende {
    margin: 0.2rem 0 0;
    padding-left: 1.1rem;
    font-size: 0.76rem;
    color: var(--white-60);
}

.awLeer {
    padding: 1.5rem;
    text-align: center;
    color: var(--white-60);
}

.awFehler {
    font-size: 0.82rem;
    color: #ff6b7a;
}
</style>
