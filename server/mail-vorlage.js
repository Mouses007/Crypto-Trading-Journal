/**
 * Gestaltung der Benachrichtigungs-Mails.
 *
 * Reine Darstellung: rein kommen Ereignis-Kennung, Betreff und der schon
 * vorhandene Fliesstext, raus gehen Betreff, Textfassung und HTML-Fassung.
 * Kein Netz, keine Datenbank, kein Zustand — deshalb im Selftest prüfbar
 * (`__selftest-mail-vorlage.mjs`).
 *
 * Warum überhaupt HTML: die Meldungen kamen als nackter Text an und sahen im
 * Postfach aus wie eine Cron-Ausgabe. Zwischen hundert anderen Mails erkennt
 * man so weder Absender noch Dringlichkeit. Kopfzeile mit Logo, Sinnbild und
 * Titel geben beides auf einen Blick.
 *
 * Zwei Regeln, die den Aufbau bestimmen:
 *
 *  1. Tabellenlayout und NUR volltonige Hex-Farben. Outlook rendert mit der
 *     Word-Engine: `rgba()` wird dort schlicht verworfen, und eine verworfene
 *     Textfarbe heisst schwarz auf dunklem Grund — also unlesbar.
 *  2. Kein Aufruf verändert seinen Text für die Gestaltung. Die Absätze der
 *     Meldungen sind schon geschrieben; die Vorlage erkennt „Label: Wert"-
 *     Blöcke selbst und macht daraus eine Tabelle. Sonst müsste jede
 *     Meldestelle zweimal gepflegt werden.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const HIER = path.dirname(fileURLToPath(import.meta.url))

/** Farbtöne nach Dringlichkeit — nicht nach Gruppe: ein Not-Aus ist rot,
 *  auch wenn er in derselben Gruppe sitzt wie eine harmlose Meldung. */
export const TOENE = {
    info: { akzent: '#01B4FF', flaeche: '#0d2c3d' },
    gut: { akzent: '#26a69a', flaeche: '#0f2f2c' },
    warnung: { akzent: '#f0a132', flaeche: '#3a2a10' },
    gefahr: { akzent: '#FF6960', flaeche: '#3a1a18' },
}

const FARBEN = {
    seite: '#0f0f11',
    karte: '#17171a',
    rand: '#26262b',
    titel: '#ffffff',
    text: '#d5d7dc',
    leise: '#8b9099',
    sehrLeise: '#6b7079',
}

const SCHRIFT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

/** Rückfallwerte, wenn ein Ereignis (noch) keine eigene Gestaltung hat. */
const VORGABE = { symbol: '•', ton: 'info', bereich: 'Meldung' }

function escape(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

/**
 * URLs anklickbar machen. Läuft NACH dem Escapen, deshalb endet die Erkennung
 * am `&amp;` nicht — die Zeichenklasse lässt `&` und `;` bewusst zu.
 */
function verlinke(escaped) {
    return escaped.replace(/https?:\/\/[^\s<]+[^\s<.,;:)\]]/g, (u) =>
        `<a href="${u}" style="color:#01B4FF;text-decoration:underline;">${u}</a>`)
}

/** „Label: Wert" — Label kurz und ohne Satzzeichen, sonst ist es ein Satz. */
const LABEL_ZEILE = /^([^:]{1,40}):[ \t]+(.+)$/

function istDatenBlock(zeilen) {
    return zeilen.length >= 2 && zeilen.every((z) => LABEL_ZEILE.test(z))
}

function datenTabelle(zeilen) {
    const reihen = zeilen.map((z, i) => {
        const [, label, wert] = z.match(LABEL_ZEILE)
        const oben = i === 0 ? '' : `border-top:1px solid ${FARBEN.rand};`
        // `width:1%` plus `nowrap`: die Labelspalte wird so breit wie ihr
        // längstes Label und keinen Punkt breiter — der Rest gehört dem Wert.
        return `<tr>`
            + `<td width="1%" style="${oben}padding:7px 14px 7px 0;color:${FARBEN.leise};`
            + `font-size:13px;line-height:1.45;white-space:nowrap;vertical-align:top;width:1%;">${escape(label)}</td>`
            + `<td style="${oben}padding:7px 0;color:${FARBEN.text};`
            + `font-size:13px;line-height:1.45;vertical-align:top;">${verlinke(escape(wert))}</td>`
            + `</tr>`
    }).join('')
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"`
        + ` style="width:100%;border-collapse:collapse;margin:14px 0;">${reihen}</table>`
}

