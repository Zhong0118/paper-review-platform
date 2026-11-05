<script setup lang="ts">
/**
 * U2-5 平台派单台（真实模式，/platform/dispatch）：论文清单｜论文需求与候选比较。
 * - 单专家试点：候选单选；按服务端规则分排序，在途任务只作参考，不是容量上限。
 * - 指派（ASSIGN_EXPERT）、拒绝后重新指派（同一指派命令，文案区分）、改派（REASSIGN_EXPERT，独立确认）是不同路径。
 * - 不可派原因来自服务端（unavailable_reasons / 回避 / 资格 / 暂停 / 方向不符），前端不另行推断。
 * - 指派带候选档案 version；一次尝试的幂等键稳定；409 刷新候选并要求重新选择。
 * - 视图、选中论文放在查询参数里；延期审批沿用 ExtensionPanel。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { assignExpert, candidateUnavailableReason, dispatchCandidates, dispatchQueue, reassignExpert, type DispatchCandidate, type DispatchQueueItem } from '@/api/dispatch'
import { failureText } from '@/api/failure'
import { deadlineLabel } from '@/api/taskTiming'
import ConfirmDialog from '@/components/workspace/ConfirmDialog.vue'
import OperationsShell from '@/components/workspace/OperationsShell.vue'
import StateBlock from '@/components/workspace/StateBlock.vue'
import StatusPill from '@/components/workspace/StatusPill.vue'
import type { WorkspaceAccount } from '@/components/workspace/types'
import { useTimeScope } from '@/composables/useTimeScope'
import { workspaceNav } from '@/router/workspaceNav'
import { useAuthStore } from '@/stores/auth'
import '@/styles/workspace.css'

import ExtensionPanel from '../components/ExtensionPanel.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const timeScope = useTimeScope()

// ---- 窄屏（≤899px：清单与详情切换） ----
const narrow = ref(false)
let media: MediaQueryList | null = null
const syncMedia = () => (narrow.value = media?.matches ?? false)
onMounted(() => {
  if (typeof window.matchMedia !== 'function') return
  media = window.matchMedia('(max-width: 899px)')
  syncMedia()
  media.addEventListener('change', syncMedia)
})
onBeforeUnmount(() => media?.removeEventListener('change', syncMedia))

// ---- 清单 ----
const queue = ref<DispatchQueueItem[]>([])
const loading = ref(true)
const listError = ref('')
let listGeneration = 0
async function loadQueue() {
  const own = ++listGeneration
  loading.value = true
  listError.value = ''
  try {
    const rows = await dispatchQueue(...timeScope.request())
    if (own !== listGeneration) return
    queue.value = rows
  } catch (error) {
    if (own !== listGeneration) return
    queue.value = []
    listError.value = failureText(error, '派单清单没有加载出来')
  } finally {
    if (own === listGeneration) loading.value = false
  }
}
watch([timeScope.scope, () => auth.user?.id], () => void loadQueue(), { immediate: true })

const ACTIVE = new Set(['INVITED', 'IN_REVIEW'])
type View = 'pending' | 'active' | 'follow' | 'all'
const views: { key: View; label: string }[] = [
  { key: 'pending', label: '待指派' },
  { key: 'active', label: '进行中' },
  { key: 'follow', label: '需跟进' },
  { key: 'all', label: '全部' },
]
const isPending = (row: DispatchQueueItem) => row.allowed_actions.includes('ASSIGN_EXPERT')
const isFollow = (row: DispatchQueueItem) => !isPending(row) && (row.tasks ?? []).some((task) => ACTIVE.has(task.status) && task.deadline?.overdue)
function inView(row: DispatchQueueItem, key: View) {
  if (key === 'pending') return isPending(row)
  if (key === 'follow') return isFollow(row)
  if (key === 'active') return !isPending(row) && !isFollow(row) && (row.tasks ?? []).some((task) => ACTIVE.has(task.status))
  return true
}
const text = (value: unknown) => (typeof value === 'string' ? value : '')
const view = computed<View>(() => views.find((item) => item.key === route.query.view)?.key ?? 'pending')
const countOf = (key: View) => queue.value.filter((row) => inView(row, key)).length
const list = computed(() => queue.value.filter((row) => inView(row, view.value)))
const selectedId = computed(() => text(route.query.thesis))
const item = computed(() => queue.value.find((row) => row.thesis_id === selectedId.value) ?? null)
function setQuery(patch: Record<string, string | undefined>) {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...route.query, ...patch })) if (typeof value === 'string' && value) query[key] = value
  void router.replace({ query })
}
function choose(row: DispatchQueueItem) {
  setQuery({ thesis: row.thesis_id })
}
// 宽屏进入视图时自动选中第一篇；窄屏保持清单
watch([list, narrow], ([rows, isNarrow]) => {
  if (loading.value || isNarrow) return
  if (!rows.some((row) => row.thesis_id === selectedId.value) && rows[0]) setQuery({ thesis: rows[0].thesis_id })
})

const TASK_TEXT: Record<string, string> = { INVITED: '待专家接受', IN_REVIEW: '评阅中', SUBMITTED: '已提交', REJECTED: '已拒绝', CANCELLED: '已取消', REASSIGNED: '已改派' }
const taskText = (status: string) => TASK_TEXT[status] ?? status
const rejectedBefore = (row: DispatchQueueItem) => (row.tasks ?? []).some((task) => task.status === 'REJECTED')
function lineOf(row: DispatchQueueItem) {
  if (isPending(row)) return rejectedBefore(row) ? '上一位专家已拒绝，待重新指派' : '待指派专家'
  const active = (row.tasks ?? []).filter((task) => ACTIVE.has(task.status))
  if (!active.length) return stageText(row.stage)
  return active.map((task) => `${taskText(task.status)}　${deadlineLabel(task.status, task.deadline)}`).join('；')
}
const STAGE_TEXT: Record<string, string> = { READY_FOR_DISPATCH: '待指派', UNDER_REVIEW: '送审中', RESULT_PROCESSING: '结果处理中', COMPLETED: '已完成', TERMINATED: '已终止' }
const stageText = (stage: string) => STAGE_TEXT[stage] ?? stage

// ---- 候选 ----
const candidates = ref<DispatchCandidate[]>([])
const candLoading = ref(false)
const candError = ref('')
let candGeneration = 0
async function loadCandidates() {
  const own = ++candGeneration
  candidates.value = []
  candError.value = ''
  chosen.value = ''
  const id = item.value?.thesis_id
  if (!id) return
  candLoading.value = true
  try {
    const rows = await dispatchCandidates(id, { quiet: true })
    if (own !== candGeneration) return
    candidates.value = rows
  } catch (error) {
    if (own === candGeneration) candError.value = failureText(error, '候选专家没有加载出来')
  } finally {
    if (own === candGeneration) candLoading.value = false
  }
}

const currentExpertId = computed(() => item.value?.reassignable_task?.expert_id ?? '')
const nameOf = (row: DispatchCandidate) => row.display_name || row.username || '未命名专家'
function blockedReason(row: DispatchCandidate) {
  if (row.expert_id === currentExpertId.value) return '当前任务专家'
  const reason = candidateUnavailableReason(row)
  if (reason) return reason
  const need = reassigning.value ? 'REASSIGN_EXPERT' : 'ASSIGN_EXPERT'
  return row.allowed_actions && !row.allowed_actions.includes(need) ? '当前不可派' : ''
}
const available = computed(() => candidates.value.filter((row) => !blockedReason(row)).sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0)))
const blocked = computed(() => candidates.value.filter((row) => blockedReason(row)))
const blockedSummary = computed(() => {
  const counts = new Map<string, number>()
  for (const row of blocked.value) {
    const key = blockedReason(row)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].map(([key, n]) => `${key} ${n} 位`).join('，')
})
const ruleVersion = computed(() => candidates.value.find((row) => row.match_rule_version)?.match_rule_version ?? '')
const currentExpert = computed(() => candidates.value.find((row) => row.expert_id === currentExpertId.value) ?? null)
const reasonKind = (kind: string) => (kind === 'research_direction' ? '研究方向' : '关键词')

// ---- 指派 / 改派 ----
const chosen = ref('')
const chosenExpert = computed(() => available.value.find((row) => row.expert_id === chosen.value) ?? null)
const reassigning = ref(false)
const canReassign = computed(() => Boolean(item.value?.reassignable_task) && Boolean(item.value?.allowed_actions.includes('REASSIGN_EXPERT')))
const showCandidates = computed(() => Boolean(item.value) && (isPending(item.value!) || reassigning.value))
const commandLabel = computed(() => (reassigning.value ? '改派…' : item.value && rejectedBefore(item.value) ? '重新指派' : '确认指派'))
const pending = ref(false)
const result = ref<null | { kind: 'conflict' | 'error'; text: string }>(null)
/** 成功提示放在清单上方：指派后论文离开“待指派”，当前选中会切到下一篇，提示不能跟着论文消失 */
const flash = ref('')
const reassignOpen = ref(false)
let attempt: { signature: string; key: string } | null = null
function keyFor(signature: string) {
  if (attempt?.signature !== signature) attempt = { signature, key: crypto.randomUUID() }
  return attempt.key
}
watch(reassigning, () => {
  chosen.value = ''
  result.value = null
})

