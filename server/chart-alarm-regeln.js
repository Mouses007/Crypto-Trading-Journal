/**
 * Regeln der Chart-Alarme — rein, ohne Netz und Datenbank
 * (Selbsttest: `server/__selftest-chart-alarme.mjs`).
 *
 * Ein Alarm feuert auf das KREUZEN, nie auf das Darüberstehen: zwischen zwei
 * Messungen muss der Preis die Seite gewechselt haben. Sonst meldete eine
 * Linie, die der Kurs gerade überschritten hat, alle fünf Sekunden erneut —
 * das Projekt hält es überall so (Spread, Funding, 24h-Bewegung im Wachhund).
 *
 * Eine schräge Linie hat zu jedem Zeitpunkt einen anderen Preis. Verglichen
 * wird deshalb die Seite VOR der Linie zur Zeit der alten Messung mit der
 * Seite zur Zeit der neuen — ein Kurs, der flach bleibt, während eine fallende
 * Trendlinie unter ihm durchläuft, kreuzt sie auch.
 *
 * Liegen zwischen zwei Messungen mehr als `maxLueckeMs` (Server war aus, Takt
 * hing), wird NICHT ausgelöst, sondern neu angesetzt. Ob und wann der Kurs in
 * der Lücke gekreuzt hat, weiss niemand — und eine Meldung „kreuzt jetzt" über
 * etwas, das vor drei Stunden geschah, ist eine Falschmeldung.
 */

export const MAX_LUECKE_MS = 10 * 60 * 1000
export const STANDARD_SPERRE_MIN = 15

/** Preis der Geraden durch a und b zur Zeit t (linear in der Zeit). */
export function geradePreis(a, b, t) {
    if (b.t === a.t) return a.p
    return a.p + ((b.p - a.p) * (t - a.t)) / (b.t - a.t)
}

/**
 * Preis einer Linien-Zeichnung zur Zeit t — oder null, wenn die Linie dort
 * nicht existiert (Strecke zu Ende, Strahl hat noch nicht begonnen).
 * Beim Kanal wählt `kante` 'oben' | 'unten' | 'mitte'.
 */
export function linienPreis(z, t, kante = 'oben') {
    const pk = z?.punkte || []
    const stil = z?.stil || {}
    if (!pk.length) return null
    switch (z.typ) {
        case 'horizontale': return pk[0].p
        case 'strahlH': return t >= pk[0].t ? pk[0].p : null
        case 'strahl': return pk.length > 1 && t >= pk[0].t ? geradePreis(pk[0], pk[1], t) : null
        case 'trendlinie': {
            if (pk.length < 2) return null
            const von = Math.min(pk[0].t, pk[1].t)
            const bis = Math.max(pk[0].t, pk[1].t)
            if (t < von && !stil.links) return null
            if (t > bis && !stil.rechts) return null
            return geradePreis(pk[0], pk[1], t)
        }
        case 'kanal': {
            const g = kanalBei(z, t)
            if (!g) return null
            return kante === 'unten' ? g.unten : kante === 'mitte' ? (g.unten + g.oben) / 2 : g.oben
        }
        default: return null
    }
}

/** Unter- und Oberkante eines Kanals zur Zeit t (nur innerhalb seiner Strecke). */
export function kanalBei(z, t) {
    const [a, b, c] = z?.punkte || []
    if (!a || !b) return null
    if (t < Math.min(a.t, b.t) || t > Math.max(a.t, b.t)) return null
    const basis = geradePreis(a, b, t)
    const versatz = c ? c.p - geradePreis(a, b, c.t) : 0
    const zweite = basis + versatz
    return { unten: Math.min(basis, zweite), oben: Math.max(basis, zweite) }
}

