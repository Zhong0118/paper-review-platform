<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'

import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import type { StudentDraftInput, ThesisFileMeta } from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { menusByRole } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'

import StudentIdentityPanel, {
  type StudentIdentityView,
} from '../components/StudentIdentityPanel.vue'
import ThesisMaterialEditor from '../components/ThesisMaterialEditor.vue'

type ValidationField = 'title' | 'abstract' | 'discipline' | 'keywords' | 'original' | 'anonymous'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const service = useScenarioService()
const editor = ref<InstanceType<typeof ThesisMaterialEditor>>()
const submitOpener = ref<HTMLButtonElement>()
const confirmDialog = ref<HTMLElement>()
const cancelConfirmation = ref<HTMLButtonElement>()
const thesisId = ref('')
const anonymousId = ref('')
const loading = ref(true)
const loadError = ref('')
const dirty = ref(false)
const saving = ref(false)
const saveFailed = ref(false)
const lastSavedAt = ref('')
const formRevision = ref(0)
const validationError = ref('')
const submitError = ref('')
const showConfirmation = ref(false)
const submitting = ref(false)
const form = ref<StudentDraftInput>({
  title: '',
  abstract: '',
  discipline: { code: '', name: '' },
  keywords: [],
  files: [],
})
const identity = ref<StudentIdentityView>({
  school: '海岳大学',
  college: '计算机学院',
  studentId: '20260042',
  studentName: '林知远',
  trainingLevel: '硕士研究生',
  degreeType: '工学硕士',
  supervisor: '赵文博教授',
  batch: '2026 年春季硕士论文盲审',
  deadline: '2026-05-20 18:00',
})

function copyFiles(files: ThesisFileMeta[]) {
  return files.map((file) => ({ ...file }))
}

async function loadDraft() {
  loading.value = true
  loadError.value = ''
  try {
    const requestedId = String(route.query.thesisId ?? 'thesis-main')
    const thesis =
      requestedId === 'new'
        ? await service.createStudentDraft()
        : await service.getStudentThesis(requestedId)
    thesisId.value = thesis.id
    anonymousId.value = thesis.anonymousId
    form.value = {
      title: thesis.form.title,
      abstract: thesis.form.abstract,
      discipline: { ...thesis.form.discipline },
      keywords: [...thesis.form.keywords],
      files: copyFiles(thesis.files),
    }
    identity.value = {
      ...identity.value,
      school: thesis.student.tenantName,
      studentId: thesis.student.id,
      studentName: thesis.student.name,
      batch: thesis.batchName,
    }
    if (requestedId === 'new') {
      await router.replace({ query: { ...route.query, thesisId: thesis.id } })
    }
    dirty.value = false
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '论文材料加载失败。'
  } finally {
    loading.value = false
  }
}

function updateForm(value: StudentDraftInput) {
  form.value = value
  formRevision.value += 1
  dirty.value = true
  saveFailed.value = false
  validationError.value = ''
}

function draftSnapshot(): StudentDraftInput {
  return {
    title: form.value.title,
    abstract: form.value.abstract,
    discipline: { ...form.value.discipline },
    keywords: [...form.value.keywords],
    files: copyFiles(form.value.files),
  }
}

async function persistDraft(snapshot: StudentDraftInput, revision: number) {
  if (saving.value || !thesisId.value) return false
  saving.value = true
  saveFailed.value = false
  try {
    const saved = await service.saveStudentDraft(thesisId.value, snapshot)
    if (formRevision.value === revision) dirty.value = false
    lastSavedAt.value = saved.updatedAt
    return true
  } catch {
    saveFailed.value = true
    return false
  } finally {
    saving.value = false
  }
}

async function saveDraft() {
  await persistDraft(draftSnapshot(), formRevision.value)
}

function firstValidationError(): { field: ValidationField; message: string } | null {
  if (!form.value.title.trim()) return { field: 'title', message: '请填写论文题目。' }
  if (!form.value.abstract.trim()) return { field: 'abstract', message: '请填写论文摘要。' }
  if (!form.value.discipline.code) return { field: 'discipline', message: '请选择学科专业。' }
  if (form.value.keywords.length === 0)
    return { field: 'keywords', message: '请至少填写 1 个关键词。' }
  if (
    !form.value.files.some(
      (file) => file.purpose === 'SCHOOL_ARCHIVE' && file.validationStatus === 'VALID',
    )
  )
    return { field: 'original', message: '请上传原始版论文。' }
  if (
    !form.value.files.some(
      (file) =>
        file.purpose === 'EXPERT_REVIEW' &&
        ['VALID', 'REVIEW_REQUIRED'].includes(file.validationStatus),
    )
  )
    return { field: 'anonymous', message: '请上传匿名版论文。' }
  return null
}

