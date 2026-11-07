<script setup lang="ts">
defineProps<{ amount: string; currency: string; version: string; settlement: string }>()
</script>

<template>
  <aside class="fee-rule" data-fee-rule aria-label="费用规则快照">
    <header><span>FEE RULE SNAPSHOT</span><strong>只读规则快照</strong></header>
    <div><span>专家评阅费</span><strong>{{ currency }} {{ amount }}</strong></div>
    <dl>
      <div><dt>规则版本</dt><dd>{{ version }}</dd></div>
      <div><dt>结算说明</dt><dd>{{ settlement }}</dd></div>
    </dl>
    <p>金额来自本批次规则，派单时固化，当前页面不可手工改写。</p>
  </aside>
</template>

<style scoped>
.fee-rule { padding: 1rem; border: 1px solid #cbd8e3; background: #f7fafc; }
.fee-rule header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 0.7rem; border-bottom: 1px solid #dce4ea; }
.fee-rule header span { color: #687682; font-family: var(--font-data); font-size: 0.65rem; letter-spacing: 0.12em; }
.fee-rule header strong { color: #31526e; font-size: 0.72rem; }
.fee-rule > div { display: flex; align-items: baseline; justify-content: space-between; padding: 1rem 0; }
.fee-rule > div span { color: #5f6e7a; font-size: 0.75rem; }
.fee-rule > div strong { color: #123d6b; font-family: var(--font-data); font-size: 1.65rem; }
.fee-rule dl { margin: 0; }
.fee-rule dl div { display: grid; grid-template-columns: 6rem 1fr; gap: 0.6rem; padding: 0.35rem 0; }
.fee-rule dt { color: #78848e; font-size: 0.7rem; }
.fee-rule dd { margin: 0; color: #3e4e5a; font-size: 0.72rem; line-height: 1.5; }
.fee-rule p { margin: 0.75rem 0 0; padding-top: 0.65rem; border-top: 1px solid #dce4ea; color: #77838d; font-size: 0.68rem; line-height: 1.5; }
</style>
