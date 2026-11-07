<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ modelValue: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()
const draft = ref('')
const limitError = ref('')

function commitDraft() {
  const additions = draft.value
    .split(/[；;]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean)
  const nextValue = [...new Set([...props.modelValue, ...additions])]
  if (nextValue.length > 5) {
    limitError.value = '最多填写 5 个关键词，请先删除已有关键词。'
    return
  }
  limitError.value = ''
  if (additions.length > 0) emit('update:modelValue', nextValue)
  draft.value = ''
}

function removeKeyword(keyword: string) {
  limitError.value = ''
  emit(
    'update:modelValue',
    props.modelValue.filter((item) => item !== keyword),
  )
}
</script>

<template>
  <div class="keyword-input">
    <label for="keyword-draft">关键词 <small>关键词用于辅助专家匹配，完全重复的词会自动合并。</small></label>
    <div class="keyword-input__box">
      <span v-for="keyword in modelValue" :key="keyword" class="keyword-tag">
        {{ keyword }}
        <button
          type="button"
          :aria-label="`删除关键词 ${keyword}`"
          :data-remove-keyword="keyword"
          @click="removeKeyword(keyword)"
        >
          ×
        </button>
      </span>
      <input
        id="keyword-draft"
        v-model="draft"
        placeholder="输入后按回车或分号"
        @keydown.enter.prevent="commitDraft"
        @blur="commitDraft"
      />
    </div>
    <small v-if="limitError" class="keyword-input__error" role="alert">{{ limitError }}</small>
  </div>
</template>

<style scoped>
.keyword-input {
  display: grid;
  gap: 0.375rem;
}

.keyword-input > label {
  color: #4a5965;
  font-size: 0.75rem;
  font-weight: 650;
}

.keyword-input__box {
  display: flex;
  min-height: 2.625rem;
  flex-wrap: wrap;
  gap: 0.375rem;
  align-items: center;
  padding: 0.375rem;
  border: 1px solid #cbd4dc;
  border-radius: 0.375rem;
  background: #fbfcfe;
}

.keyword-tag {
  display: inline-flex;
  min-height: 1.75rem;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.375rem 0.125rem 0.5rem;
  border: 1px solid #bfd0e1;
  border-radius: 999px;
  background: #e8f0f9;
  color: #123d6b;
  font-size: 0.75rem;
}

.keyword-tag button {
  width: 1.25rem;
  height: 1.25rem;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #536c83;
  cursor: pointer;
}

.keyword-tag button:hover {
  background: #cfdeec;
}

.keyword-input input {
  min-width: 10rem;
  min-height: 1.875rem;
  flex: 1;
  padding: 0 0.375rem;
  border: 0;
  outline: 0;
  background: transparent;
}

.keyword-input small {
  color: #7a8791;
  font-size: 0.6875rem;
}

.keyword-input__error {
  color: #a3342f !important;
}
</style>
