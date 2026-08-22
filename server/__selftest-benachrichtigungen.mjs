/**
 * Selbsttest: Benachrichtigungen (`benachrichtigungen.js`).
 *
 * Läuft ohne Netz, ohne Datenbank und ohne SMTP — geprüft wird die Logik, die
 * darüber entscheidet, OB etwas rausgeht: Kanalwahl, die Sperre gegen E-Mail
 * bei rein clientseitigen Ereignissen, die Hysterese der Divergenz-Erkennung
 * und die Übernahme der alten Einzelschalter.
 *
 * Der wichtigste Fall steht gleich zweimal drin: ein Ereignis, das der Server
 * gar nicht erkennen kann, darf NIE eine Mail auslösen — auch dann nicht, wenn
 * in den Einstellungen „E-Mail an" gespeichert ist. Sonst verspricht die
 * Oberfläche etwas, das niemand einlöst.
 *
 * Aufruf: node server/__selftest-benachrichtigungen.mjs
 */
import {
    REGISTER, kanalWahl, mailKonfigVollstaendig, pruefeMailKonfig,
    empfaengerListe, empfaengerFuer, EMPFAENGER_MAX,
} from './benachrichtigungen.js'

let fehler = 0
let bestanden = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Benachrichtigungen')

// ── 1) Register ──────────────────────────────────────────────────────────
pruefe('Register ist nicht leer', REGISTER.length > 0)
pruefe('Kennungen sind eindeutig', new Set(REGISTER.map(e => e.id)).size === REGISTER.length)
pruefe('jede Kennung hat eine Gruppe', REGISTER.every(e => ['markt', 'handel', 'system'].includes(e.gruppe)))
pruefe('Import und KI-Bericht können NICHT mailen',
    REGISTER.find(e => e.id === 'importFertig')?.email === false
    && REGISTER.find(e => e.id === 'kiBerichtFertig')?.email === false)
pruefe('Order-unbekannt kann mailen',
    REGISTER.find(e => e.id === 'strategieOrderUnbekannt')?.email === true)

// ── 2) Kanalwahl: Vorgaben ───────────────────────────────────────────────
// Ohne gespeicherte Wahl soll der Browser melden, die Mail aber schweigen:
// ein Update darf nicht ungefragt Post verschicken.
for (const e of REGISTER) {
    const w = kanalWahl({}, e.id)
    pruefe(`${e.id}: Browser ist voreingestellt an`, w.browser === true)
    pruefe(`${e.id}: E-Mail ist voreingestellt aus`, w.email === false)
}

// ── 3) Kanalwahl: gespeicherte Werte ─────────────────────────────────────
const mitWahl = (obj) => ({ benachrichtigungen: JSON.stringify(obj) })

pruefe('Browser lässt sich abschalten',
    kanalWahl(mitWahl({ fundingDivergenz: { browser: false } }), 'fundingDivergenz').browser === false)
pruefe('E-Mail lässt sich einschalten',
    kanalWahl(mitWahl({ fundingDivergenz: { email: true } }), 'fundingDivergenz').email === true)
pruefe('beide Kanäle gleichzeitig',
    (() => {
        const w = kanalWahl(mitWahl({ picycleKreuzung: { browser: true, email: true } }), 'picycleKreuzung')
        return w.browser === true && w.email === true
    })())
pruefe('beide Kanäle aus',
    (() => {
        const w = kanalWahl(mitWahl({ picycleKreuzung: { browser: false, email: false } }), 'picycleKreuzung')
        return w.browser === false && w.email === false
    })())

// Der Kern: gespeichertes „E-Mail an" zählt nicht, wenn der Server das
// Ereignis nicht erkennen kann.
for (const id of ['importFertig', 'kiBerichtFertig']) {
    pruefe(`${id}: E-Mail bleibt aus, auch wenn gespeichert`,
        kanalWahl(mitWahl({ [id]: { email: true } }), id).email === false)
}

// Objekt statt Zeichenkette (so kommt es aus der geparsten Settings-Zeile)
pruefe('Kanalwahl auch als Objekt lesbar',
    kanalWahl({ benachrichtigungen: { fundingDivergenz: { email: true } } }, 'fundingDivergenz').email === true)
// Kaputter Inhalt darf nicht werfen, sondern fällt auf die Vorgabe zurück
pruefe('unlesbare Kanalwahl fällt auf Vorgabe zurück',
    kanalWahl({ benachrichtigungen: '{kaputt' }, 'fundingDivergenz').browser === true)
