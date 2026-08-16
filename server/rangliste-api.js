/**
 * Coin-Rangliste — Routen und Hintergrundtakt.
 *
 * Ein Lauf dauert Minuten. Deshalb hängt er NICHT an einer offenen Anfrage:
 * die Route legt ihn nur an, ein Takt im Hintergrund arbeitet ihn ab, und der
 * Browser fragt den Fortschritt ab. Ein Seitenwechsel oder ein Neuladen darf
 * zehn Minuten Arbeit nicht töten — genau das wäre bei einem Ereignisstrom
 * passiert (vgl. `req.on('close')` in `ai-models.js`).
 *
 * Der gesamte Zustand liegt in der Datenbank. Das ist nicht Bequemlichkeit,
 * sondern die Wiederaufnahme: `unique(laufId, symbol)` in `rangliste_zeilen`
 * macht „was fehlt noch?" zur Frage „welches Symbol hat keine Zeile". Stirbt
 * der Prozess mitten im Lauf, nimmt der nächste Takt genau dort wieder auf —
 * ohne eine einzige Sonderbehandlung.
 *
 * Gleichzeitigkeit zweistufig, wie in der Strategie-Engine:
 *   1. prozesslokal `laufAktiv` gegen den eigenen überholenden Takt
 *   2. `beansprucheFuehrung` gegen den ANDEREN Prozess — NAS-Container und
 *      Entwicklungsrechner teilen sich dieselbe PostgreSQL, und zwei Läufe
 *      gleichzeitig würden dasselbe Gewichtsbudget bei Binance verbrennen.
 */

import { getKnex } from './database.js'
import { logError, logWarn } from './logger.js'
import { getStrategy, validateParams, validateRisk } from './strategies/index.js'
import { isValidTimeframe } from './market-data.js'
import { schaetzeKerzen, MAX_BACKTEST_CANDLES } from './strategy-backtest.js'
import { beansprucheFuehrung, verlaengereFuehrung, gibFuehrungFrei, INSTANZ_ID } from './db-claim.js'
import { loeseUniversumAuf, quellenUebersicht, normalisiereSymbole, UNIVERSUM_ARTEN } from './coin-universum.js'
import { leiteZeiteinheitAb } from './rangliste-zeiteinheit.js'
import { bearbeiteCoin, schaetzeAufwand } from './rangliste-lauf.js'
import { vergibRaenge, beurteileRangliste, ranglisteSatz } from './rangliste-rang.js'
import { eigenerVerbrauch, gemeldeterVerbrauch, pausiertBis } from './binance-takt.js'
import { schlageUniversumVor } from './rangliste-ki.js'

const FUEHRUNG_KEY = 'rangliste_lauf'
const FUEHRUNG_TTL_MS = 90000
const TAKT_MS = 30000
/** Obergrenze je Lauf — jenseits davon wird die Wartezeit unzumutbar. */
const MAX_COINS = 300

let laufAktiv = false
let taktTimer = null

const jetzt = () => Date.now()
const parse = (roh, vorgabe) => {
    if (roh === null || roh === undefined) return vorgabe
    if (typeof roh === 'object') return roh
    try { return JSON.parse(roh) ?? vorgabe } catch { return vorgabe }
}

/** Der globale Hebeldeckel — derselbe, den die Engine in jeder Betriebsart anwendet. */
async function hebelDeckel() {
    try {
        const s = await getKnex()('settings').select('strategyMaxLeverage').where('id', 1).first()
        return Number(s?.strategyMaxLeverage) || 10
    } catch {
        logWarn('rangliste', 'Hebeldeckel nicht lesbar — Lauf rechnet ungekappt')
        return 0
    }
}

/** Lauf-Zeile aus der DB in die Form bringen, die `bearbeiteCoin` erwartet. */
function alsLauf(zeile) {
    return {
        ...zeile,
        symbole: parse(zeile.symbole, []),
        params: parse(zeile.params, {}),
        risk: parse(zeile.risk, {}),
    }
}

// ── Der Takt ─────────────────────────────────────────────────────────────

/**
 * Einen Lauf abarbeiten — Coin für Coin, jeder sofort gesichert.
 *
 * Nach JEDEM Coin passieren drei Dinge: die Zeile wird geschrieben, die Führung
 * verlängert und der Abbruchwunsch neu gelesen. Ohne das Verlängern übernähme
 * mitten im Lauf ein anderer Prozess, und ohne das Nachlesen wäre der
 * Abbruch-Knopf eine Attrappe.
 */
