<script setup lang="ts">
/**
 * U2-2 专家专注评阅（真实模式，/expert/review?task_id=）。
 * 左：匿名稿（沿用 RealAnonymousDocumentPane）；右：评阅表单（ReviewDeskForm）。分栏可调，窄屏分段切换。
 * 装载、保存队列、冲突、最终提交全部来自 useReviewSession —— 与旧页同一份修复实现，本页只换布局。
 * 冲突（D1/D2）：先 GET 服务器草稿再展示差异；可复制本页、采用服务器版本、或核对后用本页内容重新保存。
 * 已提交：只读正式意见 + 更正面板（沿用 RealCorrectionPanel，更正稿手动保存、按更正 version 条件）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isNavigationFailure, useRouter } from 'vue-router'

import type { CheckAck } from '@/api/reviewChecks'
import ConfirmDialog from '@/components/workspace/ConfirmDialog.vue'
import FocusShell from '@/components/workspace/FocusShell.vue'
import SaveStatus from '@/components/workspace/SaveStatus.vue'
import SplitPane from '@/components/workspace/SplitPane.vue'
import StateBlock from '@/components/workspace/StateBlock.vue'
import StatusPill from '@/components/workspace/StatusPill.vue'
import type { DraftState, WorkspaceAccount } from '@/components/workspace/types'
import type { ReviewScoreInput } from '@/demo/types'
import RealCorrectionPanel from '@/modules/result/components/RealCorrectionPanel.vue'
import { useAuthStore } from '@/stores/auth'
import '@/styles/workspace.css'

import RealAnonymousDocumentPane from '../components/RealAnonymousDocumentPane.vue'
import { useReviewSession } from '../composables/useReviewSession'
import ReviewDeskForm from './ReviewDeskForm.vue'

const router = useRouter()
const auth = useAuthStore()
const session = useReviewSession({ service: null })
const {
  task, locked, saving, loadError, draft, rule, savedAt, saveFailed, latest,
  conflict, compared, formKey, submitPending, submitError, pendingInput, pendingAck,
  loadRealTask, edited, flushDraft, compareDraft, resolveConflict, confirmSubmit,
} = session

const account = computed<WorkspaceAccount>(() => ({
  name: auth.user?.displayName || '身份未取得',
  username: auth.user?.username ?? '',
  role: '评阅专家',
  org: '',
}))

const submitted = computed(() => task.value?.status === 'SUBMITTED')
const formLocked = computed(() => locked.value || submitted.value || submitPending.value)
const loading = computed(() => !task.value && !loadError.value)

const saveState = computed<DraftState>(() => {
  if (submitted.value) return 'locked'
  if (conflict.value) return 'conflict'
  if (saving.value) return 'saving'
  if (saveFailed.value) return 'failed'
  if (latest.value) return 'dirty'
  return savedAt.value ? 'saved' : 'clean'
})

// ---- 离开：路由守卫先 flush；没保存成功就留在本页 ----
const leaving = ref(false)
const leaveError = ref('')
async function leave() {
  if (leaving.value) return
  leaving.value = true
  leaveError.value = ''
  const result = await router.push('/expert/tasks')
  leaving.value = false
  if (isNavigationFailure(result)) {
    leaveError.value = conflict.value
      ? '内容冲突，没有离开本页。请先处理下面的冲突。'
      : submitPending.value
        ? '正在提交，暂时不能离开。'
        : '没有保存成功，已留在本页，你的输入还在。'
  }
}

async function retrySave() {
  leaveError.value = ''
  await flushDraft()
}

// ---- 冲突核对（D1/D2） ----
const fieldLabels: { key: keyof ReviewScoreInput; label: string }[] = [
  { key: 'overallComment', label: '总体评价' },
  { key: 'issues', label: '主要问题' },
  { key: 'revisionAdvice', label: '修改建议' },
  { key: 'strengths', label: '主要优点' },
  { key: 'recommendation', label: '评阅建议' },
]
const mine = computed<ReviewScoreInput | null>(() => latest.value ?? pendingInput.value ?? draft.value)
const show = (value: unknown) => (value === undefined || value === null || value === '' ? '（空）' : String(value))
const differences = computed(() => {
  const server = compared.value
  if (!server) return []
  const text = fieldLabels
    .filter(({ key }) => show(server[key]) !== show(mine.value?.[key]))
    .map(({ key, label }) => ({ key: String(key), label, mine: show(mine.value?.[key]), server: show(server[key]) }))
  const scores = (rule.value?.dimensions ?? [])
    .filter((item) => show(server[item.key]) !== show(mine.value?.[item.key]))
    .map((item) => ({ key: item.key, label: item.label, mine: show(mine.value?.[item.key]), server: show(server[item.key]) }))
  return [...text, ...scores]
})
const copied = ref(false)
function plain(input: ReviewScoreInput | null) {
  if (!input) return ''
  return fieldLabels.map(({ key, label }) => `${label}\n${show(input[key])}`).join('\n\n')
}
async function copyLocal() {
  try {
    await navigator.clipboard?.writeText(plain(mine.value))
    copied.value = true
  } catch {
    copied.value = false
  }
}
watch(conflict, (value) => {
  if (!value) copied.value = false
})

// ---- 最终提交 ----
const total = (input: ReviewScoreInput | null) =>
  (rule.value?.dimensions ?? []).reduce((sum, item) => sum + (Number(input?.[item.key]) || 0), 0)
const maxTotal = computed(() => (rule.value?.dimensions ?? []).reduce((sum, item) => sum + item.max_score, 0))
const bandOf = (value: number) => rule.value?.bands.find((item) => value >= item.min && value <= item.max) ?? null
const len = (value?: string) => Array.from((value ?? '').trim()).length

function requestSubmit(input: ReviewScoreInput, ack: CheckAck) {
  if (locked.value || submitPending.value) return
  pendingInput.value = input
  pendingAck.value = ack
  submitError.value = ''
}
function cancelSubmit() {
  if (submitPending.value) return
  pendingInput.value = null
  submitError.value = ''
}

// ---- 窄屏：论文 / 评阅 分段 ----
const narrow = ref(false)
const mobilePane = ref<'doc' | 'form'>('form')
let media: MediaQueryList | null = null
const syncMedia = () => (narrow.value = media?.matches ?? false)
onMounted(() => {
  if (typeof window.matchMedia !== 'function') return
  media = window.matchMedia('(max-width: 899px)')
  syncMedia()
  media.addEventListener('change', syncMedia)
})
onBeforeUnmount(() => media?.removeEventListener('change', syncMedia))

const result = computed(() => (submitted.value ? draft.value : null))
</script>

<template>
  <div class="ws">
    <FocusShell :account="account">
      <template #back>
        <button type="button" class="btn btn--quiet back" :disabled="leaving" data-action="back-to-tasks" @click="leave">‹ 我的任务</button>
      </template>
      <template #identity>
        <template v-if="task">
          <span class="code num">{{ task.anonymousId }}</span>
          <h1 class="rv-title">{{ task.anonymousTitle }}</h1>
          <span v-if="task.dueAt" class="due muted" data-review-deadline>截止 {{ task.dueAt }}（北京时间）</span>
          <StatusPill v-if="task.overdue && !submitted" tone="danger">已逾期，仍可保存和提交</StatusPill>
        </template>
        <h1 v-else class="rv-title">在线评阅</h1>
      </template>
      <template #status>
        <SaveStatus v-if="task" :state="saveState" :saved-at="savedAt" />
      </template>

      <StateBlock v-if="loading" kind="loading" title="正在载入评阅任务" />
      <StateBlock v-else-if="loadError" kind="forbidden" :title="loadError" data-review-load-error>
        任务可能已提交、被改派或终止。返回任务列表可以看到你名下当前的任务。
        <template #actions>
          <button type="button" class="btn" data-action="retry-review-load" @click="loadRealTask">重新加载</button>
          <RouterLink class="btn btn--primary" to="/expert/tasks">返回我的任务</RouterLink>
        </template>
      </StateBlock>

      <!-- 已正式提交：不再读取匿名稿，只留单栏的本人正式意见与更正入口 -->
      <div v-else-if="task && rule && submitted" class="final-wrap">
        <p class="final-wrap__note muted">已提交，匿名稿不再提供阅读。按规则，正式提交后不再读取论文材料。</p>
    <section class="final" aria-label="本人正式意见">
      <div class="final__head">
        <StatusPill tone="success">已正式提交</StatusPill>
        <span class="muted">内容已锁定，只能查看</span>
      </div>
      <dl v-if="result" class="final__body">
        <dt>总分</dt>
        <dd class="num">{{ total(result) }} / {{ maxTotal }}<template v-if="bandOf(total(result))">（规则结论：{{ bandOf(total(result))?.label }}）</template></dd>
        <dt>评阅建议</dt><dd>{{ result.recommendation }}</dd>
        <dt>总体评价</dt><dd class="pre">{{ result.overallComment }}</dd>
        <dt>主要问题</dt><dd class="pre">{{ result.issues }}</dd>
        <dt>修改建议</dt><dd class="pre">{{ result.revisionAdvice || '（未填写）' }}</dd>
        <dt>主要优点（不发布）</dt><dd class="pre">{{ result.strengths || '（未填写）' }}</dd>
        <dt>各项评分</dt>
        <dd>
          <ul class="final__scores">
            <li v-for="item in rule.dimensions" :key="item.key">
              <span>{{ item.label }}</span><span class="num">{{ result[item.key] }} / {{ item.max_score }}</span>
              <small v-if="result.evaluations?.[item.key]" class="muted">{{ result.evaluations[item.key] }}</small>
            </li>
          </ul>
        </dd>
      </dl>
      <div class="final__corr">
        <h2 class="sec">发现正式意见有误？</h2>
        <p class="muted">更正要先申请，平台批准后你提交更正内容，最后由学校确认。学校确认前，学生看到的仍是当前版本。更正稿不会自动保存。</p>
        <div class="corrpanel">
          <RealCorrectionPanel :key="task.id" mode="expert" :task-id="task.id" :dimensions="rule.dimensions" />
        </div>
      </div>
    </section>
      </div>

      <div v-else-if="task && rule" class="review" :class="{ 'review--narrow': narrow }">
        <nav v-if="narrow" class="mtabs" aria-label="评阅视图">
          <button type="button" :aria-pressed="mobilePane === 'doc'" @click="mobilePane = 'doc'">论文</button>
          <button type="button" :aria-pressed="mobilePane === 'form'" @click="mobilePane = 'form'">评阅</button>
        </nav>
        <SplitPane class="review__split" :stacked="narrow" :initial="0.6" :min-start="380" :min-end="420">
          <template #start>
            <div v-show="!narrow || mobilePane === 'doc'" class="pane-doc">
              <RealAnonymousDocumentPane :key="task.id" :task-id="task.id" />
            </div>
          </template>
          <template #end>
            <div v-show="!narrow || mobilePane === 'form'" class="pane-form">
              <div v-if="conflict" class="banner banner--danger" role="alert" data-review-conflict>
                <strong>这份草稿在另一个页签或设备上保存过更新的内容。</strong>
                <span>本页内容没有覆盖它，自动保存已暂停，你的输入仍在本页。先核对服务器版本，再决定保留哪一份。</span>
                <template v-if="compared">
                  <p class="muted">服务器版本 {{ compared.revision }}。{{ differences.length ? '以下是两边不同的内容：' : '两边内容一致。' }}</p>
                  <div v-for="item in differences" :key="item.key" class="diff">
                    <p class="diff__label">{{ item.label }}</p>
                    <div class="diff__cols">
                      <div><span class="muted">本页</span><p class="pre">{{ item.mine }}</p></div>
                      <div><span class="muted">服务器</span><p class="pre">{{ item.server }}</p></div>
                    </div>
                  </div>
                </template>
                <span class="banner__actions">
                  <button v-if="!compared" type="button" class="btn btn--sm btn--primary" data-action="compare-review-draft" @click="compareDraft">核对服务器版本</button>
                  <template v-else>
                    <button type="button" class="btn btn--sm" data-action="copy-local-review" @click="copyLocal">{{ copied ? '已复制' : '复制本页内容' }}</button>
                    <button type="button" class="btn btn--sm" data-action="accept-server-review" @click="resolveConflict(false)">采用服务器版本</button>
                    <button type="button" class="btn btn--sm btn--primary" data-action="save-compared-review" @click="resolveConflict(true)">已核对，用本页内容保存</button>
                  </template>
                </span>
              </div>
              <div v-else-if="saveFailed || leaveError" class="banner banner--danger" role="alert" data-review-save-failed>
                <strong>{{ leaveError || '保存没有确认，你的输入仍在本页。' }}</strong>
                <span v-if="!leaveError" class="muted">{{ session.notice.value }}</span>
                <span class="banner__actions">
                  <button type="button" class="btn btn--sm" data-action="retry-save-review" :disabled="saving" @click="retrySave">重新保存</button>
                </span>
              </div>

              <ReviewDeskForm
                :key="`${task.id}:${formKey}`"
                :locked="formLocked"
                :saving="saving"
                :leaving="leaving"
                :draft="draft"
                :rule="rule"
                :check-target="{ kind: 'task', id: task.id }"
                @edited="edited"
                @autosave="flushDraft"
                @submit="requestSubmit"
                @exit="leave"
              />

            </div>
          </template>
        </SplitPane>
      </div>
    </FocusShell>

    <ConfirmDialog :open="Boolean(pendingInput) && !locked" title="提交正式评阅意见？" wide :busy="submitPending" @close="cancelSubmit">
      <p>提交后以下内容会锁定，不能再修改；如需更正需要走更正申请。提交后不再提供匿名稿阅读。</p>
      <dl v-if="pendingInput" class="freeze">
        <dt>总分</dt>
        <dd class="num">{{ total(pendingInput) }} / {{ maxTotal }}<template v-if="bandOf(total(pendingInput))">，规则结论 {{ bandOf(total(pendingInput))?.label }}</template></dd>
        <dt>评阅建议</dt><dd>{{ pendingInput.recommendation }}</dd>
        <dt>评语</dt>
        <dd class="num">总体评价 {{ len(pendingInput.overallComment) }} 字，主要问题 {{ len(pendingInput.issues) }} 字，修改建议 {{ len(pendingInput.revisionAdvice) }} 字</dd>
      </dl>
      <p v-if="submitError" class="field-error" role="alert">{{ submitError }}</p>
      <template #actions>
        <button type="button" class="btn" data-action="cancel-submit-review" :disabled="submitPending" @click="cancelSubmit">继续修改</button>
        <button type="button" class="btn btn--primary" data-action="confirm-submit-review" :disabled="submitPending" @click="confirmSubmit">
          {{ submitPending ? '正在保存并提交…' : '确认提交' }}
        </button>
      </template>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.back {
  min-height: 32px;
  padding: 0 8px;
  color: var(--ws-action);
}
.code {
  flex: none;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--ws-sunken);
  color: var(--ws-muted);
  font-size: 12px;
}
.rv-title {
  min-width: 0;
  overflow: hidden;
  font-size: 15px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.due {
  flex: none;
  font-size: 13px;
}
.review {
  height: 100%;
}
.review--narrow {
  display: flex;
  flex-direction: column;
}
.review__split {
  height: 100%;
  min-height: 0;
}
.review--narrow .review__split {
  flex: 1;
  overflow: hidden;
}
.pane-doc,
.pane-form {
  height: 100%;
}
.pane-doc {
  overflow: auto;
  background: var(--ws-sunken);
}
.pane-form {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--ws-surface);
}
/* 沿用的匿名稿组件：去掉旧边框，阅读器占满左栏 */
.pane-doc :deep(.real-document) {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 0;
  background: var(--ws-sunken);
}
.pane-doc :deep(.real-document header) {
  padding: 8px 12px;
  border-bottom: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.pane-doc :deep(.real-document h2) {
  font-size: 14px;
  font-weight: 600;
}
.pane-doc :deep(.real-document > p) {
  padding: 6px 12px;
  color: var(--ws-muted);
  font-size: 12px;
}
.pane-doc :deep(.real-document iframe) {
  flex: 1;
  height: auto;
  min-height: 0;
}
.banner {
  display: grid;
  gap: 6px;
  margin: 12px 12px 0;
  padding: 10px 12px;
  border-left: 3px solid var(--ws-danger);
  border-radius: 0 var(--ws-radius) var(--ws-radius) 0;
  background: var(--ws-danger-soft);
  font-size: 13px;
}
.banner__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.diff {
  display: grid;
  gap: 4px;
  margin-top: 6px;
}
.diff__label {
  font-weight: 600;
}
.diff__cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.diff__cols > div {
  max-height: 160px;
  overflow: auto;
  padding: 6px 8px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius);
  background: var(--ws-surface);
  font-size: 13px;
}
.pre {
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.final-wrap {
  height: 100%;
  overflow-y: auto;
  background: var(--ws-page);
}
.final-wrap__note {
  max-width: 760px;
  margin: 0 auto;
  padding: 16px 16px 0;
  font-size: 13px;
}
.final {
  display: grid;
  align-content: start;
  gap: 16px;
  max-width: 760px;
  margin: 12px auto 32px;
  padding: 20px 24px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-panel);
  background: var(--ws-surface);
}
.final__head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 13px;
}
.final__body {
  display: grid;
  gap: 4px;
  margin: 0;
}
.final__body dt {
  margin-top: 8px;
  color: var(--ws-muted);
  font-size: 12px;
}
.final__body dd {
  margin: 0;
  line-height: 1.7;
}
.final__scores {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
}
.final__scores li {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0 12px;
}
.final__scores small {
  grid-column: 1 / -1;
}
.final__corr {
  display: grid;
  gap: 8px;
  padding-top: 16px;
  border-top: 1px solid var(--ws-border);
  font-size: 13px;
}
.sec {
  font-size: 14px;
  font-weight: 600;
}
/* 沿用的更正面板：版本条件与手动保存不变，只换成工作空间的字号与按钮 */
.corrpanel :deep(button) {
  min-height: var(--ws-control);
  padding: 0 12px;
  border: 1px solid var(--ws-border-strong);
  border-radius: var(--ws-radius);
  background: var(--ws-surface);
  color: var(--ws-text);
  font: inherit;
  cursor: pointer;
}
.corrpanel :deep(button:disabled) {
  color: var(--ws-faint);
  cursor: not-allowed;
}
.corrpanel :deep(textarea) {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--ws-border-strong);
  border-radius: var(--ws-radius);
  font: inherit;
}
.freeze {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 6px 12px;
  margin: 0;
  padding: 12px;
  border-radius: var(--ws-radius);
  background: var(--ws-page);
  font-size: 13px;
}
.freeze dt {
  color: var(--ws-muted);
}
.freeze dd {
  margin: 0;
}
.mtabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-bottom: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.mtabs button {
  min-height: 44px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--ws-muted);
}
.mtabs button[aria-pressed='true'] {
  border-bottom-color: var(--ws-action);
  color: var(--ws-text);
  font-weight: 600;
}
@media (max-width: 899px) {
  .rv-title,
  .due {
    display: none;
  }
}
@media (max-width: 640px) {
  .diff__cols {
    grid-template-columns: 1fr;
  }
}
</style>
