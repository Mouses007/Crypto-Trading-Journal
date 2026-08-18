/**
 * Datenschutz-/Zensur-Modus für das Journal.
 *
 * Zahlen und Geldwerte tragen im Journal keine gemeinsame CSS-Klasse (Mischung
 * aus greenTrade/redTrade/text-warning und Bootstrap-Utilities). Statt jede
 * Stelle zu markieren, erkennen wir Zahlen-Blätter am Textinhalt: ein Blatt
 * (Element ohne Kind-Elemente), dessen Text mindestens eine Ziffer und KEINEN
 * Buchstaben enthält, ist ein Wert — Beschriftungen haben immer Buchstaben.
 *
 * So werden „$ 573.62", „-57.9%", „215", „$ 16'610", „1:1.2" verwischt, aber
 * „Kontostand" oder „P/L Ratio" bleiben lesbar.
 *
 * Ein MutationObserver markiert nach jedem Vue-Re-Render nach. Er beobachtet nur
 * childList/characterData (nicht Attribute), damit das Setzen unserer Klasse ihn
 * nicht selbst auslöst.
 */

const CENSOR_CLASS = 'tj-censor'
const HAT_ZIFFER = /\d/
const HAT_BUCHSTABE = /[A-Za-zÀ-ÖØ-öø-ÿ]/

function istZahlenBlatt(el) {
    if (el.children.length) return false
    const t = (el.textContent || '').trim()
    if (!t || t.length > 24) return false
    if (!HAT_ZIFFER.test(t)) return false
    if (HAT_BUCHSTABE.test(t)) return false
    return true
}

function markiere(root) {
    root.querySelectorAll('*').forEach(el => {
        if (istZahlenBlatt(el)) el.classList.add(CENSOR_CLASS)
        else if (el.classList.contains(CENSOR_CLASS)) el.classList.remove(CENSOR_CLASS)
    })
}

function entferne(root) {
    root.querySelectorAll('.' + CENSOR_CLASS).forEach(el => el.classList.remove(CENSOR_CLASS))
}

/**
 * Startet die Zensur auf `root`. Gibt eine Funktion zurück, die alles wieder
 * aufräumt (Observer trennen, Klassen entfernen, body-Klasse zurücknehmen).
 */
export function starteZensur(root) {
    if (!root) return () => {}
    document.body.classList.add('privacy-on')
    markiere(root)

    let geplant = false
    const observer = new MutationObserver(() => {
        if (geplant) return
        geplant = true
        requestAnimationFrame(() => { geplant = false; markiere(root) })
    })
    observer.observe(root, { childList: true, subtree: true, characterData: true })

    return () => {
        observer.disconnect()
        document.body.classList.remove('privacy-on')
        entferne(root)
    }
}
