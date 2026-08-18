<script setup>
import { selectedItem, modalDailyTradeOpen, pageId, kopiertesBild } from '../stores/ui.js';
import { tags } from '../stores/trades.js';
import { useSetupMarkerArea, useSelectedScreenshotFunction } from '../utils/screenshots';
import { useHourMinuteFormat, useTimeFormat, useCreatedDateFormat } from '../utils/formatters.js';
import { useEditItem } from '../utils/utils';
import { useGetTagInfo } from '../utils/daily';


import { ref } from 'vue'

const props = defineProps({
    screenshotData: Object,
    showTitle: Boolean,
    source: String,
    index: Number
})

// Kopieren/Speichern: das (annotierte) Bild als Datei bzw. in die Zwischenablage,
// damit man es in der Trade-Bewertung (Playbook) per Strg/Cmd+V einfügen kann.
const kopierStatus = ref('')  // '' | 'ok' | 'fehler'

function bildDatenUrl() {
    return props.screenshotData?.annotatedBase64 || props.screenshotData?.originalBase64 || ''
}

// Data-URL (auch JPEG) über ein Canvas nach PNG wandeln — die Zwischenablage
// akzeptiert bei Bildern nur PNG.
function alsPngBlob(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
            const c = document.createElement('canvas')
            c.width = img.naturalWidth
            c.height = img.naturalHeight
            c.getContext('2d').drawImage(img, 0, 0)
            c.toBlob(b => b ? resolve(b) : reject(new Error('toBlob leer')), 'image/png')
        }
        img.onerror = reject
        img.src = dataUrl
    })
}

async function inZwischenablage() {
    const url = bildDatenUrl()
    if (!url) return
    // App-interne Zwischenablage füllen — funktioniert IMMER (auch über HTTP).
    // Nur die ID merken (+ sessionStorage, übersteht den Seitenwechsel); das
    // Bild holt das Playbook beim Einfügen frisch aus der DB.
    const merk = { objectId: props.screenshotData?.objectId, name: props.screenshotData?.name || 'screenshot' }
    kopiertesBild.value = merk
    try { sessionStorage.setItem('kopiertesBild', JSON.stringify(merk)) } catch (e) { /* ignore */ }
    kopierStatus.value = 'ok'
    // Bonus: zusätzlich die Browser-Zwischenablage versuchen (nur HTTPS/localhost).
    try {
        if (navigator.clipboard && window.ClipboardItem && window.isSecureContext) {
            const blob = await alsPngBlob(url)
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        }
    } catch (e) { /* egal — die App-interne Ablage reicht */ }
    setTimeout(() => { kopierStatus.value = '' }, 1500)
}

</script>

