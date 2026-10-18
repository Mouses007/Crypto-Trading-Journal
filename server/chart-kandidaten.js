/**
 * Den Chart vermessen, bevor ein Sprachmodell ihn sieht — rein, ohne Netz.
 *
 * Bis 18.10.2026 bekam das Modell 150 Kerzen als CSV und sollte daraus Linien
 * ablesen. Das kann es nicht: aus „Widerstand 82.900" wurde eine Schräge von
 * 82 639 nach 82 900, die Abwärtslinie lag am absoluten Hoch, und die Kerzen
 * wuchsen durch sie hindurch. Ein Modell liest Zahlenreihen, keine Geometrie.
 *
 * Deshalb rechnet hier der Code jede Marke, prüft sie an den Kerzen und gibt
 * ihr eine ID; das Modell wählt nur noch aus, gewichtet und erklärt. Einen
 * Preis, der nicht in der Liste steht, kann es nicht mehr erfinden.
 *
 *   N…  waagerechte Niveaus: geclusterte Wendepunkte (Kette mit 0,5 ATR
 *       Nachbarabstand, höchstens 1 ATR breit), mit Berührungen, Reaktion in
 *       ATR, Durchquerungen ab der ersten Berührung und einer Güte
 *   V…  Volumenprofil des Bereichs (POC, VAH, VAL)
 *   T…  ungebrochene Trendlinien beider Seiten (chart-trendlinien.js)
 *   D…  Niveaus der höheren Zeiteinheit (Abstand in DEREN ATR gemessen —
 *       mit der ATR der Chart-Zeiteinheit blieb auf ETH 1h nur eins übrig)
 *   U…  eigene Linien des Nutzers, nur als Bezug
 *
 * Gleiche Kerzen → gleiche IDs (deterministisch, im Selbsttest geprüft).
 */
import { atr, pivotHighs, pivotLows } from '../shared/indicators.js'
import { volumenprofil } from '../shared/volumenprofil.js'
import { alleTrendlinien, TOL_ATR, MIN_ABSTAND } from './chart-trendlinien.js'
import { trendZustand, durchquerungen } from './strategies/set_and_forget.js'

export const KAND = {
    PIVOT_K: 3,
    CLUSTER_ATR: 0.5,          // Abstand zum Nachbarn in der Kette
    CLUSTER_MAX_ATR: 1,        // Gesamtbreite einer Gruppe
    BAND_MIN_ATR: 0.15,        // halbe Mindestbreite des Bands um den Preis
    REAKTION_KERZEN: 10,
    MAX_NIVEAUS: 8,
    NAH_JE_SEITE: 2,
    TREND_JE_SEITE: 2,
    TREND_MIN_DELTA_ATR: 0.75, // flacher ist es eine waagerechte Marke
    TREND_MAX_ABSTAND_ATR: 4,  // zwei Berührungen nur, wenn so nah am Kurs
    SPANNE_KERZEN: 30,
    HTF_MAX: 4,
    HTF_ABSTAND_ATR_HTF: 3,
    DECKT_ATR: 0.2,            // V/D so nah an einem N → nicht doppelt aufführen
    ROH_KERZEN: 12,
}

/** Zeiteinheit → höhere Zeiteinheit als Kontext; null = keine. */
export const HTF_VON = {
    '1m': '15m', '3m': '1h', '5m': '1h', '15m': '4h', '30m': '4h', '1h': '4h', '2h': '1d', '4h': '1d',
    '6h': '1d', '8h': '1d', '12h': '1d', '1d': '1w', '3d': '1w', '1w': null, '1M': null,
}

const letzteAtr = (kerzen) => { const a = atr(kerzen, 14); return a[a.length - 1] }

/**
 * Wendepunkte zu Niveaus gruppieren. Absolutes Hoch und Tief zählen mit, auch
 * wenn sie am Rand liegen (ein Pivot braucht K Kerzen danach).
 */