async function verarbeiteLauf(zeile) {
    const knex = getKnex()
    const lauf = alsLauf(zeile)
    const alle = lauf.symbole

    await knex('rangliste_laeufe').where('id', lauf.id).update({
        status: 'laeuft',
        gehaltenVon: INSTANZ_ID,
        gestartetAm: lauf.gestartetAm || jetzt(),
        gesamt: alle.length,
        letzterFehler: '',
    })

    // Wiederaufnahme: was fehlt, ist genau das, was keine Zeile hat.
    const fertig = new Set((await knex('rangliste_zeilen')
        .where('laufId', lauf.id).select('symbol')).map((r) => r.symbol))
    const rest = alle.filter((s) => !fertig.has(s))

    for (const symbol of rest) {
        const stand = await knex('rangliste_laeufe').where('id', lauf.id)
            .select('abbruchGewuenscht').first()
        if (stand?.abbruchGewuenscht) {
            await knex('rangliste_laeufe').where('id', lauf.id).update({
                status: 'abgebrochen', beendetAm: jetzt(), gehaltenVon: '',
            })
            return
        }

        let ergebnis
        try {
            ergebnis = await bearbeiteCoin(lauf, symbol)
        } catch (e) {
            // Ein einzelner Coin darf den Lauf nicht mitreissen.
            ergebnis = { symbol, klasse: 'fehler', fehler: String(e?.message || e).slice(0, 300) }
        }

        await knex('rangliste_zeilen')
            .insert({
                laufId: lauf.id,
                symbol: ergebnis.symbol,
                klasse: ergebnis.klasse || '',
                rangA: 0,
                aTrades: ergebnis.aTrades || 0,
                aWinRate: ergebnis.aWinRate || 0,
                aExpectancyR: ergebnis.aExpectancyR || 0,
                aOhneTopR: ergebnis.aOhneTopR || 0,
                aProfitFactor: ergebnis.aProfitFactor ?? null,
                aReturnPct: ergebnis.aReturnPct || 0,
                aMaxDdPct: ergebnis.aMaxDdPct || 0,
                bTrades: ergebnis.bTrades || 0,
                bWinRate: ergebnis.bWinRate || 0,
                bExpectancyR: ergebnis.bExpectancyR || 0,
                bOhneTopR: ergebnis.bOhneTopR || 0,
                bProfitFactor: ergebnis.bProfitFactor ?? null,
                bReturnPct: ergebnis.bReturnPct || 0,
                bMaxDdPct: ergebnis.bMaxDdPct || 0,
                bestaetigt: ergebnis.bestaetigt || 0,
                kerzen: ergebnis.kerzen || 0,
                abdeckungPct: ergebnis.abdeckungPct || 0,
                fehlend: JSON.stringify(ergebnis.fehlend || []),
                historieAb: ergebnis.historieAb || 0,
                handelbar: ergebnis.handelbar === false ? 0 : 1,
                bitunixMaxLeverage: ergebnis.bitunixMaxLeverage || 0,
                rReiheA: JSON.stringify(ergebnis.rReiheA || []),
                fehler: ergebnis.fehler || '',
                dauerMs: ergebnis.dauerMs || 0,
                createdAt: jetzt(),
            })
            // Idempotent: ein zweiter Durchgang über denselben Coin überschreibt
            // sauber, statt an der Eindeutigkeit zu scheitern.
            .onConflict(['laufId', 'symbol']).merge()

        await knex('rangliste_laeufe').where('id', lauf.id).update({
            fortschritt: fertig.size + rest.indexOf(symbol) + 1,
            gewichtGesamt: eigenerVerbrauch(),
            status: pausiertBis() ? 'pausiert' : 'laeuft',
        })

        if (!(await verlaengereFuehrung(FUEHRUNG_KEY))) {
            logWarn('rangliste', `Führung verloren — Lauf ${lauf.id} wird später fortgesetzt`)
            return
        }
    }

    await schliesseLaufAb(lauf.id)
}

