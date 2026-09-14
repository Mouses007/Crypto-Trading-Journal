/**
 * Selbsttest der Strategie „Set and Forget".
 *
 *   node server/strategies/__selftest-setandforget.mjs
 *
 * Geprüft wird vor allem das, was still falsch sein kann:
 *
 *   • Die Zusammenfassung zur höheren Ebene muss an der ZEIT hängen, nicht an
 *     der Position im Array. Hinge sie am Index, rechnete dieselbe Strategie
 *     im Backtest (Fenster ab Historienbeginn) und live (wanderndes Fenster)
 *     mit verschiedenen Wochenkerzen — und niemand sähe es, weil beide Läufe
 *     für sich plausibel aussehen.
 *   • Eine Zone entsteht aus Hoch- UND Tiefpunkten gemeinsam; getrennt
 *     gezählt scheitert jede zweite knapp an der Schwelle.
 *   • Die Formationsliste ist abschliessend: was das Regelwerk durchstreicht
 *     (Doji, Spinning Top), darf keinen Einstieg auslösen.
 *   • Der Einstieg liegt zur ERÖFFNUNG DER KERZE NACH dem Signal. Eine Kerze
 *     zu früh wäre ein Blick in die Zukunft und würde jeden Backtest schönen.
 *   • Fehlen die Kerzen der höheren Zeiteinheit, wird NICHT gehandelt.
 */

import strategie, { strukturTrend, trendZustand, findeZonen, zonenMasse, zonenTreffer, musterTreffer, zielZone, kerzenAbstand } from './set_and_forget.js'
import { aggregiereKerzen, koerperKerzen } from './indicators.js'
import { defaultsFromSchema } from './index.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const P = defaultsFromSchema(strategie.params)
const TF = 3600000
const T0 = 1700000000000      // 14.11.2023 22:13 UTC, bewusst KEIN runder Blockanfang

const kerze = (t, o, h, l, c) => ({ t, o, h, l, c, v: 100, closeTime: t + TF - 1 })
/** Reihe aus [o,h,l,c]-Zeilen, eine Kerze je Zeiteinheit. */
const reihe = (rows, tf = TF, t0 = T0) => rows.map((r, i) => kerze(t0 + i * tf, r[0], r[1], r[2], r[3]))

console.log('\nSet and Forget — Selbsttest\n')

// ── Zusammenfassung zur höheren Ebene ────────────────────────────────────
{
    console.log('Zusammenfassung zur höheren Ebene')
    const tag = 86400000
    // Sieben Tageskerzen ab einem beliebigen Zeitpunkt.
    const roh = reihe([[1, 2, 0.5, 1.5], [1.5, 3, 1, 2], [2, 4, 1.8, 3],
                       [3, 3.5, 2, 2.5], [2.5, 5, 2.4, 4], [4, 4.5, 3, 3.5],
                       [3.5, 6, 3.4, 5]], tag, 0)
    const w = aggregiereKerzen(roh, tag, 7)
    check('sieben Tageskerzen ab Blockanfang ergeben eine Wochenkerze', w.length === 1, JSON.stringify(w))
    check('Wochenkerze übernimmt Eröffnung, Hoch, Tief, Schluss',
        w[0] && w[0].o === 1 && w[0].h === 6 && w[0].l === 0.5 && w[0].c === 5, JSON.stringify(w[0]))

    const angeschnitten = aggregiereKerzen(roh.slice(0, 6), tag, 7)
    check('ein unvollständiger Block zählt nicht', angeschnitten.length === 0, JSON.stringify(angeschnitten))

    // DIE Prüfung: derselbe Kerzenstab, zwei verschiedene Ausschnitte.
    const lang = reihe(Array.from({ length: 30 }, (_, i) => [i, i + 1, i - 1, i + 0.5]), tag, 5 * tag)
    const ganz = aggregiereKerzen(lang, tag, 7)
    const teil = aggregiereKerzen(lang.slice(9), tag, 7)
    const gemeinsam = ganz.filter((b) => teil.some((x) => x.t === b.t))
    check('gleiche Blockgrenzen aus verschiedenen Ausschnitten',
        gemeinsam.length > 0 && gemeinsam.every((b) => {
            const g = teil.find((x) => x.t === b.t)
            return g.o === b.o && g.h === b.h && g.l === b.l && g.c === b.c
        }), `${ganz.length} / ${teil.length} Blöcke`)

    check('Kerzenabstand wird aus den Daten erkannt', kerzenAbstand(lang) === tag, String(kerzenAbstand(lang)))
    const mitLuecke = [...lang.slice(0, 5), ...lang.slice(8)]
    check('eine Lücke verschiebt den erkannten Abstand nicht', kerzenAbstand(mitLuecke) === tag, String(kerzenAbstand(mitLuecke)))
}

