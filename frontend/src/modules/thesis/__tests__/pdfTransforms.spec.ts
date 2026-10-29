import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
const api = vi.hoisted(() => ({ generatePdfTransform:vi.fn(), applyPdfTransform:vi.fn(), cancelPdfTransform:vi.fn(), uploadTransformSource:vi.fn(), getFileContent:vi.fn() }))
vi.mock('@/api/pdfTransforms', () => api)
vi.mock('@/api/files', () => ({getFileContent:api.getFileContent}))
import Dialog from '@/components/app/PdfTransformDialog.vue'
enableAutoUnmount(afterEach)
const ready = {operation_id:'op',new_file_id:'new',source_version:'v1',page_count:2,status:'READY'}
beforeEach(() => {
  vi.resetAllMocks();setActivePinia(createPinia())
  HTMLDialogElement.prototype.showModal = function(){this.open=true}
  vi.stubGlobal('URL', Object.assign(URL, {createObjectURL:vi.fn(()=>'blob:pdf'),revokeObjectURL:vi.fn()}))
  api.generatePdfTransform.mockResolvedValue(ready)
  api.getFileContent.mockResolvedValue(new Blob(['pdf']))
  api.applyPdfTransform.mockResolvedValue({...ready,status:'APPLIED'})
})
afterEach(()=>vi.unstubAllGlobals())
function dialog(){return mount(Dialog,{props:{thesisId:'thesis',version:1,files:[{file_id:'source',purpose:'anonymous',filename:'paper.pdf'}]},attachTo:document.body})}
it('requires explicit preview then apply, preserving page order',async()=>{
 const w=dialog()
 await w.get('[data-pages]').setValue('2,1')
 await w.get('[data-generate-pdf]').trigger('click');await flushPromises()
 expect(api.generatePdfTransform.mock.calls[0]?.[1]).toEqual({expected_version:1,purpose:'anonymous',operation:'EXTRACT',sources:[{file_id:'source',pages:[2,1]}]})
 expect(api.applyPdfTransform).not.toHaveBeenCalled()
 expect(w.get('iframe').attributes('src')).toBe('blob:pdf')
 await w.get('[data-apply-pdf]').trigger('click');await flushPromises()
 expect(api.applyPdfTransform).toHaveBeenCalledWith('op',1)
 expect(w.emitted('applied')).toHaveLength(1)
})
it('rejects empty or duplicate page plans and retains an operation after apply conflict',async()=>{
 const w=dialog()
 await w.get('[data-pages]').setValue('1,1')
 await w.get('[data-generate-pdf]').trigger('click');await flushPromises()
 expect(api.generatePdfTransform).not.toHaveBeenCalled()
 expect(w.get('[role="alert"]').text()).toContain('页码')
 await w.get('[data-pages]').setValue('1-2')
 await w.get('[data-generate-pdf]').trigger('click');await flushPromises()
 api.applyPdfTransform.mockRejectedValue(new Error('材料已变化'))
 await w.get('[data-apply-pdf]').trigger('click');await flushPromises()
 expect(w.text()).toContain('材料已变化')
 expect(w.emitted('applied')).toBeUndefined()
})
it('cleans preview on unmount and suppresses late responses',async()=>{
 let resolve!:(v:typeof ready)=>void
 api.generatePdfTransform.mockReturnValue(new Promise(r=>{resolve=r}))
 const w=dialog();await w.get('[data-pages]').setValue('1')
 await w.get('[data-generate-pdf]').trigger('click');w.unmount()
 resolve(ready);await flushPromises()
 expect(URL.createObjectURL).not.toHaveBeenCalled()
})
