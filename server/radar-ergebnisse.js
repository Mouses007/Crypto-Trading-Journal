/**
 * Erfolgskontrolle beider Radare: was aus den Funden wirklich wurde.
 *
 * Der ehrlichste Wert des Coin-Radars war bisher die Rangkorrelation zum
 * Vorlauf. Sie misst aber BEHARRLICHKEIT, nicht Nutzen — eine stabile
 * Rangfolge kann stabil falsch sein. Gewichte, Anker und Schwellen beruhen bis
 * heute auf plausiblen Regeln und Querschnittsmessungen; ob die Note etwas
 * vorhersagt, hat nie jemand geprüft.
 *
 * Zwei getrennte Schritte, und die Trennung ist Absicht:
 *
 *   `legeAn()`   schreibt beim Lauf fest, WAS behauptet wurde — Rang, Note,
 *                Preis. Eingefroren, damit ein späterer Gewichtswechsel die
 *                Vergangenheit nicht umschreibt.
 *   `messeFaellige()`  löst die Aufträge ein, wenn ihre Zeit gekommen ist.
 *
 * Was hier NICHT passiert: eine Optimierung der Gewichte auf denselben
 * Zeitraum. Das wäre die bequemste Art, sich selbst zu belügen — die Auswertung
 * liefert Zahlen, die Entscheidung bleibt beim Menschen.
 */

import { getKnex } from './database.js'
import { logWarn } from './logger.js'
import { getHistoricalCandles, timeframeMs } from './market-data.js'
import { beansprucheAufgabe } from './db-claim.js'

/**
 * Wann gemessen wird.
 *
 * Coin-Radar kurz, Hype-Radar lang — die beiden beantworten verschiedene
 * Fragen. „Lässt sich der Coin heute handeln" entscheidet sich in Stunden;
 * „hat das Projekt Substanz" in Wochen.
 */
export const HORIZONTE = {
    coinradar: { '15m': 15 * 60e3, '1h': 3600e3, '4h': 4 * 3600e3 },
    hype: { '1d': 24 * 3600e3, '7d': 7 * 24 * 3600e3, '30d': 30 * 24 * 3600e3 },
}

/** Wie viele Spitzenplätze je Lauf verfolgt werden. */
const VERFOLGT = 20

/** Wie gross die Kontrollgruppe je Lauf ist. */
const KONTROLLE = 10

/**
 * Zufällige Stichprobe ohne Zurücklegen.
 *
 * Zufällig und nicht „die letzten zehn": Die untersten Plätze sind fast immer
 * dieselben trägen Grosswerte, und gegen sie würde jede Spitze glänzen.
 */
export function stichprobe(liste = [], n = KONTROLLE, zufall = Math.random) {
    const kopie = [...liste]
    for (let i = kopie.length - 1; i > 0; i--) {
        const j = Math.floor(zufall() * (i + 1))
        ;[kopie[i], kopie[j]] = [kopie[j], kopie[i]]
    }
    return kopie.slice(0, Math.max(0, n))
}

/**
 * Wer verfolgt wird: die Spitze und eine Kontrollgruppe aus der unteren Hälfte.
 *
 * Bis zum 07.10.2026 wurden nur die obersten zwanzig verfolgt, und die
 * Auswertung verglich Platz 1–10 mit Platz 11–20 — zwei Nachbarn aus demselben
 * beweglichsten Zehntel, also fast denselben Markt. Die Frage „ist die Spitze
 * besser als der Rest" liess sich so nicht beantworten. Rein, damit die
 * Auswahl ohne Datenbank prüfbar ist.
 *
 * @param {Array} bewertet  Zeilen eines Laufs, nach Rang aufsteigend
 */
export function waehleCoinRadar(bewertet = [], zufall = Math.random) {
    const spitze = bewertet.slice(0, VERFOLGT)
    const oben = new Set(spitze.map((z) => z.symbol))
    const untereHaelfte = bewertet.slice(Math.ceil(bewertet.length / 2)).filter((z) => !oben.has(z.symbol))
    return [
        ...spitze.map((z) => ({ ...z, gruppe: 'spitze' })),
        ...stichprobe(untereHaelfte, KONTROLLE, zufall).map((z) => ({ ...z, gruppe: 'kontrolle' })),
    ]
}

/**
 * Aufträge für einen Coin-Radar-Lauf anlegen.
 */