pruefe('unbekanntes Ereignis mailt nie',
    kanalWahl(mitWahl({ gibtsNicht: { email: true } }), 'gibtsNicht').email === false)

// ── 4) SMTP-Konfiguration ────────────────────────────────────────────────
const vollstaendig = {
    mailAktiv: 1, mailHost: 'smtp.example.com', mailPort: 587,
    mailVon: 'a@example.com', mailAn: 'b@example.com',
}
pruefe('vollständige Konfiguration wird erkannt', mailKonfigVollstaendig(vollstaendig) === true)
pruefe('abgeschaltet zählt nicht', mailKonfigVollstaendig({ ...vollstaendig, mailAktiv: 0 }) === false)
for (const feld of ['mailHost', 'mailPort', 'mailVon']) {
    pruefe(`ohne ${feld} unvollständig`,
        mailKonfigVollstaendig({ ...vollstaendig, [feld]: '' }) === false)
}
// Der Empfänger gehört bewusst NICHT dazu: Ein Ereignis mit eigener Liste
// (Lagebericht) braucht den allgemeinen Empfänger nicht.
pruefe('ohne allgemeinen Empfänger bleibt der Zugang gültig',
    mailKonfigVollstaendig({ ...vollstaendig, mailAn: '' }) === true)
pruefe('leere Konfiguration unvollständig', mailKonfigVollstaendig(null) === false)

// Metadaten-Ziele sind nie ein Mailserver, aber DAS SSRF-Ziel schlechthin —
// die Formprüfung muss sie abweisen, das eigene LAN-Relay aber durchlassen.
pruefe('Metadaten-IP 169.254.169.254 wird abgewiesen',
    pruefeMailKonfig({ mailHost: '169.254.169.254' }) !== null)
pruefe('metadata.google.internal wird abgewiesen',
    pruefeMailKonfig({ mailHost: 'metadata.google.internal' }) !== null)
pruefe('.internal-Namen werden abgewiesen',
    pruefeMailKonfig({ mailHost: 'irgendwas.internal' }) !== null)
pruefe('LAN-Relay bleibt erlaubt',
    pruefeMailKonfig({ mailHost: '192.168.178.25' }) === null)
pruefe('öffentlicher SMTP-Anbieter bleibt erlaubt',
    pruefeMailKonfig({ mailHost: 'smtp.gmail.com' }) === null)
// Ein Zugang ohne Benutzernamen ist zulässig: offene Relays im eigenen Netz
// verlangen keine Anmeldung.
pruefe('Zugang ohne Benutzer bleibt gültig',
    mailKonfigVollstaendig({ ...vollstaendig, mailUser: '' }) === true)

// ── 4b) Eigene Empfängerliste (Lagebericht) ──────────────────────────────
/*
 * Der Lagebericht ist das einzige Ereignis mit eigenem Schalter und eigener
 * Liste. Beides muss sich gegenüber der allgemeinen Kanalwahl DURCHSETZEN —
 * sonst entschiede weiterhin die Tabelle unter Benachrichtigungen, obwohl die
 * Oberfläche den Schalter woanders zeigt.
 */
pruefe('Liste trennt bei Komma',
    empfaengerListe('a@x.de,b@y.de').join('|') === 'a@x.de|b@y.de')
pruefe('Liste trennt bei Semikolon, Zeilenumbruch und Leerzeichen',
    empfaengerListe('a@x.de; b@y.de\nc@z.de d@w.de').length === 4)
pruefe('ungültige Adressen fliegen still raus',
    empfaengerListe('a@x.de, kaputt, @nix.de, b@y.de').join('|') === 'a@x.de|b@y.de')
pruefe('doppelte Adressen fallen weg — auch mit anderer Schreibweise',
    empfaengerListe('a@x.de, A@X.DE').length === 1)
pruefe('die erste Schreibweise bleibt erhalten',
    empfaengerListe('Anna@X.de, anna@x.de')[0] === 'Anna@X.de')
pruefe('leeres Feld ergibt leere Liste', empfaengerListe('').length === 0)
pruefe('null ergibt leere Liste', empfaengerListe(null).length === 0)
pruefe(`höchstens ${EMPFAENGER_MAX} Empfänger`,
    empfaengerListe(Array.from({ length: 40 }, (_, i) => `n${i}@x.de`).join(',')).length === EMPFAENGER_MAX)

