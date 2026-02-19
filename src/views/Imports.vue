<script setup>
import { onBeforeMount, ref } from 'vue';
import { selectedItem } from '../stores/ui.js';
import { imports } from '../stores/trades.js';
import { useDateCalFormat } from '../utils/formatters.js';
import { useInitPopover } from '../utils/utils';
import { useGetTrades } from '../utils/trades';

onBeforeMount(async () => {
    await useGetTrades()
    await useInitPopover()
})

</script>
<template>
    <div class="row mt-2">
        <div>
            <p>Sei vorsichtig beim Löschen von Importen, besonders beim Swing Trading, da dies zu unerwartetem Verhalten führen kann.</p>
            <p>Beim Löschen eines Imports werden auch die Exkursionen gelöscht. Screenshots, Tags, Notizen und Zufriedenheitsbewertungen bleiben erhalten.</p>
            <table class="table">
                <thead>
                </thead>
                <tbody>
                    <tr v-for="(data, index) in imports">
                        <td>{{ useDateCalFormat(data.dateUnix) }}</td>
                        <td class="text-end">
                            <i :id="data.dateUnix" v-on:click="selectedItem = data.dateUnix"
                                class="ps-2 uil uil-trash-alt popoverDelete pointerClass" data-bs-html="true"
                                data-bs-content="<div>Bist du sicher?</div><div class='text-center'><a type='button' class='btn btn-red btn-sm popoverYes'>Ja</a><a type='button' class='btn btn-outline-secondary btn-sm ms-2 popoverNo'>Nein</a></div>"
                                data-bs-toggle="popover" data-bs-placement="left"></i>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
