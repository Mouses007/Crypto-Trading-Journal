<script setup>
/**
 * Startseite — die Landing-Page der App, ein frei konfigurierbares Kachelraster.
 *
 * Gleiche Aufgabenteilung wie Marktradar und Live-Trading-Fenster: **die Seite
 * holt, die Kachel zeichnet** — alle drei benutzen dasselbe Composable
 * (`useKachelRaster`). Eigen ist hier nur die Registry (`config/startseite.js`),
 * ein eigener localStorage-Schlüssel und die Journal-Datenversorgung: die drei
 * Journal-Kacheln (Kontostand, offene Trades, Winrate) versorgen sich selbst aus
 * den Stores, und weil die Startseite im `start`-Modus läuft (nicht `journal`),
 * lädt das Dashboard-Layout diese Daten nicht — also stößt diese Seite die
 * vorhandenen Loader selbst an und hält sie im Takt frisch.
 *
 * Die generierte News-Zusammenfassung sitzt als feste Karte über dem Raster
 * (`NewsKarte.vue`), nicht als verschiebbare Kachel. Ausblendbar ist sie
 * trotzdem: sie steht als eigener Eintrag im Kachel-Menü (`NEWS_ID`) und teilt
 * sich dessen localStorage-Mechanik, obwohl sie nicht in der Registry steht.
 */
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import PageInfo from '../components/PageInfo.vue'
import RadarKachel from '../components/RadarKachel.vue'
import RadarOverlay from '../components/RadarOverlay.vue'
import NewsKarte from '../components/start/NewsKarte.vue'
import PultAnsicht from '../components/startseite/PultAnsicht.vue'
// Journal-Kacheln (self-supplying)
import KachelKontostand from '../components/start/KachelKontostand.vue'
import KachelOffeneTrades from '../components/start/KachelOffeneTrades.vue'
import KachelWinrate from '../components/start/KachelWinrate.vue'
import KachelKapitalkurve from '../components/start/KachelKapitalkurve.vue'
import KachelKennzahlen from '../components/start/KachelKennzahlen.vue'
import KachelHeatmap from '../components/start/KachelHeatmap.vue'
import KachelPerformance from '../components/start/KachelPerformance.vue'
// Voller Marktradar-Katalog
import KachelFearGreed from '../components/radar/KachelFearGreed.vue'
import KachelDominanz from '../components/radar/KachelDominanz.vue'
import KachelFunding from '../components/radar/KachelFunding.vue'
import KachelLsOi from '../components/radar/KachelLsOi.vue'
import KachelRsi from '../components/radar/KachelRsi.vue'
import KachelMarkt from '../components/radar/KachelMarkt.vue'
import KachelRainbow from '../components/radar/KachelRainbow.vue'
import KachelLiq24 from '../components/radar/KachelLiq24.vue'
import KachelRegime from '../components/radar/KachelRegime.vue'
import KachelAltseason from '../components/radar/KachelAltseason.vue'
import KachelPiCycle from '../components/radar/KachelPiCycle.vue'
import KachelMechanik from '../components/radar/KachelMechanik.vue'
import KachelMakro from '../components/radar/KachelMakro.vue'
import KachelLage from '../components/radar/KachelLage.vue'
import { liveSymbol } from '../stores/live.js'
import { KACHELN, sortiereKacheln, STANDARD_VERSTECKT } from '../config/startseite.js'
import { useKachelRaster } from '../composables/useKachelRaster.js'
// Journal-Datenversorgung. Bewusst NICHT über die Filter-Maschinerie des
// Journals (die hängt an einer App-Init-Reihenfolge, die im `start`-Modus nicht
// läuft): die Winrate rechnet hier selbst broker-weit über alle Trades — pur
// und filterunabhängig, mit demselben getesteten Summenkern wie das Journal.
import { totals, selectedBroker, currentUser } from '../stores/globals.js'
import { neueSummen, summiereTrade, leiteKennzahlenAb } from '../utils/totals-kern.js'
import { dbFind } from '../utils/db.js'
import { setzeJournalTage } from '../stores/startseite.js'
import { useGetIncomingPositions, useStartGlobalPolling, useStopGlobalPolling } from '../utils/incoming.js'
import { refreshAccountBalance } from '../stores/accountBalance.js'

