/**
 * Ein Schild für Marken im Chart (LSOB, GUSS, Signal-Ausgänge): abgerundete
 * Pille mit Rand, optional mit einer zweiten, leiseren Zeile und einem
 * kleinen Zeiger zur Kerze. Eine Form für alle, damit Indikatoren
 * nebeneinander gleich lesen.
 *
 *   art 'voll'    kräftige Fläche, weisse Schrift — bestätigte Ereignisse
 *   art 'kontur'  dunkle Fläche, Rand und Schrift in der Farbe — Hinweise
 *   blass         halbe Deckkraft — noch offen / nicht bestätigt
 *   seite         'oben' (Schild über dem Punkt, Zeiger nach unten) | 'unten' | 'rechts'
 */
const SCHRIFT = '600 11px -apple-system, "Segoe UI", Roboto, sans-serif'
const SCHRIFT_KLEIN = '10px -apple-system, "Segoe UI", Roboto, sans-serif'

function rgba(hex, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '')
    if (!m) return hex
    const n = parseInt(m[1], 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

function pille(ctx, x, y, w, h, r) {
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r)
    else ctx.rect(x, y, w, h)
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ text:string, zeile2?:string, x:number, y:number, farbe:string, art?:'voll'|'kontur', blass?:boolean, seite?:'oben'|'unten'|'rechts', abstand?:number }} o
 * @returns {{ x:number, y:number, w:number, h:number }} belegte Fläche
 */
export function zeichneSchild(ctx, { text, zeile2 = '', x, y, farbe, art = 'kontur', blass = false, seite = 'oben', abstand = 7 }) {
    ctx.save()
    ctx.globalAlpha = blass ? 0.55 : 1
    ctx.font = SCHRIFT
    const w1 = ctx.measureText(text).width
    ctx.font = SCHRIFT_KLEIN
    const w2 = zeile2 ? ctx.measureText(zeile2).width : 0
    const w = Math.ceil(Math.max(w1, w2)) + 14
    const h = zeile2 ? 29 : 17
    let x0, y0
    if (seite === 'rechts') { x0 = x + abstand; y0 = y - h / 2 }
    else { x0 = x - w / 2; y0 = seite === 'oben' ? y - h - abstand : y + abstand }

    // Fläche + Rand
    pille(ctx, x0, y0, w, h, h / 2 > 9 ? 6 : h / 2)
    ctx.fillStyle = art === 'voll' ? rgba(farbe, 0.9) : 'rgba(16,22,34,0.88)'
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = art === 'voll' ? rgba(farbe, 1) : rgba(farbe, 0.85)
    ctx.stroke()

    // Zeiger zur Kerze
    ctx.beginPath()
    if (seite === 'oben') { ctx.moveTo(x - 4, y0 + h); ctx.lineTo(x + 4, y0 + h); ctx.lineTo(x, y0 + h + 4) }
    else if (seite === 'unten') { ctx.moveTo(x - 4, y0); ctx.lineTo(x + 4, y0); ctx.lineTo(x, y0 - 4) }
    else { ctx.moveTo(x0, y - 4); ctx.lineTo(x0, y + 4); ctx.lineTo(x0 - 4, y) }
    ctx.closePath()
    ctx.fillStyle = art === 'voll' ? rgba(farbe, 0.9) : rgba(farbe, 0.85)
    ctx.fill()

    // Text
    ctx.textBaseline = 'middle'
    ctx.font = SCHRIFT
    ctx.fillStyle = art === 'voll' ? '#ffffff' : farbe
    ctx.fillText(text, x0 + 7, y0 + (zeile2 ? 9 : h / 2 + 0.5))
    if (zeile2) {
        ctx.font = SCHRIFT_KLEIN
        ctx.fillStyle = art === 'voll' ? 'rgba(255,255,255,0.85)' : 'rgba(230,230,230,0.75)'
        ctx.fillText(zeile2, x0 + 7, y0 + 21)
    }
    ctx.restore()
    return { x: x0, y: y0, w, h }
}
