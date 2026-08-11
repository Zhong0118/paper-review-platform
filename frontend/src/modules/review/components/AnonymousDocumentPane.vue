<script setup lang="ts">
import { computed } from 'vue'
import type { ExpertTaskSummary } from '@/demo/types'

const props = defineProps<{ task?: ExpertTaskSummary | null }>()

// 匿名版文件（演示只读，不提供下载，不读取正文）。
const files = computed(() =>
  [
    {
      id: 'file-anonymous-042',
      name: '匿名版_HY-2026-0042.pdf',
      size: 1843200,
      mimeType: 'application/pdf',
      validationStatus: 'VALID',
    },
  ].map((file) => ({
    ...file,
    size: `${(file.size / 1024).toFixed(0)} KB`,
    validationStatusLabel: file.validationStatus === 'VALID' ? '校验通过' : '校验中',
  })),
)
const title = computed(() => props.task?.anonymousTitle ?? '面向复杂场景的多模态知识推理研究')
const anonymousId = computed(() => props.task?.anonymousId ?? 'HY-2026-0042')
</script>

<template>
  <section class="document-pane" aria-labelledby="anonymous-document-title">
    <header>
      <div>
        <span>ANONYMOUS MATERIAL</span>
        <h2 id="anonymous-document-title">匿名版全文</h2>
      </div>
      <span class="readonly-note">只读 · 不提供下载</span>
    </header>
    <div class="document-page">
      <small>{{ anonymousId }} · 第 1 / 86 页</small>
      <h3>{{ title }}</h3>
      <h4>摘　要</h4>
      <p>针对多源异构信息在复杂任务中的语义对齐与可信推断问题，本文构建一种融合知识图谱约束的多模态推理框架……</p>
      <p>实验结果表明，该方法在跨模态检索、关系推断与不确定性估计任务中取得稳定改进。</p>
      <ul class="file-list">
        <li v-for="file in files" :key="file.id" data-file-meta>
          <span>{{ file.name }}</span>
          <code>{{ file.size }}</code>
          <mark>{{ file.validationStatusLabel }}</mark>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.document-pane {
  min-width: 0;
  height: 100%;
  border: 1px solid #d7dfe6;
  background: #e7ebef;
}

.document-pane > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #ced7df;
  background: #f6f8fa;
}

.document-pane header span {
  color: #687682;
  font-family: var(--font-data);
  font-size: 0.62rem;
  letter-spacing: 0.12em;
}

.document-pane header .readonly-note {
  letter-spacing: 0;
  font-family: inherit;
}

.document-pane h2 {
  margin: 0.12rem 0 0;
  font-family: var(--font-display);
  font-size: 1rem;
}

.document-page {
  width: min(90%, 42rem);
  min-height: 42rem;
  margin: 1.25rem auto;
  padding: 3.5rem 4rem;
  background: white;
  box-shadow: 0 0.75rem 2.5rem rgb(31 55 76 / 12%);
}

.document-page small {
  color: #89949c;
  font-family: var(--font-data);
  font-size: 0.65rem;
}

.document-page h3 {
  margin: 4rem 0 3rem;
  font-family: var(--font-display);
  font-size: 1.45rem;
  text-align: center;
}

.document-page h4 {
  font-family: var(--font-display);
  text-align: center;
}

.document-page p {
  color: #3d4a54;
  font-family: var(--font-display);
  line-height: 2;
  text-indent: 2em;
}

.file-list {
  margin: 3rem 0 0;
  padding: 1rem;
  border: 1px dashed #c7d0d8;
  list-style: none;
}

.file-list li {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  color: #53636f;
  font-size: 0.7rem;
}

.file-list code {
  color: #84909a;
  font-family: var(--font-data);
  font-size: 0.65rem;
}

.file-list mark {
  padding: 0.12rem 0.4rem;
  border-radius: 0.25rem;
  background: #edf7ee;
  color: #28642d;
}
</style>
