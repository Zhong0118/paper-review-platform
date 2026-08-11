<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import type { ExpertProfile } from '@/demo/types'
import { searchDisciplines } from '@/modules/thesis/data/disciplineCatalog'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { menusByRole } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'

import ExpertLibraryTable from '../components/ExpertLibraryTable.vue'
import ExpertProfileDrawer from '../components/ExpertProfileDrawer.vue'

type ConfirmationKind =
  | 'PAUSE'
  | 'RESUME'
  | 'REJECT_QUALIFICATION'
  | 'APPROVE_QUALIFICATION'
  | 'SAVE_EXPERT'

const service = useScenarioService()
const authStore = useAuthStore()
const router = useRouter()

const rows = ref<ExpertProfile[]>([])
const loading = ref(true)
const listError = ref('')
const feedback = ref('')

const keyword = ref('')
const researchTag = ref('')
const qualificationFilter = ref('')
const serviceStatusFilter = ref('')
const drawerOpen = ref(false)
const selectedExpert = ref<ExpertProfile | null>(null)
const formOpen = ref(false)
const editingExpert = ref<ExpertProfile | null>(null)
const saving = ref(false)
const actionPending = ref(false)
const isMobile = ref(false)

const confirmationAction = ref<ConfirmationKind | null>(null)
const reason = ref('')
const confirmDialog = ref<HTMLElement>()
const cancelConfirm = ref<HTMLButtonElement>()
const overlayOpener = ref<HTMLElement | null>(null)
const libraryRoot = ref<HTMLElement>()

/** 研究方向标签取值来自现有专家档案（演示数据投影），供筛选下拉使用。 */
const researchTagOptions = computed(() =>
  [...new Set(rows.value.flatMap((row) => row.researchTags))].sort(),
)

const stats = computed(() => {
  const total = rows.value.length
  return {
    total,
    dispatchable: rows.value.filter(
      (row) => row.qualification === 'APPROVED' && row.serviceStatus === 'ACTIVE',
    ).length,
    qualificationReview: rows.value.filter((row) => row.qualification === 'REVIEWING').length,
    expiring: 0,
    disabled: rows.value.filter((row) => row.serviceStatus === 'DISABLED').length,
  }
})

function matchesKeyword(row: ExpertProfile, normalized: string) {
  if (!normalized) return true
  return [
    row.name,
    row.unit,
    row.title,
    row.id,
    row.discipline.code,
    row.discipline.name,
    ...row.researchTags,
  ].some((candidate) => candidate.toLocaleLowerCase().includes(normalized))
}

const visibleRows = computed(() => {
  const tag = researchTag.value.trim()
  const qualification = qualificationFilter.value
  const serviceStatus = serviceStatusFilter.value
  const normalized = keyword.value.trim().toLocaleLowerCase()
  return rows.value.filter(
    (row) =>
      (!tag || row.researchTags.includes(tag)) &&
      (!qualification || row.qualification === qualification) &&
      (!serviceStatus || row.serviceStatus === serviceStatus) &&
      matchesKeyword(row, normalized),
  )
})

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作未完成，请重试。'
}

function rememberOverlayOpener() {
  if (document.activeElement instanceof HTMLElement) {
    overlayOpener.value = document.activeElement
  }
}

async function restoreOverlayOpener() {
  await nextTick()
  await nextTick()
  const target =
    overlayOpener.value?.isConnected === true
      ? overlayOpener.value
      : libraryRoot.value?.querySelector<HTMLElement>('[data-action="view-profile"]')
  target?.focus()
  overlayOpener.value = null
}

async function refreshRows() {
  rows.value = await service.listExpertProfiles()
}

async function loadLibrary() {
  loading.value = true
  listError.value = ''
  try {
    await refreshRows()
  } catch (error) {
    listError.value = errorMessage(error)
  } finally {
    loading.value = false
  }
}

function applyFilters() {
  researchTag.value = ''
  qualificationFilter.value = ''
  serviceStatusFilter.value = ''
  keyword.value = ''
}

function openDrawer(row: ExpertProfile) {
  rememberOverlayOpener()
  selectedExpert.value = row
  drawerOpen.value = true
}

