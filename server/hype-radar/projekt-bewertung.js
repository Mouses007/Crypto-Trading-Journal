/**
 * Hype-Radar, Projektprüfung — die reine Rechnung.
 *
 * Die Hype-Note misst Aufmerksamkeit, die Sicherheitsnote den Vertrag. Beide
 * sagen nichts darüber, ob hinter einem Token ein PROJEKT steht: eine Seite mit
 * Inhalt, ein Team mit Vorgeschichte, Code, der älter ist als der Token. Diese
 * Datei beantwortet genau das — als dritte, getrennte Note („Substanz") mit
 * nachlesbaren Befunden, nicht verrechnet mit den beiden anderen. Eine Zahl,
 * die drei verschiedene Fragen mittelt, beantwortet keine davon.
 *
 * Rein: HTML, RDAP- und GitHub-Antworten hinein, Fakten und Befunde heraus.
 * Kein Netz, keine Datenbank — das Abrufen steht in `projekt.js`. So lässt
 * sich jede Regel mit festen Beispieldaten prüfen.
 *
 * Grundsatz wie überall im Radar: UNBEKANNT ist nicht gut und nicht schlecht.
 * Eine Webseite, die gerade nicht antwortet, ist kein Beweis für Betrug; eine
 * Seite, die nur aus Skript besteht, ist nicht „ohne Inhalt", sondern ohne
 * Browser nicht lesbar. Beides wird so benannt und nicht als Abzug verbucht.
 *
 * Zweiter Grundsatz, seit dem 10.10.2026: Pluspunkte gibt es nur für eine
 * Seite, die nachweislich ZUM TOKEN GEHÖRT. Gemessen am Bestand: 79 von 345
 * gelesenen „Webseiten" waren ein Tweet, ein TikTok-Video, ein fremdes
 * GitHub-Repository oder die Handelsseite des Tokens, 72 davon bekamen den
 * Bonus für das Domain-Alter (x.com ist seit 1993 registriert). 54 weitere
 * zeigten die Coin-Seite einer ANDEREN Adresse — 25 davon mit demselben
 * Symbol, also die kopierten Angaben des Originals. Ein Meme-Token verlinkt
 * die Geschichte, um die es geht, oder den Coin, den es nachahmt; die Seite
 * sagt dann etwas über die Geschichte, nichts über den Token.
 */

/**
 * Regelstand. Eine gespeicherte Prüfung mit anderem Stand gilt als abgelaufen —
 * sonst stünden nach einer Regeländerung bis zu einen Tag lang Noten nach den
 * alten Regeln neben solchen nach den neuen.
 */
export const PROJEKT_REGELN = 2

// ── Webseite ────────────────────────────────────────────────────────────

/** Plattformen, auf denen eine Seite in Minuten und gratis steht. */
const GRATIS_PLATTFORMEN = [
    'carrd.co', 'linktr.ee', 'linktree.com', 'vercel.app', 'netlify.app', 'github.io', 'pages.dev',
    'web.app', 'firebaseapp.com', 'notion.site', 'wixsite.com', 'webflow.io', 'framer.website',
    'framer.ai', 'framer.app', 'replit.app', 'glitch.me', 'onrender.com', 'herokuapp.com',
    'blogspot.com', 'wordpress.com', 'super.site', 'beacons.ai', 'taplink.cc', 'bio.link',
    'gitbook.io', 'mystrikingly.com', 'weebly.com', 'site123.me', 'godaddysites.com',
    // Seitenbaukasten für Token: jede Seite eine Unterdomain (gesehen 10.10.2026, sieben Token)
    'mintfactory.xyz',
]

/*
 * Hosts, die nie die eigene Seite eines Tokens sind — Kanäle, Beiträge, Code
 * und Handelsplätze. Eine Seite dort gehört dem, der sie geschrieben hat.
 * Absichtlich KEINE Liste von Launchpads und Token-Verzeichnissen: davon
 * entstehen jede Woche neue, und die drei Regeln dahinter (Adresse im Pfad,
 * Sammelseite, von mehreren Token geteilt) erkennen sie ohne Namen.
 */
const FREMDE_PLATTFORMEN = {
    kanal: [
        'x.com', 'twitter.com', 't.me', 'telegram.me', 'telegram.org', 'discord.gg', 'discord.com',
        'tiktok.com', 'youtube.com', 'youtu.be', 'instagram.com', 'facebook.com', 'fb.com', 'reddit.com',
        'threads.net', 'threads.com', 'warpcast.com', 'farcaster.xyz', 'truthsocial.com', 'bsky.app',
        'kick.com', 'twitch.tv', 'linkedin.com', 'snapchat.com', 'pinterest.com', 'imgur.com', 'giphy.com',
    ],
    beitrag: ['medium.com', 'substack.com', 'mirror.xyz', 'paragraph.xyz', 'wikipedia.org', 'knowyourmeme.com'],
    code: ['github.com', 'gitlab.com', 'bitbucket.org', 'huggingface.co', 'npmjs.com', 'pypi.org'],
    handel: [
        'pump.fun', 'dexscreener.com', 'dextools.io', 'birdeye.so', 'gmgn.ai', 'axiom.trade', 'padre.gg',
        'tinyastro.io', 'bullx.io', 'jup.ag', 'raydium.io', 'meteora.ag', 'orca.so', 'solscan.io',
        'solana.fm', 'explorer.solana.com', 'etherscan.io', 'bscscan.com', 'basescan.org', 'arbiscan.io',
        'polygonscan.com', 'coingecko.com', 'coinmarketcap.com', 'geckoterminal.com', 'moonshot.money',
        'letsbonk.fun', 'bonk.fun', 'believe.app', 'bags.fm', 'four.meme', 'clanker.world', 'zora.co',
        'uniswap.org', 'pancakeswap.finance', 'rugcheck.xyz', 'bubblemaps.io', 'defined.fi', 'ave.ai',
        'debank.com', 'magiceden.io', 'tensor.trade', 'opensea.io', 'sunpump.meme',
    ],
}

/** Wie die Befunde die Art der fremden Plattform nennen. */
const PLATTFORM_TEXT = {
    kanal: 'nur ein Beitrag oder Konto in einem sozialen Netz',
    beitrag: 'nur ein Artikel',
    code: 'nur ein Code-Repository',
    handel: 'nur eine Handels- oder Explorer-Seite',
}

/** Zweistufige öffentliche Endungen — dort ist die Domain drei Teile lang. */
const ZWEISTUFIG = new Set([
    'co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'com.br', 'com.cn',
    'com.sg', 'com.hk', 'co.in', 'com.tr', 'com.mx', 'co.za', 'com.ar', 'co.kr', 'com.tw',
])

const ohneWww = (host) => String(host || '').toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
const passtZu = (h, p) => h === p || h.endsWith(`.${p}`)

/** Host einer Adresse, klein und ohne „www." — '' wenn keine gültige Adresse. */
export function hostVon(url) {
    try { return ohneWww(new URL(String(url || '')).hostname) } catch { return '' }
}

/**
 * Die registrierbare Domain eines Hosts („app.foo.co.uk" → „foo.co.uk").
 * Für das Domain-Alter zählt die Registrierung, nicht die Unterdomain.
 */
