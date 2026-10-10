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
    ordneWebseite, adresseImPfad, fremdePlattform, kanalAus, nenntToken, seitenBeleg, ordneAbruffehler,
    githubBeleg, hostVon, SAMMEL_AB, pfadTiefe,
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
        github: { beleg: true, repo: { name: 'protocol', alterTage: 600, letzterPushTage: 5, sterne: 80, istFork: false }, konto: { alterTage: 2000 }, fruehereProjekte: [{ name: 'old-dex', sterne: 450 }] },
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

// ── Was für eine Adresse ist die „Webseite"? (10.10.2026) ───────────────
/*
 * Gemessen am Bestand: 79 von 345 gelesenen Seiten lagen auf x.com, TikTok,
 * GitHub, YouTube …, 72 davon mit Bonus für das Domain-Alter; 54 zeigten die
 * Coin-Seite einer anderen Adresse, 25 davon mit demselben Symbol.
 */
const MINT = '7KyCdUVrNbo4BJT4xwKLFtdwJzaYFJTVenXNiN2Kpump'
const ANDERER = 'AMpDxGn6NC4kx5p18keFNJrz28HYgbZPTrUxFTL9pump'
{
    p('Tweet ist eine fremde Plattform (Kanal)', ordneWebseite('https://x.com/Dexerto/status/2087177241423733190').grund === 'plattform'
        && ordneWebseite('https://x.com/Dexerto/status/1').art === 'kanal')
    p('TikTok über Unterdomain erkannt', ordneWebseite('https://vm.tiktok.com/ZMabc/').grund === 'plattform')
    p('fremdes GitHub-Repository ist keine Webseite', ordneWebseite('https://github.com/boykopovar/AnyPS5').art === 'code')
    p('pump.fun ist ein Handelsplatz, auch mit eigener Adresse im Pfad',
        ordneWebseite(`https://pump.fun/coin/${MINT}`, MINT).grund === 'plattform')
    p('eigene Adresse im Pfad: nur die Token-Seite auf einer Plattform',
        ordneWebseite(`https://otcdesks.cash/coin/${MINT}`, MINT).grund === 'tokenSeite')
    const fremd = ordneWebseite(`https://otcdesks.cash/coin/${ANDERER}`, MINT)
    p('andere Adresse im Pfad: Seite eines anderen Tokens', fremd.grund === 'fremderToken' && fremd.adresse === ANDERER)
    p('EVM im Pfad ohne Rücksicht auf Gross/Klein',
        ordneWebseite('https://usepaid.app/token/0xABCDEF1111111111111111111111111111111111', '0xabcdef1111111111111111111111111111111111').grund === 'tokenSeite')
    p('eigene Domain bleibt zu prüfen', ordneWebseite('https://www.tootincoin.money', MINT).grund === '')
    p('… ihr Host ohne www', ordneWebseite('https://www.tootincoin.money/').host === 'tootincoin.money')
    p('ungültige Adresse', ordneWebseite('kein link').grund === 'ungueltig')
    // Gegenproben: was KEINE Adresse ist
    p('langes Pfadwort ohne Ziffern ist keine Adresse', adresseImPfad('https://blueshift.gg/research/quantumproofingsolanaresearchnotes') === '')
    p('Pfad mit Bindestrichen ist keine Adresse', adresseImPfad('https://blueshift.gg/research/quantum-proofing-solana') === '')
    p('box.com ist nicht x.com', fremdePlattform('box.com') === null)
    p('github.io ist eine Gratis-Plattform, kein Code-Host', fremdePlattform('meintoken.github.io') === null
        && gratisPlattform('meintoken.github.io') === 'github.io')
    p('Seitenbaukasten für Token ist eine Gratis-Plattform', gratisPlattform('clearcap.mintfactory.xyz') === 'mintfactory.xyz')
    p('hostVon ohne www und klein', hostVon('https://WWW.Foo.IO/x') === 'foo.io')
}