async function closeDrawer() {
  drawerOpen.value = false
  await restoreOverlayOpener()
}

function openForm(row?: ExpertProfile) {
  rememberOverlayOpener()
  editingExpert.value = row ?? null
  formOpen.value = true
}

async function closeForm() {
  formOpen.value = false
  editingExpert.value = null
  await restoreOverlayOpener()
}

async function openConfirmation(kind: ConfirmationKind) {
  confirmationAction.value = kind
  reason.value =
    kind === 'PAUSE' ? '人工暂停接单' : kind === 'RESUME' ? '人工恢复接单' : ''
  await nextTick()
  cancelConfirm.value?.focus()
}

async function closeConfirmation() {
  if (actionPending.value) return
  confirmationAction.value = null
  reason.value = ''
  await restoreOverlayOpener()
}

function handleConfirmationKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    void closeConfirmation()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = Array.from(
    confirmDialog.value?.querySelectorAll<HTMLElement>('textarea, button:not(:disabled)') ?? [],
  )
  if (focusable.length === 0) return
  const activeIndex = focusable.indexOf(document.activeElement as HTMLElement)
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

async function confirmAction() {
  const action = confirmationAction.value
  const expert = selectedExpert.value ?? editingExpert.value
  if (!action || !expert || actionPending.value) return
  if (action !== 'PAUSE' && action !== 'RESUME' && !reason.value.trim()) return

  actionPending.value = true
  feedback.value = ''
  try {
    if (action === 'PAUSE' || action === 'RESUME') {
      const status = action === 'PAUSE' ? 'DISABLED' : 'ACTIVE'
      const updated = await service.setExpertServiceStatus(expert.id, status, reason.value.trim())
      rows.value = rows.value.map((row) => (row.id === updated.id ? updated : row))
      if (selectedExpert.value?.id === updated.id) selectedExpert.value = updated
      feedback.value = action === 'PAUSE' ? '已暂停接单，新任务不再指派。' : '已恢复接单。'
    } else if (action === 'REJECT_QUALIFICATION') {
      const updated = await service.reviewExpertQualification(expert.id, 'REJECTED', reason.value.trim())
      rows.value = rows.value.map((row) => (row.id === updated.id ? updated : row))
      if (selectedExpert.value?.id === updated.id) selectedExpert.value = updated
      feedback.value = '资格已驳回并记录原因。'
    } else if (action === 'APPROVE_QUALIFICATION') {
      const updated = await service.reviewExpertQualification(expert.id, 'APPROVED', '资格审核通过')
      rows.value = rows.value.map((row) => (row.id === updated.id ? updated : row))
      if (selectedExpert.value?.id === updated.id) selectedExpert.value = updated
      feedback.value = '资格已通过，可参与派单。'
    } else if (action === 'SAVE_EXPERT' && editingExpert.value) {
      await service.updateExpertProfile(editingExpert.value.id, {
        researchTags: editingExpert.value.researchTags,
        avoidSchools: editingExpert.value.avoidSchools,
        feeStandard: editingExpert.value.feeStandard,
      })
      await refreshRows()
      feedback.value = '专家档案已更新。'
    }
    confirmationAction.value = null
  } catch (error) {
    confirmationAction.value = null
    if (error instanceof Error && 'code' in error && String((error as { code: unknown }).code) === 'STATE_CONFLICT') {
      await refreshRows()
      feedback.value = '专家状态已更新，本次操作未执行。'
    } else {
      feedback.value = `${errorMessage(error)} 请重试。`
    }
  } finally {
    actionPending.value = false
    if (!confirmationAction.value) await restoreOverlayOpener()
  }
}

async function saveExpert() {
  if (saving.value) return
  saving.value = true
  feedback.value = ''
  try {
    if (editingExpert.value) {
      const draft = formDraft.value
      if (!draft) return
      editingExpert.value = {
        ...editingExpert.value,
        researchTags: draft.researchTags,
        avoidSchools: draft.avoidSchools,
        feeStandard: draft.feeStandard,
      }
      await openConfirmation('SAVE_EXPERT')
    } else {
      const create = createForm.value
      await service.createExpertProfile({
        name: create.name,
        unit: create.unit,
        title: create.title,
        discipline: { code: create.disciplineCode, name: create.disciplineName },
        researchTags: create.researchTags
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        avoidSchools: create.avoidSchools
          .split(/[,，]/)
          .map((school) => school.trim())
          .filter(Boolean),
      })
      await refreshRows()
      formOpen.value = false
      feedback.value = '已新增专家'
    }
  } catch (error) {
    feedback.value = `${errorMessage(error)} 请重试。`
  } finally {
    saving.value = false
  }
}