// ── Trendrichtung aus der Struktur ───────────────────────────────────────
{
    console.log('\nTrendrichtung')
    const p = { ...P, pivotLinks: 1, pivotRechts: 1 }
    // Zickzack aufwärts: jedes Hoch und jedes Tief über dem vorigen.
    const auf = reihe([[10, 10, 10, 10], [12, 12, 12, 12], [11, 11, 11, 11], [14, 14, 14, 14],
                       [13, 13, 13, 13], [16, 16, 16, 16], [15, 15, 15, 15], [18, 18, 18, 18], [17, 17, 17, 17]])
    check('höheres Hoch und höheres Tief ergeben Aufwärtstrend',
        strukturTrend(koerperKerzen(auf), p.pivotLinks, p.pivotRechts) === 1,
        String(strukturTrend(koerperKerzen(auf), 1, 1)))

    const ab = reihe([[18, 18, 18, 18], [16, 16, 16, 16], [17, 17, 17, 17], [14, 14, 14, 14],
                      [15, 15, 15, 15], [12, 12, 12, 12], [13, 13, 13, 13], [10, 10, 10, 10], [11, 11, 11, 11]])
    check('tieferes Hoch und tieferes Tief ergeben Abwärtstrend',
        strukturTrend(koerperKerzen(ab), 1, 1) === -1, String(strukturTrend(koerperKerzen(ab), 1, 1)))

    // Höhere Hochs, aber tiefere Tiefs — eine sich weitende Spanne, keine Richtung.
    const spanne = reihe([[10, 10, 10, 10], [12, 12, 12, 12], [9, 9, 9, 9], [14, 14, 14, 14],
                          [8, 8, 8, 8], [16, 16, 16, 16], [7, 7, 7, 7], [18, 18, 18, 18], [6, 6, 6, 6]])
    check('weitende Spanne ist KEIN Trend',
        strukturTrend(koerperKerzen(spanne), 1, 1) === 0, String(strukturTrend(koerperKerzen(spanne), 1, 1)))

    check('zu wenige Wendepunkte ergeben keine Richtung',
        strukturTrend(koerperKerzen(reihe([[10, 10, 10, 10], [11, 11, 11, 11], [10, 10, 10, 10]])), 1, 1) === 0)

    // Dochte dürfen die Struktur nicht bestimmen: identische Körper, wilde
    // Dochte — der Linienchart sieht hier keinen Trend.
    const dochte = reihe([[10, 30, 1, 10], [10, 31, 2, 10], [10, 29, 0.5, 10],
                          [10, 33, 1, 10], [10, 28, 3, 10], [10, 35, 1, 10], [10, 27, 2, 10]])
    check('Dochte allein erzeugen keinen Trend (Linienchart)',
        strukturTrend(koerperKerzen(dochte), 1, 1) === 0, String(strukturTrend(koerperKerzen(dochte), 1, 1)))
}

// ── Trend als Zustand ────────────────────────────────────────────────────
{
    console.log('\nTrend als Zustand')
    // Aufwärts, dann eine Spanne: die letzten beiden Wendepunkte tragen keine
    // Richtung mehr, aber gebrochen wurde nichts. Das Video sieht hier weiter
    // einen Aufwärtstrend — die Momentaufnahme nicht.
    const haelt = koerperKerzen(reihe([
        [10, 10, 10, 10], [12, 12, 12, 12], [11, 11, 11, 11], [14, 14, 14, 14],
        [13, 13, 13, 13], [16, 16, 16, 16], [13.5, 13.5, 13.5, 13.5], [15, 15, 15, 15],
        [13.2, 13.2, 13.2, 13.2], [15.5, 15.5, 15.5, 15.5], [14, 14, 14, 14],
    ]))
    check('der Trend besteht fort, solange nichts gebrochen ist',
        trendZustand(haelt, 1, 1) === 1, String(trendZustand(haelt, 1, 1)))
    check('… wo die Momentaufnahme längst „keine Richtung" sagt',
        strukturTrend(haelt, 1, 1) === 0, String(strukturTrend(haelt, 1, 1)))

    // Dieselbe Reihe, aber der Schlusskurs fällt unter das letzte höhere Tief.
    const bricht = koerperKerzen(reihe([
        [10, 10, 10, 10], [12, 12, 12, 12], [11, 11, 11, 11], [14, 14, 14, 14],
        [13, 13, 13, 13], [16, 16, 16, 16], [13.5, 13.5, 13.5, 13.5], [15, 15, 15, 15],
        [12.9, 12.9, 12.9, 12.9], [15.5, 15.5, 15.5, 15.5], [12.5, 12.5, 12.5, 12.5],
    ]))
    check('der Bruch des letzten höheren Tiefs dreht den Trend',
        trendZustand(bricht, 1, 1) === -1, String(trendZustand(bricht, 1, 1)))

    check('ohne vollständiges Paar bleibt der Zustand unbestimmt',
        trendZustand(koerperKerzen(reihe([[10, 10, 10, 10], [11, 11, 11, 11], [10, 10, 10, 10]])), 1, 1) === 0)
}

