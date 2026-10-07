/**
 * Selbsttest: Projektprüfung des Hype-Radars (die reine Rechnung).
 *
 * Ohne Netz. Geprüft werden beide Richtungen: was eine ernst gemeinte Seite
 * erkennen lässt, und — wichtiger — was NICHT als Mangel gelten darf
 * (Skript-Seiten, Paaradressen, Gratis-Plattformen beim Domain-Alter).
 *
 * Aufruf: node server/hype-radar/__selftest-projekt.mjs
 */
import {
    leseWebseite, sichtbarerText, registrierbareDomain, gratisPlattform, rdapRegistriert,
    githubZiel, githubFakten, erstellerBilanz, bewerteProjekt, STERNE_FUER_PROJEKT,
} from './projekt-bewertung.js'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Hype-Radar: Projektprüfung')

const CA = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'

// ── Webseiten ───────────────────────────────────────────────────────────
const gut = `<!doctype html><html><head><title>Vaulteryx — Restaking for everyone</title>
<meta name="description" content="Liquid restaking protocol with on-chain vaults."></head>
<body><script>var x = "lorem ipsum";</script><style>.a{}</style>
<h1>Vaulteryx</h1><p>${'We build a liquid restaking protocol for retail users. '.repeat(30)}</p>
<h2>Roadmap</h2><p>Phase 1: testnet. Phase 2: mainnet.</p>
<h2>Tokenomics</h2><p>Total supply 1,000,000,000.</p>
<h2>Meet the team</h2><p>Our core team has shipped DeFi products since 2019.</p>
<p>CA: ${CA}</p>
<a href="https://github.com/vaulteryx/protocol">GitHub</a>
<a href="https://x.com/vaulteryx">X</a> <a href="https://t.me/vaulteryx">Telegram</a>
<a href="https://docs.vaulteryx.io/">Docs</a>
<a href="https://dexscreener.com/solana/AbCdEfGhJkLmNoPqRsTuVwXyZ123456789abcdefgh">Chart</a>
<p>© 2024–2026 Vaulteryx</p></body></html>`
{
    const f = leseWebseite(gut, { contract: CA, url: 'https://vaulteryx.io/' })
    p('Titel gelesen', f.titel.startsWith('Vaulteryx'))
    p('Beschreibung gelesen', /restaking/.test(f.beschreibung))
    p('Skript-Inhalt zählt nicht als Text (kein Platzhalter aus <script>)', f.platzhalter === false)
    p('Wörter gezählt', f.woerter > 300, String(f.woerter))
    p('Abschnitte erkannt', f.abschnitte.roadmap && f.abschnitte.tokenomics && f.abschnitte.team && f.abschnitte.whitepaper,
        JSON.stringify(f.abschnitte))
    p('Kanäle aus Links', f.kanaele.x.length === 1 && f.kanaele.telegram.length === 1 && f.kanaele.github.length === 1)
    p('Vertragsadresse passt', f.vertragAufSeite === 'passt')
    /*
     * Die DexScreener-PAARadresse im Link ist nicht der Token — ohne Etikett
     * davor darf sie nicht als „fremde Vertragsadresse" gelten.
     */
    p('Paaradresse im Link ist keine fremde Vertragsadresse', f.fremdeVertraege.length === 0)
    p('Copyright-Jahr', f.copyrightJahr === 2026, String(f.copyrightJahr))
}
{
    const fremd = leseWebseite('<p>Buy now! CA: 0x1111111111111111111111111111111111111111</p>',
        { contract: '0x2222222222222222222222222222222222222222' })
    p('andere Vertragsadresse mit Etikett wird erkannt', fremd.vertragAufSeite === 'fremd'
        && fremd.fremdeVertraege[0] === '0x1111111111111111111111111111111111111111')
    const evmGross = leseWebseite('<p>Contract: 0xABCDEF1111111111111111111111111111111111</p>',
        { contract: '0xabcdef1111111111111111111111111111111111' })
    p('EVM-Adresse ohne Rücksicht auf Gross/Klein', evmGross.vertragAufSeite === 'passt')
    const wallet = leseWebseite('<p>Team wallet address: 0x1111111111111111111111111111111111111111</p>',
        { contract: '0x2222222222222222222222222222222222222222' })
    p('Team-Wallet ist keine Vertragsangabe', wallet.vertragAufSeite === 'fehlt')
}
{
    const huelle = '<html><body><div id="root"></div><script src="/a.js"></script><script src="/b.js"></script></body></html>'
    const f = leseWebseite(huelle)
    p('React-Hülle wird als „nur Skript" erkannt, nicht als leer', f.nurSkript === true)
    const b = bewerteProjekt({ webseite: { status: 'ok', fakten: f } })
    p('… und kostet keine Punkte für „kaum Text"', !b.befunde.some((x) => x.schluessel === 'kaumText'))
}
{
    const platz = leseWebseite('<h1>$MOON</h1><p>Coming soon. CA: TBA</p>')
    p('Platzhalter erkannt', platz.platzhalter === true)
    const carrd = leseWebseite('<html><head><link href="https://carrd.co/x.css"></head><body><p>links</p></body></html>')
    p('Carrd-Baukasten erkannt', carrd.baukasten === 'carrd')
}
p('sichtbarer Text ohne Kommentare und Entitäten', sichtbarerText('<!-- x --><p>a&amp;b&nbsp;c</p>') === 'a&b c')