function handleTableAction(
  action: 'pause' | 'resume' | 'reviewQualification' | 'rejectQualification' | 'edit' | 'view' | 'dispatch',
  row: ExpertProfile,
) {
  if (action === 'view') {
    openDrawer(row)
  } else if (action === 'edit') {
    openForm(row)
  } else if (action === 'dispatch') {
    void router.push({ path: '/platform/dispatch', query: { expertId: row.id } })
  } else {
    selectedExpert.value = row
    void openConfirmation(
      action === 'pause'
        ? 'PAUSE'
        : action === 'resume'
          ? 'RESUME'
          : action === 'reviewQualification'
            ? 'APPROVE_QUALIFICATION'
            : 'REJECT_QUALIFICATION',
    )
  }
}

function handleDrawerAction(action: 'edit' | 'pause' | 'resume' | 'reviewQualification' | 'rejectQualification') {
  const expert = selectedExpert.value
  if (!expert) return
  if (action === 'edit') {
    drawerOpen.value = false
    void nextTick(() => openForm(expert))
    return
  }
  drawerOpen.value = false
  void nextTick(() =>
    handleTableAction(
      action === 'reviewQualification' ? 'reviewQualification' : action,
      expert,
    ),
  )
}

const formDraft = computed(() => {
  const expert = editingExpert.value
  if (!expert) return null
  return {
    name: expert.name,
    unit: expert.unit,
    title: expert.title,
    disciplineCode: expert.discipline.code,
    disciplineName: expert.discipline.name,
    researchTags: [...expert.researchTags],
    avoidSchools: [...expert.avoidSchools],
    feeStandard: expert.feeStandard,
  }
})

function updateDraft(field: string, value: string | number | string[]) {
  const expert = editingExpert.value
  if (!expert) return
  if (field === 'researchTags') {
    editingExpert.value = {
      ...expert,
      researchTags: String(value)
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    }
  } else if (field === 'avoidSchools') {
    editingExpert.value = {
      ...expert,
      avoidSchools: String(value)
        .split(/[,，]/)
        .map((school) => school.trim())
        .filter(Boolean),
    }
  } else if (field === 'feeStandard') {
    editingExpert.value = { ...expert, feeStandard: Number(value) }
  }
}

const createForm = ref({
  name: '',
  unit: '',
  title: '',
  disciplineCode: '',
  disciplineName: '',
  researchTags: '',
  avoidSchools: '',
})

function updateCreateField(field: string, value: string) {
  ;(createForm.value as Record<string, string>)[field] = value
  if (field === 'disciplineCode') {
    createForm.value.disciplineName = searchDisciplines(value)[0]?.name ?? ''
  }
}

function updateMobileFlag() {
  isMobile.value = (typeof window !== 'undefined' ? window.innerWidth : 0) <= 900
}

onMounted(() => {
  updateMobileFlag()
  window.addEventListener('resize', updateMobileFlag)
  void loadLibrary()
})
</script>