// ── Zonen ────────────────────────────────────────────────────────────────
{
    console.log('\nZonen')
    const p = { ...P, pivotLinks: 1, pivotRechts: 1, zonenBeruehrungen: 3, zonenToleranzPct: 0.5 }
    // Dreimal von 100 nach unten abgeprallt, dazwischen Hochs weit oben.
    const rows = []
    for (let i = 0; i < 3; i++) rows.push([105, 105, 105, 105], [100, 100, 100, 100], [106, 106, 106, 106])
    const k = reihe(rows)
    const zonen = findeZonen(k, p)
    const bei100 = zonen.find((z) => z.tief <= 100 && z.hoch >= 100)
    check('drei Wendepunkte auf einer Höhe ergeben eine Zone', Boolean(bei100), JSON.stringify(zonen))

    const streng = findeZonen(k, { ...p, zonenBeruehrungen: 4 })
    check('zwei Berührungen zu wenig — keine Zone',
        !streng.some((z) => z.tief <= 100 && z.hoch >= 100), JSON.stringify(streng))

    // Hoch- und Tiefpunkte auf gleicher Höhe zählen gemeinsam: zweimal als
    // Unterstützung, einmal als Widerstand.
    const gemischt = reihe([[95, 95, 95, 95], [100, 100, 100, 100], [95, 95, 95, 95],
                            [100, 100, 100, 100], [95, 95, 95, 95], [104, 104, 104, 104],
                            [100, 100, 100, 100], [104, 104, 104, 104]])
    const zg = findeZonen(gemischt, p)
    check('Hoch- und Tiefpunkte bilden gemeinsam eine Zone',
        zg.some((z) => z.tief <= 100.2 && z.hoch >= 99.8), JSON.stringify(zg))

    const breit = findeZonen(k, { ...p, zonenMaxBreitePct: 0.05, zonenMinBreitePct: 0.01 })
    check('die Breite wird gekappt',
        breit.every((z) => (z.hoch - z.tief) / z.mitte * 100 <= 0.051), JSON.stringify(breit))
    const schmal = findeZonen(k, { ...p, zonenMinBreitePct: 0.4, zonenMaxBreitePct: 2 })
    check('die Breite wird auf das Mindestmass gebracht',
        schmal.every((z) => (z.hoch - z.tief) / z.mitte * 100 >= 0.39), JSON.stringify(schmal))
}

