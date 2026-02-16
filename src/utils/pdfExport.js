import { jsPDF } from 'jspdf'

export function useExportReportPdf(reportText, zeitraum, reportData) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()  // 210
    const pageHeight = doc.internal.pageSize.getHeight() // 297
    const margin = 18
    const maxWidth = pageWidth - margin * 2  // 174

    // Farben
    const primary = [30, 58, 95]       // Dunkelblau
    const accent = [52, 152, 219]      // Blau
    const darkText = [33, 37, 41]      // Fast-Schwarz
    const grayText = [108, 117, 125]   // Grau
    const lightGray = [220, 220, 220]  // Helles Grau
    const green = [40, 167, 69]        // Grün
    const red = [220, 53, 69]          // Rot
    const bgLight = [245, 247, 250]    // Heller Hintergrund

    let y = 0

    // ==========================================
    // BRIEFKOPF / HEADER
    // ==========================================

    // Dunkelblaue Header-Box
    doc.setFillColor(...primary)
    doc.rect(0, 0, pageWidth, 42, 'F')

    // Titel
    doc.setFontSize(22)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(255, 255, 255)
    doc.text('Trading Journal', margin, 16)

    // Untertitel
    doc.setFontSize(12)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(180, 200, 230)
    doc.text('KI-Analyse Bericht', margin, 24)

    // Zeitraum & Datum rechts
    doc.setFontSize(10)
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.text(zeitraum, pageWidth - margin, 16, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(180, 200, 230)
    doc.text(`Erstellt: ${new Date().toLocaleDateString('de-DE')} ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`, pageWidth - margin, 24, { align: 'right' })

    // Akzentlinie unter Header
    doc.setFillColor(...accent)
    doc.rect(0, 42, pageWidth, 1.5, 'F')

    y = 52

    // ==========================================
    // KENNZAHLEN-BOX (wenn reportData vorhanden)
    // ==========================================

    if (reportData && reportData.tradeCount) {
        const boxHeight = 28
        doc.setFillColor(...bgLight)
        doc.roundedRect(margin, y, maxWidth, boxHeight, 3, 3, 'F')

        // 4 Spalten
        const colWidth = maxWidth / 4
        const metrics = [
            { label: 'Trades', value: String(reportData.tradeCount) },
            { label: 'Win Rate', value: `${reportData.winRate}%` },
            { label: 'Netto PnL', value: `${reportData.totalNetProceeds} USDT`, isColored: true },
            { label: 'Profit Factor', value: String(reportData.profitFactor) }
        ]

        metrics.forEach((m, i) => {
            const cx = margin + colWidth * i + colWidth / 2

            // Label
            doc.setFontSize(8)
            doc.setFont('helvetica', 'normal')
            doc.setTextColor(...grayText)
            doc.text(m.label, cx, y + 10, { align: 'center' })

            // Wert
            doc.setFontSize(13)
            doc.setFont('helvetica', 'bold')
            if (m.isColored) {
                const pnl = parseFloat(reportData.totalNetProceeds)
                doc.setTextColor(...(pnl >= 0 ? green : red))
            } else {
                doc.setTextColor(...darkText)
            }
            doc.text(m.value, cx, y + 19, { align: 'center' })
        })

        // Trennlinien zwischen Spalten
        doc.setDrawColor(...lightGray)
        for (let i = 1; i < 4; i++) {
            const lx = margin + colWidth * i
            doc.line(lx, y + 5, lx, y + boxHeight - 5)
        }

        y += boxHeight + 8

        // Zusatz-Zeile: Wins/Losses, Fees, Best/Worst
        doc.setFontSize(8)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...grayText)

        const details = []
        if (reportData.wins !== undefined) details.push(`Wins: ${reportData.wins} / Losses: ${reportData.losses}`)
        if (reportData.totalFees) details.push(`Gebühren: ${reportData.totalFees} USDT`)
        if (reportData.tradingDays) details.push(`Handelstage: ${reportData.tradingDays}`)
        if (reportData.appt) details.push(`APPT: ${reportData.appt} USDT`)

        if (details.length > 0) {
            doc.text(details.join('   |   '), pageWidth / 2, y, { align: 'center' })
            y += 8
        }

        // Trennlinie
        doc.setDrawColor(...lightGray)
        doc.line(margin, y, pageWidth - margin, y)
        y += 8
    }

    // ==========================================
    // BERICHT-TEXT
    // ==========================================

    const lines = reportText.split('\n')

    for (const line of lines) {
        // Seitenumbruch
        if (y > pageHeight - 25) {
            doc.addPage()
            y = 20
        }

        const trimmed = line.trim()

        if (trimmed.startsWith('### ')) {
            // Überschrift 3
            y += 3
            doc.setFontSize(11)
            doc.setFont('helvetica', 'bold')
            doc.setTextColor(...darkText)
            const text = trimmed.replace(/^### /, '').replace(/\*\*/g, '')
            doc.text(text, margin, y)
            y += 6

        } else if (trimmed.startsWith('## ')) {
            // Überschrift 2 — mit Akzentlinie
            y += 5
            doc.setFontSize(13)
            doc.setFont('helvetica', 'bold')
            doc.setTextColor(...accent)
            const text = trimmed.replace(/^## /, '').replace(/\*\*/g, '')
            doc.text(text, margin, y)
            y += 1.5
            doc.setDrawColor(...accent)
            doc.setLineWidth(0.5)
            const textWidth = doc.getTextWidth(text)
            doc.line(margin, y, margin + textWidth, y)
            doc.setLineWidth(0.2)
            y += 5

        } else if (trimmed.startsWith('# ')) {
            // Überschrift 1
            y += 5
            doc.setFontSize(15)
            doc.setFont('helvetica', 'bold')
            doc.setTextColor(...primary)
            const text = trimmed.replace(/^# /, '').replace(/\*\*/g, '')
            doc.text(text, margin, y)
            y += 8

        } else if (trimmed.match(/^[-*] /)) {
            // Aufzählung
            doc.setFontSize(9.5)
            doc.setFont('helvetica', 'normal')
            doc.setTextColor(...darkText)
            const text = trimmed.replace(/^[-*] /, '').replace(/\*\*/g, '')
            const wrapped = doc.splitTextToSize(text, maxWidth - 8)
            for (let wi = 0; wi < wrapped.length; wi++) {
                if (y > pageHeight - 25) { doc.addPage(); y = 20 }
                if (wi === 0) {
                    // Bullet
                    doc.setFillColor(...accent)
                    doc.circle(margin + 2, y - 1.2, 0.8, 'F')
                    doc.text(wrapped[wi], margin + 6, y)
                } else {
                    doc.text(wrapped[wi], margin + 6, y)
                }
                y += 4.5
            }

        } else if (trimmed.match(/^\d+\. /)) {
            // Nummerierte Liste
            doc.setFontSize(9.5)
            doc.setFont('helvetica', 'normal')
            doc.setTextColor(...darkText)
            const numMatch = trimmed.match(/^(\d+)\. (.+)/)
            if (numMatch) {
                doc.setFont('helvetica', 'bold')
                doc.setTextColor(...accent)
                doc.text(`${numMatch[1]}.`, margin + 1, y)
                doc.setFont('helvetica', 'normal')
                doc.setTextColor(...darkText)
                const wrapped = doc.splitTextToSize(numMatch[2].replace(/\*\*/g, ''), maxWidth - 8)
                for (const wline of wrapped) {
                    if (y > pageHeight - 25) { doc.addPage(); y = 20 }
                    doc.text(wline, margin + 6, y)
                    y += 4.5
                }
            }

        } else if (trimmed === '') {
            y += 2.5
        } else {
            // Normaler Text — Bold-Marker inline verarbeiten
            doc.setFontSize(9.5)
            doc.setTextColor(...darkText)

            // Einfach: Bold-Marker entfernen (jsPDF unterstützt kein inline-bold)
            const cleanText = trimmed.replace(/\*\*/g, '')
            doc.setFont('helvetica', 'normal')
            const wrapped = doc.splitTextToSize(cleanText, maxWidth)
            for (const wline of wrapped) {
                if (y > pageHeight - 25) { doc.addPage(); y = 20 }
                doc.text(wline, margin, y)
                y += 4.5
            }
        }
    }

    // ==========================================
    // FOOTER auf jeder Seite
    // ==========================================

    const totalPages = doc.internal.getNumberOfPages()
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i)

        // Fußzeilen-Linie
        doc.setDrawColor(...lightGray)
        doc.line(margin, pageHeight - 14, pageWidth - margin, pageHeight - 14)

        // Links: Branding
        doc.setFontSize(7.5)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...grayText)
        doc.text('Trading Journal — KI-Analyse', margin, pageHeight - 9)

        // Rechts: Seitenzahl
        doc.text(`Seite ${i} / ${totalPages}`, pageWidth - margin, pageHeight - 9, { align: 'right' })
    }

    // ==========================================
    // DOWNLOAD
    // ==========================================

    const dateStr = zeitraum.replace(/[^a-zA-Z0-9äöüÄÖÜ]/g, '-').replace(/-+/g, '-')
    doc.save(`Trading-Bericht-${dateStr}.pdf`)
}
