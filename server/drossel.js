/**
 * Mindestabstand für bezahlte Endpunkte.
 *
 * Es gibt im Server genau eine Ratenbegrenzung, und die schützt den Login vor
 * Durchprobieren. Die Endpunkte, die bei jedem Aufruf ECHTES GELD kosten,
 * hatten bis zum Audit vom 28.08.2026 keine — die „Gesamtlage" ausgenommen,
 * die TTL-Cache, Sperre und Dedup mitbringt.
 *
 * Das Schadensmodell ist hier nicht der Angreifer (er müsste erst ins LAN und
 * das Sitzungs-Cookie haben), sondern der zweite Klick: ein ungeduldiger
 * Nutzer, ein hängender Ladebalken, ein wiederholtes Formular. Deshalb ein
 * Mindestabstand und kein Kontingent.
 *
 * Prozess-lokal und bewusst nicht in der Datenbank: das ist ein
 * Bedienschutz, kein Buchhaltungsproblem. Ein Neustart darf ihn vergessen.
 *
 * Selbsttest: `server/__selftest-drossel.mjs`.
 */

/** Schlüssel -> Zeitpunkt des letzten Durchlassens. */
const zuletzt = new Map()

/**
 * Darf dieser Aufruf laufen?
 *
 * Merkt den Zeitpunkt NUR, wenn durchgelassen wird — sonst würde jeder
 * abgewiesene Versuch die Sperre verlängern, und wer zweimal zu früh klickt,
 * käme nie mehr durch.
 *
 * @param {string} schluessel
 * @param {number} abstandMs
 * @param {number} [jetzt] für den Selbsttest
 * @returns {{ok: boolean, wartenMs: number}}
 */
export function darfLaufen(schluessel, abstandMs, jetzt = Date.now()) {
    const ms = Number(abstandMs) || 0
    if (ms <= 0) return { ok: true, wartenMs: 0 }
    const vorher = zuletzt.get(schluessel)
    if (vorher !== undefined && jetzt - vorher < ms) {
        return { ok: false, wartenMs: Math.max(0, ms - (jetzt - vorher)) }
    }
    zuletzt.set(schluessel, jetzt)
    return { ok: true, wartenMs: 0 }
}

/**
 * Express-Antwort für einen abgewiesenen Aufruf.
 *
 * 429 mit `Retry-After`, damit die Oberfläche die Wartezeit anzeigen kann,
 * statt einen Fehler zu melden, der wie ein Defekt aussieht.
 *
 * @param {object} res
 * @param {number} wartenMs
 */
export function sendeZuFrueh(res, wartenMs) {
    const sekunden = Math.ceil(wartenMs / 1000)
    res.setHeader('Retry-After', String(sekunden))
    return res.status(429).json({
        error: `Zu schnell hintereinander — bitte ${sekunden} s warten.`,
        wartenMs,
    })
}

/** Nur für den Selbsttest: Zustand leeren. */
export function _zuruecksetzen() {
    zuletzt.clear()
}