export function kandidatenNiveaus(kerzen, { atrWert = letzteAtr(kerzen), k = KAND.PIVOT_K } = {}) {
    const n = kerzen.length
    const A = atrWert
    if (n < 2 * k + 2 || !(A > 0)) return []
    const pts = [
        ...pivotHighs(kerzen, k, k).map((p) => ({ i: p.index, preis: p.price, art: 'hoch' })),
        ...pivotLows(kerzen, k, k).map((p) => ({ i: p.index, preis: p.price, art: 'tief' })),
    ]
    let iH = 0, iL = 0
    for (let i = 1; i < n; i++) { if (kerzen[i].h > kerzen[iH].h) iH = i; if (kerzen[i].l < kerzen[iL].l) iL = i }
    if (!pts.some((p) => p.i === iH && p.art === 'hoch')) pts.push({ i: iH, preis: kerzen[iH].h, art: 'hoch' })
    if (!pts.some((p) => p.i === iL && p.art === 'tief')) pts.push({ i: iL, preis: kerzen[iL].l, art: 'tief' })
    // Reaktion: wie weit lief der Kurs in den REAKTION_KERZEN danach weg (in ATR)?
    for (const p of pts) {
        let ext = null
        for (let j = p.i + 1; j <= Math.min(n - 1, p.i + KAND.REAKTION_KERZEN); j++) {
            const w = p.art === 'hoch' ? kerzen[j].l : kerzen[j].h
            ext = ext == null ? w : (p.art === 'hoch' ? Math.min(ext, w) : Math.max(ext, w))
        }
        p.reakt = ext == null ? 0 : Math.max(0, (p.art === 'hoch' ? p.preis - ext : ext - p.preis) / A)
    }
    pts.sort((x, y) => x.preis - y.preis || x.i - y.i)
    const gruppen = []
    let g = []
    for (const p of pts) {
        if (g.length && p.preis - g[g.length - 1].preis <= KAND.CLUSTER_ATR * A && p.preis - g[0].preis <= KAND.CLUSTER_MAX_ATR * A) g.push(p)
        else { if (g.length) gruppen.push(g); g = [p] }
    }
    if (g.length) gruppen.push(g)
    const kurs = kerzen[n - 1].c
    return gruppen.map((gr) => {
        const preise = gr.map((p) => p.preis).sort((a, b) => a - b)
        const preis = preise[Math.floor(preise.length / 2)]
        const re = gr.map((p) => p.reakt).sort((a, b) => a - b)
        const ersterI = Math.min(...gr.map((p) => p.i)), letzterI = Math.max(...gr.map((p) => p.i))
        const tief = Math.min(preise[0], preis - KAND.BAND_MIN_ATR * A)
        const hoch = Math.max(preise[preise.length - 1], preis + KAND.BAND_MIN_ATR * A)
        // Durchquerungen erst AB der ersten Berührung — davor war die Marke noch keine.
        const durch = durchquerungen(kerzen.slice(ersterI), { tief, hoch })
        const hochs = gr.filter((p) => p.art === 'hoch').length
        const tiefs = gr.length - hochs
        const reaktMax = re[re.length - 1], reaktMed = re[Math.floor(re.length / 2)]
        const frische = n > 1 ? letzterI / (n - 1) : 1
        return {
            preis, tief, hoch,
            beruehrungen: gr.length, hochs, tiefs,
            ersteT: kerzen[ersterI].t, letzteT: kerzen[letzterI].t,
            reaktionMaxAtr: reaktMax, reaktionMedAtr: reaktMed,
            durchquerungen: durch,
            guete: ((reaktMax + reaktMed) / 2) * Math.sqrt(gr.length) * (0.3 + 0.7 * frische) / (1 + 0.5 * durch),
            abstandAtr: (preis - kurs) / A,
            extrem: gr.some((p) => p.i === iH && p.art === 'hoch') ? 'hoch' : gr.some((p) => p.i === iL && p.art === 'tief') ? 'tief' : null,
            rolle: hochs >= 2 && tiefs >= 2 && durch >= 3 ? 'wechsel' : preis >= kurs ? 'widerstand' : 'unterstuetzung',
        }
    })
}

