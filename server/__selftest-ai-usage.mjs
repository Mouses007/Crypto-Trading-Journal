/**
 * Selbsttest: KI-Verbrauchserfassung.
 *
 * Läuft ohne Netz und ohne Datenbank. Geprüft wird der rechnende Kern
 * (`baueVerbrauchZeile`) und — wichtiger — die Grundregel: eine fehlgeschlagene
 * Buchung darf den Aufrufer NIE mit einem Fehler behelligen. Ohne Datenbank ist
 * genau dieser Fall hier der Normalfall, also lässt er sich gut prüfen.
 *
 * Aufruf: node server/__selftest-ai-usage.mjs
 */
import { baueVerbrauchZeile, merkeVerbrauch, FUNKTIONEN } from './ai-usage.js'
import { schaetzeKosten } from './llm.js'
import { ANBIETER, STANDARD_MODELLE } from './ai-models.js'

let fehler = 0
let bestanden = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('KI-Verbrauchserfassung')

// 1) Ohne Funktionsnamen gibt es keine Zeile — sonst stünde Verbrauch da,
//    der keinem Vorgang zuzuordnen ist, und die Auswertung hätte einen
//    namenlosen Posten.
pruefe('ohne Funktion keine Zeile', baueVerbrauchZeile({}) === null)
pruefe('leerer Funktionsname zählt als fehlend',
    baueVerbrauchZeile({ funktion: '' }) === null)

// 2) Kosten aus Token, wenn kein Preis mitkommt.
const ausToken = baueVerbrauchZeile({
    funktion: FUNKTIONEN.BERICHT,
    modell: 'claude-sonnet-5',
    usage: { promptTokens: 1_000_000, completionTokens: 1_000_000 },
})
pruefe('Kosten werden aus dem Modell geschätzt',
    ausToken.kostenUsd === schaetzeKosten('claude-sonnet-5', 1e6, 1e6),
    String(ausToken.kostenUsd))
pruefe('geschätzte Kosten sind hier nicht null', ausToken.kostenUsd > 0)

// 3) Ein mitgegebener Preis schlägt die Schätzung — auch die 0.
//    Das ist der Ollama-Fall: lokal gerechnet, also gratis. Mit `||` statt
//    einer Prüfung auf null wäre die 0 durchgefallen und hätte fälschlich
//    eine Schätzung ausgelöst.
const gratis = baueVerbrauchZeile({
    funktion: FUNKTIONEN.AGENT,
    modell: 'claude-opus-5',      // teures Modell, aber Preis 0 vorgegeben
    usage: { promptTokens: 500_000, completionTokens: 500_000 },
    kostenUsd: 0,
})
pruefe('ausdrückliche 0 bleibt 0', gratis.kostenUsd === 0, String(gratis.kostenUsd))

const pauschale = baueVerbrauchZeile({
    funktion: FUNKTIONEN.X_SUCHE, modell: 'grok-4.6', kostenUsd: 0.005,
})
pruefe('Stückpreis wird übernommen', pauschale.kostenUsd === 0.005)

// 4) Unbekannte Modelle (Ollama) kosten nichts.
const lokal = baueVerbrauchZeile({
    funktion: FUNKTIONEN.BERICHT,
    modell: 'llama3.3:70b',
    usage: { promptTokens: 9_000, completionTokens: 3_000 },
})
pruefe('unbekanntes Modell kostet 0', lokal.kostenUsd === 0)
pruefe('Token werden trotzdem gezählt', lokal.totalTokens === 12_000)

// 5) Tokensumme: mitgeliefert schlägt gerechnet, sonst wird addiert.
const summeGerechnet = baueVerbrauchZeile({
    funktion: FUNKTIONEN.LAGE, usage: { promptTokens: 100, completionTokens: 40 },
})
pruefe('fehlende Summe wird gebildet', summeGerechnet.totalTokens === 140)

