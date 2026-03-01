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

// Template definitions: filename → display name + category
const TEMPLATE_DEFS = [
    { file: 'loss-1.png', name: 'Verlassene Fabrik', category: 'short' },
    { file: 'loss-2.png', name: 'Canyon der Verzweiflung', category: 'short' },
    { file: 'loss-3.png', name: 'Wüstensturm', category: 'short' },
    { file: 'loss-4.png', name: 'Nebelwald', category: 'short' },
    { file: 'win-1.png', name: 'Stadt der Wolken', category: 'long' },
    { file: 'win-2.png', name: 'Keltischer Wächter', category: 'long' },
    { file: 'win-3.png', name: 'Canyon Triumph', category: 'long' },
    { file: 'win-4.png', name: 'Wallstreet Palast', category: 'long' },
    { file: 'loss-bull-1.png', name: 'Regen Wall Street', category: 'long' },
    { file: 'loss-bull-2.png', name: 'Verlorener Dschungel', category: 'long' },
    { file: 'loss-bull-3.png', name: 'Friedhof der Bullen', category: 'long' },
    { file: 'win-short-1.png', name: 'Bambus Sieger', category: 'short' },
    { file: 'win-short-2.png', name: 'Bären Chaos', category: 'short' },
    { file: 'win-short-3.png', name: 'Biergarten Party', category: 'short' },
]

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
        const filePath = path.join(TEMPLATES_DIR, tpl.file)

        // Also check for .jpg variant
        const jpgPath = filePath.replace('.png', '.jpg')
        const actualPath = existsSync(filePath) ? filePath : existsSync(jpgPath) ? jpgPath : null

        if (!actualPath) continue

        try {
            const imgBuf = await readFile(actualPath)
            const resized = await sharp(imgBuf)
                .resize(SIZE, SIZE, { fit: 'cover' })
                .png()
                .toBuffer()

            const imageBase64 = resized.toString('base64')

            await knex('share_card_templates').insert({
                name: tpl.name,
                prompt: '',
                imageBase64,
                category: tpl.category,
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
