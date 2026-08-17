/**
 * Selbsttest der Sitzungs-Auswertung.
 *
 *   node src/utils/__selftest-sitzung-statistik.mjs
 *
 * Die Zahlen dieser Seite sollen Verhalten ändern („Dienstag kostet dich Geld"),
 * deshalb muss festhängen, wann sie eine Aussage machen und wann nicht:
 *
 *  - laufende und abgebrochene Sitzungen zählen NIE mit
 *  - archivierte zählen SEHR WOHL mit — sonst liesse sich die Quote aufräumen
 *  - Gruppen unter der Mindestzahl sind als `duenn` gekennzeichnet
 *  - fehlende Grenzen ergeben `null`, nicht 0
 */

import {
    werteAus, disziplinVerlauf, nachZeit, planWirkung, nachUmfang,
    nurBeendete, hatPlan, dauerMin, MIN_GRUPPE,
} from './sitzungStatistik.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** Feste Bezugszeit: Montag, 17.08.2026, 10:00 Ortszeit. */
const MO_10 = new Date(2026, 7, 17, 10, 0, 0).getTime()
const STUNDE = 3600000

/** Sitzung bauen. Vorgabe: beendet, eine Stunde lang, mit Plan, eingehalten. */
const s = (o = {}) => ({
    status: 'beendet',
    startUnix: MO_10,
    endUnix: MO_10 + STUNDE,
    symbol: 'BTCUSDT',
    planMaxVerlustUsd: 100,
    planMaxTrades: 5,
    pnlUsd: 10,
    tradeAnzahl: 2,
    planVerletzt: 0,
    archiviert: 0,
    protokoll: [],
    ...o,
})

/** n gleichartige Sitzungen, jede eine Stunde später — damit sie unterscheidbar sind. */
const viele = (n, o = {}) => Array.from({ length: n }, (_, i) =>
    s({ startUnix: MO_10 + i * STUNDE, endUnix: MO_10 + i * STUNDE + STUNDE, ...o }))

console.log('\nSitzungs-Auswertung — Selbsttest\n')

// ── Welche Sitzungen zählen ──────────────────────────────────────────────
console.log('Auswahl')
{
    const gemischt = [
        s(),
        s({ status: 'laufend', endUnix: 0 }),
        s({ status: 'abgebrochen' }),
        s({ status: 'beendet', endUnix: 0 }),   // beendet, aber ohne Ende: unbrauchbar
    ]
    check('nur beendete mit Endzeitpunkt zählen', nurBeendete(gemischt).length === 1,
        String(nurBeendete(gemischt).length))

    check('archivierte zählen mit', nurBeendete([s({ archiviert: 1 })]).length === 1)
    check('… und gehen in die Gesamtbilanz ein',
        werteAus([s({ archiviert: 1, pnlUsd: 50 })]).gesamt.pnlUsd === 50)

    check('leere Eingabe wirft nicht',
        (() => { const a = werteAus([]); return a.gesamt.anzahl === 0 })())
    check('null wirft nicht', (() => { const a = werteAus(null); return a.gesamt.anzahl === 0 })())
    check('Einträge, die null sind, werden übersprungen',
        nurBeendete([null, s(), undefined]).length === 1)
}

console.log('\nPlan erkannt')
{
    check('Verlustgrenze allein zählt als Plan', hatPlan(s({ planMaxTrades: 0 })) === true)
    check('Trade-Grenze allein zählt als Plan', hatPlan(s({ planMaxVerlustUsd: 0 })) === true)
    check('beide auf 0 = kein Plan',
        hatPlan(s({ planMaxVerlustUsd: 0, planMaxTrades: 0 })) === false)
}

console.log('\nDauer')
{
    check('eine Stunde ergibt 60 Minuten', dauerMin(s()) === 60, String(dauerMin(s())))
    check('laufende Sitzung hat KEINE Dauer (nicht 0)',
        dauerMin(s({ endUnix: 0 })) === null, String(dauerMin(s({ endUnix: 0 }))))
    check('Ende vor Beginn ergibt keine Dauer',
        dauerMin(s({ endUnix: MO_10 - 1000 })) === null)
}