function commit() {
  if (!chosenExpert.value || pending.value) return
  if (reassigning.value) {
    reassignOpen.value = true
    return
  }
  void run()
}

async function run() {
  const target = item.value
  const expert = chosenExpert.value
  if (!target || !expert || pending.value) return
  pending.value = true
  result.value = null
  flash.value = ''
  const name = nameOf(expert)
  const title = target.title || '未命名论文'
  try {
    if (reassigning.value && target.reassignable_task) {
      const taskId = target.reassignable_task.id
      await reassignExpert(taskId, expert.expert_id, { quiet: true, idempotencyKey: keyFor(`reassign:${taskId}:${expert.expert_id}:${expert.candidate_version}`) }, expert.candidate_version)
      flash.value = `《${title}》已改派给${name}：原任务关闭并保留在历史记录中，新专家需要先接受邀请。`
    } else {
      await assignExpert(target.thesis_id, expert.expert_id, { quiet: true, idempotencyKey: keyFor(`assign:${target.thesis_id}:${expert.expert_id}:${expert.candidate_version}`) }, expert.candidate_version)
      flash.value = `已向${name}发出《${title}》的评阅邀请，等待专家接受；论文移到“进行中”。`
    }
    attempt = null
    reassignOpen.value = false
    reassigning.value = false
    await loadQueue()
    await loadCandidates()
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status
    reassignOpen.value = false
    if (status === 409) {
      attempt = null
      await loadQueue()
      await loadCandidates()
      result.value = { kind: 'conflict', text: `${name}的档案或论文状态在你选择后有变化，没有${reassigning.value ? '改派' : '指派'}。候选已刷新，请重新选择。` }
    } else {
      result.value = { kind: 'error', text: `${failureText(error, '请求失败')}。没有${reassigning.value ? '改派' : '指派'}，可以重试。` }
    }
  } finally {
    pending.value = false
  }
}

