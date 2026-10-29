import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
const api = vi.hoisted(() => ({ dispatchCandidates: vi.fn(), dispatchQueue: vi.fn(), assignExpert: vi.fn(), reassignExpert: vi.fn() }))
vi.mock('@/api/dispatch', async (original) => ({ ...await original<typeof import('@/api/dispatch')>(), ...api }))
vi.mock('@/composables/useTimeScope', () => ({ useTimeScope: () => ({ scope: ref('ALL'), identity: ref('platform'), meta: ref(null), request: () => [undefined, () => {}], setScope: vi.fn() }) }))
vi.mock('@/composables/useOperationsDashboard', () => ({ useOperationsDashboard: () => ({ status: ref('ALL'), data: ref(null), loading: ref(false), error: ref(''), listCount: ref(null), changed: ref(false), listAsOf: ref(''), load: vi.fn(), resetList: vi.fn(), receiveList: vi.fn(), drill: vi.fn() }) }))
import DispatchWorkbenchPage from '../pages/DispatchWorkbenchPage.vue'
import CandidateExpertTable, { type ExpertCandidate } from '../components/CandidateExpertTable.vue'
const ranked = { expert_id:'one', username:'one', display_name:'零分专家', discipline_codes:['0812'], direction_mismatch:false, avoided:false, service_status:'AVAILABLE', qualification_status:'APPROVED', candidate_version:7, thesis_version:3, match_score:0, match_rule_version:'expert-rank-v1', match_reasons:[], hard_allowed:true, allowed_actions:['ASSIGN_EXPERT'], unavailable_reasons:[], unit:'测试大学', title:'教授', research_directions:[] }
beforeEach(() => {
 vi.stubEnv('VITE_DEMO_MODE','false'); vi.resetAllMocks()
 api.dispatchQueue.mockResolvedValue([{ thesis_id:'thesis',title:'虚构论文',student_name:'虚构学生',discipline_code:'0812',stage:'READY_FOR_DISPATCH',allowed_actions:['ASSIGN_EXPERT'] }])
 api.dispatchCandidates.mockResolvedValue([ranked]); api.assignExpert.mockResolvedValue({})
})
afterEach(() => vi.unstubAllEnvs())
async function page() {
 const w=mount(DispatchWorkbenchPage,{global:{plugins:[createPinia()],stubs:{PortalLayout:{template:'<div><slot/><slot name="modal"/></div>'},TaskProgressSummary:true,PlatformDemoScenarioController:true}}})
 await flushPromises();return w
}
it('shows score as a rule, preserves a selectable zero, sends the reviewed expert version',async()=>{
 const w=await page();expect(w.text()).toContain('expert-rank-v1');expect(w.text()).toContain('规则排序分');expect(w.text()).toContain('缺少匹配线索')
 await w.get('[data-expert-id="one"] input').setValue(true)
 await w.get('[data-action="assign-experts"]').trigger('click');await w.get('[data-action="confirm-assign"]').trigger('click');await flushPromises()
 expect(api.assignExpert).toHaveBeenCalledWith('thesis','one',expect.any(Object),7)
})
it('refreshes on 409 and requires selection and confirmation again',async()=>{
 api.assignExpert.mockRejectedValue({response:{status:409}})
 const w=await page();await w.get('[data-expert-id="one"] input').setValue(true)
 await w.get('[data-action="assign-experts"]').trigger('click');await w.get('[data-action="confirm-assign"]').trigger('click');await flushPromises()
 expect(api.dispatchCandidates).toHaveBeenCalledTimes(2);expect(api.assignExpert).toHaveBeenCalledTimes(1)
 expect(w.text()).toContain('重新选择');expect(w.get('[data-action="assign-experts"]').attributes('disabled')).toBeDefined()
})
it('shows only supplied real dispatch details without empty demo fields or duplicate discipline codes',async()=>{
 const w=await page();const detail=w.get('[data-dispatch-detail]')
 expect(detail.findAll('dt').map(row=>row.text())).toEqual(['专业目录'])
 expect(detail.get('dd').text()).toBe('0812')
 expect(detail.text()).not.toContain('第 轮')
})
it('folds ineligible rows by default and keeps high scoring conflicts disabled',async()=>{
 const base:ExpertCandidate={id:'zero',alias:'E-01',rowType:'eligible',name:'零分',unit:'',title:'',discipline:{code:'0812',name:'计算机'},fields:[],keywordHits:[],conflictHit:false,activeTasks:0,acceptanceRate:'—',onTimeRate:'—',avgCompletionDays:0,feeStandard:0,matchReason:'可派'}
 const w=mount(CandidateExpertTable,{props:{rows:[{...base,matchScore:0},{...base,id:'blocked',name:'高分回避',conflictHit:true,conflictReason:'回避',rowType:'conflicted',matchScore:25,matchReasons:[{kind:'keyword',tag:'机器学习',points:2}]}],modelValue:[],showRanking:true}})
 expect(w.find('[data-expert-id="blocked"]').exists()).toBe(false)
 await w.get('[data-toggle-unavailable]').trigger('click')
 expect(w.get('[data-expert-id="blocked"] input').attributes('disabled')).toBeDefined();expect(w.text()).toContain('机器学习 +2')
})
