/**
 * Die Lernsitzung — EINE Quelle für beide Oberflächen.
 *
 * `Lernen.vue` und `KachelQuiz.vue` führten dieselbe Sitzung mit zwei
 * getrennten Implementierungen. Der Audit vom 28.08.2026 hat eine davon
 * repariert („Schwer" ist kein Treffer, vergessene Karten kommen zurück, ein
 * fehlgeschlagener Schreibvorgang zählt nichts) — die andere nicht. Am
 * 05.09.2026 stand deshalb hinter derselben Beschriftung unterschiedliches
 * Verhalten, je nachdem ob man auf der Lernseite oder in der Startseiten-Kachel
 * bewertete. Das Muster ist in diesem Projekt bekannt genug, dass es einen
 * Namen hat: die nicht nachgezogene Kopie.
 *
 * Hier liegt ab jetzt alles, was in beiden gleich ist: Warteschlange,
 * Aufdecken, Bewerten samt Zählung und Wiedervorlage, Ausblenden. Was
 * verschieden bleibt, bleibt bei den Aufrufern — `Lernen.vue` hat
 * Sitzungspersistenz und Tastaturbedienung, die Kachel hat Kurzstatus und ihr
 * `CustomEvent`. Vorbild für den Zuschnitt ist `useKachelRaster.js`, das sich
 * Marktradar und Live-Trading auf dieselbe Weise teilen.
 *
 * Die Zustands-Refs werden absichtlich nach aussen gereicht: `Lernen.vue`
 * stellt eine unterbrochene Runde aus `localStorage` wieder her und muss sie
 * dafür setzen können. Ein Satz Setter dafür wäre dieselbe Kopplung mit mehr
 * Zeilen.
 */
import { ref, computed } from 'vue'
import { dbCreate, dbUpdate } from '../utils/db.js'
import { auswerten, BOX_MIN, GRADE_VERGESSEN, GRADE_SCHWER, GRADE_GUT, GRADE_LEICHT } from '../../shared/leitner.js'
import { logWarn } from '../utils/logger.js'

/**
 * Reihenfolge der Bewertungsknöpfe — sie ist zugleich die Tastenbelegung 1–4
 * in `Lernen.vue`. Farbfolge wie die Box-Legende (1 = rot … 4 = grün), damit
 * die Farbe schon andeutet, wie weit die Karte springt.
 */
export const GRADE_BUTTONS = [
    { grad: GRADE_VERGESSEN, key: 'vergessen', klasse: 'lernen-grade-vergessen' },
    { grad: GRADE_SCHWER, key: 'schwer', klasse: 'lernen-grade-schwer' },
    { grad: GRADE_GUT, key: 'gut', klasse: 'lernen-grade-gut' },
    { grad: GRADE_LEICHT, key: 'leicht', klasse: 'lernen-grade-leicht' },
]

/**
 * @param {object} optionen
 * @param {import('vue').Ref} optionen.faelligeEintraege  fällige `{karte, fortschritt}` — Grundlage der Runde
 * @param {import('vue').Ref} optionen.fortschritt        Liste aller Fortschrittszeilen (neu angelegte werden angehängt)
 * @param {Function} [optionen.onGeaendert]  nach jedem erfolgreichen Schreibvorgang (Kachel: CustomEvent)
 * @param {Function} [optionen.onZustand]    nach jeder Zustandsänderung (Lernseite: Sitzung sichern)
 */
