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
import { FRUEH_REGEL_AUSWERTUNG } from './radar-guete.js'

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
    // Frühphase: Memecoins entscheiden sich in Tagen, nicht Wochen.
    frueh: { '1d': 24 * 3600e3, '3d': 3 * 24 * 3600e3, '7d': 7 * 24 * 3600e3 },
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

/*
 * Höchstens EIN Coin-Radar-Lauf je Stunde wird verfolgt. Gemessen 10.10.2026:
 * angelegt wurden 24 120 Aufträge am Tag (alle fünf Minuten ein Lauf zu je
 * 90), gemessen 8 640 — 606 954 standen offen, der älteste 27 Tage über der
 * Zeit, und vor dem ersten Frühphasen-Auftrag lagen 564 664 davon. Die
 * Frühphase wurde damit nie gemessen. Ein Lauf je Stunde reicht für die Frage,
 * ob die Rangfolge trägt: Die Läufe einer Stunde teilen ohnehin 13 von 14
 * Kerzen (siehe `rangkorrelation`).
 */
const COIN_ANLAGE_MS = 55 * 60e3

/**
 * Aufträge für einen Coin-Radar-Lauf anlegen — höchstens einmal je Stunde.
 */
export async function legeAnCoinRadar(laufId) {
    if (!(await beansprucheAufgabe('radar_ergebnisse_coinradar', COIN_ANLAGE_MS))) return 0
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

/**
 * Regelstand der Frühphasen-Erfolgskontrolle — eine Quelle, in der reinen
 * Auswertung (`radar-guete.js`). Aufträge mit älterem Stand (oder ohne) werden
 * gemessen, aber nicht ausgewertet: Bis 10.10.2026 war die Spitze anders
 * bestimmt (meldefähig ohne Handels- und Projektbedingung), und die Kontrolle
 * war eine Zufallsauswahl aller neu gesehenen Token — zwei Gruppen, die sich
 * schon unterschieden, bevor die Note etwas beitragen konnte.
 */
export const FRUEH_REGEL = FRUEH_REGEL_AUSWERTUNG

/** Je Durchgang so viele Token für die Grundrate — Zufallsauswahl der NEU gesehenen. */
const FELD_FRUEH = 1

/**
 * Feld-Aufträge tragen ihre Zeile mit diesem Versatz (negativ). Ein
 * Kontrollauftrag trägt −(Zeile des Spitzen-Tokens) — ohne den Versatz könnte
 * ein Feld-Auftrag dieselbe `laufId` bekommen und als Paar gelesen werden.
 */
export const FELD_VERSATZ = 1_000_000_000

/**
 * Wie weit das Alter von Spitze und Partner auseinander liegen darf: zwei
 * Stunden, bei älteren Token die Hälfte ihres Alters. Ein Token von zwanzig
 * Minuten und einer von zwei Tagen haben verschiedene Aussichten, gleich wie
 * gut die Note ist.
 */
const PAAR_ALTER_STUNDEN = 2
const PAAR_ALTER_ANTEIL = 0.5

/**
 * Wer in der Frühphase verfolgt wird — rein.
 *
 *   spitze     Token, die in diesem Durchgang die Schwelle ÜBERSCHRITTEN
 *              (meldefähig und Note über der Schwelle)
 *   kontrolle  je Spitzen-Token EIN Partner aus demselben Durchgang: ebenfalls
 *              meldefähig (Vertrag geprüft, belastbar gemessen, gehandelt),
 *              aber unter der Note — im selben Zustand (Kurve oder Pool) und
 *              im Alter am nächsten. `paar` ist die Zeile des Spitzen-Tokens.
 *   feld       Zufallsauswahl der neu gesehenen Token — die Grundrate.
 *
 * Gepaart, weil die Frage nicht lautet, ob gehandelte Token länger leben als
 * tote (das tun sie, ehe die Note etwas tut), sondern ob die NOTE unter gleich
 * gut geprüften Token die besseren findet.
 *
 * @param {Array} spitze       {id, contract, alterStunden, aufKurve, …}
 * @param {Array} vergleichbar meldefähig, unter der Schwelle
 * @param {Array} neuGesehen   in diesem Durchgang erstmals gesehen
 */
export function waehleFrueh(spitze = [], vergleichbar = [], neuGesehen = [], zufall = Math.random) {
    const belegt = new Set(spitze.map((z) => z.contract))
    const paare = []
    for (const s of spitze) {
        const alterS = Number(s.alterStunden) || 0
        const grenze = Math.max(PAAR_ALTER_STUNDEN, PAAR_ALTER_ANTEIL * alterS)
        let bester = null
        for (const k of vergleichbar) {
            if (belegt.has(k.contract) || Boolean(k.aufKurve) !== Boolean(s.aufKurve)) continue
            const abstand = Math.abs((Number(k.alterStunden) || 0) - alterS)
            if (abstand > grenze) continue
            if (!bester || abstand < bester.abstand) bester = { k, abstand }
        }
        if (bester) {
            belegt.add(bester.k.contract)
            paare.push({ ...bester.k, gruppe: 'kontrolle', paar: s.id })
        }
    }
    const feld = stichprobe(neuGesehen.filter((z) => !belegt.has(z.contract)), FELD_FRUEH, zufall)
        .map((z) => ({ ...z, gruppe: 'feld' }))
    return [...spitze.map((z) => ({ ...z, gruppe: 'spitze' })), ...paare, ...feld]
}

/** Die `laufId` eines Auftrags — siehe `waehleFrueh` und `FELD_VERSATZ`. */
export function laufIdFrueh(z) {
    if (z.gruppe === 'kontrolle') return -Number(z.paar)
    if (z.gruppe === 'feld') return -(FELD_VERSATZ + Number(z.id))
    return Number(z.id)
}

/**
 * Aufträge für die Frühphase anlegen.
 *
 * Mitgeschrieben wird, was die Auswertung zum Vergleichen braucht: der Zustand
 * am Start (schon durch die Kurve? wie alt? pump.fun?) — „hat die Kurve
 * geschafft" heisst nur etwas für einen Token, der zu Beginn noch darauf war.
 */
export async function legeAnFrueh(spitze = [], vergleichbar = [], neuGesehen = []) {
    const auswahl = waehleFrueh(spitze, vergleichbar, neuGesehen).filter((z) => z.contract && z.id)
    if (!auswahl.length) return 0
    const jetzt = Date.now()
    const auftraege = []
    for (const z of auswahl) {
        for (const [horizont, ms] of Object.entries(HORIZONTE.frueh)) {
            auftraege.push({
                art: 'frueh',
                laufId: laufIdFrueh(z),
                symbol: z.symbol || String(z.contract).slice(0, 10),
                chain: z.chain || '',
                contract: z.contract,
                note: z.note,
                gruppe: z.gruppe,
                horizont,
                erstelltAm: jetzt,
                faelligAm: jetzt + ms,
                status: 'offen',
                preisStart: positiv(z.preis),
                mcapStart: positiv(z.mcap),
                liquiditaetStart: zahl(z.liq),
                regel: FRUEH_REGEL,
                graduiertStart: z.graduiert === true ? 1 : (z.graduiert === false ? 0 : null),
                alterStartH: zahl(z.alterStunden),
                pumpFun: z.pump === true ? 1 : (z.pump === false ? 0 : null),
            })
        }
    }
    return schreibe(getKnex(), auftraege)
}

async function schreibe(knex, auftraege) {
    for (let i = 0; i < auftraege.length; i += 25) {
        await knex('radar_ergebnisse').insert(auftraege.slice(i, i + 25))
            .onConflict(['art', 'laufId', 'symbol', 'horizont']).ignore()
    }
    return auftraege.length
}

const zahl = (w) => (Number.isFinite(Number(w)) && w !== null ? Number(w) : null)

/** Ein Preis oder eine Bewertung von 0 ist keine Messung, sondern eine fehlende. */
const positiv = (w) => (w !== null && w !== undefined && w !== '' && Number(w) > 0 ? Number(w) : null)

/** So oft wird ein Auftrag nach einem vorübergehenden Ausfall erneut versucht. */
const MAX_VERSUCHE = 3

/** Und so lange wird dazwischen gewartet. */
const WIEDERHOLUNG_MS = 30 * 60 * 1000

/*
 * Je Art eine eigene Warteschlange. Bis 10.10.2026 nahm ein Durchgang die
 * dreissig ältesten fälligen Aufträge ALLER Arten — der Coin-Radar legte mehr
 * an, als je gemessen werden konnte, und Frühphase und Hype kamen hinter
 * Hunderttausenden Coin-Aufträgen nie an die Reihe. Frühphase und Hype zuerst:
 * ihre Quellen sind die langsamen, und ihre Fenster schliessen sich (ein Token
 * ohne Kerzen in GeckoTerminal ist nach Wochen nicht mehr nachzumessen).
 */
// Frühphase knapp: jede Messung kostet bis zu zwei GeckoTerminal-Abrufe, und dort
// gehen nur fünf je Minute — der Durchgang braucht sie für die Käufer.
export const DECKEL_JE_ART = { frueh: 4, hype: 20, coinradar: 40 }

/** Ein Durchgang hört nach so langer Zeit auf; der Rest wartet auf den nächsten. */
const DURCHGANG_MS = 150e3

/**
 * Fällige Aufträge einlösen.
 *
 * @param {object} deckel  je Art höchstens so viele je Durchgang — der Takt
 *                         soll kurz sein, nicht vollständig.
 */
export async function messeFaellige(deckel = DECKEL_JE_ART) {
    const knex = getKnex()
    const beginn = Date.now()
    // Altbestand der Frühphase in einem Zug auslassen (siehe unten); danach ist das ein leerer Schritt.
    await knex('radar_ergebnisse').where({ art: 'frueh', status: 'offen' })
        .where((q) => q.whereNull('regel').orWhereNot('regel', FRUEH_REGEL))
        .update({ status: 'ausgelassen', fehler: 'alter Regelstand — wird nicht ausgewertet', gemessenAm: beginn })
        .catch((e) => logWarn('radar-ergebnisse', `Altbestand auslassen: ${e.message}`))
    const faellig = []
    for (const [art, n] of Object.entries(deckel)) {
        faellig.push(...await knex('radar_ergebnisse')
            .where({ status: 'offen', art })
            .andWhere('faelligAm', '<=', beginn)
            .orderBy('faelligAm', 'asc').limit(n))
    }
    if (!faellig.length) return { gemessen: 0, fehlgeschlagen: 0 }

    let gemessen = 0
    let fehlgeschlagen = 0
    for (const a of faellig) {
        if (Date.now() - beginn > DURCHGANG_MS) break
        /*
         * Frühphasen-Aufträge nach alten Regeln werden nicht ausgewertet — sie
         * zu messen kostete je Auftrag DexScreener, pump.fun und zwei
         * GeckoTerminal-Abrufe. Gemessen am 10.10.2026 auf der NAS: 389 solche
         * standen vor den sechs neuen, und ihr Verbrauch fehlte dem laufenden
         * Durchgang bei den Käufern (31 von 150 Token).
         */
        if (a.art === 'frueh' && Number(a.regel) !== FRUEH_REGEL) {
            await knex('radar_ergebnisse').where('id', a.id)
                .update({ status: 'ausgelassen', fehler: 'alter Regelstand — wird nicht ausgewertet', gemessenAm: Date.now() })
                .catch(() => {})
            continue
        }
        try {
            const werte = a.art === 'coinradar'
                ? await messeCoin(a)
                : (a.art === 'frueh' ? await messeFrueh(a) : await messeHype(a))
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
 * Den Rückstand des Coin-Radars auf einen Lauf je Stunde ausdünnen — rein.
 *
 * Nur Läufe, von denen noch NICHTS gemessen ist: Die Auswertung rechnet je
 * Lauf, ein halb gemessener Lauf bliebe ein halber Vergleich. Je Stunde bleibt
 * der erste Lauf; die anderen werden `ausgelassen` — gemessen werden könnten
 * sie nie (siehe `COIN_ANLAGE_MS`).
 *
 * @param {Array<{laufId, am}>} offeneLaeufe  Läufe nur mit offenen Aufträgen
 * @returns {Array} die laufIds, die ausgelassen werden
 */
export function duenneLaeufe(offeneLaeufe = []) {
    const behalten = new Set()
    const weg = []
    for (const l of [...offeneLaeufe].sort((a, b) => Number(a.am) - Number(b.am))) {
        const stunde = Math.floor(Number(l.am) / 3600e3)
        if (behalten.has(stunde)) weg.push(l.laufId)
        else behalten.add(stunde)
    }
    return weg
}

async function duenneCoinRueckstand(knex) {
    const offen = await knex('radar_ergebnisse').where({ art: 'coinradar', status: 'offen' })
        .groupBy('laufId').select('laufId').min({ am: 'erstelltAm' })
    if (offen.length < 2) return 0
    const angefangen = new Set((await knex('radar_ergebnisse').where('art', 'coinradar').whereNot('status', 'offen')
        .whereIn('laufId', offen.map((l) => l.laufId)).distinct('laufId')).map((z) => Number(z.laufId)))
    const weg = duenneLaeufe(offen.filter((l) => !angefangen.has(Number(l.laufId))))
    for (let i = 0; i < weg.length; i += 200) {
        await knex('radar_ergebnisse').where({ art: 'coinradar', status: 'offen' }).whereIn('laufId', weg.slice(i, i + 200))
            .update({ status: 'ausgelassen', fehler: 'Rückstand: ein Lauf je Stunde' })
    }
    return weg.length
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
    const start = positiv(a.preisStart)
    const ende = positiv(d.markt.preisUsd)
    const liq = d.markt.liquiditaetUsd === null || d.markt.liquiditaetUsd === undefined
        ? null : zahl(d.markt.liquiditaetUsd)
    return {
        preisEnde: ende,
        renditePct: start && ende ? ((ende - start) / start) * 100 : null,
        liquiditaetEnde: liq,
        // Ein Paar ohne Liquiditätsangabe (Bindungskurve) gibt es noch — es
        // ist handelbar; erst eine gemeldete Null heisst „leer".
        nochHandelbar: liq === null || liq > 0 ? 1 : 0,
    }
}

/** GeckoTerminal-Netz je Kette — für die Kerzen des Messfensters. */
const GECKO_NETZ = { solana: 'solana', ethereum: 'eth', base: 'base', bsc: 'bsc' }

/** Kerzenbreite für das MFE: fünfzehn Minuten — ein Stundenhoch verwischt den Ausbruch, der zählt. */
const MFE_KERZE_MS = 15 * 60e3

/**
 * Höchster Kurs im Messfenster aus GeckoTerminal-Kerzen — rein.
 *
 * Nur Kerzen, die im Fenster BEGINNEN. Bis 10.10.2026 zählte die Stunde VOR
 * dem Start mit (`von − 1 h`): Ein Token, der kurz vor der Meldung schon
 * gestiegen war, brachte sein altes Hoch als „Höchststand danach" mit — bei
 * einem Ausbruch ist das die Regel, nicht die Ausnahme.
 *
 * @param {Array} ohlcv  GeckoTerminal `ohlcv_list`: [Sekunden, o, h, l, c, v]
 * @returns {{hoch:number, erstesOpen:number, erste:number}|null}
 */
export function hochImFenster(ohlcv, von, bis) {
    const im = (Array.isArray(ohlcv) ? ohlcv : [])
        .filter((k) => Array.isArray(k) && Number(k[0]) * 1000 >= von && Number(k[0]) * 1000 < bis)
        .sort((a, b) => a[0] - b[0])
    const hochs = im.map((k) => Number(k[2])).filter((x) => Number.isFinite(x) && x > 0)
    if (!hochs.length) return null
    return { hoch: Math.max(...hochs), erstesOpen: Number(im[0][1]), erste: Number(im[0][0]) * 1000 }
}

/** Ab so vielen Transaktionen in sechs Stunden „lebt" ein Token noch. */
export const LEBT_MIN_TX_6H = 5
const LEBT_FENSTER_MS = 6 * 3600e3

/**
 * Lebt der Token noch — wird er GEHANDELT? Rein.
 *
 * Bis 10.10.2026 hiess „lebt": DexScreener kennt ein Paar mit Liquidität über
 * null. Ein toter Token mit gesperrter Liquidität lebte damit für immer, und
 * ein Token auf der Kurve, den pump.fun kennt, lebte schon deshalb. Jetzt
 * zählt Handel: mindestens fünf Transaktionen in den letzten sechs Stunden
 * (DexScreener), auf der Kurve der letzte Handel innerhalb von sechs Stunden
 * (pump.fun nennt nur den Zeitpunkt, keine Zahl).
 *
 * @returns {1|0|null} null = Paar bekannt, aber ohne Angabe zum Handel
 */
export function lebtNoch({ markt = null, coin = null, jetzt = Date.now() } = {}) {
    if (markt) {
        if (markt.liquiditaetUsd !== null && markt.liquiditaetUsd !== undefined && Number(markt.liquiditaetUsd) === 0) return 0
        const tx6 = markt.transaktionen6h
        if (tx6 !== null && tx6 !== undefined && Number.isFinite(Number(tx6))) return Number(tx6) >= LEBT_MIN_TX_6H ? 1 : 0
    }
    const letzter = Number(coin?.last_trade_timestamp)
    if (coin && Number.isFinite(letzter) && letzter > 0) return jetzt - letzter <= LEBT_FENSTER_MS ? 1 : 0
    if (markt || coin) return null
    // Weder DexScreener noch pump.fun kennt ihn: weg.
    return 0
}

/**
 * Rendite mit DEMSELBEN Mass an Start und Ende — rein. Preis gegen Preis, sonst
 * Bewertung gegen Bewertung; nie das eine gegen das andere.
 *
 * @returns {{renditePct:number|null, mass:'preis'|'bewertung'|''}}
 */
export function renditeGleichesMass(start = {}, ende = {}) {
    const ps = positiv(start.preisStart)
    const pe = positiv(ende.preisEnde)
    if (ps && pe) return { renditePct: ((pe - ps) / ps) * 100, mass: 'preis' }
    const ms = positiv(start.mcapStart)
    const me = positiv(ende.mcapEnde)
    if (ms && me) return { renditePct: ((me - ms) / ms) * 100, mass: 'bewertung' }
    return { renditePct: null, mass: '' }
}

/**
 * Frühphase: lebt der Token, hat er die Kurve geschafft, was wurde aus Preis
 * oder Bewertung — und wie hoch stand er zwischendurch?
 *
 * Auf der Kurve gibt es oft keinen Preis von DexScreener; dort ist die
 * Bewertung der Massstab (bei fester Menge bewegen sich beide gleich).
 *
 * pump.fun wird über `pumpCoin` gelesen (`/coins-v2`; `/coins/{mint}` antwortet
 * für jeden Coin mit 404). Ein Ausfall WIRFT — bis 10.10.2026 wurde jeder
 * Fehler zu „pump.fun kennt ihn nicht", und ohne DexScreener-Paar daraus „tot".
 */
async function messeFrueh(a) {
    if (!a.contract) throw new Error('keine Vertragsadresse')
    const { dexDetails, holeJson, pumpCoin } = await import('./hype-radar/quellen.js')
    const d = await dexDetails(a.contract, { streng: true })
    // Der Zustand am Start sagt es (Kurve, Quelle, Handelsplatz); die Endung nur bei Altbestand.
    const istPump = a.pumpFun !== null && a.pumpFun !== undefined
        ? Number(a.pumpFun) === 1
        : a.chain === 'solana' && /pump$/i.test(String(a.contract))
    const coin = istPump ? await pumpCoin(a.contract) : null
    const m = d?.markt || null

    const preisEnde = positiv(m?.preisUsd)
    const mcapEnde = positiv(m?.marktkapitalisierung) ?? positiv(m?.fdv) ?? positiv(coin?.usd_market_cap)
    const liqEnde = m && m.liquiditaetUsd !== null && m.liquiditaetUsd !== undefined ? zahl(m.liquiditaetUsd) : null
    let graduiert = null
    if (coin) graduiert = coin.complete === true ? 1 : 0
    else if (istPump && m?.dex) graduiert = m.dex !== 'pumpfun' ? 1 : 0

    const { renditePct } = renditeGleichesMass(a, { preisEnde, mcapEnde })

    /*
     * MFE über alle Pools, in denen der Token im Fenster gehandelt wurde: auf
     * der Kurve UND im Pool danach. Bis 10.10.2026 nur über das Paar, das
     * DexScreener am ENDE zeigte — für einen Token, der zwischendurch die
     * Kurve verliess, fehlte damit genau die Phase, in der er stieg.
     */
    let mfePct = null
    const netz = GECKO_NETZ[a.chain]
    const pools = [...new Set([coin?.bonding_curve, coin?.pool_address, d?.pair].filter(Boolean))].slice(0, 2)
    if (netz && pools.length) {
        const dauer = HORIZONTE.frueh[a.horizont] || 0
        const von = Number(a.erstelltAm)
        const bis = von + dauer
        const letzterVersuch = (Number(a.versuche) || 0) + 1 >= MAX_VERSUCHE
        let hoch = null
        let fruehestes = null
        let beantwortet = 0
        for (const pool of pools) {
            let j
            try {
                j = await holeJson(`https://api.geckoterminal.com/api/v2/networks/${netz}/pools/${encodeURIComponent(pool)}`
                    + `/ohlcv/minute?aggregate=15&limit=${Math.min(1000, Math.ceil(dauer / MFE_KERZE_MS) + 2)}`
                    + `&before_timestamp=${Math.ceil(bis / 1000)}&currency=usd&token=${encodeURIComponent(a.contract)}`)
            } catch (e) {
                /*
                 * Kennt GeckoTerminal den Pool nicht, fehlt er eben. Alles andere —
                 * Drosselung, Ausfall — ist vorübergehend: dann wird der Auftrag
                 * später wiederholt. Bis 10.10.2026 wurde daraus still „kein
                 * Höchststand", endgültig: auf der NAS hatte eine von 40 Messungen ein MFE.
                 */
                if (Number(e.status) === 404) continue
                if (!letzterVersuch) throw new Error(`GeckoTerminal-Kerzen: ${e.message}`)
                continue
            }
            // `token=` wählt die Seite des Pools; ohne Gegenprobe wäre es bei vertauschten Seiten der SOL-Kurs.
            const basisToken = j?.meta?.base?.address
            if (basisToken && String(basisToken) !== String(a.contract)) continue
            beantwortet++
            const f = hochImFenster(j?.data?.attributes?.ohlcv_list, von, bis)
            if (!f) continue
            hoch = hoch === null ? f.hoch : Math.max(hoch, f.hoch)
            if (!fruehestes || f.erste < fruehestes.erste) fruehestes = f
        }
        const basis = positiv(a.preisStart) ?? positiv(fruehestes?.erstesOpen)
        if (hoch !== null && basis) {
            mfePct = ((hoch - basis) / basis) * 100
        } else if (hoch === null && beantwortet > 0 && positiv(a.preisStart)) {
            /*
             * Die Pools antworten, aber im ganzen Fenster keine Kerze: kein
             * einziger Handel — gestiegen ist er nicht. Fehlte er im Nenner, fielen
             * gerade die toten Token aus „verdoppelt" heraus, und die Quote stiege.
             */
            mfePct = 0
        }
    }

    return {
        preisEnde, mcapEnde, liquiditaetEnde: liqEnde,
        renditePct, mfePct, graduiert,
        nochHandelbar: lebtNoch({ markt: m, coin, jetzt: Date.now() }),
    }
}

/**
 * Der Takt. Alle fünf Minuten nachsehen, ob etwas fällig ist; alle sechs
 * Stunden den Rückstand des Coin-Radars ausdünnen.
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
            if (await beansprucheAufgabe('radar_ergebnisse_duennen', 6 * 3600e3)) {
                const weg = await duenneCoinRueckstand(getKnex()).catch((e) => {
                    logWarn('radar-ergebnisse', `Rückstand ausdünnen: ${e.message}`)
                    return 0
                })
                if (weg) console.log(` -> Radar-Erfolgskontrolle: ${weg} Coin-Radar-Läufe aus dem Rückstand ausgelassen (einer je Stunde bleibt)`)
            }
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
