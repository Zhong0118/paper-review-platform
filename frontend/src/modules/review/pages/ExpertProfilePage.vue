<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import type { ExpertSelfProfile } from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { menusByRole } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'
import ExpertProfileForm from '../components/ExpertProfileForm.vue'

const service = useScenarioService()

const profile = ref<ExpertSelfProfile | null>(null)
const loading = ref(true)
const error = ref('')
const saveError = ref('')
const saving = ref(false)
const saved = ref(false)

const statusLabel = computed(() => {
  if (!profile.value) return ''
  if (profile.value.qualification === 'APPROVED') return '资格通过'
  if (profile.value.qualification === 'REVIEWING') return '资格审核中'
  return '资格驳回'
})

const statusTone = computed(() => {
  if (!profile.value) return 'neutral'
  if (profile.value.qualification === 'APPROVED') return 'success'
  if (profile.value.qualification === 'REVIEWING') return 'warning'
  return 'danger'
})

onMounted(async () => {
  try {
    profile.value = await service.getExpertProfile()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '资料加载失败。'
  } finally {
    loading.value = false
  }
})

// 保存二次确认对话框状态
const saveConfirmOpen = ref(false)
const saveDialog = ref<HTMLElement | null>(null)
const saveDialogOpener = ref<HTMLElement | null>(null)
const resubmitPending = ref(false)
const resubmitDialogButton = ref<HTMLElement | null>(null)
const pendingInput = ref<Record<string, unknown> | null>(null)

async function requestSave(input: Record<string, unknown>) {
  if (saving.value || !profile.value) return
  pendingInput.value = input
  saveError.value = ''
  saved.value = false
  saveConfirmOpen.value = true
  if (document.activeElement instanceof HTMLElement) {
    saveDialogOpener.value = document.activeElement
  }
  await nextTick()
  saveDialog.value?.querySelector<HTMLElement>('[data-action="confirm-save-profile"]')?.focus()
}

function openResubmitDialog() {
  resubmitPending.value = true
  void nextTick(() => resubmitDialogButton.value?.focus())
}

async function cancelSave() {
  if (saving.value) return
  saveConfirmOpen.value = false
  saveError.value = ''
  await nextTick()
  saveDialogOpener.value?.focus()
  saveDialogOpener.value = null
}

function handleSaveKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    void cancelSave()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = Array.from(
    saveDialog.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), select, textarea, input',
    ) ?? [],
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

