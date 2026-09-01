/**
 * Default Share Card Templates — shipped with the app.
 * Reads PNG/JPG images from server/templates/ and seeds them into the database.
 *
 * Expected files:
 *   server/templates/loss-1.png  — Bear (Loss) template 1
 *   server/templates/loss-2.png  — Bear (Loss) template 2
 *   server/templates/loss-3.png  — Bear (Loss) template 3
 *   server/templates/loss-4.png  — Bear (Loss) template 4
 *   server/templates/win-1.png   — Bull (Win) template 1
 *   server/templates/win-2.png   — Bull (Win) template 2
 *   server/templates/win-3.png   — Bull (Win) template 3
 *   server/templates/win-4.png   — Bull (Win) template 4
 *   server/templates/loss-bull-1.png — Defeated Bull (Long Loss) template 1
 *   server/templates/loss-bull-2.png — Defeated Bull (Long Loss) template 2
 *   server/templates/loss-bull-3.png — Defeated Bull (Long Loss) template 3
 *   server/templates/win-short-1.png — Panda (Short Win) template 1
 *   server/templates/win-short-2.png — Bear (Short Win) template 2
 *   server/templates/win-short-3.png — Panda (Short Win) template 3
 *
 * Images are resized to 1080x1080 and stored as base64 in the DB.
 */
import sharp from 'sharp'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const SIZE = 1080
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = path.join(__dirname, 'templates')

/**
 * Template definitions: filename → display name + category.
 *
 * `category` ist Gewinn/Verlust (die Stimmung des Bilds — triumphierend vs.
 * niedergeschlagen), NICHT Long/Short. Das Dateinamen-Präfix nennt schon das
 * Motiv (Bulle vs. Bär/Panda), das Suffix `-bull`/`-short` sagt nur, WELCHES
 * Tier gezeichnet ist, nicht die Stimmung — `loss-bull-*` ist ein
 * niedergeschlagener Bulle (Verlust-Bild), `win-short-*` ein siegreicher
 * Bär/Panda (Gewinn-Bild). Früher stand hier versehentlich Long/Short nach
 * Tier statt Gewinn/Verlust nach Stimmung — „Friedhof der Bullen" (ein
 * Verlust-Motiv) landete dadurch bei jedem gewonnenen Long-Trade in der
 * Auswahl.
 */
const TEMPLATE_DEFS = [
    { file: 'loss-1.png', name: 'Verlassene Fabrik', category: 'loss' },
    { file: 'loss-2.png', name: 'Canyon der Verzweiflung', category: 'loss' },
    { file: 'loss-3.png', name: 'Wüstensturm', category: 'loss' },
    { file: 'loss-4.png', name: 'Nebelwald', category: 'loss' },
    { file: 'win-1.png', name: 'Stadt der Wolken', category: 'win' },
    { file: 'win-2.png', name: 'Keltischer Wächter', category: 'win' },
    { file: 'win-3.png', name: 'Canyon Triumph', category: 'win' },
    { file: 'win-4.png', name: 'Wallstreet Palast', category: 'win' },
    { file: 'loss-bull-1.png', name: 'Regen Wall Street', category: 'loss' },
    { file: 'loss-bull-2.png', name: 'Verlorener Dschungel', category: 'loss' },
    { file: 'loss-bull-3.png', name: 'Friedhof der Bullen', category: 'loss' },
    { file: 'win-short-1.png', name: 'Bambus Sieger', category: 'win' },
    { file: 'win-short-2.png', name: 'Bären Chaos', category: 'win' },
    { file: 'win-short-3.png', name: 'Biergarten Party', category: 'win' },
]

/** Datei zu einer Vorlage finden — .png oder .jpg. */
function findeDatei(tpl) {
    const filePath = path.join(TEMPLATES_DIR, tpl.file)
    const jpgPath = filePath.replace('.png', '.jpg')
    return existsSync(filePath) ? filePath : existsSync(jpgPath) ? jpgPath : null
}

/** Bilddatei einer Vorlage laden und auf die Speichergrösse bringen — von Seeding UND Korrektur gebraucht. */
async function ladeVorlagenBild(tpl) {
    const actualPath = findeDatei(tpl)
    if (!actualPath) return null
    const imgBuf = await readFile(actualPath)
    const resized = await sharp(imgBuf).resize(SIZE, SIZE, { fit: 'cover' }).png().toBuffer()
    return resized.toString('base64')
}

// ============================================================
// Seed default templates (called from database.js)
// ============================================================

