/**
 * Skizzen zu den Strukturkarten des Lern-Decks.
 *
 * Warum gezeichnet und nicht erzeugt: Diese Bilder tragen eine DEFINITION.
 * Der Unterschied zwischen BOS und CHoCH ist die Lage eines einzigen
 * gebrochenen Punktes; ein Bildgenerator malt plausibel aussehende Kerzen, bei
 * denen genau dieser Punkt falsch liegt — und eine Lernkarte, die das Falsche
 * einpraegt, ist schlechter als eine ohne Bild. Jede Linie hier ist gesetzt.
 *
 * Ausgabe ist SVG-QUELLTEXT, den `seedDefaultLernkarten` in `quiz_karten.bild`
 * schreibt. Die Oberflaeche zeigt ihn als `<img src="data:image/svg+xml,…">`
 * und NICHT ueber `v-html`: In einem `img` fuehrt ein SVG keine Skripte aus,
 * und da Nutzer eigene Karten anlegen duerfen, waere `v-html` an dieser Stelle
 * ein offenes Scheunentor.
 *
 * Farben stehen fest im Bild, nicht als CSS-Variablen: Ein `img` erbt nichts
 * von der Seite. Der Kartenhintergrund ist immer schwarz (`.lernen-karteikarte`),
 * darauf sind diese Werte abgestimmt.
 */

const BREITE = 460
const HOEHE = 200

const F = {
    hoch: '#22c55e',        // steigende Kerze
    tief: '#ef4444',        // fallende Kerze
    linie: '#6b7280',       // Hilfslinien
    text: '#9ca3af',
    marke: '#f59e0b',       // die Aussage des Bildes
    zone: 'rgba(245,158,11,0.18)',
    zoneRand: 'rgba(245,158,11,0.55)',
    liq: 'rgba(96,165,250,0.22)',
    liqRand: '#60a5fa',
}

/** Eine Kerze: x = Mitte, o/c/h/l in Bildkoordinaten (y waechst nach unten). */
function kerze(x, o, c, h, l, breit = 9) {
    const farbe = c <= o ? F.hoch : F.tief          // y invertiert: kleiner = hoeher
    const oben = Math.min(o, c)
    const hoehe = Math.max(Math.abs(c - o), 2)
    return `<line x1="${x}" y1="${h}" x2="${x}" y2="${l}" stroke="${farbe}" stroke-width="1.5"/>`
        + `<rect x="${x - breit / 2}" y="${oben}" width="${breit}" height="${hoehe}" fill="${farbe}" rx="1"/>`
}

const text = (x, y, s, opt = {}) =>
    `<text x="${x}" y="${y}" fill="${opt.farbe || F.text}" font-size="${opt.gr || 11}"`
    + ` font-family="system-ui,sans-serif" text-anchor="${opt.anker || 'start'}"`
    + `${opt.fett ? ' font-weight="600"' : ''}>${s}</text>`

const linie = (x1, y1, x2, y2, opt = {}) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${opt.farbe || F.linie}"`
    + ` stroke-width="${opt.dick || 1}"${opt.strich ? ` stroke-dasharray="${opt.strich}"` : ''}/>`

const kasten = (x, y, w, h, opt = {}) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${opt.fuell || F.zone}"`
    + ` stroke="${opt.rand || F.zoneRand}" stroke-width="1" rx="2"${opt.strich ? ` stroke-dasharray="${opt.strich}"` : ''}/>`

const pfeil = (x1, y1, x2, y2, farbe = F.marke) =>
    `<defs><marker id="s${Math.round(x1 + y1 + x2 + y2)}" markerWidth="6" markerHeight="6" refX="5" refY="3"`
    + ` orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="${farbe}"/></marker></defs>`
    + `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${farbe}" stroke-width="1.5"`
    + ` marker-end="url(#s${Math.round(x1 + y1 + x2 + y2)})"/>`

const svg = (inhalt) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BREITE} ${HOEHE}" width="${BREITE}" height="${HOEHE}">`
    + inhalt + '</svg>'

/* ── Die Skizzen ──────────────────────────────────────────────────────────
 *
 * EINE LAYOUT-REGEL, an die sich alle halten: Beschriftungen stehen im
 * oberen Band (y < 30) oder im unteren (y > 182), die Mitte gehoert dem
 * Chart. Der erste Anlauf setzte Text dorthin, wo gerade Platz schien —
 * danach lagen Kerzen ueber Woertern, und bei einer Karte lief die Zeile
 * ueber den rechten Rand hinaus. Auf einem Bild, das eine Definition tragen
 * soll, ist eine verdeckte Beschriftung derselbe Fehler wie eine falsche.
 */

