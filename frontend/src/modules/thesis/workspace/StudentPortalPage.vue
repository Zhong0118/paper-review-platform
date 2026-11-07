<script setup lang="ts">
/**
 * U2-3 学生办理门户（真实模式，/student/dashboard）：首屏是当前论文到哪了、下一步做什么。
 * - 当前论文：本批次未终止的那篇；没有时按“需要我处理 → 进行中 → 最近”挑一篇。其余放“其他论文”。
 * - 开始送审跳到编辑页新建态（D5），不在这里建稿。
 * - 删除（DELETE_DRAFT）与送出前撤回（WITHDRAW_BEFORE_DISPATCH）只按 allowed_actions 出现；撤回必填理由，失败保留理由。
 * - 处理记录只列 recent_events 的先后，接口不带时间，不编造时间。
 */
import { Ellipsis } from '@lucide/vue'
import { onClickOutside } from '@vueuse/core'
import { computed, ref, useTemplateRef, watch } from 'vue'

import { fetchEligibility, type Eligibility } from '@/api/auth'
import { apiFailure } from '@/api/failure'
import { beijingTime } from '@/api/taskTiming'
import { deleteThesis, getThesis, listTheses, withdrawThesis, type ThesisDetail } from '@/api/theses'
import ScopeSelect from '@/components/app/data/ScopeSelect.vue'
import AppShell from '@/components/app/shell/AppShell.vue'
import { useSignOut } from '@/components/app/shell/useSignOut'
import StatePanel from '@/components/app/state/StatePanel.vue'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import ConfirmDialog from '@/components/workspace/ConfirmDialog.vue'
import StatusPill from '@/components/workspace/StatusPill.vue'
import { useTimeScope } from '@/composables/useTimeScope'
import { useAuthStore } from '@/stores/auth'
import '@/styles/workspace.css'

import { studentAccount, studentNav } from './studentShell'
import { eventText, materialsOf, stageView } from './studentStage'

const auth = useAuthStore()
const timeScope = useTimeScope()
const account = computed(() => studentAccount(auth.user))
const nav = [{ items: studentNav('/student/dashboard') }]
const signOut = useSignOut()

const theses = ref<ThesisDetail[]>([])
const eligibility = ref<Eligibility | null>(null)
const eligibilityMissing = ref(false)
const loading = ref(true)
const listError = ref('')
const feedback = ref('')
const justDeleted = ref(false)
let generation = 0

/** 本页在原位说明这些请求的失败，不再弹全局提示 */
const QUIET = { quiet: true } as const
const failure = apiFailure

async function load() {
  const own = ++generation
  loading.value = true
  listError.value = ''
  const [elig, list] = await Promise.allSettled([fetchEligibility(QUIET), listTheses(...timeScope.request())])
  if (own !== generation) return
  if (elig.status === 'fulfilled') {
    eligibility.value = elig.value
    eligibilityMissing.value = false
  } else {
    eligibility.value = null
    eligibilityMissing.value = [403, 404].includes(failure(elig.reason).status ?? 0)
  }
  if (list.status === 'fulfilled') theses.value = list.value
  else {
    theses.value = []
    listError.value = failure(list.reason).message
  }
  loading.value = false
}
watch([timeScope.scope, () => auth.user?.id], () => void load(), { immediate: true })

const activeInBatch = computed(() =>
  theses.value.find((item) => eligibility.value?.batch_id && item.review_batch?.id === eligibility.value.batch_id && item.stage !== 'TERMINATED') ?? null,
)
const current = computed<ThesisDetail | null>(() => {
  if (activeInBatch.value) return activeInBatch.value
  return theses.value.find((item) => item.allowed_actions.includes('EDIT_THESIS'))
    ?? theses.value.find((item) => !['COMPLETED', 'TERMINATED'].includes(item.stage))
    ?? null
})
const others = computed(() => theses.value.filter((item) => item.id !== current.value?.id))
const canStart = computed(() => Boolean(eligibility.value?.eligible) && !activeInBatch.value)
const view = computed(() => (current.value ? stageView(current.value) : null))
const materials = computed(() => (current.value?.stage === 'DRAFT' ? materialsOf(current.value) : []))
const events = computed(() => [...(current.value?.recent_events ?? [])].reverse().map(eventText).filter(Boolean))
const deadline = computed(() => beijingTime(eligibility.value?.deadline))

