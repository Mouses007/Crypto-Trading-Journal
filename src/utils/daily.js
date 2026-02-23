import { queryLimit, pageId, spinnerSetups, spinnerSetupsText, saveButton, screenshotsPagination, screenshotsQueryLimit } from "../stores/ui.js";
import { selectedRange, selectedTagIndex, filteredSuggestions, daysBack } from "../stores/filters.js";
import { excursions, satisfactionArray, satisfactionTradeArray, tags, availableTags, tradeTags, tradeTagsDateUnix, tradeTagsId, newTradeTags, notes, tradeNote, tradeNoteDateUnix, tradeNoteId, availableTagsArray, tagInput, showTagsList, tradeTagsChanged, filteredTrades, screenshot, auswertungNotes, itemTradeIndex, tradeIndex } from "../stores/trades.js";
import { currentUser } from "../stores/settings.js";
import { dbFind, dbFirst, dbCreate, dbUpdate, dbGetSettings, dbUpdateSettings } from './db.js'

/* MODULES */
import dayjs from './dayjs-setup.js'

//query limit must be same as diary limit
let satisfactionPagination = 0

export async function useGetSatisfactions() {
    return new Promise(async (resolve, reject) => {
        console.log("\nGETTING SATISFACTIONS");

        let options = {
            descending: "dateUnix"
        }

        satisfactionTradeArray.length = 0
        satisfactionArray.length = 0
        let startD = selectedRange.value.start
        let endD = selectedRange.value.end
        // "Gesamt" filter: start=0, end=0 means all — skip date filters
        if (!(startD === 0 && endD === 0)) {
            options.greaterThanOrEqualTo = { dateUnix: startD }
            options.lessThan = { dateUnix: endD }
        }
        options.limit = queryLimit.value

        const results = await dbFind("satisfactions", options)

        for (let i = 0; i < results.length; i++) {
            let temp = {}
            const object = results[i];
            temp.tradeId = object.tradeId
            temp.satisfaction = object.satisfaction
            temp.dateUnix = object.dateUnix
            if (temp.tradeId != undefined && temp.tradeId !== '') {
                satisfactionTradeArray.push(temp)
            } else {
                satisfactionArray.push(temp)
            }
        }
        console.log(" -> Trades satisfaction " + JSON.stringify(satisfactionArray))
        satisfactionPagination = satisfactionPagination + queryLimit.value

        resolve()
    })
}

export const useDailySatisfactionChange = async (param1, param2, param3) => {
    console.log("\nDAILY SATISFACTION CHANGE")
    if (param3) {
        param3.satisfaction = param2
    } else {
        let index = satisfactionArray.findIndex(obj => obj.dateUnix == param1)
        if (index != -1) {
            satisfactionArray[index].satisfaction = param2
        } else {
            let temp = {}
            temp.dateUnix = param1
            temp.satisfaction = param2
            satisfactionArray.push(temp)
        }
    }
    await useUpdateDailySatisfaction(param1, param2)
}

export const useUpdateDailySatisfaction = async (param1, param2) => {
    console.log(" -> updating satisfactions")
    return new Promise(async (resolve, reject) => {

        // Find existing satisfaction for this date without tradeId
        const results = await dbFind("satisfactions", {
            equalTo: { dateUnix: param1 },
            doesNotExist: "tradeId"
        })
        const existing = results.length > 0 ? results[0] : null

        if (existing) {
            console.log(" -> Updating satisfaction")
            await dbUpdate("satisfactions", existing.objectId, {
                satisfaction: param2
            })
            console.log(' -> Updated satisfaction with id ' + existing.objectId)
        } else {
            console.log(" -> Saving satisfaction")
            const result = await dbCreate("satisfactions", {
                dateUnix: param1,
                satisfaction: param2
            })
            console.log(' -> Added new satisfaction with id ' + result.objectId)
        }
        resolve()
    })
}