const { t } = useI18n()

/**
 * Schlüssel der festen Marktbericht-Karte im Sichtbarkeits-Speicher. Bewusst
 * KEINE Registry-Kachel (sie sitzt über dem Raster, ist nicht verschiebbar und
 * hat keinen Endpunkt) — `isVisible`/`beiUmschalten` arbeiten aber über eine
 * freie Schlüsselmenge, also genügt der eigene Schlüssel.
 */
const NEWS_ID = 'newsKarte'
const router = useRouter()

/**
 * Raster oder Pult — dieselbe Mechanik wie bei Marktradar und Live-Trading,
 * eigener Speicher. Anders als dort braucht das Pult hier kein `immerLaden`:
 * die Startseite hat keine feste Kachelmenge, das Pult zeigt exakt dieselben
 * sichtbaren Kacheln wie das Raster, nur mit einer davon als Bühne statt in
 * gleicher Grösse. Siehe `components/startseite/PultAnsicht.vue`.
 */
const ANSICHT_KEY = 'startseite_ansicht'
const ansicht = ref(localStorage.getItem(ANSICHT_KEY) === 'pult' ? 'pult' : 'raster')

function waehleAnsicht(wert) {
    ansicht.value = wert
    localStorage.setItem(ANSICHT_KEY, wert)
}

/**
 * Abschalter. Ist die Startseite in den Einstellungen abgeschaltet, landet ein
 * Deep-Link auf `/startseite` im Dashboard. `immediate` deckt den Fall ab, dass
 * die Einstellungen schon da sind, der Watch den Fall, dass sie erst
 * nachträglich eintreffen. Solange `currentUser` null ist, wird NICHT umgeleitet
 * — Unwissen ist kein Nein (gleiche Regel wie beim Live-Trading-Fenster).
 */
watch(currentUser, (u) => {
    if (u && Number(u.startseiteAn ?? 1) === 0) router.replace('/dashboard')
}, { immediate: true })

/** Kachel-Id → Komponente. Journal-Kacheln zuerst, dann der Radar-Katalog. */
const KOMPONENTEN = {
    kontostand: KachelKontostand,
    offeneTrades: KachelOffeneTrades,
    winrate: KachelWinrate,
    kapitalkurve: KachelKapitalkurve,
    kennzahlen: KachelKennzahlen,
    heatmap: KachelHeatmap,
    performance: KachelPerformance,
    fng: KachelFearGreed,
    dom: KachelDominanz,
    funding: KachelFunding,
    lsoi: KachelLsOi,
    rsi: KachelRsi,
    markt: KachelMarkt,
    rainbow: KachelRainbow,
    liq24: KachelLiq24,
    regime: KachelRegime,
    altseason: KachelAltseason,
    picycle: KachelPiCycle,
    mechanik: KachelMechanik,
    makro: KachelMakro,
    lage: KachelLage,
}

const {
    gridEl, daten, zustand, stand, fehler, kachelParams,
    alleKacheln, sichtbareKacheln, gesamtZustand,
    offeneKachel, offeneDefinition, showConfigDropdown, configRef,
    ladeKachel, ladeFaellige, beiUmschalten, isVisible,
    setzeParams, setzeAnzeige, stilFuer, starteGroesse, setzeGroesseZurueck,
} = useKachelRaster({
    storageKey: 'startseite_hidden_cards',
    paramKey: 'startseite_params',
    kacheln: KACHELN,
    sortiere: sortiereKacheln,
    symbolRef: liveSymbol,
    standardVersteckt: STANDARD_VERSTECKT,
})

/** Kacheln ohne Endpunkt versorgen sich selbst — nie eine `daten`-Nutzlast. */
const eigenstaendig = (kachel) => !kachel.endpunkt

// ── Journal-Datenversorgung ─────────────────────────────────────────────
// Winrate und Kontostand hängen an den Journal-Stores (Totals, Trades). Die
// werden im `journal`-Modus vom Dashboard-Layout geladen — hier im `start`-Modus
// nicht, also holen wir sie selbst und halten sie im Minutentakt frisch.
let journalTimer = null

