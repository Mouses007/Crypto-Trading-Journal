/**
 * Endpunkte des Coin-Radars.
 *
 * Ein Lauf dauert ein bis zwei Minuten — Kerzen für rund zweihundert Coins über
 * zwei Zeiteinheiten, gebremst, damit die Handels-Engine ihr Binance-Budget
 * behält. Deshalb wie überall im Haus: SSE-Fortschritt statt stiller Ladebalken,
 * Zustand in der Datenbank statt im Speicher, und zwei Sperren übereinander —
 * eine prozesslokale gegen den Doppelklick, eine in der Datenbank gegen den
 * zweiten Rechner (NAS-Container und Entwicklungsrechner teilen eine Postgres).
 */

import { getKnex } from './database.js'
import { beobachteAbbruch, sseSender } from './sse.js'
import { logWarn, logError } from './logger.js'
import { beansprucheAufgabe, beansprucheFuehrung, gibFuehrungFrei, meldeFehler } from './db-claim.js'
import { leseEinstellungen, schreibeEinstellungen, VORGABEN } from './coin-radar/einstellungen.js'
import { ANKER } from './coin-radar/bewertung.js'
import { KOPPLUNG_FEST, KOPPLUNG_LOSE, BTC_ZEITEINHEIT } from './coin-radar/btc-vergleich.js'
import { fuehreLaufAus } from './coin-radar/lauf.js'
import { erzeugeEinordnung } from './coin-radar/einordnung.js'
import { holeCoinInfo } from './coin-radar/coin-info.js'
import { leseSchluessel } from './hype-radar/einstellungen.js'
import { legeAnCoinRadar } from './radar-ergebnisse.js'
import { werteAus } from './radar-guete.js'

/**
 * Die Schwellen, nach denen die Oberfläche filtert und einfärbt.
 *
 * Sie gehen mit den Einstellungen mit, statt im Frontend ein zweites Mal
 * dazustehen. Vorher war „im Spiel" als `rvol >= 2` und „trendet" als
 * `adx >= 25` direkt in `CoinRadar.vue` verdrahtet, während `ANKER` dieselben
 * Zahlen führte — wer eine davon anpasste, verschob die Anzeige gegen die
 * Bewertung, ohne dass es auffiel.
 */
const KONSTANTEN = {
    rvolSchwelle: ANKER.rvolSchwelle,
    adxSchwelle: ANKER.adxSchwelle,
    kopplungFest: KOPPLUNG_FEST,
    kopplungLose: KOPPLUNG_LOSE,
    btcZeiteinheit: BTC_ZEITEINHEIT,
}

/** Gegen den Doppelklick im selben Prozess. */
let laufAktiv = false

const FUEHRUNG_KEY = 'coinradar_lauf'
/*
 * Die Führung muss länger halten als ein Lauf dauert, sonst übernimmt der
 * zweite Rechner mittendrin. Zehn Minuten sind grosszügig für einen Lauf von
 * ein bis zwei Minuten — und kurz genug, dass ein abgestürzter Prozess die
 * Sperre nicht bis zum nächsten Neustart blockiert.
 */
const FUEHRUNG_TTL_MS = 10 * 60 * 1000

