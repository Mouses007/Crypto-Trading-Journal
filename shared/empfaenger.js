/**
 * Eine Empfängerliste aus einem Textfeld lesen.
 *
 * Geteilt zwischen Server und Browser, aus demselben Grund wie
 * `handelszeiten.js`: Der Server entscheidet, an wen die Post geht, die
 * Oberfläche zeigt es beim Tippen an — und wenn beide Seiten dieselbe Regel je
 * für sich umsetzen, driften sie auseinander. Dann meldet die Oberfläche
 * „4 Empfänger", der Server schickt an drei, und niemand findet den Grund.
 *
 * Frei von Netz, Datenbank und Vue, damit der Selbsttest sie prüfen kann.
 */

/**
 * Wie viele Empfänger eine Liste tragen darf.
 *
 * Der Deckel ist keine technische Grenze, sondern eine Bremse: Ein Journal für
 * einen Betreiber verschickt an den Betreiber und ein paar Mitleser. Wer einen
 * Newsletter will, will einen Newsletter-Dienst.
 */
export const EMPFAENGER_MAX = 10

/** Eine Adresse muss so aussehen — dieselbe Prüfung wie im Einstellungs-PUT. */
const ADRESSE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Getrennt wird durch Komma, Semikolon, Leerzeichen oder Zeilenumbruch. */
const TRENNER = /[,;\s]+/

/**
 * Aus einem Textfeld die gültigen Empfänger — und was dabei liegen blieb.
 *
 * Wer eine Liste einträgt, soll nicht raten müssen, welches Trennzeichen gilt.
 * Doppelte fallen weg (Gross-/Kleinschreibung egal), damit niemand zweimal
 * dieselbe Post bekommt; erhalten bleibt die ERSTE Schreibweise, denn die hat
 * der Leser so gewollt.
 *
 * `verworfen` ist der Punkt der Übung: Eine stille Filterung wäre bequemer zu
 * schreiben, aber ein Tippfehler fiele dann erst auf, wenn die Post ausbleibt
 * — und dann sucht man am SMTP-Zugang statt an der Adresse.
 *
 * @returns {{ gueltig: string[], verworfen: string[] }}
 */
export function empfaengerPruefung(roh, { max = EMPFAENGER_MAX } = {}) {
    const gesehen = new Set()
    const gueltig = []
    const verworfen = []
    for (const teil of String(roh || '').split(TRENNER)) {
        const a = teil.trim()
        if (!a) continue
        if (!ADRESSE.test(a)) { verworfen.push(a); continue }
        const schluessel = a.toLowerCase()
        if (gesehen.has(schluessel)) continue
        gesehen.add(schluessel)
        // Über dem Deckel wird nicht still abgeschnitten, sondern verworfen —
        // sonst fehlte dem Leser genau die Adresse, die er zuletzt eintrug.
        if (gueltig.length >= max) { verworfen.push(a); continue }
        gueltig.push(a)
    }
    return { gueltig, verworfen }
}

/** Nur die gültigen Adressen — der Weg, den der Versand nimmt. */
export function empfaengerListe(roh, opt) {
    return empfaengerPruefung(roh, opt).gueltig
}
