/**
 * Einstellungen des Hype-Radars — Lesen, Schreiben, Vorgaben.
 *
 * Sie liegen als Schlüssel-Wert-Paare in `hype_settings`, nicht als Spalten:
 * es sind Listen und Objekte, und sie werden sich noch bewegen, solange das
 * Feature reift. Jede Stellschraube als Spalte hiesse, für jede neue Schraube
 * das Schema zu ändern.
 *
 * Die Schlüssel der Fremdquellen stehen dagegen in `settings` — verschlüsselt,
 * wie alle anderen Zugangsdaten des Hauses auch.
 */

import { getKnex } from '../database.js'
import { encrypt, decrypt } from '../crypto.js'
import { STANDARD_GEWICHTE, STANDARD_NARRATIVE } from './bewertung.js'
import { STANDARD_SICHERHEIT } from './sicherheit.js'

/** Spalten in `settings`, in denen die Schlüssel der Zusatzquellen liegen. */
const SCHLUESSEL_SPALTEN = {
    cryptopanic: 'hypeKeyCryptopanic',
    lunarcrush: 'hypeKeyLunarcrush',
    coingecko: 'hypeKeyCoingecko',
    // Zustellgeheimnisse des Wachhunds. Die Webhook-Adresse gehört dazu:
    // bei Home Assistant IST die Adresse das Geheimnis.
    ntfyToken: 'hypeAlarmNtfyToken',
    telegramToken: 'hypeAlarmTelegramToken',
    webhookUrl: 'hypeAlarmWebhookUrl',
}

export const VORGABEN = {
    aktiv: false,                    // Aus. Wer es will, schaltet es ein.
    intervallStunden: 6,
    ketten: ['solana', 'eth', 'base', 'bsc'],
    quellen: {
        coingecko: true, dexscreener: true, geckoterminal: true,
        // Aus, weil sie Zugangsdaten brauchen. Ein Schalter, der ohne
        // Zugangsdaten „an" steht, erzeugt nur Fehlermeldungen.
        // Reddit gehört seit dem OAuth-Zwang in diese Gruppe (siehe
        // `ausReddit` in quellen.js) — der freie Zugang ist zu.
        reddit: false, cryptopanic: false, lunarcrush: false,
    },
    gewichte: STANDARD_GEWICHTE,
    narrative: STANDARD_NARRATIVE,
    sicherheit: STANDARD_SICHERHEIT,
    /*
     * Schwelle für die Sicherheitsprüfung.
     *
     * Das Konzept schlug 55 vor; im ersten Lauf gegen echte Quellen kam damit
     * genau EIN Fund von 129 durch. Grund: ohne erkanntes Thema deckelt die
     * Rechnung bei rund 40, ein Einzelquellen-Fund liegt typisch bei 35–45.
     * Bei 55 entschied faktisch das Stichwortverzeichnis darüber, was geprüft
     * wird — nicht die Aufmerksamkeit. 35 lässt das obere Drittel durch.
     */
    minHypeScore: 35,
    /*
     * Nur Funde behalten, die Bitunix, Bitget oder Pionex führen.
     *
     * Aus als Vorgabe: der Radar soll zuerst zeigen, was draussen passiert —
     * gerade das noch nirgends Gelistete ist oft das Früheste. Wer nur
     * handeln will, was das eigene Konto hergibt, schaltet den Filter ein.
     */
    nurBoersen: false,
    /*
     * Der Wachhund. Regeln und Kanäle für die Alarme auf Favoriten; die
     * Zustellgeheimnisse (Tokens, Webhook-Adresse) liegen verschlüsselt in
     * `settings` und NICHT hier.
     */
    wachhundIntervallMin: 15,
    alarmRegeln: {
        preisSprungPct: 15,
        preisSturz24hPct: 40,
        liqAbflussPct: 30,
        sicherheitsIntervallH: 6,
    },
    alarmKanaele: {
        ntfy: { an: false, url: '', topic: 'hype-radar', minSchwere: 'info' },
        telegram: { an: false, chatId: '', minSchwere: 'warnung' },
        webhook: { an: false, minSchwere: 'info' },
    },
    berichtTopN: 7,
    llmStufe: 'gruendlich-mittel',
    llmModus: 'gruendlich',
    llmRollen: {},                   // leer = die Stufe entscheidet
    sprache: 'de',
}