/**
 * Rang vergeben und beurteilen — einmal, wenn alle Coins durch sind.
 * Die Beurteilung wandert in den Lauf und ändert sich danach nicht mehr: ein
 * Ergebnis, das sich beim zweiten Öffnen anders liest, wäre wertlos.
 */
async function schliesseLaufAb(laufId) {
    const knex = getKnex()
    const roh = await knex('rangliste_zeilen').where('laufId', laufId)
    const zeilen = roh.map((z) => ({ ...z, rReiheA: parse(z.rReiheA, []) }))

    vergibRaenge(zeilen)
    for (const z of zeilen) {
        if (z.rangA !== roh.find((r) => r.id === z.id)?.rangA) {
            await knex('rangliste_zeilen').where('id', z.id).update({ rangA: z.rangA })
        }
    }

    const beurteilung = beurteileRangliste(zeilen)
    await knex('rangliste_laeufe').where('id', laufId).update({
        status: 'fertig',
        beendetAm: jetzt(),
        gehaltenVon: '',
        nullverteilung: JSON.stringify({ ...beurteilung, satz: ranglisteSatz(beurteilung) }),
    })
}

async function takt() {
    if (laufAktiv) return
    laufAktiv = true
    let hatFuehrung = false
    try {
        const knex = getKnex()
        const offen = await knex('rangliste_laeufe')
            .whereIn('status', ['wartet', 'laeuft', 'pausiert'])
            .orderBy('id', 'asc').first()
        if (!offen) return

        // Führung erst holen, wenn es wirklich Arbeit gibt — sonst hielte ein
        // Prozess sie dauerhaft, ohne je etwas zu tun.
        hatFuehrung = await beansprucheFuehrung(FUEHRUNG_KEY, FUEHRUNG_TTL_MS)
        if (!hatFuehrung) return

        await verarbeiteLauf(offen)
    } catch (e) {
        logError('rangliste', 'Takt fehlgeschlagen', e)
    } finally {
        if (hatFuehrung) await gibFuehrungFrei(FUEHRUNG_KEY).catch(() => {})
        laufAktiv = false
    }
}

export function startRanglisteTakt() {
    if (taktTimer) return
    taktTimer = setInterval(() => { takt().catch(() => {}) }, TAKT_MS)
    // Der Takt darf den Prozess nicht am Beenden hindern.
    if (typeof taktTimer.unref === 'function') taktTimer.unref()
    console.log(` -> Coin-Rangliste bereit (Takt ${TAKT_MS / 1000}s)`)
}

export function stopRanglisteTakt() {
    if (taktTimer) { clearInterval(taktTimer); taktTimer = null }
}

// ── Routen ───────────────────────────────────────────────────────────────

