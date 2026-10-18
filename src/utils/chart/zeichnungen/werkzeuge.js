/**
 * Die Zeichenwerkzeuge: wie viele Klicks sie brauchen, welches Symbol sie in
 * der Leiste tragen, wie sie aussehen, wenn niemand etwas eingestellt hat.
 *
 * `klicks` = Punkte, die beim Zeichnen gesetzt werden. Die Position braucht
 * zwei Klicks (Einstieg, Ziel), legt aber drei Punkte an — der Stop entsteht
 * gespiegelt bei 1R und wird danach gezogen.
 */
export const WERKZEUGE = [
    { typ: 'trendlinie', icon: 'uil uil-line-alt', klicks: 2, gruppe: 'linien' },
    { typ: 'strahl', icon: 'uil uil-arrow-up-right', klicks: 2, gruppe: 'linien' },
    { typ: 'horizontale', icon: 'uil uil-minus', klicks: 1, gruppe: 'linien' },
    { typ: 'strahlH', icon: 'uil uil-arrow-right', klicks: 1, gruppe: 'linien' },
    { typ: 'vertikale', icon: 'uil uil-grip-horizontal-line', klicks: 1, gruppe: 'linien' },
    { typ: 'kanal', icon: 'uil uil-chart-down', klicks: 3, gruppe: 'formen' },
    { typ: 'rechteck', icon: 'uil uil-square-shape', klicks: 2, gruppe: 'formen' },
    { typ: 'fib', icon: 'uil uil-percentage', klicks: 2, gruppe: 'formen' },
    // Fixed-Range-Volumenprofil: zwei Klicks setzen Anfang und Ende des Bereichs (der Preis ist egal)
    { typ: 'volprofil', icon: 'uil uil-chart-bar-alt', klicks: 2, gruppe: 'formen' },
    { typ: 'position', icon: 'uil uil-crosshair-alt', klicks: 2, gruppe: 'handel' },
    { typ: 'text', icon: 'uil uil-text', klicks: 1, gruppe: 'notiz' },
    { typ: 'messen', icon: 'uil uil-ruler', klicks: 2, gruppe: 'notiz', fluechtig: true },
]

export const werkzeug = (typ) => WERKZEUGE.find((w) => w.typ === typ) || null

export const FARBEN = ['#29b6f6', '#2962ff', '#26a69a', '#ef5350', '#ff9800', '#f5c542', '#ab47bc', '#e0e0e0']

export const STANDARD_STIL = {
    trendlinie: { farbe: '#29b6f6', breite: 2, strich: 'voll', links: false, rechts: false },
    strahl: { farbe: '#29b6f6', breite: 2, strich: 'voll' },
    horizontale: { farbe: '#f5c542', breite: 1, strich: 'voll', text: '' },
    strahlH: { farbe: '#f5c542', breite: 1, strich: 'voll', text: '' },
    vertikale: { farbe: '#e0e0e0', breite: 1, strich: 'gestrichelt' },
    kanal: { farbe: '#2962ff', breite: 1, strich: 'voll', fuellung: true },
    rechteck: { farbe: '#ab47bc', breite: 1, strich: 'voll', fuellung: true, rechts: false, text: '' },
    fib: { farbe: '#8a9199', breite: 1, strich: 'voll', rechts: false },
    // farbe = Kaufvolumen; Verkauf rot, POC gelb. rechts = POC/VAH/VAL bis zum rechten Rand verlängern.
    volprofil: { farbe: '#26a69a', zeilen: 24, rechts: true, einfarbig: false, marken: true },
    position: { breite: 1 },
    text: { farbe: '#e0e0e0', groesse: 13, text: '' },
    messen: { farbe: '#29b6f6' },
}

export function stilFuer(z) {
    return { ...(STANDARD_STIL[z.typ] || {}), ...(z.stil || {}) }
}
