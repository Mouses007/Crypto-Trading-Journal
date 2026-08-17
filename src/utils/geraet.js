/**
 * „Sitzt hier ein Telefon?" — eine Frage, zwei Merkmale.
 *
 * Das Projekt hat mit `screenType` bereits eine Antwort, die auf der Breite
 * beruht (`>= 992 px` = 'computer'). Für das Layout ist das genau richtig: ein
 * schmales Fenster braucht ein schmales Menü, egal woran es hängt.
 *
 * Für die Frage „darf diese Seite überhaupt erscheinen" reicht es nicht. Ein
 * Desktop-Browser in einem halb breiten Fenster ist kein Telefon, und ihn aus
 * dem Live-Trading-Fenster zu werfen, während er nur seine Fenster sortiert,
 * wäre eine unangenehme Überraschung. Beim Entwickeln ist genau das passiert:
 * ein frisch geöffneter, noch nicht vermessener Tab galt als mobil und wurde
 * umgeleitet.
 *
 * Deshalb hier zwei Bedingungen, die beide gelten müssen:
 *   1. eine gemessene, kleine Breite — `0` heisst „noch nicht vermessen" und
 *      zählt ausdrücklich NICHT als klein
 *   2. ein grober Zeiger (Finger statt Maus)
 *
 * Im Zweifel lautet die Antwort „kein Telefon". Eine Seite fälschlich zu zeigen
 * ist harmlos; sie fälschlich wegzunehmen nicht.
 */

import { ref, onMounted, onBeforeUnmount } from 'vue'

/** Schwelle wie bei `screenType` in `utils.js`, damit beides zusammenpasst. */
const SCHMAL = 992

export function istTelefonJetzt() {
    if (typeof window === 'undefined') return false
    const b = window.innerWidth
    if (!(b > 0) || b >= SCHMAL) return false
    return window.matchMedia?.('(pointer: coarse)').matches === true
}

/**
 * Läuft die Seite bildschirmfüllend?
 *
 * Zwei Wege führen dorthin, und sie sehen für das Programm völlig verschieden
 * aus:
 *
 *   1. Die Fullscreen-API (unser Knopf) — meldet sich über `fullscreenchange`
 *      und setzt `document.fullscreenElement`.
 *   2. **F11**, das native Vollbild des Browsers — löst dieses Ereignis NICHT
 *      aus und lässt `fullscreenElement` auf `null`. Ohne den zweiten Test
 *      unten bliebe die Kopfzeile bei F11 einfach stehen, und das sieht aus
 *      wie ein kaputter Knopf.
 *
 * Der zweite Test vergleicht die Fensterhöhe mit der Bildschirmhöhe. Die zwei
 * Pixel Spielraum fangen Rundungen bei nicht ganzzahliger Skalierung ab.
 */
export function istVollbildJetzt() {
    if (typeof window === 'undefined') return false
    if (document.fullscreenElement) return true
    const h = window.screen?.height
    return !!h && Math.abs(window.innerHeight - h) <= 2
}

/** Reaktive Fassung; hört auf beide Wege ins Vollbild. */
export function useImVollbild() {
    const imVollbild = ref(istVollbildJetzt())
    const pruefe = () => { imVollbild.value = istVollbildJetzt() }

    onMounted(() => {
        pruefe()
        document.addEventListener('fullscreenchange', pruefe)
        window.addEventListener('resize', pruefe)
    })
    onBeforeUnmount(() => {
        document.removeEventListener('fullscreenchange', pruefe)
        window.removeEventListener('resize', pruefe)
    })

    return imVollbild
}

/**
 * Reaktive Fassung für Komponenten. Beobachtet die Fenstergrösse, damit ein
 * Drehen des Geräts nicht erst beim nächsten Seitenaufruf zählt.
 */
export function useIstTelefon() {
    const istTelefon = ref(istTelefonJetzt())
    const pruefe = () => { istTelefon.value = istTelefonJetzt() }

    onMounted(() => {
        pruefe()
        window.addEventListener('resize', pruefe)
        window.addEventListener('orientationchange', pruefe)
    })
    onBeforeUnmount(() => {
        window.removeEventListener('resize', pruefe)
        window.removeEventListener('orientationchange', pruefe)
    })

    return istTelefon
}
