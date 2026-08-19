/**
 * Benachrichtigungen — ein Register, zwei Kanäle.
 *
 * Die App meldete sich bisher ausschliesslich über Browser-Benachrichtigungen.
 * Die erreichen nur, wer die Seite gerade offen hat (`src/utils/notify.js`
 * prüft `Notification.permission` UND `!document.hasFocus()`). Auf eine
 * Pi-Cycle-Kreuzung wartet man aber Monate, und ein „Order-Zustand UNBEKANNT"
 * der Strategie-Engine betrifft echtes Geld — beides darf nicht davon abhängen,
 * ob zufällig ein Tab offen stand.
 *
 * Deshalb hier der zweite Kanal: E-Mail, serverseitig ausgelöst.
 *
 * Aufgabenteilung zwischen den Kanälen:
 *
 *   Browser  → Erkennung im Frontend. Braucht ohnehin eine offene Seite,
 *              also darf die Erkennung dort bleiben, wo sie ist.
 *   E-Mail   → Erkennung hier im Takt bzw. direkt an der Ereignisstelle im
 *              Server. Läuft unabhängig davon, ob jemand zusieht.
 *
 * Beide Kanäle entprellen getrennt (Browser über localStorage, E-Mail über
 * `db-claim`). Das ist Absicht: ein Browser, der drei Tage zu war, soll die
 * E-Mail-Sperre nicht beeinflussen — und umgekehrt.
 *
 * Zum Doppelbetrieb: NAS-Container und Entwicklungsrechner teilen dieselbe
 * PostgreSQL. Jeder Versand MUSS deshalb über `beansprucheAufgabe` laufen,
 * sonst schickt jede Instanz dieselbe Mail.
 */

import crypto from 'crypto'
import nodemailer from 'nodemailer'
import { getKnex } from './database.js'
import { decrypt, encrypt } from './crypto.js'
import { beansprucheAufgabe, gibAufgabeFrei, merkeAufgabenFehler } from './db-claim.js'
import { logWarn, logError } from './logger.js'
import { baueMail, logoAnhang } from './mail-vorlage.js'

/**
 * Alle Meldungstypen der App.
 *
 * `email: false` heisst nicht „unwichtig", sondern „serverseitig nicht
 * erkennbar": Import-Meldungen entstehen, während der Nutzer den Import selbst
 * angestossen hat — eine Mail darüber erreicht ihn genau dann, wenn er ohnehin
 * vor dem Rechner sitzt.
 *
 * `schwelleSpalte` verweist auf die Einstellungsspalte, die den Auslösepunkt
 * bestimmt. Die Kanalwahl steht getrennt davon in `settings.benachrichtigungen`.
 *
 * `symbol`, `ton` und `bereich` sind die Gestaltung der Mail (siehe
 * `mail-vorlage.js`). Sie stehen hier und nicht dort, damit ein neuer
 * Meldungstyp weiterhin an EINER Stelle vollständig beschrieben ist.
 * Der `ton` folgt der Dringlichkeit, nicht der Gruppe: der Not-Aus ist rot,
 * obwohl er in derselben Gruppe sitzt wie eine ausgeführte Order.
 */
export const REGISTER = [
    // ── Markt ────────────────────────────────────────────────────────────
    { id: 'picycleKreuzung', gruppe: 'markt', email: true, symbol: '\u{1F53A}', ton: 'warnung', bereich: 'Markt · Pi-Cycle' },
    { id: 'picycleVorwarnung', gruppe: 'markt', email: true, schwelleSpalte: 'radarPicycleSchwelle', symbol: '\u{1F441}\uFE0F', ton: 'info', bereich: 'Markt · Pi-Cycle' },
    { id: 'fundingDivergenz', gruppe: 'markt', email: true, schwelleSpalte: 'radarFundingDivergenz', symbol: '\u2696\uFE0F', ton: 'info', bereich: 'Markt · Funding' },
    // ── Handel ───────────────────────────────────────────────────────────
    { id: 'strategieOrderUnbekannt', gruppe: 'handel', email: true, symbol: '\u2757', ton: 'gefahr', bereich: 'Handel · Strategie' },
    { id: 'strategieKillSwitch', gruppe: 'handel', email: true, symbol: '\u{1F6D1}', ton: 'gefahr', bereich: 'Handel · Not-Aus' },
    // ── System ───────────────────────────────────────────────────────────
    { id: 'lageberichtFertig', gruppe: 'system', email: true, symbol: '\u{1F4F0}', ton: 'gut', bereich: 'System · Nachrichten' },
    { id: 'kiBerichtFertig', gruppe: 'system', email: false, symbol: '\u{1F4C4}', ton: 'gut', bereich: 'System · KI' },
    { id: 'kiGuthabenLeer', gruppe: 'system', email: true, symbol: '\u{1F4B3}', ton: 'warnung', bereich: 'System · KI' },
    { id: 'neueVersion', gruppe: 'system', email: true, symbol: '\u{1F195}', ton: 'gut', bereich: 'System · Update' },
    { id: 'aufzeichnungStumm', gruppe: 'system', email: true, symbol: '\u{1F4E1}', ton: 'warnung', bereich: 'System · Aufzeichnung' },
    { id: 'importFertig', gruppe: 'system', email: false, symbol: '\u{1F4E5}', ton: 'gut', bereich: 'System · Import' },
]

