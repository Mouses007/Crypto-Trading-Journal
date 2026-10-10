/**
 * Selbsttest: Anlegen und Messen der Erfolgskontrolle — die reinen Teile.
 *
 * Ohne Netz und ohne Datenbank. Geprüft wird, WER verfolgt wird (Spitze plus
 * Kontrollgruppe aus der unteren Hälfte) und WIE gemessen wird (das Fenster
 * endet mit dem Horizont, nicht mit dem Zeitpunkt der Messung).
 *
 * Aufruf: node server/__selftest-radar-ergebnisse.mjs
 */
import {
    waehleCoinRadar, waehleHype, rechneFenster, stichprobe, waehleFrueh, hochImFenster, laufIdFrueh, FELD_VERSATZ,
    lebtNoch, renditeGleichesMass, duenneLaeufe, DECKEL_JE_ART,
} from './radar-ergebnisse.js'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Radar: Erfolgskontrolle anlegen und messen')

/** Vorhersehbarer „Zufall" für wiederholbare Prüfungen. */
function festerZufall(start = 1) {
    let x = start
    return () => { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646 }
}

// ── Stichprobe ──────────────────────────────────────────────────────────
{
    const s = stichprobe([1, 2, 3, 4, 5], 3, festerZufall())
    p('Stichprobe hat die verlangte Grösse', s.length === 3)
    p('ohne Wiederholung', new Set(s).size === 3)
    p('kleinere Liste wird ganz genommen', stichprobe([1, 2], 10).length === 2)
}

// ── Coin-Radar: wer verfolgt wird ───────────────────────────────────────
{
    const lauf = Array.from({ length: 120 }, (_, i) => ({ symbol: `C${i + 1}`, rang: i + 1 }))
    const w = waehleCoinRadar(lauf, festerZufall(7))
    const spitze = w.filter((z) => z.gruppe === 'spitze')
    const kontrolle = w.filter((z) => z.gruppe === 'kontrolle')
    p('zwanzig Spitzenplätze', spitze.length === 20 && spitze.every((z) => z.rang <= 20))
    p('zehn Kontrollzeilen', kontrolle.length === 10)
    /*
     * Der Befund: vorher waren Platz 11–20 die „Kontrolle". Jetzt kommt sie
     * aus der unteren Hälfte — bei 120 Coins ab Platz 61.
     */
    p('Kontrolle stammt aus der unteren Hälfte', kontrolle.every((z) => z.rang > 60),
        JSON.stringify(kontrolle.map((z) => z.rang)))

    // Kleiner Lauf: die untere Hälfte überschneidet sich mit der Spitze.
    const klein = Array.from({ length: 30 }, (_, i) => ({ symbol: `K${i + 1}`, rang: i + 1 }))
    const wk = waehleCoinRadar(klein, festerZufall(3))
    const symbole = wk.map((z) => z.symbol)
    p('kein Coin steht in beiden Gruppen', new Set(symbole).size === symbole.length)
    p('Kontrolle bleibt in der unteren Hälfte',
        wk.filter((z) => z.gruppe === 'kontrolle').every((z) => z.rang > 20))
    p('leerer Lauf ergibt nichts', waehleCoinRadar([]).length === 0)
}

// ── Hype-Radar: wer verfolgt wird ───────────────────────────────────────
{
    const k = (id, status, hypeScore, vertrag = `0x${id}`) =>
        ({ id, symbol: `H${id}`, status, hypeScore, contractAddress: vertrag })
    const kandidaten = [
        ...Array.from({ length: 25 }, (_, i) => k(i + 1, i % 2 ? 'bestanden' : 'berichtet', 50 + i)),
        ...Array.from({ length: 15 }, (_, i) => k(100 + i, 'verworfen', 60)),
        ...Array.from({ length: 30 }, (_, i) => k(200 + i, 'bewertet', 20)),
        k(999, 'bestanden', 99, ''),   // ohne Vertrag nicht messbar
    ]
    const w = waehleHype(kandidaten, festerZufall(11))
    const gruppe = (g) => w.filter((x) => x.gruppe === g)
    p('zwanzig Spitzenfunde', gruppe('spitze').length === 20)
    p('die besten nach Hype-Note', Math.min(...gruppe('spitze').map((x) => x.hypeScore)) === 55,
        String(Math.min(...gruppe('spitze').map((x) => x.hypeScore))))
    p('zehn Verworfene als Gegenprobe des Filters', gruppe('verworfen').length === 10)
    p('zehn aus dem Feld als Gegenprobe der Note', gruppe('feld').length === 10)
    p('ohne Vertrag wird nichts angelegt', !w.some((x) => x.id === 999))
    /*
     * Der Befund: `laufId` stand fest auf 0 — ein Kürzel wurde einmal im
     * Leben verfolgt. Gleiche Kürzel verschiedener Verträge müssen beide
     * hinein; die Kandidaten-Zeile unterscheidet sie.
     */
    const doppelt = waehleHype([
        { id: 1, symbol: 'PEPE', status: 'bestanden', hypeScore: 50, contractAddress: '0xa' },
        { id: 2, symbol: 'PEPE', status: 'bestanden', hypeScore: 40, contractAddress: '0xb' },
    ])
    p('gleiches Kürzel, zwei Verträge: beide verfolgt',
        doppelt.length === 2 && doppelt[0].id !== doppelt[1].id)
}

