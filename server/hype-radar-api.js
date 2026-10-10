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
import { dexDetails, normChain } from './hype-radar/quellen.js'
import { ladeListungen, pruefeListung } from './hype-radar/listungen.js'
import { wachhundLauf, STANDARD_ALARM_REGELN } from './hype-radar/wachhund.js'
import { testZustellung } from './hype-radar/zustellung.js'
import { stufenNach, benoetigteAnbieter } from './hype-radar/stufen.js'
import { keySpalte } from './ai-models.js'
import { HORIZONTE } from './radar-ergebnisse.js'
import { werteAusHype, werteAusFrueh } from './radar-guete.js'
import { pruefeProjekt, kurzfassung, gespeichertePruefungen, schluesselFuer } from './hype-radar/projekt.js'
import { fruehLauf, fruehStand } from './hype-radar/fruehphase.js'
import { istDuenn, kandidatStatus, KANDIDAT_AB } from './hype-radar/fruehphase-bewertung.js'

/** Vertrag als Schlüssel: Solana unterscheidet Gross/Klein, EVM nicht. */
const vertragsSchluessel = (chain, contract) => {
    const c = normChain(chain)
    return `${c}|${c === 'solana' ? String(contract || '') : String(contract || '').toLowerCase()}`
}
import { smartWalletStand } from './hype-radar/smartmoney.js'
import { boersenLauf, boersenStand, boersenUebersicht, ladeStaende } from './hype-radar/boersenwacht.js'
import { leiterFuer } from './hype-radar/boersenwacht-bewertung.js'
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
            // Die Alarmschwellen nur als Abweichung speichern — die Vorgaben
            // leben in `wachhund.js` und sollen dort änderbar bleiben.
            await schreibeEinstellungen(rest, { alarmRegeln: STANDARD_ALARM_REGELN })
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
                projektDaten: sicherParse(z.projektDaten, {}),
            })))
        } catch (e) {
            logWarn('hype-radar', `Kandidaten lesen: ${e.message}`)
            res.status(500).json({ error: 'Kandidaten konnten nicht geladen werden' })
        }
    })

    /**
     * Projektprüfung auf Abruf — für jeden Fund, nicht nur die bestandenen.
     *
     * Liefert die gespeicherte Prüfung, solange sie gilt (24 h); `neu=1`
     * erzwingt eine frische, frühestens fünf Minuten nach der letzten. Die
     * Prüfung läuft im Hintergrund weiter, auch wenn die Seite vorher schliesst.
     */
    app.get('/api/hype-radar/projekt', async (req, res) => {
        try {
            const kandidat = {
                symbol: String(req.query.symbol || '').slice(0, 30),
                name: String(req.query.name || '').slice(0, 120),
                chain: String(req.query.chain || '').slice(0, 30),
                contract: String(req.query.contract || '').slice(0, 80),
            }
            if (!kandidat.contract && !kandidat.symbol) return res.status(400).json({ error: 'Vertrag oder Symbol fehlt' })
            // Links und Ersteller aus dem jüngsten Lauf, falls der Fund dort stand.
            if (kandidat.contract) {
                const zeile = await getKnex()('hype_candidates')
                    .where('contractAddress', kandidat.contract)
                    .orderBy('erstelltAm', 'desc').first()
                    .catch(() => null)
                const m = sicherParse(zeile?.marktDaten, {})
                kandidat.links = m.links || null
                kandidat.ersteller = m.ersteller || ''
                const f = await getKnex()('hype_frueh').where('contract', kandidat.contract).first().catch(() => null)
                if (!kandidat.links) {
                    kandidat.links = sicherParse(f?.links, null)
                    kandidat.ersteller = f?.ersteller || kandidat.ersteller
                }
                // Die Frühphase weiss, ob es ein pump.fun-Token ist — die Endung „pump" trägt nicht jeder.
                if (sicherParse(f?.stand, {}).pump === true) kandidat.pump = true
            }
            const e = await pruefeProjekt(kandidat, { neu: req.query.neu === '1' })
            res.json({ ...kurzfassung(e), auszug: e.fakten?.webseite?.fakten?.beschreibung || '' })
        } catch (e) {
            logWarn('hype-radar', `Projektprüfung: ${e.message}`)
            res.status(500).json({ error: 'Projektprüfung fehlgeschlagen' })
        }
    })

    // ── Frühphase ───────────────────────────────────────────────────────
    /**
     * Die Frühphase in drei Teilen.
     *
     * - `kandidaten`: nur, was `kandidatStatus` besteht — meldefähig (Vertrag
     *   und Projekt geprüft, belastbare Note, laufender Handel), im letzten
     *   Durchgang gemessen und mit einer Note ab `fruehKandidatAb`. Mit vollem
     *   Verlauf für das Diagramm.
     * - `beobachtung`: die Favoriten (Stern), jeweils mit ihrer Frühphasen-Zeile,
     *   wo es eine gibt — auch wenn die Frühphase den Token längst verworfen hat.
     * - `trichter`: wie viele beobachtete Token an welcher Bedingung scheitern.
     *   Eine leere Kandidatenliste ist sonst nicht von einer kaputten zu
     *   unterscheiden.
     *
     * Die ganze Liste (`zeilen`) nur mit `roh=1`; `alle=1` nimmt die
     * Verworfenen dazu — mit Grund, damit sichtbar bleibt, WARUM ein Token aus
     * dem Rennen ist.
     */
    app.get('/api/hype-radar/frueh', async (req, res) => {
        try {
            const knex = getKnex()
            const einst = await leseEinstellungen()
            const schwelle = Number(einst.fruehKandidatAb) || KANDIDAT_AB
            const projektPflicht = einst.projektPruefung !== false
            const aktiv = await knex('hype_frueh').select('*').whereNot('status', 'verworfen')
            /*
             * Der letzte Durchgang ist der jüngste `letzterBlick` — aus der
             * Datenbank, nicht aus dem Prozess: NAS und Entwicklungsrechner
             * schreiben in dieselbe Tabelle.
             */
            const letzterLauf = aktiv.reduce((m, z) => Math.max(m, Number(z.letzterBlick) || 0), 0)

            const favoriten = await knex('hype_favoriten').select('*').whereNot('quelle', 'coinradar').catch(() => [])
            const favNach = new Map(favoriten.filter((f) => f.contractAddress)
                .map((f) => [vertragsSchluessel(f.chain, f.contractAddress), f]))
            const favVon = (z) => favNach.get(vertragsSchluessel(z.chain, z.contract)) || null

            const pruefe = (z, stand) => kandidatStatus({ ...z, stand }, { letzterLauf, schwelle, projektPflicht })
            const geparst = aktiv.map((z) => {
                const stand = sicherParse(z.stand, {})
                return { z, stand, k: pruefe(z, stand) }
            })
            const trichter = {}
            for (const g of geparst) {
                const grund = g.k.ja ? 'kandidat' : g.k.grund
                trichter[grund] = (trichter[grund] || 0) + 1
            }
            const kandidaten = geparst.filter((g) => g.k.ja).sort((a, b) => b.z.note - a.z.note)

            // Favoriten: ihre Zeile auch dann, wenn sie verworfen ist.
            const favVertraege = favoriten.filter((f) => f.contractAddress)
                .flatMap((f) => [String(f.contractAddress), String(f.contractAddress).toLowerCase()])
            const favZeilen = favVertraege.length
                ? (await knex('hype_frueh').select('*').whereIn('contract', [...new Set(favVertraege)]))
                    .filter((z) => favVon(z))
                : []
            const zeileZuFav = new Map(favZeilen.map((z) => [vertragsSchluessel(z.chain, z.contract), z]))

            let roh = []
            if (req.query.roh === '1') {
                let q = knex('hype_frueh').select('*')
                if (req.query.alle !== '1') q = q.whereNot('status', 'verworfen')
                roh = await q.orderBy('note', 'desc').limit(Math.min(300, Number(req.query.limit) || 150))
            }

            const projekte = await gespeichertePruefungen([...kandidaten.map((g) => g.z), ...favZeilen, ...roh])
            const staende = await ladeStaende()
            const VOLLER_VERLAUF = ['ts', 'note', 'mcap', 'liq', 'halter', 'tx1h', 'kaeufer1h', 'verkaeufer1h']
            const ansicht = (z, stand = sicherParse(z.stand, {}), { voll = false } = {}) => ({
                ...z,
                stand,
                duenn: istDuenn(stand),
                kandidat: pruefe(z, stand),
                favoritId: favVon(z)?.id ?? null,
                quellen: sicherParse(z.quellen, []),
                links: sicherParse(z.links, {}),
                // Für die Liste nur die Notenreihe — die vollen Momentaufnahmen wären
                // bei 150 Zeilen ein paar hundert Kilobyte. Kandidaten bekommen mehr.
                verlauf: sicherParse(z.verlauf, []).map((v) => Object.fromEntries((voll ? VOLLER_VERLAUF : ['ts', 'note', 'mcap', 'halter'])
                    .map((f) => [f, v[f] ?? null]))),
                befunde: sicherParse(z.befunde, []),
                projekt: kurzfassung(projekte.get(schluesselFuer(z)) || null),
                // Auf welchen Börsen der Token schon steht (Alpha nach Vertrag).
                leiter: leiterFuer({ symbol: z.symbol, chain: z.chain, contract: z.contract,
                    bewertungUsd: stand?.mcap }, staende),
            })

            const zeilen = roh.map((z) => ansicht(z))
            // Belastbare Noten zuerst; eine Note aus ein, zwei Teilnoten ist leicht extrem.
            zeilen.sort((a, b) => (Number(a.duenn) - Number(b.duenn)) || (b.note - a.note))

            res.json({
                stand: fruehStand(),
                letzterLauf,
                schwelle,
                beobachtet: aktiv.length,
                trichter,
                kandidaten: kandidaten.map((g) => ansicht(g.z, g.stand, { voll: true })),
                beobachtung: favoriten.map((f) => {
                    const z = f.contractAddress ? zeileZuFav.get(vertragsSchluessel(f.chain, f.contractAddress)) : null
                    return {
                        favorit: { id: f.id, symbol: f.symbol, name: f.name, chain: f.chain, contractAddress: f.contractAddress,
                            stumm: Boolean(f.stumm), erstelltAm: f.erstelltAm, letzteDaten: sicherParse(f.letzteDaten, {}) },
                        zeile: z ? ansicht(z, undefined, { voll: true }) : null,
                    }
                }),
                zeilen,
            })
        } catch (e) {
            logWarn('hype-radar', `Frühphase lesen: ${e.message}`)
            res.status(500).json({ error: 'Frühphase konnte nicht geladen werden' })
        }
    })

    /**
     * Ein einzelner Token, auch wenn die Frühphase ihn nicht mehr führt.
     *
     * Wer auf einen Alarm klickt, will wissen, was aus dem Token geworden ist.
     * `hype_frueh` vergisst aber nach drei Tagen Funkstille (verworfene schon
     * nach einem) — dann stand dort nur „nicht mehr beobachtet". Was bleibt,
     * liegt anderswo: die Alarme selbst, das Gedächtnis (erster Blick, erste
     * Meldung, letzte Bewertung), die Messungen der Erfolgskontrolle — und der
     * Markt jetzt, live von DexScreener. Ein Abruf je Klick, kein Takt.
     */
    app.get('/api/hype-radar/frueh/token', async (req, res) => {
        const contract = String(req.query.contract || '').trim()
        if (!/^[A-Za-z0-9]{20,80}$/.test(contract)) return res.status(400).json({ error: 'Ungültiger Vertrag' })
        try {
            const knex = getKnex()
            const evm = /^0x/i.test(contract)
            const mitVertrag = (q) => (evm ? q.whereRaw('lower(contract) = ?', [contract.toLowerCase()]) : q.where('contract', contract))
            const [gedaechtnis, alarmeRoh, ergebnisse] = await Promise.all([
                mitVertrag(knex('hype_gedaechtnis')).first().catch(() => null),
                // `daten` ist JSON als Text; der Vertrag steht darin wörtlich.
                knex('hype_alarme').where('daten', 'like', `%${contract}%`)
                    .orderBy('erstelltAm', 'desc').limit(10).catch(() => []),
                mitVertrag(knex('radar_ergebnisse')).whereIn('art', ['frueh', 'hype'])
                    .orderBy('erstelltAm', 'asc').limit(40).catch(() => []),
            ])
            let markt = null
            let marktFehler = ''
            try {
                const d = await dexDetails(contract, { streng: true })
                if (d) {
                    const m = d.markt || {}
                    markt = {
                        symbol: d.symbol, name: d.name, chain: d.chain, url: d.url, dex: m.dex || '',
                        seite: d.seite,
                        preisUsd: m.preisUsd ?? null,
                        bewertungUsd: m.marktkapitalisierung || m.fdv || null,
                        liquiditaetUsd: m.liquiditaetUsd ?? null,
                        volumen24h: m.volumen24h ?? null,
                        volumen1h: m.volumen1h ?? null,
                        aenderung1h: m.aenderung1h ?? null,
                        aenderung24h: m.aenderung24h ?? null,
                        transaktionen24h: m.transaktionen24h ?? null,
                        transaktionen1h: m.transaktionen1h ?? null,
                        paarAlterStunden: m.paarAlterStunden ?? null,
                    }
                }
            } catch (e) {
                marktFehler = e.message
            }
            const zahl = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v))
            res.json({
                contract,
                gedaechtnis: gedaechtnis ? {
                    symbol: gedaechtnis.symbol || '',
                    chain: gedaechtnis.chain,
                    ersterBlick: zahl(gedaechtnis.ersterBlick),
                    ersteMeldung: zahl(gedaechtnis.ersteMeldung),
                    letzterBlick: zahl(gedaechtnis.letzterBlick),
                    bewertungUsd: zahl(gedaechtnis.bewertungUsd),
                } : null,
                alarme: alarmeRoh.map((a) => ({
                    id: a.id, regel: a.regel, meldung: a.meldung, erstelltAm: zahl(a.erstelltAm),
                })),
                ergebnisse: ergebnisse.map((e) => ({
                    art: e.art, gruppe: e.gruppe || 'spitze', horizont: e.horizont, status: e.status,
                    note: zahl(e.note), erstelltAm: zahl(e.erstelltAm), gemessenAm: zahl(e.gemessenAm),
                    renditePct: zahl(e.renditePct), mfePct: zahl(e.mfePct), maePct: zahl(e.maePct),
                    nochHandelbar: e.nochHandelbar === null || e.nochHandelbar === undefined ? null : Number(e.nochHandelbar) === 1,
                    mcapStart: zahl(e.mcapStart), mcapEnde: zahl(e.mcapEnde),
                    fehler: e.fehler || '',
                })),
                markt,
                marktFehler,
            })
        } catch (e) {
            logWarn('hype-radar', `Frühphase-Token ${contract}: ${e.message}`)
            res.status(500).json({ error: 'Token konnte nicht geladen werden' })
        }
    })

    /**
     * Erfolgskontrolle der Frühphase: Schwellen-Überschreiter gegen eine
     * Zufallsauswahl der neu gesehenen Token, nach 1, 3 und 7 Tagen.
     */
    app.get('/api/hype-radar/frueh/guete', async (req, res) => {
        try {
            const tage = Math.min(400, Math.max(1, Number(req.query.tage) || 120))
            const seit = Date.now() - tage * 24 * 3600e3
            const zeilen = await getKnex()('radar_ergebnisse')
                .where('art', 'frueh').andWhere('erstelltAm', '>=', seit)
            const horizonte = Object.keys(HORIZONTE.frueh).filter((h) => zeilen.some((z) => z.horizont === h))
            res.json({
                seit, tage, gesamt: zeilen.length,
                jeHorizont: horizonte.map((h) => werteAusFrueh(zeilen.filter((z) => z.horizont === h), h)),
            })
        } catch (e) {
            logWarn('hype-radar', `Frühphase-Güte lesen: ${e.message}`)
            res.status(500).json({ error: 'Erfolgskontrolle konnte nicht geladen werden' })
        }
    })

    // ── Börsen-Beobachter ───────────────────────────────────────────────
    app.get('/api/hype-radar/boersen', async (req, res) => {
        try {
            res.json(await boersenUebersicht({ tage: Math.min(180, Math.max(1, Number(req.query.tage) || 60)) }))
        } catch (e) {
            logWarn('hype-radar', `Börsen lesen: ${e.message}`)
            res.status(500).json({ error: 'Börsen-Beobachter konnte nicht geladen werden' })
        }
    })

    /** Ein Abgleich von Hand, im Hintergrund — höchstens einer je Minute. */
    app.post('/api/hype-radar/boersen/lauf', async (req, res) => {
        try {
            if (boersenStand().laeuft) return res.status(409).json({ error: 'Ein Abgleich läuft bereits' })
            if (!(await beansprucheAufgabe('hype_boersen_hand', 60e3))) {
                return res.status(429).json({ error: 'Frühestens eine Minute nach dem letzten Abgleich' })
            }
            boersenLauf().catch((e) => logWarn('hype-radar', `Börsen von Hand: ${e.message}`))
            res.status(202).json({ gestartet: true })
        } catch (e) {
            res.status(500).json({ error: 'Abgleich fehlgeschlagen' })
        }
    })

    /** Smart Money: je beobachteter Wallet der letzte Abruf und ein etwaiger Fehler. */
    app.get('/api/hype-radar/smart/wallets', async (req, res) => {
        try {
            res.json(await smartWalletStand(await leseEinstellungen()))
        } catch (e) {
            res.status(500).json({ error: 'Wallets konnten nicht geladen werden' })
        }
    })

    /**
     * Ein Durchgang von Hand, im Hintergrund. Gebremst auf einen je Minute — die Quellen sind
     * dieselben, die der Takt alle fünfzehn Minuten fragt, und pump.fun wie
     * GeckoTerminal drosseln spürbar.
     */
    app.post('/api/hype-radar/frueh/lauf', async (req, res) => {
        try {
            if (!(await beansprucheAufgabe('hype_frueh_hand', 60e3))) {
                return res.status(429).json({ error: 'Frühestens eine Minute nach dem letzten Durchgang' })
            }
            if (fruehStand().laeuft) return res.status(409).json({ error: 'Ein Durchgang läuft bereits' })
            /*
             * Im Hintergrund: mit Projektprüfungen dauert ein Durchgang leicht
             * eine Minute und mehr. Die Seite fragt `GET /frueh` ab und sieht
             * am `stand`, wann er fertig ist.
             */
            fruehLauf().catch((e) => logWarn('hype-radar', `Frühphase von Hand: ${e.message}`))
            res.status(202).json({ gestartet: true })
        } catch (e) {
            logWarn('hype-radar', `Frühphase von Hand: ${e.message}`)
            res.status(500).json({ error: 'Durchgang fehlgeschlagen' })
        }
    })

    /**
     * Erfolgskontrolle: Was wurde aus den Funden?
     *
     * Bis zum 07.10.2026 sammelte der Radar diese Messungen, und niemand las
     * sie — es gab weder Endpunkt noch Anzeige. Drei Gruppen je Horizont:
     * die Spitze, die von der Sicherheitsprüfung Verworfenen und das Feld
     * unter der Schwelle (siehe `werteAusHype`).
     */
    app.get('/api/hype-radar/guete', async (req, res) => {
        try {
            const tage = Math.min(400, Math.max(1, Number(req.query.tage) || 120))
            const seit = Date.now() - tage * 24 * 3600e3
            const zeilen = await getKnex()('radar_ergebnisse')
                .where('art', 'hype').andWhere('erstelltAm', '>=', seit)
            const horizonte = Object.keys(HORIZONTE.hype)
                .filter((h) => zeilen.some((z) => z.horizont === h))
            res.json({
                seit,
                tage,
                gesamt: zeilen.length,
                jeHorizont: horizonte.map((h) => werteAusHype(zeilen.filter((z) => z.horizont === h), h)),
            })
        } catch (e) {
            logWarn('hype-radar', `Güte lesen: ${e.message}`)
            res.status(500).json({ error: 'Erfolgskontrolle konnte nicht geladen werden' })
        }
    })

    // ── Berichte ────────────────────────────────────────────────────────
    app.get('/api/hype-radar/berichte', async (req, res) => {
        try {
            // Leere Läufe werden seit dem Fix gar nicht mehr gespeichert; der
            // Altbestand aus der Zeit davor bleibt in der Tabelle stehen und
            // wird hier ausgeblendet, statt ihn zu löschen.
            const zeilen = await getKnex()('hype_reports')
                .select('id', 'erstelltAm', 'ueberschrift', 'marktkontext',
                    'anzahlKandidaten', 'anzahlAussortiert', 'kostenUsd', 'ausloeser')
                .where('anzahlKandidaten', '>', 0)
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
            /*
             * Doppelklick auf den Stern darf keine zweite Zeile anlegen. Der
             * Vertrag gehört zur Identität: „PEPE auf Solana" gibt es
             * hundertfach, und bis zum 07.10.2026 bekam, wer das Original nach
             * einem Klon anheftete, den Klon zurück.
             */
            const vorhanden = await knex('hype_favoriten')
                .where({ symbol: s, chain: String(chain || ''), contractAddress: String(contractAddress || '') })
                .first()
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
            res.json(zeilen.map((z) => {
                const daten = sicherParse(z.daten, {})
                // Frühphasen-Alarme hängen an keinem Favoriten (`favoritId` 0)
                // — ihr Symbol steht in den Daten.
                return { ...z, daten, symbol: z.symbol || daten.symbol || '', chain: z.chain || daten.chain || '' }
            }))
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
    /*
     * Die Sperre greift SOFORT, vor dem ersten `await`. Bis zum 07.10.2026
     * wurde sie erst nach dem Lesen der Einstellungen gesetzt — über das Netz
     * zur NAS-Postgres dauert das spürbar, und zwei schnelle Klicks starteten
     * zwei bezahlte Berichte.
     */
    laufAktiv = true
    let uebergeben = false
    try {
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
        uebergeben = true
        await fuehreLaufRoute(res, einst, mitBericht)
    } finally {
        // Den eigentlichen Lauf gibt `fuehreLaufRoute` selbst frei.
        if (!uebergeben) laufAktiv = false
    }
}

async function fuehreLaufRoute(res, einst, mitBericht) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    })
    const istAbgebrochen = beobachteAbbruch(res)
    const sende = sseSender(res, istAbgebrochen)

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

            /*
             * Erst die eigene Sperre, DANN der Anspruch. Andersherum verbrauchte
             * ein gerade laufender Handlauf den Anspruch des Takts — und der
             * geplante Bericht fiel für das ganze Intervall (sechs Stunden) aus.
             */
            if (laufAktiv) return
            const stunden = Math.max(1, Number(einst.intervallStunden) || 6)
            if (!(await beansprucheAufgabe(ANSPRUCH, stunden * 3600 * 1000))) return
            if (laufAktiv) return

            laufAktiv = true
            try {
                const fehlt = await fehlendeSchluessel(einst)
                if (fehlt.length) {
                    await meldeFehler(ANSPRUCH, `Zugangsdaten fehlen: ${fehlt.join(', ')}`)
                    return
                }
                const { id, bericht } = await scanneUndBerichte(einst, () => {}, 'auto')
                console.log(id
                    ? ` -> Hype-Radar: Bericht ${id} erstellt`
                    : ` -> Hype-Radar: kein Fund bestanden, kein Bericht `
                      + `(${bericht.aussortiert.length} aussortiert)`)
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
            /*
             * 0 heisst AUS — und das braucht eine eigene Abfrage.
             *
             * `Number(0) || 15` ergäbe 15, weil die Null falsy ist: Der
             * Wachhund liefe genau dann weiter, wenn er abgeschaltet werden
             * soll. Dieselbe Falle steckte an mehreren Stellen im Haus und ist
             * am 21.08.2026 überall aufgeräumt worden.
             */
            const roh = Number(einst.wachhundIntervallMin)
            if (roh === 0) return

            const minuten = Math.max(5, Number.isFinite(roh) && roh > 0 ? roh : 15)
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