export function useLernSitzung({ faelligeEintraege, fortschritt, onGeaendert = null, onZustand = null }) {
    const phase = ref('start')            // start | review | summary
    const warteschlange = ref([])
    const aktuellerIndex = ref(0)
    const antwortSichtbar = ref(false)
    /** Erklärungsblock der aktuellen Karte — fällt bei jedem Kartenwechsel zu. */
    const erklaerungOffen = ref(false)
    const sitzungRichtig = ref(0)
    const sitzungFalsch = ref(0)
    /** „Schwer" — weder Treffer noch Fehler, und deshalb eine eigene Zahl. */
    const sitzungSchwer = ref(0)
    /*
     * Karten, die in DIESER Sitzung schon einmal wiedervorgelegt wurden — eine
     * Karte kommt genau einmal zurück, sonst liesse sich die Runde mit
     * wiederholtem „Vergessen" in eine Endlosschleife bewerten.
     */
    const wiedervorgelegt = ref(new Set())
    /*
     * Riegel gegen den zweiten Klick, während der erste noch schreibt. Ohne ihn
     * bewertet ein schneller Doppeldruck auf 1–4 dieselbe Karte zweimal: der
     * Index rückt erst NACH dem `await` vor, bis dahin zeigt
     * `aktuellerEintrag` noch auf dieselbe Karte.
     */
    const beschaeftigt = ref(false)

    const aktuellerEintrag = computed(() => warteschlange.value[aktuellerIndex.value] || null)
    const aktuelleBox = computed(() => Number(aktuellerEintrag.value?.fortschritt?.box) || BOX_MIN)
    const hatErklaerung = computed(() => !!String(aktuellerEintrag.value?.karte?.erklaerung || '').trim())

    function sitzungStarten() {
        // niedrigste Box zuerst, dann am längsten überfällig zuerst
        warteschlange.value = [...faelligeEintraege.value].sort((a, b) => {
            const boxA = Number(a.fortschritt?.box) || BOX_MIN
            const boxB = Number(b.fortschritt?.box) || BOX_MIN
            if (boxA !== boxB) return boxA - boxB
            return Number(a.fortschritt?.faelligAm ?? 0) - Number(b.fortschritt?.faelligAm ?? 0)
        })
        aktuellerIndex.value = 0
        sitzungRichtig.value = 0
        sitzungFalsch.value = 0
        sitzungSchwer.value = 0
        wiedervorgelegt.value = new Set()
        karteZuruecksetzen()
        phase.value = 'review'
        onZustand?.()
    }

    /** Aufdeckzustand für die nächste Karte — Antwort verdeckt, Erklärung zu. */
    function karteZuruecksetzen() {
        antwortSichtbar.value = false
        erklaerungOffen.value = false
    }

    function antwortZeigen() {
        antwortSichtbar.value = true
    }

    function erklaerungUmschalten() {
        erklaerungOffen.value = !erklaerungOffen.value
    }

    /** Eine Position weiter — oder in die Bilanz, wenn nichts mehr kommt. */
    function weiter() {
        karteZuruecksetzen()
        if (aktuellerIndex.value + 1 < warteschlange.value.length) aktuellerIndex.value++
        else phase.value = 'summary'
        onZustand?.()
    }

    async function bewerten(grad) {
        const eintrag = aktuellerEintrag.value
        if (!eintrag || beschaeftigt.value) return
        const patch = auswerten(eintrag.fortschritt, grad, Date.now())

        beschaeftigt.value = true
        try {
            if (eintrag.fortschritt) {
                await dbUpdate('quiz_fortschritt', eintrag.fortschritt.objectId, patch)
                Object.assign(eintrag.fortschritt, patch)
            } else {
                const erstellt = await dbCreate('quiz_fortschritt', { kartenId: eintrag.karte.objectId, ...patch })
                fortschritt.value.push(erstellt)
                eintrag.fortschritt = erstellt
            }
        } catch (fehler) {
            /*
             * Sichtbar wird der Fehler zentral (db.js-Hinweis). Die Karte bleibt
             * stehen und nichts wird gezählt — der nächste Klick versucht es
             * neu, statt dass eine Bewertung still verloren geht.
             */
            logWarn('lernsitzung', 'Bewertung nicht gespeichert', fehler)
            return
        } finally {
            beschaeftigt.value = false
        }

        /*
         * „Schwer" ist kein Treffer.
         *
         * Bis zum Audit vom 28.08.2026 zählte alles ausser „Vergessen" als
         * richtig — die angezeigte Trefferquote war damit systematisch zu gut,
         * und zwar genau bei den Karten, die man noch nicht kann. Die Box
         * bleibt trotzdem stehen (so will es der Leitner-Kanon in
         * `shared/leitner.js`: `gewusst` ist dort die Frage nach dem
         * Wiedersehen, nicht nach dem Können) — nur die Bilanz beschönigt
         * nicht mehr.
         */
        if (grad === GRADE_VERGESSEN) sitzungFalsch.value++
        else if (grad === GRADE_SCHWER) sitzungSchwer.value++
        else sitzungRichtig.value++

        /*
         * Box 1 ist sofort wieder fällig (INTERVALL_TAGE in shared/leitner.js) —
         * eine frisch vergessene Karte gehört deshalb ans Ende der laufenden
         * Warteschlange und nicht erst in die nächste Sitzung. „Schwer" kommt
         * aus demselben Grund zurück: wer eine Karte gerade eben nur mit Mühe
         * wusste, hat sie in dieser Runde nicht gelernt. Sie bleibt in ihrer Box
         * — die Wiedervorlage ist eine Sache DIESER Sitzung, nicht des
         * Langzeitplans.
         */
        const nochmal = grad === GRADE_VERGESSEN || grad === GRADE_SCHWER
        if (nochmal && !wiedervorgelegt.value.has(eintrag.karte.objectId)) {
            wiedervorgelegt.value.add(eintrag.karte.objectId)
            warteschlange.value.push(eintrag)
        }

        onGeaendert?.()
        weiter()
    }

    /**
     * Karte mitten in der Sitzung ausblenden.
     *
     * Ausblenden, nicht löschen — dieselbe Wirkung wie der Schalter im Reiter
     * „Karten" (`aktiv = 0`): der Lernverlauf bleibt, und ein Klick dort holt
     * die Karte zurück. Deshalb auch keine Rückfrage.
     *
     * Die Karte kann ZWEIMAL in der Warteschlange stehen, wenn sie vorher
     * wiedervorgelegt wurde — es müssen also alle Vorkommen weg, und der Index
     * muss auf die Zahl der überlebenden Einträge davor gesetzt werden. Genau
     * dort steht danach die nächste Karte.
     */
    async function karteAusblenden() {
        const eintrag = aktuellerEintrag.value
        if (!eintrag || beschaeftigt.value) return

        beschaeftigt.value = true
        try {
            await dbUpdate('quiz_karten', eintrag.karte.objectId, { aktiv: 0 })
            eintrag.karte.aktiv = 0
        } catch (fehler) {
            logWarn('lernsitzung', 'Karte ausblenden fehlgeschlagen', fehler)
            return
        } finally {
            beschaeftigt.value = false
        }

        const id = eintrag.karte.objectId
        const ueberlebendeDavor = warteschlange.value
            .slice(0, aktuellerIndex.value)
            .filter(e => e.karte.objectId !== id).length
        warteschlange.value = warteschlange.value.filter(e => e.karte.objectId !== id)
        aktuellerIndex.value = ueberlebendeDavor
        karteZuruecksetzen()
        if (aktuellerIndex.value >= warteschlange.value.length) phase.value = 'summary'

        onGeaendert?.()
        onZustand?.()
    }

    function sitzungBeenden() {
        phase.value = 'summary'
        onZustand?.()
    }

    function sitzungZurueck() {
        phase.value = 'start'
        onZustand?.()
    }

    return {
        // Zustand (schreibbar, damit eine unterbrochene Runde wiederherstellbar ist)
        phase, warteschlange, aktuellerIndex, antwortSichtbar, erklaerungOffen,
        sitzungRichtig, sitzungSchwer, sitzungFalsch, wiedervorgelegt, beschaeftigt,
        // Abgeleitetes
        aktuellerEintrag, aktuelleBox, hatErklaerung,
        // Bedienung
        sitzungStarten, antwortZeigen, erklaerungUmschalten, bewerten,
        karteAusblenden, sitzungBeenden, sitzungZurueck, karteZuruecksetzen,
    }
}
