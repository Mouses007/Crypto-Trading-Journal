/**
 * Echte Marktbeispiele zu den Strukturkarten — eingefrorene Binance-Kerzen.
 *
 * WARUM EINGEFROREN und nicht live geholt: Ein Leitner-Kasten lebt von
 * Wiedererkennung. In drei Tagen dieselbe Karte, dasselbe Bild — holt sie
 * live, ist es jedes Mal ein anderer Ausschnitt, und die Beschriftung wird
 * zur Laufzeit berechnet. Ein Fehlgriff faellt dann niemandem auf. Ausserdem
 * waere eine Lernkarte, die kaputt ist, wenn Binance klemmt, die falsche
 * Sorte Abhaengigkeit.
 *
 * WARUM NUR ZWEI KARTEN: Fair Value Gap und gleiche Hochs sind ohne Willkuer
 * definiert — drei Kerzen bzw. eine Toleranz, die im Bild dabeisteht. BOS,
 * CHoCH, Order Block, Breaker, Mitigation und Inducement haengen dagegen an
 * der Definition von Hoch und Tief, und genau deren Beliebigkeit ist der
 * Inhalt der jeweiligen Karte. Ein Beispiel dafuer zu erzeugen hiesse, die
 * Karte mit der Regel zu bebildern, vor der sie warnt — man saehe dann nicht
 * mehr, was ein CHoCH ist, sondern was ein bestimmter Detektor so nennt.
 *
 * Gefunden mit `scripts/lernkarten-beispiel-suchen.mjs`, das Kandidaten nur
 * VORSCHLAEGT; uebernommen wurde nach Ansicht des Bildes.
 *
 * Kerzenform: [t, o, h, l, c].
 */

const BREITE = 460
const HOEHE = 200
const PLOT = { x0: 30, x1: 452, y0: 40, y1: 168 }