// ── Domains ─────────────────────────────────────────────────────────────
p('registrierbare Domain', registrierbareDomain('app.vaulteryx.io') === 'vaulteryx.io')
p('zweistufige Endung', registrierbareDomain('www.foo.co.uk') === 'foo.co.uk')
p('Gratis-Plattform erkannt', gratisPlattform('mytoken.vercel.app') === 'vercel.app')
p('eigene Domain ist keine Gratis-Plattform', gratisPlattform('vaulteryx.io') === '')
p('RDAP: Registrierung gelesen',
    rdapRegistriert({ events: [{ eventAction: 'last changed', eventDate: '2026-01-01T00:00:00Z' },
        { eventAction: 'registration', eventDate: '2024-03-01T12:00:00Z' }] }) === Date.parse('2024-03-01T12:00:00Z'))
p('RDAP ohne Registrierung ergibt null', rdapRegistriert({ events: [] }) === null)

// ── GitHub ──────────────────────────────────────────────────────────────
p('GitHub-Ziel mit Repo', JSON.stringify(githubZiel('https://github.com/vaulteryx/protocol.git')) === '{"konto":"vaulteryx","repo":"protocol"}')
p('GitHub-Ziel nur Konto', githubZiel('https://github.com/vaulteryx')?.repo === '')
p('kein Konto: /orgs/…', githubZiel('https://github.com/orgs/x') === null)
p('fremder Host', githubZiel('https://gitlab.com/x/y') === null)
{
    const jetzt = Date.parse('2026-10-07T00:00:00Z')
    const g = githubFakten({
        konto: { login: 'vaulteryx', type: 'Organization', created_at: '2021-01-01T00:00:00Z', public_repos: 12, followers: 300 },
        repo: { name: 'protocol', created_at: '2025-01-01T00:00:00Z', pushed_at: '2026-10-01T00:00:00Z', stargazers_count: 80, forks_count: 9, fork: false, size: 2048 },
        repos: [
            { name: 'protocol', stargazers_count: 80, fork: false },
            { name: 'old-dex', stargazers_count: 450, fork: false, created_at: '2022-01-01T00:00:00Z' },
            { name: 'forked-lib', stargazers_count: 9000, fork: true },
            { name: 'tiny', stargazers_count: STERNE_FUER_PROJEKT - 1, fork: false },
        ],
    }, jetzt)
    p('Konto als Organisation, Alter in Tagen', g.konto.art === 'organisation' && g.konto.alterTage > 2000)
    p('Repo gepflegt', g.repo.letzterPushTage < 7 && g.repo.alterTage > 600)
    p('frühere Projekte: ohne das eigene, ohne Forks, nur mit Sternen',
        g.fruehereProjekte.length === 1 && g.fruehereProjekte[0].name === 'old-dex', JSON.stringify(g.fruehereProjekte))
}

