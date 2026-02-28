/**
 * Share Card API — FLUX.2 (Black Forest Labs) + Google Gemini (Nano Banana).
 * Generates stylized trade share images with AI backgrounds + SVG text overlay.
 */
import { getKnex } from './database.js'
import { encrypt, decrypt } from './crypto.js'
import sharp from 'sharp'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import path from 'path'

const BFL_API_BASE = 'https://api.bfl.ai/v1'

// Default avatar: app logo resized to 64x64 PNG, cached as base64 data URL
let defaultAvatarDataUrl = ''

async function initDefaultAvatar() {
    try {
        const __dirname = path.dirname(fileURLToPath(import.meta.url))
        const logoPath = path.join(__dirname, '..', 'src', 'assets', 'icon.png')
        const logoBuf = await readFile(logoPath)
        const resized = await sharp(logoBuf)
            .resize(64, 64, { fit: 'cover' })
            .png()
            .toBuffer()
        defaultAvatarDataUrl = `data:image/png;base64,${resized.toString('base64')}`
    } catch (e) {
        console.warn(' -> FLUX: Could not load default avatar logo:', e.message)
    }
}

// ============================================================
// Helpers
// ============================================================

function maskKey(encryptedKey) {
    if (!encryptedKey) return ''
    const key = decrypt(encryptedKey)
    if (!key) return ''
    if (key.length <= 8) return '•'.repeat(key.length)
    return key.slice(0, 4) + '•'.repeat(Math.min(key.length - 8, 20)) + key.slice(-4)
}

function formatNumber(num, decimals = 2) {
    if (num == null || isNaN(num)) return '0'
    return Number(num).toFixed(decimals)
}

function smartDecimals(price) {
    const p = Number(price || 0)
    if (p === 0) return '0'
    if (p >= 100) return p.toFixed(2)
    if (p >= 1) return p.toFixed(4)
    if (p >= 0.01) return p.toFixed(5)
    return p.toFixed(6)
}

