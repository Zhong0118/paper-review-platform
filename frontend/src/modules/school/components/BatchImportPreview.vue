<script setup lang="ts">
import type { BatchImportRow } from '@/demo/types'

defineProps<{ rows: BatchImportRow[] }>()
const labels: Record<BatchImportRow['validationStatus'], string> = {
  VALID: '有效', DUPLICATE: '重复记录', UNKNOWN_DISCIPLINE: '未知专业', MISSING_FILE: '缺少文件',
}
</script>

<template>
  <section class="batch-preview" aria-labelledby="batch-preview-title">
    <header>
      <div><span>BATCH VALIDATION</span><h2 id="batch-preview-title">批量导入预检</h2></div>
      <strong>演示数据，不执行真实 Excel 写入</strong>
    </header>
    <div class="batch-preview__table">
      <table>
        <thead><tr><th>行</th><th>学号</th><th>论文</th><th>专业代码</th><th>文件</th><th>校验结果</th><th>原因</th></tr></thead>
        <tbody>
          <tr v-for="row in rows" :key="row.rowNumber" :data-import-status="row.validationStatus">
            <td>{{ row.rowNumber }}</td><td><code>{{ row.studentId }}</code></td><td>{{ row.title }}</td>
            <td><code>{{ row.disciplineCode }}</code></td><td>{{ row.fileName || '—' }}</td>
            <td><span :class="`validation validation--${row.validationStatus.toLowerCase()}`">{{ labels[row.validationStatus] }}</span></td>
            <td>{{ row.reason ?? '校验通过' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.batch-preview { border: 1px solid #dce3e9; background: white; }
.batch-preview > header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.875rem 1rem; border-bottom: 1px solid #e3e8ec; }
.batch-preview header span { color: #6b7883; font-family: var(--font-data); font-size: 0.65rem; letter-spacing: 0.12em; }
.batch-preview h2 { margin: 0.15rem 0 0; color: #263744; font-family: var(--font-display); font-size: 1rem; }
.batch-preview header > strong { padding: 0.35rem 0.55rem; background: #fff3e8; color: #98420d; font-size: 0.7rem; }
.batch-preview__table { overflow-x: auto; }
.batch-preview table { width: 100%; min-width: 62rem; border-collapse: collapse; font-size: 0.72rem; }
.batch-preview th, .batch-preview td { padding: 0.65rem; border-bottom: 1px solid #e6eaed; text-align: left; }
.batch-preview th { background: #f5f7f9; color: #60707c; }
.batch-preview code { font-family: var(--font-data); }
.validation { display: inline-flex; padding: 0.18rem 0.4rem; border-radius: 999px; font-weight: 700; white-space: nowrap; }
.validation--valid { background: #edf7ee; color: #236529; }
.validation--duplicate, .validation--unknown_discipline, .validation--missing_file { background: #fceded; color: #9c2929; }
</style>
