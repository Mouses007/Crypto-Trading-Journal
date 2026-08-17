/**
 * Cockpit-Schnappschuss — das Live-Trading-Fenster als Bild ins Journal.
 *
 * Bisher brauchte ein Screenshot des Live-Fensters ein externes Werkzeug plus
 * Upload. Hier macht es ein Knopf: die Screen-Capture-API liefert EINEN Frame
 * des Fensters (der Browser fragt, welches geteilt wird — das ist die einzige
 * Rückfrage), der als ganz normaler Screenshot über den bestehenden
 * `screenshots`-Pfad gespeichert wird. Er taucht damit in der Setup-Galerie
 * und in der Tagesansicht am selben Tag auf wie der später importierte Trade.
 *
 * Bewusst KEIN Trade-Name (`t<dateUnix>_…`): während der Sitzung existiert der
 * Trade im Journal noch nicht — der Import kommt später. Symbol + Zeitstempel
 * reichen, um das Bild neben den importierten Trade zu legen.
 *
 * Grenze der API: `getDisplayMedia` gibt es nur im sicheren Kontext (HTTPS
 * oder localhost). Übers LAN per HTTP fehlt die Funktion — dann gibt es eine
 * verständliche Meldung statt eines stillen Fehlschlags.
 */

import dayjs from './dayjs-setup.js'
import { dbCreate } from './db.js'
import { timeZoneTrade } from '../stores/ui.js'

/** JPEG statt PNG: ein voller Bildschirm als PNG-Base64 wird schnell 5+ MB. */
const JPEG_QUALITAET = 0.85

/**
 * Einen Frame des vom Nutzer gewählten Fensters einfangen.
 * @returns {Promise<string>} data-URL (image/jpeg)
 */
export async function fangeFensterBild() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('Bildschirmaufnahme braucht HTTPS oder localhost — über eine LAN-Adresse per HTTP stellt der Browser die Funktion nicht bereit.')
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
        // Hinweise an den Auswahldialog: das eigene Fenster/der eigene Tab
        // zuerst. Chrome versteht `preferCurrentTab`, andere ignorieren es.
        video: { displaySurface: 'window' },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
    })
    try {
        const video = document.createElement('video')
        video.srcObject = stream
        video.muted = true
        await video.play()
        // Erst nach dem ersten gerenderten Frame zeichnen — direkt nach play()
        // ist die Fläche gelegentlich noch schwarz.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        canvas.getContext('2d').drawImage(video, 0, 0)
        return canvas.toDataURL('image/jpeg', JPEG_QUALITAET)
    } finally {
        // Sofort wieder freigeben, sonst zeigt der Browser dauerhaft
        // „teilt den Bildschirm" an.
        stream.getTracks().forEach((t) => t.stop())
    }
}

/**
 * Schnappschuss aufnehmen und als Journal-Screenshot speichern.
 *
 * @param {string} symbol aktuell gewähltes Symbol (landet im Namen und Filter)
 * @returns {Promise<{objectId: string, name: string}>}
 */
export async function speichereCockpitFoto(symbol) {
    const base64 = await fangeFensterBild()
    const jetzt = dayjs().tz(timeZoneTrade.value)
    const dateUnix = jetzt.unix()
    const name = `${dateUnix}_${symbol || 'COCKPIT'}`
    const result = await dbCreate('screenshots', {
        name,
        symbol: symbol || '',
        side: '',
        originalBase64: base64,
        annotatedBase64: base64,
        markersOnly: true,
        maState: null,
        date: jetzt.format('YYYY-MM-DDTHH:mm:ss'),
        dateUnix,
        dateUnixDay: jetzt.startOf('day').unix(),
    })
    return { objectId: result.objectId, name }
}