async function openSubmitConfirmation() {
  const failure = firstValidationError()
  if (failure) {
    validationError.value = failure.message
    await nextTick()
    editor.value?.focusField(failure.field)
    return
  }
  validationError.value = ''
  showConfirmation.value = true
  await nextTick()
  cancelConfirmation.value?.focus()
}

async function closeSubmitConfirmation() {
  if (submitting.value) return
  showConfirmation.value = false
  submitError.value = ''
  await nextTick()
  submitOpener.value?.focus()
}

function handleConfirmationKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    void closeSubmitConfirmation()
    return
  }
  if (event.key !== 'Tab') return

  const focusable = Array.from(
    confirmDialog.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
  )
  if (focusable.length === 0) return
  const activeIndex = focusable.indexOf(document.activeElement as HTMLButtonElement)
  const nextIndex = event.shiftKey
    ? activeIndex <= 0
      ? focusable.length - 1
      : activeIndex - 1
    : activeIndex < 0 || activeIndex === focusable.length - 1
      ? 0
      : activeIndex + 1
  event.preventDefault()
  focusable[nextIndex]?.focus()
}

async function confirmSubmit() {
  if (submitting.value || !thesisId.value) return
  submitting.value = true
  submitError.value = ''
  try {
    if (dirty.value) {
      const revision = formRevision.value
      const saved = await persistDraft(draftSnapshot(), revision)
      if (!saved) {
        submitError.value = '提交前保存失败，请重试。'
        return
      }
      if (formRevision.value !== revision) {
        submitError.value = '材料已发生新的修改，请重新确认提交。'
        return
      }
    }
    await service.submitStudentThesis(thesisId.value)
    dirty.value = false
    showConfirmation.value = false
    await router.push('/student/dashboard')
  } catch {
    submitError.value = '提交失败，请重试。'
  } finally {
    submitting.value = false
  }
}

onBeforeRouteLeave(() => {
  if (!dirty.value) return true
  return window.confirm('当前修改尚未保存，确认离开吗？')
})

void loadDraft()
</script>

<template>
  <PortalLayout
    :menu-items="menusByRole.student ?? []"
    active-path="/student/dashboard"
    context-label="学生端 · 海岳大学"
    :user-name="authStore.user?.displayName ?? '林知远'"
  >
    <div
      class="edit-page"
      :inert="showConfirmation || undefined"
      :aria-hidden="showConfirmation ? 'true' : undefined"
    >
      <PageHeader
        eyebrow="PAGE-003 · THESIS SUBMISSION"
        title="论文信息与材料提交"
        description="提交前请同时核对原始论文与匿名版。匿名版不得包含姓名、导师、致谢及可识别个人身份的信息。"
      >
        <template #actions>
          <button
            class="button button--quiet"
            type="button"
            @click="router.push('/student/dashboard')"
          >
            返回工作台
          </button>
        </template>
      </PageHeader>

      <BlindRail
        audience="本人论文信息与学校审核状态"
        hidden-from="评审专家只能看到匿名论文号和匿名版材料"
        stage="提交准备"
      />

      <p v-if="loading" class="page-state">正在加载论文草稿…</p>
      <p v-else-if="loadError" class="page-state page-state--error" role="alert">{{ loadError }}</p>

      <form v-else class="paper-form" @submit.prevent>
        <StudentIdentityPanel :identity="identity" />
        <ThesisMaterialEditor
          ref="editor"
          :model-value="form"
          :identity-tokens="[identity.studentName, identity.studentId]"
          @update:model-value="updateForm"
        />

        <p v-if="validationError" class="validation-error" data-validation-error role="alert">
          {{ validationError }}
        </p>

        <footer class="paper-form__footer">
          <div>
            <p>系统将在学校确认匿名检测结果后，才允许进入专家匹配环节。</p>
            <small v-if="saveFailed" data-save-status>保存失败，请重试。</small>
            <small v-else-if="dirty" data-save-status>
              有未保存修改<span v-if="lastSavedAt"> · 上次保存 {{ lastSavedAt }}</span>
            </small>
            <small v-else-if="lastSavedAt" data-save-status>已保存 · {{ lastSavedAt }}</small>
            <small v-else data-save-status>材料已同步</small>
          </div>
          <div class="paper-form__actions">
            <button
              class="button button--quiet"
              data-action="save-draft"
              type="button"
              :disabled="saving"
              @click="saveDraft"
            >
              {{ saving ? '保存中…' : saveFailed ? '重新保存' : '保存草稿' }}
            </button>
            <button
              ref="submitOpener"
              class="button button--primary"
              data-action="open-submit-confirmation"
              type="button"
              @click="openSubmitConfirmation"
            >
              提交学校审核
            </button>
          </div>
        </footer>
      </form>
    </div>

    <div v-if="showConfirmation" class="dialog-backdrop">
      <section
        ref="confirmDialog"
        class="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        @keydown="handleConfirmationKeydown"
      >
        <span class="confirm-dialog__mark" aria-hidden="true">审</span>
        <h2 id="confirm-title">确认提交论文？</h2>
        <p>
          提交后将进入学校材料审核。审核完成前你不能再次替换文件，如需修改请联系学校管理员退回。
        </p>
        <p v-if="submitError" class="confirm-dialog__error" data-submit-error role="alert">
          {{ submitError }}
        </p>
        <dl>
          <div>
            <dt>论文题目</dt>
            <dd>{{ form.title }}</dd>
          </div>
          <div>
            <dt>匿名论文号</dt>
            <dd>{{ anonymousId }}</dd>
          </div>
        </dl>
        <footer>
          <button
            ref="cancelConfirmation"
            class="button button--quiet"
            data-action="close-submit-confirmation"
            type="button"
            @click="closeSubmitConfirmation"
          >
            继续检查
          </button>
          <button
            class="button button--primary"
            data-action="confirm-submit"
            type="button"
            :disabled="submitting"
            @click="confirmSubmit"
          >
            {{ submitting ? '正在提交…' : '确认提交' }}
          </button>
        </footer>
      </section>
    </div>
  </PortalLayout>
