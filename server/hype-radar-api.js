/**
 * Endpunkte des Hype-Radars.
 *
 * Aufgeteilt wie das Feature selbst: `/scan` macht die drei rechnenden Stufen,
 * `/bericht` den teuren vierten Schritt. Beide melden ihren Fortschritt über
 * SSE, weil ein Lauf je nach Quellenlage ein bis drei Minuten dauert und ein
 * stiller Ladebalken in dieser Zeit wie ein Absturz aussieht.
 *
 * Ein Wächter erlaubt nur einen Lauf gleichzeitig — parallel angestossen
 * würden zwei Läufe dieselben Fremdquellen doppelt abfragen und sich
 * gegenseitig in die Ratenbegrenzung treiben.
 */

import { getKnex } from './database.js'
import { beobachteAbbruch, sseSender } from './sse.js'
import { logWarn } from './logger.js'
import { beansprucheAufgabe, meldeFehler } from './db-claim.js'
import { leseEinstellungen, schreibeEinstellungen, schreibeSchluessel, maskiere } from './hype-radar/einstellungen.js'
import { scanne, scanneUndBerichte } from './hype-radar/lauf.js'
import { dexDetails } from './hype-radar/quellen.js'
import { ladeListungen, pruefeListung } from './hype-radar/listungen.js'
import { wachhundLauf, STANDARD_ALARM_REGELN } from './hype-radar/wachhund.js'
import { testZustellung } from './hype-radar/zustellung.js'
import { stufenNach, benoetigteAnbieter } from './hype-radar/stufen.js'
import { keySpalte } from './ai-models.js'
// Börsenfavoriten (Coin-Radar) brauchen den anderen Datenweg — siehe `boersenLive`.
import { holeMarktweit } from './coin-radar/daten.js'
import { fundingJahresRate } from './coin-radar/kennzahlen.js'

/** Prozesslokal wie beim Agenten — gegen den Doppelklick, nicht gegen den NAS. */
let laufAktiv = false

/** Für den Zeitplan zusätzlich: der DB-Anspruch gegen den zweiten Rechner. */
const ANSPRUCH = 'hype_scan'

/**
 * Fehlende Zugangsdaten der Berichtsstufe.
 *
 * Lieber vorher blockieren als still auf einen anderen Anbieter ausweichen:
 * wer den Ausweich nicht bemerkt, wundert sich später über Qualität oder
 * Rechnung und findet den Grund nicht.
 */
async function fehlendeSchluessel(einst) {
    const noetig = benoetigteAnbieter(einst)
    const s = await getKnex()('settings').where('id', 1).first() || {}
    return noetig.filter((p) => {
        if (p === 'ollama') return false          // lokal, braucht keinen
        const spalte = keySpalte(p)
        return !spalte || !s[spalte]
    })
}

