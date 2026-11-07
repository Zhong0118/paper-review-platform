<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'

import type { ExpertProfile } from '@/demo/types'

export type ExpertProfileDrawerAction =
  | 'edit'
  | 'pause'
  | 'resume'
  | 'reviewQualification'
  | 'rejectQualification'

defineProps<{ expert: ExpertProfile }>()
const emit = defineEmits<{ close: []; action: [action: ExpertProfileDrawerAction] }>()

function qualificationTone(qualification: ExpertProfile['qualification']) {
  if (qualification === 'APPROVED') return 'success'
  if (qualification === 'REVIEWING') return 'warning'
  return 'danger'
}

function qualificationLabel(qualification: ExpertProfile['qualification']) {
  if (qualification === 'APPROVED') return '资格通过'
  if (qualification === 'REVIEWING') return '资格审核中'
  return '资格驳回'
}

function serviceTone(serviceStatus: ExpertProfile['serviceStatus']) {
  return serviceStatus === 'ACTIVE' ? 'success' : 'neutral'
}

const drawer = ref<HTMLElement>()
const closeButton = ref<HTMLButtonElement>()
const activeTab = ref<'basic' | 'qualification' | 'avoidance' | 'history' | 'fees' | 'audit'>(
  'basic',
)

const tabs: Array<{ key: typeof activeTab.value; label: string }> = [
  { key: 'basic', label: '基本资料' },
  { key: 'qualification', label: '资格与材料' },
  { key: 'avoidance', label: '回避管理' },
  { key: 'history', label: '历史任务' },
  { key: 'fees', label: '费用摘要' },
  { key: 'audit', label: '操作日志' },
]

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return
  const focusable = Array.from(
    drawer.value?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') ?? [],
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

onMounted(() => {
  void nextTick(() => closeButton.value?.focus())
})
</script>

<template>
  <div class="drawer-backdrop" @click.self="emit('close')">
    <aside
      ref="drawer"
      class="profile-drawer"
      data-expert-drawer
      :data-expert-id="expert.id"
      role="dialog"
      aria-modal="true"
      aria-labelledby="expert-drawer-title"
      @keydown="handleKeydown"
    >
      <header>
        <div>
          <span>{{ expert.discipline.code }} · {{ expert.discipline.name }}</span>
          <h2 id="expert-drawer-title">{{ expert.name }}</h2>
          <small>{{ expert.unit }} · {{ expert.title }} · {{ expert.id }}</small>
        </div>
        <button
          ref="closeButton"
          type="button"
          aria-label="关闭专家详情"
          data-action="close-drawer"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <div class="profile-drawer__tags" aria-label="资格与服务状态">
        <span
          class="expert-tag"
          :class="`expert-tag--${qualificationTone(expert.qualification)}`"
        >{{ qualificationLabel(expert.qualification) }}</span>
        <span
          class="expert-tag"
          :class="`expert-tag--${serviceTone(expert.serviceStatus)}`"
        >{{ expert.serviceStatus === 'ACTIVE' ? '可接单' : '暂停接单' }}</span>
      </div>

      <nav class="profile-drawer__tabs" aria-label="专家详情分页">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          :data-drawer-tab="tab.key"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </nav>

      <section v-show="activeTab === 'basic'" class="profile-drawer__panel" data-drawer-panel="basic">
        <dl class="profile-drawer__facts">
          <div>
            <dt>姓名</dt>
            <dd>{{ expert.name }}</dd>
          </div>
          <div>
            <dt>所属单位</dt>
            <dd>{{ expert.unit }}</dd>
          </div>
          <div>
            <dt>职称</dt>
            <dd>{{ expert.title }}</dd>
          </div>
          <div>
            <dt>学科专业</dt>
            <dd>{{ expert.discipline.code }} {{ expert.discipline.name }}</dd>
          </div>
          <div>
            <dt>研究方向</dt>
            <dd class="profile-drawer__tagrow">
              <span v-for="tag in expert.researchTags" :key="tag" class="research-tag">{{ tag }}</span>
              <span v-if="expert.researchTags.length === 0" class="profile-drawer__muted">未设置</span>
            </dd>
          </div>
          <div>
            <dt>可评论文类型</dt>
            <dd>{{ expert.reviewableTypes.join('、') || '未设置' }}</dd>
          </div>
        </dl>
      </section>

      <section
        v-show="activeTab === 'qualification'"
        class="profile-drawer__panel"
        data-drawer-panel="qualification"
      >
        <dl class="profile-drawer__facts">
          <div>
            <dt>资格状态</dt>
            <dd>
              {{
                expert.qualification === 'APPROVED'
                  ? '资格通过'
                  : expert.qualification === 'REVIEWING'
                    ? '审核中'
                    : '资格驳回'
              }}
            </dd>
          </div>
          <div v-if="expert.qualification === 'REJECTED' && expert.qualificationNote">
            <dt>驳回原因</dt>
            <dd>{{ expert.qualificationNote }}</dd>
          </div>
          <div>
            <dt>资质材料</dt>
            <dd>职称证书（演示投影：文件名 / 类型 / 有效期 / 审核状态，不读取正文）</dd>
          </div>
          <div>
            <dt>服务状态</dt>
            <dd>
              {{ expert.serviceStatus === 'ACTIVE' ? '可接单' : '暂停接单' }}
              <span v-if="expert.serviceNote" class="profile-drawer__muted">（{{ expert.serviceNote }}）</span>
            </dd>
          </div>
        </dl>
      </section>

      <section
        v-show="activeTab === 'avoidance'"
        class="profile-drawer__panel"
        data-drawer-panel="avoidance"
      >
        <h3>回避学校</h3>
        <ul v-if="expert.avoidSchools.length" class="profile-drawer__list">
          <li v-for="school in expert.avoidSchools" :key="school">{{ school }}</li>
        </ul>
        <p v-else class="profile-drawer__muted">未设置回避学校</p>
        <p class="profile-drawer__hint">命中回避的候选专家在派单时自动禁选并提示原因（T-016）。</p>
      </section>

      <section
        v-show="activeTab === 'history'"
        class="profile-drawer__panel"
        data-drawer-panel="history"
      >
        <dl class="profile-drawer__facts">
          <div>
            <dt>历史完成数</dt>
            <dd>{{ expert.completedTasks }} 项</dd>
          </div>
          <div>
            <dt>逾期率</dt>
            <dd>{{ expert.overdueRate }}</dd>
          </div>
          <div>
            <dt>平均完成时间</dt>
            <dd>{{ expert.avgCompletionDays }} 天</dd>
          </div>
          <div>
            <dt>当前负载</dt>
            <dd>{{ expert.activeTasks }} 项</dd>
          </div>
        </dl>
        <p class="profile-drawer__hint">历史任务不对学校投影；演示批次仅提供汇总投影。</p>
      </section>

      <section
        v-show="activeTab === 'fees'"
        class="profile-drawer__panel"
        data-drawer-panel="fees"
      >
        <dl class="profile-drawer__facts">
          <div>
            <dt>费用标准</dt>
            <dd>¥ {{ expert.feeStandard.toFixed(2) }} / 篇</dd>
          </div>
          <div>
            <dt>收款信息状态</dt>
            <dd>{{ expert.payoutStatus === 'BOUND' ? '已绑定' : '待绑定' }}（脱敏展示，不显示卡号）</dd>
          </div>
          <div>
            <dt>历史接受率</dt>
            <dd>{{ expert.acceptanceRate }}</dd>
          </div>
          <div>
            <dt>按时完成率</dt>
            <dd>{{ expert.onTimeRate }}</dd>
          </div>
        </dl>
        <p class="profile-drawer__hint">费用标准为演示快照；结算以运营台费用规则版本为准。</p>
      </section>

      <section
        v-show="activeTab === 'audit'"
        class="profile-drawer__panel"
        data-drawer-panel="audit"
      >
        <h3>操作日志</h3>
        <ul class="profile-drawer__list">
          <li>
            <time>2026-08-10 14:20</time>
            <p>{{ expert.name }} 档案由平台运营维护，重要变更（资格、联系方式、费用标准）写入审计。</p>
          </li>
          <li>
            <time>2026-08-01 09:05</time>
            <p>资格材料复核完成（演示批次快照，不含真实材料内容）。</p>
          </li>
        </ul>
        <p class="profile-drawer__hint">本页为演示投影；正式审计查询见运营端“审计查询”。</p>
      </section>

      <footer class="profile-drawer__actions">
        <button
          v-if="expert.allowedActions.includes('UPDATE_PROFILE')"
          type="button"
          data-action="edit-expert"
          @click="emit('action', 'edit')"
        >
          编辑
        </button>
        <button
          v-if="expert.allowedActions.includes('SET_SERVICE_STATUS')"
          type="button"
          :data-action="expert.serviceStatus === 'ACTIVE' ? 'pause-expert' : 'resume-expert'"
          @click="emit('action', expert.serviceStatus === 'ACTIVE' ? 'pause' : 'resume')"
        >
          {{ expert.serviceStatus === 'ACTIVE' ? '暂停接单' : '恢复接单' }}
        </button>
        <button
          v-if="expert.allowedActions.includes('REVIEW_QUALIFICATION')"
          type="button"
          data-action="review-qualification"
          @click="emit('action', 'reviewQualification')"
        >
          资格通过
        </button>
        <button
          v-if="expert.allowedActions.includes('REVIEW_QUALIFICATION')"
          type="button"
          data-action="reject-qualification"
          @click="emit('action', 'rejectQualification')"
        >
          资格驳回
        </button>
      </footer>
    </aside>
  </div>
</template>

<style scoped>
.drawer-backdrop {
  position: fixed;
  z-index: 60;
  inset: 0;
  display: flex;
  justify-content: end;
  background: color-mix(in srgb, var(--color-primary-active) 42%, transparent);
}

.profile-drawer {
  display: grid;
  width: min(36rem, 100%);
  height: 100%;
  align-content: start;
  gap: 1rem;
  overflow-y: auto;
  padding: 1.25rem;
  background: var(--color-bg);
  box-shadow: var(--shadow-md);
}

.profile-drawer > header {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  justify-content: space-between;
  padding-bottom: 1rem;
  border-bottom: 2px solid var(--color-blind-rail);
}

.profile-drawer header span,
.profile-drawer header small,
.profile-drawer time {
  color: var(--color-text-secondary);
  font-family: var(--font-data);
  font-size: 0.6875rem;
}

.profile-drawer h2,
.profile-drawer h3 {
  font-family: var(--font-display);
}

.profile-drawer h2 {
  margin: 0.25rem 0 0;
  font-size: 1.25rem;
}

.profile-drawer h3 {
  margin: 0 0 0.625rem;
  font-size: 0.9375rem;
}

.profile-drawer header button {
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 1.5rem;
}

.profile-drawer__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.profile-drawer__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--color-border);
}

