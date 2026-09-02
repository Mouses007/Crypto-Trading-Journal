/**
 * Der Lauf: die vier Stufen hintereinander, mit Zwischenstand nach jeder.
 *
 * Getrennt von den Routen, damit derselbe Ablauf vom Zeitplan und vom
 * Knopfdruck aus benutzt werden kann, ohne dass einer der beiden Wege eine
 * eigene Fassung pflegt.
 *
 * Der Sicherheitsschritt ist der langsamste: er fragt je Kandidat einmal bei
 * GoPlus nach. Deshalb wird vorher aussortiert — geprüft wird nur, was die
 * Hype-Schwelle überhaupt erreicht. Das spart nicht Geld (GoPlus ist gratis),
 * aber Minuten.
 */

import { getKnex } from '../database.js'
import { logWarn } from '../logger.js'
import { sammle, dexDetailsViele, fuehreZusammen } from './quellen.js'
import { bewerte, STANDARD_GEWICHTE, STANDARD_NARRATIVE } from './bewertung.js'
import { pruefe, holeGoPlus, STANDARD_SICHERHEIT } from './sicherheit.js'
import { erzeugeBericht } from './bericht.js'
import { ladeListungen, pruefeListung } from './listungen.js'
import { legeAnHype } from '../radar-ergebnisse.js'

/** Wie viele Kandidaten in die (teure) Sicherheitsprüfung gehen. */
const MAX_PRUEFUNGEN = 40

/**
 * Stufen 1 bis 3.
 *
 * @param {object} einst   Einstellungen (siehe `einstellungen.js`)
 * @param {function} melde Fortschritt an die Oberfläche
 * @returns {Promise<{bestanden:array, verworfen:array, quellenStand:object}>}
 */
