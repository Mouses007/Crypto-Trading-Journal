/**
 * Welche Settings-Felder ein News-Profil erfasst.
 *
 * Abgeleitet aus `VALID_SETTINGS_KEYS` statt ein zweites Mal von Hand
 * aufgezählt — bei ~30 Feldern ist eine eigene Kopie genau das Muster, das im
 * Haus schon einmal schiefging (`STANDARD_ALARM_REGELN` vs. `VORGABEN.alarmRegeln`):
 * die Liste hier würde beim nächsten neuen `radarNews*`-Feld nicht mehr
 * automatisch mitwachsen und still hinter der echten Whitelist zurückbleiben.
 *
 * `radarNewsAktivesProfil` wird trotz passendem Präfix ausdrücklich
 * ausgeschlossen: das ist der Zeiger auf das zuletzt angewendete Profil
 * selbst, kein Inhalt, den ein Profil einfrieren sollte.
 */

import { VALID_SETTINGS_KEYS } from './api-routes.js'

const AUSGESCHLOSSEN = new Set(['radarNewsAktivesProfil'])

export const NEWS_PROFIL_FELDER = VALID_SETTINGS_KEYS.filter(
    (k) => k.startsWith('radarNews') && !AUSGESCHLOSSEN.has(k),
)
