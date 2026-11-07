<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import PdfTransformDialog from '@/components/app/PdfTransformDialog.vue'
import SensitiveFindingPanel from '@/components/app/SensitiveFindingPanel.vue'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { portalMenus } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'

import StudentIdentityPanel from '../components/StudentIdentityPanel.vue'
import StudentDemoScenarioController from '../components/StudentDemoScenarioController.vue'
import DisciplineSelector from '../components/DisciplineSelector.vue'
import ThesisMaterialEditor from '../components/ThesisMaterialEditor.vue'
import { useThesisEditor } from '../composables/useThesisEditor'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true'
const service = demoEnabled ? useScenarioService() : null
const editor = ref<InstanceType<typeof ThesisMaterialEditor>>()
const submitOpener = ref<HTMLButtonElement>()
const confirmDialog = ref<HTMLElement>()
const cancelConfirmation = ref<HTMLButtonElement>()

// U2-3：编辑会话（建稿、保存、上传、检测、提交）搬到 useThesisEditor（原样搬家，旧 spec 不改）
const {
  pendingUploads,
  realDetail,
  checking,
  transformOpen,
  preparingTransform,
  checkError,
  thesisId,
  anonymousId,
  loading,
  loadError,
  disciplineOptions,
  programs,
  localCode,
  localOptions,
  shownProgram,
  chooseProgram,
  createTitle,
  createKeywordText,
  createError,
  existingId,
  createKeywords,
  newDiscipline,
  dirty,
  saving,
  saveFailed,
  contentRevision,
  saveConflict,
  serverCopy,
  compareServerCopy,
  lastSavedAt,
  validationError,
  submitError,
  showConfirmation,
  submitting,
  refreshingChecklist,
  demoDialogOpen,
  form,
  identity,
  loadDraft,
  startDraft,
  updateForm,
  onNativeFile,
  checkDraft,
  openTransform,
  appliedTransform,
  saveDraft,
  issues,
  openSubmitConfirmation,
  closeSubmitConfirmation,
  confirmSubmit,
} = useThesisEditor({
  service,
  focusField: (field) => editor.value?.focusField(field),
  onConfirmationOpened: () => cancelConfirmation.value?.focus(),
  onConfirmationClosed: () => submitOpener.value?.focus(),
})

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

</script>

