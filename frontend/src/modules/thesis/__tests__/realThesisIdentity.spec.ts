import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const programApi=vi.hoisted(()=>({studentPrograms:vi.fn()}))
vi.mock('@/api/schoolPrograms',()=>programApi)
const api = vi.hoisted(() => ({
  getThesis: vi.fn(), createThesis: vi.fn(), patchThesis: vi.fn(), submitThesis: vi.fn(),
  fetchEligibility: vi.fn(), getMyDisciplines: vi.fn(), checkSensitiveThesis: vi.fn(), uploadThesisFile: vi.fn(), getFileContent: vi.fn(),
}))
vi.mock('@/api/theses', () => api)
vi.mock('@/api/sensitiveChecks', () => api)
vi.mock('@/api/files', () => api)
vi.mock('@/api/catalogs', () => ({getMyDisciplines:api.getMyDisciplines}))
vi.mock('@/api/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/auth')>(),
  fetchEligibility: api.fetchEligibility,
}))

import Page from '../pages/ThesisEditPage.vue'

enableAutoUnmount(afterEach)
afterEach(() => vi.unstubAllEnvs())
beforeEach(() => { vi.stubEnv('VITE_DEMO_MODE', 'false'); vi.resetAllMocks(); programApi.studentPrograms.mockResolvedValue({catalog_id:null,items:[]}); api.getMyDisciplines.mockResolvedValue([{code:'0812',name:'计算机科学与技术'}]) })

const historical = {
  id: 'old-thesis', stage: 'DRAFT', version: 1, return_reason: null,
  allowed_actions: ['EDIT_THESIS', 'SUBMIT_THESIS'],
  anonymization: { auto_conclusion: null, manual_conclusion: null, findings: [] },
  current_version: { id: 'old-version', title: '旧论文', abstract: '旧摘要', discipline_code: '0812',
    discipline_name: '计算机科学与技术', keywords: ['盲审'], is_editable: true, files: [] },
  recent_events: [],
  student: { name: '旧学生', student_no: 'old-001', supervisor_name: '旧导师',
    degree_type: '工学硕士', tenant_name: '旧学校', college_name: '旧学院' },
  batch_name: '旧批次',
  review_batch: { id: 'old-batch', name: '旧批次', end_at: '2026-05-20T10:00:00Z' },
}

async function page(id='old-thesis') {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/student/thesis/edit', component: Page },
    { path: '/student/dashboard', component: { template: '<div>工作台</div>' } },
  ] })
  await router.push(`/student/thesis/edit?thesisId=${id}`)
  await router.isReady()
  const wrapper = mount(RouterView, { global: {
    plugins: [createPinia(), router],
    stubs: { PortalLayout: { template: '<div><slot/></div>' } },
  } })
  await flushPromises()
  return wrapper
}

it('renders the historical thesis identity without loading current eligibility', async () => {
  api.getThesis.mockResolvedValue(historical)
  api.fetchEligibility.mockResolvedValue({
    student_name: '新学生', student_no: 'new-001', supervisor_name: '新导师',
    degree_type: '理学博士', tenant_name: '新学校', college_name: '新学院',
    batch_name: '新批次', deadline: '2027-05-20T10:00:00Z',
  })
  const wrapper = await page()
  const identity = wrapper.get('[data-student-identity]').text()
  for (const value of ['旧学校', '旧学院', '旧学生', 'old-001', '旧导师', '工学硕士', '旧批次', '2026-05-20']) {
    expect(identity).toContain(value)
  }
  for (const value of ['新学校', '新学院', '新学生', '新导师', '理学博士', '新批次', '教授']) {
    expect(identity).not.toContain(value)
  }
  expect(api.getThesis).toHaveBeenCalledWith('old-thesis')
  expect(api.fetchEligibility).not.toHaveBeenCalled()
})

it('shows missing identity fields explicitly instead of demo or current values', async () => {
  api.getThesis.mockResolvedValue({
    ...historical, student: { name: '', student_no: '', supervisor_name: null,
      degree_type: null, tenant_name: '', college_name: '' },
    batch_name: '', review_batch: undefined,
  })
  api.fetchEligibility.mockResolvedValue({ batch_name: '当前批次', supervisor_name: '当前导师' })
  const wrapper = await page()
  const identity = wrapper.get('[data-student-identity]').text()
  expect(identity).toContain('未提供')
  expect(identity).toContain('未设置')
  for (const value of ['海岳大学', '2026-05-20', '赵文博教授', '当前批次', '当前导师']) {
    expect(identity).not.toContain(value)
  }
  expect(api.fetchEligibility).not.toHaveBeenCalled()
})


