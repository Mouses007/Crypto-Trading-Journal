<script setup>
/**
 * Kachel „Handelslage" — eine KI ordnet ein, was die nächsten Stunden hergeben.
 *
 * Schwester von `KachelLage.vue` und bewusst eine eigene Kachel: die Gesamtlage
 * beantwortet „wo stehen wir im Zyklus", diese hier „was gibt der Nachmittag
 * her". Beide sind nützlich, aber nicht dieselbe Frage — und eine Kachel, die
 * Regenbogen-Bänder neben einen 15-Minuten-Befund stellt, beantwortet keine von
 * beiden gut.
 *
 * Aufbau wie bei der Schwester: der Server hält die Daten für BEIDE Instanzen
 * (klein und gross), erzeugt wird per POST, gelesen per GET. Zwei Unterschiede:
 *
 *   1. Das Alter wird ab **30 Minuten** auffällig, nicht erst ab einer Stunde.
 *      Auf Stundenhorizont ist ein halbstündiger Befund bereits Geschichte.
 *   2. Es gibt einen **Automatismus**. Er läuft nur bei laufender Sitzung, nur
 *      in der kleinen Instanz (die grosse ist eine zweite Instanz derselben
 *      Komponente — beide zusammen würden doppelt bezahlen) und nur, solange
 *      der Server noch automatische Läufe freigibt.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { liveSymbol } from '../../stores/live.js'
import { aktiveSitzung } from '../../stores/livetrading.js'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
})

const emit = defineEmits(['neuladen'])

const { t } = useI18n()

const ROT = 'rgb(255, 95, 86)'
const GRUEN = 'rgb(38, 190, 150)'
const BLAU = 'rgb(90, 156, 255)'
const GELB = '#e8a33d'
const GRAU = 'rgba(255, 255, 255, 0.45)'

const LAGE_FARBE = {
    trend_auf: GRUEN,
    trend_ab: ROT,
    spanne: BLAU,
    quetsche: GELB,
    nachrichtenrisiko: GELB,
    unklar: GRAU,
}

const TON_FARBE = { gut: GRUEN, schlecht: ROT, neutral: GRAU }

/** Erlaubte Takte des Automatismus. 0 = aus. */
const AUTO_TAKTE = [0, 15, 30, 60]
const AUTO_SCHLUESSEL = 'ctj.handelslage.autoMin'

const laedt = ref(false)
const fehler = ref('')
const deckelErreicht = ref(false)

const hat = computed(() => Boolean(props.daten && !props.daten.leer && props.daten.ueberschrift))

const farbe = computed(() => LAGE_FARBE[props.daten?.lage] || GRAU)

/**
 * Alter der Einordnung.
 *
 * Gerechnet gegen `daten.stand` (Erzeugungszeitpunkt), nicht gegen das
 * `alterMs` des Servers: die Kachel holt im Takt, der Serverwert wäre
 * entsprechend eingefroren. Gleiche Begründung wie in `KachelLage.vue`.
 */
const jetzt = ref(Date.now())
let uhr = null

const alterMinuten = computed(() => {
    const s = Number(props.daten?.stand)
    if (!Number.isFinite(s) || s <= 0) return null
    return Math.max(0, Math.round((jetzt.value - s) / 60000))
})

const alterText = computed(() => {
    const m = alterMinuten.value
    if (m == null) return ''
    if (m < 60) return t('livetrading.handelslage.alterMin', { min: m })
    return t('livetrading.handelslage.alterStd', { std: Math.floor(m / 60) })
})

/** Ab einer halben Stunde ist ein Stundenbefund kein Befund mehr. */
const alterAuffaellig = computed(() => (alterMinuten.value ?? 0) >= 30)

// ── Automatismus ────────────────────────────────────────────────────────
const autoMin = ref(0)
try {
    const roh = Number(localStorage.getItem(AUTO_SCHLUESSEL))
    if (AUTO_TAKTE.includes(roh)) autoMin.value = roh
} catch { /* privater Modus: dann eben ohne Gedächtnis */ }

watch(autoMin, (v) => {
    try { localStorage.setItem(AUTO_SCHLUESSEL, String(v)) } catch { /* s. o. */ }
    // Ein neu eingeschalteter Takt soll nicht bis zum nächsten Prüflauf warten
    if (v > 0) pruefeAuto()
})

