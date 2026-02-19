/**
 * Browser Notification Helper
 * Zeigt Desktop-Benachrichtigungen wenn der Tab nicht im Fokus ist.
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

/** Benachrichtigung senden (nur wenn Tab nicht fokussiert und Setting aktiviert) */
export function sendNotification(title, body, options = {}) {
    if (!('Notification' in window)) return
    if (Notification.permission !== 'granted') return
    if (document.hasFocus()) return // Kein Popup wenn Tab aktiv
    if (currentUser.value?.browserNotifications === 0) return // Setting deaktiviert

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