export async function useGetExcursions() {
    return new Promise(async (resolve, reject) => {
        console.log("\nGETTING EXCURSIONS")

        let options = {
            ascending: "dateUnix"
        }

        if (pageId.value === "addExcursions") {
            let startD = dayjs().subtract(daysBack.value, 'days').unix()
            let endD = dayjs().unix()
            options.greaterThanOrEqualTo = { dateUnix: startD }
            options.lessThan = { dateUnix: endD }
        } else {
            let startD = selectedRange.value.start
            let endD = selectedRange.value.end
            // "Gesamt" filter: start=0, end=0 means all — skip date filters
            if (!(startD === 0 && endD === 0)) {
                options.greaterThanOrEqualTo = { dateUnix: startD }
                options.lessThan = { dateUnix: endD }
            }
            options.limit = queryLimit.value
        }

        excursions.length = 0
        const results = await dbFind("excursions", options)
        results.forEach(element => {
            excursions.push(element)
        });
        resolve()
    })
}

/****************************************$
 *
 * TAGS
 ****************************************/
export const useGetTagInfo = (param) => {
    const findTagInfo = (tagId) => {
        let temp = {}
        for (let obj of availableTags) {
            for (let tag of obj.tags) {
                if (tag.id === tagId) {
                    temp.tagGroupId = obj.id
                    temp.tagGroupName = obj.name
                    temp.groupColor = obj.color
                    temp.tagName = tag.name
                    return temp
                }
            }
        }

        let color = "#6c757d"
        if (availableTags.length > 0) {
            const firstGroup = availableTags[0]
            if (firstGroup && firstGroup.color) color = firstGroup.color
        }
        temp.groupColor = color
        temp.tagName = ''
        return temp
    }

    const tagIdToFind = param;
    const tagInfo = findTagInfo(tagIdToFind);
    return tagInfo
}

export async function useGetTags() {
    return new Promise(async (resolve, reject) => {
        console.log(" -> Getting Tags");
        tags.length = 0

        let options = {
            limit: queryLimit.value
        }

        if (pageId.value == "daily") {
            let startD = selectedRange.value.start
            let endD = selectedRange.value.end
            options.greaterThanOrEqualTo = { dateUnix: startD }
            options.lessThan = { dateUnix: endD }
        }
        // Dashboard und andere Seiten: queryLimit bleibt auf dem hohen Standardwert
        // damit ALLE Tags geladen werden (nicht nur Screenshots-Limit)

        const results = await dbFind("tags", options)

        if (results.length > 0) {
            for (let i = 0; i < results.length; i++) {
                let temp = {}
                const object = results[i];
                temp.tradeId = object.tradeId
                temp.tags = object.tags
                temp.dateUnix = object.dateUnix
                tags.push(temp)
            }
        }
        resolve()
    })
}

let _loadingAvailableTags = null
export async function useGetAvailableTags() {
    // Guard gegen parallele Aufrufe → Race Condition verhindert Doppel-Einträge
    if (_loadingAvailableTags) return _loadingAvailableTags
    _loadingAvailableTags = (async () => {
        console.log(" -> Getting Available Tags");
        const settings = await dbGetSettings()
        let currentTags = settings.tags

        // Atomar: erst leeren, dann sofort befüllen
        availableTags.splice(0)
        if (Array.isArray(currentTags) && currentTags.length > 0) {
            availableTags.push(...currentTags)
        }
    })()
    try {
        await _loadingAvailableTags
    } finally {
        _loadingAvailableTags = null
    }
}

export const useCreateAvailableTagsArray = () => {
    availableTagsArray.splice(0)
    for (let index = 0; index < availableTags.length; index++) {
        const element = availableTags[index];
        for (let index = 0; index < element.tags.length; index++) {
            const el = element.tags[index];
            availableTagsArray.push(el)
        }
    }
}

export const useFilterSuggestions = (param) => {
    let index = availableTags.findIndex(obj => obj.id == param)
    if (index === -1) return []
    return [{
        id: param,
        tags: availableTags[index].tags.filter(tag =>
            tag.name.toLowerCase().startsWith(tagInput.value.toLowerCase())
        )
    }]
}

