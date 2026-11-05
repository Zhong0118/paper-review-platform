<script setup lang="ts">
/**
 * U2-6 学生正式反馈（真实模式，/student/results?thesisId=）：只读已发布快照 + 本人异议。
 * - 只有 COMPLETED 的论文有正式反馈；其余显示“还没有发布”，不提前透露分数或评语。
 * - 发布快照按 schema 版本解读（publishedFeedback.ts）；无法识别 → 整页按接口错误处理（D7）。
 * - 异议：服务端给 SUBMIT_OBJECTION 且没有未结异议时才可登记；理由与诉求都必填；一次尝试幂等键稳定。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { createObjection, listMyObjections, type ObjectionRow } from '@/api/objections'
import { getPublishedResult } from '@/api/results'
import { listTheses, type ThesisDetail } from '@/api/theses'
import ConfirmDialog from '@/components/workspace/ConfirmDialog.vue'
import PersonalShell from '@/components/workspace/PersonalShell.vue'
import StateBlock from '@/components/workspace/StateBlock.vue'
import StatusPill from '@/components/workspace/StatusPill.vue'
import { useTimeScope } from '@/composables/useTimeScope'
import { studentAccount, studentNav } from '@/modules/thesis/workspace/studentShell'
import { failureText } from '@/api/failure'
import { useAuthStore } from '@/stores/auth'
import '@/styles/workspace.css'

import FeedbackArticle from './FeedbackArticle.vue'
import { readPublished, type FeedbackView } from './publishedFeedback'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const timeScope = useTimeScope()
const statusOf = (error: unknown) => (error as { response?: { status?: number } })?.response?.status
const messageOf = (error: unknown, fallback: string) => failureText(error, fallback)

const theses = ref<ThesisDetail[]>([])
const listLoading = ref(true)
const listError = ref('')
const published = computed(() => theses.value.filter((thesis) => thesis.stage === 'COMPLETED'))
const queryId = computed(() => (typeof route.query.thesisId === 'string' ? route.query.thesisId : ''))
const thesis = computed(() => theses.value.find((row) => row.id === queryId.value) ?? null)
const title = computed(() => thesis.value?.current_version?.title || '本人论文')
const context = computed(() => [thesis.value?.review_batch?.name ?? thesis.value?.batch_name ?? ''].filter(Boolean))

type Load = { kind: 'idle' | 'loading' | 'unpublished' | 'error' | 'invalid' } | { kind: 'ready'; view: FeedbackView }
const state = ref<Load>({ kind: 'idle' })
const loadError = ref('')
let listGeneration = 0
let resultGeneration = 0

async function loadList() {
  const own = ++listGeneration
  listLoading.value = true
  listError.value = ''
  try {
    const rows = await listTheses(...timeScope.request())
    if (own !== listGeneration) return
    theses.value = rows
    if (!queryId.value && published.value[0]) await router.replace({ query: { ...route.query, thesisId: published.value[0].id } })
    // 地址里的选择可能刚被补上：两条路都在这里取结果，监听在清单加载期间不触发
    void loadResult()
  } catch (error) {
    if (own === listGeneration) listError.value = messageOf(error, '本人论文没有加载出来')
  } finally {
    if (own === listGeneration) listLoading.value = false
  }
}

async function loadResult() {
  const own = ++resultGeneration
  objections.value = []
  objectionError.value = ''
  objectionNotice.value = ''
  const id = queryId.value
  if (!id) {
    state.value = { kind: 'idle' }
    return
  }
  // 清单里能看到且尚未完成的论文：不请求结果，直接说明未发布
  if (thesis.value && thesis.value.stage !== 'COMPLETED') {
    state.value = { kind: 'unpublished' }
    return
  }
  state.value = { kind: 'loading' }
  try {
    const data = await getPublishedResult(id, { quiet: true })
    if (own !== resultGeneration) return
    const view = readPublished(data)
    state.value = view ? { kind: 'ready', view } : { kind: 'invalid' }
    if (view) void loadObjections(id)
  } catch (error) {
    if (own !== resultGeneration) return
    if (statusOf(error) === 404 || statusOf(error) === 403) state.value = { kind: 'unpublished' }
    else {
      loadError.value = messageOf(error, '评阅结果没有加载出来')
      state.value = { kind: 'error' }
    }
  }
}

watch([timeScope.scope, () => auth.user?.id], () => void loadList(), { immediate: true })
watch(queryId, (value, old) => { if (value !== old && !listLoading.value) void loadResult() })
onBeforeUnmount(() => { listGeneration++; resultGeneration++ })

function choose(id: string) {
  void router.replace({ query: { ...route.query, thesisId: id } })
}

// ---- 异议 ----
const objections = ref<ObjectionRow[]>([])
const objectionError = ref('')
const objectionNotice = ref('')
const latest = computed(() => objections.value[0] ?? null)
const open = computed(() => Boolean(latest.value && ['SUBMITTED', 'PROCESSING'].includes(latest.value.status)))
const canObject = computed(() => Boolean(thesis.value?.allowed_actions.includes('SUBMIT_OBJECTION')) && !open.value)
const OBJECTION_TEXT: Record<string, string> = { SUBMITTED: '已登记，等待学校受理', PROCESSING: '学校处理中', RESOLVED: '学校已办结' }
const CHANNEL_TEXT: Record<string, string> = { ONLINE: '线上处理', OFFLINE: '线下处理' }

async function loadObjections(id: string) {
  objectionError.value = ''
  try {
    const rows = await listMyObjections(id)
    if (id === queryId.value) objections.value = rows
  } catch (error) {
    if (id === queryId.value) objectionError.value = messageOf(error, '异议记录没有加载出来')
  }
}

const reason = ref('')
const request = ref('')
const formError = ref('')
const confirmOpen = ref(false)
const submitting = ref(false)
const submitError = ref('')
let attempt: { signature: string; key: string } | null = null

function openConfirm() {
  formError.value = !reason.value.trim() ? '请写明异议理由。' : !request.value.trim() ? '请写明希望学校如何处理。' : ''
  if (formError.value) return
  submitError.value = ''
  confirmOpen.value = true
}

async function submitObjection() {
  const id = queryId.value
  if (!id || submitting.value) return
  const body = { reason: reason.value.trim(), request: request.value.trim() }
  const signature = `${id}\n${body.reason}\n${body.request}`
  if (attempt?.signature !== signature) attempt = { signature, key: crypto.randomUUID() }
  submitting.value = true
  submitError.value = ''
  try {
    await createObjection(id, body, { idempotencyKey: attempt.key, quiet: true })
    attempt = null
    confirmOpen.value = false
    reason.value = ''
    request.value = ''
    objectionNotice.value = '异议已登记。学校受理后，这里会更新处理状态。'
    await loadObjections(id)
  } catch (error) {
    if (statusOf(error) === 409) {
      attempt = null
      confirmOpen.value = false
      await loadObjections(id)
      objectionNotice.value = '这篇论文已有未办结的异议，没有重复登记。'
    } else {
      submitError.value = `${messageOf(error, '请求失败')}。异议没有登记，可以重试。`
    }
  } finally {
    submitting.value = false
  }
}

const nav = computed(() => studentNav('/student/results'))
const account = computed(() => studentAccount(auth.user))
</script>

<template>
  <div class="ws">
    <PersonalShell :nav="nav" :account="account" width="reading">
      <div class="toolbar">
        <label v-if="published.length > 1" class="picker">
          <span>论文</span>
          <select class="select" :value="queryId" data-thesis-picker @change="choose(($event.target as HTMLSelectElement).value)">
            <option v-for="row in published" :key="row.id" :value="row.id">{{ row.current_version?.title || '未命名论文' }}</option>
          </select>
        </label>
        <label class="scope">
          <span class="sr-only">论文范围</span>
          <select class="select" :value="timeScope.scope.value" data-time-scope @change="timeScope.setScope(($event.target as HTMLSelectElement).value)">
            <option value="all">全部年份</option>
            <option value="past_year">近一年</option>
          </select>
        </label>
      </div>

      <StateBlock v-if="listLoading || state.kind === 'loading'" kind="loading" title="正在载入正式反馈" />
      <StateBlock v-else-if="listError" kind="error" title="本人论文没有加载出来">
        {{ listError }}
        <template #actions><button type="button" class="btn" data-action="retry-feedback" @click="loadList">重试</button></template>
      </StateBlock>
      <StateBlock v-else-if="state.kind === 'idle'" kind="empty" title="还没有已发布的评阅结果">
        学校发布结果后，正式反馈会出现在这里。
        <template #actions><RouterLink class="btn" to="/student/dashboard">回到我的送审</RouterLink></template>
      </StateBlock>
      <StateBlock v-else-if="state.kind === 'unpublished'" kind="empty" title="这篇论文的评阅结果还没有发布" data-unpublished>
        学校发布后会在这里显示正式反馈。发布前看不到分数或评语，这不代表评阅进度。
        <template #actions><RouterLink class="btn" to="/student/dashboard">回到我的送审</RouterLink></template>
      </StateBlock>
      <StateBlock v-else-if="state.kind === 'invalid'" kind="error" title="这份评阅结果暂时无法显示" data-feedback-invalid>
        结果数据的格式无法识别，为避免显示错误内容，本页没有展示任何部分。请稍后再试；如果一直如此，请联系学校。
        <template #actions><RouterLink class="btn" to="/student/dashboard">回到我的送审</RouterLink></template>
      </StateBlock>
      <StateBlock v-else-if="state.kind === 'error'" kind="error" title="评阅结果没有加载出来">
        {{ loadError }}
        <template #actions><button type="button" class="btn" data-action="retry-feedback" @click="loadResult">重试</button></template>
      </StateBlock>

      <FeedbackArticle v-else-if="state.kind === 'ready'" :view="state.view" :title="title" :context="context">
        <section class="objection" aria-labelledby="objection-head">
          <h2 id="objection-head">对这份结果有异议？</h2>
          <p v-if="objectionNotice" class="ok" role="status" data-objection-notice>{{ objectionNotice }}</p>
          <p v-if="objectionError" class="err" role="alert">
            {{ objectionError }}
            <button type="button" class="btn btn--sm" @click="loadObjections(queryId)">重试</button>
          </p>
          <div v-if="latest" class="record" data-objection-status>
            <p><StatusPill :tone="latest.status === 'RESOLVED' ? 'success' : 'action'">{{ OBJECTION_TEXT[latest.status] ?? latest.status }}</StatusPill></p>
            <dl>
              <dt>你的理由</dt><dd class="pre">{{ latest.reason }}</dd>
              <template v-if="latest.request"><dt>处理诉求</dt><dd class="pre">{{ latest.request }}</dd></template>
              <template v-if="latest.status === 'RESOLVED'">
                <dt>学校结论</dt><dd class="pre">{{ latest.conclusion || '学校未填写结论' }}<span v-if="latest.channel" class="muted">（{{ CHANNEL_TEXT[latest.channel] ?? latest.channel }}）</span></dd>
              </template>
            </dl>
          </div>
          <template v-if="canObject && !objectionError">
            <p class="muted">异议由学校处理。登记异议不会自动改变分数，也不会让专家重新评阅。</p>
            <label class="field">
              <span>异议理由</span>
              <textarea v-model="reason" class="textarea" name="objectionReason" placeholder="写明你对哪一部分有异议，以及理由" />
            </label>
            <label class="field">
              <span>处理诉求</span>
              <textarea v-model="request" class="textarea" name="objectionRequest" placeholder="例如：请学校复核第三章的评分" />
            </label>
            <p v-if="formError" class="field-error" role="alert" data-objection-error>{{ formError }}</p>
            <button type="button" class="btn btn--primary" data-action="open-objection" @click="openConfirm">登记异议…</button>
          </template>
          <p v-else-if="!latest && !objectionError" class="muted" data-objection-closed>这篇论文当前不能登记异议。如有疑问，请联系学院研究生秘书。</p>
        </section>
      </FeedbackArticle>
    </PersonalShell>

    <ConfirmDialog :open="confirmOpen" title="登记这份异议？" :busy="submitting" @close="confirmOpen = false">
      <p>登记后不能撤回；同一篇论文同时只能有一份未办结的异议。学校处理完成后，你会在这里看到结论。</p>
      <p v-if="submitError" class="err" role="alert" data-objection-submit-error>{{ submitError }}</p>
      <template #actions>
        <button type="button" class="btn" :disabled="submitting" @click="confirmOpen = false">继续修改</button>
        <button type="button" class="btn btn--primary" data-action="confirm-objection" :disabled="submitting" @click="submitObjection">{{ submitting ? '正在登记…' : '确认登记' }}</button>
      </template>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  font-size: 13px;
}
.picker {
  display: flex;
  flex: 1;
  gap: 8px;
  align-items: center;
  min-width: 0;
}
.picker .select {
  min-width: 0;
  max-width: 100%;
}
.scope {
  margin-left: auto;
}
.objection {
  display: grid;
  gap: 10px;
  justify-items: start;
  max-width: 42em;
  padding-top: 24px;
  border-top: 1px solid var(--ws-border);
}
.objection h2 {
  font-size: 16px;
  font-weight: 650;
}
.objection .field {
  width: 100%;
}
.record {
  display: grid;
  gap: 8px;
  width: 100%;
  padding: 12px 14px;
  border-radius: var(--ws-radius);
  background: var(--ws-page);
}
.record dl {
  display: grid;
  grid-template-columns: 5em 1fr;
  gap: 6px 12px;
  margin: 0;
  font-size: 14px;
}
.record dt {
  color: var(--ws-muted);
}
.record dd {
  margin: 0;
}
.pre {
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.ok {
  padding: 8px 12px;
  border-left: 3px solid var(--ws-success);
  background: var(--ws-success-soft);
  font-size: 14px;
}
.err {
  padding: 8px 12px;
  border-left: 3px solid var(--ws-danger);
  background: var(--ws-danger-soft);
  font-size: 14px;
}
</style>
