/**
 * Selbsttest des Radar-Zwischenspeichers (`ausCache` in marktradar-api.js).
 *
 *   node server/__selftest-radar-cache.mjs
 *
 * Geprüft wird der Fehlerpfad, nicht der Gutfall — dort lag der Befund des
 * Audits vom 19.08.2026: `ausCache` legte nur Erfolge ab. Nach einem
 * Fehlschlag galt eine Kachel damit sofort wieder als fällig, und der Client
 * fragte im PRÜFTAKT (3 s im Live-Trading) statt im Kachel-Intervall nach.
 * Wer wegen zu vieler Anfragen gesperrt war, verlängerte so die eigene Sperre.
 *
 * Kein Netz: die Abruffunktion ist eine Attrappe, die zählt, wie oft sie
 * wirklich gerufen wurde. Genau das ist die Frage.
 */

import { ausCache, _cacheZuruecksetzen } from './marktradar-api.js'

let bestanden = 0
let fehler = 0
function pruefe(name, bedingung, zusatz = '') {
    if (bedingung) { bestanden++; console.log(`  ✓ ${name}`) }
    else { fehler++; console.log(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}

const schlaf = (ms) => new Promise(r => setTimeout(r, ms))

console.log('Radar-Zwischenspeicher: Gutfall')

{
    _cacheZuruecksetzen()
    let rufe = 0
    const holen = async () => { rufe++; return { wert: rufe } }

    const a = await ausCache('t1', 10000, holen)
    const b = await ausCache('t1', 10000, holen)
    pruefe('zweiter Abruf innerhalb der Frist ruft die Quelle nicht erneut', rufe === 1, String(rufe))
    pruefe('beide liefern denselben Wert', a.wert === 1 && b.wert === 1)
    pruefe('erster Abruf ist MISS, zweiter HIT', a._cache === 'MISS' && b._cache === 'HIT',
        `${a._cache}/${b._cache}`)
    pruefe('frische Daten sind nicht veraltet', a.veraltet === false && b.veraltet === false)
}

console.log('\nAltstand statt leerer Kachel')

{
    _cacheZuruecksetzen()
    let rufe = 0
    let kaputt = false
    const holen = async () => {
        rufe++
        if (kaputt) throw new Error('Fremdquelle antwortet nicht')
        return { wert: 'gut' }
    }

    await ausCache('t2', 1, holen)      // Frist 1 ms: sofort wieder fällig
    await schlaf(5)
    kaputt = true
    const alt = await ausCache('t2', 1, holen)
    pruefe('bei Ausfall kommt der letzte Stand', alt.wert === 'gut', JSON.stringify(alt))
    pruefe('… und er ist als veraltet gekennzeichnet', alt.veraltet === true)
    pruefe('… mit Hinweis auf den Grund', String(alt.hinweis).includes('antwortet nicht'), alt.hinweis)
}

console.log('\nSperrfenster nach Fehlschlägen (der eigentliche Befund)')

{
    _cacheZuruecksetzen()
    let rufe = 0
    let kaputt = false
    const holen = async () => {
        rufe++
        if (kaputt) throw new Error('HTTP 429')
        return { wert: 'gut' }
    }

    await ausCache('t3', 1, holen)      // ein guter Stand im Speicher
    await schlaf(5)
    kaputt = true
    await ausCache('t3', 1, holen)      // erster Fehlschlag
    const nachFehler = rufe

    // Jetzt das, was der Client im Prüftakt tut: sofort wieder fragen.
    for (let i = 0; i < 5; i++) {
        const r = await ausCache('t3', 1, holen)
        pruefe(`Nachfrage ${i + 1} liefert weiter den Altstand`, r.wert === 'gut' && r.veraltet === true)
        pruefe(`Nachfrage ${i + 1} ist als Sperre gekennzeichnet`, r._cache === 'BACKOFF', r._cache)
    }
    pruefe('… ohne die gestörte Quelle noch einmal anzufassen',
        rufe === nachFehler, `${rufe} Abrufe statt ${nachFehler}`)
}

console.log('\nErholung: nach einem Erfolg ist die Sperre weg')

{
    _cacheZuruecksetzen()
    let rufe = 0
    let kaputt = true
    // Sperrfenster ist mindestens 30 s — für den Test bewusst NICHT abgewartet.
    // Geprüft wird stattdessen, dass ein Erfolg den Fehlerzähler löscht.
    const holen = async () => {
        rufe++
        if (kaputt) throw new Error('kaputt')
        return { wert: rufe }
    }

    // Ohne Altstand muss der Fehler durchschlagen — eine leere Kachel ist
    // besser als eine, die etwas erfindet.
    let geworfen = false
    try { await ausCache('t4', 1, holen) } catch { geworfen = true }
    pruefe('ohne Altstand wirft der Fehler durch', geworfen)

    kaputt = false
    const gut = await ausCache('t4', 1, holen)
    pruefe('nach dem Fehlschlag ohne Altstand wird sofort neu versucht', gut.wert === 2, String(gut.wert))

    await schlaf(5)
    kaputt = true
    const jetztAlt = await ausCache('t4', 1, holen)
    pruefe('der Erfolg löschte die Sperre — der nächste Fehlschlag wird wirklich versucht',
        rufe === 3 && jetztAlt.veraltet === true, `${rufe} Abrufe`)
}

console.log('\nMehrfachabruf-Bündelung')

{
    _cacheZuruecksetzen()
    let rufe = 0
    const holen = async () => { rufe++; await schlaf(20); return { wert: rufe } }

    const [a, b, c] = await Promise.all([
        ausCache('t5', 10000, holen),
        ausCache('t5', 10000, holen),
        ausCache('t5', 10000, holen),
    ])
    pruefe('drei gleichzeitige Anfragen teilen einen Abruf', rufe === 1, String(rufe))
    pruefe('alle drei bekommen dasselbe Ergebnis',
        a.wert === 1 && b.wert === 1 && c.wert === 1)
}

console.log(`\n${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
