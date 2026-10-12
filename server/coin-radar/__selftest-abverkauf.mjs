/**
 * Selbsttest: Abverkaufs-Wache (die reine Rechnung).
 *
 * Ohne Netz. Die wichtigste Richtung ist die Gegenprobe: Ein Coin, der noch
 * steigt, darf nicht als „kippt" gemeldet werden — wer dort shortet, wird
 * ausgequetscht. Und fehlende Daten dürfen weder Treibstoff noch Gegenanzeichen
 * erfinden.
 *
 * Aufruf: node server/coin-radar/__selftest-abverkauf.mjs
 */
import {
    bewerteAbverkauf, kennzahlen, funding8h, vorauswahl, waehlePartner, abverkaufGuete, bereinigeAbverkauf, preisSpieltMit, ABVERKAUF_VORGABEN,
} from './abverkauf-bewertung.js'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}
console.log('Coin-Radar: Abverkaufs-Wache')

const H = 3600e3
const M15 = 15 * 60e3
const T0 = Date.UTC(2026, 9, 1)

/** Kerzen aus einer Schlusskurs-Reihe; Hoch/Tief knapp darum, Volumen wählbar. */
function kerzen(closes, schritt, vol = () => 1000) {
    return closes.map((c, i) => {
        const o = i ? closes[i - 1] : c
        return { t: T0 + i * schritt, o, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, c, v: vol(i, c) }
    })
}
const flach = (n, w) => Array.from({ length: n }, (_, i) => w * (1 + 0.001 * Math.sin(i)))
const rampe = (n, von, bis) => Array.from({ length: n }, (_, i) => von + ((bis - von) * (i + 1)) / n)

// ── Szenario A: hochgepumpt, kippt ──────────────────────────────────────
// 1h: lange flach bei 1, in 12 h auf 2,2, dann drei Stunden zurück auf 1,85
const c1A = [...flach(150, 1), ...rampe(12, 1, 2.2), 2.1, 1.95, 1.85]
// 15m: flach, langer Lauf über der EMA, dann zwei Schlüsse klar darunter
const c15A = [...flach(140, 1), ...rampe(50, 1, 2.2), 2.18, 2.15, 2.12, 2.1, 2.08, 2.05, 2.02, 2.0, 1.9, 1.85]
const ohneSpur = { erfasst: false }
const basisA = {
    preisAenderung24h: 85,
    fundingRate: 0.08, fundingIntervallH: 8,
    k1h: kerzen(c1A, H, (i) => (i >= 150 ? 5000 : 1000)),
    k15m: kerzen(c15A, M15, (i) => (i >= 140 && i < 190 ? 8000 : 1000)),
    spot1h: kerzen(c1A, H, (i) => (i >= 150 ? 1000 : 1000)),
    oi1h: Array.from({ length: 48 }, (_, i) => ({ t: T0 + i * H, wert: i < 24 ? 100 : 100 + (i - 23) * 4 })),
    oi5m: Array.from({ length: 36 }, (_, i) => ({ t: T0 + i * 300e3, wert: i < 24 ? 200 : 200 - (i - 23) * 2 })),
    lsKonten: [{ t: T0, longPct: 70 }],
    lsTop: [{ t: T0, ratio: 2.1 }],
    taker5m: Array.from({ length: 36 }, (_, i) => ({ t: T0 + i * 300e3, ratio: i < 30 ? 1.3 : 0.8 })),
    liq: ohneSpur,
    listung: null,
}
const A = bewerteAbverkauf(basisA, { jetzt: T0 + 200 * H })
p('A: Treibstoff reicht für „überdehnt"', A.note >= ABVERKAUF_VORGABEN.schwelle, String(A.note))
p('A: kippt', A.phase === 'kippt', `${A.phase} · ${A.kippen.map((k) => k.schluessel).join(',')} · ${A.gegen.map((g) => g.schluessel).join(',')}`)
p('A: ein Preissignal ist dabei', A.kippen.some((k) => ['vomHoch', 'tieferesHoch', 'strukturbruch'].includes(k.schluessel)))
p('A: Dehnung zählt von der Spitze, nicht vom schon gefallenen Kurs', A.treibstoff.some((x) => x.schluessel === 'dehnung'))
p('A: fallendes OI nach dem Hoch bestätigt', A.kippen.some((k) => k.schluessel === 'oiFaellt'))
p('A: Kaufdruck weg erkannt', A.kippen.some((k) => k.schluessel === 'kaufdruckWeg'))
p('A: Funding, OI, Anstieg als Treibstoff', ['funding', 'oi', 'anstieg'].every((s) => A.treibstoff.some((x) => x.schluessel === s)),
    A.treibstoff.map((x) => x.schluessel).join(','))
