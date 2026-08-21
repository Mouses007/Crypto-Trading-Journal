/**
 * Selftest der Mail-Vorlage.
 *
 * Geprüft wird, was im Postfach schiefgehen kann und niemandem auffällt:
 * verschluckte Sonderzeichen, eingeschleustes HTML aus Fremddaten (Symbole
 * und Fehlermeldungen von Börsen/Anbietern landen ungefiltert im Text),
 * Farben, die Outlook verwirft, und die Textfassung für Clients ohne HTML.
 */

import { baueMail, baueKoerper, logoAnhang, TOENE, STUFEN, STUFE_VORGABE, groessen } from './mail-vorlage.js'

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
    const g = groessen(STUFE_VORGABE)
    // Auf feste px zu prüfen wäre eine zweite Quelle für die Grössen — die
    // Aussage ist „Kapitel grösser als Meldung", nicht „15 Pixel".
    pruefe('## wird zur grossen Überschrift',
        h.includes(`font-size:${g.kapitel}px`) && h.includes('Kapitel') && g.kapitel > g.unterkapitel)
    pruefe('### wird zur kleinen Überschrift',
        h.includes(`font-size:${g.unterkapitel}px`) && h.includes('Meldung eins'))
    pruefe('die Marke selbst steht nicht in der Mail', !h.includes('##'))
    const nur = baueMail({ titel: 'x', text: '## Kapitel\n\nText.\n\n### Meldung\n\nMehr.' }).text
    pruefe('Nur-Text: Kapitel unterstrichen', nur.includes('Kapitel\n──────'))
    pruefe('Nur-Text: Meldung ohne Marke', nur.includes('\nMeldung\n') && !nur.includes('###'))
    // Ein Doppelkreuz MITTEN im Satz ist keine Überschrift, sondern Text.
    const kein = baueKoerper('Wir kaufen ## Stück davon.')
    pruefe('## mitten im Satz bleibt stehen',
        kein.includes('Wir kaufen ## Stück davon.') && kein.includes('line-height:1.62'))
}

// Schriftstufen: eine Mail ist nicht zoombar, die Grösse muss beim Bauen
// feststehen — und ausser dem Akzentstreifen darf keine px-Grösse fest im
// Quelltext stehen, sonst wächst beim Umschalten nur ein Teil mit.
{
    const klein = baueMail({ titel: 'T', text: 'Ein Satz.\n\nSymbol: X\nWert: 1', groesse: 'normal' }).html
    const mittel = baueMail({ titel: 'T', text: 'Ein Satz.\n\nSymbol: X\nWert: 1', groesse: 'gross' }).html
    const riesig = baueMail({ titel: 'T', text: 'Ein Satz.\n\nSymbol: X\nWert: 1', groesse: 'sehrGross' }).html
    const px = (html) => [...html.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]))
    const a = px(klein), b = px(mittel), c = px(riesig)
    pruefe('jede Stufe setzt gleich viele Grössen', a.length === b.length && b.length === c.length && a.length > 6)
    pruefe('gross ist überall grösser als normal', a.every((v, i) => b[i] > v))
    pruefe('sehr gross ist überall grösser als gross', b.every((v, i) => c[i] > v))

    const g = groessen('normal')
    pruefe('normal entspricht den Grundwerten', g.fliess === 14 && g.titel === 19)
    pruefe('unbekannte Stufe fällt auf die Vorgabe',
        JSON.stringify(groessen('riesengross')) === JSON.stringify(groessen(STUFE_VORGABE)))
    pruefe('ohne Angabe gilt die Vorgabe',
        baueMail({ titel: 'T', text: 'x' }).html === baueMail({ titel: 'T', text: 'x', groesse: STUFE_VORGABE }).html)
    pruefe('Vorgabe ist grösser als normal', STUFEN[STUFE_VORGABE] > STUFEN.normal)
    // Fest verdrahtete Grössen: erlaubt ist nur der Akzentstreifen (font-size:0).
    const roh = baueMail({ titel: 'T', text: 'x' }).html.replace(/font-size:0;/g, '')
    pruefe('keine Grösse ausserhalb der Stufe', px(roh).every((v) => Object.values(groessen(STUFE_VORGABE)).includes(v)))
    pruefe('Nur-Text-Fassung kennt keine Grössen', !baueMail({ titel: 'T', text: 'x' }).text.includes('font-size'))
}

console.log(`mail-vorlage: ${ok} ok, ${fehler} Fehler`)
process.exit(fehler ? 1 : 0)