/**
 * Auswahl: je Seite die nächsten zuerst (ein Trader braucht die Marken am Kurs),
 * dann nach Güte auffüllen. Zulassung: ≥ 2 Berührungen, Extrem des Bereichs oder
 * eine deutliche Einzelreaktion ohne viele Durchquerungen.
 */
export function waehleNiveaus(niveaus, kurs, { max = KAND.MAX_NIVEAUS, nah = KAND.NAH_JE_SEITE } = {}) {
    const zugelassen = niveaus.filter((x) => x.beruehrungen >= 2 || x.extrem || (x.reaktionMaxAtr >= 3 && x.durchquerungen <= 2))
    const wahl = new Set()
    const oben = zugelassen.filter((x) => x.preis > kurs).sort((a, b) => a.preis - b.preis).slice(0, nah)
    const unten = zugelassen.filter((x) => x.preis <= kurs).sort((a, b) => b.preis - a.preis).slice(0, nah)
    for (const x of [...oben, ...unten]) wahl.add(x)
    for (const x of [...zugelassen].sort((a, b) => b.guete - a.guete)) { if (wahl.size >= max) break; wahl.add(x) }
    return [...wahl].sort((a, b) => b.preis - a.preis)
}

/**
 * Trendlinien-Kandidaten beider Seiten. Raus: fast flache (das ist eine waagerechte
 * Marke), zwei Berührungen weit weg vom Kurs, und Doppelte (jetzt < 0,5 ATR auseinander).
 */
export function kandidatenTrendlinien(kerzen, atrWert, { jeSeite = KAND.TREND_JE_SEITE } = {}) {
    const n = kerzen.length
    if (n < 2 * KAND.PIVOT_K + MIN_ABSTAND || !(atrWert > 0)) return []
    const kurs = kerzen[n - 1].c
    const aus = []
    for (const seite of ['hoch', 'tief']) {
        const gewaehlt = []
        for (const c of alleTrendlinien(kerzen, seite, { tol: TOL_ATR * atrWert })) {
            if (Math.abs(c.p2 - c.p1) < KAND.TREND_MIN_DELTA_ATR * atrWert) continue
            const steigung = (c.p2 - c.p1) / (c.i2 - c.i1)
            const wertJetzt = c.p1 + steigung * (n - 1 - c.i1)
            const abstandAtr = (wertJetzt - kurs) / atrWert
            if (c.beruehrungen < 3 && Math.abs(abstandAtr) > KAND.TREND_MAX_ABSTAND_ATR) continue
            if (gewaehlt.some((d) => Math.abs(d.wertJetzt - wertJetzt) < 0.5 * atrWert)) continue
            gewaehlt.push({
                seite, richtung: steigung < 0 ? 'ab' : 'auf',
                t1: kerzen[c.i1].t, p1: c.p1, t2: kerzen[c.i2].t, p2: c.p2,
                beruehrungen: c.beruehrungen, wertJetzt, abstandAtr,
            })
            if (gewaehlt.length >= jeSeite) break
        }
        aus.push(...gewaehlt)
    }
    return aus
}

/**
 * Marktstruktur: die letzten Hochs/Tiefs mit HH/LH bzw. HL/LL, der Zustand
 * (wie in Set and Forget: gilt bis zum Bruch) und der letzte Strukturbruch —
 * ein Schluss jenseits des zuletzt BESTÄTIGTEN Wendepunkts.
 */
