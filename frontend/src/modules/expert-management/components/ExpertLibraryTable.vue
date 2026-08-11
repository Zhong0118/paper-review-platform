<script setup lang="ts">
import type { ExpertProfile } from '@/demo/types'

defineProps<{
  rows: ExpertProfile[]
  /** 移动端卡片视图由布局断点驱动；为测试与 SSR 场景显式切换（≤900px 时由页面传入）。 */
  mobile?: boolean
}>()

const emit = defineEmits<{
  pause: [row: ExpertProfile]
  resume: [row: ExpertProfile]
  reviewQualification: [row: ExpertProfile]
  rejectQualification: [row: ExpertProfile]
  edit: [row: ExpertProfile]
  view: [row: ExpertProfile]
  dispatch: [row: ExpertProfile]
}>()

type RowAction = 'pause' | 'resume' | 'reviewQualification' | 'rejectQualification' | 'edit' | 'view' | 'dispatch'

const emitRowAction = emit as unknown as (action: RowAction, row: ExpertProfile) => void

function on(action: RowAction, row: ExpertProfile) {
  emitRowAction(action, row)
}

function qualificationLabel(qualification: ExpertProfile['qualification']) {
  if (qualification === 'APPROVED') return '资格通过'
  if (qualification === 'REVIEWING') return '资格审核中'
  return '资格驳回'
}

function qualificationTone(qualification: ExpertProfile['qualification']) {
  if (qualification === 'APPROVED') return 'success'
  if (qualification === 'REVIEWING') return 'warning'
  return 'danger'
}

function serviceLabel(serviceStatus: ExpertProfile['serviceStatus']) {
  return serviceStatus === 'ACTIVE' ? '可接单' : '暂停接单'
}

function serviceTone(serviceStatus: ExpertProfile['serviceStatus']) {
  return serviceStatus === 'ACTIVE' ? 'success' : 'neutral'
}
</script>

