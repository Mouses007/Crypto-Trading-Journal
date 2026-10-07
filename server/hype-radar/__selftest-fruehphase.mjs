/**
 * Selbsttest: Frühphase des Hype-Radars (die reine Rechnung).
 *
 * Ohne Netz. Geprüft wird vor allem die Gegenrichtung: Was nach Nachfrage
 * aussieht und keine ist (einseitige Käufe, Kreishandel, Volumen ohne
 * Preisbewegung), darf nicht nach oben ranken.
 *
 * Aufruf: node server/hype-radar/__selftest-fruehphase.mjs
 */
import {
    erwaehnungenIn, leseBizKatalog, momentaufnahme, naechsterVerlauf, bewerteFrueh, statusFrueh,
    MAX_VERLAUF, REIF,
} from './fruehphase-bewertung.js'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Hype-Radar: Frühphase')

// ── Erwähnungen ─────────────────────────────────────────────────────────
{
    const e = erwaehnungenIn('New gem $FROG ape now! CA: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU '
        + 'also 0xAbC0000000000000000000000000000000000001 and wSOL So11111111111111111111111111111111111111112')
    p('Solana-Adresse gefunden', e.adressen.includes('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'))
    p('EVM-Adresse klein geschrieben', e.adressen.includes('0xabc0000000000000000000000000000000000001'))
    p('Wrapped SOL zählt nicht als Fund', !e.adressen.includes('So11111111111111111111111111111111111111112'))
    p('Kürzel gefunden', e.kuerzel.includes('FROG'))
    p('ein langes Wort ist keine Adresse',
        erwaehnungenIn('thisisaverylongwordwithoutanydigitsorcapitalsinit').adressen.length === 0)
}
{
    const katalog = [{ page: 1, threads: [
        { no: 1, sub: '/smg/ Solana Meme General', com: 'CA: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU<br>$FROG', replies: 120, last_modified: 1790000000 },
        { no: 2, com: 'link marines &gt; all', replies: 3, last_modified: 1790000100 },
    ] }]
    const f = leseBizKatalog(katalog)
    p('/biz/-Katalog: zwei Fäden', f.length === 2)
    p('HTML entfernt, Adresse lesbar', erwaehnungenIn(f[0].text).adressen.length === 1)
    p('Antworten und Zeit', f[0].antworten === 120 && f[0].zeit === 1790000000000)
    p('kaputter Katalog ergibt nichts', leseBizKatalog({ fehler: 1 }).length === 0)
}

// ── Momentaufnahme und Verlauf ──────────────────────────────────────────
{
    const s = momentaufnahme({ marktKapUsd: 50000, liquiditaetUsd: null, transaktionen1h: 300 }, { erwaehnungen: 2, plattformen: ['biz', 'telegram'] }, 1000)
    p('fehlende Liquidität bleibt null, nicht 0', s.liq === null)
    p('Plattformen gezählt', s.plattformen === 2 && s.erw === 2)
    const v = Array.from({ length: MAX_VERLAUF + 5 }, (_, i) => ({ ts: i }))
    p('Verlauf wird gekappt', naechsterVerlauf(v, { ts: 999 }).length === MAX_VERLAUF)
    p('Verlauf bleibt sortiert', naechsterVerlauf([{ ts: 5 }, { ts: 1 }], { ts: 3 }).map((x) => x.ts).join() === '1,3,5')
}

const H = 3600e3
const stand = (ts, o = {}) => ({ ts, mcap: null, liq: null, preis: null, vol1h: null, tx1h: null, tx5m: null, kv1h: null,
    kaeufer1h: null, verkaeufer1h: null, aend1h: null, antworten: null, erw: 0, plattformen: 0, ...o })

// ── Beschleunigung ──────────────────────────────────────────────────────
{
    const verlauf = [stand(0, { tx1h: 40, mcap: 20000, kaeufer1h: 15, verkaeufer1h: 10, erw: 0 }),
        stand(H, { tx1h: 50, mcap: 22000, kaeufer1h: 20, verkaeufer1h: 12, erw: 1, plattformen: 1 })]
    const jetzt = stand(2 * H, { tx1h: 400, mcap: 90000, kaeufer1h: 180, verkaeufer1h: 90, kv1h: 1.6, erw: 6, plattformen: 3 })
    const b = bewerteFrueh({ stand: jetzt, verlauf, links: { webseiten: ['https://x.io'], kanaele: [{ typ: 'twitter' }] } })
    p('echter Schub bekommt hohe Note', b.note >= 70, `${b.note} ${JSON.stringify(b.teilnoten)}`)
    p('Handelsschub begründet', b.befunde.some((x) => x.schluessel === 'handelSchub'))
    p('Käuferschub begründet', b.befunde.some((x) => x.schluessel === 'kaeuferSchub'))
    p('Sozialschub begründet', b.befunde.some((x) => x.schluessel === 'sozialSchub'))
    p('Momentum begründet', b.befunde.some((x) => x.schluessel === 'momentum'))

    // Derselbe Stand OHNE Beschleunigung: hoher Pegel, aber flach.
    const flach = bewerteFrueh({
        stand: stand(2 * H, { tx1h: 400, mcap: 90000, kaeufer1h: 30, verkaeufer1h: 25, erw: 1, plattformen: 1 }),
        verlauf: [stand(0, { tx1h: 400, mcap: 88000 }), stand(H, { tx1h: 410, mcap: 90000, erw: 1 })],
    })
    p('hoher Pegel ohne Schub rankt niedriger', flach.note < b.note - 20, `${flach.note} vs ${b.note}`)
}
{
    // Ohne Verlauf: die letzten fünf Minuten gegen die Stunde.
    const innen = bewerteFrueh({ stand: stand(0, { tx1h: 120, tx5m: 30 }) })
    p('erster Blick: Schub innerhalb der Stunde', innen.teilnoten.handel === 75, String(innen.teilnoten.handel))
    p('erster Blick: Trend „neu"', innen.trend === 'neu')
}