// ── Kanäle ──────────────────────────────────────────────────────────────
{
    p('X-Konto ist ein Kanal', kanalAus('https://x.com/vaulteryx').gueltig === true)
    p('X-Gemeinschaft ist ein Kanal', kanalAus('https://x.com/i/communities/1890000000000000000').gueltig === true)
    const tweet = kanalAus('https://twitter.com/Dexerto/status/2087177241423733190')
    p('einzelner Beitrag ist kein Kanal', tweet.art === 'x' && tweet.gueltig === false && tweet.grund === 'beitrag')
    p('X-Suche ist kein Kanal', kanalAus('https://x.com/search?q=%24CAT').gueltig === false)
    p('Telegram-Kanal', kanalAus('https://t.me/vaulteryx').gueltig === true && kanalAus('https://t.me/+AbCdEf').gueltig === true)
    p('Telegram-Vorschau /s/ zählt wie der Kanal', kanalAus('https://t.me/s/vaulteryx').gueltig === true)
    const bot = kanalAus('https://t.me/solana_trojanbot?start=r-abc')
    p('Handelsbot ist keine Gemeinschaft', bot.art === 'telegram' && bot.gueltig === false && bot.grund === 'bot')
    p('Discord-Einladung', kanalAus('https://discord.gg/abc').gueltig === true)
    p('box.com ist kein X-Kanal', kanalAus('https://box.com/s/x').art === '')
}

// ── Sammelseiten, Cashtags, Handelslinks ────────────────────────────────
{
    // Base58 kennt keine 0, kein O, I oder l — die Testadressen auch nicht.
    const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    const liste = Array.from({ length: SAMMEL_AB + 2 }, (_, i) => `<li><a href="/coin/${i}">Ab${B58[i]}${B58[(i * 7) % 58]}CdEfGhJkLmNpQrStUvWxYz23456789ab</a></li>`).join('')
    const sammel = leseWebseite(`<html><title>Markets</title><body><ul>${liste}</ul><p>${CA}</p></body></html>`, { contract: CA })
    p('Seite mit vielen Verträgen ist eine Sammelseite', sammel.sammelseite === true && sammel.adressen >= SAMMEL_AB, String(sammel.adressen))
    p('… und dort „steht der Vertrag" nicht als Beleg', sammel.vertragAufSeite === 'sammel')
    const bild = leseWebseite(`<img src="data:image/png;base64,${'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg'.repeat(30)}"><p>${CA}</p>`, { contract: CA })
    p('eingebettetes Bild zählt keine Adressen', bild.adressen === 1 && bild.sammelseite === false, String(bild.adressen))
    p('der eigene Vertrag auf einer Einzelseite passt weiterhin', bild.vertragAufSeite === 'passt')
    const meme = leseWebseite(`<title>Darn Tootin' ($TOOTIN)</title><p>Buy $TOOTIN on <a href="https://pump.fun/coin/${MINT}">pump.fun</a>. Price $1,000 soon.</p>`)
    p('Cashtag gelesen, Preisangabe nicht', meme.cashtags.includes('tootin') && !meme.cashtags.includes('1'))
    p('Link auf einen Handelsplatz gezählt', meme.handelsLinks === 1)
}

