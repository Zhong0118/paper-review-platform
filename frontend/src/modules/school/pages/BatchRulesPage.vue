<script setup lang="ts">
import BatchDeadlines from "../components/BatchDeadlines.vue"
import BatchProgramPin from '../components/BatchProgramPin.vue'
import BatchCloseout from '../components/BatchCloseout.vue'
import { onMounted, reactive, ref } from 'vue'
import {
  archiveBatch, closeBatch, createBatch, getSchoolReviewRule, listBatches, openBatch, updateBatch,
  type ReviewBatch,
} from '@/api/schoolOperations'
import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { portalMenus } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'
import type { ReviewRule } from '@/api/review'

const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true'
const authStore = useAuthStore()
const rows = ref<ReviewBatch[]>([])
const rule = ref<ReviewRule | null>(null)
const ruleError = ref('')
const closeoutId = ref(''), programBatch = ref(''), clockBatch = ref('')
const loading = ref(!demoEnabled)
const saving = ref(false)
const listError = ref('')
const actionError = ref('')
const feedback = ref('')
const formMode = ref<'create' | 'edit' | null>(null)
const editing = ref<ReviewBatch | null>(null)
const form = reactive({ code: '', name: '', startAt: '', endAt: '' })
const scoreRules = [['选题价值', 15], ['文献与理论基础', 15], ['研究方法', 20], ['创新性', 25], ['研究成果与工作量', 15], ['写作与学术规范', 10]] as const

function errorText(error: unknown) {
  if ((error as { response?: { status?: number } })?.response?.status === 409) return '数据已变更，请刷新后重试。'
  return error instanceof Error ? error.message : '操作未完成，请重试。'
}

async function loadRule() {
  if (demoEnabled) return
  rule.value = null
  ruleError.value = ''
  try { rule.value = await getSchoolReviewRule() }
  catch (error) { ruleError.value = errorText(error) }
}

