/**
 * Zuletzt benutzter Stil je Zeichenwerkzeug (Farbe, Breite, Strich, Zeilen
 * des Volumenprofils …). Eine neue Zeichnung startet damit statt mit den
 * Werksfarben — wer eine Trendlinie einmal gelb und dick gemacht hat, will
 * die nächste nicht wieder umstellen. Im Browser gemerkt, je Werkzeugtyp.
 * Der Text einer Notiz gehört nicht dazu.
 */
const SCHLUESSEL = 'ctj.chart.zeichenStil'
const NICHT_MERKEN = new Set(['text'])

function alle() {
    try { return JSON.parse(localStorage.getItem(SCHLUESSEL) || '{}') || {} } catch { return {} }
}

export function letzterStil(typ) {
    return { ...(alle()[typ] || {}) }
}

export function merkeStil(typ, stil) {
    if (!typ || !stil) return
    const a = alle()
    a[typ] = Object.fromEntries(Object.entries({ ...(a[typ] || {}), ...stil }).filter(([k]) => !NICHT_MERKEN.has(k)))
    try { localStorage.setItem(SCHLUESSEL, JSON.stringify(a)) } catch { /* privat */ }
}
