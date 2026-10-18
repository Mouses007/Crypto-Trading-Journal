/**
 * Zeichnungen des Chart-Arbeitsplatzes — je Symbol EINE reaktive Liste.
 *
 * Zwei Panels mit demselben Symbol (etwa 1h und 15m nebeneinander) zeigen
 * dieselben Linien; wer eine verschiebt, sieht sie im Nachbarpanel mitwandern.
 * Deshalb liegt der Bestand hier und nicht im Panel.
 *
 * Änderungen wirken sofort (optimistisch) und gehen dann an den Server. Geht
 * das schief, wird der vorige Stand wiederhergestellt — eine Linie, die auf
 * dem Bildschirm steht, aber nie gespeichert wurde, wäre beim nächsten Laden
 * kommentarlos weg.
 *
 * Rückgängig/Wiederholen gilt über alle Symbole, in der Reihenfolge der
 * Handlungen, und nur für diese Sitzung (wie in jedem Zeichenprogramm). Die
 * Schritte laufen in EINER Reihe: dreimal schnell Strg+Z startete vorher drei
 * Rückgängig gleichzeitig, und ein Schritt, der auf die neue id eines eben
 * wiederhergestellten wartete, griff noch auf die alte.
 *
 * Änderungen an derselben Zeichnung gehen nacheinander an den Server, und nur
 * die Antwort der LETZTEN wird übernommen — vorher konnte eine ältere Antwort
 * eine jüngere überholen, und die Linie sprang zurück.
 */
import { ref } from 'vue'
import axios from 'axios'
import { alarme, legeAlarmAn } from './chartAlarme.js'

const bestand = new Map()        // symbol → ref([...])
const laedt = new Map()          // symbol → Promise
const rueckgaengig = []          // [{ art, vorher, nachher }]
const wiederholen = []
const MAX_SCHRITTE = 100
const schlange = new Map()       // id → Promise der letzten Änderung (Reihenfolge am Server)
const folge = new Map()          // id → Nummer der jüngsten Änderung (nur deren Antwort zählt)
let schrittKette = Promise.resolve()

export const fehlerMeldung = ref('')

export function zeichnungenVon(symbol) {
    if (!bestand.has(symbol)) bestand.set(symbol, ref([]))
    if (!laedt.has(symbol)) {
        laedt.set(symbol, axios.get('/api/chart/zeichnungen', { params: { symbol } })
            .then((r) => { bestand.get(symbol).value = r.data })
            .catch((e) => { laedt.delete(symbol); fehlerMeldung.value = e.response?.data?.error || e.message }))
    }
    return bestand.get(symbol)
}

function liste(symbol) {
    if (!bestand.has(symbol)) bestand.set(symbol, ref([]))
    return bestand.get(symbol)
}

function ersetze(z) {
    const l = liste(z.symbol)
    const i = l.value.findIndex((x) => x.id === z.id)
    if (i >= 0) l.value = [...l.value.slice(0, i), z, ...l.value.slice(i + 1)]
    else l.value = [...l.value, z]
}

function entferneLokal(symbol, id) {
    const l = liste(symbol)
    l.value = l.value.filter((x) => x.id !== id)
}

function merke(schritt) {
    rueckgaengig.push(schritt)
    if (rueckgaengig.length > MAX_SCHRITTE) rueckgaengig.shift()
    wiederholen.length = 0
}

function felder(z) {
    const { symbol, typ, punkte, stil, sichtbarAuf, gesperrt, versteckt } = z
    return { symbol, typ, punkte, stil, sichtbarAuf, gesperrt, versteckt }
}

/** Neue Zeichnung anlegen. Gibt die gespeicherte Zeile (mit id) zurück. */
export async function legeAn(daten, { merken = true } = {}) {
    try {
        const { data } = await axios.post('/api/chart/zeichnungen', felder(daten))
        ersetze(data)
        if (merken) merke({ art: 'neu', nachher: data })
        return data
    } catch (e) {
        fehlerMeldung.value = e.response?.data?.error || e.message
        return null
    }
}