const NACH_ID = new Map(REGISTER.map(e => [e.id, e]))

/**
 * Höchstens so viele Mails je rollender Stunde — über ALLE Ereignisse hinweg.
 * Der Deckel ist die letzte Sicherung: die Entprellung je Ereignis fängt den
 * Normalfall ab, aber wenn mehrere Typen gleichzeitig ausschlagen, soll das
 * Postfach trotzdem nicht volllaufen.
 */
const MAX_MAILS_PRO_STUNDE = 10

/** SMTP darf den Takt nicht aufhalten, wenn der Server nicht antwortet. */
const SMTP_TIMEOUT_MS = 20000

/**
 * Anspruchsschlüssel kürzen. `radar_fetch_state.key` ist ein varchar(255);
 * ein Schlüssel aus vielen Symbolen sprengt das sonst.
 */
function kurzSchluessel(roh) {
    const s = String(roh)
    if (s.length <= 180) return s
    return `${s.slice(0, 140)}~${crypto.createHash('sha1').update(s).digest('hex').slice(0, 16)}`
}

/** Einstellungssatz lesen — überall dasselbe Muster wie im übrigen Server. */
async function ladeSettings() {
    try {
        return await getKnex()('settings').where('id', 1).first()
    } catch (e) {
        logWarn('benachrichtigungen', `Einstellungen nicht lesbar: ${e.message}`)
        return null
    }
}

/**
 * Kanalwahl für ein Ereignis.
 *
 * Fehlt ein Eintrag, gilt „Browser an, E-Mail aus". Neue Meldungstypen sind
 * damit sofort sichtbar, verschicken aber nie ungefragt Post — E-Mail ist
 * immer eine bewusste Entscheidung.
 */
export function kanalWahl(settings, id) {
    const eintrag = NACH_ID.get(id)
    let wahl = {}
    try {
        const roh = settings?.benachrichtigungen
        wahl = typeof roh === 'string' ? JSON.parse(roh || '{}') : (roh || {})
    } catch {
        wahl = {}
    }
    const eigen = wahl[id] || {}
    return {
        browser: eigen.browser !== undefined ? Boolean(eigen.browser) : true,
        // Ein Ereignis ohne serverseitige Erkennung kann nie mailen, egal was
        // gespeichert ist — sonst verspräche die Oberfläche etwas, das der
        // Server nicht halten kann.
        email: eintrag?.email ? Boolean(eigen.email) : false,
    }
}

/** Ist der SMTP-Zugang vollständig genug für einen Versuch? */
export function mailKonfigVollstaendig(s) {
    return Boolean(s && Number(s.mailAktiv) === 1 && s.mailHost && s.mailPort
        && s.mailVon && s.mailAn)
}

/**
 * Mail verschicken. Kein Transport-Zwischenspeicher: der Versand ist selten,
 * die Konfiguration darf sich jederzeit ändern, und ein veralteter Transport
 * wäre ein Fehler, den niemand findet.
 *
 * `html` und `anhaenge` sind freiwillig: ohne sie geht die Mail als reiner
 * Text raus, wie vorher. Mit ihnen sieht jedes Postfach die gestaltete
 * Fassung — und Textleser (oder ein Client, der HTML sperrt) den `text`.
 */