const BILDER = {}

/**
 * BOS gegen CHoCH.
 *
 * Aufwaertsstruktur aus hoeheren Hochs und hoeheren Tiefs. Der Bruch des
 * letzten HOCHS bestaetigt sie (BOS), der Bruch des letzten TIEFS bricht sie
 * zum ersten Mal (CHoCH). Beide Marken stehen bewusst auf derselben
 * Zeichnung — der Unterschied ist die Lage, nicht die Form.
 */
BILDER.bosChoch = svg([
    text(8, 18, 'Aufwaertsstruktur: hoehere Hochs, hoehere Tiefs', { gr: 10 }),
    linie(30, 66, 340, 66, { farbe: F.linie, strich: '3 3' }),
    text(34, 62, 'letztes Hoch', { gr: 10 }),
    linie(30, 130, 452, 130, { farbe: F.linie, strich: '3 3' }),
    text(34, 126, 'letztes Tief', { gr: 10 }),
    `<polyline points="30,168 76,104 108,142 152,66 194,130 240,48 288,112 330,130 372,172"
        fill="none" stroke="#e5e7eb" stroke-width="2" stroke-linejoin="round"/>`,
    `<circle cx="240" cy="48" r="4" fill="${F.marke}"/>`,
    text(252, 44, 'BOS', { farbe: F.marke, fett: true }),
    `<circle cx="352" cy="150" r="4" fill="${F.tief}"/>`,
    text(364, 154, 'CHoCH', { farbe: F.tief, fett: true }),
    text(8, 194, 'BOS bestaetigt den Trend — CHoCH bricht ihn zum ersten Mal.', { gr: 10 }),
].join(''))

/**
 * Order Block: die letzte GEGENFARBIGE Kerze vor der impulsiven Bewegung.
 * Die Zone deckt genau ihren Koerper — nicht den Docht, nicht die Nachbarn.
 */
BILDER.orderBlock = svg([
    text(8, 18, 'Order Block — Koerper der letzten roten Kerze vor dem Impuls', { farbe: F.marke, gr: 10 }),
    kasten(40, 118, 412, 24),
    kerze(62, 118, 142, 110, 150),
    kerze(94, 138, 96, 92, 144),
    kerze(126, 96, 62, 56, 100),
    kerze(158, 62, 44, 38, 68),
    kerze(190, 46, 58, 40, 64),
    kerze(222, 58, 80, 52, 86),
    kerze(254, 80, 106, 74, 112),
    kerze(286, 106, 132, 100, 138),
    kerze(318, 132, 98, 90, 140),
    kerze(350, 98, 68, 62, 102),
    kerze(382, 68, 46, 40, 72),
    pfeil(286, 176, 286, 148),
    text(8, 194, 'Der Kurs kehrt an die Zone zurueck und laeuft weiter.', { gr: 10 }),
].join(''))

/**
 * Fair Value Gap: die Luecke zwischen dem HOCH der ersten und dem TIEF der
 * dritten Kerze. Genau diese beiden Kanten sind beschriftet — an ihnen haengt
 * die Definition, alles andere im Bild ist Beiwerk.
 */
BILDER.fairValueGap = svg([
    text(8, 18, 'Fair Value Gap — Luecke zwischen Hoch der 1. und Tief der 3. Kerze', { farbe: F.marke, gr: 10 }),
    kasten(96, 84, 356, 34),
    // Das Hoch dieser Kerze IST die untere Bandkante — im ersten Anlauf lag es
    // bei 148 und die Linie bei 118: Das Bild behauptete eine Kante, die die
    // Kerze nicht hergab. Bei einer Skizze, die eine Definition traegt, ist das
    // kein Schoenheitsfehler, sondern eine falsche Aussage.
    kerze(96, 150, 124, 118, 158, 16),
    linie(96, 118, 452, 118, { farbe: F.zoneRand, strich: '3 3' }),
    kerze(150, 126, 62, 54, 132, 18),
    kerze(204, 64, 44, 40, 84, 16),
    linie(204, 84, 452, 84, { farbe: F.zoneRand, strich: '3 3' }),
    kerze(250, 48, 60, 44, 66, 12),
    kerze(282, 60, 90, 56, 96, 12),
    text(60, 138, 'Hoch 1', { gr: 10, anker: 'end', farbe: F.zoneRand }),
    text(60, 74, 'Tief 3', { gr: 10, anker: 'end', farbe: F.zoneRand }),
    text(8, 194, 'In dieser Spanne wurde nur in eine Richtung gehandelt.', { gr: 10 }),
].join(''))

