<script setup>
/**
 * Kachel „Gesamtlage" — eine KI fasst auf Knopfdruck zusammen, was die übrigen
 * Kacheln gerade zeigen.
 *
 * Sie holt sich nichts selbst: der Server liest dieselben Kachel-Zahlen aus
 * demselben Zwischenspeicher, aus dem die Kacheln daneben gezeichnet werden.
 * Die verwendeten Zeilen kommen mit (`grundlage`) und stehen in der
 * Gross-Ansicht unter der Einordnung — nachprüfen statt glauben.
 *
 * Erzeugt wird ausschliesslich per Knopf (POST). Das Pfeilsymbol in der
 * Kopfzeile und „Alle aktualisieren" holen nur, was schon vorliegt, und kosten
 * deshalb nichts. Nach einem Lauf wird die Seite gebeten, die Kachel neu zu
 * lesen — sonst zeigte die Gross-Ansicht (eine zweite Instanz dieser
 * Komponente) weiter den alten Stand.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { kachelById } from '../../config/marktradar.js'
import { liveSymbol } from '../../stores/live.js'

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

const STIMMUNG_FARBE = {
    risiko_auf: GRUEN,
    risiko_ab: ROT,
    angespannt: GELB,
    gemischt: BLAU,
    ruhig: GRAU,
}

const TON_FARBE = { gut: GRUEN, schlecht: ROT, neutral: GRAU }

const laedt = ref(false)
const fehler = ref('')

/** Liegt eine Einordnung vor? `leer` ist die Antwort des Servers, wenn nicht. */
const hat = computed(() => Boolean(props.daten && !props.daten.leer && props.daten.ueberschrift))

/**
 * Alter der Einordnung, gut sichtbar am Kopf.
 *
 * Diese Kachel ist KEINE Live-Quelle: Der Text entsteht nur auf Knopfdruck
 * (der Endpunkt liest per GET bloss, erzeugt wird per POST) und steht danach,
 * bis jemand ihn neu erzeugt. Im Handelsfenster stand er schon über acht
 * Stunden — und der „Stand 07:12" im Kachelkopf liest sich wie Datenfrische,
 * nicht wie das Erzeugungsdatum eines Textes. Deshalb hier eine Angabe, die
 * ausspricht, was sie meint, und ab einer Stunde auffällig wird.
 *
 * `daten.alterMs` vom Server wird bewusst NICHT genommen: die Kachel holt alle
 * fünf Minuten, der Wert wäre entsprechend eingefroren. Gerechnet wird gegen
 * `daten.stand`, den Erzeugungszeitpunkt.
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
    if (m < 60) return t('marktradar.lage.alterMin', { min: m })
    return t('marktradar.lage.alterStd', { std: Math.floor(m / 60) })
})

/** Ab einer Stunde ist eine Markteinordnung im Handelsfenster kein Befund mehr. */
const alterAuffaellig = computed(() => (alterMinuten.value ?? 0) >= 60)

onMounted(() => { uhr = setInterval(() => { jetzt.value = Date.now() }, 30000) })
onBeforeUnmount(() => { clearInterval(uhr); uhr = null })
const farbe = computed(() => STIMMUNG_FARBE[props.daten?.stimmung] || GRAU)

/**
 * Modell und Kosten des Laufs, als ein Stück. Zwei getrennte Spannen hätten
 * ihren Zwischenraum verloren — Vue faltet Leerraum zwischen Elementen weg.
 */
const fussMeta = computed(() => [
    props.daten?.model,
    props.daten?.costUsd ? `${props.daten.costUsd.toFixed(3)} $` : '',
].filter(Boolean).join(' · '))

/** Überschrift der Kachel, aus der die Zeile stammt — sonst stünde dort eine Id. */
const grundlageTitel = (id) => {
    const k = kachelById(id)
    return k ? t(k.titleKey) : id
}

async function erzeuge(erzwingen = false) {
    if (laedt.value) return
    laedt.value = true
    fehler.value = ''
    try {
        await axios.post('/api/marktradar/lage', {
            symbol: props.daten?.symbol || liveSymbol.value,
            erzwingen,
        })
        // Die Seite hält die Daten für BEIDE Instanzen (klein und gross);
        // eigener Zustand hier würde sie auseinanderlaufen lassen
        emit('neuladen')
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    } finally {
        laedt.value = false
    }
}
</script>

