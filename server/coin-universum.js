/**
 * Coin-Universen — welche Münzen kommen für einen Rangliste-Lauf in Frage?
 *
 * Zwei Börsen, zwei verschiedene Rollen:
 *   - **Bitunix** sagt, was man HANDELN kann. Dort liegt das Geld.
 *   - **Binance** liefert die Kerzenhistorie, gegen die getestet wird.
 *
 * Nur die Schnittmenge ergibt eine sinnvolle Rangliste: ein Coin ohne Historie
 * lässt sich nicht testen, und ein Coin, den man nicht handeln kann, nützt auch
 * mit dem besten Ergebnis nichts. Gemessen am 16.08.2026:
 *
 *      614 handelbar (Bitunix, USDT-Perpetuals, offen, per API)
 *      529 testbar   (Binance-Perpetuals, `underlyingType === 'COIN'`)
 *      494 beides    ← das eigentliche Universum
 *      120 nur handelbar (keine Binance-Historie → nicht testbar)
 *       35 nur testbar   (auf Bitunix nicht handelbar → nur zum Vergleich)
 *
 * Diese Zahlen werden dem Nutzer gezeigt, statt still 120 Coins zu schlucken.
 *
 * Alle Fremdabrufe laufen über `ausCache` aus dem Marktradar — das bringt TTL,
 * Bündelung gleichzeitiger Anfragen und den Rückfall auf einen Altstand mit.
 * Ein eigener Cache daneben wäre ein zweiter Ort, an dem etwas veralten kann.
 */

import { ausCache, nurCoinSymbole, holeMarkt } from './marktradar-api.js'
import { holeBitunixPaare } from './bitunix-api.js'

/** Symbole sehen überall im Projekt gleich aus (vgl. `SYMBOL_RE` der Strategie-API). */
const SYMBOL_RE = /^[A-Z0-9]{2,20}$/

export const UNIVERSUM_ARTEN = ['bitunix', 'top', 'manuell', 'ki']

/**
 * Auf Bitunix handelbar — Symbol → Metadaten.
 * 12 h Vorrat wie die Perpetuals-Liste des Radars: eine Börse nimmt nicht
 * stündlich neue Paare auf, und ein Abruf je Rangliste-Lauf reicht völlig.
 */
export async function holeHandelbar() {
    const { paare } = await ausCache('bitunix_paare', 12 * 60 * 60 * 1000, async () => ({
        paare: await holeBitunixPaare(),
    }))
    const map = new Map()
    for (const p of paare) map.set(p.symbol, p)
    return map
}

/** Mit Binance-Historie testbar (der Filter entfernt getarnte Aktien und Rohstoffe). */
export async function holeTestbar() {
    return nurCoinSymbole()
}

/**
 * Die drei Zahlen, die über der Universumsauswahl stehen.
 * Bewusst als eigene Funktion: sie ist der schnellste Weg zu prüfen, ob beide
 * Börsen antworten, ohne einen Lauf zu starten.
 */
export async function quellenUebersicht() {
    const [handelbar, testbar] = await Promise.all([holeHandelbar(), holeTestbar()])
    const beides = [...testbar].filter((s) => handelbar.has(s))
    return {
        handelbar: handelbar.size,
        testbar: testbar.size,
        beides: beides.length,
        nurHandelbar: handelbar.size - beides.length,
        nurTestbar: testbar.size - beides.length,
    }
}

/**
 * Eingegebene oder vorgeschlagene Symbole säubern.
 * Kleinschreibung, Leerzeichen, Trennzeichen und Doppelte werden geglättet —
 * Unsinn wird NICHT stillschweigend geschluckt, sondern zurückgemeldet.
 */
export function normalisiereSymbole(eingabe) {
    const roh = Array.isArray(eingabe)
        ? eingabe
        : String(eingabe || '').split(/[\s,;]+/)
    const gut = []
    const ungueltig = []
    const gesehen = new Set()
    for (const x of roh) {
        const s = String(x || '').trim().toUpperCase()
        if (!s) continue
        if (!SYMBOL_RE.test(s)) { ungueltig.push(s); continue }
        if (gesehen.has(s)) continue
        gesehen.add(s)
        gut.push(s)
    }
    return { symbole: gut, ungueltig }
}

