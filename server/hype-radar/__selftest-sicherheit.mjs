/**
 * Selbsttest: Sicherheitsprüfung des Hype-Radars.
 *
 * Ohne Netz. Das ist der wichtigste Test des Features: hier entscheidet sich,
 * ob ein Token, aus dem man nicht wieder herauskommt, in einem Bericht als
 * „Top-Kandidat" landet. Jeder K.-o.-Fall wird deshalb einzeln geprüft.
 *
 * Aufruf: node server/hype-radar/__selftest-sicherheit.mjs
 */
import {
    pruefe, pruefeMarkt, summeTop10, top10Ausgeschlossen, ausRugCheck, ausGoPlusSolana, token2022,
    STANDARD_SICHERHEIT, SKALA_PROZENT,
} from './sicherheit.js'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Hype-Radar: Sicherheit')

/** Ein unauffälliger Vertrag als Ausgangspunkt (GoPlus-EVM-Sprache, Bruchteile). */
const sauber = () => ({
    is_honeypot: 0, is_mintable: 0, is_proxy: 0,
    cannot_sell_all: 0, transfer_pausable: 0,
    is_open_source: '1', hidden_owner: '0', can_take_back_ownership: '0',
    owner_change_balance: '0', selfdestruct: '0', personal_slippage_modifiable: '0',
    slippage_modifiable: '0', honeypot_with_same_creator: '0',
    is_blacklisted: '0', trading_cooldown: '0', external_call: '0', buy_tax: '0.01',
    sell_tax: '0.02', owner_address: '0x0000000000000000000000000000000000000000',
    holder_count: 5000,
    holders: Array.from({ length: 10 }, () => ({ percent: '0.01' })),   // zusammen 10 %
    lp_holders: [{ percent: '0.9', is_locked: 1, address: '0x1' }],
})

/** Ein unauffälliger Markt dazu. */
const marktOk = () => ({
    liquiditaetUsd: 250000, fdv: 5000000, paarAlterStunden: 72,
    volumen24h: 500000, kaufVerkaufVerhaeltnis: 1.2,
})

// ── Der gute Fall ───────────────────────────────────────────────────────
const gut = pruefe(sauber(), marktOk())
p('unauffälliger Token besteht', gut.status === 'bestanden', gut.grund)
p('und bekommt eine hohe Note', gut.safetyScore >= 90, String(gut.safetyScore))

// ── K.-o.-Kriterien, jedes einzeln ──────────────────────────────────────
const honeypot = pruefe({ ...sauber(), is_honeypot: 1 }, marktOk())
p('Honeypot wird verworfen', honeypot.status === 'verworfen' && honeypot.grund === 'honeypot')
p('Honeypot bekommt Note 0', honeypot.safetyScore === 0)

const anhaltbar = pruefe({ ...sauber(), transfer_pausable: 1 }, marktOk())
p('anhaltbare Übertragung wird verworfen', anhaltbar.grund === 'verkauf_sperrbar')

const teuer = pruefe({ ...sauber(), sell_tax: '0.25' }, marktOk())
p('hohe Verkaufssteuer wird verworfen', teuer.grund === 'verkaufssteuer_hoch', JSON.stringify(teuer))

const praegbar = pruefe(
    { ...sauber(), is_mintable: 1, owner_address: '0xabc0000000000000000000000000000000000001' }, marktOk())
p('Nachprägung mit aktivem Eigentümer wird verworfen', praegbar.grund === 'praegbar')

/*
 * Nachprägbar OHNE Eigentümer ist etwas anderes: die Rechte sind abgegeben,
 * niemand kann die Funktion mehr auslösen. Das darf nicht verworfen werden,
 * sonst fallen sauber aufgesetzte Token durch.
 */
const praegbarOhneEigner = pruefe({ ...sauber(), is_mintable: 1 }, marktOk())
p('Nachprägung ohne Eigentümer wird NICHT verworfen',
    praegbarOhneEigner.status === 'bestanden', praegbarOhneEigner.grund)

const lpOffen = pruefe(
    { ...sauber(), lp_holders: [{ percent: '0.9', is_locked: 0, address: '0x1' }] }, marktOk())
p('offene Liquidität wird verworfen', lpOffen.grund === 'lp_offen')

/*
 * Verbrannte Anteile gehen an die Nulladresse. Sie sind dauerhafter als jede
 * Sperrfrist und müssen als gesperrt zählen — sonst verwirft der Filter genau
 * die sichersten Aufsetzungen.
 */
