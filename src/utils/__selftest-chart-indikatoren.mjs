/**
 * Selbsttest der Chart-Indikatoren — ohne Browser, ohne Chart-Bibliothek.
 *
 *   node src/utils/__selftest-chart-indikatoren.mjs
 *
 * Geprüft wird, was beim Zeichnen nicht auffällt, aber falsche Linien ergibt:
 * dass der Chart DIESELBE Rechnung benutzt wie die Strategie-Detektoren, dass
 * jede Ausgabe genau so lang ist wie die Kerzenreihe (sonst rutscht die Linie
 * gegen die Kerzen), dass die Preisquelle wirklich wirkt, und dass kaputte
 * gespeicherte Parameter nicht durchschlagen.
 */
import { INDIKATOREN, rechneIndikator, saubereParams, vorgaben, kurzname, neueInstanz, aufKerzen, jeKerzeSumme, benoetigteQuellen, veraenderung } from './chart/indikatorRegister.js'
import { ema, rsi, macd, bollinger } from '../../shared/indicators.js'
import { ema as serverEma } from '../../server/strategies/indicators.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const gleich = (a, b) => a.length === b.length && a.every((x, i) => (x === null && b[i] === null) || Math.abs(x - b[i]) < 1e-12)

// Deterministische Kerzen: Welle mit Trend, Volumen schwankend.
const kerzen = Array.from({ length: 300 }, (_, i) => {
    const basis = 100 + i * 0.05 + Math.sin(i / 7) * 3
    const o = basis + Math.sin(i / 3)
    const c = basis + Math.cos(i / 4)
    return { t: 1_700_000_000_000 + i * 3_600_000, o, h: Math.max(o, c) + 0.8, l: Math.min(o, c) - 0.6, c, v: 1000 + (i % 17) * 40 }
})

console.log('\nEine Rechnung für Chart und Strategie\n')
check('Weiterleitung server/strategies/indicators.js zeigt auf shared/', serverEma === ema)
check('EMA im Chart == EMA der Detektoren', gleich(rechneIndikator('ema', kerzen, { laenge: 21 }).wert, ema(kerzen, 21)))
check('RSI im Chart == RSI der Detektoren', gleich(rechneIndikator('rsi', kerzen, { laenge: 14 }).wert, rsi(kerzen, 14)))
{
    const m = rechneIndikator('macd', kerzen, { schnell: 12, langsam: 26, signal: 9 })
    check('MACD-Linie, Signal und Histogramm == Detektoren',
        gleich(m.macd, macd(kerzen, { line: 'macd' })) && gleich(m.signal, macd(kerzen, { line: 'signal' })) && gleich(m.hist, macd(kerzen, { line: 'hist' })))
}
{
    const b = rechneIndikator('bb', kerzen, { laenge: 20, mult: 2, basis: 'sma' })
    const r = bollinger(kerzen, { period: 20, mult: 2 })
    check('Bollinger oben/mitte/unten == Detektoren', gleich(b.oben, r.upper) && gleich(b.mitte, r.middle) && gleich(b.unten, r.lower))
}

// Fremddaten für die Datenfenster: stündliches OI, Funding alle 8 h, Momentum je Kerze.
const extern = {
    oi: kerzen.filter((_, i) => i % 1 === 0).map((k, i) => ({ t: k.t, oi: 1000 + i, longPct: 50 + (i % 10) })),
    funding: kerzen.filter((_, i) => i % 8 === 0).map((k) => ({ t: k.t + 60_000, rate: 0.0001 })),
    momentum: { t: kerzen.map((k) => k.t), w1: kerzen.map((_, i) => Math.sin(i / 5) * 50), w2: kerzen.map((_, i) => Math.sin(i / 5 - 0.3) * 50), mf: kerzen.map((_, i) => Math.cos(i / 7) * 20) },
}

