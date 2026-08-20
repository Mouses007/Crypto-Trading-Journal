/**
 * Endpunkte des Live-Trading-Fensters.
 *
 * Vier Kacheln brauchen Daten, die es sonst nirgends gibt:
 *
 *   /indizes           Intraday-Kerzen von ES, NQ und DXY (Yahoo, ohne Schlüssel)
 *   /kalender-countdown Nur die Termine der nächsten Stunden, mit Restzeit
 *   /liq-ticker        Liquidationen der letzten Minuten aus dem Arbeitsspeicher
 *   /session-stand     Offene Positionen und die P&L der laufenden Sitzung
 *
 * Alle liefern die Form `{stand, veraltet, hinweis?, …}` und laufen über
 * `ausCache` aus `marktradar-api.js` — damit teilen sich alle offenen Fenster
 * und alle Tabs denselben Abruf, und ein Ausfall der Fremdquelle liefert den
 * letzten bekannten Stand mit `veraltet: true` statt einer leeren Kachel.
 */

import { ausCache, sendeRadar, sendRadarError, holeJson, verwerfeCache } from './marktradar-api.js'
import { leseKalender } from './marktradar-kalender.js'
import { ohlcAusChart } from './makro.js'
import { lies as liesLiqTicker } from './liq-ticker.js'
import { getDecryptedConfig, getPendingPositions, getHistoryPositions } from './bitunix-api.js'
import { getKnex } from './database.js'
import { logWarn } from './logger.js'
import { berechneSitzung } from './sitzung-rechnung.js'

/**
 * Liest ALLE geschlossenen Positionen im Fenster, nicht nur die erste Seite.
 *
 * Bitunix liefert höchstens 100 je Aufruf. Ohne die Schleife war der
 * Sitzungsstand ab der 101. geschlossenen Position still falsch: die
 * Plan-Grenzen (Max-Verlust, Max-Trades) zählten zu wenig — bei einem aktiven
 * Scalper keine Randbedingung. Die Import-Pfade in bitunix-api.js paginieren
 * längst; dieser Leser hier war die einzige Stelle ohne.
 *
 * `holeSeite` ist injizierbar, damit der Selbsttest den Zusammenschnitt ohne
 * Netz füttern kann.
 */
export async function alleHistoryPositions(config, { startTime, endTime }, holeSeite) {
    const lade = holeSeite || ((skip, limit) => getHistoryPositions(
        config.apiKey, config.secretKey, { startTime, endTime, skip, limit },
    ))
    const alle = []
    const limit = 100
    let skip = 0
    for (;;) {
        const r = await lade(skip, limit)
        const seite = r?.data?.positionList || []
        alle.push(...seite)
        if (seite.length < limit) break
        skip += limit
        // Harte Kappe gegen Endlosschleifen (kaputte API, die immer volle
        // Seiten liefert): 2000 Positionen sind mehr als jede Sitzung.
        if (skip >= 2000) break
    }
    return alle
}

/**
 * Dieselben Ticker wie die Makro-Kachel — ES und NQ als FUTURES, nicht als
 * Kassa-Index: der Kassa-Index steht ausserhalb der Börsenzeiten still und war
 * in der ersten Fassung der Makro-Kachel zeitweise 62 Stunden alt.
 */
const MAERKTE = {
    sp500: { ticker: 'ES=F', name: 'S&P 500 (ES)' },
    nasdaq: { ticker: 'NQ=F', name: 'Nasdaq 100 (NQ)' },
    // Russell 2000: die Nebenwerte reagieren am stärksten auf Zins- und
    // Risikoerwartung — dreht RTY vor ES/NQ, ist es eine Risikobewegung
    // und keine Rotation innerhalb der grossen Werte.
    russell: { ticker: 'RTY=F', name: 'Russell 2000 (RTY)' },
    dxy: { ticker: 'DX-Y.NYB', name: 'US-Dollar-Index' },
}

const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart/'

/**
 * Zulässige Auflösungen. Yahoo begrenzt den Zeitraum je Auflösung (1m nur
 * wenige Tage); mehr Stufen bringen im Stundenfenster nichts.
 */
const INTERVALLE = new Set(['1m', '2m', '5m', '15m', '30m', '1h'])

/**
 * TTL 60 s — unabhängig davon, wie viele Fenster offen sind, fragt der Server
 * höchstens einmal pro Minute je Markt. Yahoo hat kein dokumentiertes Limit,
 * blockt aber aggressive Aufrufer; vier Anfragen pro Minute für den ganzen
 * Server sind unbedenklich.
 */