p('A: Futures-getrieben (Futures-Umsatz verfünffacht, Spot nicht)', A.treibstoff.some((x) => x.schluessel === 'futuresGetrieben'))
p('A: Marke „ungültig über" ist das 24h-Hoch', A.ungueltigUeber > 2.19 && A.ungueltigUeber < 2.25, String(A.ungueltigUeber))
p('A: Liquidationen nicht erfasst — weder Signal noch Gegenzeichen',
    !A.kippen.some((k) => k.schluessel === 'longLiquidationen') && A.kennzahlen.liqLongUsd === null)

// ── Szenario B: Gegenprobe — steigt noch ────────────────────────────────
const c1B = [...flach(150, 1), ...rampe(15, 1, 2.2)]
const c15B = [...flach(140, 1), ...rampe(60, 1, 2.2)]
const B = bewerteAbverkauf({
    ...basisA,
    k1h: kerzen(c1B, H, (i) => (i >= 150 ? 5000 : 1000)),
    k15m: kerzen(c15B, M15, (i) => (i >= 140 ? 8000 : 1000)),
    taker5m: Array.from({ length: 36 }, () => ({ ratio: 1.4 })),
    oi5m: Array.from({ length: 36 }, (_, i) => ({ wert: 200 + i })),
}, { jetzt: T0 + 200 * H })
p('B: überdehnt, aber NICHT kippt', B.phase === 'ueberdehnt', `${B.phase} · ${B.kippen.map((k) => k.schluessel).join(',')}`)
p('B: „neue Hochs" sperrt', B.gegen.some((g) => g.schluessel === 'neuesHoch' && g.sperrt))
p('B: Taker kaufen weiter als Gegenzeichen', B.gegen.some((g) => g.schluessel === 'kaufdruckStark'))

// ── Szenario C: ruhiger Coin ─────────────────────────────────────────────
const C = bewerteAbverkauf({
    preisAenderung24h: 2, fundingRate: 0.01, fundingIntervallH: 8,
    k1h: kerzen(flach(200, 50), H), k15m: kerzen(flach(200, 50), M15), spot1h: kerzen(flach(200, 50), H),
    oi1h: Array.from({ length: 48 }, () => ({ wert: 100 })), oi5m: Array.from({ length: 36 }, () => ({ wert: 100 })),
    lsKonten: [{ longPct: 52 }], lsTop: [{ ratio: 1.1 }], taker5m: Array.from({ length: 36 }, () => ({ ratio: 1 })),
}, { jetzt: T0 + 200 * H })
p('C: ruhiger Coin — keine Phase, kaum Treibstoff', C.phase === 'keine' && C.note < 20, `${C.phase} ${C.note}`)

// ── Szenario D: fehlende Daten ──────────────────────────────────────────
const D = bewerteAbverkauf({ preisAenderung24h: 60, k1h: basisA.k1h, k15m: basisA.k15m }, { jetzt: T0 + 200 * H })
p('D: fehlende Quellen stehen unter „fehlend"', ['funding', 'oi', 'longShort', 'taker'].every((f) => D.fehlend.includes(f)), D.fehlend.join(','))
p('D: fehlendes Funding ist kein Gegenzeichen', !D.gegen.some((g) => g.schluessel === 'fundingNegativ'))
p('D: fehlende Konten-Quote ist kein Short-Überhang', !D.gegen.some((g) => g.schluessel === 'shortUeberhang'))
p('D: Spot nicht abgefragt (null) ist nicht „nur Futures"', !D.treibstoff.some((x) => x.schluessel === 'nurFutures'))
p('D: leerer Spot ([]) ist „nur Futures"', bewerteAbverkauf({ ...basisA, spot1h: [] }).treibstoff.some((x) => x.schluessel === 'nurFutures'))

// ── Squeeze-Gefahr ──────────────────────────────────────────────────────
const E = bewerteAbverkauf({ ...basisA, fundingRate: -0.05, lsKonten: [{ longPct: 35 }] }, { jetzt: T0 + 200 * H })
p('E: negatives Funding ist Gegenzeichen', E.gegen.some((g) => g.schluessel === 'fundingNegativ'))
p('E: leicht negatives Funding sperrt nicht', !E.gegen.find((g) => g.schluessel === 'fundingNegativ').sperrt)
const E2 = bewerteAbverkauf({ ...basisA, fundingRate: -2, fundingIntervallH: 8 }, { jetzt: T0 + 200 * H })
p('E: Funding −2 % je 8 h sperrt die Meldung (RSR, 12.10.2026)', E2.phase === 'ueberdehnt' && E2.gegen.some((g) => g.sperrt))
p('E: Short-Überhang ist Gegenzeichen', E.gegen.some((g) => g.schluessel === 'shortUeberhang'))

// ── Spielt der Kurs mit? ────────────────────────────────────────────────
const k = (...namen) => namen.map((schluessel) => ({ schluessel }))
p('Kurs: Abstand vom Hoch reicht allein', preisSpieltMit(k('vomHoch')))
p('Kurs: Strukturbruch reicht allein', preisSpieltMit(k('strukturbruch')))
p('Kurs: tieferes Hoch mit einem weiteren Zeichen reicht nicht (IOUSDT, 3 % unter dem Gipfel)', !preisSpieltMit(k('tieferesHoch', 'docht')))
p('Kurs: tieferes Hoch mit zwei weiteren Zeichen reicht', preisSpieltMit(k('tieferesHoch', 'docht', 'volumenErschoepft')))
p('Kurs: ohne Preiszeichen nie, auch mit vielen anderen', !preisSpieltMit(k('kaufdruckWeg', 'docht', 'divergenz', 'oiFaellt')))

