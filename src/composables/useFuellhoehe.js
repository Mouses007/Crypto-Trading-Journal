/**
 * Höhe eines Elements so setzen, dass es genau bis zum unteren Fensterrand
 * reicht — gemessen, nicht geraten.
 *
 * Vorher stand in Bookmap und Liquidationskarte je ein `calc(100dvh - 90px)`
 * bzw. `- 7.5rem`. Die Zahl sollte Seitenkopf, Modus-Reiter und Kartenkopf
 * abdecken und tat es nicht: gemeldet am 07.09.2026 als Scrollbalken auf
 * beiden Seiten. Sie KANN es auch nicht zuverlässig, weil über der Karte je
 * nach Zustand verschieden viel steht (Modus-Reiter, Warnzeilen, Cockpit ohne
 * Navigation) und sich das mit der Fensterbreite ändert.
 *
 * Also wird der Abstand nach oben gemessen und der Rest verteilt. Der Preis
 * ist ein Stück JavaScript für etwas, das nach CSS aussieht — dafür stimmt es
 * in allen Zuständen, statt in einem.
 */
import { onBeforeUnmount, onMounted, ref, nextTick } from 'vue'

/**
 * @param {number} [luft]     Abstand nach unten in px
 * @param {number} [minimum]  Untergrenze in px — darunter wird gescrollt statt
 *                            die Karte unbenutzbar zu quetschen
 */
export function useFuellhoehe(luft = 12, minimum = 320) {
    const el = ref(null)
    let ro = null

    function messen() {
        const node = el.value
        if (!node) return
        /*
         * Erst die Höhe freigeben, dann messen. Sonst misst man den Abstand
         * nach oben, den die eigene Höhe gerade erzeugt hat — bei jedem
         * Durchlauf ein bisschen anders, und die Karte wandert.
         */
        node.style.height = ''
        const oben = node.getBoundingClientRect().top + window.scrollY
        const hoehe = Math.max(minimum, Math.round(window.innerHeight - oben - luft))
        node.style.height = hoehe + 'px'
    }

    onMounted(async () => {
        await nextTick()
        messen()
        window.addEventListener('resize', messen)
        /*
         * Der Kartenkopf wächst und schrumpft im Betrieb (Warnzeile „Fenster zu
         * kurz", umbrechende Kopfzeile). Ohne Beobachter bliebe die Höhe dann
         * stehen und der Scrollbalken käme zurück — nur seltener, was schlimmer
         * ist als immer.
         */
        if (typeof ResizeObserver !== 'undefined' && el.value?.parentElement) {
            ro = new ResizeObserver(() => messen())
            ro.observe(el.value.parentElement)
        }
    })

    onBeforeUnmount(() => {
        window.removeEventListener('resize', messen)
        ro?.disconnect()
        ro = null
    })

    return { el, messen }
}
