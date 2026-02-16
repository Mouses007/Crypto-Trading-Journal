import { ref, reactive } from "vue";

/**************************************
* GENERAL
**************************************/
export const pageId = ref()
export const currentUser = ref()
export const timeZones = ref(["America/New_York", "Asia/Shanghai", "Europe/Brussels", "Asia/Tokyo", "Asia/Hong_Kong", "Asia/Kolkata", "Europe/London", "Asia/Riyadh"])
export const timeZoneTrade = ref()
export const queryLimit = ref(10000000)
export const queryLimitExistingTrades = ref(50)
export const endOfList = ref(false) //infinite scroll
export const noData = ref(false)
export const stepper = ref()
export const hasData = ref(false)
export const itemToEditId = ref(typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('editItemId') : "")
export const currentDate = ref()
export const quill = ref()
export const sideMenuMobileOut = ref(false)
export const screenType = ref()
export const saveButton = ref(false)
export const windowIsScrolled = ref()

export const idCurrent = ref()
export const idPrevious = ref()
export const idCurrentType = ref()
export const idCurrentNumber = ref()
export const idPreviousType = ref()
export const idPreviousNumber = ref()

export const countdownInterval = ref(null)
export const countdownSeconds = ref(5)

/* Layout & Style */
export const dailyChartZoom = ref(3) //1: zoom inn 2: medium zoom 3: fully/max zoom out


/**************************************
* LOADING AND MOUNTING
**************************************/
//General
export const spinnerLoadingPage = ref(true)
export const spinnerLoadingPageText = ref()
export const renderData = ref(0) //this is for updating DOM

export const spinnerLoadMore = ref(false) //infinite scroll

export const tabGettingScreenshots = ref(false)

//Dashboard
export const dashboardChartsMounted = ref()
export const dashboardIdMounted = ref(false)

//Auswertung
export const auswertungMounted = ref(false)
export const barChartNegativeTagGroups = ref([])

//Charts
export const renderingCharts = ref(true) // this is for spinner

//Setups
export const spinnerSetups = ref(true)
export const spinnerSetupsText = ref()

//Legacy
export const legacy = reactive([])

/**************************************
* MODALS
**************************************/
export const modalDailyTradeOpen = ref(false)

/**************************************
* TRADES
**************************************/
export const selectedRange = ref()
export const filteredTrades = reactive([])
export const filteredTradesDaily = reactive([])
export const filteredTradesTrades = reactive([])
export const auswertungNotes = reactive([])
export const totals = reactive({})
export const totalsByDate = reactive({})
export const groups = reactive({})
export const profitAnalysis = reactive({})
export const timeFrame = ref(60)
export const imports = ref([])

/**************************************
* ADD TRADES
**************************************/
export const pAndL = reactive({})
export const executions = reactive({})
export const trades = reactive({})
export const blotter = reactive({})
export const tradesData = reactive([])
export const tradeId = ref()
export const existingImports = reactive([])
export const existingTradesArray = reactive([])
export const gotExistingTradesArray = ref(false)
export const marketCloseTime = ref("16:00:00")

export const brokers = reactive([{
    value: "bitunix",
    label: "Bitunix",
    assetTypes: ["futures"]
}])

/**************************************
* SETTINGS
**************************************/
export const renderProfile = ref(0)
export const apis = reactive([])
export const layoutStyle = reactive([])

/**************************************
* SELECTED & FILTERS
**************************************/
export const selectedItem = ref()

export const tempSelectedPlSatisfaction = ref(null)

export const periodRange = reactive([])

export const positions = ref([{
    value: "long",
    label: "Long"
},
{
    value: "short",
    label: "Short"
}
])

export const timeFrames = ref([{
    value: "daily",
    label: "Täglich"
},
{
    value: "weekly",
    label: "Wöchentlich"
},
{
    value: "monthly",
    label: "Monatlich"
}
])

export const ratios = ref([{
    value: "appt",
    label: "APPT"
},
{
    value: "profitFactor",
    label: "Profitfaktor"
}
])

export const grossNet = ref([{
    value: "gross",
    label: "Brutto"
},
{
    value: "net",
    label: "Netto"
}
])

// Alle verfügbaren Trade-Timeframes
export const allTradeTimeframes = [
    { value: '1m', label: '1 Minute', group: 'Minuten' },
    { value: '2m', label: '2 Minuten', group: 'Minuten' },
    { value: '3m', label: '3 Minuten', group: 'Minuten' },
    { value: '5m', label: '5 Minuten', group: 'Minuten' },
    { value: '6m', label: '6 Minuten', group: 'Minuten' },
    { value: '10m', label: '10 Minuten', group: 'Minuten' },
    { value: '15m', label: '15 Minuten', group: 'Minuten' },
    { value: '30m', label: '30 Minuten', group: 'Minuten' },
    { value: '45m', label: '45 Minuten', group: 'Minuten' },
    { value: '1h', label: '1 Stunde', group: 'Stunden' },
    { value: '2h', label: '2 Stunden', group: 'Stunden' },
    { value: '3h', label: '3 Stunden', group: 'Stunden' },
    { value: '4h', label: '4 Stunden', group: 'Stunden' },
    { value: '1D', label: '1 Tag', group: 'Tage' },
    { value: '1W', label: '1 Woche', group: 'Tage' },
    { value: '1M', label: '1 Monat', group: 'Tage' },
    { value: '3M', label: '3 Monate', group: 'Tage' },
    { value: '6M', label: '6 Monate', group: 'Tage' },
    { value: '12M', label: '12 Monate', group: 'Tage' },
]

