<script setup lang="ts">
/**
 * U4-7 更正审批（真实模式，P13）：申请清单｜申请对象。
 * 平台只看申请信息（E5）：任务编号、申请时间、申请理由与处理记录、状态；不渲染 revision，不显示更正前后对照。
 * 批准与驳回都要原因；409 时重读并说明当前状态。地址：?view= &correction=。
 * demo 模式与旧页 CorrectionApprovalPage 不变（见 router/routes.ts）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { listCorrections, type Correction } from '@/api/corrections'
import { apiFailure } from '@/api/failure'
import ViewTabs, { type ViewOption } from '@/components/app/data/ViewTabs.vue'
import AppShell from '@/components/app/shell/AppShell.vue'
import { useSignOut } from '@/components/app/shell/useSignOut'
import StatePanel from '@/components/app/state/StatePanel.vue'
import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/workspace/ConfirmDialog.vue'
import MasterDetail from '@/components/workspace/MasterDetail.vue'
import StatusPill from '@/components/workspace/StatusPill.vue'
import type { WorkspaceAccount } from '@/components/workspace/types'
import { useNarrow } from '@/components/workspace/useNarrow'
import { workspaceNav } from '@/router/workspaceNav'
import { useAuthStore } from '@/stores/auth'
import '@/styles/workspace.css'

import { inView, isPending, laterNotes, progress, requestReason, shortTask, statusText, statusTone, steps, when, type ViewKey } from './correctionView'
import { usePlatformCorrection, type PlatformDecision } from './usePlatformCorrection'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const narrow = useNarrow()
const command = usePlatformCorrection()

const rows = ref<Correction[]>([])
const loading = ref(true)
const error = ref('')
let generation = 0
onBeforeUnmount(() => generation++)

async function load(): Promise<Correction[] | null> {
  const request = ++generation
  loading.value = true
  error.value = ''
  try {
    const items = await listCorrections('platform', { quiet: true })
    if (request !== generation) return null
    rows.value = items
    return items
  } catch (reason) {
    if (request !== generation) return null
    error.value = apiFailure(reason).message
    return null
  } finally {
    if (request === generation) loading.value = false
  }
}
void load()

const views: { key: ViewKey; label: string }[] = [
  { key: 'pending', label: '待审批' },
  { key: 'done', label: '已处理' },
  { key: 'all', label: '全部' },
]
const view = computed<ViewKey>(() => views.find((item) => item.key === route.query.view)?.key ?? 'pending')
const correctionId = computed(() => (typeof route.query.correction === 'string' ? route.query.correction : ''))
function setQuery(patch: Record<string, string | undefined>) {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...route.query, ...patch })) if (typeof value === 'string' && value) next[key] = value
  void router.replace({ query: next })
}

const ready = computed(() => !loading.value && !error.value)
const countOf = (key: ViewKey) => rows.value.filter((row) => inView(row, key)).length
const viewTabs = computed<ViewOption[]>(() => views.map((v) => ({ value: v.key, label: v.label, count: ready.value ? countOf(v.key) : undefined })))
const list = computed(() => rows.value.filter((row) => inView(row, view.value)))
const selected = computed(() => rows.value.find((row) => row.id === correctionId.value) ?? null)
const step = computed(() => (selected.value ? progress(selected.value.status) : null))

watch([ready, list, narrow], () => {
  if (!ready.value || narrow.value || correctionId.value || !list.value.length) return
  setQuery({ correction: list.value[0]!.id })
})

const flash = ref('')
const notice = ref<{ tone: 'warn' | 'danger'; title: string; body: string } | null>(null)
watch(correctionId, () => {
  flash.value = ''
  notice.value = null
})
const decision = ref<PlatformDecision | null>(null)
const reason = ref('')
const tried = ref(false)
const decisionError = ref('')
const reasonError = computed(() => {
  if (!tried.value) return ''
  if (!reason.value.trim()) return decision.value === 'APPROVE' ? '请填写批准说明。' : '请填写驳回原因。'
  return reason.value.trim().length > 2000 ? '不超过 2000 个字。' : ''
})
function ask(next: PlatformDecision) {
  decision.value = next
  tried.value = false
  decisionError.value = ''
}
function closeDialog() {
  if (!command.pending.value) decision.value = null
}
async function decide() {
  tried.value = true
  const row = selected.value
  const chosen = decision.value
  if (!row || !chosen || reasonError.value) return
  flash.value = ''
  notice.value = null
  decisionError.value = ''
  const outcome = await command.decide(row, chosen, reason.value)
  if (!outcome) return
  if (outcome.ok) {
    decision.value = null
    reason.value = ''
    flash.value = chosen === 'APPROVE' ? '已批准。专家现在可以起草更正稿，提交后交学校核对确认。' : '已驳回。专家会看到驳回原因，原评阅结果不变。'
    await load()
    return
  }
  if (outcome.status !== 409 && outcome.status !== 404) {
    decisionError.value = outcome.message
    return
  }
  decision.value = null
  const fresh = (await load())?.find((item) => item.id === row.id)
  if (!fresh) return
  if (!isPending(fresh)) {
    reason.value = ''
    notice.value = { tone: 'warn', title: '这条申请已被处理', body: `当前状态：${statusText[fresh.status]}。你不需要再操作。` }
  } else notice.value = { tone: 'danger', title: '没有保存', body: `${outcome.message}。已读回最新记录，请核对后重新操作；你写的原因还在。` }
}

const signOut = useSignOut()
const nav = computed(() => workspaceNav('platform_reviewer', '/platform/corrections', { '/platform/corrections': ready.value ? countOf('pending') : undefined }))
const account = computed<WorkspaceAccount>(() => ({ name: auth.user?.displayName || '身份未取得', username: auth.user?.username ?? '', role: '百杰审核', org: '百杰运营' }))
</script>

<template>
  <div class="ws">
    <AppShell :nav="nav" :account="account" :workspace="account.org" layout="bare" title="更正审批" @sign-out="signOut">
      <template #context><span>专家对已发布评阅的更正申请</span></template>

      <MasterDetail :open="Boolean(correctionId)" :narrow="narrow" list-label="更正申请清单" detail-label="当前申请" back-label="申请清单" @back="setQuery({ correction: undefined })">
        <template #list>
          <div class="wsd-lhead">
            <ViewTabs :model-value="view" :views="viewTabs" label="视图" size="sm" @select="setQuery({ view: $event === 'pending' ? undefined : $event, correction: undefined })" />
          </div>
          <StatePanel v-if="loading && !rows.length" kind="loading" title="正在读取更正申请…" compact />
          <StatePanel v-else-if="error" kind="error" title="更正申请没有加载出来" compact>
            {{ error }}
            <template #actions><Button type="button" variant="outline" @click="load">重试</Button></template>
          </StatePanel>
          <StatePanel v-else-if="!rows.length" kind="empty" title="还没有更正申请" compact>专家在已发布的任务里申请更正后，会出现在这里。</StatePanel>
          <StatePanel v-else-if="!list.length" kind="empty" :title="view === 'pending' ? '待审批的申请都已处理' : '这个视图里没有申请'" compact />
          <ul v-else class="wsd-tlist">
            <li v-for="row in list" :key="row.id">
              <button type="button" class="wsd-titem" :class="{ 'wsd-titem--on': row.id === correctionId }" :aria-current="row.id === correctionId || undefined" @click="setQuery({ correction: row.id })">
                <span class="wsd-titem__title num">任务 {{ shortTask(row) }}</span>
                <span class="wsd-titem__meta num">申请于 {{ when(row.created_at) }}</span>
                <span class="wsd-titem__line"><StatusPill :tone="statusTone(row.status)">{{ statusText[row.status] }}</StatusPill></span>
              </button>
            </li>
          </ul>
        </template>

        <template #empty>
          <StatePanel v-if="ready && rows.length" kind="empty" title="从左侧选择一条申请" compact />
        </template>

        <StatePanel v-if="loading && !selected" kind="loading" title="正在读取更正申请…" />
        <StatePanel v-else-if="error && !selected" kind="error" title="更正申请没有加载出来，暂时不能打开">
          <template #actions><Button type="button" variant="outline" @click="load">重试</Button></template>
        </StatePanel>
        <StatePanel v-else-if="!selected" kind="forbidden" title="这条更正申请已不可见">
          链接可能已过期。申请清单已是最新。
          <template #actions><Button type="button" variant="outline" @click="setQuery({ correction: undefined })">回到申请清单</Button></template>
        </StatePanel>
        <template v-else>
          <div class="wsd-obj">
            <header class="wsd-obj__head">
              <div class="wsd-obj__row"><StatusPill :tone="statusTone(selected.status)">{{ statusText[selected.status] }}</StatusPill></div>
              <h2 class="wsd-obj__title num">任务 {{ shortTask(selected) }} 的更正申请</h2>
              <dl class="wsd-obj__meta">
                <div><dt>任务编号</dt><dd class="num">{{ selected.task_id }}</dd></div>
                <div><dt>申请时间</dt><dd class="num">{{ when(selected.created_at) }}</dd></div>
              </dl>
            </header>
            <div v-if="flash" class="wsd-banner wsd-banner--ok" role="status">{{ flash }}</div>
            <div v-if="notice" class="wsd-banner" :class="`wsd-banner--${notice.tone}`" role="alert" data-notice>
              <strong>{{ notice.title }}</strong>
              <span>{{ notice.body }}</span>
            </div>

            <ol v-if="step" class="steps" aria-label="更正进度" data-progress>
              <li v-for="(label, index) in steps" :key="label" :class="{ done: index < step.step, now: index === step.step && !step.ended, stop: index === step.step && step.ended }">
                <span class="dot" aria-hidden="true" />{{ label }}<span v-if="index === step.step" class="sr-only">{{ step.ended ? '（在此终止）' : '（当前）' }}</span>
              </li>
            </ol>
            <p v-if="step?.ended" class="wsd-hint ended">{{ step.ended }}</p>

            <section class="wsd-sec" aria-labelledby="rq-h" data-request>
              <div class="wsd-sec__head"><h3 id="rq-h">申请理由</h3><p>专家原文</p></div>
              <p class="wsd-plain reason">{{ requestReason(selected) || '没有记录申请理由' }}</p>
            </section>
            <section v-if="laterNotes(selected).length" class="wsd-sec" aria-labelledby="nt-h" data-notes>
              <div class="wsd-sec__head"><h3 id="nt-h">处理记录</h3></div>
              <ul class="notes">
                <li v-for="(note, index) in laterNotes(selected)" :key="index"><strong>{{ note.label }}</strong><span class="wsd-plain">{{ note.reason }}</span></li>
              </ul>
            </section>
            <p class="wsd-hint">平台审批只看申请信息。更正前后的具体内容由学校在结果处理页核对确认，这里不显示。</p>
          </div>
          <footer v-if="selected.status === 'REQUESTED'" class="wsd-commit">
            <p class="wsd-commit__text">批准后专家起草更正稿；驳回则原评阅结果不变。</p>
            <Button type="button" variant="outline" data-action="reject-correction" :disabled="command.pending.value" @click="ask('REJECT')">驳回…</Button>
            <Button type="button" data-action="approve-correction" :disabled="command.pending.value" @click="ask('APPROVE')">批准…</Button>
          </footer>
        </template>
      </MasterDetail>

      <ConfirmDialog :open="Boolean(decision) && Boolean(selected)" :title="decision === 'APPROVE' ? '批准更正申请' : '驳回更正申请'" :busy="command.pending.value" @close="closeDialog">
        <p v-if="decision === 'APPROVE'">批准后，专家可以起草更正稿；提交后交学校核对确认。学校确认前，已发布的原结果继续有效。</p>
        <p v-else>驳回后原评阅结果不变，专家会看到驳回原因。</p>
        <label class="field">
          <span>{{ decision === 'APPROVE' ? '批准说明' : '驳回原因' }}（专家可见）</span>
          <textarea v-model="reason" class="textarea" rows="3" maxlength="2100" data-field="decision-reason" :disabled="command.pending.value" :aria-invalid="Boolean(reasonError)" />
          <small v-if="reasonError" class="field-error">{{ reasonError }}</small>
        </label>
        <p v-if="decisionError" class="field-error" role="alert">{{ decisionError }}</p>
        <template #actions>
          <Button type="button" variant="outline" :disabled="command.pending.value" @click="closeDialog">取消</Button>
          <Button type="button" variant="outline" :class="decision === 'APPROVE' ? 'btn--primary' : 'btn--danger'" data-action="confirm-decision" :disabled="command.pending.value" @click="decide">{{ decision === 'APPROVE' ? '批准' : '驳回' }}</Button>
        </template>
      </ConfirmDialog>
    </AppShell>
  </div>
</template>

<style scoped>
.reason {
  line-height: 1.75;
}
.notes {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
}
.notes li {
  display: grid;
  gap: 2px;
}
.notes strong {
  font-weight: 600;
}
.steps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 20px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--ws-muted);
  font-size: 13px;
}
.steps li {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
.dot {
  width: 8px;
  height: 8px;
  border: 1.5px solid currentColor;
  border-radius: 50%;
}
.steps .done {
  color: var(--ws-success);
}
.steps .done .dot {
  background: currentColor;
}
.steps .now {
  color: var(--ws-action);
  font-weight: 600;
}
.steps .now .dot {
  background: currentColor;
}
.steps .stop {
  color: var(--ws-danger);
}
.ended {
  margin-top: -8px;
}
</style>
