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
 */

// ── Webseite ────────────────────────────────────────────────────────────

/** Plattformen, auf denen eine Seite in Minuten und gratis steht. */
const GRATIS_PLATTFORMEN = [
    'carrd.co', 'linktr.ee', 'linktree.com', 'vercel.app', 'netlify.app', 'github.io', 'pages.dev',
    'web.app', 'firebaseapp.com', 'notion.site', 'wixsite.com', 'webflow.io', 'framer.website',
    'framer.ai', 'framer.app', 'replit.app', 'glitch.me', 'onrender.com', 'herokuapp.com',
    'blogspot.com', 'wordpress.com', 'super.site', 'beacons.ai', 'taplink.cc', 'bio.link',
    'gitbook.io', 'mystrikingly.com', 'weebly.com', 'site123.me', 'godaddysites.com',
]

/** Zweistufige öffentliche Endungen — dort ist die Domain drei Teile lang. */
const ZWEISTUFIG = new Set([
    'co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'com.br', 'com.cn',
    'com.sg', 'com.hk', 'co.in', 'com.tr', 'com.mx', 'co.za', 'com.ar', 'co.kr', 'com.tw',
])

/**
 * Die registrierbare Domain eines Hosts („app.foo.co.uk" → „foo.co.uk").
 * Für das Domain-Alter zählt die Registrierung, nicht die Unterdomain.
 */