export async function legeAnCoinRadar(laufId) {
    const knex = getKnex()
    const zeilen = await knex('coinradar_zeilen')
        .select('symbol', 'rang', 'note', 'noteAusfuehrung', 'atrPct')
        .where({ laufId, status: 'bewertet' })
        .orderBy('rang', 'asc')
    if (!zeilen.length) return 0

    const jetzt = Date.now()
    const auftraege = []
    for (const z of waehleCoinRadar(zeilen)) {
        for (const [horizont, ms] of Object.entries(HORIZONTE.coinradar)) {
            auftraege.push({
                art: 'coinradar',
                laufId,
                symbol: z.symbol,
                rang: z.rang,
                note: z.note,
                noteAusfuehrung: z.noteAusfuehrung,
                atrPct: zahl(z.atrPct),
                gruppe: z.gruppe,
                horizont,
                erstelltAm: jetzt,
                faelligAm: jetzt + ms,
                status: 'offen',
            })
        }
    }
    return schreibe(knex, auftraege)
}

/**
 * Wer beim Hype-Radar verfolgt wird — drei Gruppen, rein.
 *
 *   spitze     die besten bestandenen Funde (worüber der Radar spricht)
 *   verworfen  Stichprobe der von der Sicherheitsprüfung Aussortierten
 *   feld       Stichprobe derer unter der Hype-Schwelle
 *
 * Ohne die beiden Vergleichsgruppen hiesse „30 % leben nach einem Monat noch"
 * gar nichts — vielleicht leben 30 % von allem. Nur Funde mit Vertrag: ohne
 * Adresse lässt sich später nichts nachschlagen.
 */
export function waehleHype(kandidaten = [], zufall = Math.random) {
    const mitVertrag = kandidaten.filter((k) => String(k.contractAddress || '').length > 0)
    const spitze = mitVertrag
        .filter((k) => k.status === 'bestanden' || k.status === 'berichtet')
        .sort((a, b) => (Number(b.hypeScore) || 0) - (Number(a.hypeScore) || 0))
        .slice(0, VERFOLGT)
    const verworfen = stichprobe(mitVertrag.filter((k) => k.status === 'verworfen'), KONTROLLE, zufall)
    const feld = stichprobe(mitVertrag.filter((k) => k.status === 'bewertet'), KONTROLLE, zufall)
    return [
        ...spitze.map((k) => ({ ...k, gruppe: 'spitze' })),
        ...verworfen.map((k) => ({ ...k, gruppe: 'verworfen' })),
        ...feld.map((k) => ({ ...k, gruppe: 'feld' })),
    ]
}

/** Dasselbe für die Funde des Hype-Radars. */
export async function legeAnHype(erstelltAm) {
    const knex = getKnex()
    const zeilen = await knex('hype_candidates')
        .where('erstelltAm', Number(erstelltAm))
        .whereIn('status', ['bestanden', 'berichtet', 'verworfen', 'bewertet'])
    const auswahl = waehleHype(zeilen)
    if (!auswahl.length) return 0

    const jetzt = Date.now()
    const auftraege = []
    for (const z of auswahl) {
        let markt = {}
        try { markt = JSON.parse(z.marktDaten || '{}') } catch { /* egal */ }
        for (const [horizont, ms] of Object.entries(HORIZONTE.hype)) {
            auftraege.push({
                art: 'hype',
                /*
                 * Beim Hype-Radar steht hier die KANDIDATEN-Zeile, nicht ein
                 * Lauf. Bis zum 07.10.2026 stand fest 0 — mit dem eindeutigen
                 * Schlüssel (art, laufId, symbol, horizont) wurde damit jedes
                 * Kürzel genau EINMAL im Leben verfolgt; jeder spätere Lauf
                 * und jeder gleichnamige Vertrag auf einer anderen Kette
                 * verschwand still im `ignore()`. Die Zeilennummer ist je Lauf
                 * und Vertrag eindeutig und passt in die bestehende Spalte.
                 */
                laufId: z.id,
                symbol: z.symbol,
                chain: z.chain || '',
                contract: z.contractAddress || '',
                note: z.hypeScore,
                safetyScore: z.safetyScore,
                gruppe: z.gruppe,
                horizont,
                erstelltAm: jetzt,
                faelligAm: jetzt + ms,
                status: 'offen',
                preisStart: zahl(markt.preisUsd),
                liquiditaetStart: zahl(markt.liquiditaetUsd),
            })
        }
    }
    return schreibe(knex, auftraege)
}

