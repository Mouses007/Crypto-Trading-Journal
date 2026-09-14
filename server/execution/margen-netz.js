/**
 * Margen-Netz — die Sicherung, die auch ohne laufenden Prozess hält.
 *
 * Auf Bitunix geht der Stop MIT der Order an die Börse; fällt das Journal aus,
 * liegt er trotzdem im Buch. Pionex kennt keine Stop-Order über die API. Dort
 * hält ein Wächter im Journal den Stop — und wenn der Wächter nicht läuft,
 * hält gar nichts mehr. Ausser der isolierten Marge: sie begrenzt den Schaden
 * auf den Betrag, der für die Position hinterlegt ist.
 *
 * Dieses Modul rechnet aus, wie eng diese Grenze liegt und welcher Hebel sie
 * dorthin bringt.
 *
 * ── Die unbequeme Arithmetik, die man kennen muss ───────────────────────────
 * Damit die Liquidation direkt hinter dem Stop liegt, muss die Marge beim Stop
 * aufgebraucht sein. Mit a = |Einstieg − Stop|/Einstieg und der Wartungsmarge m
 * gilt (siehe `hebelFuerLiqPreis`):
 *
 *     nötiger Hebel ≈ 1 / (a + m)
 *
 * Ein Stop 1 % unter dem Einstieg verlangt also Hebel ~72, einer bei 2 % ~42.
 * Der Vorgabe-Deckel dieses Projekts steht bei 10 — das Netz liegt damit weit
 * hinter dem Stop, nicht direkt dahinter. Das ist kein Fehler, den man
 * wegrechnen kann, sondern die Eigenschaft der Sache.
 *
 * ── Warum ein höherer Hebel hier trotzdem kein höheres Risiko ist ───────────
 * `computePositionSize` (server/risk-engine.js) bemisst die MENGE am
 * Stopabstand, nicht am Hebel; der Hebel wirkt dort nur über `maxQtyByMargin`.
 * Wer den Deckel von 10 auf 45 hebt, handelt deshalb nicht grösser — er bindet
 * weniger Marge und zieht das Netz näher an den Stop. Der Deckel ist in diesem
 * Betrieb ein NETZWEITEN-Regler, kein Risikoregler. Steht das nicht in der
 * Oberfläche, wird jemand ihn aus den falschen Gründen senken.
 *
 * Rein: kein Netz, keine DB, kein Zustand.
 */

import { hebelFuerLiqPreis, liqPreis, hebelHaltbar } from '../../shared/liquidation.js'

/** Betriebsarten des Netzes. Siehe `plantHebel`. */
export const NETZ_MODI = ['voll', 'gedeckelt', 'aus']

/**
 * Wie weit hinter dem Stop die Liquidation liegen soll, als Anteil des
 * Stopabstands. Nicht null: läge sie exakt auf dem Stop, würde ein Docht, der
 * den Stop gerade berührt, die Position schon liquidieren statt sie den
 * Wächter schliessen zu lassen — und eine Liquidation kostet die volle Marge
 * plus Gebühr statt 1 R.
 */
export const PUFFER_VORGABE = 0.15

/**
 * Plant den Hebel für eine Live-Position auf einer Börse ohne Stop-Order.
 *
 * @param {object} o
 * @param {number} o.entry
 * @param {number} o.stopLoss
 * @param {string} o.direction    'long' | 'short'
 * @param {number} o.mmr          Wartungsmarge als BRUCH (Einheiten-Kanon!)
 * @param {number} o.maxLeverage  harter Deckel (strategyMaxLeverage)
 * @param {number} [o.wunschHebel] Hebel der Instanz; deckelt zusätzlich nach oben
 * @param {number} [o.puffer]
 * @param {string} [o.netzModus]  'voll' | 'gedeckelt' | 'aus'
 * @param {number} [o.netzMaxR]   im Modus 'gedeckelt': ab wie vielen R das Netz
 *                                zu weit ist, um noch zu handeln
 * @returns {{hebel, liqPreis, gesichert, netzVerlustR, noetigerHebel, grund}}
 *   `gesichert` heisst: die Liquidation liegt beim geplanten Hebel wirklich
 *   knapp hinter dem Stop. `netzVerlustR` sagt, bei wie vielen R das Netz
 *   greift — 1,0 ist „direkt am Stop", 9,6 ist „neunfacher Schaden".
 *   `hebel === 0` heisst: nicht handeln, `grund` sagt warum.
 */