// ---- 更多 ----
const moreOpen = ref(false)
onClickOutside(useTemplateRef<HTMLElement>('more'), () => { moreOpen.value = false })
const can = (action: string) => Boolean(current.value?.allowed_actions.includes(action))

// ---- 删除草稿（C-DELETE） ----
const deleteOpen = ref(false)
const deleting = ref(false)
const deleteError = ref('')
function openDelete() {
  moreOpen.value = false
  deleteError.value = ''
  deleteOpen.value = true
}
async function confirmDelete() {
  const id = current.value?.id
  if (!id || deleting.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    await deleteThesis(id, QUIET)
    deleteOpen.value = false
    justDeleted.value = true
    feedback.value = ''
    await load()
  } catch (error) {
    const info = failure(error)
    if (info.status === 409) {
      deleteOpen.value = false
      await refreshCurrent()
      feedback.value = '论文状态已更新，没有删除。'
    } else deleteError.value = `${info.message}。草稿还在，可以重试。`
  } finally {
    deleting.value = false
  }
}

// ---- 送出前撤回（需理由；失败保留理由） ----
const withdrawOpen = ref(false)
const withdrawReason = ref('')
const withdrawing = ref(false)
const withdrawError = ref('')
function openWithdraw() {
  moreOpen.value = false
  withdrawError.value = ''
  withdrawOpen.value = true
}
async function confirmWithdraw() {
  const target = current.value
  const reason = withdrawReason.value.trim()
  if (!target || !reason || withdrawing.value) return
  withdrawing.value = true
  withdrawError.value = ''
  try {
    const updated = await withdrawThesis(target.id, target.version, reason, QUIET)
    theses.value = theses.value.map((item) => (item.id === updated.id ? updated : item))
    withdrawOpen.value = false
    withdrawReason.value = ''
    feedback.value = '论文已撤回为草稿，可以继续修改后重新提交。'
  } catch (error) {
    const info = failure(error)
    if (info.status === 409) {
      await refreshCurrent()
      withdrawError.value = '论文状态已更新（可能学校已经送出），本次没有撤回。'
    } else withdrawError.value = `${info.message}。你填写的理由还在，可以重试。`
  } finally {
    withdrawing.value = false
  }
}

async function refreshCurrent() {
  const id = current.value?.id
  if (!id) return
  try {
    const fresh = await getThesis(id)
    theses.value = theses.value.map((item) => (item.id === fresh.id ? fresh : item))
  } catch {
    await load()
  }
}

const editLink = (item: ThesisDetail) => ({ path: '/student/thesis/edit', query: { thesisId: item.id } })
const resultLink = (item: ThesisDetail) => ({ path: '/student/results', query: { thesisId: item.id } })
</script>