/** Preisbereich einer Zonen-Zeichnung zur Zeit t, oder null ausserhalb. */
export function zoneBei(z, t) {
    const pk = z?.punkte || []
    if (z?.typ === 'kanal') return kanalBei(z, t)
    if (z?.typ !== 'rechteck' || pk.length < 2) return null
    const von = Math.min(pk[0].t, pk[1].t)
    const bis = z.stil?.rechts ? Infinity : Math.max(pk[0].t, pk[1].t)
    if (t < von || t > bis) return null
    return { unten: Math.min(pk[0].p, pk[1].p), oben: Math.max(pk[0].p, pk[1].p) }
}

const SEITEN = {
    ueber: (alt, neu) => alt.abstand < 0 && neu.abstand >= 0,
    unter: (alt, neu) => alt.abstand > 0 && neu.abstand <= 0,
}

/**
 * Löst der Alarm zwischen `vorher` und `jetzt` aus?
 *
 * @param {object} alarm     { art: 'preis'|'linie'|'zone', bedingung }
 * @param {object|null} zeichnung  für linie/zone
 * @param {{p:number,t:number}|null} vorher  letzte Messung
 * @param {{p:number,t:number}} jetzt
 * @returns {{ ausloesen: boolean, niveau?: number, grund?: string }}
 */
export function pruefeAlarm(alarm, zeichnung, vorher, jetzt, { maxLueckeMs = MAX_LUECKE_MS } = {}) {
    if (!jetzt || !Number.isFinite(jetzt.p)) return { ausloesen: false, grund: 'keinPreis' }
    if (!vorher || !Number.isFinite(vorher.p)) return { ausloesen: false, grund: 'ersteMessung' }
    if (jetzt.t - vorher.t > maxLueckeMs) return { ausloesen: false, grund: 'luecke' }
    const b = alarm.bedingung || {}

    if (alarm.art === 'zone') {
        const altZone = zoneBei(zeichnung, vorher.t)
        const neuZone = zoneBei(zeichnung, jetzt.t)
        if (!altZone || !neuZone) return { ausloesen: false, grund: 'ausserhalb' }
        const drin = (p, z) => p >= z.unten && p <= z.oben
        const warDrin = drin(vorher.p, altZone)
        const istDrin = drin(jetzt.p, neuZone)
        const richtung = b.richtung || 'betreten'
        const treffer = richtung === 'verlassen' ? warDrin && !istDrin : !warDrin && istDrin
        return { ausloesen: treffer, niveau: istDrin ? jetzt.p : (jetzt.p > neuZone.oben ? neuZone.oben : neuZone.unten) }
    }

    let altNiveau, neuNiveau
    if (alarm.art === 'preis') {
        altNiveau = neuNiveau = Number(b.preis)
    } else if (alarm.art === 'linie') {
        altNiveau = linienPreis(zeichnung, vorher.t, b.kante)
        neuNiveau = linienPreis(zeichnung, jetzt.t, b.kante)
    } else {
        return { ausloesen: false, grund: 'unbekannteArt' }
    }
    if (!Number.isFinite(altNiveau) || !Number.isFinite(neuNiveau)) return { ausloesen: false, grund: 'ausserhalb' }

    const alt = { abstand: vorher.p - altNiveau }
    const neu = { abstand: jetzt.p - neuNiveau }
    const richtung = b.richtung || 'kreuzt'
    const treffer = richtung === 'kreuzt'
        ? SEITEN.ueber(alt, neu) || SEITEN.unter(alt, neu)
        : SEITEN[richtung]?.(alt, neu) || false
    return { ausloesen: treffer, niveau: neuNiveau, richtung: neu.abstand >= 0 ? 'ueber' : 'unter' }
}

/** Darf ein wiederholender Alarm wieder melden? */
export function sperreAbgelaufen(alarm, jetztMs) {
    const zuletzt = Number(alarm.ausgeloestAm) || 0
    if (!zuletzt) return true
    const min = Number(alarm.bedingung?.sperreMin)
    const sperre = (Number.isFinite(min) && min >= 0 ? min : STANDARD_SPERRE_MIN) * 60_000
    return jetztMs - zuletzt >= sperre
}
