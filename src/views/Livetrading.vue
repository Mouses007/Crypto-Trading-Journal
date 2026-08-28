<script setup>
/**
 * Live-Trading-Fenster — der Arbeitsplatz für die Stunden, in denen tatsächlich
 * gehandelt wird.
 *
 * Gleiche Aufgabenteilung wie im Marktradar: **die Seite holt, die Kachel
 * zeichnet** — beide benutzen dafür dasselbe Composable. Eigen ist nur, WAS
 * hier steht und wie schnell: eigene Registry (`src/config/livetrading.js`),
 * eigener localStorage-Schlüssel, und ein Prüftakt von drei statt dreissig
 * Sekunden, damit auch eine Kachel mit fünf Sekunden Intervall pünktlich
 * nachlädt. Teuer wird das nicht — der Takt prüft nur, geholt wird weiterhin
 * erst, wenn das `intervallMs` der einzelnen Kachel abgelaufen ist.
 *
 * Die Seite lässt sich in den Einstellungen abschalten (`livetradingAn`). Die
 * Prüfung sitzt bewusst hier und nicht im Router: beim ersten Aufruf eines
 * Deep-Links sind die Einstellungen unter Umständen noch nicht geladen, und
 * ein Router-Guard würde dann fälschlich umleiten.
 */
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import PageInfo from '../components/PageInfo.vue'
import RadarKachel from '../components/RadarKachel.vue'
import RadarOverlay from '../components/RadarOverlay.vue'
import SitzungsLeiste from '../components/livetrading/SitzungsLeiste.vue'
import SymbolWahl from '../components/livetrading/SymbolWahl.vue'
import KachelHandelszeiten from '../components/radar/KachelHandelszeiten.vue'
import KachelMechanik from '../components/radar/KachelMechanik.vue'
import KachelLiqTicker from '../components/radar/KachelLiqTicker.vue'
import KachelPositionen from '../components/radar/KachelPositionen.vue'
import KachelKalenderCountdown from '../components/radar/KachelKalenderCountdown.vue'
import KachelIndizes from '../components/radar/KachelIndizes.vue'
import KachelFunding from '../components/radar/KachelFunding.vue'
import KachelLsOi from '../components/radar/KachelLsOi.vue'
import KachelMakro from '../components/radar/KachelMakro.vue'
import KachelBookmap from '../components/radar/KachelBookmap.vue'
import KachelHebelkarte from '../components/radar/KachelHebelkarte.vue'
import KachelLage from '../components/radar/KachelLage.vue'
import { liveSymbol } from '../stores/live.js'
import { currentUser } from '../stores/globals.js'
import { useIstTelefon, useImVollbild } from '../utils/geraet.js'
import { oeffneLivetradingFenster } from '../utils/livetradingFenster.js'
import { speichereCockpitFoto } from '../utils/cockpitFoto.js'
import { kopiertesBild } from '../stores/ui.js'
import { aktiveSitzung, merkeSymbol, protokolliere } from '../stores/livetrading.js'
import PultAnsicht from '../components/livetrading/PultAnsicht.vue'
import { KACHELN, sortiereKacheln } from '../config/livetrading.js'
import { PULT_KACHELN } from '../config/pult.js'
import { useKachelRaster } from '../composables/useKachelRaster.js'

const { t } = useI18n()
const router = useRouter()

/** Kachel-Id → Komponente. Neue Kacheln werden hier eingehängt. */
const KOMPONENTEN = {
    handelszeiten: KachelHandelszeiten,
    mechanik: KachelMechanik,
    liqticker: KachelLiqTicker,
    positionen: KachelPositionen,
    kalender: KachelKalenderCountdown,
    indizes: KachelIndizes,
    funding: KachelFunding,
    lsoi: KachelLsOi,
    makro: KachelMakro,
    bookmap: KachelBookmap,
    hebelkarte: KachelHebelkarte,
    lage: KachelLage,
}

