<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DispatchCandidate, MatchReason } from '@/api/dispatch'
import ColumnPreferences from '@/components/app/ColumnPreferences.vue'
import { useColumnPreferences, type ColumnIdentity } from '@/composables/useColumnPreferences'
import ConflictReason from './ConflictReason.vue'

export interface ExpertCandidate {
  matchScore?: number
  matchReasons?: MatchReason[]
  matchRuleVersion?: string
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
  exclusionReasons?: string[]
  conflictReason?: string
  workload?: DispatchCandidate['workload']
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
  showDemoMetrics?: boolean
  showRanking?: boolean
  resultReady?: boolean
  /** 移动断点由页面传入；真实模式保留横向表格，演示模式使用卡片。 */
  mobile?: boolean
  preferenceIdentity?: ColumnIdentity | null
}>()
const showUnavailable = ref(false)
const blockedCount = computed(() => props.rows.filter(row => row.conflictHit).length)
const visibleRows = computed(() => props.showRanking && !showUnavailable.value ? props.rows.filter(row => !row.conflictHit) : props.rows)
const exclusions = computed(() => {
  if (!props.resultReady || props.rows.some(row => !row.conflictHit)) return null
  const counts = new Map<string, number>()
  for (const row of props.rows) {
    const reasons = row.exclusionReasons?.length ? row.exclusionReasons : [row.conflictReason || '当前不可派']
    for (const reason of new Set(reasons)) counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
})
const preferences = useColumnPreferences('dispatch-candidates', 1, () => [
  ...(!props.preferenceIdentity ? [{ id: 'selection', label: '选择', required: true, defaultVisible: true }] : []),
  { id: 'expert', label: '专家', required: true, defaultVisible: true },
  { id: 'unit', label: '单位 / 职称', required: false, defaultVisible: true },
  { id: 'discipline', label: '专业匹配', required: false, defaultVisible: true },
  ...(props.showRanking ? [{ id: 'ranking', label: '规则排序分', required: false, defaultVisible: true }] : []),
  { id: 'fields', label: '擅长领域', required: false, defaultVisible: true },
  { id: 'keywords', label: '关键词命中', required: false, defaultVisible: true },
  ...(props.showRanking ? [{ id: 'workload', label: '任务负荷', required: false, defaultVisible: true }] : []),
  ...(props.showDemoMetrics ? [
    { id: 'load', label: '当前负载', required: false, defaultVisible: true },
    { id: 'acceptance', label: '接单率', required: false, defaultVisible: true },
    { id: 'onTime', label: '按时完成率', required: false, defaultVisible: true },
    { id: 'average', label: '平均完成时间', required: false, defaultVisible: true },
    { id: 'fee', label: '费用标准', required: false, defaultVisible: true },
  ] : []),
  { id: 'conflict', label: props.showRanking ? '派单资格' : '回避校验', required: false, defaultVisible: true },
  ...(props.preferenceIdentity ? [{ id: 'actions', label: '选择', required: true, defaultVisible: true }] : []),
], () => props.preferenceIdentity ?? null)
const { visibleColumns } = preferences
const emit = defineEmits<{ 'update:modelValue': [ids: string[]] }>()

function toggle(id: string, checked: boolean) {
  if (checked && props.rows.find(row => row.id === id)?.conflictHit) return
  emit('update:modelValue', checked ? [id] : [])
}
</script>

<template>
  <section v-if="showRanking" class="ranking-note" aria-label="候选推荐规则">
    <p>规则排序分 · {{ rows[0]?.matchRuleVersion ?? '待刷新' }} · 方向每项3分（最多15）关键词每项2分（最多10）</p>
    <p>0分表示缺少匹配线索 不代表不合格 分数不是准确率或概率 最终由平台人工确认</p>
    <button v-if="blockedCount" type="button" data-toggle-unavailable :aria-expanded="showUnavailable" @click="showUnavailable = !showUnavailable">{{ showUnavailable ? '收起' : '查看' }}不可派候选（{{ blockedCount }}）</button>
    <Transition name="ranking-rows">
      <div v-if="exclusions" class="exclusions" data-candidate-exclusions role="status">
        <template v-if="rows.length">
          <strong>{{ rows.length }} 位候选均不可派</strong>
          <ul><li v-for="[reason, count] in exclusions" :key="reason">{{ reason }}：{{ count }} 人</li></ul>
          <p>同一人可能命中多项原因。展开不可派候选可核对个人情况。</p>
        </template>
        <template v-else>
          <strong>本次查询未返回候选</strong>
          <p>请在专家库核对是否已有专家档案及有效专家账号。</p>
        </template>
      </div>
    </Transition>
  </section>
  <ColumnPreferences v-if="preferenceIdentity" :preferences="preferences" label="候选专家" />
  <div v-if="!mobile || preferenceIdentity" class="candidate-table-wrap">
    <table class="candidate-table">
      <thead>
        <TransitionGroup name="table-columns" tag="tr">
          <th v-for="column in visibleColumns" :key="column.id" :data-column-header="column.id">{{ column.label }}</th>
        </TransitionGroup>
      </thead>
      <TransitionGroup name="ranking-rows" tag="tbody">
        <TransitionGroup name="table-columns" tag="tr"
          v-for="row in visibleRows"
          :key="row.id"
          :data-expert="row.rowType"
          :data-expert-id="row.id"
        >
          <td v-for="column in visibleColumns" :key="column.id" :data-column-cell="column.id">
            <input v-if="column.id === 'actions' || column.id === 'selection'" type="checkbox" :checked="modelValue.includes(row.id)" :disabled="row.conflictHit" :aria-label="`选择 ${row.alias}`" @change="toggle(row.id, ($event.target as HTMLInputElement).checked)" />
            <template v-else-if="column.id === 'expert'"><strong>{{ row.name }}</strong><small>{{ row.alias }} · 仅平台可见</small></template>
            <template v-else-if="column.id === 'unit'"><strong>{{ row.unit }}</strong><small>{{ row.title }}</small></template>
            <template v-else-if="column.id === 'discipline'"><code>{{ row.discipline.code }}</code><span>{{ row.discipline.name }}</span></template>
            <template v-else-if="column.id === 'ranking'"><strong>{{ row.matchScore ?? '待刷新' }}</strong><small v-if="row.matchScore === 0">缺少匹配线索</small></template>
            <template v-else-if="column.id === 'fields'"><span v-for="field in row.fields" :key="field" class="tag">{{ field }}</span></template>
            <template v-else-if="column.id === 'keywords'">
              <span v-if="row.keywordHits.length > 0"><span v-for="keyword in row.keywordHits" :key="keyword" class="tag hit">{{ keyword }}</span></span><small v-else>无直接命中</small>
            </template>
            <template v-else-if="column.id === 'workload'"><template v-if="row.workload">待接单 {{ row.workload.invited }} · 评阅中 {{ row.workload.in_review }} · 合计 {{ row.workload.total }}</template><template v-else>—</template></template>
            <template v-else-if="column.id === 'load'">{{ row.activeTasks }} 个</template>
            <template v-else-if="column.id === 'acceptance'">{{ row.acceptanceRate }}</template>
            <template v-else-if="column.id === 'onTime'">{{ row.onTimeRate }}</template>
            <template v-else-if="column.id === 'average'">{{ row.avgCompletionDays }} 天</template>
            <template v-else-if="column.id === 'fee'">¥ {{ Number(row.feeStandard).toFixed(2) }}</template>
            <ConflictReason v-else-if="column.id === 'conflict'" :availability="showRanking" :hit="row.conflictHit" :reason="row.conflictReason" />
          </td>
        </TransitionGroup>
      </TransitionGroup>
    </table>
    <TransitionGroup name="ranking-rows" tag="ul" class="match-reasons" aria-label="候选匹配原因">
      <li v-for="row in visibleRows" :key="`reason-${row.id}`" :data-match-reason="row.id">
        <strong>{{ row.name }}</strong>
        <span>{{ row.matchReason }}</span>
        <span v-if="showRanking" class="scored-tags"><span v-for="hit in row.matchReasons" :key="hit.kind + hit.tag" class="tag hit">{{ hit.kind === 'research_direction' ? '方向' : '关键词' }} · {{ hit.tag }} +{{ hit.points }}</span></span>
      </li>
    </TransitionGroup>
  </div>

  <!-- 演示模式移动卡片；真实模式保留可配置表格 -->
  <ul v-else class="candidate-cards" aria-label="候选专家">
    <li
      v-for="row in visibleRows"
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
        <div v-if="showDemoMetrics">
          <dt>负载 / 接单率</dt>
          <dd>{{ row.activeTasks }} 个 · {{ row.acceptanceRate }}</dd>
        </div>
        <div v-if="showDemoMetrics">
          <dt>按时完成率 / 平均完成时间</dt>
          <dd>{{ row.onTimeRate }} · {{ row.avgCompletionDays }} 天</dd>
        </div>
        <div v-if="showDemoMetrics">
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
.ranking-note { padding: .8rem; background: #f1f6fd; color: #334155; font-size: .75rem; line-height: 1.7; animation: rank-in .18s ease; }
.exclusions { margin-top: .6rem; padding: .65rem .85rem; background: white; border-left: 3px solid #33659c; }
.exclusions ul { display: flex; flex-wrap: wrap; gap: .25rem 1.25rem; padding: 0; list-style: none; }
.ranking-note button { margin-top: .4rem; padding: .35rem .7rem; border: 1px solid #cbd5e1; border-radius: .3rem; background: white; transition: background .18s, transform .18s; cursor: pointer; }
.ranking-note button:hover { background: #dbeafe; transform: translateY(-1px); }
.ranking-note button:active { transform: scale(.98); }
.scored-tags { display: flex; gap: .25rem; flex-wrap: wrap; }
.ranking-rows-enter-active, .ranking-rows-leave-active, .ranking-rows-move { transition: opacity .18s ease, transform .18s ease; }
.ranking-rows-enter-from, .ranking-rows-leave-to { opacity: 0; transform: translateY(4px); }
@keyframes rank-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .ranking-note, .ranking-note button, .ranking-rows-enter-active, .ranking-rows-leave-active, .ranking-rows-move { animation: none; transition: none; } }

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
.table-columns-enter-active, .table-columns-leave-active, .table-columns-move { transition: opacity .18s, transform .18s; }
.table-columns-enter-from, .table-columns-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .table-columns-enter-active, .table-columns-leave-active, .table-columns-move { transition: none; } }
</style>