function toLocal(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function toIso(value: string) {
  return value ? new Date(value).toISOString() : null
}

async function loadBatches() {
  if (demoEnabled) return true
  loading.value = true
  listError.value = ''
  rows.value = []
  try {
    rows.value = await listBatches()
    return true
  } catch (error) {
    listError.value = errorText(error)
    return false
  } finally {
    loading.value = false
  }
}

function refreshBatches() {
  actionError.value = ''
  feedback.value = ''
  void loadBatches()
}

function openCreate() {
  editing.value = null
  Object.assign(form, { code: '', name: '', startAt: '', endAt: '' })
  actionError.value = ''
  feedback.value = ''
  formMode.value = 'create'
}

function openEdit(row: ReviewBatch) {
  editing.value = row
  Object.assign(form, { code: row.code, name: row.name, startAt: toLocal(row.start_at), endAt: toLocal(row.end_at) })
  actionError.value = ''
  feedback.value = ''
  formMode.value = 'edit'
}

async function submitBatch() {
  if (saving.value || !formMode.value) return
  saving.value = true
  actionError.value = ''
  feedback.value = ''
  try {
    const body = { name: form.name.trim(), start_at: toIso(form.startAt), end_at: toIso(form.endAt) }
    if (formMode.value === 'create') {
      await createBatch({ code: form.code.trim(), ...body }, { idempotencyKey: crypto.randomUUID() })
    } else if (editing.value) {
      await updateBatch(editing.value.id, { ...body, expected_version: editing.value.version })
    }
    formMode.value = null
    editing.value = null
    if (await loadBatches()) feedback.value = '批次已保存。'
  } catch (error) {
    actionError.value = errorText(error)
    if ((error as { response?: { status?: number } })?.response?.status === 409) {
      if (formMode.value === 'edit') {
        formMode.value = null
        editing.value = null
      }
      await loadBatches()
    }
  } finally {
    saving.value = false
  }
}

async function runCommand(row: ReviewBatch, action: 'OPEN' | 'CLOSE_SUBMISSIONS' | 'ARCHIVE') {
  if (saving.value) return
  saving.value = true
  actionError.value = ''
  feedback.value = ''
  try {
    const options = { idempotencyKey: crypto.randomUUID() }
    if (action === 'OPEN') await openBatch(row.id, row.version, options)
    else if (action === 'CLOSE_SUBMISSIONS') await closeBatch(row.id, row.version, options)
    else await archiveBatch(row.id, row.version, options)
    if (await loadBatches()) feedback.value = '批次状态已更新。'
  } catch (error) {
    actionError.value = errorText(error)
    if ((error as { response?: { status?: number } })?.response?.status === 409) await loadBatches()
  } finally {
    saving.value = false
  }
}

onMounted(() => { void loadBatches(); void loadRule() })
</script>

<template>
  <PortalLayout :menu-items="portalMenus('school_reviewer', demoEnabled)" active-path="/school/batch-rules" :context-label="'学校端 · ' + (authStore.user?.tenantCode ?? '本校')" :user-name="authStore.user?.displayName ?? '学校管理员'">
    <div class="rules-page">
      <PageHeader eyebrow="PAGE-023 · BATCH RULES" title="批次与评审规则" description="管理本校送审批次的开放、关闭提交与归档状态。">
        <template #actions><button v-if="!demoEnabled" type="button" data-action="new-batch" @click="openCreate">建立批次</button></template>
      </PageHeader>
      <BlindRail audience="本校送审批次" hidden-from="其他学校批次和专家身份" stage="学校配置" />
      <template v-if="demoEnabled">
        <p class="note">甲方演示规则：以下数值仅用于演示，仅当前演示批次生效。</p>
        <section class="rule-sheet"><header><span>ACTIVE RULE VERSION</span><h2>DEMO-2026-SPRING-v1</h2></header><p>目标专家数 1 · 单篇任务费用 ¥300 · 六维百分制</p><div class="score-rules"><article v-for="([label, score], index) in scoreRules" :key="label" data-score-rule><span>{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ label }}</strong><b>{{ score }} 分</b></article></div></section>
      </template>
      <template v-else>
        <section v-if="rule" class="rule-sheet" data-review-rule>
          <header><span>固定试点评审规则 · 只读</span><h2>{{ rule.version }}</h2></header>
          <p>目标专家数 {{ rule.required_experts }} · {{ rule.dimensions.reduce((sum, item) => sum + item.max_score, 0) }} 分</p>
          <div class="score-rules"><article v-for="item in rule.dimensions" :key="item.key" data-score-rule><strong>{{ item.label }}</strong><b>{{ item.max_score }} 分</b></article></div>
          <p>评分档位：{{ rule.bands.map(item => `${item.min}–${item.max} ${item.label}`).join('；') }}</p>
          <p>“修改后通过”是评分档位，不代表平台已验收修改稿。</p>
        </section>
        <p v-else-if="ruleError" role="alert">评审规则加载失败：{{ ruleError }} <button type="button" @click="loadRule">重试</button></p>
        <p v-else role="status">正在加载评审规则…</p>
        <div class="section-heading"><h2>本校批次</h2><button type="button" data-action="reload-batches" :disabled="loading" @click="refreshBatches">刷新</button></div>
        <p v-if="loading" role="status">正在加载批次…</p>
        <p v-else-if="listError" role="alert">{{ listError }}</p>
        <p v-else-if="rows.length === 0" class="empty">尚无送审批次，可建立首个 DRAFT 批次。</p>
        <div v-else class="batch-list">
          <article v-for="row in rows" :key="row.id">
            <div><strong>{{ row.name }}</strong><code>{{ row.code }}</code></div>
            <span>{{ row.status }}</span><small>版本 {{ row.version }}</small>
            <small>{{ row.start_at ? new Date(row.start_at).toLocaleString() : '未设开始时间' }} — {{ row.end_at ? new Date(row.end_at).toLocaleString() : '未设结束时间' }}</small>
            <div class="actions">
              <small>接单 {{row.accept_days ? row.accept_days+' 天' : '不限期'}} · 评阅 {{row.review_days ? row.review_days+' 天' : '不限期'}}</small>
              <button v-if="['OPEN','DRAFT'].includes(row.status)" type="button" @click="clockBatch=clockBatch===row.id?'':row.id">设置期限</button>
              <button type="button" :aria-expanded="programBatch === row.id" @click="programBatch = programBatch === row.id ? '' : row.id">{{row.program_catalog_id?'查看校内目录':'设置校内目录'}}</button>
              <button type="button" :aria-expanded="closeoutId === row.id" @click="closeoutId = closeoutId === row.id ? '' : row.id">收尾核对</button>
              <button v-if="row.allowed_actions.includes('EDIT')" type="button" data-action="edit-batch" :disabled="saving" @click="openEdit(row)">编辑</button>
              <button v-if="row.allowed_actions.includes('OPEN')" type="button" data-action="open-batch" :disabled="saving" @click="runCommand(row, 'OPEN')">开放</button>
              <button v-if="row.allowed_actions.includes('CLOSE_SUBMISSIONS')" type="button" data-action="close-batch" :disabled="saving" @click="runCommand(row, 'CLOSE_SUBMISSIONS')">关闭提交</button>
              <button v-if="row.allowed_actions.includes('ARCHIVE')" type="button" data-action="archive-batch" :disabled="saving" @click="runCommand(row, 'ARCHIVE')">归档</button>
            </div>
            <Transition name="closeout"><BatchDeadlines v-if="clockBatch===row.id" :batch="row" @saved="clockBatch='';loadBatches()" /></Transition>
            <Transition name="closeout"><BatchProgramPin v-if="programBatch === row.id" :batch="row" @saved="loadBatches" /></Transition>
            <Transition name="closeout"><BatchCloseout v-if="closeoutId === row.id" :batch-id="row.id" /></Transition>
          </article>
        </div>
        <section v-if="formMode" class="batch-form">
          <h2>{{ formMode === 'create' ? '建立批次' : '编辑 DRAFT 批次' }}</h2>
          <label v-if="formMode === 'create'">批次代码<input v-model="form.code" data-field="batch-code" autocomplete="off"></label>
          <label>批次名称<input v-model="form.name" data-field="batch-name"></label>
          <label>开始时间<input v-model="form.startAt" data-field="start-at" type="datetime-local"></label>
          <label>结束时间<input v-model="form.endAt" data-field="end-at" type="datetime-local"></label>
          <div class="actions"><button type="button" :disabled="saving" @click="formMode = null">取消</button><button type="button" data-action="submit-batch" :disabled="saving" @click="submitBatch">{{ saving ? '保存中…' : '保存批次' }}</button></div>
        </section>
        <p v-if="actionError" role="alert">{{ actionError }}</p>
        <p v-if="feedback" role="status" class="feedback">{{ feedback }}</p>
      </template>
    </div>
  </PortalLayout>
