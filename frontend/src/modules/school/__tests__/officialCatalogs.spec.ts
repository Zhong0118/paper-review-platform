import { mount,flushPromises,enableAutoUnmount } from '@vue/test-utils'
import { afterEach,beforeEach,it,expect,vi } from 'vitest'
const api=vi.hoisted(()=>({getDisciplines:vi.fn(),getDisciplineSettings:vi.fn(),saveDisciplineSettings:vi.fn(),previewCatalogImport:vi.fn(),applyCatalogImport:vi.fn()}))
vi.mock('@/api/catalogs',()=>api)
import Import from '@/components/app/OfficialCatalogImport.vue'
enableAutoUnmount(afterEach)
beforeEach(()=>{vi.resetAllMocks();})
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