const sitzungLaeuft = computed(() => Boolean(aktiveSitzung.value))

/** Was unter dem Regler steht: warum er gerade nicht greift, oder wie viel Budget bleibt. */
const autoHinweis = computed(() => {
    if (!autoMin.value) return ''
    if (deckelErreicht.value) return t('livetrading.handelslage.autoDeckel')
    if (!sitzungLaeuft.value) return t('livetrading.handelslage.autoNurSitzung')
    const rest = Number(props.daten?.autoRest)
    return Number.isFinite(rest) ? t('livetrading.handelslage.autoRest', { n: rest }) : ''
})

/**
 * Ist ein automatischer Lauf fällig?
 *
 * Vier Bedingungen, alle notwendig: ein Takt ist eingestellt, eine Sitzung
 * läuft, der Server hat noch Budget, und der vorhandene Befund ist älter als
 * der Takt. Ohne bestehenden Befund gilt er als fällig — der erste Lauf einer
 * Sitzung ist genau der, den man haben will.
 */
function autoFaellig() {
    if (props.gross) return false          // die zweite Instanz zahlt nicht mit
    if (!autoMin.value || deckelErreicht.value) return false
    if (!sitzungLaeuft.value) return false
    if (laedt.value) return false
    const m = alterMinuten.value
    return m == null || m >= autoMin.value
}

async function pruefeAuto() {
    if (!autoFaellig()) return
    await erzeuge(false, true)
}

let autoUhr = null

onMounted(() => {
    uhr = setInterval(() => { jetzt.value = Date.now() }, 30000)
    // Derselbe Takt reicht für beides: die Altersanzeige springt in Minuten,
    // und ein Automatismus, der auf 30 Sekunden genau feuert, wäre Zierde.
    if (!props.gross) autoUhr = setInterval(pruefeAuto, 30000)
})
onBeforeUnmount(() => {
    clearInterval(uhr); uhr = null
    clearInterval(autoUhr); autoUhr = null
})

/** Endet eine Sitzung, ist der Automatismus damit still — ohne eigenes Zutun. */
watch(sitzungLaeuft, (laeuft) => { if (laeuft) pruefeAuto() })

const fussMeta = computed(() => [
    props.daten?.model,
    props.daten?.costUsd ? `${props.daten.costUsd.toFixed(3)} $` : '',
].filter(Boolean).join(' · '))

/**
 * Überschrift der Quelle, aus der eine Grundlagenzeile stammt.
 *
 * Anders als bei der Gesamtlage sind das keine Kachel-Ids: mehrere Zeilen
 * (Tagesbild, Zeit, Termine) rechnet der Server selbst und hat gar keine
 * Kachel dazu. Deshalb eine eigene, kurze Zuordnung statt `kachelById`.
 */
const QUELLE_NAME = {
    zeit: 'Handelstag',
    termine: 'Termine',
    tagesbild: 'Tagesbild',
    mechanik15: 'Mechanik 15m',
    mechanik1h: 'Mechanik 1h',
    liqJetzt: 'Liquidationen live',
    hebelzonen: 'Liquidations-Cluster',
    lsoi: 'Long/Short',
    funding: 'Funding',
    rsi: 'RSI',
    markt: 'Marktbreite',
    makro: 'Makro',
    coinradar: 'Coin-Radar',
    sitzung: 'Sitzung',
}
const grundlageTitel = (id) => QUELLE_NAME[id] || id

async function erzeuge(erzwingen = false, auto = false) {
    if (laedt.value) return
    laedt.value = true
    if (!auto) fehler.value = ''
    try {
        await axios.post('/api/livetrading/handelslage', {
            symbol: props.daten?.symbol || liveSymbol.value,
            erzwingen,
            auto,
        })
        // Die Seite hält die Daten für beide Instanzen; eigener Zustand hier
        // liesse sie auseinanderlaufen.
        emit('neuladen')
    } catch (e) {
        if (e.response?.status === 429) {
            // Deckel: für den Rest des Tages nicht weiter versuchen. Der Knopf
            // bleibt bedienbar — ein Klick ist eine Absicht, kein Automatismus.
            deckelErreicht.value = true
        } else if (!auto) {
            fehler.value = e.response?.data?.error || e.message
        }
    } finally {
        laedt.value = false
    }
}
</script>