const lpVerbrannt = pruefe(
    { ...sauber(), lp_holders: [{ percent: '0.95', is_locked: 0, address: '0x0000000000000000000000000000000000000000' }] },
    marktOk())
p('verbrannte Liquidität zählt als gesperrt',
    lpVerbrannt.status === 'bestanden', lpVerbrannt.grund)

/*
 * Der Befund des Audits vom 19.08.2026: Fehlten die LP-Angaben vollständig,
 * erzeugte die aktivierte Pflicht nur einen Hinweis — die Einstellung
 * versprach einen harten Filter und lieferte eine Fussnote. Gemessen kamen
 * dadurch vier von zehn Kandidaten, die diese Prüfung überhaupt erreichten,
 * mit Sicherheitsnote 100 durch, ohne dass je eine Sperre geprüft wurde.
 */
const lpFehlt = pruefe({ ...sauber(), lp_holders: [] }, marktOk())
p('fehlende LP-Angabe wird bei Pflicht verworfen',
    lpFehlt.status === 'verworfen' && lpFehlt.grund === 'lp_unbekannt',
    `${lpFehlt.status}/${lpFehlt.grund}`)
p('und bekommt keine Sicherheitsnote geschenkt', lpFehlt.safetyScore === 0)

// Ohne Pflicht bleibt es ein Hinweis — wer die Sperre nicht verlangt, soll
// nicht plötzlich strenger geprüft werden als vorher.
const lpFehltOhnePflicht = pruefe({ ...sauber(), lp_holders: [] }, marktOk(),
    { ...STANDARD_SICHERHEIT, lpMussGesperrtSein: false })
p('ohne Pflicht bleibt die fehlende Angabe ein Hinweis',
    lpFehltOhnePflicht.status === 'bestanden'
    && lpFehltOhnePflicht.hinweise.some((h) => /Liquiditätssperre/.test(h)),
    `${lpFehltOhnePflicht.status} | ${JSON.stringify(lpFehltOhnePflicht.hinweise)}`)

const zuKlein = pruefe(sauber(), { ...marktOk(), liquiditaetUsd: 5000 })
p('zu wenig Liquidität wird verworfen', zuKlein.grund === 'liquiditaet_zu_klein')

const zuJung = pruefe(sauber(), { ...marktOk(), paarAlterStunden: 2 })
p('zu junges Paar wird verworfen', zuJung.grund === 'zu_jung')

/*
 * Unbekanntes Alter ist nicht „0 Stunden". `Number(null)` ist 0 — bis zum
 * 07.10.2026 meldete der Wachhund deshalb „Paar erst 0.0 h alt", sobald
 * DexScreener kein Erstellungsdatum lieferte.
 */
p('unbekanntes Alter ist nicht zu jung',
    pruefe(sauber(), { ...marktOk(), paarAlterStunden: null }).status === 'bestanden')
p('Marktprüfung allein: zu jung', pruefeMarkt({ ...marktOk(), paarAlterStunden: 2 })?.grund === 'zu_jung')
p('Marktprüfung allein: passt', pruefeMarkt(marktOk()) === null)
p('Marktprüfung allein: zu dünn', pruefeMarkt({ liquiditaetUsd: 10 })?.grund === 'liquiditaet_zu_klein')

/*
 * Der wichtigste Fall überhaupt: keine Sicherheitsdaten. Ungeprüft darf NIE
 * als bestanden durchgehen — sonst stünde ein nie geprüfter Token unter
 * „Top-Kandidaten".
 */
const ohneDaten = pruefe(null, marktOk())
p('ohne Sicherheitsdaten wird verworfen', ohneDaten.grund === 'ungeprueft')
p('ungeprüft bekommt Note 0', ohneDaten.safetyScore === 0)

// ── Abzüge: senken die Note, verwerfen aber nicht ───────────────────────
const konzentriert = pruefe(
    { ...sauber(), holders: [{ percent: '0.60' }, ...Array.from({ length: 9 }, () => ({ percent: '0.01' }))] },
    marktOk())
p('konzentrierter Besitz besteht noch', konzentriert.status === 'bestanden')
p('kostet aber deutlich Note', konzentriert.safetyScore < gut.safetyScore,
    `${konzentriert.safetyScore} vs ${gut.safetyScore}`)