// ── Massstab der Zonen ───────────────────────────────────────────────────
{
    console.log('\nMassstab der Zonen')
    const p = { ...P, pivotLinks: 1, pivotRechts: 1, zonenBeruehrungen: 3, zonenAtrLaenge: 3 }

    // Dieselbe Marktbewegung, einmal ruhig und einmal fünfmal so beweglich —
    // gleiches Preisniveau, gleiche Anzahl Wendepunkte, nur andere Spanne.
    const bauen = (streuung) => {
        const rows = []
        // Die Wendepunkte streuen proportional zur Beweglichkeit — genau das
        // ist der Fall, für den ein fester Prozentsatz nicht taugt.
        for (let i = 0; i < 6; i++) {
            const hoch = 100 + 5 * streuung
            rows.push([hoch, hoch + streuung, hoch - streuung, hoch])
            const tief = 100 + i * 0.3 * streuung
            rows.push([tief, tief + streuung, tief - streuung, tief])
        }
        rows.push([120, 120, 120, 120])
        return reihe(rows)
    }
    const ruhig = bauen(0.2)
    const bewegt = bauen(1.0)

    const mRuhig = zonenMasse(ruhig, p)
    const mBewegt = zonenMasse(bewegt, p)
    check('der bewegte Markt bekommt den grösseren Massstab',
        mBewegt.atrPct > mRuhig.atrPct * 3, `${mRuhig.atrPct?.toFixed(3)} gegen ${mBewegt.atrPct?.toFixed(3)}`)
    check('im ATR-Massstab findet BEIDE Märkte dieselbe Zonenzahl',
        findeZonen(ruhig, p).length === findeZonen(bewegt, p).length,
        `${findeZonen(ruhig, p).length} gegen ${findeZonen(bewegt, p).length}`)

    const fest = { ...p, zonenMassstab: 'prozent', zonenToleranzPct: 0.35 }
    check('mit festem Prozentsatz zerfällt die Zone des bewegten Marktes',
        findeZonen(ruhig, fest).length > findeZonen(bewegt, fest).length,
        `${findeZonen(ruhig, fest).length} gegen ${findeZonen(bewegt, fest).length}`)

    // Ohne brauchbare ATR (flache Kerzen) muss der Prozentsatz einspringen,
    // sonst zöge eine ATR von null jede Zone auf einen Strich zusammen.
    const flach = reihe([[100, 100, 100, 100], [101, 101, 101, 101], [100, 100, 100, 100],
                         [101, 101, 101, 101], [100, 100, 100, 100], [101, 101, 101, 101]])
    const mFlach = zonenMasse(flach, p)
    check('ohne ATR fällt der Prozentsatz ein',
        mFlach.atrPct === null && mFlach.toleranz === P.zonenToleranzPct,
        JSON.stringify(mFlach))
}

// ── Test der Zone ────────────────────────────────────────────────────────
{
    console.log('\nAntesten der Zone')
    const zone = { tief: 99.5, hoch: 100.5, mitte: 100, punkte: 3, letzterIndex: 0 }
    check('Long: Tief in der Zone, Schluss darüber → Treffer',
        zonenTreffer(zone, kerze(0, 101, 101.5, 99.6, 100.4), true, 0.1))
    check('Long: Schluss UNTER der Zone ist ein Durchbruch, kein Test',
        !zonenTreffer(zone, kerze(0, 101, 101.5, 98, 98.5), true, 0.1))
    check('Long: Kerze weit über der Zone zählt nicht',
        !zonenTreffer(zone, kerze(0, 110, 111, 109, 110), true, 0.1))
    check('Short: Hoch in der Zone, Schluss darunter → Treffer',
        zonenTreffer(zone, kerze(0, 99, 100.4, 98.5, 99.6), false, 0.1))
    check('Short: Schluss ÜBER der Zone ist ein Durchbruch',
        !zonenTreffer(zone, kerze(0, 99, 102, 98.5, 101.8), false, 0.1))
}

// ── Formationen ──────────────────────────────────────────────────────────
{
    console.log('\nFormationen')
    const p = { ...P }
    // [vorvor, vor, signal]
    const mit = (rows, long) => musterTreffer(reihe(rows), rows.length - 1, long, p)

    check('Bullish Engulfing zählt',
        mit([[10, 10, 10, 10], [10, 10.1, 9.4, 9.5], [9.4, 10.6, 9.3, 10.5]], true) === 'bullish_engulfing',
        String(mit([[10, 10, 10, 10], [10, 10.1, 9.4, 9.5], [9.4, 10.6, 9.3, 10.5]], true)))
    check('Hammer zählt',
        mit([[10, 10, 10, 10], [10, 10, 10, 10], [10, 10.02, 9, 9.95]], true) === 'hammer',
        String(mit([[10, 10, 10, 10], [10, 10, 10, 10], [10, 10.02, 9, 9.95]], true)))
    check('Shooting Star zählt (short)',
        mit([[10, 10, 10, 10], [10, 10, 10, 10], [10, 11, 9.95, 10.05]], false) === 'shooting_star',
        String(mit([[10, 10, 10, 10], [10, 10, 10, 10], [10, 11, 9.95, 10.05]], false)))
    check('Morning Star zählt',
        mit([[10, 10.1, 9, 9.1], [8.8, 8.9, 8.6, 8.85], [8.9, 9.8, 8.9, 9.7]], true) === 'morning_star',
        String(mit([[10, 10.1, 9, 9.1], [8.8, 8.9, 8.6, 8.85], [8.9, 9.8, 8.9, 9.7]], true)))

    // Verbotene Formationen: symmetrischer Doji und Spinning Top.
    check('gewöhnlicher Doji löst NICHTS aus',
        mit([[10, 10, 10, 10], [10, 10, 10, 10], [10, 10.5, 9.5, 10]], true) === null,
        String(mit([[10, 10, 10, 10], [10, 10, 10, 10], [10, 10.5, 9.5, 10]], true)))
    check('Spinning Top löst NICHTS aus',
        mit([[10, 10, 10, 10], [10, 10, 10, 10], [10, 10.6, 9.4, 10.1]], true) === null,
        String(mit([[10, 10, 10, 10], [10, 10, 10, 10], [10, 10.6, 9.4, 10.1]], true)))
    check('Dark Cloud Cover löst NICHTS aus (short)',
        mit([[9, 9, 9, 9], [9, 10.2, 8.9, 10], [10.3, 10.4, 9.3, 9.4]], false) === null,
        String(mit([[9, 9, 9, 9], [9, 10.2, 8.9, 10], [10.3, 10.4, 9.3, 9.4]], false)))
    check('abgeschaltete Formation löst nicht mehr aus',
        musterTreffer(reihe([[10, 10, 10, 10], [10, 10, 10, 10], [10, 10.02, 9, 9.95]]), 2, true,
            { ...p, musterDocht: false, musterDoji: false }) === null)
}