/**
 * Abrufparameter, die vom Zustand der Seite abhängen.
 *
 * Die Positionen-Kachel braucht den Zeitraum und die Plangrenzen der laufenden
 * Sitzung. Läuft keine, wird der heutige Tagesbeginn genommen — offene
 * Positionen und das Tagesergebnis will man auch dann sehen, wenn man noch
 * keine Sitzung gestartet hat. Der Tagesbeginn kommt bewusst aus dem Browser:
 * der kennt die Zeitzone des Nutzers, der Server müsste sie erst nachschlagen.
 */
function zusatzParams(kachel) {
    if (!kachel.sitzungAbhaengig) return null
    const s = aktiveSitzung.value
    if (s) {
        return {
            von: Number(s.startUnix),
            maxVerlust: Number(s.planMaxVerlustUsd) || 0,
            maxTrades: Number(s.planMaxTrades) || 0,
        }
    }
    const tagesbeginn = new Date()
    tagesbeginn.setHours(0, 0, 0, 0)
    return { von: tagesbeginn.getTime() }
}

/**
 * Welche der beiden Darstellungen läuft.
 *
 * Raster = Werkstatt (alles gleichrangig, alles verstellbar), Pult = Gerät
 * (feste Rangfolge, nichts verstellbar). Zwei Formen derselben Daten, nicht
 * zwei Seiten: beide hängen an derselben `useKachelRaster`-Instanz, ein Wechsel
 * kostet keinen Abruf.
 *
 * Gemerkt wird pro Gerät in `localStorage` und NICHT in den Einstellungen: der
 * Wechsel ist auch mitten in einer Sitzung sinnvoll, und was man während der
 * Arbeit umschaltet, gehört an die Seite. (Die Vorlage dafür ist
 * `radarNewsLayout` — dort gilt bewusst das Gegenteil, weil man ein
 * Nachrichten-Layout nicht zwischen zwei Berichten umwerfen soll.)
 */
const ANSICHT_KEY = 'livetrading_ansicht'
const ansicht = ref(localStorage.getItem(ANSICHT_KEY) === 'pult' ? 'pult' : 'raster')

function waehleAnsicht(wert) {
    ansicht.value = wert
    localStorage.setItem(ANSICHT_KEY, wert)
}

/*
 * Das Pult hat feste Instrumente und kennt das Ausblenden nicht. Ohne diese
 * Liste entschiede das Raster mit, was das Pult sehen darf — wer dort die
 * Makro-Kachel ausblendet, bekäme hier ein leeres Instrument ohne Hinweis auf
 * den Grund. Im Raster bleibt die Liste leer, damit ausgeblendete Kacheln wie
 * bisher gar nicht erst geholt werden.
 */
const immerLaden = computed(() => ansicht.value === 'pult' ? PULT_KACHELN : [])

const {
    gridEl, daten, zustand, stand, fehler, kachelParams,
    alleKacheln, sichtbareKacheln, gesamtZustand,
    offeneKachel, offeneDefinition, showConfigDropdown, configRef,
    ladeKachel, ladeFaellige, beiUmschalten, isVisible, setzeKachelZustand,
    setzeParams, setzeAnzeige, stilFuer, starteGroesse, setzeGroesseZurueck,
} = useKachelRaster({
    storageKey: 'livetrading_hidden_cards',
    paramKey: 'livetrading_params',
    kacheln: KACHELN,
    sortiere: sortiereKacheln,
    symbolRef: liveSymbol,
    zusatzParams,
    taktMs: 3000,
    immerLaden,
})

/**
 * Startet oder endet eine Sitzung, muss die Positionen-Kachel sofort neu
 * rechnen — sonst zeigte sie bis zum nächsten Takt noch den Tagesbeginn als
 * Bezug, obwohl gerade eine Sitzung begonnen hat.
 */
watch(() => aktiveSitzung.value?.objectId, () => ladeKachel('positionen', true))

