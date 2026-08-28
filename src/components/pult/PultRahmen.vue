<script setup>
/**
 * Rahmen des Pults — die Form, die sich Live-Trading und Marktradar teilen.
 *
 * ## Wofür das Pult da ist
 *
 * Ein Kachelraster ist eine Werkstatt: alles gleichrangig, alles verstellbar,
 * gut zum Einrichten und Vergleichen. Das Pult ist die Gegenthese — feste
 * Rangfolge, nichts verstellbar ausser der Bühne. Fünf Zonen, feste Höhen,
 * keine Kartenrahmen; getrennt wird durch Rinnen und zwei Ebenen.
 *
 * ```
 * ┌ Band oben ───────────────────────────────────────────┐
 * ├ Band unten ──────────────────────────────────────────┤
 * ├ Bühne ────────────────────────┬ Instrumentenleiste ──┤
 * │                               │                      │
 * ├───────────────────────────────┴──────────────────────┤
 * │ Fuss                                                 │
 * └──────────────────────────────────────────────────────┘
 * ```
 *
 * Die beiden Bänder und der Fuss sind **Slots**: welche Frage dort oben steht,
 * ist das einzige, worin sich die beiden Seiten wirklich unterscheiden. Im
 * Live-Fenster sind es Sitzungsstand und Zeitachse, im Marktradar Stimmung und
 * Zyklus. Alles darunter — Bühnenwahl, Leiste, Alter, Zustandspunkte, die
 * ganze Gestaltung — ist identisch und steht deshalb nur hier.
 *
 * ## Es holt nichts
 *
 * Der Rahmen bekommt `daten`, `zustand` und `stand` aus derselben
 * `useKachelRaster`-Instanz, die auch das Raster der Seite versorgt. Ein
 * Wechsel der Ansicht kostet damit keinen einzigen Abruf, und beide Ansichten
 * sind immer warm. Die Aufgabenteilung des Marktradars gilt unverändert:
 * **die Seite holt, die Darstellung zeichnet.**
 *
 * ## Warum die Bühne `v-if` und `:key` benutzt
 *
 * Bookmap und Hebelkarte hängen an eigenen WebSockets mit einem Modul-Singleton
 * für den Einfrier-Zustand; zwei gleichzeitig lebende Instanzen wären zwei
 * Verbindungen auf denselben Zustand. Der Preis ist ein Verbindungsaufbau beim
 * Umschalten — sichtbar am Zustandspunkt, und das ist die ehrlichere Anzeige.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import InfoTipp from '../InfoTipp.vue'

const props = defineProps({
    /** Nutzlasten aller Kacheln, id-indiziert. */
    daten: { type: Object, required: true },
    zustand: { type: Object, required: true },
    stand: { type: Object, required: true },
    kachelParams: { type: Object, default: () => ({}) },
    /** Kachel-Id → Komponente. Kommt von der Seite, damit es nur eine Zuordnung gibt. */
    komponenten: { type: Object, required: true },
    /** Grosse Arbeitsflächen, umschaltbar: `[{ id, titleKey, icon }]`. */
    buehnen: { type: Array, required: true },
    /**
     * Welche Bühne gerade steht — "controlled": der Rahmen hält diesen
     * Zustand NICHT mehr selbst, er meldet nur `update:buehne` und zeichnet,
     * was ihm gesagt wird.
     *
     * Grund für den Umbau: die ersten beiden Pulte (Live-Trading, Marktradar)
     * haben eine FESTE Bühnenliste, aber die Startseite bietet den ganzen
     * frei konfigurierbaren Kachelkatalog an — welche Kacheln überhaupt als
     * Bühne wählbar sind, ändert sich dort, sobald man im Kachel-Menü etwas
     * aus- oder einblendet. Ein intern verwalteter Zustand kann auf eine sich
     * ändernde Liste nicht reagieren (wählt man z.B. eine Kachel als Bühne und
     * blendet sie dann aus, bliebe der Rahmen auf einer verschwundenen Bühne
     * stehen); ein von aussen kontrollierter Zustand kann es, weil der
     * Aufrufer den Rückfall entscheidet.
     */
    /** Leerer String: keine Bühnenkandidatin sichtbar. Siehe `buehneLeerHinweis`. */
    buehne: { type: String, required: true },
    /**
     * Text für den Fall `buehne === ''`. Bei Live-Trading und Marktradar
     * kommt das nie vor (feste, immer vorhandene Bühnenliste); bei der
     * Startseite kann der Nutzer alle bühnentauglichen Kacheln ausblenden.
     */
    buehneLeerHinweis: { type: String, default: '' },
    /** Instrumente von oben nach unten: `[{ id, titleKey, eigen? }]`. */
    leiste: { type: Array, required: true },
    /** Verdichtete Eigenbauten: `eigen`-Name → Komponente. */
    eigeneKomponenten: { type: Object, default: () => ({}) },
    /**
     * Zusätzliche Props für die Eigenbauten (z.B. das gewählte Symbol). Wird
     * unverändert durchgereicht — der Rahmen weiss nicht, was drin steht.
     */
    kontext: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['params', 'anzeige', 'zustand', 'neuladen', 'update:buehne'])

