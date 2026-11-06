<script setup lang="ts">
/**
 * 样板用的论文页（代替真实 PDF iframe）：只画版面骨架和命中位置，文字均为虚构。
 * 真实核验台仍用受控 PDF 呈现（文件接口 + #page 跳页），R2 只换外围布局。
 */
import { ref } from 'vue'

export interface PaperMark {
  key: string
  page: number
  text: string
  severity: 'WARN' | 'BLOCK'
}
const props = defineProps<{ pages: number; kind: 'anonymous' | 'original'; marks: PaperMark[]; focusKey: string | null; label: string }>()
const root = ref<HTMLElement | null>(null)

function scrollToPage(page: number) {
  root.value?.querySelector<HTMLElement>(`[data-page="${page}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}
defineExpose({ scrollToPage })

const widths = [92, 100, 96, 88, 100, 74, 97, 100, 90, 66]
const marksOn = (page: number) => props.marks.filter((mark) => mark.page === page)
</script>

<template>
  <div ref="root" class="h-full overflow-y-auto bg-muted/70 px-4 py-5" :aria-label="label" tabindex="0" data-paper>
    <div class="mx-auto grid max-w-[720px] gap-4">
      <article
        v-for="page in pages"
        :key="page"
        :data-page="page"
        class="relative aspect-[1/1.414] w-full scroll-mt-4 rounded-sm bg-background px-[9%] py-[10%] shadow-[0_0_0_1px_var(--border)]"
      >
        <p v-if="page === 1" class="mb-[6%] text-center text-lg font-semibold text-foreground">面向多源异构日志的软件缺陷定位方法研究</p>
        <div v-if="page === 1" class="mb-[8%] grid justify-items-center gap-1 text-sm text-muted-foreground">
          <span v-if="kind === 'original'">作者：<mark :class="['rounded-sm px-0.5', focusKey && marksOn(1).some((m) => m.key === focusKey) ? 'bg-destructive/25 ring-2 ring-destructive' : 'bg-destructive-soft']">学生（样板）</mark>　指导教师：导师（样板）</span>
          <span v-else-if="!marksOn(1).length">作者与指导教师信息已去除</span>
        </div>
        <div class="grid gap-[2.2%]">
          <span v-for="(w, i) in widths" :key="i" class="h-[1.1%] min-h-[5px] rounded-full bg-muted" :style="{ width: `${w}%` }" />
        </div>
        <div v-if="kind === 'anonymous' && marksOn(page).length" class="mt-[5%] grid gap-2 text-sm">
          <p v-for="mark in marksOn(page)" :key="mark.key" class="text-muted-foreground">
            ……
            <mark
              :class="[
                'rounded-sm px-0.5 text-foreground',
                mark.severity === 'BLOCK' ? 'bg-destructive-soft' : 'bg-warning-soft',
                focusKey === mark.key && (mark.severity === 'BLOCK' ? 'ring-2 ring-destructive' : 'ring-2 ring-warning'),
              ]"
              :data-mark="mark.key"
              >{{ mark.text }}</mark
            >
            ……
          </p>
        </div>
        <span class="tabular absolute right-0 bottom-[3%] left-0 text-center text-xs text-faint">{{ page }}</span>
      </article>
    </div>
  </div>
</template>
