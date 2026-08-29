/**
 * Rückfrage, bevor ungespeicherte Eingaben verloren gehen.
 *
 * Das Frontend hatte davon bis zum Audit vom 28.08.2026 nichts — weder
 * `beforeunload` noch `onBeforeRouteLeave` kamen irgendwo vor. Ein
 * halbgeschriebener Tagebucheintrag war mit einem Klick auf „Abbrechen", einem
 * Menüwechsel oder einem F5 weg, ohne Nachfrage.
 *
 * BEIDE Wege sind nötig, und das ist kein Gürtel-und-Hosenträger:
 *   - `onBeforeRouteLeave` fängt die Navigation innerhalb der App,
 *   - `beforeunload` fängt Neuladen, Tab schliessen — UND die
 *     „Abbrechen"-Knöpfe der Formularseiten, die `location.href = …` setzen
 *     und damit am Router vorbeigehen.
 *
 * Der Browser zeigt bei `beforeunload` seinen eigenen, nicht anpassbaren Text;
 * `returnValue` muss trotzdem gesetzt werden, sonst erscheint gar nichts.
 * Innerhalb der App fragen wir mit `confirm()` und eigenem Wortlaut.
 *
 * Verwendung im `<script setup>` einer View:
 *
 *   const schmutzig = computed(() => text.value.trim().length > 0)
 *   useVerlassenSchutz(schmutzig)
 *
 * Nach dem Speichern muss die Bedingung von selbst `false` werden (Feld
 * geleert, Formular zurückgesetzt) — sonst fragt die Weiterleitung direkt im
 * Anschluss noch einmal.
 */
import { onBeforeUnmount, onMounted, unref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'

/**
 * @param {import('vue').Ref<boolean>|(() => boolean)} istSchmutzig
 *        Ref oder Funktion: gibt es ungespeicherte Eingaben?
 * @param {string|(() => string)} [frage] Text der In-App-Rückfrage, oder eine
 *        Funktion, die ihn liefert. Als Funktion übergeben, weil `t(…)` erst
 *        zur Aufrufzeit die richtige Sprache kennt.
 */
export function useVerlassenSchutz(istSchmutzig, frage) {
    const schmutzig = () => {
        try {
            const v = typeof istSchmutzig === 'function' ? istSchmutzig() : unref(istSchmutzig)
            return !!v
        } catch {
            /*
             * Eine kaputte Bedingung darf nicht dazu führen, dass niemand die
             * Seite mehr verlassen kann. Im Zweifel durchlassen.
             */
            return false
        }
    }

    function beiEntladen(e) {
        if (!schmutzig()) return
        e.preventDefault()
        e.returnValue = ''   // ohne das zeigt Chrome nichts an
        return ''
    }

    onMounted(() => window.addEventListener('beforeunload', beiEntladen))
    onBeforeUnmount(() => window.removeEventListener('beforeunload', beiEntladen))

    onBeforeRouteLeave(() => {
        if (!schmutzig()) return true
        const text = typeof frage === 'function' ? frage() : frage
        return window.confirm(text || 'Es gibt ungespeicherte Eingaben. Seite trotzdem verlassen?')
    })
}