export function setupCoinRadarRoutes(app) {
    // ── Einstellungen ───────────────────────────────────────────────────
    app.get('/api/coin-radar/einstellungen', async (req, res) => {
        try {
            res.json({ ...(await leseEinstellungen()), vorgaben: VORGABEN, konstanten: KONSTANTEN })
        } catch (e) {
            logWarn('coin-radar', `Einstellungen lesen: ${e.message}`)
            res.status(500).json({ error: 'Einstellungen konnten nicht geladen werden' })
        }
    })

    app.put('/api/coin-radar/einstellungen', async (req, res) => {
        try {
            const neu = { ...(req.body || {}) }
            /*
             * Die Gewichte müssen nicht auf 100 summieren — die Bewertung
             * normiert selbst. Eine Summe von NULL wäre aber eine Division
             * durch nichts, und ein leeres Zeiteinheiten-Feld liesse den Lauf
             * ohne Hauptzeiteinheit dastehen. Beides hier abfangen, nicht
             * später im Lauf.
             */
            if (neu.gewichte) {
                const summe = Object.values(neu.gewichte).reduce((a, b) => a + (Number(b) || 0), 0)
                if (summe <= 0) return res.status(400).json({ error: 'Die Gewichte dürfen nicht alle null sein.' })
            }
            if (neu.zeiteinheiten && (!Array.isArray(neu.zeiteinheiten) || !neu.zeiteinheiten.length)) {
                return res.status(400).json({ error: 'Mindestens eine Zeiteinheit wird gebraucht.' })
            }
            await schreibeEinstellungen(neu)
            res.json({ ...(await leseEinstellungen()), vorgaben: VORGABEN, konstanten: KONSTANTEN })
        } catch (e) {
            logWarn('coin-radar', `Einstellungen schreiben: ${e.message}`)
            res.status(500).json({ error: 'Einstellungen konnten nicht gespeichert werden' })
        }
    })

    // ── Läufe ───────────────────────────────────────────────────────────
    app.get('/api/coin-radar/laeufe', async (req, res) => {
        try {
            const zeilen = await getKnex()('coinradar_laeufe')
                .select('id', 'erstelltAm', 'beendetAm', 'status', 'ausloeser', 'gesamt',
                    'fortschritt', 'geprueft', 'verworfenHuerde', 'rangkorrelation',
                    'vergleichslauf', 'einordnung', 'kostenUsd', 'fehler')
                .orderBy('id', 'desc')
                .limit(Math.min(100, Number(req.query.limit) || 30))
            res.json(zeilen)
        } catch (e) {
            res.status(500).json({ error: 'Läufe konnten nicht geladen werden' })
        }
    })

    app.get('/api/coin-radar/laeufe/:id', async (req, res) => {
        try {
            const lauf = await getKnex()('coinradar_laeufe').where('id', Number(req.params.id)).first()
            if (!lauf) return res.status(404).json({ error: 'Lauf nicht gefunden' })
            res.json({
                ...lauf,
                zeiteinheiten: sicherParse(lauf.zeiteinheiten, []),
                quellenStand: sicherParse(lauf.quellenStand, {}),
            })
        } catch (e) {
            res.status(500).json({ error: 'Lauf konnte nicht geladen werden' })
        }
    })

    /**
     * Die Rangliste eines Laufs. Ohne `laufId` der letzte fertige.
     *
     * Ausdrücklich der letzte FERTIGE: Während ein Lauf schreibt, ist seine
     * Rangfolge halb — sie zu zeigen hiesse, eine unfertige Liste als Ergebnis
     * auszugeben, und die oberen Plätze wären schlicht die, die zuerst dran
     * waren.
     */
    app.get('/api/coin-radar/zeilen', async (req, res) => {
        try {
            const knex = getKnex()
            let laufId = Number(req.query.laufId) || 0
            if (!laufId) {
                const letzter = await knex('coinradar_laeufe')
                    .where('status', 'fertig').orderBy('id', 'desc').first()
                if (!letzter) return res.json({ lauf: null, zeilen: [] })
                laufId = letzter.id
            }
            const lauf = await knex('coinradar_laeufe').where('id', laufId).first()

            let q = knex('coinradar_zeilen').where('laufId', laufId)
            // Vorgabe: nur die Bewerteten. Wer wissen will, wer an welcher
            // Hürde scheiterte, fragt danach — es sind ein paar hundert Zeilen.
            if (req.query.huerden === '1') q = q.where('status', 'huerde').orderBy('umsatz24h', 'desc')
            else q = q.where('status', 'bewertet').orderBy('rang', 'asc')

            const zeilen = await q.limit(Math.min(500, Number(req.query.limit) || 300))
            res.json({
                lauf: lauf ? { ...lauf, quellenStand: sicherParse(lauf.quellenStand, {}) } : null,
                zeilen: zeilen.map((z) => ({
                    ...z,
                    jeZeiteinheit: sicherParse(z.jeZeiteinheit, {}),
                    teilnoten: sicherParse(z.teilnoten, {}),
                    boersen: sicherParse(z.boersen, {}),
                })),
            })
        } catch (e) {
            logWarn('coin-radar', `Zeilen lesen: ${e.message}`)
            res.status(500).json({ error: 'Rangliste konnte nicht geladen werden' })
        }
    })

    /**
     * Projekt-Infos zu einem Symbol — Beschreibung, Links, Kategorien.
     * `null` (kein Treffer bei CoinGecko) ist ein gültiges, eigenes Ergebnis
     * und kein Fehler: gerade die kleinen Perpetuals, um die es im Coin-Radar
     * oft geht, sind nicht bei jeder Quelle gelistet.
     */
    app.get('/api/coin-radar/coin-info', async (req, res) => {
        try {
            const symbol = String(req.query.symbol || '').trim()
            if (!symbol) return res.status(400).json({ error: 'Symbol fehlt' })
            const { coingecko } = await leseSchluessel()
            const info = await holeCoinInfo(symbol, coingecko)
            res.json({ info })
        } catch (e) {
            logWarn('coin-radar', `Coin-Info: ${e.message}`)
            res.status(502).json({ error: 'Projekt-Infos konnten nicht geladen werden' })
        }
    })

    /**
     * Wer hält sich oben — über ALLE fertigen Läufe, nicht nur die letzten
     * paar. Seit die Läufe automatisch alle paar Stunden laufen statt von
     * Hand, wäre "die letzten 5" nur noch ein Tagesausschnitt; Beständigkeit
     * über Tage/Wochen braucht die volle Historie. Deshalb eine einzige
     * Aggregations-Abfrage statt N Einzelabrufe (einer je Lauf) — das war der
     * bisherige Ansatz auf der Client-Seite und hätte bei hunderten
     * automatischen Läufen ebenso viele parallele Anfragen bedeutet.
     */
    app.get('/api/coin-radar/dauerhaft', async (req, res) => {
        try {
            const knex = getKnex()
            const moeglich = Number(await knex('coinradar_laeufe').where('status', 'fertig').count('id as n').first().then((r) => r?.n) || 0)
            if (moeglich < 2) return res.json({ dauerhaft: [], moeglich })

            const treffer = await knex('coinradar_zeilen as z')
                .join('coinradar_laeufe as l', 'l.id', 'z.laufId')
                .where('l.status', 'fertig')
                .andWhere('z.status', 'bewertet')
                .andWhere('z.rang', '<=', 10)
                .andWhere('z.rang', '>', 0)
                .select('z.symbol')
                .count('z.id as haeufigkeit')
                .groupBy('z.symbol')
                .orderBy('haeufigkeit', 'desc')
                .limit(8)

            const dauerhaft = treffer
                .map((t) => ({ symbol: t.symbol, male: Number(t.haeufigkeit), moeglich }))
                .filter((t) => t.male >= 2)
                .map((t) => ({ ...t, anteil: Math.round((t.male / moeglich) * 100) }))
            res.json({ dauerhaft, moeglich })
        } catch (e) {
            logWarn('coin-radar', `Dauerhaft-Auswertung: ${e.message}`)
            res.status(500).json({ error: 'Beständigkeit konnte nicht berechnet werden' })
        }
    })

    /**
     * Erfolgskontrolle: taugt die Rangfolge überhaupt etwas?
     *
     * Die Rangkorrelation zum Vorlauf misst Beharrlichkeit; DIESE Zahlen
     * messen Nutzen. Sie stehen bewusst als eigener Endpunkt und nicht neben
     * der Rangliste — wer sie liest, soll die Absicht dahinter mitbekommen.
     */
    app.get('/api/coin-radar/guete', async (req, res) => {
        try {
            const knex = getKnex()
            const seit = Date.now() - (Number(req.query.tage) || 7) * 24 * 3600e3
            const zeilen = await knex('radar_ergebnisse')
                .where('art', 'coinradar').andWhere('erstelltAm', '>=', seit)
            const horizonte = [...new Set(zeilen.map((z) => z.horizont))]
            res.json({
                seit,
                gesamt: zeilen.length,
                jeHorizont: horizonte.map((h) => werteAus(zeilen.filter((z) => z.horizont === h), h)),
            })
        } catch (e) {
            logWarn('coin-radar', `Güte lesen: ${e.message}`)
            res.status(500).json({ error: 'Erfolgskontrolle konnte nicht geladen werden' })
        }
    })

    // ── Lauf starten ────────────────────────────────────────────────────
    app.post('/api/coin-radar/lauf', async (req, res) => {
        if (laufAktiv) {
            return res.status(429).json({ error: 'Es läuft bereits ein Durchgang. Bitte warten.' })
        }

        let einst
        try {
            einst = await leseEinstellungen()
        } catch {
            return res.status(500).json({ error: 'Einstellungen nicht lesbar' })
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        })
        const istAbgebrochen = beobachteAbbruch(res)
        const sende = sseSender(res, istAbgebrochen)

        laufAktiv = true
        let hatFuehrung = false
        try {
            /*
             * Die Führung erst holen, wenn wirklich gearbeitet wird — nicht
             * beim Öffnen der Seite. Sonst blockierte ein Tab, der nur schaut,
             * den Takt auf dem anderen Rechner.
             */
            hatFuehrung = await beansprucheFuehrung(FUEHRUNG_KEY, FUEHRUNG_TTL_MS)
            if (!hatFuehrung) {
                sende({ type: 'fehler', fehler: 'Auf einem anderen Rechner läuft gerade ein Durchgang.' })
                return
            }
            sende({ type: 'start' })
            await laufeMitZustand(einst, 'manuell',
                (stand) => sende({ type: 'fortschritt', ...stand }),
                istAbgebrochen,
                (fertig) => sende({ type: 'fertig', ...fertig }))
        } catch (e) {
            logWarn('coin-radar', `Lauf fehlgeschlagen: ${e.message}`)
            sende({ type: 'fehler', fehler: e.message })
        } finally {
            if (hatFuehrung) await gibFuehrungFrei(FUEHRUNG_KEY).catch(() => {})
            laufAktiv = false
            res.end()
        }
    })
}

