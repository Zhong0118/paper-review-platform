<script setup lang="ts">
import { ref, watch } from 'vue'
import { saveDeadlines, type ReviewBatch } from '@/api/schoolOperations'
const props = defineProps<{ batch: ReviewBatch }>()
const emit = defineEmits<{ saved: [] }>()
const accept = ref(''),
  review = ref(''),
  error = ref(''),
  busy = ref(false)
watch(
  () => props.batch,
  (b) => {
    accept.value = String(b.accept_days ?? '')
    review.value = String(b.review_days ?? '')
  },
  { immediate: true },
)
async function submit() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await saveDeadlines(
      props.batch.id,
      props.batch.version,
      accept.value === '' ? null : Number(accept.value),
      review.value === '' ? null : Number(review.value),
    )
    emit('saved')
  } catch {
    error.value = '未能保存期限，请刷新批次后重试。'
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <form class="clock" data-batch-deadlines @submit.prevent="submit">
    <label
      >接单自然日数<input
        v-model="accept"
        type="number"
        min="1"
        max="32767"
        step="1"
        placeholder="未配置"
    /></label>
    <label
      >评阅自然日数<input
        v-model="review"
        type="number"
        min="1"
        max="32767"
        step="1"
        placeholder="未配置"
    /></label>
    <button type="submit" :disabled="busy">保存期限</button>
    <small>留空表示不限期。只影响后续派单，逾期仅标记。</small>
    <p v-if="error" role="alert">{{ error }}</p>
  </form>
</template>
<style scoped>
.clock {
  grid-column: 1/-1;
  display: flex;
  gap: 0.8rem;
  align-items: center;
  flex-wrap: wrap;
  padding: 0.8rem;
  background: #f2f6fa;
}
.clock label {
  display: grid;
  gap: 0.25rem;
}
.clock input,
.clock button {
  padding: 0.45rem;
}
.clock button {
  transition: transform 0.15s;
}
.clock button:hover {
  transform: translateY(-1px);
}
</style>
