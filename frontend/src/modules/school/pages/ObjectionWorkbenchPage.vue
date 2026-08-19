<script setup lang="ts">
import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { menusByRole } from '@/router/menus'

const rows=[
  {id:'OBJ-2026-019',paper:'HY-2026-0058',student:'苏雨桐',status:'SUBMITTED',label:'已提交',reason:'对评语中实验数据判断存在疑问',updated:'2026-08-10 10:20'},
  {id:'OBJ-2026-014',paper:'HY-2026-0039',student:'叶承宇',status:'PROCESSING',label:'处理中',reason:'申请核对评分项汇总过程',updated:'2026-08-09 16:45'},
  {id:'OBJ-2026-006',paper:'HY-2026-0018',student:'唐思远',status:'RESOLVED',label:'已办结',reason:'补充说明已由学校回填',updated:'2026-08-06 09:15'},
]
</script>

<template>
  <PortalLayout :menu-items="menusByRole.school_reviewer??[]" active-path="/school/objections" context-label="学校端 · 海岳大学" user-name="王老师">
    <div class="objection-page"><PageHeader eyebrow="PAGE-019 · OBJECTIONS" title="异议处理" description="受理学生对已发布结果提出的异议，记录处理过程和结论；异议不直接修改专家原始分数或评语。"/><BlindRail audience="本校学生身份、异议材料与处理记录" hidden-from="专家真实身份与其他学校异议" stage="独立流程 · 不回退论文状态"/>
      <section class="objection-table"><header><div><span>OBJECTION REGISTER</span><h2>异议登记</h2></div><small>共 3 条演示记录</small></header><div class="objection-table__head"><span>异议编号</span><span>论文 / 学生</span><span>异议摘要</span><span>状态</span><span>更新时间</span><span>操作</span></div><article v-for="row in rows" :key="row.id" :data-objection-status="row.status"><code>{{row.id}}</code><div><strong>{{row.paper}}</strong><small>{{row.student}}</small></div><p>{{row.reason}}</p><mark>{{row.label}}</mark><time>{{row.updated}}</time><button type="button">查看处理</button></article></section>
    </div>
  </PortalLayout>
</template>

<style scoped>
.objection-page{display:grid;gap:1rem}.objection-table{border:1px solid #d8e0e6;background:#fff}.objection-table>header{display:flex;align-items:end;justify-content:space-between;padding:.85rem 1rem;border-bottom:1px solid #e2e7eb}.objection-table header span{color:#71808c;font-family:var(--font-data);font-size:.64rem;letter-spacing:.12em}.objection-table h2{margin:.15rem 0 0;font-family:var(--font-display);font-size:1rem}.objection-table header small{color:#78858f;font-size:.68rem}.objection-table__head,.objection-table article{display:grid;grid-template-columns:9rem 11rem minmax(14rem,1fr) 7rem 10rem 6rem;gap:.8rem;align-items:center;padding:.7rem 1rem}.objection-table__head{background:#f6f8fa;color:#687681;font-size:.65rem;font-weight:650}.objection-table article{border-top:1px solid #e7ebee;color:#53636f;font-size:.7rem}.objection-table code{font-family:var(--font-data);color:#1b4f8a}.objection-table strong,.objection-table small{display:block}.objection-table small{margin-top:.15rem;color:#7b8791}.objection-table p{margin:0;line-height:1.5}.objection-table mark{justify-self:start;padding:.2rem .45rem;border-radius:.25rem;background:#edf1f4;color:#53636f}.objection-table [data-objection-status='PROCESSING'] mark{background:var(--color-result-processing-soft);color:var(--color-result-processing)}.objection-table [data-objection-status='RESOLVED'] mark{background:#edf7ee;color:#28642d}.objection-table time{font-family:var(--font-data);font-size:.65rem}.objection-table button{border:0;background:transparent;color:#1b4f8a;font-weight:650;cursor:pointer}@media(max-width:900px){.objection-table{overflow-x:auto}.objection-table__head,.objection-table article{min-width:62rem}}
</style>