.profile-drawer__tabs button {
  padding: 0.4rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-text-secondary);
  font-weight: 650;
  cursor: pointer;
}

.profile-drawer__tabs button.active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary-active);
}

.profile-drawer__panel {
  display: grid;
  gap: 0.75rem;
}

.profile-drawer__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin: 0;
}

.profile-drawer__facts > div {
  padding: 0.75rem;
  border: 1px solid var(--color-border);
}

.profile-drawer__facts dt {
  color: var(--color-text-secondary);
  font-size: 0.6875rem;
}

.profile-drawer__facts dd {
  margin: 0.25rem 0 0;
  color: var(--color-text-primary);
  font-size: 0.8125rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.profile-drawer__list {
  display: grid;
  gap: 0.5rem;
  padding: 0;
  margin: 0;
  list-style: none;
}

.profile-drawer__list li {
  display: grid;
  gap: 0.2rem;
  padding: 0.75rem;
  border-left: 3px solid var(--color-primary);
  background: var(--color-primary-50);
}

.profile-drawer__list p {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 0.8125rem;
  line-height: 1.6;
}

.profile-drawer__tagrow {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.research-tag {
  display: inline-flex;
  padding: 0.18rem 0.45rem;
  border-radius: 999px;
  background: var(--color-primary-soft);
  color: var(--color-primary-active);
  font-size: 0.6875rem;
  white-space: nowrap;
}

.expert-tag {
  display: inline-flex;
  align-items: center;
  padding: 0.18rem 0.5rem;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 0.6875rem;
  line-height: 1.4;
  white-space: nowrap;
}

.expert-tag--success {
  color: var(--color-success);
  background: color-mix(in srgb, var(--color-success) 12%, transparent);
}

.expert-tag--warning {
  color: var(--color-warning);
  background: color-mix(in srgb, var(--color-warning) 12%, transparent);
}

.expert-tag--danger {
  color: var(--color-danger);
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
}

.expert-tag--neutral {
  color: var(--color-text-secondary);
  background: var(--color-fill);
}

.profile-drawer__muted,
.profile-drawer__hint {
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  line-height: 1.65;
}

.profile-drawer__hint {
  padding: 0.75rem;
  border-left: 3px solid var(--color-warning);
  background: var(--color-fill);
}

.profile-drawer__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}

.profile-drawer__actions button {
  min-height: 2.5rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-primary);
  cursor: pointer;
  font-weight: 650;
}

@media (max-width: 480px) {
  .profile-drawer__facts {
    grid-template-columns: 1fr;
  }
}
</style>
