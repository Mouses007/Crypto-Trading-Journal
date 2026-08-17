/**
 * Cockpit-Schnappschuss — das Live-Trading-Fenster als Bild ins Journal.
 *
 * Bisher brauchte ein Screenshot des Live-Fensters ein externes Werkzeug plus
 * Upload. Hier macht es ein Knopf, und zwar OHNE Rückfrage: die Seite wird per
 * DOM-Rendering (html2canvas) in ein Canvas gezeichnet — alle Kacheln sind
 * 2D-Canvas oder Text, das kopiert sauber. Das Ergebnis geht als ganz normaler
 * Screenshot über den bestehenden `screenshots`-Pfad und taucht in der
 * Setup-Galerie und der Tagesansicht am selben Tag auf wie der später
 * importierte Trade.
 *
 * Warum NICHT (mehr) die Screen-Capture-API als erster Weg: `getDisplayMedia`
 * existiert nur im sicheren Kontext (HTTPS/localhost). Das Journal läuft beim
 * Nutzer aber übers LAN per HTTP — dort war der Knopf damit wertlos. Die API
 * bleibt als Rückfalllinie, falls das DOM-Rendering scheitert UND der Kontext
 * sie hergibt.
 *
 * Bewusst KEIN Trade-Name (`t<dateUnix>_…`): während der Sitzung existiert der
 * Trade im Journal noch nicht — der Import kommt später. Symbol + Zeitstempel
 * reichen, um das Bild neben den importierten Trade zu legen.
 */

import dayjs from './dayjs-setup.js'
import { dbCreate } from './db.js'
import { timeZoneTrade } from '../stores/ui.js'

/** JPEG statt PNG: ein voller Bildschirm als PNG-Base64 wird schnell 5+ MB. */
const JPEG_QUALITAET = 0.85

/**
 * Die ganze Seite (inklusive der aus dem Sichtfeld gescrollten Kacheln) per
 * DOM-Rendering einfangen. Dynamischer Import, damit html2canvas als eigener
 * Chunk erst beim ersten Klick geladen wird.
 * @returns {Promise<string>} data-URL (image/jpeg)
 */
export async function fangeSeitenBild() {
    const { default: html2canvas } = await import('html2canvas')
    const canvas = await html2canvas(document.body, {
        backgroundColor: getComputedStyle(document.body).backgroundColor || '#0d0d14',
        // Volle Retina-Auflösung wäre ein Mehrfaches an Speicher für kaum
        // sichtbaren Gewinn im Journal.
        scale: Math.min(window.devicePixelRatio || 1, 1.5),
        useCORS: true,
        logging: false,
    })
    return canvas.toDataURL('image/jpeg', JPEG_QUALITAET)
}

/**
 * Rückfalllinie: einen Frame über die Screen-Capture-API (Auswahldialog).
 * Nur im sicheren Kontext (HTTPS/localhost) verfügbar.
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
    let base64
    try {
        base64 = await fangeSeitenBild()
    } catch (e) {
        // DOM-Rendering gescheitert (exotisches CSS, Speichergrenze) — wenn
        // der Kontext die Screen-Capture-API hergibt, darf sie übernehmen.
        if (navigator.mediaDevices?.getDisplayMedia) base64 = await fangeFensterBild()
        else throw e
    }
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
