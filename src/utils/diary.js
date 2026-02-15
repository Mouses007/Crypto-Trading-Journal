import { diaries, selectedMonth, endOfList, spinnerLoadingPage, spinnerLoadMore, pageId, diaryIdToEdit, diaryUpdate, selectedItem, renderData, diaryQueryLimit, diaryPagination } from "../stores/globals.js"
import { usePageRedirect } from "./utils.js";
import { useUpdateTags, useUpdateAvailableTags } from "./daily.js";
import { dbFind, dbFirst, dbCreate, dbUpdate, dbDelete } from './db.js'

export async function useGetDiaries(param1, param2) {
    //param1: true is diary page
    //param2: true is diary delete
    return new Promise(async (resolve, reject) => {
        console.log(" -> Getting diaries");

        let options = {
            descending: "dateUnix"
        }

        if (param1) {
            options.limit = diaryQueryLimit.value
            options.skip = diaryPagination.value
        } else {
            options.greaterThanOrEqualTo = { dateUnix: selectedMonth.value.start }
            options.lessThanOrEqualTo = { dateUnix: selectedMonth.value.end }
        }

        const results = await dbFind("diaries", options)

        if (results.length > 0) {
            if (param1) {
                results.forEach(element => {
                    diaries.push(element)
                });
            } else {
                diaries.length = 0
                results.forEach(element => {
                    diaries.push(element)
                });
            }
        } else {
            if (pageId.value == "diary") {
                endOfList.value = true
            }
        }

        diaryPagination.value = diaryPagination.value + diaryQueryLimit.value
        if (pageId.value != "daily") spinnerLoadingPage.value = false
        spinnerLoadMore.value = false
        resolve()
    })
}

export async function useUploadDiary(param) {
    return new Promise(async (resolve, reject) => {

        await Promise.all([useUpdateAvailableTags(), useUpdateTags()])

        if (diaryIdToEdit.value) {
            console.log(" -> Updating diary")
            await dbUpdate("diaries", diaryIdToEdit.value, {
                date: diaryUpdate.dateDateFormat,
                dateUnix: diaryUpdate.dateUnix,
                diary: diaryUpdate.diary
            })
            if (param != "autoSave") usePageRedirect()
        } else {
            // Check if diary with that date already exists
            const existing = await dbFirst("diaries", {
                equalTo: { dateUnix: diaryUpdate.dateUnix }
            })
            if (existing) {
                alert("Diary with that date already exists")
                resolve()
                return
            }

            console.log(" -> saving diary")
            const result = await dbCreate("diaries", {
                date: diaryUpdate.dateDateFormat,
                dateUnix: diaryUpdate.dateUnix,
                diary: diaryUpdate.diary
            })
            console.log('  --> Added new diary with id ' + result.objectId)
            if (param != "autoSave") {
                usePageRedirect()
            } else {
                diaryIdToEdit.value = result.objectId
            }
        }
        resolve()
    })
}

export async function useDeleteDiary(param1, param2) {
    console.log("\nDELETING DIARY ENTRY")
    await dbDelete("diaries", selectedItem.value)
    await refreshDiaries()
}

async function refreshDiaries() {
    console.log(" -> Refreshing diary entries")
    return new Promise(async (resolve, reject) => {
        diaryQueryLimit.value = 10
        diaryPagination.value = 0
        diaries.length = 0
        await useGetDiaries(true)
        await (renderData.value += 1)
        selectedItem.value = null
        resolve()
    })
}