<template>
  <div class="ws">
    <AppShell :nav="nav" :account="account" :workspace="account.org" layout="reading" title="我的送审" @sign-out="signOut">
      <template v-if="eligibility?.batch_name" #context>
        {{ eligibility.batch_name }}<template v-if="deadline">，收件截止 <span class="tabular">{{ deadline }}</span>（北京时间）</template>
      </template>

      <div class="grid gap-8">
        <p v-if="feedback" class="rounded-md border-l-[3px] border-success bg-success-soft px-4 py-2.5 text-sm" role="status">{{ feedback }}</p>

        <StatePanel v-if="loading" kind="loading" title="正在载入你的论文" />

        <StatePanel v-else-if="listError" kind="error" title="没有取到你的论文列表">
          {{ listError }}
          <template #actions><Button variant="outline" @click="load">重新加载</Button></template>
        </StatePanel>

        <template v-else>
          <!-- 当前论文 -->
          <section v-if="current && view" class="current grid gap-5 rounded-lg border bg-background p-6 max-sm:p-4" aria-labelledby="cur-h" :data-thesis-id="current.id">
            <div class="flex items-start justify-between gap-4">
              <div class="grid min-w-0 gap-2">
                <StatusPill :tone="view.tone" class="justify-self-start">{{ view.pill }}</StatusPill>
                <h2 id="cur-h" class="text-xl font-semibold text-balance">{{ current.current_version?.title || '未命名论文' }}</h2>
                <p class="text-sm text-muted-foreground">
                  {{ current.current_version?.school_program?.name || [current.current_version?.discipline_code, current.current_version?.discipline_name].filter(Boolean).join(' ') }}<template v-if="current.review_batch?.name || current.batch_name">，{{ current.review_batch?.name || current.batch_name }}</template>
                </p>
              </div>
              <div v-if="can('DELETE_DRAFT') || can('WITHDRAW_BEFORE_DISPATCH')" ref="more" class="relative shrink-0">
                <Button variant="ghost" size="icon" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="moreOpen" data-action="more" @click="moreOpen = !moreOpen"><Ellipsis /></Button>
                <div
                  v-if="moreOpen"
                  class="absolute top-[calc(100%+4px)] right-0 z-10 grid min-w-[168px] rounded-md border bg-popover p-1 shadow-(--shadow-float)"
                  role="menu"
                  @keydown.esc="moreOpen = false"
                >
                  <button v-if="can('DELETE_DRAFT')" type="button" role="menuitem" class="h-9 rounded-sm px-2.5 text-left text-sm text-destructive hover:bg-muted focus-visible:bg-muted focus-visible:outline-none" data-action="delete-draft" @click="openDelete">删除这份草稿…</button>
                  <button v-if="can('WITHDRAW_BEFORE_DISPATCH')" type="button" role="menuitem" class="h-9 rounded-sm px-2.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none" data-action="withdraw" @click="openWithdraw">撤回提交…</button>
                </div>
              </div>
            </div>

            <div v-if="current.stage === 'DRAFT' && current.return_reason" class="returned grid gap-1.5 rounded-md border-l-[3px] border-warning bg-warning-soft px-4 py-3">
              <p class="text-sm">学校退回了这篇论文，原因：</p>
              <blockquote class="m-0 leading-relaxed whitespace-pre-line">{{ current.return_reason }}</blockquote>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/60 px-4 py-3.5">
              <div class="grid gap-0.5">
                <p class="text-sm text-muted-foreground">下一步</p>
                <p class="font-medium">{{ view.next }}</p>
              </div>
              <Button v-if="view.action === 'edit' && can('EDIT_THESIS')" as-child>
                <RouterLink :to="editLink(current)" data-action="edit-thesis">{{ current.return_reason ? '修改这份论文' : '继续编辑' }}</RouterLink>
              </Button>
              <Button v-else-if="view.action === 'result'" as-child><RouterLink :to="resultLink(current)">阅读正式反馈</RouterLink></Button>
            </div>

            <dl v-if="materials.length" class="materials m-0 grid grid-cols-4 gap-3 max-sm:grid-cols-2">
              <div v-for="item in materials" :key="item.label" class="grid gap-1">
                <dt class="text-sm text-muted-foreground">{{ item.label }}</dt>
                <dd class="m-0"><StatusPill :tone="item.tone">{{ item.text }}</StatusPill></dd>
              </div>
            </dl>
            <p v-if="current.stage !== 'DRAFT' && !can('WITHDRAW_BEFORE_DISPATCH') && !['COMPLETED', 'TERMINATED'].includes(current.stage)" class="text-sm text-muted-foreground">
              论文已送出给专家，不能再自行撤回。
            </p>

            <section v-if="events.length" class="grid gap-2 border-t pt-4" aria-label="处理记录">
              <h3 class="text-base font-semibold">处理记录</h3>
              <ol class="m-0 grid gap-1 pl-5 text-sm">
                <li v-for="(item, index) in events" :key="index">{{ item }}</li>
              </ol>
              <p class="text-sm text-muted-foreground">按先后排列，最新的在上面。</p>
            </section>
          </section>

          <!-- 无当前论文 -->
          <section v-else-if="canStart" class="empty grid justify-items-start gap-3 rounded-lg border bg-background p-6 max-sm:p-4" :role="justDeleted ? 'status' : undefined">
            <h2 class="text-lg font-semibold">{{ justDeleted ? '草稿已删除' : '还没有论文' }}</h2>
            <p class="max-w-[56ch] text-muted-foreground">
              {{ justDeleted ? '这份草稿已从你的论文列表移除。你仍有本批次的送审资格，可以重新开始送审。' : '你已具备本批次的送审资格。开始前请准备好论文题目、关键词和所属专业；原稿与匿名稿在下一步上传。' }}
            </p>
            <Button as-child><RouterLink to="/student/thesis/edit" data-action="create-thesis">{{ justDeleted ? '重新开始送审' : '开始送审' }}</RouterLink></Button>
          </section>

          <StatePanel v-else-if="eligibilityMissing || (eligibility && !eligibility.eligible)" kind="forbidden" title="你目前没有本批次的送审资格" compact>
            送审资格由学校维护。如果你认为有误，请联系学院研究生秘书。已有的历史论文仍可在下方查看。
          </StatePanel>
          <StatePanel v-else-if="!eligibility" kind="error" title="没有取到你的送审资格" compact>
            可以稍后重新加载。已有的论文仍可在下方查看。
            <template #actions><Button variant="outline" @click="load">重新加载</Button></template>
          </StatePanel>

          <!-- 其他论文 -->
          <section class="others grid gap-3" aria-labelledby="others-h">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h2 id="others-h" class="text-md font-semibold">其他论文</h2>
              <ScopeSelect :model-value="timeScope.scope.value" @update:model-value="timeScope.setScope" />
            </div>
            <ul v-if="others.length" class="m-0 grid list-none divide-y rounded-lg border bg-background p-0">
              <li v-for="item in others" :key="item.id" class="grid grid-cols-[minmax(0,1fr)_auto_88px] items-center gap-3 px-4 py-3 max-sm:grid-cols-[minmax(0,1fr)_auto]" :data-thesis-id="item.id">
                <span class="grid min-w-0 gap-0.5">
                  <strong class="truncate font-medium">{{ item.current_version?.title || '未命名论文' }}</strong>
                  <span class="text-sm text-muted-foreground">{{ item.review_batch?.name || item.batch_name || '批次未提供' }}</span>
                </span>
                <StatusPill :tone="stageView(item).tone">{{ stageView(item).pill }}</StatusPill>
                <Button v-if="item.stage === 'COMPLETED'" variant="outline" size="sm" as-child class="max-sm:col-span-full max-sm:justify-self-start"><RouterLink :to="resultLink(item)">查看反馈</RouterLink></Button>
                <Button v-else-if="item.allowed_actions.includes('EDIT_THESIS')" variant="outline" size="sm" as-child class="max-sm:col-span-full max-sm:justify-self-start"><RouterLink :to="editLink(item)">继续编辑</RouterLink></Button>
                <span v-else class="max-sm:hidden" aria-hidden="true" />
              </li>
            </ul>
            <p v-else class="text-sm text-muted-foreground">
              {{ timeScope.scope.value === 'past_year' ? '近一年（按论文创建日）没有其他论文。' : '没有其他论文。' }}
            </p>
          </section>
        </template>
      </div>
    </AppShell>

    <ConfirmDialog :open="deleteOpen" title="删除这份草稿？" :busy="deleting" @close="deleteOpen = false">
      <p>删除后，该草稿将从你的论文列表移除，可以重新建稿；必要的检测、材料处理与审计记录仍按平台规则保留。此操作不提供自助恢复。</p>
      <p v-if="deleteError" class="text-sm text-destructive" role="alert">{{ deleteError }}</p>
      <template #actions>
        <Button variant="outline" :disabled="deleting" @click="deleteOpen = false">保留草稿</Button>
        <Button variant="destructive" data-action="confirm-delete" :disabled="deleting" @click="confirmDelete">{{ deleting ? '正在删除…' : '删除草稿' }}</Button>
      </template>
    </ConfirmDialog>

    <ConfirmDialog :open="withdrawOpen" title="撤回这次提交？" :busy="withdrawing" @close="withdrawOpen = false">
      <p>撤回后论文回到草稿，你可以修改后重新提交。学校送出给专家之后就不能自行撤回。</p>
      <div class="grid gap-1.5">
        <Label for="withdraw-reason">撤回理由（学校可见）</Label>
        <Textarea id="withdraw-reason" v-model="withdrawReason" rows="3" data-withdraw-reason :disabled="withdrawing" />
      </div>
      <p v-if="withdrawError" class="text-sm text-destructive" role="alert">{{ withdrawError }}</p>
      <template #actions>
        <Button variant="outline" :disabled="withdrawing" @click="withdrawOpen = false">不撤回</Button>
        <Button data-action="confirm-withdraw" :disabled="withdrawing || !withdrawReason.trim()" @click="confirmWithdraw">
          {{ withdrawing ? '正在撤回…' : '撤回提交' }}
        </Button>
      </template>
    </ConfirmDialog>
  </div>
</template>