/**
 * Einen Lauf anlegen, durchführen, abschliessen.
 *
 * Die Zeile in `coinradar_laeufe` entsteht VOR der Arbeit: sie ist der
 * Zustand, an dem sich die Wiederaufnahme orientiert, und sie soll auch dann
 * dastehen, wenn der Prozess mitten im Lauf stirbt — sonst wäre nach einem
 * Absturz nicht erkennbar, dass überhaupt etwas versucht wurde.
 */
async function laufeMitZustand(einst, ausloeser, melde, istAbgebrochen = () => false, fertigMelden = () => {}) {
    const knex = getKnex()

    /*
     * Erst nachsehen, ob ein Lauf liegen geblieben ist.
     *
     * Der Lauf überspringt Symbole, die für seine `laufId` schon eine Zeile
     * haben — das ist die Wiederaufnahme, und sie war bis zum Audit vom
     * 19.08.2026 UNERREICHBAR: Jeder Start legte eine neue Laufzeile an, also
     * fand die Prüfung nie etwas. Das Versprechen stand im Kommentar, im
     * Schema und in CLAUDE.md, nur nicht im Ablauf.
     *
     * Der Altersfilter ist die Sicherung: Nur ein Lauf, der älter ist als die
     * Führungssperre, gilt als verwaist. Ein gerade laufender Durchgang auf
     * dem anderen Rechner wird so nie übernommen — dort hält jemand die
     * Führung, und die wäre sonst umsonst.
     */
    const verwaist = await knex('coinradar_laeufe')
        .where('status', 'laeuft')
        .andWhere('erstelltAm', '<', Date.now() - FUEHRUNG_TTL_MS)
        .orderBy('id', 'desc').first()

    let laufId
    if (verwaist) {
        laufId = verwaist.id
        const schon = await knex('coinradar_zeilen').where('laufId', laufId).count({ n: '*' }).first()
        melde({ schritt: 'wiederaufnahme', laufId, zeilen: Number(schon?.n) || 0 })
        logWarn('coin-radar', `Lauf ${laufId} wird fortgesetzt (${schon?.n || 0} Zeilen vorhanden)`)
    } else {
        const [eingefuegt] = await knex('coinradar_laeufe').insert({
            erstelltAm: Date.now(),
            status: 'laeuft',
            ausloeser,
            zeiteinheiten: JSON.stringify(einst.zeiteinheiten || []),
        }).returning('id')
        laufId = typeof eingefuegt === 'object' ? eingefuegt.id : eingefuegt
    }

    try {
        const ergebnis = await fuehreLaufAus({ id: laufId }, einst, melde, istAbgebrochen)

        if (ergebnis?.abgebrochen) {
            await knex('coinradar_laeufe').where('id', laufId)
                .update({ status: 'abgebrochen', beendetAm: Date.now() })
            fertigMelden({ laufId, abgebrochen: true })
            return { laufId, abgebrochen: true }
        }

        /*
         * Erfolgskontrolle anmelden (R-06).
         *
         * Muss VOR der KI-Einordnung passieren und darf nichts kosten: Die
         * Aufträge halten fest, was die Seite gerade behauptet hat. Schlägt es
         * fehl, ist der Lauf trotzdem gültig — die Kontrolle ist eine
         * Beobachtung über den Lauf, nicht Teil von ihm.
         */
        await legeAnCoinRadar(laufId).catch((e) =>
            logWarn('coin-radar', `Erfolgskontrolle nicht angemeldet: ${e.message}`))

        // Die Einordnung NACH dem Abschluss: Sie kostet, und die Rangliste ist
        // das Produkt. Scheitert sie, steht der Lauf trotzdem als „fertig" da.
        let einordnung = ''
        if (einst.einordnungAn) {
            melde({ schritt: 'einordnung' })
            /*
             * ALLE bewerteten Zeilen, nicht die besten fünfzig.
             *
             * Mit einem Deckel von 50 stimmten die Kennzahlen im Anstoss nicht
             * mehr mit dem Lauf überein — das Modell schrieb pflichtbewusst
             * „von 50 bewerteten Coins", während es 80 waren. Namentlich sieht
             * es ohnehin nur die obersten zehn; die Kennzahlen darüber müssen
             * aber den ganzen Lauf beschreiben, sonst steht eine falsche Zahl
             * im Text.
             */
            const zeilen = await knex('coinradar_zeilen')
                .where({ laufId, status: 'bewertet' }).orderBy('rang', 'asc')
            const e = await erzeugeEinordnung(zeilen, {
                verworfen: ergebnis.verworfen,
                ausloeser,
                rangkorrelation: ergebnis.rangkorrelation?.wert,
                gemeinsam: ergebnis.rangkorrelation?.gemeinsam,
            }, laufId)
            if (e) {
                einordnung = e.text
                await knex('coinradar_laeufe').where('id', laufId)
                    .update({ einordnung: e.text, kostenUsd: e.kostenUsd })
            }
        }

        fertigMelden({ laufId, ...ergebnis, einordnung })
        return { laufId, ...ergebnis, einordnung }
    } catch (e) {
        await knex('coinradar_laeufe').where('id', laufId)
            .update({ status: 'fehler', beendetAm: Date.now(), fehler: String(e.message).slice(0, 500) })
            .catch(() => {})
        throw e
    }
}