</template>

<style scoped>
.edit-page,
.paper-form {
  display: grid;
  gap: 1rem;
}

.page-state,
.validation-error {
  margin: 0;
  padding: 0.875rem 1rem;
  border: 1px solid #dce3e9;
  background: white;
  color: #52616d;
}

.page-state--error,
.validation-error {
  border-color: #dfb2ae;
  background: #fff7f6;
  color: #9a302b;
}

.paper-form__footer {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 1rem;
  border: 1px solid #d6dee5;
  background: rgb(255 255 255 / 0.96);
  box-shadow: 0 -0.5rem 1.5rem rgb(31 55 76 / 0.06);
  backdrop-filter: blur(8px);
}

.paper-form__footer p,
.paper-form__footer small {
  display: block;
  margin: 0;
  color: #697680;
  font-size: 0.75rem;
}

.paper-form__footer small {
  margin-top: 0.25rem;
  color: #2d617b;
}

.paper-form__actions {
  display: flex;
  gap: 0.625rem;
}

.button {
  min-height: 2.5rem;
  padding: 0.5rem 0.875rem;
  border-radius: 0.375rem;
  font-weight: 650;
  cursor: pointer;
}

.button:disabled {
  cursor: wait;
  opacity: 0.65;
}

.button--quiet {
  border: 1px solid #bec9d2;
  background: white;
  color: #42515d;
}

.button--primary {
  border: 1px solid #1b4f8a;
  background: #1b4f8a;
  color: white;
}

.dialog-backdrop {
  position: fixed;
  z-index: 100;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(20 32 42 / 0.48);
}

.confirm-dialog {
  width: min(30rem, 100%);
  padding: 1.5rem;
  border-top: 0.25rem solid #1b4f8a;
  background: white;
  box-shadow: 0 1rem 3rem rgb(0 0 0 / 0.25);
}

.confirm-dialog__mark {
  display: inline-grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border: 1px solid #1b4f8a;
  color: #1b4f8a;
  font-family: var(--font-display);
}

.confirm-dialog h2 {
  margin: 0.75rem 0 0;
  color: #243746;
  font-family: var(--font-display);
}

.confirm-dialog p {
  color: #60707d;
  line-height: 1.7;
}

.confirm-dialog .confirm-dialog__error {
  padding: 0.625rem 0.75rem;
  border: 1px solid #dfb2ae;
  background: #fff7f6;
  color: #9a302b;
}

.confirm-dialog dl {
  padding: 0.75rem;
  background: #f4f7f9;
}

.confirm-dialog dl div,
.confirm-dialog footer {
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

.confirm-dialog dd {
  margin: 0;
  text-align: right;
}

.confirm-dialog footer {
  margin-top: 1rem;
  justify-content: flex-end;
}

@media (max-width: 680px) {
  .paper-form__footer {
    align-items: stretch;
    flex-direction: column;
  }

  .paper-form__actions {
    justify-content: flex-end;
  }
}
</style>
