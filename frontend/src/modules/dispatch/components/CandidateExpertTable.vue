<script setup lang="ts">
import ConflictReason from './ConflictReason.vue'

export interface ExpertCandidate {
  id: string
  rowType: 'eligible' | 'conflicted' | 'secondary'
  alias: string
  name: string
  unit: string
  title: string
  discipline: { code: string; name: string }
  fields: string[]
  keywordHits: string[]
  conflictHit: boolean
  conflictReason?: string
  activeTasks: number
  acceptanceRate: string
  onTimeRate: string
  avgCompletionDays: number
  feeStandard: number
  matchReason: string
}

const props = defineProps<{
  rows: ExpertCandidate[]
  modelValue: string[]
  /** 移动端卡片视图由布局断点驱动；与专家库/任务列表一致（≤900px 由页面传入）。 */
  mobile?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [ids: string[]] }>()

function toggle(id: string, checked: boolean) {
  emit('update:modelValue', checked ? [id] : [])
}
</script>

<template>
  <div v-if="!mobile" class="candidate-table-wrap">
    <table class="candidate-table">
      <thead>
        <tr>
          <th>选择</th>
          <th>专家</th>
          <th>单位 / 职称</th>
          <th>专业匹配</th>
          <th>擅长领域</th>
          <th>关键词命中</th>
          <th>当前负载</th>
          <th>接单率</th>
          <th>按时完成率</th>
          <th>平均完成时间</th>
          <th>费用标准</th>
          <th>回避校验</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.id"
          :data-expert="row.rowType"
          :data-expert-id="row.id"
        >
          <td>
            <input
              type="checkbox"
              :checked="modelValue.includes(row.id)"
              :disabled="row.conflictHit"
              :aria-label="`选择 ${row.alias}`"
              @change="toggle(row.id, ($event.target as HTMLInputElement).checked)"
            />
          </td>
          <td>
            <strong>{{ row.name }}</strong>
            <small>{{ row.alias }} · 仅平台可见</small>
          </td>
          <td>
            <strong>{{ row.unit }}</strong>
            <small>{{ row.title }}</small>
          </td>
          <td>
            <code>{{ row.discipline.code }}</code>
            <span>{{ row.discipline.name }}</span>
          </td>
          <td>
            <span v-for="field in row.fields" :key="field" class="tag">{{ field }}</span>
          </td>
          <td>
            <span v-if="row.keywordHits.length > 0">
              <span v-for="keyword in row.keywordHits" :key="keyword" class="tag hit">
                {{ keyword }}
              </span>
            </span>
            <small v-else>无直接命中</small>
          </td>
          <td>{{ row.activeTasks }} 个</td>
          <td>{{ row.acceptanceRate }}</td>
          <td>{{ row.onTimeRate }}</td>
          <td>{{ row.avgCompletionDays }} 天</td>
          <td>¥ {{ row.feeStandard.toFixed(2) }}</td>
          <td><ConflictReason :hit="row.conflictHit" :reason="row.conflictReason" /></td>
        </tr>
      </tbody>
    </table>
    <ul class="match-reasons" aria-label="候选匹配原因">
      <li v-for="row in rows" :key="`reason-${row.id}`" :data-match-reason="row.id">
        <strong>{{ row.name }}</strong>
        <span>{{ row.matchReason }}</span>
      </li>
    </ul>
  </div>

  <!-- 移动端卡片视图（≤900px）：候选专家以卡片呈现，390px 无整页横向滚动 -->
  <ul v-else class="candidate-cards" aria-label="候选专家">
    <li
      v-for="row in rows"
      :key="`card-${row.id}`"
      class="candidate-card"
      :data-candidate-card="row.id"
      :data-candidate-conflict="row.conflictHit ? 'true' : 'false'"
    >
      <header class="candidate-card__head">
        <input
          type="checkbox"
          :checked="modelValue.includes(row.id)"
          :disabled="row.conflictHit"
          :aria-label="`选择 ${row.alias}`"
          @change="toggle(row.id, ($event.target as HTMLInputElement).checked)"
        />
        <strong>{{ row.name }}</strong>
        <small>{{ row.alias }} · 仅平台可见</small>
      </header>
      <dl class="candidate-card__facts">
        <div>
          <dt>单位 / 职称</dt>
          <dd>{{ row.unit }} · {{ row.title }}</dd>
        </div>
        <div>
          <dt>专业匹配</dt>
          <dd>
            <code>{{ row.discipline.code }}</code> {{ row.discipline.name }}
          </dd>
        </div>
        <div>
          <dt>擅长领域</dt>
          <dd>
            <span v-for="field in row.fields" :key="field" class="tag">{{ field }}</span>
          </dd>
        </div>
        <div>
          <dt>关键词命中</dt>
          <dd>
            <span v-if="row.keywordHits.length > 0">
              <span v-for="keyword in row.keywordHits" :key="keyword" class="tag hit">
                {{ keyword }}
              </span>
            </span>
            <small v-else>无直接命中</small>
          </dd>
        </div>
        <div>
          <dt>负载 / 接单率</dt>
          <dd>{{ row.activeTasks }} 个 · {{ row.acceptanceRate }}</dd>
        </div>
        <div>
          <dt>按时完成率 / 平均完成时间</dt>
          <dd>{{ row.onTimeRate }} · {{ row.avgCompletionDays }} 天</dd>
        </div>
        <div>
          <dt>费用标准</dt>
          <dd>¥ {{ row.feeStandard.toFixed(2) }}</dd>
        </div>
        <div>
          <dt>回避校验</dt>
          <dd><ConflictReason :hit="row.conflictHit" :reason="row.conflictReason" /></dd>
        </div>
      </dl>
      <p class="candidate-card__match">{{ row.matchReason }}</p>
    </li>
  </ul>