const mitListe = { radarNewsMailAktiv: 1, radarNewsMailAn: 'a@x.de, b@y.de', mailAn: 'allgemein@x.de' }
pruefe('eigene Liste schlägt den allgemeinen Empfänger',
    empfaengerFuer(mitListe, 'lageberichtFertig').join('|') === 'a@x.de|b@y.de')
pruefe('leere eigene Liste fällt auf den allgemeinen Empfänger zurück',
    empfaengerFuer({ ...mitListe, radarNewsMailAn: '' }, 'lageberichtFertig').join('|') === 'allgemein@x.de')
pruefe('ein Ereignis ohne eigene Spalte nimmt immer den allgemeinen Empfänger',
    empfaengerFuer(mitListe, 'neueVersion').join('|') === 'allgemein@x.de')

pruefe('eigener Schalter an → Mail, obwohl die Kanalwahl sie aus hat',
    kanalWahl({ ...mitListe, benachrichtigungen: { lageberichtFertig: { email: false } } },
        'lageberichtFertig').email === true)
pruefe('eigener Schalter aus → keine Mail, obwohl die Kanalwahl sie an hat',
    kanalWahl({ radarNewsMailAktiv: 0, benachrichtigungen: { lageberichtFertig: { email: true } } },
        'lageberichtFertig').email === false)
pruefe('der Browser-Kanal bleibt bei der allgemeinen Wahl',
    kanalWahl({ radarNewsMailAktiv: 0, benachrichtigungen: { lageberichtFertig: { browser: false } } },
        'lageberichtFertig').browser === false)
pruefe('der Lagebericht ist als eigene Stelle markiert',
    REGISTER.find(e => e.id === 'lageberichtFertig')?.eigeneStelle === 'nachrichten')
pruefe('sonst hat kein Ereignis eine eigene Stelle',
    REGISTER.filter(e => e.eigeneStelle).length === 1)

// ── 5) Hysterese der Divergenz-Meldung (Browser-Kanal) ───────────────────
/**
 * Nachbau der Schleife aus Marktradar.vue — dieselbe Regel, isoliert prüfbar.
 * Die Zeilen kommen als `divergenzMaerkte` vom Server: die Auswahl der Märkte
 * trifft dort `marktradar-api.js`, hier steht nur noch die Entprellung.
 */
function lauf(folge, schwelle) {
    let merker = {}
    const meldungen = []
    for (const [i, beobachtet] of folge.entries()) {
        const gemeldet = { ...merker }
        for (const r of beobachtet) {
            const punkte = r.delta == null ? 0 : Math.abs(r.delta) * 100
            if (punkte < schwelle * 0.7) { delete gemeldet[r.symbol]; continue }
            if (punkte < schwelle) continue
            const richtung = r.delta > 0 ? 'binance' : 'bybit'
            if (gemeldet[r.symbol] === richtung) continue
            gemeldet[r.symbol] = richtung
            meldungen.push(`t${i}:${r.symbol}:${richtung}`)
        }
        merker = gemeldet
    }
    return meldungen
}
const d = (v) => [{ symbol: 'ADAUSDT', delta: v === null ? null : v / 100 }]
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b)

pruefe('meldet einmal, dann Ruhe',
    gleich(lauf([d(20), d(20), d(21)], 15), ['t0:ADAUSDT:binance']))
pruefe('unter der Schwelle schweigt es', gleich(lauf([d(9), d(12)], 15), []))
// Der eigentliche Zweck der Hysterese: ADA lag am 17.08.2026 bei knapp
// 11 Punkten und hätte sonst bei jedem Abruf neu gemeldet.
pruefe('Pendeln um die Schwelle meldet nicht erneut',
    gleich(lauf([d(16), d(14), d(16), d(13), d(17)], 15), ['t0:ADAUSDT:binance']))
pruefe('deutlicher Rückfall schaltet wieder scharf',
    gleich(lauf([d(20), d(5), d(20)], 15), ['t0:ADAUSDT:binance', 't2:ADAUSDT:binance']))
pruefe('Richtungswechsel meldet erneut',
    gleich(lauf([d(20), d(-20)], 15), ['t0:ADAUSDT:binance', 't1:ADAUSDT:bybit']))
pruefe('verschwundene Divergenz schaltet scharf',
    gleich(lauf([d(20), d(null), d(20)], 15), ['t0:ADAUSDT:binance', 't2:ADAUSDT:binance']))

