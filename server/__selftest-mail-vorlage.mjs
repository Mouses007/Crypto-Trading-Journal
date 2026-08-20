/**
 * Selftest der Mail-Vorlage.
 *
 * Geprüft wird, was im Postfach schiefgehen kann und niemandem auffällt:
 * verschluckte Sonderzeichen, eingeschleustes HTML aus Fremddaten (Symbole
 * und Fehlermeldungen von Börsen/Anbietern landen ungefiltert im Text),
 * Farben, die Outlook verwirft, und die Textfassung für Clients ohne HTML.
 */

import { baueMail, baueKoerper, logoAnhang, TOENE } from './mail-vorlage.js'

let ok = 0, fehler = 0
function pruefe(name, bedingung, detail = '') {
    if (bedingung) { ok++; return }
    fehler++
    console.error(`  FEHLER: ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── Aufbau ───────────────────────────────────────────────────────────────
{
    const m = baueMail({
        titel: 'Not-Aus aktiv',
        text: 'Erster Absatz.\n\nSymbol: BTCUSDT\nDetail: nichts',
        symbol: '\u{1F6D1}', ton: 'gefahr', bereich: 'Handel · Not-Aus',
        nutzer: 'Rosenberg', zeit: new Date('2026-08-19T12:00:00Z'),
    })
    pruefe('Sinnbild im Betreff', m.betreff.startsWith('\u{1F6D1} '), m.betreff)
    pruefe('Titel im Betreff', m.betreff.includes('Not-Aus aktiv'))
    pruefe('Titel im HTML', m.html.includes('Not-Aus aktiv'))
    pruefe('Rubrik im HTML', m.html.includes('Handel · Not-Aus'))
    pruefe('Nutzername im HTML', m.html.includes('Rosenberg'))
    pruefe('Ton färbt den Akzent', m.html.includes(TOENE.gefahr.akzent))
    pruefe('Logo eingebunden', m.html.includes('cid:ctjlogo'))
    pruefe('Textfassung enthält den Text', m.text.includes('Erster Absatz.'))
    pruefe('Textfassung nennt die Abschaltung', m.text.includes('Benachrichtigungen'))
    pruefe('kein HTML in der Textfassung', !/<[a-z]/i.test(m.text))
}

// ── Ohne Logo kein toter Bildverweis ─────────────────────────────────────
{
    const m = baueMail({ titel: 'T', text: 'x', mitLogo: false })
    pruefe('ohne Anhang kein cid-Bild', !m.html.includes('cid:ctjlogo'))
}

// ── Unbekannter Ton fällt zurück statt zu brechen ────────────────────────
{
    const m = baueMail({ titel: 'T', text: 'x', ton: 'gibtsnicht' })
    pruefe('Rückfall auf info', m.html.includes(TOENE.info.akzent))
    pruefe('Rückfall-Sinnbild', m.betreff.startsWith('•'))
}

// ── Fremddaten dürfen kein HTML einschleusen ─────────────────────────────
{
    const m = baueMail({
        titel: '<img src=x onerror=alert(1)>',
        text: 'Meldung: <script>alert(2)</script>\nSymbol: A&B',
    })
    pruefe('Titel escaped', !m.html.includes('<img src=x'), m.html.slice(0, 200))
    pruefe('Text escaped', !m.html.includes('<script>'))
    pruefe('Ampersand escaped', m.html.includes('A&amp;B'))
}

// ── Blockerkennung ───────────────────────────────────────────────────────
{
    const tabelle = baueKoerper('Symbol: BTCUSDT\nOrder-Kennung: 4711')
    pruefe('Label-Block wird Tabelle', tabelle.includes('<table') && !tabelle.includes('<p '))

    const satz = baueKoerper('Nach dem Senden riss die Verbindung ab: das ist ein Satz.')
    pruefe('Einzelzeile bleibt Absatz', satz.includes('<p ') && !satz.includes('<table'))

    const gemischt = baueKoerper('Einleitung mit Doppelpunkt: hier.\n\nSymbol: X\nWert: 1')
    pruefe('gemischt: Absatz + Tabelle', gemischt.includes('<p ') && gemischt.includes('<table'))

    const lang = baueKoerper('Das ist eine sehr lange Zeile ohne echtes Label, die einen Doppelpunkt weit hinten hat: nämlich hier.\nUnd noch eine solche Zeile mit ganz viel Text davor: und hier.')
    pruefe('langes Pseudo-Label bleibt Absatz', !lang.includes('<table'), lang.slice(0, 120))
}

// ── Verlinkung ───────────────────────────────────────────────────────────
{
    const html = baueKoerper('Siehe https://github.com/Mouses007/Crypto-Trading-Journal/releases sowie danach.')
    pruefe('URL wird Link', html.includes('<a href="https://github.com/Mouses007/Crypto-Trading-Journal/releases"'))
    pruefe('Satzzeichen nicht im Link', !html.includes('releases sowie'))
}

// ── Outlook-Falle: keine rgba/hsl-Farben ─────────────────────────────────
{
    const m = baueMail({ titel: 'T', text: 'Symbol: X\nWert: 1\n\nEin Absatz.' })
    pruefe('keine rgba-Farben', !/rgba?\(/i.test(m.html))
    pruefe('keine hsl-Farben', !/hsla?\(/i.test(m.html))
    pruefe('Tabellenlayout', m.html.includes('role="presentation"'))
}

// ── Logo-Anhang ──────────────────────────────────────────────────────────
{
    const ausDatei = logoAnhang(null)
    pruefe('App-Symbol als Rückfall', ausDatei && ausDatei.cid === 'ctjlogo' && ausDatei.content.length > 100,
        ausDatei ? `${ausDatei.content.length} Bytes` : 'nichts geladen')

    // 1x1-PNG als Profilbild
    const winzig = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const eigen = logoAnhang({ avatar: `data:image/png;base64,${winzig}` })
    pruefe('Profilbild schlägt App-Symbol', eigen && eigen.content.length < 200, `${eigen?.content.length} Bytes`)

    const riesig = logoAnhang({ avatar: `data:image/png;base64,${'A'.repeat(900 * 1024)}` })
    pruefe('zu grosses Profilbild fällt zurück', riesig && riesig.content.length > 100)

    const kaputt = logoAnhang({ avatar: 'https://example.com/bild.png' })
    pruefe('externe URL wird nicht verwendet', kaputt && kaputt.filename === 'logo.png')
}

// Überschriften: zwei Stufen, und in der Nur-Text-Fassung ohne die Marke.
{
    const h = baueKoerper('## Kapitel\n\nText dazu.\n\n### Meldung eins\n\nMehr Text.')
    pruefe('## wird zur grossen Überschrift', h.includes('font-size:15px') && h.includes('Kapitel'))
    pruefe('### wird zur kleinen Überschrift', h.includes('font-size:14px') && h.includes('Meldung eins'))
    pruefe('die Marke selbst steht nicht in der Mail', !h.includes('##'))
    const nur = baueMail({ titel: 'x', text: '## Kapitel\n\nText.\n\n### Meldung\n\nMehr.' }).text
    pruefe('Nur-Text: Kapitel unterstrichen', nur.includes('Kapitel\n──────'))
    pruefe('Nur-Text: Meldung ohne Marke', nur.includes('\nMeldung\n') && !nur.includes('###'))
    // Ein Doppelkreuz MITTEN im Satz ist keine Überschrift, sondern Text.
    const kein = baueKoerper('Wir kaufen ## Stück davon.')
    pruefe('## mitten im Satz bleibt stehen',
        kein.includes('Wir kaufen ## Stück davon.') && kein.includes('line-height:1.62'))
}

console.log(`mail-vorlage: ${ok} ok, ${fehler} Fehler`)
process.exit(fehler ? 1 : 0)