// ── 1. Disziplin ─────────────────────────────────────────────────────────
console.log('\nDisziplin über die Zeit')
{
    const d = disziplinVerlauf([
        ...viele(3, { planVerletzt: 0 }),
        s({ startUnix: MO_10 + 3 * STUNDE, endUnix: MO_10 + 4 * STUNDE, planVerletzt: 1, pnlUsd: -200 }),
    ])
    check('vier Sitzungen mit Plan', d.anzahl === 4, String(d.anzahl))
    check('drei gehalten', d.gehalten === 3, String(d.gehalten))
    check('Quote 0.75', Math.abs(d.quote - 0.75) < 1e-9, String(d.quote))
    check('laufende Quote steigt und fällt richtig',
        d.punkte[0].quote === 1 && Math.abs(d.punkte[3].quote - 0.75) < 1e-9)
    check('Punkte sind zeitlich aufsteigend',
        d.punkte.every((p, i) => i === 0 || p.t >= d.punkte[i - 1].t))
    check('Grund erkannt: Verlustgrenze gerissen', d.gruende.verlust === 1, String(d.gruende.verlust))
    check('Trade-Grenze wurde NICHT gerissen', d.gruende.trades === 0)

    const nurTrades = disziplinVerlauf([
        s({ planVerletzt: 1, tradeAnzahl: 9, planMaxTrades: 5, pnlUsd: 5 }),
    ])
    check('zu viele Trades wird als eigener Grund gezählt',
        nurTrades.gruende.trades === 1 && nurTrades.gruende.verlust === 0)

    check('Sitzungen ohne Plan tauchen in der Disziplin nicht auf',
        disziplinVerlauf([s({ planMaxVerlustUsd: 0, planMaxTrades: 0 })]).anzahl === 0)
    check('ohne Sitzungen mit Plan ist die Quote null, nicht 0',
        disziplinVerlauf([]).quote === null)
    check(`unter ${MIN_GRUPPE} Sitzungen ist die Quote als dünn markiert`,
        disziplinVerlauf(viele(MIN_GRUPPE - 1)).duenn === true)
    check(`ab ${MIN_GRUPPE} Sitzungen nicht mehr`,
        disziplinVerlauf(viele(MIN_GRUPPE)).duenn === false)
}

// ── 2. Zeit ──────────────────────────────────────────────────────────────
console.log('\nTageszeit und Wochentag')
{
    const z = nachZeit([
        s({ startUnix: new Date(2026, 7, 17, 10, 0).getTime(), endUnix: new Date(2026, 7, 17, 11, 0).getTime(), pnlUsd: 10 }),
        s({ startUnix: new Date(2026, 7, 18, 10, 30).getTime(), endUnix: new Date(2026, 7, 18, 11, 0).getTime(), pnlUsd: -30 }),
        s({ startUnix: new Date(2026, 7, 19, 15, 0).getTime(), endUnix: new Date(2026, 7, 19, 16, 0).getTime(), pnlUsd: 5 }),
    ])
    const zehn = z.stunden.find(x => x.stunde === 10)
    check('zwei Sitzungen in der 10-Uhr-Stunde', zehn.anzahl === 2, String(zehn?.anzahl))
    check('deren P&L summiert', zehn.pnlUsd === -20, String(zehn.pnlUsd))
    check('Durchschnitt je Sitzung', zehn.pnlJeSitzung === -10, String(zehn.pnlJeSitzung))
    check('Stunden aufsteigend sortiert',
        z.stunden.every((x, i) => i === 0 || x.stunde > z.stunden[i - 1].stunde))
    check('kleine Gruppen sind als dünn markiert', zehn.duenn === true)

    check('Wochentage beginnen mit Montag',
        z.wochentage[0].name === 'Mo', z.wochentage[0]?.name)
    check('drei verschiedene Wochentage', z.wochentage.length === 3, String(z.wochentage.length))

    const so = nachZeit([s({ startUnix: new Date(2026, 7, 16, 12, 0).getTime(), endUnix: new Date(2026, 7, 16, 13, 0).getTime() })])
    check('Sonntag wird als So geführt', so.wochentage[0].name === 'So', so.wochentage[0]?.name)
}

