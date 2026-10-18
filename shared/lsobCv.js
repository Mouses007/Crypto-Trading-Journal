/**
 * LSOB (Liquidity Sweep Order Block) — Nachbau des TradingView-Indikators
 * „LSOB V3 [Claudius Vertesi]" aus seinem sichtbaren Verhalten.
 *
 * Das Original ist geschützter Quelltext. Hergeleitet am 18.10.2026 aus den
 * Einstellungen und ⓘ-Texten des Indikators und Kerze für Kerze gegen seine
 * Boxen und Signale auf ETHUSDT.P 1h und BTCUSDT.P 4h (Binance) geprüft — die
 * Kerzen liegen als Fixture unter shared/fixtures/, der Selbsttest
 * shared/__selftest-cv-indikatoren.mjs hält die Übereinstimmung fest.
 *
 *   Box        ein Pivot-Hoch (Short) bzw. -Tief (Long) mit `pivotLaenge`
 *              Kerzen zu beiden Seiten, das das VORIGE Pivot-Hoch überbietet
 *              (bzw. -Tief unterbietet) — der Liquidity Sweep. Die Box ist die
 *              ganze Spanne dieser Kerze (Tief bis Hoch) und beginnt an ihr.
 *   Ungültig   ab der Bestätigung (Pivot + pivotLaenge + 1): ein Kerzenkörper
 *              dringt mehr als `invalidierungPct` der Boxhöhe ein (Short: von
 *              unten, Long: von oben). Ungültige Boxen verschwinden, wie im
 *              Original. Mit `strengDocht` macht das auch ein Docht über
 *              `maxDochtPct` der Boxhöhe.
 *   Signal     der erste Retest — frühestens zwei Kerzen nach der Bestätigung —:
 *              der Docht erreicht die Box, der Körper bleibt innerhalb von
 *              `retestPct` der Boxhöhe. Ein Signal je Box.
 *   Vorwarnung waagerechte Linie `vorwarnAtr` × ATR vor der Box (Short:
 *              darunter, Long: darüber), ab Bestätigung + `vorwarnVerzoegerung`
 *              bis `vorwarnAblauf` Kerzen danach oder bis zum Signal.
 *
 * Bekannte Abweichung: BTCUSDT 4h, Box vom 03.09.2026 20:00 — der Nachbau
 * meldet am 18.09. 12:00 einen Retest, das Original nicht (dieselbe Kerze
 * macht eine darunterliegende Box ungültig; die Regel dahinter ist nicht
 * sichtbar).
 *
 * Rein, ohne Netz. Kerzen `{t,o,h,l,c}` aufsteigend, nur geschlossene.
 */
import { atr } from './indicators.js'

export const LSOB_VORGABEN = {
    pivotLaenge: 5,
    invalidierungPct: 20,
    retestPct: 10,
    strengDocht: false,
    maxDochtPct: 50,
    maxHistorie: 2000,
    vorwarnAtr: 0.5,
    vorwarnVerzoegerung: 0,
    vorwarnAblauf: 150,
}

function pivots(k, L, hoch) {
    const aus = []
    for (let i = L; i < k.length - L; i++) {
        const v = hoch ? k[i].h : k[i].l
        let ok = true
        for (let j = i - L; j <= i + L && ok; j++) {
            if (j === i) continue
            ok = hoch ? k[j].h < v : k[j].l > v
        }
        if (ok) aus.push(i)
    }
    return aus
}

/**
 * @returns {{ boxen: Array<{seite:'short'|'long', i, t, tief, hoch, gueltig:boolean, endeT:number|null, signalT:number|null}>,
 *             signale: Array<{seite, t, preis, boxT}>, vorwarnungen: Array<{seite, preis, vonT, bisT}> }}
 */
export function lsobCv(kerzen, opt = {}) {
    const p = { ...LSOB_VORGABEN, ...opt }
    const k = (kerzen || []).slice(-Math.max(50, p.maxHistorie))
    const L = Math.max(1, Math.round(p.pivotLaenge))
    const a = atr(k, 14)
    const boxen = [], signale = [], vorwarnungen = []
    for (const hoch of [true, false]) {
        const seite = hoch ? 'short' : 'long'
        const pv = pivots(k, L, hoch)
        for (let n = 1; n < pv.length; n++) {
            const i = pv[n], vor = k[pv[n - 1]], b = k[i]
            // Liquidity Sweep: über das vorige Pivot-Hoch hinaus (bzw. unter das vorige Tief)
            if (hoch ? !(b.h > vor.h) : !(b.l < vor.l)) continue
            const tief = b.l, hochP = b.h, H = hochP - tief
            if (!(H > 0)) continue
            const box = { seite, i, t: b.t, tief, hoch: hochP, gueltig: true, endeT: null, signalT: null }
            const bestaetigt = i + L + 1
            for (let j = bestaetigt; j < k.length; j++) {
                const x = k[j]
                const oben = Math.max(x.o, x.c), unten = Math.min(x.o, x.c)
                const koerper = hoch ? (oben - tief) / H : (hochP - unten) / H
                const docht = hoch ? (x.h - tief) / H : (hochP - x.l) / H
                if (koerper > p.invalidierungPct / 100 || (p.strengDocht && docht > p.maxDochtPct / 100)) {
                    box.gueltig = false
                    box.endeT = x.t
                    break
                }
                // erster Retest, frühestens zwei Kerzen nach der Bestätigung
                if (box.signalT == null && j >= bestaetigt + 1 && docht >= 0 && koerper <= p.retestPct / 100) {
                    box.signalT = x.t
                    signale.push({ seite, t: x.t, preis: hoch ? tief : hochP, boxT: b.t })
                }
            }
            const atrB = a[Math.min(k.length - 1, bestaetigt)] ?? a[a.length - 1]
            if (atrB > 0 && bestaetigt + p.vorwarnVerzoegerung < k.length) {
                const von = bestaetigt + p.vorwarnVerzoegerung
                let bis = Math.min(k.length - 1, von + p.vorwarnAblauf)
                const ende = [box.signalT, box.endeT].filter((t) => t != null)
                if (ende.length) bis = Math.min(bis, k.findIndex((x) => x.t === Math.min(...ende)))
                vorwarnungen.push({ seite, boxT: b.t, preis: hoch ? tief - p.vorwarnAtr * atrB : hochP + p.vorwarnAtr * atrB, vonT: k[von].t, bisT: k[Math.max(von, bis)].t, gueltig: box.gueltig })
            }
            boxen.push(box)
        }
    }
    return { boxen, signale: signale.sort((x, y) => x.t - y.t), vorwarnungen }
}