export async function scanne(einst, melde = () => {}) {
    const knex = getKnex()

    // ── Stufe 1 ─────────────────────────────────────────────────────────
    melde({ schritt: 'sammeln' })
    const { kandidaten: roh, quellenStand } = await sammle({
        schluessel: einst.schluessel || {},
        ketten: einst.ketten,
        quellen: einst.quellen || {},
    })
    melde({ schritt: 'gesammelt', anzahl: roh.length })

    /*
     * ── Detaildaten VOR der Vorsortierung ───────────────────────────────
     *
     * Die Reihenfolge war das Problem. Vorher wurde erst bewertet, dann auf
     * vierzig gekürzt und erst danach nachgeschlagen — nur bringen die
     * DexScreener-Trendlisten nichts mit als eine Adresse. Diese Funde
     * bekamen Volumen 0, Neuheit 0 und Narrativ 0 und fielen bei rund zehn
     * Punkten heraus, BEVOR die Daten geholt wurden, die sie bewertbar
     * gemacht hätten. Ausgerechnet die frischesten Funde traf das.
     *
     * Der Sammelabruf nimmt dreissig Adressen auf einmal: rund sechzig Funde
     * in zwei Anfragen statt vierzig einzelnen. Damit ist es billiger, ALLE
     * anzureichern, als vorher zu sieben — und die Rangfolge entsteht zum
     * ersten Mal auf vergleichbarer Grundlage.
     */
    const mitVertrag = roh.filter((k) => k.contract)
    melde({ schritt: 'details', gesamt: mitVertrag.length })
    let detailKarte = new Map()
    try {
        detailKarte = await dexDetailsViele(mitVertrag.map((k) => k.contract))
    } catch (e) {
        logWarn('hype-radar', `Sammelabruf der Details: ${e.message}`)
    }
    melde({ schritt: 'details', fertig: detailKarte.size, gesamt: mitVertrag.length })

    const angereichert = roh.map((k) => {
        const d = k.contract ? detailKarte.get(String(k.contract).toLowerCase()) : null
        return {
            ...k,
            symbol: d?.symbol || k.symbol,
            name: d?.name || k.name,
            chain: d?.chain || k.chain,
            pair: d?.pair || k.pair,
            // Steht der Fund auf der Gegenseite seines Paars, gehören Preis
            // und Volumen nicht ihm — der Vermerk wandert mit.
            seite: d?.seite || 'base',
            markt: { ...k.markt, ...(d?.markt || {}) },
        }
    })

    // ── Stufe 2 ─────────────────────────────────────────────────────────
    const gewichte = einst.gewichte || STANDARD_GEWICHTE
    const narrative = einst.narrative || STANDARD_NARRATIVE

    /*
     * Zweiter Durchgang der Zusammenführung.
     *
     * Erst jetzt haben die Funde von DexScreener ihr echtes Symbol — die
     * Trend-Endpunkte nennen nur Adressen. Vorher konnte sich ein Fund von
     * DexScreener nie mit demselben Coin von CoinGecko oder Reddit treffen,
     * und die Quellenzahl blieb ausnahmslos 1. Da sie der wichtigste Faktor
     * gegen gekauften Lärm ist, war die Bewertung damit praktisch blind.
     *
     * Seit der Sammelabruf ALLE Funde anreichert, ist das hier die vollständige
     * Menge. Vorher musste an dieser Stelle noch nachgeholt werden, was die
     * Vorsortierung abgeschnitten hatte.
     */
    const vereint = fuehreZusammen(angereichert)

    /*
     * Listung an den eigenen Börsen.
     *
     * Für jeden Fund wird vermerkt, ob Bitunix, Bitget oder Pionex ihn führen
     * — der Unterschied zwischen „kann ich handeln" und „kann ich nur
     * beobachten" gehört an jede Zeile. Drei Set-Abfragen je Fund, die
     * Listen selbst kommen einmal je Lauf (und sind 12 h zwischengespeichert).
     */
    melde({ schritt: 'listungen' })
    const listen = await ladeListungen()

    // ── Stufe 2, endgültig ──────────────────────────────────────────────
    const bewertet = vereint
        .map((k) => {
            const { liste, unbekannt } = pruefeListung(k.symbol, listen)
            return {
                ...k,
                ...bewerte(k, gewichte, narrative),
                markt: { ...k.markt, listungen: liste, listungUnbekannt: unbekannt },
            }
        })
        .sort((a, b) => b.hypeScore - a.hypeScore)

    /*
     * Auf Wunsch zählt nur, was handelbar ist.
     *
     * Der Filter lässt auch durch, was UNGEKLÄRT ist (eine Börsenliste war
     * nicht abrufbar): mit „unbekannt = weg" würde ein Netzaussetzer bei
     * Bitget den ganzen Lauf leeren, und niemand sähe warum.
     */
    const gefiltert = einst.nurBoersen
        ? bewertet.filter((k) => k.markt.listungen.length > 0 || k.markt.listungUnbekannt.length > 0)
        : bewertet
    if (einst.nurBoersen) {
        melde({ schritt: 'boersenfilter', anzahl: gefiltert.length, entfernt: bewertet.length - gefiltert.length })
    }

    const schwelle = Number(einst.minHypeScore) || 0
    /*
     * Der Deckel sitzt jetzt HIER und nicht mehr vor dem Detailabruf.
     *
     * Vorher begrenzte der Top-40-Schnitt beides zugleich: die Detailabrufe
     * und — als Nebenwirkung — die Sicherheitsprüfungen. Seit der Sammelabruf
     * alle Funde anreichert, gäbe es ohne diese Zeile gar keine Grenze mehr,
     * und jeder Kandidat über der Schwelle kostete einen GoPlus- bzw.
     * RugCheck-Aufruf. Die Sicherheitsprüfung ist die teuerste Stufe vor der
     * KI — sie gehört gedeckelt, die Anreicherung nicht.
     */
    const zurPruefung = gefiltert
        .filter((k) => k.hypeScore >= schwelle)
        .slice(0, MAX_PRUEFUNGEN)
    /*
     * Was die Schwelle reisst, ist nicht „verworfen" im Sinne der Prüfung —
     * es war schlicht nicht interessant genug. Diese Funde tauchen im Bericht
     * gar nicht auf; die Aussortiert-Liste ist der Sicherheitsprüfung
     * vorbehalten, sonst ertränkt sie die eigentlichen Warnungen.
     *
     * Gespeichert werden sie trotzdem: die Übersicht lebt davon, das ganze
     * Feld zu zeigen. Im ersten Lauf gegen echte Daten kam genau EIN Fund über
     * die Schwelle — ein Streudiagramm mit einem Punkt beantwortet keine
     * Frage. Erst neben den vielen unauffälligen wird sichtbar, was heraussticht.
     */
    /*
     * Alles, was NICHT in die Prüfung ging — nicht bloss das unter der
     * Schwelle. Seit dem Deckel gibt es einen dritten Fall: über der Schwelle,
     * aber jenseits von Platz vierzig. Ohne diese Fassung fiele er durch beide
     * Listen und verschwände aus der Übersicht, obwohl er zu den besseren
     * gehört.
     *
     * Aus `gefiltert`, nicht `bewertet`: mit dem Börsenfilter an sollen auch
     * im Hintergrundfeld nur handelbare Funde stehen — der Filter gilt dem
     * ganzen Lauf, nicht nur der Prüfliste.
     */
    const inPruefung = new Set(zurPruefung)
    const unterSchwelle = gefiltert.filter((k) => !inPruefung.has(k))
    melde({ schritt: 'bewertet', anzahl: zurPruefung.length, verworfenSchwelle: unterSchwelle.length })

    // ── Stufe 3 ─────────────────────────────────────────────────────────
    melde({ schritt: 'sicherheit', gesamt: zurPruefung.length })
    const regeln = { ...STANDARD_SICHERHEIT, ...(einst.sicherheit || {}) }
    const bestanden = []
    const verworfen = []

    for (const [i, k] of zurPruefung.entries()) {
        let goplus = null
        try {
            goplus = await holeGoPlus(k.chain, k.contract)
        } catch (e) {
            logWarn('hype-radar', `GoPlus zu ${k.symbol}: ${e.message}`)
        }
        const urteil = pruefe(goplus, k.markt, regeln)
        const zeile = {
            symbol: k.symbol,
            name: k.name,
            chain: k.chain,
            contractAddress: k.contract,
            pairAddress: k.pair,
            narrative: k.narrativ || '',
            quellen: k.quellen || [],
            marktDaten: k.markt || {},
            sozialDaten: { ...(k.sozial || {}), teilnoten: k.teilnoten, quellenAnzahl: k.quellenAnzahl,
            // Welche Belegarten — nicht nur wie viele. Ohne sie liesse sich
            // eine Quellenzahl von 1 bei zwei Anbietern nicht erklären.
            evidenzDomaenen: k.evidenzDomaenen || [], anbieterAnzahl: k.anbieterAnzahl || 0,
            trittbrett: k.trittbrett || null },
            sicherheitsDaten: { flaggen: urteil.flaggen, hinweise: urteil.hinweise, roh: goplus ? true : false },
            hypeScore: k.hypeScore,
            safetyScore: urteil.safetyScore,
            status: urteil.status,
            verworfenGrund: urteil.grund,
        }
        ;(urteil.status === 'bestanden' ? bestanden : verworfen).push(zeile)
        if ((i + 1) % 5 === 0) melde({ schritt: 'sicherheit', fertig: i + 1, gesamt: zurPruefung.length })
    }

    // ── Speichern ───────────────────────────────────────────────────────
    const jetzt = Date.now()

    // Auch die unter der Schwelle — sie sind der Hintergrund, vor dem sich
    // ein auffälliger Fund überhaupt abhebt. Status `bewertet`: weder
    // sicherheitsgeprüft noch verworfen.
    const nurBewertet = unterSchwelle.map((k) => ({
        symbol: k.symbol,
        name: k.name,
        chain: k.chain,
        contractAddress: k.contract,
        pairAddress: k.pair,
        narrative: k.narrativ || '',
        quellen: k.quellen || [],
        marktDaten: k.markt || {},
        sozialDaten: { ...(k.sozial || {}), teilnoten: k.teilnoten, quellenAnzahl: k.quellenAnzahl,
            // Welche Belegarten — nicht nur wie viele. Ohne sie liesse sich
            // eine Quellenzahl von 1 bei zwei Anbietern nicht erklären.
            evidenzDomaenen: k.evidenzDomaenen || [], anbieterAnzahl: k.anbieterAnzahl || 0,
            trittbrett: k.trittbrett || null },
        sicherheitsDaten: {},
        hypeScore: k.hypeScore,
        safetyScore: 0,
        status: 'bewertet',
        verworfenGrund: '',
    }))

    /*
     * Funde ohne Symbol fallen hier heraus.
     *
     * Es sind Adressen von DexScreener, deren Detailabruf nichts ergab — im
     * ersten Lauf gegen echte Daten waren das 41 von 129. Anzeigen liessen sie
     * sich nicht (eine Zeile ohne Namen sagt niemandem etwas), nachschlagen
     * auch nicht; sie blähten nur die Zahlen auf.
     */
    const zeilen = [...bestanden, ...verworfen, ...nurBewertet]
        .filter((z) => z.symbol)
        .map((z) => ({
            symbol: z.symbol,
            name: z.name,
            chain: z.chain,
            contractAddress: z.contractAddress,
            pairAddress: z.pairAddress,
            narrative: z.narrative,
            quellen: JSON.stringify(z.quellen),
            marktDaten: JSON.stringify(z.marktDaten),
            sozialDaten: JSON.stringify(z.sozialDaten),
            sicherheitsDaten: JSON.stringify(z.sicherheitsDaten),
            hypeScore: z.hypeScore,
            safetyScore: z.safetyScore,
            status: z.status,
            verworfenGrund: z.verworfenGrund,
            erstelltAm: jetzt,
            aktualisiertAm: jetzt,
        }))
    if (zeilen.length) {
        // In Stücken einfügen: SQLite hat eine Grenze für Platzhalter je Anweisung.
        for (let i = 0; i < zeilen.length; i += 25) {
            await knex('hype_candidates').insert(zeilen.slice(i, i + 25))
        }
    }

    /*
     * Erfolgskontrolle anmelden (R-06).
     *
     * Nur die Funde, die die Sicherheitsprüfung BESTANDEN haben — das sind
     * die, über die der Radar eine Aussage macht. Nach 1, 7 und 30 Tagen wird
     * nachgesehen, was daraus wurde: Preis, Liquidität, und die einzige Frage,
     * die bei jungen Token wirklich zählt — gibt es das Paar überhaupt noch.
     *
     * Schlägt es fehl, bleibt der Lauf gültig: Die Kontrolle ist eine
     * Beobachtung ÜBER den Lauf, nicht Teil von ihm.
     */
    await legeAnHype(jetzt).catch((e) =>
        logWarn('hype-radar', `Erfolgskontrolle nicht angemeldet: ${e.message}`))

    melde({ schritt: 'fertig', bestanden: bestanden.length, verworfen: verworfen.length })
    return { bestanden, verworfen, quellenStand }
}