// ── Das Messfenster ─────────────────────────────────────────────────────
{
    const MIN = 60e3
    const von = 1_700_000_000_000
    const bis = von + 15 * MIN
    // Kerzen von 10 Minuten VOR der Aussage bis 3 Stunden danach.
    const kerzen = Array.from({ length: 200 }, (_, i) => {
        const t = von - 10 * MIN + i * MIN
        // Im Fenster 100 ± 1, danach ein Ausbruch auf 150.
        const nachher = t >= bis
        return { t, o: 100, h: nachher ? 150 : 101, l: nachher ? 100 : 99, c: 100 }
    })
    const r = rechneFenster(kerzen, von, bis, MIN)
    /*
     * Der Befund: vorher lief das Fenster bis zur Messung. Ein Ausbruch NACH
     * dem Horizont landete so in MFE — hier darf er nicht auftauchen.
     */
    p('MFE endet mit dem Horizont', Math.abs(r.mfePct - 1) < 1e-9, String(r.mfePct))
    p('MAE ebenso', Math.abs(r.maePct + 1) < 1e-9, String(r.maePct))
    p('Startpreis ist die erste Kerze ab der Aussage', r.preisStart === 100)

    let fehlerText = ''
    try { rechneFenster(kerzen.filter((k) => k.t >= von + 5 * MIN), von, bis, MIN) } catch (e) { fehlerText = e.message }
    p('Fenster mit Loch am Anfang wird nicht gemessen', /zu spät/.test(fehlerText), fehlerText)

    fehlerText = ''
    try { rechneFenster(kerzen.filter((k) => k.t < von + 8 * MIN), von, bis, MIN) } catch (e) { fehlerText = e.message }
    p('unvollständiges Fenster wird nicht gemessen', /unvollständig/.test(fehlerText), fehlerText)

    fehlerText = ''
    try { rechneFenster([], von, bis, MIN) } catch (e) { fehlerText = e.message }
    p('ohne Kerzen keine Messung', /zu wenige/.test(fehlerText), fehlerText)
}

// ── Frühphase: gepaarte Kontrolle (10.10.2026) ──────────────────────────
{
    const t = (id, c, alter, aufKurve = true, note = 40) => ({ id, contract: c, symbol: c.toUpperCase(), note, alterStunden: alter, aufKurve })
    const spitze = [t(10, 's1', 5)]
    const vergleichbar = [t(21, 'zuAlt', 30), t(22, 'imPool', 5.2, false), t(23, 'k3', 4), t(24, 'k4', 5.5)]
    const neu = [t(31, 'n1', 0.2), t(32, 'n2', 0.1), t(24, 'k4', 5.5)]
    const wahl = waehleFrueh(spitze, vergleichbar, neu, festerZufall(3))
    const kontrolle = wahl.filter((z) => z.gruppe === 'kontrolle')
    p('Partner: gleicher Zustand, nächstes Alter', kontrolle.length === 1 && kontrolle[0].contract === 'k4' && kontrolle[0].paar === 10,
        JSON.stringify(kontrolle))
    p('Partner nicht aus einem anderen Zustand (Pool statt Kurve)', !kontrolle.some((z) => z.contract === 'imPool'))
    p('Partner nicht mit zu grossem Altersabstand', waehleFrueh([t(10, 's1', 5)], [t(21, 'zuAlt', 30)], []).filter((z) => z.gruppe === 'kontrolle').length === 0)
    const feld = wahl.filter((z) => z.gruppe === 'feld')
    p('Feld: einer aus den neu Gesehenen, nicht der Partner', feld.length === 1 && feld[0].contract !== 'k4' && feld[0].contract !== 's1')
    p('laufId: Spitze positiv, Partner minus Spitzenzeile, Feld mit Versatz',
        laufIdFrueh(wahl.find((z) => z.gruppe === 'spitze')) === 10 && laufIdFrueh(kontrolle[0]) === -10
        && laufIdFrueh(feld[0]) === -(FELD_VERSATZ + feld[0].id))
    const zwei = waehleFrueh([t(10, 's1', 5), t(11, 's2', 5)], [t(24, 'k4', 5.5)], [])
    p('ein Partner gehört nur einem Spitzen-Token', zwei.filter((z) => z.gruppe === 'kontrolle').length === 1)
    p('ein Spitzen-Token ist nie sein eigener Partner', waehleFrueh([t(10, 's1', 5)], [t(10, 's1', 5)], []).filter((z) => z.gruppe === 'kontrolle').length === 0)
}