p('und wird begründet', konzentriert.hinweise.some((h) => h.includes('Halter')))

const aufgeblasen = pruefe(sauber(), { ...marktOk(), fdv: 500000000 })
p('Bewertung weit über Liquidität kostet Note', aufgeblasen.safetyScore < gut.safetyScore)
p('bleibt aber bestanden', aufgeblasen.status === 'bestanden')

const proxy = pruefe({ ...sauber(), is_proxy: 1 }, marktOk())
p('Proxy-Vertrag kostet Note', proxy.safetyScore < gut.safetyScore)

const wenigHalter = pruefe({ ...sauber(), holder_count: 50 }, marktOk())
p('wenige Halter kosten Note', wenigHalter.safetyScore < gut.safetyScore)

/*
 * Viele Käufe je Verkauf sehen gut aus, sind aber die Signatur eines
 * Honeypots: alle kommen hinein, kaum einer wieder heraus. Muss Abzug geben,
 * nicht Bonus.
 */
const einseitig = pruefe(sauber(), { ...marktOk(), kaufVerkaufVerhaeltnis: 20 })
p('einseitiges Handelsmuster kostet Note', einseitig.safetyScore < gut.safetyScore)
p('und wird benannt', einseitig.hinweise.some((h) => h.includes('einseitig')))

// ── Zahlenformate: die Skala steht an der Quelle, sie wird nicht geraten ──
p('Anteile als Bruchteil (GoPlus, Vorgabe)',
    Math.round(summeTop10([{ percent: '0.25' }, { percent: '0.15' }])) === 40)
p('Anteile in Prozent, wenn die Quelle es sagt',
    Math.round(summeTop10([{ percent: '25' }, { percent: '15' }], { skala: SKALA_PROZENT })) === 40)
/*
 * Der Fall, an dem das Raten scheiterte: kleine Werte in Prozentskala. 0,4 %
 * plus 0,3 % sind 0,7 % — das alte `summe <= 1 ? summe * 100` machte daraus 70 %.
 */
p('kleine Prozentwerte werden nicht hochgerechnet',
    Math.abs(summeTop10([{ percent: '0.4' }, { percent: '0.3' }], { skala: SKALA_PROZENT }) - 0.7) < 1e-9,
    String(summeTop10([{ percent: '0.4' }, { percent: '0.3' }], { skala: SKALA_PROZENT })))
p('leere Halterliste ergibt null', summeTop10([]) === null)
p('fehlende Halterliste ergibt null', summeTop10(undefined) === null)

/*
 * Der Befund R-09: Bis zum Audit vom 19.08.2026 wurden die zehn grössten
 * Halter roh addiert. Verbrannte Anteile, gesperrte Tranchen, Börsen-
 * Sammeladressen und die Liquiditätspools selbst zählten mit — ausgerechnet
 * eine saubere Aufsetzung wirkte dadurch riskant.
 */
const gemischt = [
    { percent: '30', address: '0x0000000000000000000000000000000000000000', tag: '', is_locked: 0 },
    { percent: '20', address: '0xAAA', tag: 'Binance', is_locked: 0 },
    { percent: '15', address: '0xBBB', tag: '', is_locked: 1 },
    { percent: '10', address: '0xCCC', tag: '', is_locked: 0 },
    { percent: '5', address: '0xDDD', tag: '', is_locked: 0 },
]
const PZ = { skala: SKALA_PROZENT }
p('verbrannt, benannt und gesperrt zählen nicht mit',
    Math.round(summeTop10(gemischt, PZ)) === 15, String(summeTop10(gemischt, PZ)))
p('die rohe Summe bleibt abrufbar',
    Math.round(summeTop10(gemischt, { roh: true, ...PZ })) === 80, String(summeTop10(gemischt, { roh: true, ...PZ })))
p('unbekannte Adressen bleiben verdächtig',
    Math.round(summeTop10([{ percent: '40', address: '0xEEE', tag: '', is_locked: 0 }], PZ)) === 40)

const weg = top10Ausgeschlossen(gemischt)
p('drei Halter werden ausgewiesen', weg.length === 3, JSON.stringify(weg.map((x) => x.grund)))
p('die Gründe sind benannt',
    weg.some((x) => x.grund === 'verbrannt') && weg.some((x) => x.grund === 'gesperrt')
    && weg.some((x) => /Binance/i.test(x.grund)), JSON.stringify(weg))

