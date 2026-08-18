import { reactive, ref } from 'vue'

/**
 * Sichtbarkeit und Reihenfolge von Karten — gespeichert je Gerät im localStorage.
 *
 * Die Mechanik stand wortgleich in `Dashboard.vue` und `Auswertung.vue`; mit dem
 * Marktradar wäre sie dreimal im Baum. Herausgezogen ist nur die Mechanik, nicht
 * das Zahnrad-Markup: die drei Seiten setzen es in ganz verschiedene Leisten.
 *
 * Das Speicherformat der Sichtbarkeit bleibt unverändert (Array von Schlüsseln
 * unter demselben Namen), damit vorhandene Einträge weiter gelten. Die
 * Reihenfolge kommt als zweiter Eintrag `<key>_order` dazu.
 *
 * `standardVersteckt` belegt die Ausblend-Menge beim ERSTEN Aufruf vor (solange
 * unter `storageKey` noch nichts gespeichert ist). Gedacht für Seiten mit
 * grossem Katalog, die aufgeräumt starten sollen (Startseite): dort sind fünf
 * Kacheln sichtbar, der Rest wartet im Zahnrad. Sobald der Nutzer einmal
 * umschaltet, gilt ausschliesslich sein localStorage — die Vorgabe drängt sich
 * nie ein zweites Mal auf. Marktradar/Live-Trading rufen ohne das Argument auf
 * und starten damit wie bisher mit allen Kacheln sichtbar.
 *
 * @param {string} storageKey z.B. 'marktradar_hidden_cards'
 * @param {string[]} [standardVersteckt=[]] beim Erststart ausgeblendete Ids
 */
export function useHiddenCards(storageKey, standardVersteckt = []) {
    const orderKey = `${storageKey}_order`

    const lies = (key, vorgabe) => {
        try {
            const roh = JSON.parse(localStorage.getItem(key) || 'null')
            return Array.isArray(roh) ? roh : vorgabe
        } catch {
            // Kaputter Eintrag (von Hand bearbeitet, halb geschrieben) darf die
            // Seite nicht lahmlegen — dann eben mit der Vorgabe weiter.
            return vorgabe
        }
    }

    const sizeKey = `${storageKey}_size`

    // Fehlt der Eintrag (Erststart), gilt `standardVersteckt`; sobald einmal
    // gespeichert wurde (auch ein leeres Array durch „alle zeigen"), gewinnt der
    // gespeicherte Stand.
    const hiddenCards = reactive(new Set(lies(storageKey, standardVersteckt)))
    const reihenfolge = ref(lies(orderKey, []))

    // id → { spalten, hoehe } aus dem Ziehen am Eckanfasser
    const groessen = reactive((() => {
        try {
            const roh = JSON.parse(localStorage.getItem(sizeKey) || 'null')
            return roh && typeof roh === 'object' && !Array.isArray(roh) ? roh : {}
        } catch {
            return {}
        }
    })())

    const schreibeSichtbarkeit = () =>
        localStorage.setItem(storageKey, JSON.stringify([...hiddenCards]))

    function toggleCard(key) {
        if (hiddenCards.has(key)) hiddenCards.delete(key)
        else hiddenCards.add(key)
        schreibeSichtbarkeit()
    }

    function isVisible(key) {
        return !hiddenCards.has(key)
    }

    function zeigeAlle() {
        hiddenCards.clear()
        schreibeSichtbarkeit()
    }

    function setzeReihenfolge(ids) {
        reihenfolge.value = [...ids]
        localStorage.setItem(orderKey, JSON.stringify(reihenfolge.value))
    }

    /** Beim Ziehen ohne Schreiben aufrufen, am Ende einmal mit `sichern`. */
    function setzeGroesse(id, wert, sichern = false) {
        if (wert === null) delete groessen[id]
        else groessen[id] = { ...groessen[id], ...wert }
        if (sichern) localStorage.setItem(sizeKey, JSON.stringify(groessen))
    }

    return {
        hiddenCards, reihenfolge, groessen,
        toggleCard, isVisible, zeigeAlle, setzeReihenfolge, setzeGroesse,
    }
}