/** Felder einer Zeichnung ändern (Punkte, Stil, Sperre …). */
export async function aendere(symbol, id, patch, { merken = true } = {}) {
    const l = liste(symbol)
    const vorher = l.value.find((x) => x.id === id)
    if (!vorher) return null
    const nachher = { ...vorher, ...patch }
    ersetze(nachher)
    const nr = (folge.get(id) || 0) + 1
    folge.set(id, nr)
    const anfrage = (schlange.get(id) || Promise.resolve()).then(() => axios.put(`/api/chart/zeichnungen/${id}`, patch))
    schlange.set(id, anfrage.catch(() => {}))
    try {
        const { data } = await anfrage
        if (folge.get(id) === nr) { ersetze(data); schlange.delete(id) }
        if (merken) merke({ art: 'aendern', vorher, nachher: data })
        return data
    } catch (e) {
        // Zurück nur, wenn seither nichts Neueres kam — sonst verwürfe das eine spätere Änderung.
        if (folge.get(id) === nr) ersetze(vorher)
        fehlerMeldung.value = e.response?.data?.error || e.message
        return null
    }
}

/*
 * Der Server löscht mit der Zeichnung ihre Alarme. Damit Rückgängig sie
 * zurückbringt, merkt sich der Schritt die Alarme — vorher stand die Linie
 * wieder da, ihr Alarm aber nicht, und niemand bemerkte es.
 */
const ALARM_FELDER = ['symbol', 'markt', 'art', 'bedingung', 'kanaele', 'einmalig', 'aktiv', 'notiz']
function alarmeVon(id) {
    return alarme.value.filter((a) => a.zeichnungId === id)
        .map((a) => Object.fromEntries(ALARM_FELDER.filter((k) => a[k] !== undefined).map((k) => [k, a[k]])))
}

export async function loesche(symbol, id, { merken = true } = {}) {
    const vorher = liste(symbol).value.find((x) => x.id === id)
    if (!vorher) return
    const seineAlarme = alarmeVon(id)
    entferneLokal(symbol, id)
    try {
        await (schlange.get(id) || Promise.resolve()).then(() => axios.delete(`/api/chart/zeichnungen/${id}`))
        schlange.delete(id)
        if (seineAlarme.length) alarme.value = alarme.value.filter((a) => a.zeichnungId !== id)
        if (merken) merke({ art: 'loeschen', vorher, alarme: seineAlarme })
        return seineAlarme
    } catch (e) {
        ersetze(vorher)
        fehlerMeldung.value = e.response?.data?.error || e.message
    }
}

/*
 * Rückgängig einer Löschung legt die Zeichnung NEU an — sie bekommt eine neue
 * id. Spätere Schritte im Stapel, die noch die alte id tragen, werden darauf
 * umgeschrieben, sonst liefe ein „Wiederholen" danach ins Leere.
 */
function idUmschreiben(alt, neu) {
    for (const s of [...rueckgaengig, ...wiederholen]) {
        if (s.vorher?.id === alt) s.vorher = { ...s.vorher, id: neu }
        if (s.nachher?.id === alt) s.nachher = { ...s.nachher, id: neu }
    }
}

/** Zeichnung wiederherstellen, samt ihrer Alarme (die neue id bekommen sie mit). */
async function stelleWiederHer(z, seineAlarme = []) {
    const neu = await legeAn(z, { merken: false })
    if (!neu) return null
    idUmschreiben(z.id, neu.id)
    for (const a of seineAlarme) {
        try { await legeAlarmAn({ ...a, zeichnungId: neu.id }) } catch (e) {
            fehlerMeldung.value = e.response?.data?.error || e.message
        }
    }
    return neu
}

function inReihe(arbeit) {
    const p = schrittKette.then(arbeit, arbeit)
    schrittKette = p.catch(() => {})
    return p
}

export function macheRueckgaengig() {
    return inReihe(async () => {
        const s = rueckgaengig.pop()
        if (!s) return false
        if (s.art === 'neu') {
            const weg = await loesche(s.nachher.symbol, s.nachher.id, { merken: false })
            s.alarme = weg || []
        } else if (s.art === 'aendern') await aendere(s.vorher.symbol, s.vorher.id, felder(s.vorher), { merken: false })
        else if (s.art === 'loeschen') {
            const neu = await stelleWiederHer(s.vorher, s.alarme)
            if (neu) s.vorher = neu
        }
        wiederholen.push(s)
        return true
    })
}

export function macheWiederholen() {
    return inReihe(async () => {
        const s = wiederholen.pop()
        if (!s) return false
        if (s.art === 'neu') {
            const neu = await stelleWiederHer(s.nachher, s.alarme)
            if (neu) s.nachher = neu
        } else if (s.art === 'aendern') await aendere(s.nachher.symbol, s.nachher.id, felder(s.nachher), { merken: false })
        else if (s.art === 'loeschen') {
            const weg = await loesche(s.vorher.symbol, s.vorher.id, { merken: false })
            s.alarme = weg || s.alarme || []
        }
        rueckgaengig.push(s)
        return true
    })
}