async function sendeMail(s, { betreff, text, html, anhaenge }) {
    const sicherheit = String(s.mailSicherheit || 'starttls')
    let passwort = ''
    if (s.mailPasswort) {
        try {
            passwort = decrypt(s.mailPasswort)
        } catch (e) {
            throw new Error(`Passwort nicht entschlüsselbar (CTJ_SECRET geändert?): ${e.message}`)
        }
    }

    // Zweite Verteidigungslinie zur PUT-Prüfung: auch ein VOR der Prüfung
    // gespeicherter Metadaten-Host darf nie angewählt werden.
    if (METADATEN_ZIELE.some((r) => r.test(String(s.mailHost).trim()))) {
        throw new Error('SMTP-Host ist ein Metadaten-Dienst — Versand verweigert.')
    }

    const transport = nodemailer.createTransport({
        host: String(s.mailHost),
        port: Number(s.mailPort),
        // 465 spricht von der ersten Sekunde an TLS, 587 hebt erst per
        // STARTTLS an. Beides zu verwechseln ist der häufigste Grund, warum
        // ein SMTP-Zugang „einfach nicht geht".
        secure: sicherheit === 'tls',
        requireTLS: sicherheit === 'starttls',
        auth: s.mailUser ? { user: String(s.mailUser), pass: passwort } : undefined,
        connectionTimeout: SMTP_TIMEOUT_MS,
        greetingTimeout: SMTP_TIMEOUT_MS,
        socketTimeout: SMTP_TIMEOUT_MS,
    })

    try {
        await transport.sendMail({
            // Anzeigename statt nackter Adresse — im Postfach steht dann die
            // App und nicht „noreply@…".
            from: { name: 'Crypto Trading Journal', address: String(s.mailVon) },
            to: String(s.mailAn),
            subject: betreff,
            text,
            ...(html ? { html } : {}),
            ...(anhaenge?.length ? { attachments: anhaenge } : {}),
        })
    } finally {
        transport.close()
    }
}

/**
 * Aus Betreff und Text die fertige Mail bauen.
 *
 * Alles Ereignisabhängige (Sinnbild, Ton, Rubrik) kommt aus dem REGISTER,
 * alles Absenderabhängige (Profilbild, Name) aus den Einstellungen — die
 * Meldestellen selbst schicken weiterhin nur Betreff und Text.
 */
function gestalteteMail(s, id, { betreff, text }) {
    const eintrag = NACH_ID.get(id) || {}
    const logo = logoAnhang(s)
    const mail = baueMail({
        titel: betreff,
        text,
        symbol: eintrag.symbol,
        ton: eintrag.ton,
        bereich: eintrag.bereich,
        nutzer: s?.username || '',
        mitLogo: Boolean(logo),
    })
    return { ...mail, anhaenge: logo ? [logo] : [] }
}

/**
 * Stundendeckel über Anspruchsplätze.
 *
 * `beansprucheAufgabe` kann „einmal je Zeitraum", nicht „N-mal je Zeitraum".
 * Mit N Plätzen, von denen jeder eine Stunde gesperrt bleibt, ergibt sich
 * genau das: der erste freie Platz erteilt die Erlaubnis, sind alle belegt,
 * ist der Deckel erreicht.
 */
async function darfNochSenden() {
    for (let i = 0; i < MAX_MAILS_PRO_STUNDE; i++) {
        const platz = `mail_deckel_${i}`
        if (await beansprucheAufgabe(platz, 60 * 60 * 1000)) return platz
    }
    return null
}

/**
 * Zentraler Einstieg für jedes serverseitige Ereignis.
 *
 * @param {string} id          Ereignis aus dem REGISTER
 * @param {object} opt
 * @param {string} opt.betreff Betreffzeile
 * @param {string} opt.text    Nachrichtentext
 * @param {string} opt.schluessel  Was das Ereignis EINDEUTIG macht (Symbol,
 *   Tag, Versionsnummer …). Zusammen mit `ttlMs` ist das die Entprellung:
 *   derselbe Schlüssel meldet sich innerhalb der Frist kein zweites Mal.
 * @param {number} [opt.ttlMs] Sperrfrist, Vorgabe 12 Stunden
 * @returns {Promise<boolean>} true = Mail wurde verschickt
 */