export const useTradeTagsChange = async (param1, param2) => {
    console.log(" -> Type of trade tags change: " + param1)
    console.log(" -> Input added: " + JSON.stringify(param2))

    if (param1 == "add") {
        if (selectedTagIndex.value != -1) {
            console.log(" -> Adding on arrow down and enter " + param2)
            let tradeTagsIndex = tradeTags.findIndex(obj => obj.id == filteredSuggestions[selectedTagIndex.value].id)
            if (tradeTagsIndex == -1) {
                tradeTags.push(filteredSuggestions[selectedTagIndex.value]);
                tradeTagsChanged.value = true
                saveButton.value = true
                tagInput.value = '';
            }
        } else if (param2) {
            let inputTextIndex = tradeTags.findIndex(obj => obj.name.toLowerCase() == param2.toLowerCase())
            console.log(" -> InputTextIndex " + inputTextIndex)
            if (inputTextIndex != -1) {
                console.log("  --> Input text already exists in trades tags")
            } else {
                let inAvailableTagsIndex = availableTagsArray.findIndex(tag =>
                    tag.name.toLowerCase() == param2.toLowerCase())

                if (inAvailableTagsIndex != -1) {
                    console.log("  --> Input text already exists in availableTags")
                    tradeTags.push(availableTagsArray[inAvailableTagsIndex])
                    tradeTagsChanged.value = true
                    saveButton.value = true
                } else {
                    console.log("  --> Input is a new tag")
                    let temp = {}
                    const highestIdNumberAvailableTags = useFindHighestIdNumber(availableTags);
                    const highestIdNumberTradeTags = useFindHighestIdNumberTradeTags(tradeTags);

                    function chooseHighestNumber(num1, num2) {
                        return Math.max(num1, num2);
                    }

                    const highestIdNumber = chooseHighestNumber(highestIdNumberAvailableTags, highestIdNumberTradeTags);
                    temp.id = "tag_" + (highestIdNumber + 1).toString()
                    temp.name = param2
                    tradeTags.push(temp)
                    tradeTagsChanged.value = true
                    saveButton.value = true
                    newTradeTags.push(temp)
                    tagInput.value = '';
                }
            }
        }
        selectedTagIndex.value = -1
        showTagsList.value = ''
        console.log(" -> TradeTags " + JSON.stringify(tradeTags))
    }
    if (param1 == "addFromDropdownMenu") {
        let index = tradeTags.findIndex(obj => obj.id == param2.id)
        if (index == -1) {
            console.log(" -> Adding " + JSON.stringify(param2))
            tradeTags.push(param2);
            tradeTagsChanged.value = true
            saveButton.value = true
            tagInput.value = '';
        }
        selectedTagIndex.value = -1
        showTagsList.value = ''
        console.log(" -> TradeTags " + JSON.stringify(tradeTags))
    }

    if (param1 == "remove") {
        tradeTags.splice(param2, 1);
        tradeTagsChanged.value = true
        saveButton.value = true
    }

    if (pageId.value == "daily") {
        tradeTagsDateUnix.value = filteredTrades[itemTradeIndex.value].dateUnix
        console.log(" tradeIndex.value " + tradeIndex.value)
        if (tradeIndex.value != undefined) {
            tradeTagsId.value = filteredTrades[itemTradeIndex.value].trades[tradeIndex.value].id
        } else {
            tradeTagsId.value = null
        }
    }
};

export const useFilterTags = () => {
    if (tagInput.value == '') selectedTagIndex.value = -1
    // Flache Liste aller Tags die zum Input passen
    filteredSuggestions.splice(0)
    for (const group of availableTags) {
        for (const tag of group.tags) {
            if (tagInput.value === '' || tag.name.toLowerCase().startsWith(tagInput.value.toLowerCase())) {
                filteredSuggestions.push(tag)
            }
        }
    }
    showTagsList.value = (tagInput.value !== '' && filteredSuggestions.length > 0) ? pageId.value : ''
};

export const useHandleKeyDown = (event) => {
    if (showTagsList.value !== '') {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            console.log("filteredSuggestions " + JSON.stringify(filteredSuggestions))
            selectedTagIndex.value = Math.min(selectedTagIndex.value + 1, filteredSuggestions.length - 1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            selectedTagIndex.value = Math.max(selectedTagIndex.value - 1, 0);
        }
    }
};

