/**
 * Selbsttest: Alarm-Regeln des Wachhunds.
 *
 * Ohne Netz und ohne Datenbank. Ein falscher Alarm nervt; ein verschluckter
 * kostet Geld — geprüft werden deshalb beide Richtungen: was anschlagen muss
 * und was schweigen muss.
 *
 * Aufruf: node server/hype-radar/__selftest-wachhund.mjs
 */
import { pruefeRegeln, pruefeRegelnBoerse, naechsteBasis, STANDARD_ALARM_REGELN, SPERRFRIST_MS } from './wachhund.js'
import { erreichtSchwere, ntfyNachricht } from './zustellung.js'
import { bereinigeEinstellungen } from './einstellungen.js'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Hype-Radar: Wachhund')

const fav = { symbol: 'PEPE' }
const ruhig = { preis: 1.0, liq: 100000, ts: 1 }

// ── Ruhe ist der Normalfall ─────────────────────────────────────────────
p('unveränderter Stand löst nichts aus',
    pruefeRegeln(fav, ruhig, { preisUsd: 1.01, liquiditaetUsd: 99000, aenderung24h: 3 }).length === 0)

// ── Preissprung seit letztem Blick ──────────────────────────────────────
const hoch = pruefeRegeln(fav, ruhig, { preisUsd: 1.20, liquiditaetUsd: 100000 })
p('+20 % seit letztem Blick schlägt an', hoch.some((a) => a.regel === 'preisSprung'))
p('als info, nicht als Drama', hoch.find((a) => a.regel === 'preisSprung')?.schwere === 'info')

const runter = pruefeRegeln(fav, ruhig, { preisUsd: 0.80, liquiditaetUsd: 100000 })
p('-20 % schlägt ebenso an (beide Richtungen)', runter.some((a) => a.regel === 'preisSprung'))

p('+10 % bleibt unter der Schwelle',
    pruefeRegeln(fav, ruhig, { preisUsd: 1.10, liquiditaetUsd: 100000 }).length === 0)

// ── Tagessicht ──────────────────────────────────────────────────────────
const tag = pruefeRegeln(fav, ruhig, { preisUsd: 1.0, liquiditaetUsd: 100000, aenderung24h: -45 })
p('-45 % auf Tagessicht ist eine Warnung',
    tag.find((a) => a.regel === 'preis24h')?.schwere === 'warnung')

// ── Liquidität: der NIUNAI-Fall ─────────────────────────────────────────
// 44 000 → 2 400 USD zwischen zwei Blicken. Genau dafür gibt es den Hund.
const abfluss = pruefeRegeln(fav, { preis: 1, liq: 44000 }, { preisUsd: 1, liquiditaetUsd: 2400 })
p('Liquiditätsabfluss schlägt an', abfluss.some((a) => a.regel === 'liqAbfluss'))
p('und ist kritisch', abfluss.find((a) => a.regel === 'liqAbfluss')?.schwere === 'kritisch')
p('mit Vorher/Nachher in den Daten',
    abfluss.find((a) => a.regel === 'liqAbfluss')?.daten?.vorher === 44000)

// Zufluss ist erfreulich, aber kein Alarm.
p('Liquiditätszufluss schweigt',
    !pruefeRegeln(fav, { preis: 1, liq: 50000 }, { preisUsd: 1, liquiditaetUsd: 200000 })
        .some((a) => a.regel === 'liqAbfluss'))

// ── Sicherheit: nur der Übergang zählt ──────────────────────────────────
const kippt = pruefeRegeln(fav, ruhig, { preisUsd: 1, liquiditaetUsd: 100000 },
    { status: 'bestanden' }, { status: 'verworfen', grund: 'lp_offen' })
p('bestanden → verworfen ist kritisch',
    kippt.find((a) => a.regel === 'sicherheit')?.schwere === 'kritisch')

p('verworfen → verworfen schweigt (keine Neuigkeit)',
    !pruefeRegeln(fav, ruhig, { preisUsd: 1, liquiditaetUsd: 100000 },
        { status: 'verworfen' }, { status: 'verworfen', grund: 'lp_offen' })
        .some((a) => a.regel === 'sicherheit'))

p('ohne Nachprüfung schweigt die Sicherheitsregel',
    !pruefeRegeln(fav, ruhig, { preisUsd: 1, liquiditaetUsd: 100000 },
        { status: 'bestanden' }, null).some((a) => a.regel === 'sicherheit'))