// Alles verbrannt heisst 0 % Konzentration — eine Aussage, keine Lücke.
p('vollständig verbrannt ergibt 0, nicht null',
    summeTop10([{ percent: '100', address: '0x000000000000000000000000000000000000dEaD' }], PZ) === 0)

/*
 * Die Wirkung dort, wo sie zählt: Ein Token, dessen Grossteil verbrannt und
 * bei einer Börse liegt, darf dafür keinen Abzug bekommen.
 */
const inProzent = () => ({
    ...sauber(), anteilSkala: SKALA_PROZENT,
    lp_holders: [{ percent: '90', is_locked: 1, address: '0x1' }],
})
const sauberVerteilt = pruefe({ ...inProzent(), holders: gemischt }, marktOk())
const rohGerechnet = pruefe({ ...inProzent(), holders: [{ percent: '80', address: '0xFFF' }] }, marktOk())
p('bereinigte Verteilung schneidet besser ab als eine echte Ballung',
    sauberVerteilt.safetyScore > rohGerechnet.safetyScore,
    `${sauberVerteilt.safetyScore} vs ${rohGerechnet.safetyScore}`)
p('und die Bereinigung wird im Hinweis genannt',
    sauberVerteilt.hinweise.some((h) => /nicht mitgezählt/.test(h)),
    JSON.stringify(sauberVerteilt.hinweise))

// Verkaufssteuer ebenso: „0.05" ist 5 %, „5" auch.
const steuerAnteil = pruefe({ ...sauber(), sell_tax: '0.05' }, marktOk())
const steuerProzent = pruefe({ ...sauber(), sell_tax: '5' }, marktOk())
p('Steuer 0.05 und 5 bedeuten dasselbe',
    steuerAnteil.status === 'bestanden' && steuerProzent.status === 'bestanden')

// ── Eigene Grenzwerte ───────────────────────────────────────────────────
const strenger = pruefe(sauber(), marktOk(), { ...STANDARD_SICHERHEIT, minLiquiditaetUsd: 1000000 })
p('strengere Liquiditätsgrenze greift', strenger.grund === 'liquiditaet_zu_klein')

const ohneLpPflicht = pruefe(
    { ...sauber(), lp_holders: [{ percent: '0.9', is_locked: 0, address: '0x1' }] },
    marktOk(), { ...STANDARD_SICHERHEIT, lpMussGesperrtSein: false })
p('abgeschaltete LP-Pflicht lässt durch', ohneLpPflicht.status === 'bestanden')

// Note bleibt immer im gültigen Bereich, auch wenn sich Abzüge häufen.
const allesSchlecht = pruefe(
    {
        ...sauber(), is_proxy: 1, holder_count: 5,
        holders: [{ percent: '0.95' }],
    },
    { ...marktOk(), fdv: 900000000, kaufVerkaufVerhaeltnis: 30 })
p('gehäufte Abzüge bleiben bei mindestens 0',
    allesSchlecht.safetyScore >= 0 && allesSchlecht.safetyScore <= 100,
    String(allesSchlecht.safetyScore))

/*
 * ── RugCheck-Übersetzung ────────────────────────────────────────────────
 * Die zweite Solana-Quelle muss die Sprache der ersten sprechen. Geprüft
 * werden die Fälle, in denen eine falsche Übersetzung gefährlich wäre.
 */
const sauberRc = {
    token: { mintAuthority: null, freezeAuthority: null },
    rugged: false, totalHolders: 3659,
    topHolders: [{ pct: 8.7 }, { pct: 5.0 }, { pct: 5.0 }],
    markets: [{ lp: { lpLockedPct: 100 } }],
    risks: [],
}
const rcGut = pruefe(ausRugCheck(sauberRc), marktOk())
p('sauberer RugCheck-Befund besteht', rcGut.status === 'bestanden', rcGut.grund)

// Bereits gezogener Teppich = Honeypot-Behandlung, nicht Fussnote.
const rcWeg = pruefe(ausRugCheck({ ...sauberRc, rugged: true }), marktOk())
p('rugged wird wie Honeypot verworfen', rcWeg.grund === 'honeypot')

// Freeze-Authority kann jede Übertragung anhalten.
const rcFrost = pruefe(ausRugCheck({
    ...sauberRc, token: { ...sauberRc.token, freezeAuthority: 'Fr33z3…' },
}), marktOk())
p('gesetzte Freeze-Authority wird verworfen', rcFrost.grund === 'verkauf_sperrbar')

