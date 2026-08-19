/**
 * Selbsttest: Stufen, Profile und Rollen des Hype-Radars.
 *
 * Ohne Netz und ohne Datenbank. Der Kern ist die eine Prüfung, die R-15
 * gefunden hätte: JEDE Rolle, für die ein Schlüssel verlangt wird, muss im
 * Berichtspfad auch wirklich gerufen werden.
 *
 * `helper` stand über Monate in `ROLLEN`, wurde von `benoetigteAnbieter`
 * abgefragt und von `bericht.js` nie benutzt. Ein fehlender Schlüssel für eine
 * Rolle, die nichts tut, blockierte damit manuelle wie automatische Berichte —
 * und die Oberfläche bot obendrein eine folgenlose Modellwahl dafür an.
 *
 * Deshalb liest dieser Test den QUELLTEXT von `bericht.js`. Ein Test, der nur
 * Funktionen aufruft, hätte die Lücke nie gesehen: es fehlte ja kein
 * Rückgabewert, sondern ein Aufruf.
 *
 * Aufruf: node server/hype-radar/__selftest-stufen.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROLLEN, PROFILE, STUFEN, stufe, stufenNach, rollenAnbieter, benoetigteAnbieter } from './stufen.js'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Hype-Radar: Stufen & Rollen')

// ── Der Befund R-15 ─────────────────────────────────────────────────────
const hier = path.dirname(fileURLToPath(import.meta.url))
const berichtQuelle = readFileSync(path.join(hier, 'bericht.js'), 'utf8')

for (const rolle of ROLLEN) {
    p(`Rolle „${rolle}" wird im Bericht auch gerufen`,
        new RegExp(`rollenAnbieter\\([^)]*['"]${rolle}['"]`).test(berichtQuelle),
        'in ROLLEN, aber kein rollenAnbieter-Aufruf in bericht.js')
}

// Und die Gegenrichtung: keine Rolle rufen, die nicht in ROLLEN steht — sonst
// fehlte für sie die Schlüsselprüfung, und der Lauf bräche mitten im Bericht ab.
for (const m of berichtQuelle.matchAll(/rollenAnbieter\([^)]*['"](\w+)['"]/g)) {
    p(`gerufene Rolle „${m[1]}" ist in ROLLEN bekannt`, ROLLEN.includes(m[1]))
}

// ── Profile decken alle Rollen ──────────────────────────────────────────
for (const [name, belegung] of Object.entries(PROFILE)) {
    for (const rolle of ROLLEN) {
        p(`Profil „${name}" belegt „${rolle}"`,
            Boolean(belegung[rolle]?.provider && belegung[rolle]?.modell),
            JSON.stringify(belegung[rolle]))
    }
    p(`Profil „${name}" führt keine unbekannte Rolle`,
        Object.keys(belegung).every((r) => ROLLEN.includes(r)),
        Object.keys(belegung).join(','))
}

// ── Schlüsselprüfung ────────────────────────────────────────────────────
{
    const gruendlich = benoetigteAnbieter({ llmStufe: 'gruendlich-mittel' })
    p('gründlich verlangt Recherche- und Redaktionsanbieter',
        gruendlich.includes('moonshot') && gruendlich.includes('anthropic'),
        gruendlich.join(','))

    // Im einfachen Modus schreibt dasselbe Modell, das recherchiert — dann
    // darf auch nur dessen Schlüssel verlangt werden.
    const einfach = benoetigteAnbieter({ llmStufe: 'einfach-mittel' })
    p('einfach verlangt nur den Redakteur', einfach.length === 1 && einfach[0] === 'anthropic',
        einfach.join(','))

    p('kein Anbieter wird doppelt verlangt',
        new Set(benoetigteAnbieter({ llmStufe: 'gruendlich-guenstig' })).size
        === benoetigteAnbieter({ llmStufe: 'gruendlich-guenstig' }).length)

    // Eigene Belegung schlägt die Stufe — sonst wäre „manuell" wirkungslos.
    const eigen = benoetigteAnbieter({
        llmStufe: 'gruendlich-mittel',
        llmRollen: { editor: { provider: 'ollama', modell: 'x' } },
    })
    p('eigene Rollenbelegung schlägt die Stufe',
        eigen.includes('ollama') && !eigen.includes('anthropic'), eigen.join(','))
}

// ── Stufen-Tabelle ──────────────────────────────────────────────────────
{
    p('sechs Stufen', STUFEN.length === 6)
    const preise = STUFEN.map((s) => s.preisRang).sort((a, b) => a - b)
    const guete = STUFEN.map((s) => s.guteRang).sort((a, b) => a - b)
    p('Preisränge lückenlos 1..6', preise.join() === '1,2,3,4,5,6', preise.join())
    p('Güteränge lückenlos 1..6', guete.join() === '1,2,3,4,5,6', guete.join())
    p('genau eine Empfehlung', STUFEN.filter((s) => s.empfohlen).length === 1)

    /*
     * Die Aussage, für die es diese Tabelle überhaupt gibt: Die beiden
     * Ordnungen sind NICHT gegenläufig. Wäre die teuerste immer die beste,
     * bräuchte niemand sechs benannte Stufen — dann genügte ein Schieberegler.
     */
    const gegenlaeufig = STUFEN.every((s) => s.preisRang + s.guteRang === 7)
    p('Preis und Güte laufen nicht stur gegeneinander', !gegenlaeufig)

    p('jede Stufe kennt ihre Rollenbelegung',
        STUFEN.every((s) => ROLLEN.every((r) => stufe(s.id)?.rollen?.[r]?.provider)))
    p('unbekannte Stufe liefert null', stufe('gibtsnicht') === null)
    p('Sortierung nach Güte beginnt beim besten', stufenNach('guete')[0].guteRang === 1)
    p('Sortierung nach Preis beginnt beim billigsten', stufenNach('preis')[0].preisRang === 1)
}

// ── Rückfall bei kaputter Einstellung ───────────────────────────────────
p('unbekannte Stufe fällt auf das mittlere Profil zurück',
    rollenAnbieter({ llmStufe: 'quatsch' }, 'editor')?.provider === PROFILE.mittel.editor.provider)
p('fehlende Einstellung ergibt trotzdem einen Anbieter',
    Boolean(rollenAnbieter({}, 'editor')?.provider))

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