<template>
  <PortalLayout
    :menu-items="menusByRole.platform_reviewer ?? []"
    active-path="/platform/experts"
    context-label="百杰运营端 · 专家库"
    :user-name="authStore.user?.displayName ?? '陈岚'"
    :background-locked="drawerOpen || Boolean(confirmationAction) || formOpen"
  >
    <div ref="libraryRoot" class="library-page">
      <PageHeader
        eyebrow="PAGE-006 · EXPERT DIRECTORY"
        title="专家库"
        description="维护平台专家档案、资格和服务状态，并结合负载、接单率和按时完成率辅助人工派单。"
      >
        <template #actions>
          <button
            type="button"
            class="toolbar-action primary"
            data-action="create-expert"
            @click="openForm()"
          >
            新增专家
          </button>
          <button
            type="button"
            class="toolbar-action quiet"
            data-action="batch-import"
            title="演示占位：批量导入将在后续迭代提供"
          >
            批量导入
          </button>
        </template>
      </PageHeader>

      <BlindRail
        audience="平台专家身份、资格、负载、任务与费用摘要"
        hidden-from="学校不可访问专家库；专家之间不可互见；不出现学生/导师身份与论文内容"
        stage="平台共享专家资源"
      />

      <section class="stat-grid" aria-label="专家库统计">
        <article class="stat-card" data-stat="total">
          <span>专家总数</span>
          <strong>{{ stats.total }}</strong>
        </article>
        <article class="stat-card" data-stat="dispatchable">
          <span>可派</span>
          <strong>{{ stats.dispatchable }}</strong>
        </article>
        <article class="stat-card" data-stat="qualification-review">
          <span>待审资格</span>
          <strong>{{ stats.qualificationReview }}</strong>
        </article>
        <article class="stat-card" data-stat="expiring">
          <span>即将到期</span>
          <strong>{{ stats.expiring }}</strong>
        </article>
        <article class="stat-card" data-stat="disabled">
          <span>已停用</span>
          <strong>{{ stats.disabled }}</strong>
        </article>
      </section>

      <section class="filters" aria-label="专家库筛选">
        <label>
          <span>研究方向</span>
          <select v-model="researchTag" data-filter="research-tag">
            <option value="">全部</option>
            <option v-for="tag in researchTagOptions" :key="tag" :value="tag">{{ tag }}</option>
          </select>
        </label>
        <label>
          <span>资格状态</span>
          <select v-model="qualificationFilter" data-filter="qualification">
            <option value="">全部</option>
            <option value="APPROVED">资格通过</option>
            <option value="REVIEWING">审核中</option>
            <option value="REJECTED">资格驳回</option>
          </select>
        </label>
        <label>
          <span>服务状态</span>
          <select v-model="serviceStatusFilter" data-filter="service-status">
            <option value="">全部</option>
            <option value="ACTIVE">可接单</option>
            <option value="DISABLED">暂停接单</option>
          </select>
        </label>
        <label class="filters__keyword">
          <span>关键字</span>
          <input
            v-model="keyword"
            data-filter="keyword"
            placeholder="姓名、单位、专业或研究方向"
          />
        </label>
        <div class="filters__actions">
          <button type="button" data-action="query-experts" @click="feedback = ''">查询</button>
          <button type="button" class="secondary" data-action="reset-filters" @click="applyFilters">
            重置
          </button>
        </div>
      </section>

      <p v-if="feedback" class="workspace-feedback" role="status">{{ feedback }}</p>

      <section v-if="listError" class="workspace-error" role="alert">
        <p>{{ listError }}</p>
        <button type="button" data-action="reload-experts" @click="loadLibrary">重新加载</button>
      </section>
      <p v-else-if="loading" class="workspace-loading" role="status">正在加载专家档案…</p>

      <section v-else class="library-list" aria-labelledby="library-list-title">
        <header>
          <div>
            <span>EXPERT DIRECTORY</span>
            <h2 id="library-list-title">专家档案</h2>
          </div>
          <small>显示 {{ visibleRows.length }} / {{ rows.length }} 位专家</small>
        </header>
        <ExpertLibraryTable
          :rows="visibleRows"
          :mobile="isMobile"
          @pause="handleTableAction('pause', $event)"
          @resume="handleTableAction('resume', $event)"
          @review-qualification="handleTableAction('reviewQualification', $event)"
          @reject-qualification="handleTableAction('rejectQualification', $event)"
          @edit="handleTableAction('edit', $event)"
          @view="handleTableAction('view', $event)"
          @dispatch="handleTableAction('dispatch', $event)"
        />
      </section>
    </div>

    <template #modal>
      <ExpertProfileDrawer
        v-if="drawerOpen && selectedExpert"
        :expert="selectedExpert"
        @close="closeDrawer"
        @action="handleDrawerAction"
      />

      <div v-if="formOpen" class="dialog-backdrop" @click.self="closeForm">
        <section class="expert-form" role="dialog" aria-modal="true" aria-labelledby="expert-form-title" data-expert-form>
          <header>
            <div>
              <span>EXPERT PROFILE</span>
              <h2 id="expert-form-title">{{ editingExpert ? '编辑专家' : '新增专家' }}</h2>
            </div>
            <button type="button" aria-label="关闭" data-action="close-expert-form" @click="closeForm">
              ×
            </button>
          </header>

          <template v-if="editingExpert">
            <p class="expert-form__note">
              平台侧可维护研究方向、回避学校与费用标准；姓名、单位、职称等身份字段由专家本人维护（PAGE-021）。
            </p>
            <dl class="expert-form__facts">
              <div>
                <dt>姓名 / 单位 / 职称</dt>
                <dd>{{ editingExpert.name }} · {{ editingExpert.unit }} · {{ editingExpert.title }}</dd>
              </div>
              <div>
                <dt>学科专业</dt>
                <dd>{{ editingExpert.discipline.code }} {{ editingExpert.discipline.name }}</dd>
              </div>
            </dl>
            <label>
              <span>研究方向（逗号分隔，最多 8 个）</span>
              <input
                type="text"
                :value="formDraft?.researchTags.join('，') ?? ''"
                placeholder="如：知识图谱，机器学习"
                @input="updateDraft('researchTags', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label>
              <span>回避学校（逗号分隔）</span>
              <input
                type="text"
                :value="formDraft?.avoidSchools.join('，') ?? ''"
                placeholder="如：东江理工大学，海岳大学"
                @input="updateDraft('avoidSchools', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label>
              <span>费用标准（元 / 篇）</span>
              <input
                type="number"
                min="0"
                step="0.01"
                :value="formDraft?.feeStandard ?? 0"
                @input="updateDraft('feeStandard', ($event.target as HTMLInputElement).value)"
              />
            </label>
          </template>

          <template v-else>
            <label>
              <span>姓名（必填）</span>
              <input v-model="createForm.name" type="text" data-field="name" placeholder="专家姓名" />
            </label>
            <label>
              <span>所属单位（必填）</span>
              <input v-model="createForm.unit" type="text" data-field="unit" placeholder="单位名称" />
            </label>
            <label>
              <span>职称（必填）</span>
              <input v-model="createForm.title" type="text" data-field="title" placeholder="如：教授、副教授" />
            </label>
            <label>
              <span>学科专业（受控目录，代码或名称）</span>
              <input
                v-model="createForm.disciplineCode"
                type="text"
                data-field="discipline"
                placeholder="如：0812 或 软件工程"
                @input="updateCreateField('disciplineCode', ($event.target as HTMLInputElement).value)"
              />
              <small class="expert-form__hint">
                {{ createForm.disciplineName || '请输入代码或名称以匹配受控目录（184 条目）' }}
              </small>
            </label>
            <label>
              <span>研究方向（逗号分隔，最多 8 个）</span>
              <input
                v-model="createForm.researchTags"
                type="text"
                data-field="research-tags"
                placeholder="如：可信软件，程序分析"
              />
            </label>
            <label>
              <span>回避学校（逗号分隔，可选）</span>
              <input
                v-model="createForm.avoidSchools"
                type="text"
                data-field="avoid-schools"
                placeholder="如：东江理工大学"
              />
            </label>
          </template>

          <footer>
            <button type="button" data-action="cancel-expert-form" @click="closeForm">取消</button>
            <button
              type="button"
              class="is-primary"
              data-form-action="save-expert"
              :disabled="saving"
              @click="saveExpert"
            >
              {{ saving ? '正在保存…' : editingExpert ? '保存修改' : '保存专家' }}
            </button>
          </footer>
        </section>
      </div>

      <div v-if="confirmationAction" class="dialog-backdrop">
        <section
          ref="confirmDialog"
          class="action-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="action-dialog-title"
          @keydown="handleConfirmationKeydown"
        >
          <h2 id="action-dialog-title">
            {{
              confirmationAction === 'PAUSE'
                ? '确认暂停接单？'
                : confirmationAction === 'RESUME'
                  ? '确认恢复接单？'
                  : confirmationAction === 'REJECT_QUALIFICATION'
                    ? '确认驳回资格？'
                    : confirmationAction === 'APPROVE_QUALIFICATION'
                      ? '确认资格审核通过？'
                      : '确认保存专家档案？'
            }}
          </h2>
          <p v-if="confirmationAction === 'PAUSE'">
            暂停后该专家不再被新任务指派，既有评阅任务不受影响。
          </p>
          <p v-else-if="confirmationAction === 'RESUME'">恢复后该专家可继续参与新任务指派。</p>
          <p v-else-if="confirmationAction === 'APPROVE_QUALIFICATION'">
            通过后该专家进入可派候选；该操作将写入审计。
          </p>
          <p v-else-if="confirmationAction === 'SAVE_EXPERT'">
            重要变更（研究方向、回避、费用标准）将写入审计。
          </p>
          <p v-else>驳回后该专家不可参与派单，需重新提交资格材料后再审核。</p>
          <label v-if="confirmationAction === 'PAUSE' || confirmationAction === 'RESUME'">
            <span>操作原因</span>
            <textarea
              v-model="reason"
              name="operationReason"
              rows="4"
              placeholder="请说明操作原因"
            />
          </label>
          <label v-else-if="confirmationAction === 'REJECT_QUALIFICATION'">
            <span>驳回原因（必填）</span>
            <textarea
              v-model="reason"
              name="qualificationReason"
              rows="4"
              placeholder="请说明驳回原因"
            />
          </label>
          <footer>
            <button
              ref="cancelConfirm"
              type="button"
              data-action="cancel-confirmation"
              @click="closeConfirmation"
            >
              取消
            </button>
            <button
              type="button"
              :data-action="
                confirmationAction === 'PAUSE'
                  ? 'confirm-pause'
                  : confirmationAction === 'RESUME'
                    ? 'confirm-resume'
                    : confirmationAction === 'REJECT_QUALIFICATION'
                      ? 'confirm-qualification-reject'
                      : 'confirm-save-expert'
              "
              :disabled="
                actionPending ||
                ((confirmationAction === 'PAUSE' ||
                  confirmationAction === 'RESUME' ||
                  confirmationAction === 'REJECT_QUALIFICATION') &&
                  !reason.trim())
              "
              @click="confirmAction"
            >
              {{
                actionPending
                  ? '正在提交…'
                  : confirmationAction === 'PAUSE'
                    ? '确认暂停'
                    : confirmationAction === 'RESUME'
                      ? '确认恢复'
                      : confirmationAction === 'REJECT_QUALIFICATION'
                        ? '确认驳回'
                        : confirmationAction === 'APPROVE_QUALIFICATION'
                          ? '确认通过'
                          : '确认保存'
              }}
            </button>
          </footer>
        </section>
      </div>
    </template>
  </PortalLayout>