it('creates only after an explicit server-provided discipline is selected', async () => {
  api.getMyDisciplines.mockResolvedValue([{code:'0101',name:'哲学'}])
  api.createThesis.mockResolvedValue({id:'new-philosophy'})
  api.getThesis.mockResolvedValue({...historical,id:'new-philosophy'})
  const wrapper = await page('new')
  expect(api.createThesis).not.toHaveBeenCalled()
  expect(wrapper.get('[data-action="create-selected-draft"]').attributes('disabled')).toBeDefined()
  await wrapper.get('[data-action="open-discipline"]').trigger('click')
  await wrapper.get('[data-discipline="0101"]').trigger('click')
  await wrapper.get('[data-action="create-selected-draft"]').trigger('click')
  await flushPromises()
  expect(api.createThesis).toHaveBeenCalledWith(expect.objectContaining({discipline_code:'0101',discipline_name:'哲学'}))
})

it('does not create or fall back to demo choices when the directory fails', async () => {
  api.getMyDisciplines.mockRejectedValue(new Error('目录不可用'))
  const wrapper = await page('new')
  expect(wrapper.get('[role="alert"]').text()).toContain('目录不可用')
  expect(api.createThesis).not.toHaveBeenCalled()
  expect(wrapper.find('[data-action="open-discipline"]').exists()).toBe(false)
})


it('saves draft metadata before running the bound anonymous check and renders the returned report', async () => {
  const draft = {...historical,current_version:{...historical.current_version,files:[{file_id:'anonymous-a',purpose:'anonymous',filename:'anonymous.pdf'}]}}
  api.getThesis.mockResolvedValue(draft)
  api.patchThesis.mockResolvedValue(draft)
  api.checkSensitiveThesis.mockResolvedValue({auto_conclusion:'PASS',manual_conclusion:null,stale:false,findings:[],source_metadata:{file_id:'anonymous-a',thesis_version_id:'old-version',title_status:'FOUND',terms_version:4,uncertain:false,uncertain_pages:[],page_count:1}})
  const wrapper = await page()
  await wrapper.get('[data-run-sensitive]').trigger('click');await flushPromises()
  expect(api.patchThesis).toHaveBeenCalledWith('old-thesis',expect.objectContaining({title:'旧论文'}))
  expect(api.checkSensitiveThesis).toHaveBeenCalledWith('old-thesis',{expected_version:1,file_id:'anonymous-a'})
  expect(wrapper.get('[data-sensitive-report]').text()).toContain('本校词表版本 4')
})

it('does not check an old server file when the user removes the selected anonymous material',async()=>{
  const draft={...historical,current_version:{...historical.current_version,files:[{file_id:'anonymous-a',purpose:'anonymous',filename:'anonymous.pdf'}]}}
  api.getThesis.mockResolvedValue(draft);api.patchThesis.mockResolvedValue(draft)
  const wrapper=await page()
  await wrapper.get('[data-file-purpose="EXPERT_REVIEW"] [data-action="delete-file"]').trigger('click')
  await wrapper.get('[data-run-sensitive]').trigger('click');await flushPromises()
  expect(api.checkSensitiveThesis).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('请先选择匿名 PDF 材料')
})

it('lists simultaneous missing materials and a closed discipline without blocking a suspended existing eligibility', async () => {
  api.getMyDisciplines.mockResolvedValue([])
  api.getThesis.mockResolvedValue({...historical, draft_eligibility_status:'SUSPENDED'})
  const w = await page()
  const panel = w.get('[data-submit-checklist]')
  for (const text of ['资格已暂停','仍可提交','不在本校开放目录','请上传原始版','请上传匿名版']) expect(panel.text()).toContain(text)
  await w.get('[data-action="open-submit-confirmation"]').trigger('click')
  expect(w.find('[role=dialog]').exists()).toBe(false)
})

it('selects a local code by official name and sends its pinned catalog along with canonical discipline', async () => {
  programApi.studentPrograms.mockResolvedValue({catalog_id:'catalog-b',items:[
    {code:'0007',name:'虚构乙专业',official_code:'0812',official_name:'计算机科学与技术'}]})
  api.createThesis.mockResolvedValue({...historical,id:'new-id'})
  api.getThesis.mockResolvedValue({...historical,id:'new-id'})
  const wrapper=await page('new')
  await wrapper.get('[data-action="open-discipline"]').trigger('click')
  await wrapper.get('input[type=search]').setValue('计算机')
  await wrapper.get('[data-discipline="0007"]').trigger('click')
  await wrapper.get('[data-action="create-selected-draft"]').trigger('click')
  await flushPromises()
  expect(api.createThesis.mock.calls[0]?.[0]).not.toHaveProperty('discipline_code')
  expect(api.createThesis).toHaveBeenCalledWith(expect.objectContaining({
    program:{catalog_id:'catalog-b',code:'0007'}}))
})
