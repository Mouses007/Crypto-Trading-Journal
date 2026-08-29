<script setup>
/**
 * Zyklusband — die zweite Zeile des Marktradar-Pults.
 *
 * Das Gegenstück zum Zeitband des Live-Fensters: dort werden Handelssitzungen
 * und Termine auf eine gemeinsame Zeitachse gelegt, hier Regenbogen und
 * Pi-Cycle auf eine gemeinsame Bewertungsachse. Beide Kacheln beantworten
 * dieselbe Frage — *wo im Zyklus stehen wir* — und nebeneinander in zwei
 * Kästen muss man sie im Kopf zusammenrechnen.
 *
 * Die neun Regenbogenbänder laufen hier von günstig nach teuer, also von links
 * nach rechts. Im Server stehen sie umgekehrt (`RAINBOW_BAENDER` beginnt bei
 * `blase`), weil dort von oben nach unten gesucht wird; für eine Achse ist
 * „billig links" die Leserichtung, die niemand erklären muss.
 *
 * ## Der Pi-Cycle-Abstand ist bewusst keine Skala mit festem Ende
 *
 * `abstandPct` sagt, wie weit die 111-Tage-Linie noch unter der doppelten
 * 350-Tage-Linie liegt; bei 0 kreuzen sie, und das ist das Signal. Wie weit
 * „weit weg" ist, hat aber keinen definierten Rand — historisch waren es über
 * 60 %, garantiert ist das nicht. Der Balken wird deshalb an einem
 * ANGENOMMENEN Bezug von 50 % gefüllt und läuft darüber einfach voll; die Zahl
 * daneben ist die Wahrheit, der Balken nur die Richtung.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
    rainbow: { type: Object, default: null },
    picycle: { type: Object, default: null },
})

const { t } = useI18n()

/**
 * Linker Rand der Pi-Cycle-Skala in Prozent Abstand.
 *
 * Historisch lag die 111-Tage-Linie in ruhigen Phasen 50 bis 70 % unter der
 * doppelten 350-Tage-Linie; ein garantiertes Maximum gibt es nicht. −60 ist
 * deshalb eine ANNAHME und keine Messgrösse — steht der Wert darunter, klebt
 * die Nadel am linken Rand, und die Zahl daneben bleibt die Wahrheit.
 */
const PI_SKALA_MIN = -60

/*
 * Drei Zonen bis zur Kreuzung. Die Farben sind die der Kachel: Grün ist dort
 * die 350-Tage-Linie (das ruhige Mass), Bernstein die 111-Tage-Linie, die sich
 * heranarbeitet. Rot ist die letzte Handbreit davor.
 *
 * Vorher stand hier ein Füllbalken, der bei −58,7 % leer war — und leer ist er
 * fast immer, denn „weit weg" ist der Normalzustand. Ein Instrument, das im
 * Regelfall nichts anzeigt, sagt auch im Ernstfall nichts, weil man nie gelernt
 * hat, es zu lesen. Als Skala mit Nadel steht immer etwas da.
 */
const PI_STREIFEN = [
    { von: -60, bis: -30, farbe: '#26be96' },
    { von: -30, bis: -10, farbe: '#e8a33d' },
    { von: -10, bis: 0, farbe: '#ff5f56' },
]

/** Günstig links, teuer rechts. */
const baender = computed(() => [...(props.rainbow?.baender || [])].reverse())

const aktuellesBand = computed(() => props.rainbow?.jetzt?.band || null)

const preis = computed(() => {
    const v = Number(props.rainbow?.jetzt?.preis)
    return Number.isFinite(v) ? v : null
})

const abstand = computed(() => {
    const v = Number(props.picycle?.jetzt?.abstandPct)
    return Number.isFinite(v) ? v : null
})

const ausgeloest = computed(() => Boolean(props.picycle?.jetzt?.ausgeloest))

/** Wert → Position auf der Skala in Prozent, an beiden Rändern geklemmt. */
const aufSkala = (wert) => Math.max(0, Math.min(100,
    ((wert - PI_SKALA_MIN) / (0 - PI_SKALA_MIN)) * 100))

const piStreifen = computed(() => PI_STREIFEN.map(z => ({
    farbe: z.farbe,
    links: aufSkala(z.von),
    breite: aufSkala(z.bis) - aufSkala(z.von),
})))

const piNadel = computed(() => abstand.value === null ? null : aufSkala(abstand.value))

/** Ab hier ist die Annäherung der Rede wert. */
const piNah = computed(() => abstand.value !== null && abstand.value > -10)
</script>