export async function melde(id, { betreff, text, schluessel = '', ttlMs = 12 * 60 * 60 * 1000 } = {}) {
    try {
        if (!NACH_ID.has(id)) {
            logWarn('benachrichtigungen', `Unbekanntes Ereignis "${id}" — nichts verschickt`)
            return false
        }
        const s = await ladeSettings()
        if (!s) return false
        if (!kanalWahl(s, id).email) return false
        if (!mailKonfigVollstaendig(s)) return false

        // Entprellen VOR dem Deckel: sonst verbraucht ein längst gemeldetes
        // Ereignis einen Platz, den ein neues gebraucht hätte.
        const anspruch = kurzSchluessel(`mail|${id}|${schluessel}`)
        if (!(await beansprucheAufgabe(anspruch, ttlMs))) return false
        const platz = await darfNochSenden()
        if (!platz) {
            logWarn('benachrichtigungen', `Stundendeckel erreicht — "${id}" nicht verschickt`)
            // Nicht als erledigt stehen lassen: sobald wieder Platz ist, soll
            // dieselbe Meldung noch rausgehen dürfen.
            await gibAufgabeFrei(anspruch)
            return false
        }

        try {
            await sendeMail(s, gestalteteMail(s, id, { betreff, text }))
        } catch (e) {
            /*
             * Ansprüche sind gesetzt, die Mail aber nie angekommen. Ohne
             * Freigabe wäre die Meldung für die volle Sperrfrist verloren — bei
             * „Order-Zustand unbekannt" also schlimmstenfalls ein Jahr, wegen
             * eines SMTP-Aussetzers von zehn Sekunden. Also beides zurückgeben
             * und den Grund vermerken; der nächste Takt versucht es erneut.
             */
            await gibAufgabeFrei(anspruch)
            await gibAufgabeFrei(platz)
            await merkeAufgabenFehler(anspruch, e.message)
            throw e
        }
        console.log(` -> Benachrichtigung verschickt: ${id}`)
        return true
    } catch (e) {
        logError('benachrichtigungen', `"${id}" konnte nicht verschickt werden`, e)
        return false
    }
}

// ── Takt: Ereignisse, die niemand sonst bemerkt ──────────────────────────

let taktTimer = null
const TAKT_MS = 10 * 60 * 1000

const proz = (v) => `${(v * 100).toFixed(1)} %`

/**
 * Funding-Divergenz.
 *
 * Alle betroffenen Märkte kommen in EINE Mail statt in eine je Symbol — das
 * liest sich besser und kann das Postfach nicht fluten. Der Anspruchsschlüssel
 * ist die Liste der betroffenen Märkte samt Richtung: solange sich daran
 * nichts ändert, meldet sich nichts erneut; kommt ein Markt dazu, ist es ein
 * neues Ereignis. Die zusätzliche Stundensperre fängt den Fall ab, dass zwei
 * Zustände miteinander flattern.
 */
async function pruefeFundingDivergenz(s) {
    const schwelle = Number(s.radarFundingDivergenz ?? 15)
    if (!schwelle) return

    const { holeFunding } = await import('./marktradar-api.js')
    const daten = await holeFunding(50)
    const treffer = []
    // Welche Märkte beobachtet werden, entscheidet `marktradar-api.js` — hier
    // steht nur noch die Schwelle. Ohne eigene Auswahl sind es die eigenen
    // Märkte, wie vorher.
    for (const r of daten.divergenzMaerkte || []) {
        if (r.delta == null) continue
        const punkte = Math.abs(r.delta) * 100
        if (punkte < schwelle) continue
        treffer.push({
            symbol: r.symbol,
            richtung: r.delta > 0 ? 'binance' : 'bybit',
            punkte,
            binance: r.binance,
            bybit: r.bybit,
        })
    }
    if (!treffer.length) return

    treffer.sort((a, b) => b.punkte - a.punkte)
    // Nicht öfter als stündlich, egal wie die Zusammensetzung wechselt
    const sperre = 'mail|fundingDivergenz|takt'
    if (!(await beansprucheAufgabe(sperre, 60 * 60 * 1000))) return

    const zeilen = treffer.map(t => {
        const gegensaetzlich = t.binance != null && t.bybit != null
            && Math.sign(t.binance) !== Math.sign(t.bybit)
        return `${t.symbol.replace(/USDT$/, '')}: Binance ${proz(t.binance)} p.a., `
            + `Bybit ${proz(t.bybit)} p.a. (${t.punkte.toFixed(1)} Punkte Unterschied`
            + `${gegensaetzlich ? ', gegensätzliche Vorzeichen' : ''})`
    })

    const verschickt = await melde('fundingDivergenz', {
        betreff: treffer.length === 1
            ? `Funding-Divergenz: ${treffer[0].symbol.replace(/USDT$/, '')}`
            : `Funding-Divergenz in ${treffer.length} Märkten`,
        text: 'Die Funding-Raten laufen zwischen den Börsen auseinander. '
            + 'Wo eine Börse ausschert, sitzt die überfüllte Seite dort allein — '
            + 'genau dort zündet eine Auflösung zuerst.\n\n'
            + zeilen.join('\n')
            + `\n\nSchwelle: ${schwelle} Prozentpunkte p.a.`,
        schluessel: treffer.map(t => `${t.symbol}:${t.richtung}`).join(','),
    })
    // Ging nichts raus (abgewählt, entprellt oder SMTP-Aussetzer), darf die
    // Stundensperre nicht stehen bleiben — sonst kostet ein Fehlschlag von
    // zehn Sekunden eine ganze Stunde Verzug.
    if (!verschickt) await gibAufgabeFrei(sperre)
}

