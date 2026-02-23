<script setup>
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>
<template>
    <div class="text-center col-12 dailyCard">
        <div>{{ t('common.noData') }}</div>
    </div>
</template>
