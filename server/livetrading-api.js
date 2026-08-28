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
/*
 * `erwartetMin` ist die von Yahoo angegebene Verzögerung der jeweiligen Börse
 * (CME rund 10 Minuten, ICE rund 30). Sie dient NUR als Beschriftung und als
 * Schwelle — das tatsächliche Alter wird aus `regularMarketTime` gemessen, das
 * `ohlcAusChart` als `zeit` liefert. Eine Konstante als Alterswert auszugeben
 * wäre dieselbe Sorte Falschaussage, die diese Änderung beseitigen soll.
 */
const MAERKTE = {
    sp500: { ticker: 'ES=F', name: 'S&P 500 (ES)', erwartetMin: 10 },
    nasdaq: { ticker: 'NQ=F', name: 'Nasdaq 100 (NQ)', erwartetMin: 10 },
    // Russell 2000: die Nebenwerte reagieren am stärksten auf Zins- und
    // Risikoerwartung — dreht RTY vor ES/NQ, ist es eine Risikobewegung
    // und keine Rotation innerhalb der grossen Werte.
    russell: { ticker: 'RTY=F', name: 'Russell 2000 (RTY)', erwartetMin: 10 },
    dxy: { ticker: 'DX-Y.NYB', name: 'US-Dollar-Index', erwartetMin: 30 },
}

/**
 * Zuschlag auf die erwartete Verzögerung, ab dem die Kachel auf „veraltet"
 * geht. Ohne ihn stünde eine Quelle, die ihre 10 Minuten genau einhält, im
 * Sekundentakt zwischen grün und gelb.
 *
 * Ausserhalb der Handelszeiten läuft er ins Leere und das ist beabsichtigt:
 * Am Wochenende ist der letzte Kurs Stunden alt, und genau das soll die Kachel
 * dann auch sagen. Ein Feiertagskurs, der als frisch durchgeht, ist die
 * Falschaussage — nicht ein gelber Punkt am Sonntag.
 */
const ALTERS_RESERVE_MIN = 5

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

/**
 * Zeitraum, den wir bei Yahoo IMMER anfordern — unabhängig vom Fenster, das
 * die Kachel zeigt.
 *
 * `1d` war hier die naheliegende und falsche Wahl. Für einen Future meint
 * Yahoo damit die laufende reguläre Sitzung, und die hat um sechs Uhr früh
 * europäischer Zeit noch kaum begonnen: gemessen am 27.08.2026 lieferte
 * `NQ=F?range=1d&interval=5m` genau **10 Kerzen**, bei `15m` noch fünf. Auf
 * einer grossen Fläche standen dann fünf riesige Kerzen ohne jeden Bezug —
 * man sah eine Bewegung, konnte sie aber nicht einordnen.
 *
 * `5d` liefert an derselben Stelle 945 Kerzen und deckt damit auch die
 * Nachtsitzung ab, in der Krypto tatsächlich gehandelt wird. Beschnitten wird
 * danach hier, nicht bei Yahoo — ein Abruf bedient so jedes Fenster.
 */
const YAHOO_RANGE = '5d'

/** Fenster in Stunden: Vorgabe, Grenzen und Mindestzahl an Kerzen. */
const FENSTER_VORGABE_H = 12
const FENSTER_MAX_H = 120
const MIN_KERZEN = 12

/**
 * Kerzen auf das gewünschte Fenster kürzen.
 *
 * Arbeitet auf einer KOPIE: `roh` kommt aus dem Zwischenspeicher und wird von
 * parallelen Anfragen mit anderem Fenster mitbenutzt. Wer hier hineinschneidet,
 * kürzt sie allen.
 *
 * Bleiben weniger als `MIN_KERZEN` übrig, gelten stattdessen die letzten
 * `MIN_KERZEN` — ein Markt, der im Fenster gar nicht gehandelt hat (Feiertag,
 * Wochenende, ICE-Pause), soll seinen letzten bekannten Verlauf zeigen und
 * nicht eine leere Fläche.
 */
