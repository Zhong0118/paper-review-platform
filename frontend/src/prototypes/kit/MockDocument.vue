<script setup lang="ts">
/**
 * 虚构 PDF 阅读器：受控材料的页码、缩放与页级定位。
 * 只做页级高亮（整页描边），不伪造文字坐标高亮——当前检测只提供 page_number。
 */
import { computed, nextTick, ref, watch } from 'vue'

import type { MockPage } from './types'

const props = defineProps<{
  pages: MockPage[]
  label: string
  highlightPages?: number[]
  focusPage?: number | null
}>()
const emit = defineEmits<{ page: [number] }>()
const zoom = ref(100)
const current = ref(1)
const scroller = ref<HTMLElement | null>(null)
const total = computed(() => props.pages.length)

function goto(page: number) {
  const target = Math.min(Math.max(page, 1), total.value)
  current.value = target
  emit('page', target)
  const el = scroller.value?.querySelector<HTMLElement>(`[data-page="${target}"]`)
  if (el && scroller.value) scroller.value.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' })
}
watch(
  () => props.focusPage,
  async (page) => {
    if (!page) return
    await nextTick()
    goto(page)
  },
)
function onScroll() {
  const box = scroller.value
  if (!box) return
  const pages = Array.from(box.querySelectorAll<HTMLElement>('[data-page]'))
  const mid = box.scrollTop + box.clientHeight / 3
  const hit = [...pages].reverse().find((el) => el.offsetTop <= mid)
  if (hit) current.value = Number(hit.dataset.page)
}
defineExpose({ goto })
</script>

<template>
  <div class="doc">
    <div class="doc__tools" role="toolbar" :aria-label="`${label}阅读工具`">
      <span class="doc__label">{{ label }}</span>
      <div class="doc__pager">
        <button type="button" class="btn btn--sm btn--quiet" aria-label="上一页" :disabled="current <= 1" @click="goto(current - 1)">‹</button>
        <label class="doc__page">
          <span class="sr-only">页码</span>
          <input :value="current" class="input num" inputmode="numeric" @change="goto(Number(($event.target as HTMLInputElement).value))" />
          <span class="muted num">/ {{ total }}</span>
        </label>
        <button type="button" class="btn btn--sm btn--quiet" aria-label="下一页" :disabled="current >= total" @click="goto(current + 1)">›</button>
      </div>
      <div class="doc__zoom">
        <button type="button" class="btn btn--sm btn--quiet" aria-label="缩小" :disabled="zoom <= 70" @click="zoom -= 10">−</button>
        <span class="num">{{ zoom }}%</span>
        <button type="button" class="btn btn--sm btn--quiet" aria-label="放大" :disabled="zoom >= 150" @click="zoom += 10">+</button>
      </div>
    </div>
    <div ref="scroller" class="doc__scroll" tabindex="0" :aria-label="`${label}正文`" @scroll.passive="onScroll">
      <article
        v-for="(page, index) in pages"
        :key="index"
        class="doc__sheet"
        :class="{ 'doc__sheet--hit': highlightPages?.includes(index + 1) }"
        :data-page="index + 1"
        :style="{ width: `${(zoom / 100) * 620}px` }"
      >
        <p v-if="highlightPages?.includes(index + 1)" class="doc__hit">本页有发现项（页级定位）</p>
        <h3 v-if="page.heading" class="doc__heading">{{ page.heading }}</h3>
        <p v-for="(line, li) in page.lines" :key="li" class="doc__line">{{ line }}</p>
        <footer class="doc__folio num">{{ index + 1 }}</footer>
      </article>
    </div>
  </div>
</template>

<style scoped>
.doc {
  display: grid;
  grid-template-rows: 44px minmax(0, 1fr);
  height: 100%;
  background: #e9ecf0;
}
.doc__tools {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  border-bottom: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.doc__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.doc__pager,
.doc__zoom {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
}
.doc__page {
  display: flex;
  align-items: center;
  gap: 4px;
}
.doc__page .input {
  width: 44px;
  min-height: 28px;
  padding: 2px 6px;
  text-align: center;
}
.doc__scroll {
  position: relative;
  overflow: auto;
  padding: 16px;
}
.doc__sheet {
  position: relative;
  max-width: 100%;
  aspect-ratio: 1 / 1.414;
  margin: 0 auto 16px;
  padding: 7% 9%;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 1px 3px rgb(23 32 42 / 0.12);
  color: #2a2f36;
  font-family: var(--ws-font-reading);
  font-size: 12.5px;
  line-height: 1.9;
}
.doc__sheet--hit {
  outline: 3px solid var(--ws-warning);
  outline-offset: 0;
}
.doc__hit {
  position: absolute;
  top: 0;
  right: 0;
  padding: 2px 8px;
  background: var(--ws-warning);
  color: #fff;
  font-family: var(--ws-font);
  font-size: 11px;
}
.doc__heading {
  margin-bottom: 10px;
  font-size: 15px;
  font-weight: 700;
  text-align: center;
}
.doc__line {
  text-indent: 2em;
}
.doc__folio {
  position: absolute;
  right: 0;
  bottom: 3%;
  left: 0;
  color: #8a9099;
  font-family: var(--ws-font);
  font-size: 11px;
  text-align: center;
}
</style>