<template>
    <div class="hlWrap" :class="{ gross }">
        <!-- Noch keine Einordnung: ein Knopf und der Satz, was er tut -->
        <div v-if="!hat && !laedt" class="hlLeer">
            <i class="uil uil-compass hlLeerIcon"></i>
            <p class="hlLeerText">{{ t('livetrading.handelslage.leerHinweis') }}</p>
            <button type="button" class="ctl-pill hlKnopf" @click.stop="erzeuge(false)">
                <i class="uil uil-bolt-alt"></i> {{ t('livetrading.handelslage.erzeugen') }}
            </button>
            <p v-if="fehler" class="hlFehler">{{ fehler }}</p>
        </div>

        <div v-else-if="laedt" class="hlLeer">
            <span class="spinner-border spinner-border-sm mb-2"></span>
            <p class="hlLeerText">{{ t('livetrading.handelslage.laedt') }}</p>
        </div>

        <template v-else>
            <div class="hlKopf">
                <span class="hlBadge" :style="{ borderColor: farbe, color: farbe }">
                    {{ t('livetrading.handelslage.lage_' + daten.lage) }}
                </span>
                <span v-if="alterText" class="hlAlter" :class="{ hlAlterAuf: alterAuffaellig }">
                    {{ alterText }}
                </span>
                <button type="button" class="hlErneut" :title="t('livetrading.handelslage.erneut')"
                    @click.stop="erzeuge(true)">
                    <i class="uil uil-sync"></i>
                </button>
            </div>

            <p class="hlTitel">{{ daten.ueberschrift }}</p>

            <!-- Klein: die Punkt-Titel und der Spielraum. Der Spielraum steht
                 auch hier, weil er die Frage beantwortet, für die man die
                 Kachel überhaupt ansieht. -->
            <template v-if="!gross">
                <ul class="hlKurz">
                    <li v-for="(p, i) in (daten.punkte || []).slice(0, 3)" :key="i">
                        <span class="hlPunkt" :style="{ background: TON_FARBE[p.ton] }"></span>{{ p.titel }}
                    </li>
                </ul>
                <p v-if="daten.spielraum" class="hlSpielraumKurz">{{ daten.spielraum }}</p>
            </template>

            <!-- Gross: das ganze Bild -->
            <template v-else>
                <p v-if="daten.text" class="hlText">{{ daten.text }}</p>

                <div v-if="daten.spielraum || daten.zeitfenster" class="hlZwei">
                    <div v-if="daten.spielraum" class="hlFeld">
                        <div class="hlAbschnitt">{{ t('livetrading.handelslage.spielraum') }}</div>
                        <p>{{ daten.spielraum }}</p>
                    </div>
                    <div v-if="daten.zeitfenster" class="hlFeld">
                        <div class="hlAbschnitt">{{ t('livetrading.handelslage.zeitfenster') }}</div>
                        <p>{{ daten.zeitfenster }}</p>
                    </div>
                </div>

                <div v-if="daten.punkte?.length" class="hlListe">
                    <div v-for="(p, i) in daten.punkte" :key="i" class="hlKarte"
                        :style="{ borderLeftColor: TON_FARBE[p.ton] }">
                        <div class="hlKarteTitel">{{ p.titel }}</div>
                        <div class="hlKarteText">{{ p.text }}</div>
                    </div>
                </div>

                <!-- Der eigentliche Unterschied zur Gesamtlage: Bedingungen
                     statt blosser Beschreibung. -->
                <div v-if="daten.bedingungen?.length" class="hlBedingungen">
                    <div class="hlAbschnitt">{{ t('livetrading.handelslage.bedingungen') }}</div>
                    <div v-for="(b, i) in daten.bedingungen" :key="i" class="hlBed">
                        <span class="hlWenn">{{ t('livetrading.handelslage.wenn') }}</span>
                        <span class="hlBedText">{{ b.wenn }}</span>
                        <span class="hlDann">{{ t('livetrading.handelslage.dann') }}</span>
                        <span class="hlBedText">{{ b.dann }}</span>
                    </div>
                </div>

                <div v-if="daten.hinfaellig?.length" class="hlHinfaellig">
                    <div class="hlAbschnitt">{{ t('livetrading.handelslage.hinfaellig') }}</div>
                    <ul>
                        <li v-for="(h, i) in daten.hinfaellig" :key="i">{{ h }}</li>
                    </ul>
                </div>

                <div v-if="daten.widerspruch" class="hlWiderspruch">
                    <div class="hlAbschnitt">{{ t('livetrading.handelslage.widerspruch') }}</div>
                    <p>{{ daten.widerspruch }}</p>
                </div>

                <!-- Automatischer Nachzug. Steht in der Gross-Ansicht, weil er
                     eine Entscheidung ist und kein Handgriff — gefeuert wird er
                     aber ausschliesslich von der kleinen Instanz. -->
                <div class="hlAuto">
                    <span class="hlAbschnitt">{{ t('livetrading.handelslage.auto') }}</span>
                    <div class="hlTakte" :title="t('livetrading.handelslage.autoTitel')">
                        <button v-for="m in AUTO_TAKTE" :key="m" type="button"
                            class="hlTakt" :class="{ an: autoMin === m }"
                            @click.stop="autoMin = m">
                            {{ m === 0 ? t('livetrading.handelslage.autoAus')
                                : t('livetrading.handelslage.autoMin', { min: m }) }}
                        </button>
                    </div>
                    <span v-if="autoHinweis" class="hlAutoHinweis"
                        :class="{ warn: deckelErreicht }">{{ autoHinweis }}</span>
                </div>

                <!-- Die Zahlen, auf denen der Text beruht. Ohne sie wäre die
                     Einordnung eine Behauptung. -->
                <details v-if="daten.grundlage?.length" class="hlGrundlage">
                    <summary>{{ t('livetrading.handelslage.grundlage', { n: daten.grundlage.length }) }}</summary>
                    <div v-for="(z, i) in daten.grundlage" :key="i" class="hlQuelle">
                        <span class="hlQuelleName">{{ grundlageTitel(z.id) }}</span>
                        <span class="hlQuelleText">{{ z.text }}</span>
                    </div>
                </details>

                <p class="hlFuss">
                    {{ t('livetrading.handelslage.hinweis') }}
                    <span v-if="fussMeta" class="hlModell">· {{ fussMeta }}</span>
                </p>
                <p v-if="fehler" class="hlFehler">{{ fehler }}</p>
            </template>
        </template>
    </div>