// ── Zielzone ─────────────────────────────────────────────────────────────
{
    console.log('\nZielzone')
    const zonen = [
        { tief: 90, hoch: 91, mitte: 90.5 },
        { tief: 99, hoch: 101, mitte: 100 },
        { tief: 105, hoch: 106, mitte: 105.5 },
        { tief: 120, hoch: 121, mitte: 120.5 },
    ]
    check('Long zielt auf die UNTERKANTE der nächsten Zone darüber',
        zielZone(zonen, 100.5, true)?.tief === 105, JSON.stringify(zielZone(zonen, 100.5, true)))
    check('Short zielt auf die OBERKANTE der nächsten Zone darunter',
        zielZone(zonen, 99.5, false)?.hoch === 91, JSON.stringify(zielZone(zonen, 99.5, false)))
    check('die eigene Zone ist kein Ziel',
        zielZone(zonen, 100, true)?.tief === 105)
    check('ohne Zone in Richtung gibt es kein Ziel',
        zielZone(zonen, 200, true) === null)
}

// ── detect: der ganze Weg ────────────────────────────────────────────────
/**
 * Bildet die Buchführung des Backtests nach — wachsendes Fenster, offene
 * Setups weiterreichen. Nur so zeigt sich, in welcher Kerze eingestiegen wird.
 */
function replay(candles, params, htf) {
    let offene = []
    const ausgeloest = []
    const bekannt = new Set()
    let id = 1
    for (let n = 5; n <= candles.length; n++) {
        const sicht = candles.slice(0, n)
        const bis = sicht[sicht.length - 1].t
        const htfSicht = htf ? htf.filter((h) => h.t + 86400000 <= bis + TF) : null
        const { setups = [], events = [] } = strategie.detect({
            candles: sicht, params, openSetups: offene, knownSetupKeys: [...bekannt], htfCandles: htfSicht,
        })
        for (const s of setups) {
            const setup = { ...s, id: id++ }
            offene.push(setup)
            bekannt.add(`${s.direction}|${s.obCandleTime}`)
        }
        for (const ev of events) {
            const setup = offene.find((s) => s.id === ev.id)
            offene = offene.filter((s) => s.id !== ev.id)
            if (setup && ev.status === 'triggered') ausgeloest.push({ ...setup, ...ev })
        }
    }
    return ausgeloest
}