// ── Erster Blick: keine Vergleichsbasis, kein Fehlalarm ─────────────────
const erster = pruefeRegeln(fav, {}, { preisUsd: 1, liquiditaetUsd: 100000, aenderung24h: 2 })
p('ohne alten Stand schlägt nur die Tagessicht an können', erster.length === 0)

// ── Kaputte Eingaben ────────────────────────────────────────────────────
p('Nullpreis als Basis erzeugt keinen Unsinn',
    pruefeRegeln(fav, { preis: 0, liq: 0 }, { preisUsd: 5, liquiditaetUsd: 100 }).length === 0)
p('Textwerte erzeugen keinen Alarm',
    pruefeRegeln(fav, { preis: 'x', liq: 'y' }, { preisUsd: 'z', liquiditaetUsd: null }).length === 0)

// ── Eigene Schwellen greifen ────────────────────────────────────────────
p('strengere Schwelle schlägt früher an',
    pruefeRegeln(fav, ruhig, { preisUsd: 1.10, liquiditaetUsd: 100000 },
        {}, null, { ...STANDARD_ALARM_REGELN, preisSprungPct: 5 })
        .some((a) => a.regel === 'preisSprung'))

// ── Schwere-Ordnung der Zustellung ──────────────────────────────────────
p('kritisch erreicht jede Mindest-Schwere',
    erreichtSchwere('kritisch', 'info') && erreichtSchwere('kritisch', 'kritisch'))
p('info erreicht warnung nicht', !erreichtSchwere('info', 'warnung'))
p('kritische Sperrfrist ist kürzer als die informative',
    SPERRFRIST_MS.kritisch < SPERRFRIST_MS.info)

// ════════════════════════════════════════════════════════════════════════
// Börsenpfad — Coin-Radar-Favoriten
//
// Eigene Regeln, weil ein Bitunix-Perp keinen Liquiditätspool hat, der
// abfliessen könnte. Wichtigster Prüfpunkt hier: Spread und Funding melden
// beim ÜBERSCHREITEN und nicht, solange sie darüber liegen — sonst würde aus
// einem dauerhaft teuren Coin ein Dauerpiepen.
// ════════════════════════════════════════════════════════════════════════
const bx = { symbol: 'HEIUSDT' }
const bAlt = { preis: 100, umsatz: 50e6, spreadBp: 2, funding: 10 }
const bNeu = { preisUsd: 100, aenderung24h: 1, umsatz24h: 50e6, spreadBp: 2, fundingJahresRate: 10 }
const regelnVon = (l) => pruefeRegelnBoerse(bx, bAlt, { ...bNeu, ...l }).map((a) => a.regel)

p('ruhiger Börsen-Coin löst nichts aus', pruefeRegelnBoerse(bx, bAlt, bNeu).length === 0)

p('Preissprung schlägt an', regelnVon({ preisUsd: 120 }).includes('preisSprung'))
p('Tagessicht schlägt an', regelnVon({ aenderung24h: -45 }).includes('preis24h'))

p('Umsatzeinbruch schlägt an', regelnVon({ umsatz24h: 20e6 }).includes('umsatzEinbruch'))
// Zufluss ist kein Handlungsdruck — Alarme sind für das, was einen zwingt.
p('Umsatzanstieg schlägt NICHT an', !regelnVon({ umsatz24h: 200e6 }).includes('umsatzEinbruch'))

p('Spread-Überschreitung schlägt an', regelnVon({ spreadBp: 15 }).includes('spreadWeit'))
p('dauerhaft weiter Spread piept nicht weiter',
    !pruefeRegelnBoerse(bx, { ...bAlt, spreadBp: 15 }, { ...bNeu, spreadBp: 16 })
        .some((a) => a.regel === 'spreadWeit'))

p('Funding-Überschreitung schlägt an', regelnVon({ fundingJahresRate: 80 }).includes('fundingExtrem'))
p('negatives Extrem schlägt ebenfalls an', regelnVon({ fundingJahresRate: -80 }).includes('fundingExtrem'))
p('dauerhaft teures Funding piept nicht weiter',
    !pruefeRegelnBoerse(bx, { ...bAlt, funding: 80 }, { ...bNeu, fundingJahresRate: 90 })
        .some((a) => a.regel === 'fundingExtrem'))
