/**
 * Indikator-Vorlagen des Chart-Arbeitsplatzes — die reine Prüfregel.
 *
 * Eine Vorlage ist eine benannte Indikatorliste (Typ, Parameter, Farben,
 * sichtbar), die man auf jeden Chart anwenden kann — wie die „Indicator
 * Templates" bei TradingView. Sie gehört bewusst NICHT zum Layout: dieselbe
 * Vorlage soll auf BTC im 1h-Layout und auf SOL im 4er-Raster passen.
 *
 * Geprüft wird nur die FORM, nicht ob der Typ bekannt ist: das Register lebt
 * im Browser (`indikatorRegister.js`) und wächst; ein Typ, den ein älterer
 * Stand nicht kennt, überspringt der Browser beim Zeichnen ohnehin, und
 * `saubereParams` setzt unbekannte oder kaputte Parameter auf ihre Vorgabe.
 * IDs werden NICHT gespeichert — beim Anwenden bekommt jede Instanz eine neue,
 * sonst trügen zwei Panels dieselbe.
 */

export const MAX_VORLAGE_INDIKATOREN = 30
export const MAX_VORLAGE_BYTES = 64 * 1024
const TYP_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/

function flachesObjekt(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {}
    const aus = {}
    for (const [k, v] of Object.entries(o)) {
        if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k)) continue
        if (typeof v === 'number' && Number.isFinite(v)) aus[k] = v
        else if (typeof v === 'boolean') aus[k] = v
        else if (typeof v === 'string' && v.length <= 40) aus[k] = v
    }
    return aus
}

/**
 * Indikatorliste einer Vorlage säubern.
 * @returns {{ ok: true, indikatoren: Array } | { ok: false, fehler: string }}
 */
export function saubereVorlage(eingabe) {
    if (!Array.isArray(eingabe)) return { ok: false, fehler: 'indikatoren muss eine Liste sein' }
    if (!eingabe.length) return { ok: false, fehler: 'Eine Vorlage braucht mindestens einen Indikator' }
    if (eingabe.length > MAX_VORLAGE_INDIKATOREN) return { ok: false, fehler: `Höchstens ${MAX_VORLAGE_INDIKATOREN} Indikatoren je Vorlage` }
    const indikatoren = []
    for (const e of eingabe) {
        const typ = String(e?.typ || '')
        if (!TYP_RE.test(typ)) continue
        indikatoren.push({
            typ,
            params: flachesObjekt(e.params),
            farben: flachesObjekt(e.farben),
            sichtbar: e.sichtbar !== false,
        })
    }
    if (!indikatoren.length) return { ok: false, fehler: 'Keine gültigen Indikatoren' }
    if (JSON.stringify(indikatoren).length > MAX_VORLAGE_BYTES) return { ok: false, fehler: 'Vorlage zu gross' }
    return { ok: true, indikatoren }
}