</template>

<style scoped>
.closeout-enter-active,.closeout-leave-active{transition:opacity .16s,transform .16s}.closeout-enter-from,.closeout-leave-to{opacity:0;transform:translateY(-4px)}
.rules-page{display:grid;gap:1.1rem;max-width:84rem}.rules-page :deep(.page-header__actions) button,.section-heading button,.batch-form .actions button:last-child{padding:.6rem .85rem;border:1px solid #1b4f8a;border-radius:.25rem;background:#1b4f8a;color:#fff;font-weight:650}.note{margin:0;padding:.8rem 1rem;border-left:4px solid #bd9a41;background:#fcf8ea;color:#5b4c2d;font-size:.78rem;line-height:1.5}.section-heading{display:flex;align-items:center;justify-content:space-between}.section-heading h2{margin:0;font-size:1.05rem}.batch-list,.rule-sheet,.batch-form{border:1px solid #d8e0e6;background:#fff}.batch-list article{display:grid;grid-template-columns:minmax(12rem,1.2fr) 9rem 6rem minmax(12rem,1fr) auto;gap:1rem;align-items:center;padding:1rem;border-bottom:1px solid #e6eaed}.batch-list article:last-child{border-bottom:0}.batch-list strong,.batch-list code{display:block}.batch-list code,.batch-list small{color:#6d7c87;font-size:.73rem}.actions{display:flex;gap:.45rem;flex-wrap:wrap}.actions button{border:1px solid #b8cbd9;border-radius:.25rem;background:#fff;color:#1b4f8a;padding:.45rem .7rem}.batch-form{display:grid;gap:.7rem;padding:1.1rem;max-width:34rem}.batch-form h2{margin:0;font-size:1rem}.batch-form label{display:grid;gap:.25rem;font-size:.78rem}.batch-form input{padding:.55rem;border:1px solid #b8c8d2;border-radius:.25rem;font:inherit}.empty{padding:1.1rem;border:1px dashed #cbd7df;color:#687681}.feedback{color:#28642d}.rule-sheet{padding:1rem}.rule-sheet h2{margin:.2rem 0}.score-rules{display:grid;grid-template-columns:repeat(6,1fr)}.score-rules article{display:grid;gap:.25rem;padding:.8rem;border-right:1px solid #e3e8ec}.score-rules strong{font-size:.72rem}.score-rules b{color:#1b4f8a;font-size:.75rem}button:disabled{opacity:.55;cursor:not-allowed}@media(max-width:950px){.batch-list article{grid-template-columns:1fr 1fr}.score-rules{grid-template-columns:repeat(2,1fr)}}
</style>