// ── Ersteller ───────────────────────────────────────────────────────────
{
    const jetzt = Date.parse('2026-10-07T12:00:00Z')
    const coins = [
        { mint: 'AKTUELL', complete: false, created_timestamp: jetzt - 3600e3 },
        { mint: 'A', symbol: 'AAA', complete: true, created_timestamp: jetzt - 40 * 86400e3, usd_market_cap: 2e6 },
        { mint: 'B', symbol: 'BBB', complete: false, created_timestamp: jetzt - 20 * 86400e3 },
    ]
    const e = erstellerBilanz(coins, { mint: 'AKTUELL', jetzt })
    p('der aktuelle Coin zählt nicht mit', e.andere === 2)
    p('graduierte gezählt', e.graduiert === 1 && e.beispiele[0].symbol === 'AAA')
    p('Antwort als {coins: […]} wird gelesen', erstellerBilanz({ coins }, { mint: 'AKTUELL', jetzt }).andere === 2)
    p('unlesbare Antwort ergibt null (unbekannt)', erstellerBilanz({ fehler: 1 }) === null)
    const serie = erstellerBilanz(Array.from({ length: 30 }, (_, i) => ({ mint: `S${i}`, complete: false, created_timestamp: jetzt - i * 1800e3 })),
        { mint: 'X', jetzt })
    p('Serien-Launcher gezählt', serie.andere === 30 && serie.graduiert === 0 && serie.letzte24h >= 5)
}

// ── Gesamturteil ────────────────────────────────────────────────────────
{
    const fakten = leseWebseite(gut, { contract: CA, url: 'https://vaulteryx.io/' })
    const stark = bewerteProjekt({
        webseite: { status: 'ok', fakten, domainAlterTage: 400, plattform: '' },
        kanaele: { x: true, telegram: true },
        github: { repo: { name: 'protocol', alterTage: 600, letzterPushTage: 5, sterne: 80, istFork: false }, konto: { alterTage: 2000 }, fruehereProjekte: [{ name: 'old-dex', sterne: 450 }] },
        ersteller: { andere: 3, graduiert: 1, letzte24h: 0, beispiele: [{ symbol: 'AAA' }], vollstaendig: true },
    })
    p('starkes Projekt bekommt hohe Substanz', stark.note >= 90, String(stark.note))
    p('jeder Zuschlag ist begründet', stark.befunde.filter((b) => b.art === 'plus').length >= 6)

    const leer = bewerteProjekt({ webseite: { status: 'keine' }, kanaele: {}, ersteller: { andere: 40, graduiert: 0, letzte24h: 8, vollstaendig: false } })
    p('Wegwerf-Token bekommt kaum Substanz', leer.note <= 10, String(leer.note))
    p('Serie und Masse werden benannt', leer.befunde.some((b) => b.schluessel === 'erstellerSerie')
        && leer.befunde.some((b) => b.schluessel === 'erstellerMasse'))

    const fremd = bewerteProjekt({ webseite: { status: 'ok', fakten: { ...fakten, vertragAufSeite: 'fremd', fremdeVertraege: ['0x11'] } } })
    p('fremde Vertragsadresse kostet schwer', fremd.befunde.some((b) => b.schluessel === 'vertragFremd'))

    /*
     * Gratis-Plattform: das Domain-Alter der Plattform darf NICHT als Alter
     * des Projekts zählen — vercel.app ist Jahre alt, die Seite eine Stunde.
     */
    const gratis = bewerteProjekt({ webseite: { status: 'ok', fakten, domainAlterTage: 3000, plattform: 'vercel.app' } })
    p('Gratis-Plattform: kein Bonus für Domain-Alter', !gratis.befunde.some((b) => /domain/i.test(b.schluessel)))

    p('nichts geprüft ergibt keine Note (unbekannt, nicht 50)', bewerteProjekt({}).note === null)
    p('neue Domain kostet', bewerteProjekt({ webseite: { status: 'ok', fakten, domainAlterTage: 1, plattform: '' } })
        .befunde.some((b) => b.schluessel === 'domainNeu'))
    p('erster Coin des Erstellers ist nur eine Auskunft',
        bewerteProjekt({ ersteller: { andere: 0, graduiert: 0, letzte24h: 0 } }).note === 50)
    const fork = bewerteProjekt({ github: { repo: { name: 'x', istFork: true }, fruehereProjekte: [] } })
    p('Fork kostet', fork.befunde.some((b) => b.schluessel === 'githubFork'))
    const schutz = bewerteProjekt({ webseite: { status: 'geschuetzt' }, kanaele: { x: true } })
    p('Bot-Schutz ist kein toter Link (keine Abzüge dafür)',
        schutz.befunde.some((b) => b.schluessel === 'webseiteGeschuetzt') && !schutz.befunde.some((b) => b.schluessel === 'webseiteTot'))
    p('Note bleibt im Bereich', [stark, leer, fremd, gratis].every((b) => b.note >= 0 && b.note <= 100))
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