export function registrierbareDomain(host) {
    const teile = ohneWww(host).split('.').filter(Boolean)
    if (teile.length < 2) return ''
    const letzteZwei = teile.slice(-2).join('.')
    if (ZWEISTUFIG.has(letzteZwei) && teile.length >= 3) return teile.slice(-3).join('.')
    return letzteZwei
}

/**
 * Liegt die Seite auf einer Gratis-Plattform? Dann sagt das Alter der Domain
 * nichts — `vercel.app` ist Jahre alt, die Seite darauf vielleicht eine Stunde.
 *
 * @returns {string} die Plattform, oder '' wenn eigene Domain
 */
export function gratisPlattform(host) {
    const h = ohneWww(host)
    return GRATIS_PLATTFORMEN.find((p) => passtZu(h, p)) || ''
}

/**
 * Liegt die Adresse auf einer fremden Plattform (Kanal, Beitrag, Code, Handel)?
 * @returns {{plattform:string, art:string}|null}
 */
export function fremdePlattform(host) {
    const h = ohneWww(host)
    for (const [art, liste] of Object.entries(FREMDE_PLATTFORMEN)) {
        const p = liste.find((x) => passtZu(h, x))
        if (p) return { plattform: p, art }
    }
    return null
}

/** Handelsplatz oder Explorer — ein Link dorthin zeigt Token-Bezug. */
const istHandelsplatz = (host) => fremdePlattform(host)?.art === 'handel'

const EVM_ADRESSE = /\b0x[a-fA-F0-9]{40}\b/g
const SOL_ADRESSE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g

/*
 * Eine Solana-Adresse ist Base58 und damit von einem langen Wort nicht zu
 * unterscheiden — ausser daran, dass sie Gross- und Kleinbuchstaben UND
 * Ziffern mischt. Ein Pfadstück wie „quantumproofingsolanaresearch" tut das
 * nicht; eine echte Adresse fast immer (die Wahrscheinlichkeit, dass 32
 * zufällige Base58-Zeichen keine Ziffer enthalten, liegt unter 1 %).
 */
const istSolAdresse = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s) && /[1-9]/.test(s)
const istEvmAdresse = (s) => /^0x[a-fA-F0-9]{40}$/.test(s)
const gleicheAdresse = (a, b) => (istEvmAdresse(a) ? a.toLowerCase() === String(b).toLowerCase() : a === b)

/** Die erste Vertragsadresse im PFAD einer URL (Coin-Seiten: `/coin/<adresse>`). */
export function adresseImPfad(url) {
    let u
    try { u = new URL(String(url || '')) } catch { return '' }
    return u.pathname.split('/').map((t) => decodeURIComponentSicher(t)).find((t) => istSolAdresse(t) || istEvmAdresse(t)) || ''
}

function decodeURIComponentSicher(t) {
    try { return decodeURIComponent(t) } catch { return t }
}

/**
 * Was für eine Adresse ist die angegebene Webseite — BEVOR sie abgerufen wird?
 *
 *   plattform     x.com, TikTok, GitHub, pump.fun, DexScreener …
 *   tokenSeite    die Seite DIESES Tokens auf irgendeiner Plattform (eigene Adresse im Pfad)
 *   fremderToken  die Seite einer ANDEREN Adresse (gemessen: 37 von 54 waren Token,
 *                 25 mit demselben Symbol — die Angaben des Originals, kopiert)
 *   ungueltig     keine lesbare Adresse
 *   ''            eine Seite, die geprüft werden muss
 *
 * @returns {{grund:string, host:string, plattform?:string, art?:string, adresse?:string}}
 */
export function ordneWebseite(url, contract = '') {
    const host = hostVon(url)
    if (!host) return { grund: 'ungueltig', host: '' }
    const fremd = fremdePlattform(host)
    if (fremd) return { grund: 'plattform', host, ...fremd }
    const adresse = adresseImPfad(url)
    if (adresse) {
        return { grund: contract && gleicheAdresse(adresse, contract) ? 'tokenSeite' : 'fremderToken', host, adresse }
    }
    return { grund: '', host }
}

/*
 * Kennungen von X, die kein Konto sind, und Telegram-Konten, die ein Bot sind.
 * Der Handelsbot mit Werbe-Code (`t.me/…bot?start=r-…`) ist bei Meme-Coins
 * häufig als „Telegram" eingetragen — eine Gemeinschaft ist er nicht.
 */
const X_KEIN_KONTO = new Set(['search', 'hashtag', 'home', 'explore', 'intent', 'share', 'messages',
    'notifications', 'settings', 'compose', 'login', 'signup', 'i'])

/**
 * Ein Kanal-Link, eingeordnet: Welcher Dienst, und ist er ein KANAL des Tokens?
 *
 * Ein Link auf einen einzelnen Beitrag (`x.com/…/status/…`) ist keiner: pump.fun
 * trägt im Feld „twitter" oft den Tweet ein, um den es beim Coin geht — das
 * Konto dahinter gehört dem, der getwittert hat.
 *
 * @returns {{art:''|'x'|'telegram'|'discord'|'github', gueltig:boolean, grund:string}}
 */
export function kanalAus(url) {
    let u
    try { u = new URL(String(url || '')) } catch { return { art: '', gueltig: false, grund: 'ungueltig' } }
    const h = ohneWww(u.hostname).replace(/^mobile\./, '')
    const teile = u.pathname.split('/').filter(Boolean)
    if (/^(x|twitter)\.com$/.test(h)) {
        if (teile[0] === 'i' && teile[1] === 'communities' && teile[2]) return { art: 'x', gueltig: true, grund: 'gemeinschaft' }
        if (!teile.length || X_KEIN_KONTO.has(teile[0].toLowerCase())) return { art: 'x', gueltig: false, grund: 'keinKonto' }
        if (teile[1] === 'status') return { art: 'x', gueltig: false, grund: 'beitrag' }
        return { art: 'x', gueltig: true, grund: 'konto' }
    }
    if (/^(t|telegram)\.me$/.test(h)) {
        if (!teile.length) return { art: 'telegram', gueltig: false, grund: 'keinKonto' }
        const name = teile[0] === 's' && teile[1] ? teile[1] : teile[0]
        if (/bot$/i.test(name)) return { art: 'telegram', gueltig: false, grund: 'bot' }
        return { art: 'telegram', gueltig: true, grund: 'kanal' }
    }
    if (/^discord\.(gg|com)$/.test(h)) {
        return teile.length ? { art: 'discord', gueltig: true, grund: 'einladung' } : { art: 'discord', gueltig: false, grund: 'keinKonto' }
    }
    if (h === 'github.com') return { art: 'github', gueltig: Boolean(githubZiel(url)), grund: 'code' }
    return { art: '', gueltig: false, grund: 'unbekannt' }
}

/** HTML-Entitäten, die in Fliesstext tatsächlich vorkommen. */
const ENTITAETEN = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

function entitaeten(text) {
    return text
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&([a-z0-9#]+);/gi, (m, n) => ENTITAETEN[n.toLowerCase()] ?? m)
}

/** Sichtbarer Text: ohne Skripte, Stile, SVG, Kommentare und Tags. */
export function sichtbarerText(html) {
    return entitaeten(String(html || '')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|section|article|header|footer)>/gi, '\n')
        .replace(/<[^>]+>/g, ' '))
        .replace(/[ \t\r\f\v]+/g, ' ')
        .replace(/\n\s*/g, '\n')
        .trim()
}

