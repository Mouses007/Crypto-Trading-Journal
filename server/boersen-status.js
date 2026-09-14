/**
 * Zugangs-Status der Börsen-APIs.
 *
 * Eine Börse sagt nie von selbst, dass ein Schlüssel abgelaufen ist — sie sagt
 * es erst, wenn man anklopft. Am 14.09.2026 lief der Pionex-Schlüssel ab; die
 * Antwort war `[APIKEY_EXPIRED] Apikey has expired`, der Bot verschwand aus den
 * pendenten Trades, und die Seite sah völlig normal aus: der Abruf fing den
 * Fehler ab, meldete `ok: true` mit leerer Liste, und das Frontend meldete
 * ohnehin nur, wenn ALLE Börsen scheiterten. Sichtbar war der Ausfall
 * ausschliesslich im Serverprotokoll.
 *
 * Deshalb hier ein Vermerk je Börse, nach dem Muster von `merkeKiGuthaben`
 * (`llm.js`): beim Fehlschlag gesetzt, beim nächsten erfolgreichen Abruf
 * gelöscht.
 *
 * ── Warum zwei Klassen von Fehlern ───────────────────────────────────────
 *
 * „Zugang weg" (abgelaufen, widerrufen, falsche Signatur, fehlende Berechtigung)
 * und „Börse gerade nicht erreichbar" (Zeitüberschreitung, 502, Ratenlimit)
 * sehen im Code gleich aus, verlangen aber Gegenteiliges: Das erste geht ohne
 * Zutun NIE weg und gehört gemeldet, das zweite ist in zwei Minuten vorbei.
 * Wer beides meldet, bekommt Mails, die meistens unnötig waren — und liest die
 * eine, auf die es ankommt, dann auch nicht mehr.
 *
 * Also: Auf der Seite wird JEDER Fehlschlag angezeigt, solange er anhält
 * (Banner, kostet nichts). Vermerk und Benachrichtigung gibt es nur bei einem
 * Zugangsfehler.
 */
import { getKnex } from './database.js'
import { logWarn } from './logger.js'

/**
 * Sieht diese Meldung danach aus, dass der Zugang selbst nicht mehr gilt?
 *
 * Rein und ohne Datenbank, damit der Selbsttest sie prüfen kann. Die Muster
 * stammen aus den Wortlauten der drei angebundenen Börsen; gesammelt wird auf
 * Textebene statt über Fehlercodes, weil jede Börse eigene Nummern vergibt
 * (Bitunix `10003`, Bitget `40037`, Pionex `APIKEY_EXPIRED`) und eine
 * Nummernliste bei jeder Änderung still veraltet.
 */
