/**
 * Browser-Benachrichtigungen.
 *
 * Zeigt eine Meldung, wenn der Tab NICHT im Vordergrund ist — wer hinsieht,
 * braucht kein Popup. Das ist zugleich die Grenze dieses Kanals: bei
 * geschlossener Seite erreicht er niemanden. Alles, was auch dann ankommen
 * soll, läuft über den E-Mail-Weg (`server/benachrichtigungen.js`).
 *
 * Jede Meldung trägt eine Ereignis-Kennung aus dem Register. Über sie greift
 * die Kanalwahl aus den Einstellungen; das Register selbst liegt beim Server
 * (`GET /api/benachrichtigungen/typen`), damit ein neuer Meldungstyp nur an
 * einer Stelle eingetragen werden muss.
 */
import { currentUser } from '../stores/settings.js'

/** Permission anfordern (sollte einmal beim App-Start aufgerufen werden) */
export async function requestNotificationPermission() {
    if (!('Notification' in window)) return false
    if (Notification.permission === 'granted') return true
    if (Notification.permission === 'denied') return false
    const result = await Notification.requestPermission()
    return result === 'granted'
}

/**
 * Darf dieses Ereignis über den Browser melden?
 *
 * Ohne gespeicherte Wahl gilt „an" — sonst würde ein neu hinzugekommener
 * Meldungstyp stillschweigend verschluckt, und ein Nutzer, der nie in die
 * Einstellungen geschaut hat, bekäme gar nichts mehr.
 */
export function browserKanalAn(eventId) {
    if (!eventId) return true
    const wahl = currentUser.value?.benachrichtigungen
    const eintrag = (wahl && typeof wahl === 'object' ? wahl[eventId] : null) || {}
    return eintrag.browser !== undefined ? Boolean(eintrag.browser) : true
}

/**
 * Benachrichtigung senden.
 *
 * @param {string} eventId Ereignis aus dem Register (z.B. 'importFertig')
 * @param {string} title   Überschrift
 * @param {string} body    Text
 */
export function sendNotification(eventId, title, body, options = {}) {
    if (!('Notification' in window)) return
    if (Notification.permission !== 'granted') return
    if (document.hasFocus()) return // Kein Popup wenn Tab aktiv
    if (currentUser.value?.browserNotifications === 0) return // Hauptschalter aus
    if (!browserKanalAn(eventId)) return // Für dieses Ereignis abgewählt

    const notification = new Notification(title, {
        body,
        icon: '/src/assets/favicon.png',
        ...options
    })

    // Klick auf Notification → Tab fokussieren
    notification.onclick = () => {
        window.focus()
        notification.close()
    }

    // Auto-Close nach 8 Sekunden
    setTimeout(() => notification.close(), 8000)
}