// Mint-Authority gesetzt = nachprägbar mit aktivem Eigentümer.
const rcMint = pruefe(ausRugCheck({
    ...sauberRc, token: { ...sauberRc.token, mintAuthority: 'M1nt…' },
}), marktOk())
p('gesetzte Mint-Authority wird verworfen', rcMint.grund === 'praegbar')

// Offene Liquidität fällt durch, gesperrte nicht.
const rcOffen = pruefe(ausRugCheck({
    ...sauberRc, markets: [{ lp: { lpLockedPct: 10 } }],
}), marktOk())
p('kaum gesperrte LP wird verworfen', rcOffen.grund === 'lp_offen', JSON.stringify(rcOffen.flaggen))

// Konzentrierter Besitz gibt Abzug — die 0..100-Prozente kommen richtig an.
const rcDick = pruefe(ausRugCheck({
    ...sauberRc, topHolders: [{ pct: 60 }, { pct: 5 }],
}), marktOk())
p('RugCheck-Halterprozente werden als 0..100 gelesen',
    rcDick.status === 'bestanden' && rcDick.safetyScore < rcGut.safetyScore,
    JSON.stringify(rcDick.flaggen))

p('leere RugCheck-Antwort ergibt null (= ungeprüft)', ausRugCheck(null) === null)

/*
 * Der Befund vom 07.10.2026: RugCheck spricht Prozent. 0,9 % gesperrte
 * Liquidität wurden zu 90 % hochgerechnet und bestanden die Sperrpflicht.
 */
const rcFastNichts = pruefe(ausRugCheck({
    ...sauberRc, markets: [{ lp: { lpLockedPct: 0.9 } }],
}), marktOk())
p('0,9 % gesperrt (RugCheck) wird verworfen', rcFastNichts.grund === 'lp_offen',
    JSON.stringify(rcFastNichts.flaggen))
const rcStreu = pruefe(ausRugCheck({
    ...sauberRc, topHolders: [{ pct: 0.4 }, { pct: 0.3 }],
}), marktOk())
p('RugCheck-Halter 0,4 % + 0,3 % ergeben 0,7 %, nicht 70 %',
    Math.abs(rcStreu.flaggen.top10Prozent - 0.7) < 1e-9, String(rcStreu.flaggen.top10Prozent))

// Mehrere Märkte: gezählt wird nach Dollar, nicht der erste in der Liste.
const rcZwei = ausRugCheck({
    ...sauberRc,
    markets: [
        { lp: { lpLockedPct: 100, lpLockedUSD: 1000, baseUSD: 500, quoteUSD: 500 } },
        { lp: { lpLockedPct: 0, lpLockedUSD: 0, baseUSD: 50000, quoteUSD: 50000 } },
    ],
})
p('gesperrter Kleinstpool vor offenem Hauptpool ergibt kaum Sperre',
    rcZwei.lp_holders[0].percent < 2, JSON.stringify(rcZwei.lp_holders))
const rcOhneUsd = ausRugCheck({
    ...sauberRc,
    markets: [{ lp: { lpLockedPct: 100 } }, { lp: { lpLockedPct: 5, baseUSD: 9, quoteUSD: 9 } }],
})
p('ohne Dollarangabe zählt der liquideste Markt',
    rcOhneUsd.lp_holders[0].percent === 5, JSON.stringify(rcOhneUsd.lp_holders))

// Gebühr unbekannt ist nicht null — und eine gemeldete Gebühr kommt an.
p('RugCheck ohne Gebührangabe: Steuer unbekannt',
    rcGut.hinweise.includes('Verkaufssteuer unbekannt'), JSON.stringify(rcGut.hinweise))
const rcGebuehr = pruefe(ausRugCheck({ ...sauberRc, transferFee: { pct: 25 } }), marktOk())
p('RugCheck-Gebühr 25 % wird als hohe Steuer verworfen', rcGebuehr.grund === 'verkaufssteuer_hoch',
    JSON.stringify(rcGebuehr.flaggen))
const rcGefahr = pruefe(ausRugCheck({
    ...sauberRc, risks: [{ name: 'Copycat token', level: 'danger' }, { name: 'Low liquidity', level: 'warn' }],
}), marktOk())
p('RugCheck-Gefahren kosten Note, Warnungen nicht',
    rcGefahr.status === 'bestanden' && rcGut.safetyScore - rcGefahr.safetyScore === 10,
    `${rcGut.safetyScore} → ${rcGefahr.safetyScore}`)