export function setupRanglisteRoutes(app) {
    const knex = () => getKnex()

    // ── Universen ────────────────────────────────────────────────────────

    app.get('/api/rangliste/universen', async (req, res) => {
        try {
            res.json(await knex()('coin_universen').orderBy('id', 'desc'))
        } catch (e) {
            logError('rangliste', 'Universen laden fehlgeschlagen', e)
            res.status(500).json({ error: 'Universen konnten nicht geladen werden' })
        }
    })

    /** Die drei Zahlen über der Auswahl — auch der schnellste Weg zu sehen, ob beide Börsen antworten. */
    app.get('/api/rangliste/universen/quellen', async (req, res) => {
        try {
            res.json(await quellenUebersicht())
        } catch (e) {
            logError('rangliste', 'Quellen nicht abrufbar', e)
            res.status(502).json({ error: `Börsenlisten nicht abrufbar: ${e.message}` })
        }
    })

    app.post('/api/rangliste/universen', async (req, res) => {
        try {
            const b = req.body || {}
            const art = String(b.art || 'manuell')
            if (!UNIVERSUM_ARTEN.includes(art)) return res.status(400).json({ error: 'Unbekannte Art' })
            const { symbole } = normalisiereSymbole(b.symbole)
            const [id] = await knex()('coin_universen').insert({
                name: String(b.name || '').slice(0, 120) || art,
                art,
                n: Math.max(0, Math.min(250, Number(b.n) || 0)),
                symbole: JSON.stringify(symbole),
                thema: String(b.thema || '').slice(0, 120),
                begruendung: String(b.begruendung || '').slice(0, 2000),
                provider: String(b.provider || '').slice(0, 60),
                modell: String(b.modell || '').slice(0, 120),
                kostenUsd: Number(b.kostenUsd) || 0,
                nurHandelbar: b.nurHandelbar === false || b.nurHandelbar === 0 ? 0 : 1,
                createdAt: jetzt(), updatedAt: jetzt(),
            }).returning('id')
            res.json({ ok: true, id: typeof id === 'object' ? id.id : id })
        } catch (e) {
            logError('rangliste', 'Universum anlegen fehlgeschlagen', e)
            res.status(500).json({ error: 'Universum konnte nicht angelegt werden' })
        }
    })

    app.put('/api/rangliste/universen/:id', async (req, res) => {
        try {
            const b = req.body || {}
            const feld = { updatedAt: jetzt() }
            if (b.name !== undefined) feld.name = String(b.name).slice(0, 120)
            if (b.n !== undefined) feld.n = Math.max(0, Math.min(250, Number(b.n) || 0))
            if (b.symbole !== undefined) feld.symbole = JSON.stringify(normalisiereSymbole(b.symbole).symbole)
            if (b.nurHandelbar !== undefined) feld.nurHandelbar = b.nurHandelbar ? 1 : 0
            const n = await knex()('coin_universen').where('id', req.params.id).update(feld)
            if (!n) return res.status(404).json({ error: 'Universum nicht gefunden' })
            res.json({ ok: true })
        } catch (e) {
            logError('rangliste', 'Universum ändern fehlgeschlagen', e)
            res.status(500).json({ error: 'Universum konnte nicht geändert werden' })
        }
    })

    app.delete('/api/rangliste/universen/:id', async (req, res) => {
        try {
            await knex()('coin_universen').where('id', req.params.id).del()
            res.json({ ok: true })
        } catch (e) {
            logError('rangliste', 'Universum löschen fehlgeschlagen', e)
            res.status(500).json({ error: 'Universum konnte nicht gelöscht werden' })
        }
    })

    /** Auflösen ohne zu starten — zeigt vorher, wie viele Coins wirklich laufen. */
    app.post('/api/rangliste/universen/aufloesen', async (req, res) => {
        try {
            const aufgeloest = await loeseUniversumAuf(req.body || {})
            res.json({
                anzahl: aufgeloest.symbole.length,
                symbole: aufgeloest.symbole.slice(0, 400),
                ohneHistorie: aufgeloest.ohneHistorie,
                ohneMarkt: aufgeloest.ohneMarkt,
                nichtHandelbar: aufgeloest.nichtHandelbar,
                ungueltig: aufgeloest.ungueltig,
            })
        } catch (e) {
            res.status(400).json({ error: e.message })
        }
    })

    /**
     * Themenliste von der KI vorschlagen lassen.
     * Das Ergebnis wird NICHT automatisch gespeichert — der Nutzer sieht erst,
     * was vorgeschlagen und was verworfen wurde, und entscheidet dann.
     */
    app.post('/api/rangliste/ki-vorschlag', async (req, res) => {
        try {
            const b = req.body || {}
            res.json(await schlageUniversumVor(b.thema, {
                provider: b.provider, modell: b.modell,
            }))
        } catch (e) {
            logError('rangliste', 'KI-Vorschlag fehlgeschlagen', e)
            res.status(500).json({ error: e.message })
        }
    })

    // ── Zeiteinheit-Vorschlag ────────────────────────────────────────────

    app.get('/api/rangliste/zeiteinheit', async (req, res) => {
        try {
            const strategyId = String(req.query.strategyId || '')
            const tage = Math.max(14, Math.min(720, Number(req.query.tage) || 360))
            const toTs = Date.now()
            const fromTs = toTs - tage * 86400000
            const [backtests, instanzen] = await Promise.all([
                knex()('strategy_backtests').where('strategyId', strategyId)
                    .select('timeframe', 'entscheidung', 'stats'),
                knex()('strategy_instances').where('strategyId', strategyId)
                    .select('timeframe', 'timeframes'),
            ])
            res.json(leiteZeiteinheitAb(strategyId, {
                fromTs, toTs, backtests,
                instanzen: instanzen.map((i) => ({ ...i, timeframes: parse(i.timeframes, []) })),
            }))
        } catch (e) {
            logError('rangliste', 'Zeiteinheit-Vorschlag fehlgeschlagen', e)
            res.status(500).json({ error: 'Vorschlag konnte nicht berechnet werden' })
        }
    })

    // ── Läufe ────────────────────────────────────────────────────────────

    app.post('/api/rangliste/laeufe', async (req, res) => {
        try {
            const b = req.body || {}
            const strategie = getStrategy(b.strategyId)
            if (!strategie) return res.status(400).json({ error: 'Unbekannte Strategie' })
            if (!isValidTimeframe(b.timeframe)) return res.status(400).json({ error: 'Ungültige Zeiteinheit' })
            if (!strategie.supportedTimeframes.includes(b.timeframe)) {
                return res.status(400).json({ error: `${strategie.name} unterstützt ${b.timeframe} nicht` })
            }

            const toTs = Number(b.toTs) || Date.now()
            const tage = Math.max(14, Math.min(720, Number(b.tage) || 360))
            const fromTs = Number(b.fromTs) || (toTs - tage * 86400000)
            if (fromTs >= toTs) return res.status(400).json({ error: 'Zeitraum ist leer' })

            // Derselbe Deckel wie im Backtest — mit Vorlauf, weil der Abruf ihn
            // mitbringen muss.
            const kerzen = schaetzeKerzen(fromTs, toTs, b.timeframe) + (strategie.warmupCandles || 200)
            if (kerzen > MAX_BACKTEST_CANDLES) {
                return res.status(400).json({
                    error: `Zeitraum zu gross für ${b.timeframe}: ~${kerzen} Kerzen je Coin, erlaubt sind ${MAX_BACKTEST_CANDLES}`,
                })
            }

            // Es läuft immer nur EINE Rangliste — sonst teilen sich zwei Läufe
            // dasselbe Binance-Budget und beide werden langsam.
            const laeuft = await knex()('rangliste_laeufe')
                .whereIn('status', ['wartet', 'laeuft', 'pausiert']).first()
            if (laeuft) {
                return res.status(429).json({
                    error: `Es läuft bereits eine Rangliste (${laeuft.universumName || laeuft.strategyId}, `
                        + `Coin ${laeuft.fortschritt} von ${laeuft.gesamt}).`,
                    laufId: laeuft.id,
                })
            }

            const universum = b.universumId
                ? await knex()('coin_universen').where('id', b.universumId).first()
                : { art: b.art || 'manuell', n: b.n, symbole: b.symbole, nurHandelbar: b.nurHandelbar, name: b.name }
            if (!universum) return res.status(400).json({ error: 'Universum nicht gefunden' })

            const aufgeloest = await loeseUniversumAuf({
                ...universum, symbole: parse(universum.symbole, universum.symbole),
            })
            if (!aufgeloest.symbole.length) {
                return res.status(400).json({ error: 'Kein einziger Coin dieses Universums ist testbar' })
            }
            const symbole = aufgeloest.symbole.slice(0, MAX_COINS)

            const { values: params } = validateParams(b.strategyId, b.params || {})
            const { values: risk } = validateRisk(b.risk || {})

            const [id] = await knex()('rangliste_laeufe').insert({
                strategyId: b.strategyId,
                instanceId: Number(b.instanceId) || 0,
                ruleVersion: Number(b.ruleVersion) || 0,
                universumId: Number(b.universumId) || 0,
                universumName: String(universum.name || universum.art || '').slice(0, 120),
                symbole: JSON.stringify(symbole),
                timeframe: b.timeframe,
                timeframeQuelle: String(b.timeframeQuelle || 'hand').slice(0, 30),
                timeframeBegruendung: String(b.timeframeBegruendung || '').slice(0, 1000),
                market: b.market === 'spot' ? 'spot' : 'futures',
                fromTs, mitteTs: Math.floor((fromTs + toTs) / 2), toTs,
                params: JSON.stringify(params),
                risk: JSON.stringify(risk),
                maxLeverage: await hebelDeckel(),
                startEquity: Number(b.startEquity) || 1000,
                status: 'wartet',
                gesamt: symbole.length,
                createdAt: jetzt(),
            }).returning('id')

            const laufId = typeof id === 'object' ? id.id : id
            // Nicht auf den nächsten Takt warten — der Nutzer hat gerade geklickt.
            takt().catch(() => {})
            res.json({
                ok: true, laufId, anzahl: symbole.length,
                aufwand: schaetzeAufwand({
                    strategyId: b.strategyId, timeframe: b.timeframe,
                    fromTs, toTs, anzahlCoins: symbole.length,
                }),
                ohneHistorie: aufgeloest.ohneHistorie.length,
                nichtHandelbar: aufgeloest.nichtHandelbar.length,
            })
        } catch (e) {
            logError('rangliste', 'Lauf anlegen fehlgeschlagen', e)
            res.status(500).json({ error: `Lauf konnte nicht angelegt werden: ${e.message}` })
        }
    })

    app.get('/api/rangliste/laeufe', async (req, res) => {
        try {
            const rows = await knex()('rangliste_laeufe')
                .select('id', 'strategyId', 'universumName', 'timeframe', 'fromTs', 'toTs',
                    'status', 'fortschritt', 'gesamt', 'gestartetAm', 'beendetAm', 'createdAt')
                .orderBy('id', 'desc').limit(50)
            res.json(rows)
        } catch (e) {
            logError('rangliste', 'Läufe laden fehlgeschlagen', e)
            res.status(500).json({ error: 'Läufe konnten nicht geladen werden' })
        }
    })

    /** Kopf und Fortschritt — das Ziel des Pollings. */
    app.get('/api/rangliste/laeufe/:id', async (req, res) => {
        try {
            const row = await knex()('rangliste_laeufe').where('id', req.params.id).first()
            if (!row) return res.status(404).json({ error: 'Lauf nicht gefunden' })
            res.json({
                ...row,
                symbole: parse(row.symbole, []),
                params: parse(row.params, {}),
                risk: parse(row.risk, {}),
                nullverteilung: parse(row.nullverteilung, null),
                // Was die Bremse gerade macht — sonst sieht ein pausierter Lauf
                // aus wie ein hängender.
                takt: { eigen: eigenerVerbrauch(), ip: gemeldeterVerbrauch(), pausiertBis: pausiertBis() },
            })
        } catch (e) {
            logError('rangliste', 'Lauf laden fehlgeschlagen', e)
            res.status(500).json({ error: 'Lauf konnte nicht geladen werden' })
        }
    })

    app.get('/api/rangliste/laeufe/:id/zeilen', async (req, res) => {
        try {
            let q = knex()('rangliste_zeilen').where('laufId', req.params.id)
            if (req.query.klasse) q = q.whereIn('klasse', String(req.query.klasse).split(','))
            const rows = await q
            // Belastbare nach Rang, alles andere nach dem Erwartungswert der
            // Rang-Hälfte — auch unter der Trennlinie soll eine Ordnung sein.
            rows.sort((a, b) => (a.rangA || 9999) - (b.rangA || 9999)
                || Number(b.aOhneTopR) - Number(a.aOhneTopR))
            res.json(rows.map((r) => ({ ...r, fehlend: parse(r.fehlend, []), rReiheA: undefined })))
        } catch (e) {
            logError('rangliste', 'Zeilen laden fehlgeschlagen', e)
            res.status(500).json({ error: 'Zeilen konnten nicht geladen werden' })
        }
    })

    app.post('/api/rangliste/laeufe/:id/abbrechen', async (req, res) => {
        try {
            const n = await knex()('rangliste_laeufe').where('id', req.params.id)
                .whereIn('status', ['wartet', 'laeuft', 'pausiert'])
                .update({ abbruchGewuenscht: 1 })
            if (!n) return res.status(409).json({ error: 'Dieser Lauf läuft nicht' })
            // Die Schleife liest den Wunsch nach dem laufenden Coin — die
            // bereits gerechneten Zeilen bleiben erhalten.
            res.json({ ok: true })
        } catch (e) {
            logError('rangliste', 'Abbruch fehlgeschlagen', e)
            res.status(500).json({ error: 'Abbruch fehlgeschlagen' })
        }
    })

    app.delete('/api/rangliste/laeufe/:id', async (req, res) => {
        try {
            await knex()('rangliste_zeilen').where('laufId', req.params.id).del()
            await knex()('rangliste_laeufe').where('id', req.params.id).del()
            res.json({ ok: true })
        } catch (e) {
            logError('rangliste', 'Löschen fehlgeschlagen', e)
            res.status(500).json({ error: 'Lauf konnte nicht gelöscht werden' })
        }
    })
}