p('Funding-Meldung nennt, wer zahlt',
    pruefeRegelnBoerse(bx, bAlt, { ...bNeu, fundingJahresRate: 80 })
        .find((a) => a.regel === 'fundingExtrem').meldung.includes('Long zahlt'))

/*
 * Der teuerste Fehler wäre hier ein STUMMER: fehlende Werte dürfen weder
 * einen Alarm erfinden noch einen Vergleich mit NaN erzeugen, der immer
 * falsch ist und damit für immer schweigt.
 */
p('erster Blick ohne Vergleichsbasis erfindet nichts',
    pruefeRegelnBoerse(bx, {}, { preisUsd: 100, umsatz24h: 50e6, spreadBp: 2 }).length === 0)
p('unbekannter Spread meldet nichts',
    !pruefeRegelnBoerse(bx, bAlt, { ...bNeu, spreadBp: null }).some((a) => a.regel === 'spreadWeit'))
p('unbekanntes Funding meldet nichts',
    !pruefeRegelnBoerse(bx, bAlt, { ...bNeu, fundingJahresRate: null }).some((a) => a.regel === 'fundingExtrem'))
p('unbekannter Spread beim ERSTEN Blick meldet trotzdem, wenn er weit ist',
    pruefeRegelnBoerse(bx, {}, { ...bNeu, spreadBp: 20 }).some((a) => a.regel === 'spreadWeit'))
p('Textwerte erzeugen keinen Alarm',
    pruefeRegelnBoerse(bx, { preis: 'x', umsatz: 'y' },
        { preisUsd: 'z', umsatz24h: null, spreadBp: undefined, fundingJahresRate: 'a' }).length === 0)

p('das USDT im Symbol steht nicht in der Meldung',
    !pruefeRegelnBoerse(bx, bAlt, { ...bNeu, preisUsd: 130 })[0].meldung.includes('USDT'))

p('eigene Schwelle greift auch hier',
    pruefeRegelnBoerse(bx, bAlt, { ...bNeu, umsatz24h: 45e6 },
        { ...STANDARD_ALARM_REGELN, umsatzEinbruchPct: 5 }).some((a) => a.regel === 'umsatzEinbruch'))

/*
 * ── Befunde vom 07.10.2026 ─────────────────────────────────────────────
 *
 * Der langsame Abfluss: je Takt 25 % weniger Liquidität, die Schwelle liegt
 * bei 30 %. Takt gegen Takt verglichen schlug das NIE an — von 100 000 auf
 * 31 000 ohne Alarm. Simuliert wird der ganze Verlauf samt Fortschreiben der
 * Basis, wie `wachhundLauf` es tut.
 */
{
    let stand = { liq: 100000, liqReferenz: 100000 }
    let alarme = 0
    let erstesBei = null
    for (let takt = 1; takt <= 4; takt++) {
        const neuLiq = Math.round(stand.liq * 0.75)
        const a = pruefeRegeln(fav, stand, { liquiditaetUsd: neuLiq })
        const angeschlagen = a.some((x) => x.regel === 'liqAbfluss')
        if (angeschlagen) { alarme++; erstesBei ??= neuLiq }
        stand = { liq: neuLiq, liqReferenz: naechsteBasis(stand.liqReferenz, stand.liq, neuLiq, angeschlagen) }
    }
    p('langsamer Abfluss schlägt an', alarme >= 1, `${alarme} Alarme`)
    p('und zwar beim zweiten Takt (−44 % vom Höchststand)', erstesBei === 56250, String(erstesBei))
    p('nach dem Alarm zählt der Abfluss neu', alarme <= 2, `${alarme} Alarme`)
}
p('Basis wandert mit dem Höchststand', naechsteBasis(100, 100, 150, false) === 150)
p('Basis fällt nicht mit', naechsteBasis(150, 120, 120, false) === 150)
p('nach Alarm beginnt die Basis beim jetzigen Stand', naechsteBasis(150, 120, 80, true) === 80)
p('fehlender neuer Wert lässt die Basis stehen', naechsteBasis(150, 120, null, false) === 150)
p('Altbestand ohne Basis nimmt den letzten Stand', naechsteBasis(undefined, 120, 110, false) === 120)

// Eine fehlende Liquidität ist kein leerer Pool.
p('fehlende Liquidität löst keinen Abfluss aus',
    pruefeRegeln(fav, ruhig, { preisUsd: 1, liquiditaetUsd: null }).length === 0)