// ── 6) Übernahme der alten Einzelschalter ────────────────────────────────
/**
 * Nachbau der Migration aus database.js — sie darf niemanden lauter machen,
 * aber auch niemanden dauerhaft stumm schalten.
 *
 * Der Hauptschalter `browserNotifications` gehört ausdrücklich NICHT hinein:
 * er wird in notify.js ohnehin zuerst geprüft. Ihn zusätzlich in jedes
 * Ereignis zu schreiben wäre eine Falle — wer ihn später wieder einschaltet,
 * bekäme trotzdem nichts. (Genau das ist beim ersten Anlauf passiert und
 * deshalb steht hier ein eigener Test dafür.)
 */
function uebernahme(s) {
    const wahl = {}
    if (Number(s.radarPicycleAlarm ?? 1) !== 1) {
        wahl.picycleKreuzung = { browser: false, email: false }
        wahl.picycleVorwarnung = { browser: false, email: false }
    }
    if (Number(s.radarFundingDivergenz ?? 15) === 0) {
        wahl.fundingDivergenz = { browser: false, email: false }
    }
    return wahl
}

pruefe('unveränderte Vorgaben erzeugen keine Einträge',
    Object.keys(uebernahme({ browserNotifications: 1, radarPicycleAlarm: 1, radarFundingDivergenz: 15 })).length === 0)
// Der Hauptschalter darf NICHT in die Einzelwahl durchschlagen, sonst bleibt
// nach dem Wiedereinschalten alles stumm — ohne erkennbaren Grund.
pruefe('Hauptschalter schlägt nicht auf die Einzelwahl durch',
    Object.keys(uebernahme({ browserNotifications: 0 })).length === 0)
pruefe('abgeschalteter Pi-Cycle-Alarm überträgt sich',
    (() => {
        const w = uebernahme({ radarPicycleAlarm: 0 })
        return w.picycleKreuzung.browser === false && w.picycleVorwarnung.browser === false
            && w.fundingDivergenz === undefined
    })())
pruefe('Divergenz-Schwelle 0 schaltet das Ereignis ab',
    uebernahme({ radarFundingDivergenz: 0 }).fundingDivergenz.browser === false)
// Die Übernahme darf niemals einen E-Mail-Kanal öffnen — Post verschickt man
// nicht ungefragt, auch nicht bei einer Migration.
pruefe('E-Mail wird nie durch die Übernahme eingeschaltet',
    [{ radarPicycleAlarm: 0 }, { radarFundingDivergenz: 0 }, { browserNotifications: 0 }]
        .every(s => Object.values(uebernahme(s)).every(v => v.email === false)))

// ── 7) Altersprüfung der Pi-Cycle-Kreuzung ───────────────────────────────
/*
 * `market_snapshots.dayUnix` steht in MILLISEKUNDEN, obwohl der Name Sekunden
 * nahelegt (geschrieben mit `tagesBeginn(ms)`). Eine Umrechnung mit `* 1000`
 * ergab das Jahr 53250, machte das Alter negativ und hebelte damit die Sperre
 * aus — verschickt worden wäre eine Meldung über die Kreuzung vom 13.04.2021.
 * Der echte Datenbankwert steht deshalb als fester Wert im Test.
 */
const TAG = 86400000
const meldetKreuzung = (dayUnix, jetzt = Date.now()) => {
    const alterTage = (jetzt - Number(dayUnix)) / TAG
    return Number.isFinite(alterTage) && alterTage >= 0 && alterTage <= 14
}
pruefe('Kreuzung von 2021 wird nicht nachgemeldet', meldetKreuzung(1618272000000) === false)
pruefe('frische Kreuzung meldet', meldetKreuzung(Date.now() - 3 * TAG) === true)
pruefe('Kreuzung von gerade eben meldet', meldetKreuzung(Date.now()) === true)
pruefe('Kreuzung vor 20 Tagen schweigt', meldetKreuzung(Date.now() - 20 * TAG) === false)
// Eine Kreuzung in der Zukunft heisst: die Einheit stimmt nicht. Lieber
// schweigen als einen Fehlalarm über das wichtigste Ereignis der App.
pruefe('Zeitstempel aus der Zukunft schweigt', meldetKreuzung(Date.now() + 5 * TAG) === false)
pruefe('als Sekunden gelesen käme die Zukunft heraus — und muss schweigen',
    meldetKreuzung(1618272000000 * 1000) === false)

// Zählbare Schlussmeldung: `scripts/run-selftests.mjs` liest genau dieses
// Format. Ohne sie zählt der Sammellauf die ganze Datei als EINE Prüfung.
console.log(`\n${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
