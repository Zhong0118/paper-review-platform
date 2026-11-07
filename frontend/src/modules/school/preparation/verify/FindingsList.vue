<script setup lang="ts">
/**
 * R1 检测发现列表（学校核验 Focus 左栏，v3 §9.1）：按严重程度分组（阻断在前），点击定位到文档页并展开上下文。
 * 报告过期时不展示单项发现（不再对应当前匿名稿）；没有发现时提醒人工通读，不宣称“已匿名”。
 * 展示组件：不调接口；R1 样板与 R2 真实核验台共用。
 */
import { ChevronRight, Eye, Quote } from '@lucide/vue'

import type { SensitiveFinding } from '@/api/sensitiveChecks'
import StatusBadge from '@/components/app/data/StatusBadge.vue'
import { Button } from '@/components/ui/button'

import { findingWhere as where } from './findingSource'

const props = defineProps<{
  findings: SensitiveFinding[]
  stale: boolean
  hasReport: boolean
  openKey: string | null
  viewed: Set<string>
  canQuote: boolean
}>()
const emit = defineEmits<{ locate: [finding: SensitiveFinding, key: string]; quote: [finding: SensitiveFinding] }>()

const keyOf = (f: SensitiveFinding, i: number) => `${f.field}-${f.page_number ?? 'm'}-${i}`
const groups = () =>
  [
    { key: 'BLOCK', label: '阻断', tone: 'danger' as const, note: '身份信息，须在匿名稿中去除', items: props.findings.map((f, i) => ({ f, key: keyOf(f, i) })).filter(({ f }) => f.severity === 'BLOCK') },
    { key: 'WARN', label: '警告', tone: 'warning' as const, note: '人工判断是否指向身份', items: props.findings.map((f, i) => ({ f, key: keyOf(f, i) })).filter(({ f }) => f.severity !== 'BLOCK') },
  ].filter((group) => group.items.length)
</script>

<template>
  <div class="grid gap-4" data-findings>
    <p v-if="stale" class="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">报告已过期，单项发现不再对应当前匿名稿，这里不展示。</p>
    <p v-else-if="!hasReport" class="text-sm text-muted-foreground">当前匿名稿还没有检测报告。</p>
    <p v-else-if="!findings.length" class="text-sm text-muted-foreground">检测器没有发现身份线索。这不代表匿名化一定完整，请人工通读封面、致谢、附录和页眉页脚。</p>

    <section v-for="group in groups()" :key="group.key" class="grid gap-1.5" :aria-labelledby="`fg-${group.key}`">
      <h3 :id="`fg-${group.key}`" class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <StatusBadge :tone="group.tone">{{ group.label }} {{ group.items.length }}</StatusBadge>
        <span class="text-xs text-muted-foreground">{{ group.note }}</span>
      </h3>
      <ul class="grid gap-1">
        <li v-for="{ f, key } in group.items" :key="key">
          <button
            type="button"
            class="group grid w-full grid-cols-[1fr_auto] items-start gap-x-2 rounded-md px-2.5 py-2 text-left hover:bg-muted aria-expanded:bg-muted"
            :aria-expanded="openKey === key"
            :data-finding="key"
            @click="emit('locate', f, key)"
          >
            <span class="tabular text-sm text-muted-foreground">{{ where(f) }}　{{ f.kind === 'SCHOOL_TERM' ? '学校词表' : '身份信息' }}</span>
            <span class="flex items-center gap-1 text-xs text-faint">
              <Eye v-if="viewed.has(key)" class="size-3.5" aria-label="已查看" />
              <ChevronRight class="size-4 transition-transform group-aria-expanded:rotate-90" aria-hidden="true" />
            </span>
            <span class="col-span-2 mt-0.5 font-medium break-all">“{{ f.matched_text }}”</span>
          </button>
          <div v-if="openKey === key" class="mx-2.5 mt-1 mb-2 grid gap-2 border-l-2 border-border-strong pl-3">
            <p v-if="f.context" class="text-sm text-foreground">{{ f.context }}</p>
            <p v-if="f.description" class="text-xs text-muted-foreground">{{ f.description }}</p>
            <Button v-if="canQuote" variant="outline" size="sm" class="justify-self-start" @click="emit('quote', f)"><Quote />写入退回原因</Button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