// Tagesbewegung: beim Überschreiten, nicht solange darüber.
p('−50 % in 24 h meldet beim ersten Mal',
    pruefeRegeln(fav, { ...ruhig, aenderung24h: -10 }, { preisUsd: 1, liquiditaetUsd: 100000, aenderung24h: -50 })
        .some((a) => a.regel === 'preis24h'))
p('und nicht erneut, solange es so bleibt',
    !pruefeRegeln(fav, { ...ruhig, aenderung24h: -48 }, { preisUsd: 1, liquiditaetUsd: 100000, aenderung24h: -50 })
        .some((a) => a.regel === 'preis24h'))

// Sicherheit: nur ein Übergang von BEKANNT bestanden ist kritisch.
const vertragsKo = { status: 'verworfen', grund: 'honeypot', hinweise: [] }
p('bestanden → Vertragsbefund ist kritisch',
    pruefeRegeln(fav, ruhig, { preisUsd: 1, liquiditaetUsd: 100000 }, { status: 'bestanden' }, vertragsKo)
        .find((a) => a.regel === 'sicherheit')?.schwere === 'kritisch')
p('frisch angeheftet ohne Vorgeschichte: nur Auskunft',
    pruefeRegeln(fav, ruhig, { preisUsd: 1, liquiditaetUsd: 100000 }, {}, vertragsKo)
        .find((a) => a.regel === 'sicherheit')?.schwere === 'info')
p('GoPlus-Ausfall (ungeprueft) ist kein Befund',
    !pruefeRegeln(fav, ruhig, { preisUsd: 1, liquiditaetUsd: 100000 }, { status: 'bestanden' },
        { status: 'verworfen', grund: 'ungeprueft' }).some((a) => a.regel === 'sicherheit'))
p('Pendeln um die Mindestliquidität ist kein Sicherheitsalarm',
    !pruefeRegeln(fav, ruhig, { preisUsd: 1, liquiditaetUsd: 49000 }, { status: 'bestanden' },
        { status: 'verworfen', grund: 'liquiditaet_zu_klein' }).some((a) => a.regel === 'sicherheit'))

// Börsenpfad: der rollierende 24-h-Umsatz gegen seinen Höchststand.
p('Umsatz halbiert gegenüber dem Höchststand meldet',
    pruefeRegelnBoerse(bx, { ...bAlt, umsatz: 60e6, umsatzReferenz: 100e6 }, { ...bNeu, umsatz24h: 45e6 })
        .some((a) => a.regel === 'umsatzEinbruch'))

// ntfy: Titel mit Nicht-Latin-1-Zeichen gehen über JSON.
{
    const n = ntfyNachricht({ regel: 'liqAbfluss', schwere: 'kritisch', meldung: 'm' }, { symbol: '币安' })
    p('ntfy-Titel darf UTF-8 tragen', n.title === '币安 (liqAbfluss)' && n.priority === 5)
}

/*
 * Einstellungen: Ein geleertes Zahlenfeld wirkte wie 0 — Alarme bei 0,1 %,
 * Mindestliquidität aus. Und die aufgefüllten Vorgaben froren beim ersten
 * Speichern in der Datenbank ein.
 */
{
    const b = bereinigeEinstellungen(
        {
            alarmRegeln: { ...STANDARD_ALARM_REGELN, preisSprungPct: '', liqAbflussPct: 25 },
            sicherheit: { minLiquiditaetUsd: '', maxTop10Prozent: 40, lpMussGesperrtSein: false },
            minHypeScore: '',
            wachhundIntervallMin: '30',
            unbekannt: 1,
        },
        { alarmRegeln: STANDARD_ALARM_REGELN })
    p('leeres Zahlenfeld fällt weg (Vorgabe greift)', !('preisSprungPct' in b.alarmRegeln) && !('minHypeScore' in b))
    p('nur Abweichungen werden gespeichert',
        JSON.stringify(b.alarmRegeln) === JSON.stringify({ liqAbflussPct: 25 }), JSON.stringify(b.alarmRegeln))
    p('Sicherheit: leer fällt weg, Vorgabe fällt weg, Abweichung bleibt',
        JSON.stringify(b.sicherheit) === JSON.stringify({ lpMussGesperrtSein: false }), JSON.stringify(b.sicherheit))
    p('Zahl als Text wird Zahl', b.wachhundIntervallMin === 30)
    p('Unbekannte Schlüssel sickern nicht ein', !('unbekannt' in b))
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
