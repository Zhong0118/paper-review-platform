<script setup lang="ts">
/**
 * R1 样板三：学生正式反馈（reading 模板，居中 840，v3 §9.3）。不是后台表格，也不是成绩仪表盘：
 * 结论与总分一行带过，正文按阅读排版；异议入口默认收起，展开后先说明规则，再进入填写。
 * 快照经真实的 readPublished 解读（v1 / v2 修改建议差异、更正状态都按真实规则显示）。虚构数据，不调用接口。
 */
import { ChevronDown, MessageSquareWarning } from '@lucide/vue'
import { computed, ref } from 'vue'

import AppShell from '@/components/app/shell/AppShell.vue'
import StatePanel from '@/components/app/state/StatePanel.vue'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import FeedbackDocument from '@/modules/result/feedback/FeedbackDocument.vue'
import { readPublished } from '@/modules/result/feedback/publishedFeedback'

import { publishedSample, sampleAccounts, verifyThesis } from './fixtures'
import { protoNav } from './protoNav'
import SampleControls from './SampleControls.vue'

const sample = ref('v2')
const SAMPLE_STATES = [
  { value: 'v2', label: '正常' },
  { value: 'v1', label: '历史版本（无修改建议）' },
  { value: 'pending', label: '更正处理中' },
  { value: 'corrected', label: '更正后版本' },
  { value: 'unreadable', label: '无法识别' },
]
const view = computed(() => {
  if (sample.value === 'unreadable') return readPublished({ ...publishedSample, snapshot_schema_version: 9 })
  if (sample.value === 'v1') {
    const items = publishedSample.items.map(({ revision_advice: _advice, ...rest }) => rest)
    return readPublished({ ...publishedSample, snapshot_schema_version: 1, items })
  }
  return readPublished({ ...publishedSample, correction_pending: sample.value === 'pending', effective_revision_id: sample.value === 'corrected' ? 'rev-1' : null })
})
const objectionOpen = ref(false)

const shell = sampleAccounts.student!
const nav = protoNav('student', '/student/results')
</script>

<template>
  <AppShell :nav="nav" :account="shell.account" :workspace="shell.workspace" layout="reading" title="评阅结果">
    <template #context>{{ verifyThesis.batch }}</template>

    <StatePanel v-if="!view" kind="error" title="这份评阅结果暂时无法显示">
      发布内容的格式无法识别，为避免显示不完整的意见，这里不展示任何部分。请稍后再看，或联系学校研究生院。
    </StatePanel>

    <FeedbackDocument v-else :view="view" :title="verifyThesis.title" :context="[verifyThesis.program, verifyThesis.batch]">
      <Collapsible v-model:open="objectionOpen" class="border-t pt-6" data-objection>
        <CollapsibleTrigger as-child>
          <Button variant="ghost" class="-ml-3 text-muted-foreground"><MessageSquareWarning />对这份结果有异议？<ChevronDown :class="['transition-transform', objectionOpen && 'rotate-180']" /></Button>
        </CollapsibleTrigger>
        <CollapsibleContent class="grid max-w-[42em] gap-3 pt-3">
          <p>异议由学校处理。登记异议不会自动改变分数，也不会让专家重新评阅。</p>
          <p class="text-sm text-muted-foreground">登记时需要写明异议理由和希望学校如何处理；一篇论文同时只能有一份未办结的异议。</p>
          <Button variant="outline" class="justify-self-start" data-action="open-objection">登记异议…</Button>
        </CollapsibleContent>
      </Collapsible>
    </FeedbackDocument>

    <SampleControls v-model="sample" :states="SAMPLE_STATES" />
  </AppShell>
</template>