/**
 * Symbolwechsel während einer laufenden Sitzung festhalten.
 *
 * Eine Sitzung ist ein Zeitraum, kein Markt — man sieht sich mehrere Münzen an.
 * Damit sie hinterher trotzdem nachvollziehbar und nachspielbar bleibt, wandert
 * jeder Wechsel ins Protokoll, und `symbol` folgt der zuletzt gewählten.
 */
watch(liveSymbol, (s) => merkeSymbol(s))

/**
 * Abschalter. `immediate` deckt den Fall ab, dass die Einstellungen schon da
 * sind; der Watch den Fall, dass sie erst nachträglich eintreffen. Solange
 * `currentUser` null ist, wird NICHT umgeleitet — Unwissen ist kein Nein.
 */
watch(currentUser, (u) => {
    if (u && Number(u.livetradingAn ?? 1) === 0) router.replace('/marktradar')
}, { immediate: true })

/**
 * Am Telefon gibt es diese Seite nicht.
 *
 * Kein Geschmacksurteil: zwölf Kacheln, ein Orderbuch und ein Kerzenchart
 * lassen sich auf 375 Pixeln nicht bedienen. Ein Werkzeug, das dort nur halb
 * funktioniert, führt zu Entscheidungen auf halber Information — und das ist
 * beim Handeln teurer als kein Werkzeug. Wer trotzdem den Direktlink aufruft,
 * landet auf dem Marktradar, der für kleine Geräte gebaut ist.
 *
 * Bewusst NICHT an `screenType`: das misst nur die Breite, und ein
 * Desktop-Browser in einem halb breiten Fenster wäre damit ein Telefon. Beim
 * Entwickeln hat genau das einen frisch geöffneten, noch nicht vermessenen Tab
 * hinausgeworfen. `useIstTelefon` verlangt zusätzlich einen groben Zeiger.
 */
const istTelefon = useIstTelefon()
watch(istTelefon, (ja) => {
    if (ja) router.replace('/marktradar')
}, { immediate: true })

// ── Cockpit: eigenes Fenster ohne Menü und Navigation ───────────────────
const route = useRoute()
const istCockpit = computed(() => String(route.query?.cockpit || '') === '1')
const imVollbild = useImVollbild()

/**
 * Kahler Zustand: Kopfzeile und Sitzungsleiste fahren nach oben aus dem Bild
 * und kommen bei Mauskontakt am oberen Rand zurück.
 *
 * Gilt für BEIDE Wege in die freie Fläche — Vollbild **und** eigenes Fenster.
 * Das hing zuerst nur am Vollbild, und dadurch sah das Fenster nach dem
 * Sitzungsstart aus wie vorher: Menü und Navigation waren weg, aber die
 * Kopfzeile stand weiter da. Ein eigenes Fenster kann sich nicht selbst ins
 * Vollbild schalten (die Fullscreen-API verlangt eine Geste in genau diesem
 * Dokument), also muss es ohne Vollbild schon aufgeräumt aussehen.
 */
const kahl = computed(() => imVollbild.value || istCockpit.value)

/**
 * Der Knopf oben öffnet dasselbe Fenster wie der Sitzungsstart.
 *
 * Er rief vorher die Fullscreen-API auf — das war der falsche Weg. Gewollt ist
 * das aufgeräumte eigene Fenster ohne Seitenmenü, Navigation und obere Leisten,
 * und dafür braucht es kein Vollbild des Browsers. Der Weg ist damit für beide
 * Auslöser derselbe, und was der Browser mit der Fullscreen-API erlaubt oder
 * ablehnt, spielt keine Rolle mehr.
 */
const oeffneFenster = () => oeffneLivetradingFenster()

// ── Cockpit-Schnappschuss: ein Frame des Fensters ins Journal ────────────
//
// Der Browser fragt einmal, welches Fenster geteilt wird — danach liegt das
// Bild als Screenshot (Symbol + Zeitstempel) in der Setup-Galerie und in der
// Tagesansicht, am selben Tag wie der später importierte Trade. Läuft gerade
// eine Sitzung, wandert die Aufnahme zusätzlich ins Sitzungsprotokoll.
const fotoZustand = ref('')   // '' | 'laeuft' | 'ok' | 'fehler'
const fotoMeldung = ref('')