const { t, te } = useI18n()

/*
 * Lokaler Name fürs Template — spart das Umschreiben aller `buehne`-Stellen
 * dort auf `props.buehne`, und macht an einer Stelle sichtbar, dass es sich
 * um eine reine Durchreichung handelt (kein `ref`, kein eigener Zustand).
 */
const buehne = computed(() => props.buehne)

function waehleBuehne(id) {
    emit('update:buehne', id)
}

/*
 * Eine Uhr für alles. Die Bänder, die Altersangaben und etwaige Countdowns
 * brauchen denselben Zeitpunkt; drei eigene Sekundentakte würden dreimal
 * getrennt neu zeichnen. Im Hintergrund steht sie still — ein Countdown auf
 * einem unsichtbaren Reiter kostet nur.
 */
const jetzt = ref(Date.now())
let uhr = null

function tick() {
    if (!document.hidden) jetzt.value = Date.now()
}

onMounted(() => {
    uhr = setInterval(tick, 1000)
    document.addEventListener('visibilitychange', tick)
})

onBeforeUnmount(() => {
    clearInterval(uhr)
    document.removeEventListener('visibilitychange', tick)
})

/** Alter der Daten eines Instruments, in der gröbsten noch zutreffenden Einheit. */
function alter(id) {
    const s = props.stand[id]
    if (!s) return '—'
    const sek = Math.round((jetzt.value - s) / 1000)
    if (sek < 60) return t('livetrading.pult.vorSek', { n: sek })
    const min = Math.floor(sek / 60)
    if (min < 60) return t('livetrading.pult.vorMin', { n: min })
    return t('livetrading.pult.vorStd', { n: Math.floor(min / 60) })
}

/**
 * Erklärtext eines Instruments. `te()` vor `t()` ist Pflicht: ein fehlender
 * Schlüssel soll NICHTS zeigen statt den Schlüssel selbst — genau der Fehler,
 * durch den monatelang `info.coinRadar.caveat` wörtlich auf der Seite stand.
 */
function infoKey(titleKey) {
    const abgeleitet = titleKey.replace(/\.title$/, '.info')
    return te(abgeleitet) ? abgeleitet : ''
}

defineExpose({ jetzt })
</script>