// Vom User ausgewählte Timeframes (wird aus Settings geladen)
export const selectedTradeTimeframes = reactive([])

export const plSatisfaction = ref([{
    value: "pl",
    label: "PnL"
},
{
    value: "satisfaction",
    label: "Zufriedenheit"
}
])

export const selectedTags = typeof localStorage !== 'undefined' ? localStorage.getItem('selectedTags') ? ref(localStorage.getItem('selectedTags').split(",")) : ref([]) : ""

export const selectedPositions = typeof localStorage !== 'undefined' ? localStorage.getItem('selectedPositions') ? ref(localStorage.getItem('selectedPositions').split(",")) : ref([]) : ""
export const selectedTimeFrame = typeof localStorage !== 'undefined' ? ref(localStorage.getItem('selectedTimeFrame')) : ""
export const selectedRatio = typeof localStorage !== 'undefined' ? ref(localStorage.getItem('selectedRatio')) : ""
export const selectedAccount = typeof localStorage !== 'undefined' ? ref(localStorage.getItem('selectedAccount')) : ""
export const selectedAccounts = typeof localStorage !== 'undefined' ? localStorage.getItem('selectedAccounts') ? ref(localStorage.getItem('selectedAccounts').split(",")) : ref([]) : ""
export const selectedGrossNet = typeof localStorage !== 'undefined' ? ref(localStorage.getItem('selectedGrossNet')) : ""
export const selectedPlSatisfaction = typeof localStorage !== 'undefined' ? ref(localStorage.getItem('selectedPlSatisfaction')) : ""
export const selectedBroker = typeof localStorage !== 'undefined' ? ref(localStorage.getItem('selectedBroker')) : ref()
export const selectedDateRange = typeof localStorage !== 'undefined' ? ref(JSON.parse(localStorage.getItem('selectedDateRange'))) : ""
export const selectedMonth = typeof localStorage !== 'undefined' ? ref(JSON.parse(localStorage.getItem('selectedMonth'))) : ""
export const selectedPeriodRange = typeof localStorage !== 'undefined' ? ref(JSON.parse(localStorage.getItem('selectedPeriodRange'))) : ""
export const selectedDashTab = typeof localStorage !== 'undefined' ? ref(localStorage.getItem('selectedDashTab')) : ""

export const amountCase = typeof localStorage !== 'undefined' ? ref(localStorage.getItem('selectedGrossNet')) : ""
export const amountCapital = ref()

/**************************************
* DAILY / TRADE DETAIL
**************************************/
export const satisfactionArray = reactive([])
export const satisfactionTradeArray = reactive([])
export const tradeIndex = ref()
export const tradeIndexPrevious = ref()
export const itemTradeIndex = ref()
export const excursion = reactive({})
export const excursions = reactive([])
export const notes = reactive([])
export const tags = reactive([])
export const tradeTags = reactive([])
export const newTradeTags = reactive([])
export const availableTags = reactive([])
export const availableTagsArray = reactive([])
export const tagInput = ref('')
export const showTagsList = ref(false)
export const tradeNote = ref(null)
export const tradeNoteChanged = ref(false)
export const tradeNoteDateUnix = ref()
export const tradeNoteId = ref()
export const tradeTagsChanged = ref(false)
export const tradeTagsDateUnix = ref()
export const tradeTagsId = ref()
export const tradeExcursionChanged = ref(false)
export const tradeExcursionDateUnix = ref()
export const tradeExcursionId = ref()
export const tradeScreenshotChanged = ref(false)
export const daysBack = ref()
export const daysMargin = ref()

/**************************************
* INCOMING POSITIONS
**************************************/
export const incomingPositions = reactive([])
export const incomingPollingActive = ref(false)
export const incomingLastFetched = ref(null)

/**************************************
* EVALUATION POPUPS
**************************************/
export const evaluationQueue = reactive([])
// Items: { type: 'opening'|'closing', positionObjectId, position, historyData? }
export const evaluationPopupVisible = ref(false)
export const currentEvaluation = ref(null)

export const dailyPagination = ref(0)
export const dailyQueryLimit = ref(10)

/**************************************
* SCREENSHOTS
**************************************/
export const screenshot = reactive({})
export const screenshots = reactive([])
export const screenshotsInfos = reactive([])
export const screenshotsPagination = ref(0)
export const screenshotsQueryLimit = ref(10)
export const selectedScreenshot = reactive({})
export const selectedScreenshotIndex = ref()
export const selectedScreenshotSource = ref()
export const dateScreenshotEdited = ref()
export const editingScreenshot = ref(false)
export const expandedId = ref()
export const expandedSource = ref()
export const markerAreaOpen = ref(false)
export const resizeCompressImg = ref()
export const resizeCompressMaxHeight = ref()
export const resizeCompressMaxWidth = ref()
export const resizeCompressQuality = ref()

/**************************************
* CALENDAR
**************************************/
export const calendarData = reactive({})
export const miniCalendarsData = reactive({})
export const scrollToDateUnix = ref(null)

/**************************************
* MISC
**************************************/
export const getMore = ref(false)
export const uploadMfePrices = ref(false)
export const tradeAccounts = reactive([])
export const selectedTagIndex = ref()
export const expandedScreenshot = ref()