// ── 3. Plan gegen kein Plan ──────────────────────────────────────────────
console.log('\nMit Plan gegen ohne Plan')
{
    const p = planWirkung([
        ...viele(MIN_GRUPPE, { pnlUsd: 20 }),
        ...viele(MIN_GRUPPE, { planMaxVerlustUsd: 0, planMaxTrades: 0, pnlUsd: -10 }),
    ])
    check('beide Gruppen gefüllt', p.mit.anzahl === MIN_GRUPPE && p.ohne.anzahl === MIN_GRUPPE)
    check('Durchschnitt mit Plan', p.mit.pnlJeSitzung === 20, String(p.mit.pnlJeSitzung))
    check('Durchschnitt ohne Plan', p.ohne.pnlJeSitzung === -10, String(p.ohne.pnlJeSitzung))
    check('Unterschied je Sitzung ausgewiesen',
        p.unterschiedJeSitzung === 30, String(p.unterschiedJeSitzung))

    const duenn = planWirkung([...viele(2, { pnlUsd: 20 }), s({ planMaxVerlustUsd: 0, planMaxTrades: 0 })])
    check('bei zu dünner Gruppe KEIN Unterschied ausgewiesen',
        duenn.unterschiedJeSitzung === null, String(duenn.unterschiedJeSitzung))

    check('Disziplin einer Gruppe ohne Plan ist null, nicht 0',
        planWirkung([s({ planMaxVerlustUsd: 0, planMaxTrades: 0 })]).ohne.disziplin === null)
}

// ── 4. Dauer und Überhandeln ─────────────────────────────────────────────
console.log('\nDauer und Trade-Zahl')
{
    const u = nachUmfang([
        s({ endUnix: MO_10 + 30 * 60000, tradeAnzahl: 0, pnlUsd: 1 }),      // 30 min, 0 Trades
        s({ endUnix: MO_10 + 3 * STUNDE, tradeAnzahl: 4, pnlUsd: -5 }),     // 3 h, 4 Trades
        s({ endUnix: MO_10 + 6 * STUNDE, tradeAnzahl: 9, pnlUsd: -50 }),    // 6 h, 9 Trades
    ])
    check('drei Dauerstufen belegt', u.dauer.length === 3, String(u.dauer.length))
    check('30 min landet in „bis 1 h"', u.dauer[0].label === 'bis 1 h', u.dauer[0]?.label)
    check('6 h landet in „über 4 h"',
        u.dauer[u.dauer.length - 1].label === 'über 4 h', u.dauer[u.dauer.length - 1]?.label)
    check('leere Stufen tauchen nicht auf', !u.dauer.some(x => x.anzahl === 0))

    check('0 Trades bekommen eine eigene Stufe',
        u.trades[0].label === 'keine' && u.trades[0].anzahl === 1)
    check('9 Trades landen in „6 und mehr"',
        u.trades[u.trades.length - 1].label === '6 und mehr')

    check('laufende Sitzung fehlt in der Dauerverteilung',
        nachUmfang([s({ status: 'laufend', endUnix: 0 })]).dauer.length === 0)
}

// ── Gesamtaufruf ─────────────────────────────────────────────────────────
console.log('\nGesamtaufruf')
{
    const a = werteAus(viele(5, { pnlUsd: 4, tradeAnzahl: 1 }))
    check('alle vier Blöcke vorhanden',
        !!a.disziplin && !!a.zeit && !!a.plan && !!a.umfang)
    check('Gesamt-P&L stimmt', a.gesamt.pnlUsd === 20, String(a.gesamt.pnlUsd))
    check('Gesamt-Trades stimmen', a.gesamt.trades === 5, String(a.gesamt.trades))
    check('Gewinner gezählt', a.gesamt.gewinner === 5)
    check('Gesamtgruppe nicht dünn', a.gesamt.duenn === false)

    const kaputt = werteAus([s({ pnlUsd: 'abc', tradeAnzahl: null })])
    check('unlesbare Beträge werden zu 0, nicht NaN',
        kaputt.gesamt.pnlUsd === 0 && !Number.isNaN(kaputt.gesamt.pnlUsd))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) {
    console.log(`\x1b[31mFehler: ${fehler.join(', ')}\x1b[0m\n`)
    process.exit(1)
}
console.log('')