export async function seedDefaultTemplates(knex) {
    // Check which default templates already exist (by name)
    const existing = await knex('share_card_templates')
        .select('name')
        .whereIn('name', TEMPLATE_DEFS.map(t => t.name))
    const existingNames = new Set(existing.map(r => r.name))

    const missing = TEMPLATE_DEFS.filter(t => !existingNames.has(t.name))
    if (missing.length === 0) return

    console.log(` -> Seeding ${missing.length} default share card templates...`)
    let seeded = 0

    for (const tpl of missing) {
        try {
            const imageBase64 = await ladeVorlagenBild(tpl)
            if (!imageBase64) continue

            await knex('share_card_templates').insert({
                name: tpl.name,
                prompt: '',
                imageBase64,
                category: tpl.category,
                istStandard: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            })
            seeded++
            console.log(`    -> "${tpl.name}" (${tpl.category}) ✓`)
        } catch (e) {
            console.warn(`    -> "${tpl.name}" failed: ${e.message}`)
        }
    }

    if (seeded > 0) {
        console.log(` -> ${seeded} default templates seeded`)
    } else {
        console.log(' -> No template images found in server/templates/ — skipping seed')
    }
}

/**
 * Einmalig: bereits gespeicherte Standard-Vorlagen aus einem älteren Codestand
 * auf die richtige Kategorie UND den `istStandard`-Vermerk ziehen.
 *
 * Zwei Altlasten, die vor `istStandard` entstanden:
 *   1. Zeilen aus dem allerersten Seeding trugen die alte (falsche)
 *      Long/Short-Kategorie statt Gewinn/Verlust — „Friedhof der Bullen"
 *      (ein Verlust-Motiv) landete dadurch bei jedem gewonnenen Long-Trade
 *      in der Auswahl.
 *   2. Eigene Vorlagen des Nutzers, ebenfalls noch mit Long/Short beschriftet
 *      (aus dem alten `saveAsTemplate`), passen zu KEINER der beiden neuen
 *      Kategorien mehr und verschwinden dadurch aus jeder Auswahl — für sie
 *      gibt es kein Richtig-oder-Falsch nachzuvollziehen, also zurück auf
 *      „ohne Kategorie", das zeigt sie wieder bei jedem Trade statt bei
 *      keinem.
 *
 * Namensgleichheit allein wäre als dauerhaftes Erkennungsmerkmal für „ist
 * Standard" gefährlich: eine eigene Vorlage, die zufällig genauso heisst wie
 * eine der 14 mitgelieferten (z.B. „Wallstreet Palast"), würde sonst
 * mitkorrigiert. Ein Bild-Byte-Vergleich gegen die mitgelieferte Datei wäre
 * die sauberere Unterscheidung — erwies sich aber als brüchig: dieselbe
 * PNG-Kodierung liefert je nach Sharp-/libvips-Version unterschiedliche
 * Bytes für dasselbe Bild, verglichen an echten Altdaten schlug er bei 12
 * von 14 echten Standard-Zeilen fehl. Deshalb hier bewusst nur Namensabgleich
 * — mit dem eng begrenzten Restrisiko einer Namensgleichheit GENAU in der
 * kurzen Zeitspanne zwischen diesem Update und seinem ersten Serverstart.
 * Der eigentliche, dauerhafte Schutz ist `istStandard`: Es wird ab jetzt bei
 * jeder Neuanlage sauber gesetzt (`seedDefaultTemplates` immer `true`,
 * `saveAsTemplate` implizit `false`) — diese Funktion läuft nur EINMAL, um
 * die Zeilen aus der Zeit VOR `istStandard` nachzuziehen.
 *
 * Läuft dank des `vorlagenKategorienKorrigiert`-Vermerks nur dieses eine Mal.
 */
export async function korrigiereVorlagenKategorien(knex) {
    const stand = await knex('settings').select('vorlagenKategorienKorrigiert').where('id', 1).first()
    if (!stand || stand.vorlagenKategorienKorrigiert) return

    let korrigiert = 0
    for (const tpl of TEMPLATE_DEFS) {
        const anzahl = await knex('share_card_templates')
            .where({ name: tpl.name })
            .andWhere((qb) => qb.whereNot({ category: tpl.category }).orWhereNot({ istStandard: true }))
            .update({ category: tpl.category, istStandard: true, updatedAt: new Date().toISOString() })
        korrigiert += anzahl
    }

    // Eigene Vorlagen mit der alten Kategorie: zurück auf „ohne Kategorie"
    // statt für immer aus jeder Auswahl zu verschwinden.
    const zurueckgesetzt = await knex('share_card_templates')
        .where({ istStandard: false })
        .whereIn('category', ['long', 'short'])
        .update({ category: '', updatedAt: new Date().toISOString() })

    if (korrigiert > 0) {
        console.log(` -> ${korrigiert} Vorlagen-Kategorie(n) von Long/Short auf Gewinn/Verlust korrigiert`)
    }
    if (zurueckgesetzt > 0) {
        console.log(` -> ${zurueckgesetzt} eigene Vorlage(n) mit alter Kategorie auf „ohne Kategorie" zurückgesetzt`)
    }
    await knex('settings').where('id', 1).update({ vorlagenKategorienKorrigiert: 1 })
}
