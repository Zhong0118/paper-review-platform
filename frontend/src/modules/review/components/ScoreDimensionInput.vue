<script setup lang="ts">
import { computed } from 'vue'
import { REVIEW_SCORE_TEMPLATE } from '@/demo/types'
import type { ReviewDimensionKey } from '@/demo/types'

const props = defineProps<{
  label: string
  max: number
  guide: string
  modelValue: number
  locked: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: number]
  'update:evaluation': [value: string]
}>()

const key = computed<ReviewDimensionKey>(
  () => REVIEW_SCORE_TEMPLATE.find((item) => item.label === props.label)?.key ?? 'topicValue',
)
const hasError = computed(() => {
  const value = props.modelValue
  if (!Number.isFinite(value)) return true
  return value < 0 || value > props.max
})
const errorMessage = computed(() => `分值应在 0–${props.max} 之间（满分 ${props.max}）。`)
</script>

<template>
  <fieldset class="dimension" data-dimension :data-dimension-key="key">
    <legend>
      {{ label }} <small>满分 {{ max }}</small>
    </legend>
    <div class="dimension__score">
      <label class="dimension__score-label">
        <span>分值</span>
        <input
          type="number"
          min="0"
          :max="max"
          :name="key"
          :value="modelValue"
          :disabled="locked"
          aria-describedby="dimension-guide"
          @input="
            emit('update:modelValue', Number(($event.target as HTMLInputElement).value))
          "
        />
      </label>
      <p v-if="hasError" class="dimension__error" data-score-error role="alert">
        {{ errorMessage }}
      </p>
    </div>
    <p class="dimension__guide" data-dimension-guide>{{ guide }}</p>
    <label class="dimension__evaluation">
      <span>可选评价</span>
      <textarea
        rows="2"
        :disabled="locked"
        placeholder="（选填）针对该维度的具体评语"
        @input="
          emit('update:evaluation', ($event.target as HTMLTextAreaElement).value)
        "
      />
    </label>
  </fieldset>
</template>

<style scoped>
.dimension {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 0.45rem 0.75rem;
  margin: 0;
  padding: 0.6rem 0.75rem;
  border: 1px solid #e1e6ea;
  border-radius: 0.35rem;
  background: #fbfcfe;
}

.dimension legend {
  grid-column: 1 / -1;
  padding: 0 0.25rem;
  color: #344652;
  font-size: 0.75rem;
  font-weight: 700;
}

.dimension legend small {
  margin-left: 0.35rem;
  color: #84909a;
  font-size: 0.62rem;
  font-weight: 400;
}

.dimension__score {
  display: grid;
  gap: 0.3rem;
}

.dimension__score-label,
.dimension__evaluation {
  display: grid;
  gap: 0.25rem;
}

.dimension__score-label span,
.dimension__evaluation span {
  color: #71808c;
  font-size: 0.64rem;
}

.dimension input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #cbd4dc;
  border-radius: 0.25rem;
  background: #fff;
  font-family: var(--font-data);
  text-align: right;
}

.dimension textarea {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #cbd4dc;
  border-radius: 0.25rem;
  background: #fff;
  resize: vertical;
  line-height: 1.6;
  font-size: 0.7rem;
}

.dimension__guide {
  margin: 0;
  color: #7a8791;
  font-size: 0.66rem;
  line-height: 1.55;
}

.dimension__error {
  margin: 0;
  color: #b03232;
  font-size: 0.64rem;
}
</style>
