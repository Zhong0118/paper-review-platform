<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useAttrs, useId, watch } from 'vue'

import { searchDisciplines } from '../data/disciplineCatalog'
import type { DisciplineOption } from '../types'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  modelValue?: DisciplineOption
  /** Kept optional while existing callers migrate from their local demo lists. */
  options?: DisciplineOption[]
}>()

const emit = defineEmits<{ 'update:modelValue': [value: DisciplineOption] }>()
const attrs = useAttrs()
const instanceId = useId()
const controlId = computed(() =>
  typeof attrs.id === 'string' ? attrs.id : `${instanceId}-discipline-control`,
)
const listboxId = `${instanceId}-discipline-listbox`
const root = ref<HTMLElement>()
const control = ref<HTMLButtonElement>()
const searchInput = ref<HTMLInputElement>()
const query = ref('')
const open = ref(false)
const activeIndex = ref(-1)
const placement = ref<'top' | 'bottom'>('bottom')

const filteredOptions = computed(() => props.options === undefined
  ? searchDisciplines(query.value)
  : props.options.filter(item => `${item.code} ${item.name}`.toLowerCase().includes(query.value.trim().toLowerCase())))
const activeOption = computed(() => filteredOptions.value[activeIndex.value])
const activeDescendant = computed(() =>
  activeOption.value ? optionId(activeOption.value.code) : undefined,
)

watch(query, () => {
  activeIndex.value = -1
})

function optionId(code: string) {
  return `${instanceId}-discipline-${code}`
}

function updatePlacement() {
  if (!control.value) return
  const rect = control.value.getBoundingClientRect()
  const spaceAbove = rect.top
  const spaceBelow = window.innerHeight - rect.bottom
  placement.value = spaceBelow >= 360 || spaceBelow >= spaceAbove ? 'bottom' : 'top'
}

async function openSelector() {
  open.value = true
  activeIndex.value = -1
  await nextTick()
  updatePlacement()
  searchInput.value?.focus()
}

async function closeSelector(restoreFocus = true) {
  if (!open.value) return
  open.value = false
  query.value = ''
  activeIndex.value = -1
  if (restoreFocus) {
    await nextTick()
    control.value?.focus()
  }
}

function toggleSelector() {
  if (open.value) {
    void closeSelector(false)
  } else {
    void openSelector()
  }
}

function selectDiscipline(option: DisciplineOption) {
  emit('update:modelValue', { code: option.code, name: option.name })
  void closeSelector()
}

function moveActive(offset: 1 | -1) {
  const count = filteredOptions.value.length
  if (count === 0) return
  activeIndex.value =
    activeIndex.value === -1
      ? offset === 1
        ? 0
        : count - 1
      : (activeIndex.value + offset + count) % count
  void nextTick(() => {
    document
      .getElementById(optionId(activeOption.value?.code ?? ''))
      ?.scrollIntoView?.({ block: 'nearest' })
  })
}

function handleSearchKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    void closeSelector()
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    moveActive(event.key === 'ArrowDown' ? 1 : -1)
    return
  }
  if (event.key === 'Enter' && activeOption.value) {
    event.preventDefault()
    selectDiscipline(activeOption.value)
  }
}

function handleDocumentClick(event: MouseEvent) {
  if (open.value && event.target instanceof Node && !root.value?.contains(event.target)) {
    void closeSelector()
  }
}

onMounted(() => {
  document.addEventListener('click', handleDocumentClick)
  window.addEventListener('resize', updatePlacement)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick)
  window.removeEventListener('resize', updatePlacement)
})
</script>

