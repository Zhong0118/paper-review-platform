<script setup lang="ts">
import { reactive } from 'vue'

import DisciplineSelector from '@/modules/thesis/components/DisciplineSelector.vue'
import KeywordTagInput from '@/modules/thesis/components/KeywordTagInput.vue'
import type { DisciplineOption } from '@/modules/thesis/types'
import type { SchoolSubmissionInput } from '@/demo/types'

defineProps<{ saving?: boolean }>()
const emit = defineEmits<{ close: []; submit: [input: SchoolSubmissionInput] }>()

const disciplines: DisciplineOption[] = [
  { code: '0812', name: '计算机科学与技术' },
  { code: '0835', name: '软件工程' },
  { code: '1201', name: '管理科学与工程' },
]
const form = reactive({
  studentId: '20260042',
  batchId: 'batch-2026-spring',
  title: '学校代传的可信计算研究',
  discipline: disciplines[0]!,
  keywords: ['可信计算', '知识图谱'],
  originalFileName: '20260042-原始版.pdf',
  anonymousFileName: 'HY-2026-0043-匿名版.pdf',
})

function submit() {
  emit('submit', {
    ...form,
    discipline: { ...form.discipline },
    keywords: [...form.keywords],
  })
}
</script>

<template>
  <div class="drawer-backdrop" @click.self="emit('close')">
    <aside class="submission-drawer" role="dialog" aria-modal="true" aria-labelledby="submission-title">
      <header>
        <div><span>SINGLE SUBMISSION</span><h2 id="submission-title">学校单篇代传</h2></div>
        <button type="button" aria-label="关闭" @click="emit('close')">×</button>
      </header>
      <p class="submission-drawer__policy">学校可直接提交，无需学生再次确认；操作人和接入来源会写入审计记录。</p>
      <div class="submission-form">
        <label><span>已同步学生</span><select v-model="form.studentId"><option value="20260042">20260042 · 林知远</option></select></label>
        <label><span>送审批次</span><select v-model="form.batchId"><option value="batch-2026-spring">2026 年春季硕士论文盲审</option></select></label>
        <label class="wide"><span>论文题目</span><input v-model="form.title" /></label>
        <DisciplineSelector v-model="form.discipline" :options="disciplines" />
        <KeywordTagInput v-model="form.keywords" />
        <label><span>原始论文</span><input v-model="form.originalFileName" /></label>
        <label><span>匿名版论文</span><input v-model="form.anonymousFileName" /></label>
      </div>
      <footer>
        <button type="button" class="quiet" @click="emit('close')">取消</button>
        <button type="button" class="primary" data-action="confirm-school-submission" :disabled="saving" @click="submit">
          {{ saving ? '正在提交…' : '确认代传并提交' }}
        </button>
      </footer>
    </aside>
  </div>
</template>

<style scoped>
.drawer-backdrop { position: fixed; z-index: 30; inset: 0; display: flex; justify-content: flex-end; background: rgb(21 35 47 / 0.48); }
.submission-drawer { width: min(100%, 42rem); height: 100%; overflow-y: auto; padding: 1.25rem; background: white; box-shadow: -1rem 0 3rem rgb(0 0 0 / 0.14); }
.submission-drawer > header { display: flex; align-items: flex-start; justify-content: space-between; padding-bottom: 1rem; border-bottom: 1px solid #dfe5ea; }
.submission-drawer header span { color: #657481; font-family: var(--font-data); font-size: 0.6875rem; letter-spacing: 0.12em; }
.submission-drawer h2 { margin: 0.25rem 0 0; color: #263744; font-family: var(--font-display); }
.submission-drawer header button { border: 0; background: transparent; color: #60707d; font-size: 1.5rem; cursor: pointer; }
.submission-drawer__policy { padding: 0.75rem; border-left: 3px solid #1b4f8a; background: #edf3f9; color: #31526e; font-size: 0.75rem; line-height: 1.6; }
.submission-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.875rem; }
.submission-form label, .submission-form label span { display: grid; gap: 0.375rem; }
.submission-form label span { color: #4a5965; font-size: 0.75rem; font-weight: 650; }
.submission-form input, .submission-form select { width: 100%; height: 2.625rem; padding: 0 0.625rem; border: 1px solid #cbd4dc; border-radius: 0.375rem; background: #fbfcfe; }
.submission-form .wide { grid-column: 1 / -1; }
.submission-drawer footer { display: flex; gap: 0.625rem; justify-content: flex-end; margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid #dfe5ea; }
.submission-drawer footer button { min-height: 2.5rem; padding: 0.45rem 0.8rem; border-radius: 0.375rem; font-weight: 650; cursor: pointer; }
.quiet { border: 1px solid #bdc8d1; background: white; color: #44535f; }
.primary { border: 1px solid #1b4f8a; background: #1b4f8a; color: white; }
@media (max-width: 620px) { .submission-form { grid-template-columns: 1fr; } .submission-form .wide { grid-column: auto; } }
</style>
