/**
 * U2-3 学生办理门户与编辑页（真实模式）。
 */
import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth'

import StudentPortalPage from '../StudentPortalPage.vue'
import StudentThesisEditor from '../StudentThesisEditor.vue'

const api = vi.hoisted(() => ({
  fetchEligibility: vi.fn(),
  listTheses: vi.fn(), getThesis: vi.fn(), deleteThesis: vi.fn(), withdrawThesis: vi.fn(),
  createThesis: vi.fn(), patchThesis: vi.fn(), submitThesis: vi.fn(),
  getMyDisciplines: vi.fn(), studentPrograms: vi.fn(),
  uploadThesisFile: vi.fn(), checkSensitiveThesis: vi.fn(),
}))
vi.mock('@/api/auth', async (original) => ({ ...(await original<object>()), fetchEligibility: api.fetchEligibility }))
vi.mock('@/api/theses', () => api)
vi.mock('@/api/catalogs', () => api)
vi.mock('@/api/schoolPrograms', () => api)
vi.mock('@/api/files', () => api)
vi.mock('@/api/sensitiveChecks', () => api)

enableAutoUnmount(afterEach)

const eligibility = { eligible: true, status: 'ELIGIBLE', student_no: 'S1', student_name: '学生甲', supervisor_name: null, degree_type: null,
  tenant_name: '示例大学', college_name: '计算机学院', batch_id: 'b1', batch_name: '2026 秋季送审', deadline: '2026-11-30T10:00:00Z' }
function thesis(id: string, stage: string, extra: Record<string, unknown> = {}) {
  return {
    id, stage, version: 3, return_reason: null, draft_eligibility_status: 'ELIGIBLE',
    allowed_actions: stage === 'DRAFT' ? ['EDIT_THESIS', 'SUBMIT_THESIS', 'DELETE_DRAFT'] : ['SUBMITTED', 'PREPARING', 'READY_FOR_DISPATCH'].includes(stage) ? ['WITHDRAW_BEFORE_DISPATCH'] : [],
    anonymization: { auto_conclusion: null, manual_conclusion: null, findings: [], stale: false },
    current_version: {
      id: `v-${id}`, content_revision: 'a'.repeat(64), title: `论文 ${id}`, abstract: '摘要', discipline_code: '0812', discipline_name: '计算机科学与技术',
      keywords: ['调度'], is_editable: stage === 'DRAFT', school_program: null,
      files: [{ file_id: 'f-o', purpose: 'original', filename: '原稿.pdf' }, { file_id: 'f-a', purpose: 'anonymous', filename: '匿名稿.pdf' }],
    },
    recent_events: [{ action: 'create_draft', from_stage: null, to_stage: 'DRAFT', reason: null }],
    review_batch: { id: 'b1', name: '2026 秋季送审', end_at: null },
    ...extra,
  }
}
const httpError = (status: number, code?: string, data?: unknown) =>
  Object.assign(new Error(code ?? `HTTP ${status}`), { response: { status, data: { code, message: `错误 ${status}`, data } } })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  api.fetchEligibility.mockResolvedValue(eligibility)
  api.listTheses.mockResolvedValue([])
  api.getMyDisciplines.mockResolvedValue([{ code: '0812', name: '计算机科学与技术' }])
  api.studentPrograms.mockResolvedValue({ catalog_id: null, items: [] })
})
afterEach(() => vi.unstubAllEnvs())

async function mountAt(url: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/student/dashboard', component: StudentPortalPage },
      { path: '/student/thesis/edit', component: StudentThesisEditor },
      { path: '/student/results', component: { template: '<p data-results />' } },
      { path: '/login', component: { template: '<p />' } },
    ],
  })
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.user = { id: 'u1', role: 'student', tenantId: 't1', displayName: '学生甲', username: 'stu', tenantCode: 'S01' } as typeof auth.user
  await router.push(url)
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [pinia, router] }, attachTo: document.body })
  await flushPromises()
  return { wrapper, router }
}