// ── Gehört die Seite zum Token? ─────────────────────────────────────────
{
    p('CAT steht nicht in „education"', nenntToken({ host: 'education.com', titel: 'Education for all' }, { symbol: 'CAT' }) === false)
    p('CAT als Wort im Titel', nenntToken({ host: 'meowfi.io', titel: 'The Cat Coin' }, { symbol: 'CAT' }) === true)
    p('CAT am Anfang des Domain-Teils', nenntToken({ host: 'catcoin.io', titel: '' }, { symbol: 'CAT' }) === true)
    p('langer Name irgendwo in der Domain', nenntToken({ host: 'tootincoin.money', titel: '' }, { name: 'Tootin', symbol: 'TOOTIN' }) === true)
    p('Sonderzeichen im Namen stören nicht', nenntToken({ host: 'x.io', titel: "Darn Tootin' ($TOOTIN)" }, { name: "Darn Tootin'" }) === true)
    p('zweibuchstabiges Symbol allein nennt nichts', nenntToken({ host: 'ai.com', titel: 'AI' }, { symbol: 'AI' }) === false)

    const seite = (fakten, extra = {}) => ({ status: 'ok', host: 'tootincoin.money', fakten: { vertragAufSeite: 'fehlt', cashtags: [], handelsLinks: 0, titel: '', ...fakten }, ...extra })
    const token = { symbol: 'TOOTIN', name: 'Darn Tootin', contract: MINT }
    p('Vertrag auf der Seite belegt sie', seitenBeleg(seite({ vertragAufSeite: 'passt' }), token).wie === 'vertrag')
    p('Name plus „$Symbol" belegt sie', seitenBeleg(seite({ titel: "Darn Tootin' ($TOOTIN)", cashtags: ['tootin'] }), token).wie === 'name')
    /*
     * Der Name allein genügt nicht: ein Token namens NETFLIX, der netflix.com
     * angibt, bekäme sonst die älteste Domain und den meisten Text des Netzes.
     */
    p('Name ohne Token-Bezug belegt nichts (Markenseite)',
        seitenBeleg({ status: 'ok', host: 'netflix.com', fakten: { vertragAufSeite: 'fehlt', titel: 'Netflix', cashtags: [], handelsLinks: 0 } },
            { symbol: 'NETFLIX', name: 'Netflix' }).eigen === false)
    p('geteilte Seite ist nur über den Vertrag belegt',
        seitenBeleg(seite({ titel: "Darn Tootin' ($TOOTIN)", cashtags: ['tootin'] }, { geteilt: 4 }), token).eigen === false)
    p('… mit Vertrag ist sie das Original', seitenBeleg(seite({ vertragAufSeite: 'passt' }, { geteilt: 4 }), token).wie === 'vertrag')
    p('Sammelseite belegt nie', seitenBeleg(seite({ vertragAufSeite: 'sammel', sammelseite: true }), token).eigen === false)
    p('fremder Vertrag auf der Seite belegt nicht', seitenBeleg(seite({ vertragAufSeite: 'fremd', titel: 'TOOTIN', cashtags: ['tootin'] }), token).eigen === false)
}

