<script setup>
import { onBeforeMount, ref } from 'vue';
import { selectedItem } from '../stores/ui.js';
import { imports } from '../stores/trades.js';
import { useDateCalFormat } from '../utils/formatters.js';
import { useInitPopover } from '../utils/utils';
import { useGetTrades } from '../utils/trades';
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

onBeforeMount(async () => {
    await useGetTrades()
    await useInitPopover()
})

</script>
<template>
    <div class="row mt-2">
        <div>
            <p>{{ t('imports.deleteCareful') }}</p>
            <p>{{ t('imports.deleteWarning') }}</p>
            <table class="table">
                <thead>
                </thead>
                <tbody>
                    <tr v-for="(data, index) in imports">
                        <td>{{ useDateCalFormat(data.dateUnix) }}</td>
                        <td class="text-end">
                            <i :id="data.dateUnix" v-on:click="selectedItem = data.dateUnix"
                                class="ps-2 uil uil-trash-alt popoverDelete pointerClass" data-bs-html="true"
                                :data-bs-content="'<div>' + t('common.areYouSure') + '</div><div class=\'text-center\'><a type=\'button\' class=\'btn btn-red btn-sm popoverYes\'>' + t('common.yes') + '</a><a type=\'button\' class=\'btn btn-outline-secondary btn-sm ms-2 popoverNo\'>' + t('common.no') + '</a></div>'"
                                data-bs-toggle="popover" data-bs-placement="left"></i>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