</template>

<style scoped>
.library-page {
  display: grid;
  min-width: 0;
  gap: 1.25rem;
}

.toolbar-action {
  min-height: 2.5rem;
  padding: 0.5rem 0.875rem;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  font-weight: 700;
  cursor: pointer;
}

.toolbar-action.primary {
  background: var(--color-primary);
  color: var(--color-bg);
}

.toolbar-action.quiet {
  border-color: var(--color-border);
  background: var(--color-bg);
  color: var(--color-text-secondary);
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.75rem;
}

.stat-card {
  padding: 1rem;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}

.stat-card span,
.stat-card strong {
  display: block;
}

.stat-card span {
  color: var(--color-text-secondary);
  font-size: 0.75rem;
}

.stat-card strong {
  margin-top: 0.5rem;
  color: var(--color-primary);
  font-family: var(--font-data);
  font-size: 1.75rem;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
  padding: 0.875rem;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}

.filters label {
  display: grid;
  gap: 0.35rem;
}

.filters label > span {
  color: var(--color-text-secondary);
  font-size: 0.6875rem;
  font-weight: 650;
}

.filters input,
.filters select {
  min-width: 11rem;
  height: 2.25rem;
  padding: 0 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
}

.filters__keyword input {
  min-width: 16rem;
}

.filters__actions {
  display: flex;
  gap: 0.5rem;
}