<template>
    <div class="lgWrap" :class="{ gross }">
        <!-- Noch keine Einordnung: ein Knopf und der Satz, was er tut -->
        <div v-if="!hat && !laedt" class="lgLeer">
            <i class="uil uil-robot lgLeerIcon"></i>
            <p class="lgLeerText">{{ t('marktradar.lage.leerHinweis') }}</p>
            <button type="button" class="ctl-pill lgKnopf" @click.stop="erzeuge(false)">
                <i class="uil uil-bolt-alt"></i> {{ t('marktradar.lage.erzeugen') }}
            </button>
            <p v-if="fehler" class="lgFehler">{{ fehler }}</p>
        </div>

        <div v-else-if="laedt" class="lgLeer">
            <span class="spinner-border spinner-border-sm mb-2"></span>
            <p class="lgLeerText">{{ t('marktradar.lage.laedt') }}</p>
        </div>

        <template v-else>
            <div class="lgKopf">
                <span class="lgBadge" :style="{ borderColor: farbe, color: farbe }">
                    {{ t('marktradar.lage.stimmung_' + daten.stimmung) }}
                </span>
                <!-- Erzeugungsalter, nicht Datenfrische: der Text steht, bis
                     ihn jemand neu erzeugt. -->
                <span v-if="alterText" class="lgAlter" :class="{ lgAlterAuf: alterAuffaellig }">
                    {{ alterText }}
                </span>
                <button type="button" class="lgErneut" :title="t('marktradar.lage.erneut')"
                    @click.stop="erzeuge(true)">
                    <i class="uil uil-sync"></i>
                </button>
            </div>

            <p class="lgTitel">{{ daten.ueberschrift }}</p>

            <!-- Klein: nur die Punkt-Titel, das ist der Fünf-Sekunden-Blick -->
            <template v-if="!gross">
                <ul class="lgKurz">
                    <li v-for="(p, i) in (daten.punkte || []).slice(0, 4)" :key="i">
                        <span class="lgPunkt" :style="{ background: TON_FARBE[p.ton] }"></span>{{ p.titel }}
                    </li>
                </ul>
            </template>

            <!-- Gross: das ganze Bild -->
            <template v-else>
                <p v-if="daten.text" class="lgText">{{ daten.text }}</p>

                <div v-if="daten.punkte?.length" class="lgListe">
                    <div v-for="(p, i) in daten.punkte" :key="i" class="lgKarte"
                        :style="{ borderLeftColor: TON_FARBE[p.ton] }">
                        <div class="lgKarteTitel">{{ p.titel }}</div>
                        <div class="lgKarteText">{{ p.text }}</div>
                    </div>
                </div>

                <div v-if="daten.widerspruch" class="lgWiderspruch">
                    <div class="lgAbschnitt">{{ t('marktradar.lage.widerspruch') }}</div>
                    <p>{{ daten.widerspruch }}</p>
                </div>

                <div v-if="daten.achten?.length" class="lgAchten">
                    <div class="lgAbschnitt">{{ t('marktradar.lage.achten') }}</div>
                    <ul>
                        <li v-for="(a, i) in daten.achten" :key="i">{{ a }}</li>
                    </ul>
                </div>

                <!-- Die Zahlen, auf denen der Text beruht. Ohne sie wäre die
                     Einordnung eine Behauptung. -->
                <details v-if="daten.grundlage?.length" class="lgGrundlage">
                    <summary>{{ t('marktradar.lage.grundlage', { n: daten.grundlage.length }) }}</summary>
                    <div v-for="(z, i) in daten.grundlage" :key="i" class="lgQuelle">
                        <span class="lgQuelleName">{{ grundlageTitel(z.id) }}</span>
                        <span class="lgQuelleText">{{ z.text }}</span>
                    </div>
                </details>

                <p class="lgFuss">
                    {{ t('marktradar.lage.hinweis') }}
                    <span v-if="fussMeta" class="lgModell">· {{ fussMeta }}</span>
                </p>
                <p v-if="fehler" class="lgFehler">{{ fehler }}</p>
            </template>
        </template>
    </div>
