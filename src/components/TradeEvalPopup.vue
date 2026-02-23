<template>
    <div class="modal fade" id="evalPopupModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-sm">
            <div class="modal-content">

                <!-- Header -->
                <div class="modal-header border-bottom-0 pb-1">
                    <h5 class="modal-title">
                        <i class="uil uil-bell me-2"></i>{{ t('incoming.newTradeEvals') }}
                    </h5>
                    <button type="button" class="btn-close btn-close-white" @click="dismissPopup"
                        :aria-label="t('common.close')"></button>
                </div>

                <!-- Body -->
                <div class="modal-body pt-1">
                    <div class="eval-counts">
                        <div v-if="pendingOpeningCount > 0" class="d-flex align-items-center mb-2">
                            <span class="eval-dot eval-dot-opening me-2"></span>
                            <span>{{ pendingOpeningCount }} {{ pendingOpeningCount > 1 ? t('incoming.openingEvaluations') : t('incoming.openingEvaluation') }}</span>
                        </div>
                        <div v-if="pendingClosingCount > 0" class="d-flex align-items-center mb-2">
                            <span class="eval-dot eval-dot-closing me-2"></span>
                            <span>{{ pendingClosingCount }} {{ t('incoming.closingEvaluation') }}</span>
                        </div>
                    </div>
                </div>

                <!-- Footer -->
                <div class="modal-footer border-top-0 pt-0">
                    <button type="button" class="btn btn-primary btn-sm w-100" @click="goToIncoming">
                        <i class="uil uil-arrow-circle-down me-1"></i>{{ t('incoming.goToPendingTrades') }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { watch, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { pendingOpeningCount, pendingClosingCount, evalNotificationShown, evalNotificationDismissed } from '../stores/trades.js'

const { t } = useI18n()
const router = useRouter()
let modalInstance = null

onMounted(() => {
    modalInstance = new bootstrap.Modal('#evalPopupModal')

    // When modal is hidden externally (e.g., backdrop click), mark as dismissed
    document.getElementById('evalPopupModal').addEventListener('hidden.bs.modal', () => {
        evalNotificationDismissed.value = true
    })

    // If notification already pending on mount, show it
    if (evalNotificationShown.value && !evalNotificationDismissed.value && (pendingOpeningCount.value > 0 || pendingClosingCount.value > 0)) {
        nextTick(() => {
            if (modalInstance) modalInstance.show()
        })
    }
})

// Watch for notification flag changes
watch(evalNotificationShown, (shown) => {
    if (shown && !evalNotificationDismissed.value && modalInstance) {
        nextTick(() => {
            modalInstance.show()
        })
    }
})

function dismissPopup() {
    evalNotificationDismissed.value = true
    if (modalInstance) modalInstance.hide()
}

function goToIncoming() {
    evalNotificationDismissed.value = true
    if (modalInstance) modalInstance.hide()
    router.push('/incoming')
}
</script>

<style scoped>
.eval-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
}

.eval-dot-opening {
    background-color: var(--blue-color, #4a9eff);
}

.eval-dot-closing {
    background-color: #f0ad4e;
}

.eval-counts {
    font-size: 0.95rem;
}
</style>