// 切换论文：取消改派、清掉上一篇的结果、重新取候选
watch(() => item.value?.thesis_id, () => {
  reassigning.value = false
  result.value = null
  void loadCandidates()
}, { immediate: true })

// ---- 延期审批 ----
const extOpen = ref(false)

// ---- 外壳 ----
const nav = computed(() => workspaceNav('platform_reviewer', '/platform/dispatch', {
  '/platform/dispatch': !loading.value && !listError.value ? countOf('pending') : undefined,
}))
const account = computed<WorkspaceAccount>(() => ({ name: auth.user?.displayName || '身份未取得', username: auth.user?.username ?? '', role: '百杰审核', org: '百杰运营' }))

</script>

<template>
  <div class="ws">
    <OperationsShell :nav="nav" :account="account" org="百杰运营">
      <template #title><h1 class="title">派单台</h1></template>
      <template #context>
        <span class="muted ctx">单专家试点，每篇论文指派 1 位专家</span>
        <label class="ctx-scope">
          <span class="sr-only">论文范围</span>
          <select class="select" :value="timeScope.scope.value" data-time-scope @change="timeScope.setScope(($event.target as HTMLSelectElement).value)">
            <option value="all">全部年份</option>
            <option value="past_year">近一年</option>
          </select>
        </label>
        <button type="button" class="btn btn--sm" :aria-expanded="extOpen" data-action="toggle-extensions" @click="extOpen = !extOpen">延期审批</button>
      </template>

      <section v-if="extOpen" class="ext-panel" aria-label="评阅延期审批">
        <ExtensionPanel @changed="loadQueue" />
      </section>

      <div class="desk" :class="{ 'desk--narrow': narrow }">
        <section v-show="!narrow || !item" class="desk__list" aria-label="论文清单">
          <div class="views" role="tablist" aria-label="工作视图">
            <button v-for="entry in views" :key="entry.key" type="button" role="tab" class="views__tab" :aria-selected="view === entry.key" @click="setQuery({ view: entry.key === 'pending' ? undefined : entry.key, thesis: undefined })">
              {{ entry.label }} <span v-if="!loading && !listError" class="num">{{ countOf(entry.key) }}</span>
            </button>
          </div>
          <p v-if="flash" class="flash" role="status" data-dispatch-flash>{{ flash }}</p>
          <StateBlock v-if="loading" kind="loading" title="正在载入派单清单" compact />
          <StateBlock v-else-if="listError" kind="error" title="派单清单没有加载出来" compact>
            {{ listError }}
            <template #actions><button type="button" class="btn btn--sm" @click="loadQueue">重试</button></template>
          </StateBlock>
          <StateBlock v-else-if="!list.length" kind="empty" :title="view === 'pending' ? '没有待指派的论文' : '这个视图里没有论文'" compact>
            {{ view === 'pending' ? '学校确认送出后，论文会出现在这里。' : '' }}
          </StateBlock>
          <ul v-else class="tlist">
            <li v-for="row in list" :key="row.thesis_id">
              <button type="button" class="titem" :class="{ 'titem--on': row.thesis_id === selectedId }" :aria-current="row.thesis_id === selectedId" data-thesis-row @click="choose(row)">
                <span class="titem__title">{{ row.title || '未命名论文' }}</span>
                <span class="titem__meta muted">{{ row.student_name }}　{{ row.discipline_code }}</span>
                <span class="titem__line" :class="{ 'titem__line--warn': isFollow(row) || (isPending(row) && rejectedBefore(row)) }">{{ lineOf(row) }}</span>
              </button>
            </li>
          </ul>
        </section>

        <section v-if="item" class="desk__detail" aria-label="当前论文">
          <button v-if="narrow" type="button" class="btn btn--quiet back" @click="setQuery({ thesis: undefined })">‹ 论文清单</button>
          <header class="need">
            <h2 class="need__title">{{ item.title || '未命名论文' }}</h2>
            <dl class="need__meta">
              <div><dt>学生</dt><dd>{{ item.student_name }}</dd></div>
              <div><dt>学科</dt><dd>{{ item.discipline_code }}</dd></div>
              <div><dt>材料</dt><dd>当前送审匿名稿</dd></div>
              <div><dt>需要</dt><dd>1 位专家</dd></div>
            </dl>
          </header>

          <section v-if="(item.tasks ?? []).length" class="tasks" aria-label="当前任务与历史">
            <div v-for="(task, index) in item.tasks" :key="index" class="task">
              <div class="task__main">
                <StatusPill :tone="task.status === 'REJECTED' ? 'warning' : ACTIVE.has(task.status) ? (task.deadline?.overdue ? 'danger' : 'action') : 'neutral'">{{ taskText(task.status) }}</StatusPill>
                <span v-if="ACTIVE.has(task.status) && currentExpert">{{ nameOf(currentExpert) }}</span>
                <span class="muted">{{ deadlineLabel(task.status, task.deadline) }}</span>
              </div>
            </div>
            <div v-if="canReassign" class="task__actions">
              <button v-if="!reassigning" type="button" class="btn btn--sm" data-action="start-reassign" @click="reassigning = true">改派…</button>
              <button v-else type="button" class="btn btn--sm btn--quiet" @click="reassigning = false">取消改派</button>
            </div>
          </section>

          <section v-if="showCandidates" class="cands" aria-label="候选专家">
            <div class="cands__head">
              <h3>{{ reassigning ? '选择改派给哪位专家' : '候选专家' }}</h3>
              <p class="muted">按规则分排序<template v-if="ruleVersion">（规则 {{ ruleVersion }}）</template>；在途任务只供参考，不是容量上限。</p>
            </div>
            <div v-if="result" class="result" role="alert" data-dispatch-result>{{ result.text }}</div>

            <StateBlock v-if="candLoading" kind="loading" title="正在载入候选专家" compact />
            <StateBlock v-else-if="candError" kind="error" title="候选专家没有加载出来" compact>
              论文信息不受影响。{{ candError }}
              <template #actions><button type="button" class="btn btn--sm" @click="loadCandidates">重试</button></template>
            </StateBlock>
            <StateBlock v-else-if="!candidates.length" kind="empty" :title="`专家库里没有 ${item.discipline_code} 方向的专家`" compact>
              这不是推荐失败：目前没有该学科的专家档案。需要先在专家库新增或导入档案。
              <template #actions><RouterLink class="btn btn--sm" to="/platform/experts">打开专家库</RouterLink></template>
            </StateBlock>
            <template v-else>
              <StateBlock v-if="!available.length" kind="unconfigured" :title="`有 ${blocked.length} 位候选，但当前都不可指派`" compact>
                {{ blockedSummary }}。可以在专家库调整资格或服务状态，或等待暂停结束。
              </StateBlock>
              <div class="table-wrap">
                <table class="ctable">
                  <thead>
                    <tr>
                      <th scope="col"><span class="sr-only">选择</span></th>
                      <th scope="col">专家</th>
                      <th scope="col">匹配依据</th>
                      <th scope="col" class="num-col">在途任务</th>
                      <th scope="col">可否指派</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in available" :key="row.expert_id" :class="{ 'row--on': chosen === row.expert_id }" @click="chosen = row.expert_id">
                      <td><input :id="`c-${row.expert_id}`" v-model="chosen" type="radio" name="expert" :value="row.expert_id" :aria-label="`选择${nameOf(row)}`" /></td>
                      <td>
                        <label :for="`c-${row.expert_id}`" class="who"><strong>{{ nameOf(row) }}</strong><span class="muted">{{ [row.title, row.unit].filter(Boolean).join('，') || '单位未填写' }}</span></label>
                      </td>
                      <td>
                        <span class="score num">{{ row.match_score ?? 0 }} 分</span>
                        <span class="reasons">
                          <span v-for="reason in row.match_reasons ?? []" :key="`${reason.kind}-${reason.tag}`" class="reason">{{ reasonKind(reason.kind) }}：{{ reason.tag }} +{{ reason.points }}</span>
                        </span>
                      </td>
                      <td class="num-col num">{{ row.workload ? `待接 ${row.workload.invited}　评阅中 ${row.workload.in_review}` : '—' }}</td>
                      <td><StatusPill tone="success">可指派</StatusPill></td>
                    </tr>
                    <tr v-if="available.length && blocked.length" class="divider"><td colspan="5">不可指派 {{ blocked.length }} 位</td></tr>
                    <tr v-for="row in blocked" :key="row.expert_id" class="row--blocked">
                      <td><input type="radio" disabled :aria-label="`${nameOf(row)}不可指派`" /></td>
                      <td><span class="who"><strong>{{ nameOf(row) }}</strong><span class="muted">{{ [row.title, row.unit].filter(Boolean).join('，') || '单位未填写' }}</span></span></td>
                      <td><span class="score num">{{ row.match_score ?? 0 }} 分</span></td>
                      <td class="num-col num">{{ row.workload ? `待接 ${row.workload.invited}　评阅中 ${row.workload.in_review}` : '—' }}</td>
                      <td><StatusPill :tone="blockedReason(row) === '当前任务专家' ? 'neutral' : 'danger'">{{ blockedReason(row) }}</StatusPill></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </section>

          <footer v-if="showCandidates && !candLoading && !candError && candidates.length" class="commit">
            <p v-if="chosenExpert" class="commit__sel">已选：<strong>{{ nameOf(chosenExpert) }}</strong><span class="muted">　{{ chosenExpert.unit }}</span></p>
            <p v-else class="muted commit__sel">{{ available.length ? '在上方选择一位专家' : '暂无可指派的专家' }}</p>
            <p v-if="!reassigning && rejectedBefore(item)" class="muted commit__hint">上一位专家已拒绝，这是一次新的指派，不是改派。</p>
            <button type="button" class="btn btn--primary" data-action="commit-dispatch" :disabled="!chosenExpert || pending" @click="commit">{{ pending ? '正在提交…' : commandLabel }}</button>
          </footer>
        </section>
        <StateBlock v-else-if="!narrow && !loading && list.length" kind="empty" title="选择左侧一篇论文开始派单" />
      </div>
    </OperationsShell>

    <ConfirmDialog :open="reassignOpen" title="改派这篇论文？" wide :busy="pending" @close="reassignOpen = false">
      <dl class="swap">
        <dt>当前任务</dt><dd>{{ currentExpert ? nameOf(currentExpert) : '当前专家' }}，{{ taskText(item?.tasks?.find((task) => ACTIVE.has(task.status))?.status ?? '') }}</dd>
        <dt>改派给</dt><dd>{{ chosenExpert ? nameOf(chosenExpert) : '尚未选择' }}<span v-if="chosenExpert?.unit" class="muted">，{{ chosenExpert.unit }}</span></dd>
      </dl>
      <p>当前任务会被关闭并保留在历史记录中，原专家不能再提交这篇论文的评阅。新专家收到邀请后需要先接受；期限按新任务重新计算，以服务端结果为准。</p>
      <template #actions>
        <button type="button" class="btn" :disabled="pending" @click="reassignOpen = false">取消</button>
        <button type="button" class="btn btn--primary" data-action="confirm-reassign" :disabled="!chosenExpert || pending" @click="run">{{ pending ? '正在改派…' : '确认改派' }}</button>
      </template>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.title {
  font-size: 17px;
  font-weight: 600;
}
.ctx {
  font-size: 13px;
}
.ext-panel {
  max-height: 40vh;
  overflow: auto;
  padding: 12px 20px;
  border-bottom: 1px solid var(--ws-border);
  background: var(--ws-surface);
  font-size: 13px;
}
.desk {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  height: calc(100vh - var(--ws-bar));
}
.desk--narrow {
  grid-template-columns: minmax(0, 1fr);
  height: auto;
  min-height: calc(100vh - var(--ws-bar));
}
.desk__list {
  overflow-y: auto;
  border-right: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.views {
  position: sticky;
  z-index: 2;
  top: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.views__tab {
  min-height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--ws-radius);
  background: transparent;
  color: var(--ws-muted);
  cursor: pointer;
}
.views__tab[aria-selected='true'] {
  background: var(--ws-action-soft);
  color: var(--ws-action);
  font-weight: 600;
}
.tlist {
  margin: 0;
  padding: 4px 0;
  list-style: none;
}
.titem {
  display: grid;
  width: 100%;
  gap: 3px;
  padding: 10px 16px;
  border: 0;
  border-left: 3px solid transparent;
  background: transparent;
  color: var(--ws-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.titem:hover {
  background: var(--ws-sunken);
}
.titem--on,
.titem--on:hover {
  border-left-color: var(--ws-action);
  background: var(--ws-action-soft);
}
.titem__title {
  font-weight: 500;
  line-height: 1.45;
}
.titem__meta,
.titem__line {
  font-size: 12px;
}
.titem__line--warn {
  color: var(--ws-warning);
  font-weight: 500;
}
.desk__detail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  background: var(--ws-page);
}
.back {
  align-self: flex-start;
  margin: 8px 8px 0;
  color: var(--ws-action);
}
.need {
  display: grid;
  gap: 10px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.need__title {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.45;
}
.need__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 24px;
  margin: 0;
  font-size: 13px;
}
.need__meta div {
  display: flex;
  gap: 8px;
}
.need__meta dt {
  color: var(--ws-muted);
}
.need__meta dd {
  margin: 0;
}
.tasks {
  display: grid;
  gap: 8px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.task__main {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 13px;
}
.task__actions {
  display: flex;
  justify-content: flex-end;
}
.cands {
  display: grid;
  gap: 10px;
  padding: 16px 20px;
}
.cands__head h3 {
  font-size: 15px;
  font-weight: 600;
}
.cands__head p {
  margin-top: 2px;
  font-size: 12px;
}
.result {
  padding: 10px 12px;
  border-left: 3px solid var(--ws-danger);
  background: var(--ws-danger-soft);
  font-size: 13px;
}
.flash {
  margin: 8px 12px 0;
  padding: 8px 10px;
  border-left: 3px solid var(--ws-success);
  background: var(--ws-success-soft);
  font-size: 13px;
}
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-panel);
  background: var(--ws-surface);
}
.ctable {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
}
.ctable th {
  height: 36px;
  padding: 0 10px;
  border-bottom: 1px solid var(--ws-border);
  color: var(--ws-muted);
  font-size: 12px;
  font-weight: 500;
  text-align: left;
}
.ctable th:first-child,
.ctable td:first-child {
  width: 36px;
}
.ctable td {
  padding: 10px;
  border-bottom: 1px solid var(--ws-border);
  vertical-align: top;
}
.ctable tbody tr:last-child td {
  border-bottom: 0;
}
.ctable tbody tr:not(.row--blocked):not(.divider) {
  cursor: pointer;
}
.ctable tbody tr:not(.row--blocked):not(.divider):hover {
  background: var(--ws-page);
}
.row--on,
.ctable tbody tr.row--on:hover {
  background: var(--ws-action-soft);
}
.row--blocked td {
  color: var(--ws-muted);
}
.divider td {
  padding: 6px 10px;
  background: var(--ws-page);
  color: var(--ws-muted);
  font-size: 12px;
}
.who {
  display: grid;
  gap: 2px;
  cursor: inherit;
}
.who .muted {
  font-size: 12px;
}
.score {
  display: block;
  font-weight: 600;
}
.reasons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.reason {
  padding: 0 6px;
  border-radius: 3px;
  background: var(--ws-sunken);
  color: var(--ws-muted);
  font-size: 12px;
}
.num-col {
  white-space: nowrap;
}
.commit {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 16px;
  margin-top: auto;
  padding: 10px 20px;
  border-top: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.commit__sel {
  flex: 1;
  font-size: 13px;
}
.commit__hint {
  flex-basis: 100%;
  order: 3;
  font-size: 12px;
}
.swap {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 8px 12px;
  margin: 0;
  padding: 12px;
  border-radius: var(--ws-radius);
  background: var(--ws-page);
}
.swap dt {
  color: var(--ws-muted);
}
.swap dd {
  margin: 0;
}
@media (max-width: 899px) {
  .ctx {
    display: none;
  }
  .need,
  .tasks,
  .cands {
    padding-inline: 14px;
  }
}
</style>