console.log('\nJede Ausgabe so lang wie die Kerzenreihe\n')
for (const typ of Object.keys(INDIKATOREN)) {
    const params = { ...vorgaben(typ), ...(typ === 'vwap' ? { band: 2 } : {}) }
    const aus = rechneIndikator(typ, kerzen, params, extern)
    const pflicht = INDIKATOREN[typ].ausgaben.filter((a) => !a.optional || typ === 'vwap')
    const fehlt = pflicht.filter((a) => !Array.isArray(aus[a.key]) || aus[a.key].length !== kerzen.length).map((a) => a.key)
    const zahlen = pflicht.every((a) => (aus[a.key] || []).some((x) => Number.isFinite(x)))
    check(`${typ}: alle Ausgaben vorhanden, Länge ${kerzen.length}, mit Werten`, !fehlt.length && zahlen, fehlt.join(','))
}
{
    const ohneBand = rechneIndikator('vwap', kerzen, { anker: 'session', band: 0 })
    check('VWAP ohne Band liefert keine leeren Bandreihen', !('oben' in ohneBand) && !('unten' in ohneBand))
    const mitBand = rechneIndikator('vwap', kerzen, { anker: 'session', band: 1 })
    const i = kerzen.length - 1
    check('VWAP-Band liegt um die Linie (oben > Linie > unten)', mitBand.oben[i] > mitBand.wert[i] && mitBand.wert[i] > mitBand.unten[i])
}

console.log('\nDatenfenster: fremde Reihen auf Kerzen\n')
{
    const k = [{ t: 100 }, { t: 200 }, { t: 300 }, { t: 400 }]
    const oi = aufKerzen(k, [{ t: 150, oi: 7 }, { t: 300, oi: 9 }], 'oi')
    check('Vor dem ersten Punkt null, nicht 0', oi[0] === null)
    check('Letzter bekannter Wert zur Kerzeneröffnung', oi[1] === 7 && oi[2] === 9 && oi[3] === 9, JSON.stringify(oi))
    check('Unsortierte Punkte werden sortiert', aufKerzen(k, [{ t: 300, oi: 9 }, { t: 150, oi: 7 }], 'oi')[1] === 7)
    // Stand am Kerzenschluss: Punkt bei 200 = Schluss der Kerze [100,200) → gehört zu Kerze 0
    const s = aufKerzen(k, [{ t: 200, oi: 5 }, { t: 400, oi: 8 }], 'oi', { amSchluss: true })
    check('amSchluss: Stand zur Zeit 200 sitzt auf der Kerze, die um 200 schliesst', s[0] === 5, JSON.stringify(s))
    check('amSchluss: Stand von 400 auf der Kerze 300–400, nicht schon auf 200–300', s[1] === 5 && s[2] === 8 && s[3] === 8, JSON.stringify(s))
    check('Gegenprobe ohne amSchluss: derselbe Punkt eine Kerze später', aufKerzen(k, [{ t: 200, oi: 5 }], 'oi')[0] === null && aufKerzen(k, [{ t: 200, oi: 5 }], 'oi')[1] === 5)
    const f = jeKerzeSumme(k, [{ t: 210, rate: 0.0001 }, { t: 290, rate: 0.0002 }, { t: 50, rate: 1 }], 'rate', 100)
    check('Funding in der Kerze, in die es fällt, summiert (in %)', Math.abs(f[1] - 0.03) < 1e-12 && f[0] === null && f[2] === null, JSON.stringify(f))
    check('Zahlung vor der ersten Kerze wird nicht der ersten zugeschlagen', f[0] === null)
    const d = veraenderung([null, 7, 7, 9, 8])
    check('OI-Veränderung: fortgeschriebener Wert ist keine Messung (null statt 0)', d[0] === null && d[1] === null && d[2] === null && d[3] === 2 && d[4] === -1, JSON.stringify(d))
    check('Ohne Fremddaten: Reihe aus null statt Absturz', rechneIndikator('oi', kerzen, {}, {}).wert.every((v) => v === null))
    const m = rechneIndikator('momentum', kerzen.slice(0, 5), {}, { momentum: { t: [kerzen[1].t, kerzen[3].t], w1: [10, 20], w2: [1, 2], mf: [3, 4] } })
    check('Momentum nur an exakt passenden Kerzenzeiten (andere Zeiteinheit → leer)', m.w1[0] === null && m.w1[1] === 10 && m.w1[3] === 20 && m.w1[2] === null)
    check('Momentum-Geldfluss als Wert für die Legende', m.mf[1] === 3 && m.mf[3] === 4)
    check('Benötigte Quellen ohne Doppelte, ausgeblendete zählen nicht',
        benoetigteQuellen([{ typ: 'oi' }, { typ: 'longShort' }, { typ: 'funding', sichtbar: false }, { typ: 'ema' }]).join() === 'oi')
}

