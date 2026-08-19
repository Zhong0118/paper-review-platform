<script setup lang="ts">
import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { menusByRole } from '@/router/menus'

const scoreRules=[['选题价值',15],['文献与理论基础',15],['研究方法',20],['创新性',25],['研究成果与工作量',15],['写作与学术规范',10]] as const
</script>

<template>
  <PortalLayout :menu-items="menusByRole.school_reviewer??[]" active-path="/school/batch-rules" context-label="学校端 · 海岳大学" user-name="王老师">
    <div class="rules-page">
      <PageHeader eyebrow="PAGE-023 · BATCH RULES" title="批次与评审规则" description="查看本校送审批次和已启用规则版本。规则启用后形成快照，既有送审任务不随新版本变化。" />
      <BlindRail audience="本校批次与评审规则" hidden-from="专家身份、其他学校规则与内部运营排序" stage="学校配置 · 百杰按快照执行" />
      <p class="demo-note"><strong>甲方演示规则</strong> 以下数值仅当前演示批次生效，不是平台默认值。</p>
      <section class="rule-sheet">
        <header><div><span>ACTIVE RULE VERSION</span><h2>DEMO-2026-SPRING-v1</h2></div><mark>已启用</mark></header>
        <dl class="rule-facts"><div><dt>适用批次</dt><dd>2026 年春季硕士论文盲审</dd></div><div><dt>目标专家数</dt><dd>目标专家数 1</dd></div><div><dt>任务费用</dt><dd>单篇任务费用 ¥300</dd></div><div><dt>模板模式</dt><dd>六维百分制 · 单专家结果</dd></div></dl>
        <div class="score-rules"><article v-for="([label,score],index) in scoreRules" :key="label" data-score-rule><span>{{ String(index+1).padStart(2,'0') }}</span><strong>{{ label }}</strong><b>{{ score }} 分</b></article></div>
      </section>
    </div>
  </PortalLayout>
</template>

<style scoped>
.rules-page{display:grid;gap:1rem}.demo-note{margin:0;padding:.72rem .9rem;border-left:4px solid var(--color-billing-frozen);background:var(--color-billing-frozen-soft);color:#774511;font-size:.72rem}.demo-note strong{margin-right:.65rem}.rule-sheet{border:1px solid #d8e0e6;background:#fff}.rule-sheet>header{display:flex;align-items:center;justify-content:space-between;padding:1rem;border-bottom:1px solid #e3e8ec}.rule-sheet header span{color:#71808c;font-family:var(--font-data);font-size:.65rem;letter-spacing:.12em}.rule-sheet h2{margin:.2rem 0 0;color:#243c50;font-family:var(--font-data);font-size:1rem}.rule-sheet mark{padding:.25rem .5rem;border-radius:.25rem;background:#edf7ee;color:#28642d;font-size:.7rem}.rule-facts{display:grid;grid-template-columns:repeat(4,1fr);margin:0;border-bottom:1px solid #e3e8ec}.rule-facts div{padding:.85rem 1rem;border-right:1px solid #e3e8ec}.rule-facts div:last-child{border-right:0}.rule-facts dt{color:#74818c;font-size:.65rem}.rule-facts dd{margin:.25rem 0 0;color:#334550;font-size:.75rem}.score-rules{display:grid;grid-template-columns:repeat(6,1fr)}.score-rules article{display:grid;gap:.25rem;padding:1rem;border-right:1px solid #e3e8ec}.score-rules article:last-child{border-right:0}.score-rules span{color:#8a96a0;font-family:var(--font-data);font-size:.62rem}.score-rules strong{color:#344652;font-size:.72rem}.score-rules b{color:#1b4f8a;font-family:var(--font-data);font-size:.78rem}@media(max-width:900px){.rule-facts,.score-rules{grid-template-columns:1fr 1fr}}
</style>
