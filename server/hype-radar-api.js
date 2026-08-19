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
import { stufenNach, benoetigteAnbieter } from './hype-radar/stufen.js'
import { keySpalte } from './ai-models.js'

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

    // ── Lauf ────────────────────────────────────────────────────────────
    app.post('/api/hype-radar/scan', (req, res) => laufRoute(req, res, false))
    app.post('/api/hype-radar/bericht', (req, res) => laufRoute(req, res, true))
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
