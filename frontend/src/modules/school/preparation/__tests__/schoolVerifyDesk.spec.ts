import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { deferred, httpError, mountAt, thesis } from './fixtures'

const api = vi.hoisted(() => ({ listSchoolTheses: vi.fn(), getSchoolThesis: vi.fn(), confirmAnonymization: vi.fn(), terminateThesis: vi.fn(), checkSensitiveThesis: vi.fn(), getFileContent: vi.fn(), confirmDispatch: vi.fn() }))
vi.mock('@/api/schoolReview', () => api)
vi.mock('@/api/sensitiveChecks', () => api)
vi.mock('@/api/files', () => api)
vi.mock('@/api/dispatch', () => api)
enableAutoUnmount(afterEach)

const schoolWarn = { field: 'file', location: 'p3', matched_text: '某校区', kind: 'SCHOOL_TERM' as const, severity: 'WARN' as const, page_number: 3, context: '……某校区……' }
const block = { field: 'file', location: 'p1', matched_text: '张三', kind: 'IDENTITY' as const, severity: 'BLOCK' as const, page_number: 1, context: '作者：张三' }
const a = thesis('a', { report: { auto_conclusion: 'REVIEW_REQUIRED', findings: [schoolWarn] } })
const b = thesis('b')
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:local/1'), revokeObjectURL: vi.fn() }))
  api.listSchoolTheses.mockResolvedValue([a, b])
  api.getSchoolThesis.mockImplementation(async (id: string) => [a, b].find((row) => row.id === id))
  api.getFileContent.mockResolvedValue(new Blob(['%PDF']))
})
afterEach(() => vi.unstubAllGlobals())

type W = Awaited<ReturnType<typeof mountAt>>['wrapper']
const button = (w: W, text: string) => w.findAll('button').find((b) => b.text() === text)
const choose = async (w: W, value: 'pass' | 'return') => { await w.get(`input[type="radio"][value="${value}"]`).setValue(true) }
const submit = async (w: W) => { await w.get('[data-action="submit-decision"]').trigger('click'); await flushPromises() }

it('shows each check dimension on its own and the position in the verify queue', async () => {
  const { wrapper } = await mountAt('/school/preparation?thesis=a')
  const basis = wrapper.get('[aria-label="当前报告依据"]').text()
  expect(basis).toContain('需人工复核')
  expect(basis).toContain('阻断 0，警告 1')
  expect(basis).toContain('尚未作出')
  expect(wrapper.text()).toContain('待核验 1 / 2')
  expect(wrapper.get('[aria-label="检测发现"]').text()).toContain('某校区')
})

it('names a stale report as the previous conclusion and greys out passing with the server reason', async () => {
  api.getSchoolThesis.mockResolvedValue(thesis('a', { allowed_actions: ['REJECT_ANONYMIZATION', 'TERMINATE'], report: { auto_conclusion: 'PASS', stale: true, source_metadata: { thesis_version_id: 'v-a', file_id: 'anon-a', file_sha256: 'x', detector_version: 'd', terms_version: 12, title_status: 'FOUND', uncertain: true, uncertain_pages: [9], page_count: 12 } } }))
  const { wrapper } = await mountAt('/school/preparation?thesis=a')
  const basis = wrapper.get('[aria-label="当前报告依据"]').text()
  expect(basis).toContain('上次自动结论')
  expect(basis).toContain('已过期')
  expect(basis).not.toContain('第 9 页')
  expect(wrapper.get('input[value="pass"]').attributes('disabled')).toBeDefined()
  expect(wrapper.get('[aria-label="核验判断"]').text()).toContain('检测报告已过期')
})