.filters__actions button,
.workspace-error button,
.action-dialog button,
.expert-form button {
  min-height: 2.25rem;
  padding: 0.4rem 0.8rem;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: var(--color-primary);
  color: var(--color-bg);
  font-weight: 650;
  cursor: pointer;
}

.filters__actions button.secondary {
  background: var(--color-bg);
  color: var(--color-primary);
}

.workspace-feedback,
.workspace-error,
.workspace-loading {
  margin: 0;
  padding: 0.875rem 1rem;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text-secondary);
}

.workspace-feedback {
  border-left: 3px solid var(--color-info);
}

.workspace-error {
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.workspace-error p {
  margin: 0;
}

.library-list > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.625rem;
}

.library-list h2 {
  margin: 0.15rem 0 0;
  font-family: var(--font-display);
  font-size: 1rem;
}

.library-list > header span,
.library-list > header small {
  color: var(--color-text-secondary);
  font-family: var(--font-data);
  font-size: 0.6875rem;
}

.dialog-backdrop {
  position: fixed;
  z-index: 70;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: color-mix(in srgb, var(--color-primary-active) 50%, transparent);
}

.action-dialog,
.expert-form {
  display: grid;
  width: min(28rem, 100%);
  gap: 1rem;
  padding: 1.25rem;
  border-radius: var(--radius-md);
  background: var(--color-bg);
  box-shadow: var(--shadow-md);
}