const INDIZES_TTL = 60 * 1000

async function holeIndizes(interval, range) {
    const eintraege = await Promise.all(Object.entries(MAERKTE).map(async ([id, m]) => {
        try {
            const url = `${YAHOO}${encodeURIComponent(m.ticker)}?range=${range}&interval=${interval}`
            const json = await holeJson(url)
            const daten = ohlcAusChart(json)
            return [id, { ...daten, ticker: m.ticker, name: daten.name || m.name }]
        } catch (e) {
            // Ein Markt darf die übrigen nicht mitnehmen
            logWarn('livetrading', `Indizes: ${m.ticker} fehlgeschlagen`, e.message)
            return [id, null]
        }
    }))

    const maerkte = Object.fromEntries(eintraege)
    const fehlend = Object.entries(maerkte).filter(([, v]) => !v).map(([k]) => k)
    if (fehlend.length === Object.keys(MAERKTE).length) {
        throw new Error('Kein Markt erreichbar')
    }
    return {
        interval,
        range,
        maerkte,
        hinweis: fehlend.length ? `Nicht erreichbar: ${fehlend.join(', ')}` : '',
    }
}

/** Countdown-Fenster: nur was in den nächsten Stunden kommt. */
async function holeKalenderCountdown(stunden, laender, impact) {
    const jetzt = Date.now()
    const daten = await leseKalender({
        // Eine Stunde zurück, damit ein Termin nicht in derselben Minute
        // verschwindet, in der er fällig war — die Zahlen kommen verzögert
        von: jetzt - 60 * 60 * 1000,
        bis: jetzt + stunden * 60 * 60 * 1000,
        laender,
        impact,
    })
    const ereignisse = (daten.ereignisse || []).map(e => ({
        ...e,
        inMs: e.dateUnix - jetzt,
        vorbei: e.dateUnix < jetzt,
    }))
    return {
        stunden,
        ereignisse,
        naechstes: ereignisse.find(e => !e.vorbei) || null,
        letzterAbruf: daten.letzterAbruf,
        letzterFehler: daten.letzterFehler,
        gesamtImZeitraum: daten.gesamtImZeitraum,
    }
}