/**
 * Zwischenüberschrift: eine Zeile, die mit „## " beginnt.
 *
 * Kam mit dem ganzen Lagebericht in der Mail. Eine Meldung besteht aus zwei
 * Sätzen und braucht keine Gliederung, ein vollständiger Bericht mit drei
 * Kapiteln und einem Dutzend Meldungen schon: ohne Überschriften ist er im
 * Postfach eine Textwand. Bewusst kein Markdown-Dialekt, nur diese eine
 * Marke — alles Weitere wäre eine Auszeichnungssprache im Mailtext.
 */
const UEBERSCHRIFT_ZEILE = /^(##|###)[ \t]+(.+)$/

function istUeberschrift(zeilen) {
    return zeilen.length === 1 && UEBERSCHRIFT_ZEILE.test(zeilen[0])
}

function ueberschrift(zeile) {
    const [, marke, text] = zeile.match(UEBERSCHRIFT_ZEILE)
    // Zwei Stufen, mehr nicht: Kapitel und die einzelne Meldung darin. Ohne die
    // zweite Stufe verschwindet der Titel einer Meldung im Fliesstext, mit
    // einer dritten wäre es eine Auszeichnungssprache.
    const klein = marke === '###'
    return `<p style="margin:${klein ? '18px 0 6px' : '22px 0 8px'};color:${FARBEN.titel};`
        + `font-size:${klein ? '14px' : '15px'};line-height:1.4;font-weight:600;">${escape(text)}</p>`
}

function absatz(zeilen, ersterAbsatz) {
    const stil = ersterAbsatz
        ? `margin:0 0 12px;color:${FARBEN.text};font-size:15px;line-height:1.62;`
        : `margin:0 0 12px;color:${FARBEN.text};font-size:14px;line-height:1.62;`
    return `<p style="${stil}">${verlinke(escape(zeilen.join('\n'))).replace(/\n/g, '<br>')}</p>`
}

/** Fliesstext → HTML. Blöcke sind durch Leerzeilen getrennt, wie im Quelltext. */
export function baueKoerper(text) {
    const bloecke = String(text ?? '').split(/\n{2,}/)
        .map((b) => b.split('\n').map((z) => z.trim()).filter(Boolean))
        .filter((b) => b.length)
    let ersterAbsatz = true
    return bloecke.map((zeilen) => {
        if (istUeberschrift(zeilen)) return ueberschrift(zeilen[0])
        if (istDatenBlock(zeilen)) return datenTabelle(zeilen)
        const html = absatz(zeilen, ersterAbsatz)
        ersterAbsatz = false
        return html
    }).join('')
}

/**
 * Das Logo als Anhang. Bevorzugt das eigene Profilbild aus den Einstellungen
 * (dieselbe Marke wie im Seitenmenü), sonst das App-Symbol.
 *
 * Als Anhang mit `cid:` und nicht als externe URL: die App läuft lokal, eine
 * Bild-URL darauf wäre im Postfach tot. Datei-Inhalt wird gemerkt, der Pfad
 * ändert sich zur Laufzeit nicht.
 */
let logoZwischen = null
export function logoAnhang(settings) {
    const avatar = String(settings?.avatar || '')
    const treffer = avatar.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=\s]+)$/)
    if (treffer) {
        try {
            const inhalt = Buffer.from(treffer[2].replace(/\s/g, ''), 'base64')
            // Ein Profilbild von mehreren Megabyte gehört nicht in jede Mail.
            if (inhalt.length && inhalt.length <= 512 * 1024) {
                return { filename: `logo.${treffer[1]}`, content: inhalt, cid: 'ctjlogo' }
            }
        } catch { /* dann eben das App-Symbol */ }
    }
    if (logoZwischen === null) {
        try {
            logoZwischen = fs.readFileSync(path.join(HIER, '..', 'src', 'assets', 'icon.png'))
        } catch {
            logoZwischen = false
        }
    }
    if (!logoZwischen) return null
    return { filename: 'logo.png', content: logoZwischen, cid: 'ctjlogo' }
}

function kopfzeile(marke, unterzeile, mitLogo) {
    const bild = mitLogo
        ? `<td width="40" valign="middle" style="width:40px;">`
        + `<img src="cid:ctjlogo" width="36" height="36" alt=""`
        + ` style="display:block;width:36px;height:36px;border-radius:9px;"></td>`
        : ''
    return `<tr><td style="padding:18px 24px 0 24px;">`
        + `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`
        + bild
        + `<td valign="middle" style="${mitLogo ? 'padding-left:12px;' : ''}">`
        + `<div style="color:${FARBEN.titel};font-size:12px;font-weight:700;`
        + `letter-spacing:1.6px;text-transform:uppercase;">${escape(marke)}</div>`
        + `<div style="color:${FARBEN.sehrLeise};font-size:11px;padding-top:2px;">${escape(unterzeile)}</div>`
        + `</td></tr></table></td></tr>`
}

