/**
 * Startvorlagen für den Strategie-Editor.
 *
 * Vor einem leeren Regelformular zu sitzen ist der sicherste Weg, es nie zu
 * benutzen. Diese Vorlagen sind lauffähige Beispiele zum Umbauen — bewusst
 * einfach gehalten, damit man den Zusammenhang zwischen Formular und Wirkung
 * an einem Backtest ablesen kann.
 *
 * Sie sind KEINE Empfehlungen. Die erste (EMA Touch) ist im Backtest über
 * 5 Märkte durchgefallen; sie steht hier, weil sie zeigt, wie ein mehrstufiges
 * Setup aufgebaut wird.
 */

export const VORLAGEN = [
    {
        key: 'macd_wolke',
        titel: '„Optimierte MACD-Strategie" (Rang 19) — MACD-Kreuzung über der EMA-Wolke',
        beschreibung: 'Kurs über EMA 20 und EMA 200, MACD kreuzt seine Signallinie nach oben — '
            + 'und zwar UNTERHALB der Nulllinie, also aus einer Korrektur heraus. Stop am letzten '
            + 'Swing-Tief, Ziel 2R, Break-Even ab 1R. Nachgebaut aus einer öffentlichen '
            + 'Testreihe (1h, 1095 Tage, Profitfaktor 2,17) — die Zahlen stammen von dort, '
            + 'nicht von uns.',
        rules: {
            timeframes: ['15m', '30m', '1h', '4h'],
            direction: 'long',
            warmupCandles: 300,
            params: [
                { key: 'emaSchnell', type: 'integer', label: 'Schnelle EMA (Wolkenoberkante)', default: 20, min: 5, max: 100, step: 1 },
                { key: 'emaLangsam', type: 'integer', label: 'Langsame EMA (Wolkenunterkante)', default: 200, min: 50, max: 400, step: 5 },
                { key: 'ziel', type: 'number', label: 'Chance/Risiko-Ziel', default: 2, min: 0.5, max: 10, step: 0.5 },
                { key: 'stopPuffer', type: 'number', label: 'Stop-Puffer unter dem Swing-Tief (%)', default: 0.2, min: 0.01, max: 3, step: 0.05 },
                { key: 'wartefrist', type: 'integer', label: 'Wartefrist (Kerzen)', default: 5, min: 1, max: 30, step: 1 },
            ],
            indicators: [
                { id: 'emaSchnell', type: 'ema', period: { param: 'emaSchnell' } },
                { id: 'emaLangsam', type: 'ema', period: { param: 'emaLangsam' } },
                { id: 'macdLinie', type: 'macd', fast: 12, slow: 26, signal: 9 },
                { id: 'macdSignal', type: 'macdSignal', fast: 12, slow: 26, signal: 9 },
            ],
            // Der Auslöser ist wörtlich die Kreuzung der beiden MACD-Linien
            signal: { type: 'crossUp', a: 'macdLinie', b: 'macdSignal' },
            signalFilters: [
                // „aus einer Korrektur heraus": die Kreuzung muss unter null liegen
                { left: 'macdLinie', op: 'lt', right: { value: 0 }, code: 'kreuzung_ueber_null' },
                { left: 'close', op: 'gt', right: 'emaSchnell', code: 'unter_der_wolke' },
                // Die Kerze darf die Wolkenunterkante nicht berühren
                { left: 'low', op: 'gt', right: 'emaLangsam', code: 'wolke_beruehrt' },
            ],
            entry: { type: 'immediate' },
            invalidations: [
                { type: 'condition', code: 'trend_gebrochen', when: { left: 'close', op: 'lt', right: 'emaLangsam' } },
                { type: 'timeout', code: 'zu_spaet', candles: { param: 'wartefrist' } },
            ],
            stopLoss: { anchor: 'lastSwingLow', offsetPct: { param: 'stopPuffer' } },
            takeProfit: { mode: 'rr', rr: { param: 'ziel' } },
            breakEvenAtR: 1,
        },
    },
    {
        key: 'vwap_ruecklauf',
        titel: 'Rücklauf zur VWAP',
        beschreibung: 'Der Kurs steht über der Tages-VWAP (Käufer im Vorteil), läuft nach einem '
            + 'Zwischenhoch dorthin zurück und wird an der Linie aufgenommen. Klassischer '
            + 'Intraday-Ansatz — die VWAP setzt zu jedem UTC-Tageswechsel zurück.',
        rules: {
            timeframes: ['5m', '15m', '30m', '1h'],
            direction: 'long',
            warmupCandles: 300,
            params: [
                { key: 'abstand', type: 'number', label: 'Mindestabstand Hoch zur VWAP (%)', default: 0.6, min: 0.05, max: 10, step: 0.05,
                  hint: 'Wie weit sich der Kurs von der VWAP entfernt haben muss, damit der Rücklauf lohnt.' },
                { key: 'wartefrist', type: 'integer', label: 'Wartefrist (Kerzen)', default: 20, min: 3, max: 100, step: 1 },
                { key: 'stopPuffer', type: 'number', label: 'Stop-Puffer unter dem Tief (%)', default: 0.25, min: 0.01, max: 3, step: 0.05 },
                { key: 'ziel', type: 'number', label: 'Chance/Risiko-Ziel', default: 2, min: 0.5, max: 15, step: 0.5 },
            ],
            indicators: [
                { id: 'vwap', type: 'vwap', anchor: 'session' },
                { id: 'vwapOben', type: 'vwapBand', anchor: 'session', mult: 2 },
            ],
            signal: { type: 'pivotHigh', left: 6, right: 2 },
            signalFilters: [
                { left: 'signalPrice', op: 'distancePctGt', right: 'vwap', value: { param: 'abstand' }, code: 'zu_nah_an_vwap' },
                { left: 'close', op: 'gt', right: 'vwap', code: 'unter_der_vwap' },
            ],
            entry: { type: 'touch', anchor: 'vwap', from: 'above' },
            invalidations: [
                { type: 'condition', code: 'vwap_verloren', when: { left: 'close', op: 'lt', right: 'vwap' } },
                { type: 'timeout', code: 'kein_ruecklauf', candles: { param: 'wartefrist' } },
            ],
            stopLoss: { anchor: 'correctionLow', offsetPct: { param: 'stopPuffer' } },
            takeProfit: { mode: 'rr', rr: { param: 'ziel' } },
            breakEvenAtR: 1,
        },
    },
    {
        key: 'vwap_band',
        titel: 'Überdehnung am VWAP-Band',
        beschreibung: 'Der Kurs schiesst über das obere VWAP-Band hinaus und kehrt zurück. '
            + 'Gegen-den-Impuls-Ansatz mit Ziel an der VWAP selbst.',
        rules: {
            timeframes: ['5m', '15m', '30m', '1h'],
            direction: 'short',
            warmupCandles: 300,
            params: [
                { key: 'bandFaktor', type: 'number', label: 'Bandbreite (Standardabweichungen)', default: 2, min: 0.5, max: 4, step: 0.25 },
                { key: 'wartefrist', type: 'integer', label: 'Wartefrist (Kerzen)', default: 10, min: 2, max: 60, step: 1 },
                { key: 'stopPuffer', type: 'number', label: 'Stop-Puffer über dem Hoch (%)', default: 0.3, min: 0.01, max: 3, step: 0.05 },
            ],
            indicators: [
                { id: 'vwap', type: 'vwap', anchor: 'session' },
                { id: 'band', type: 'vwapBand', anchor: 'session', mult: { param: 'bandFaktor' } },
            ],
            signal: { type: 'pivotHigh', left: 4, right: 2 },
            signalFilters: [
                { left: 'signalPrice', op: 'gt', right: 'band', code: 'nicht_ueber_dem_band' },
            ],
            entry: { type: 'immediate' },
            invalidations: [
                { type: 'timeout', code: 'zu_spaet', candles: { param: 'wartefrist' } },
            ],
            stopLoss: { anchor: 'signalHigh', offsetPct: { param: 'stopPuffer' } },
            takeProfit: { mode: 'anchor', anchor: 'vwap' },
            breakEvenAtR: 0,
        },
    },
    {
        key: 'ema_pullback',
        titel: '„GUSS Sniperentry" — Rücklauf an eine EMA',
        beschreibung: 'Höheres Hoch weit über der schnellen EMA, danach Korrektur ohne grüne Kerze '
            + 'bis zur langsameren EMA — dort der Einstieg. Baukasten-Fassung der eingebauten Strategie '
            + '„EMA Touch" (Kryptomano-PDF); die Eingebaute prüft die Guss-Bedingung vollständig.',
        rules: {
            timeframes: ['15m', '1h', '4h'],
            direction: 'long',
            warmupCandles: 300,
            params: [
                { key: 'ueberdehnung', type: 'number', label: 'Mindest-Überdehnung (%)', default: 2.5, min: 0.1, max: 15, step: 0.1,
                  hint: 'Wie weit das Hoch über der schnellen EMA liegen muss.' },
                { key: 'maxKerzen', type: 'integer', label: 'Max. Korrekturdauer (Kerzen)', default: 10, min: 2, max: 50, step: 1 },
                { key: 'stopPuffer', type: 'number', label: 'Stop-Puffer unter dem Tief (%)', default: 0.2, min: 0.01, max: 3, step: 0.05 },
                { key: 'ziel', type: 'number', label: 'Chance/Risiko-Ziel', default: 2, min: 0.5, max: 15, step: 0.5 },
            ],
            indicators: [
                { id: 'emaFast', type: 'ema', period: 21 },
                { id: 'emaEntry', type: 'ema', period: 50 },
            ],
            signal: { type: 'pivotHigh', left: 10, right: 2 },
            signalFilters: [
                { op: 'higherThanPrevSignal', code: 'kein_hoeheres_hoch' },
                { left: 'emaFast', op: 'gt', right: 'emaEntry', code: 'kein_aufwaertstrend' },
                { left: 'signalPrice', op: 'distancePctGt', right: 'emaFast', value: { param: 'ueberdehnung' }, code: 'keine_ueberdehnung' },
            ],
            entry: { type: 'touch', anchor: 'emaEntry', from: 'above' },
            invalidations: [
                { type: 'condition', code: 'gruene_kerze', when: { op: 'isBullish' } },
                { type: 'condition', code: 'trend_gebrochen', when: { left: 'emaFast', op: 'lt', right: 'emaEntry' } },
                { type: 'timeout', code: 'zu_lang', candles: { param: 'maxKerzen' } },
            ],
            stopLoss: { anchor: 'correctionLow', offsetPct: { param: 'stopPuffer' } },
            takeProfit: { mode: 'rr', rr: { param: 'ziel' } },
            breakEvenAtR: 1,
        },
    },
    {
        key: 'ema_kreuzung',
        titel: 'EMA-Kreuzung mit Rücklauf',
        beschreibung: 'Die schnelle EMA kreuzt die langsame nach oben. Statt sofort zu kaufen, '
            + 'wird auf den Rücklauf zur schnellen EMA gewartet.',
        rules: {
            timeframes: ['1h', '4h', '1d'],
            direction: 'long',
            warmupCandles: 300,
            params: [
                { key: 'schnell', type: 'integer', label: 'Schnelle EMA', default: 20, min: 3, max: 100, step: 1 },
                { key: 'langsam', type: 'integer', label: 'Langsame EMA', default: 50, min: 10, max: 300, step: 1 },
                { key: 'wartefrist', type: 'integer', label: 'Wartefrist (Kerzen)', default: 15, min: 2, max: 60, step: 1 },
                { key: 'ziel', type: 'number', label: 'Chance/Risiko-Ziel', default: 2, min: 0.5, max: 15, step: 0.5 },
            ],
            indicators: [
                { id: 'schnell', type: 'ema', period: { param: 'schnell' } },
                { id: 'langsam', type: 'ema', period: { param: 'langsam' } },
            ],
            signal: { type: 'crossUp', a: 'schnell', b: 'langsam' },
            signalFilters: [],
            entry: { type: 'touch', anchor: 'schnell', from: 'above' },
            invalidations: [
                { type: 'condition', code: 'kreuzung_zurueck', when: { left: 'schnell', op: 'lt', right: 'langsam' } },
                { type: 'timeout', code: 'kein_ruecklauf', candles: { param: 'wartefrist' } },
            ],
            stopLoss: { anchor: 'correctionLow', offsetPct: 0.3 },
            takeProfit: { mode: 'rr', rr: { param: 'ziel' } },
            breakEvenAtR: 1,
        },
    },
    {
        key: 'rsi_umkehr',
        titel: 'Überverkaufter Rücksetzer',
        beschreibung: 'Ein Pivot-Tief bei überverkauftem RSI und intaktem übergeordnetem Trend. '
            + 'Einstieg sofort beim bestätigten Tief.',
        rules: {
            timeframes: ['1h', '4h', '1d'],
            direction: 'long',
            warmupCandles: 300,
            params: [
                { key: 'rsiGrenze', type: 'number', label: 'RSI-Schwelle', default: 35, min: 5, max: 50, step: 1 },
                { key: 'trendEma', type: 'integer', label: 'Trend-EMA', default: 200, min: 20, max: 400, step: 10 },
                { key: 'stopPuffer', type: 'number', label: 'Stop-Puffer (%)', default: 0.5, min: 0.05, max: 5, step: 0.05 },
                { key: 'ziel', type: 'number', label: 'Chance/Risiko-Ziel', default: 2.5, min: 0.5, max: 15, step: 0.5 },
            ],
            indicators: [
                { id: 'rsi', type: 'rsi', period: 14 },
                { id: 'trend', type: 'ema', period: { param: 'trendEma' } },
            ],
            signal: { type: 'pivotLow', left: 5, right: 2 },
            signalFilters: [
                { left: 'rsi', op: 'lt', right: { param: 'rsiGrenze' }, code: 'rsi_nicht_tief_genug' },
                { left: 'close', op: 'gt', right: 'trend', code: 'unter_dem_trend' },
            ],
            entry: { type: 'immediate' },
            invalidations: [
                { type: 'timeout', code: 'zu_lang', candles: 3 },
            ],
            stopLoss: { anchor: 'signalLow', offsetPct: { param: 'stopPuffer' } },
            takeProfit: { mode: 'rr', rr: { param: 'ziel' } },
            breakEvenAtR: 1,
        },
    },
    {
        key: 'holy_grail_adx',
        titel: '„Holy Grail" 2.0 (Rang 6) — ADX-Trend mit Rücklauf in die Bollinger-Zone',
        beschreibung: 'ADX über 25 zeigt einen tragfähigen Trend an; der Kurs läuft in eine enge '
            + 'Bollinger-Zone um den gleitenden Durchschnitt zurück und wird dort von einer '
            + 'Umkehrkerze aufgenommen. Einstieg per Stop-Order über dem Hoch der Signalkerze, '
            + 'Order verfällt nach fünf Kerzen. Nachgebaut aus einer öffentlichen Testreihe '
            + '(Tageskerzen, 35 Jahre, Profitfaktor 2,26) — die Zahlen stammen von dort, nicht '
            + 'von uns. Achtung: die Vorlage prüft vier Umkehrformationen, das Original rund '
            + 'dreissig. Der Filter ist damit strenger, es kommen weniger Trades zustande.',
        rules: {
            timeframes: ['1h', '4h', '1d'],
            direction: 'long',
            warmupCandles: 300,
            params: [
                { key: 'adxPeriode', type: 'integer', label: 'ADX-Periode', default: 14, min: 5, max: 50, step: 1 },
                { key: 'adxSchwelle', type: 'number', label: 'ADX-Schwelle (Trendstärke)', default: 25, min: 10, max: 60, step: 1 },
                { key: 'zonenLaenge', type: 'integer', label: 'Länge der Bollinger-Zone', default: 20, min: 5, max: 200, step: 1 },
                { key: 'zonenBreite', type: 'number', label: 'Standardabweichungen der Zone', default: 0.25, min: 0.05, max: 3, step: 0.05 },
                { key: 'ziel', type: 'number', label: 'Chance/Risiko-Ziel', default: 3, min: 0.5, max: 10, step: 0.5 },
                { key: 'stopPuffer', type: 'number', label: 'Stop-Puffer unter der Signalkerze (%)', default: 0.1, min: 0.01, max: 3, step: 0.05 },
                { key: 'gueltigkeit', type: 'integer', label: 'Ordergültigkeit (Kerzen)', default: 5, min: 1, max: 30, step: 1 },
            ],
            indicators: [
                { id: 'adxWert', type: 'adx', period: { param: 'adxPeriode' } },
                { id: 'plus', type: 'plusDI', period: { param: 'adxPeriode' } },
                { id: 'minus', type: 'minusDI', period: { param: 'adxPeriode' } },
                { id: 'zoneOben', type: 'bollUpper', period: { param: 'zonenLaenge' }, mult: { param: 'zonenBreite' } },
                { id: 'zoneUnten', type: 'bollLower', period: { param: 'zonenLaenge' }, mult: { param: 'zonenBreite' } },
            ],
            // „Die erste Kerze, die die Zone berührt" — das Tief sticht von oben hinein
            signal: { type: 'crossDown', a: 'low', b: 'zoneOben' },
            signalFilters: [
                { left: 'adxWert', op: 'gte', right: { param: 'adxSchwelle' }, code: 'trend_zu_schwach' },
                { left: 'plus', op: 'gt', right: 'minus', code: 'falsche_trendrichtung' },
                // Der Rücklauf darf die Zone nicht durchschlagen
                { left: 'close', op: 'gt', right: 'zoneUnten', code: 'zone_durchschlagen' },
                // Umkehrkerze als letzter Filter — im Original ein Muster-Indikator
                { op: 'isHammer', code: 'keine_umkehrkerze' },
            ],
            entry: { type: 'touch', anchor: 'signalHigh', from: 'below' },
            invalidations: [
                { type: 'timeout', code: 'order_verfallen', candles: { param: 'gueltigkeit' } },
            ],
            stopLoss: { anchor: 'signalLow', offsetPct: { param: 'stopPuffer' } },
            takeProfit: { mode: 'rr', rr: { param: 'ziel' } },
        },
    },
    {
        key: 'engulfing_mfi',
        titel: '„Optimierte ChatGPT-Strategie" 2.0 (Rang 5) — Engulfing nach Gegenkerzen + Money Flow',
        beschreibung: 'Nach mindestens drei fallenden Kerzen verschlingt eine grüne Kerze ihre '
            + 'Vorgängerin, und der Money Flow Index steht unter der Mittellinie — Verkaufsdruck, '
            + 'der gerade kippt. Einstieg per Stop-Order über der Signalkerze, Order verfällt '
            + 'nach einer Kerze, Stop knapp darunter, Ziel 3R, Break-Even ab 1R. Nachgebaut aus '
            + 'einer öffentlichen Testreihe (1h, 733 Tage, Profitfaktor 2,26). Die Zonen-Definition '
            + 'des Originals ist im Transkript unscharf; hier ist sie als „unter 50" gelesen.',
        rules: {
            timeframes: ['15m', '30m', '1h', '4h'],
            direction: 'long',
            warmupCandles: 200,
            params: [
                { key: 'mfiPeriode', type: 'integer', label: 'MFI-Periode', default: 14, min: 3, max: 50, step: 1 },
                { key: 'mfiSchwelle', type: 'number', label: 'MFI-Schwelle (Bestätigung darunter)', default: 50, min: 5, max: 95, step: 1 },
                { key: 'gegenkerzen', type: 'integer', label: 'Gegenkerzen vor dem Muster', default: 3, min: 0, max: 10, step: 1 },
                { key: 'ziel', type: 'number', label: 'Chance/Risiko-Ziel', default: 3, min: 0.5, max: 10, step: 0.5 },
                { key: 'stopPuffer', type: 'number', label: 'Stop-Puffer unter der Signalkerze (%)', default: 0.05, min: 0.01, max: 3, step: 0.05 },
            ],
            indicators: [
                { id: 'mfiWert', type: 'mfi', period: { param: 'mfiPeriode' } },
            ],
            signal: { type: 'pattern', pattern: 'bullishEngulfing', prevOpposite: { param: 'gegenkerzen' } },
            signalFilters: [
                { left: 'mfiWert', op: 'lt', right: { param: 'mfiSchwelle' }, code: 'kein_verkaufsdruck' },
            ],
            entry: { type: 'touch', anchor: 'signalHigh', from: 'below' },
            invalidations: [
                { type: 'timeout', code: 'order_verfallen', candles: 1 },
            ],
            stopLoss: { anchor: 'signalLow', offsetPct: { param: 'stopPuffer' } },
            takeProfit: { mode: 'rr', rr: { param: 'ziel' } },
            breakEvenAtR: 1,
        },
    },
    {
        key: 'bollinger_rsi_trend',
        titel: '„Bollinger Bänder + RSI" 2.0 (Rang 21) — RSI-Umkehr im Bollinger-Trend',
        beschreibung: 'Die weit gefassten Bollinger Bänder auf EMA-Basis dienen hier NICHT als '
            + 'Extrem-Indikator, sondern als Trendbestimmung: schliesst der Kurs darüber, gilt '
            + 'Aufwärtstrend. Der sehr kurze RSI kreuzt dann sein unteres Level nach oben — '
            + 'Rücksetzer im Trend beendet. Stop am letzten Swing-Tief, Ziel 3R, Break-Even ab 1R. '
            + 'Nachgebaut aus einer öffentlichen Testreihe (1h, 284 Tage, Profitfaktor 1,88). '
            + 'Der kurze RSI ist parameterempfindlich — ein Durchlauf über 2 bis 6 lohnt sich.',
        rules: {
            timeframes: ['15m', '30m', '1h', '4h'],
            direction: 'long',
            warmupCandles: 400,
            params: [
                { key: 'bandLaenge', type: 'integer', label: 'Länge der Bänder', default: 200, min: 20, max: 400, step: 10 },
                { key: 'bandBreite', type: 'number', label: 'Standardabweichungen', default: 0.2, min: 0.05, max: 3, step: 0.05 },
                { key: 'rsiLaenge', type: 'integer', label: 'RSI-Länge', default: 3, min: 2, max: 30, step: 1 },
                { key: 'rsiLevel', type: 'number', label: 'RSI-Level (Kreuzung nach oben)', default: 20, min: 5, max: 50, step: 1 },
                { key: 'ziel', type: 'number', label: 'Chance/Risiko-Ziel', default: 3, min: 0.5, max: 10, step: 0.5 },
                { key: 'stopPuffer', type: 'number', label: 'Stop-Puffer unter dem Swing-Tief (%)', default: 0.2, min: 0.01, max: 3, step: 0.05 },
                { key: 'wartefrist', type: 'integer', label: 'Wartefrist (Kerzen)', default: 5, min: 1, max: 30, step: 1 },
            ],
            indicators: [
                { id: 'bandOben', type: 'bollUpper', period: { param: 'bandLaenge' }, mult: { param: 'bandBreite' }, basis: 'ema' },
                { id: 'bandUnten', type: 'bollLower', period: { param: 'bandLaenge' }, mult: { param: 'bandBreite' }, basis: 'ema' },
                { id: 'rsiKurz', type: 'rsi', period: { param: 'rsiLaenge' } },
            ],
            signal: { type: 'crossUp', a: 'rsiKurz', b: { param: 'rsiLevel' } },
            signalFilters: [
                { left: 'close', op: 'gt', right: 'bandOben', code: 'kein_aufwaertstrend' },
            ],
            entry: { type: 'immediate' },
            invalidations: [
                { type: 'condition', code: 'trend_gebrochen', when: { left: 'close', op: 'lt', right: 'bandUnten' } },
                { type: 'timeout', code: 'zu_spaet', candles: { param: 'wartefrist' } },
            ],
            stopLoss: { anchor: 'lastSwingLow', offsetPct: { param: 'stopPuffer' } },
            takeProfit: { mode: 'rr', rr: { param: 'ziel' } },
            breakEvenAtR: 1,
        },
    },
    {
        key: 'stochastik_dreiklang',
        titel: '„ChatGPT-Daytrading-Strategie" (Rang 49) — Stochastik-Umkehr im bestätigten Trend',
        beschreibung: 'Drei Bedingungen müssen zusammenkommen: Kurs über dem SMA 50, RSI über 50 '
            + 'und die Stochastik verlässt den überverkauften Bereich nach oben. Stop am letzten '
            + 'Swing-Tief, Ziel 1,5R, kein Break-Even-Nachzug. Nachgebaut aus einer öffentlichen '
            + 'Testreihe (1h, 486 Tage, 55 % Trefferquote, Profitfaktor 1,83) — die ruhigste '
            + 'Verlaufskurve der Kandidatenliste.',
        rules: {
            timeframes: ['15m', '30m', '1h', '4h'],
            direction: 'long',
            warmupCandles: 200,
            params: [
                { key: 'trendSma', type: 'integer', label: 'Trend-SMA', default: 50, min: 10, max: 200, step: 5 },
                { key: 'rsiLaenge', type: 'integer', label: 'RSI-Länge', default: 14, min: 3, max: 50, step: 1 },
                { key: 'stochLaenge', type: 'integer', label: 'Stochastik-Länge', default: 14, min: 3, max: 50, step: 1 },
                { key: 'stochGlaettung', type: 'integer', label: 'Glättung %K', default: 3, min: 1, max: 10, step: 1 },
                { key: 'stochLevel', type: 'number', label: 'Überverkauft-Level', default: 20, min: 5, max: 45, step: 1 },
                { key: 'ziel', type: 'number', label: 'Chance/Risiko-Ziel', default: 1.5, min: 0.5, max: 10, step: 0.5 },
                { key: 'stopPuffer', type: 'number', label: 'Stop-Puffer unter dem Swing-Tief (%)', default: 0.2, min: 0.01, max: 3, step: 0.05 },
                { key: 'wartefrist', type: 'integer', label: 'Wartefrist (Kerzen)', default: 5, min: 1, max: 30, step: 1 },
            ],
            indicators: [
                { id: 'trend', type: 'sma', period: { param: 'trendSma' } },
                { id: 'rsiWert', type: 'rsi', period: { param: 'rsiLaenge' } },
                { id: 'stoch', type: 'stochK', period: { param: 'stochLaenge' }, smoothK: { param: 'stochGlaettung' } },
            ],
            signal: { type: 'crossUp', a: 'stoch', b: { param: 'stochLevel' } },
            signalFilters: [
                { left: 'close', op: 'gt', right: 'trend', code: 'kein_aufwaertstrend' },
                { left: 'rsiWert', op: 'gt', right: { value: 50 }, code: 'rsi_zu_schwach' },
            ],
            entry: { type: 'immediate' },
            invalidations: [
                { type: 'condition', code: 'trend_gebrochen', when: { left: 'close', op: 'lt', right: 'trend' } },
                { type: 'timeout', code: 'zu_spaet', candles: { param: 'wartefrist' } },
            ],
            stopLoss: { anchor: 'lastSwingLow', offsetPct: { param: 'stopPuffer' } },
            takeProfit: { mode: 'rr', rr: { param: 'ziel' } },
        },
    },
]