<template>
  <div class="expert-library-table__wrap">
    <!-- 桌面表格（断点 ≥901px；页面按断点传入 mobile=false 时渲染） -->
    <div v-if="!mobile" class="expert-library-table__desktop">
      <table class="expert-library-table">
        <thead>
          <tr>
            <th>专家</th>
            <th>单位 / 职称</th>
            <th>专业</th>
            <th>研究方向</th>
            <th>资格</th>
            <th>服务状态</th>
            <th>当前负载</th>
            <th>历史接受率</th>
            <th>按时完成率</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id" :data-expert-profile="row.id">
            <td data-label="专家">
              <strong>{{ row.name }}</strong>
              <small>{{ row.id }}</small>
            </td>
            <td data-label="单位 / 职称">
              <span>{{ row.unit }}</span>
              <small>{{ row.title }}</small>
            </td>
            <td data-label="专业">
              <code>{{ row.discipline.code }}</code>
              <span>{{ row.discipline.name }}</span>
            </td>
            <td data-label="研究方向">
              <span
                v-for="tag in row.researchTags"
                :key="tag"
                class="research-tag"
              >{{ tag }}</span>
              <span v-if="row.researchTags.length === 0" class="research-tag is-empty">未设置</span>
            </td>
            <td data-label="资格">
              <span class="expert-tag" :class="`expert-tag--${qualificationTone(row.qualification)}`">{{ qualificationLabel(row.qualification) }}</span>
            </td>
            <td data-label="服务状态">
              <span class="expert-tag" :class="`expert-tag--${serviceTone(row.serviceStatus)}`">{{ serviceLabel(row.serviceStatus) }}</span>
            </td>
            <td data-label="当前负载">{{ row.activeTasks }} 项</td>
            <td data-label="历史接受率">{{ row.acceptanceRate }}</td>
            <td data-label="按时完成率">{{ row.onTimeRate }}</td>
            <td data-label="操作" class="expert-library-table__actions">
              <button
                v-if="row.allowedActions.includes('UPDATE_PROFILE')"
                type="button"
                data-action="edit-expert"
                @click="on('edit', row)"
              >
                编辑
              </button>
              <button
                v-if="row.allowedActions.includes('SET_SERVICE_STATUS')"
                type="button"
                :data-action="row.serviceStatus === 'ACTIVE' ? 'pause-expert' : 'resume-expert'"
                @click="on(row.serviceStatus === 'ACTIVE' ? 'pause' : 'resume', row)"
              >
                {{ row.serviceStatus === 'ACTIVE' ? '暂停接单' : '恢复接单' }}
              </button>
              <button
                v-if="row.allowedActions.includes('REVIEW_QUALIFICATION')"
                type="button"
                data-action="review-qualification"
                @click="on('reviewQualification', row)"
              >
                资格通过
              </button>
              <button
                v-if="row.allowedActions.includes('REVIEW_QUALIFICATION')"
                type="button"
                data-action="reject-qualification"
                @click="on('rejectQualification', row)"
              >
                资格驳回
              </button>
              <button
                v-if="row.allowedActions.includes('SET_SERVICE_STATUS')"
                type="button"
                data-action="dispatch-expert"
                @click="on('dispatch', row)"
              >
                指派论文
              </button>
              <button type="button" data-action="view-profile" @click="on('view', row)">详情</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="rows.length === 0" class="expert-library-table__empty">没有符合条件的专家档案</p>
    </div>

    <!-- 移动端卡片 -->
    <div class="expert-library-table__mobile">
      <article
        v-for="row in rows"
        :key="row.id"
        class="expert-card"
        :data-expert-card="row.id"
      >
        <header class="expert-card__head">
          <div>
            <strong>{{ row.name }}</strong>
            <small>{{ row.id }}</small>
          </div>
          <span class="expert-tag" :class="`expert-tag--${serviceTone(row.serviceStatus)}`">{{ serviceLabel(row.serviceStatus) }}</span>
        </header>
        <dl class="expert-card__facts">
          <div>
            <dt>单位 / 职称</dt>
            <dd>{{ row.unit }} · {{ row.title }}</dd>
          </div>
          <div>
            <dt>专业</dt>
            <dd><code>{{ row.discipline.code }}</code> {{ row.discipline.name }}</dd>
          </div>
          <div>
            <dt>研究方向</dt>
            <dd>
              <span
                v-for="tag in row.researchTags"
                :key="tag"
                class="research-tag"
              >{{ tag }}</span>
              <span v-if="row.researchTags.length === 0" class="research-tag is-empty">未设置</span>
            </dd>
          </div>
          <div>
            <dt>资格</dt>
            <dd><span class="expert-tag" :class="`expert-tag--${qualificationTone(row.qualification)}`">{{ qualificationLabel(row.qualification) }}</span></dd>
          </div>
          <div>
            <dt>负载 / 接受率 / 按时率</dt>
            <dd>{{ row.activeTasks }} 项 · {{ row.acceptanceRate }} · {{ row.onTimeRate }}</dd>
          </div>
        </dl>
        <footer class="expert-card__actions">
          <button
            v-if="row.allowedActions.includes('UPDATE_PROFILE')"
            type="button"
            data-action="edit-expert"
            @click="on('edit', row)"
          >
            编辑
          </button>
          <button
            v-if="row.allowedActions.includes('SET_SERVICE_STATUS')"
            type="button"
            :data-action="row.serviceStatus === 'ACTIVE' ? 'pause-expert' : 'resume-expert'"
            @click="on(row.serviceStatus === 'ACTIVE' ? 'pause' : 'resume', row)"
          >
            {{ row.serviceStatus === 'ACTIVE' ? '暂停接单' : '恢复接单' }}
          </button>
          <button
            v-if="row.allowedActions.includes('REVIEW_QUALIFICATION')"
            type="button"
            data-action="review-qualification"
            @click="on('reviewQualification', row)"
          >
            资格通过
          </button>
          <button
            v-if="row.allowedActions.includes('REVIEW_QUALIFICATION')"
            type="button"
            data-action="reject-qualification"
            @click="on('rejectQualification', row)"
          >
            资格驳回
          </button>
          <button type="button" data-action="view-profile" @click="on('view', row)">详情</button>
        </footer>
      </article>
      <p v-if="rows.length === 0" class="expert-library-table__empty">没有符合条件的专家档案</p>
    </div>
  </div>
