/**
 * Chart-Alarme im Browser: Liste, Anlegen/Ändern/Löschen und ein Blick alle
 * zehn Sekunden, ob einer ausgelöst hat.
 *
 * Geprüft wird auf dem SERVER (`server/chart-alarme.js`) — auch bei
 * geschlossener Seite, Meldung per Push/Mail. Hier geht es nur darum, eine
 * Auslösung auch auf der offenen Seite zu zeigen: als Banner, und als
 * Browser-Meldung, wenn der Tab im Hintergrund liegt.
 */
import { ref } from 'vue'
import axios from 'axios'
import { sendNotification } from '../utils/notify.js'

export const alarme = ref([])
export const neueAusloesungen = ref([])     // [{ id, symbol, text, t }]

let uhr = null
let nutzer = 0
let gesehenBis = Date.now()

export async function ladeAlarme() {
    try {
        const { data } = await axios.get('/api/chart/alarme')
        const neu = data.filter((a) => a.ausgeloestAm > gesehenBis)
        if (neu.length) {
            gesehenBis = Math.max(...neu.map((a) => a.ausgeloestAm))
            for (const a of neu) {
                const letzte = a.verlauf[a.verlauf.length - 1]
                const text = `${a.symbol}: ${beschreibe(a)}${letzte ? ` — ${letzte.p}` : ''}`
                neueAusloesungen.value = [...neueAusloesungen.value, { id: a.id, symbol: a.symbol, text, t: a.ausgeloestAm }].slice(-5)
                sendNotification('chartAlarm', `Alarm ${a.symbol}`, text)
            }
        }
        alarme.value = data
    } catch { /* nächster Versuch in zehn Sekunden */ }
}

/** Kurzbeschreibung für Liste, Banner und Preislinie. */
export function beschreibe(a) {
    const b = a.bedingung || {}
    const r = { ueber: '↑ über', unter: '↓ unter', kreuzt: '↕ kreuzt', betreten: '→ Zone betreten', verlassen: '← Zone verlassen' }[b.richtung || (a.art === 'zone' ? 'betreten' : 'kreuzt')]
    if (a.art === 'preis') return `${r} ${b.preis}`
    if (a.art === 'linie') return `${r} Linie${b.kante && b.kante !== 'oben' ? ` (${b.kante})` : ''}`
    return r
}

/** Polling starten — mehrere Nutzer (Seite, Reiter) teilen einen Takt. */
export function abonniereAlarme() {
    nutzer++
    if (!uhr) {
        ladeAlarme()
        uhr = setInterval(ladeAlarme, 10_000)
    }
    return () => {
        nutzer--
        if (nutzer <= 0) { clearInterval(uhr); uhr = null; nutzer = 0 }
    }
}

export async function legeAlarmAn(daten) {
    const { data } = await axios.post('/api/chart/alarme', daten)
    alarme.value = [data, ...alarme.value]
    return data
}

export async function aendereAlarm(id, patch) {
    const { data } = await axios.put(`/api/chart/alarme/${id}`, patch)
    alarme.value = alarme.value.map((a) => (a.id === id ? data : a))
    return data
}

export async function loescheAlarm(id) {
    await axios.delete(`/api/chart/alarme/${id}`)
    alarme.value = alarme.value.filter((a) => a.id !== id)
}

export function quittiere(id) {
    neueAusloesungen.value = neueAusloesungen.value.filter((x) => x.id !== id)
}
