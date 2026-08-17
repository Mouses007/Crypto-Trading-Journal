<script setup>
/**
 * Marktradar — Kachelraster zur Marktlage.
 *
 * Aufgabenteilung: **die Seite holt, die Kachel zeichnet.** Die Gross-Ansicht
 * ist eine zweite Instanz derselben Kachel-Komponente und bekommt dieselben
 * Daten gereicht — ohne diese Trennung würde jedes Aufklappen die Fremdquelle
 * ein zweites Mal fragen.
 *
 * Unsichtbare Kacheln werden gar nicht erst geladen. Ausblenden spart damit
 * nicht nur Platz, sondern auch Anfragen an Fremdquellen.
 */
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import PageInfo from '../components/PageInfo.vue'
import RadarKachel from '../components/RadarKachel.vue'
import RadarOverlay from '../components/RadarOverlay.vue'
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
// Für die Alarm-Einstellungen: currentUser hält den Einstellungssatz
import { currentUser } from '../stores/globals.js'
import { useIstTelefon } from '../utils/geraet.js'
import { oeffneLivetradingFenster } from '../utils/livetradingFenster.js'
import { sendNotification } from '../utils/notify.js'
import { KACHELN, sortiereKacheln } from '../config/marktradar.js'
import { useKachelRaster } from '../composables/useKachelRaster.js'

const { t } = useI18n()

