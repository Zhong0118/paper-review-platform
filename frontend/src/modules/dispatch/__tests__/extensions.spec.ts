import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ExtensionPanel from '../components/ExtensionPanel.vue'
import BatchDeadlines from '@/modules/school/components/BatchDeadlines.vue'
import type { ReviewBatch } from '@/api/schoolOperations'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), saveDeadlines: vi.fn() }))
vi.mock('@/api/request', () => ({ httpApi: api }))
vi.mock('@/api/schoolOperations', () => ({ saveDeadlines: api.saveDeadlines }))
beforeEach(() => {
  vi.resetAllMocks()
  api.get.mockResolvedValue([])
})
afterEach(() => vi.restoreAllMocks())

it('sends an explicit empty deadline independently of the other clock', async () => {
  const w = mount(BatchDeadlines, {
    props: { batch: { id: 'b', version: 7, review_days: 5, accept_days: 2 } as ReviewBatch },
  })
  const fields = w.findAll('input')
  await fields[0].setValue('')
  await fields[1].setValue('4')
  await w.get('form').trigger('submit')
  await flushPromises()
  expect(api.saveDeadlines).toHaveBeenCalledWith('b', 7, null, 4)
  expect(w.emitted('saved')).toHaveLength(1)
})

it('keeps Beijing wall time independent of machine timezone and allows retry after rejection', async () => {
  const w = mount(ExtensionPanel, { props: { taskId: 't', canRequest: true } })
  await flushPromises()
  await w.get('[type=datetime-local]').setValue('2027-02-20T15:15')
  await w.get('input[maxlength]').setValue('申请延长')
  api.post.mockRejectedValueOnce({ response: { data: { message: '期限过早' } } })
  await w.get('form').trigger('submit')
  await flushPromises()
  expect(w.get('[role=alert]').text()).toBe('期限过早')
  expect(w.find('form').exists()).toBe(true)
  expect(api.post).toHaveBeenCalledWith(
    '/expert/tasks/t/extensions',
    { requested_due_at: '2027-02-20T07:15:00.000Z', reason: '申请延长' },
    expect.objectContaining({ idempotencyKey: expect.any(String) }),
  )
})

it('preserves terminal pending history without offering approval', async () => {
  api.get.mockResolvedValue([
    { id: 'r', task_id: 't', status: 'PENDING', actionable: false, reason: '测试' },
  ])
  const w = mount(ExtensionPanel)
  await flushPromises()
  expect(w.text()).toContain('任务已结束（未审批）')
  expect(w.find('input').exists()).toBe(false)
  expect(w.text()).not.toContain('批准延期')
})
