<script setup lang="ts">
/**
 * U2-3 学生论文编辑（真实模式，/student/thesis/edit[?thesisId=]）。
 * 不带 thesisId 是新建态（D5）：先填真实题目、1–5 个关键词与受控专业，创建后写回 thesisId。
 * 编辑态分三段：论文信息与材料 → 匿名检测 → 提交前核对；保存为手动（与修复实现一致）。
 * 全部业务逻辑来自 useThesisEditor（与旧页同一份实现）；字段、上传、PDF 处理与检测组件原样沿用，只换外壳与令牌。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import PdfTransformDialog from '@/components/app/PdfTransformDialog.vue'
import SensitiveFindingPanel from '@/components/app/SensitiveFindingPanel.vue'
import ConfirmDialog from '@/components/workspace/ConfirmDialog.vue'
import PersonalShell from '@/components/workspace/PersonalShell.vue'
import SaveStatus from '@/components/workspace/SaveStatus.vue'
import StateBlock from '@/components/workspace/StateBlock.vue'
import StatusPill from '@/components/workspace/StatusPill.vue'
import type { DraftState } from '@/components/workspace/types'
import '@/styles/workspace.css'

import DisciplineSelector from '../components/DisciplineSelector.vue'
import ThesisMaterialEditor from '../components/ThesisMaterialEditor.vue'
import { useThesisEditor, type ValidationField } from '../composables/useThesisEditor'
import { studentAccount, studentNav } from './studentShell'

const router = useRouter()
const editor = ref<InstanceType<typeof ThesisMaterialEditor>>()
const root = ref<HTMLElement | null>(null)

const session = useThesisEditor({
  service: null,
  focusField: (field) => focus(field),
})
const {
  authStore, pendingUploads, realDetail, checking, transformOpen, preparingTransform, checkError, thesisId, anonymousId,
  loading, loadError, disciplineOptions, programs, localCode, localOptions, shownProgram, chooseProgram,
  createTitle, createKeywordText, createError, existingId, createKeywords, newDiscipline,
  dirty, saving, saveFailed, contentRevision, saveConflict, serverCopy, compareServerCopy, lastSavedAt,
  validationError, submitError, showConfirmation, submitting, refreshingChecklist, form, identity,
  loadDraft, startDraft, updateForm, onNativeFile, checkDraft, openTransform, appliedTransform, saveDraft,
  issues, openSubmitConfirmation, closeSubmitConfirmation, confirmSubmit,
} = session

const account = computed(() => studentAccount(authStore.user))

const view = computed<'loading' | 'error' | 'create' | 'locked' | 'edit'>(() => {
  if (loading.value) return 'loading'
  if (loadError.value) return 'error'
  if (!thesisId.value) return 'create'
  if (realDetail.value && (realDetail.value.stage !== 'DRAFT' || !realDetail.value.current_version?.is_editable)) return 'locked'
  return 'edit'
})

// ---- 新建态（D5） ----
const createTouched = ref(false)
const createErrors = computed(() => ({
  title: createTitle.value.trim() ? '' : '请填写论文题目',
  keywords: createKeywords.value.length >= 1 && createKeywords.value.length <= 5 ? '' : '请填写 1–5 个不重复的关键词',
  program: newDiscipline.value ? '' : programs.value.catalog_id ? '请选择校内专业' : '请选择学科',
}))
const noOptions = computed(() => (programs.value.catalog_id ? !localOptions.value.length : !disciplineOptions.value.length))
const rawKeywordCount = computed(() => createKeywordText.value.split(/[,，;；、\n]/).map((item) => item.trim()).filter(Boolean).length)
async function create() {
  createTouched.value = true
  if (createErrors.value.title || createErrors.value.keywords || createErrors.value.program) return
  await startDraft()
}
function openExisting() {
  void router.replace({ query: { thesisId: existingId.value } })
}

// ---- 编辑态 ----
const saveState = computed<DraftState>(() => {
  if (saveConflict.value) return 'conflict'
  if (saving.value) return 'saving'
  if (saveFailed.value) return 'failed'
  if (dirty.value) return 'dirty'
  return lastSavedAt.value ? 'saved' : 'clean'
})
const savedAt = computed(() => (lastSavedAt.value ? new Date(lastSavedAt.value) : null))
const hasPendingFiles = computed(() => Boolean(pendingUploads.value.SCHOOL_ARCHIVE || pendingUploads.value.EXPERT_REVIEW))
const busy = computed(() => saving.value || submitting.value || checking.value || preparingTransform.value)
const returnReason = computed(() => realDetail.value?.return_reason || '')
const fileName = (purpose: 'SCHOOL_ARCHIVE' | 'EXPERT_REVIEW') => form.value.files.find((file) => file.purpose === purpose)?.name ?? ''

const sectionLabel: Record<ValidationField, string> = {
  title: '论文信息', abstract: '论文信息', discipline: '论文信息', keywords: '论文信息', original: '材料', anonymous: '材料',
}
function focus(field: ValidationField) {
  editor.value?.focusField(field)
}
function jump(id: string) {
  root.value?.querySelector<HTMLElement>(`#${id}`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
}
const steps = computed(() => [
  { id: 'sec-info', label: '论文信息与材料', done: !issues.value.some((item) => item.field) },
  { id: 'sec-check', label: '匿名检测', done: Boolean(realDetail.value?.anonymization?.auto_conclusion) && !realDetail.value?.anonymization?.stale },
  { id: 'sec-submit', label: '提交前核对', done: issues.value.length === 0 },
])
</script>

<template>
  <div ref="root" class="ws">
    <PersonalShell :nav="studentNav('/student/dashboard')" :account="account">
      <RouterLink class="back" to="/student/dashboard">‹ 我的送审</RouterLink>

      <StateBlock v-if="view === 'loading'" kind="loading" title="正在载入论文" />

      <StateBlock v-else-if="view === 'error'" kind="error" :title="loadError">
        <template #actions><button type="button" class="btn" @click="loadDraft">重新加载</button></template>
      </StateBlock>

      <!-- 新建态（D5） -->
      <section v-else-if="view === 'create'" class="card create" aria-labelledby="create-h">
        <header class="card__head">
          <h1 id="create-h">开始送审</h1>
          <RouterLink class="btn btn--quiet" to="/student/dashboard">取消</RouterLink>
        </header>
        <p class="muted">先填写论文题目、关键词和所属专业。创建后在本页上传原稿与匿名稿。</p>

        <div v-if="createError" class="banner" :class="existingId ? 'banner--info' : 'banner--danger'" role="alert">
          <strong>{{ existingId ? '你在本批次已经有一篇论文，不能再新建。' : `没有创建成功：${createError}` }}</strong>
          <span>{{ existingId ? '打开时会按它现在的状态显示。' : '你填写的内容还在，可以直接重试。' }}</span>
          <span class="banner__actions">
            <button v-if="existingId" type="button" class="btn btn--sm" data-open-existing @click="openExisting">打开已有论文</button>
            <button v-else type="button" class="btn btn--sm" @click="loadDraft">刷新可选专业</button>
          </span>
        </div>

        <StateBlock v-if="noOptions" kind="unconfigured" title="本批次还没有可选的专业" compact>
          学校还没有为本批次维护专业目录或开放学科，暂时不能开始送审。请联系学院研究生秘书。
        </StateBlock>

        <form v-else class="create__form" novalidate @submit.prevent="create">
          <label class="field">
            <span>论文题目</span>
            <input v-model="createTitle" class="input" data-create-title maxlength="255" :aria-invalid="createTouched && Boolean(createErrors.title)" />
            <span v-if="createTouched && createErrors.title" class="field-error">{{ createErrors.title }}</span>
          </label>
          <label class="field">
            <span>关键词</span>
            <input v-model="createKeywordText" class="input" data-create-keywords placeholder="用逗号、顿号或分号分隔" :aria-invalid="createTouched && Boolean(createErrors.keywords)" />
            <small>
              已识别 {{ createKeywords.length }} 个：{{ createKeywords.join('、') || '无' }}<template v-if="rawKeywordCount > createKeywords.length">（已去掉 {{ rawKeywordCount - createKeywords.length }} 个重复）</template>
            </small>
            <span v-if="createTouched && createErrors.keywords" class="field-error">{{ createErrors.keywords }}</span>
          </label>
          <div class="field">
            <span>{{ programs.catalog_id ? '校内专业' : '学科' }}</span>
            <div class="selector">
              <DisciplineSelector v-if="programs.catalog_id" :model-value="shownProgram" :options="localOptions" @update:model-value="chooseProgram" />
              <DisciplineSelector v-else v-model="newDiscipline" :options="disciplineOptions" />
            </div>
            <small>{{ programs.catalog_id ? '选项来自学校维护的校内专业目录，选择后显示对应官方学科。' : '学校尚未为本批次绑定校内专业目录，按本校开放的学科选择。' }}</small>
            <p v-if="programs.catalog_id && newDiscipline" class="mapped"><span class="muted">对应官方学科</span><strong>{{ newDiscipline.code }} {{ newDiscipline.name }}</strong></p>
            <span v-if="createTouched && createErrors.program" class="field-error">{{ createErrors.program }}</span>
          </div>
          <div class="create__actions">
            <button type="submit" class="btn btn--primary" data-action="create-selected-draft" :disabled="saving">{{ saving ? '正在创建…' : '创建并继续' }}</button>
            <span class="muted">摘要可以在下一步填写。</span>
          </div>
        </form>
      </section>

      <!-- 已不可编辑 -->
      <StateBlock v-else-if="view === 'locked'" kind="forbidden" :title="realDetail?.current_version?.title || '这篇论文'">
        这篇论文当前不能编辑。返回“我的送审”查看进度和可以做的操作。
        <template #actions><RouterLink class="btn btn--primary" to="/student/dashboard">查看我的论文</RouterLink></template>
      </StateBlock>

      <!-- 编辑态 -->
      <template v-else>
        <header class="page-head">
          <div class="page-head__title">
            <StatusPill :tone="returnReason ? 'warning' : 'neutral'">{{ returnReason ? '已退回，待修改' : '草稿' }}</StatusPill>
            <h1>{{ form.title || '未命名论文' }}</h1>
          </div>
          <SaveStatus :state="saveState" :saved-at="savedAt" manual />
        </header>

        <div v-if="returnReason" class="returned">
          <p class="returned__who">学校退回了这篇论文，原因：</p>
          <blockquote>{{ returnReason }}</blockquote>
        </div>

        <div v-if="saveConflict" class="banner banner--danger" role="alert" data-save-status>
          <strong>论文内容或材料在其他页面改动过。</strong>
          <span>本页输入没有覆盖它，仍保留在本页。请先核对服务器版本，另存需要的内容后重新打开论文合并。</span>
          <dl v-if="serverCopy?.current_version" class="server">
            <dt>服务器题目</dt><dd>{{ serverCopy.current_version.title }}</dd>
            <dt>服务器摘要</dt><dd>{{ serverCopy.current_version.abstract || '（空）' }}</dd>
            <dt>专业与关键词</dt><dd>{{ serverCopy.current_version.discipline_name }} {{ serverCopy.current_version.school_program?.code }} · {{ serverCopy.current_version.keywords.join('、') }}</dd>
            <dt>服务器材料</dt><dd>{{ serverCopy.current_version.files.map((file) => file.filename).join('、') || '无' }}</dd>
          </dl>
          <span class="banner__actions">
            <button v-if="!serverCopy" type="button" class="btn btn--sm btn--primary" data-action="compare-server-thesis" @click="compareServerCopy">查看服务器版本</button>
            <button v-else type="button" class="btn btn--sm" @click="loadDraft">重新打开论文</button>
          </span>
        </div>

        <div class="layout">
          <nav class="steps" aria-label="编辑步骤">
            <button v-for="step in steps" :key="step.id" type="button" class="steps__item" :class="{ 'steps__item--done': step.done }" @click="jump(step.id)">
              <span aria-hidden="true">{{ step.done ? '✓' : '○' }}</span>{{ step.label }}<span class="sr-only">{{ step.done ? '已完成' : '未完成' }}</span>
            </button>
          </nav>

          <form class="sections" @submit.prevent>
            <section id="sec-info" class="card" aria-labelledby="sec-info-h">
              <h2 id="sec-info-h" class="sec">论文信息与材料</h2>
              <div class="legacy">
                <ThesisMaterialEditor
                  ref="editor"
                  :model-value="form"
                  :discipline-options="disciplineOptions"
                  :identity-tokens="[identity.studentName, identity.studentId]"
                  @update:model-value="updateForm"
                  @native-file="onNativeFile"
                >
                  <template v-if="programs.catalog_id" #discipline>
                    <div class="field">
                      <span>校内专业</span>
                      <p v-if="!localCode" class="muted small">原稿已选官方学科 {{ form.discipline.code }} {{ form.discipline.name }}；可以保留，或改选校内专业。</p>
                      <DisciplineSelector :model-value="shownProgram" :options="localOptions" @update:model-value="chooseProgram" />
                      <p v-if="!localOptions.length" class="muted small">当前没有可选的校内专业，请联系学校审核员。</p>
                    </div>
                  </template>
                </ThesisMaterialEditor>
              </div>
              <div class="pdf">
                <div>
                  <p class="pdf__title">需要合并、提取或删除 PDF 页面？</p>
                  <p class="muted small">会先保存本页内容并上传已选文件，再打开处理窗口；处理前会给出预览，原文件保留到你确认应用。</p>
                </div>
                <button type="button" class="btn" data-open-pdf-transform :disabled="busy" @click="openTransform">{{ preparingTransform ? '正在保存材料…' : '保存并处理 PDF 材料' }}</button>
              </div>
              <PdfTransformDialog
                v-if="transformOpen && realDetail"
                :thesis-id="realDetail.id"
                :version="realDetail.version"
                :content-revision="contentRevision"
                :files="realDetail.current_version?.files ?? []"
                @close="transformOpen = false"
                @applied="appliedTransform"
              />
            </section>

            <section id="sec-check" class="card" aria-labelledby="sec-check-h">
              <h2 id="sec-check-h" class="sec">匿名检测</h2>
              <p class="muted small">检测只看匿名稿。改动内容或换了匿名稿后，旧报告会作废，需要重新检测。</p>
              <div class="legacy">
                <SensitiveFindingPanel
                  v-if="realDetail"
                  :detail="realDetail"
                  :busy="checking"
                  :disabled="saving || submitting"
                  :invalidated="dirty || !!pendingUploads.EXPERT_REVIEW || !form.files.some((file) => file.purpose === 'EXPERT_REVIEW')"
                  @check="checkDraft"
                />
              </div>
              <p v-if="checkError" class="field-error" role="alert">{{ checkError }}</p>
            </section>

            <section id="sec-submit" class="card" data-submit-checklist aria-labelledby="sec-submit-h">
              <h2 id="sec-submit-h" class="sec">提交前核对</h2>
              <p v-if="realDetail?.draft_eligibility_status === 'SUSPENDED'" class="muted small">原批次资格已暂停，只限制新建论文；这份草稿仍可提交。</p>
              <ul v-if="issues.length" class="issues">
                <li v-for="issue in issues" :key="issue.message">
                  <StatusPill tone="warning">{{ issue.field ? sectionLabel[issue.field] : '资格' }}</StatusPill>
                  <span>{{ issue.message }}</span>
                  <button v-if="issue.field" type="button" class="btn btn--sm btn--quiet" @click="focus(issue.field)">去填写</button>
                </li>
              </ul>
              <p v-else class="ok" role="status">当前没有缺项。提交时会再次核对专业和文件。</p>
              <p v-if="hasPendingFiles" class="muted small">已选的本地文件会在保存或提交时上传，上传完成前还没有经过服务端校验。</p>
              <p v-if="validationError" class="field-error" data-validation-error role="alert">{{ validationError }}</p>
            </section>
          </form>
        </div>

        <footer class="bar">
          <span class="bar__state muted">
            <template v-if="saveFailed && !saveConflict">保存失败，内容仍在本页。</template>
            <template v-else-if="dirty">有未保存的修改，离开前请保存。</template>
            <template v-else-if="hasPendingFiles">信息已保存；已选文件尚未上传。</template>
            <template v-else>学校确认匿名检测结果后，论文才会进入专家匹配。</template>
          </span>
          <button type="button" class="btn" data-action="save-draft" :disabled="saving" @click="saveDraft">
            {{ saving ? '正在保存…' : saveFailed ? '重新保存' : '保存草稿' }}
          </button>
          <button type="button" class="btn btn--primary" data-action="open-submit-confirmation" :disabled="refreshingChecklist || busy" @click="openSubmitConfirmation">
            {{ refreshingChecklist ? '正在核对…' : '提交学校审核' }}
          </button>
        </footer>
      </template>
    </PersonalShell>

    <ConfirmDialog :open="showConfirmation" title="提交给学校审核？" wide :busy="submitting" @close="closeSubmitConfirmation">
      <p>提交后进入学校材料核验。核验完成前不能替换文件；需要修改时，可以在送出前撤回，或等学校退回。</p>
      <dl class="freeze">
        <dt>论文题目</dt><dd>{{ form.title }}</dd>
        <dt>学科</dt><dd>{{ form.discipline.code }} {{ form.discipline.name }}</dd>
        <dt>关键词</dt><dd>{{ form.keywords.join('、') }}</dd>
        <dt>原稿</dt><dd>{{ fileName('SCHOOL_ARCHIVE') || '（本地文件，提交时上传）' }}</dd>
        <dt>匿名稿</dt><dd>{{ fileName('EXPERT_REVIEW') || '（本地文件，提交时上传）' }}</dd>
        <dt>匿名论文号</dt><dd class="num">{{ anonymousId }}</dd>
      </dl>
      <p v-if="submitError" class="field-error" data-submit-error role="alert">{{ submitError }}</p>
      <template #actions>
        <button type="button" class="btn" data-action="close-submit-confirmation" :disabled="submitting" @click="closeSubmitConfirmation">继续检查</button>
        <button type="button" class="btn btn--primary" data-action="confirm-submit" :disabled="submitting" @click="confirmSubmit">{{ submitting ? '正在提交…' : '确认提交' }}</button>
      </template>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.back {
  display: inline-block;
  margin-bottom: 12px;
  color: var(--ws-action);
  font-size: 13px;
  text-decoration: none;
}
.card {
  display: grid;
  gap: 14px;
  padding: 20px 24px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-panel);
  background: var(--ws-surface);
}
.card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.card__head h1,
.page-head h1 {
  font-size: 20px;
  font-weight: 650;
}
.create__form {
  display: grid;
  gap: 16px;
  max-width: 620px;
}
.create__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.mapped {
  display: flex;
  gap: 12px;
  padding: 8px 10px;
  border-radius: var(--ws-radius);
  background: var(--ws-page);
  font-size: 13px;
}
.page-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  margin-bottom: 16px;
}
.page-head__title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}
.page-head__title h1 {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.returned {
  display: grid;
  gap: 6px;
  margin-bottom: 16px;
  padding: 12px 16px;
  border-left: 3px solid var(--ws-warning);
  border-radius: 0 var(--ws-radius) var(--ws-radius) 0;
  background: var(--ws-warning-soft);
}
.returned blockquote {
  margin: 0;
  font-family: var(--ws-font-reading);
  line-height: 1.75;
}
.banner {
  display: grid;
  gap: 6px;
  margin-bottom: 16px;
  padding: 10px 12px;
  border-left: 3px solid var(--ws-danger);
  border-radius: 0 var(--ws-radius) var(--ws-radius) 0;
  background: var(--ws-danger-soft);
  font-size: 13px;
}
.banner--info {
  border-left-color: var(--ws-action);
  background: var(--ws-info-soft);
}
.banner__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.server {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 4px 12px;
  margin: 0;
}
.server dt {
  color: var(--ws-muted);
}
.server dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.layout {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.steps {
  position: sticky;
  top: 76px;
  display: grid;
  gap: 2px;
}
.steps__item {
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--ws-radius);
  background: transparent;
  color: var(--ws-muted);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.steps__item:hover {
  background: var(--ws-sunken);
  color: var(--ws-text);
}
.steps__item--done span:first-child {
  color: var(--ws-success);
}
.sections {
  display: grid;
  gap: 16px;
}
.sections .card {
  scroll-margin-top: 76px;
}
.sec {
  font-size: 15px;
  font-weight: 600;
}
.small {
  font-size: 12px;
}
.pdf {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--ws-radius);
  background: var(--ws-page);
}
.pdf__title {
  font-weight: 500;
}
.issues {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.issues li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.ok {
  color: var(--ws-success);
  font-size: 13px;
}
.bar {
  position: sticky;
  z-index: 20;
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 16px -20px -96px;
  padding: 12px 20px;
  border-top: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.bar__state {
  flex: 1;
  min-width: 200px;
  font-size: 13px;
}
.freeze {
  display: grid;
  grid-template-columns: 84px 1fr;
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
  overflow-wrap: anywhere;
}
/* 沿用的字段、上传与检测组件：业务行为不变，只换成工作空间的边框、字号与按钮 */
.legacy :deep(.material-editor) {
  gap: 20px;
}
.legacy :deep(.material-editor__section) {
  border: 0;
  background: transparent;
}
.legacy :deep(.material-editor__section > header) {
  padding: 0 0 8px;
  border-bottom: 1px solid var(--ws-border);
}
.legacy :deep(.material-editor__section > header span) {
  display: none;
}
.legacy :deep(.material-editor__section > header h2) {
  color: var(--ws-muted);
  font-size: 13px;
  font-weight: 600;
}
.legacy :deep(input:not([type='file']):not([type='checkbox']):not([type='radio'])),
.legacy :deep(textarea) {
  width: 100%;
  min-height: var(--ws-control);
  padding: 7px 10px;
  border: 1px solid var(--ws-border-strong);
  border-radius: var(--ws-radius);
  background: var(--ws-surface);
  color: var(--ws-text);
  font: inherit;
}
.legacy :deep(textarea) {
  line-height: 1.7;
}
.legacy :deep(label > span),
.legacy :deep(.field > span) {
  color: var(--ws-text);
  font-size: 13px;
  font-weight: 500;
}
.legacy :deep(button) {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--ws-border-strong);
  border-radius: var(--ws-radius);
  background: var(--ws-surface);
  color: var(--ws-text);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.legacy :deep(button:disabled) {
  color: var(--ws-faint);
  cursor: not-allowed;
}
.legacy :deep(.sensitive-panel),
.legacy :deep(section) {
  border-color: var(--ws-border);
}
@media (max-width: 899px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .steps {
    position: static;
    display: flex;
    overflow-x: auto;
  }
  .steps__item {
    flex: none;
  }
  .card {
    padding: 16px;
  }
}
@media (max-width: 640px) {
  .bar {
    margin: 16px -14px -96px;
    padding: 10px 14px;
  }
  .bar .btn {
    flex: 1;
  }
  .server {
    grid-template-columns: 1fr;
  }
}
</style>
