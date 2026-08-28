<script setup>
import { onBeforeMount, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue';
import Screenshot from '../components/Screenshot.vue'
import { currentDate, dateScreenshotEdited, editingScreenshot, itemToEditId, spinnerLoadingPage, timeZoneTrade } from '../stores/ui.js';
import { selectedTagIndex } from '../stores/filters.js';
import { screenshot, tradeTags, tagInput, showTagsList, availableTags, tags } from '../stores/trades.js';
import { useSaveScreenshot, useSetupImageUpload, useSetupImageFile } from '../utils/screenshots';
import { useDatetimeLocalFormat } from '../utils/formatters.js';
import { useGetSelectedRange } from '../utils/mountOrchestration.js';
import { useVerlassenSchutz } from '../composables/useVerlassenSchutz.js';
import { useFilterSuggestions, useTradeTagsChange, useFilterTags, useToggleTagsDropdown, useGetTags, useGetAvailableTags, useGetTagInfo } from '../utils/daily';

/* MODULES */
import { dbGet } from '../utils/db.js'
import dayjs from '../utils/dayjs-setup.js'

const router = useRouter()
const { t } = useI18n()

onBeforeMount(async () => {
    await (spinnerLoadingPage.value = true)
    await useGetSelectedRange()
    await Promise.all([useGetTags(), useGetAvailableTags()])
    await getScreenshotToEdit(itemToEditId.value)
    await sessionStorage.removeItem('editItemId');
    await (spinnerLoadingPage.value = false)
    // Erst NACH dem Laden merken — `onMounted` käme dem async-Laden zuvor und
    // hielte ein bestehendes Bild fälschlich für neu hinzugefügt.
    bildBeimLaden.value = !!screenshot.originalBase64
})
currentDate.value = dayjs().tz(timeZoneTrade.value).format("YYYY-MM-DD HH:mm")

// ── Drag & Drop + Zwischenablage ──
// Erstes Bild aus Drop bzw. Paste an dieselbe Verarbeitung wie der Datei-Upload.
const dragOver = ref(false)

/*
 * Ein hochgeladenes und womöglich schon annotiertes Bild ist bis zum
 * Speichern nur im Speicher. Beim Bearbeiten eines bestehenden Screenshots
 * liegt das Bild bereits vor — dann fragt der Schutz nicht, sonst käme die
 * Rückfrage auch bei reinem Ansehen.
 */
const bildBeimLaden = ref(false)
useVerlassenSchutz(() => !!screenshot.originalBase64 && !bildBeimLaden.value)

function ersteBilddatei(list) {
    return [...(list || [])].find(f => f && f.type && f.type.startsWith('image/')) || null
}

function onDrop(e) {
    dragOver.value = false
    const file = ersteBilddatei(e.dataTransfer?.files)
    if (file) useSetupImageFile(file)
}

function onPaste(e) {
    const items = e.clipboardData?.items || []
    for (const it of items) {
        if (it.type && it.type.startsWith('image/')) {
            const file = it.getAsFile()
            if (file) { useSetupImageFile(file); e.preventDefault(); return }
        }
    }
}

onMounted(() => { window.addEventListener('paste', onPaste) })
onUnmounted(() => { window.removeEventListener('paste', onPaste) })
//console.log(" current page id " + pageId.value)
//console.log(" screenshot "+JSON.stringify(screenshot))
let setupType = [{
    value: null,
    label: "Typ"
},
{
    value: "setup",
    label: "Allgemeines Setup"
},
{
    value: "entry",
    label: "Trade-Einstieg"
}
]

let entrySide = [{
    value: null,
    label: "Seite"
},
{
    value: "SS",
    label: "Short"
},
{
    value: "B",
    label: "Kauf"
}
]

function screenshotUpdateDate(event) {
    if (editingScreenshot.value) {
        dateScreenshotEdited.value = true
    }
    screenshot.date = event
    //console.log("screenshot date (local time, i.e. New York time) " + this.screenshot.date)
    screenshot.dateUnix = dayjs.tz(screenshot.date, timeZoneTrade.value).unix()
    //console.log(" screenshot "+JSON.stringify(screenshot))
    //console.log("unix " + dayjs.tz(this.screenshot.date, this.timeZoneTrade).unix()) // we SPECIFY that it's New york time
}

async function getScreenshotToEdit(param) {
    console.log(" -> Getting screenshot to edit " + param)
    if (!param) {
        return
    }
    editingScreenshot.value = true

    //console.log("screenshot to edit " + screenshotIdToEdit.value)
    const results = await dbGet("screenshots", param)
    if (results) {
        for (let key in screenshot) delete screenshot[key]
        Object.assign(screenshot, results)
        //console.log(" -> Screenshot to edit "+JSON.stringify(screenshot))
        if (screenshot.side) {
            screenshot.type = "entry"
        } else {
            screenshot.type = "setup"
        }

        let findTags = tags.find(obj => obj.tradeId == screenshot.name)
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
        console.log(' -> No screenshot to edit')
        //alert("Query did not return any results")
    }
}

</script>
<template>
    <SpinnerLoadingPage />
    <div v-show="!spinnerLoadingPage">
        <div class="row mt-3 mb-3">
            <div class="col-12 mb-2">
                <div class="row">
                    <div class="col">
                        <select v-model="screenshot.type" class="form-select">
                            <option v-for="item in setupType" v-bind:value="item.value">{{ item.label }}</option>
                        </select>
                    </div>
                    <div class="col">
                        <input type="datetime-local" v-bind:step="screenshot.type == 'setup' ? '' : '1'"
                            class="form-control"
                            v-bind:value="screenshot.hasOwnProperty('dateUnix') ? useDatetimeLocalFormat(screenshot.dateUnix) : currentDate"
                            v-on:input="screenshotUpdateDate($event.target.value)" />
                    </div>

                    <div class="col">
                        <input type="text" class="form-control"
                            v-bind:value="screenshot.hasOwnProperty('symbol') ? screenshot.symbol : ''"
                            v-on:input="screenshot.symbol = $event.target.value" placeholder="Symbol" />
                    </div>

                </div>
            </div>
            <div class="col-12">
                <div class="row">

                    <div v-if="screenshot.type == 'entry'" class="col">
                        <select v-model="screenshot.side" class="form-select">
                            <option v-for="item in entrySide" v-bind:value="item.value">{{ item.label }}</option>
                        </select>
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

                        <ul class="dropdown-menu-tags" v-show="showTagsList === 'addScreenshot'">
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



                </div>
            </div>
        </div>
        <div class="mt-3">
            <!-- Datei-Upload + Drag&Drop-Zone + Einfügen aus Zwischenablage (Strg/Cmd+V).
                 Als <label>: Klick irgendwo in der Zone öffnet die Dateiwahl; der
                 eigene @drop-Handler nimmt gezogene Bilder. -->
            <label class="ss-dropzone" :class="{ 'ss-dropzone-over': dragOver }"
                @dragover.prevent="dragOver = true" @dragenter.prevent="dragOver = true"
                @dragleave.prevent="dragOver = false" @drop.prevent="onDrop">
                <i class="uil uil-image-upload ss-dropzone-icon"></i>
                <div class="ss-dropzone-text">
                    <strong>Bild hierher ziehen oder auswählen</strong>
                    <span>oder aus der Zwischenablage einfügen (Strg/Cmd + V)</span>
                </div>
                <input type="file" accept="image/*" @change="useSetupImageUpload" class="ss-dropzone-input" />
            </label>
        </div>
        <Screenshot v-if="screenshot.originalBase64" :screenshot-data="screenshot" source="addScreenshot" />

        <p class="fst-italic fw-lighter text-center" v-show="screenshot.originalBase64">
            <small>Klicke auf <i class="uil uil-image-edit ms-2 me-2"></i> zum Markieren & Kommentieren</small>
        </p>

        <div class="mt-3 mb-3">
            <button type="button" v-on:click="useSaveScreenshot" class="btn btn-success btn-sm">Absenden</button>
        </div>
        <div class="mt-3">
            <!-- siehe AddTrades.vue: kein `type="cancel"`, keine harte Navigation -->
            <button type="button" @click="router.push('/screenshots')"
                class="btn btn-outline-secondary btn-sm">{{ t('common.cancel') }}</button>
        </div>
    </div>
</template>

<style scoped>
.ss-dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 1.4rem 1rem;
    border: 2px dashed var(--white-18, rgba(255, 255, 255, 0.2));
    border-radius: 10px;
    background: var(--black-bg-7, rgba(255, 255, 255, 0.03));
    color: var(--white-70, rgba(255, 255, 255, 0.7));
    text-align: center;
    cursor: pointer;
    transition: all 0.15s ease;
}
.ss-dropzone:hover { border-color: var(--white-38, rgba(255, 255, 255, 0.38)); }
.ss-dropzone-over {
    border-color: var(--blue-color, #01B4FF);
    background: rgba(1, 180, 255, 0.08);
    color: var(--white-87);
}
.ss-dropzone-icon {
    font-size: 1.8rem;
    color: var(--blue-color, #01B4FF);
}
.ss-dropzone-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    line-height: 1.3;
}
.ss-dropzone-text strong { font-size: 0.9rem; font-weight: 600; }
.ss-dropzone-text span { font-size: 0.78rem; color: var(--white-60, rgba(255, 255, 255, 0.6)); }
/* Input versteckt — die Zone ist ein <label>, Klick öffnet die Dateiwahl. */
.ss-dropzone-input {
    display: none;
}
</style>