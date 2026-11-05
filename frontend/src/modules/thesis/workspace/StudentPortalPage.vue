<script setup lang="ts">
/**
 * U2-3 学生办理门户（真实模式，/student/dashboard）：首屏是当前论文到哪了、下一步做什么。
 * - 当前论文：本批次未终止的那篇；没有时按“需要我处理 → 进行中 → 最近”挑一篇。其余放“其他论文”。
 * - 开始送审跳到编辑页新建态（D5），不在这里建稿。
 * - 删除（DELETE_DRAFT）与送出前撤回（WITHDRAW_BEFORE_DISPATCH）只按 allowed_actions 出现；撤回必填理由，失败保留理由。
 * - 处理记录只列 recent_events 的先后，接口不带时间，不编造时间。
 */
import { computed, ref, watch } from 'vue'

import { fetchEligibility, type Eligibility } from '@/api/auth'
import { apiFailure } from '@/api/failure'
import { beijingTime } from '@/api/taskTiming'
import { deleteThesis, getThesis, listTheses, withdrawThesis, type ThesisDetail } from '@/api/theses'
import ConfirmDialog from '@/components/workspace/ConfirmDialog.vue'
import PersonalShell from '@/components/workspace/PersonalShell.vue'
import StateBlock from '@/components/workspace/StateBlock.vue'
import StatusPill from '@/components/workspace/StatusPill.vue'
import { useTimeScope } from '@/composables/useTimeScope'
import { useAuthStore } from '@/stores/auth'
import '@/styles/workspace.css'

import { studentAccount, studentNav } from './studentShell'
import { eventText, materialsOf, stageView } from './studentStage'