export function istZugangsFehler(text) {
    const s = String(text || '')
    if (!s) return false
    // Vorfahrt für das Vorübergehende: „429 Too Many Requests" enthält kein
    // Zugangswort, aber „Signature expired" bei Zeitdrift schon — und das ist
    // kein toter Schlüssel, sondern eine falsch gehende Uhr.
    if (istVoruebergehend(s)) return false
    return [
        /api[-_ ]?key[-_ ]?expired|api[-_ ]?key (has )?expired|key (is |has )?expired/i,
        /invalid[-_ ]?(api[-_ ]?|access[-_ ]?)?(key|secret|passphrase)/i,
        // Dieselbe Aussage in der anderen Wortstellung: Bitunix meldet
        // „apiKey invalid", nicht „invalid apiKey". Ein Muster für beide wäre
        // so weit gefasst, dass es „invalid symbol" mitnähme.
        /(api[-_ ]?key|apikey|access[-_ ]?key|secret ?key|passphrase)[^.]{0,20}(invalid|incorrect|wrong|mismatch)/i,
        /(api[-_ ]?key|access[-_ ]?key|apikey)[^.]{0,20}(does not exist|doesn't exist|not exist|not found|revoked|deleted|disabled)/i,
        /signature (verification )?(failed|invalid|error)|invalid sign/i,
        /permission denied|no permission|insufficient permission|not authorized|unauthorized|forbidden/i,
        /\b(401|403)\b/,
        /ip[^.]{0,20}(not (in )?(the )?white ?list|not allowed|restricted|bound)/i,
        /white ?list[^.]{0,20}(ip|address)/i,
    ].some(r => r.test(s))
}

/**
 * Sieht diese Meldung nach einer vorübergehenden Störung aus?
 *
 * Getrennt geführt und nicht bloss als „nicht Zugangsfehler" behandelt: Der
 * Unterschied entscheidet, ob eine Mail rausgeht, und ein stummes „passt auf
 * kein Muster" wäre die schlechtere Vorgabe.
 */
export function istVoruebergehend(text) {
    const s = String(text || '')
    return [
        /timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up/i,
        /\b(429|500|502|503|504)\b/,
        /too many requests|rate limit|try again later|temporarily unavailable|service unavailable/i,
        /bad gateway|gateway timeout|network error/i,
        /timestamp|time ?stamp|signature expired|recv ?window/i,
    ].some(r => r.test(s))
}

/**
 * Zugangs-Status einer Börse festhalten.
 *
 * `fehler` gesetzt → Zugangsfehler vermerken (mit Meldung und Zeitpunkt) und
 * beim KIPPEN einmal melden; ohne `fehler` → Erfolg, Vermerk löschen.
 *
 * Der Erfolgsfall schreibt bewusst NICHT bei jedem Aufruf: Die pendenten Trades
 * fragen jede Minute je Börse ab, das wären 4320 Schreibzugriffe am Tag für die
 * Auskunft „alles wie gestern". Geschrieben wird nur, wenn sich etwas ändert.
 */
export async function merkeBoersenStatus(broker, fehler = null) {
    try {
        const knex = getKnex()
        const s = await knex('settings').where('id', 1).select('boersenStatus').first()
        let status = {}
        try { status = JSON.parse(s?.boersenStatus || '{}') } catch { /* Altbestand */ }

        const alt = status[broker] || {}

        if (fehler) {
            if (!istZugangsFehler(fehler)) return   // vorübergehend → nur Banner, kein Vermerk
            status[broker] = {
                kaputt: true,
                meldung: String(fehler).slice(0, 200),
                seit: alt.kaputt ? (alt.seit || Date.now()) : Date.now(),
            }
            if (!alt.kaputt) {
                const { melde } = await import('./benachrichtigungen.js')
                melde('boerseKeinZugang', {
                    betreff: `Börsen-Zugang abgelaufen: ${broker}`,
                    text: `Die API von ${broker} weist den hinterlegten Schlüssel zurück.\n\n`
                        + `Meldung: ${String(fehler).slice(0, 300)}\n\n`
                        + 'Solange das anhält, kommen von dieser Börse keine offenen Positionen '
                        + 'mehr an: Pendente Trades bleiben leer, der Import ruht, und ein dort '
                        + 'geschlossener Trade landet nicht im Journal.\n\n'
                        + 'Neuen Schlüssel bei der Börse erzeugen und in den Einstellungen '
                        + 'unter Börsen eintragen.',
                    schluessel: String(broker),
                }).catch(() => { })
            }
        } else {
            if (!alt.kaputt) return   // war schon in Ordnung — nichts zu schreiben
            delete status[broker]
        }

        await knex('settings').where('id', 1).update({ boersenStatus: JSON.stringify(status) })
    } catch (e) {
        logWarn('boersen-status', `Zugangs-Status nicht gespeichert: ${e.message}`)
    }
}

/**
 * Vermerk einer Börse verwerfen — beim Speichern neuer Zugangsdaten.
 *
 * Der Eintrag wird GANZ entfernt statt auf „in Ordnung" gesetzt: Ob der neue
 * Schlüssel taugt, weiss erst der nächste Abruf. „Kein Vermerk" heisst
 * unbekannt, und das ist hier die Wahrheit.
 */
export async function loescheBoersenVermerk(broker) {
    try {
        const knex = getKnex()
        const s = await knex('settings').where('id', 1).select('boersenStatus').first()
        let status = {}
        try { status = JSON.parse(s?.boersenStatus || '{}') } catch { /* Altbestand */ }
        if (!(broker in status)) return false
        delete status[broker]
        await knex('settings').where('id', 1).update({ boersenStatus: JSON.stringify(status) })
        return true
    } catch (e) {
        logWarn('boersen-status', `Zugangs-Vermerk nicht gelöscht: ${e.message}`)
        return false
    }
}

/** Alle Vermerke lesen (für die Übersicht in den Einstellungen). */
export async function holeBoersenStatus() {
    try {
        const knex = getKnex()
        const s = await knex('settings').where('id', 1).select('boersenStatus').first()
        return JSON.parse(s?.boersenStatus || '{}')
    } catch {
        return {}
    }
}

/**
 * Fehlermeldung, die dem Frontend gezeigt werden darf.
 *
 * Bisher antworteten alle drei Börsen-Routen mit „Interner Serverfehler" — der
 * Grund stand nur im Protokoll. Für die Anzeige braucht es den Wortlaut der
 * Börse („Apikey has expired"), sonst kann niemand entscheiden, ob ein neuer
 * Schlüssel fällig ist oder ob die Börse nur gerade hustet.
 *
 * Herausgeschnitten wird, was versehentlich mitkommen könnte: Schlüssel und
 * Signaturen, die in einer URL einer Fehlermeldung stehen. Die Börsen schicken
 * beides im Header, aber der Preis dieser Zeilen ist niedriger als der Preis,
 * sich zu irren.
 */
export function fehlerText(e, max = 200) {
    const roh = String(
        e?.response?.data?.msg || e?.response?.data?.message || e?.message || e || ''
    ) || 'Unbekannter Fehler'
    return roh
        .replace(/([?&](signature|api[-_]?key|access[-_]?key|secret|passphrase|token)=)[^&\s]*/gi, '$1…')
        .replace(/\b[0-9a-f]{32,}\b/gi, '…')
        .slice(0, max)
}