export function plantHebel({
    entry, stopLoss, direction, mmr,
    maxLeverage = 0, wunschHebel = 0, puffer = PUFFER_VORGABE,
    netzModus = 'gedeckelt', netzMaxR = 0,
}) {
    const e = Number(entry) || 0
    const s = Number(stopLoss) || 0
    const m = Math.max(0, Number(mmr) || 0)
    const abstand = Math.abs(e - s)

    const leer = {
        hebel: 0, liqPreis: 0, gesichert: false,
        netzVerlustR: 0, noetigerHebel: 0, grund: '',
    }
    if (!(e > 0) || !(abstand > 0)) return { ...leer, grund: 'bad_levels' }
    if (direction !== 'long' && direction !== 'short') return { ...leer, grund: 'bad_direction' }

    // Der Stop muss auf der richtigen Seite liegen. Sonst wäre das Ziel der
    // Liquidation auf der Gewinnseite, und die Rechnung liefert plausible
    // Zahlen für eine unmögliche Position.
    if ((direction === 'long' && s >= e) || (direction === 'short' && s <= e)) {
        return { ...leer, grund: 'stop_falsche_seite' }
    }

    const deckel = obergrenze(maxLeverage, wunschHebel)

    // Modus 'aus': kein Netz gewollt. Der Hebel bleibt, was die Instanz sagt.
    if (netzModus === 'aus') {
        const h = deckel > 0 ? deckel : 1
        return {
            hebel: h,
            liqPreis: liqPreis(e, h, m, direction),
            gesichert: false,
            netzVerlustR: netzVerlustInR({ entry: e, hebel: h, mmr: m, direction, abstand }),
            noetigerHebel: 0,
            grund: 'netz_aus',
        }
    }

    // Zielliquidation: ein Stück HINTER dem Stop, in Verlustrichtung.
    const zielLiq = direction === 'long'
        ? s - abstand * puffer
        : s + abstand * puffer

    const noetig = hebelFuerLiqPreis(e, zielLiq, m, direction)
    if (!(noetig > 0)) return { ...leer, grund: 'netz_unerreichbar' }

    // ABRUNDEN, nie aufrunden. Ein aufgerundeter Hebel schöbe die Liquidation
    // näher an den Stop — im Zweifel soll das Netz lockerer sitzen, nie enger.
    const noetigGanz = Math.floor(noetig)
    if (noetigGanz < 1 || !hebelHaltbar(noetigGanz, m)) {
        return { ...leer, noetigerHebel: noetig, grund: 'netz_unerreichbar' }
    }

    if (deckel > 0 && noetigGanz > deckel) {
        // Der nötige Hebel liegt über dem, was erlaubt ist.
        if (netzModus === 'voll') {
            return { ...leer, noetigerHebel: noetig, grund: 'margin_net_unreachable' }
        }
        // 'gedeckelt': so eng wie erlaubt, und ehrlich sagen, wie weit das ist.
        const h = Math.max(1, Math.floor(deckel))
        if (!hebelHaltbar(h, m)) return { ...leer, noetigerHebel: noetig, grund: 'hebel_unhaltbar' }
        const verlustR = netzVerlustInR({ entry: e, hebel: h, mmr: m, direction, abstand })
        if (netzMaxR > 0 && verlustR > netzMaxR) {
            return {
                hebel: 0, liqPreis: liqPreis(e, h, m, direction), gesichert: false,
                netzVerlustR: verlustR, noetigerHebel: noetig, grund: 'netz_zu_weit',
            }
        }
        return {
            hebel: h,
            liqPreis: liqPreis(e, h, m, direction),
            gesichert: false,
            netzVerlustR: verlustR,
            noetigerHebel: noetig,
            grund: 'gedeckelt',
        }
    }

    return {
        hebel: noetigGanz,
        liqPreis: liqPreis(e, noetigGanz, m, direction),
        gesichert: true,
        netzVerlustR: netzVerlustInR({ entry: e, hebel: noetigGanz, mmr: m, direction, abstand }),
        noetigerHebel: noetig,
        grund: 'gesichert',
    }
}

/**
 * Bei wie vielen R greift das Netz?
 *
 * Gemessen wird der Kursweg bis zur Liquidation, geteilt durch den
 * Stopabstand — 1,0 heisst „die Liquidation liegt auf dem Stop", 9,6 heisst
 * „der Schaden wäre das Neunfache des geplanten Risikos".
 *
 * Bewusst am Kursweg und nicht an der Marge gemessen: die Marge kennt der
 * Aufrufer erst nach `computePositionSize`, der Kursweg steht schon jetzt fest
 * und ist dieselbe Zahl (Marge/Risiko = Liquidationsabstand/Stopabstand,
 * solange beide dieselbe Menge betreffen).
 */
export function netzVerlustInR({ entry, hebel, mmr, direction, abstand }) {
    const lp = liqPreis(entry, hebel, mmr, direction)
    if (!(lp > 0) || !(abstand > 0)) return 0
    return Math.abs(entry - lp) / abstand
}

/** Kleinster der gesetzten Deckel; 0 heisst „keiner gesetzt". */
function obergrenze(maxLeverage, wunschHebel) {
    const werte = [Number(maxLeverage) || 0, Number(wunschHebel) || 0].filter((x) => x > 0)
    return werte.length ? Math.min(...werte) : 0
}
