import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import type { ThesisDetail } from '@/api/theses'
const api = vi.hoisted(() => ({ getFileContent: vi.fn(), getSensitiveTerms: vi.fn(), saveSensitiveTerms: vi.fn() }))
vi.mock('@/api/files', () => ({ getFileContent: api.getFileContent }))
vi.mock('@/api/sensitiveChecks', () => api)
import Panel from '@/components/app/SensitiveFindingPanel.vue'
import TermsPage from '@/modules/school/pages/SensitiveTermsPage.vue'
import { portalMenus } from '@/router/menus'
import { appRoutes } from '@/router/routes'

enableAutoUnmount(afterEach)
beforeEach(() => {
  vi.resetAllMocks(); setActivePinia(createPinia())
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:owned-pdf'), revokeObjectURL: vi.fn() }))
  api.getFileContent.mockResolvedValue(new Blob(['pdf'],{type:'application/pdf'}))
})
afterEach(() => vi.unstubAllGlobals())
function detail(): ThesisDetail {
  return { id:'thesis-a',stage:'DRAFT',version:1,return_reason:null,allowed_actions:['EDIT_THESIS'],recent_events:[],
    current_version:{id:'version-a',title:'标题',abstract:'',keywords:[],discipline_code:'0812',discipline_name:'计算机',is_editable:true,files:[{file_id:'anonymous-a',filename:'anonymous.pdf',purpose:'anonymous'}]},
    anonymization:{auto_conclusion:'FAIL',manual_conclusion:null,stale:false,source_metadata:{file_id:'anonymous-a',thesis_version_id:'version-a',file_sha256:'hash',detector_version:'v3',terms_version:1,title_status:'TITLE_NOT_FOUND',uncertain:true,uncertain_pages:[3],page_count:3},findings:[
      {field:'student_name',location:'body',kind:'IDENTITY',source:'body',page_number:1,matched_text:'甲某',context:'第一页甲某',severity:'BLOCK'},
      {field:'supervisor_name',location:'body',kind:'IDENTITY',source:'body',page_number:2,matched_text:'乙某',context:'第二页乙某',severity:'BLOCK'},
      {field:'student_no',location:'metadata',kind:'IDENTITY',source:'metadata',page_number:null,matched_text:'20260001',context:'作者属性',severity:'BLOCK'},
    ]} }
}
it('groups physical pages, labels metadata and uncertainty, and previews only the bound file', async () => {
  const wrapper=mount(Panel,{props:{detail:detail()}})
  expect(wrapper.text()).toContain('PDF 物理页 1')
  expect(wrapper.text()).toContain('PDF 物理页 2')
  expect(wrapper.text()).toContain('文件元数据')
  expect(wrapper.text()).toContain('3')
  expect(wrapper.text()).toContain('前两页未找到登记标题')
  expect(wrapper.text()).not.toContain('自动替换')
  await wrapper.get('[data-preview-page="2"]').trigger('click'); await flushPromises()
  expect(api.getFileContent).toHaveBeenCalledWith('anonymous-a')
  expect(wrapper.get('iframe').attributes('src')).toBe('blob:owned-pdf#page=2')
  expect(wrapper.text()).toContain('若阅读器未自动跳转')
  await wrapper.get('[data-preview-page="1"]').trigger('click'); await flushPromises()
  expect(wrapper.get('iframe').attributes('src')).toBe('blob:owned-pdf#page=1')
})
it('hides old excerpts and preview after a changed file or dirty form',async()=>{
 const wrapper=mount(Panel,{props:{detail:detail()}})
 await wrapper.get('[data-preview-page="1"]').trigger('click');await flushPromises()
 await wrapper.setProps({invalidated:true})
 expect(wrapper.text()).not.toContain('第一页甲某')
 expect(wrapper.text()).toContain('检测依据已变化')
 expect(wrapper.find('iframe').exists()).toBe(false)
 expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-pdf')
 await wrapper.setProps({invalidated:false,detail:{...detail(),current_version:{...detail().current_version!,files:[{file_id:'new-file',filename:'new.pdf',purpose:'anonymous'}]}}})
 expect(wrapper.find('[data-preview-page]').exists()).toBe(false)
})
it('discards an in-flight preview after logout or selection change',async()=>{
 let resolve!:(blob:Blob)=>void
 api.getFileContent.mockReturnValue(new Promise<Blob>(r=>{resolve=r}))
 const wrapper=mount(Panel,{props:{detail:detail()}})
 await wrapper.get('[data-preview-page="1"]').trigger('click')
 await wrapper.setProps({detail:{...detail(),id:'other-thesis'}})
 resolve(new Blob(['old']));await flushPromises()
 expect(wrapper.find('iframe').exists()).toBe(false)
 expect(URL.createObjectURL).not.toHaveBeenCalled()
})
it('displays an empty or historical unbound report honestly',()=>{
 const wrapper=mount(Panel,{props:{detail:{...detail(),anonymization:{auto_conclusion:null,manual_conclusion:null,findings:[]}}}})
 expect(wrapper.text()).toContain('尚无当前材料检测报告')
 expect(wrapper.find('[data-preview-page]').exists()).toBe(false)
})
async function termsPage(){
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:TermsPage}]})
 await router.push('/');await router.isReady()
 const wrapper=mount(TermsPage,{global:{plugins:[router],stubs:{PortalLayout:{template:'<div><slot/></div>'}}}})
 await flushPromises();return wrapper
}
it('edits school literal terms with defaults, expected version and explicit conflict recovery',async()=>{
 api.getSensitiveTerms.mockResolvedValue({version:2,terms:[]})
 const wrapper=await termsPage()
 expect(wrapper.text()).toContain('没有内置官方敏感词库')
 await wrapper.get('[data-add-term]').trigger('click')
 await wrapper.get('[data-term-text]').setValue('待核词')
 api.saveSensitiveTerms.mockRejectedValue(new Error('词表已变化，请刷新后再保存'))
 await wrapper.get('[data-save-terms]').trigger('click');await flushPromises()
 expect(api.saveSensitiveTerms).toHaveBeenCalledWith({expected_version:2,terms:[{text:'待核词',severity:'WARN',description:''}]})
 expect((wrapper.get('[data-term-text]').element as HTMLInputElement).value).toBe('待核词')
 expect(wrapper.text()).toContain('词表已变化')
 api.getSensitiveTerms.mockResolvedValue({version:3,terms:[{text:'新配置',severity:'BLOCK',description:'本校规则'}]})
 await wrapper.get('[data-reload-terms]').trigger('click');await flushPromises()
 expect((wrapper.get('[data-term-text]').element as HTMLInputElement).value).toBe('新配置')
})
it('validates duplicates and whitespace before writing',async()=>{
 api.getSensitiveTerms.mockResolvedValue({version:0,terms:[]})
 const wrapper=await termsPage()
 for(let i=0;i<2;i++){await wrapper.get('[data-add-term]').trigger('click');await wrapper.findAll('[data-term-text]')[i]!.setValue('同一个词')}
 await wrapper.get('[data-save-terms]').trigger('click');await flushPromises()
 expect(api.saveSensitiveTerms).not.toHaveBeenCalled()
 expect(wrapper.text()).toContain('不能重复')
})
it('exposes vocabulary configuration only to the school real menu and route',()=>{
 expect(portalMenus('school_reviewer',false).some(x=>x.path==='/school/sensitive-terms')).toBe(true)
 for(const role of ['student','expert','platform_reviewer','system_admin','supervisor'] as const)
   expect(portalMenus(role,false).some(x=>x.path==='/school/sensitive-terms')).toBe(false)
 expect(appRoutes.find(x=>x.path==='/school/sensitive-terms')?.meta?.roleCodes).toEqual(['school_reviewer'])
})