async function cockpitFoto() {
    if (fotoZustand.value === 'laeuft') return
    fotoZustand.value = 'laeuft'
    fotoMeldung.value = ''
    try {
        const { objectId, name } = await speichereCockpitFoto(liveSymbol.value)
        protokolliere('foto', name)
        // Direkt in die interne Zwischenablage legen: so kann man ohne Umweg über
        // die Galerie gleich zu „Pendente Trades" gehen und „Kopiertes Bild
        // einfügen" drücken.
        if (objectId) {
            const merk = { objectId, name }
            kopiertesBild.value = merk
            try { sessionStorage.setItem('kopiertesBild', JSON.stringify(merk)) } catch (e) { /* ignore */ }
        }
        fotoZustand.value = 'ok'
        setTimeout(() => { if (fotoZustand.value === 'ok') fotoZustand.value = '' }, 2500)
    } catch (e) {
        // Den Auswahldialog wegzuklicken ist eine Entscheidung, kein Fehler.
        if (e?.name === 'NotAllowedError') { fotoZustand.value = ''; return }
        fotoZustand.value = 'fehler'
        fotoMeldung.value = e?.response?.data?.error || e?.message || t('livetrading.foto.fehler')
    }
}

/** Kacheln, die sich selbst versorgen, haben nie eine `daten`-Nutzlast. */
const eigenstaendig = (kachel) => !kachel.endpunkt

/**
 * Kacheln, deren Inhalt bedient wird: kein Klick-zum-Vergrössern, keine Lupe.
 * `gross: false` in der Registry bedeutet genau das — die Gross-Ansicht wäre
 * eine zweite Instanz und damit eine zweite Datenverbindung.
 */
const interaktiv = (kachel) => kachel.gross === false
</script>

