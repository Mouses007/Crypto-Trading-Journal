/**
 * Rangfolge und die Frage, ob sie überhaupt etwas bedeutet.
 *
 * Wer 100 Coins durchtestet und die besten fünf nimmt, hat mit hoher
 * Wahrscheinlichkeit Rauschen ausgewählt. Bei hundert Versuchen sieht immer
 * irgendetwas hervorragend aus — auch wenn die Strategie gar keinen Vorteil
 * hat. Eine Rangliste ohne dieses Gegengewicht ist gefährlicher als keine, weil
 * sie überzeugend aussieht.
 *
 * Drei Antworten darauf, alle ohne einen einzigen zusätzlichen Backtest:
 *
 *   1. GRUNDQUOTE   Wie viele Coins waren in der Rang-Hälfte positiv, wie viele
 *                   in der Prüfhälfte? Fällt der Anteil deutlich, war die
 *                   Auswahl eine Anpassung an den Zeitraum.
 *   2. RANGKORRELATION  Stimmt die Reihenfolge der ersten Hälfte mit der der
 *                   zweiten überein? Liegt sie bei null, trägt die Rangliste
 *                   nichts — dann ist Platz 1 heute morgen Platz 60.
 *   3. UMTOPFEN     Alle R-Werte in einen Topf, neu verteilen, das Maximum
 *                   notieren. So oft, dass man sagen kann: „wären alle Coins in
 *                   Wahrheit gleich gut, hätte der beste in 12 % der Fälle so
 *                   gut ausgesehen wie unserer."
 *
 * Gerangt wird nach `expectancyROhneTop`, nicht nach `expectancyR` — dieselbe
 * Begründung wie im Backtest: bei hundert Coins ist ein einzelner Ausreisser
 * der wahrscheinlichste Grund, dass einer oben steht.
 */

import { perzentil, zufall } from './robustness.js'
import { spearman } from '../shared/statistik.js'
import { MIN_TRADES_BELASTBAR } from './strategy-backtest.js'

/** Wie oft der Topf neu verteilt wird. */
const ZIEHUNGEN = 200
/** Feste Aussaat: derselbe Lauf muss beim Neuladen dieselbe Zahl zeigen. */
const AUSSAAT = 20260816

const zahl = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/**
 * Rangfolge vergeben — nur belastbare Zeilen bekommen einen Rang.
 *
 * Die übrigen behalten `rangA = 0` und stehen in der Oberfläche unter der
 * Trennlinie. Sie zu löschen wäre eine Behauptung über ihre
 * Bedeutungslosigkeit; ein Coin mit vier Trades und 2,1 R ist kein Ergebnis,
 * aber auch keine Null.
 */
export function vergibRaenge(zeilen) {
    const belastbar = zeilen.filter((z) => z.klasse === 'belastbar')
    belastbar
        .sort((a, b) => zahl(b.aOhneTopR) - zahl(a.aOhneTopR)
            // Gleichstand nach Symbol, damit zwei Läufe dieselbe Reihenfolge
            // ergeben — sonst wechselt die Anzeige ohne Grund.
            || String(a.symbol).localeCompare(String(b.symbol)))
        .forEach((z, i) => { z.rangA = i + 1 })
    for (const z of zeilen) if (z.klasse !== 'belastbar') z.rangA = 0
    return zeilen
}

/**
 * Umtopfen: wie gut hätte der beste Coin ausgesehen, wenn alle gleich gut wären?
 *
 * Die Nullhypothese lautet: die Unterschiede zwischen den Coins sind reines
 * Ziehungsrauschen. Um sie nachzustellen, kommen ALLE R-Werte in einen Topf,
 * und jeder Coin zieht daraus so viele, wie er selbst Trades hatte — mit
 * Zurücklegen. Sein mittleres R ist dann rein zufällig zustande gekommen. Das
 * Maximum über alle Coins ist der Wert, mit dem sich unser echter Bester messen
 * muss.
 *
 * Wichtig ist das Ziehen MIT der jeweils eigenen Trade-Zahl: ein Coin mit 30
 * Trades schwankt stärker als einer mit 300, und genau diese Schwankung ist der
 * Grund, warum kleine Stichproben oben landen.
 *
 * `null`, wenn weniger als zwei belastbare Coins da sind — mit einem einzigen
 * gibt es keine Auswahl, gegen die man sich absichern müsste.
 */
export function umtopfen(zeilen, { ziehungen = ZIEHUNGEN, aussaat = AUSSAAT } = {}) {
    const belastbar = zeilen.filter((z) => z.klasse === 'belastbar' && (z.rReiheA || []).length)
    if (belastbar.length < 2) return null

    const topf = []
    for (const z of belastbar) for (const r of z.rReiheA) if (Number.isFinite(r)) topf.push(r)
    if (topf.length < 10) return null

    const grossen = belastbar.map((z) => z.rReiheA.length)
    const wuerfel = zufall(aussaat)
    const maxima = []
    for (let d = 0; d < ziehungen; d++) {
        let best = -Infinity
        for (const n of grossen) {
            let summe = 0
            for (let i = 0; i < n; i++) summe += topf[Math.floor(wuerfel() * topf.length)]
            const mittel = summe / n
            if (mittel > best) best = mittel
        }
        maxima.push(best)
    }

    const beobachtet = Math.max(...belastbar.map((z) => zahl(z.aOhneTopR)))
    const drueber = maxima.filter((m) => m >= beobachtet).length
    return {
        coins: belastbar.length,
        ziehungen,
        beobachtet,
        p50: perzentil(maxima, 0.5),
        p90: perzentil(maxima, 0.9),
        p95: perzentil(maxima, 0.95),
        anteilUeberBeobachtet: drueber / maxima.length,
    }
}

