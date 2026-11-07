<script setup lang="ts">
/**
 * R1 样板一（续）：完整专家档案（form 模板，居中 960）。展示字段分组、可见标签、就近错误、
 * 危险动作的确认（写明后果与理由）与保存条。虚构数据，不保存到任何地方。
 */
import { ChevronLeft } from '@lucide/vue'
import { computed, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'

import ComboFilter from '@/components/app/data/ComboFilter.vue'
import StatusBadge from '@/components/app/data/StatusBadge.vue'
import AppShell from '@/components/app/shell/AppShell.vue'
import StatePanel from '@/components/app/state/StatePanel.vue'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { availability, qualificationText, serviceText } from '@/modules/expert-management/library/expertView'

import { experts, options, sampleAccounts } from './fixtures'
import { protoNav } from './protoNav'

const route = useRoute()
const expert = computed(() => experts.find((row) => row.id === route.params.id) ?? null)
const form = reactive({ unit: expert.value?.unit ?? '', title: expert.value?.title ?? '', province: expert.value?.province_name ?? null })
const dirty = computed(() => Boolean(expert.value) && (form.unit !== expert.value!.unit || form.title !== expert.value!.title || form.province !== expert.value!.province_name))
const unitError = computed(() => (form.unit.trim() ? '' : '请填写单位。'))
const saved = ref(false)

const pauseOpen = ref(false)
const pauseReason = ref('')
const pauseTried = ref(false)
function confirmPause(event: Event) {
  pauseTried.value = true
  if (!pauseReason.value.trim()) event.preventDefault()
}

const shell = sampleAccounts.platform_reviewer!
const nav = protoNav('platform_reviewer', '/platform/experts')
const state = computed(() => (expert.value ? availability(expert.value) : null))
</script>

<template>
  <AppShell :nav="nav" :account="shell.account" :workspace="shell.workspace" layout="form" :title="expert?.display_name ?? '专家档案'">
    <template #back>
      <Button variant="ghost" size="sm" as-child class="-ml-1 text-muted-foreground"><RouterLink to="/prototype/r1/experts"><ChevronLeft />专家库</RouterLink></Button>
    </template>
    <template #context><span v-if="expert" class="tabular">{{ expert.username }}</span></template>

    <StatePanel v-if="!expert" kind="forbidden" title="这位专家不在专家库中">
      链接可能有误，或档案已不可见。
      <template #actions><Button variant="outline" as-child><RouterLink to="/prototype/r1/experts">返回专家库</RouterLink></Button></template>
    </StatePanel>

    <div v-else class="grid gap-6">
      <section class="rounded-lg border bg-background" aria-labelledby="sec-state">
        <header class="flex flex-wrap items-center gap-3 border-b px-5 py-3">
          <h2 id="sec-state" class="text-md font-semibold">资格与接单</h2>
          <StatusBadge :tone="state?.tone === 'success' ? 'success' : 'warning'">{{ state?.tone === 'success' ? '可指派' : '暂不可派' }}</StatusBadge>
          <span class="text-sm text-muted-foreground">{{ state?.text }}</span>
        </header>
        <dl class="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-[120px_1fr_auto]">
          <dt class="text-muted-foreground">资格审核</dt>
          <dd>{{ qualificationText[expert.qualification_status] }}</dd>
          <dd class="sm:text-right"><Button v-if="expert.qualification_status === 'PENDING'" variant="outline" size="sm">审核资格…</Button></dd>
          <dt class="text-muted-foreground">接单状态</dt>
          <dd>{{ serviceText[expert.service_status] }}</dd>
          <dd class="sm:text-right">
            <Button v-if="expert.service_status === 'AVAILABLE'" variant="outline" size="sm" data-action="pause" @click="pauseOpen = true">暂停接单…</Button>
            <Button v-else variant="outline" size="sm">恢复接单</Button>
          </dd>
        </dl>
      </section>

      <section class="rounded-lg border bg-background" aria-labelledby="sec-profile">
        <header class="border-b px-5 py-3"><h2 id="sec-profile" class="text-md font-semibold">档案</h2></header>
        <div class="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <div class="grid gap-1.5 sm:col-span-2">
            <Label for="f-unit">单位</Label>
            <Input id="f-unit" v-model="form.unit" :aria-invalid="Boolean(unitError)" aria-describedby="f-unit-err" class="max-w-[560px]" />
            <p v-if="unitError" id="f-unit-err" class="text-sm text-destructive">{{ unitError }}</p>
          </div>
          <div class="grid gap-1.5">
            <Label for="f-title">职称</Label>
            <Select v-model="form.title">
              <SelectTrigger id="f-title" class="w-[220px]"><SelectValue placeholder="选择职称" /></SelectTrigger>
              <SelectContent><SelectItem v-for="t in options.titles" :key="t" :value="t">{{ t }}</SelectItem></SelectContent>
            </Select>
          </div>
          <div class="grid gap-1.5">
            <Label>省份</Label>
            <ComboFilter v-model="form.province" label="省份" placeholder="选择省份" :options="options.provinces.map((p) => ({ value: p, label: p }))" width="w-[220px]" />
            <p class="text-sm text-muted-foreground">只能从官方省份名录中选择。</p>
          </div>
        </div>
      </section>

      <div class="sticky bottom-0 z-10 -mx-1 rounded-lg border bg-background px-4 shadow-float">
        <div class="flex h-14 items-center justify-end gap-3">
          <span class="mr-auto text-sm text-muted-foreground" role="status">{{ saved && !dirty ? '已保存（样板）' : dirty ? '有未保存的修改' : '没有未保存的修改' }}</span>
          <Button variant="outline" :disabled="!dirty" @click="Object.assign(form, { unit: expert.unit, title: expert.title, province: expert.province_name })">放弃修改</Button>
          <Button :disabled="!dirty || Boolean(unitError)" @click="saved = true">保存档案</Button>
        </div>
      </div>
    </div>

    <AlertDialog v-model:open="pauseOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>暂停 {{ expert?.display_name }} 接单？</AlertDialogTitle>
          <AlertDialogDescription>暂停后不会再给这位专家派新任务；已接受的任务继续办理。原因写入处理记录。</AlertDialogDescription>
        </AlertDialogHeader>
        <div class="grid gap-1.5">
          <Label for="pause-reason">原因</Label>
          <Textarea id="pause-reason" v-model="pauseReason" :aria-invalid="pauseTried && !pauseReason.trim()" placeholder="例如：本人申请暂停至 12 月" />
          <p v-if="pauseTried && !pauseReason.trim()" class="text-sm text-destructive">请写明暂停原因。</p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction @click="confirmPause">暂停接单</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </AppShell>
</template>