export function setupHypeRadarRoutes(app) {
    // ── Einstellungen ───────────────────────────────────────────────────
    app.get('/api/hype-radar/einstellungen', async (req, res) => {
        try {
            const e = await leseEinstellungen()
            res.json({
                ...e,
                // Die Alarmschwellen leben neben ihren Regeln in `wachhund.js`
                // und werden erst hier aufgefüllt — eine zweite Vorgabenliste
                // in den Einstellungen wäre eine zweite Wahrheit.
                alarmRegeln: { ...STANDARD_ALARM_REGELN, ...(e.alarmRegeln || {}) },
                schluessel: maskiere(e.schluessel),      // nie im Klartext hinaus
                stufen: stufenNach(req.query.ordnung === 'guete' ? 'guete' : 'preis'),
                fehlendeSchluessel: await fehlendeSchluessel(e),
            })
        } catch (e) {
            logWarn('hype-radar', `Einstellungen lesen: ${e.message}`)
            res.status(500).json({ error: 'Einstellungen konnten nicht geladen werden' })
        }
    })

    app.put('/api/hype-radar/einstellungen', async (req, res) => {
        try {
            const { schluessel, ...rest } = req.body || {}
            await schreibeEinstellungen(rest)
            if (schluessel) await schreibeSchluessel(schluessel)
            const e = await leseEinstellungen()
            res.json({
                ...e,
                alarmRegeln: { ...STANDARD_ALARM_REGELN, ...(e.alarmRegeln || {}) },
                schluessel: maskiere(e.schluessel),
                fehlendeSchluessel: await fehlendeSchluessel(e),
            })
        } catch (e) {
            logWarn('hype-radar', `Einstellungen schreiben: ${e.message}`)
            res.status(500).json({ error: 'Einstellungen konnten nicht gespeichert werden' })
        }
    })

    // ── Kandidaten ──────────────────────────────────────────────────────
    app.get('/api/hype-radar/kandidaten', async (req, res) => {
        try {
            const knex = getKnex()
            let q = knex('hype_candidates').select('*')
            if (req.query.status) q = q.where('status', String(req.query.status))
            /*
             * Vorgabe: der letzte Lauf, und zwar genau er. Alle Zeilen eines
             * Laufs tragen denselben Zeitstempel, deshalb reicht Gleichheit —
             * ein Zeitfenster fasste zwei kurz aufeinanderfolgende Läufe
             * zusammen und zeigte dieselben Symbole doppelt.
             */
            if (req.query.alle !== '1') {
                const letzter = await knex('hype_candidates').max({ m: 'erstelltAm' }).first()
                if (letzter?.m) q = q.where('erstelltAm', Number(letzter.m))
            }
            const zeilen = await q.orderBy('hypeScore', 'desc').limit(300)
            res.json(zeilen.map((z) => ({
                ...z,
                quellen: sicherParse(z.quellen, []),
                marktDaten: sicherParse(z.marktDaten, {}),
                sozialDaten: sicherParse(z.sozialDaten, {}),
                sicherheitsDaten: sicherParse(z.sicherheitsDaten, {}),
            })))
        } catch (e) {
            logWarn('hype-radar', `Kandidaten lesen: ${e.message}`)
            res.status(500).json({ error: 'Kandidaten konnten nicht geladen werden' })
        }
    })

    // ── Berichte ────────────────────────────────────────────────────────
    app.get('/api/hype-radar/berichte', async (req, res) => {
        try {
            const zeilen = await getKnex()('hype_reports')
                .select('id', 'erstelltAm', 'ueberschrift', 'marktkontext',
                    'anzahlKandidaten', 'anzahlAussortiert', 'kostenUsd', 'ausloeser')
                .orderBy('erstelltAm', 'desc').limit(50)
            res.json(zeilen)
        } catch (e) {
            res.status(500).json({ error: 'Berichte konnten nicht geladen werden' })
        }
    })

    app.get('/api/hype-radar/berichte/:id', async (req, res) => {
        try {
            const z = await getKnex()('hype_reports').where('id', Number(req.params.id)).first()
            if (!z) return res.status(404).json({ error: 'Bericht nicht gefunden' })
            res.json({
                ...z,
                kandidaten: sicherParse(z.kandidaten, []),
                aussortiert: sicherParse(z.aussortiert, []),
                meta: sicherParse(z.meta, {}),
            })
        } catch (e) {
            res.status(500).json({ error: 'Bericht konnte nicht geladen werden' })
        }
    })

    app.delete('/api/hype-radar/berichte/:id', async (req, res) => {
        try {
            await getKnex()('hype_reports').where('id', Number(req.params.id)).del()
            res.json({ ok: true })
        } catch (e) {
            res.status(500).json({ error: 'Bericht konnte nicht gelöscht werden' })
        }
    })

    // ── Favoriten ───────────────────────────────────────────────────────
    app.get('/api/hype-radar/favoriten', async (req, res) => {
        try {
            const zeilen = await getKnex()('hype_favoriten').select('*').orderBy('erstelltAm', 'desc')
            res.json(zeilen)
        } catch (e) {
            res.status(500).json({ error: 'Favoriten konnten nicht geladen werden' })
        }
    })

    app.post('/api/hype-radar/favoriten', async (req, res) => {
        try {
            const { symbol, name, chain, contractAddress, pairAddress, narrative, quelle } = req.body || {}
            const s = String(symbol || '').trim().toUpperCase()
            if (!s) return res.status(400).json({ error: 'Symbol fehlt' })
            const knex = getKnex()
            // Doppelklick auf den Stern darf keine zweite Zeile anlegen.
            const vorhanden = await knex('hype_favoriten')
                .where({ symbol: s, chain: String(chain || '') }).first()
            if (vorhanden) return res.json(vorhanden)
            const [eingefuegt] = await knex('hype_favoriten').insert({
                symbol: s,
                name: String(name || '').slice(0, 120),
                chain: String(chain || ''),
                contractAddress: String(contractAddress || ''),
                pairAddress: String(pairAddress || ''),
                narrative: String(narrative || ''),
                /*
                 * Woher der Coin kommt. Der Wachhund braucht das: für einen
                 * Fund vom dezentralen Markt gibt es ein Handelspaar zum
                 * Nachschlagen, für ein Bitunix-Symbol nicht — die Datenwege
                 * sind verschieden, und ohne das Merkmal würde der eine still
                 * am anderen scheitern.
                 */
                quelle: quelle === 'coinradar' ? 'coinradar' : 'hype',
                erstelltAm: Date.now(),
            }).returning('id')
            const id = typeof eingefuegt === 'object' ? eingefuegt.id : eingefuegt
            res.json(await knex('hype_favoriten').where('id', id).first())
        } catch (e) {
            logWarn('hype-radar', `Favorit anlegen: ${e.message}`)
            res.status(500).json({ error: 'Favorit konnte nicht gespeichert werden' })
        }
    })

    app.delete('/api/hype-radar/favoriten/:id', async (req, res) => {
        try {
            const knex = getKnex()
            const id = Number(req.params.id)
            await knex('hype_favoriten').where('id', id).del()
            // Verwaiste Alarme sagen ohne ihren Favoriten nichts mehr aus.
            await knex('hype_alarme').where('favoritId', id).del()
            res.json({ ok: true })
        } catch (e) {
            res.status(500).json({ error: 'Favorit konnte nicht entfernt werden' })
        }
    })

    // Stumm: beobachten ja, melden nein.
    app.patch('/api/hype-radar/favoriten/:id', async (req, res) => {
        try {
            const stumm = req.body?.stumm ? 1 : 0
            await getKnex()('hype_favoriten').where('id', Number(req.params.id)).update({ stumm })
            res.json({ ok: true, stumm })
        } catch (e) {
            res.status(500).json({ error: 'Favorit konnte nicht geändert werden' })
        }
    })

    // ── Alarme ──────────────────────────────────────────────────────────
    app.get('/api/hype-radar/alarme', async (req, res) => {
        try {
            const knex = getKnex()
            let q = knex('hype_alarme as a')
                .leftJoin('hype_favoriten as f', 'f.id', 'a.favoritId')
                .select('a.*', 'f.symbol', 'f.chain')
                .orderBy('a.erstelltAm', 'desc')
                .limit(Math.min(200, Number(req.query.limit) || 50))
            if (req.query.ungelesen === '1') q = q.where('a.gelesen', 0)
            const zeilen = await q
            res.json(zeilen.map((z) => ({ ...z, daten: sicherParse(z.daten, {}) })))
        } catch (e) {
            res.status(500).json({ error: 'Alarme konnten nicht geladen werden' })
        }
    })

    app.patch('/api/hype-radar/alarme/gelesen', async (req, res) => {
        try {
            const knex = getKnex()
            const ids = req.body?.ids
            if (ids === 'alle') await knex('hype_alarme').update({ gelesen: 1 })
            else if (Array.isArray(ids) && ids.length) {
                await knex('hype_alarme').whereIn('id', ids.map(Number)).update({ gelesen: 1 })
            }
            res.json({ ok: true })
        } catch (e) {
            res.status(500).json({ error: 'Alarme konnten nicht markiert werden' })
        }
    })

    /*
     * Gelesen ist nicht dasselbe wie erledigt: ein abgearbeiteter Alarm soll
     * auch aus der Liste verschwinden dürfen. Ohne `ids` wird alles geleert —
     * dieselbe Form wie beim Markieren, damit die Route nicht neu zu lernen ist.
     */
    app.delete('/api/hype-radar/alarme', async (req, res) => {
        try {
            const knex = getKnex()
            const ids = req.body?.ids
            if (Array.isArray(ids) && ids.length) {
                await knex('hype_alarme').whereIn('id', ids.map(Number)).del()
            } else {
                await knex('hype_alarme').del()
            }
            res.json({ ok: true })
        } catch (e) {
            res.status(500).json({ error: 'Alarme konnten nicht gelöscht werden' })
        }
    })

    app.delete('/api/hype-radar/alarme/:id', async (req, res) => {
        try {
            await getKnex()('hype_alarme').where('id', Number(req.params.id)).del()
            res.json({ ok: true })
        } catch (e) {
            res.status(500).json({ error: 'Alarm konnte nicht gelöscht werden' })
        }
    })

    /*
     * Test-Knopf: eine harmlose Meldung über die ECHTEN Kanäle. Wer ntfy oder
     * den Home-Assistant-Webhook einrichtet, will sofort wissen, ob der Draht
     * steht — nicht erst beim ersten echten Absturz eines Coins.
     */
    app.post('/api/hype-radar/alarme/test', async (req, res) => {
        try {
            const einst = await leseEinstellungen()
            res.json(await testZustellung(einst))
        } catch (e) {
            res.status(500).json({ error: 'Test fehlgeschlagen' })
        }
    })

    /*
     * Livedaten zu einem Favoriten — für die Kachel-Detailansicht.
     *
     * Frisch von DexScreener (Preis, Liquidität, Volumen, Kauf/Verkauf) plus
     * die Börsenlistung und der letzte gespeicherte Prüfstand. 60 s
     * Zwischenspeicher je Vertrag: die Ansicht fragt beim Öffnen und dann im
     * Takt — jede Anfrage bis zur Fremdquelle durchzureichen hiesse, deren
     * Ratengrenze mit einem einzigen offenen Fenster zu belegen.
     */
    app.get('/api/hype-radar/live/:id', async (req, res) => {
        try {
            const knex = getKnex()
            const fav = await knex('hype_favoriten').where('id', Number(req.params.id)).first()
            if (!fav) return res.status(404).json({ error: 'Favorit nicht gefunden' })

            const schluessel = `live:${fav.contractAddress || fav.symbol}`
            const alt = liveCache.get(schluessel)
            if (alt && Date.now() - alt.ts < 60000) return res.json(alt.payload)

            /*
             * Börsenfavoriten gehen einen anderen Weg.
             *
             * Ein Coin-Radar-Favorit ist ein Bitunix-Symbol ohne
             * Vertragsadresse — der DEX-Detailpfad findet für ihn nichts und
             * lieferte eine leere Kachel. Der Wachhund hatte diesen zweiten
             * Weg schon, die Anzeige nicht.
             */
            if (fav.quelle === 'coinradar') {
                const payload = await boersenLive(knex, fav)
                liveCache.set(schluessel, { ts: Date.now(), payload })
                if (liveCache.size > 200) liveCache.delete(liveCache.keys().next().value)
                return res.json(payload)
            }

            const [details, listen, letzter] = await Promise.all([
                fav.contractAddress ? dexDetails(fav.contractAddress).catch(() => null) : null,
                ladeListungen(),
                knex('hype_candidates')
                    .where({ symbol: fav.symbol, chain: fav.chain })
                    .orderBy('erstelltAm', 'desc').first(),
            ])
            const listung = pruefeListung(fav.symbol, listen)

            const payload = {
                favorit: fav,
                stand: Date.now(),
                markt: details?.markt || null,
                dexUrl: details?.url || '',
                listungen: listung.liste,
                listungUnbekannt: listung.unbekannt,
                // Der letzte Prüfstand aus dem Lauf — Noten sind keine Livedaten,
                // sie stammen aus der letzten Prüfung und werden so beschriftet.
                letzterLauf: letzter ? {
                    hypeScore: letzter.hypeScore,
                    safetyScore: letzter.safetyScore,
                    status: letzter.status,
                    verworfenGrund: letzter.verworfenGrund,
                    erstelltAm: Number(letzter.erstelltAm),
                    hinweise: sicherParse(letzter.sicherheitsDaten, {})?.hinweise || [],
                } : null,
            }
            liveCache.set(schluessel, { ts: Date.now(), payload })
            // Deckel gegen Anwachsen über Monate
            if (liveCache.size > 200) liveCache.delete(liveCache.keys().next().value)
            res.json(payload)
        } catch (e) {
            logWarn('hype-radar', `Livedaten: ${e.message}`)
            res.status(500).json({ error: 'Livedaten konnten nicht geladen werden' })
        }
    })

    // ── Lauf ────────────────────────────────────────────────────────────
    app.post('/api/hype-radar/scan', (req, res) => laufRoute(req, res, false))
    app.post('/api/hype-radar/bericht', (req, res) => laufRoute(req, res, true))
}

