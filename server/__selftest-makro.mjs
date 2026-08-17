/**
 * Selbsttest des Makro-Moduls.
 *
 *   node server/__selftest-makro.mjs
 *
 * Zwei Dinge müssen hier unbedingt stimmen, weil sie sich im Betrieb nicht von
 * selbst verraten: die Angleichung auf gemeinsame Handelstage (sonst vergleicht
 * man Freitag→Montag der Nasdaq mit Sonntag→Montag von Bitcoin und bekommt eine
 * plausibel aussehende, aber falsche Korrelation) und dass `deltaAusReihe` aus
 * der Reihe rechnet statt aus Yahoos `chartPreviousClose`.
 */

import {
    reiheAusChart, deltaAusReihe, pearson, korrelationAusReihen,
    deuteKorrelation, stableFluss, zerlegeDominanz, waehleDominanzPunkte,
    KORR_MIN_PUNKTE,
} from './makro.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const nahe = (a, b, eps = 1e-9) => a !== null && Math.abs(a - b) < eps

/** Chart-Antwort im Yahoo-Format bauen (Zeitstempel in Sekunden). */
const chart = (paare, meta = {}) => ({
    chart: {
        result: [{
            meta: { regularMarketPrice: meta.preis, regularMarketTime: meta.zeit, shortName: meta.name },
            timestamp: paare.map(p => Math.floor(Date.parse(p[0] + 'T00:00:00Z') / 1000)),
            indicators: { quote: [{ close: paare.map(p => p[1]) }] },
        }],
    },
})

/** Tagesreihe aus einem Startdatum und Schlusskursen. */
const reihe = (start, werte) => werte.map((close, i) => {
    const d = new Date(Date.parse(start + 'T00:00:00Z') + i * 86400000)
    return { tag: d.toISOString().slice(0, 10), close }
})

console.log('\nMakro-Umfeld — Selbsttest\n')

// ── Yahoo-Antwort lesen ──────────────────────────────────────────────────
console.log('Chart-Antwort lesen')
{
    const j = chart([['2026-08-13', 7822.5], ['2026-08-14', 7805], ['2026-08-17', 7816.5]],
        { preis: 7816.5, zeit: 1786961982, name: 'E-Mini S&P 500' })
    const a = reiheAusChart(j)
    check('Tage und Schlusskurse werden gelesen',
        a.reihe.length === 3 && a.reihe[0].tag === '2026-08-13' && a.reihe[2].close === 7816.5)
    check('Zeit wird von Sekunden in Millisekunden umgerechnet', a.zeit === 1786961982000)
    check('Name kommt mit', a.name === 'E-Mini S&P 500')

    const mitLuecke = reiheAusChart(chart([['2026-08-13', 100], ['2026-08-14', null], ['2026-08-17', 102]]))
    check('null-Schlusskurse (Feiertag) fallen raus, statt als 0 zu zählen',
        mitLuecke.reihe.length === 2 && mitLuecke.reihe[1].close === 102)

    check('leere/kaputte Antwort kippt nicht um',
        reiheAusChart({}).reihe.length === 0 && reiheAusChart(null).preis === null)

    const ohneMeta = reiheAusChart(chart([['2026-08-17', 55]]))
    check('ohne Meta-Preis wird der letzte Schlusskurs genommen', ohneMeta.preis === 55)

    /*
     * Der Fall, der lange durchgerutscht ist: Yahoo schickt bei geschlossenen
     * Märkten und Aussetzern nicht `undefined`, sondern ein explizites `null`.
     * `Number(undefined)` ist NaN und fällt korrekt zurück — `Number(null)` ist
     * aber 0, und die ist endlich. Der Rückfall griff deshalb nie, und die
     * Makro-Kachel zeigte einen Kurs von 0 samt absurdem Tagesdelta.
     * Die Prüfung darüber deckt nur `undefined` ab; diese hier `null`.
     */
    const nullPreis = reiheAusChart(chart([['2026-08-13', 101], ['2026-08-17', 102]],
        { preis: null, zeit: null }))
    check('meta-Preis null → letzter Schlusskurs, NICHT 0',
        nullPreis.preis === 102, String(nullPreis.preis))
    check('meta-Zeit null → null, NICHT 0',
        nullPreis.zeit === null, String(nullPreis.zeit))
    check('… und das Delta bleibt dadurch brauchbar',
        nahe(deltaAusReihe(nullPreis.reihe), (102 - 101) / 101 * 100))

    const nullPreisLeer = reiheAusChart(chart([], { preis: null }))
    check('meta-Preis null ohne Reihe → null statt 0',
        nullPreisLeer.preis === null, String(nullPreisLeer.preis))

    const nullKurs = reiheAusChart(chart([['2026-08-17', 55]], { preis: 0, zeit: 0 }))
    check('ein gemeldeter Kurs von 0 gilt als fehlend', nullKurs.preis === 55)
    check('eine gemeldete Zeit von 0 gilt als fehlend', nullKurs.zeit === null)
}