/*
 * ── EVM: Felder, die bis zum 07.10.2026 niemand las ─────────────────────
 * Jedes davon setzt Käufer fest oder enteignet sie. Einzeln geprüft.
 */
const evmKo = [
    ['honeypot_with_same_creator', 'ersteller_honeypots'],
    ['hidden_owner', 'verdeckter_eigentuemer'],
    ['can_take_back_ownership', 'eigentum_rueckholbar'],
    ['owner_change_balance', 'saldo_aenderbar'],
    ['selfdestruct', 'selbstzerstoerung'],
    ['personal_slippage_modifiable', 'steuer_je_adresse'],
]
for (const [feld, grund] of evmKo) {
    const r = pruefe({ ...sauber(), [feld]: '1' }, marktOk())
    p(`${feld} wird verworfen`, r.grund === grund, r.grund)
}
const geschlossen = pruefe({ ...sauber(), is_open_source: '0' }, marktOk())
p('nicht verifizierter Quelltext wird verworfen', geschlossen.grund === 'nicht_quelloffen')
const ohneAngabe = { ...sauber() }
delete ohneAngabe.is_open_source
p('fehlende Quelltext-Angabe ist kein K.o. (Solana kennt das Feld nicht)',
    pruefe(ohneAngabe, marktOk()).status === 'bestanden')

const drehbar = pruefe({
    ...sauber(), slippage_modifiable: '1', owner_address: '0xabc0000000000000000000000000000000000001',
}, marktOk())
p('änderbare Steuer mit aktivem Eigentümer wird verworfen', drehbar.grund === 'steuer_aenderbar')
const drehbarOhne = pruefe({ ...sauber(), slippage_modifiable: '1' }, marktOk())
p('änderbare Steuer ohne Eigentümer: nur Hinweis',
    drehbarOhne.status === 'bestanden' && drehbarOhne.hinweise.some((h) => /änderbar/.test(h)))

const sperrliste = pruefe({ ...sauber(), is_blacklisted: '1' }, marktOk())
p('Sperrliste kostet Note, verwirft aber nicht (das Original PEPE hat eine)',
    sperrliste.status === 'bestanden' && sperrliste.safetyScore < gut.safetyScore)

const ohneSimulation = pruefe({ ...sauber(), is_honeypot: '' }, marktOk())
p('fehlende Honeypot-Simulation ist kein „sauber"',
    ohneSimulation.safetyScore <= gut.safetyScore - 15
    && ohneSimulation.hinweise.some((h) => /Honeypot-Simulation/.test(h)),
    `${ohneSimulation.safetyScore} vs ${gut.safetyScore}`)

const kaufTeuer = pruefe({ ...sauber(), buy_tax: '0.2' }, marktOk())
p('hohe Kaufsteuer kostet Note', kaufTeuer.safetyScore < gut.safetyScore
    && kaufTeuer.hinweise.some((h) => /Kaufsteuer/.test(h)))

/*
 * ── Solana über GoPlus ──────────────────────────────────────────────────
 * Ausgangspunkt ist die Form der echten Antwort (siehe fixtures/goplus-solana).
 */
const solSauber = () => ({
    balance_mutable_authority: { authority: [], status: '0' },
    closable: { authority: [], status: '0' },
    default_account_state: '1',
    default_account_state_upgradable: { authority: [], status: '0' },
    freezable: { authority: [], status: '0' },
    holder_count: '10872',
    holders: [
        { account: '1nc1nerator11111111111111111111111111111111', percent: '0.30', is_locked: 0, tag: '' },
        { account: 'Wa11et1111111111111111111111111111111111111', percent: '0.05', is_locked: 0, tag: '' },
    ],
    metadata_mutable: { metadata_upgrade_authority: [], status: '0' },
    mintable: { authority: [], status: '0' },
    non_transferable: '0',
    transfer_fee: {},
    transfer_fee_upgradable: { authority: [], status: '0' },
    transfer_hook: [],
    transfer_hook_upgradable: { authority: [], status: '0' },
})
const lpSol = [{ percent: 1, is_locked: 1, address: 'rugcheck' }]
const solGut = pruefe(ausGoPlusSolana(solSauber(), lpSol), marktOk())
p('sauberer Solana-Token besteht', solGut.status === 'bestanden', `${solGut.grund} ${JSON.stringify(solGut.hinweise)}`)
p('leere Gebühr heisst: keine Gebühr (bekannt)', solGut.flaggen.verkaufssteuerProzent === 0)
p('Halteradresse kommt aus `account` — der Verbrenner zählt nicht mit',
    Math.round(solGut.flaggen.top10Prozent) === 5, String(solGut.flaggen.top10Prozent))