</template>

<style scoped>
.hlWrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.hlLeer {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 0.15rem;
}

.hlLeerIcon {
    font-size: 1.6rem;
    color: var(--white-60);
}

.hlLeerText {
    margin: 0 0 0.4rem;
    font-size: 0.8rem;
    color: var(--white-60);
    max-width: 26rem;
}

.hlKnopf {
    font-size: 0.84rem;
}

.hlKopf {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding-bottom: 0.4rem;
}

.hlBadge {
    border: 1px solid;
    border-radius: var(--border-radius, 6px);
    padding: 0.15rem 0.55rem;
    font-size: 0.86rem;
    font-weight: 600;
}

.hlWrap.gross .hlBadge {
    font-size: 1.05rem;
}

.hlAlter {
    font-size: 0.7rem;
    color: var(--white-45, rgba(255, 255, 255, 0.45));
    white-space: nowrap;
}

.hlAlter.hlAlterAuf {
    color: #e8b04b;
}

.hlErneut {
    margin-left: auto;
    background: none;
    border: none;
    padding: 0 0.2rem;
    color: var(--white-60);
    cursor: pointer;
}

.hlErneut:hover {
    color: var(--white-87);
}

.hlTitel {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    line-height: 1.35;
    color: var(--white-87);
}

.hlWrap.gross .hlTitel {
    font-size: 1.25rem;
}

/* Klein hat die Kachel eine feste Höhe: eine ausufernde Überschrift darf die
   Punkte darunter nicht aus der Kachel schieben. */
