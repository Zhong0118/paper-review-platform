<script setup lang="ts">
import { onMounted, ref } from 'vue'
import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { portalMenus } from '@/router/menus'
import { listSchoolObjections, resolveObjection, startObjection, type ObjectionRow } from '@/api/objections'

const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true'
const rows = ref<ObjectionRow[]>([])
const conclusion = ref('')
const notice = ref('')

const demoRows: ObjectionRow[] = [
  { id: 'OBJ-2026-019', thesis_id: '', created_at: '2026-09-01T08:00:00Z', reason: '对评语中实验数据判断存在疑问', request: '', status: 'SUBMITTED', channel: null, conclusion: null, student_name: '苏雨桐' },
  { id: 'OBJ-2026-014', thesis_id: '', created_at: '2026-09-01T08:00:00Z', reason: '申请核对评分项汇总过程', request: '', status: 'PROCESSING', channel: null, conclusion: null, student_name: '叶承宇' },
  { id: 'OBJ-2026-006', thesis_id: '', created_at: '2026-09-01T08:00:00Z', reason: '补充说明已由学校回填', request: '', status: 'RESOLVED', channel: 'OFFLINE', conclusion: '已办结', student_name: '唐思远' },
]

onMounted(async () => {
  if (demoEnabled) {
    rows.value = demoRows
    return
  }
  rows.value = await listSchoolObjections()
})

async function start(id: string) {
  await startObjection(id)
  rows.value = await listSchoolObjections()
}

async function resolve(id: string) {
  if (!conclusion.value.trim()) {
    notice.value = '请填写结论'
    return
  }
  await resolveObjection(id, { channel: 'OFFLINE', conclusion: conclusion.value.trim() })
  conclusion.value = ''
  rows.value = await listSchoolObjections()
}

function label(status: string) {
  if (status === 'PROCESSING') return '处理中'
  if (status === 'RESOLVED') return '已办结'
  return '已提交'
}
</script>

<template>
  <PortalLayout :menu-items="portalMenus('school_reviewer', demoEnabled)" active-path="/school/objections" context-label="学校端 · 海岳大学" user-name="王老师">
    <div class="objection-page">
      <PageHeader eyebrow="PAGE-019 · OBJECTIONS" title="异议处理" description="受理学生对已发布结果提出的异议，记录处理过程和结论；异议不直接修改专家原始分数或评语。" />
      <BlindRail audience="本校学生身份、异议材料与处理记录" hidden-from="专家真实身份与其他学校异议" stage="独立流程 · 不回退论文状态" />
      <section class="objection-table">
        <header>
          <div><span>OBJECTION REGISTER</span><h2>异议登记</h2></div>
          <small>共 {{ rows.length }} 条</small>
        </header>
        <div class="objection-table__head"><span>异议编号</span><span>论文 / 学生</span><span>异议摘要</span><span>状态</span><span>结论</span><span>操作</span></div>
        <article v-for="row in rows" :key="row.id" :data-objection-status="row.status">
          <code>{{ row.id.slice(0, 8) }}</code>
          <div><strong>{{ row.thesis_id.slice(0, 8) || '—' }}</strong><small>{{ row.student_name }}</small></div>
          <p>{{ row.reason }}</p>
          <mark>{{ label(row.status) }}</mark>
          <span>{{ row.conclusion || '—' }}</span>
          <span>
            <button v-if="!demoEnabled && row.status === 'SUBMITTED'" type="button" @click="start(row.id)">受理</button>
            <button v-if="!demoEnabled && row.status !== 'RESOLVED'" type="button" @click="resolve(row.id)">办结</button>
          </span>
        </article>
        <p v-if="!demoEnabled" class="hint">
          办结结论：<input v-model="conclusion" placeholder="线下处理结论" />
          <span v-if="notice">{{ notice }}</span>
        </p>
      </section>
    </div>
  </PortalLayout>
</template>

<style scoped>
.objection-page{display:grid;gap:1rem}.objection-table{border:1px solid #d8e0e6;background:#fff}.objection-table>header{display:flex;align-items:end;justify-content:space-between;padding:.85rem 1rem;border-bottom:1px solid #e2e7eb}.objection-table header span{color:#71808c;font-family:var(--font-data);font-size:.64rem;letter-spacing:.12em}.objection-table h2{margin:.15rem 0 0;font-family:var(--font-display);font-size:1rem}.objection-table header small{color:#78858f;font-size:.68rem}.objection-table__head,.objection-table article{display:grid;grid-template-columns:9rem 11rem minmax(14rem,1fr) 7rem 10rem 6rem;gap:.8rem;align-items:center;padding:.7rem 1rem}.objection-table__head{background:#f6f8fa;color:#687681;font-size:.65rem;font-weight:650}.objection-table article{border-top:1px solid #e7ebee;color:#53636f;font-size:.7rem}.objection-table code{font-family:var(--font-data);color:#1b4f8a}.objection-table strong,.objection-table small{display:block}.objection-table small{margin-top:.15rem;color:#7b8791}.objection-table p{margin:0;line-height:1.5}.objection-table mark{justify-self:start;padding:.2rem .45rem;border-radius:.25rem;background:#edf1f4;color:#53636f}.objection-table [data-objection-status='PROCESSING'] mark{background:var(--color-result-processing-soft);color:var(--color-result-processing)}.objection-table [data-objection-status='RESOLVED'] mark{background:#edf7ee;color:#28642d}.objection-table button{border:0;background:transparent;color:#1b4f8a;font-weight:650;cursor:pointer}.hint{padding:0.75rem 1rem;color:#53636f;font-size:0.75rem}.hint input{margin-left:0.5rem;height:2rem}
</style>
