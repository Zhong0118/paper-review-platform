<script setup lang="ts">
/**
 * R1 专家档案预览（参考 Attio 记录预览：属性“键—值”两列，分组；完整档案另开）。
 * 只读：资格、服务、编辑等命令在完整档案里做。预览不是强制中间步骤。
 */
import { ExternalLink } from '@lucide/vue'
import { computed } from 'vue'

import type { ExpertOptions, ExpertRecord } from '@/api/expertOperations'
import StatusBadge from '@/components/app/data/StatusBadge.vue'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'

import { accountActive, availability, qualificationText, serviceText } from './expertView'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ expert: ExpertRecord | null; options: ExpertOptions }>()
const emit = defineEmits<{ openFull: [row: ExpertRecord] }>()

const tri = (value: boolean | null) => (value === null ? '未知（档案未填写）' : value ? '是' : '否')
const school = (id: string) => props.options.schools.find((s) => s.id === id)?.name ?? '学校已不可见'
const disciplines = computed(() => (props.expert?.discipline_codes ?? []).map((code) => ({ code, name: props.options.disciplines.find((d) => d.code === code)?.name ?? code })))
const state = computed(() => (props.expert ? availability(props.expert) : null))
</script>

<template>
  <Sheet v-model:open="open">
    <SheetContent side="right" class="w-full gap-0 p-0 sm:max-w-[440px]" data-expert-preview>
      <template v-if="expert">
        <SheetHeader class="gap-1 border-b px-5 pt-5 pb-4">
          <SheetTitle class="pr-8 text-lg font-semibold">{{ expert.display_name }}</SheetTitle>
          <SheetDescription class="text-sm text-muted-foreground">{{ expert.title || '职称未填' }}　{{ expert.unit || '单位未填' }}</SheetDescription>
          <p v-if="state" class="mt-2 flex items-start gap-2 text-sm" data-availability>
            <StatusBadge :tone="state.tone === 'success' ? 'success' : 'warning'">{{ state.tone === 'success' ? '可指派' : '暂不可派' }}</StatusBadge>
            <span class="text-muted-foreground">{{ state.text }}</span>
          </p>
        </SheetHeader>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <section class="grid gap-2" aria-labelledby="pv-basic">
            <h3 id="pv-basic" class="text-sm font-medium text-muted-foreground">档案</h3>
            <dl class="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2.5 text-base">
              <dt class="text-muted-foreground">账号</dt>
              <dd class="tabular">{{ expert.username }}<span v-if="!accountActive(expert)" class="ml-2 text-sm text-warning">已停用</span></dd>
              <dt class="text-muted-foreground">省份</dt>
              <dd>{{ expert.province_name || '未填' }}</dd>
              <dt class="text-muted-foreground">学科</dt>
              <dd class="flex flex-wrap gap-1">
                <StatusBadge v-for="d in disciplines" :key="d.code">{{ d.name }}</StatusBadge>
                <span v-if="!disciplines.length" class="text-faint">未填</span>
              </dd>
              <dt class="text-muted-foreground">博士生导师</dt>
              <dd>{{ tri(expert.doctoral_supervisor) }}</dd>
              <dt class="text-muted-foreground">硕士生导师</dt>
              <dd>{{ tri(expert.masters_supervisor) }}</dd>
              <dt class="text-muted-foreground">研究方向</dt>
              <dd>{{ expert.research_directions.join('；') || '未填' }}</dd>
              <dt class="text-muted-foreground">关键词</dt>
              <dd>{{ expert.keywords.join('；') || '未填' }}</dd>
            </dl>
          </section>

          <section class="mt-6 grid gap-2" aria-labelledby="pv-state">
            <h3 id="pv-state" class="text-sm font-medium text-muted-foreground">资格与服务</h3>
            <dl class="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2.5 text-base">
              <dt class="text-muted-foreground">资格</dt>
              <dd>{{ qualificationText[expert.qualification_status] }}</dd>
              <dt class="text-muted-foreground">接单</dt>
              <dd>{{ serviceText[expert.service_status] }}</dd>
            </dl>
          </section>

          <section class="mt-6 grid gap-2" aria-labelledby="pv-conflicts">
            <h3 id="pv-conflicts" class="text-sm font-medium text-muted-foreground">回避 <span class="tabular">{{ expert.conflicts.length }}</span></h3>
            <ul v-if="expert.conflicts.length" class="grid gap-1.5 text-base">
              <li v-for="(c, i) in expert.conflicts" :key="i">
                <span class="text-muted-foreground">{{ c.kind === 'TENANT_ID' ? '学校' : '导师姓名' }}　</span>{{ c.kind === 'TENANT_ID' ? school(c.value) : c.value }}
              </li>
            </ul>
            <p v-else class="text-sm text-faint">没有登记回避对象。</p>
          </section>

          <section class="mt-6 grid gap-2" aria-labelledby="pv-source">
            <h3 id="pv-source" class="text-sm font-medium text-muted-foreground">来源记录</h3>
            <p v-if="expert.source_url || expert.source_note" class="text-base">
              {{ expert.source_note || '未写说明' }}
              <a v-if="expert.source_url" :href="expert.source_url" target="_blank" rel="noopener noreferrer" class="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline">打开<ExternalLink class="size-3.5" /></a>
            </p>
            <p v-else class="text-sm text-faint">没有来源记录。</p>
          </section>
        </div>

        <SheetFooter class="flex-row justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" @click="open = false">关闭</Button>
          <Button data-action="open-full" @click="emit('openFull', expert)">打开完整档案</Button>
        </SheetFooter>
      </template>
    </SheetContent>
  </Sheet>
</template>