// ── Veränderung zur Vorsitzung ───────────────────────────────────────────
console.log('\nVeränderung zur Vorsitzung')
{
    check('Delta = letzter gegen vorletzten Wert',
        nahe(deltaAusReihe(reihe('2026-08-10', [100, 110])), 10))
    check('fallend ergibt negatives Delta',
        nahe(deltaAusReihe(reihe('2026-08-10', [200, 190])), -5))
    check('eine einzelne Kerze ergibt kein Delta', deltaAusReihe(reihe('2026-08-10', [100])) === null)
    check('leere Reihe ergibt kein Delta', deltaAusReihe([]) === null)
}

// ── Pearson ──────────────────────────────────────────────────────────────
console.log('\nKorrelationsrechnung')
{
    check('gleichlaufende Reihen ergeben +1', nahe(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1, 1e-12))
    check('gegenläufige Reihen ergeben −1', nahe(pearson([1, 2, 3, 4], [8, 6, 4, 2]), -1, 1e-12))
    check('ohne Streuung ist sie nicht definiert', pearson([5, 5, 5, 5], [1, 2, 3, 4]) === null)
    check('ein einzelner Punkt ergibt nichts', pearson([1], [1]) === null)
    const r = pearson([0.01, -0.02, 0.03, -0.01, 0.02], [0.02, -0.01, 0.02, -0.03, 0.01])
    check('bleibt im Bereich −1…1', r !== null && r > -1 && r < 1)
}

// ── Angleichung auf gemeinsame Tage ──────────────────────────────────────
console.log('\nAngleichung auf gemeinsame Handelstage')
{
    // Krypto läuft täglich, die Börse nicht: Bitcoin hat hier 20 Tage,
    // die Nasdaq nur die 14 Werktage darin.
    const alleTage = reihe('2026-07-06', Array.from({ length: 20 }, (_, i) => 100 + i))
    const nurWerktage = alleTage.filter(p => {
        const wt = new Date(p.tag + 'T00:00:00Z').getUTCDay()
        return wt !== 0 && wt !== 6
    })
    const k = korrelationAusReihen(alleTage, nurWerktage)
    check('gerechnet wird nur auf gemeinsamen Tagen',
        k.punkte === nurWerktage.length - 1, `punkte=${k.punkte}, erwartet ${nurWerktage.length - 1}`)
    check('identischer Verlauf ergibt +1', nahe(k.r, 1, 1e-9))

    // Gegenläufig heisst gespiegelte RENDITEN. Ein simples „1000 − Kurs" täte
    // es nicht: die Kurse liefen dann zwar gegeneinander, die prozentualen
    // Veränderungen wären aber nicht exakt gespiegelt (andere Basis).
    const rs = [0.01, -0.02, 0.015, -0.005, 0.03, -0.01, 0.02, -0.025, 0.005, 0.012, -0.018, 0.008, -0.004]
    const hoch = [], runter = []
    let va = 100, vb = 100
    for (let i = 0; i < nurWerktage.length; i++) {
        if (i > 0) { va *= 1 + rs[(i - 1) % rs.length]; vb *= 1 - rs[(i - 1) % rs.length] }
        hoch.push({ tag: nurWerktage[i].tag, close: va })
        runter.push({ tag: nurWerktage[i].tag, close: vb })
    }
    check('gespiegelte Renditen ergeben −1', nahe(korrelationAusReihen(hoch, runter).r, -1, 1e-9))

    const kurz = korrelationAusReihen(reihe('2026-08-01', [1, 2, 3]), reihe('2026-08-01', [1, 2, 3]))
    check(`unter ${KORR_MIN_PUNKTE} Punkten wird keine Korrelation behauptet`, kurz.r === null)

    check('ohne gemeinsame Tage kommt nichts heraus',
        korrelationAusReihen(reihe('2026-01-01', [1, 2, 3]), reihe('2026-06-01', [1, 2, 3])).r === null)

    // Reihenfolge darf egal sein — die Angleichung sortiert selbst
    const gemischt = [...alleTage].reverse()
    check('unsortierte Eingabe ändert das Ergebnis nicht',
        nahe(korrelationAusReihen(gemischt, nurWerktage).r, 1, 1e-9))
}

