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

/**
 * Preis der Geraden durch a und b zur Zeit t. Auf einer LOG-Skala gezeichnete
 * Linie ist im Bild gerade im Logarithmus des Preises — linear gerechnet lag
 * die Mitte von 100→200 bei 150 statt 141,4, und der Alarm feuerte neben der
 * gezeichneten Linie.
 */
export function geradePreis(a, b, t, log = false) {
    if (b.t === a.t) return a.p
    const f = (t - a.t) / (b.t - a.t)
    if (log && a.p > 0 && b.p > 0) return Math.exp(Math.log(a.p) + (Math.log(b.p) - Math.log(a.p)) * f)
    return a.p + (b.p - a.p) * f
}

/**
 * Punkte einer Zeichnung nach der Zeit ordnen — damit „rechts verlängern"
 * überall „über den SPÄTEREN Punkt hinaus" heisst. Vorher verlängerte das Bild
 * über den zweiten GEZEICHNETEN Punkt, der Alarm über den späteren: eine von
 * rechts nach links gezogene Trendlinie mit „rechts" wuchs im Bild nach links,
 * der Alarm rechnete nach rechts, wo nichts zu sehen war.
 * Ausgenommen: Strahl (die Richtung IST die Aussage) und Fibonacci (die
 * Reihenfolge legt fest, wo 0 und 1 liegen).
 */
export function ordnePunkte(typ, punkte) {
    if (!Array.isArray(punkte) || punkte.length < 2) return punkte
    if (typ === 'trendlinie' || typ === 'rechteck' || typ === 'messen' || typ === 'position') {
        if (typ === 'position') return punkte          // Einstieg/Ziel/Stop: feste Rollen
        return punkte[0].t <= punkte[1].t ? punkte : [punkte[1], punkte[0], ...punkte.slice(2)]
    }
    if (typ === 'kanal') {
        // a, b = Basislinie, c = Versatzpunkt — nur a/b tauschen
        return punkte[0].t <= punkte[1].t ? punkte : [punkte[1], punkte[0], ...punkte.slice(2)]
    }
    return punkte
}

/**
 * Preis einer Linien-Zeichnung zur Zeit t — oder null, wenn die Linie dort
 * nicht existiert (Strecke zu Ende, Strahl hat noch nicht begonnen).
 * Beim Kanal wählt `kante` 'oben' | 'unten' | 'mitte'.
 */
export function linienPreis(z, t, kante = 'oben') {
    const pk = ordnePunkte(z?.typ, z?.punkte || []) || []
    const stil = z?.stil || {}
    const log = stil.skala === 'log'
    if (!pk.length) return null
    switch (z.typ) {
        case 'horizontale': return pk[0].p
        case 'strahlH': return t >= pk[0].t ? pk[0].p : null
        case 'strahl': {
            // Der Strahl gilt in seiner GEZEICHNETEN Richtung: von pk[0] über pk[1] hinaus.
            if (pk.length < 2) return null
            const vorwaerts = pk[1].t >= pk[0].t
            if (vorwaerts ? t < pk[0].t : t > pk[0].t) return null
            return geradePreis(pk[0], pk[1], t, log)
        }
        case 'trendlinie': {
            if (pk.length < 2) return null
            if (t < pk[0].t && !stil.links) return null
            if (t > pk[1].t && !stil.rechts) return null
            return geradePreis(pk[0], pk[1], t, log)
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
    const [a, b, c] = ordnePunkte('kanal', z?.punkte || []) || []
    if (!a || !b) return null
    const stil = z?.stil || {}
    if (t < a.t && !stil.links) return null
    if (t > b.t && !stil.rechts) return null
    const log = stil.skala === 'log' && a.p > 0 && b.p > 0 && (!c || c.p > 0)
    const basis = geradePreis(a, b, t, log)
    // Auf der Log-Skala ist der Abstand der Parallelen ein FAKTOR, kein Betrag.
    const zweite = !c ? basis
        : log ? basis * (c.p / geradePreis(a, b, c.t, true))
            : basis + (c.p - geradePreis(a, b, c.t))
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

/**
 * Darf ein wiederholender Alarm wieder melden? Einmalige Alarme sperren nie —
 * sie schalten sich beim Auslösen ab; wer sie wieder einschaltet, will die
 * nächste Kreuzung, auch wenn die letzte Auslösung erst zehn Minuten her ist.
 * Mindestens eine Minute: mit 0 meldete ein Kurs, der um das Niveau pendelt,
 * alle zehn Sekunden.
 */
export const MIN_SPERRE_MIN = 1
export function sperreAbgelaufen(alarm, jetztMs) {
    if (alarm.einmalig) return true
    const zuletzt = Number(alarm.ausgeloestAm) || 0
    if (!zuletzt) return true
    const min = Number(alarm.bedingung?.sperreMin)
    const sperre = Math.max(MIN_SPERRE_MIN, Number.isFinite(min) && min >= 0 ? min : STANDARD_SPERRE_MIN) * 60_000
    return jetztMs - zuletzt >= sperre
}

/**
 * Ist die Geometrie, auf die der Alarm schaut, zur Zeit t schon VORBEI
 * (Strecke/Rechteck/Kanal ohne Verlängerung, Ende in der Vergangenheit)? Dann
 * kann der Alarm nie wieder auslösen — er wird abgeschaltet und sagt warum,
 * statt still für immer weiterzulaufen.
 */
export function geometrieVorbei(alarm, z, t) {
    if (!z) return false
    if (alarm.art === 'linie') {
        if (linienPreis(z, t, alarm.bedingung?.kante) != null) return false
        // vorbei = es gibt einen früheren Zeitpunkt, an dem die Linie existierte, und t liegt danach
        const pk = ordnePunkte(z.typ, z.punkte || []) || []
        const ende = Math.max(...pk.map((q) => q.t))
        return Number.isFinite(ende) && t > ende
    }
    if (alarm.art === 'zone') {
        if (zoneBei(z, t)) return false
        const pk = z.punkte || []
        const ende = Math.max(...pk.map((q) => q.t))
        return Number.isFinite(ende) && t > ende
    }
    return false
}