<template>
  <div ref="root" class="discipline-selector" :class="{ 'is-open': open }">
    <label :for="controlId"
      >学科专业　<small>按代码或名称搜索，请选择与论文研究内容最匹配的送审专业。</small></label
    >
    <button
      :id="controlId"
      ref="control"
      type="button"
      class="discipline-selector__control"
      data-action="open-discipline"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :aria-controls="open ? listboxId : undefined"
      @click="toggleSelector"
    >
      <span v-if="modelValue">
        <code>{{ modelValue.code }}</code>
        {{ modelValue.name }}
      </span>
      <span v-else class="discipline-selector__placeholder">请选择专业代码与名称</span>
      <b aria-hidden="true">⌄</b>
    </button>

    <p v-if="options !== undefined && modelValue && !options.some(item => item.code === modelValue?.code)">已保存的历史学科，当前不可新选；提交前请核对学校开放范围。</p>
    <div v-if="open" class="discipline-selector__popover" :data-placement="placement">
      <input
        ref="searchInput"
        v-model="query"
        type="search"
        placeholder="搜索专业代码或名称"
        aria-label="搜索专业代码或名称"
        autocomplete="off"
        :aria-controls="listboxId"
        :aria-activedescendant="activeDescendant"
        @keydown="handleSearchKeydown"
      />
      <div
        :id="listboxId"
        class="discipline-selector__options"
        role="listbox"
        aria-label="专业目录"
      >
        <button
          v-for="(option, index) in filteredOptions"
          :id="optionId(option.code)"
          :key="option.code"
          type="button"
          role="option"
          :aria-selected="modelValue?.code === option.code"
          :class="{ 'is-active': activeIndex === index }"
          :data-discipline="option.code"
          @mouseenter="activeIndex = index"
          @click="selectDiscipline(option)"
        >
          <code>{{ option.code }}</code>
          <span>{{ option.name }}</span>
        </button>
        <p v-if="filteredOptions.length === 0" data-empty="discipline">没有匹配的专业</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.discipline-selector {
  position: relative;
  display: grid;
  gap: 0.375rem;
  min-width: 0;
}

.discipline-selector > label {
  color: #4a5965;
  font-size: 0.75rem;
  font-weight: 650;
  line-height: 1.5;
}

.discipline-selector small {
  color: #7a8791;
  font-size: 0.6875rem;
}


.discipline-selector__control {
  display: flex;
  min-height: 2.625rem;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.75rem;
  border: 1px solid #cbd4dc;
  border-radius: 0.375rem;
  background: #fbfcfe;
  color: #33414d;
  text-align: left;
  cursor: pointer;
}

.discipline-selector.is-open .discipline-selector__control {
  border-color: #1b4f8a;
  box-shadow: 0 0 0 2px rgb(27 79 138 / 0.12);
}

.discipline-selector__control code,
.discipline-selector__options code {
  margin-right: 0.5rem;
  color: #1b4f8a;
  font-family: var(--font-data);
  font-size: 0.75rem;
}

.discipline-selector__placeholder {
  color: #88949e;
}

.discipline-selector__popover {
  position: absolute;
  z-index: 30;
  inset-inline: 0;
  display: grid;
  gap: 0.375rem;
  padding: 0.5rem;
  border: 1px solid #cbd4dc;
  background: white;
  box-shadow: 0 0.75rem 2rem rgb(31 55 76 / 0.18);
}

.discipline-selector__popover[data-placement='bottom'] {
  top: calc(100% + 0.375rem);
}

.discipline-selector__popover[data-placement='top'] {
  bottom: calc(100% + 0.375rem);
}

.discipline-selector__popover input {
  height: 2.375rem;
  padding: 0 0.625rem;
  border: 1px solid #d6dee5;
  border-radius: 0.25rem;
}

.discipline-selector__options {
  display: grid;
  max-height: 18rem;
  overflow-y: auto;
}

.discipline-selector__options button {
  display: flex;
  min-height: 2.5rem;
  align-items: center;
  padding: 0.5rem 0.625rem;
  border: 0;
  border-bottom: 1px solid #edf0f3;
  background: white;
  color: #33414d;
  text-align: left;
  cursor: pointer;
}

.discipline-selector__options button:hover,
.discipline-selector__options button.is-active,
.discipline-selector__options button[aria-selected='true'] {
  background: #edf3f9;
}

.discipline-selector__options p {
  margin: 0;
  padding: 0.75rem;
  color: #7a8791;
  font-size: 0.75rem;
}

@media (max-width: 640px) {
  .discipline-selector__popover,
  .discipline-selector__popover[data-placement='top'],
  .discipline-selector__popover[data-placement='bottom'] {
    position: fixed;
    inset: auto 0 0;
    max-height: 70vh;
    padding: 0.75rem;
    border-radius: 0.75rem 0.75rem 0 0;
    box-shadow: 0 -1rem 3rem rgb(31 55 76 / 0.2);
  }

  .discipline-selector__options {
    max-height: calc(70vh - 4.5rem);
  }
}
</style>