it('enables passing only when the server allows it and explains an automatic fail', async () => {
  api.getSchoolThesis.mockResolvedValue(thesis('a', { allowed_actions: ['REJECT_ANONYMIZATION'], report: { auto_conclusion: 'FAIL', findings: [block] } }))
  const { wrapper } = await mountAt('/school/preparation?thesis=a')
  expect(wrapper.get('input[value="pass"]').attributes('disabled')).toBeDefined()
  expect(wrapper.get('input[value="return"]').attributes('disabled')).toBeUndefined()
  expect((wrapper.get('input[value="return"]').element as HTMLInputElement).checked).toBe(true)
  expect(wrapper.get('[aria-label="核验判断"]').text()).toContain('自动检测不通过')
  expect(wrapper.text()).toContain('阻断 1，警告 0')
})

it('keeps the existing school re-check of the anonymous copy and reloads afterwards', async () => {
  api.checkSensitiveThesis.mockResolvedValue({})
  const { wrapper } = await mountAt('/school/preparation?thesis=a')
  await button(wrapper, '重新检测匿名稿')!.trigger('click')
  await flushPromises()
  expect(api.checkSensitiveThesis).toHaveBeenCalledWith('a', { expected_version: 3, file_id: 'anon-a' }, true)
  expect(api.getSchoolThesis).toHaveBeenCalledTimes(2)
})

it('requires a reason for a school-term warning before passing, then sends the server version', async () => {
  api.confirmAnonymization.mockResolvedValue({ ...a, stage: 'READY_FOR_DISPATCH' })
  const { wrapper } = await mountAt('/school/preparation?thesis=a')
  await choose(wrapper, 'pass')
  await submit(wrapper)
  expect(api.confirmAnonymization).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('请说明')
  await wrapper.get('textarea').setValue('第 3 页校区名称为公开地名，不指向个人')
  await submit(wrapper)
  expect(api.confirmAnonymization).toHaveBeenCalledWith('a', { decision: 'PASS', version: 3, reason: '第 3 页校区名称为公开地名，不指向个人' }, { idempotencyKey: expect.any(String) })
})

it('requires a reason to return the thesis', async () => {
  api.confirmAnonymization.mockResolvedValue({ ...a, stage: 'DRAFT' })
  const { wrapper } = await mountAt('/school/preparation?thesis=a')
  await choose(wrapper, 'return')
  await submit(wrapper)
  expect(api.confirmAnonymization).not.toHaveBeenCalled()
  await wrapper.get('textarea').setValue('第 3 页仍有校区名称，请替换')
  await submit(wrapper)
  expect(api.confirmAnonymization).toHaveBeenCalledWith('a', { decision: 'REJECT', version: 3, reason: '第 3 页仍有校区名称，请替换' }, { idempotencyKey: expect.any(String) })
  expect(wrapper.text()).toContain('已退回修改')
})

it('offers the next thesis only after the server confirms', async () => {
  const pending = deferred<unknown>()
  api.confirmAnonymization.mockReturnValue(pending.promise)
  const { wrapper, router } = await mountAt('/school/preparation?thesis=b&view=verify')
  await choose(wrapper, 'pass')
  await submit(wrapper)
  expect(wrapper.text()).toContain('正在提交')
  expect(button(wrapper, '下一篇')).toBeUndefined()
  pending.resolve({ ...b, stage: 'READY_FOR_DISPATCH' })
  await flushPromises()
  expect(wrapper.text()).toContain('已通过核验')
  await button(wrapper, '下一篇')!.trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.query).toMatchObject({ thesis: 'a', view: 'verify' })
})

it('keeps the same idempotency key when retrying the same decision after a network failure', async () => {
  api.confirmAnonymization.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({ ...b, stage: 'READY_FOR_DISPATCH' })
  const { wrapper } = await mountAt('/school/preparation?thesis=b')
  await choose(wrapper, 'pass')
  await submit(wrapper)
  expect(wrapper.get('[role="alert"]').text()).toContain('Network Error')
  await submit(wrapper)
  const keys = api.confirmAnonymization.mock.calls.map((call) => call[2].idempotencyKey)
  expect(keys[0]).toBe(keys[1])
})