const solFrost = pruefe(ausGoPlusSolana({
    ...solSauber(), freezable: { authority: [{ address: 'F' }], status: '1' },
}, lpSol), marktOk())
p('Freeze-Authority (GoPlus) wird verworfen', solFrost.grund === 'verkauf_sperrbar', solFrost.grund)
const solEis = pruefe(ausGoPlusSolana({ ...solSauber(), default_account_state: '2' }, lpSol), marktOk())
p('eingefroren startende Konten werden verworfen', solEis.grund === 'verkauf_sperrbar', solEis.grund)
const solSaldo = pruefe(ausGoPlusSolana({
    ...solSauber(), balance_mutable_authority: { authority: [{ address: 'B' }], status: '1' },
}, lpSol), marktOk())
p('änderbare Kontostände werden verworfen', solSaldo.grund === 'saldo_aenderbar', solSaldo.grund)
const solGebuehr = pruefe(ausGoPlusSolana({
    ...solSauber(), transfer_fee: { current_fee_rate: { transfer_fee_basis_points: 2500 } },
}, lpSol), marktOk())
p('Gebühr in Basispunkten wird gelesen (25 % → verworfen)', solGebuehr.grund === 'verkaufssteuer_hoch',
    JSON.stringify(solGebuehr.flaggen))
const solGebuehrUnklar = pruefe(ausGoPlusSolana({
    ...solSauber(), transfer_fee: { current_fee_rate: { irgendwas: 'x' } },
}, lpSol), marktOk())
p('Gebühr in unbekannter Form bleibt unbekannt, nicht 0',
    solGebuehrUnklar.flaggen.verkaufssteuerProzent === null, JSON.stringify(solGebuehrUnklar.flaggen))
const solSchliessbar = pruefe(ausGoPlusSolana({
    ...solSauber(), closable: { authority: [{ address: 'C' }], status: '1' },
}, lpSol), marktOk())
p('schliessbarer Token kostet Note', solSchliessbar.status === 'bestanden'
    && solSchliessbar.safetyScore < solGut.safetyScore)
p('leere GoPlus-Solana-Antwort ergibt null (= ungeprüft)', ausGoPlusSolana(null) === null)