async function schreibe(knex, auftraege) {
    for (let i = 0; i < auftraege.length; i += 25) {
        await knex('radar_ergebnisse').insert(auftraege.slice(i, i + 25))
            .onConflict(['art', 'laufId', 'symbol', 'horizont']).ignore()
    }
    return auftraege.length
}

const zahl = (w) => (Number.isFinite(Number(w)) && w !== null ? Number(w) : null)

/** So oft wird ein Auftrag nach einem vorübergehenden Ausfall erneut versucht. */
const MAX_VERSUCHE = 3

/** Und so lange wird dazwischen gewartet. */
const WIEDERHOLUNG_MS = 30 * 60 * 1000

/**
 * Fällige Aufträge einlösen.
 *
 * @param {number} deckel  höchstens so viele je Durchgang — der Takt soll
 *                         kurz sein, nicht vollständig.
 */
export async function messeFaellige(deckel = 30) {
    const knex = getKnex()
    const faellig = await knex('radar_ergebnisse')
        .where('status', 'offen')
        .andWhere('faelligAm', '<=', Date.now())
        .orderBy('faelligAm', 'asc').limit(deckel)
    if (!faellig.length) return { gemessen: 0, fehlgeschlagen: 0 }

    let gemessen = 0
    let fehlgeschlagen = 0
    for (const a of faellig) {
        try {
            const werte = a.art === 'coinradar'
                ? await messeCoin(a)
                : await messeHype(a)
            await knex('radar_ergebnisse').where('id', a.id).update({
                ...werte, status: 'gemessen', gemessenAm: Date.now(),
            })
            gemessen++
        } catch (e) {
            /*
             * Ein Ausfall ist nicht dasselbe wie ein Ergebnis. Bis zum
             * 07.10.2026 wurde nach dem ersten Fehlschlag aufgegeben — ein
             * kurzer Aussetzer von Binance oder DexScreener nahm die Messung
             * für immer aus der Statistik, und zwar bevorzugt in bewegten
             * Stunden, in denen die Anbieter am ehesten klemmen. Jetzt gibt
             * es drei Versuche im Abstand einer halben Stunde; danach wird
             * aufgegeben, damit ein delistetes Symbol nicht ewig in der
             * Warteschlange hängt. `faelligAm` darf dabei wandern — das
             * Messfenster hängt am Horizont, nicht am Zeitpunkt der Messung.
             */
            const versuche = (Number(a.versuche) || 0) + 1
            const endgueltig = versuche >= MAX_VERSUCHE
            await knex('radar_ergebnisse').where('id', a.id).update({
                versuche,
                fehler: String(e.message).slice(0, 200),
                ...(endgueltig
                    ? { status: 'fehlgeschlagen', gemessenAm: Date.now() }
                    : { faelligAm: Date.now() + WIEDERHOLUNG_MS }),
            }).catch(() => {})
            if (endgueltig) fehlgeschlagen++
        }
    }
    return { gemessen, fehlgeschlagen }
}

/**
 * Das Messfenster eines Coin-Radar-Auftrags — rein, damit prüfbar.
 *
 * Bis zum 07.10.2026 reichte das Fenster von der Aussage bis JETZT, nicht bis
 * zum Ende des Horizonts. Der Takt läuft alle fünf Minuten und misst höchstens
 * dreissig Aufträge je Durchgang; „15 Minuten" waren damit im Schnitt ein
 * Sechstel länger, nach einer Auszeit des Rechners Stunden oder Tage — und
 * MFE und MAE wachsen mit der Fensterlänge. Lag die Aussage weiter zurück als
 * die 500 geholten Kerzen, war sogar der Startpreis falsch, ohne dass es
 * jemand bemerkt hätte.
 *
 * Jetzt: Kerzen mit Eröffnung in [Aussage, Aussage + Horizont), und das
 * Fenster muss vorn und hinten vollständig sein — sonst wird nicht gemessen.
 *
 * @returns {{preisStart, preisEnde, renditePct, mfePct, maePct}}
 */
