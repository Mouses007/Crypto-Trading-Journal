/**
 * Rollender Speicher der letzten Liquidationen — für den Live-Ticker.
 *
 * ## Warum es diesen Puffer zusätzlich gibt
 *
 * Der Aufzeichner (`live-recorder.js`) hat die Ströme von Binance und Bybit
 * bereits offen, schreibt sie aber gebündelt: alle 30 Sekunden wandert der
 * Puffer als gzip-Blob in die Datenbank und wird geleert. Ein Abruf aus der
 * Datenbank hinkt damit bis zu einer halben Minute nach — für „was ist gerade
 * passiert" unbrauchbar.
 *
 * Deshalb liegt hier ein zweiter, winziger Speicher im Arbeitsspeicher, der
 * neben dem Schreibpuffer mitgefüllt wird. Er ersetzt die Aufzeichnung nicht,
 * er beantwortet nur eine andere Frage.
 *
 * ## Was hier NICHT passiert
 *
 * **Die Seiten-Konvention wird nicht angefasst.** Projektweit gilt
 * `seite 1 = SHORT liquidiert, 0 = LONG liquidiert`; Bybit meldet es
 * umgekehrt und wird in `bybit-liq.js` normalisiert. An allen drei
 * Einhängepunkten im Aufzeichner ist der Wert bereits richtig. Würde hier noch
 * einmal gedreht, gäbe es die Umrechnung ein viertes Mal im Baum — und beim
 * nächsten Lesen wüsste niemand mehr, welche Stelle gilt.
 *
 * Reines Modul: kein Netz, keine Datenbank. Selbsttest:
 * `server/__selftest-liq-ticker.mjs`.
 */

/** Behaltenes Zeitfenster. Doppelt so gross wie die grösste Abfrage. */
const FENSTER_MS = 30 * 60 * 1000

/**
 * Harte Obergrenze. Bei einem Ausschlag können in Sekunden tausende Ereignisse
 * kommen; ohne Deckel wächst der Speicher unbegrenzt, weil die Zeitgrenze dann
 * noch gar nicht greift.
 */
const MAX_EREIGNISSE = 20000

/** [zeitMs, preis, menge, seite, boerse] — Array statt Objekt, es sind viele. */
let ring = []

/**
 * Index des ersten noch gültigen Eintrags.
 *
 * Verdrängt wurde bis zum Audit vom 28.08.2026 mit `ring.filter(...)` bei
 * praktisch JEDEM Ereignis: sobald der Ring das 30-Minuten-Fenster füllt,
 * liegt das älteste Element per Konstruktion an der Grenze, und das nächste
 * Ereignis schiebt sie darüber hinweg. Gemessen 137 µs je Liquidation im
 * Vollstand — bei einer ungedrosselten Bybit-Kaskade (2000 Ereignisse/s) ein
 * Viertel eines Kerns, und zwar in genau dem Prozess, der gleichzeitig die
 * Live-Trading-Kacheln bedient. Also teuer genau dann, wenn das Fenster
 * gebraucht wird.
 *
 * Mit einem Kopfzeiger kostet das Verdrängen amortisiert O(1); kopiert wird
 * nur, wenn der tote Vorlauf gross genug ist, dass sich das Kopieren lohnt.
 */
let kopf = 0

/** Ab wann der tote Vorlauf weggeschnitten wird. */
const KOMPAKT_AB = 4096

/**
 * Börse → Zeitpunkt des zuletzt gelieferten Ereignisses.
 *
 * Vorher war das ein Set: „hat je geliefert". Ein toter Bybit-Strom blieb
 * damit für die Lebensdauer des Prozesses als Quelle gemeldet, obwohl seit
 * Stunden nichts mehr kam — die Kachel zeigte eine Quelle an, die nichts
 * beiträgt. Mit dem Zeitstempel kann der Aufrufer selbst urteilen.
 */
const boersen = new Map()

/**
 * Ein Liquidationsereignis vormerken.
 *
 * Wird direkt neben dem Schreibpuffer des Aufzeichners aufgerufen. Ungültige
 * Werte werden verworfen statt zu werfen — ein kaputtes Ereignis darf den
 * Datenstrom nicht abreissen.
 *
 * @param {string} boerse 'binance' | 'bybit'
 * @param {string} symbol z.B. 'BTCUSDT'
 * @param {number} t      Zeitpunkt in ms
 * @param {number} preis
 * @param {number} menge  in Basiswährung (nicht USD)
 * @param {number} seite  1 = Short liquidiert, 0 = Long liquidiert
 */