{
    console.log('\ndetect')
    const tag = 86400000
    const p = {
        ...P, pivotLinks: 1, pivotRechts: 1, zonenBeruehrungen: 3, zonenToleranzPct: 0.6,
        zweiteEbene: false, tpQuelle: 'rr', minRR: 0, direction: 'long', slPufferPct: 0,
        zoneNaehePct: 0.2, zonenMaxBreitePct: 1,
    }

    // Tageskerzen: Aufwärtsstruktur (höhere Hochs, höhere Tiefs) und dabei
    // sechs Wendepunkte dicht über 100 — das ist die Zone.
    const htf = reihe([
        [106, 106, 106, 106], [100.0, 100.0, 100.0, 100.0], [107, 107, 107, 107],
        [100.1, 100.1, 100.1, 100.1], [108, 108, 108, 108], [100.2, 100.2, 100.2, 100.2],
        [109, 109, 109, 109], [100.3, 100.3, 100.3, 100.3], [110, 110, 110, 110],
        [100.4, 100.4, 100.4, 100.4], [111, 111, 111, 111], [100.5, 100.5, 100.5, 100.5],
        [112, 112, 112, 112],
    ], tag, 0)
    const trend = strukturTrend(koerperKerzen(htf), 1, 1)
    check('Testaufbau: die höhere Ebene steht im Aufwärtstrend', trend === 1, String(trend))
    const zonen = findeZonen(htf, p)
    check('Testaufbau: die Zone bei 100 wird gefunden',
        zonen.some((z) => z.tief <= 100.1 && z.hoch >= 100.4), JSON.stringify(zonen))

    // Stundenkerzen: Anlauf von oben auf 100, Hammer, dann Eröffnung darüber.
    const ltf = reihe([
        [112, 112, 112, 112], [111, 111.2, 110, 110.5], [110, 110.2, 109, 109.5],
        [109, 109.2, 108, 108.5], [108, 108.2, 107, 107.5], [107, 107.2, 106, 106.5],
        [106, 106.2, 105, 105.5], [105, 105.2, 103, 103.5], [103, 103.2, 101, 101.5],
        [100.6, 100.62, 99.6, 100.55],   // Hammer an der Zone
        [100.8, 103, 100.7, 102.5],      // Einstiegskerze — Eröffnung 100.8
        [102.5, 106, 102, 105.5],
        [105.5, 108, 105, 107.5],
    ], TF, 25 * tag)   // 26.01.1970 — ein Montag, damit die Sperre prüfbar ist

    const trades = replay(ltf, p, htf)
    check('ein Long-Setup wird ausgelöst', trades.length === 1, JSON.stringify(trades.map((t) => t.confirmations)))
    const t = trades[0]
    check('Einstieg zur ERÖFFNUNG der Kerze nach dem Signal', t && t.entry === 100.8, String(t?.entry))
    check('Einstieg liegt zeitlich NACH der Signalkerze', t && t.triggeredAt > t.obCandleTime,
        `${t?.triggeredAt} > ${t?.obCandleTime}`)
    check('Formation ist vermerkt', t?.confirmations?.muster === 'hammer', JSON.stringify(t?.confirmations))
    check('Stop liegt unter dem Docht der Signalkerze', t && t.stopLoss <= 99.6 && t.stopLoss > 98,
        String(t?.stopLoss))
    check('Ziel folgt dem eingestellten Chance/Risiko',
        t && Math.abs((t.takeProfit - t.entry) / (t.entry - t.stopLoss) - p.tpRR) < 0.01,
        `${t?.entry} / ${t?.stopLoss} / ${t?.takeProfit}`)

    // Gegen den Trend wird nicht gehandelt.
    const short = replay(ltf, { ...p, direction: 'short' }, htf)
    check('gegen den Trend entsteht kein Trade', short.length === 0, JSON.stringify(short.length))

    // Ohne Kerzen der höheren Zeiteinheit: kein Trade, und der Grund steht im Trichter.
    const ohne = strategie.detect({ candles: ltf, params: p, openSetups: [], knownSetupKeys: [], htfCandles: null })
    check('ohne HTF-Kerzen entsteht kein Setup', ohne.setups.length === 0)
    check('der fehlende HTF-Stand steht im Trichter',
        ohne.diagnostics.rejected.htf_data_missing === 1, JSON.stringify(ohne.diagnostics.rejected))

    // Mindest-Chance/Risiko: ein unerreichbares Ziel lehnt den Trade ab.
    const streng = replay(ltf, { ...p, minRR: 99 }, htf)
    check('unter dem Mindest-Chance/Risiko wird nicht gehandelt', streng.length === 0, String(streng.length))

    // Wochentagssperre trifft den EINSTIEG.
    const tagDerKerze = new Date(ltf[10].t).getUTCDay()
    const sperrSchalter = { 0: 'sperreSonntag', 1: 'sperreMontag', 6: 'sperreSamstag' }[tagDerKerze]
    if (sperrSchalter) {
        const gesperrt = replay(ltf, { ...p, [sperrSchalter]: true }, htf)
        check(`Wochentagssperre (${sperrSchalter}) verhindert den Einstieg`, gesperrt.length === 0, String(gesperrt.length))
    } else {
        check('Wochentagssperre: Einstiegskerze liegt auf einem nicht sperrbaren Tag (übersprungen)', true)
    }
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
