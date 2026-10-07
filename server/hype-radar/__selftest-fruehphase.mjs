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
    kaeufeAusTransaktion, smartSignale, smartWalletListe,
    MAX_VERLAUF, REIF, X_MIN_AUTOREN_NEU,
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
    p('RugCheck ohne Insider-Markierung: 0 %, gemessen', sauber.insiderPct === 0)
    const unbekannt = risikoFrueh(rc([h(KURVE, 80), h('a', 2)]), { kurve: [], aufKurve: true })
    p('Kurve unbekannt: Top-10 bleibt unbekannt statt 80 %', unbekannt.top10Pct === null && unbekannt.abzug === 0)
    const insider = risikoFrueh(rc([h(KURVE, 60), h('i1', 10, true), h('i2', 8, true), h('a', 1)]), { kurve: [KURVE], aufKurve: true })
    p('Insider ab 15 % kosten', insider.insiderPct === 18 && insider.befunde.some((b) => b.schluessel === 'insider'))
    const dev = risikoFrueh(rc([h('dev', 12), h('a', 3)]), { ersteller: 'dev' })
    p('Dev-Anteil erkannt', dev.devPct === 12 && dev.befunde.some((b) => b.schluessel === 'devAnteil'))
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
    const vor = { ...stand(0, { halter: 100 }), note: 30 }
    const jetzt = stand(H, { halter: 260 })
    const b = bewerteFrueh({ stand: jetzt, verlauf: [vor] })
    p('Halterschub erkannt', b.befunde.some((x) => x.schluessel === 'halterSchub'))
    p('Halterwachstum trägt die Beteiligung', b.teilnoten.beteiligung === 100, String(b.teilnoten.beteiligung))
    const schwund = bewerteFrueh({ stand: stand(H, { halter: 60 }), verlauf: [vor] })
    p('Halterschwund benannt', schwund.befunde.some((x) => x.schluessel === 'halterSchwund'))
    const koth = bewerteFrueh({ stand: stand(0, { kothMin: 12 }) })
    p('King of the Hill: Momentum ohne Verlauf', koth.teilnoten.momentum === 80 && koth.befunde.some((x) => x.schluessel === 'koth'))
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

    const liste = smartWalletListe(`${W} Kolscan Top\nkeine-adresse\n${W} doppelt`)
    p('Wallet-Liste: nur gültige Adressen, ohne Doppelte', liste.length === 1 && liste[0].name === 'Kolscan Top')
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