async function ladeJournal() {
    try {
        // Alle Trade-Tage des aktiven Brokers summieren (all-time) und die
        // abgeleiteten Kennzahlen in `totals` schreiben — genau die Felder, die
        // die Winrate-Kachel liest (trades, netWinsCount, grossWinsCount …).
        const broker = selectedBroker.value || 'bitunix'
        const tage = await dbFind('trades', { equalTo: { broker }, limit: 100000 })
        // Tage in den Startseiten-Store legen (Kapitalkurve, Heatmap, Splits)
        setzeJournalTage(tage)
        // Kennzahlen/Winrate aus dem getesteten Summenkern in `totals`
        const summe = neueSummen()
        for (const tag of tage) {
            for (const el of (tag.trades || [])) summiereTrade(summe, el)
        }
        const merged = { ...summe, ...leiteKennzahlenAb(summe) }
        for (const k in totals) delete totals[k]
        Object.assign(totals, merged)
    } catch (e) {
        console.warn(' -> Startseite: Winrate laden fehlgeschlagen:', e?.message)
    }
}

onMounted(async () => {
    await Promise.allSettled([
        ladeJournal(),
        useGetIncomingPositions(),
        refreshAccountBalance({}),
    ])
    // Offene Positionen frisch halten (nur wenn Trade-Popups nicht abgeschaltet
    // sind — dieselbe Regel wie im Dashboard-Layout).
    useStartGlobalPolling()
    journalTimer = setInterval(() => {
        ladeJournal()
        refreshAccountBalance({})
    }, 60000)
})

onBeforeUnmount(() => {
    clearInterval(journalTimer)
    useStopGlobalPolling()
})
</script>