/**
 * Pi-Cycle-Kreuzung. Die Erkennung steht bereits im Marktradar und schreibt
 * jede Kreuzung nach `market_snapshots` — hier wird nur nachgesehen, ob seit
 * dem letzten Blick eine dazugekommen ist.
 */
async function pruefePicycle() {
    const zeile = await getKnex()('market_snapshots')
        .where('kind', 'picycleCross')
        .orderBy('dayUnix', 'desc')
        .first()
    if (!zeile) return

    /*
     * `dayUnix` steht hier in MILLISEKUNDEN, nicht in Sekunden — geschrieben
     * wird die Spalte mit `tagesBeginn(ms)` (marktradar-api.js), und das ist
     * schlicht ein auf den Tagesbeginn abgerundeter Millisekunden-Stempel.
     * Der Spaltenname legt etwas anderes nahe; eine Umrechnung mit `* 1000`
     * ergab das Jahr 53250 und hätte die Altersprüfung ausgehebelt — also
     * eine Meldung über die Kreuzung von 2021 verschickt.
     */
    const alterTage = (Date.now() - Number(zeile.dayUnix)) / 86400000
    if (!Number.isFinite(alterTage) || alterTage < 0 || alterTage > 14) return

    await melde('picycleKreuzung', {
        betreff: 'Pi-Cycle-Top: die Linien haben sich gekreuzt',
        text: 'Die 111-Tage-Linie hat die doppelte 350-Tage-Linie gekreuzt.\n\n'
            + `Datum: ${new Date(Number(zeile.dayUnix)).toLocaleDateString('de-CH')}\n`
            + `BTC-Kurs dabei: ${Number(zeile.value).toLocaleString('de-CH')} $\n\n`
            + 'Das ist historisch nahe am Zyklushoch passiert — allerdings dreimal '
            + 'in fünfzehn Jahren. Ein Hinweis, keine Statistik.',
        schluessel: String(zeile.dayUnix),
        ttlMs: 365 * 24 * 60 * 60 * 1000,
    })
}

/**
 * Pi-Cycle-Vorwarnung. Die Kreuzung selbst zu melden kommt per Definition zu
 * spät — sie IST das Signal. Wer eine Schwelle gesetzt hat, will vorher wissen,
 * dass die kurze Linie heranläuft.
 */
async function pruefePicycleVorwarnung(s) {
    const schwelle = Number(s.radarPicycleSchwelle ?? 0)
    if (!schwelle) return

    const { holePiCycle } = await import('./marktradar-api.js')
    const d = await holePiCycle()
    const abstand = d?.jetzt?.abstandPct
    if (abstand == null || abstand < -schwelle) return
    // Die Kreuzung selbst hat ihre eigene Meldung
    if (d.jetzt.ausgeloest) return

    await melde('picycleVorwarnung', {
        betreff: `Pi-Cycle: nur noch ${Math.abs(abstand).toFixed(1)} % Abstand`,
        text: 'Die 111-Tage-Linie ist bis auf die eingestellte Schwelle an die '
            + 'doppelte 350-Tage-Linie herangelaufen.\n\n'
            + `Abstand jetzt: ${abstand.toFixed(1)} %\n`
            + `Deine Schwelle: ${schwelle} %\n\n`
            + 'Gekreuzt haben sie noch nicht — das ist die Vorwarnung.',
        // Je Schwelle und Jahr einmal, wie im Frontend
        schluessel: `${schwelle}|${new Date().getFullYear()}`,
        ttlMs: 365 * 24 * 60 * 60 * 1000,
    })
}