export function rechneFenster(kerzen, von, bis, schrittMs) {
    const fenster = (Array.isArray(kerzen) ? kerzen : [])
        .filter((k) => Number(k.t) >= von && Number(k.t) < bis)
        .sort((a, b) => a.t - b.t)
    if (fenster.length < 2) throw new Error('zu wenige Kerzen im Messfenster')
    if (fenster[0].t - von > 2 * schrittMs) throw new Error('Messfenster beginnt zu spät')
    if (bis - (fenster[fenster.length - 1].t + schrittMs) > 2 * schrittMs) {
        throw new Error('Messfenster unvollständig')
    }

    const start = Number(fenster[0].o)
    const ende = Number(fenster[fenster.length - 1].c)
    if (!(start > 0)) throw new Error('kein Startpreis')
    const hoch = Math.max(...fenster.map((k) => Number(k.h)))
    const tief = Math.min(...fenster.map((k) => Number(k.l)))
    return {
        preisStart: start,
        preisEnde: ende,
        renditePct: ((ende - start) / start) * 100,
        mfePct: ((hoch - start) / start) * 100,
        maePct: ((tief - start) / start) * 100,
    }
}

/**
 * Coin-Radar: Rendite, MAE und MFE aus den Kerzen des Horizonts.
 *
 * MAE und MFE sind wichtiger als die blosse Rendite. Ein Coin, der erst 8 %
 * gegen einen läuft und dann 2 % ins Plus dreht, ist ein anderes Geschäft als
 * einer, der schnurgerade 2 % steigt — und nur die eine Zahl unterscheidet die
 * beiden nicht.
 *
 * Gelesen wird die HISTORIE des Fensters (`getHistoricalCandles`, gebremst),
 * nicht „die letzten 500 Kerzen" — so ist eine späte Messung genauso richtig
 * wie eine pünktliche.
 */
async function messeCoin(a) {
    const dauer = HORIZONTE.coinradar[a.horizont]
    if (!dauer) throw new Error(`unbekannter Horizont ${a.horizont}`)
    const von = Number(a.erstelltAm)
    const bis = von + dauer
    // Feine Auflösung für kurze Horizonte, gröbere für lange.
    const ze = dauer <= 3600e3 ? '1m' : '5m'
    const schritt = timeframeMs(ze)
    const kerzen = await getHistoricalCandles(a.symbol, ze, von, bis,
        { seite: Math.ceil(dauer / schritt) + 2 })
    return { ...rechneFenster(kerzen, von, bis, schritt), nochHandelbar: 1 }
}

/** Hype-Radar: lebt der Fund noch, und was ist aus Preis und Liquidität geworden? */
async function messeHype(a) {
    if (!a.contract) throw new Error('keine Vertragsadresse')
    const { dexDetails } = await import('./hype-radar/quellen.js')
    /*
     * `streng`: Ein Ausfall von DexScreener muss als Fehler ankommen. Ohne
     * das schluckte der Sammelabruf ihn, lieferte „nichts gefunden" — und
     * daraus wurde unten „der Fund ist weg", das härteste Ergebnis überhaupt.
     */
    const d = await dexDetails(a.contract, { streng: true })
    if (!d?.markt) {
        /*
         * Kein Paar mehr — das ist keine fehlgeschlagene Messung, sondern das
         * härteste Ergebnis, das es gibt: der Fund ist weg.
         */
        return { nochHandelbar: 0, preisEnde: null, liquiditaetEnde: 0 }
    }
    const start = zahl(a.preisStart)
    const ende = zahl(d.markt.preisUsd)
    return {
        preisEnde: ende,
        renditePct: start > 0 && ende !== null ? ((ende - start) / start) * 100 : null,
        liquiditaetEnde: zahl(d.markt.liquiditaetUsd),
        nochHandelbar: (Number(d.markt.liquiditaetUsd) || 0) > 0 ? 1 : 0,
    }
}

/**
 * Der Takt. Alle fünf Minuten nachsehen, ob etwas fällig ist.
 *
 * Der DB-Anspruch verhindert wie überall den Doppellauf von NAS und
 * Entwicklungsrechner — zwei Prozesse würden dieselben Aufträge messen und
 * einander die Ergebnisse überschreiben.
 */
export function startErgebnisTakt() {
    const TAKT_MS = 5 * 60 * 1000
    let laeuft = false

    const uhr = setInterval(async () => {
        if (laeuft) return
        try {
            if (!(await beansprucheAufgabe('radar_ergebnisse', TAKT_MS - 30000))) return
            laeuft = true
            const { gemessen, fehlgeschlagen } = await messeFaellige()
            if (gemessen || fehlgeschlagen) {
                console.log(` -> Radar-Erfolgskontrolle: ${gemessen} gemessen, ${fehlgeschlagen} fehlgeschlagen`)
            }
        } catch (e) {
            logWarn('radar-ergebnisse', `Takt: ${e.message}`)
        } finally {
            laeuft = false
        }
    }, TAKT_MS)

    uhr.unref?.()
    return () => clearInterval(uhr)
}