/**
 * Displacement: die Bewegung, die die Luecke erzeugt. Links ruhige Kerzen,
 * dann eine, die alles davon ueberspannt — und das Band dazwischen bleibt
 * LEER, denn genau das ist die Aussage.
 */
BILDER.displacement = svg([
    text(8, 18, 'Displacement — eine Kerze nimmt mehr Spanne als die Stunde davor', { farbe: F.marke, gr: 10 }),
    kasten(196, 78, 256, 30, { fuell: F.zone, rand: F.zoneRand, strich: '4 3' }),
    text(446, 98, 'Luecke bleibt zurueck', { farbe: F.marke, gr: 10, anker: 'end' }),
    ...[0, 1, 2, 3, 4].map(i => kerze(44 + i * 30, 118 + (i % 2) * 5, 112 + (i % 2) * 5, 108, 126, 8)),
    kerze(196, 122, 52, 46, 128, 20),
    kerze(246, 54, 62, 48, 68, 12),
    kerze(278, 62, 50, 44, 68, 12),
    kerze(310, 50, 66, 46, 72, 12),
    text(44, 150, 'ruhig, kleine Spannen', { gr: 10 }),
    text(8, 194, 'Absicht, nicht Rauschen — und der Anlass fuer die Luecke daneben.', { gr: 10 }),
].join(''))

/**
 * Inducement: der Koeder liegt VOR dem Ziel. Die Reihenfolge ist die ganze
 * Aussage, deshalb sind die beiden Schritte nummeriert.
 */
BILDER.inducement = svg([
    text(8, 18, 'Inducement — erst der Koeder, dann das Ziel', { farbe: F.liqRand, gr: 10 }),
    linie(30, 96, 300, 96, { farbe: F.liqRand, strich: '3 3' }),
    // Kurz halten: Die lange Fassung lief im ersten Anlauf quer durch die
    // Kurslinie. Was sie erklaerte, steht jetzt im unteren Band.
    text(34, 92, 'Zwischenhoch', { farbe: F.liqRand, gr: 10 }),
    kasten(330, 46, 122, 26),
    text(391, 40, 'eigentliches Ziel', { farbe: F.marke, anker: 'middle', gr: 10 }),
    `<polyline points="30,166 72,118 104,146 148,96 172,88 200,136 244,156 300,76 350,58 400,60 440,120"
        fill="none" stroke="#e5e7eb" stroke-width="2" stroke-linejoin="round"/>`,
    `<circle cx="172" cy="88" r="4" fill="${F.liqRand}"/>`,
    // Linksbuendig ab dem Rand: rechtsbuendig auf x=146 lief der Anfang der
    // Zeile aus dem Bild heraus — im Text unsichtbar, im Bild abgeschnitten.
    text(8, 194, '1. Stopps ueber dem Zwischenhoch geholt', { farbe: F.liqRand, gr: 10 }),
    text(452, 194, '2. dann erst der Weg zum Ziel', { farbe: F.marke, gr: 10, anker: 'end' }),
].join(''))

/**
 * Mitigation Block: der Bereich wird erneut angelaufen und HAELT.
 * Bildsprache absichtlich identisch zum Breaker daneben — der Unterschied
 * liegt allein im Verlauf.
 */
BILDER.mitigationBlock = svg([
    text(8, 18, 'Mitigation Block — der Bereich haelt', { farbe: F.hoch, gr: 10 }),
    kasten(30, 104, 422, 26),
    // Rechts statt links: Auf der linken Seite steigt die Kurslinie durch
    // diese Hoehe, und der Text lag quer darueber.
    text(452, 98, 'Bereich der letzten Eroeffnungen', { farbe: F.marke, gr: 10, anker: 'end' }),
    `<polyline points="30,158 80,158 122,68 168,48 210,116 252,122 300,66 360,44 440,36"
        fill="none" stroke="#e5e7eb" stroke-width="2" stroke-linejoin="round"/>`,
    `<circle cx="231" cy="119" r="4" fill="${F.hoch}"/>`,
    text(231, 152, 'beruehrt, haelt', { farbe: F.hoch, anker: 'middle', fett: true, gr: 11 }),
    text(8, 194, 'Liegengebliebene Positionen werden glattgestellt, die Richtung bleibt.', { gr: 10 }),
].join(''))