/** Neue Version — die Prüfung selbst liegt in update-api.js. */
async function pruefeVersion() {
    const { pruefeAufUpdate } = await import('./update-api.js')
    const stand = await pruefeAufUpdate()
    if (!stand?.updateAvailable) return

    await melde('neueVersion', {
        betreff: `Neue Version verfügbar: v${stand.remoteVersion}`,
        text: `Installiert ist v${stand.localVersion}, veröffentlicht wurde v${stand.remoteVersion}.\n\n`
            + (stand.releaseName ? `${stand.releaseName}\n\n` : '')
            + (stand.releaseUrl ? `${stand.releaseUrl}\n\n` : '')
            + 'Achtung: Die Installation setzt den Arbeitsbaum zurück. '
            + 'Nicht gesicherte Änderungen gehen dabei verloren.',
        // Je Version genau einmal — nicht je Tag
        schluessel: String(stand.remoteVersion),
        ttlMs: 365 * 24 * 60 * 60 * 1000,
    })
}

/**
 * Ein Takt-Durchlauf. Jeder Prüfschritt ist einzeln abgesichert: fällt eine
 * Fremdquelle aus, sollen die übrigen Prüfungen trotzdem laufen.
 */
export async function taktDurchlauf() {
    const s = await ladeSettings()
    if (!s || !mailKonfigVollstaendig(s)) return

    for (const [name, fn] of [
        ['Funding-Divergenz', () => pruefeFundingDivergenz(s)],
        ['Pi-Cycle', () => pruefePicycle()],
        ['Pi-Cycle-Vorwarnung', () => pruefePicycleVorwarnung(s)],
        ['Version', () => pruefeVersion()],
    ]) {
        try {
            await fn()
        } catch (e) {
            logWarn('benachrichtigungen', `Prüfung ${name} fehlgeschlagen: ${e.message}`)
        }
    }
}

export function startBenachrichtigungsTakt() {
    if (taktTimer) return
    taktTimer = setInterval(() => { taktDurchlauf().catch(() => { }) }, TAKT_MS)
    console.log(' -> Benachrichtigungs-Takt gestartet')
}

export function stopBenachrichtigungen() {
    if (taktTimer) clearInterval(taktTimer)
    taktTimer = null
}

// ── Routen ───────────────────────────────────────────────────────────────

const SICHERHEIT = ['tls', 'starttls', 'keine']

/** Nur die Form prüfen. Ein Mailrelay im eigenen Netz ist ein legitimes Ziel —
 *  der SSRF-Schutz aus net-guard.js gilt für Feed-URLs, nicht hierfür.
 *  AUSNAHME: Cloud-Metadaten-Ziele. Die sind nie ein Mailserver, aber das
 *  klassische SSRF-Ziel — ein kompromittiertes Frontend könnte den Server
 *  sonst auf 169.254.169.254:25 zeigen lassen. */
const METADATEN_ZIELE = [
    /^169\.254\.\d{1,3}\.\d{1,3}$/,          // Link-local inkl. AWS/GCP/Azure-Metadaten
    /^metadata\.google\.internal$/i,
    /\.internal$/i,
]

export function pruefeMailKonfig({ mailHost, mailPort, mailSicherheit, mailVon, mailAn }) {
    if (mailHost && !/^[A-Za-z0-9.\-_]{1,253}$/.test(String(mailHost))) {
        return 'Der SMTP-Server ist kein gültiger Hostname.'
    }
    if (mailHost && METADATEN_ZIELE.some((r) => r.test(String(mailHost).trim()))) {
        return 'Der SMTP-Server darf kein Metadaten-Dienst sein.'
    }
    const port = Number(mailPort)
    if (mailPort !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
        return 'Der Port muss zwischen 1 und 65535 liegen.'
    }
    if (mailSicherheit !== undefined && !SICHERHEIT.includes(String(mailSicherheit))) {
        return 'Unbekannte Verschlüsselungsart.'
    }
    for (const [feld, wert] of [['Absender', mailVon], ['Empfänger', mailAn]]) {
        if (wert && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(wert))) {
            return `${feld}: keine gültige E-Mail-Adresse.`
        }
    }
    return null
}