<template>
    <div class="pult">
        <slot name="bandOben" :jetzt="jetzt" />
        <slot name="bandUnten" :jetzt="jetzt" />

        <div class="pMitte" :class="{ pOhneBuehne: !buehne }">
            <!-- ── Bühne ──────────────────────────────────────────────── -->
            <section v-if="buehne" class="pBuehne">
                <header class="pBuehneKopf">
                    <button v-for="b in buehnen" :key="b.id" type="button"
                        :class="['ctl-pill', buehne === b.id ? 'active' : '']"
                        @click="waehleBuehne(b.id)">
                        <i v-if="b.icon" :class="b.icon"></i>{{ t(b.titleKey) }}
                    </button>
                    <span class="pBuehneStand">
                        <span :class="['liveDot', 'dot-' + (zustand[buehne] || 'idle')]"></span>
                        {{ alter(buehne) }}
                    </span>
                </header>

                <!-- Genau eine Instanz. Siehe Kopfkommentar. -->
                <div class="pBuehneKoerper">
                    <component :is="komponenten[buehne]" :key="buehne" :daten="daten[buehne]" :gross="true"
                        :params="kachelParams[buehne] || {}"
                        @params="emit('params', buehne, $event)"
                        @anzeige="emit('anzeige', buehne, $event)"
                        @zustand="(z, extra) => emit('zustand', buehne, z, extra)"
                        @neuladen="emit('neuladen', buehne)" />
                </div>
            </section>

            <!-- Kein Bühnenkandidat sichtbar (nur bei der Startseite möglich,
                 wo der Nutzer selbst bestimmt, welche Kacheln überhaupt da
                 sind). Die Leiste bekommt dann die volle Breite, siehe
                 `.pMitte.pOhneBuehne` unten. -->
            <section v-else class="pBuehneLeer">
                <i class="uil uil-web-grid"></i>
                <p>{{ buehneLeerHinweis }}</p>
            </section>

            <!-- ── Instrumentenleiste ─────────────────────────────────── -->
            <aside class="pLeiste">
                <section v-for="inst in leiste" :key="inst.id" class="pInst">
                    <header class="pInstKopf">
                        <span class="pInstTitel">{{ t(inst.titleKey) }}</span>
                        <InfoTipp v-if="infoKey(inst.titleKey)" :schluessel="infoKey(inst.titleKey)" />
                        <span class="pInstStand">
                            <span :class="['liveDot', 'dot-' + (zustand[inst.id] || 'idle')]"></span>
                            {{ alter(inst.id) }}
                        </span>
                    </header>
                    <div class="pInstKoerper">
                        <!-- Verdichtete Fassung, wo die Kachel zu gross ist -->
                        <component v-if="inst.eigen" :is="eigeneKomponenten[inst.eigen]"
                            :daten="daten[inst.id]" :jetzt="jetzt" v-bind="kontext" />
                        <!-- Sonst dieselbe Kachel wie im Raster, nur ohne Rahmen -->
                        <component v-else :is="komponenten[inst.id]" :daten="daten[inst.id]" :gross="false"
                            :params="kachelParams[inst.id] || {}"
                            @params="emit('params', inst.id, $event)"
                            @anzeige="emit('anzeige', inst.id, $event)"
                            @neuladen="emit('neuladen', inst.id)" />
                        <div v-if="!daten[inst.id] && zustand[inst.id] === 'error'" class="pInstFehler">
                            {{ t('marktradar.status_error') }}
                        </div>
                    </div>
                </section>
            </aside>
        </div>

        <slot name="fuss" :jetzt="jetzt" />
    </div>
</template>

<style scoped>
/*
 * Kein Kartenrahmen, kein Schatten, keine Rundung. Getrennt wird ausschliesslich
 * durch Haarlinien, die bis an den Rand laufen — das ist der sichtbare
 * Unterschied zum Raster: dort ist jede Kachel ein Objekt, hier ist die ganze
 * Fläche ein Gerät.
 */
.pult {
    /*
     * Trennmittel des ganzen Pults, an EINER Stelle.
     *
     * Es gibt keine Karten und keine Schatten — getrennt wird ausschliesslich
     * durch Rinnen und zwei Ebenen. Damit hängt die Lesbarkeit der gesamten
     * Ansicht an diesen vier Werten, und sie gehören deshalb nicht als
     * Literale in fünf Dateien verstreut. Kindkomponenten erben sie über die
     * Kaskade, auch durch `scoped` hindurch.
     *
     * `--pTrenn` trennt FELDER (sichtbar, das ist der Sinn), `--pTrennFein`
     * gliedert INNERHALB eines Feldes (darf man übersehen).
     */
    --pTrenn: rgba(255, 255, 255, 0.16);
    --pTrennFein: rgba(255, 255, 255, 0.07);
    /* Zwei Ebenen: Gerät (Beschriftung, Instrumente) und Arbeitsfläche (Bühne). */
    --pChrom: hsl(0, 0%, 5%);
    --pFlaeche: hsl(0, 0%, 0%);
    /* Beschriftungsband über jedem Instrument — macht den Feldanfang sichtbar,
       ohne dass daraus wieder eine Karte wird. */
    --pBand: rgba(255, 255, 255, 0.035);

    display: flex;
    flex-direction: column;
    /* dvh statt vh: auf Geräten mit einfahrender Adressleiste misst vh falsch */
    height: calc(100dvh - 190px);
    min-height: 560px;
    border: 1px solid var(--white-18);
    border-radius: var(--border-radius);
    background: var(--pChrom);
    overflow: hidden;
}

.pMitte {
    display: grid;
    /* Die Bühne bekommt deutlich mehr — sie ist der Grund, warum man hier sitzt */
    grid-template-columns: 1.42fr minmax(300px, 1fr);
    flex: 1 1 auto;
    min-height: 0;
}

/* Keine Bühne (nur Startseite): die Leiste nimmt die volle Breite, damit
   nichts unsichtbar wird, nur weil keine Kachel als Fläche taugt. */
.pMitte.pOhneBuehne {
    grid-template-columns: 1fr;
}

.pBuehneLeer {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 200px;
    padding: 2rem;
    color: var(--white-38);
    border-right: 1px solid var(--pTrenn);
}

