<script setup>
import SideMenu from '../components/SideMenu.vue'
import Nav from '../components/Nav.vue'
import Screenshot from '../components/Screenshot.vue'
import ReturnToTopButton from '../components/ReturnToTopButton.vue'
import TradeEvalPopup from '../components/TradeEvalPopup.vue'
import { onBeforeMount, onMounted, onUnmounted, watch } from 'vue'
import { useCreatedDateFormat, useTimeFormat, useHourMinuteFormat } from '../utils/formatters.js'
import { useInitParse, usePageId, useScreenType, useGetTimeZone, useGetPeriods, useSetValues } from '../utils/utils.js'
import { screenType, sideMenuMobileOut, pageId, selectedScreenshotIndex } from '../stores/ui.js'
import { getMore } from '../stores/filters.js'
import { screenshots, selectedScreenshot, screenshot } from '../stores/trades.js'
import { currentUser, aiReportGenerating, aiReportCountBefore, aiReportLabel } from '../stores/settings.js'
import { useSelectedScreenshotFunction } from '../utils/screenshots'
import { useUpdatePendingCounts, useStartGlobalPolling, useStopGlobalPolling } from '../utils/incoming.js'
import { useGetAvailableTags } from '../utils/daily.js'
import { requestNotificationPermission, sendNotification } from '../utils/notify'
import { logWarn } from '../utils/logger.js'
import axios from 'axios'

/*========================================
  Functions used on all Dashboard components
========================================*/
onBeforeMount(async () => {
  usePageId()
  await useInitParse()
  useGetTimeZone()
  await useGetPeriods()
  await useSetValues()
  useScreenType()

  // Load available tags for evaluation popup
  await useGetAvailableTags()

  // Update pending evaluation counters and start polling
  // This runs after currentUser is loaded, so showTradePopups check works.
  // TradeEvalPopup watches evalNotificationShown and shows popup when counts > 0.
  // Request notification permission if enabled
  if (currentUser.value?.browserNotifications !== 0) {
    requestNotificationPermission()
  }

  if (currentUser.value?.showTradePopups !== 0) {
    console.log(' -> Dashboard: updating pending evaluation counts')
    await useUpdatePendingCounts()
    useStartGlobalPolling()
  }
})

onMounted(() => {
  // Nothing needed here — evaluation restore happens in onBeforeMount
  // after currentUser is loaded. TradeEvalPopup handles queue via watcher + onMounted check.
})

onUnmounted(() => {
  useStopGlobalPolling()
})

// KI-Bericht Polling: Wenn ein Bericht generiert wird und der User NICHT auf der KI-Agent-Seite ist,
// pollen wir ob der Server den Bericht schon gespeichert hat und senden eine Benachrichtigung.
// Wir watchen BEIDE Refs: aiReportGenerating UND pageId — damit das Polling auch startet,
// wenn der User erst nach dem Start des Berichts die Seite wechselt.
let aiPollInterval = null
let lastAiPollErrorTs = 0
watch([aiReportGenerating, pageId], ([generating, page]) => {
  if (generating && page !== 'kiAgent') {
    // Polling starten (falls noch nicht aktiv)
    if (!aiPollInterval) {
      aiPollInterval = setInterval(async () => {
        try {
          const res = await axios.get('/api/ai/reports')
          if (res.data.length > aiReportCountBefore.value) {
            // Neuer Report gefunden — Benachrichtigung senden und Polling stoppen
            sendNotification('KI-Bericht fertig', `Bericht für ${aiReportLabel.value || 'Zeitraum'} wurde erstellt.`)
            aiReportGenerating.value = false
            clearInterval(aiPollInterval)
            aiPollInterval = null
          }
        } catch (e) {
          // Throttle logging to avoid console spam during temporary outages
          const now = Date.now()
          if (now - lastAiPollErrorTs > 15000) {
            logWarn('dashboard-layout', 'KI-Report-Polling fehlgeschlagen', e)
            lastAiPollErrorTs = now
          }
        }
      }, 5000)
    }
  } else if (!generating && aiPollInterval) {
    clearInterval(aiPollInterval)
    aiPollInterval = null
  }
})
</script>
<template>
  <ReturnToTopButton />
  <div v-cloak class="container-fluid g-0">
    <div class="row g-0">
      <div id="sideMenu" v-bind:class="'min-vh-100 ' +
        (screenType == 'computer' ? 'sideMenu col-2' : 'sideMenuMobile')
        ">
        <SideMenu />
      </div>
      <div class="col-12 col-lg-10 position-relative">
        <div v-show="sideMenuMobileOut" class="sideMenuMobileOut position-absolute" v-on:click="toggleMobileMenu"></div>
        <Nav />
        <main>
          <slot />
        </main>
      </div>
      <!--footer-->
    </div>
  </div>
  <!-- Modal -->
  <div class="modal fade" id="fullScreenModal" tabindex="-1" aria-labelledby="fullScreenModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-fullscreen">
      <div class="modal-content">
        <div class="modal-body">
          <Screenshot v-if="Object.keys(selectedScreenshot).length > 0" :index="selectedScreenshotIndex" source="fullScreen" :screenshot-data="selectedScreenshot" />
        </div>
        <div class="modal-footer">
          <!-- NEXT / PREVIOUS -->
          
            <div class="text-start">
              <button v-if="selectedScreenshotIndex - 1 >= 0" class="btn btn-outline-primary btn-sm ms-3 mb-2"
                v-on:click="useSelectedScreenshotFunction((selectedScreenshotIndex - 1), 'fullScreen')">
                <i class="fa fa-chevron-left me-2"></i></button>
            </div>
            <div v-if="selectedScreenshotIndex + 1 > 0 && screenshots[selectedScreenshotIndex + 1]"
              class="ms-auto text-end">
              <button class="btn btn-outline-primary btn-sm me-3 mb-2"
                v-on:click="useSelectedScreenshotFunction((selectedScreenshotIndex + 1), 'fullScreen')"
                :disabled="getMore"><span v-if="!getMore"><i class="fa fa-chevron-right ms-2"></i></span>
                <span v-else>
                  <div class="spinner-border spinner-border-sm" role="status">
                  </div>
                </span>
              </button>
            </div>
          
        </div>
      </div>
    </div>
  </div>
  <!-- Trade Evaluation Popup -->
  <TradeEvalPopup />
</template>