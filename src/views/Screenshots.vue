<script setup>
import { ref, reactive, computed, onBeforeMount, onMounted } from 'vue'
import NoData from '../components/NoData.vue';
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue';
import Screenshot from '../components/Screenshot.vue';
import { spinnerLoadMore, spinnerLoadingPage, expandedScreenshot } from '../stores/ui.js';
import { screenshots } from '../stores/trades.js';
import { useMountScreenshots, useCheckVisibleScreen, useLoadMore } from '../utils/mountOrchestration.js';
import { endOfList } from '../stores/ui.js';
import { sanitizeHtml } from '../utils/sanitize';
import { useI18n } from 'vue-i18n'
const { t } = useI18n()

// Screenshot-Filter: 'alle' | 'entry' | 'closing'
const screenshotFilter = ref('alle')

const filteredScreenshots = computed(() => {
    if (screenshotFilter.value === 'alle') return screenshots
    return screenshots.filter(s => {
        const side = s.side || ''
        const name = s.name || ''
        if (screenshotFilter.value === 'entry') {
            // Eröffnung: B (Long Buy) oder SS (Short Sell), aber NICHT _closing im Namen
            return (side === 'B' || side === 'SS') && !name.includes('_closing')
        } else if (screenshotFilter.value === 'closing') {
            // Abschluss: BC (Buy Cover) oder Name enthält _closing
            return side === 'BC' || name.includes('_closing')
        }
        return true
    })
})


onBeforeMount(async () => {

})

onMounted(async () => {
    await useMountScreenshots()
    window.addEventListener('scroll', () => {
        let scrollFromTop = window.scrollY
        let visibleScreen = (window.innerHeight + 200) // adding 200 so that loads before getting to bottom
        let documentHeight = document.documentElement.scrollHeight
        let difference = documentHeight - (scrollFromTop + visibleScreen)
        if (difference <= 0) {
            if (!spinnerLoadMore.value && !spinnerLoadingPage.value && !endOfList.value && expandedScreenshot.value == null) {
                useLoadMore()
            }
        }
    })
    useCheckVisibleScreen()
})

</script>

<template>
    <SpinnerLoadingPage />
    <div v-show="!spinnerLoadingPage" class="screenshots-grid mt-2 mb-2">

        <!-- Screenshot-Typ Filter -->
        <div class="ss-filter-bar mb-2">
            <button :class="['ss-filter-btn', screenshotFilter === 'alle' && 'active']"
                @click="screenshotFilter = 'alle'">
                {{ t('common.all') }}
            </button>
            <button :class="['ss-filter-btn', screenshotFilter === 'entry' && 'active']"
                @click="screenshotFilter = 'entry'">
                <i class="uil uil-arrow-up-right me-1"></i>{{ t('screenshots.opening') }}
            </button>
            <button :class="['ss-filter-btn', screenshotFilter === 'closing' && 'active']"
                @click="screenshotFilter = 'closing'">
                <i class="uil uil-arrow-down-left me-1"></i>{{ t('screenshots.closing') }}
            </button>
        </div>

        <div v-if="filteredScreenshots.length == 0">
            <NoData />
        </div>
        <div class="row">
            <div v-for="(itemScreenshot, index) in filteredScreenshots" class="col-12 col-md-6 col-xl-4 mt-2">
                <div class="dailyCard" v-bind:id="itemScreenshot.objectId">
                    <div class="row">
                        <Screenshot :screenshot-data="itemScreenshot" show-title source="screenshots" :index="screenshots.indexOf(itemScreenshot)"/>
                    </div>

                    <!-- Playbook Link -->
                    <div v-if="itemScreenshot.name" class="px-2 pb-2 pt-1">
                        <a :href="'/playbook?tradeId=' + encodeURIComponent(itemScreenshot.name)"
                            class="playbook-link-btn">
                            <i class="uil uil-compass me-1"></i>{{ t('nav.playbook') }}
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

<style scoped>
/* Screenshot-Typ Filter */
.ss-filter-bar {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
}

.ss-filter-btn {
    display: inline-flex;
    align-items: center;
    font-size: 0.78rem;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--white-18);
    border-radius: 6px;
    color: var(--white-60);
    background: transparent;
    cursor: pointer;
    transition: all 0.15s;
}

.ss-filter-btn:hover {
    border-color: var(--white-38);
    color: var(--white-87);
}

.ss-filter-btn.active {
    border-color: var(--blue-color, #6cb4ee);
    color: var(--blue-color, #6cb4ee);
    background: rgba(108, 180, 238, 0.1);
}

/* Kompaktere Karten im Screenshots-Grid */
.screenshots-grid :deep(.cardFirstLine) h5 {
    font-size: 0.85rem;
    margin-bottom: 0;
}

.screenshots-grid :deep(.col-12.mt-2 span) {
    font-size: 0.78rem;
}

.screenshots-grid :deep(.imgContainer) {
    max-height: 250px;
    overflow: hidden;
}

.screenshots-grid :deep(.uil) {
    font-size: 0.95rem;
}

</style>