const F = {
    hoch: '#22c55e', tief: '#ef4444', text: '#9ca3af', achse: '#374151',
    marke: '#f59e0b', zone: 'rgba(245,158,11,0.18)', zoneRand: 'rgba(245,158,11,0.6)',
    liq: 'rgba(96,165,250,0.20)', liqRand: '#60a5fa',
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

const txt = (x, y, s, o = {}) =>
    `<text x="${x}" y="${y}" fill="${o.farbe || F.text}" font-size="${o.gr || 10}"`
    + ` font-family="system-ui,sans-serif" text-anchor="${o.anker || 'start'}"`
    + `${o.fett ? ' font-weight="600"' : ''}>${esc(s)}</text>`

/**
 * Kerzen eines eingefrorenen Fensters zeichnen, mit einer Marke darauf.
 *
 * Rein: Daten rein, SVG-Text raus. Dieselbe Layout-Regel wie die Schemata --
 * Beschriftung nur im oberen oder unteren Band, die Mitte gehoert dem Chart.
 *
 * @param {object} b        Eintrag aus BEISPIELE
 * @returns {string} SVG-Quelltext
 */
/**
 * Beschriftung einer Luecke — AUS DEN KERZEN, nicht von Hand.
 *
 * Das erste eingefrorene Beispiel war baerisch, trug aber die Beschriftung des
 * bullischen Falls („Hoch der 1. und Tief der 3."). Der Selbsttest rechnete
 * richtungsabhaengig und war deshalb gruen: Er prueft Zahlen, nicht Text. Wer
 * im Bild nach dem „Hoch der 1. Kerze" suchte, fand dort keine Bandkante.
 *
 * Seitdem faellt der Satz aus denselben Daten wie die Kante. Der Spiegelfall
 * wird ausdruecklich benannt, weil das Schema daneben die Aufwaertsluecke
 * zeigt und die beiden Bilder sich sonst zu widersprechen scheinen.
 */
function bandTitel(b, m) {
    const a1 = b.kerzen[m.ab - 2], a3 = b.kerzen[m.ab]
    return a3[3] > a1[2]
        ? `${b.titel} — Luecke zwischen HOCH der 1. und TIEF der 3. Kerze (aufwaerts)`
        : `${b.titel} — Luecke zwischen TIEF der 1. und HOCH der 3. Kerze (abwaerts, Spiegelfall zum Schema)`
}

export function zeichneBeispiel(b) {
    const k = b.kerzen.map(([t, o, h, l, c]) => ({ t, o, h, l, c }))
    if (!k.length) return ''
    const hoch = Math.max(...k.map(x => x.h))
    const tief = Math.min(...k.map(x => x.l))
    const luft = (hoch - tief) * 0.08 || 1
    const pMax = hoch + luft, pMin = tief - luft
    const y = (p) => PLOT.y1 - ((p - pMin) / (pMax - pMin)) * (PLOT.y1 - PLOT.y0)
    const schritt = (PLOT.x1 - PLOT.x0) / k.length
    const x = (i) => PLOT.x0 + schritt * (i + 0.5)
    const dick = Math.max(2, Math.min(7, schritt * 0.62))

    const kerzen = k.map((c, i) => {
        const farbe = c.c >= c.o ? F.hoch : F.tief
        const oben = y(Math.max(c.o, c.c))
        const h = Math.max(Math.abs(y(c.o) - y(c.c)), 1)
        return `<line x1="${x(i).toFixed(1)}" y1="${y(c.h).toFixed(1)}" x2="${x(i).toFixed(1)}"`
            + ` y2="${y(c.l).toFixed(1)}" stroke="${farbe}" stroke-width="1"/>`
            + `<rect x="${(x(i) - dick / 2).toFixed(1)}" y="${oben.toFixed(1)}" width="${dick.toFixed(1)}"`
            + ` height="${h.toFixed(1)}" fill="${farbe}"/>`
    }).join('')

    const marken = []
    for (const m of b.marken || []) {
        if (m.art === 'band') {
            const yo = y(m.oben), yu = y(m.unten)
            marken.push(`<rect x="${x(m.ab).toFixed(1)}" y="${yo.toFixed(1)}"`
                + ` width="${(PLOT.x1 - x(m.ab)).toFixed(1)}" height="${Math.max(yu - yo, 2).toFixed(1)}"`
                + ` fill="${F.zone}" stroke="${F.zoneRand}" stroke-width="1" rx="1"/>`)
        }
        if (m.art === 'linie') {
            marken.push(`<line x1="${PLOT.x0}" y1="${y(m.preis).toFixed(1)}" x2="${PLOT.x1}"`
                + ` y2="${y(m.preis).toFixed(1)}" stroke="${F.liqRand}" stroke-width="1" stroke-dasharray="3 3"/>`)
            marken.push(`<rect x="${PLOT.x0}" y="${(y(m.preis) - 16).toFixed(1)}" width="${PLOT.x1 - PLOT.x0}"`
                + ` height="16" fill="${F.liq}" stroke="${F.liqRand}" stroke-width="1"`
                + ` stroke-dasharray="4 3" rx="1"/>`)
            for (const i of m.punkte || []) {
                marken.push(`<circle cx="${x(i).toFixed(1)}" cy="${y(m.preis).toFixed(1)}" r="3" fill="${F.liqRand}"/>`)
            }
        }
    }

    const datum = new Date(k[0].t).toLocaleDateString('de-CH', { timeZone: 'UTC' })
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BREITE} ${HOEHE}" width="${BREITE}" height="${HOEHE}">`
        + txt(8, 18, (b.marken || []).find(m => m.art === 'band')
            ? bandTitel(b, b.marken.find(m => m.art === 'band')) : b.titel,
            { farbe: F.marke, gr: 9.5 })
        + `<line x1="${PLOT.x0}" y1="${PLOT.y1 + 6}" x2="${PLOT.x1}" y2="${PLOT.y1 + 6}" stroke="${F.achse}" stroke-width="1"/>`
        + marken.join('') + kerzen
        + txt(8, 194, `${b.symbol} · ${b.intervall} · ${datum} · ${b.regel}`, { gr: 9 })
        + '</svg>'
}

