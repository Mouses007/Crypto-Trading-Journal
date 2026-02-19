<script setup>
import { ref, onBeforeMount, onMounted } from 'vue'
import NoData from '../components/NoData.vue';
import Filters from '../components/Filters.vue';
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue';
import Screenshot from '../components/Screenshot.vue';
import { spinnerLoadMore, spinnerLoadingPage, expandedScreenshot } from '../stores/ui.js';
import { screenshots } from '../stores/trades.js';
import { useMountScreenshots, useCheckVisibleScreen, useLoadMore } from '../utils/mountOrchestration.js';
import { endOfList } from '../stores/ui.js';

onBeforeMount(async () => {

})

onMounted(async () => {
    await useMountScreenshots()
    window.addEventListener('scroll', () => {
        let scrollFromTop = window.scrollY
        let visibleScreen = (window.innerHeight + 200) // adding 200 so that loads before getting to bottom
        let documentHeight = document.documentElement.scrollHeight
        let difference = documentHeight - (scrollFromTop + visibleScreen)
        //console.log("scroll top "+scrollFromTop)
        //console.log("visible screen "+visibleScreen)
        //console.log("documentHeight "+documentHeight)
        //console.log("difference "+difference)
        if (difference <= 0) {

            if (!spinnerLoadMore.value && !spinnerLoadingPage.value && !endOfList.value && expandedScreenshot.value == null) { //To avoid firing multiple times, make sure it's not loadin for the first time and that there is not already a loading more (spinner)
                useLoadMore()
            }
        }
    })
    useCheckVisibleScreen()

})

</script>

<template>
    <SpinnerLoadingPage />
    <div v-show="!spinnerLoadingPage" class="mt-2 mb-2">
        <Filters />
        <div v-if="screenshots.length == 0">
            <NoData />
        </div>
        <div class="row">
            <div v-for="(itemScreenshot, index) in screenshots" class="col-12 col-xl-6 mt-2">
                <div class="dailyCard" v-bind:id="itemScreenshot.objectId">
                    <div class="row">
                        <Screenshot :screenshot-data="itemScreenshot" show-title source="screenshots" :index="index"/>
                    </div>
                    <!-- Link to Playbook entry -->
                    <div v-if="itemScreenshot.name" class="px-2 pb-2 pt-1">
                        <a :href="'/playbook?tradeId=' + encodeURIComponent(itemScreenshot.name)"
                            class="playbook-link-btn">
                            <i class="uil uil-compass me-1"></i>Playbook
                        </a>
                    </div>
                </div>
            </div>
        </div>

        <!-- Load more spinner -->
        <div v-if="spinnerLoadMore" class="d-flex justify-content-center mt-3">
            <div class="spinner-border text-blue" role="status"></div>
        </div>
    </div>
</template>