</template>

<style scoped>
.lgWrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

/* Leer- und Ladezustand mittig — der Knopf ist der ganze Inhalt */
.lgLeer {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 0.15rem;
}

.lgLeerIcon {
    font-size: 1.6rem;
    color: var(--white-60);
}

.lgLeerText {
    margin: 0 0 0.4rem;
    font-size: 0.8rem;
    color: var(--white-60);
    max-width: 26rem;
}

.lgKnopf {
    font-size: 0.84rem;
}

.lgKopf {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding-bottom: 0.4rem;
}

.lgBadge {
    border: 1px solid;
    border-radius: var(--border-radius, 6px);
    padding: 0.15rem 0.55rem;
    font-size: 0.86rem;
    font-weight: 600;
}

.lgWrap.gross .lgBadge {
    font-size: 1.05rem;
}

/* Das Alter steht direkt am Befund — wer die Stimmung liest, liest mit, wie
   alt sie ist. Unauffällig, solange sie frisch ist. */
.lgAlter {
    font-size: 0.7rem;
    color: var(--white-45, rgba(255, 255, 255, 0.45));
    white-space: nowrap;
}

.lgAlter.lgAlterAuf {
    color: #e8b04b;
}

/* Zweiter Lauf kostet Geld — deshalb unauffällig, nicht als Hauptknopf */
.lgErneut {
    margin-left: auto;
    background: none;
    border: none;
    padding: 0 0.2rem;
    color: var(--white-60);
    cursor: pointer;
}

.lgErneut:hover {
    color: var(--white-87);
}

.lgTitel {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    line-height: 1.35;
    color: var(--white-87);
}

.lgWrap.gross .lgTitel {
    font-size: 1.25rem;
}

/* Klein hat die Kachel eine feste Höhe: eine ausufernde Überschrift darf die
   Punkte darunter nicht aus der Kachel schieben. */
.lgWrap:not(.gross) .lgTitel {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.lgKurz {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
    min-height: 0;
    overflow: hidden;
}

.lgKurz li {
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

.lgPunkt {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
}

.lgText {
    margin: 0.6rem 0 0;
    font-size: 0.95rem;
    line-height: 1.5;
    color: var(--white-87);
}

.lgListe {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 0.5rem;
    margin-top: 0.9rem;
}

.lgKarte {
    border-left: 3px solid;
    padding: 0.25rem 0.6rem;
    background: var(--black-bg-12, rgba(255, 255, 255, 0.04));
    border-radius: 0 var(--border-radius, 6px) var(--border-radius, 6px) 0;
}

.lgKarteTitel {
    font-size: 0.86rem;
    font-weight: 600;
    color: var(--white-87);
}

.lgKarteText {
    font-size: 0.84rem;
    line-height: 1.4;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
}

.lgAbschnitt {
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--white-60);
    margin-bottom: 0.2rem;
}

.lgWiderspruch,
.lgAchten {
    margin-top: 0.9rem;
}

.lgWiderspruch p {
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.45;
    color: var(--white-87);
}

.lgAchten ul {
    margin: 0;
    padding-left: 1.1rem;
}

.lgAchten li {
    font-size: 0.88rem;
    line-height: 1.45;
    color: var(--white-87);
}

.lgGrundlage {
    margin-top: 1rem;
    font-size: 0.8rem;
}

.lgGrundlage summary {
    color: var(--white-60);
    cursor: pointer;
}

.lgQuelle {
    display: flex;
    gap: 0.6rem;
    padding: 0.15rem 0;
    border-top: 1px solid var(--black-bg-12, rgba(255, 255, 255, 0.07));
}

.lgQuelleName {
    flex: none;
    width: 11rem;
    color: var(--white-60);
}

.lgQuelleText {
    color: var(--white-70, rgba(255, 255, 255, 0.7));
    font-variant-numeric: tabular-nums;
}

.lgFuss {
    margin: 0.9rem 0 0;
    font-size: 0.74rem;
    color: var(--white-60);
}

.lgModell {
    opacity: 0.7;
}

.lgFehler {
    margin: 0.4rem 0 0;
    font-size: 0.8rem;
    color: rgb(255, 95, 86);
}
</style>
