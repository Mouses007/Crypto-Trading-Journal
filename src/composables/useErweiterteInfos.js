/**
 * Schalter „Erweiterte Infos": zeigt oder verbirgt alle `InfoTipp`-Symbole.
 *
 * Modulweiter Ref statt eines Watchers je Komponente. Bei ~100 Symbolen auf
 * einer Seite wäre sonst jedes einzelne an `currentUser` gehängt; so hängt
 * genau einer daran und alle lesen denselben Wert.
 *
 * Der Startwert kommt SYNCHRON aus dem localStorage — dasselbe Vorgehen wie
 * bei `startseiteAn` (`src/utils/utils.js`). Nötig, weil die Vorgabe „an" ist:
 * ohne Spiegel blitzten bei jemandem, der die Symbole abgeschaltet hat, alle
 * kurz auf, bis `dbGetSettings()` antwortet. Die Datenbank bleibt die Wahrheit,
 * der Spiegel ist nur das Gedächtnis für die ersten Millisekunden.
 */
import { ref, watch } from 'vue'
import { currentUser } from '../stores/settings.js'

function ausSpeicher() {
    try {
        const roh = localStorage.getItem('erweiterteInfos')
        if (roh === null) return true          // nie gesetzt → Vorgabe an
        return roh === '1'
    } catch (_) {
        return true
    }
}

export const erweiterteInfos = ref(ausSpeicher())

/**
 * Spiegel schreiben UND den Ref setzen. Wird von den Einstellungen beim
 * Speichern gerufen.
 *
 * Der Ref muss hier mitgesetzt werden, nicht nur der Spiegel: `kiSpeichern`
 * in den Einstellungen schreibt mit `currentUser.value[feld] = wert`, ändert
 * also eine Eigenschaft INNERHALB des Objekts. Der Watch unten fängt das zwar
 * ab, aber diesen Weg zu haben macht die Wirkung unabhängig davon, wie die
 * Einstellungen den Wert ablegen.
 */
export function merkeErweiterteInfos(an) {
    erweiterteInfos.value = !!an
    try {
        localStorage.setItem('erweiterteInfos', an ? '1' : '0')
    } catch (_) { /* privates Fenster: dann eben ohne Gedächtnis */ }
}

/*
 * Sobald die Einstellungen geladen sind, gewinnt der Wert aus der Datenbank.
 *
 * Beobachtet wird ausdrücklich der EINZELWERT und nicht `currentUser` selbst:
 * ein Watch auf dem Ref feuert nur, wenn `.value` ersetzt wird — und die
 * Einstellungen ersetzen es nie, sie schreiben eine Eigenschaft hinein. Ein
 * Getter-Watch verfolgt genau diese Eigenschaft und merkt die Änderung.
 *
 * `?? 1` wie überall sonst: Unwissen ist kein Nein.
 */
watch(() => currentUser.value?.erweiterteInfos, (roh) => {
    if (!currentUser.value) return
    merkeErweiterteInfos(Number(roh ?? 1) === 1)
}, { immediate: true })