.pBuehneLeer i { font-size: 1.6rem; }
.pBuehneLeer p { max-width: 32ch; text-align: center; font-size: 0.82rem; margin: 0; }

.pMitte.pOhneBuehne .pBuehneLeer { display: none; }

/* ── Bühne ──────────────────────────────────────────────────────────── */
.pBuehne {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border-right: 1px solid var(--pTrenn);
}

.pBuehneKopf {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0.45rem;
    border-bottom: 1px solid var(--pTrenn);
    background: var(--pBand);
}

.pBuehneKopf .ctl-pill { padding: 0.1rem 0.55rem; font-size: 0.74rem; }

.pBuehneStand {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.68rem;
    font-variant-numeric: tabular-nums;
    color: var(--white-38);
}

/* `min-height: 0` ist Pflicht, sonst wächst die Canvas-Kachel aus dem Raster
   heraus statt sich einzupassen. */
.pBuehneKoerper {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    /* Zweite Ebene: die Arbeitsfläche liegt tiefer als das Gerät drumherum.
       Das trennt Bühne und Leiste schon ohne die Rinne dazwischen. */
    background: var(--pFlaeche);
}

/* ── Instrumentenleiste ─────────────────────────────────────────────── */
.pLeiste {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
}

/*
 * `flex: none` ist hier kein Feinschliff, sondern der Unterschied zwischen
 * lesbar und kaputt.
 *
 * Als normale Flex-Kinder dürfen Abschnitte schrumpfen (`flex-shrink: 1` ist
 * die Vorgabe), und `min-height: 0` erlaubt ihnen zusätzlich, UNTER ihre
 * Inhaltshöhe zu gehen. Bei sechs Instrumenten in einer Leiste, die weniger
 * hoch ist als ihr Inhalt, hat der Browser daraufhin jeden Abschnitt gestaucht
 * — und weil der Inhalt nicht mitschrumpft, lag er sichtbar übereinander:
 * die Funding-Zeile stand im Kopf des nächsten Instruments.
 *
 * Richtig ist, dass jeder Abschnitt seine Höhe behält und stattdessen die
 * LEISTE scrollt. Das `overflow-y: auto` darüber war schon da, kam aber nie zum
 * Zug, weil nichts überlief — es wurde ja gestaucht.
 */
.pInst {
    display: flex;
    flex-direction: column;
    flex: none;
}

.pInst + .pInst { border-top: 1px solid var(--pTrenn); }

/*
 * Das Beschriftungsband ist der eigentliche Trick gegen ineinanderlaufende
 * Instrumente: eine Linie allein sagt „hier endet etwas", ein Band sagt „hier
 * beginnt das nächste". Es läuft über die volle Breite und hat deshalb keine
 * Rundung — sonst wäre es doch wieder eine Karte.
 */
.pInstKopf {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0.5rem;
    background: var(--pBand);
    border-bottom: 1px solid var(--pTrennFein);
}

/* Beschriftung klein, versal, gesperrt — der Sprung zum Wert macht die
   Ablesbarkeit, nicht die Farbe. */
.pInstTitel {
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--white-38);
}

.pInstStand {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.62rem;
    font-variant-numeric: tabular-nums;
    color: var(--white-38);
}

.pInstKoerper {
    padding: 0.3rem 0.5rem 0.4rem;
    /* Sicherheitsnetz: eine Kachel, die intern doch breiter/höher rechnet als
       gedacht, schneidet sich selbst ab, statt ins nächste Instrument zu
       ragen. Sichtbar wird das als fehlender Rest, nicht als Textsalat. */
    overflow: hidden;
}

.pInstFehler {
    font-size: 0.72rem;
    color: #ff6b7a;
}

/*
 * Zahlen in Tabellenziffern, ausnahmslos. Ohne sie springen die Stellen bei
 * jedem Tick seitlich — der Unterschied zwischen einer Webseite und einem
 * Instrument. Gilt für die eingebetteten Kacheln mit, die selbst keine setzen.
 */
.pult :deep(b),
.pult :deep(.poWert),
.pult :deep(.mxWert),
.pult :deep(.lsWert),
.pult :deep(.mkWert) {
    font-variant-numeric: tabular-nums;
}

/* Die eingebetteten Kacheln bringen ihre eigenen Ränder mit — hier stören sie,
   weil die Leiste schon durch Haarlinien gegliedert ist. */
.pult :deep(.radarCard) {
    border: 0;
    background: transparent;
    min-height: 0;
}
</style>