</template>

<style scoped>
.candidate-table-wrap {
  overflow-x: auto;
  border: 1px solid #dce3e9;
  background: white;
}
.candidate-table {
  width: 100%;
  min-width: 76rem;
  border-collapse: collapse;
  font-size: 0.72rem;
}
.candidate-table th {
  padding: 0.7rem;
  border-bottom: 1px solid #d9e0e6;
  background: #f4f6f8;
  color: #5e6c78;
  text-align: left;
}
.candidate-table td {
  padding: 0.75rem 0.7rem;
  border-bottom: 1px solid #e7ebee;
  color: #40505c;
  vertical-align: top;
}
.candidate-table tr:last-child td {
  border-bottom: 0;
}
.candidate-table strong,
.candidate-table small,
.candidate-table code,
.candidate-table td > span:not(.tag) {
  display: block;
}
.candidate-table strong {
  color: #2c3d49;
}
.candidate-table small {
  margin-top: 0.15rem;
  color: #89939b;
  font-size: 0.63rem;
}
.candidate-table code {
  color: #1b4f8a;
  font-family: var(--font-data);
  font-weight: 700;
}
.tag {
  display: inline-flex;
  margin: 0 0.25rem 0.2rem 0;
  padding: 0.16rem 0.38rem;
  border-radius: 999px;
  background: #edf1f4;
  color: #53626e;
}
.tag.hit {
  background: #e8f0f9;
  color: #174c7c;
}
.match-reasons {
  margin: 0;
  padding: 0.6rem 0.7rem;
  border-top: 1px solid #e2e7eb;
  background: #f8fafb;
  list-style: none;
}
.match-reasons li {
  display: flex;
  gap: 0.5rem;
  padding: 0.3rem 0;
  color: #5b6a76;
  font-size: 0.68rem;
  line-height: 1.5;
}
.match-reasons li strong {
  flex: none;
  color: #2c3d49;
}
.match-reasons li + li {
  border-top: 1px dashed #e4e9ed;
}
.candidate-cards {
  display: grid;
  gap: 0.7rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.candidate-card {
  display: grid;
  gap: 0.6rem;
  padding: 0.9rem 1rem;
  border: 1px solid #dce3e9;
  border-radius: 0.4rem;
  background: #fff;
}
.candidate-card__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.candidate-card__head input {
  flex: none;
}
.candidate-card__head strong {
  color: #2c3d49;
  font-size: 0.85rem;
}
.candidate-card__head small {
  color: #89939b;
  font-size: 0.65rem;
}
.candidate-card__facts {
  display: grid;
  gap: 0.35rem 0.9rem;
  margin: 0;
}
.candidate-card__facts > div {
  display: flex;
  gap: 0.5rem;
  font-size: 0.7rem;
}
.candidate-card__facts dt {
  flex: none;
  width: 7.5rem;
  color: #7c8993;
}
.candidate-card__facts dd {
  margin: 0;
  color: #40505c;
}
.candidate-card__facts code {
  color: #1b4f8a;
  font-family: var(--font-data);
  font-weight: 700;
}
.candidate-card__match {
  margin: 0;
  padding-top: 0.55rem;
  border-top: 1px dashed #e4e9ed;
  color: #5b6a76;
  font-size: 0.68rem;
  line-height: 1.5;
}
</style>
