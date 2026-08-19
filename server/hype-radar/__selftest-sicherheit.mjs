/**
 * Selbsttest: Sicherheitsprüfung des Hype-Radars.
 *
 * Ohne Netz. Das ist der wichtigste Test des Features: hier entscheidet sich,
 * ob ein Token, aus dem man nicht wieder herauskommt, in einem Bericht als
 * „Top-Kandidat" landet. Jeder K.-o.-Fall wird deshalb einzeln geprüft.
 *
 * Aufruf: node server/hype-radar/__selftest-sicherheit.mjs
 */
import { pruefe, summeTop10, STANDARD_SICHERHEIT } from './sicherheit.js'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Hype-Radar: Sicherheit')

/** Ein unauffälliger Vertrag als Ausgangspunkt. */
const sauber = () => ({
    is_honeypot: 0, is_mintable: 0, is_proxy: 0,
    cannot_sell_all: 0, transfer_pausable: 0,
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

const zuKlein = pruefe(sauber(), { ...marktOk(), liquiditaetUsd: 5000 })
p('zu wenig Liquidität wird verworfen', zuKlein.grund === 'liquiditaet_zu_klein')

const zuJung = pruefe(sauber(), { ...marktOk(), paarAlterStunden: 2 })
p('zu junges Paar wird verworfen', zuJung.grund === 'zu_jung')

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

// ── Zahlenformate: GoPlus liefert Anteile mal als 0..1, mal als 0..100 ──
p('Anteile als 0..1 werden erkannt',
    Math.round(summeTop10([{ percent: '0.25' }, { percent: '0.15' }])) === 40)
p('Anteile als 0..100 werden erkannt',
    Math.round(summeTop10([{ percent: '25' }, { percent: '15' }])) === 40)
p('leere Halterliste ergibt null', summeTop10([]) === null)
p('fehlende Halterliste ergibt null', summeTop10(undefined) === null)

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

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