/**
 * Breaker Block: derselbe Bereich, aber gebrochen — danach in umgekehrter
 * Rolle. Die beiden Schritte sind nummeriert wie beim Inducement.
 */
BILDER.breakerBlock = svg([
    text(8, 18, 'Breaker Block — derselbe Bereich, aber durchbrochen', { farbe: F.tief, gr: 10 }),
    kasten(30, 96, 422, 26, { fuell: 'rgba(239,68,68,0.16)', rand: 'rgba(239,68,68,0.6)' }),
    `<polyline points="30,158 76,126 112,62 148,104 190,156 232,172 278,124 306,108 340,146 392,176"
        fill="none" stroke="#e5e7eb" stroke-width="2" stroke-linejoin="round"/>`,
    `<circle cx="190" cy="156" r="4" fill="${F.tief}"/>`,
    text(60, 194, '1. gebrochen', { farbe: F.tief, gr: 10 }),
    `<circle cx="306" cy="108" r="4" fill="${F.tief}"/>`,
    text(452, 194, '2. von unten geprueft — haelt jetzt als Widerstand', { farbe: F.tief, gr: 10, anker: 'end' }),
].join(''))

/**
 * Premium und Discount: die Haelften der Handelsspanne. Die 50-%-Linie ist
 * die ganze Aussage, deshalb die einzige durchgezogene Linie im Bild.
 */
BILDER.premiumDiscount = svg([
    text(8, 18, 'Premium und Discount — die beiden Haelften der Spanne', { gr: 10 }),
    kasten(60, 38, 392, 60, { fuell: 'rgba(239,68,68,0.13)', rand: 'rgba(239,68,68,0.45)' }),
    kasten(60, 98, 392, 60, { fuell: 'rgba(34,197,94,0.13)', rand: 'rgba(34,197,94,0.45)' }),
    linie(60, 98, 452, 98, { farbe: '#e5e7eb', dick: 2 }),
    text(66, 94, '50 % der Spanne', { farbe: '#e5e7eb', gr: 10, fett: true }),
    text(66, 60, 'PREMIUM — teuer, hier wird verkauft', { farbe: F.tief, gr: 11, fett: true }),
    text(66, 132, 'DISCOUNT — billig, hier wird gekauft', { farbe: F.hoch, gr: 11, fett: true }),
    text(56, 42, 'Hoch', { anker: 'end', gr: 10 }),
    text(56, 158, 'Tief', { anker: 'end', gr: 10 }),
    text(8, 194, 'Die Spanne muss vorher festliegen — sonst verschiebt sich die Mitte mit.', { gr: 10 }),
].join(''))

/**
 * Equal Highs: mehrere Hochs auf derselben Marke. Der Inhalt ist nicht die
 * Form, sondern was DARUEBER liegt — deshalb ist das Band die groesste
 * Flaeche im Bild.
 */
BILDER.equalHighsLows = svg([
    text(8, 18, 'Gleiche Hochs — und was darueber liegt', { farbe: F.liqRand, gr: 10 }),
    `<rect x="30" y="56" width="422" height="22" fill="${F.liq}" stroke="${F.liqRand}"
        stroke-width="1" stroke-dasharray="4 3" rx="2"/>`,
    text(34, 70, 'Stopps der Verkaeufer + Kaufauftraege beim Ausbruch', { farbe: F.liqRand, gr: 10 }),
    linie(30, 78, 452, 78, { farbe: F.liqRand, strich: '2 3' }),
    `<polyline points="30,168 86,79 122,128 172,79 208,138 254,79 306,128 350,64 400,40"
        fill="none" stroke="#e5e7eb" stroke-width="2" stroke-linejoin="round"/>`,
    ...[86, 172, 254].map(x => `<circle cx="${x}" cy="79" r="4" fill="${F.liqRand}"/>`),
    text(8, 194, 'Drei Hochs auf derselben Marke — beim vierten Anlauf wird sie geholt.', { gr: 10 }),
].join(''))

/** SVG-Quelltext zu einem Kartenschluessel, oder leerer Text. */
export function bildFuer(schluessel) {
    return BILDER[schluessel] || ''
}

export { BILDER }