export const useToggleTagsDropdown = () => {
    selectedTagIndex.value = -1
    showTagsList.value = showTagsList.value ? '' : pageId.value
    if (showTagsList.value) {
        // Alle Tags als flache Liste bereitstellen
        filteredSuggestions.splice(0)
        for (const group of availableTags) {
            for (const tag of group.tags) {
                filteredSuggestions.push(tag)
            }
        }
    }
}

export const useGetTagGroup = (param) => {
    const findGroupName = (tagId) => {
        for (let obj of availableTags) {
            for (let tag of obj.tags) {
                if (tag.id === tagId) {
                    return obj.name;
                }
            }
        }
        let name = null
        if (availableTags.length > 0) {
            name = availableTags.filter(obj => obj.id == "group_0")[0].name
        }
        return name
    }

    const tagIdToFind = param;
    const groupName = findGroupName(tagIdToFind);
    return groupName
}

export const useResetTags = () => {
    tradeTags.splice(0);
}

export const useFindHighestIdNumber = (param) => {
    let highestId = -Infinity;
    if (param.length == 0) {
        highestId = 0
    } else {
        param.forEach(innerArray => {
            innerArray.tags.forEach(obj => {
                if (Number(obj.id.replace("tag_", "")) > highestId) {
                    highestId = Number(obj.id.replace("tag_", ""))
                }
            });
        });
    }
    return highestId;
}

export const useFindHighestIdNumberTradeTags = (param) => {
    let highestId = -Infinity;
    if (param.length == 0) {
        highestId = 0
    } else {
        param.forEach(obj => {
            if (Number(obj.id.replace("tag_", "")) > highestId) {
                highestId = Number(obj.id.replace("tag_", ""))
            }
        });
    }
    return highestId;
}

export const useUpdateTags = async () => {
    console.log("\nUPDATING OR SAVING TAGS")
    return new Promise(async (resolve, reject) => {
        spinnerSetups.value = true
        let tagsArray = []
        for (let index = 0; index < tradeTags.length; index++) {
            const element = tradeTags[index];
            tagsArray.push(element.id)
        }

        let tradeIdFilter
        if (pageId.value == "addScreenshot") {
            tradeIdFilter = screenshot.name
        } else {
            tradeIdFilter = tradeTagsId.value ? tradeTagsId.value : tradeTagsDateUnix.value.toString()
        }

        const results = await dbFind("tags", {
            equalTo: { tradeId: tradeIdFilter }
        })
        const existing = results.length > 0 ? results[0] : null

        if (existing) {
            console.log(" -> Updating tags")
            spinnerSetupsText.value = "Updating"
            await dbUpdate("tags", existing.objectId, { tags: tagsArray })
            console.log(' -> Updated tags with id ' + existing.objectId)
        } else {
            console.log(" -> Saving tags")
            spinnerSetupsText.value = "Saving"

            let data = { tags: tagsArray }
            if (pageId.value == "addScreenshot") {
                data.dateUnix = screenshot.dateUnix
                data.tradeId = screenshot.name
            } else {
                if (tradeTagsId.value) {
                    data.dateUnix = tradeTagsDateUnix.value
                    data.tradeId = tradeTagsId.value
                } else {
                    data.dateUnix = tradeTagsDateUnix.value
                    data.tradeId = tradeTagsDateUnix.value.toString()
                }
            }

            const result = await dbCreate("tags", data)
            console.log(' -> Added new tags with id ' + result.objectId)
        }
        resolve()
    })
}