<template>
    <div class="row">
        <!-- HEADER / DATE & INFO -->
        <div v-if="props.source == 'fullScreen' || props.source == 'screenshots'" class="col-12 cardFirstLine">
            <div class="row">
                <div class="col">
                    <h5>{{ useCreatedDateFormat(props.screenshotData.dateUnix) }}</h5>
                </div>
                <div v-if="props.source == 'fullScreen'" class="col me-auto text-end" data-bs-theme="dark">
                    <button v-if="!modalDailyTradeOpen" type="button" class="btn-close" data-bs-dismiss="modal"
                        aria-label="Close"></button>
                    <button v-if="modalDailyTradeOpen" type="button" class="btn-close" data-bs-target="#tradesModal"
                        data-bs-toggle="modal"></button>
                </div>
            </div>
        </div>

        <!-- SUB HEADER -->
        <div class="col-12 mt-2">
            <div class="row">

                <!-- Left: info -->
                <div v-if="props.source != 'addScreenshot' && props.source != 'dailyModal'" class="col-6">
                    <span>{{ props.screenshotData.symbol }}</span><span v-if="props.screenshotData.side"
                        class="col mt-1">
                        | {{ props.screenshotData.side == 'SS' || props.screenshotData.side == 'BC' ? 'Short' :
            'Long' }}
                        | {{ useTimeFormat(props.screenshotData.dateUnix) }}</span>
                    <span v-else class="col mb-2"> | {{
            useHourMinuteFormat(props.screenshotData.dateUnix)
        }}</span>


                    <span v-for="tags in tags.filter(obj => obj.tradeId == props.screenshotData.name)"><span
                            v-if="tags.tags.length > 0"> | <span v-for="tag in tags.tags.slice(0, 2)"
                                class="tag txt-small" :style="{ 'background-color': useGetTagInfo(tag).groupColor }">{{
            useGetTagInfo(tag).tagName }}
                            </span>
                            <span v-show="tags.tags.length > 2">+{{
            tags.tags.length
            - 2 }}</span></span></span>

                </div>

                <!-- Right: tools -->
                <div v-if="props.source != 'fullScreen'"
                    :class="[props.source == 'addScreenshot' || props.source == 'dailyModal' ? 'offset-6' : '', 'col-6 text-end']">

                    <!-- Expand / fullScreen screen -->
                    <i v-if="props.screenshotData.objectId && props.source != 'addScreenshot'"
                        class="uil uil-expand-arrows-alt pointerClass me-3" data-bs-toggle="modal"
                        data-bs-target="#fullScreenModal"
                        v-on:click="useSelectedScreenshotFunction(props.index, props.source, props.screenshotData)"></i>

                    <!-- Annotate -->
                    <i class="uil uil-image-edit pointerClass me-3"
                        v-on:click="useSetupMarkerArea(props.source, props.screenshotData)"></i>

                    <!-- In Zwischenablage kopieren (zum Einfügen in die Trade-Bewertung) -->
                    <i v-if="props.screenshotData.objectId"
                        :class="['uil', 'pointerClass', 'me-3', kopierStatus === 'ok' ? 'uil-check text-success' : kopierStatus === 'fehler' ? 'uil-times text-danger' : 'uil-copy']"
                        :title="kopierStatus === 'ok' ? 'Kopiert!' : 'In Zwischenablage kopieren'"
                        v-on:click="inZwischenablage()"></i>

                    <!-- Edit -->
                    <i v-if="props.source == 'screenshots'" class="uil uil-edit-alt pointerClass me-4"
                        v-on:click="useEditItem(props.screenshotData.objectId)"></i>

                    <!-- Delete -->
                    <i v-if="props.screenshotData.objectId && props.source != 'addScreenshot'"
                        v-on:click="selectedItem = props.screenshotData.objectId"
                        class="ps-2 uil uil-trash-alt popoverDelete pointerClass" data-bs-html="true"
                        data-bs-content="<div>Are you sure?</div><div class='text-center'><a type='button' class='btn btn-red btn-sm popoverYes'>Yes</a><a type='button' class='btn btn-outline-secondary btn-sm ms-2 popoverNo'>No</a></div>"
                        data-bs-toggle="popover" data-bs-placement="left"></i>
                </div>
            </div>
        </div>

    </div>

    <!-- SCREENSHOTS -->
    <div :class="[pageId === 'addScreenshot' ? 'imgContainerAddScreenshot' : 'imgContainer']">
        <img :id="props.screenshotData.objectId ? 'screenshotDiv-' + props.source + '-' + props.screenshotData.objectId : 'screenshotDiv-' + props.source + '-' + props.screenshotData.dateUnix"
            class="screenshotImg mt-3 img-fluid" v-bind:src="props.screenshotData.originalBase64" />
        <img class="overlayImg screenshotImg mt-3 img-fluid" v-bind:src="props.screenshotData.annotatedBase64" />

        <!--<img v-if="props.screenshotData.markersOnly" :id="props.screenshotData.objectId ? 'screenshotDiv-' + props.source + '-' + props.screenshotData.objectId : 'screenshotDiv-' + props.source + '-' + props.screenshotData.dateUnix" class="screenshotImg mt-3 img-fluid" v-bind:src="props.screenshotData.originalBase64" />

        <img :id="!props.screenshotData.markersOnly ? props.screenshotData.objectId ? 'screenshotDiv-' + props.source + '-' + props.screenshotData.objectId : 'screenshotDiv-' + props.source + '-' + props.screenshotData.dateUnix : ''"
            v-bind:class="[props.screenshotData.markersOnly ? 'overlayImg' : '', 'screenshotImg mt-3 img-fluid']"
            v-bind:src="props.screenshotData.annotatedBase64" />-->

        <!--<img v-if="props.screenshotData.markersOnly" class="screenshotImg mt-3 img-fluid"
            v-bind:src="props.screenshotData.originalBase64" />
        <img v-bind:class="[props.screenshotData.markersOnly ? 'overlayImg' : '', 'screenshotImg mt-3 img-fluid']"
            v-bind:src="props.screenshotData.annotatedBase64" />-->
    </div>
</template>
