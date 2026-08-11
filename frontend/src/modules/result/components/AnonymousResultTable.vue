<script setup lang="ts">
import type { DemoPublishedResult } from '@/demo/types'
defineProps<{ rows: DemoPublishedResult[] }>()
</script>
<template>
  <div class="result-table-wrap">
    <table class="result-table">
      <thead>
        <tr>
          <th>匿名专家序号</th>
          <th>分数</th>
          <th>结论</th>
          <th>获准公开的评语</th>
          <th>提交时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.expertAlias" data-result-row>
          <td>
            <strong>{{ row.expertAlias }}</strong>
          </td>
          <td>
            <b>{{ row.score }}</b>
          </td>
          <td>{{ row.recommendation }}</td>
          <td>{{ row.comment }}</td>
          <td>
            <time>{{ row.submittedAt }}</time>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
<style scoped>
.result-table-wrap {
  overflow-x: auto;
  border: 1px solid #dce3e9;
  background: white;
}
.result-table {
  width: 100%;
  min-width: 58rem;
  border-collapse: collapse;
  font-size: 0.73rem;
}
.result-table th {
  padding: 0.75rem;
  border-bottom: 1px solid #d9e1e7;
  background: #f4f6f8;
  color: #5d6b77;
  text-align: left;
}
.result-table td {
  padding: 0.85rem 0.75rem;
  border-bottom: 1px solid #e6eaed;
  color: #40505c;
  line-height: 1.6;
  vertical-align: top;
}
.result-table tr:last-child td {
  border-bottom: 0;
}
.result-table strong {
  color: #123d6b;
}
.result-table b {
  font-family: var(--font-data);
  font-size: 1.1rem;
}
.result-table time {
  color: #7b8791;
  font-family: var(--font-data);
  font-size: 0.67rem;
}
</style>