export function merkeLiq(boerse, symbol, t, preis, menge, seite) {
    const zeit = Number(t)
    const p = Number(preis)
    const m = Number(menge)
    if (!Number.isFinite(zeit) || !Number.isFinite(p) || !Number.isFinite(m)) return
    if (p <= 0 || m <= 0 || !symbol) return

    boersen.set(boerse, zeit)
    ring.push([zeit, p, m, seite === 1 ? 1 : 0, boerse, String(symbol).toUpperCase()])

    /*
     * Verdrängung beim Schreiben statt per Zeitgeber: ein Timer, der auch dann
     * läuft, wenn gar nichts kommt, wäre reine Beschäftigung.
     *
     * Der Kopfzeiger wandert nur über die Elemente, die WIRKLICH verfallen —
     * über die Lebenszeit eines Elements genau einmal. Das ist der Unterschied
     * zum vorherigen `filter`, das bei jedem Ereignis den ganzen Ring anfasste.
     */
    const grenze = zeit - FENSTER_MS
    while (kopf < ring.length && ring[kopf][0] < grenze) kopf++
    // Harte Obergrenze: bei einem Ausschlag greift die Zeitgrenze noch nicht.
    while (ring.length - kopf > MAX_EREIGNISSE) kopf++

    // Kopieren lohnt erst, wenn genug totes Vorspann liegt.
    if (kopf >= KOMPAKT_AB) {
        ring = ring.slice(kopf)
        kopf = 0
    }
}

/** Die gültigen Einträge — ohne den verdrängten Vorlauf. */
function gueltige() {
    return kopf === 0 ? ring : ring.slice(kopf)
}

/**
 * Auswertung der letzten `minuten`.
 *
 * @param {object} [opt]
 * @param {number} [opt.minuten=15]
 * @param {string} [opt.symbol]  nur dieses Symbol; leer = alle
 * @param {number} [opt.jetzt]   Bezugszeitpunkt (für den Selbsttest)
 */
export function lies({ minuten = 15, symbol = null, jetzt = Date.now() } = {}) {
    const spanne = Math.max(1, Math.min(30, Number(minuten) || 15)) * 60 * 1000
    const von = jetzt - spanne
    const sym = symbol ? String(symbol).toUpperCase() : null

    const treffer = gueltige().filter(e => e[0] >= von && (!sym || e[5] === sym))

    let longUsd = 0
    let shortUsd = 0
    const jeMinuteMap = new Map()
    const jeSymbolMap = new Map()

    for (const [t, preis, menge, seite, boerse, s] of treffer) {
        const usd = preis * menge
        if (seite === 1) shortUsd += usd; else longUsd += usd

        const minute = Math.floor(t / 60000) * 60000
        let mEintrag = jeMinuteMap.get(minute)
        if (!mEintrag) jeMinuteMap.set(minute, mEintrag = { t: minute, longUsd: 0, shortUsd: 0, anzahl: 0 })
        if (seite === 1) mEintrag.shortUsd += usd; else mEintrag.longUsd += usd
        mEintrag.anzahl++

        let sEintrag = jeSymbolMap.get(s)
        if (!sEintrag) jeSymbolMap.set(s, sEintrag = { symbol: s, longUsd: 0, shortUsd: 0, anzahl: 0 })
        if (seite === 1) sEintrag.shortUsd += usd; else sEintrag.longUsd += usd
        sEintrag.anzahl++

        void boerse
    }

    const alsEreignis = (e) => ({
        t: e[0], preis: e[1], menge: e[2], seite: e[3], boerse: e[4], symbol: e[5],
        usd: e[1] * e[2],
    })

    return {
        fensterMinuten: spanne / 60000,
        von,
        bis: jetzt,
        gesamt: { longUsd, shortUsd, anzahl: treffer.length },
        jeMinute: [...jeMinuteMap.values()].sort((a, b) => a.t - b.t),
        jeSymbol: [...jeSymbolMap.values()].sort((a, b) => (b.longUsd + b.shortUsd) - (a.longUsd + a.shortUsd)),
        // Die grössten Einzelereignisse — die erzählen mehr als die Summe
        groesste: treffer.map(alsEreignis).sort((a, b) => b.usd - a.usd).slice(0, 10),
        // Das Band: neueste zuerst, damit die Kachel von oben lesen kann
        letzte: treffer.map(alsEreignis).sort((a, b) => b.t - a.t).slice(0, 50),
        /*
         * Je Börse: hat sie je geliefert, und wann zuletzt. `aktiv` misst am
         * angefragten Fenster — was ausserhalb liegt, zählt in dieser Antwort
         * ohnehin nicht mit.
         */
        quellen: {
            binance: boersen.has('binance'),
            bybit: boersen.has('bybit'),
            zuletzt: { binance: boersen.get('binance') || 0, bybit: boersen.get('bybit') || 0 },
            aktiv: {
                binance: (boersen.get('binance') || 0) >= von,
                bybit: (boersen.get('bybit') || 0) >= von,
            },
        },
    }
}

/** Nur für den Selbsttest — im Betrieb gibt es keinen Grund, zu leeren. */
export function _leere() {
    ring = []
    kopf = 0
    boersen.clear()
}

export const _grenzen = { FENSTER_MS, MAX_EREIGNISSE }