// ── Frühphase: Messung ──────────────────────────────────────────────────
{
    const von = 1790000000000
    // [Sekunden, o, h, l, c] — die Kerze VOR dem Start (Hoch 9) darf nicht zählen.
    const kerzen = [[von / 1000 - 900, 1, 9, 1, 1], [von / 1000, 1, 3, 0.5, 2], [von / 1000 + 900, 2, 5, 2, 4], [von / 1000 + 90000, 4, 99, 4, 4]]
    const f = hochImFenster(kerzen, von, von + 24 * 3600e3)
    p('Hoch im Fenster: nur Kerzen, die im Fenster beginnen', f?.hoch === 5 && f?.erstesOpen === 1, JSON.stringify(f))
    p('Hoch im Fenster: ohne Kerzen null', hochImFenster([], von, von + 1) === null)

    const jetzt = von + 3 * 86400e3
    p('lebt: gehandelt in sechs Stunden', lebtNoch({ markt: { liquiditaetUsd: 5000, transaktionen6h: 12 } }) === 1)
    // Gesperrte Liquidität hält einen toten Token sonst für immer am Leben.
    p('lebt nicht: Paar mit Liquidität, aber kaum Handel', lebtNoch({ markt: { liquiditaetUsd: 5000, transaktionen6h: 2 } }) === 0)
    p('lebt nicht: leerer Pool', lebtNoch({ markt: { liquiditaetUsd: 0, transaktionen6h: 40 } }) === 0)
    p('Kurve: letzter Handel vor einer Stunde', lebtNoch({ coin: { last_trade_timestamp: jetzt - 3600e3 }, jetzt }) === 1)
    p('Kurve: letzter Handel vor sieben Stunden', lebtNoch({ coin: { last_trade_timestamp: jetzt - 7 * 3600e3 }, jetzt }) === 0)
    p('weder DexScreener noch pump.fun kennt ihn: weg', lebtNoch({}) === 0)
    p('Paar ohne Angabe zum Handel: unbekannt, nicht tot', lebtNoch({ markt: { liquiditaetUsd: null } }) === null)

    p('Rendite: Preis gegen Preis', renditeGleichesMass({ preisStart: 2, mcapStart: 100 }, { preisEnde: 3, mcapEnde: 900 }).mass === 'preis')
    const bew = renditeGleichesMass({ preisStart: null, mcapStart: 100 }, { preisEnde: 3, mcapEnde: 150 })
    p('Rendite: ohne Startpreis Bewertung gegen Bewertung, nie gemischt', bew.mass === 'bewertung' && bew.renditePct === 50)
    p('Rendite: eine Null ist keine Messung', renditeGleichesMass({ preisStart: 0, mcapStart: 0 }, { preisEnde: 3, mcapEnde: 9 }).renditePct === null)
}

// ── Coin-Radar: Rückstand ausdünnen ─────────────────────────────────────
{
    const h = Date.parse('2026-10-01T10:00:00Z')
    const weg = duenneLaeufe([
        { laufId: 1, am: h }, { laufId: 2, am: h + 5 * 60e3 }, { laufId: 3, am: h + 55 * 60e3 }, { laufId: 4, am: h + 61 * 60e3 },
    ])
    p('je Stunde bleibt der erste Lauf', weg.join() === '2,3', weg.join())
    p('Warteschlange je Art: Frühphase und Hype haben eigene Plätze', DECKEL_JE_ART.frueh > 0 && DECKEL_JE_ART.hype > 0)
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