const BEISPIELE = {
    fairValueGap: {
        titel: 'Echtes Beispiel',
        symbol: 'BTCUSDT', intervall: '5m',
        regel: 'Kanten aus den Kerzen gerechnet, nicht gesetzt',
        marken: [{ art: 'band', unten: 79823, oben: 79923.7, ab: 21 }],
        kerzen: [[1788630600000,80018,80065.9,80010,80032.2],
        [1788630900000,80032.2,80050,79995.3,80030],
        [1788631200000,80030.1,80049.5,79978.6,79998],
        [1788631500000,79998.1,80052.9,79977.1,79977.1],
        [1788631800000,79977.1,79977.2,79936.2,79969.6],
        [1788632100000,79969.6,79993.6,79938,79989.6],
        [1788632400000,79989.5,79989.6,79951.4,79965.4],
        [1788632700000,79965.5,79968.1,79912.3,79915.9],
        [1788633000000,79916,80018,79915.9,79949.5],
        [1788633300000,79949.5,79961.6,79942.6,79943.3],
        [1788633600000,79943.4,79962.7,79896.1,79940.1],
        [1788633900000,79940,79940.1,79908.5,79910.9],
        [1788634200000,79910.9,79931.2,79892.6,79919],
        [1788634500000,79919,79968.9,79918.9,79959.2],
        [1788634800000,79959.2,79959.2,79891,79897.8],
        [1788635100000,79897.8,79928.9,79897.7,79913.8],
        [1788635400000,79913.7,79936,79900,79901.5],
        [1788635700000,79901.6,79930,79898,79898],
        [1788636000000,79898.1,79923.8,79859.5,79923.7],
        [1788636300000,79923.8,79950,79923.7,79925.2],
        [1788636600000,79925.1,79935,79740,79748.1],
        [1788636900000,79748.1,79823,79717.8,79723.8],
        [1788637200000,79723.9,79828.8,79723.8,79819.2],
        [1788637500000,79819.3,79820.1,79680.8,79710.1],
        [1788637800000,79710.1,79745,79674.4,79713.2],
        [1788638100000,79713.2,79752,79701.2,79719.9],
        [1788638400000,79719.9,79772.5,79682.9,79683.7],
        [1788638700000,79683.6,79760,79683.6,79713.5],
        [1788639000000,79713.6,79812,79682.7,79705.9],
        [1788639300000,79706,79712.5,79660.2,79663.4],
        [1788639600000,79663.4,79763.6,79653,79763.6],
        [1788639900000,79763.8,79797.1,79670.9,79687.5],
        [1788640200000,79687.5,79710.8,79674.8,79677.3],
        [1788640500000,79677.3,79733.9,79653.4,79682.3],
        [1788640800000,79682.4,79753,79682.4,79753],
        [1788641100000,79752.9,79752.9,79724,79738],
        [1788641400000,79737.9,79766.5,79698.4,79715.9],
        [1788641700000,79715.9,79760.3,79691.5,79702.2],
        [1788642000000,79702.2,79722.1,79695.2,79698.6],
        [1788642300000,79698.6,79743.4,79683,79743.4]],
    },
    equalHighsLows: {
        titel: 'Echtes Beispiel — zwei Hochs auf derselben Marke',
        symbol: 'BTCUSDT', intervall: '5m',
        regel: 'Zwei Pivot-Hochs, Abweichung 0,0005 % — im Fenster nicht ueberschritten',
        marken: [{ art: 'linie', preis: 79734.7, punkte: [4, 36] }],
        kerzen: [[1788610800000,79616.4,79640.5,79616.3,79640.4],
        [1788611100000,79640.4,79644.8,79618.4,79618.4],
        [1788611400000,79618.4,79650,79572.8,79638.5],
        [1788611700000,79638.4,79674,79617.8,79673.9],
        [1788612000000,79674,79734.3,79673.6,79682.8],
        [1788612300000,79682.7,79720,79664.9,79693.2],
        [1788612600000,79693.2,79698.9,79673.3,79698.9],
        [1788612900000,79698.9,79723.8,79666,79666],
        [1788613200000,79666,79673.3,79643,79667.5],
        [1788613500000,79667.5,79672.4,79640,79640],
        [1788613800000,79640,79681.6,79622.8,79681.6],
        [1788614100000,79681.6,79691.2,79630,79657.6],
        [1788614400000,79657.7,79722.7,79657.6,79721],
        [1788614700000,79721,79721.1,79711.6,79712.1],
        [1788615000000,79712.1,79718.8,79672.5,79691.4],
        [1788615300000,79691.3,79691.3,79614.2,79616.2],
        [1788615600000,79616.3,79678.6,79601.6,79616.2],
        [1788615900000,79616.1,79650.3,79616.1,79650.2],
        [1788616200000,79650.3,79650.3,79500,79587.7],
        [1788616500000,79587.8,79590.4,79562,79573.9],
        [1788616800000,79573.8,79636.1,79573.8,79607.9],
        [1788617100000,79607.8,79645.8,79607.8,79645.8],
        [1788617400000,79645.8,79655.9,79630.6,79630.7],
        [1788617700000,79630.8,79640.5,79630.7,79637.7],
        [1788618000000,79637.7,79643.2,79630,79637.6],
        [1788618300000,79637.6,79696.7,79637.5,79685.9],
        [1788618600000,79685.9,79704,79685.8,79704],
        [1788618900000,79704,79708.2,79686.7,79695],
        [1788619200000,79695,79695,79651.2,79673.6],
        [1788619500000,79673.6,79703.4,79673.5,79690.1],
        [1788619800000,79690,79710,79684.8,79710],
        [1788620100000,79710,79719.9,79672.2,79672.3],
        [1788620400000,79672.2,79702.3,79672.2,79700.1],
        [1788620700000,79700.1,79730,79676.2,79678.7],
        [1788621000000,79678.6,79711.1,79672.1,79685.4],
        [1788621300000,79685.4,79685.5,79637.6,79649.7],
        [1788621600000,79649.7,79734.7,79649.7,79713.8],
        [1788621900000,79713.8,79734.7,79648.6,79653],
        [1788622200000,79652.9,79684.2,79652.9,79684.2],
        [1788622500000,79684.2,79699.5,79660.6,79699.4]],
    },
}

/** Fertiges SVG zu einem Kartenschluessel, oder leerer Text. */
export function beispielFuer(schluessel) {
    const b = BEISPIELE[schluessel]
    return b ? zeichneBeispiel(b) : ''
}

export { BEISPIELE }