/** 60-s-Zwischenspeicher der Livedaten, je Vertrag. */
const liveCache = new Map()

/**
 * Livedaten eines Börsenfavoriten (Coin-Radar).
 *
 * Dieselbe Form wie der DEX-Pfad, damit die Kachel nicht zwei Fassungen
 * braucht — nur eben aus Börsendaten: Preis und Umsatz aus dem marktweiten
 * Abruf, dazu die letzte Zeile aus der Coin-Radar-Rangliste als Prüfstand.
 * `liquiditaetUsd` bleibt bewusst leer statt auf 0 gesetzt: Ein Perp hat
 * keinen Liquiditätspool, und eine Null dort behauptete eine Messung.
 */
async function boersenLive(knex, fav) {
    const [{ jeSymbol }, letzte] = await Promise.all([
        holeMarktweit().catch(() => ({ jeSymbol: new Map() })),
        knex('coinradar_zeilen').where({ symbol: fav.symbol, status: 'bewertet' })
            .orderBy('id', 'desc').first().catch(() => null),
    ])
    const roh = jeSymbol.get(fav.symbol) || null

    return {
        favorit: fav,
        stand: Date.now(),
        boerse: true,
        markt: roh ? {
            preisUsd: roh.preis,
            aenderung24h: roh.preisAenderung24h,
            volumen24h: roh.umsatz24h,
            spreadBp: roh.spreadBp,
            fundingJahresRate: fundingJahresRate(roh.fundingRate, roh.fundingIntervallH),
            transaktionen24h: roh.trades24h,
            dex: 'bitunix',
        } : null,
        dexUrl: '',
        listungen: [], listungUnbekannt: false,
        letzterLauf: letzte ? {
            hypeScore: letzte.note,
            safetyScore: null,
            status: 'bewertet',
            verworfenGrund: '',
            erstelltAm: Number(letzte.erstelltAm),
            hinweise: sicherParse(letzte.jeZeiteinheit, {})?.hinweise || [],
            rang: letzte.rang,
            atrPct: letzte.atrPct, rvol: letzte.rvol, adx: letzte.adx,
        } : null,
    }
}

