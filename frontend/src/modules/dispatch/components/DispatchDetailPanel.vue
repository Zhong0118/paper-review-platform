<script setup lang="ts">
import type { DispatchThesisSeed } from '@/demo/types'

defineProps<{ thesis: DispatchThesisSeed | null }>()
</script>

<template>
  <section class="dispatch-detail" data-dispatch-detail aria-label="派单详情">
    <template v-if="thesis">
      <header>
        <span>DISPATCH DETAIL</span>
        <h2>派单详情</h2>
        <code>{{ thesis.anonymousId }}</code>
      </header>
      <dl class="dispatch-detail__grid">
        <div>
          <dt>专业目录</dt>
          <dd>{{ thesis.discipline.code }} · {{ thesis.discipline.name }}</dd>
        </div>
        <div>
          <dt>论文类型</dt>
          <dd>{{ thesis.thesisType }}</dd>
        </div>
        <div>
          <dt>送审学校</dt>
          <dd>{{ thesis.tenantName }}</dd>
        </div>
        <div>
          <dt>送审轮次</dt>
          <dd>第 {{ thesis.round }} 轮</dd>
        </div>
        <div class="span-2">
          <dt>关键词</dt>
          <dd class="keywords">
            <span v-for="keyword in thesis.keywords" :key="keyword" class="tag">
              {{ keyword }}
            </span>
          </dd>
        </div>
        <div class="span-2">
          <dt>回避规则</dt>
          <dd>{{ thesis.avoidRule }}</dd>
        </div>
        <div class="span-2">
          <dt>学校要求</dt>
          <dd>{{ thesis.schoolRequirement }}</dd>
        </div>
      </dl>
      <p class="dispatch-detail__note">
        匹配依据来自专家档案（研究方向、历史质量与回避声明），仅用于人工派单参考。
      </p>
    </template>
    <p v-else class="dispatch-detail__empty">请先在待派列表中选择一篇论文查看派单详情。</p>
  </section>
</template>

<style scoped>
.dispatch-detail {
  padding: 1rem;
  border: 1px solid #cbd8e3;
  background: #f7fafc;
}
.dispatch-detail header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding-bottom: 0.7rem;
  border-bottom: 1px solid #dce4ea;
}
.dispatch-detail header span {
  color: #687682;
  font-family: var(--font-data);
  font-size: 0.65rem;
  letter-spacing: 0.12em;
}
.dispatch-detail header h2 {
  margin: 0;
  color: #263744;
  font-family: var(--font-display);
  font-size: 0.95rem;
}
.dispatch-detail header code {
  margin-left: auto;
  color: #1b4f8a;
  font-family: var(--font-data);
  font-size: 0.7rem;
}
.dispatch-detail__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem 1rem;
  margin: 0.9rem 0;
}
.dispatch-detail__grid .span-2 {
  grid-column: span 2;
}
.dispatch-detail__grid dt {
  color: #78848e;
  font-size: 0.68rem;
}
.dispatch-detail__grid dd {
  margin: 0.2rem 0 0;
  color: #3e4e5a;
  font-size: 0.74rem;
  line-height: 1.55;
}
.dispatch-detail__grid .keywords {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.tag {
  display: inline-flex;
  padding: 0.16rem 0.42rem;
  border-radius: 999px;
  background: #e8f0f9;
  color: #174c7c;
  font-size: 0.68rem;
}
.dispatch-detail__note {
  margin: 0;
  padding-top: 0.6rem;
  border-top: 1px solid #dce4ea;
  color: #77838d;
  font-size: 0.68rem;
  line-height: 1.5;
}
.dispatch-detail__empty {
  margin: 0;
  padding: 1.5rem 0;
  color: #89939b;
  font-size: 0.75rem;
  text-align: center;
}
</style>
