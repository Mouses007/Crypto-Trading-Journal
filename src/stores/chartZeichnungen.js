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
 * Handlungen, und nur für diese Sitzung (wie in jedem Zeichenprogramm).
 */
import { ref } from 'vue'
import axios from 'axios'

const bestand = new Map()        // symbol → ref([...])
const laedt = new Map()          // symbol → Promise
const rueckgaengig = []          // [{ art, vorher, nachher }]
const wiederholen = []
const MAX_SCHRITTE = 100

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
    try {
        const { data } = await axios.put(`/api/chart/zeichnungen/${id}`, patch)
        ersetze(data)
        if (merken) merke({ art: 'aendern', vorher, nachher: data })
        return data
    } catch (e) {
        ersetze(vorher)
        fehlerMeldung.value = e.response?.data?.error || e.message
        return null
    }
}

export async function loesche(symbol, id, { merken = true } = {}) {
    const vorher = liste(symbol).value.find((x) => x.id === id)
    if (!vorher) return
    entferneLokal(symbol, id)
    try {
        await axios.delete(`/api/chart/zeichnungen/${id}`)
        if (merken) merke({ art: 'loeschen', vorher })
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

export async function macheRueckgaengig() {
    const s = rueckgaengig.pop()
    if (!s) return false
    if (s.art === 'neu') await loesche(s.nachher.symbol, s.nachher.id, { merken: false })
    else if (s.art === 'aendern') await aendere(s.vorher.symbol, s.vorher.id, felder(s.vorher), { merken: false })
    else if (s.art === 'loeschen') {
        const neu = await legeAn(s.vorher, { merken: false })
        if (neu) { idUmschreiben(s.vorher.id, neu.id); s.vorher = neu }
    }
    wiederholen.push(s)
    return true
}

export async function macheWiederholen() {
    const s = wiederholen.pop()
    if (!s) return false
    if (s.art === 'neu') {
        const neu = await legeAn(s.nachher, { merken: false })
        if (neu) { idUmschreiben(s.nachher.id, neu.id); s.nachher = neu }
    } else if (s.art === 'aendern') await aendere(s.nachher.symbol, s.nachher.id, felder(s.nachher), { merken: false })
    else if (s.art === 'loeschen') await loesche(s.vorher.symbol, s.vorher.id, { merken: false })
    rueckgaengig.push(s)
    return true
}