/**
 * Die vollständige Beurteilung einer fertigen Rangliste.
 * Wird einmal am Ende eines Laufs gerechnet und in `rangliste_laeufe`
 * abgelegt — danach ändert sie sich nicht mehr.
 */
export function beurteileRangliste(zeilen) {
    const belastbar = zeilen.filter((z) => z.klasse === 'belastbar')
    if (!belastbar.length) {
        return { coins: 0, grundquote: null, spearman: null, umtopfen: null, top10Haelt: null }
    }

    // ── Grundquote ───────────────────────────────────────────────────────
    const positivA = belastbar.filter((z) => zahl(z.aOhneTopR) > 0).length
    // Die Prüfhälfte zählt nur, wo sie selbst genug Trades hat — sonst
    // verglichen wir eine Aussage mit einem Zufall.
    const mitB = belastbar.filter((z) => zahl(z.bTrades) >= MIN_TRADES_BELASTBAR)
    const positivB = mitB.filter((z) => zahl(z.bOhneTopR) > 0).length

    // ── Halten die Besten? ───────────────────────────────────────────────
    const sortiert = [...belastbar].sort((a, b) => zahl(b.aOhneTopR) - zahl(a.aOhneTopR))
    const top10 = sortiert.slice(0, Math.min(10, sortiert.length))
    const top10MitB = top10.filter((z) => zahl(z.bTrades) >= MIN_TRADES_BELASTBAR)
    const top10Positiv = top10MitB.filter((z) => zahl(z.bOhneTopR) > 0).length

    // ── Rangkorrelation ──────────────────────────────────────────────────
    // Nur Coins, die in BEIDEN Hälften etwas zu sagen haben.
    const paare = belastbar.filter((z) => zahl(z.bTrades) >= MIN_TRADES_BELASTBAR)
    const rho = spearman(paare.map((z) => zahl(z.aOhneTopR)), paare.map((z) => zahl(z.bOhneTopR)))

    return {
        coins: belastbar.length,
        grundquote: {
            positivA, gesamtA: belastbar.length,
            anteilA: belastbar.length ? positivA / belastbar.length : 0,
            positivB, gesamtB: mitB.length,
            anteilB: mitB.length ? positivB / mitB.length : 0,
        },
        top10Haelt: top10MitB.length
            ? { positiv: top10Positiv, geprueft: top10MitB.length }
            : null,
        spearman: rho,
        spearmanPaare: paare.length,
        umtopfen: umtopfen(zeilen),
    }
}

/**
 * Der Satz, der über der Tabelle steht.
 *
 * Bewusst hier gebaut und mit dem Lauf gespeichert, nicht in der Oberfläche
 * zusammengesetzt: er gehört zum Ergebnis. Ein Lauf, dessen Beurteilung sich
 * beim nächsten Öffnen anders liest, wäre wertlos.
 */
export function ranglisteSatz(beurteilung) {
    if (!beurteilung || !beurteilung.coins) {
        return 'Kein einziger Coin hat genug Trades für eine belastbare Aussage.'
    }
    const teile = []
    const u = beurteilung.umtopfen
    if (u) {
        const pct = (u.anteilUeberBeobachtet * 100).toFixed(0)
        teile.push(`Der beste Coin steht bei ${u.beobachtet.toFixed(2)} R. Wären alle ${u.coins} `
            + `belastbaren Coins in Wahrheit gleich gut, hätte der beste im Median `
            + `${u.p50.toFixed(2)} R erreicht — und in ${pct} % der Ziehungen mehr als `
            + `${u.beobachtet.toFixed(2)} R.`)
        teile.push(u.anteilUeberBeobachtet < 0.05
            ? 'Das ist deutlich mehr, als Zufall erklären würde.'
            : 'Diese Rangliste ist damit nicht deutlich besser als Zufall.')
    }
    const g = beurteilung.grundquote
    if (g && g.gesamtB) {
        teile.push(`In der Rang-Hälfte waren ${(g.anteilA * 100).toFixed(0)} % der Coins positiv, `
            + `in der Prüfhälfte ${(g.anteilB * 100).toFixed(0)} %.`)
    }
    if (beurteilung.spearman !== null && beurteilung.spearman !== undefined) {
        const r = beurteilung.spearman
        teile.push(`Die Reihenfolge beider Hälften hängt mit ${r.toFixed(2)} zusammen `
            + `(${r > 0.3 ? 'brauchbar' : r > 0.1 ? 'schwach' : 'so gut wie gar nicht'}).`)
    }
    if (beurteilung.top10Haelt) {
        const t = beurteilung.top10Haelt
        teile.push(`Von den besten ${t.geprueft} halten ${t.positiv} auch in der Prüfhälfte.`)
    }
    return teile.join(' ')
}