it('after a conflict re-reads the thesis and says it was already handled, keeping what was written', async () => {
  api.confirmAnonymization.mockRejectedValue(httpError(409, 'STATE_TRANSITION_DENIED'))
  const { wrapper } = await mountAt('/school/preparation?thesis=a')
  api.getSchoolThesis.mockResolvedValue({ ...a, stage: 'READY_FOR_DISPATCH', version: 4, allowed_actions: ['CONFIRM_DISPATCH'] })
  await choose(wrapper, 'pass')
  await wrapper.get('textarea').setValue('已核对第 3 页')
  await submit(wrapper)
  expect(wrapper.get('[role="status"].banner').text()).toContain('已被处理')
  expect(wrapper.get('[role="status"].banner').text()).toContain('待送出')
  expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('已核对第 3 页')
  expect(wrapper.get('[data-action="submit-decision"]').attributes('disabled')).toBeDefined()
})

it('after a conflict on a still-pending thesis loads the latest materials but keeps the note', async () => {
  api.confirmAnonymization.mockRejectedValueOnce(httpError(409, 'VERSION_CONFLICT')).mockResolvedValueOnce({ ...a, stage: 'READY_FOR_DISPATCH' })
  const { wrapper } = await mountAt('/school/preparation?thesis=a')
  api.getSchoolThesis.mockResolvedValue({ ...a, version: 5 })
  await choose(wrapper, 'pass')
  await wrapper.get('textarea').setValue('已核对第 3 页')
  await submit(wrapper)
  expect(wrapper.get('[role="alert"].banner').text()).toContain('已更新')
  await button(wrapper, '载入最新材料（保留说明）')!.trigger('click')
  await flushPromises()
  expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('已核对第 3 页')
  await submit(wrapper)
  expect(api.confirmAnonymization).toHaveBeenLastCalledWith('a', expect.objectContaining({ version: 5 }), expect.anything())
})

it('treats a deep link to a thesis it cannot see as unavailable', async () => {
  api.getSchoolThesis.mockRejectedValue(httpError(404, 'RESOURCE_NOT_FOUND'))
  const { wrapper } = await mountAt('/school/preparation?thesis=zzz')
  expect(wrapper.text()).toContain('这篇论文已不可用')
  expect(wrapper.findAll('a, button').some((el) => el.text().includes('返回清单'))).toBe(true)
})

it('loads the original only on request and labels who can see each copy', async () => {
  const { wrapper } = await mountAt('/school/preparation?thesis=a')
  expect(api.getFileContent).toHaveBeenCalledWith('anon-a')
  expect(wrapper.text()).toContain('这份材料将交给评阅专家')
  await button(wrapper, '原稿')!.trigger('click')
  await flushPromises()
  expect(api.getFileContent).toHaveBeenCalledWith('orig-a')
  expect(wrapper.text()).toContain('仅本校可见')
})

it('keeps the existing dispatch confirmation and termination, shown only when allowed', async () => {
  const ready = thesis('c', { stage: 'READY_FOR_DISPATCH', version: 6, allowed_actions: ['CONFIRM_DISPATCH', 'TERMINATE'] })
  api.getSchoolThesis.mockResolvedValue(ready)
  api.confirmDispatch.mockResolvedValue({ stage: 'UNDER_REVIEW' })
  api.terminateThesis.mockResolvedValue({ ...ready, stage: 'TERMINATED' })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const { wrapper } = await mountAt('/school/preparation?thesis=c')
  expect(wrapper.find('input[value="pass"]').exists()).toBe(false)
  await button(wrapper, '确认送出')!.trigger('click')
  await flushPromises()
  expect(api.confirmDispatch).toHaveBeenCalledWith('c', 6, { idempotencyKey: expect.any(String) })
  const terminate = wrapper.get('[data-action="terminate-thesis"]')
  expect(terminate.attributes('disabled')).toBeDefined()
  await wrapper.get('[data-terminate-reason]').setValue('学校终止送审')
  await terminate.trigger('click')
  expect(api.terminateThesis).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  await terminate.trigger('click')
  await flushPromises()
  expect(api.terminateThesis).toHaveBeenCalledWith('c', { version: 6, reason: '学校终止送审' }, { idempotencyKey: expect.any(String) })
  confirm.mockRestore()
})
