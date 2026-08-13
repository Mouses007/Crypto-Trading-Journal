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
        titel: 'MACD-Kreuzung über der EMA-Wolke',
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
        titel: 'Rücklauf an eine EMA',
        beschreibung: 'Höheres Hoch weit über der schnellen EMA, danach Korrektur ohne grüne Kerze '
            + 'bis zur langsameren EMA — dort der Einstieg. Entspricht der Strategie „EMA Touch".',
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
]
