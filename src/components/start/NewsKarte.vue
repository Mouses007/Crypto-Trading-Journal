<script setup>
/**
 * Feste News-Karte der Startseite.
 *
 * Zeigt die Zusammenfassung des zuletzt generierten Lageberichts (Überschrift,
 * Kurzfassung, die wichtigsten Punkte, Themen, Alter) und verlinkt auf die
 * Nachrichten-Seite. Ist noch kein Bericht da, steht ein Hinweis.
 *
 * Die Punkte sind der eigentliche Ertrag eines Berichts — die Lage-Kurzfassung
 * allein war zu mager für eine Übersichtsseite, die genau dafür da ist, in
 * einem Blick zu zeigen, was ansteht. Gezeigt werden bis zu drei, mit
 * `wichtigkeit: 'hoch'` zuerst (dasselbe Feld, das auch die Nachrichten-Seite
 * für ihre Kachelansicht benutzt); ohne einen einzigen „hoch"-Punkt greifen
 * die ersten drei überhaupt — besser eine Auswahl ohne Rang als gar keine.
 *
 * Bewusst KEINE Kachel im Raster: immer sichtbar, nicht verschiebbar. Und
 * bewusst nur LESEND — Generieren kostet Geld und passiert ausschließlich auf
 * der Nachrichten-Seite (POST). Hier wird nur der bereits erzeugte Stand geholt.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import axios from 'axios'
import dayjs from '../../utils/dayjs-setup.js'

const { t } = useI18n()
const router = useRouter()

const bericht = ref(null)
const geladen = ref(false)
let timer = null

async function laden() {
    try {
        const { data } = await axios.get('/api/marktradar/lagebericht')
        bericht.value = data?.bericht || null
    } catch (_) {
        // Ein Aussetzer lässt den vorherigen Stand stehen; kein Fehlerbild nötig
    } finally {
        geladen.value = true
    }
}

/** Kurzfassung: erste ~420 Zeichen der Lage, an einem Satzende gekappt. */
const kurz = computed(() => {
    const text = (bericht.value?.lage || '').trim()
    if (!text) return ''
    if (text.length <= 420) return text
    const schnitt = text.slice(0, 420)
    const punkt = schnitt.lastIndexOf('. ')
    return (punkt > 240 ? schnitt.slice(0, punkt + 1) : schnitt) + ' …'
})

/** Kurzer Auszug aus einem Punkttext — drei Punkte brauchen mehr Zurückhaltung
 *  als die einzelne Lage-Kurzfassung oben. */
function punktAuszug(text) {
    const t = (text || '').trim()
    if (t.length <= 130) return t
    const schnitt = t.slice(0, 130)
    const punkt = schnitt.lastIndexOf('. ')
    return (punkt > 60 ? schnitt.slice(0, punkt + 1) : schnitt) + ' …'
}

/**
 * Bis zu drei Punkte, wichtigste zuerst und mit den nächstbesten aufgefüllt.
 * Nur die „hoch"-Punkte zu zeigen war der erste Entwurf — an einem Bericht
 * mit nur einem einzigen „hoch"-Punkt blieb die Karte dann bei einer einzigen
 * Zeile stehen, obwohl der Bericht Dutzende Punkte hatte. Führt kein eigenes
 * Ranking über die Themenvielfalt wie die Nachrichten-Seite (drei Dimensionen:
 * Wichtig, je Thema, Rest) — dafür ist die Übersichtskarte zu klein, sie zeigt
 * nur EINE Auswahl, keine Struktur.
 */
const topPunkte = computed(() => {
    const alle = bericht.value?.punkte || []
    const hoch = alle.filter(p => p?.wichtigkeit === 'hoch')
    const rest = alle.filter(p => p?.wichtigkeit !== 'hoch')
    return [...hoch, ...rest].slice(0, 3)
})

const themen = computed(() =>
    (bericht.value?.themen || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
)

const alter = computed(() =>
    bericht.value?.erstelltAm ? dayjs(bericht.value.erstelltAm).format('DD.MM.YYYY, HH:mm') : '',
)

onMounted(() => {
    laden()
    // Alle 10 Minuten nachsehen, ob inzwischen ein neuer Bericht vorliegt
    timer = setInterval(laden, 10 * 60 * 1000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
    <div class="newsKarte">
        <div class="nkKopf">
            <span class="nkLabel"><i class="uil uil-newspaper"></i>{{ t('startseite.news.label') }}</span>
            <a class="nkLink" href="#" @click.prevent="router.push('/nachrichten')">
                {{ t('startseite.news.mehr') }} <i class="uil uil-arrow-right"></i>
            </a>
        </div>

        <template v-if="bericht">
            <h3 class="nkTitel">{{ bericht.ueberschrift || t('startseite.news.ohneTitel') }}</h3>
            <p v-if="kurz" class="nkText">{{ kurz }}</p>

            <ul v-if="topPunkte.length" class="nkPunkte">
                <li v-for="(p, i) in topPunkte" :key="p.themaId || i">
                    <span class="nkPunktTitel">{{ p.titel }}</span>
                    <span v-if="punktAuszug(p.text)" class="nkPunktText"> — {{ punktAuszug(p.text) }}</span>
                </li>
            </ul>

            <div class="nkFuss">
                <span v-for="th in themen" :key="th" class="nkThema">{{ th }}</span>
                <span v-if="alter" class="nkAlter">{{ alter }}</span>
            </div>
        </template>

        <div v-else-if="geladen" class="nkLeer">
            <i class="uil uil-file-info-alt"></i>
            <span>{{ t('startseite.news.leer') }}</span>
            <a class="ctl-pill mt-1" href="#" @click.prevent="router.push('/nachrichten')">
                {{ t('startseite.news.zurSeite') }}
            </a>
        </div>

        <div v-else class="nkLeer">
            <span class="spinner-border spinner-border-sm"></span>
        </div>
    </div>
</template>

<style scoped>
.newsKarte {
    background: var(--black-bg-soft, rgba(255, 255, 255, 0.03));
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--border-radius, 12px);
    padding: 0.9rem 1.1rem;
    margin-bottom: 1rem;
}

.nkKopf {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    margin-bottom: 0.4rem;
}

.nkLabel {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.76rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--white-60);
}

.nkLink {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--blue-color, #4a90e2);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
}

.nkTitel {
    margin: 0 0 0.35rem;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--white-87);
    line-height: 1.25;
}

.nkText {
    margin: 0 0 0.5rem;
    font-size: 0.92rem;
    line-height: 1.5;
    color: var(--white-80, rgba(255, 255, 255, 0.8));
}

.nkPunkte {
    margin: 0 0 0.6rem;
    padding-left: 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
}

.nkPunkte li {
    font-size: 0.86rem;
    line-height: 1.45;
}

.nkPunktTitel {
    color: var(--white-87);
    font-weight: 600;
}

.nkPunktText {
    color: var(--white-60);
}

.nkFuss {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
}

.nkThema {
    font-size: 0.72rem;
    font-weight: 600;
    padding: 0.12rem 0.5rem;
    border-radius: 999px;
    background: rgba(74, 144, 226, 0.14);
    color: var(--blue-color, #4a90e2);
    text-transform: capitalize;
}

.nkAlter {
    margin-left: auto;
    font-size: 0.76rem;
    color: var(--white-60);
}

.nkLeer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    padding: 0.8rem 0;
    color: var(--white-60);
    font-size: 0.88rem;
    text-align: center;
}

.nkLeer i {
    font-size: 1.5rem;
}
</style>