/**
 * Ein Universum in eine konkrete Symbolliste auflösen.
 *
 * `bitunix` und `top` tragen bewusst KEINE gespeicherte Liste — sie würde still
 * veralten. Sie werden bei jedem Laufstart neu aufgelöst, und das Ergebnis
 * wandert als Kopie in den Lauf, damit ein alter Lauf nachvollziehbar bleibt.
 *
 * `nurHandelbar` (Vorgabe an) beschränkt auf die Schnittmenge. Aus heisst: auch
 * Coins ohne Bitunix-Markt laufen mit — sie sind dann reine Vergleichswerte und
 * werden in der Tabelle als „nicht handelbar" ausgewiesen. Coins ohne Binance-
 * Historie fliegen IMMER raus; sie liessen sich schlicht nicht testen.
 */
export async function loeseUniversumAuf(universum, quellen = {}) {
    const art = String(universum?.art || '')
    if (!UNIVERSUM_ARTEN.includes(art)) {
        throw new Error(`Unbekannte Universumsart: ${art || '(leer)'}`)
    }
    const nurHandelbar = universum.nurHandelbar !== 0 && universum.nurHandelbar !== false
    // Die drei Quellen sind einspeisbar — sonst wäre diese Funktion nur mit
    // Netzverbindung prüfbar, und ein Test, der online sein muss, wird nicht
    // geschrieben. Vorgabe ist immer der echte Abruf (Muster wie `walkForward`).
    const [handelbar, testbar] = await Promise.all([
        quellen.handelbar ? quellen.handelbar() : holeHandelbar(),
        quellen.testbar ? quellen.testbar() : holeTestbar(),
    ])

    let kandidaten = []
    let ungueltig = []
    // Coins, die es bei Binance gar nicht als Perpetual gibt (nur bei `top`)
    const ohneMarkt = []

    if (art === 'bitunix') {
        // Alles Handelbare — die Testbarkeit filtert gleich darunter.
        kandidaten = [...handelbar.keys()]
    } else if (art === 'top') {
        // `holeMarkt` liefert `perp` bereits als passendes Binance-Symbol,
        // inklusive der gebündelten Kleinstwerte (1000SHIBUSDT, 1000000MOGUSDT).
        // Das selbst nachzubauen hiesse, denselben Sonderfall zweimal zu pflegen.
        const markt = quellen.markt
            ? await quellen.markt(Number(universum.n) || 100)
            : await holeMarkt(Number(universum.n) || 100)
        // Coins ohne Binance-Perpetual (`perp === null`) tragen ihren
        // CoinGecko-Namen in die Fehlliste, statt einfach zu verschwinden:
        // von den Top 100 nach Marktkapitalisierung haben nur rund 72 einen —
        // ohne diese Zeile wundert sich der Nutzer, wo die anderen 28 sind.
        for (const m of markt.muenzen || []) {
            if (!m.perp) ohneMarkt.push(m.symbol)
        }
        kandidaten = (markt.muenzen || []).map((m) => m.perp).filter(Boolean)
    } else {
        const n = normalisiereSymbole(universum.symbole)
        kandidaten = n.symbole
        ungueltig = n.ungueltig
    }

    // Reihenfolge bleibt erhalten (bei `top` ist sie die Rangfolge nach
    // Marktkapitalisierung), Doppelte fallen weg.
    const gesehen = new Set()
    const symbole = []
    const ohneHistorie = []
    const nichtHandelbar = []
    for (const s of kandidaten) {
        if (gesehen.has(s)) continue
        gesehen.add(s)
        if (!testbar.has(s)) { ohneHistorie.push(s); continue }
        if (!handelbar.has(s)) {
            nichtHandelbar.push(s)
            if (nurHandelbar) continue
        }
        symbole.push(s)
    }

    return {
        symbole,
        // Was NICHT mitläuft, gehört genannt — sonst wundert sich der Nutzer,
        // warum aus „Top 100" 83 Zeilen werden.
        ohneHistorie,
        ohneMarkt,
        nichtHandelbar,
        ungueltig,
        nurHandelbar,
        // Handelsdaten je Symbol für die Ergebniszeile
        meta: Object.fromEntries(symbole.map((s) => [s, {
            handelbar: handelbar.has(s),
            maxLeverage: handelbar.get(s)?.maxLeverage || 0,
        }])),
    }
}