// ── Abruffehler: tot, geschützt oder nicht prüfbar ──────────────────────
{
    const art = (e) => ordneAbruffehler(e).status
    p('403 ist Bot-Schutz', art({ status: 403 }) === 'geschuetzt')
    p('503 ist Bot-Schutz (Cloudflare)', art({ status: 503 }) === 'geschuetzt')
    p('404 und 410 sind tot', art({ status: 404 }) === 'fehler' && art({ status: 410 }) === 'fehler')
    p('Serverfehler nach zwei Anläufen ist tot', art({ status: 500 }) === 'fehler' && art({ status: 521 }) === 'fehler')
    p('451 (Sperre nach Land) ist nicht prüfbar', art({ status: 451 }) === 'unpruefbar')
    const nx = { art: 'dns', code: 'ENOTFOUND', message: 'Name „x" nicht auflösbar' }
    p('Name gibt es nicht, Gegenprobe bestätigt: tot', ordneAbruffehler(nx, { nxdomain: true }).status === 'fehler')
    // 10.10.2026: ENOTFOUND für www.tootincoin.money und blueshift.gg, eine Minute später antworteten beide.
    p('ENOTFOUND, aber die Gegenprobe kennt den Namen: nicht tot', ordneAbruffehler(nx, { nxdomain: false }).status === 'unpruefbar')
    p('ENOTFOUND ohne Gegenprobe: nicht tot', art(nx) === 'unpruefbar')
    p('Namensdienst gerade weg: nicht prüfbar', art({ art: 'dns', code: 'EAI_AGAIN', message: 'Name „x" nicht auflösbar' }) === 'unpruefbar')
    p('Verbindung verweigert: tot', art({ art: 'netz', code: 'ECONNREFUSED', message: 'fetch failed' }) === 'fehler')
    // Die zehn Seiten vom 10.10.2026: so antwortet ein DNS-Filter im eigenen Netz.
    p('0.0.0.0 ist nicht prüfbar, nicht tot', art({ art: 'gesperrt', adresse: '0.0.0.0', message: '„x" zeigt auf eine interne Adresse (0.0.0.0)' }) === 'unpruefbar')
    p('… auch aus dem alten Fehlertext', art({ message: '„x" zeigt auf eine interne Adresse (0.0.0.0)' }) === 'unpruefbar')
    p('zu grosse Seite ist nicht tot', art({ art: 'zuGross', message: 'Antwort zu gross (über 2048 kB)' }) === 'unpruefbar')
    p('Zeitgrenze ist nicht tot', art({ name: 'AbortError', code: 20, message: 'This operation was aborted' }) === 'unpruefbar')
    p('Zertifikat, das Node strenger prüft, ist nicht tot', art({ art: 'netz', code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', message: 'fetch failed' }) === 'unpruefbar')
    p('allgemeiner Netzfehler ist nicht tot', art({ message: 'fetch failed' }) === 'unpruefbar')
}

// ── GitHub-Beleg ────────────────────────────────────────────────────────
{
    const g = { konto: { name: 'boykopovar', webseite: '', bio: '' }, repo: { name: 'AnyPS5', beschreibung: 'Tool for automatic PS5 executables', webseite: '' } }
    p('fremdes Repository ohne Bezug: kein Beleg', githubBeleg(g, { contract: MINT }) === false)
    p('Link von der belegten eigenen Seite: Beleg', githubBeleg(g, { vonSeite: true }) === true)
    p('Repository nennt den Vertrag: Beleg', githubBeleg({ ...g, repo: { ...g.repo, beschreibung: `Token ${MINT}` } }, { contract: MINT }) === true)
    p('Repository verweist auf die eigene Seite: Beleg',
        githubBeleg({ ...g, repo: { ...g.repo, webseite: 'www.tootincoin.money' } }, { seitenHost: 'tootincoin.money' }) === true)
    p('… aber nicht ohne belegte eigene Seite',
        githubBeleg({ ...g, repo: { ...g.repo, webseite: 'tootincoin.money' } }, { seitenHost: '' }) === false)
}

// ── Ersteller: Gegenprobe des Filters ───────────────────────────────────
{
    const jetzt = Date.parse('2026-10-10T12:00:00Z')
    const W = 'Wa11et111111111111111111111111111111111111'
    const eigene = [{ mint: 'A', creator: W, complete: true, created_timestamp: jetzt - 86400e3 }, { mint: 'B', creator: W, complete: false }]
    p('nur Coins dieser Wallet: gezählt', erstellerBilanz(eigene, { wallet: W, jetzt }).andere === 2)
    // Gemessen 10.10.2026: ein vertippter Filter liefert die fünfzig neuesten Coins ALLER Ersteller.
    const ungefiltert = [...eigene, { mint: 'C', creator: 'Fremd111111111111111111111111111111111111' }]
    p('ein Coin eines anderen Erstellers: Antwort ungefiltert, unbekannt', erstellerBilanz(ungefiltert, { wallet: W, jetzt }) === null)
}

// ── Gesamturteil nach den neuen Regeln ──────────────────────────────────
{
    const has = (b, s) => b.befunde.some((x) => x.schluessel === s)
    const tweet = bewerteProjekt({ webseite: { status: 'keine', grund: 'plattform', plattform: 'x.com', art: 'kanal', url: 'https://x.com/a/status/1', host: 'x.com' } })
    p('Tweet als Webseite: keine eigene Webseite', has(tweet, 'keineWebseite') && /sozialen Netz/.test(tweet.befunde[0].text))
    p('… ohne Bonus für das Domain-Alter von x.com', !tweet.befunde.some((x) => /domain/i.test(x.schluessel)))
    const kopie = bewerteProjekt({ webseite: { status: 'keine', grund: 'fremderToken', host: 'otcdesks.cash', adresse: ANDERER } })
    p('Seite eines anderen Tokens kostet wie ein fremder Vertrag', has(kopie, 'vertragFremd') && kopie.note === 25, String(kopie.note))
    const eigeneSeite = bewerteProjekt({ webseite: { status: 'keine', grund: 'tokenSeite', host: 'otcdesks.cash' } })
    p('nur die eigene Coin-Seite: keine eigene Webseite', has(eigeneSeite, 'keineWebseite') && eigeneSeite.note === 35)

    const sammelFakten = { woerter: 900, abschnitte: { produkt: true, tokenomics: true }, vertragAufSeite: 'sammel', sammelseite: true, adressen: 121 }
    const sammel = bewerteProjekt({ webseite: { status: 'ok', host: 'born.fun', fakten: sammelFakten, domainAlterTage: 400 } })
    p('Sammelseite: keine eigene Webseite, kein Text-, Abschnitts- oder Domain-Bonus',
        has(sammel, 'keineWebseite') && !has(sammel, 'vielText') && !has(sammel, 'abschnitte') && !has(sammel, 'domainAlt') && !has(sammel, 'vertragPasst'))

    const fakten = leseWebseite(gut, { contract: CA, url: 'https://vaulteryx.io/' })
    const ohneVertrag = { ...fakten, vertragAufSeite: 'fehlt', cashtags: [], titelCashtags: [], handelsLinks: 0, titel: 'Research notes' }
    // Unbelegt, aber nicht erkennbar fremd (junge Domain, Startseite): kein Plus, aber auch kein Abzug dafür.
    const offen = bewerteProjekt({ token: { symbol: 'QPS', name: 'Quantum Proof' },
        webseite: { status: 'ok', host: 'qps.xyz', url: 'https://qps.xyz/', fakten: ohneVertrag, domainAlterTage: 90 } })
    p('unbelegte Seite: keine Pluspunkte für Text und Abschnitte',
        !has(offen, 'vielText') && !has(offen, 'abschnitte') && !has(offen, 'domainAlt') && !has(offen, 'keineWebseite'))
    p('… und das wird gesagt', has(offen, 'seiteOhneBeleg'))
    const frischUnbelegt = bewerteProjekt({ token: { symbol: 'QPS' }, webseite: { status: 'ok', host: 'qps.xyz', url: 'https://qps.xyz/', fakten: { ...ohneVertrag, woerter: 30 }, domainAlterTage: 0.5 } })
    p('Abzüge gelten auch für eine unbelegte Seite', has(frischUnbelegt, 'domainNeu') && has(frischUnbelegt, 'kaumText'))

    /*
     * Erkennbar fremde Seiten kosten wie keine Webseite — sonst stünde ein
     * Token, der einen fremden Artikel angibt, besser da als einer ohne Seite.
     * Fälle aus dem Bestand vom 10.10.2026.
     */
    const artikel = bewerteProjekt({ token: { symbol: 'IRIS', name: 'Iris' },
        webseite: { status: 'ok', host: 'world.org', url: 'https://world.org/blog/engineering/open-sourcing-worldcoin-iris', fakten: { ...ohneVertrag, titel: 'Open sourcing the Worldcoin iris recognition pipeline' }, domainAlterTage: 3000 } })
    p('Blogartikel einer fremden Seite: keine eigene Webseite (war Note 100)', has(artikel, 'keineWebseite') && /Beitrag/.test(artikel.befunde.find((x) => x.schluessel === 'keineWebseite').text)
        && !has(artikel, 'domainSehrAlt') && !has(artikel, 'vielText'), String(artikel.note))
    const marke = bewerteProjekt({ token: { symbol: 'WEBULL', name: 'Webull' },
        webseite: { status: 'ok', host: 'webull.com', url: 'https://webull.com', fakten: { ...ohneVertrag, titel: 'Invest Confidently with Webull' }, domainAlterTage: 4000 } })
    p('alte Markenseite ohne Token-Bezug: fremde Seite (war Note 85)', has(marke, 'keineWebseite') && /registriert/.test(marke.befunde.find((x) => x.schluessel === 'keineWebseite').text))
    const kopierteSeite = bewerteProjekt({ token: { symbol: 'BELIEVE', name: 'Believe' },
        webseite: { status: 'ok', host: 'spx6900.com', url: 'https://www.spx6900.com', fakten: { ...ohneVertrag, nurSkript: true, titel: 'SPX6900 ($SPX) is the meme coin', titelCashtags: ['spx'] }, domainAlterTage: 600 } })
    p('Seite eines anderen Tokens laut Titel: Abzug wie ein fremder Vertrag', has(kopierteSeite, 'seiteAndererToken') && kopierteSeite.note === 25, String(kopierteSeite.note))
    // Gegenproben
    const eigenerTitel = seitenBeleg({ status: 'ok', host: 'spx6900.com', url: 'https://www.spx6900.com', fakten: { ...ohneVertrag, titel: 'SPX6900 ($SPX)', titelCashtags: ['spx'], cashtags: ['spx'] } }, { symbol: 'SPX', name: 'SPX6900' })
    p('der eigene Cashtag im Titel ist kein anderer Token', eigenerTitel.eigen === true && eigenerTitel.fremd === '')
    const sol = seitenBeleg({ status: 'ok', host: 'qps.xyz', url: 'https://qps.xyz/', fakten: { ...ohneVertrag, titel: 'Pay in $SOL', titelCashtags: ['sol'] } }, { symbol: 'QPS' })
    p('„$SOL" im Titel macht die Seite nicht zu einer fremden', sol.fremd === '')
    p('Pfadtiefe: Startseite, Sprache, Unterseite, Artikel',
        pfadTiefe('https://a.io/') === 0 && pfadTiefe('https://a.io/en/') === 0 && pfadTiefe('https://a.io/token') === 1
        && pfadTiefe('https://a.io/slang/41') === 2 && pfadTiefe('https://a.io/why-this-cat-will-change-everything') === 2)

    const geteiltOhne = bewerteProjekt({ token: { symbol: 'TOOTIN', name: 'Darn Tootin' },
        webseite: { status: 'ok', host: 'tootincoin.money', geteilt: 4, domainAlterTage: 400,
            fakten: { ...fakten, vertragAufSeite: 'fehlt', titel: "Darn Tootin' ($TOOTIN)", cashtags: ['tootin'] } } })
    p('geteilte Seite ohne Vertrag: Abzug, kein Domain- oder Textbonus',
        has(geteiltOhne, 'seiteGeteilt') && geteiltOhne.befunde.find((x) => x.schluessel === 'seiteGeteilt').art === 'minus'
        && !has(geteiltOhne, 'domainAlt') && !has(geteiltOhne, 'vielText'))
    const original = bewerteProjekt({ webseite: { status: 'ok', host: 'vaulteryx.io', geteilt: 4, domainAlterTage: 400, fakten } })
    p('geteilte Seite MIT Vertrag: das Original behält seine Pluspunkte',
        original.befunde.find((x) => x.schluessel === 'seiteGeteilt')?.art === 'info' && has(original, 'domainAlt') && has(original, 'vertragPasst'))

    const ghFremd = bewerteProjekt({ github: { beleg: false, repo: { name: 'AnyPS5', alterTage: 400, letzterPushTage: 2, sterne: 900, istFork: false },
        konto: { name: 'boykopovar', alterTage: 3000 }, fruehereProjekte: [{ name: 'x', sterne: 300 }] } })
    p('fremdes GitHub: weder Code- noch Projektbonus', !has(ghFremd, 'githubRepo') && !has(ghFremd, 'githubGepflegt') && !has(ghFremd, 'githubFruehere'))
    p('… und das wird gesagt', has(ghFremd, 'githubOhneBeleg') && ghFremd.note === 50)
    const ghFork = bewerteProjekt({ github: { beleg: false, repo: { name: 'x', istFork: true }, fruehereProjekte: [] } })
    p('ein Fork kostet auch ohne Beleg', has(ghFork, 'githubFork'))

    const unpr = bewerteProjekt({ webseite: { status: 'unpruefbar', fehler: 'keine Antwort innerhalb der Zeitgrenze' } })
    p('nicht prüfbare Seite: kein Abzug, keine Note', unpr.note === null && has(unpr, 'webseiteUnpruefbar'))
    const verworfen = bewerteProjekt({ kanaele: {}, kanaeleVerworfen: [{ art: 'x', grund: 'beitrag' }, { art: 'telegram', grund: 'bot' }] })
    p('verworfene Kanal-Links werden benannt', verworfen.befunde.filter((x) => x.schluessel === 'kanalVerworfen').length === 2
        && has(verworfen, 'keineKanaele'))
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