console.log('\nPreisquelle wirkt\n')
{
    const c = rechneIndikator('sma', kerzen, { laenge: 10, quelle: 'c' }).wert
    const h = rechneIndikator('sma', kerzen, { laenge: 10, quelle: 'h' }).wert
    const hl2 = rechneIndikator('sma', kerzen, { laenge: 10, quelle: 'hl2' }).wert
    const i = 200
    const erwartetHl2 = kerzen.slice(i - 9, i + 1).reduce((s, k) => s + (k.h + k.l) / 2, 0) / 10
    check('SMA auf Hoch liegt über SMA auf Schluss', h[i] > c[i])
    check('SMA hl2 nachgerechnet', Math.abs(hl2[i] - erwartetHl2) < 1e-9, `${hl2[i]} vs ${erwartetHl2}`)
    check('Quelle verändert die Kerzen des Aufrufers nicht', kerzen[i].c !== (kerzen[i].h + kerzen[i].l) / 2)
}

console.log('\nGespeicherte Parameter säubern\n')
{
    const p = saubereParams('ema', { laenge: '9999', quelle: 'quatsch', fremd: 1 })
    check('Zahl auf Maximum begrenzt', p.laenge === 500, String(p.laenge))
    check('unbekannte Wahl fällt auf Vorgabe', p.quelle === 'c')
    check('unbekannter Schlüssel fällt weg', !('fremd' in p))
    check('Text statt Zahl → Vorgabe', saubereParams('rsi', { laenge: 'abc' }).laenge === 14)
    check('unbekannter Indikator → leeres Ergebnis statt Absturz', Object.keys(rechneIndikator('gibtsnicht', kerzen, {})).length === 0)
    check('leere Kerzenreihe → leeres Ergebnis', Object.keys(rechneIndikator('ema', [], { laenge: 5 })).length === 0)
}

console.log('\nBeschriftung und Instanzen\n')
check('Kurzname EMA', kurzname('ema', { laenge: 21, quelle: 'c' }, 'EMA') === 'EMA 21')
check('Kurzname zeigt abweichende Quelle', kurzname('sma', { laenge: 50, quelle: 'hl2' }, 'SMA') === 'SMA 50 hl2')
check('Kurzname BB', kurzname('bb', { laenge: 20, mult: 2, basis: 'sma' }, 'BB') === 'BB 20 2')
{
    const a = neueInstanz('ema')
    const b = neueInstanz('ema')
    check('zwei Instanzen desselben Typs haben verschiedene ids', a.id !== b.id)
    check('neue Instanz trägt die Vorgaben', a.params.laenge === 21 && a.sichtbar === true)
}

console.log('\nEingaben säubern\n')
{
    const k = Array.from({ length: 100 }, (_, i) => ({ t: i * 3_600_000, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 10 }))
    let wirft = false
    try { rechneIndikator('ema', k, { laenge: 14.5 }) } catch { wirft = true }
    check('Länge 14.5 wird gerundet statt zu werfen (griff auf candles[i − 14.5])', !wirft && saubereParams('ema', { laenge: 14.5 }).laenge === 15)
    check('leeres Feld ergibt die Vorgabe, nicht das Minimum (EMA 1)', saubereParams('ema', { laenge: '' }).laenge === vorgaben('ema').laenge && saubereParams('ema', { laenge: null }).laenge === vorgaben('ema').laenge)
    check('Gegenprobe: Faktor mit Schritt 0.1 bleibt wie eingegeben (2.25)', saubereParams('bb', { mult: 2.25 }).mult === 2.25)
    check('shared/ema rundet selbst (Strategien mit gebrochener Länge)', ema(k, 14.5)[99] === ema(k, 15)[99])
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