/** Kachel-Id → Komponente. Neue Kacheln werden hier eingehängt. */
const KOMPONENTEN = {
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

const PARAM_KEY = 'marktradar_params'
/**
 * Einmalige Umstellung: wer die Seite vor der Vereinheitlichung benutzt hat,
 * trägt noch eine eigene Ranglisten-Grösse im Speicher — die würde die neue
 * Vorgabe (Top 50) für immer überstimmen. Der Marker sorgt dafür, dass genau
 * einmal aufgeräumt wird, ohne die übrigen Einstellungen anzutasten.
 *
 * Läuft direkt auf dem localStorage und VOR `useKachelRaster`, weil das
 * Composable die Parameter beim Aufsetzen einliest — danach wäre es zu spät.
 */
const PARAM_VERSION = '2'
function migriereParams() {
    if (localStorage.getItem(PARAM_KEY + '_v') === PARAM_VERSION) return
    let roh = null
    try { roh = JSON.parse(localStorage.getItem(PARAM_KEY) || 'null') } catch { roh = null }
    if (roh && typeof roh === 'object' && !Array.isArray(roh)) {
        for (const eintrag of Object.values(roh)) {
            if (eintrag && typeof eintrag === 'object') delete eintrag.n
        }
        localStorage.setItem(PARAM_KEY, JSON.stringify(roh))
    }
    localStorage.setItem(PARAM_KEY + '_v', PARAM_VERSION)
}
migriereParams()

/**
 * Der Knopf ins Live-Trading-Fenster. Zwei Bedingungen: der Nutzer hat es nicht
 * abgeschaltet, und wir sitzen nicht an einem Telefon — dort gibt es die Seite
 * gar nicht, und ein Knopf ins Nichts wäre schlimmer als keiner.
 */
const istTelefon = useIstTelefon()
const livetradingSichtbar = computed(() =>
    Number(currentUser.value?.livetradingAn ?? 1) === 1 && !istTelefon.value)

const oeffneLivetrading = () => oeffneLivetradingFenster()

const {
    gridEl, daten, zustand, stand, fehler, kachelParams,
    alleKacheln, sichtbareKacheln, gesamtZustand,
    offeneKachel, offeneDefinition, showConfigDropdown, configRef,
    ladeKachel, ladeFaellige, beiUmschalten, isVisible,
    setzeParams, setzeAnzeige, stilFuer, starteGroesse, setzeGroesseZurueck,
} = useKachelRaster({
    storageKey: 'marktradar_hidden_cards',
    paramKey: PARAM_KEY,
    kacheln: KACHELN,
    sortiere: sortiereKacheln,
    symbolRef: liveSymbol,
})

/**
 * Pi-Cycle-Alarm. Die Kreuzung der 111-Tage- über die doppelte 350-Tage-Linie
 * ist ein Ereignis, das man nicht verpassen will — und das im Zweifel eintritt,
 * während man etwas anderes tut. Deshalb einmal je Kreuzung eine
 * Benachrichtigung; der Merker verhindert, dass sie bei jedem Seitenaufruf
 * erneut kommt.
 */
const ALARM_KEY = 'marktradar_picycle_alarm'
const VORWARN_KEY = 'marktradar_picycle_vorwarnung'

watch(() => daten.picycle, (d) => {
    // Ob überhaupt gemeldet wird, steht in der Kanalwahl unter
    // Einstellungen → Benachrichtigungen. Der alte Einzelschalter
    // `radarPicycleAlarm` ist beim Umbau einmalig dorthin übernommen worden.
    if (!d) return

    // 1. Die Kreuzung selbst — einmal je Ereignis
    if (d.frisch && d.letzteKreuzung) {
        const marke = String(d.letzteKreuzung.t)
        if (localStorage.getItem(ALARM_KEY) !== marke) {
            localStorage.setItem(ALARM_KEY, marke)
            sendNotification(
                'picycleKreuzung',
                t('marktradar.picycle.title'),
                t('marktradar.picycle.alarm', { datum: new Date(d.letzteKreuzung.t).toLocaleDateString() }),
            )
        }
        return
    }

    /*
     * 2. Vorwarnung, bevor es so weit ist.
     *
     * Die Kreuzung selbst zu melden ist zwar korrekt, kommt aber per
     * Definition zu spät — sie IST das Signal. Wer eine Schwelle setzt,
     * bekommt Vorlauf: nähert sich der Abstand von unten der eingestellten
     * Grenze, meldet sich der Alarm einmal. Der Merker enthält die Schwelle,
     * damit ein Herabsetzen erneut auslösen darf, ein Seitenaufruf aber nicht.
     */
    const schwelle = Number(currentUser.value?.radarPicycleSchwelle ?? 0)
    if (!schwelle || d.jetzt?.abstandPct == null) return
    if (d.jetzt.abstandPct < -schwelle) {
        // Wieder weiter entfernt: Merker löschen, damit die nächste Annäherung zählt
        if (localStorage.getItem(VORWARN_KEY)) localStorage.removeItem(VORWARN_KEY)
        return
    }
    const merker = `${schwelle}|${new Date().getFullYear()}`
    if (localStorage.getItem(VORWARN_KEY) === merker) return
    localStorage.setItem(VORWARN_KEY, merker)
    sendNotification(
        'picycleVorwarnung',
        t('marktradar.picycle.title'),
        t('marktradar.picycle.vorwarnung', { pct: Math.abs(d.jetzt.abstandPct), schwelle }),
    )
})

/**
 * Funding-Divergenz-Alarm.
 *
 * Arbitrage hält die Funding-Raten der Börsen normalerweise zusammen. Laufen
 * sie bei einem BEOBACHTETEN Markt auseinander, sitzt die überfüllte Seite auf
 * einer Börse allein — dort zündet eine Auflösung zuerst. Bewusst nicht der
 * ganze Markt: in Mikro-Werten weichen die Raten dauernd ab, ohne dass es
 * einen betrifft. Welche Märkte beobachtet werden, steht in den Einstellungen
 * (leer = die eigenen); die Auswahl trifft der Server, hier steht nur die
 * Entprellung.
 *
 * Der Merker trägt Symbol und Vorzeichen der Abweichung. Damit meldet sich
 * derselbe Zustand nicht bei jedem Abruf erneut, ein Wechsel der Richtung
 * (Binance war teurer, jetzt ist es Bybit) aber schon. Fällt die Abweichung
 * unter die Schwelle, wird der Merker gelöscht und der Markt darf erneut melden.
 */
const DIVERGENZ_KEY = 'marktradar_funding_divergenz'

watch(() => daten.funding, (d) => {
    const schwelle = Number(currentUser.value?.radarFundingDivergenz ?? 15)
    if (!d || !schwelle) return

    let merker = {}
    try { merker = JSON.parse(localStorage.getItem(DIVERGENZ_KEY) || '{}') } catch { merker = {} }

    const gemeldet = { ...merker }
    for (const r of d.divergenzMaerkte || []) {
        const delta = r.delta
        // Schwelle in Prozentpunkten, Daten als Dezimalbruch
        const punkte = delta == null ? 0 : Math.abs(delta) * 100

        /*
         * Hysterese. Ein Wert, der um die Schwelle pendelt (beobachtet: ADA
         * bei knapp 11 Punkten), würde sonst bei jedem Abruf abwechselnd
         * verfallen und neu melden. Scharf geschaltet wird erst wieder
         * deutlich unterhalb; dazwischen passiert schlicht nichts.
         */
        if (punkte < schwelle * 0.7) {
            delete gemeldet[r.symbol]
            continue
        }
        if (punkte < schwelle) continue

        const richtung = delta > 0 ? 'binance' : 'bybit'
        if (gemeldet[r.symbol] === richtung) continue
        gemeldet[r.symbol] = richtung

        // Unterschiedliche Vorzeichen sind der stärkste Fall: die Börsen sind
        // sich nicht einig, WELCHE Seite überfüllt ist
        const gegensaetzlich = r.binance != null && r.bybit != null
            && Math.sign(r.binance) !== Math.sign(r.bybit)
        sendNotification(
            'fundingDivergenz',
            t('marktradar.funding.divergenzTitel', { symbol: r.symbol.replace(/USDT$/, '') }),
            t(gegensaetzlich ? 'marktradar.funding.divergenzGegensatz' : 'marktradar.funding.divergenzText', {
                binance: (r.binance * 100).toFixed(1),
                bybit: (r.bybit * 100).toFixed(1),
                delta: Math.abs(delta * 100).toFixed(1),
            }),
        )
    }
    localStorage.setItem(DIVERGENZ_KEY, JSON.stringify(gemeldet))
})

</script>

<template>
    <div class="radarWrap">
        <div class="liveHeader">
            <div class="liveTitle">
                <span class="liveSymbol">{{ t('marktradar.title') }}</span>
                <span :class="['liveDot', 'dot-' + gesamtZustand]"></span>
                <span class="liveState">{{ t('marktradar.status_' + gesamtZustand) }}</span>
            </div>
            <div class="liveActions">
                <div ref="configRef" class="position-relative">
                    <button type="button" class="ctl-pill" @click="showConfigDropdown = !showConfigDropdown">
                        <i class="uil uil-apps"></i>{{ t('marktradar.cards') }}
                    </button>
                    <div v-if="showConfigDropdown" class="card-config-dropdown">
                        <div class="card-config-title">{{ t('auswertung.visibleCards') }}</div>
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
                <!-- Öffnet ein eigenes Fenster (siehe `oeffneLivetrading`).
                     Nur am Desktop: der Arbeitsplatz braucht Platz. -->
                <button v-if="livetradingSichtbar" type="button" class="ctl-pill" @click="oeffneLivetrading">
                    <i class="uil uil-crosshairs"></i>{{ t('livetrading.start') }}
                </button>
                <span class="ctl-sep"></span>
                <PageInfo section="info.marktradar" />
            </div>
        </div>

        <div ref="gridEl" class="radarGrid">
            <div v-for="kachel in sichtbareKacheln" :key="kachel.id" :data-kachel="kachel.id"
                :style="stilFuer(kachel)">
                <RadarKachel :titel="t(kachel.titleKey)" :icon="kachel.icon" :zustand="zustand[kachel.id] || 'idle'"
                    :stand="stand[kachel.id] || 0" :fehler="fehler[kachel.id] || ''" :hat-daten="!!daten[kachel.id]"
                    @gross="offeneKachel = kachel.id" @neuladen="ladeKachel(kachel.id, true)"
                    @groesse-start="starteGroesse(kachel, $event)" @groesse-zurueck="setzeGroesseZurueck(kachel)">
                    <!-- `neuladen` aus der Kachel heraus: eine Kachel, die selbst
                         etwas erzeugt hat (Lagebild), lässt die Seite ihre Daten
                         neu lesen — sonst zeigte die Gross-Ansicht als zweite
                         Instanz weiter den alten Stand. -->
                    <component :is="KOMPONENTEN[kachel.id]" :daten="daten[kachel.id]" :gross="false"
                        :params="kachelParams[kachel.id] || {}"
                        @params="setzeParams(kachel.id, $event)"
                        @anzeige="setzeAnzeige(kachel.id, $event)"
                        @neuladen="ladeKachel(kachel.id, true)" />
                </RadarKachel>
            </div>
        </div>

        <div v-if="!sichtbareKacheln.length" class="radarLeer">{{ t('marktradar.allHidden') }}</div>

        <!-- Gross: dieselbe Komponente, dieselben Daten, nur mit mehr Platz -->
        <RadarOverlay v-if="offeneKachel && daten[offeneKachel]" :titel="t(offeneDefinition.titleKey)"
            :quelle="offeneDefinition.quelle" @schliessen="offeneKachel = null">
            <component :is="KOMPONENTEN[offeneKachel]" :daten="daten[offeneKachel]" :gross="true"
                :params="kachelParams[offeneKachel] || {}"
                @params="setzeParams(offeneKachel, $event)"
                @anzeige="setzeAnzeige(offeneKachel, $event)"
                @neuladen="ladeKachel(offeneKachel, true)" />
        </RadarOverlay>
    </div>
</template>

<style scoped>
.radarWrap {
    display: flex;
    flex-direction: column;
    /* Anders als die Chart-Seiten hat der Radar keine feste Höhe: das Raster
       darf wachsen und die Seite scrollen. */
    min-height: 300px;
}
</style>