<template>
    <div class="radarWrap" :class="{ vollbildKahl: kahl }">
        <!-- Im Vollbild fährt dieser Block nach oben aus dem Bild und kommt
             zurück, sobald die Maus den oberen Rand berührt. Wegwerfen kann man
             ihn nicht: hier hängen Symbolwahl, Sitzungsstart und der Weg aus dem
             Vollbild heraus. -->
        <div class="ltKopf">
        <div class="liveHeader">
            <div class="liveTitle">
                <span class="liveSymbol">{{ t('livetrading.title') }}</span>
                <span :class="['liveDot', 'dot-' + gesamtZustand]"></span>
                <span class="liveState">{{ t('marktradar.status_' + gesamtZustand) }}</span>
            </div>

            <!-- Mittig, weil das Symbol die ganze Seite steuert: Bookmap,
                 Hebelkarte, Mechanik, Long/Short und die KI-Lage hängen daran.
                 Im eigenen Fenster gibt es kein Seitenmenü, in dem es sonst
                 stünde. -->
            <div class="ltSymbolMitte">
                <SymbolWahl />
            </div>
            <div class="liveActions">
                <!-- Zwei Formen derselben Daten. Der Umschalter steht ganz
                     links in der Knopfreihe, weil er die Bedeutung aller
                     folgenden Knöpfe verändert. -->
                <div class="ltAnsicht">
                    <button type="button" :class="['ctl-pill', ansicht === 'raster' ? 'active' : '']"
                        :title="t('livetrading.ansicht.rasterSub')" @click="waehleAnsicht('raster')">
                        <i class="uil uil-apps"></i>{{ t('livetrading.ansicht.raster') }}
                    </button>
                    <button type="button" :class="['ctl-pill', ansicht === 'pult' ? 'active' : '']"
                        :title="t('livetrading.ansicht.pultSub')" @click="waehleAnsicht('pult')">
                        <i class="uil uil-sliders-v-alt"></i>{{ t('livetrading.ansicht.pult') }}
                    </button>
                </div>
                <span class="ctl-sep"></span>
                <!-- Sichtbarkeit ist eine Rasterfrage: das Pult hat feste
                     Instrumente und kennt kein Ausblenden. -->
                <div v-if="ansicht === 'raster'" ref="configRef" class="position-relative">
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
                <button type="button" class="ctl-pill" :class="{ fotoOk: fotoZustand === 'ok' }"
                    :disabled="fotoZustand === 'laeuft'" :title="t('livetrading.foto.hinweis')"
                    @click="cockpitFoto">
                    <i class="uil" :class="fotoZustand === 'ok' ? 'uil-check' : 'uil-camera'"></i>
                    {{ fotoZustand === 'ok' ? t('livetrading.foto.gespeichert') : t('livetrading.foto.knopf') }}
                </button>
                <!-- Nur ausserhalb des eigenen Fensters: dort ist man schon. -->
                <button v-if="!istCockpit" type="button" class="ctl-pill" @click="oeffneFenster">
                    <i class="uil uil-expand-arrows-alt"></i>{{ t('livetrading.vollbild') }}
                </button>
                <a v-if="istCockpit" class="ctl-pill" href="/marktradar">
                    <i class="uil uil-arrow-left"></i>{{ t('livetrading.zumJournal') }}
                </a>
                <span class="ctl-sep"></span>
                <PageInfo section="info.livetrading" />
            </div>
        </div>

        <div v-if="fotoZustand === 'fehler'" class="fotoFehler">
            <i class="uil uil-exclamation-triangle"></i>{{ fotoMeldung }}
            <button type="button" class="radarCardBtn" @click="fotoZustand = ''; fotoMeldung = ''">
                <i class="uil uil-times"></i>
            </button>
        </div>

        <SitzungsLeiste />
        </div>

        <!--
            `v-if` und nicht `v-show`: Bookmap und Hebelkarte hängen an eigenen
            WebSockets mit einem Modul-Singleton für den Einfrier-Zustand. Zwei
            gleichzeitig lebende Instanzen wären zwei Verbindungen auf denselben
            Zustand. Der Preis ist ein Verbindungsaufbau beim Umschalten — er
            steht am Zustandspunkt, und das ist die ehrlichere Anzeige.
        -->
        <PultAnsicht v-if="ansicht === 'pult'" :daten="daten" :zustand="zustand" :stand="stand"
            :kachel-params="kachelParams" :komponenten="KOMPONENTEN" :symbol="liveSymbol"
            @params="setzeParams" @anzeige="setzeAnzeige"
            @zustand="(id, z, extra) => setzeKachelZustand(id, z, extra)"
            @neuladen="(id) => ladeKachel(id, true)" />

        <div v-else ref="gridEl" class="radarGrid">
            <div v-for="kachel in sichtbareKacheln" :key="kachel.id" :data-kachel="kachel.id"
                :style="stilFuer(kachel)">
                <RadarKachel :titel="t(kachel.titleKey)" :icon="kachel.icon" :info-key="kachel.infoKey" :zustand="zustand[kachel.id] || 'idle'"
                    :stand="stand[kachel.id] || 0" :fehler="fehler[kachel.id] || ''" :hat-daten="!!daten[kachel.id]"
                    :eigenstaendig="eigenstaendig(kachel)" :interaktiv="interaktiv(kachel)"
                    @gross="offeneKachel = kachel.id" @neuladen="ladeKachel(kachel.id, true)"
                    @groesse-start="starteGroesse(kachel, $event)" @groesse-zurueck="setzeGroesseZurueck(kachel)">
                    <!-- `neuladen` aus der Kachel heraus: die KI-Lage erzeugt
                         ihren Text selbst per POST und will danach den frischen
                         Stand sehen. -->
                    <component :is="KOMPONENTEN[kachel.id]" :daten="daten[kachel.id]" :gross="false"
                        :params="kachelParams[kachel.id] || {}"
                        @params="setzeParams(kachel.id, $event)"
                        @anzeige="setzeAnzeige(kachel.id, $event)"
                        @zustand="(z, extra) => setzeKachelZustand(kachel.id, z, extra)"
                        @neuladen="ladeKachel(kachel.id, true)" />
                </RadarKachel>
            </div>
        </div>

        <div v-if="ansicht === 'raster' && !sichtbareKacheln.length" class="radarLeer">
            {{ t('marktradar.allHidden') }}
        </div>

        <!-- Gross: dieselbe Komponente, dieselben Daten, nur mit mehr Platz -->
        <RadarOverlay v-if="ansicht === 'raster' && offeneKachel && (daten[offeneKachel] || !offeneDefinition?.endpunkt)"
            :titel="t(offeneDefinition.titleKey)"
            :info-key="offeneDefinition.infoKey" :quelle="offeneDefinition.quelle" @schliessen="offeneKachel = null">
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
    /* Wie der Marktradar: keine feste Höhe, das Raster darf wachsen. */
    min-height: 300px;
}