async function confirmSave() {
  const input = pendingInput.value
  if (!input || saving.value) return
  saving.value = true
  saveError.value = ''
  saved.value = false
  try {
    profile.value = await service.saveExpertProfile(input)
    saveConfirmOpen.value = false
    pendingInput.value = null
    saved.value = true
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : '保存资料失败，请稍后重试。'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <PortalLayout
    :menu-items="menusByRole.expert ?? []"
    active-path="/expert/profile"
    context-label="专家端 · 双盲评阅"
    :user-name="useAuthStore().user?.displayName ?? '周明远教授'"
  >
    <div class="profile-page">
      <PageHeader
        eyebrow="PAGE-021 · EXPERT PROFILE"
        title="个人资料与资格"
        description="仅展示并维护本人资料。姓名按平台策略只读；资格材料为演示投影，不读取文件正文，审核状态以平台审核结果为准。"
      />
      <BlindRail
        audience="本人档案、资格材料和审核状态"
        hidden-from="其他专家、学生与学校送审业务数据"
        stage="专家本人维护 · 平台审核"
      />

      <p v-if="error" class="profile-page__error" role="alert">{{ error }}</p>
      <p v-else-if="loading" class="profile-page__loading">正在加载资料…</p>

      <template v-else-if="profile">
        <section class="qualification" :data-qualification-status="profile.qualification">
          <div class="qualification__identity">
            <div class="qualification__seal">{{ profile.name.slice(0, 1) }}</div>
            <div>
              <h2>{{ profile.name }}</h2>
              <p>{{ profile.unit }} · {{ profile.title }}</p>
            </div>
          </div>
          <dl class="qualification__meta">
            <div>
              <dt>专家编号</dt>
              <dd>{{ profile.id.toUpperCase() }}</dd>
            </div>
            <div>
              <dt>资格状态</dt>
              <dd class="qualification__status" :data-tone="statusTone">{{ statusLabel }}</dd>
            </div>
          </dl>
          <p v-if="profile.qualification === 'REJECTED' && profile.qualificationNote" class="qualification__note">
            驳回原因：{{ profile.qualificationNote }}
          </p>
        </section>

        <section class="materials">
          <div class="materials__head">
            <h2>资格材料</h2>
            <span class="materials__hint">演示投影：仅保存文件名、类型、有效期与审核状态，不读取文件正文。</span>
          </div>
          <ul v-if="profile.qualificationMaterials.length > 0" class="materials__list">
            <li v-for="material in profile.qualificationMaterials" :key="material.id" class="material">
              <div>
                <strong data-material-name>{{ material.fileName }}</strong>
                <p>
                  {{ material.fileType }} · 有效期至 <time>{{ material.validUntil }}</time> ·
                  提交于 {{ material.submittedAt }}
                </p>
                <p v-if="material.status === 'REJECTED' && material.rejectReason" class="material__reason">
                  驳回原因：{{ material.rejectReason }}
                </p>
              </div>
              <span
                class="material__status"
                :data-tone="material.status === 'APPROVED' ? 'success' : material.status === 'REVIEWING' ? 'warning' : 'danger'"
              >
                {{
                  material.status === 'APPROVED'
                    ? '已通过'
                    : material.status === 'REVIEWING'
                      ? '审核中'
                      : '已驳回'
                }}
              </span>
            </li>
          </ul>
          <p v-else class="materials__empty">暂无资格材料。</p>
          <p v-if="profile.qualification === 'REJECTED'" class="materials__resubmit">
            资格未通过：请核对驳回原因后补充或更换材料，重新提交平台审核。
          </p>
          <button
            v-if="profile.qualification === 'REJECTED'"
            type="button"
            class="materials__resubmit-button"
            data-action="re-submit-qualification"
            @click="openResubmitDialog"
          >
            重新提交资格材料
          </button>
        </section>

        <ExpertProfileForm
          :profile="profile"
          :saving="saving"
          :saved="saved"
          @save="requestSave"
        />
      </template>
    </div>

    <template #modal>
      <div v-if="saveConfirmOpen" class="dialog-backdrop">
        <section
          ref="saveDialog"
          class="action-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-dialog-title"
          @keydown="handleSaveKeydown"
        >
          <h2 id="save-dialog-title">确认保存资料？</h2>
          <p>
            资料变更将写入审计，并用于平台后续候选匹配；姓名按平台策略只读，不会随本次保存变更。
          </p>
          <p v-if="saveError" class="action-dialog__error" role="alert">{{ saveError }}</p>
          <footer>
            <button type="button" data-action="cancel-save-profile" :disabled="saving" @click="cancelSave">
              取消
            </button>
            <button
              type="button"
              data-action="confirm-save-profile"
              :disabled="saving"
              @click="confirmSave"
            >
              {{ saving ? '正在保存…' : '保存资料' }}
            </button>
          </footer>
        </section>
      </div>
      <div v-if="resubmitPending" class="dialog-backdrop">
        <section
          class="action-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="resubmit-dialog-title"
          @keydown.esc="resubmitPending = false"
        >
          <h2 id="resubmit-dialog-title">重新提交资格材料（演示入口）</h2>
          <p>
            演示阶段仅保存文件名、类型、有效期与审核状态，不读取文件正文。正式系统将支持在此上传补充材料并重新提交平台审核。
          </p>
          <footer>
            <button
              ref="resubmitDialogButton"
              type="button"
              data-action="close-resubmit"
              autofocus
              @click="resubmitPending = false"
            >
              知道了
            </button>
          </footer>
        </section>
      </div>
    </template>
  </PortalLayout>
</template>

<style scoped>
.profile-page {
  display: grid;
  min-width: 0;
  gap: 1rem;
}

.profile-page__error {
  margin: 0;
  padding: 0.6rem 0.75rem;
  background: #fbeaea;
  color: #b03232;
  font-size: 0.72rem;
}

.profile-page__loading {
  margin: 0;
  padding: 0.6rem 0.75rem;
  color: #7c8993;
  font-size: 0.72rem;
}

.qualification {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 1rem;
  align-items: center;
  padding: 1rem;
  border: 1px solid var(--color-border, #d8e0e6);
  background: #fff;
}

.qualification__identity {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.qualification__seal {
  display: grid;
  width: 3.25rem;
  height: 3.25rem;
  place-items: center;
  border-radius: 50%;
  background: #e8f0f9;
  color: #1b4f8a;
  font-family: var(--font-display);
  font-size: 1.2rem;
}

.qualification__identity h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1rem;
}

.qualification__identity p {
  margin: 0.25rem 0 0;
  color: #687681;
  font-size: 0.72rem;
}

.qualification__meta {
  display: flex;
  gap: 1.5rem;
  margin: 0;
}

.qualification__meta dt {
  color: #7a8791;
  font-size: 0.62rem;
}

.qualification__meta dd {
  margin: 0.2rem 0 0;
  color: #344652;
  font-family: var(--font-data);
  font-size: 0.7rem;
}

.qualification__status {
  display: inline-block;
  padding: 0.18rem 0.4rem;
  border-radius: 0.25rem;
  font-size: 0.68rem;
}

.qualification__status[data-tone='success'] {
  background: #edf7ee;
  color: #28642d;
}

.qualification__status[data-tone='warning'] {
  background: #fdf6e5;
  color: #8a6d1f;
}

.qualification__status[data-tone='danger'] {
  background: #fbeaea;
  color: #b03232;
}

.qualification__note {
  grid-column: 1 / -1;
  margin: 0;
  padding: 0.5rem 0.65rem;
  background: #fbeaea;
  color: #b03232;
  font-size: 0.72rem;
}

.materials {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--color-border, #d8e0e6);
  background: #fff;
}

.materials__head {
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
  justify-content: space-between;
}

.materials__head h2 {
  margin: 0;
  color: #1f2d3a;
  font-family: var(--font-display);
  font-size: 0.95rem;
}

.materials__hint {
  color: #7a8791;
  font-size: 0.66rem;
}

.materials__list {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.material {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.65rem 0.75rem;
  border: 1px solid #e3e8ec;
  border-radius: 0.3rem;
}

.material strong {
  color: #344652;
  font-size: 0.78rem;
}

.material p {
  margin: 0.25rem 0 0;
  color: #71808c;
  font-size: 0.68rem;
}

.material__reason {
  color: #b03232 !important;
}

.material__status {
  flex-shrink: 0;
  padding: 0.18rem 0.4rem;
  border-radius: 0.25rem;
  font-size: 0.68rem;
}

.material__status[data-tone='success'] {
  background: #edf7ee;
  color: #28642d;
}

.material__status[data-tone='warning'] {
  background: #fdf6e5;
  color: #8a6d1f;
}

.material__status[data-tone='danger'] {
  background: #fbeaea;
  color: #b03232;
}

.materials__empty {
  margin: 0;
  color: #7a8791;
  font-size: 0.72rem;
}

.materials__resubmit {
  margin: 0;
  padding: 0.5rem 0.65rem;
  border: 1px dashed #b03232;
  background: #fdf4f4;
  color: #8a2c2c;
  font-size: 0.72rem;
}

.materials__resubmit-button {
  justify-self: start;
  padding: 0.45rem 0.9rem;
  border: 1px solid #b03232;
  border-radius: 0.3rem;
  background: #fff;
  color: #b03232;
  font-weight: 650;
  cursor: pointer;
}

.dialog-backdrop {
  position: fixed;
  z-index: 70;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: color-mix(in srgb, #0d2b47 50%, transparent);
}

.action-dialog {
  display: grid;
  width: min(30rem, 100%);
  gap: 1rem;
  padding: 1.25rem;
  border-radius: 0.5rem;
  background: #fff;
  box-shadow: 0 0.5rem 2rem rgb(13 43 71 / 35%);
}

.action-dialog h2,
.action-dialog p {
  margin: 0;
}

.action-dialog h2 {
  color: #1f2d3a;
  font-family: var(--font-display);
  font-size: 1.125rem;
}

.action-dialog p {
  color: #4b5966;
  font-size: 0.78rem;
  line-height: 1.65;
}

.action-dialog__error {
  color: #b03232 !important;
}

.action-dialog footer {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

.action-dialog button {
  padding: 0.5rem 0.875rem;
  border: 1px solid var(--color-border, #d8e0e6);
  border-radius: 0.3rem;
  background: #fff;
  color: #3a4a58;
  font-weight: 650;
  cursor: pointer;
}

.action-dialog button[data-action='confirm-save-profile'] {
  border-color: #1b4f8a;
  background: #1b4f8a;
  color: #fff;
}

.action-dialog button:disabled {
  border-color: #d8dee3;
  background: #f2f4f6;
  color: #a3adb6;
  cursor: not-allowed;
}

@media (max-width: 640px) {
  .qualification {
    grid-template-columns: 1fr;
  }

  .qualification__meta {
    justify-content: space-between;
  }
}
</style>
