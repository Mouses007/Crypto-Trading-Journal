<script setup>
import { onMounted } from 'vue';
import { useToggleMobileMenu } from '../utils/utils.js'
import { useInitTooltip } from "../utils/utils.js";
import { pageId, currentUser, renderProfile, screenType } from "../stores/globals"
import { version } from '../../package.json';

const pages = [{
    id: "dashboard",
    name: "Dashboard",
    icon: "uil uil-apps"
},
{
    id: "daily",
    name: "Tages Ansicht",
    icon: "uil uil-signal-alt-3"
},
{
    id: "calendar",
    name: "Kalender",
    icon: "uil uil-calendar-alt"
},
{
    id: "screenshots",
    name: "Screenshots",
    icon: "uil uil-image-v"
},
{
    id: "incoming",
    name: "Offene Trades",
    icon: "uil uil-arrow-circle-down"
},
{
    id: "playbook",
    name: "Playbook",
    icon: "uil uil-compass"
},
{
    id: "auswertung",
    name: "Auswertung",
    icon: "uil uil-chart-pie"
},
{
    id: "kiAgent",
    name: "KI-Agent",
    icon: "uil uil-robot"
},
{
    id: "addTrades",
    name: "Manueller Trade Import",
    icon: "uil uil-plus-circle"
},
{
    id: "settings",
    name: "Einstellungen",
    icon: "uil uil-sliders-v-alt"
},
{
    id: "addExcursions",
    name: "Exkursionen hinzufügen",
    icon: "uil uil-refresh"
},
{
    id: "imports",
    name: "Importe",
    icon: "uil uil-import"
}
]

onMounted(async () => {
    await useInitTooltip()
})

const navAdd = (param) => {
    window.location.href = "/" + param;
};


</script>

<template>
    <div class="justify-content-between navbar">
        <div class="col-6">
            <span v-if="screenType == 'mobile'">
                <a v-on:click="useToggleMobileMenu">
                    <i v-bind:class="pages.filter(item => item.id == pageId)[0].icon" class="me-1"></i>{{
                        pages.filter(item => item.id == pageId)[0].name }}</a>
            </span>
            <span v-else>
                <i v-bind:class="pages.filter(item => item.id == pageId)[0].icon" class="me-1"></i>{{
                    pages.filter(item => item.id == pageId)[0].name }}</span>
        </div>
        <div class="col-6 ms-auto text-end">
        </div>
    </div>
</template>