.hlWrap:not(.gross) .hlTitel {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.hlKurz {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0;
    min-height: 0;
    overflow: hidden;
}

.hlKurz li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.82rem;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
    padding: 0.1rem 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.hlPunkt {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
}

/* In der kleinen Kachel die einzige ganze Aussage — deshalb abgesetzt und
   auf zwei Zeilen begrenzt statt abgeschnitten. */
.hlSpielraumKurz {
    margin: 0.4rem 0 0;
    padding-top: 0.35rem;
    border-top: 1px solid var(--black-bg-12, rgba(255, 255, 255, 0.07));
    font-size: 0.8rem;
    line-height: 1.35;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.hlText {
    margin: 0.6rem 0 0;
    font-size: 0.95rem;
    line-height: 1.5;
    color: var(--white-87);
}

.hlZwei {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
    gap: 0.6rem;
    margin-top: 0.9rem;
}

.hlFeld p {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.45;
    color: var(--white-87);
}

.hlListe {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
    gap: 0.5rem;
    margin-top: 0.9rem;
}

.hlKarte {
    border-left: 3px solid;
    padding: 0.25rem 0.6rem;
    background: var(--black-bg-12, rgba(255, 255, 255, 0.04));
    border-radius: 0 var(--border-radius, 6px) var(--border-radius, 6px) 0;
}

.hlKarteTitel {
    font-size: 0.86rem;
    font-weight: 600;
    color: var(--white-87);
}

.hlKarteText {
    font-size: 0.84rem;
    line-height: 1.4;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
}

.hlAbschnitt {
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--white-60);
    margin-bottom: 0.2rem;
}

.hlBedingungen,
.hlHinfaellig,
.hlWiderspruch {
    margin-top: 0.9rem;
}

/* Wenn/dann als Fluss, nicht als Tabelle: die beiden Hälften sind ungleich
   lang, und eine feste Spalte reisst bei der kurzen ein Loch. */
.hlBed {
    font-size: 0.88rem;
    line-height: 1.5;
    color: var(--white-87);
    padding: 0.15rem 0;
}

.hlWenn,
.hlDann {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--white-60);
    margin-right: 0.3rem;
}

.hlDann {
    margin-left: 0.4rem;
}

.hlBedText {
    font-variant-numeric: tabular-nums;
}

.hlHinfaellig ul {
    margin: 0;
    padding-left: 1.1rem;
}

.hlHinfaellig li {
    font-size: 0.88rem;
    line-height: 1.45;
    color: var(--white-87);
    font-variant-numeric: tabular-nums;
}

.hlWiderspruch p {
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.45;
    color: var(--white-87);
}

.hlAuto {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 1rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--black-bg-12, rgba(255, 255, 255, 0.07));
}

.hlAuto .hlAbschnitt {
    margin-bottom: 0;
}

.hlTakte {
    display: flex;
    gap: 0.2rem;
}

.hlTakt {
    background: none;
    border: 1px solid var(--black-bg-12, rgba(255, 255, 255, 0.12));
    border-radius: var(--border-radius, 6px);
    padding: 0.1rem 0.45rem;
    font-size: 0.76rem;
    color: var(--white-60);
    cursor: pointer;
}

.hlTakt.an {
    border-color: var(--blue-color, rgb(90, 156, 255));
    color: var(--blue-color, rgb(90, 156, 255));
}

.hlAutoHinweis {
    font-size: 0.74rem;
    color: var(--white-60);
}

.hlAutoHinweis.warn {
    color: #e8b04b;
}

.hlGrundlage {
    margin-top: 1rem;
    font-size: 0.8rem;
}

.hlGrundlage summary {
    color: var(--white-60);
    cursor: pointer;
}

.hlQuelle {
    display: flex;
    gap: 0.6rem;
    padding: 0.15rem 0;
    border-top: 1px solid var(--black-bg-12, rgba(255, 255, 255, 0.07));
}

.hlQuelleName {
    flex: none;
    width: 9rem;
    color: var(--white-60);
}

.hlQuelleText {
    color: var(--white-70, rgba(255, 255, 255, 0.7));
    font-variant-numeric: tabular-nums;
}

.hlFuss {
    margin: 0.9rem 0 0;
    font-size: 0.74rem;
    color: var(--white-60);
}

.hlModell {
    opacity: 0.7;
}

.hlFehler {
    margin: 0.4rem 0 0;
    font-size: 0.8rem;
    color: rgb(255, 95, 86);
}
</style>
