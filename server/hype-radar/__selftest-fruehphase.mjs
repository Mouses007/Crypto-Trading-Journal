/**
 * Selbsttest: Frühphase des Hype-Radars (die reine Rechnung).
 *
 * Ohne Netz. Geprüft wird vor allem die Gegenrichtung: Was nach Nachfrage
 * aussieht und keine ist (einseitige Käufe, Kreishandel, Volumen ohne
 * Preisbewegung), darf nicht nach oben ranken.
 *
 * Aufruf: node server/hype-radar/__selftest-fruehphase.mjs
 */
import { ausRugCheck } from './sicherheit.js'
import {
    erwaehnungenIn, leseBizKatalog, momentaufnahme, naechsterVerlauf, bewerteFrueh, statusFrueh, xNennungen, risikoFrueh,
    kaeufeAusTransaktion, handelAusTransaktion, smartSignale, smartWalletListe, risikoUnpruefbar, meldefaehig, hatMessung, verteilePlaetze, istDuenn, kandidatStatus, belastbarkeit,
    RENT_KONTO_LAMPORTS, MIN_KAUF_LAMPORTS,
    MAX_VERLAUF, REIF, X_MIN_AUTOREN_NEU, MAX_ALTER_STUNDEN, MIN_TEILNOTEN_MELDUNG, STILL_MIN, MIN_TX_AKTIV, KANDIDAT_AB,
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

// ── X über Grok: zählen, was belegt ist ─────────────────────────────────
{
    const BEK = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
    const NEU = '9yKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
    const post = (handle, id, text) => ({ handle, id, url: `https://x.com/${handle}/status/${id}`, text })
    const posts = [
        post('alice', '1', `aping ${BEK} now`),
        post('alice', '2', `${BEK} again!!`),
        post('alice', '3', `${BEK} third time`),
        post('bob', '4', 'love $FOO'),
        post('carol', '5', `new gem ${NEU}`),
        post('erfunden', '99', `${BEK} ${NEU}`),          // nicht zitiert
    ]
    const zitiert = new Set(['1', '2', '3', '4', '5'])
    const bekannt = { adressen: new Set([BEK]), symbole: new Map([['FOO', BEK], ['BAR', null]]) }
    const n = xNennungen(posts, zitiert, bekannt)
    p('X: nicht zitierte Posts fallen weg', n.verworfen === 1, String(n.verworfen))
    p('X: Autoren statt Posts (alice dreimal = 1)', n.adressen.get(BEK)?.autoren === 2, JSON.stringify(n.adressen.get(BEK)))
    p('X: Belege je Autor, nicht je Post', n.adressen.get(BEK)?.belege.length === 2)
    p('X: unbekannter Token mit EINEM Autor wird nicht angelegt', !n.adressen.has(NEU))
    const zwei = xNennungen([...posts, post('dave', '6', `${NEU} 🚀`)], new Set([...zitiert, '6']), bekannt)
    p(`X: unbekannter Token ab ${X_MIN_AUTOREN_NEU} Autoren`, zwei.adressen.get(NEU)?.autoren === 2)
    p('X: mehrdeutiges Kürzel zählt nicht',
        xNennungen([post('eve', '7', '$BAR moon')], new Set(['7']), bekannt).adressen.size === 0)
    p('X: ohne Zitatliste entfällt nur diese Sperre',
        xNennungen(posts, new Set(), bekannt).adressen.get(BEK)?.autoren === 3)
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
    // Ohne Verlauf: die letzten fünf Minuten gegen die 55 Minuten davor.
    // 110 Handel in 55 min = 2/min, 30 in 5 min = 6/min → 3× → 75.
    const innen = bewerteFrueh({ stand: stand(0, { tx1h: 140, tx5m: 30 }), geborenAm: -3 * H })
    p('erster Blick: Schub innerhalb der Stunde', innen.teilnoten.handel === 75, String(innen.teilnoten.handel))
    p('erster Blick: Trend „neu"', innen.trend === 'neu')
    p('erster Blick ohne bekanntes Alter: keine Aussage', bewerteFrueh({ stand: stand(0, { tx1h: 140, tx5m: 30 }) }).teilnoten.handel === null)
}

// ── Junge Token: die „Stunde" deckt nur ihr Alter ab ────────────────────
{
    const M = 60e3
    /*
     * Der Fall aus dem ersten Lauf (07.10.2026): 18 Minuten alt, gleichmässig
     * 10 Handel je Minute. Die alte Rechnung (5 min ×12 gegen die Stunde)
     * ergab 50·12/180 = 3,3× — „Schub", und die Meldung ging hinaus.
     */
    const gleich = bewerteFrueh({ stand: stand(18 * M, { tx1h: 180, tx5m: 50 }), geborenAm: 0 })
    p('junger Token, gleichmässiger Handel: kein Schub', !gleich.befunde.some((x) => x.schluessel === 'handelSchub')
        && gleich.teilnoten.handel === 25, `${gleich.teilnoten.handel} ${JSON.stringify(gleich.befunde)}`)
    const sechs = bewerteFrueh({ stand: stand(6 * M, { tx1h: 60, tx5m: 50 }), geborenAm: 0 })
    p('sechs Minuten alt: zu kurz für einen Vergleich', sechs.teilnoten.handel === null, String(sechs.teilnoten.handel))
    // Gegenprobe: ein echter Schub bei einem jungen Token bleibt einer.
    // 150 in 25 min = 6/min davor, 150 in 5 min = 30/min jetzt → 5×.
    const echt = bewerteFrueh({ stand: stand(30 * M, { tx1h: 300, tx5m: 150 }), geborenAm: 0 })
    p('junger Token, echter Schub: erkannt', echt.befunde.some((x) => x.schluessel === 'handelSchub') && echt.teilnoten.handel === 100,
        String(echt.teilnoten.handel))

    // Mit Verlauf: jede Aufnahme deckte nur das Alter bis dahin ab.
    // Alt: Median(150, 300, 450) = 300, 600 / 300 = 2× — Schub aus dem Nichts.
    const v = [15, 30, 45].map((m) => stand(m * M, { tx1h: m * 10, kaeufer1h: m * 2 }))
    const verlaufGleich = bewerteFrueh({ stand: stand(60 * M, { tx1h: 600, kaeufer1h: 120 }), verlauf: v, geborenAm: 0 })
    p('junger Verlauf, gleichmässig: kein Schub', !verlaufGleich.befunde.some((x) => x.schluessel === 'handelSchub')
        && Math.round(verlaufGleich.teilnoten.handel) === 25, String(verlaufGleich.teilnoten.handel))
    p('junger Verlauf, gleichmässig: kein Käuferschub', !verlaufGleich.befunde.some((x) => x.schluessel === 'kaeuferSchub'))
    const verlaufEcht = bewerteFrueh({ stand: stand(60 * M, { tx1h: 2400, kaeufer1h: 400 }), verlauf: v, geborenAm: 0 })
    p('junger Verlauf, echter Schub: erkannt', verlaufEcht.befunde.some((x) => x.schluessel === 'handelSchub')
        && verlaufEcht.befunde.some((x) => x.schluessel === 'kaeuferSchub'))
    // Volumen eines jungen Tokens wächst mit dem Alter — das ist kein Wash-Trading.
    const vv = [15, 30, 45].map((m) => stand(m * M, { vol1h: m * 100, tx1h: m * 10 }))
    const volGleich = bewerteFrueh({ stand: stand(60 * M, { vol1h: 6000, tx1h: 600, aend1h: 1 }), verlauf: vv, geborenAm: 0 })
    p('junges Volumen, gleichmässig: kein Wash-Verdacht', !volGleich.befunde.some((x) => x.schluessel === 'washVerdacht'))

    // Über einer Stunde ändert das Alter nichts: dieselbe Note wie ohne.
    const altV = [stand(0, { tx1h: 40 }), stand(H, { tx1h: 50 })]
    const mitAlter = bewerteFrueh({ stand: stand(2 * H, { tx1h: 400 }), verlauf: altV, geborenAm: -10 * H })
    const ohneAlter = bewerteFrueh({ stand: stand(2 * H, { tx1h: 400 }), verlauf: altV })
    p('alter Token: Alter ändert den Schub nicht', mitAlter.teilnoten.handel === ohneAlter.teilnoten.handel && mitAlter.teilnoten.handel === 100)
}

// ── Meldefähig: Abdeckung, Vertragsprüfung, Status ──────────────────────
{
    const nurTeam = bewerteFrueh({ stand: stand(0, {}), projektNote: 90 })
    p('eine Teilnote: Abdeckung 1', nurTeam.abdeckung === 1)
    p('… als „dünn" benannt', nurTeam.befunde.some((x) => x.schluessel === 'duenn'))
    const drei = bewerteFrueh({ stand: stand(0, { tx1h: 140, tx5m: 30, kaeufer1h: 100 }), projektNote: 60, geborenAm: -3 * H })
    p('drei Teilnoten: Abdeckung 3, nicht dünn', drei.abdeckung === 3 && !drei.befunde.some((x) => x.schluessel === 'duenn'),
        `${drei.abdeckung} ${JSON.stringify(drei.teilnoten)}`)

    const geprueft = { ko: null, abzug: 0, befunde: [], am: 1 }
    const ok = { status: 'beobachtet', belastbar: true, risiko: geprueft, projektGeprueft: true, tx1h: MIN_TX_AKTIV }
    p('meldefähig: belastbar, geprüft, Projekt geprüft, Handel läuft', meldefaehig(ok).ja)
    p('NICHT meldefähig: nicht belastbar', meldefaehig({ ...ok, belastbar: false }).grund === 'duenn')
    p('NICHT meldefähig: ungeprüft', meldefaehig({ ...ok, risiko: null }).grund === 'ungeprueft')
    p('NICHT meldefähig: kein Prüfdienst', meldefaehig({ ...ok, risiko: risikoUnpruefbar(1) }).grund === 'ungeprueft')
    p('NICHT meldefähig: verworfen', meldefaehig({ ...ok, status: 'verworfen' }).grund === 'verworfen')
    p('NICHT meldefähig: Vertrag mit K.-o.', meldefaehig({ ...ok, risiko: { ...geprueft, ko: { grund: 'x' } } }).grund === 'verworfen')
    p('NICHT meldefähig: Projekt ungeprüft', meldefaehig({ ...ok, projektGeprueft: false }).grund === 'projekt')
    p('NICHT meldefähig: kein laufender Handel', meldefaehig({ ...ok, tx1h: MIN_TX_AKTIV - 1 }).grund === 'handel')
    p('NICHT meldefähig: Handel unbekannt', meldefaehig({ ...ok, tx1h: null }).grund === 'handel')
    p('Smart Money braucht nur die Vertragsprüfung',
        meldefaehig({ status: 'beobachtet', belastbar: false, risiko: geprueft, smart: true, projektGeprueft: false, tx1h: 0 }).ja)
    p('… aber die braucht es', !meldefaehig({ status: 'beobachtet', risiko: null, smart: true }).ja)

    const u = risikoUnpruefbar(5)
    const mitU = bewerteFrueh({ stand: stand(0, {}), projektNote: 60, risiko: u })
    const ohneU = bewerteFrueh({ stand: stand(0, {}), projektNote: 60 })
    p('nicht prüfbar: kein Abzug', mitU.note === ohneU.note && u.abzug === 0)
    p('nicht prüfbar: benannt', mitU.befunde.some((x) => x.schluessel === 'risikoUnpruefbar'))
}

// ── Ohne Messung kein Stand ─────────────────────────────────────────────
{
    // Der Lauf vom 07.10.2026 18:52: lauter null, nur fortgeschriebenes King of the Hill.
    p('nichts gemessen: keine Messung', !hatMessung(stand(H, { kothMin: 12 })))
    p('… auch nicht durch fortgeschriebenes X', !hatMessung(stand(H, { plattformen: 1, erw: 3 })))
    p('Nennung in DIESEM Durchgang zählt', hatMessung(stand(H, {}), true))
    p('eine Bewertung zählt', hatMessung(stand(H, { mcap: 3256 })))
    p('null Transaktionen sind eine Messung, kein Fehlen', hatMessung(stand(H, { tx1h: 0 })))
    p('pump.fun-Kommentare zählen', hatMessung(stand(H, { antworten: 0 })))
    // Was ohne die Sperre geschah: Team allein trägt die Note.
    const leer = bewerteFrueh({ stand: stand(H, {}), links: { webseiten: ['https://a.fun'], kanaele: [{ typ: 'twitter', url: 'https://x.com/afun' }] } })
    p('ohne Messung käme die Note allein aus dem Team', leer.abdeckung === 1 && leer.note === 50, `${leer.note}`)
}

// ── Still: tot, nicht ruhig ─────────────────────────────────────────────
{
    const M = 60e3
    const tot = bewerteFrueh({ stand: stand(40 * M, { tx1h: 0, mcap: 3256 }), geborenAm: 0 })
    p('40 min ohne einen Handel: still', tot.befunde.some((x) => x.schluessel === 'still'))
    p('… und verworfen, Grund „still"', statusFrueh({ liq: null, mcap: 3256 }, 0.7, tot.befunde).grund === 'still')
    // Gegenproben: zu jung, ein einziger Handel, unbekannt.
    p('20 min ohne Handel: noch nicht still', !bewerteFrueh({ stand: stand(20 * M, { tx1h: 0 }), geborenAm: 0 })
        .befunde.some((x) => x.schluessel === 'still'))
    p('ein Handel ist nicht still', !bewerteFrueh({ stand: stand(40 * M, { tx1h: 1 }), geborenAm: 0 })
        .befunde.some((x) => x.schluessel === 'still'))
    p('unbekannte Transaktionen sind nicht still', !bewerteFrueh({ stand: stand(3 * H, { tx1h: null }), geborenAm: 0 })
        .befunde.some((x) => x.schluessel === 'still'))
    // Ohne Alter: zwei Aufnahmen ohne Handel, mindestens STILL_MIN auseinander.
    const zwei = bewerteFrueh({ stand: stand(STILL_MIN * M, { tx1h: 0 }), verlauf: [stand(0, { tx1h: 0 })] })
    p('ohne Alter: zwei stille Aufnahmen über 30 min', zwei.befunde.some((x) => x.schluessel === 'still'))
    p('ohne Alter: eine stille Aufnahme reicht nicht', !bewerteFrueh({ stand: stand(H, { tx1h: 0 }) })
        .befunde.some((x) => x.schluessel === 'still'))
    p('ohne Alter: zu nah beieinander reicht nicht', !bewerteFrueh({ stand: stand(10 * M, { tx1h: 0 }), verlauf: [stand(0, { tx1h: 0 })] })
        .befunde.some((x) => x.schluessel === 'still'))
}

// ── Schub braucht eine echte Basis ──────────────────────────────────────
{
    const M = 60e3
    // Der Fall MPAD (07.10.2026): Basis ein einziger Handel, „Schub 199×".
    const mini = bewerteFrueh({ stand: stand(16 * M, { tx1h: 260, tx5m: 60 }), verlauf: [stand(12 * M, { tx1h: 1 })], geborenAm: 0 })
    p('Basis aus einem Handel zählt nicht als Verlauf', !mini.befunde.some((x) => x.schluessel === 'handelSchub' && /eigenen Schnitt/.test(x.text)),
        JSON.stringify(mini.befunde.map((x) => x.text)))
    // Gegenprobe: eine tragfähige Basis bleibt Basis.
    const echt = bewerteFrueh({ stand: stand(2 * H, { tx1h: 400 }), verlauf: [stand(0, { tx1h: 40 }), stand(H, { tx1h: 50 })] })
    p('Basis ab 20 Handel trägt den Verlauf', echt.befunde.some((x) => x.schluessel === 'handelSchub' && /eigenen Schnitt/.test(x.text)))
}

// ── Liste: dünne Noten nach unten ───────────────────────────────────────
{
    p('eine Teilnote ist dünn', istDuenn({ teilnoten: { team: 90 } }))
    p('drei Teilnoten, zwei aus dem Markt: belastbar', !istDuenn({ teilnoten: { handel: 10, momentum: 5, team: 50 } }))
    // Team (aus Links) und Sozial (aus „nirgends genannt") gibt es für fast jeden Token.
    p('drei Teilnoten, nur eine aus dem Markt: dünn', istDuenn({ teilnoten: { handel: 10, team: 50, sozial: 0 } }))
    p('Abdeckung zählt nur Gemessenes', istDuenn({ teilnoten: { handel: null, team: 50 } }))
    p('kein Stand ist dünn', istDuenn(null))
    // Schub gegen eine fast leere Basis: die Richtung zählt, die Zahl nicht.
    const M = 60e3
    const riesig = bewerteFrueh({ stand: stand(20 * M, { tx1h: 201, tx5m: 200 }), geborenAm: 0 })
    p('Schub über 10× wird als „über 10×" genannt', riesig.befunde.some((x) => x.schluessel === 'handelSchub' && /über 10×/.test(x.text)),
        JSON.stringify(riesig.befunde.map((x) => x.text)))
    p('… und trägt die Teilnote trotzdem voll', riesig.teilnoten.handel === 100)
}

// ── Sozial: für jeden Token gleich ──────────────────────────────────────
{
    // pump.fun-Token haben eine Kommentarzahl (oft 0), andere nicht.
    const pump = stand(H, { antworten: 0, tx1h: 100 })
    const andere = stand(H, { antworten: null, tx1h: 100 })
    const a = bewerteFrueh({ stand: pump, sozialGeprueft: true })
    const b = bewerteFrueh({ stand: andere, sozialGeprueft: true })
    p('Sozial geprüft: pump.fun und andere gleich (0)', a.teilnoten.sozial === 0 && b.teilnoten.sozial === 0)
    const c = bewerteFrueh({ stand: pump, sozialGeprueft: false })
    const d = bewerteFrueh({ stand: andere, sozialGeprueft: false })
    p('Sozial ungeprüft: pump.fun und andere gleich (unbekannt)', c.teilnoten.sozial === null && d.teilnoten.sozial === null)
    // Ein Kommentar-Zuwachs ist ein Beleg — auch ohne soziale Quelle.
    const kom = bewerteFrueh({ stand: stand(H, { antworten: 60 }), verlauf: [stand(0, { antworten: 10 })] })
    p('Kommentar-Zuwachs zählt als Sozialmessung', kom.teilnoten.sozial === 15 && kom.befunde.some((x) => x.schluessel === 'kommentare'))
}

// ── Momentum über höchstens zwölf Stunden ───────────────────────────────
{
    // 20 h alt: 1000 → (6 h alt) 2000 → jetzt 4000. Gemessen wird ab 2000 (+100 %), nicht ab 1000 (+300 %).
    const v = [stand(-20 * H, { mcap: 1000 }), stand(-6 * H, { mcap: 2000 })]
    const m = bewerteFrueh({ stand: stand(0, { mcap: 4000 }), verlauf: v })
    p('Momentum: Basis höchstens zwölf Stunden zurück', m.teilnoten.momentum === 50, String(m.teilnoten.momentum))
    p('… und der Befund nennt den Zeitraum', m.befunde.some((x) => x.schluessel === 'momentum' && / in 6 h$/.test(x.text)),
        JSON.stringify(m.befunde.map((x) => x.text)))
}

// ── Das Fenster einer Aufnahme bleibt ihres ─────────────────────────────
{
    const M = 60e3
    // Alte Aufnahme deckte 15 Minuten ab (Paar so jung): 300 Tx = 20/min.
    // Heute ist das Paar älter, der Token zählt anders — die alte Rate darf sich nicht ändern.
    const alt = { ...stand(-45 * M, { tx1h: 300 }), fenster: 15 }
    const jetzt = { ...stand(0, { tx1h: 1200 }), fenster: 60 }   // 20/min — gleichmässig
    const b = bewerteFrueh({ stand: jetzt, verlauf: [alt], geborenAm: -10 * H })
    p('gespeichertes Fenster: gleichmässiger Handel bleibt gleichmässig', Math.round(b.teilnoten.handel) === 25, String(b.teilnoten.handel))
}

// ── Leer: nur für Pools, nicht für die Kurve ────────────────────────────
{
    p('Pool mit 50 USD Liquidität ist leer', statusFrueh({ liq: 50, mcap: 3000 }, 1, [], { aufKurve: false }).grund === 'leer')
    p('auf der Kurve ist wenig Liquidität kein „leer"', statusFrueh({ liq: 50, mcap: 3000 }, 1, [], { aufKurve: true }).status === 'beobachtet')
    p('unbekannte Liquidität ist nicht leer', statusFrueh({ liq: null, mcap: 3000 }, 1, []).status === 'beobachtet')
}

// ── Kandidat: meldefähig, frisch, Note ──────────────────────────────────
{
    const geprueft = { ko: null, abzug: 0, befunde: [], am: 1 }
    const zeile = (o = {}) => ({
        status: 'beobachtet', note: 60, letzterBlick: '1000000', projektNote: 55,
        ...o, stand: { teilnoten: { handel: 80, momentum: 40, team: 55 }, risiko: geprueft, tx1h: 120, ...(o.stand || {}) },
    })
    const lauf = { letzterLauf: 1000000, schwelle: KANDIDAT_AB }
    p('Kandidat: alles erfüllt', kandidatStatus(zeile(), lauf).ja)
    p('Kein Kandidat: im letzten Durchgang nicht gemessen', kandidatStatus(zeile({ letzterBlick: '400000' }), lauf).grund === 'veraltet')
    p('Kein Kandidat: Note unter der Schwelle', kandidatStatus(zeile({ note: KANDIDAT_AB - 1 }), lauf).grund === 'note')
    p('Kein Kandidat: dünn', kandidatStatus(zeile({ stand: { teilnoten: { handel: 80, team: 55, sozial: 0 } } }), lauf).grund === 'duenn')
    p('Kein Kandidat: Projekt ungeprüft', kandidatStatus(zeile({ projektNote: null }), lauf).grund === 'projekt')
    p('… ausser die Projektprüfung ist aus', kandidatStatus(zeile({ projektNote: null }), { ...lauf, projektPflicht: false }).ja)
    p('Kein Kandidat: kein laufender Handel', kandidatStatus(zeile({ stand: { tx1h: 5 } }), lauf).grund === 'handel')
    p('Kein Kandidat: Vertrag ungeprüft', kandidatStatus(zeile({ stand: { risiko: null } }), lauf).grund === 'ungeprueft')
    p('Kein Kandidat: verworfen', kandidatStatus(zeile({ status: 'verworfen' }), lauf).grund === 'verworfen')
    /*
     * Reihenfolge des Trichters (10.10.2026): Geprüft werden je Durchgang nur
     * die Besten. Ein schwacher, ungeprüfter Token scheitert an der NOTE, nicht
     * an der Prüfung — sonst stand auf der NAS „125 Vertrag ungeprüft".
     */
    p('Trichter: schwach und ungeprüft heisst „Note"', kandidatStatus(zeile({ note: 20, stand: { risiko: null } }), lauf).grund === 'note')
    p('Trichter: stark und ungeprüft heisst „ungeprüft"', kandidatStatus(zeile({ note: 80, stand: { risiko: null } }), lauf).grund === 'ungeprueft')
    p('Trichter: verworfen geht vor der Note', kandidatStatus(zeile({ note: 20, status: 'verworfen' }), lauf).grund === 'verworfen')
    p('Kandidat trotz tiefer Note: zwei beobachtete Wallets',
        kandidatStatus(zeile({ note: 10, stand: { smart: { wallets: 2 }, teilnoten: { team: 10 } } }), lauf).ja)
    p('Belastbarkeit: Zählung', belastbarkeit({ handel: 1, beteiligung: null, momentum: 2, team: 3, sozial: 0 }).markt === 2
        && belastbarkeit({ handel: 1, beteiligung: null, momentum: 2, team: 3, sozial: 0 }).abdeckung === 4)
}

// ── Plätze: Neue bekommen ihre reservierten ─────────────────────────────
{
    const b = Array.from({ length: 140 }, (_, i) => `b${i}`)
    const n = Array.from({ length: 100 }, (_, i) => `n${i}`)
    const v = verteilePlaetze(b, n, 150, 50)
    p('volle Tabelle: 100 bekannte, 50 neue', v.length === 150 && v.filter((x) => x[0] === 'n').length === 50)
    p('Bekannte in ihrer Reihenfolge', v[0] === 'b0' && v[99] === 'b99')
    p('wenige Neue: Bekannte füllen auf', verteilePlaetze(b, n.slice(0, 5), 150, 50).filter((x) => x[0] === 'b').length === 140)
    p('wenige Bekannte: Neue füllen auf', verteilePlaetze(b.slice(0, 10), n, 150, 50).filter((x) => x[0] === 'n').length === 100)
    p('nie mehr als das Maximum', verteilePlaetze(b, n, 150, 50).length === 150 && verteilePlaetze([], [], 150, 50).length === 0)
}

// ── Zu alt für die Frühphase ────────────────────────────────────────────
{
    p('älter als drei Tage: verworfen, Grund „alt"', statusFrueh({ liq: 80000, mcap: 1 }, MAX_ALTER_STUNDEN + 1, []).grund === 'alt')
    p('genau drei Tage: noch dabei', statusFrueh({ liq: 80000, mcap: 1 }, MAX_ALTER_STUNDEN, []).status === 'reif')
    p('Vertrag geht vor Alter', statusFrueh({ liq: 1, mcap: 1 }, 500, [{ schluessel: 'sicherheitKo' }]).grund === 'sicherheit')
}

// ── Inszenierung ────────────────────────────────────────────────────────
{
    const basis = { tx1h: 300, kaeufer1h: 150, verkaeufer1h: 120, mcap: 50000, plattformen: 2, erw: 3 }
    const sauber = bewerteFrueh({ stand: stand(H, basis), verlauf: [stand(0, { tx1h: 100, mcap: 40000 })] })
    const einseitig = bewerteFrueh({ stand: stand(H, { ...basis, kv1h: 15, kaeufe1h: 150, verkaeufe1h: 10 }), verlauf: [stand(0, { tx1h: 100, mcap: 40000 })] })
    p('einseitige Käufe kosten', einseitig.note < sauber.note && einseitig.befunde.some((x) => x.schluessel === 'einseitig'))
    // Der Fall vom 10.10.2026: ein Kauf, kein Verkauf ergab „99 Käufe je Verkauf" und −15.
    const einKauf = bewerteFrueh({ stand: stand(H, { ...basis, kv1h: 99, kaeufe1h: 1, verkaeufe1h: 0 }), verlauf: [stand(0, { tx1h: 100, mcap: 40000 })] })
    p('ein Kauf ohne Verkauf ist nicht einseitig', !einKauf.befunde.some((x) => x.schluessel === 'einseitig'))
    const ohneVerkauf = bewerteFrueh({ stand: stand(H, { ...basis, kaeufe1h: 40, verkaeufe1h: 0 }) })
    p('40 Käufe ohne Verkauf sind einseitig', ohneVerkauf.befunde.some((x) => x.schluessel === 'einseitig' && /kein einziger Verkauf/.test(x.text)))
    p('ausgeglichener Handel ist nicht einseitig', !bewerteFrueh({ stand: stand(H, { ...basis, kaeufe1h: 200, verkaeufe1h: 120 }) })
        .befunde.some((x) => x.schluessel === 'einseitig'))
    const kreis = bewerteFrueh({ stand: stand(H, { ...basis, poolTx1h: 900, kaeufer1h: 30, verkaeufer1h: 20 }), verlauf: [stand(0, { tx1h: 100, mcap: 40000 })] })
    p('Kreishandel erkannt', kreis.befunde.some((x) => x.schluessel === 'kreishandel'))
    // Echte Werte vom 10.10.2026 (GeckoTerminal, Hauptpool): HOTBOT gegen MEMECHAN.
    const hotbot = bewerteFrueh({ stand: stand(H, { poolTx1h: 274, kaeufer1h: 6, verkaeufer1h: 5, tx1h: 274 }) })
    p('HOTBOT: 274 Transaktionen von 11 Wallets', hotbot.befunde.some((x) => x.schluessel === 'kreishandel'))
    const memechan = bewerteFrueh({ stand: stand(H, { poolTx1h: 354, kaeufer1h: 140, verkaeufer1h: 101, tx1h: 354 }) })
    p('MEMECHAN: 354 von 241 Wallets ist kein Kreishandel', !memechan.befunde.some((x) => x.schluessel === 'kreishandel'))
    // Wallets aus dem einen, Transaktionen aus einem anderen Pool werden nicht verglichen.
    p('ohne Pool-Transaktionen kein Kreishandel', !bewerteFrueh({ stand: stand(H, { tx1h: 900, kaeufer1h: 30, verkaeufer1h: 20 }) })
        .befunde.some((x) => x.schluessel === 'kreishandel'))
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
    const profil = bewerteFrueh({ stand: stand(0, {}), profil: true, links: { webseiten: ['https://a.io'], kanaele: [{ typ: 'twitter', url: 'https://x.com/aio' }, { typ: 'telegram', url: 'https://t.me/aio' }] } })
    const ohneProfil = bewerteFrueh({ stand: stand(0, {}), links: { webseiten: ['https://a.io'], kanaele: [{ typ: 'twitter', url: 'https://x.com/aio' }, { typ: 'telegram', url: 'https://t.me/aio' }] } })
    p('Webseite und Kanäle tragen die Team-Teilnote', profil.teilnoten.team === 70, String(profil.teilnoten.team))
    // Ein bezahltes Profil ist Werbebudget: kein Punkt, nur ein Hinweis.
    p('bezahltes Profil bringt keine Punkte', profil.teilnoten.team === ohneProfil.teilnoten.team && profil.note === ohneProfil.note)
    p('… und steht als Hinweis, nicht als Plus', profil.befunde.some((x) => x.schluessel === 'profil' && x.art === 'info')
        && !profil.befunde.some((x) => x.art === 'plus'))
    p('Note bleibt im Bereich', [mitNote, ohneSpuren, profil].every((b) => b.note >= 0 && b.note <= 100))
    /*
     * Ohne Projektprüfung dieselben Massstäbe wie in ihr (10.10.2026): Ein
     * Tweet als Webseite, die eigene Coin-Seite auf pump.fun, ein Link auf
     * einen einzelnen Beitrag oder einen Handelsbot tragen kein Team.
     */
    const narrativ = bewerteFrueh({ stand: stand(0, {}), links: {
        webseiten: ['https://x.com/Dexerto/status/2087177241423733190', 'https://pump.fun/coin/7KyCdUVrNbo4BJT4xwKLFtdwJzaYFJTVenXNiN2Kpump'],
        kanaele: [{ typ: 'twitter', url: 'https://x.com/Dexerto/status/2087177241423733190' }, { typ: 'telegram', url: 'https://t.me/solana_trojanbot?start=r-abc' }],
    } })
    p('Tweet, Coin-Seite, Beitrag und Bot: keine Spuren eines Teams', narrativ.teilnoten.team === 0
        && narrativ.befunde.some((x) => x.schluessel === 'keineSpuren'), String(narrativ.teilnoten.team))
    const doppelt = bewerteFrueh({ stand: stand(0, {}), links: { webseiten: [], kanaele: [
        { typ: 'twitter', url: 'https://x.com/aio' }, { typ: 'twitter', url: 'https://twitter.com/aio2' }] } })
    p('zwei X-Links sind ein Kanal, nicht zwei', doppelt.teilnoten.team === 20, String(doppelt.teilnoten.team))

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

// ── Risiko: Vertrag, Insider, Kurve, Dev ────────────────────────────────
{
    const rc = (holders, extra = {}) => ausRugCheck({ rugged: false, totalHolders: 420,
        token: { mintAuthority: null, freezeAuthority: null }, topHolders: holders, markets: [], ...extra })
    const h = (owner, pct, insider = false, address = 'acc-' + owner) => ({ address, owner, pct, insider })
    const KURVE = 'kurve1'
    // Kurven-Token: die Kurve hält 80 %, der Rest ist breit verteilt.
    const sauber = risikoFrueh(rc([h(KURVE, 80), h('a', 2), h('b', 1.5), h('c', 1)]), { kurve: [KURVE], aufKurve: true })
    p('Kurve zählt nicht als Klumpen', sauber.top10Pct !== null && sauber.top10Pct < 10 && !sauber.befunde.some((b) => b.schluessel === 'top10'), JSON.stringify(sauber))
    p('Halterzahl aus RugCheck', sauber.halter === 420)
    // Die Markierung `insider` je Halter war nie gesetzt; ohne Netzwerkangabe ist der Anteil unbekannt.
    p('RugCheck ohne Netzwerkangabe: Insider unbekannt, nicht 0', sauber.insiderPct === null)
    const unbekannt = risikoFrueh(rc([h(KURVE, 80), h('a', 2)]), { kurve: [], aufKurve: true })
    p('Kurve unbekannt: Top-10 bleibt unbekannt statt 80 %', unbekannt.top10Pct === null && unbekannt.abzug === 0)
    // Anteil der Insider-Netzwerke: Rohbestand / Angebot (ROCKETCAT-Form, 10.10.2026).
    const netz = (bestaende) => ({ token: { mintAuthority: null, freezeAuthority: null, supply: 1000 },
        insiderNetworks: bestaende.map((b) => ({ size: 3, currentHolding: b })) })
    const insider = risikoFrueh(rc([h(KURVE, 60), h('a', 1)], netz([100, 80])), { kurve: [KURVE], aufKurve: true })
    p('Insider ab 15 % kosten', Math.round(insider.insiderPct) === 18 && insider.befunde.some((b) => b.schluessel === 'insider' && b.art === 'minus'),
        JSON.stringify(insider))
    const mittel = risikoFrueh(rc([h(KURVE, 60), h('a', 1)], netz([60])), { kurve: [KURVE], aufKurve: true })
    p('Insider 6 %: Netzwerk-Abzug, nicht der grosse', mittel.befunde.some((b) => b.schluessel === 'insiderNetz' && b.art === 'minus')
        && !mittel.befunde.some((b) => b.schluessel === 'insider'))
    const klein = risikoFrueh(rc([h(KURVE, 60), h('a', 1)], netz([32])), { kurve: [KURVE], aufKurve: true })
    p('Insider 3 %: nur ein Hinweis', klein.abzug === 0 && klein.befunde.some((b) => b.schluessel === 'insiderNetz' && b.art === 'info'))
    const netzOhneAnteil = risikoFrueh(rc([h('a', 1)], { insiderNetworks: [{ size: 3, currentHolding: 5 }], token: { mintAuthority: null, freezeAuthority: null } }))
    p('Netzwerke ohne Angebot: Abzug wie bisher', netzOhneAnteil.insiderPct === null && netzOhneAnteil.befunde.some((b) => b.schluessel === 'insiderNetz' && b.art === 'minus'))
    const dev = risikoFrueh(rc([h('dev', 12), h('a', 3)]), { ersteller: 'dev' })
    p('Dev-Anteil erkannt', dev.devPct === 12 && dev.befunde.some((b) => b.schluessel === 'devAnteil'))
    // RugCheck nennt den Bestand des Erstellers selbst — gilt, wenn er denselben meint.
    const rcDev = risikoFrueh(rc([h('a', 3)], { creator: 'dev', creatorBalance: 150, token: { mintAuthority: null, freezeAuthority: null, supply: 1000 } }), { ersteller: 'dev' })
    p('Ersteller-Anteil aus RugCheck', Math.round(rcDev.devPct) === 15 && rcDev.befunde.some((b) => b.schluessel === 'devAnteil'))
    const andererDev = risikoFrueh(rc([h('a', 3)], { creator: 'jemand', creatorBalance: 150, token: { mintAuthority: null, freezeAuthority: null, supply: 1000 } }), { ersteller: 'dev' })
    p('… nicht, wenn RugCheck einen anderen Ersteller meint', andererDev.devPct === null)
    const zehn = Array.from({ length: 10 }, (_, i) => h('w' + i, 3 - i * 0.1))
    const nichtDabei = risikoFrueh(rc(zehn), { ersteller: 'dev' })
    p('Ersteller nicht unter den Top-10: kleiner als der kleinste, nicht 0', nichtDabei.devPct === null && Math.abs(nichtDabei.devUnterPct - 2.1) < 1e-9,
        `${nichtDabei.devPct} ${nichtDabei.devUnterPct}`)
    // Auf der Kurve: das Bündel, das den ganzen Umlauf hält.
    const buendel = risikoFrueh(rc([h(KURVE, 80), h('b1', 10), h('b2', 6), h('b3', 3)], { totalHolders: 120 }), { kurve: [KURVE], aufKurve: true })
    p('Kurve: 95 % des Umlaufs bei den Top-10 kosten', buendel.befunde.some((b) => b.schluessel === 'top10' && /Umlaufs/.test(b.text)),
        JSON.stringify({ t: buendel.top10Pct, u: buendel.top10UmlaufPct }))
    const wenigeHalter = risikoFrueh(rc([h(KURVE, 80), h('b1', 10), h('b2', 6), h('b3', 3)], { totalHolders: 12 }), { kurve: [KURVE], aufKurve: true })
    p('… nicht bei einer Handvoll Halter (natürliche Konzentration)', !wenigeHalter.befunde.some((b) => b.schluessel === 'top10'))
    const mint = risikoFrueh(ausRugCheck({ rugged: false, totalHolders: 10, token: { mintAuthority: 'X', freezeAuthority: null }, topHolders: [], markets: [] }))
    p('Mint-Recht ist K.-o.', mint.ko !== null && mint.befunde.some((b) => b.schluessel === 'sicherheitKo'))
    p('… und verwirft den Token', statusFrueh({ liq: null, mcap: 1 }, 1, mint.befunde).grund === 'sicherheit')
    p('ohne Antwort: keine Aussage, keine Strafe', risikoFrueh(null) === null)
    const goplus = risikoFrueh({ quelle: 'goplus-evm', anteilSkala: 'bruch', is_honeypot: '0', holder_count: '50', is_open_source: '1',
        holders: [{ address: '0xa', percent: '0.05' }, { address: '0xb', percent: '0.04' }] })
    p('GoPlus kennt keine Insider: unbekannt, nicht 0', goplus.insiderPct === null)
    p('GoPlus-Bruchteile werden Prozent', Math.round(goplus.top10Pct) === 9, String(goplus.top10Pct))
}

// ── Halterwachstum, King of the Hill, Smart Money ───────────────────────
{
    const vor = { ...stand(0, { halter: 100, halterQuelle: 'rugcheck' }), note: 30 }
    const jetzt = stand(H, { halter: 260, halterQuelle: 'rugcheck' })
    const b = bewerteFrueh({ stand: jetzt, verlauf: [vor] })
    p('Halterschub erkannt', b.befunde.some((x) => x.schluessel === 'halterSchub'))
    p('Halterwachstum trägt die Beteiligung', b.teilnoten.beteiligung === 100, String(b.teilnoten.beteiligung))
    const schwund = bewerteFrueh({ stand: stand(H, { halter: 60, halterQuelle: 'rugcheck' }), verlauf: [vor] })
    p('Halterschwund benannt', schwund.befunde.some((x) => x.schluessel === 'halterSchwund'))
    // DPG: RugCheck 28 811, GoPlus 10 872 — ein Quellenwechsel ist kein Schwund.
    const wechsel = bewerteFrueh({ stand: stand(H, { halter: 10872, halterQuelle: 'goplus-solana' }),
        verlauf: [{ ...stand(0, { halter: 28811, halterQuelle: 'rugcheck' }), note: 30 }] })
    p('Halter aus zwei Quellen werden nicht verglichen', !wechsel.befunde.some((x) => /^halter/.test(x.schluessel)) && wechsel.teilnoten.beteiligung === null)
    const koth = bewerteFrueh({ stand: stand(0, { kothMin: 12, kothAm: -20 * 60e3 }) })
    p('King of the Hill: Momentum ohne Verlauf', koth.teilnoten.momentum === 80 && koth.befunde.some((x) => x.schluessel === 'koth'))
    // Ein Ereignis, kein Zustand: fünf Stunden später zählt es nicht mehr.
    const kothAlt = bewerteFrueh({ stand: stand(5 * H, { kothMin: 12, kothAm: 0 }) })
    p('King of the Hill vor 5 h zählt nicht mehr', kothAlt.teilnoten.momentum === null && !kothAlt.befunde.some((x) => x.schluessel === 'koth'))
    p('King of the Hill ohne Zeitpunkt zählt nicht', bewerteFrueh({ stand: stand(0, { kothMin: 12 }) }).teilnoten.momentum === null)
    const s0 = stand(0, { tx1h: 120, tx5m: 30 })
    const ohne = bewerteFrueh({ stand: s0 }).note
    const eine = bewerteFrueh({ stand: s0, smart: { wallets: 1 } }).note
    const zwei = bewerteFrueh({ stand: s0, smart: { wallets: 2, namen: ['alpha'] } }).note
    p('Smart Money: zwei Wallets wiegen mehr als eine', zwei > eine && eine > ohne, `${ohne} ${eine} ${zwei}`)
    p('Halter fehlt: bleibt null', momentaufnahme({}, {}, 1).halter === null)
}

// ── Smart Money ─────────────────────────────────────────────────────────
{
    const W = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
    const MINT = '9yKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJospump'
    const tb = (owner, mint, ui) => ({ owner, mint, uiTokenAmount: { uiAmountString: String(ui) } })
    const tx = (o = {}) => ({
        blockTime: 1790000000, meta: { err: null, fee: 5000, preBalances: [5e9, 0], postBalances: [4e9, 0],
            preTokenBalances: [], postTokenBalances: [tb(W, MINT, 1000)], ...o.meta },
        transaction: { message: { accountKeys: [{ pubkey: W, signer: o.signer ?? true }, { pubkey: 'x', signer: false }] } },
    })
    const k = kaeufeAusTransaktion(tx(), W)
    p('Kauf erkannt (SOL bezahlt, Bestand gestiegen)', k.length === 1 && k[0].mint === MINT && k[0].menge === 1000 && k[0].zeit === 1790000000000)
    p('Airdrop (nicht signiert) ist kein Kauf', kaeufeAusTransaktion(tx({ signer: false }), W).length === 0)
    p('nichts bezahlt ist kein Kauf', kaeufeAusTransaktion(tx({ meta: { preBalances: [5e9, 0], postBalances: [5e9 - 5000, 0] } }), W).length === 0)
    p('mit USDC bezahlt zählt', kaeufeAusTransaktion(tx({ meta: { preBalances: [5e9, 0], postBalances: [5e9 - 5000, 0],
        preTokenBalances: [tb(W, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 50)],
        postTokenBalances: [tb(W, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 0), tb(W, MINT, 10)] } }), W).length === 1)
    p('fehlgeschlagene Transaktion zählt nicht', kaeufeAusTransaktion(tx({ meta: { err: { x: 1 } } }), W).length === 0)
    p('Verkauf ist kein Kauf', kaeufeAusTransaktion(tx({ meta: { preTokenBalances: [tb(W, MINT, 1000)], postTokenBalances: [tb(W, MINT, 0)] } }), W).length === 0)

    const j = 1790000000000
    const sig = smartSignale([
        { wallet: 'a', mint: 'M', zeit: j - 1000 }, { wallet: 'a', mint: 'M', zeit: j - 500 },
        { wallet: 'b', mint: 'M', zeit: j - 200 }, { wallet: 'c', mint: 'N', zeit: j - 7 * 3600e3 },
    ], { jetzt: j, namen: new Map([['a', 'Alpha']]) })
    p('Signal: verschiedene Wallets, nicht Käufe', sig.get('M')?.wallets === 2)
    p('Signal: Namen aus der Liste', sig.get('M')?.namen[0] === 'Alpha')
    p('Signal: ausserhalb des Fensters zählt nicht', !sig.has('N'))

    /*
     * Rent ist keine Bezahlung (10.10.2026): Ein neues Token-Konto kostet
     * 0,00204 SOL — mehr als die alte Schwelle von 0,001 SOL. Wer einen
     * Airdrop selbst abholt, hatte damit „gekauft".
     */
    const abholen = tx({ meta: { preBalances: [5e9, 0], postBalances: [5e9 - 5000 - RENT_KONTO_LAMPORTS - 100000, 0] } })
    p('Airdrop selbst abgeholt (nur Gebühr und Rent): kein Kauf', kaeufeAusTransaktion(abholen, W).length === 0)
    const knapp = tx({ meta: { preBalances: [5e9, 0], postBalances: [5e9 - 5000 - RENT_KONTO_LAMPORTS - MIN_KAUF_LAMPORTS, 0] } })
    p('… ab 0,005 SOL über Gebühr und Rent: Kauf', kaeufeAusTransaktion(knapp, W).length === 1)
    const usdcStaub = tx({ meta: { preBalances: [5e9, 0], postBalances: [5e9 - 5000, 0],
        preTokenBalances: [tb(W, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 50)],
        postTokenBalances: [tb(W, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 49.5), tb(W, MINT, 10)] } })
    p('USDC-Staub ist keine Bezahlung', kaeufeAusTransaktion(usdcStaub, W).length === 0)
    // Ein bestehendes Konto (keine Rent) mit 1 SOL bezahlt
    const bestehend = tx({ meta: { preBalances: [5e9, 0], postBalances: [4e9, 0], preTokenBalances: [tb(W, MINT, 5)], postTokenBalances: [tb(W, MINT, 15)] } })
    p('Nachkauf auf bestehendem Konto zählt mit der Menge des Zuwachses', kaeufeAusTransaktion(bestehend, W)[0]?.menge === 10)
    const verkauf = handelAusTransaktion(tx({ meta: { preBalances: [4e9, 0], postBalances: [5e9, 0], preTokenBalances: [tb(W, MINT, 1000)], postTokenBalances: [tb(W, MINT, 0)] } }), W)
    p('Verkauf ist ein Abgang mit negativer Menge', verkauf.length === 1 && verkauf[0].menge === -1000)
    p('… den nur der Signierer macht', handelAusTransaktion(tx({ signer: false, meta: { preTokenBalances: [tb(W, MINT, 1000)], postTokenBalances: [] } }), W).length === 0)

    // Wer im Fenster wieder abgibt, hält den Token nicht mehr.
    const netto = smartSignale([
        { wallet: 'a', mint: 'M', zeit: j - 3000, menge: 1000 }, { wallet: 'a', mint: 'M', zeit: j - 2000, menge: -800 },
        { wallet: 'b', mint: 'M', zeit: j - 1000, menge: 1000 }, { wallet: 'b', mint: 'M', zeit: j - 500, menge: -200 },
        { wallet: 'c', mint: 'M', zeit: j - 400, menge: 50 },
    ], { jetzt: j })
    p('Sniper (kauft und verkauft) zählt nicht, Teilverkauf schon', netto.get('M')?.wallets === 2 && netto.get('M')?.verkauft === 1,
        JSON.stringify(netto.get('M')))
    const nurVerkauft = smartSignale([
        { wallet: 'a', mint: 'Q', zeit: j - 3000, menge: 100 }, { wallet: 'a', mint: 'Q', zeit: j - 2000, menge: -100 },
        { wallet: 'b', mint: 'Q', zeit: j - 3000, menge: 100 }, { wallet: 'b', mint: 'Q', zeit: j - 1000, menge: -100 },
    ], { jetzt: j })
    p('zwei Wallets, beide wieder draussen: kein Signal', nurVerkauft.get('Q')?.wallets === 0)
    p('Abgang ohne Kauf im Fenster zählt nicht als Kauf', !smartSignale([{ wallet: 'a', mint: 'R', zeit: j - 10, menge: -5 }], { jetzt: j }).get('R')?.wallets)

    const liste = smartWalletListe(`${W} Kolscan Top\nkeine-adresse\n${W} doppelt`)
    p('Wallet-Liste: nur gültige Adressen, ohne Doppelte', liste.length === 1 && liste[0].name === 'Kolscan Top')
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
