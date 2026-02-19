import { ref, reactive } from 'vue'

// Diary-spezifischer Zustand (inkrementell aus globals.js ausgelagert).
export const diaries = reactive([])
export const diaryUpdate = reactive({})
export const diaryIdToEdit = ref(null)
export const diaryButton = ref(false)
export const diaryQueryLimit = ref(10)
export const diaryPagination = ref(0)