const metaInhalt = (html, name) => {
    const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, 'i')
    const tag = String(html).match(re)?.[0] || ''
    return entitaeten(tag.match(/content=["']([^"']*)["']/i)?.[1] || '').trim()
}

/** Alle `href`-Ziele einer Seite, absolut gemacht. */
function verweise(html, basis) {
    const raus = []
    for (const m of String(html).matchAll(/<a\b[^>]*\bhref=["']([^"'#][^"']*)["']/gi)) {
        try { raus.push(new URL(entitaeten(m[1]), basis || undefined).toString()) } catch { /* kaputter Link */ }
    }
    return raus
}

/*
 * Stichwörter der Abschnitte, die eine ernst gemeinte Projektseite trägt.
 * Mehrsprachig nur dort, wo es in dieser Ecke vorkommt (Englisch dominiert).
 *
 * `produkt` war bis 10.10.2026 mit „platform", „protocol", „product", „beta",
 * „dashboard" und „api" besetzt — Wörter, die auf jeder Seite stehen, auch auf
 * der eines Meme-Coins („the first meme protocol"). Jetzt nur noch, was auf
 * eine benutzbare Anwendung zeigt.
 */
const ABSCHNITTE = {
    roadmap: /\b(roadmap|milestones?|phase\s*[1-4]|q[1-4]\s*20\d\d)\b/i,
    tokenomics: /\b(tokenomics|token\s*distribution|allocation|total\s*supply|vesting)\b/i,
    team: /\b(our\s*team|the\s*team|core\s*team|founders?|co-?founder|team\s*members?|meet\s*the\s*team)\b/i,
    audit: /\b(audit(ed)?\s*by|security\s*audit|certik|hacken|solidproof|peckshield|trail\s*of\s*bits)\b/i,
    whitepaper: /\b(white\s*paper|litepaper|documentation|docs)\b/i,
    produkt: /\b(launch\s*(the\s*)?app|open\s*(the\s*)?app|enter\s*(the\s*)?app|go\s*to\s*app|use\s*the\s*app|dapp|testnet|mainnet\s*(is\s*)?(live|launch)|sdk|api\s*(docs|reference)|developer\s*docs)\b/i,
}

/*
 * Was eine Platzhalter- oder Vorlagenseite verrät. Jedes Muster für sich ist
 * ein starkes Zeichen, dass niemand an der Seite gearbeitet hat.
 */
const PLATZHALTER = /\b(lorem\s+ipsum|coming\s+soon|under\s+construction|your\s+(token|coin)\s+name|insert\s+(text|contract)|ca:\s*(soon|tba|tbd)|contract\s*(address)?:\s*(soon|tba|tbd|coming))\b/i

/** Baukästen, deren Kennung im HTML steht — Linkseiten statt Projektseiten. */
const BAUKASTEN = [
    ['carrd', /carrd\.co|class=["'][^"']*\bcarrd\b/i],
    ['linktree', /linktr\.ee|linktree/i],
    ['taplink', /taplink/i],
    ['beacons', /beacons\.ai/i],
]

/** Ein Etikett, das eine Vertragsadresse ankündigt. */
// Bewusst NICHT das blosse „address": „Team wallet address: …" ist keine
// Aussage über den Token.
const CA_ETIKETT = /\b(ca|contract(\s*address)?|token\s*address|mint(\s*address)?)\s*[:：-]?\s*$/i

/**
 * Ab so vielen verschiedenen Vertragsadressen ist eine Seite eine Sammel- oder
 * Handelsseite. Gemessen 10.10.2026: eine Projektseite (pepe.vip) nennt eine,
 * eine mit Paar und Kassen-Wallets eine Handvoll; jup.ag 29, die Marktliste
 * eines Launchpads (born.fun) 121. Dort „steht der Vertrag auf der Seite" für
 * jeden Token der Liste — sieben verschiedene Token bekamen dafür Pluspunkte.
 */
export const SAMMEL_AB = 12

/**
 * Vertragsadressen, die die Seite als SOLCHE nennt (mit Etikett davor).
 *
 * Nicht jede Adresse im Text: Projektseiten verlinken DexScreener-Paare,
 * Gründer-Wallets und Kassen — die Paaradresse ist nicht der Token. Nur was
 * hinter „CA:", „Contract:" oder „Token address" steht, ist eine Aussage.
 */
function genannteVertraege(text) {
    const raus = []
    for (const re of [EVM_ADRESSE, SOL_ADRESSE]) {
        for (const m of text.matchAll(re)) {
            const davor = text.slice(Math.max(0, m.index - 40), m.index)
            if (CA_ETIKETT.test(davor)) raus.push(m[0])
        }
    }
    return raus
}

/**
 * Wie viele verschiedene Vertragsadressen das HTML enthält — samt Zustand im
 * Skript (`__NEXT_DATA__`), denn dort steht bei einer App die Token-Liste.
 * Eingebettete Bilder (`data:…;base64,…`) zuerst heraus: Base64 enthält
 * Base58-artige Stücke in beliebiger Zahl.
 */
function zaehleAdressen(roh) {
    const ohneBilder = roh.replace(/data:[a-z0-9.+/-]+;base64,[A-Za-z0-9+/=]+/gi, ' ')
    const sol = new Set((ohneBilder.match(SOL_ADRESSE) || []).filter(istSolAdresse))
    const evm = new Set((ohneBilder.match(EVM_ADRESSE) || []).map((a) => a.toLowerCase()))
    return sol.size + evm.size
}

/**
 * Eine Projektseite lesen.
 *
 * @param {string} html
 * @param {object} kontext  {contract, url}
 * @returns {object} Fakten, alle beobachtbar und ohne Wertung
 */
export function leseWebseite(html, { contract = '', url = '' } = {}) {
    const roh = String(html || '')
    const text = sichtbarerText(roh)
    const woerter = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length
    const links = verweise(roh, url)
    const host = hostVon

    const kanal = (muster) => [...new Set(links.filter((l) => muster.test(host(l))))].slice(0, 5)
    const kanaele = {
        x: kanal(/^(x|twitter)\.com$/),
        telegram: kanal(/^(t\.me|telegram\.me)$/),
        discord: kanal(/^(discord\.gg|discord\.com)$/),
        github: kanal(/^github\.com$/),
        medium: kanal(/(^|\.)medium\.com$/),
        docs: [...new Set(links.filter((l) => /^docs\.|gitbook\.io$|\/docs\b|whitepaper|litepaper|\.pdf$/i.test(`${host(l)}${(() => { try { return new URL(l).pathname } catch { return '' } })()}`)))].slice(0, 5),
    }

    const abschnitte = Object.fromEntries(Object.entries(ABSCHNITTE).map(([k, re]) => [k, re.test(text)]))
    // Ein Link auf Doku oder Whitepaper zählt wie der Abschnitt selbst.
    if (kanaele.docs.length) abschnitte.whitepaper = true

    /*
     * Reine Skript-Hülle: Eine React- oder Vue-Seite schickt fast keinen Text
     * und baut alles im Browser. „Kaum Text" wäre dort eine falsche Aussage —
     * ohne Browser ist der Inhalt schlicht nicht lesbar.
     */
    const skripte = (roh.match(/<script\b/gi) || []).length
    const nurSkript = woerter < 60
        && (/<div[^>]+id=["'](root|app|__next|__nuxt)["']/i.test(roh) || skripte >= 3)

    const adressen = zaehleAdressen(roh)
    const sammelseite = adressen >= SAMMEL_AB

    const genannt = genannteVertraege(text)
    const vertrag = String(contract || '')
    let vertragAufSeite = 'fehlt'
    if (sammelseite) {
        // Auf einer Liste vieler Token steht jeder Vertrag — das belegt nichts.
        vertragAufSeite = 'sammel'
    } else if (vertrag && (roh.includes(vertrag) || (vertrag.startsWith('0x') && roh.toLowerCase().includes(vertrag.toLowerCase())))) {
        vertragAufSeite = 'passt'
    } else if (vertrag && genannt.length && !genannt.some((a) => gleicheAdresse(a, vertrag))) {
        vertragAufSeite = 'fremd'
    }

    const jahre = [...text.matchAll(/(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)]
        .map((m) => Number(m[1])).filter((j) => j >= 2009 && j <= 2100)

    const titel = entitaeten((roh.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim()).slice(0, 200)
    const beschreibung = (metaInhalt(roh, 'description') || metaInhalt(roh, 'og:description')).slice(0, 400)
    // „$SYMBOL" in Titel, Beschreibung oder Text — klein geschrieben, ohne „$".
    const cashtagsIn = (t) => [...new Set([...String(t).matchAll(/(?:^|[^\w$])\$([A-Za-z][A-Za-z0-9]{1,14})\b/g)]
        .map((m) => m[1].toLowerCase()))].slice(0, 20)
    const cashtags = cashtagsIn(`${titel} ${beschreibung} ${text}`)

    return {
        titel,
        beschreibung,
        woerter,
        nurSkript,
        textAuszug: text.slice(0, 2500),
        kanaele,
        abschnitte,
        platzhalter: PLATZHALTER.test(text),
        baukasten: BAUKASTEN.find(([, re]) => re.test(roh))?.[0] || '',
        vertragAufSeite,
        fremdeVertraege: vertragAufSeite === 'fremd' ? [...new Set(genannt)].slice(0, 3) : [],
        adressen,
        sammelseite,
        cashtags,
        // Im TITEL kündigt eine Seite an, wessen Seite sie ist — „SPX6900 ($SPX)".
        titelCashtags: cashtagsIn(titel),
        handelsLinks: new Set(links.map(host).filter(istHandelsplatz)).size,
        copyrightJahr: jahre.length ? Math.max(...jahre) : null,
    }
}

// ── Gehört die Seite zum Token? ─────────────────────────────────────────

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * Nennt die Seite den Token in Domain oder Titel?
 *
 * Name und Symbol ab drei Zeichen. Vier und mehr dürfen irgendwo in einem
 * Domain-Teil oder im Titel stehen; drei nur am Anfang oder Ende eines
 * Domain-Teils oder als eigenes Wort im Titel — sonst stünde „CAT" in
 * „education".
 */
export function nenntToken({ host = '', titel = '' } = {}, { symbol = '', name = '' } = {}) {
    const marken = [...new Set([symbol, name].map(norm).filter((m) => m.length >= 3))]
    if (!marken.length) return false
    const teile = ohneWww(host).split('.').slice(0, -1).map(norm).filter(Boolean)
    const titelNorm = norm(titel)
    const titelWoerter = new Set(String(titel || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).map(norm).filter(Boolean))
    return marken.some((m) => (m.length >= 4
        ? teile.some((t) => t.includes(m)) || titelNorm.includes(m)
        : teile.some((t) => t.startsWith(m) || t.endsWith(m)) || titelWoerter.has(m)))
}

/** Sprachkennungen am Pfadanfang zählen nicht als Tiefe („/en/", „/zh-cn/"). */
const SPRACHE = /^[a-z]{2}(-[a-z]{2,4})?$/i

/**
 * Wie tief eine Adresse in eine Seite führt. Eine Projektseite ist die
 * Startseite; `/blog/…`, `/wiki/Q`, `/slang/41`, `/research/…` ist ein
 * Beitrag auf der Seite eines anderen. Ein einzelnes Pfadstück zählt doppelt,
 * wenn es ein Artikeltitel ist (drei Bindestriche oder 25 Zeichen).
 */
export function pfadTiefe(url) {
    let u
    try { u = new URL(String(url || '')) } catch { return 0 }
    const teile = u.pathname.split('/').filter(Boolean).map(decodeURIComponentSicher)
    if (teile.length && SPRACHE.test(teile[0])) teile.shift()
    const rest = teile.filter((t) => !/^(index\.html?|home)$/i.test(t))
    if (rest.length === 1 && ((rest[0].match(/-/g) || []).length >= 3 || rest[0].length >= 25)) return 2
    return rest.length
}

/** Ab so vielen Jahren ist eine Domain älter als jeder Token, der sie heute angibt. */
const ALTE_DOMAIN_TAGE = 730

/*
 * Cashtags, die auf fast jeder Krypto-Seite stehen, ohne dass sie der Seite
 * gehören — „pay in $SOL" macht eine Seite nicht zur Seite von Solana.
 */
const ALLERWELTS_CASHTAGS = new Set(['sol', 'btc', 'eth', 'usdc', 'usdt', 'bnb', 'weth', 'wbtc', 'wsol', 'usd', 'base'])

/**
 * Ist belegt, dass die gelesene Seite die des Tokens ist — oder dass sie es
 * NICHT ist?
 *
 *   vertrag  der Vertrag steht auf der Seite (und sie ist keine Sammelseite)
 *   name     Name oder Symbol in Domain oder Titel UND ein Token-Bezug auf der
 *            Seite: „$SYMBOL" oder ein Link auf einen Handelsplatz. Der Name
 *            allein genügt nicht — ein Token namens NETFLIX, der netflix.com
 *            angibt, hätte sonst die älteste Domain und den meisten Text.
 *
 * Ohne Beleg sagt `fremd`, ob die Seite erkennbar einem anderen gehört:
 *
 *   andererToken  der Titel wirbt für einen anderen Token („SPX6900 ($SPX)")
 *   beitrag       ein einzelner Beitrag tief in einer fremden Seite
 *   alteSeite     die Domain ist Jahre älter als jeder Token, der sie heute
 *                 angibt — eine Marke oder ein Verlag (nvidia.com, webull.com)
 *
 * Gemessen am Bestand vom 10.10.2026, an den 48 lesbaren Seiten ohne jeden
 * Bezug zum Token: ein Worldcoin-Blogartikel (Note 100), ein Wörterbucheintrag,
 * eine ICANN-Antragsseite, ein Netflix-Artikel, eine Börsenstatistik. Ohne
 * `fremd` stünde ein Token, der einen fremden Artikel angibt, besser da als
 * einer ohne Webseite — er bekäme keinen Abzug, der andere fünfzehn.
 *
 * Eine Seite, die mehrere Token nennen (`geteilt`), ist nur über den Vertrag
 * belegt — Nachahmer kopieren den Namen mit.
 *
 * @returns {{eigen:boolean, wie:''|'vertrag'|'name', fremd:''|'andererToken'|'beitrag'|'alteSeite', anderer?:string}}
 */
export function seitenBeleg(w = {}, token = {}) {
    const s = w?.fakten
    if (w?.status !== 'ok' || !s || s.sammelseite) return { eigen: false, wie: '', fremd: '' }
    if (s.vertragAufSeite === 'passt') return { eigen: true, wie: 'vertrag', fremd: '' }
    const sym = norm(token.symbol)
    if (s.vertragAufSeite !== 'fremd' && !(Number(w.geteilt) > 0)) {
        const bezug = (sym && (s.cashtags || []).includes(sym)) || Number(s.handelsLinks) > 0
        if (bezug && nenntToken({ host: w.host, titel: s.titel }, token)) return { eigen: true, wie: 'name', fremd: '' }
    }
    const anderer = (s.titelCashtags || []).find((c) => c !== sym && !ALLERWELTS_CASHTAGS.has(c))
    if (sym && anderer && !(s.titelCashtags || []).includes(sym)) return { eigen: false, wie: '', fremd: 'andererToken', anderer }
    if (pfadTiefe(w.url) >= 2) return { eigen: false, wie: '', fremd: 'beitrag' }
    if (Number(w.domainAlterTage) > ALTE_DOMAIN_TAGE) return { eigen: false, wie: '', fremd: 'alteSeite' }
    return { eigen: false, wie: '', fremd: '' }
}

// ── Abruffehler ─────────────────────────────────────────────────────────

/**
 * Ein gescheiterter Abruf, eingeordnet: tot, geschützt oder nicht prüfbar.
 *
 * Nur was eindeutig „diese Seite gibt es nicht" sagt, kostet Punkte — 404 und
 * 410, ein Serverfehler nach zwei Anläufen, ein Name, den es nicht gibt, ein
 * Server, der die Verbindung verweigert. Alles andere hängt am eigenen Netz
 * oder an der eigenen Grenze: Zeitüberschreitung, zu grosse Seite, Zertifikat,
 * das Node strenger prüft als ein Browser, und 0.0.0.0 — so antwortet ein
 * DNS-Filter im eigenen Netz (zehn Seiten am 10.10.2026). Bis dahin kostete
 * jedes davon zehn Punkte.
 *
 * „Name gibt es nicht" (ENOTFOUND) zählt nur mit Gegenprobe: Im Lauf vom
 * 10.10.2026 meldete die Namensauflösung über systemd-resolved für
 * www.tootincoin.money und blueshift.gg zweimal ENOTFOUND, eine Minute später
 * antworteten beide. `nxdomain` ist das Urteil eines unabhängigen Resolvers
 * (DNS über HTTPS): true = gibt es wirklich nicht, false = gibt es, null =
 * Gegenprobe gescheitert.
 *
 * @param {Error} e  aus `net-guard.holeText` (mit `status`, `code`, `art`)
 * @param {object} gegenprobe  {nxdomain: true|false|null}
 * @returns {{status:'fehler'|'geschuetzt'|'unpruefbar', fehler:string}}
 */
export function ordneAbruffehler(e = {}, { nxdomain = null } = {}) {
    const status = Number(e?.status) || 0
    const code = String(e?.code || e?.cause?.code || '')
    const text = String(e?.message || e || '')
    if ([401, 403, 429, 503].includes(status)) return { status: 'geschuetzt', fehler: `HTTP ${status}` }
    if (status === 404 || status === 410 || status >= 500) return { status: 'fehler', fehler: `HTTP ${status}` }
    if (status) return { status: 'unpruefbar', fehler: `HTTP ${status}` }
    if (e?.adresse === '0.0.0.0' || /\(0\.0\.0\.0\)/.test(text)) {
        return { status: 'unpruefbar', fehler: 'Domain zeigt auf 0.0.0.0 — von einem DNS-Filter gesperrt oder abgeschaltet' }
    }
    if (e?.art === 'dns' && code === 'ENOTFOUND') {
        if (nxdomain === true) return { status: 'fehler', fehler: 'Domain existiert nicht' }
        return {
            status: 'unpruefbar',
            fehler: nxdomain === false ? 'Namensauflösung hier gescheitert, die Domain existiert aber' : 'Namensauflösung gescheitert, Gegenprobe nicht möglich',
        }
    }
    if (code === 'ECONNREFUSED') return { status: 'fehler', fehler: 'Server verweigert die Verbindung' }
    if (e?.art === 'zuGross' || /zu gross/i.test(text)) return { status: 'unpruefbar', fehler: 'Seite zu gross zum Lesen' }
    if (e?.name === 'AbortError' || /abort/i.test(text)) return { status: 'unpruefbar', fehler: 'keine Antwort innerhalb der Zeitgrenze' }
    if (/^(CERT_|ERR_TLS_|UNABLE_TO_|SELF_SIGNED|DEPTH_ZERO)/.test(code)) return { status: 'unpruefbar', fehler: `Zertifikat nicht prüfbar (${code})` }
    return { status: 'unpruefbar', fehler: (code ? `${text} (${code})` : text).slice(0, 80) }
}

// ── Domain-Alter (RDAP) ─────────────────────────────────────────────────

/**
 * Registrierungsdatum aus einer RDAP-Antwort (RFC 9083).
 *
 * RDAP ist der Nachfolger von WHOIS, maschinenlesbar und ohne Schlüssel. Das
 * Datum steht unter `events[]` mit `eventAction: "registration"`.
 *
 * @returns {number|null} Zeitpunkt in ms
 */
export function rdapRegistriert(json) {
    const ereignisse = Array.isArray(json?.events) ? json.events : []
    const reg = ereignisse.find((e) => String(e?.eventAction || '').toLowerCase() === 'registration')
    const ts = Date.parse(reg?.eventDate || '')
    return Number.isFinite(ts) ? ts : null
}

// ── GitHub ──────────────────────────────────────────────────────────────

/** Pfade auf github.com, die kein Konto sind. */
const GITHUB_KEIN_KONTO = new Set(['orgs', 'topics', 'features', 'marketplace', 'sponsors', 'about', 'pricing', 'login', 'join', 'settings', 'explore'])

/**
 * Konto und Repository aus einem GitHub-Link.
 * @returns {{konto:string, repo:string}|null}
 */
export function githubZiel(link) {
    let u
    try { u = new URL(String(link || '')) } catch { return null }
    if (!/^(www\.)?github\.com$/i.test(u.hostname)) return null
    const [konto, repo] = u.pathname.split('/').filter(Boolean)
    if (!konto || GITHUB_KEIN_KONTO.has(konto.toLowerCase())) return null
    return { konto, repo: (repo || '').replace(/\.git$/, '') }
}

const tageSeit = (iso, jetzt) => {
    const t = Date.parse(iso || '')
    return Number.isFinite(t) ? Math.max(0, (jetzt - t) / 86400000) : null
}

/** Ab so vielen Sternen gilt ein anderes Repository als „früheres Projekt". */
export const STERNE_FUER_PROJEKT = 20

/**
 * Was die GitHub-Antworten über das Team sagen.
 *
 * @param {object} quellen  {konto, repo, repos} — Antworten von /users, /repos, /users/x/repos
 */
export function githubFakten({ konto = null, repo = null, repos = [] } = {}, jetzt = Date.now()) {
    const eigenes = String(repo?.name || '').toLowerCase()
    const frueher = (Array.isArray(repos) ? repos : [])
        .filter((r) => !r?.fork && String(r?.name || '').toLowerCase() !== eigenes)
        .filter((r) => Number(r?.stargazers_count) >= STERNE_FUER_PROJEKT)
        .sort((a, b) => Number(b.stargazers_count) - Number(a.stargazers_count))
        .slice(0, 5)
        .map((r) => ({ name: String(r.name), sterne: Number(r.stargazers_count), alterTage: tageSeit(r.created_at, jetzt) }))
    return {
        konto: konto ? {
            name: String(konto.login || ''),
            art: konto.type === 'Organization' ? 'organisation' : 'person',
            alterTage: tageSeit(konto.created_at, jetzt),
            oeffentlicheRepos: Number(konto.public_repos) || 0,
            follower: Number(konto.followers) || 0,
            webseite: String(konto.blog || '').slice(0, 200),
            bio: String(konto.bio || '').slice(0, 300),
        } : null,
        repo: repo ? {
            name: String(repo.name || ''),
            alterTage: tageSeit(repo.created_at, jetzt),
            letzterPushTage: tageSeit(repo.pushed_at, jetzt),
            sterne: Number(repo.stargazers_count) || 0,
            forks: Number(repo.forks_count) || 0,
            istFork: repo.fork === true,
            leer: Number(repo.size) === 0,
            beschreibung: String(repo.description || '').slice(0, 300),
            webseite: String(repo.homepage || '').slice(0, 200),
        } : null,
        fruehereProjekte: frueher,
    }
}

/**
 * Ist belegt, dass das GitHub-Konto zum Token gehört?
 *
 * Ein Meme-Token über ein virales Repository verlinkt genau dieses — fremden
 * Code mit vielen Sternen, gepflegt von Leuten, die vom Token nichts wissen.
 * Am 10.10.2026 standen 20 Token mit GitHub-Link als „Webseite" im Bestand,
 * mit Noten von 85 bis 90. Der Name hilft hier nicht (der Token HEISST wie das
 * Repository). Was hilft: Die eigene Seite verlinkt das Konto, oder das
 * Repository bzw. Konto nennt Vertrag oder Seite des Tokens.
 *
 * @param {object} g  `githubFakten`-Ergebnis
 * @param {object} k  {vonSeite: Link stammt von der belegten eigenen Seite, contract, seitenHost}
 */
export function githubBeleg(g, { vonSeite = false, contract = '', seitenHost = '' } = {}) {
    if (!g) return false
    if (vonSeite) return true
    const texte = [g.repo?.beschreibung, g.repo?.webseite, g.konto?.webseite, g.konto?.bio].map((t) => String(t || ''))
    const c = String(contract || '')
    if (c && texte.some((t) => (istEvmAdresse(c) ? t.toLowerCase().includes(c.toLowerCase()) : t.includes(c)))) return true
    if (seitenHost) {
        const hosts = [g.repo?.webseite, g.konto?.webseite].map((u) => hostVon(/^https?:\/\//i.test(String(u || '')) ? u : `https://${u}`))
        if (hosts.includes(ohneWww(seitenHost))) return true
    }
    return false
}

// ── Ersteller-Bilanz (pump.fun) ─────────────────────────────────────────

/**
 * Was der Ersteller vorher aufgelegt hat — die Frage „hat dieses Team schon
 * einmal etwas zustande gebracht", für Token ohne Webseite und ohne Code.
 *
 * Gemessen an pump.fun (Marino et al. 2026; scorplabs 2026): Wer schon einmal
 * einen Coin durch die Kurve gebracht hat, schafft es mit dem nächsten um ein
 * Vielfaches häufiger als die Grundrate von rund 1 %. Wer dagegen Dutzende
 * aufgelegt hat und keiner kam durch, legt in Serie auf — Massenware.
 *
 * Die Antwort kommt als Liste oder als `{coins: [...]}`; beides wird gelesen.
 * Der aktuelle Coin zählt nicht mit.
 *
 * Gegenprobe mit `wallet`: Jeder Coin muss diese Wallet als `creator` tragen.
 * Greift der Filter der Abfrage einmal nicht (Parameter umbenannt, Antwort aus
 * einem Zwischenspeicher), kämen die fünfzig neuesten Coins ALLER Ersteller
 * zurück — und jeder Token hätte „50+ Coins, keiner durch die Kurve", minus
 * dreissig Punkte. Dann lieber unbekannt.
 */
export function erstellerBilanz(antwort, { mint = '', wallet = '', jetzt = Date.now() } = {}) {
    const roh = Array.isArray(antwort) ? antwort : (Array.isArray(antwort?.coins) ? antwort.coins : null)
    if (!roh) return null
    if (wallet && roh.some((c) => String(c?.creator || '') !== String(wallet))) return null
    const andere = roh.filter((c) => c && String(c.mint || '') !== String(mint))
    const graduiert = andere.filter((c) => c.complete === true || Boolean(c.raydium_pool) || Boolean(c.pump_swap_pool))
    const juengst = andere.filter((c) => {
        const t = Number(c.created_timestamp)
        return Number.isFinite(t) && t > 0 && jetzt - t < 24 * 3600e3
    })
    const besteKap = Math.max(0, ...andere.map((c) => Number(c.usd_market_cap) || 0))
    return {
        andere: andere.length,
        graduiert: graduiert.length,
        letzte24h: juengst.length,
        besteMarktkapUsd: besteKap || null,
        beispiele: graduiert.slice(0, 3).map((c) => ({ symbol: String(c.symbol || ''), mint: String(c.mint || '') })),
        // Die Liste ist gedeckelt (eine Seite); mehr heisst „mindestens".
        vollstaendig: roh.length < 50,
    }
}

// ── Gesamturteil ────────────────────────────────────────────────────────

const PUNKTE = {
    keineWebseite: -15,
    webseiteTot: -10,
    gratisSeite: -5,
    platzhalter: -15,
    kaumText: -5,
    vielText: 5,
    vertragPasst: 8,
    vertragFremd: -25,
    seiteGeteilt: -10,
    domainNeu: -10,          // unter 3 Tagen
    domainJung: -5,          // unter 30 Tagen
    domainAlt: 10,           // über 180 Tagen
    domainSehrAlt: 15,       // über zwei Jahren
    keineKanaele: -10,
    githubRepo: 5,
    githubGepflegt: 10,
    githubFork: -10,
    githubKontoNeu: -5,
    githubFruehere: 10,
    erstellerErfolg: 15,
    erstellerSerie: -20,
    erstellerMasse: -10,
}

/** Höchstens so viel bringen die Abschnitte der Seite zusammen. */
const ABSCHNITTE_DECKEL = 20
const ABSCHNITT_PUNKTE = { roadmap: 4, tokenomics: 4, team: 6, audit: 4, whitepaper: 6, produkt: 6 }

const kurzAdresse = (a) => (String(a || '').length > 12 ? `${String(a).slice(0, 4)}…${String(a).slice(-4)}` : String(a || '?'))

/** Warum ein Kanal-Link nicht als Kanal zählt. */
const KANAL_GRUND = {
    beitrag: 'zeigt auf einen einzelnen Beitrag, nicht auf ein Konto',
    keinKonto: 'zeigt auf kein Konto',
    bot: 'ist ein Bot, keine Gemeinschaft',
}

/**
 * Substanz-Note und Befunde.
 *
 * Start bei 50 (nichts dafür, nichts dagegen), dann Zu- und Abschläge, jeder
 * mit Begründung. Die Gewichte sind Setzungen, keine Messung — dafür gibt es
 * die Erfolgskontrolle, an der sie sich bewähren müssen.
 *
 * Abzüge gelten für jede angegebene Seite — der Token hat sie als seine
 * ausgegeben. Zuschläge nur für eine Seite, die nachweislich seine ist
 * (`seitenBeleg`); sonst stünden die Verdienste fremder Leute in seiner Note.
 *
 * @param {object} f  {token:{symbol,name,contract},
 *                     webseite:{status, grund, fakten, host, domainAlterTage, plattform, art, adresse, geteilt},
 *                     kanaele:{x,telegram,discord}, kanaeleVerworfen:[{art,grund}], github, ersteller}
 * @returns {{note:number|null, befunde:Array<{art:string, schluessel:string, text:string}>}}
 */
export function bewerteProjekt(f = {}) {
    const befunde = []
    let note = 50
    let gemessen = 0
    const plus = (schluessel, punkte, text) => { note += punkte; befunde.push({ art: 'plus', schluessel, text }) }
    const minus = (schluessel, punkte, text) => { note += punkte; befunde.push({ art: 'minus', schluessel, text }) }
    const info = (schluessel, text) => befunde.push({ art: 'info', schluessel, text })

    // ── Webseite ────────────────────────────────────────────────────────
    const w = f.webseite || { status: 'unbekannt' }
    const s = w.status === 'ok' ? w.fakten : null
    const beleg = seitenBeleg(w, f.token || {})
    const sammel = Boolean(s?.sammelseite)
    const geteilt = w.status !== 'keine' ? Math.max(0, Number(w.geteilt) || 0) : 0

    if (w.status === 'keine') {
        gemessen++
        if (w.grund === 'fremderToken') {
            minus('vertragFremd', PUNKTE.vertragFremd,
                `Als Webseite ist die Seite einer ANDEREN Adresse angegeben (${kurzAdresse(w.adresse)} auf ${w.host}) — die kopierten Angaben eines anderen Coins oder eine falsche Seite`)
        } else if (w.grund === 'tokenSeite') {
            minus('keineWebseite', PUNKTE.keineWebseite, `Keine eigene Webseite — angegeben ist nur die Seite des Tokens auf ${w.host}`)
        } else if (w.grund === 'plattform') {
            minus('keineWebseite', PUNKTE.keineWebseite, `Keine eigene Webseite — angegeben ist ${PLATTFORM_TEXT[w.art] || 'eine fremde Plattform'} (${w.plattform})`)
        } else {
            minus('keineWebseite', PUNKTE.keineWebseite, 'Keine Webseite angegeben')
        }
    } else if (w.status === 'geschuetzt') {
        info('webseiteGeschuetzt', 'Webseite blockt automatische Abrufe (Bot-Schutz) — Inhalt nicht prüfbar')
    } else if (w.status === 'unpruefbar') {
        info('webseiteUnpruefbar', `Webseite nicht prüfbar${w.fehler ? ` (${w.fehler})` : ''} — kein Abzug`)
    } else if (w.status === 'fehler') {
        gemessen++
        minus('webseiteTot', PUNKTE.webseiteTot, `Webseite nicht erreichbar${w.fehler ? ` (${w.fehler})` : ''}`)
    } else if (s && sammel) {
        gemessen++
        minus('keineWebseite', PUNKTE.keineWebseite,
            `Keine eigene Webseite — die angegebene Seite listet ${s.adressen} Vertragsadressen (Sammel- oder Handelsseite)`)
    } else if (s && s.vertragAufSeite === 'fremd') {
        // Die Seite eines anderen Tokens: was auf ihr steht, ist nicht seins — weder Plus noch Minus.
        gemessen++
        minus('vertragFremd', PUNKTE.vertragFremd,
            `Seite nennt eine ANDERE Vertragsadresse (${(s.fremdeVertraege || [])[0] || '?'}) — Nachahmer oder falsche Seite`)
    } else if (s && beleg.fremd) {
        gemessen++
        if (beleg.fremd === 'andererToken') {
            minus('seiteAndererToken', PUNKTE.vertragFremd,
                `Die angegebene Seite wirbt für einen anderen Token („$${String(beleg.anderer).toUpperCase()}" im Titel) — kopierte Angaben oder falsche Seite`)
        } else if (beleg.fremd === 'beitrag') {
            minus('keineWebseite', PUNKTE.keineWebseite,
                `Keine eigene Webseite — angegeben ist ein einzelner Beitrag auf ${w.host}, ohne Beleg, dass er zum Token gehört`)
        } else {
            minus('keineWebseite', PUNKTE.keineWebseite,
                `Keine eigene Webseite — ${w.host} ist seit ${Math.floor(Number(w.domainAlterTage) / 365)} Jahren registriert und belegt keinen Bezug zum Token (eine fremde Seite)`)
        }
    } else if (s) {
        gemessen++
        if (w.plattform) minus('gratisSeite', PUNKTE.gratisSeite, `Seite auf einer Gratis-Plattform (${w.plattform})`)
        else if (s.baukasten) minus('gratisSeite', PUNKTE.gratisSeite, `Linkseite aus einem Baukasten (${s.baukasten})`)
        if (s.platzhalter) minus('platzhalter', PUNKTE.platzhalter, 'Platzhalter- oder Vorlagentext auf der Seite')
        if (s.nurSkript) {
            info('nurSkript', 'Seite baut ihren Inhalt erst im Browser — Text nicht prüfbar')
        } else if (s.woerter < 80) {
            minus('kaumText', PUNKTE.kaumText, `Kaum Inhalt (${s.woerter} Wörter)`)
        } else if (s.woerter > 400 && beleg.eigen) {
            plus('vielText', PUNKTE.vielText, `Ausführliche Seite (${s.woerter} Wörter)`)
        }
        if (beleg.eigen) {
            let abschnitte = 0
            const gefunden = []
            for (const [k, p] of Object.entries(ABSCHNITT_PUNKTE)) {
                if (s.abschnitte?.[k]) { abschnitte += p; gefunden.push(k) }
            }
            if (abschnitte) plus('abschnitte', Math.min(ABSCHNITTE_DECKEL, abschnitte), `Seite nennt: ${gefunden.join(', ')}`)
        }
        if (s.vertragAufSeite === 'passt') plus('vertragPasst', PUNKTE.vertragPasst, 'Vertragsadresse steht auf der Seite')
        if (!beleg.eigen && !geteilt) {
            info('seiteOhneBeleg', 'Seite nennt weder den Vertrag noch Namen und „$Symbol" des Tokens — ob sie seine ist, ist nicht belegt; ihre Pluspunkte zählen nicht')
        }
    }

    /*
     * Dieselbe Seite bei mehreren Token: Höchstens einer davon ist das
     * Original. Gemessen 10.10.2026: tootincoin.money bei fünf Token, keiner
     * davon auf der Seite genannt; ein Forschungsartikel bei dreien mit Note 92.
     * Wer auf der Seite steht, ist das Original — die anderen haben kopiert.
     * Eine erkennbar fremde Seite trägt schon ihren Abzug; das Teilen sagt
     * dort nichts Neues.
     */
    if (geteilt && !beleg.fremd && s?.vertragAufSeite !== 'fremd' && !sammel) {
        gemessen++
        if (beleg.wie === 'vertrag') {
            info('seiteGeteilt', `${geteilt} weitere${geteilt === 1 ? 'r' : ''} Token ${geteilt === 1 ? 'nennt' : 'nennen'} dieselbe Seite — dieser steht darauf, die anderen nicht`)
        } else {
            minus('seiteGeteilt', PUNKTE.seiteGeteilt,
                `Dieselbe Webseite ${geteilt === 1 ? 'nennt ein weiterer Token' : `nennen ${geteilt} weitere Token`} — welcher der echte ist, belegt die Seite nicht`)
        }
    }

    // Domain-Alter nur bei eigener, nicht geteilter Domain — eine Gratis-Plattform ist alt, die Seite darauf nicht.
    const alter = Number(w.domainAlterTage)
    const domainZaehlt = s && !sammel && !beleg.fremd && s.vertragAufSeite !== 'fremd' && !w.plattform
        && (!geteilt || beleg.wie === 'vertrag')
        && w.domainAlterTage !== null && w.domainAlterTage !== undefined && Number.isFinite(alter)
    if (domainZaehlt) {
        if (alter < 3) minus('domainNeu', PUNKTE.domainNeu, `Domain erst ${alter.toFixed(1)} Tage registriert`)
        else if (alter < 30) minus('domainJung', PUNKTE.domainJung, `Domain ${Math.round(alter)} Tage alt`)
        else if (beleg.eigen && alter > 730) plus('domainSehrAlt', PUNKTE.domainSehrAlt, `Domain seit ${(alter / 365).toFixed(1)} Jahren registriert`)
        else if (beleg.eigen && alter > 180) plus('domainAlt', PUNKTE.domainAlt, `Domain seit ${Math.round(alter)} Tagen registriert`)
        if (beleg.eigen && alter > 730) info('domainGekauft', 'Alte Domains lassen sich kaufen — das Alter allein beweist keine Vorgeschichte')
    }

    // ── Kanäle ──────────────────────────────────────────────────────────
    const k = f.kanaele || {}
    const anzahlKanaele = ['x', 'telegram', 'discord'].filter((n) => k[n]).length
    if (f.kanaele) {
        gemessen++
        if (!anzahlKanaele) minus('keineKanaele', PUNKTE.keineKanaele, 'Weder X noch Telegram noch Discord angegeben')
        else plus('kanaele', Math.min(6, anzahlKanaele * 3), `Kanäle: ${['x', 'telegram', 'discord'].filter((n) => k[n]).join(', ')}`)
    }
    for (const v of f.kanaeleVerworfen || []) {
        if (!KANAL_GRUND[v.grund]) continue
        const dienst = { x: 'X', telegram: 'Telegram', discord: 'Discord' }[v.art] || v.art
        info('kanalVerworfen', `${dienst}-Link ${KANAL_GRUND[v.grund]} — nicht als Kanal gezählt`)
    }

    // ── GitHub ──────────────────────────────────────────────────────────
    const g = f.github
    if (g) {
        gemessen++
        const belegt = g.beleg === true
        let ohneBelegVerdient = false
        if (g.repo) {
            if (g.repo.istFork) {
                minus('githubFork', PUNKTE.githubFork, `Repository ${g.repo.name} ist nur ein Fork fremden Codes`)
            } else if (g.repo.leer) {
                minus('githubFork', PUNKTE.githubFork, `Repository ${g.repo.name} ist leer`)
            } else if (!belegt) {
                ohneBelegVerdient = true
            } else {
                plus('githubRepo', PUNKTE.githubRepo, `Öffentlicher Code (${g.repo.name}, ${g.repo.sterne} Sterne)`)
                if (g.repo.alterTage > 30 && g.repo.letzterPushTage !== null && g.repo.letzterPushTage < 30) {
                    plus('githubGepflegt', PUNKTE.githubGepflegt,
                        `Code älter als der Hype und gepflegt (seit ${Math.round(g.repo.alterTage)} Tagen, letzter Stand vor ${Math.round(g.repo.letzterPushTage)} Tagen)`)
                }
            }
        }
        if (g.konto && g.konto.alterTage !== null && g.konto.alterTage < 14) {
            minus('githubKontoNeu', PUNKTE.githubKontoNeu, `GitHub-Konto erst ${Math.round(g.konto.alterTage)} Tage alt`)
        }
        if (g.fruehereProjekte?.length) {
            if (belegt) {
                plus('githubFruehere', PUNKTE.githubFruehere,
                    `Frühere Projekte desselben Kontos: ${g.fruehereProjekte.map((p) => `${p.name} (${p.sterne}★)`).join(', ')}`)
            } else {
                ohneBelegVerdient = true
            }
        }
        if (ohneBelegVerdient) {
            info('githubOhneBeleg', `GitHub ${g.konto?.name || g.repo?.name || ''} ohne belegte Verbindung zum Token — weder von der eigenen Seite verlinkt, noch nennt es Vertrag oder Seite; Code und frühere Projekte zählen nicht`.replace(/\s+—/, ' —'))
        }
    }

    // ── Ersteller ───────────────────────────────────────────────────────
    const e = f.ersteller
    if (e) {
        gemessen++
        if (e.andere === 0) {
            info('erstellerNeu', 'Erster Coin dieses Erstellers')
        } else if (e.graduiert > 0) {
            plus('erstellerErfolg', PUNKTE.erstellerErfolg,
                `Ersteller hat schon ${e.graduiert} von ${e.andere}${e.vollstaendig ? '' : '+'} Coins durch die Kurve gebracht`
                + (e.beispiele?.length ? ` (${e.beispiele.map((b) => b.symbol).join(', ')})` : ''))
        } else if (e.andere >= 10) {
            minus('erstellerSerie', PUNKTE.erstellerSerie,
                `Ersteller hat ${e.andere}${e.vollstaendig ? '' : '+'} Coins aufgelegt, keiner kam durch die Kurve`)
        } else {
            info('erstellerOhneErfolg', `Ersteller hat ${e.andere} weitere Coins aufgelegt, keiner kam durch die Kurve`)
        }
        if (e.letzte24h >= 5) {
            minus('erstellerMasse', PUNKTE.erstellerMasse, `Ersteller hat in 24 Stunden ${e.letzte24h} weitere Coins gestartet`)
        }
    }

    if (!gemessen) return { note: null, befunde }
    return { note: Math.max(0, Math.min(100, Math.round(note))), befunde }
}