function sicherParse(text, rueckfall) {
    try {
        const j = JSON.parse(text)
        return j ?? rueckfall
    } catch {
        return rueckfall
    }
}

/**
 * Der Zeitplan.
 *
 * Kurzer Takt, der selbst entscheidet, ob Arbeit ansteht — `beansprucheAufgabe`
 * hält das Intervall, `beansprucheFuehrung` verhindert, dass zwei Rechner
 * denselben Lauf gleichzeitig machen. Beides braucht es: der Anspruch regelt
 * das WANN, die Führung das WER.
 */
export function startCoinRadarTakt() {
    const TAKT_MS = 5 * 60 * 1000

    const uhr = setInterval(async () => {
        if (laufAktiv) return
        let hatFuehrung = false
        try {
            const einst = await leseEinstellungen()
            if (!einst.aktiv) return

            const stunden = Math.max(1, Number(einst.intervallStunden) || 1)
            if (!(await beansprucheAufgabe('coinradar_lauf', stunden * 3600 * 1000))) return

            hatFuehrung = await beansprucheFuehrung(FUEHRUNG_KEY, FUEHRUNG_TTL_MS)
            if (!hatFuehrung) return

            laufAktiv = true
            const { laufId, bewertet } = await laufeMitZustand(einst, 'auto', () => {})
            console.log(` -> Coin-Radar: Lauf ${laufId} fertig, ${bewertet} Coins bewertet`)
        } catch (e) {
            logError('coin-radar', 'Zeitplan fehlgeschlagen', e)
            await meldeFehler('coinradar_lauf', e.message).catch(() => {})
        } finally {
            if (hatFuehrung) await gibFuehrungFrei(FUEHRUNG_KEY).catch(() => {})
            laufAktiv = false
        }
    }, TAKT_MS)

    uhr.unref?.()
    return () => clearInterval(uhr)
}