<template>
  <PortalLayout
    :menu-items="portalMenus('student', demoEnabled)"
    active-path="/student/dashboard"
    :context-label="demoEnabled ? '学生端 · 海岳大学' : '学生端 · ' + (authStore.user?.tenantCode ?? '本校')"
    :user-name="authStore.user?.displayName ?? '林知远'"
    :background-locked="showConfirmation || demoDialogOpen"
  >
    <div class="edit-page">
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
      <p v-else-if="loadError" class="page-state page-state--error" role="alert">{{ loadError }} <button type="button" @click="loadDraft">重试加载</button></p>

      <section v-else-if="!demoEnabled && !thesisId" class="paper-form">
        <h2>新建送审论文</h2>
        <label>论文题目 <input v-model="createTitle" data-create-title maxlength="255" required></label>
        <label>关键词（1 至 5 个，用逗号分隔） <input v-model="createKeywordText" data-create-keywords required></label>
        <template v-if="programs.catalog_id"><p>从本批固定的校内目录选择，校码后显示对应官方学科。</p>
          <DisciplineSelector :model-value="shownProgram" :options="localOptions" @update:model-value="chooseProgram"/>
          <p v-if="!localOptions.length">本批暂无开放的校内专业，请联系学校审核员。</p></template>
        <DisciplineSelector v-else v-model="newDiscipline" :options="disciplineOptions" />
        <p v-if="!programs.catalog_id && !disciplineOptions.length">本校暂无可选学科，请联系学校审核员。</p>
        <button type="button" data-action="create-selected-draft" :disabled="!newDiscipline || !createTitle.trim() || !createKeywords.length || createKeywords.length>5 || saving" @click="startDraft">创建论文草稿</button>
        <p v-if="createError" role="alert">{{ createError }} <button v-if="existingId" type="button" data-open-existing @click="router.replace({query:{...route.query,thesisId:existingId}})">打开已有论文</button><button v-else type="button" @click="loadDraft">刷新可选专业</button></p>
      </section>
      <section v-else-if="!demoEnabled && realDetail && (realDetail.stage!=='DRAFT' || !realDetail.current_version?.is_editable)" class="paper-form">
        <h2>{{ realDetail.current_version?.title || '已有论文' }}</h2>
        <p>本批次已有这篇论文，当前版本不可编辑。请返回工作台查看进度和可执行操作。</p>
        <RouterLink to="/student/dashboard">查看我的论文</RouterLink>
      </section>
      <form v-else class="paper-form" @submit.prevent>
        <StudentIdentityPanel :identity="identity" />
        <ThesisMaterialEditor
          ref="editor"
          :model-value="form"
          :discipline-options="demoEnabled ? undefined : disciplineOptions"
          :identity-tokens="[identity.studentName, identity.studentId]"
          @update:model-value="updateForm"
          @native-file="onNativeFile">
          <template v-if="!demoEnabled && programs.catalog_id" #discipline>
            <div><p>校内专业 · 本批固定目录</p>
            <p v-if="!localCode">原稿已选官方学科 {{form.discipline.code}} {{form.discipline.name}}；可保留原稿，或主动改选校内专业。</p>
            <DisciplineSelector :model-value="shownProgram" :options="localOptions" @update:model-value="chooseProgram"/>
            <p v-if="!localOptions.length">当前无可选项，请联系学校审核员。</p></div>
          </template>
        </ThesisMaterialEditor>

        <button v-if="!demoEnabled && realDetail?.stage === 'DRAFT'" type="button" data-open-pdf-transform
          :disabled="saving || submitting || checking || preparingTransform" @click="openTransform">{{preparingTransform ? '正在保存材料…' : '保存并处理 PDF 材料'}}</button>
        <Transition name="confirmation"><PdfTransformDialog v-if="transformOpen && realDetail" :thesis-id="realDetail.id" :version="realDetail.version" :content-revision="contentRevision"
          :files="realDetail.current_version?.files ?? []" @close="transformOpen=false" @applied="appliedTransform" /></Transition>
        <SensitiveFindingPanel v-if="!demoEnabled && realDetail" :detail="realDetail" :busy="checking"
          :disabled="saving || submitting" :invalidated="dirty || !!pendingUploads.EXPERT_REVIEW || !form.files.some(file => file.purpose === 'EXPERT_REVIEW')" @check="checkDraft" />
        <p v-if="checkError" role="alert">{{checkError}}</p>
        <p v-if="validationError" class="validation-error" data-validation-error role="alert">
          {{ validationError }}
        </p>

        <section v-if="!demoEnabled && realDetail?.stage === 'DRAFT'" data-submit-checklist class="checklist">
          <h2>送审前核对</h2>
          <p v-if="realDetail.draft_eligibility_status === 'SUSPENDED'">原批次资格已暂停，仅限制新建论文；已有草稿仍可提交。</p>
          <p v-else-if="realDetail.draft_eligibility_status">已核对本论文的原批次资格记录</p>
          <ul v-if="issues.length"><li v-for="issue in issues" :key="issue.message">
            {{issue.message}} <button v-if="issue.field" type="button" @click="editor?.focusField(issue.field)">去填写</button>
          </li></ul>
          <p v-else>当前表单没有缺项，提交时将再次核验专业和文件。</p>
          <p v-if="pendingUploads.SCHOOL_ARCHIVE || pendingUploads.EXPERT_REVIEW">本地已选文件会在确认提交时上传，尚未完成服务端核验。</p>
        </section>
        <footer class="paper-form__footer">
          <div>
            <p>系统将在学校确认匿名检测结果后，才允许进入专家匹配环节。</p>
            <div v-if="saveConflict" data-save-status role="alert">其他页面已改动内容或材料。本页输入已保留，请核对服务器版本。
              <button type="button" @click="compareServerCopy">查看服务器版本</button>
              <dl v-if="serverCopy?.current_version"><dt>服务器题目和摘要</dt><dd>{{serverCopy.current_version.title}} · {{serverCopy.current_version.abstract}}</dd>
                <dt>专业与关键词</dt><dd>{{serverCopy.current_version.discipline_name}} {{serverCopy.current_version.school_program?.code}} · {{serverCopy.current_version.keywords.join('、')}}</dd>
                <dt>服务器材料</dt><dd>{{serverCopy.current_version.files.map(f=>f.filename).join('、') || '无'}}</dd></dl>
              <p>请另存所需输入后，重新打开论文进行合并。</p></div>
            <small v-else-if="saveFailed" data-save-status>保存失败，请重试。</small>
            <small v-else-if="dirty" data-save-status>
              有未保存修改<span v-if="lastSavedAt"> · 上次保存 {{ lastSavedAt }}</span>
            </small>
            <small v-else-if="pendingUploads.SCHOOL_ARCHIVE || pendingUploads.EXPERT_REVIEW" data-save-status>元数据已保存；所选文件尚未上传</small>
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
              :disabled="refreshingChecklist || saving || checking || submitting"
              @click="openSubmitConfirmation"
            >
              提交学校审核
            </button>
          </div>
        </footer>
      </form>
    </div>

    <StudentDemoScenarioController
      :enabled="demoEnabled"
      @changed="loadDraft"
      @reset-dialog-change="demoDialogOpen = $event"
    />

    <template #modal>
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
    </template>
  </PortalLayout>
</template>

<style scoped>
.checklist{padding:1rem;border:1px solid #ccdbea;border-radius:.4rem}.checklist h2{font-size:1rem}.checklist li{margin:.35rem 0}.checklist button{color:#174a79;cursor:pointer}

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