// ── Inszenierung ────────────────────────────────────────────────────────
{
    const basis = { tx1h: 300, kaeufer1h: 150, verkaeufer1h: 120, mcap: 50000, plattformen: 2, erw: 3 }
    const sauber = bewerteFrueh({ stand: stand(H, basis), verlauf: [stand(0, { tx1h: 100, mcap: 40000 })] })
    const einseitig = bewerteFrueh({ stand: stand(H, { ...basis, kv1h: 15 }), verlauf: [stand(0, { tx1h: 100, mcap: 40000 })] })
    p('einseitige Käufe kosten', einseitig.note < sauber.note && einseitig.befunde.some((x) => x.schluessel === 'einseitig'))
    const kreis = bewerteFrueh({ stand: stand(H, { ...basis, tx1h: 900, kaeufer1h: 30, verkaeufer1h: 20 }), verlauf: [stand(0, { tx1h: 100, mcap: 40000 })] })
    p('Kreishandel erkannt', kreis.befunde.some((x) => x.schluessel === 'kreishandel'))
    const wash = bewerteFrueh({
        stand: stand(2 * H, { ...basis, vol1h: 60000, aend1h: 1.2 }),
        verlauf: [stand(0, { vol1h: 8000, tx1h: 100 }), stand(H, { vol1h: 10000, tx1h: 120 })],
    })
    p('Volumen ohne Preisbewegung: Wash-Verdacht', wash.befunde.some((x) => x.schluessel === 'washVerdacht'))
    const serie = bewerteFrueh({ stand: stand(H, basis), ersteller: { andere: 40, graduiert: 0 } })
    p('Serien-Ersteller kostet', serie.befunde.some((x) => x.schluessel === 'erstellerSerie'))
    const crash = bewerteFrueh({ stand: stand(2 * H, { ...basis, mcap: 5000 }), verlauf: [stand(0, { mcap: 30000 }), stand(H, { mcap: 80000 })] })
    p('Einbruch vom Höchststand erkannt', crash.befunde.some((x) => x.schluessel === 'eingebrochen'))
    p('… und wird verworfen', statusFrueh(stand(0, { mcap: 5000 }), 3, crash.befunde).status === 'verworfen')
}

// ── Team und Status ─────────────────────────────────────────────────────
{
    const mitNote = bewerteFrueh({ stand: stand(0, {}), projektNote: 80 })
    p('Substanz-Note der Projektprüfung trägt die Team-Teilnote', mitNote.teilnoten.team === 80)
    const ohneSpuren = bewerteFrueh({ stand: stand(0, {}) })
    p('keine Webseite, keine Kanäle: benannt', ohneSpuren.befunde.some((x) => x.schluessel === 'keineSpuren'))
    const profil = bewerteFrueh({ stand: stand(0, {}), profil: true, links: { webseiten: ['https://a.io'], kanaele: [{}, {}] } })
    p('Profil und Kanäle heben die Team-Teilnote', profil.teilnoten.team === 100, String(profil.teilnoten.team))
    p('Note bleibt im Bereich', [mitNote, ohneSpuren, profil].every((b) => b.note >= 0 && b.note <= 100))

    p('reif ab Alter und Liquidität', statusFrueh({ liq: REIF.minLiquiditaetUsd, mcap: 1 }, REIF.minAlterStunden, []).status === 'reif')
    p('jung bleibt beobachtet', statusFrueh({ liq: 1e6, mcap: 1 }, 2, []).status === 'beobachtet')
    p('unbekannte Liquidität ist nicht reif', statusFrueh({ liq: null, mcap: 1 }, 30, []).status === 'beobachtet')
}
{
    // Trend gegen die vorige Note.
    const v = [{ ...stand(0, { tx1h: 100 }), note: 20 }]
    const t = bewerteFrueh({ stand: stand(H, { tx1h: 500, kaeufer1h: 200, verkaeufer1h: 100, plattformen: 3, erw: 5 }), verlauf: v })
    p('Trend steigt gegen die vorige Note', t.trend === 'steigt', `${t.note} ${t.trend}`)
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