/*
 * Vollbild: Kopfzeile und Sitzungsleiste fahren nach oben aus dem Bild.
 *
 * Wegwerfen wäre falsch — dort hängen Symbolwahl, Sitzungsstart und der Weg aus
 * dem Vollbild heraus. Stattdessen bleibt ein schmaler Streifen stehen; berührt
 * die Maus ihn, kommt der ganze Block zurück. Dasselbe Verhalten kennt man von
 * Videoplayern und Editoren im Vollbild.
 *
 * Der Streifen ist bewusst 6 px hoch und nicht 0: ein Block, der vollständig
 * verschwindet, ist mit der Maus nicht mehr zu treffen, und dann käme man ohne
 * Tastatur nicht mehr an die Bedienung.
 */
.vollbildKahl .ltKopf {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 40;
    padding: 0 0.6rem 0.4rem;
    background: var(--black-bg, #0d0d14);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    transform: translateY(calc(-100% + 6px));
    transition: transform 0.18s ease;
}

.vollbildKahl .ltKopf:hover,
.vollbildKahl .ltKopf:focus-within {
    transform: translateY(0);
}

/* Ohne diesen Ausgleich läge die erste Kachelreihe unter dem Streifen. */
.vollbildKahl .radarGrid {
    margin-top: 8px;
}

/*
 * Im kahlen Zustand ist die Kopfzeile ausgefahren — das Pult darf den Platz
 * haben. Die Höhe steht hier und nicht in der Komponente, weil nur die Seite
 * weiss, wie viel über ihr steht: mit Kopfzeile und Sitzungsleiste sind es
 * rund 190 px, im eigenen Fenster nur der 6-px-Streifen.
 */
.vollbildKahl .pult {
    margin-top: 8px;
    height: calc(100dvh - 24px);
}

/* Die beiden Ansichtsknöpfe rücken zusammen: sie sind eine Entscheidung, nicht
   zwei Befehle. */
.ltAnsicht { display: flex; gap: 0.15rem; }

.fotoOk { color: #4ec9a0; }

.fotoFehler {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.82rem;
    color: #ff6b7a;
    padding: 0.3rem 0.5rem;
    margin-bottom: 0.4rem;
    border-radius: var(--border-radius);
    background: rgba(220, 53, 69, 0.12);
}

.fotoFehler .radarCardBtn { margin-left: auto; }

/* Absolut zentriert statt per Flex: die Kopfzeile hat links den Titel und
   rechts die Knöpfe, und die sind verschieden breit — mit `flex: 1` sässe das
   Symbol optisch daneben, nicht in der Mitte. */
.ltSymbolMitte {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    z-index: 5;
}

@media (max-width: 991.98px) {
    /* Kein Platz für drei Blöcke nebeneinander — dann läuft es mit. */
    .ltSymbolMitte {
        position: static;
        transform: none;
    }
}
</style>