<template>
    <div class="radarWrap">
        <!-- Feste News-Karte: nicht Teil des Rasters, aber über das
             Kachel-Menü ausblendbar -->
        <NewsKarte v-if="isVisible(NEWS_ID)" />

        <div class="liveHeader">
            <div class="liveTitle">
                <span class="liveSymbol">{{ t('startseite.title') }}</span>
                <span :class="['liveDot', 'dot-' + gesamtZustand]"></span>
                <span class="liveState">{{ t('marktradar.status_' + gesamtZustand) }}</span>
            </div>
            <div class="liveActions">
                <div class="ltAnsicht">
                    <button type="button" :class="['ctl-pill', ansicht === 'raster' ? 'active' : '']"
                        :title="t('livetrading.ansicht.rasterSub')" @click="waehleAnsicht('raster')">
                        <i class="uil uil-apps"></i>{{ t('livetrading.ansicht.raster') }}
                    </button>
                    <button type="button" :class="['ctl-pill', ansicht === 'pult' ? 'active' : '']"
                        :title="t('startseite.pult.pultSub')" @click="waehleAnsicht('pult')">
                        <i class="uil uil-sliders-v-alt"></i>{{ t('livetrading.ansicht.pult') }}
                    </button>
                </div>
                <span class="ctl-sep"></span>
                <div ref="configRef" class="position-relative">
                    <button type="button" class="ctl-pill" @click="showConfigDropdown = !showConfigDropdown">
                        <i class="uil uil-apps"></i>{{ t('marktradar.cards') }}
                    </button>
                    <div v-if="showConfigDropdown" class="card-config-dropdown">
                        <div class="card-config-title">{{ t('auswertung.visibleCards') }}</div>
                        <!-- Der Marktbericht ist keine Raster-Kachel, gehört
                             aber in dieselbe Liste — sonst gibt es genau einen
                             Block auf der Seite, den man nicht loswird. -->
                        <div class="card-config-item" @click="beiUmschalten(NEWS_ID)">
                            <i class="uil me-2"
                                :class="isVisible(NEWS_ID) ? 'uil-check-square text-success' : 'uil-square-full text-muted'"></i>
                            {{ t('startseite.news.label') }}
                        </div>
                        <div v-for="kachel in alleKacheln" :key="kachel.id" class="card-config-item"
                            @click="beiUmschalten(kachel.id)">
                            <i class="uil me-2"
                                :class="isVisible(kachel.id) ? 'uil-check-square text-success' : 'uil-square-full text-muted'"></i>
                            {{ t(kachel.titleKey) }}
                        </div>
                    </div>
                </div>
                <button type="button" class="ctl-pill" @click="ladeFaellige(true)">
                    <i class="uil uil-sync"></i>{{ t('marktradar.refreshAll') }}
                </button>
                <span class="ctl-sep"></span>
                <PageInfo section="info.marktradar" />
            </div>
        </div>

        <!-- Keine WebSocket-Kacheln in diesem Katalog: `v-if` ist hier nicht aus
             Verbindungsgründen nötig wie bei Bookmap/Hebelkarte, sondern weil die
             Bühne sich mit der Sichtbarkeit ändert und `v-show` beide Bäume
             gleichzeitig am Leben hielte. -->
        <PultAnsicht v-if="ansicht === 'pult'" :daten="daten" :zustand="zustand" :stand="stand"
            :kachel-params="kachelParams" :komponenten="KOMPONENTEN" :sichtbare-kacheln="sichtbareKacheln"
            @params="setzeParams" @anzeige="setzeAnzeige"
            @zustand="() => {}"
            @neuladen="(id) => ladeKachel(id, true)" />

        <div v-else ref="gridEl" class="radarGrid">
            <div v-for="kachel in sichtbareKacheln" :key="kachel.id" :data-kachel="kachel.id"
                :style="stilFuer(kachel)">
                <RadarKachel :titel="t(kachel.titleKey)" :icon="kachel.icon" :info-key="kachel.infoKey" :zustand="zustand[kachel.id] || 'idle'"
                    :stand="stand[kachel.id] || 0" :fehler="fehler[kachel.id] || ''" :hat-daten="!!daten[kachel.id]"
                    :eigenstaendig="eigenstaendig(kachel)"
                    @gross="offeneKachel = kachel.id" @neuladen="ladeKachel(kachel.id, true)"
                    @groesse-start="starteGroesse(kachel, $event)" @groesse-zurueck="setzeGroesseZurueck(kachel)">
                    <component :is="KOMPONENTEN[kachel.id]" :daten="daten[kachel.id]" :gross="false"
                        :params="kachelParams[kachel.id] || {}"
                        @params="setzeParams(kachel.id, $event)"
                        @anzeige="setzeAnzeige(kachel.id, $event)"
                        @neuladen="ladeKachel(kachel.id, true)" />
                </RadarKachel>
            </div>
        </div>

        <div v-if="!sichtbareKacheln.length" class="radarLeer">{{ t('marktradar.allHidden') }}</div>

        <!-- Gross: dieselbe Komponente, dieselben Daten, nur mit mehr Platz.
             Self-supplying Kacheln (ohne Endpunkt) dürfen auch ohne `daten` auf. -->
        <RadarOverlay v-if="ansicht === 'raster' && offeneKachel && (daten[offeneKachel] || !offeneDefinition?.endpunkt)"
            :titel="t(offeneDefinition.titleKey)" :info-key="offeneDefinition.infoKey" :quelle="offeneDefinition.quelle" @schliessen="offeneKachel = null">
            <component :is="KOMPONENTEN[offeneKachel]" :daten="daten[offeneKachel]" :gross="true"
                :params="kachelParams[offeneKachel] || {}"
                @params="setzeParams(offeneKachel, $event)"
                @anzeige="setzeAnzeige(offeneKachel, $event)"
                @neuladen="ladeKachel(offeneKachel, true)" />
        </RadarOverlay>
    </div>
</template>

<style scoped>
/* Die beiden Ansichtsknöpfe rücken zusammen: sie sind eine Entscheidung, nicht
   zwei Befehle. */
.ltAnsicht { display: flex; gap: 0.15rem; }

.radarWrap {
    display: flex;
    flex-direction: column;
    /* Wie der Marktradar: keine feste Höhe, das Raster darf wachsen. */
    min-height: 300px;
}
</style>