const summeGeliefert = baueVerbrauchZeile({
    funktion: FUNKTIONEN.LAGE,
    usage: { promptTokens: 100, completionTokens: 40, totalTokens: 900 },
})
pruefe('gelieferte Summe gilt (Anthropic zählt Zwischenspeicher gesondert)',
    summeGeliefert.totalTokens === 900)

// 6) Fehlende Angaben dürfen keine kaputten Zeilen erzeugen — alle Felder
//    müssen vom richtigen Typ sein, sonst scheitert der Insert erst in der DB.
const knapp = baueVerbrauchZeile({ funktion: FUNKTIONEN.BILD })
pruefe('ohne Token bleibt alles 0',
    knapp.promptTokens === 0 && knapp.completionTokens === 0
    && knapp.totalTokens === 0 && knapp.kostenUsd === 0)
pruefe('Textfelder sind Zeichenketten',
    typeof knapp.provider === 'string' && typeof knapp.modell === 'string'
    && typeof knapp.bezugTyp === 'string' && typeof knapp.bezugId === 'string')
pruefe('Vorgabe des Auslösers ist auto', knapp.ausloeser === 'auto')

// Eine numerische Bezugs-Id darf nicht als Zahl durchrutschen: die Spalte ist
// Text, und PostgreSQL nähme den Typwechsel übel.
const mitBezug = baueVerbrauchZeile({
    funktion: FUNKTIONEN.COACH_CHAT, bezug: { typ: 'bericht', id: 42 },
})
pruefe('Bezugs-Id wird zu Text', mitBezug.bezugId === '42')

// 7) Kaputte Eingaben: Text statt Zahl darf keine NaN in die Spalte schreiben.
const murks = baueVerbrauchZeile({
    funktion: FUNKTIONEN.RECHERCHE,
    usage: { promptTokens: 'viele', completionTokens: null },
    kostenUsd: 'teuer',
})
pruefe('unbrauchbare Token werden zu 0',
    murks.promptTokens === 0 && murks.completionTokens === 0)
pruefe('unbrauchbarer Preis wird zu 0 statt NaN',
    murks.kostenUsd === 0 && !Number.isNaN(murks.kostenUsd))

// 8) Die Grundregel. Ohne Datenbank muss `merkeVerbrauch` still scheitern:
//    false zurückgeben, aber nicht werfen. Wer gerade einen Bericht erzeugt
//    hat, soll ihn behalten, auch wenn die Buchhaltung danebengeht.
let geworfen = false
let ergebnis = null
try {
    ergebnis = await merkeVerbrauch({ funktion: FUNKTIONEN.BERICHT, modell: 'gpt-5.6-luna' })
} catch {
    geworfen = true
}
pruefe('Buchung ohne Datenbank wirft nicht', !geworfen)
pruefe('Buchung ohne Datenbank meldet false', ergebnis === false)

/*
 * 9) Jedes wählbare Modell braucht einen Preis.
 *
 * Die Falle ist unauffällig: ein neu aufgenommener Anbieter ohne Eintrag in
 * `PREISE` wird mit 0 verbucht, und die Übersicht zeigt ihn als Anbieter, der
 * angeblich nichts kostet — man merkt es erst auf der Rechnung. Ollama ist
 * ausgenommen: dort stimmt die 0.
 */
for (const anbieter of ANBIETER) {
    if (anbieter === 'ollama' || anbieter === 'custom') continue
    for (const modell of STANDARD_MODELLE[anbieter] || []) {
        pruefe(`Preis hinterlegt: ${modell}`,
            schaetzeKosten(modell, 1e6, 1e6) > 0)
    }
}

// 10) Die Funktionsnamen selbst: doppelte Werte würden zwei Vorgänge in der
//    Auswertung zu einem verschmelzen.
const werte = Object.values(FUNKTIONEN)
pruefe('Funktionsnamen sind doppelfrei', new Set(werte).size === werte.length)
pruefe('Funktionsnamen sind klein und ohne Leerzeichen',
    werte.every((w) => w === w.toLowerCase() && !/\s/.test(w)))

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