export function marktstruktur(kerzen, k = KAND.PIVOT_K) {
    const hochs = pivotHighs(kerzen, k, k)
    const tiefs = pivotLows(kerzen, k, k)
    const benenne = (liste, oben) => liste.slice(-4).map((p, i, a) => ({
        t: p.t, p: p.price,
        art: i === 0 ? null : oben ? (p.price > a[i - 1].price ? 'HH' : 'LH') : (p.price > a[i - 1].price ? 'HL' : 'LL'),
    })).slice(-3)
    let bruch = null
    let hi = 0, ti = 0, letztesH = null, letztesT = null
    for (let i = 0; i < kerzen.length; i++) {
        while (hi < hochs.length && hochs[hi].index + k <= i) letztesH = hochs[hi++]
        while (ti < tiefs.length && tiefs[ti].index + k <= i) letztesT = tiefs[ti++]
        const c = kerzen[i].c
        if (letztesH && c > letztesH.price) { bruch = { richtung: 'auf', marke: letztesH.price, t: kerzen[i].t }; letztesH = null }
        if (letztesT && c < letztesT.price) { bruch = { richtung: 'ab', marke: letztesT.price, t: kerzen[i].t }; letztesT = null }
    }
    return { hochs: benenne(hochs, true), tiefs: benenne(tiefs, false), zustand: trendZustand(kerzen, k, k), bruch }
}

export function spanneLetzte(kerzen, n, atrWert) {
    const r = kerzen.slice(-n)
    if (!r.length) return null
    const hoch = Math.max(...r.map((x) => x.h)), tief = Math.min(...r.map((x) => x.l))
    const kurs = kerzen[kerzen.length - 1].c
    return { tief, hoch, breiteAtr: atrWert > 0 ? (hoch - tief) / atrWert : null, positionPct: hoch > tief ? ((kurs - tief) / (hoch - tief)) * 100 : 50, kerzen: r.length }
}

/** Alles zusammen, mit stabilen IDs. */
export function baueKandidaten({ kerzen, kerzenHtf = null, interval = null, intervalHtf = null, zeichnungen = [] }) {
    const n = kerzen.length
    if (n < 30) return null
    const A = letzteAtr(kerzen)
    if (!(A > 0)) return null
    const kurs = kerzen[n - 1].c
    const vonT = kerzen[0].t, bisT = kerzen[n - 1].t
    const kandidaten = []
    const nahAnN = (preis, niveaus) => niveaus.find((x) => Math.abs(x.preis - preis) < KAND.DECKT_ATR * A)

    const niveaus = waehleNiveaus(kandidatenNiveaus(kerzen, { atrWert: A }), kurs)
    niveaus.forEach((x, i) => kandidaten.push({ id: `N${i + 1}`, quelle: 'niveau', ...x, t1: x.ersteT }))
    const nListe = kandidaten.slice()

    const vp = volumenprofil(kerzen, { zeilen: 48 })
    if (vp) {
        let v = 1
        for (const [name, preis] of [['POC', vp.poc], ['VAH', vp.vah], ['VAL', vp.val]]) {
            const deckt = nahAnN(preis, nListe)
            kandidaten.push({ id: `V${v++}`, quelle: 'volumenprofil', name, preis, tief: preis - KAND.BAND_MIN_ATR * A, hoch: preis + KAND.BAND_MIN_ATR * A, t1: vonT, abstandAtr: (preis - kurs) / A, deckt: deckt?.id || null })
        }
    }

    kandidatenTrendlinien(kerzen, A).forEach((x, i) => kandidaten.push({ id: `T${i + 1}`, quelle: 'trend', ...x }))

    if (Array.isArray(kerzenHtf) && kerzenHtf.length >= 30) {
        const Ah = letzteAtr(kerzenHtf)
        const htf = waehleNiveaus(kandidatenNiveaus(kerzenHtf, { atrWert: Ah }), kurs, { max: 6 })
            .filter((x) => Math.abs(x.preis - kurs) <= KAND.HTF_ABSTAND_ATR_HTF * Ah)
            .slice(0, KAND.HTF_MAX)
        htf.forEach((x, i) => kandidaten.push({
            id: `D${i + 1}`, quelle: 'htf', ...x, t1: Math.max(x.ersteT, vonT),
            abstandAtr: (x.preis - kurs) / A, deckt: nahAnN(x.preis, nListe)?.id || null,
        }))
    }

    const nutzer = (zeichnungen || []).filter((z) => ['horizontale', 'strahlH', 'trendlinie', 'strahl', 'rechteck', 'volprofil'].includes(z.typ))
        .slice(0, 12).map((z, i) => ({ id: `U${i + 1}`, typ: z.typ, punkte: z.punkte || [], text: z.stil?.text || '' }))

    return {
        kurs, atr: A, vonT, bisT, interval, intervalHtf,
        spanne: spanneLetzte(kerzen, KAND.SPANNE_KERZEN, A),
        struktur: marktstruktur(kerzen),
        kandidaten, nutzer,
        roh: kerzen.slice(-KAND.ROH_KERZEN),
        volMedian: (() => { const v = kerzen.slice(-50).map((x) => x.v).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] || null })(),
    }
}

