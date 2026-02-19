import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import isoWeek from 'dayjs/plugin/isoWeek.js'
import timezone from 'dayjs/plugin/timezone.js'
import duration from 'dayjs/plugin/duration.js'
import updateLocale from 'dayjs/plugin/updateLocale.js'
import localizedFormat from 'dayjs/plugin/localizedFormat.js'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'

// Centralized one-time plugin registration for all utility modules.
dayjs.extend(utc)
dayjs.extend(isoWeek)
dayjs.extend(timezone)
dayjs.extend(duration)
dayjs.extend(updateLocale)
dayjs.extend(localizedFormat)
dayjs.extend(customParseFormat)

export default dayjs
