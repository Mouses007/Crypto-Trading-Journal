<script setup>
import { onBeforeMount, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue';
import { spinnerLoadingPage, itemToEditId, currentDate, timeZoneTrade, countdownSeconds } from '../stores/ui.js';
import { selectedTagIndex } from '../stores/filters.js';
import { tradeTags, tagInput, showTagsList, availableTags, tags } from '../stores/trades.js';
import { diaryUpdate, diaryIdToEdit, diaryButton } from '../stores/diary.js';
import { useDateCalFormat } from '../utils/formatters.js';
import { useVerlassenSchutz } from '../composables/useVerlassenSchutz.js';
import { useInitQuill } from '../utils/utils';
import { useUploadDiary } from '../utils/diary'
import { sanitizeHtml } from '../utils/sanitize'
import { useFilterSuggestions, useTradeTagsChange, useFilterTags, useToggleTagsDropdown, useGetTags, useGetAvailableTags, useGetTagInfo } from '../utils/daily';

/* MODULES */
import { dbGet } from '../utils/db.js'
import dayjs from '../utils/dayjs-setup.js'

const router = useRouter()
const { t } = useI18n()

let diary = {}
currentDate.value = dayjs().tz(timeZoneTrade.value).format("YYYY-MM-DD")

onBeforeMount(async () => {
    await (spinnerLoadingPage.value = true)
    await Promise.all([useGetTags(), useGetAvailableTags(), diaryDateInput(currentDate.value), useInitQuill("Diary")])
    await initDiaryJson()
    await getDiaryToEdit(itemToEditId.value)
    await sessionStorage.removeItem('editItemId');
    await (spinnerLoadingPage.value = false)
    standBeimLaden.value = quillInhalt()
})

/*
 * Der Editorinhalt lebt im DOM, nicht im Store — `diaryUpdate.diary` wird nur
 * beim Speichern gelesen. Für die Frage „gibt es Ungespeichertes?" ist der DOM
 * deshalb die verlässliche Quelle.
 */
function quillInhalt() {
    return document.querySelector('#quillEditorDiary .ql-editor')?.innerHTML ?? ''
}

const standBeimLaden = ref('')

useVerlassenSchutz(() => {
    const jetzt = quillInhalt()
    // Quill hinterlässt bei leerem Editor ein <p><br></p> — das ist kein Text.
    const leer = (h) => h.replace(/<p>(<br\s*\/?>)?<\/p>/gi, '').trim() === ''
    if (leer(jetzt)) return false
    return jetzt !== standBeimLaden.value
})

function diaryDateInput(param) {
    //console.log(" -> diaryDateInput param: " + param)
    diaryUpdate.dateUnix = dayjs.tz(param, timeZoneTrade.value).unix()
    diaryUpdate.date = dayjs(diaryUpdate.dateUnix * 1000).format("YYYY-MM-DD")
    diaryUpdate.dateDateFormat = new Date(diaryUpdate.date)
    console.log(" -> diaryDateUnix " + diaryUpdate.dateUnix + " and date " + diaryUpdate.date)
    //console.log("diaryUpdate " + JSON.stringify(diaryUpdate))
}

async function getDiaryToEdit(param) {
    if (!param) {
        return
    }
    diaryIdToEdit.value = param
    //console.log("diary to edit " + diaryIdToEdit.value)
    const results = await dbGet("diaries", param)
    if (results) {
        diary = results
        //console.log(" Diary to edit " + JSON.stringify(diary))
        //console.log("diary.dateUnix "+diary.dateUnix)
        diaryUpdate.dateUnix = diary.dateUnix
        diaryUpdate.date = dayjs.unix(diary.dateUnix).format("YYYY-MM-DD")
        diaryUpdate.dateDateFormat = new Date(diaryUpdate.date)
        //console.log("diaryUpdate " + JSON.stringify(diaryUpdate))
        document.querySelector("#quillEditorDiary .ql-editor").innerHTML = sanitizeHtml(diary.diary)

        let findTags = tags.find(obj => obj.tradeId == diaryUpdate.dateUnix)
        if (findTags) {
            findTags.tags.forEach(element => {
                for (let obj of availableTags) {
                    for (let tag of obj.tags) {
                        if (tag.id === element) {
                            let temp = {}
                            temp.id = tag.id
                            temp.name = tag.name
                            tradeTags.push(temp)
                        }
                    }
                }
            });
        }

    } else {
        console.log(' -> No diary to edit')
        //alert("Query did not return any results")
    }
}

async function initDiaryJson(param) {
    return new Promise(async (resolve, reject) => {

        diaryUpdate.diary = ""

        resolve()
    })
}




</script>
<template>
    <SpinnerLoadingPage />
    <div class="row mt-2">
        <!-- ============ ADD Diary ============ -->
        <div>
            <div v-show="!spinnerLoadingPage">
                <div class="mt-3 input-group mb-3">
                    <input type="date" class="form-control"
                        v-bind:value="diaryUpdate.hasOwnProperty('date') ? diaryUpdate.date : diaryUpdate.date = currentDate"
                        v-on:input="diaryDateInput($event.target.value)" />
                </div>

                <!-- Tags -->
                <div class="container-tags col">
                    <div class="form-control dropdown form-select" style="height: auto;">
                        <div style="display: flex; align-items: center; flex-wrap: wrap;">
                            <span v-for="(tag, index) in tradeTags" :key="index" class="tag txt-small"
                                :style="{ 'background-color': useGetTagInfo(tag.id).groupColor }"
                                @click="useTradeTagsChange('remove', index)">
                                {{ tag.name }}<span class="remove-tag">×</span>
                            </span>

                            <input type="text" v-model="tagInput" @input="useFilterTags"
                                @keydown.enter.prevent="useTradeTagsChange('add', tagInput)"
                                @keydown.tab.prevent="useTradeTagsChange('add', tagInput)"
                                class="form-control tag-input" placeholder="Tag hinzufügen">
                            <div class="clickable-area" v-on:click="useToggleTagsDropdown">
                            </div>
                        </div>
                    </div>

                    <ul class="dropdown-menu-tags" v-show="showTagsList === 'addDiary'">
                        <span v-for="group in availableTags">
                            <h6 class="p-1 mb-0" :style="'background-color: ' + group.color + ';'"
                                v-show="useFilterSuggestions(group.id).filter(obj => obj.id == group.id)[0].tags.length > 0">
                                {{ group.name }}</h6>
                            <li v-for="(suggestion, index) in useFilterSuggestions(group.id).filter(obj => obj.id == group.id)[0].tags"
                                :key="index" :class="{ active: index === selectedTagIndex }"
                                @click="useTradeTagsChange('addFromDropdownMenu', suggestion)"
                                class="dropdown-item dropdown-item-tags">
                                <span class="ms-2">{{ suggestion.name }}</span>
                            </li>
                        </span>
                    </ul>
                </div>

                <!-- Diary -->
                <div class="mt-2">
                    <div id="quillEditorDiary"></div>
                </div>
                
                <!--
                    Ein <button>, kein <div>: `:disabled` und `type` sind auf
                    einem div wirkungslos — der Klick feuerte trotzdem, und per
                    Tastatur war der Knopf gar nicht erreichbar.
                -->
                <button type="button" class="progress buttonProgress mt-3"
                    :disabled="!diaryButton" @click="useUploadDiary()">
                    <span class="progress-bar buttonProgressBar text-center"
                        :style="{ width: (5 - countdownSeconds) / 5 * 100 + '%' }">
                        <span class="progress-bar-text">{{ t('common.submit') }}</span>
                    </span>
                </button>

                <div class="mt-3">
                    <!--
                        `type="cancel"` gibt es nicht — der Browser faellt auf
                        `submit` zurueck. Und `location.href` startet die ganze
                        App neu, statt im Router zu navigieren.
                    -->
                    <button type="button" @click="router.push('/diary')"
                        class="btn btn-outline-secondary btn-sm">{{ t('common.cancel') }}</button>
                </div>
            </div>
        </div>
    </div>
</template>