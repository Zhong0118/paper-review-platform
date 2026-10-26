<script setup lang="ts">
import type { Dashboard, StatusFilter } from '@/api/dashboard'
defineProps<{ waiting?: number; reviewing?: number; completed?: number; overdue?: number; data?: Dashboard | null; loading?: boolean; error?: string; live?: boolean }>()
defineEmits<{ filter: [status: StatusFilter]; retry: [] }>()
const cards = [
  { key: 'waiting_theses', label: '待派论文', status: 'WAITING' },
  { key: 'invited_tasks', label: '邀请中任务', status: 'INVITED' },
  { key: 'in_review_tasks', label: '评阅中任务', status: 'IN_REVIEW' },
  { key: 'submitted_tasks', label: '已提交任务', status: 'SUBMITTED' },
] as const
const updated = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
</script>

<template>
  <section v-if="!live" class="progress-summary" aria-label="评审任务统计">
    <div><span>待平台派单</span><strong>{{ waiting }}</strong></div>
    <div><span>评阅中</span><strong>{{ reviewing }}</strong></div>
    <div><span>已完成</span><strong>{{ completed }}</strong></div>
    <div><span>已逾期</span><strong>{{ overdue }}</strong></div>
  </section>
  <section v-else class="dashboard" aria-label="评审运营指标" :aria-busy="loading">
    <Transition name="metrics" mode="out-in">
      <p v-if="loading" key="loading" role="status">正在加载运营指标…</p>
      <div v-else-if="error" key="error" role="alert">{{ error }} <button type="button" data-retry-dashboard @click="$emit('retry')">重试指标</button></div>
      <div v-else-if="data" key="data">
        <p class="scope-note">{{ data.time_scope === 'all' ? '全部论文' : '近一年创建的论文' }} · 更新于 {{ updated(data.as_of) }} 北京时间</p>
        <div class="progress-summary">
          <button v-for="card in cards" :key="card.key" type="button" :data-dashboard-card="card.key" @click="$emit('filter', card.status)">
            <span>{{ card.label }}</span><strong>{{ data.cards[card.key] }}</strong><small>查看列表</small>
          </button>
        </div>
        <p class="scope-note">逾期任务：未配置截止规则，暂不统计</p>
        <section v-if="data.published_score_bands" class="distribution" data-score-distribution aria-label="已发布论文评分分布">
          <h3>已发布论文 {{ data.published_count }} 篇</h3>
          <p>仅统计当前有效发布 每篇论文计一次 更正后替换分值</p>
          <div v-for="band in data.published_score_bands" :key="band.code" :data-score-band="band.code" class="band">
            <span>{{ band.code }} 分</span><meter min="0" :max="Math.max(data.published_count ?? 0, 1)" :value="band.count" :aria-label="`${band.code}分 ${band.count}篇`"/><strong>{{ band.count }} 篇</strong>
          </div>
          <p v-if="!data.published_count">当前范围暂无已发布论文</p>
        </section>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.progress-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid #dce3e9; background: white; }
.progress-summary > div, .progress-summary > button { padding: .9rem 1rem; border: 0; border-right: 1px solid #e3e8ec; background: white; text-align: left; }
.progress-summary > :last-child { border-right: 0; }
.progress-summary span, .progress-summary strong { display: block; }
.progress-summary span, .scope-note, .distribution p, small { color: #687682; font-size: .75rem; }
.progress-summary strong { margin: .15rem 0; color: #263744; font-family: var(--font-data); font-size: 1.5rem; }
button { cursor: pointer; transition: transform .15s ease, background .15s ease; }
button:hover { background: #eff6ff; transform: translateY(-2px); }
button:active { transform: scale(.98); }
button:focus-visible { outline: 2px solid #1b4f8a; outline-offset: 2px; }
.distribution { border: 1px solid #dce3e9; background: white; padding: 1rem; animation: appear .18s ease; }
h3 { font-size: 1rem; margin: 0; }
.band { display: grid; grid-template-columns: 6rem 1fr 4rem; gap: 1rem; align-items: center; margin: .65rem 0; font-size: .8rem; }
meter { width: 100%; height: 1rem; }
meter::-webkit-meter-optimum-value { background: #2967a3; transition: width .2s ease; }
.metrics-enter-active, .metrics-leave-active { transition: opacity .18s ease, transform .18s ease; }
.metrics-enter-from, .metrics-leave-to { opacity: 0; transform: translateY(4px); }
@keyframes appear { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
@media (max-width: 620px) { .progress-summary { grid-template-columns: repeat(2, 1fr); } }
@media (prefers-reduced-motion: reduce) { *, .metrics-enter-active, .metrics-leave-active { animation: none; transition: none; } }
</style>