export function setupLivetradingRoutes(app) {
    /**
     * Intraday-Kerzen. `force=1` umgeht den Cache — für den
     * „Alle aktualisieren"-Knopf.
     */
    app.get('/api/livetrading/indizes', async (req, res) => {
        try {
            const interval = INTERVALLE.has(String(req.query.interval)) ? String(req.query.interval) : '5m'
            // 1d deckt die laufende Sitzung; 5d ist die einzige sinnvolle
            // Erweiterung, alles darüber sprengt eine Kachel
            const range = req.query.range === '5d' ? '5d' : '1d'
            const key = `lt_indizes|${interval}|${range}`
            if (req.query.force) verwerfeCache(key)
            sendeRadar(res, await ausCache(key, INDIZES_TTL, () => holeIndizes(interval, range)))
        } catch (e) {
            sendRadarError(res, e, 'Indizes')
        }
    })

    /** Wirtschaftstermine der nächsten Stunden. */
    app.get('/api/livetrading/kalender-countdown', async (req, res) => {
        try {
            const stunden = Math.max(1, Math.min(48, Number(req.query.stunden) || 8))
            const knex = getKnex()
            const s = await knex('settings').where('id', 1).first().catch(() => null)
            const laender = req.query.laender ?? s?.radarKalenderLaender ?? 'USD,JPY'
            const impact = req.query.impact ?? s?.radarKalenderImpact ?? 'medium'
            const key = `lt_kalender|${stunden}|${laender}|${impact}`
            if (req.query.force) verwerfeCache(key)
            sendeRadar(res, await ausCache(key, 60 * 1000,
                () => holeKalenderCountdown(stunden, laender, impact)))
        } catch (e) {
            sendRadarError(res, e, 'Termine')
        }
    })

    /**
     * Liquidationen der letzten Minuten.
     *
     * Kommt aus dem Arbeitsspeicher (`liq-ticker.js`), nicht aus der Datenbank:
     * der Aufzeichner leert seinen Schreibpuffer nur alle 30 Sekunden, ein
     * DB-Abruf hinkte also nach. Die kurze TTL ist nur dafür da, dass mehrere
     * Tabs nicht jede Sekunde dieselbe Rechnung anstossen.
     */
    app.get('/api/livetrading/liq-ticker', async (req, res) => {
        try {
            const minuten = Math.max(1, Math.min(30, Number(req.query.minuten) || 15))
            const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : null
            const key = `lt_liq|${minuten}|${symbol || 'alle'}`
            if (req.query.force) verwerfeCache(key)
            const nutzlast = await ausCache(key, 2000, async () => {
                const knex = getKnex()
                const s = await knex('settings').where('id', 1).first().catch(() => null)
                return {
                    ...liesLiqTicker({ minuten, symbol }),
                    // Ohne den Sammelstrom liefert nur ein eigens aufgezeichnetes
                    // Symbol Ereignisse. Das muss die Kachel sagen können, sonst
                    // sieht ein abgeschalteter Schalter wie ein ruhiger Markt aus.
                    sammelstromAn: Number(s?.liveRecordAllLiq ?? 0) === 1,
                    aufzeichnungAn: Number(s?.liveRecordEnabled ?? 0) === 1,
                }
            })
            sendeRadar(res, nutzlast)
        } catch (e) {
            sendRadarError(res, e, 'Liquidations-Ticker')
        }
    })

    /**
     * Stand der laufenden Sitzung: offene Positionen, geschlossene im Fenster,
     * P&L und Plan-Fortschritt.
     *
     * Serverseitig gebündelt, damit die Kachel dumm bleibt und je Tab nur eine
     * beglaubigte Bitunix-Anfrage nötig ist.
     */
    app.get('/api/livetrading/session-stand', async (req, res) => {
        try {
            const von = Number(req.query.von)
            const bis = Number(req.query.bis) || Date.now()
            if (!Number.isFinite(von) || von <= 0) {
                return res.status(400).json({ error: 'von ist erforderlich (Zeitstempel in ms)' })
            }
            const plan = {
                planMaxVerlustUsd: Number(req.query.maxVerlust) || 0,
                planMaxTrades: Number(req.query.maxTrades) || 0,
            }

            // Der Plan gehört NICHT in den Cache-Schlüssel: er ändert nur, wie
            // dieselben Zahlen bewertet werden, und würde sonst bei jeder
            // Planänderung eine neue Bitunix-Anfrage auslösen.
            // KEIN Zeit-Eimer im Schlüssel: die 5-s-Frist von `ausCache` regelt
            // die Frische bereits. Ein rotierender Schlüssel legte alle 5 s
            // einen neuen Cache-Eintrag an (~720 je Stunde, mit Positionslisten
            // daran) und der Altstand-Rückfall fand nie einen Vorgänger — bei
            // einem Bitunix-Aussetzer flog der Fehler bis zur Kachel durch,
            // statt den letzten Stand mit `veraltet: true` zu zeigen.
            const key = `lt_session|${von}`
            const roh = await ausCache(key, 5000, async () => {
                const config = await getDecryptedConfig()
                if (!config?.apiKey || !config?.secretKey) {
                    return { offen: [], geschlossen: [], hinweis: 'Kein Bitunix-Schlüssel hinterlegt' }
                }

                const [offenRoh, histAlle] = await Promise.all([
                    getPendingPositions(config.apiKey, config.secretKey, {}),
                    /*
                     * BEWUSST `getHistoryPositions` und NICHT der Endpunkt
                     * /api/bitunix/recent-closed: der schreibt bei jedem Aufruf
                     * `bitunix_config.lastHistoryScan`. Ein Abruf im
                     * Sekundentakt würde das Import-Fenster ständig
                     * zurücksetzen und den Trade-Import stillschweigend
                     * sabotieren. Dieser Weg liest nur.
                     */
                    alleHistoryPositions(config, { startTime: von, endTime: bis }),
                ])

                const offen = Array.isArray(offenRoh?.data)
                    ? offenRoh.data
                    : (offenRoh?.data?.positionList || [])
                const geschlossen = histAlle
                    // Bitunix filtert den Zeitraum serverseitig; zur Sicherheit
                    // nachschneiden, damit ein Randfall nicht ins Ergebnis rutscht
                    .filter(p => {
                        const zu = Number(p.mtime)
                        return Number.isFinite(zu) && zu >= von && zu <= bis
                    })

                return { offen, geschlossen }
            })

            sendeRadar(res, { ...roh, ...berechneSitzung({ ...roh, ...plan }) })
        } catch (e) {
            sendRadarError(res, e, 'Sitzungsstand')
        }
    })

    console.log(' -> Live-Trading routes initialized')
}
