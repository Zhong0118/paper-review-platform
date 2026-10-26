import { mount,flushPromises,enableAutoUnmount } from '@vue/test-utils'
import { afterEach,beforeEach,it,expect,vi } from 'vitest'
import { createPinia } from 'pinia'
const api=vi.hoisted(()=>({getDisciplines:vi.fn(),getDisciplineSettings:vi.fn(),saveDisciplineSettings:vi.fn(),previewCatalogImport:vi.fn(),applyCatalogImport:vi.fn()}))
vi.mock('@/api/catalogs',()=>api)
import SchoolPage from '../pages/SchoolDisciplinesPage.vue'
import Import from '@/components/app/OfficialCatalogImport.vue'
enableAutoUnmount(afterEach)
beforeEach(()=>{vi.resetAllMocks();api.getDisciplines.mockResolvedValue([{code:'0101',name:'哲学'},{code:'0812',name:'计算机科学与技术'}]);api.getDisciplineSettings.mockResolvedValue({configured:false,codes:[],version:0})})
it('saves the school scope and reloads on conflict without replaying',async()=>{
 const w=mount(SchoolPage,{global:{plugins:[createPinia()],stubs:{PortalLayout:{template:'<div><slot/></div>'}}}})
 await flushPromises()
 await w.get('input[value="0812"]').setValue(false)
 api.saveDisciplineSettings.mockRejectedValue({response:{status:409}})
 api.getDisciplineSettings.mockResolvedValue({configured:true,codes:[],version:1})
 await w.get('main>button').trigger('click');await flushPromises()
 expect(api.saveDisciplineSettings).toHaveBeenCalledExactlyOnceWith(['0101'],0)
 expect(w.get('[role="alert"]').text()).toContain('重新确认')
 expect((w.get('input[value="0101"]').element as HTMLInputElement).checked).toBe(false)
})
it('requires a preview before applying the pinned source and invalidates stale preview',async()=>{
 const w=mount(Import)
 const preview={fingerprint:'f'.repeat(64),disciplines:{added:184,changed:0,unchanged:0},institutions:{added:3196,changed:0,unchanged:0},sources:[]}
 api.previewCatalogImport.mockResolvedValue(preview)
 await w.get('button').trigger('click');await flushPromises()
 expect(w.text()).toContain('3196')
 expect(api.applyCatalogImport).not.toHaveBeenCalled()
 api.applyCatalogImport.mockRejectedValue({response:{status:409}})
 await w.findAll('button')[1]!.trigger('click');await flushPromises()
 expect(api.applyCatalogImport).toHaveBeenCalledExactlyOnceWith(preview.fingerprint)
 expect(w.text()).toContain('重新预览')
 expect(w.findAll('button')).toHaveLength(1)
})
it('can clear the school scope explicitly and restore all choices',async()=>{
 const w=mount(SchoolPage,{global:{plugins:[createPinia()],stubs:{PortalLayout:{template:'<div><slot/></div>'}}}})
 await flushPromises()
 const button=(label:string)=>w.findAll('button').find(b=>b.text()===label)!
 await button('清空选择').trigger('click')
 expect(w.findAll('input[type="checkbox"]:checked')).toHaveLength(0)
 api.saveDisciplineSettings.mockResolvedValue({configured:true,codes:[],version:1})
 await button('保存本校范围').trigger('click');await flushPromises()
 expect(api.saveDisciplineSettings).toHaveBeenCalledExactlyOnceWith([],0)
 await button('选择全部').trigger('click')
 expect(w.findAll('input[type="checkbox"]:checked')).toHaveLength(2)
})