// ── Text für das Modell ─────────────────────────────────────────────────
export function zahl(x) {
    if (!Number.isFinite(x)) return '—'
    const a = Math.abs(x)
    if (a >= 1000) return x.toFixed(0)
    if (a >= 1) return x.toFixed(a >= 100 ? 2 : 4).replace(/0+$/, '').replace(/\.$/, '')
    return Number(x.toPrecision(5)).toString()
}
const zeit = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + 'Z'
const atrText = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`
const ZUSTAND = { 1: 'aufwärts', '-1': 'abwärts', 0: 'unbestimmt' }

/** Preis eines Kandidaten (bei Trendlinien der Wert jetzt). */
export const preisVon = (k) => (k.quelle === 'trend' ? k.wertJetzt : k.preis)

export function kandidatenText(paket) {
    const z = []
    const { kurs, atr: A, spanne, struktur } = paket
    z.push(`KURS ${zahl(kurs)} (letzter Schluss ${zeit(paket.bisT)}), ATR(14) ${zahl(A)} = ${(A / kurs * 100).toFixed(2)} %`)
    if (spanne) z.push(`SPANNE der letzten ${spanne.kerzen} Kerzen ${zahl(spanne.tief)}–${zahl(spanne.hoch)} = ${spanne.breiteAtr.toFixed(1)} ATR; Kurs bei ${spanne.positionPct.toFixed(0)} % der Spanne`)
    const n = paket.kandidaten.filter((k) => k.quelle === 'niveau')
    if (n.length) {
        z.push('', 'NIVEAUS (id | Preis | Band | Berührungen gesamt (an Hochs/an Tiefs) | letzte Berührung | max. Reaktion in ATR | Durchquerungen seit der ersten Berührung | Abstand zum Kurs in ATR):')
        for (const x of n) z.push(`${x.id} | ${zahl(x.preis)} | ${zahl(x.tief)}–${zahl(x.hoch)} | ${x.beruehrungen} (${x.hochs}/${x.tiefs}) | ${zeit(x.letzteT)} | ${x.reaktionMaxAtr.toFixed(1)} | ${x.durchquerungen} | ${atrText(x.abstandAtr)}${x.extrem ? ` | ${x.extrem === 'hoch' ? 'Hoch' : 'Tief'} des Bereichs` : ''}${x.rolle === 'wechsel' ? ' | Drehpunkt (mal Unterstützung, mal Widerstand)' : ''}`)
    }
    const v = paket.kandidaten.filter((k) => k.quelle === 'volumenprofil')
    if (v.length) z.push('', 'VOLUMENPROFIL des Bereichs: ' + v.map((x) => `${x.id} ${x.name} ${zahl(x.preis)} (${atrText(x.abstandAtr)} ATR${x.deckt ? `, deckt sich mit ${x.deckt}` : ''})`).join(' | '))
    const t = paket.kandidaten.filter((k) => k.quelle === 'trend')
    if (t.length) {
        z.push('', 'TRENDLINIEN — alle an den Kerzen geprüft, ungebrochen (id | Seite | Anker 1 → Anker 2 | Berührungen | Wert jetzt | Abstand in ATR):')
        for (const x of t) z.push(`${x.id} | an ${x.seite === 'hoch' ? 'Hochs' : 'Tiefs'}, ${x.richtung === 'ab' ? 'fallend' : 'steigend'} | ${zeit(x.t1)} ${zahl(x.p1)} → ${zeit(x.t2)} ${zahl(x.p2)} | ${x.beruehrungen} | ${zahl(x.wertJetzt)} | ${atrText(x.abstandAtr)}`)
    } else z.push('', 'TRENDLINIEN: keine ungebrochene Linie mit genug Berührungen.')
    if (struktur) {
        const folge = (l) => l.map((p) => `${zahl(p.p)}${p.art ? ` ${p.art}` : ''} (${zeit(p.t)})`).join(' → ')
        z.push('', `STRUKTUR: Hochs ${folge(struktur.hochs) || '—'}; Tiefs ${folge(struktur.tiefs) || '—'}; Zustand ${ZUSTAND[struktur.zustand]}${struktur.bruch ? `; letzter Bruch ${struktur.bruch.richtung === 'auf' ? 'aufwärts über' : 'abwärts unter'} ${zahl(struktur.bruch.marke)} am ${zeit(struktur.bruch.t)}` : ''}`)
    }
    const d = paket.kandidaten.filter((k) => k.quelle === 'htf')
    if (d.length) {
        z.push('', `HÖHERE ZEITEINHEIT ${paket.intervalHtf} (id | Preis | Band | Berührungen | Abstand in ATR der Chart-Zeiteinheit):`)
        for (const x of d) z.push(`${x.id} | ${zahl(x.preis)} | ${zahl(x.tief)}–${zahl(x.hoch)} | ${x.beruehrungen} | ${atrText(x.abstandAtr)}${x.deckt ? ` | deckt sich mit ${x.deckt}` : ''}${kurs >= x.tief && kurs <= x.hoch ? ' | Kurs liegt im Band' : ''}`)
    }
    if (paket.nutzer.length) {
        z.push('', 'EIGENE LINIEN DES NUTZERS (nur als Bezug — nicht als Linie auswählbar):')
        for (const u of paket.nutzer) {
            const p = u.punkte
            const text = u.text ? ` „${u.text}"` : ''
            if (u.typ === 'rechteck') z.push(`${u.id} | Zone ${zahl(Math.min(p[0]?.p, p[1]?.p))}–${zahl(Math.max(p[0]?.p, p[1]?.p))}${text}`)
            else if (u.typ === 'volprofil') z.push(`${u.id} | Volumenprofil ${zeit(Math.min(p[0]?.t, p[1]?.t))} → ${zeit(Math.max(p[0]?.t, p[1]?.t))}`)
            else if (p.length > 1) z.push(`${u.id} | ${u.typ} ${zeit(p[0].t)} ${zahl(p[0].p)} → ${zeit(p[1].t)} ${zahl(p[1].p)}${text}`)
            else if (p.length) z.push(`${u.id} | ${u.typ} bei ${zahl(p[0].p)}${text}`)
        }
    }
    z.push('', `LETZTE ${paket.roh.length} KERZEN (Zeit,Eröffnung,Hoch,Tief,Schluss,Volumen relativ zum Median der letzten 50):`)
    for (const x of paket.roh) z.push([zeit(x.t), zahl(x.o), zahl(x.h), zahl(x.l), zahl(x.c), paket.volMedian ? (x.v / paket.volMedian).toFixed(1) : '—'].join(','))
    return z.join('\n')
}