// ── Funding-Takt ────────────────────────────────────────────────────────
p('Funding: 4h-Takt zählt doppelt', funding8h(0.05, 4) === 0.1)
p('Funding: ohne Takt unbekannt, nicht 8 h', funding8h(0.05, null) === null)

// ── Liquidationen ───────────────────────────────────────────────────────
const L = bewerteAbverkauf({ ...basisA, liq: { erfasst: true, longUsd: 400_000, shortUsd: 20_000 } }, { jetzt: T0 + 200 * H })
p('Long-Liquidationen erkannt, wenn erfasst', L.kippen.some((k) => k.schluessel === 'longLiquidationen'))
p('erfasst, aber nichts: 0, nicht unbekannt', kennzahlen({ ...basisA, liq: { erfasst: true, longUsd: 0, shortUsd: 0 } }).liqLongUsd === 0)

// ── Frisches Listing ────────────────────────────────────────────────────
const F = bewerteAbverkauf({ ...basisA, listung: { boerse: 'okx', gesehenAm: T0 + 200 * H - 2 * 86400e3 } }, { jetzt: T0 + 200 * H })
p('Listing vor zwei Tagen zählt', F.treibstoff.some((x) => x.schluessel === 'frischGelistet'))
const G = bewerteAbverkauf({ ...basisA, listung: { boerse: 'okx', gesehenAm: T0 + 200 * H - 9 * 86400e3 } }, { jetzt: T0 + 200 * H })
p('Listing vor neun Tagen nicht mehr', !G.treibstoff.some((x) => x.schluessel === 'frischGelistet'))

// ── Vorauswahl ──────────────────────────────────────────────────────────
const markt = new Map([
    ['AUSDT', { symbol: 'AUSDT', preisAenderung24h: 60, umsatz24h: 50e6 }],
    ['BUSDT', { symbol: 'BUSDT', preisAenderung24h: 30, umsatz24h: 2e6 }],      // zu dünn
    ['CUSDT', { symbol: 'CUSDT', preisAenderung24h: 4, umsatz24h: 90e6 }],      // nicht gestiegen, aber Nachlauf
    ['DUSDC', { symbol: 'DUSDC', preisAenderung24h: 90, umsatz24h: 90e6 }],     // kein USDT-Perp
])
const v = vorauswahl(markt, new Set(['CUSDT'])).map((x) => x.symbol)
p('Vorauswahl: gestiegen und liquide', v.includes('AUSDT') && !v.includes('BUSDT'))
p('Vorauswahl: Nachlauf bleibt drin, auch wenn der 24h-Anstieg schrumpft', v.includes('CUSDT'))
p('Vorauswahl: nur USDT-Perps', !v.includes('DUSDC'))

// ── Partner und Auswertung ──────────────────────────────────────────────
const paare = waehlePartner([{ s: 'X', anstieg24h: 80 }], [{ s: 'Y', anstieg24h: 25 }, { s: 'Z', anstieg24h: 70 }])
p('Partner: ähnlichster Anstieg', paare.length === 1 && paare[0][1].s === 'Z')
p('Partner: ohne Übrige kein Paar', waehlePartner([{ anstieg24h: 1 }], []).length === 0)
const q = abverkaufGuete([
    { gruppe: 'spitze', horizont: '4h', status: 'gemessen', renditePct: -8, mfePct: 2 },
    { gruppe: 'spitze', horizont: '4h', status: 'gemessen', renditePct: -2, mfePct: 5 },
    { gruppe: 'kontrolle', horizont: '4h', status: 'gemessen', renditePct: 1, mfePct: 6 },
    { gruppe: 'spitze', horizont: '4h', status: 'offen', renditePct: null },
])
p('Auswertung: nur gemessene', q['4h'].spitze.n === 2 && q['4h'].kontrolle.n === 1)
p('Auswertung: Median und Anteil Rückgang ≥ 3 %', q['4h'].spitze.medianRendite === -5 && q['4h'].spitze.anteilFall === 50)

// ── Einstellungen ───────────────────────────────────────────────────────
const alt = { an: true, minAnstieg: 20, schwelle: 45 }
const neu = bereinigeAbverkauf({ minAnstieg: '', schwelle: 500, maxKandidaten: 0, an: 'ja', fremd: 1 }, alt)
p('Einstellungen: leeres Feld behält den alten Wert', neu.minAnstieg === 20)
p('Einstellungen: geklemmt', neu.schwelle === 100 && neu.maxKandidaten === 1)
p('Einstellungen: kein Text als Schalter, nichts Fremdes', neu.an === true && !('fremd' in neu))

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