/** Beide Lauf-Routen unterscheiden sich nur darin, ob Stufe 4 mitläuft. */
async function laufRoute(req, res, mitBericht) {
    if (laufAktiv) {
        return res.status(429).json({ error: 'Es läuft bereits ein Durchgang. Bitte warten.' })
    }

    let einst
    try {
        einst = await leseEinstellungen()
    } catch (e) {
        return res.status(500).json({ error: 'Einstellungen nicht lesbar' })
    }

    if (mitBericht) {
        const fehlt = await fehlendeSchluessel(einst)
        if (fehlt.length) {
            return res.status(400).json({
                error: `Für den Bericht fehlen Zugangsdaten: ${fehlt.join(', ')}. `
                    + 'Bitte in den KI-Einstellungen hinterlegen.',
            })
        }
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
    try {
        sende({ type: 'start', mitBericht })
        const melde = (stand) => sende({ type: 'fortschritt', ...stand })

        if (mitBericht) {
            const { id, bericht, quellenStand } = await scanneUndBerichte(einst, melde, 'manuell')
            sende({ type: 'fertig', berichtId: id, bericht, quellenStand })
        } else {
            const { bestanden, verworfen, quellenStand } = await scanne(einst, melde)
            sende({
                type: 'fertig',
                bestanden: bestanden.length,
                verworfen: verworfen.length,
                quellenStand,
            })
        }
    } catch (e) {
        logWarn('hype-radar', `Lauf fehlgeschlagen: ${e.message}`)
        sende({ type: 'fehler', fehler: e.message })
    } finally {
        laufAktiv = false
        res.end()
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
 * Wie überall im Haus: ein kurzer Takt, der selbst entscheidet, ob Arbeit
 * ansteht, plus ein Anspruch in der Datenbank gegen den zweiten Rechner. Ohne
 * den liefe der Lauf auf NAS und Entwicklungsrechner doppelt — bei einem
 * Vorgang, der ein Sprachmodell bezahlt, wäre das direkt spürbar.
 */
export function startHypeTakt() {
    const TAKT_MS = 10 * 60 * 1000

    const uhr = setInterval(async () => {
        try {
            const einst = await leseEinstellungen()
            if (!einst.aktiv) return

            const stunden = Math.max(1, Number(einst.intervallStunden) || 6)
            if (!(await beansprucheAufgabe(ANSPRUCH, stunden * 3600 * 1000))) return

            if (laufAktiv) return
            const fehlt = await fehlendeSchluessel(einst)
            if (fehlt.length) {
                await meldeFehler(ANSPRUCH, `Zugangsdaten fehlen: ${fehlt.join(', ')}`)
                return
            }

            laufAktiv = true
            try {
                const { id } = await scanneUndBerichte(einst, () => {}, 'auto')
                console.log(` -> Hype-Radar: Bericht ${id} erstellt`)
            } finally {
                laufAktiv = false
            }
        } catch (e) {
            logWarn('hype-radar', `Zeitplan: ${e.message}`)
            await meldeFehler(ANSPRUCH, e.message).catch(() => {})
        }
    }, TAKT_MS)

    // Der Takt darf den Prozess nicht am Beenden hindern.
    uhr.unref?.()
    return () => clearInterval(uhr)
}

/**
 * Der Wachhund-Takt — getrennt vom Scan-Takt.
 *
 * Beobachtung braucht Frische (Viertelstunden), Berichte brauchen sie nicht
 * (Stunden). Ein gemeinsamer Takt müsste sich für eine der beiden Fristen
 * entscheiden und wäre für die andere falsch. Der DB-Anspruch verhindert wie
 * überall den Doppellauf von NAS und Entwicklungsrechner — doppelt getaktete
 * Alarme wären doppelt zugestellte Alarme.
 */
export function startWachhundTakt() {
    const TAKT_MS = 5 * 60 * 1000
    let laeuft = false

    const uhr = setInterval(async () => {
        if (laeuft) return
        try {
            const einst = await leseEinstellungen()
            const minuten = Math.max(5, Number(einst.wachhundIntervallMin) || 15)
            if (!(await beansprucheAufgabe('hype_wachhund', minuten * 60 * 1000))) return

            laeuft = true
            try {
                const { geprueft, ausgeloest } = await wachhundLauf()
                if (ausgeloest) console.log(` -> Hype-Wachhund: ${ausgeloest} Alarm(e) bei ${geprueft} Favoriten`)
            } finally {
                laeuft = false
            }
        } catch (e) {
            laeuft = false
            logWarn('hype-radar', `Wachhund-Takt: ${e.message}`)
            await meldeFehler('hype_wachhund', e.message).catch(() => {})
        }
    }, TAKT_MS)

    uhr.unref?.()
    return () => clearInterval(uhr)
}