export const useUpdateAvailableTags = async () => {
    console.log("\nUPDATING OR SAVING AVAILABLE TAGS")
    return new Promise(async (resolve, reject) => {
        const settings = await dbGetSettings()
        let currentTags = settings.tags

        const saveTags = () => {
            console.log(" -> Saving available tags")
            currentTags = []
            let temp = {}
            temp.id = "group_0"
            temp.name = "Ungrouped"
            temp.color = "#6c757d"
            temp.tags = []
            for (let index = 0; index < tradeTags.length; index++) {
                const element = tradeTags[index];
                temp.tags.push(element)
            }
            currentTags.push(temp)
        }

        if (currentTags == undefined || currentTags == null) {
            saveTags()
        } else if (!Array.isArray(currentTags) || currentTags.length == 0) {
            saveTags()
        } else {
            console.log(" -> Updating available tags")
            let ungroupedIndex = currentTags.findIndex(obj => obj.id == "group_0")

            let tempArray = []
            if (pageId.value == "registerSignup") {
                tempArray = tradeTags
            } else {
                tempArray = newTradeTags
            }

            for (let index = 0; index < tempArray.length; index++) {
                const element = tempArray[index];
                let index2 = currentTags[ungroupedIndex].tags.findIndex(obj => obj.id == element.id)
                if (index2 == -1) {
                    console.log("  --> Adding new tag to available tags")
                    currentTags[ungroupedIndex].tags.push(element)
                } else {
                    console.log("  --> Tag already exists in available tags")
                }
            }
        }

        await dbUpdateSettings({ tags: currentTags })
        console.log(' -> Saved/Updated available tags')
        resolve()
    })
}

/****************************************$
 *
 * NOTES
 ****************************************/

export async function useGetNotes() {
    return new Promise(async (resolve, reject) => {
        console.log(" -> Getting Notes");
        notes.length = 0
        let startD = selectedRange.value.start
        let endD = selectedRange.value.end

        const results = await dbFind("notes", {
            greaterThanOrEqualTo: { dateUnix: startD },
            lessThan: { dateUnix: endD },
            limit: queryLimit.value
        })

        if (results.length > 0) {
            for (let i = 0; i < results.length; i++) {
                let temp = {}
                const object = results[i];
                temp.tradeId = object.tradeId
                temp.note = object.note
                temp.dateUnix = object.dateUnix
                temp.tradingMetadata = object.tradingMetadata || null
                notes.push(temp)
            }
        }
        resolve()
    })
}

export async function useGetAuswertungNotes() {
    return new Promise(async (resolve, reject) => {
        console.log(" -> Getting Auswertung Notes")
        auswertungNotes.length = 0
        let startD = selectedRange.value.start
        let endD = selectedRange.value.end
        const options = { limit: queryLimit.value }
        if (!(startD === 0 && endD === 0)) {
            options.greaterThanOrEqualTo = { dateUnix: startD }
            options.lessThan = { dateUnix: endD }
        }
        const results = await dbFind("notes", options)
        if (results.length > 0) {
            for (let i = 0; i < results.length; i++) {
                const obj = results[i]
                auswertungNotes.push({
                    tradeId: obj.tradeId,
                    dateUnix: obj.dateUnix,
                    note: obj.note,
                    entryStressLevel: obj.entryStressLevel || 0,
                    emotionLevel: obj.emotionLevel || 0,
                    feelings: obj.feelings || '',
                    playbook: obj.playbook || '',
                    timeframe: obj.timeframe || '',
                    entryNote: obj.entryNote || ''
                })
            }
        }
        resolve()
    })
}

export const useUpdateNote = async () => {
    console.log("\nUPDATING OR SAVING NOTE")
    return new Promise(async (resolve, reject) => {
        spinnerSetups.value = true

        const existing = await dbFirst("notes", {
            equalTo: { tradeId: tradeNoteId.value }
        })

        if (existing) {
            console.log(" -> Updating note")
            spinnerSetupsText.value = "Updating"
            await dbUpdate("notes", existing.objectId, {
                note: tradeNote.value
            })
            console.log(' -> Updated note with id ' + existing.objectId)
        } else {
            console.log(" -> Saving note")
            spinnerSetupsText.value = "Saving"
            const result = await dbCreate("notes", {
                note: tradeNote.value,
                dateUnix: tradeNoteDateUnix.value,
                tradeId: tradeNoteId.value
            })
            console.log(' -> Added new note with id ' + result.objectId)
        }
        resolve()
    })
}
