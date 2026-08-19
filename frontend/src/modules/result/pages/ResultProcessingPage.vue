<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import BlindRail from '@/components/app/BlindRail.vue'; import PageHeader from '@/components/app/PageHeader.vue'
import { useScenarioService } from '@/demo/serviceProvider'; import type { DemoPublishedResult } from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'; import { menusByRole } from '@/router/menus'; import { useAuthStore } from '@/stores/auth'
import AnonymousResultTable from '../components/AnonymousResultTable.vue'; import ResultSummaryPanel from '../components/ResultSummaryPanel.vue'
const service=useScenarioService(); const rows=ref<DemoPublishedResult[]>([]); const published=ref(false)
const score=computed(()=>rows.value[0]?.score??0)
onMounted(async()=>{const snapshot=await service.loginAs('school_reviewer');rows.value=await service.listReviewResults();published.value=snapshot.thesis.stage==='COMPLETED'})
async function publish(){await service.publishResult();rows.value=await service.listPublishedResults();published.value=true}
</script>
<template><PortalLayout :menu-items="menusByRole.school_reviewer??[]" active-path="/school/results" context-label="学校端 · 海岳大学" :user-name="useAuthStore().user?.displayName??'王老师'"><div class="result-page"><PageHeader eyebrow="PAGE-011 · RESULT PROCESSING" title="结果处理" description="核对匿名评阅意见和汇总结论后统一发布；学校侧只显示任务化名，不显示专家身份。"><template #actions><button data-action="publish-results" type="button" :disabled="published||!rows.length" @click="publish">{{published?'结果已发布':'确认并发布结果'}}</button></template></PageHeader><BlindRail audience="本校论文、匿名任务序号与评阅汇总" hidden-from="专家姓名、联系方式和专家库档案" stage="单专家结果核对与发布"/><ResultSummaryPanel :average="score" conclusion="建议通过" :published="published"/><AnonymousResultTable v-if="rows.length" :rows="rows"/><p v-else>尚未收到有效评阅意见，暂不能发布结果。</p></div></PortalLayout></template>
<style scoped>.result-page{display:grid;gap:1rem}.result-page button{padding:.5rem .75rem;border:1px solid #1b4f8a;border-radius:.3rem;background:#1b4f8a;color:white;font-weight:650}.result-page button:disabled{opacity:.65}.result-page>p{margin:0;padding:2rem;border:1px dashed #cbd4dc;background:white;color:#687682;text-align:center}</style>