// ── Deutung ──────────────────────────────────────────────────────────────
console.log('\nDeutung der Kopplung')
{
    check('r = 0,8 heisst stark gleichlaufend', deuteKorrelation(0.8) === 'starkGleich')
    check('r = −0,8 heisst stark gegenläufig', deuteKorrelation(-0.8) === 'starkGegen')
    check('r = 0,45 heisst mittel', deuteKorrelation(0.45) === 'mittelGleich')
    check('r = 0,1 heisst entkoppelt', deuteKorrelation(0.1) === 'entkoppelt')
    check('ohne Wert wird nichts behauptet', deuteKorrelation(null) === 'unbekannt')
}

// ── Stablecoin-Fluss ─────────────────────────────────────────────────────
console.log('\nStablecoin-Fluss')
{
    const usdt = [[1, 100e9], [2, 101e9], [3, 104e9]]
    const usdc = [[1, 50e9], [2, 50e9], [3, 50e9]]
    const f = stableFluss([usdt, usdc], 30)
    check('Mengen beider Coins werden summiert', nahe(f.jetztUsd, 154e9))
    check('Zufluss wird als Betrag ausgewiesen', nahe(f.deltaUsd, 4e9))
    check('… und als Prozent', nahe(f.deltaPct, (4 / 150) * 100, 1e-9))

    const ab = stableFluss([[[1, 200e9], [2, 190e9]]], 30)
    check('Abfluss ergibt ein negatives Delta', ab.deltaUsd < 0 && ab.deltaPct < 0)

    // Verschieden lange Reihen: sonst summierte man Zeitfenster verschiedener Länge
    const kurzLang = stableFluss([[[1, 10e9], [2, 11e9], [3, 12e9]], [[2, 5e9], [3, 5e9]]], 30)
    check('die kürzeste Reihe gibt den Zeitraum vor',
        nahe(kurzLang.deltaUsd, (12e9 + 5e9) - (11e9 + 5e9)), `delta=${kurzLang.deltaUsd}`)

    check('ohne brauchbare Reihen wird nichts behauptet',
        stableFluss([]).jetztUsd === null && stableFluss([[[1, 1e9]]]).deltaUsd === null)
}

