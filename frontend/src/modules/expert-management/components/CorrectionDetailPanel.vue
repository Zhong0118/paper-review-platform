<script setup lang="ts">
import type { CorrectionRequest, ReviewVersion } from '@/demo/types'

defineProps<{
  request: CorrectionRequest
  versions: ReviewVersion[]
}>()

defineEmits<{
  close: []
  approve: []
  reject: []
}>()
</script>

<template>
  <section class="correction-detail" data-correction-detail aria-label="更正申请详情">
    <header class="correction-detail__header">
      <div>
        <span>CORRECTION DETAIL</span>
        <h2>更正申请详情</h2>
      </div>
      <button type="button" class="correction-detail__close" aria-label="关闭" @click="$emit('close')">
        ×
      </button>
    </header>

    <dl class="correction-detail__facts">
      <div>
        <dt>申请编号</dt>
        <dd><code>{{ request.id }}</code></dd>
      </div>
      <div>
        <dt>申请专家</dt>
        <dd>{{ request.expertName }}（{{ request.expertId }}）</dd>
      </div>
      <div>
        <dt>匿名论文号</dt>
        <dd>{{ request.anonymousId }}</dd>
      </div>
      <div>
        <dt>申请时间</dt>
        <dd>{{ request.requestedAt }}</dd>
      </div>
      <div>
        <dt>原评阅版本</dt>
        <dd>版本 {{ request.version }}（只读）</dd>
      </div>
    </dl>

    <section v-if="request.impactWarning" class="correction-detail__impact" data-impact-warning>
      <strong>影响范围提示</strong>
      <p>{{ request.impactWarning }}</p>
    </section>

    <section class="correction-detail__section">
      <h3>原评阅版本（只读 Diff）</h3>
      <p class="correction-detail__note">
        审批人员可查看版本差异，但不得直接修改专家原始分数或评语；批准后生成新版本，旧版本永久保留。
      </p>
      <div class="correction-detail__diff" data-version-diff>
        <div>
          <span>版本 {{ request.version }}</span>
          <ul>
            <li>研究方法（20 分）：17 分</li>
            <li>写作规范（10 分）：9 分</li>
          </ul>
        </div>
        <div>
          <span>拟更正差异</span>
          <ul>
            <li>研究方法（20 分）：17 → 18 分</li>
            <li>写作规范（10 分）：9 → 8 分</li>
          </ul>
        </div>
      </div>
    </section>

    <section class="correction-detail__section">
      <h3>更正原因</h3>
      <p>{{ request.reason }}</p>
    </section>

    <section class="correction-detail__section">
      <h3>拟更正差异</h3>
      <p>{{ request.proposedDiff }}</p>
    </section>

    <section class="correction-detail__section">
      <h3>证据</h3>
      <p>{{ request.evidence }}</p>
      <small class="correction-detail__demo-note">演示仅展示文件名与校验状态，不读取论文正文。</small>
    </section>

    <section class="correction-detail__section">
      <h3>版本历史（全部只读保留）</h3>
      <ul class="correction-detail__versions">
        <li v-for="version in versions" :key="version.id" :data-version="version.id">
          <code>版本 {{ version.version }}</code>
          <span>{{ version.status === 'CURRENT' ? '当前版本' : '已被新版本替换' }}</span>
          <small>总分 {{ version.score }} · 提交于 {{ version.submittedAt }}</small>
        </li>
        <li v-if="versions.length === 0">暂无版本记录。</li>
      </ul>
    </section>

    <footer class="correction-detail__actions" v-if="request.status === 'PENDING'">
      <button type="button" data-action="reject-correction" @click="$emit('reject')">驳回</button>
      <button type="button" class="is-primary" data-action="approve-correction" @click="$emit('approve')">
        批准并生成新版本
      </button>
    </footer>
    <p v-else class="correction-detail__decided">
      {{ request.status === 'APPROVED' ? '已批准并生成新版本' : '已驳回' }} · 审核意见：{{
        request.decisionReason ?? '—'
      }}
    </p>
  </section>