// ── RugCheck: Token-2022, Insider-Netzwerke, bekannte Konten (10.10.2026) ─
{
    const harmlos = {
        nonTransferable: false, transferFeeConfig: null, defaultAccountState: null, permanentDelegate: null,
        metadataPointer: { authority: null, metadataAddress: 'x' }, tokenMetadata: { authority: null, mint: 'x' },
        mintCloseAuthority: null, confidentialTransferMint: null, interestBearingConfig: null, transferHook: null,
        scaledUiAmountConfig: null, pausableConfig: null,
    }
    const t = token2022(harmlos)
    p('Token-2022: alle Schlüssel da, alle harmlos → nichts gesetzt',
        !t.nichtUebertragbar && !t.staendigBevollmaechtigt && !t.hook && !t.standardEingefroren && !t.anhaltbar
        && !t.schliessbar && !t.gebuehrAenderbar && !t.metadatenAenderbar && !t.gefahren.length, JSON.stringify(t))
    // Auf dem sauberen Befund von oben aufgebaut (gesperrte Liquidität, breite Verteilung).
    const rc = (ext, extra = {}) => ({
        ...sauberRc, token: { ...sauberRc.token, supply: 1000 }, token_extensions: { ...harmlos, ...ext }, ...extra,
    })
    p('ständiger Bevollmächtigter ist K.o.', pruefe(ausRugCheck(rc({ permanentDelegate: { delegate: 'D' } })), marktOk()).grund === 'saldo_aenderbar')
    p('nicht übertragbar ist K.o. (Honeypot)', pruefe(ausRugCheck(rc({ nonTransferable: true })), marktOk()).grund === 'honeypot')
    p('Übertragungs-Hook ist K.o.', pruefe(ausRugCheck(rc({ transferHook: { programId: 'P', authority: 'A' } })), marktOk()).grund === 'verkauf_sperrbar')
    p('eingefroren startende Konten sind K.o.', pruefe(ausRugCheck(rc({ defaultAccountState: { state: 'frozen' } })), marktOk()).grund === 'verkauf_sperrbar')
    p('… initialisiert startende nicht', pruefe(ausRugCheck(rc({ defaultAccountState: { state: 'initialized' } })), marktOk()).status === 'bestanden')
    p('anhaltbar mit Vollmacht ist K.o.', pruefe(ausRugCheck(rc({ pausableConfig: { authority: 'A', paused: false } })), marktOk()).grund === 'verkauf_sperrbar')
    p('… ohne Vollmacht nicht', pruefe(ausRugCheck(rc({ pausableConfig: { authority: null } })), marktOk()).status === 'bestanden')
    const schliess = pruefe(ausRugCheck(rc({ mintCloseAuthority: 'C' })), marktOk())
    const sauber = pruefe(ausRugCheck(rc({})), marktOk())
    p('schliessbarer Mint kostet Punkte, kein K.o.', schliess.status === 'bestanden' && schliess.safetyScore < sauber.safetyScore)

    p('RugCheck ohne `token`: nicht geprüft (null)', ausRugCheck({ topHolders: [], rugged: false }) === null)

    const netz = ausRugCheck({ ...rc({}), token: { supply: 1000, mintAuthority: null, freezeAuthority: null },
        insiderNetworks: [{ size: 17, currentHolding: 22 }, { size: 4, currentHolding: 10 }] })
    p('Insider-Anteil aus den Netzwerken (Rohmenge / Angebot)', Math.abs(netz.insider_anteil_pct - 3.2) < 1e-9, String(netz.insider_anteil_pct))
    p('ohne Netzwerkangabe: Insider unbekannt, nicht 0', ausRugCheck(rc({})).insider_anteil_pct === null)
    const erst = ausRugCheck({ ...rc({}), creator: 'C', creatorBalance: 28, token: { supply: 1000 } })
    p('Ersteller-Anteil aus creatorBalance', Math.abs(erst.ersteller_anteil_pct - 2.8) < 1e-9 && erst.ersteller === 'C')

    // Der Pool eines graduierten Tokens ist kein Klumpen (CAT, 10.10.2026: 23,4 % im Pump-Fun-AMM).
    const pool = ausRugCheck({ ...rc({}), knownAccounts: { POOL: { name: 'Pump Fun AMM', type: 'AMM' } },
        topHolders: [{ address: 'k1', owner: 'POOL', pct: 23.38 }, { address: 'k2', owner: 'w1', pct: 7.81 }, { address: 'k3', owner: 'w2', pct: 6.07 }] })
    p('bekannter AMM-Pool zählt nicht zu den Top-10', Math.abs(summeTop10(pool.holders, { skala: pool.anteilSkala }) - 13.88) < 1e-9,
        String(summeTop10(pool.holders, { skala: pool.anteilSkala })))
    // Verbrannt: bei RugCheck steht der Verbrenner als Besitzer, nicht als Konto.
    const brand = ausRugCheck({ ...rc({}), topHolders: [{ address: 'konto', owner: '1nc1nerator11111111111111111111111111111111', pct: 40 }, { address: 'b', owner: 'w', pct: 5 }] })
    p('verbrannter Anteil (Besitzer) zählt nicht', summeTop10(brand.holders, { skala: brand.anteilSkala }) === 5)
}

// ── Pausenfunktion ohne Eigentümer (PEPE) ───────────────────────────────
{
    const pepe = pruefe({ ...sauber(), quelle: 'goplus-evm', transfer_pausable: 1, owner_address: '0x0000000000000000000000000000000000000000' }, marktOk())
    p('EVM: anhaltbar, aber Eigentümer abgegeben → kein K.o.', pepe.status === 'bestanden', pepe.grund)
    p('… und als Hinweis sichtbar', pepe.hinweise.some((h) => /Pausenfunktion/.test(h)))
    const aktiv = pruefe({ ...sauber(), quelle: 'goplus-evm', transfer_pausable: 1, owner_address: '0x1234567890123456789012345678901234567890' }, marktOk())
    p('EVM: anhaltbar mit aktivem Eigentümer → K.o.', aktiv.grund === 'verkauf_sperrbar')
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
