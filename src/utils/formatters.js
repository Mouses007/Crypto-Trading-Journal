/**
 * formatters.js — Pure formatting functions (date, number, string).
 * Extracted from utils.js to break circular dependencies.
 * Dependencies: dayjs + timeZoneTrade (globals) only.
 */
import { timeZoneTrade, currentUser } from "../stores/ui.js"
import dayjs from './dayjs-setup.js'

/**************************************
* KI-KOSTEN
**************************************/

/**
 * KI-Kosten in der Anzeigewährung.
 *
 * Die Anbieter rechnen in USD, angezeigt wurde bisher CHF — mit dem Faktor
 * `0.8`, der an sechs Stellen im Quelltext stand. Sechsmal dieselbe Zahl heisst
 * sechsmal nachbessern, wenn sich der Kurs bewegt, und beim ersten Vergessen
 * zeigen zwei Seiten verschiedene Beträge für denselben Lauf.
 *
 * Der Faktor ist eine Einstellung (`waehrungFaktor`), kein Wechselkursdienst:
 * ein täglich abgerufener Kurs wäre Scheingenauigkeit für Beträge, die selbst
 * Schätzungen aus Listenpreisen sind.
 *
 * @param {number} usd     Betrag in USD
 * @param {number} stellen Nachkommastellen (Vorgabe 2)
 * @returns {string} z. B. „0.04 CHF" — leer, wenn nichts zu zeigen ist
 */
export function useKostenAnzeige(usd, stellen = 2) {
    const betrag = Number(usd)
    if (!Number.isFinite(betrag) || betrag === 0) return ''
    return `${useKostenZahl(betrag, stellen)} ${useWaehrungCode()}`
}

/**
 * Nur der umgerechnete Betrag, ohne Währungskürzel — für Sätze, die die
 * Währung schon selbst nennen („davon 0.05 für den Text").
 */
export function useKostenZahl(usd, stellen = 2) {
    const betrag = Number(usd)
    if (!Number.isFinite(betrag)) return (0).toFixed(stellen)
    const faktor = Number(currentUser.value?.waehrungFaktor)
    // Kein Faktor hinterlegt heisst: nicht umrechnen. Lieber der echte Betrag
    // in seiner echten Währung als ein unveränderter unter falschem Namen —
    // deshalb hängt auch `useWaehrungCode` an derselben Bedingung.
    if (!Number.isFinite(faktor) || faktor <= 0) return betrag.toFixed(stellen)
    return (betrag * faktor).toFixed(stellen)
}

/** Kürzel der Anzeigewährung — USD, solange kein Faktor hinterlegt ist. */
export function useWaehrungCode() {
    const faktor = Number(currentUser.value?.waehrungFaktor)
    if (!Number.isFinite(faktor) || faktor <= 0) return 'USD'
    return String(currentUser.value?.waehrungCode || 'CHF')
}

/**************************************
* STRING FORMATS
**************************************/
export function useCapitalizeFirstLetter(param) {
    return param.charAt(0).toUpperCase() + param.slice(1)
}


export function useDateCalFormat(param) {
    return dayjs.unix(param).tz(timeZoneTrade.value).format("YYYY-MM-DD")
}

export function useDateCalFormatMonth(param) {
    return dayjs.unix(param).tz(timeZoneTrade.value).format("YYYY-MM")
}

export function useTimeFormat(param) {
    return dayjs.unix(param).tz(timeZoneTrade.value).format("HH:mm:ss")
}


export function useTimeDuration(param) {
    return dayjs.duration(param * 1000).format("HH:mm:ss")
}

export function useSwingDuration(param) {
    let duration = Number(dayjs.duration(param * 1000).format("D"))
    let period
    duration > 1 ? period = "days" : period = "day"
    return (duration + " " + period)
}

export function useHourMinuteFormat(param) {
    return dayjs.unix(param).tz(timeZoneTrade.value).format("HH:mm")
}

export function useDateTimeFormat(param) {
    return dayjs.unix(param).tz(timeZoneTrade.value).format("YYYY-MM-DD HH:mm:ss")
}

export function useChartFormat(param) {
    return dayjs.unix(param).tz(timeZoneTrade.value).format("D.M.YYYY")
}

export function useMonthFormat(param) {
    return dayjs.unix(param).tz(timeZoneTrade.value).format("MMMM YYYY")
}


export function useCreatedDateFormat(param) {
    return dayjs.unix(param).tz(timeZoneTrade.value).format("ddd DD MMMM YYYY")
}


export function useStartOfDay(param) {
    return dayjs(param * 1000).tz(timeZoneTrade.value).startOf("day").unix()
}

/**************************************
* NUMBER FORMATS
**************************************/
// Map app language → Intl number locale (de→de-CH with apostrophe, en→en-US with comma)
const LOCALE_MAP = { de: 'de-CH', en: 'en-US' }
function numLocale() {
    const lang = localStorage.getItem('appLanguage') || 'de'
    return LOCALE_MAP[lang] || 'de-CH'
}

export function useThousandCurrencyFormat(param) {
    return new Intl.NumberFormat(numLocale(), { maximumFractionDigits: 0, style: 'currency', currency: 'USD' }).format(param)
}

export function useThousandFormat(param) {
    return new Intl.NumberFormat(numLocale(), { maximumFractionDigits: 0 }).format(param)
}

export function useTwoDecCurrencyFormat(param) {
    return new Intl.NumberFormat(numLocale(), { maximumFractionDigits: 2, style: 'currency', currency: 'USD' }).format(param)
}


export function useXDecCurrencyFormat(param, param2) {
    return new Intl.NumberFormat(numLocale(), { maximumFractionDigits: param2, style: 'currency', currency: 'USD' }).format(param)
}

export function useTwoDecFormat(param) {
    return new Intl.NumberFormat(numLocale(), { maximumFractionDigits: 2 }).format(param)
}

export function useXDecFormat(param, param2) {
    return new Intl.NumberFormat(numLocale(), { maximumFractionDigits: param2 }).format(param)
}

export function useOneDecPercentFormat(param) {
    return new Intl.NumberFormat(numLocale(), { maximumFractionDigits: 1, style: 'percent' }).format(param)
}



export function useDecimalsArithmetic(param1, param2) {
    //https://flaviocopes.com/javascript-decimal-arithmetics/
    return ((param1.toFixed(6) * 100) + (param2.toFixed(6) * 100)) / 100
}