/**
 * Eine fertige Mail.
 *
 * @param {object} opt
 * @param {string} opt.titel     Betreffzeile ohne Sinnbild
 * @param {string} opt.text      Fliesstext, Blöcke durch Leerzeilen getrennt
 * @param {string} [opt.symbol]  Sinnbild des Ereignisses
 * @param {string} [opt.ton]     info | gut | warnung | gefahr
 * @param {string} [opt.bereich] Zeile über dem Titel („Handel", „Markt" …)
 * @param {string} [opt.marke]   Absenderzeile, Vorgabe „Crypto Trading Journal"
 * @param {string} [opt.nutzer]  Zusatz in der Unterzeile (Name aus den Einstellungen)
 * @param {Date}   [opt.zeit]    Zeitstempel der Meldung
 * @param {boolean}[opt.mitLogo] false, wenn kein Anhang mitgeschickt wird
 * @returns {{betreff: string, text: string, html: string}}
 */
export function baueMail({ titel, text, symbol, ton, bereich, marke = 'Crypto Trading Journal',
    nutzer = '', zeit = new Date(), mitLogo = true } = {}) {
    const stil = TOENE[ton] || TOENE[VORGABE.ton]
    const zeichen = symbol || VORGABE.symbol
    const rubrik = bereich || VORGABE.bereich
    const stempel = zeit.toLocaleString('de-CH', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
    const unterzeile = [nutzer, stempel].filter(Boolean).join(' · ')

    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">`
        + `<meta name="viewport" content="width=device-width,initial-scale=1">`
        + `<meta name="color-scheme" content="dark light"><title>${escape(titel)}</title></head>`
        + `<body style="margin:0;padding:0;background:${FARBEN.seite};">`
        // Vorschauzeile im Postfach: der erste Satz, nicht die Kopfzeile.
        + `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">`
        + `${escape(String(text || '').split('\n').find(Boolean) || '')}</div>`
        + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"`
        + ` bgcolor="${FARBEN.seite}" style="background:${FARBEN.seite};padding:24px 10px;">`
        + `<tr><td align="center">`
        + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"`
        + ` bgcolor="${FARBEN.karte}" style="width:600px;max-width:100%;background:${FARBEN.karte};`
        + `border:1px solid ${FARBEN.rand};border-radius:14px;font-family:${SCHRIFT};">`
        // Akzentstreifen: Dringlichkeit noch vor dem ersten Wort
        + `<tr><td bgcolor="${stil.akzent}" style="height:4px;line-height:4px;font-size:0;`
        + `background:${stil.akzent};border-radius:14px 14px 0 0;">&nbsp;</td></tr>`
        + kopfzeile(marke, unterzeile, mitLogo)
        + `<tr><td style="padding:16px 24px 0 24px;">`
        + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>`
        + `<td width="48" valign="top" style="width:48px;">`
        + `<div style="width:44px;height:44px;line-height:44px;text-align:center;font-size:22px;`
        + `background:${stil.flaeche};border-radius:11px;">${escape(zeichen)}</div></td>`
        + `<td valign="middle" style="padding-left:14px;">`
        + `<div style="color:${stil.akzent};font-size:11px;font-weight:700;letter-spacing:1.3px;`
        + `text-transform:uppercase;">${escape(rubrik)}</div>`
        + `<div style="color:${FARBEN.titel};font-size:19px;line-height:1.32;font-weight:600;`
        + `padding-top:3px;">${escape(titel)}</div>`
        + `</td></tr></table></td></tr>`
        + `<tr><td style="padding:18px 24px 6px 24px;">${baueKoerper(text)}</td></tr>`
        + `<tr><td style="border-top:1px solid ${FARBEN.rand};padding:14px 24px 18px 24px;`
        + `color:${FARBEN.sehrLeise};font-size:11px;line-height:1.6;">`
        + `Automatische Nachricht aus deinem Trading Journal.<br>`
        + `Welche Ereignisse per Mail kommen, steht unter Einstellungen → Benachrichtigungen.`
        + `</td></tr></table></td></tr></table></body></html>`

    // In der Nur-Text-Fassung wird aus „## Kapitel" eine unterstrichene Zeile —
    // die Marke selbst hat dort nichts zu suchen.
    const textRein = String(text || '').trim().replace(/^(##|###)[ \t]+(.+)$/gm,
        (_, marke, z) => (marke === '###' ? z : `${z}\n${'─'.repeat(Math.min(60, z.length))}`))
    const nurText = `${zeichen} ${titel}\n${'─'.repeat(Math.min(60, titel.length + 2))}\n\n`
        + `${textRein}\n\n`
        + `— ${marke}${nutzer ? ` · ${nutzer}` : ''} · ${stempel}\n`
        + 'Automatische Nachricht. Einstellungen → Benachrichtigungen.\n'

    return { betreff: `${zeichen} ${titel}`, text: nurText, html }
}