describe('U2-3 student portal', () => {
  it('leads with the current draft: status, next step, materials and edit link', async () => {
    api.listTheses.mockResolvedValue([thesis('d1', 'DRAFT'), thesis('old', 'COMPLETED', { review_batch: { id: 'b0', name: '2025 春季', end_at: null } })])
    const { wrapper } = await mountAt('/student/dashboard')
    const current = wrapper.get('.current')
    expect(current.text()).toContain('草稿')
    expect(current.text()).toContain('补齐信息和材料后提交给学校核验')
    expect(current.get('[data-action="edit-thesis"]').attributes('href')).toBe('/student/thesis/edit?thesisId=d1')
    expect(current.get('.materials').text()).toContain('匿名检测未运行')
    expect(current.text()).toContain('你创建了这篇论文')
    const others = wrapper.get('.others')
    expect(others.text()).toContain('论文 old')
    expect(others.get('a').attributes('href')).toBe('/student/results?thesisId=old')
    expect(wrapper.find('[data-action="create-thesis"]').exists()).toBe(false)
  })

  it('quotes the school return reason on a returned draft', async () => {
    api.listTheses.mockResolvedValue([thesis('d1', 'DRAFT', { return_reason: '匿名稿第 3 页致谢含导师姓名' })])
    const { wrapper } = await mountAt('/student/dashboard')
    expect(wrapper.get('.returned').text()).toContain('匿名稿第 3 页致谢含导师姓名')
    expect(wrapper.get('[data-action="edit-thesis"]').text()).toBe('修改这份论文')
  })

  it('deletes a never-submitted draft and offers to start again', async () => {
    api.listTheses.mockResolvedValueOnce([thesis('d1', 'DRAFT')]).mockResolvedValueOnce([])
    api.deleteThesis.mockResolvedValue(undefined)
    const { wrapper } = await mountAt('/student/dashboard')
    await wrapper.get('[data-action="more"]').trigger('click')
    await wrapper.get('[data-action="delete-draft"]').trigger('click')
    expect(wrapper.text()).toContain('此操作不提供自助恢复')
    await wrapper.get('[data-action="confirm-delete"]').trigger('click')
    await flushPromises()
    expect(api.deleteThesis).toHaveBeenCalledWith('d1', { quiet: true })
    expect(wrapper.get('.empty').text()).toContain('草稿已删除')
    expect(wrapper.get('[data-action="create-thesis"]').attributes('href')).toBe('/student/thesis/edit')
  })

  it('requires a withdraw reason and keeps it when the thesis moved on', async () => {
    api.listTheses.mockResolvedValue([thesis('p1', 'PREPARING')])
    api.withdrawThesis.mockRejectedValueOnce(httpError(409, 'STATE_TRANSITION_DENIED'))
    api.getThesis.mockResolvedValue(thesis('p1', 'UNDER_REVIEW'))
    const { wrapper } = await mountAt('/student/dashboard')
    expect(wrapper.text()).toContain('学校核验中')
    await wrapper.get('[data-action="more"]').trigger('click')
    expect(wrapper.find('[data-action="delete-draft"]').exists()).toBe(false)
    await wrapper.get('[data-action="withdraw"]').trigger('click')
    expect(wrapper.get('[data-action="confirm-withdraw"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-withdraw-reason]').setValue('需要替换匿名稿')
    await wrapper.get('[data-action="confirm-withdraw"]').trigger('click')
    await flushPromises()
    expect(api.withdrawThesis).toHaveBeenCalledWith('p1', 3, '需要替换匿名稿', { quiet: true })
    expect(wrapper.text()).toContain('本次没有撤回')
    expect((wrapper.get('[data-withdraw-reason]').element as HTMLTextAreaElement).value).toBe('需要替换匿名稿')
    expect(wrapper.get('.current').text()).toContain('专家评阅中')
  })

  it('withdraws back to a draft', async () => {
    api.listTheses.mockResolvedValue([thesis('p1', 'SUBMITTED')])
    api.withdrawThesis.mockResolvedValue(thesis('p1', 'DRAFT'))
    const { wrapper } = await mountAt('/student/dashboard')
    await wrapper.get('[data-action="more"]').trigger('click')
    await wrapper.get('[data-action="withdraw"]').trigger('click')
    await wrapper.get('[data-withdraw-reason]').setValue('补充材料')
    await wrapper.get('[data-action="confirm-withdraw"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.current').text()).toContain('草稿')
    expect(wrapper.text()).toContain('论文已撤回为草稿')
  })

  it('offers to start only with eligibility and no active thesis in the batch', async () => {
    const { wrapper } = await mountAt('/student/dashboard')
    expect(wrapper.get('[data-action="create-thesis"]').text()).toBe('开始送审')
    expect(wrapper.text()).toContain('2026 秋季送审')
  })

  it('explains missing eligibility without a start button and still lists old theses', async () => {
    api.fetchEligibility.mockRejectedValue(httpError(403, 'ACCESS_DENIED'))
    api.listTheses.mockResolvedValue([thesis('old', 'COMPLETED')])
    const { wrapper } = await mountAt('/student/dashboard')
    expect(wrapper.find('[data-action="create-thesis"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('你目前没有本批次的送审资格')
    expect(wrapper.get('.others').text()).toContain('论文 old')
  })

  it('reports a list failure with retry instead of an empty state', async () => {
    api.listTheses.mockRejectedValueOnce(httpError(500)).mockResolvedValueOnce([thesis('d1', 'DRAFT')])
    const { wrapper } = await mountAt('/student/dashboard')
    expect(wrapper.text()).toContain('没有取到你的论文列表')
    expect(wrapper.text()).not.toContain('还没有论文')
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.get('.current').text()).toContain('论文 d1')
  })
})

describe('U2-3 student thesis editor', () => {
  it('creates the draft on the edit page with a real title, keywords and discipline (D5)', async () => {
    api.createThesis.mockResolvedValue(thesis('n1', 'DRAFT'))
    api.getThesis.mockResolvedValue(thesis('n1', 'DRAFT'))
    const { wrapper, router } = await mountAt('/student/thesis/edit')
    expect(wrapper.get('#create-h').text()).toBe('开始送审')
    await wrapper.get('[data-action="create-selected-draft"]').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.text()).toContain('请填写论文题目')
    expect(api.createThesis).not.toHaveBeenCalled()
    await wrapper.get('[data-create-title]').setValue('容错调度研究')
    await wrapper.get('[data-create-keywords]').setValue('调度，容错、调度')
    expect(wrapper.text()).toContain('已识别 2 个：调度、容错（已去掉 1 个重复）')
    await wrapper.get('[data-action="open-discipline"]').trigger('click')
    await wrapper.get('[data-discipline="0812"]').trigger('click')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(api.createThesis).toHaveBeenCalledWith(expect.objectContaining({ title: '容错调度研究', keywords: ['调度', '容错'], discipline_code: '0812' }))
    expect(router.currentRoute.value.query.thesisId).toBe('n1')
  })

  it('points to the existing thesis when the batch already has one', async () => {
    api.createThesis.mockRejectedValue(httpError(409, 'VERSION_CONFLICT', { id: 'e1' }))
    api.getThesis.mockResolvedValue(thesis('e1', 'PREPARING'))
    const { wrapper, router } = await mountAt('/student/thesis/edit')
    await wrapper.get('[data-create-title]').setValue('题目')
    await wrapper.get('[data-create-keywords]').setValue('调度')
    await wrapper.get('[data-action="open-discipline"]').trigger('click')
    await wrapper.get('[data-discipline="0812"]').trigger('click')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('你在本批次已经有一篇论文')
    await wrapper.get('[data-open-existing]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.thesisId).toBe('e1')
    expect(wrapper.text()).toContain('这篇论文当前不能编辑')
  })

  it('saves with the opaque content revision and stops on a conflict', async () => {
    api.getThesis.mockResolvedValue(thesis('d1', 'DRAFT'))
    api.patchThesis.mockRejectedValueOnce(httpError(409, 'VERSION_CONFLICT'))
    const { wrapper } = await mountAt('/student/thesis/edit?thesisId=d1')
    expect(wrapper.get('h1').text()).toBe('论文 d1')
    await wrapper.get('input[name="title"]').setValue('论文 d1（修订）')
    expect(wrapper.text()).toContain('有未保存的修改')
    await wrapper.get('[data-action="save-draft"]').trigger('click')
    await flushPromises()
    expect(api.patchThesis).toHaveBeenCalledWith('d1', expect.objectContaining({ expected_content_revision: 'a'.repeat(64), title: '论文 d1（修订）' }))
    expect(wrapper.text()).toContain('论文内容或材料在其他页面改动过')
    await wrapper.get('[data-action="compare-server-thesis"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.server').text()).toContain('论文 d1')
    expect((wrapper.get('input[name="title"]').element as HTMLInputElement).value).toBe('论文 d1（修订）')
  })

  it('lists what is missing before submit, then submits with version, revision and a stable key', async () => {
    api.getThesis.mockResolvedValueOnce(thesis('d1', 'DRAFT', { current_version: { ...thesis('d1', 'DRAFT').current_version, abstract: '' } }))
    const { wrapper, router } = await mountAt('/student/thesis/edit?thesisId=d1')
    expect(wrapper.get('[data-submit-checklist]').text()).toContain('请填写论文摘要。')
    await wrapper.get('textarea[name="abstract"]').setValue('补上的摘要')
    api.patchThesis.mockResolvedValue(thesis('d1', 'DRAFT', { current_version: { ...thesis('d1', 'DRAFT').current_version, abstract: '补上的摘要', content_revision: 'b'.repeat(64) } }))
    await wrapper.get('[data-action="save-draft"]').trigger('click')
    await flushPromises()
    api.getThesis.mockResolvedValue(thesis('d1', 'DRAFT', { current_version: { ...thesis('d1', 'DRAFT').current_version, abstract: '补上的摘要', content_revision: 'b'.repeat(64) } }))
    await wrapper.get('[data-action="open-submit-confirmation"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.freeze').text()).toContain('匿名稿.pdf')
    api.submitThesis.mockRejectedValueOnce(new Error('网络中断')).mockResolvedValueOnce(thesis('d1', 'SUBMITTED'))
    await wrapper.get('[data-action="confirm-submit"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-submit-error]').text()).toContain('提交失败')
    await wrapper.get('[data-action="confirm-submit"]').trigger('click')
    await flushPromises()
    const [first, second] = api.submitThesis.mock.calls
    expect(first.slice(0, 3)).toEqual(['d1', 3, 'b'.repeat(64)])
    expect(second[3].idempotencyKey).toBe(first[3].idempotencyKey)
    expect(router.currentRoute.value.path).toBe('/student/dashboard')
  })
})