</template>

<style scoped>
.correction-detail {
  display: grid;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid #cbd8e3;
  background: #fff;
}

.correction-detail__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 0.7rem;
  border-bottom: 1px solid #dce4ea;
}

.correction-detail__header span {
  color: #687682;
  font-family: var(--font-data);
  font-size: 0.65rem;
  letter-spacing: 0.12em;
}

.correction-detail__header h2 {
  margin: 0.15rem 0 0;
  color: #263744;
  font-family: var(--font-display);
  font-size: 0.95rem;
}

.correction-detail__close {
  border: 0;
  background: transparent;
  color: #7c8993;
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
}

.correction-detail__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem 1rem;
  margin: 0;
}

.correction-detail__facts dt {
  color: #78848e;
  font-size: 0.68rem;
}

.correction-detail__facts dd {
  margin: 0.2rem 0 0;
  color: #3e4e5a;
  font-size: 0.74rem;
}

.correction-detail__facts code {
  color: #1b4f8a;
  font-family: var(--font-data);
}

.correction-detail__impact {
  padding: 0.75rem;
  border-left: 4px solid var(--color-warning);
  background: color-mix(in srgb, var(--color-warning) 10%, #fff);
}

.correction-detail__impact strong {
  color: #7a4d12;
  font-size: 0.72rem;
}

.correction-detail__impact p {
  margin: 0.35rem 0 0;
  color: #5d4630;
  font-size: 0.74rem;
  line-height: 1.65;
}

.correction-detail__section h3 {
  margin: 0 0 0.4rem;
  color: #3e4e5a;
  font-size: 0.75rem;
}

.correction-detail__section p {
  margin: 0;
  color: #52626e;
  font-size: 0.74rem;
  line-height: 1.65;
}

.correction-detail__note {
  margin-bottom: 0.5rem;
}

.correction-detail__demo-note {
  color: #7c8993;
  font-size: 0.65rem;
}

.correction-detail__diff {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem;
}

.correction-detail__diff > div {
  padding: 0.65rem;
  border: 1px solid #e2e8ee;
  background: #f7fafc;
}

.correction-detail__diff span {
  color: #687682;
  font-family: var(--font-data);
  font-size: 0.65rem;
}

.correction-detail__diff ul {
  margin: 0.45rem 0 0;
  padding-left: 1.1rem;
  color: #52626e;
  font-size: 0.72rem;
  line-height: 1.7;
}

.correction-detail__versions {
  display: grid;
  gap: 0.45rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.correction-detail__versions li {
  display: grid;
  grid-template-columns: 7rem 1fr auto;
  gap: 0.5rem;
  align-items: center;
  padding: 0.5rem 0.6rem;
  border: 1px solid #e2e8ee;
  background: #f7fafc;
}

.correction-detail__versions code {
  color: #1b4f8a;
  font-family: var(--font-data);
  font-size: 0.7rem;
}

.correction-detail__versions span {
  color: #52626e;
  font-size: 0.7rem;
}

.correction-detail__versions small {
  color: #7c8993;
  font-size: 0.65rem;
}

.correction-detail__actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  padding-top: 0.75rem;
  border-top: 1px solid #e2e8ee;
}

.correction-detail__actions button {
  min-height: 2.25rem;
  padding: 0.4rem 0.8rem;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-primary);
  font-weight: 650;
  cursor: pointer;
}

.correction-detail__actions button.is-primary {
  background: var(--color-primary);
  color: var(--color-bg);
}

.correction-detail__decided {
  margin: 0;
  padding: 0.7rem;
  border: 1px solid #e2e8ee;
  background: #f7fafc;
  color: #52626e;
  font-size: 0.74rem;
}

@media (max-width: 900px) {
  .correction-detail__facts,
  .correction-detail__diff {
    grid-template-columns: 1fr;
  }

  .correction-detail__versions li {
    grid-template-columns: 1fr;
  }
}
</style>