export function setupBenachrichtigungsRoutes(app) {
    // Register für die Oberfläche — damit ein neuer Meldungstyp nur HIER
    // eingetragen werden muss und nicht ein zweites Mal im Frontend.
    app.get('/api/benachrichtigungen/typen', (req, res) => {
        res.json({ typen: REGISTER })
    })

    app.get('/api/mail/settings', async (req, res) => {
        try {
            const s = await getKnex()('settings').where('id', 1).first()
            res.json({
                mailAktiv: Number(s?.mailAktiv ?? 0),
                mailHost: s?.mailHost || '',
                mailPort: Number(s?.mailPort ?? 587),
                mailSicherheit: s?.mailSicherheit || 'starttls',
                mailUser: s?.mailUser || '',
                mailVon: s?.mailVon || '',
                mailAn: s?.mailAn || '',
                // Das Passwort verlässt den Server nie — nur die Auskunft,
                // ob eines hinterlegt ist.
                mailPasswortSet: Boolean(s?.mailPasswort),
            })
        } catch (e) {
            logError('benachrichtigungen', 'Mail-Einstellungen nicht lesbar', e)
            res.status(500).json({ error: 'Interner Serverfehler' })
        }
    })

    app.post('/api/mail/settings', async (req, res) => {
        try {
            const fehler = pruefeMailKonfig(req.body || {})
            if (fehler) return res.status(400).json({ error: fehler })

            const { mailAktiv, mailHost, mailPort, mailSicherheit, mailUser,
                mailVon, mailAn, mailPasswort } = req.body || {}
            const aenderung = {
                mailAktiv: mailAktiv ? 1 : 0,
                mailHost: String(mailHost || ''),
                mailPort: Number(mailPort) || 587,
                mailSicherheit: SICHERHEIT.includes(mailSicherheit) ? mailSicherheit : 'starttls',
                mailUser: String(mailUser || ''),
                mailVon: String(mailVon || ''),
                mailAn: String(mailAn || ''),
            }
            // Maskierten Wert nicht zurückschreiben — sonst überschreibt ein
            // Speichern ohne Passwortänderung das echte Passwort mit Punkten.
            // Gleiches Vorgehen wie bei den KI-Schlüsseln.
            if (mailPasswort !== undefined && !String(mailPasswort).includes('•')) {
                aenderung.mailPasswort = mailPasswort ? encrypt(String(mailPasswort)) : ''
            }
            await getKnex()('settings').where('id', 1).update(aenderung)
            res.json({ success: true })
        } catch (e) {
            logError('benachrichtigungen', 'Mail-Einstellungen nicht speicherbar', e)
            res.status(500).json({ error: 'Interner Serverfehler' })
        }
    })

    /**
     * Testmail. Ohne sie ist eine falsche SMTP-Einstellung nicht zu finden —
     * deshalb geht der Fehlertext des Servers hier bewusst im Klartext zurück.
     */
    app.post('/api/mail/test', async (req, res) => {
        try {
            const s = await getKnex()('settings').where('id', 1).first()
            if (!s?.mailHost || !s?.mailVon || !s?.mailAn) {
                return res.status(400).json({ error: 'SMTP-Server, Absender und Empfänger müssen ausgefüllt sein.' })
            }
            const logo = logoAnhang(s)
            const mail = baueMail({
                titel: 'Testmail aus dem Trading Journal',
                text: 'Wenn diese Nachricht ankommt, ist der E-Mail-Versand richtig eingerichtet.\n\n'
                    + `SMTP-Server: ${s.mailHost}:${s.mailPort} (${s.mailSicherheit})\n`
                    + `Absender: ${s.mailVon}\nEmpfänger: ${s.mailAn}\n\n`
                    + 'So sehen ab jetzt alle Benachrichtigungen aus. Sinnbild und Farbe '
                    + 'wechseln je nach Ereignis — rot bei Not-Aus, gelb bei Warnungen.',
                symbol: '\u2705',
                ton: 'gut',
                bereich: 'System · Test',
                nutzer: s?.username || '',
                mitLogo: Boolean(logo),
            })
            await sendeMail(s, { ...mail, anhaenge: logo ? [logo] : [] })
            res.json({ success: true })
        } catch (e) {
            // Kein 500: die Konfiguration ist falsch, nicht der Server kaputt
            res.status(400).json({ error: e.message })
        }
    })

    console.log(' -> Benachrichtigungs-Routen initialisiert')
}