const auth = useAuthStore()
const timeScope = useTimeScope()
const account = computed(() => studentAccount(auth.user))

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
    <PersonalShell :nav="studentNav('/student/dashboard')" :account="account">
      <header class="page-head">
        <h1>我的送审</h1>
        <p v-if="eligibility?.batch_name" class="batch">
          <span>{{ eligibility.batch_name }}</span>
          <span v-if="deadline" class="muted">收件截止 {{ deadline }}（北京时间）</span>
        </p>
      </header>

      <p v-if="feedback" class="feedback" role="status">{{ feedback }}</p>

      <StateBlock v-if="loading" kind="loading" title="正在载入你的论文" />

      <StateBlock v-else-if="listError" kind="error" title="没有取到你的论文列表">
        {{ listError }}
        <template #actions><button type="button" class="btn" @click="load">重新加载</button></template>
      </StateBlock>

      <template v-else>
        <!-- 当前论文 -->
        <section v-if="current && view" class="current" aria-labelledby="cur-h" :data-thesis-id="current.id">
          <div class="current__top">
            <StatusPill :tone="view.tone">{{ view.pill }}</StatusPill>
            <div v-if="can('DELETE_DRAFT') || can('WITHDRAW_BEFORE_DISPATCH')" class="more">
              <button type="button" class="btn btn--sm btn--quiet" aria-haspopup="menu" :aria-expanded="moreOpen" data-action="more" @click="moreOpen = !moreOpen">更多</button>
              <div v-if="moreOpen" class="more__menu" role="menu" @keydown.esc="moreOpen = false">
                <button v-if="can('DELETE_DRAFT')" type="button" role="menuitem" class="danger" data-action="delete-draft" @click="openDelete">删除这份草稿…</button>
                <button v-if="can('WITHDRAW_BEFORE_DISPATCH')" type="button" role="menuitem" data-action="withdraw" @click="openWithdraw">撤回提交…</button>
              </div>
            </div>
          </div>
          <h2 id="cur-h" class="current__title">{{ current.current_version?.title || '未命名论文' }}</h2>
          <p class="muted current__prog">
            {{ current.current_version?.school_program?.name || [current.current_version?.discipline_code, current.current_version?.discipline_name].filter(Boolean).join(' ') }}
            <template v-if="current.review_batch?.name || current.batch_name"> · {{ current.review_batch?.name || current.batch_name }}</template>
          </p>

          <div v-if="current.stage === 'DRAFT' && current.return_reason" class="returned">
            <p class="returned__who">学校退回了这篇论文，原因：</p>
            <blockquote>{{ current.return_reason }}</blockquote>
          </div>

          <div class="next">
            <div>
              <p class="next__label muted">下一步</p>
              <p class="next__text">{{ view.next }}</p>
            </div>
            <RouterLink v-if="view.action === 'edit' && can('EDIT_THESIS')" class="btn btn--primary" :to="editLink(current)" data-action="edit-thesis">
              {{ current.return_reason ? '修改这份论文' : '继续编辑' }}
            </RouterLink>
            <RouterLink v-else-if="view.action === 'result'" class="btn btn--primary" :to="resultLink(current)">阅读正式反馈</RouterLink>
          </div>

          <dl v-if="materials.length" class="materials">
            <div v-for="item in materials" :key="item.label">
              <dt>{{ item.label }}</dt>
              <dd><StatusPill :tone="item.tone">{{ item.text }}</StatusPill></dd>
            </div>
          </dl>
          <p v-if="current.stage !== 'DRAFT' && !can('WITHDRAW_BEFORE_DISPATCH') && !['COMPLETED', 'TERMINATED'].includes(current.stage)" class="muted small">
            论文已送出给专家，不能再自行撤回。
          </p>

          <section v-if="events.length" class="log" aria-label="处理记录">
            <h3>处理记录</h3>
            <ol>
              <li v-for="(item, index) in events" :key="index">{{ item }}</li>
            </ol>
            <p class="muted small">按先后排列，最新的在上面。</p>
          </section>
        </section>

        <!-- 无当前论文 -->
        <section v-else-if="canStart" class="empty" :role="justDeleted ? 'status' : undefined">
          <h2>{{ justDeleted ? '草稿已删除' : '还没有论文' }}</h2>
          <p class="muted">
            {{ justDeleted ? '这份草稿已从你的论文列表移除。你仍有本批次的送审资格，可以重新开始送审。' : '你已具备本批次的送审资格。开始前请准备好论文题目、关键词和所属专业；原稿与匿名稿在下一步上传。' }}
          </p>
          <RouterLink class="btn btn--primary" to="/student/thesis/edit" data-action="create-thesis">{{ justDeleted ? '重新开始送审' : '开始送审' }}</RouterLink>
        </section>

        <StateBlock v-else-if="eligibilityMissing || (eligibility && !eligibility.eligible)" kind="unconfigured" title="你目前没有本批次的送审资格">
          送审资格由学校维护。如果你认为有误，请联系学院研究生秘书。已有的历史论文仍可在下方查看。
        </StateBlock>
        <StateBlock v-else-if="!eligibility" kind="error" title="没有取到你的送审资格">
          可以稍后重新加载。已有的论文仍可在下方查看。
          <template #actions><button type="button" class="btn" @click="load">重新加载</button></template>
        </StateBlock>

        <!-- 其他论文 -->
        <section class="others" aria-labelledby="others-h">
          <div class="others__head">
            <h2 id="others-h">其他论文</h2>
            <label class="scope">
              <span class="sr-only">时间范围</span>
              <select class="select" :value="timeScope.scope.value" data-time-scope @change="timeScope.setScope(($event.target as HTMLSelectElement).value)">
                <option value="all">全部年份</option>
                <option value="past_year">近一年</option>
              </select>
            </label>
          </div>
          <ul v-if="others.length">
            <li v-for="item in others" :key="item.id" :data-thesis-id="item.id">
              <span class="others__name">
                <strong>{{ item.current_version?.title || '未命名论文' }}</strong>
                <span class="muted">{{ item.review_batch?.name || item.batch_name || '批次未提供' }}</span>
              </span>
              <StatusPill :tone="stageView(item).tone">{{ stageView(item).pill }}</StatusPill>
              <RouterLink v-if="item.stage === 'COMPLETED'" class="btn btn--sm" :to="resultLink(item)">查看反馈</RouterLink>
              <RouterLink v-else-if="item.allowed_actions.includes('EDIT_THESIS')" class="btn btn--sm" :to="editLink(item)">继续编辑</RouterLink>
              <span v-else class="others__gap" aria-hidden="true" />
            </li>
          </ul>
          <p v-else class="muted small">
            {{ timeScope.scope.value === 'past_year' ? '近一年（按论文创建日）没有其他论文。' : '没有其他论文。' }}
          </p>
        </section>
      </template>
    </PersonalShell>

    <ConfirmDialog :open="deleteOpen" title="删除这份草稿？" :busy="deleting" @close="deleteOpen = false">
      <p>删除后，该草稿将从你的论文列表移除，可以重新建稿；必要的检测、材料处理与审计记录仍按平台规则保留。此操作不提供自助恢复。</p>
      <p v-if="deleteError" class="field-error" role="alert">{{ deleteError }}</p>
      <template #actions>
        <button type="button" class="btn" :disabled="deleting" @click="deleteOpen = false">保留草稿</button>
        <button type="button" class="btn btn--danger" data-action="confirm-delete" :disabled="deleting" @click="confirmDelete">{{ deleting ? '正在删除…' : '删除草稿' }}</button>
      </template>
    </ConfirmDialog>

    <ConfirmDialog :open="withdrawOpen" title="撤回这次提交？" :busy="withdrawing" @close="withdrawOpen = false">
      <p>撤回后论文回到草稿，你可以修改后重新提交。学校送出给专家之后就不能自行撤回。</p>
      <label class="field">
        <span>撤回理由（学校可见）</span>
        <textarea v-model="withdrawReason" class="textarea" rows="3" data-withdraw-reason :disabled="withdrawing" />
      </label>
      <p v-if="withdrawError" class="field-error" role="alert">{{ withdrawError }}</p>
      <template #actions>
        <button type="button" class="btn" :disabled="withdrawing" @click="withdrawOpen = false">不撤回</button>
        <button type="button" class="btn btn--primary" data-action="confirm-withdraw" :disabled="withdrawing || !withdrawReason.trim()" @click="confirmWithdraw">
          {{ withdrawing ? '正在撤回…' : '撤回提交' }}
        </button>
      </template>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px 16px;
  margin-bottom: 20px;
}
.page-head h1 {
  font-size: 22px;
  font-weight: 650;
}
.batch {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 13px;
}
.feedback {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: var(--ws-radius);
  background: var(--ws-success-soft);
  font-size: 13px;
}
.empty,
.current {
  display: grid;
  gap: 14px;
  padding: 24px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-panel);
  background: var(--ws-surface);
}
.empty {
  justify-items: start;
}
.empty h2 {
  font-size: 17px;
  font-weight: 600;
}
.empty p {
  max-width: 56ch;
}
.current__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.current__title {
  font-family: var(--ws-font-reading);
  font-size: 20px;
  font-weight: 600;
  line-height: 1.45;
}
.current__prog {
  margin-top: -8px;
  font-size: 13px;
}
.more {
  position: relative;
}
.more__menu {
  position: absolute;
  z-index: 10;
  top: calc(100% + 4px);
  right: 0;
  display: grid;
  min-width: 168px;
  padding: 4px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius);
  background: var(--ws-surface);
  box-shadow: var(--ws-shadow-float);
}
.more__menu button {
  min-height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ws-text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.more__menu button:hover {
  background: var(--ws-sunken);
}
.more__menu .danger {
  color: var(--ws-danger);
}
.returned {
  display: grid;
  gap: 6px;
  padding: 12px 16px;
  border-left: 3px solid var(--ws-warning);
  border-radius: 0 var(--ws-radius) var(--ws-radius) 0;
  background: var(--ws-warning-soft);
}
.returned__who {
  font-size: 13px;
}
.returned blockquote {
  margin: 0;
  font-family: var(--ws-font-reading);
  line-height: 1.75;
}
.next {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--ws-radius);
  background: var(--ws-page);
}
.next__label {
  font-size: 12px;
}
.next__text {
  font-weight: 500;
}
.materials {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}
.materials dt {
  margin-bottom: 4px;
  color: var(--ws-muted);
  font-size: 12px;
}
.materials dd {
  margin: 0;
}
.small {
  font-size: 12px;
}
.log {
  display: grid;
  gap: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--ws-border);
}
.log h3 {
  font-size: 14px;
  font-weight: 600;
}
.log ol {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
}
.others {
  display: grid;
  gap: 10px;
  margin-top: 28px;
}
.others__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.others__head h2 {
  font-size: 15px;
  font-weight: 600;
}
.scope .select {
  min-height: 32px;
}
.others ul {
  display: grid;
  margin: 0;
  padding: 0;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-panel);
  background: var(--ws-surface);
  list-style: none;
}
.others li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 88px;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}
.others li + li {
  border-top: 1px solid var(--ws-border);
}
.others__name {
  display: grid;
  min-width: 0;
  gap: 2px;
}
.others__name strong {
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.others__name .muted {
  font-size: 12px;
}
@media (max-width: 640px) {
  .empty,
  .current {
    padding: 16px;
  }
  .materials {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .others li {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .others li > :last-child {
    grid-column: 1 / -1;
    justify-self: start;
  }
  .others__gap {
    display: none;
  }
}
</style>