// ── Dominanz-Zerlegung ───────────────────────────────────────────────────
console.log('\nDominanz-Zerlegung')
{
    // Der Kernfall: der übrige Markt fällt 10 %, es wird KEIN Stablecoin
    // geprägt oder eingelöst. Die Dominanz steigt trotzdem — genau diese
    // Täuschung soll die Zerlegung sichtbar machen.
    const s = 245e9
    const n0 = 1925e9
    const nurKurs = zerlegeDominanz({ s0: s, s1: s, t0: s + n0, t1: s + n0 * 0.9 })
    check('Dominanz steigt, obwohl keine Menge floss',
        nurKurs.jetztPct > nurKurs.vorherPct)
    check('… und der Anstieg wird VOLLSTÄNDIG dem Kurs zugeschrieben',
        nahe(nurKurs.mengePunkte, 0, 1e-9), `menge=${nurKurs.mengePunkte}`)
    check('… die Zahlen entsprechen dem Rechenbeispiel (11,3 % → 12,4 %)',
        Math.abs(nurKurs.vorherPct - 11.29) < 0.02 && Math.abs(nurKurs.jetztPct - 12.39) < 0.02,
        `${nurKurs.vorherPct} → ${nurKurs.jetztPct}`)

    // Gegenprobe: nur die Menge ändert sich, die Kurse stehen still
    const nurMenge = zerlegeDominanz({ s0: 200e9, s1: 220e9, t0: 2200e9, t1: 2220e9 })
    check('ändert sich nur die Menge, ist der Kurseffekt null',
        nahe(nurMenge.kursPunkte, 0, 1e-9), `kurs=${nurMenge.kursPunkte}`)

    // Beides gleichzeitig: die Summe muss exakt aufgehen, sonst wäre die
    // Zerlegung eine Erfindung statt einer Aufteilung
    const beides = zerlegeDominanz({ s0: 200e9, s1: 260e9, t0: 2200e9, t1: 1900e9 })
    check('beide Effekte zusammen ergeben exakt die Gesamtveränderung',
        nahe(beides.mengePunkte + beides.kursPunkte, beides.deltaPunkte, 1e-9))
    check('bei Zufluss UND Kursverfall zeigen beide Effekte nach oben',
        beides.mengePunkte > 0 && beides.kursPunkte > 0)

    // Ein echter Zufluss kann in einer Rally unsichtbar werden — die
    // Zerlegung muss ihn trotzdem ausweisen
    const rally = zerlegeDominanz({ s0: 200e9, s1: 230e9, t0: 2000e9, t1: 3000e9 })
    check('in einer Rally fällt die Dominanz trotz Zufluss', rally.deltaPunkte < 0)
    check('… der Zufluss bleibt als positiver Mengeneffekt sichtbar', rally.mengePunkte > 0)

    check('unbrauchbare Eingaben ergeben nichts',
        zerlegeDominanz({ s0: 0, s1: 1, t0: 2, t1: 3 }) === null
        && zerlegeDominanz({}) === null
        // Stablecoins können nicht grösser als der Gesamtmarkt sein
        && zerlegeDominanz({ s0: 5, s1: 5, t0: 4, t1: 4 }) === null)
}

// ── Stützpunkte wählen ───────────────────────────────────────────────────
console.log('\nStützpunkte für die Zerlegung')
{
    const stable = new Map(), total = new Map()
    for (let i = 0; i <= 40; i++) {
        const tag = new Date(Date.UTC(2026, 6, 1) + i * 86400000).toISOString().slice(0, 10)
        stable.set(tag, 200e9 + i * 1e9)
        total.set(tag, 2000e9 + i * 5e9)
    }
    const p = waehleDominanzPunkte(stable, total, 30)
    check('der jüngste gemeinsame Tag wird als Endpunkt genommen', p.tagBis === '2026-08-10')
    check('der Startpunkt liegt 30 Tage davor', p.tage === 30 && p.tagVon === '2026-07-11')
    check('die Werte stammen paarweise vom selben Tag',
        p.s1 === stable.get(p.tagBis) && p.t1 === total.get(p.tagBis)
        && p.s0 === stable.get(p.tagVon) && p.t0 === total.get(p.tagVon))

    // Fehlt der Gesamtmarkt an einem Tag, darf dieser Tag nicht benutzt werden
    const luecke = new Map(total)
    luecke.delete('2026-08-10')
    check('Tage ohne beide Werte fallen raus', waehleDominanzPunkte(stable, luecke, 30).tagBis === '2026-08-09')

    // Reicht die Historie nicht, wird der nächstbeste Tag genommen statt zu raten
    const kurz = new Map([...stable].slice(-5))
    const kurzP = waehleDominanzPunkte(kurz, total, 30)
    check('bei kurzer Historie wird der Zeitraum ehrlich kleiner gemeldet',
        kurzP !== null && kurzP.tage < 30 && kurzP.tage > 0, `tage=${kurzP?.tage}`)

    check('ohne gemeinsame Tage kommt nichts heraus',
        waehleDominanzPunkte(stable, new Map(), 30) === null
        && waehleDominanzPunkte(new Map(), new Map(), 30) === null)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) {
    console.log('Fehlgeschlagen:')
    for (const f of fehler) console.log(`  - ${f}`)
    process.exit(1)
}