.expert-form {
  max-height: 90vh;
  overflow-y: auto;
}

.expert-form > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--color-border);
}

.expert-form header span {
  color: var(--color-text-secondary);
  font-family: var(--font-data);
  font-size: 0.6875rem;
}

.expert-form h2,
.action-dialog h2,
.action-dialog p {
  margin: 0;
}

.expert-form h2 {
  margin-top: 0.15rem;
  font-family: var(--font-display);
  font-size: 1.125rem;
}

.expert-form > header button {
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 1.5rem;
  line-height: 1;
}

.expert-form label {
  display: grid;
  gap: 0.35rem;
}

.expert-form label > span {
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  font-weight: 650;
}

.expert-form input {
  width: 100%;
  padding: 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
}

.expert-form__note,
.expert-form__hint {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  line-height: 1.6;
}

.expert-form__note {
  padding: 0.75rem;
  border-left: 3px solid var(--color-warning);
  background: var(--color-fill);
}

.expert-form__facts {
  display: grid;
  gap: 0.5rem;
  margin: 0;
}

.expert-form__facts div {
  display: grid;
  grid-template-columns: 7rem minmax(0, 1fr);
  gap: 0.6rem;
}

.expert-form__facts dt {
  color: var(--color-text-secondary);
  font-size: 0.6875rem;
  font-weight: 650;
}

.expert-form__facts dd {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 0.8125rem;
}

.expert-form > footer,
.action-dialog footer {
  display: flex;
  gap: 0.5rem;
  justify-content: end;
}

.expert-form > footer button:first-child,
.action-dialog footer button:first-child {
  background: var(--color-bg);
  color: var(--color-primary);
}

.expert-form button.is-primary {
  font-weight: 700;
}

.expert-form button:disabled,
.action-dialog button:disabled {
  border-color: var(--color-border);
  background: var(--color-fill);
  color: var(--color-text-disabled);
  cursor: not-allowed;
}

.action-dialog h2 {
  font-family: var(--font-display);
  font-size: 1.125rem;
}

.action-dialog p,
.action-dialog label {
  color: var(--color-text-secondary);
  font-size: 0.8125rem;
  line-height: 1.65;
}

.action-dialog label,
.action-dialog label span {
  display: grid;
  gap: 0.35rem;
}

.action-dialog textarea {
  width: 100%;
  padding: 0.625rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  resize: vertical;
}

@media (max-width: 900px) {
  .stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .filters__keyword input {
    min-width: 0;
    width: 100%;
  }

  .filters input,
  .filters select {
    min-width: 0;
    width: 100%;
  }

  .filters label {
    flex: 1 1 45%;
  }
}

@media (max-width: 480px) {
  .workspace-error,
  .action-dialog footer,
  .expert-form > footer {
    align-items: stretch;
    flex-direction: column;
  }

  .expert-form > footer button,
  .action-dialog footer button {
    width: 100%;
  }
}
</style>