function formatDate(unixVal) {
    // Trade timestamps are stored in seconds; convert to ms if needed
    const ms = unixVal < 1e12 ? unixVal * 1000 : unixVal
    const d = new Date(ms)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ============================================================
// Prompt Builder
// ============================================================

function buildShareCardPrompt(trade) {
    const isLong = trade.strategy === 'long'
    const isWin = (trade.netProceeds || 0) > 0

    const animal = isWin ? 'bull' : 'bear'
    let mood, scene
    if (isWin) {
        mood = 'triumphant, golden rim lighting, epic atmosphere, glory'
        scene = 'bipedal bull standing upright on two hind legs on a mountain peak, one front hoof raised at 45 degree angle showing strength, exactly four limbs total, beautiful alpine landscape with dramatic sunset, snow-capped peaks in background, golden hour light'
    } else {
        mood = 'dramatic, moody blue lighting, rain, defeated atmosphere, failure'
        scene = 'on all four legs collapsed face-first onto the ground on a rainy city rooftop at night, four-legged animal lying defeated, neon reflections on wet ground'
    }

    return `Epic digital art of a powerful ${animal} in a dramatic pose, ${scene}, ${mood}, cinematic composition, crypto trading theme, professional illustration, ultra detailed, 4k quality. Clean image without any text or watermarks.`
}

// ============================================================
// SVG Overlay Builder
// ============================================================

function buildOverlaySvg(trade, displayName, avatarDataUrl, width, height, opts = {}) {
    const { hidePnlAmount, showTags, showRrr, comment } = opts
    const isWin = (trade.netProceeds || 0) > 0
    const pnlColor = isWin ? '#26a69a' : '#ef5350'
    const direction = trade.strategy === 'long' ? 'Long' : 'Short'
    const leverage = trade.leverage ? `${trade.leverage}X` : ''
    const symbol = (trade.symbol || 'UNKNOWN').replace(/USDT$/, 'USDT')

    // Calculate P&L percentage
    let pnlPercent = 0
    if (trade.entryPrice && trade.exitPrice && trade.entryPrice !== 0) {
        const priceDiff = trade.strategy === 'long'
            ? (trade.exitPrice - trade.entryPrice) / trade.entryPrice
            : (trade.entryPrice - trade.exitPrice) / trade.entryPrice
        pnlPercent = priceDiff * (trade.leverage || 1) * 100
    }

    const pnlSign = isWin ? '+' : ''
    const pnlPercentStr = `${pnlSign}${formatNumber(pnlPercent)}%`
    const pnlAmountStr = hidePnlAmount ? '••••• USDT' : `${pnlSign}${formatNumber(trade.netProceeds)} USDT`
    const entryStr = smartDecimals(trade.entryPrice)
    const exitStr = smartDecimals(trade.exitPrice)
    const dateStr = trade.exitTime ? formatDate(trade.exitTime) : (trade.dateUnix ? formatDate(trade.dateUnix) : '')
    const name = displayName || ''

    // Direction color
    const dirColor = trade.strategy === 'long' ? '#26a69a' : '#ef5350'

    // Logo (top right): use default app logo — 140px
    const logo = defaultAvatarDataUrl
    const logoSize = 140
    const logoX = width - logoSize - 20
    const logoY = 10

    // Build logo SVG snippet (circular, top right)
    const logoSvg = logo ? `
  <!-- App Logo (top right, circular) -->
  <defs>
    <clipPath id="logoClip">
      <circle cx="${logoX + logoSize / 2}" cy="${logoY + logoSize / 2}" r="${logoSize / 2}" />
    </clipPath>
  </defs>
  <image href="${logo}" x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}" clip-path="url(#logoClip)" preserveAspectRatio="xMidYMid slice" />
  <circle cx="${logoX + logoSize / 2}" cy="${logoY + logoSize / 2}" r="${logoSize / 2}" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="2.5" />` : ''

    // Bottom left: "by CRYPTO TRADING JOURNAL"
    const byLine = 'by CRYPTO TRADING JOURNAL'

    // Display name: positioned left of logo in top bar
    const nameSvg = name ? `
  <text x="${logoX - 15}" y="${logoY + logoSize / 2 + 8}" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="28" font-weight="bold" fill="#ffffff" text-anchor="end">${name}</text>` : ''

    // Strategy line: "Strategie: Tag1, Tag2" below symbol bar
    const tagNames = (showTags && Array.isArray(trade.tagNames) && trade.tagNames.length) ? trade.tagNames : []
    const strategyStr = tagNames.join(', ')
    const tagsSvg = strategyStr ? `
  <text x="50" y="135" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="26" fill="#81d4fa"><tspan fill="#aaaaaa">Strategie: </tspan>${strategyStr}</text>` : ''

    // RRR: show next to leverage
    const rrr = (showRrr && trade.rrr) ? trade.rrr : ''

    // Sanitize comment for SVG (escape XML entities)
    const safeComment = (comment || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

    // Comment: word-wrap into lines of ~40 chars max, max 3 lines — BIGGER font (28px)
    const commentLines = []
    if (safeComment) {
        const words = safeComment.split(/\s+/)
        let line = ''
        for (const word of words) {
            if ((line + ' ' + word).trim().length > 40) {
                commentLines.push(line.trim())
                line = word
                if (commentLines.length >= 3) break
            } else {
                line = line ? line + ' ' + word : word
            }
        }
        if (line.trim() && commentLines.length < 3) commentLines.push(line.trim())
    }

    // Comment SVG: positioned between exit price and byLine — font 28px
    const commentStartY = height * 0.89
    const commentSvg = commentLines.map((ln, i) =>
        `  <text x="60" y="${commentStartY + i * 34}" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="28" font-style="italic" fill="#dddddd">${ln}</text>`
    ).join('\n')

    // Symbol text positioning with proper spacing
    const symbolEndX = 50 + symbol.length * 26
    const dirStartX = symbolEndX + 40
    const levStartX = dirStartX + direction.length * 20 + 20
    // RRR after leverage
    const rrrStartX = leverage ? levStartX + leverage.length * 18 + 25 : levStartX
    const rrrSvg = rrr ? `
  <text x="${rrrStartX}" y="95" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="28" font-weight="bold" fill="#a78bfa">RRR 1:${rrr}</text>` : ''

    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}">
  <defs>
    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(0,0,0,0)" />
      <stop offset="30%" stop-color="rgba(0,0,0,0.3)" />
      <stop offset="100%" stop-color="rgba(0,0,0,0.85)" />
    </linearGradient>
  </defs>

  <!-- Dark gradient overlay bottom half -->
  <rect x="0" y="${height * 0.45}" width="${width}" height="${height * 0.55}" fill="url(#grad)" />

  <!-- Top: subtle dark bar for symbol + tags + logo -->
  <rect x="0" y="0" width="${width}" height="${tagsSvg ? 165 : 130}" fill="rgba(0,0,0,0.5)" />

  ${logoSvg}
  ${nameSvg}

  <!-- Symbol + Direction + Leverage + RRR (with spacing) -->
  <text x="50" y="95" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="42" font-weight="bold" fill="#ffffff" letter-spacing="1">${symbol}</text>
  <text x="${dirStartX}" y="95" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="32" font-weight="bold" fill="${dirColor}">${direction}</text>
  <text x="${levStartX}" y="95" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="32" fill="#cccccc">${leverage}</text>
  ${rrrSvg}

  <!-- Tags (below symbol line) -->
  ${tagsSvg}

  <!-- P&L Percentage (large) -->
  <text x="60" y="${height * 0.62}" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="72" font-weight="bold" fill="${pnlColor}">${pnlPercentStr}</text>

  <!-- P&L Amount -->
  <text x="60" y="${height * 0.69}" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="34" font-weight="600" fill="${pnlColor}">${pnlAmountStr}</text>

  <!-- Entry / Exit prices -->
  <text x="60" y="${height * 0.78}" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="26" fill="#aaaaaa">Einstiegspreis</text>
  <text x="340" y="${height * 0.78}" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="26" font-weight="bold" fill="#ffffff">${entryStr}</text>

  <text x="60" y="${height * 0.84}" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="26" fill="#aaaaaa">Schlusspreis</text>
  <text x="340" y="${height * 0.84}" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="26" font-weight="bold" fill="#ffffff">${exitStr}</text>

${commentSvg}

  <!-- Bottom left: "by CRYPTO TRADING JOURNAL" -->
  <text x="60" y="${height * 0.97}" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="22" fill="#888888">${byLine}</text>
  <!-- Bottom right: Date -->
  <text x="${width - 60}" y="${height * 0.97}" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="22" fill="#888888" text-anchor="end">${dateStr}</text>
</svg>`
}

// ============================================================
// FLUX.2 API Communication
// ============================================================

async function callFluxApi(apiKey, model, prompt, width = 1080, height = 1080) {
    const endpoint = `${BFL_API_BASE}/${model}`

    // Submit generation request
    const submitRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'accept': 'application/json',
            'x-key': apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            prompt,
            width,
            height,
            output_format: 'jpeg',
            safety_tolerance: 2
        })
    })

    if (!submitRes.ok) {
        const err = await submitRes.text()
        throw new Error(`FLUX API error (${submitRes.status}): ${err}`)
    }

    const submitData = await submitRes.json()
    const pollingUrl = submitData.polling_url

    if (!pollingUrl) {
        throw new Error('No polling URL returned from FLUX API')
    }

    // Poll for result
    const maxWait = 120000 // 2 minutes
    const pollInterval = 1500
    const startTime = Date.now()

    while (Date.now() - startTime < maxWait) {
        await new Promise(r => setTimeout(r, pollInterval))

        const pollRes = await fetch(pollingUrl, {
            headers: {
                'accept': 'application/json',
                'x-key': apiKey
            }
        })

        if (!pollRes.ok) continue

        const pollData = await pollRes.json()

        if (pollData.status === 'Ready' && pollData.result?.sample) {
            return pollData.result.sample
        }

        if (pollData.status === 'Error' || pollData.status === 'Request Moderated' || pollData.status === 'Content Moderated') {
            throw new Error(`FLUX generation failed: ${pollData.status}`)
        }
    }

    throw new Error('FLUX generation timed out (120s)')
}

// ============================================================
// Google Gemini (Nano Banana) API Communication
// ============================================================

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

async function callGeminiApi(apiKey, model, prompt) {
    const endpoint = `${GEMINI_API_BASE}/models/${model}:generateContent`

    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
        })
    })

    if (!res.ok) {
        const errText = await res.text()
        let msg = `Gemini API Fehler (${res.status})`
        try {
            const errJson = JSON.parse(errText)
            const detail = errJson.error?.message || ''
            if (res.status === 429) msg = 'Gemini Rate-Limit erreicht. Bitte warte kurz oder wechsle das Modell.'
            else if (res.status === 404) msg = `Gemini Modell nicht gefunden. Bitte in Einstellungen prüfen.`
            else if (detail) msg = `Gemini: ${detail.slice(0, 150)}`
        } catch (_) { /* use default msg */ }
        throw new Error(msg)
    }

    const data = await res.json()
    const candidates = data.candidates || []
    for (const candidate of candidates) {
        const parts = candidate.content?.parts || []
        for (const part of parts) {
            if (part.inlineData && part.inlineData.mimeType?.startsWith('image/')) {
                return Buffer.from(part.inlineData.data, 'base64')
            }
        }
    }

    throw new Error('Gemini returned no image in response')
}

// ============================================================
// Provider Abstraction
// ============================================================

async function generateBackgroundImage(provider, settings, prompt) {
    if (provider === 'gemini') {
        const apiKey = settings.geminiImageApiKey ? decrypt(settings.geminiImageApiKey) : ''
        if (!apiKey) throw new Error('Kein Gemini API-Key konfiguriert. Bitte in den Einstellungen hinterlegen.')
        const model = settings.geminiImageModel || 'gemini-2.5-flash-image'
        console.log(` -> Gemini generating share card (${model})...`)
        return await callGeminiApi(apiKey, model, prompt)
    } else {
        const apiKey = settings.fluxApiKey ? decrypt(settings.fluxApiKey) : ''
        if (!apiKey) throw new Error('Kein FLUX API-Key konfiguriert. Bitte in den Einstellungen hinterlegen.')
        const model = settings.fluxModel || 'flux-2-pro'
        console.log(` -> FLUX.2 generating share card (${model})...`)
        const imageUrl = await callFluxApi(apiKey, model, prompt, 1080, 1080)
        const imgRes = await fetch(imageUrl)
        if (!imgRes.ok) throw new Error('Failed to download generated image')
        return Buffer.from(await imgRes.arrayBuffer())
    }
}

// ============================================================
// Routes
// ============================================================

export async function setupFluxRoutes(app) {

    // Load default avatar (app logo) at startup
    await initDefaultAvatar()

    // --- Load share card settings (key masked) ---
    app.get('/api/flux/settings', async (req, res) => {
        try {
            const knex = getKnex()
            const settings = await knex('settings')
                .select('fluxApiKey', 'fluxModel', 'fluxDisplayName', 'fluxAvatar', 'fluxUseCustomAvatar',
                    'shareCardProvider', 'geminiImageApiKey', 'geminiImageModel')
                .where('id', 1).first()

            res.json({
                shareCardProvider: settings?.shareCardProvider || 'flux',
                fluxApiKey: maskKey(settings?.fluxApiKey),
                fluxModel: settings?.fluxModel || 'flux-2-pro',
                fluxDisplayName: settings?.fluxDisplayName || '',
                fluxAvatar: settings?.fluxAvatar || '',
                fluxUseCustomAvatar: !!settings?.fluxUseCustomAvatar,
                geminiImageApiKey: maskKey(settings?.geminiImageApiKey),
                geminiImageModel: settings?.geminiImageModel || 'gemini-2.5-flash-image'
            })
        } catch (e) {
            console.error('Load share card settings error:', e)
            res.status(500).json({ error: e.message })
        }
    })

    // --- Save share card settings (encrypt API keys) ---
    app.post('/api/flux/settings', async (req, res) => {
        try {
            const knex = getKnex()
            const { fluxApiKey, fluxModel, fluxDisplayName, fluxAvatar, fluxUseCustomAvatar,
                shareCardProvider, geminiImageApiKey, geminiImageModel } = req.body
            const update = {}

            if (shareCardProvider !== undefined) update.shareCardProvider = shareCardProvider
            if (fluxModel !== undefined) update.fluxModel = fluxModel
            if (fluxDisplayName !== undefined) update.fluxDisplayName = fluxDisplayName
            if (fluxAvatar !== undefined) update.fluxAvatar = fluxAvatar
            if (fluxUseCustomAvatar !== undefined) update.fluxUseCustomAvatar = fluxUseCustomAvatar ? 1 : 0
            if (geminiImageModel !== undefined) update.geminiImageModel = geminiImageModel

            // Only update keys if not masked
            if (fluxApiKey !== undefined && !fluxApiKey.includes('•')) {
                update.fluxApiKey = fluxApiKey ? encrypt(fluxApiKey) : ''
            }
            if (geminiImageApiKey !== undefined && !geminiImageApiKey.includes('•')) {
                update.geminiImageApiKey = geminiImageApiKey ? encrypt(geminiImageApiKey) : ''
            }

            if (Object.keys(update).length > 0) {
                await knex('settings').where('id', 1).update(update)
            }

            res.json({ success: true })
        } catch (e) {
            console.error('Save share card settings error:', e)
            res.status(500).json({ error: e.message })
        }
    })

    // --- Test FLUX API key (check credits) ---
    app.post('/api/flux/test', async (req, res) => {
        try {
            let apiKey = req.body.fluxApiKey

            // If masked or empty, use stored key
            if (!apiKey || apiKey.includes('•')) {
                const knex = getKnex()
                const settings = await knex('settings').select('fluxApiKey').where('id', 1).first()
                apiKey = settings?.fluxApiKey ? decrypt(settings.fluxApiKey) : ''
            }

            if (!apiKey) {
                return res.json({ success: false, message: 'Kein API-Key konfiguriert' })
            }

            const creditsRes = await fetch(`${BFL_API_BASE}/credits`, {
                headers: { 'x-key': apiKey, 'accept': 'application/json' }
            })

            if (!creditsRes.ok) {
                return res.json({ success: false, message: `API-Fehler: ${creditsRes.status}` })
            }

            const credits = await creditsRes.json()
            const balance = credits.credits ?? credits.remaining_credits ?? 'N/A'
            res.json({ success: true, message: `Verbunden! Credits: ${balance}` })
        } catch (e) {
            res.json({ success: false, message: `Verbindungsfehler: ${e.message}` })
        }
    })

    // --- Test Gemini API key ---
    app.post('/api/flux/test-gemini', async (req, res) => {
        try {
            let apiKey = req.body.geminiImageApiKey
            if (!apiKey || apiKey.includes('•')) {
                const knex = getKnex()
                const settings = await knex('settings').select('geminiImageApiKey').where('id', 1).first()
                apiKey = settings?.geminiImageApiKey ? decrypt(settings.geminiImageApiKey) : ''
            }
            if (!apiKey) {
                return res.json({ success: false, message: 'Kein API-Key konfiguriert' })
            }
            const testRes = await fetch(`${GEMINI_API_BASE}/models?key=${apiKey}`)
            if (!testRes.ok) {
                return res.json({ success: false, message: `API-Fehler: ${testRes.status}` })
            }
            const data = await testRes.json()
            const imageModels = (data.models || []).filter(m => m.name?.includes('image'))
            res.json({ success: true, message: `Verbunden! ${imageModels.length} Bild-Modelle verfügbar.` })
        } catch (e) {
            res.json({ success: false, message: `Verbindungsfehler: ${e.message}` })
        }
    })

    // --- Generate share card (provider-agnostic) ---
    app.post('/api/flux/generate', async (req, res) => {
        try {
            const knex = getKnex()
            const settings = await knex('settings')
                .select('fluxApiKey', 'fluxModel', 'fluxDisplayName', 'fluxAvatar', 'fluxUseCustomAvatar',
                    'shareCardProvider', 'geminiImageApiKey', 'geminiImageModel')
                .where('id', 1).first()

            const provider = settings?.shareCardProvider || 'flux'
            const displayName = settings?.fluxDisplayName || ''
            const avatarDataUrl = (settings?.fluxUseCustomAvatar && settings?.fluxAvatar) ? settings.fluxAvatar : ''
            const tradeData = req.body.trade
            const customPrompt = req.body.prompt
            const hidePnlAmount = !!req.body.hidePnlAmount
            const showTags = req.body.showTags !== false
            const showRrr = req.body.showRrr !== false
            const comment = req.body.comment || ''

            if (!tradeData) {
                return res.status(400).json({ error: 'Keine Trade-Daten übergeben' })
            }

            const prompt = customPrompt || buildShareCardPrompt(tradeData)

            // 1. Generate background via selected provider
            const imgBuffer = await generateBackgroundImage(provider, settings, prompt)

            // 1b. Keep raw background for template saving (before overlay)
            const bgResized = await sharp(imgBuffer).resize(1080, 1080).png().toBuffer()
            const backgroundBase64 = bgResized.toString('base64')

            // 2. Build SVG overlay
            const svgOverlay = buildOverlaySvg(tradeData, displayName, avatarDataUrl, 1080, 1080, { hidePnlAmount, showTags, showRrr, comment })

            // 3. Composite with sharp
            const composited = await sharp(bgResized)
                .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
                .png({ quality: 90 })
                .toBuffer()

            const base64 = composited.toString('base64')
            const dataUrl = `data:image/png;base64,${base64}`

            const providerLabel = provider === 'gemini' ? 'Gemini' : 'FLUX.2'
            console.log(` -> ${providerLabel} share card generated successfully`)
            // Return composited image + raw background (for template saving)
            res.json({ image: dataUrl, prompt, backgroundImage: backgroundBase64 })
        } catch (e) {
            console.error('Share card generate error:', e)
            res.status(500).json({ error: e.message })
        }
    })

    // --- Generate share card from saved template (no API call!) ---
    app.post('/api/flux/generate-from-template', async (req, res) => {
        try {
            const knex = getKnex()
            const { templateId, trade, hidePnlAmount, showTags, showRrr, comment } = req.body

            if (!templateId) return res.status(400).json({ error: 'Keine Vorlage angegeben' })
            if (!trade) return res.status(400).json({ error: 'Keine Trade-Daten übergeben' })

            // Load template from DB
            const template = await knex('share_card_templates').where('id', templateId).first()
            if (!template) return res.status(404).json({ error: 'Vorlage nicht gefunden' })
            if (!template.imageBase64) return res.status(400).json({ error: 'Vorlage hat kein Hintergrundbild' })

            // Load display settings
            const settings = await knex('settings')
                .select('fluxDisplayName', 'fluxAvatar', 'fluxUseCustomAvatar')
                .where('id', 1).first()

            const displayName = settings?.fluxDisplayName || ''
            const avatarDataUrl = (settings?.fluxUseCustomAvatar && settings?.fluxAvatar) ? settings.fluxAvatar : ''

            // Decode stored background
            const bgBuffer = Buffer.from(template.imageBase64, 'base64')

            // Build SVG overlay with current trade data
            const svgOverlay = buildOverlaySvg(trade, displayName, avatarDataUrl, 1080, 1080, {
                hidePnlAmount: !!hidePnlAmount,
                showTags: showTags !== false,
                showRrr: showRrr !== false,
                comment: comment || ''
            })

            // Composite
            const composited = await sharp(bgBuffer)
                .resize(1080, 1080)
                .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
                .png({ quality: 90 })
                .toBuffer()

            const base64 = composited.toString('base64')
            const dataUrl = `data:image/png;base64,${base64}`

            console.log(` -> Share card from template "${template.name}" generated (no API call)`)
            res.json({ image: dataUrl, prompt: template.prompt, fromTemplate: true })
        } catch (e) {
            console.error('Generate from template error:', e)
            res.status(500).json({ error: e.message })
        }
    })

    console.log(' -> Share Card routes initialized (FLUX.2 + Gemini)')
}