/** Alle Einstellungen, mit Vorgaben aufgefüllt. */
export async function leseEinstellungen() {
    const knex = getKnex()
    let zeilen = []
    try {
        zeilen = await knex('hype_settings').select('schluessel', 'wert')
    } catch {
        // Tabelle fehlt noch (älterer Codestand hat die DB angelegt).
        return { ...VORGABEN, schluessel: {} }
    }

    const gespeichert = {}
    for (const z of zeilen) {
        try {
            gespeichert[z.schluessel] = JSON.parse(z.wert)
        } catch {
            // Eine kaputte Zeile darf nicht alle übrigen mitnehmen.
            gespeichert[z.schluessel] = null
        }
    }

    const e = { ...VORGABEN }
    for (const [k, v] of Object.entries(gespeichert)) {
        if (v === null || v === undefined) continue
        // Verschachtelte Objekte auffüllen statt ersetzen: sonst fehlt nach
        // dem Hinzufügen einer neuen Schraube genau diese in alten Ständen.
        e[k] = (typeof v === 'object' && !Array.isArray(v) && typeof VORGABEN[k] === 'object' && !Array.isArray(VORGABEN[k]))
            ? { ...VORGABEN[k], ...v }
            : v
    }

    e.schluessel = await leseSchluessel()
    return e
}

/** Entschlüsselte Schlüssel der Zusatzquellen. */
export async function leseSchluessel() {
    try {
        const s = await getKnex()('settings')
            .select(Object.values(SCHLUESSEL_SPALTEN)).where('id', 1).first()
        const raus = {}
        for (const [name, spalte] of Object.entries(SCHLUESSEL_SPALTEN)) {
            raus[name] = s?.[spalte] ? decrypt(s[spalte]) : ''
        }
        return raus
    } catch {
        return {}
    }
}

/** Einstellungen schreiben. Nur bekannte Schlüssel, damit nichts einsickert. */
export async function schreibeEinstellungen(neu = {}) {
    const knex = getKnex()
    const jetzt = Date.now()

    for (const [k, v] of Object.entries(neu)) {
        if (!(k in VORGABEN)) continue
        const wert = JSON.stringify(v)
        const vorhanden = await knex('hype_settings').where('schluessel', k).first()
        if (vorhanden) {
            await knex('hype_settings').where('schluessel', k)
                .update({ wert, aktualisiertAm: jetzt })
        } else {
            await knex('hype_settings').insert({ schluessel: k, wert, aktualisiertAm: jetzt })
        }
    }
}

/**
 * Schlüssel der Zusatzquellen speichern.
 *
 * Ein maskierter Wert (enthält „•") bedeutet „unverändert lassen" — sonst
 * überschriebe die Oberfläche beim Speichern jedes Formulars die echten
 * Schlüssel mit ihren eigenen Platzhaltern.
 */
export async function schreibeSchluessel(schluessel = {}) {
    const aenderung = {}
    for (const [name, spalte] of Object.entries(SCHLUESSEL_SPALTEN)) {
        const wert = schluessel[name]
        if (wert === undefined || String(wert).includes('•')) continue
        aenderung[spalte] = wert ? encrypt(String(wert)) : ''
    }
    if (Object.keys(aenderung).length) {
        await getKnex()('settings').where('id', 1).update(aenderung)
    }
}

/** Für die Oberfläche: vorhanden ja/nein, aber nie der Schlüssel selbst. */
export function maskiere(schluessel = {}) {
    const raus = {}
    for (const name of Object.keys(SCHLUESSEL_SPALTEN)) {
        const w = schluessel[name]
        raus[name] = w ? `${String(w).slice(0, 3)}••••${String(w).slice(-3)}` : ''
    }
    return raus
}
