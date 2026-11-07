<script setup lang="ts">
import PageHeader from '@/components/app/PageHeader.vue'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { portalMenus } from '@/router/menus'
</script>

<template>
  <PortalLayout :menu-items="portalMenus('school_reviewer', true)" active-path="/exports" context-label="数据服务" user-name="王老师">
    <section class="export-page">
      <PageHeader eyebrow="PAGE-016 · EXPORT CENTER" title="导出中心" description="按学校数据权限生成论文、进度、结果和账单文件。演示阶段展示任务状态，不实际下载敏感数据。" />
      <section class="export-builder"><header><span>NEW EXPORT</span><h2>新建导出任务</h2></header><div class="export-fields"><label>数据类型<select><option>评审进度明细</option><option>评审结果汇总</option><option>学校账单流水</option></select></label><label>批次<select><option>2026 届夏季批次</option></select></label><label>文件格式<select><option>XLSX</option><option>CSV</option></select></label><button type="button">生成文件</button></div><p>结果导出默认仅包含获准公开字段，不包含专家实名、联系方式和回避信息。</p></section>
      <section class="export-list"><header><span>EXPORT HISTORY</span><h2>最近任务</h2></header><div class="export-row"><div><strong>评审进度明细</strong><small>2026 届夏季批次 · XLSX</small></div><mark>已完成</mark><time>2026-08-10 10:24</time><button type="button">下载</button></div><div class="export-row"><div><strong>学校账单流水</strong><small>2026-07-01 至 2026-07-31 · XLSX</small></div><mark>已过期</mark><time>2026-08-01 09:11</time><button type="button" disabled>重新生成</button></div></section>
    </section>
  </PortalLayout>
</template>

<style scoped>
.export-page{display:grid;gap:1rem}.export-builder,.export-list{border:1px solid #d8e0e6;background:#fff}.export-builder>header,.export-list>header{padding:.85rem 1rem;border-bottom:1px solid #e2e7eb}.export-page header span{color:#71808c;font-family:var(--font-data);font-size:.62rem;letter-spacing:.12em}.export-page h2{margin:.18rem 0 0;font-size:.92rem}.export-fields{display:grid;grid-template-columns:2fr 2fr 1fr auto;gap:.75rem;align-items:end;padding:1rem}.export-fields label{display:grid;gap:.3rem;color:#6a7883;font-size:.67rem}.export-fields select{height:2.35rem;padding:0 .55rem;border:1px solid #c8d2da;border-radius:.25rem;background:#fff}.export-fields button,.export-row button{height:2.35rem;padding:0 .75rem;border:1px solid #1b4f8a;border-radius:.25rem;background:#1b4f8a;color:#fff;font-size:.7rem;font-weight:650}.export-builder>p{margin:0;padding:.75rem 1rem;border-top:1px solid #edf0f2;background:#f7f9fa;color:#6d7b86;font-size:.67rem}.export-row{display:grid;grid-template-columns:minmax(0,1fr) 5rem 11rem 6rem;gap:1rem;align-items:center;padding:.85rem 1rem;border-bottom:1px solid #e7ebee}.export-row:last-child{border-bottom:0}.export-row strong,.export-row small{display:block}.export-row strong{color:#304552;font-size:.75rem}.export-row small,.export-row time{margin-top:.2rem;color:#7c8993;font-size:.64rem}.export-row mark{justify-self:start;padding:.22rem .45rem;background:#edf7ee;color:#28642d}.export-row button:disabled{border-color:#cbd3d9;background:#f0f2f4;color:#7a8790}@media(max-width:760px){.export-fields,.export-row{grid-template-columns:1fr}.export-row mark{justify-self:start}}
</style>