export function registrierbareDomain(host) {
    const h = String(host || '').toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
    const teile = h.split('.').filter(Boolean)
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
    const h = String(host || '').toLowerCase().replace(/\.$/, '')
    return GRATIS_PLATTFORMEN.find((p) => h === p || h.endsWith(`.${p}`)) || ''
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
 */
const ABSCHNITTE = {
    roadmap: /\b(roadmap|milestones?|phase\s*[1-4]|q[1-4]\s*20\d\d)\b/i,
    tokenomics: /\b(tokenomics|token\s*distribution|allocation|total\s*supply|vesting)\b/i,
    team: /\b(our\s*team|the\s*team|core\s*team|founders?|co-?founder|team\s*members?|meet\s*the\s*team)\b/i,
    audit: /\b(audit(ed)?\s*by|security\s*audit|certik|hacken|solidproof|peckshield|trail\s*of\s*bits)\b/i,
    whitepaper: /\b(white\s*paper|litepaper|documentation|docs)\b/i,
    produkt: /\b(launch\s*app|open\s*app|dapp|testnet|mainnet|beta|dashboard|sdk|api|platform|protocol|product)\b/i,
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

const EVM_ADRESSE = /\b0x[a-fA-F0-9]{40}\b/g
const SOL_ADRESSE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g
/** Ein Etikett, das eine Vertragsadresse ankündigt. */
// Bewusst NICHT das blosse „address": „Team wallet address: …" ist keine
// Aussage über den Token.
const CA_ETIKETT = /\b(ca|contract(\s*address)?|token\s*address|mint(\s*address)?)\s*[:：-]?\s*$/i

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
    const host = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' } }

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

    const genannt = genannteVertraege(text)
    const vertrag = String(contract || '')
    const kommtVor = (a) => (a.startsWith('0x') ? a.toLowerCase() === vertrag.toLowerCase() : a === vertrag)
    let vertragAufSeite = 'fehlt'
    if (vertrag && (roh.includes(vertrag) || (vertrag.startsWith('0x') && roh.toLowerCase().includes(vertrag.toLowerCase())))) {
        vertragAufSeite = 'passt'
    } else if (vertrag && genannt.length && !genannt.some(kommtVor)) {
        vertragAufSeite = 'fremd'
    }

    const jahre = [...text.matchAll(/(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)]
        .map((m) => Number(m[1])).filter((j) => j >= 2009 && j <= 2100)

    return {
        titel: entitaeten((roh.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim()).slice(0, 200),
        beschreibung: (metaInhalt(roh, 'description') || metaInhalt(roh, 'og:description')).slice(0, 400),
        woerter,
        nurSkript,
        textAuszug: text.slice(0, 2500),
        kanaele,
        abschnitte,
        platzhalter: PLATZHALTER.test(text),
        baukasten: BAUKASTEN.find(([, re]) => re.test(roh))?.[0] || '',
        vertragAufSeite,
        fremdeVertraege: vertragAufSeite === 'fremd' ? [...new Set(genannt)].slice(0, 3) : [],
        copyrightJahr: jahre.length ? Math.max(...jahre) : null,
    }
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
        } : null,
        repo: repo ? {
            name: String(repo.name || ''),
            alterTage: tageSeit(repo.created_at, jetzt),
            letzterPushTage: tageSeit(repo.pushed_at, jetzt),
            sterne: Number(repo.stargazers_count) || 0,
            forks: Number(repo.forks_count) || 0,
            istFork: repo.fork === true,
            leer: Number(repo.size) === 0,
        } : null,
        fruehereProjekte: frueher,
    }
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
 */
export function erstellerBilanz(antwort, { mint = '', jetzt = Date.now() } = {}) {
    const roh = Array.isArray(antwort) ? antwort : (Array.isArray(antwort?.coins) ? antwort.coins : null)
    if (!roh) return null
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

/**
 * Substanz-Note und Befunde.
 *
 * Start bei 50 (nichts dafür, nichts dagegen), dann Zu- und Abschläge, jeder
 * mit Begründung. Die Gewichte sind Setzungen, keine Messung — dafür gibt es
 * die Erfolgskontrolle, an der sie sich bewähren müssen.
 *
 * @param {object} f  {webseite:{status, fakten, host, domainAlterTage, plattform},
 *                     kanaele:{x,telegram,discord}, github, ersteller}
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
    if (w.status === 'keine') {
        gemessen++
        minus('keineWebseite', PUNKTE.keineWebseite, 'Keine Webseite angegeben')
    } else if (w.status === 'geschuetzt') {
        info('webseiteGeschuetzt', 'Webseite blockt automatische Abrufe (Bot-Schutz) — Inhalt nicht prüfbar')
    } else if (w.status === 'fehler') {
        gemessen++
        minus('webseiteTot', PUNKTE.webseiteTot, `Webseite nicht erreichbar${w.fehler ? ` (${w.fehler})` : ''}`)
    } else if (w.status === 'ok' && w.fakten) {
        gemessen++
        const s = w.fakten
        if (w.plattform) minus('gratisSeite', PUNKTE.gratisSeite, `Seite auf einer Gratis-Plattform (${w.plattform})`)
        else if (s.baukasten) minus('gratisSeite', PUNKTE.gratisSeite, `Linkseite aus einem Baukasten (${s.baukasten})`)
        if (s.platzhalter) minus('platzhalter', PUNKTE.platzhalter, 'Platzhalter- oder Vorlagentext auf der Seite')
        if (s.nurSkript) {
            info('nurSkript', 'Seite baut ihren Inhalt erst im Browser — Text nicht prüfbar')
        } else if (s.woerter < 80) {
            minus('kaumText', PUNKTE.kaumText, `Kaum Inhalt (${s.woerter} Wörter)`)
        } else if (s.woerter > 400) {
            plus('vielText', PUNKTE.vielText, `Ausführliche Seite (${s.woerter} Wörter)`)
        }
        let abschnitte = 0
        const gefunden = []
        for (const [k, p] of Object.entries(ABSCHNITT_PUNKTE)) {
            if (s.abschnitte?.[k]) { abschnitte += p; gefunden.push(k) }
        }
        if (abschnitte) plus('abschnitte', Math.min(ABSCHNITTE_DECKEL, abschnitte), `Seite nennt: ${gefunden.join(', ')}`)
        if (s.vertragAufSeite === 'passt') plus('vertragPasst', PUNKTE.vertragPasst, 'Vertragsadresse steht auf der Seite')
        if (s.vertragAufSeite === 'fremd') {
            minus('vertragFremd', PUNKTE.vertragFremd,
                `Seite nennt eine ANDERE Vertragsadresse (${(s.fremdeVertraege || [])[0] || '?'}) — Nachahmer oder falsche Seite`)
        }
    }

    // Domain-Alter nur bei eigener Domain — eine Gratis-Plattform ist alt, die Seite darauf nicht.
    const alter = Number(w.domainAlterTage)
    if (w.status === 'ok' && !w.plattform && w.domainAlterTage !== null && w.domainAlterTage !== undefined && Number.isFinite(alter)) {
        if (alter < 3) minus('domainNeu', PUNKTE.domainNeu, `Domain erst ${alter.toFixed(1)} Tage registriert`)
        else if (alter < 30) minus('domainJung', PUNKTE.domainJung, `Domain ${Math.round(alter)} Tage alt`)
        else if (alter > 730) plus('domainSehrAlt', PUNKTE.domainSehrAlt, `Domain seit ${(alter / 365).toFixed(1)} Jahren registriert`)
        else if (alter > 180) plus('domainAlt', PUNKTE.domainAlt, `Domain seit ${Math.round(alter)} Tagen registriert`)
        if (alter > 730) info('domainGekauft', 'Alte Domains lassen sich kaufen — das Alter allein beweist keine Vorgeschichte')
    }

    // ── Kanäle ──────────────────────────────────────────────────────────
    const k = f.kanaele || {}
    const anzahlKanaele = ['x', 'telegram', 'discord'].filter((n) => k[n]).length
    if (f.kanaele) {
        gemessen++
        if (!anzahlKanaele) minus('keineKanaele', PUNKTE.keineKanaele, 'Weder X noch Telegram noch Discord angegeben')
        else plus('kanaele', Math.min(6, anzahlKanaele * 3), `Kanäle: ${['x', 'telegram', 'discord'].filter((n) => k[n]).join(', ')}`)
    }

    // ── GitHub ──────────────────────────────────────────────────────────
    const g = f.github
    if (g) {
        gemessen++
        if (g.repo) {
            if (g.repo.istFork) {
                minus('githubFork', PUNKTE.githubFork, `Repository ${g.repo.name} ist nur ein Fork fremden Codes`)
            } else if (g.repo.leer) {
                minus('githubFork', PUNKTE.githubFork, `Repository ${g.repo.name} ist leer`)
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
            plus('githubFruehere', PUNKTE.githubFruehere,
                `Frühere Projekte desselben Kontos: ${g.fruehereProjekte.map((p) => `${p.name} (${p.sterne}★)`).join(', ')}`)
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