function beschneideFenster(roh, stunden) {
    const grenze = Date.now() - stunden * 60 * 60 * 1000
    const maerkte = {}
    for (const [id, m] of Object.entries(roh.maerkte || {})) {
        const alle = Array.isArray(m?.kerzen) ? m.kerzen : []
        const drin = alle.filter(k => k.t >= grenze)
        maerkte[id] = {
            ...m,
            kerzen: drin.length >= MIN_KERZEN ? drin : alle.slice(-MIN_KERZEN),
            // Was der Schnitt weggenommen hat, gehört angeschrieben: sonst
            // sieht ein zurückgefallenes Mindestfenster wie das gewählte aus.
            kerzenGesamt: alle.length,
            fensterVoll: drin.length >= MIN_KERZEN,
        }
    }
    return { maerkte }
}

async function holeIndizes(interval, range) {
    const eintraege = await Promise.all(Object.entries(MAERKTE).map(async ([id, m]) => {
        try {
            const url = `${YAHOO}${encodeURIComponent(m.ticker)}?range=${range}&interval=${interval}`
            const json = await holeJson(url)
            const daten = ohlcAusChart(json)
            /*
             * `quellenStand` ist ein ABSOLUTER Zeitstempel, kein Alter. Die
             * Antwort liegt bis zu `INDIZES_TTL` im Zwischenspeicher — ein hier
             * ausgerechnetes Alter wäre beim Ausliefern bis zu eine Minute zu
             * jung, und ausgerechnet die Zahl, die Frische behaupten soll,
             * würde selbst zu alt ausgeliefert. Gerechnet wird beim Senden.
             */
            const quellenStand = daten.zeit
                || (daten.kerzen.length ? daten.kerzen[daten.kerzen.length - 1].t : null)
            return [id, {
                ...daten,
                ticker: m.ticker,
                name: daten.name || m.name,
                quellenStand,
                erwartetMin: m.erwartetMin,
            }]
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

/**
 * Datenalter einer Indizes-Antwort BEIM SENDEN bestimmen.
 *
 * Rein und ohne Netz, damit prüfbar — Selbsttest in
 * `server/__selftest-livetrading-ohlc.mjs`.
 *
 * Warum das nicht in `holeIndizes` steht: die Antwort kommt aus dem
 * Zwischenspeicher. Alles, was mit `Date.now()` rechnet, muss deshalb hier
 * passieren, sonst altert die Altersangabe mit.
 *
 * Warum `stand` der ÄLTESTE Quellenstand ist und nicht der jüngste: Der
 * Kachelkopf zeigt eine Zahl für die ganze Kachel. Die darf nicht vom
 * frischesten Markt kommen — sonst verdeckt ein munterer ES einen DXY, der
 * seit einer halben Stunde steht. Der Kopf sagt, wie alt das ÄLTESTE ist, was
 * man da sieht.
 *
 * @param {object} nutzlast Ergebnis von `holeIndizes`
 * @param {number} [jetzt]  Bezugszeit (für den Selbsttest setzbar)
 * @returns {{stand:number|null, veraltet:boolean, maerkte:object}}
 */
export function altereIndizes(nutzlast, jetzt = Date.now()) {
    const maerkte = {}
    const staende = []
    let veraltet = false

    for (const [id, m] of Object.entries(nutzlast?.maerkte || {})) {
        if (!m) { maerkte[id] = m; continue }
        const quelle = Number(m.quellenStand)
        if (!Number.isFinite(quelle) || quelle <= 0) {
            // Kein Zeitstempel heisst UNBEKANNT, nicht „null Minuten alt".
            // `Number(null)` ergibt 0 und wäre hier die frischeste denkbare
            // Angabe — genau falsch herum.
            maerkte[id] = { ...m, alterMinuten: null }
            continue
        }
        const alter = Math.max(0, (jetzt - quelle) / 60000)
        const grenze = (Number(m.erwartetMin) || 0) + ALTERS_RESERVE_MIN
        if (alter > grenze) veraltet = true
        staende.push(quelle)
        maerkte[id] = { ...m, alterMinuten: Math.round(alter * 10) / 10 }
    }

    return {
        stand: staende.length ? Math.min(...staende) : null,
        veraltet,
        maerkte,
    }
}

/**
 * Positionen einer Sitzung von Bitunix holen — offen und im Fenster geschlossen.
 *
 * Herausgezogen, weil es **genau eine** Beschaffung geben muss: Der laufende
 * Stand (`/session-stand`) und der Abschluss (`/session-beenden`) rechnen sonst
 * dieselbe Zahl aus verschiedenen Quellen. Vor dieser Änderung war genau das
 * der Fall — die Kachel rechnete aus Bitunix, das Beenden aus bereits
 * importierten Journal-Trades. Ein verzögerter Import liess Live-Anzeige,
 * Planurteil und Archiv auseinanderlaufen, und nichts an der Oberfläche sagte,
 * welche der beiden Zahlen stimmt.
 *
 * @param {number} von Beginn in ms
 * @param {number} bis Ende in ms
 * @returns {Promise<{offen:Array, geschlossen:Array, hinweis?:string, ohneSchluessel?:boolean}>}
 */
async function holeSitzungsRohdaten(von, bis) {
    const config = await getDecryptedConfig()
    if (!config?.apiKey || !config?.secretKey) {
        // Kein Schlüssel ist kein Fehler, sondern ein bekannter Zustand: die
        // Kachel soll „nichts hinterlegt" sagen und nicht rot blinken. Der
        // Abschlussweg wertet das Kennzeichen allerdings anders — dort darf
        // daraus keine makellose Nullsitzung werden.
        return { offen: [], geschlossen: [], hinweis: 'Kein Bitunix-Schlüssel hinterlegt', ohneSchluessel: true }
    }

    const [offenRoh, histAlle] = await Promise.all([
        getPendingPositions(config.apiKey, config.secretKey, {}),
        /*
         * BEWUSST `getHistoryPositions` und NICHT der Endpunkt
         * /api/bitunix/recent-closed: der schreibt bei jedem Aufruf
         * `bitunix_config.lastHistoryScan`. Ein Abruf im Sekundentakt würde das
         * Import-Fenster ständig zurücksetzen und den Trade-Import
         * stillschweigend sabotieren. Dieser Weg liest nur.
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
}

/**
 * Geschlossene Bitunix-Positionen in den Schnappschuss der Sitzung überführen.
 *
 * Rein, damit prüfbar. Bewusst dieselben Feldnamen wie der frühere
 * Journal-Schnappschuss (`symbol`, `side`, `entryTime` …), damit
 * `LiveSessions.vue` unverändert weiterliest — alte Sitzungen im Archiv
 * behalten ihre Form, neue bekommen dieselbe.
 *
 * Zeiten stehen hier in **Sekunden**, wie im Journal-Schnappschuss zuvor; die
 * Bitunix-Antwort liefert Millisekunden. Felder der History-Position laut
 * `bitunix-api.js`: symbol, entryPrice, closePrice, maxQty, side, fee, funding,
 * realizedPNL, leverage, ctime, mtime.
 *
 * ## `netProceeds` heisst hier `realizedPNL` — und das ist Absicht
 *
 * Im Journal bedeutet `netProceeds` nach dem Kanon aus `bitunix-api.js`
 * (`fix-double-fees`) `realizedPNL - funding`. Hier steht bewusst `realizedPNL`
 * selbst, weil die laufende Kachel über `berechneSitzung().realisiertUsd`
 * genau diese Summe zeigt. Der ganze Zweck dieser Änderung ist, dass Kachel
 * und Archiv **dieselbe** Zahl nennen; ein um das Funding verschobener
 * Archivwert wäre der alte Widerspruch in klein. Funding geht deshalb nicht
 * unter, es steht als eigenes Feld daneben und als `fundingUsd` an der
 * Sitzung.
 */
export function schnappschussAusPositionen(geschlossen = []) {
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
    return (Array.isArray(geschlossen) ? geschlossen : [])
        .filter(Boolean)
        .map(p => {
            const realisiert = n(p.realizedPNL ?? p.realizedPnl ?? p.realized_pnl)
            const gebuehr = n(p.fee)
            const funding = n(p.funding)
            return {
                symbol: p.symbol || '',
                side: p.side || '',
                entryTime: Math.floor(n(p.ctime) / 1000),
                exitTime: Math.floor(n(p.mtime) / 1000),
                entryPrice: Number(p.entryPrice) || null,
                exitPrice: Number(p.closePrice) || null,
                qty: Number(p.maxQty) || null,
                netProceeds: realisiert,
                // Kanon aus `bitunix-api.js`: brutto = realizedPNL + |fee|.
                // `Math.abs`, weil das Vorzeichen der Gebühr je nach Endpunkt
                // wechselt — ein positiver Gebührenwert dürfte den Bruttowert
                // nicht kleiner machen als den Nettowert.
                grossProceeds: realisiert + Math.abs(gebuehr),
                commission: Math.abs(gebuehr),
                funding,
            }
        })
        .sort((a, b) => a.exitTime - b.exitTime)
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
            /*
             * Das Fenster steht NICHT im Cache-Schlüssel: geholt wird immer
             * `YAHOO_RANGE`, geschnitten wird danach. Sonst hielte der Server
             * für jedes Fenster eine eigene Kopie derselben Kurse vor und
             * fragte Yahoo entsprechend öfter.
             */
            const stunden = Math.max(1, Math.min(FENSTER_MAX_H,
                Number(req.query.stunden) || FENSTER_VORGABE_H))
            const key = `lt_indizes|${interval}`
            if (req.query.force) verwerfeCache(key)
            const roh = await ausCache(key, INDIZES_TTL, () => holeIndizes(interval, YAHOO_RANGE))
            /*
             * Alter erst hier: `roh` kann aus dem Zwischenspeicher kommen, und
             * bisher setzte das Raster mangels `stand` schlicht `Date.now()` —
             * über einer zehn Minuten alten Kerze stand die aktuelle Uhrzeit.
             * `veraltet` aus dem Altstand-Rückfall von `ausCache` bleibt
             * erhalten: ein Abrufproblem ist auch dann eines, wenn die Kurse
             * im Rahmen sind.
             */
            const gealtert = altereIndizes(roh)
            const geschnitten = beschneideFenster(gealtert, stunden)
            sendeRadar(res, {
                ...roh, ...gealtert,
                maerkte: geschnitten.maerkte,
                stunden,
                veraltet: roh.veraltet || gealtert.veraltet,
            })
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
            const roh = await ausCache(key, 5000, () => holeSitzungsRohdaten(von, bis))

            sendeRadar(res, { ...roh, ...berechneSitzung({ ...roh, ...plan }) })
        } catch (e) {
            sendRadarError(res, e, 'Sitzungsstand')
        }
    })

    /**
     * Sitzung beenden — dieselbe Rechnung wie der laufende Stand.
     *
     * Bis hierher rechnete das Beenden im Browser aus bereits importierten
     * Journal-Trades, während die Kachel daneben aus Bitunix rechnete. Zwei
     * Quellen für ein Urteil; ein verzögerter Import genügte, damit Kachel und
     * Archiv verschiedene Zahlen zeigten. Jetzt gehen beide durch
     * `holeSitzungsRohdaten` und `berechneSitzung`.
     *
     * ## Kein Nullstand bei Ausfall
     *
     * Der alte Weg fing einen Abruffehler ab und schrieb trotzdem
     * `pnlUsd: 0, tradeAnzahl: 0, planVerletzt: 0`. Ein Fehlschlag wurde damit
     * zur makellosen Sitzung — und weil die Disziplinbilanz auch archivierte
     * Sitzungen zählt, verbesserte ein Bitunix-Aussetzer stillschweigend die
     * eigene Statistik. Hier bricht der Abschluss stattdessen ab: die Sitzung
     * bleibt `laufend` und lässt sich beenden, sobald die Quelle wieder da ist.
     */
    app.post('/api/livetrading/session-beenden', async (req, res) => {
        try {
            const id = Number(req.body?.objectId ?? req.body?.id)
            if (!Number.isFinite(id) || id <= 0) {
                return res.status(400).json({ error: 'objectId ist erforderlich' })
            }
            const knex = getKnex()
            const s = await knex('live_sessions').where('id', id).first()
            if (!s) return res.status(404).json({ error: 'Sitzung nicht gefunden' })
            if (s.status !== 'laufend') {
                return res.status(409).json({ error: 'Sitzung läuft nicht mehr' })
            }

            const von = Number(s.startUnix)
            if (!Number.isFinite(von) || von <= 0) {
                return res.status(422).json({ error: 'Sitzung ohne gültige Startzeit' })
            }
            const endeMs = Date.now()

            /*
             * Bewusst OHNE `ausCache`: Ein Abschluss ist einmalig und muss den
             * Stand von jetzt sehen, nicht den bis zu fünf Sekunden alten aus
             * der Kachelabfrage. Der letzte Trade fällt sonst womöglich aus dem
             * eingefrorenen Ergebnis.
             */
            const roh = await holeSitzungsRohdaten(von, endeMs)
            if (roh.ohneSchluessel) {
                // Ohne Schlüssel ist die Kachel zu Recht still — ein Abschluss
                // wäre hier aber eine erfundene Nullsitzung.
                return res.status(422).json({ error: 'Kein Bitunix-Schlüssel hinterlegt — Sitzung nicht abrechenbar' })
            }

            const rechnung = berechneSitzung({
                ...roh,
                planMaxVerlustUsd: Number(s.planMaxVerlustUsd) || 0,
                planMaxTrades: Number(s.planMaxTrades) || 0,
            })
            const trades = schnappschussAusPositionen(roh.geschlossen)

            let protokoll = []
            try {
                protokoll = JSON.parse(s.protokoll || '[]')
            } catch { protokoll = [] }
            if (!Array.isArray(protokoll)) protokoll = []

            const daten = {
                endUnix: endeMs,
                status: 'beendet',
                fazit: String(req.body?.fazit || ''),
                protokoll: JSON.stringify([...protokoll, { t: endeMs, art: 'ende', text: 'Sitzung beendet' }]),
                trades: JSON.stringify(trades),
                // Genau die Zahl, die die Kachel als „realisiert" zeigt
                pnlUsd: rechnung.realisiertUsd,
                gebuehrenUsd: rechnung.gebuehrenUsd,
                fundingUsd: rechnung.fundingUsd,
                tradeAnzahl: rechnung.tradeAnzahl,
                planVerletzt: rechnung.plan.verletzt ? 1 : 0,
                updatedAt: knex.fn.now(),
            }

            // Erst rechnen, dann schreiben — und erst danach gilt sie als beendet
            await knex('live_sessions').where('id', id).update(daten)

            /*
             * Bewusst NICHT die rohe Zeile mitschicken: dort stehen
             * `protokoll`, `trades` und `kacheln` als JSON-TEXT. Der Store
             * legt die Antwort über sein bereits geparstes Objekt — rohe
             * Zeichenketten würden die geparsten Felder überschreiben.
             */
            res.json({
                ok: true,
                sitzung: {
                    objectId: id,
                    endUnix: endeMs,
                    status: 'beendet',
                    fazit: daten.fazit,
                    protokoll: JSON.parse(daten.protokoll),
                    trades,
                    pnlUsd: daten.pnlUsd,
                    gebuehrenUsd: daten.gebuehrenUsd,
                    fundingUsd: daten.fundingUsd,
                    tradeAnzahl: daten.tradeAnzahl,
                    planVerletzt: daten.planVerletzt,
                },
                rechnung,
            })
        } catch (e) {
            logWarn('livetrading', 'Sitzungsabschluss fehlgeschlagen', e.message)
            res.status(502).json({ error: `Sitzung konnte nicht abgerechnet werden: ${e.message}` })
        }
    })

    console.log(' -> Live-Trading routes initialized')
}