/**
 * Stufen 1 bis 4: scannen und Bericht schreiben.
 *
 * @param {object} einst
 * @param {function} melde
 * @param {string} ausloeser 'auto' | 'manuell'
 */
export async function scanneUndBerichte(einst, melde = () => {}, ausloeser = 'auto') {
    const { bestanden, verworfen, quellenStand } = await scanne(einst, melde)

    const bericht = await erzeugeBericht(
        bestanden, verworfen, { ...einst, _ausloeser: ausloeser }, melde)

    const knex = getKnex()
    const jetzt = Date.now()

    /*
     * Ein Lauf ohne bestandenen Fund bekommt KEINEN Berichtseintrag.
     *
     * Er ist ein gültiges Ergebnis — an vielen Tagen hält schlicht nichts der
     * Prüfung stand, `erzeugeBericht` fragt dafür nicht einmal ein Modell. Als
     * Karte in der Berichtsliste ist er trotzdem wertlos: acht von zehn
     * Einträgen hiessen „Keine Kandidaten" und verdeckten die Berichte, wegen
     * derer man die Liste öffnet. Was der Lauf gesehen hat, steht ohnehin
     * vollständig in `hype_candidates` — samt Verwerfungsgrund.
     *
     * `id` ist dann `null`; die Aufrufer unterscheiden daran „nichts gefunden"
     * von „Bericht liegt vor".
     */
    if (!bericht.kandidaten.length) {
        return { id: null, bericht, quellenStand }
    }

    const [eingefuegt] = await knex('hype_reports').insert({
        erstelltAm: jetzt,
        ueberschrift: bericht.ueberschrift,
        marktkontext: bericht.marktkontext,
        kandidaten: JSON.stringify(bericht.kandidaten),
        aussortiert: JSON.stringify(bericht.aussortiert),
        meta: JSON.stringify({ ...bericht.meta, quellenStand }),
        anzahlKandidaten: bericht.kandidaten.length,
        anzahlAussortiert: bericht.aussortiert.length,
        kostenUsd: Number(bericht.meta?.kostenUsd) || 0,
        ausloeser,
    }).returning('id')
    // pg gibt ein Objekt zurück, SQLite die blanke Zahl.
    const id = typeof eingefuegt === 'object' ? eingefuegt.id : eingefuegt

    // Berichtete Kandidaten kennzeichnen, damit die Kandidatenliste zeigt,
    // welche es in einen Bericht geschafft haben.
    const symbole = bericht.kandidaten.map((k) => k.symbol)
    if (symbole.length) {
        await knex('hype_candidates')
            .where('erstelltAm', '>=', jetzt - 10 * 60 * 1000)
            .whereIn('symbol', symbole)
            .update({ status: 'berichtet' })
    }

    return { id, bericht, quellenStand }
}