</template>

<style scoped>
.expert-library-table__desktop {
  overflow: hidden;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}

.expert-library-table {
  width: 100%;
  border-collapse: collapse;
  color: var(--color-text-primary);
  font-size: 0.75rem;
}

.expert-library-table th {
  padding: 0.75rem;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-fill);
  color: var(--color-text-secondary);
  font-weight: 700;
  text-align: left;
  white-space: nowrap;
}

.expert-library-table td {
  padding: 0.875rem 0.75rem;
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}

.expert-library-table tbody tr:last-child td {
  border-bottom: 0;
}

.expert-library-table td strong,
.expert-library-table td small,
.expert-library-table td code,
.expert-library-table td > span:not(.research-tag) {
  display: block;
}

.expert-library-table td strong {
  color: var(--color-text-primary);
  font-size: 0.8125rem;
}

.expert-library-table td small,
.expert-library-table td span,
.expert-library-table time {
  color: var(--color-text-secondary);
  font-family: var(--font-data);
  font-size: 0.6875rem;
}

.expert-library-table td code {
  margin-bottom: 0.2rem;
  color: var(--color-primary);
  font-family: var(--font-data);
  font-weight: 700;
}

.research-tag {
  display: inline-flex;
  margin: 0.15rem 0.3rem 0.15rem 0;
  padding: 0.18rem 0.45rem;
  border-radius: 999px;
  background: var(--color-primary-soft);
  color: var(--color-primary-active);
  font-size: 0.6875rem;
  white-space: nowrap;
}

.research-tag.is-empty {
  background: var(--color-fill);
  color: var(--color-text-secondary);
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

.expert-library-table__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.expert-library-table__actions button,
.expert-card__actions button {
  padding: 0.3rem 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  background: var(--color-bg);
  color: var(--color-primary);
  font-weight: 650;
  cursor: pointer;
  white-space: nowrap;
}

.expert-library-table__empty {
  margin: 0;
  padding: 2rem;
  color: var(--color-text-secondary);
  text-align: center;
}

/* 移动端卡片（页面断点 ≤900px 时渲染；此处兜底隐藏避免双份渲染） */
.expert-library-table__mobile {
  display: none;
}

@media (max-width: 900px) {
  .expert-library-table__desktop {
    display: none;
  }

  .expert-library-table__mobile {
    display: grid;
    gap: 0.75rem;
  }

  .expert-card {
    display: grid;
    gap: 0.7rem;
    padding: 0.875rem;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
  }

  .expert-card__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .expert-card__head strong,
  .expert-card__head small {
    display: block;
  }

  .expert-card__head strong {
    color: var(--color-text-primary);
    font-size: 0.875rem;
  }

  .expert-card__head small,
  .expert-card__facts dd {
    color: var(--color-text-secondary);
    font-family: var(--font-data);
    font-size: 0.6875rem;
  }

  .expert-card__facts {
    display: grid;
    gap: 0.4rem;
    margin: 0;
  }

  .expert-card__facts > div {
    display: grid;
    grid-template-columns: 6rem minmax(0, 1fr);
    gap: 0.6rem;
  }

  .expert-card__facts dt {
    color: var(--color-text-secondary);
    font-size: 0.6875rem;
    font-weight: 650;
  }

  .expert-card__facts dd {
    margin: 0;
    line-height: 1.6;
  }

  .expert-card__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
}
</style>
