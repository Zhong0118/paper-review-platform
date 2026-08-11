<script setup lang="ts">
import { computed, ref } from 'vue'

import type { StudentDraftInput, ThesisFileMeta } from '@/demo/types'

import DisciplineSelector from './DisciplineSelector.vue'
import KeywordTagInput from './KeywordTagInput.vue'
import ThesisFileField from './ThesisFileField.vue'

const props = defineProps<{
  modelValue: StudentDraftInput
  identityTokens: string[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: StudentDraftInput] }>()
const root = ref<HTMLElement>()

const originalFile = computed(
  () => props.modelValue.files.find((file) => file.purpose === 'SCHOOL_ARCHIVE') ?? null,
)
const anonymousFile = computed(
  () => props.modelValue.files.find((file) => file.purpose === 'EXPERT_REVIEW') ?? null,
)
const selectedDiscipline = computed(() =>
  props.modelValue.discipline.code ? props.modelValue.discipline : undefined,
)

function updateField<K extends keyof StudentDraftInput>(key: K, value: StudentDraftInput[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function updateFile(purpose: ThesisFileMeta['purpose'], file: ThesisFileMeta | null) {
  const remaining = props.modelValue.files.filter((item) => item.purpose !== purpose)
  updateField('files', file ? [...remaining, file] : remaining)
}

function focusField(
  field: 'title' | 'abstract' | 'discipline' | 'keywords' | 'original' | 'anonymous',
) {
  const selectors = {
    title: 'input[name="title"]',
    abstract: 'textarea[name="abstract"]',
    discipline: '[data-action="open-discipline"]',
    keywords: '#keyword-draft',
    original: '[data-file-purpose="SCHOOL_ARCHIVE"] input[type="file"]',
    anonymous: '[data-file-purpose="EXPERT_REVIEW"] input[type="file"]',
  }
  root.value?.querySelector<HTMLElement>(selectors[field])?.focus()
}

defineExpose({ focusField })
</script>

<template>
  <div ref="root" class="material-editor">
    <section class="material-editor__section">
      <header>
        <span>01</span>
        <h2>论文基本信息</h2>
      </header>
      <div class="material-editor__form">
        <label class="material-editor__wide">
          <span>论文题目</span>
          <input
            name="title"
            :value="modelValue.title"
            @input="updateField('title', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="material-editor__wide">
          <span>论文摘要</span>
          <textarea
            name="abstract"
            rows="6"
            :value="modelValue.abstract"
            @input="updateField('abstract', ($event.target as HTMLTextAreaElement).value)"
          ></textarea>
        </label>
        <DisciplineSelector
          :model-value="selectedDiscipline"
          @update:model-value="updateField('discipline', $event)"
        />
        <KeywordTagInput
          :model-value="modelValue.keywords"
          @update:model-value="updateField('keywords', $event)"
        />
      </div>
    </section>

    <section class="material-editor__section">
      <header>
        <span>02</span>
        <h2>论文材料</h2>
      </header>
      <div class="material-editor__files">
        <div data-file-purpose="SCHOOL_ARCHIVE">
          <ThesisFileField
            label="原始论文（学校侧留存）"
            purpose="SCHOOL_ARCHIVE"
            :model-value="originalFile"
            @update:model-value="updateFile('SCHOOL_ARCHIVE', $event)"
          />
        </div>
        <div data-file-purpose="EXPERT_REVIEW">
          <ThesisFileField
            label="匿名版论文（提供专家评阅）"
            purpose="EXPERT_REVIEW"
            :model-value="anonymousFile"
            :identity-tokens="identityTokens"
            @update:model-value="updateFile('EXPERT_REVIEW', $event)"
          />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.material-editor {
  display: grid;
  gap: 1rem;
}

.material-editor__section {
  border: 1px solid #dce3e9;
  background: white;
}

.material-editor__section > header {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  padding: 0.875rem 1rem;
  border-bottom: 1px solid #e5eaee;
}

.material-editor__section > header span {
  color: #5b6b7a;
  font-family: var(--font-data);
  font-size: 0.6875rem;
}

.material-editor__section h2 {
  margin: 0;
  color: #263744;
  font-family: var(--font-display);
  font-size: 1rem;
}

.material-editor__form,
.material-editor__files {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  padding: 1rem;
}

.material-editor__wide {
  grid-column: 1 / -1;
}

.material-editor__form label,
.material-editor__form label span {
  display: grid;
  gap: 0.375rem;
}

.material-editor__form label span {
  color: #4a5965;
  font-size: 0.75rem;
  font-weight: 650;
}

.material-editor__form input,
.material-editor__form textarea {
  padding: 0.65rem 0.75rem;
  border: 1px solid #cbd4dc;
  border-radius: 0.375rem;
  background: #fbfcfe;
  color: #293946;
  font: inherit;
}

.material-editor__form textarea {
  resize: vertical;
}

@media (max-width: 760px) {
  .material-editor__form,
  .material-editor__files {
    grid-template-columns: 1fr;
  }
}
</style>