<template>
    <div class="zyBand">
        <div class="zyKopf">
            <div class="zyTitel">{{ t('marktradar.pult.zyklus') }}</div>
            <div class="zyPreis">{{ preis === null ? '—' : '$ ' + Math.round(preis).toLocaleString('de-CH').replace(/'/g, ' ') }}</div>
        </div>

        <!-- Regenbogen als Achse -->
        <div class="zyRegenbogen">
            <span v-for="b in baender" :key="b.key" class="zySegment"
                :class="{ zyAktiv: b.key === aktuellesBand }"
                :style="{ background: b.farbe }"
                :title="t('marktradar.rainbow.band_' + b.key)">
                <span v-if="b.key === aktuellesBand" class="zySegmentText">
                    {{ t('marktradar.rainbow.band_' + b.key) }}
                </span>
            </span>
        </div>

        <!-- Pi-Cycle daneben, eigenes Feld -->
        <div class="zyPi">
            <div class="zyPiKopf">
                <span>{{ t('marktradar.picycle.title') }}</span>
                <span class="zyPiZahl" :class="{ zyWarn: piNah || ausgeloest }">
                    {{ abstand === null ? '—' : (abstand > 0 ? '+' : '') + abstand + ' %' }}
                </span>
            </div>
            <div class="zyPiSchiene">
                <span v-for="z in piStreifen" :key="z.links" class="zyPiStreifen"
                    :style="{ left: z.links + '%', width: z.breite + '%', background: z.farbe }"></span>
                <span v-if="piNadel !== null" class="zyPiNadel" :style="{ left: piNadel + '%' }"></span>
            </div>
            <div class="zyPiFuss">
                {{ ausgeloest ? t('marktradar.pult.piAusgeloest') : t('marktradar.pult.piAbstand') }}
            </div>
        </div>
    </div>
</template>

<style scoped>
.zyBand {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) 210px;
    align-items: center;
    border-bottom: 1px solid var(--pTrenn);
    background: var(--pChrom);
}

.zyKopf {
    padding: 0.35rem 0.6rem;
    border-right: 1px solid var(--pTrenn);
    white-space: nowrap;
}

.zyTitel {
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--white-38);
}

.zyPreis {
    font-size: 0.86rem;
    font-variant-numeric: tabular-nums;
    color: var(--white-87);
    margin-top: 0.1rem;
}

/*
 * Die neun Bänder als lückenloses Segmentband. Kein Abstand dazwischen: es ist
 * eine durchgehende Achse, keine Reihe von Knöpfen. Das aktive Segment wird
 * höher und bekommt als einziges eine Beschriftung — acht Namen nebeneinander
 * wären Lärm, und man will ohnehin nur wissen, wo man steht.
 */
.zyRegenbogen {
    display: flex;
    height: 100%;
    align-items: stretch;
    padding: 0.45rem 0.6rem 0.85rem;
    gap: 0;
}

.zySegment {
    position: relative;
    flex: 1 1 0;
    height: 10px;
    align-self: center;
    opacity: 0.4;
    transition: opacity 0.2s ease, height 0.2s ease;
}

.zySegment.zyAktiv {
    opacity: 1;
    height: 18px;
}

.zySegmentText {
    position: absolute;
    left: 50%;
    top: 20px;
    transform: translateX(-50%);
    font-size: 0.66rem;
    color: var(--white-87);
    white-space: nowrap;
}

.zyPi {
    padding: 0.32rem 0.6rem;
    border-left: 1px solid var(--pTrenn);
    align-self: stretch;
}

.zyPiKopf {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--white-38);
}

.zyPiZahl {
    font-size: 0.92rem;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0;
    color: var(--white-87);
}

.zyPiZahl.zyWarn { color: #e8a33d; }

.zyPiSchiene {
    position: relative;
    height: 7px;
    margin-top: 0.3rem;
    background: rgba(255, 255, 255, 0.07);
}

/* Gedämpft, damit die weisse Nadel die hellste Stelle bleibt — gleiche Regel
   wie auf den Skalen des Stimmungsbands. */
.zyPiStreifen {
    position: absolute;
    top: 0;
    bottom: 0;
    opacity: 0.55;
}

.zyPiNadel {
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: 2px;
    margin-left: -1px;
    background: #fff;
    transition: left 0.4s ease;
}

.zyPiFuss {
    font-size: 0.6rem;
    color: var(--white-38);
    margin-top: 0.2rem;
}
</style>
