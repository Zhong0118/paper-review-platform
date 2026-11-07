import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import ReviewFormPane from '../components/ReviewFormPane.vue'

const api = vi.hoisted(() => ({ getReviewChecks: vi.fn() }))
vi.mock('@/api/reviewChecks', () => api)
enableAutoUnmount(afterEach)
const draft = { topicValue: 12, literatureTheory: 12, methodology: 16, innovation: 20, writingStandards: 8,
  resultsWorkload: 12, recommendation: '建议通过', strengths: '', overallComment: '😀甲错词乙', issues: '问题', revisionAdvice: '建议' }
const report = { payload_hash: 'a'.repeat(64), rule_version: 'check-v1', checked_at: '2026-10-13T00:00:00Z', status: 'COMPLETE',
  coverage: { dictionary_version: 'test', dictionary_entries: 1, description: '测试词表' },
  findings: [{ code: 'TEST_WORD', field: 'overallComment', start: 2, end: 4, severity: 'WARN', message: '疑似错词', suggestion: '核对' }] }
beforeEach(() => { vi.resetAllMocks(); api.getReviewChecks.mockResolvedValue(report) })
function form(kind = 'task') {
  return mount(ReviewFormPane, { props: { locked: false, draft: { ...draft }, checkTarget: { kind, id: 'owned-a' } } as never })
}

it('requires category confirmation, preserves text, and clears acknowledgement on score edits', async () => {
  const wrapper = form()
  expect(wrapper.get('[data-action="submit-final-review"]').attributes('disabled')).toBeDefined()
  await wrapper.get('[data-action="check-comments"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('mark').text()).toBe('错词')
  expect(wrapper.get('textarea[name="overallComment"]').element.value).toBe(draft.overallComment)
  await wrapper.get('input[data-check-code="TEST_WORD"]').setValue(true)
  await wrapper.get('[data-action="submit-final-review"]').trigger('click')
  const event = wrapper.emitted('submit')![0]!
  expect(event[0]).toMatchObject({ overallComment: draft.overallComment, topicValue: 12 })
  expect(event[1]).toEqual({ payload_hash: 'a'.repeat(64), rule_version: 'check-v1', codes: ['TEST_WORD'] })
  await wrapper.get('input[name="topicValue"]').setValue(13)
  expect(wrapper.find('input[data-check-code]').exists()).toBe(false)
  expect(wrapper.get('[data-action="submit-final-review"]').attributes('disabled')).toBeDefined()
})

it('shows retry after network failure and never reports a failed check as complete', async () => {
  api.getReviewChecks.mockRejectedValueOnce(new Error('网络失败'))
  const wrapper = form('correction')
  await wrapper.get('[data-action="check-comments"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('网络失败')
  expect(wrapper.get('[data-action="submit-final-review"]').attributes('disabled')).toBeDefined()
  await wrapper.get('[data-action="check-comments"]').trigger('click')
  await flushPromises()
  expect(wrapper.find('input[data-check-code]').exists()).toBe(true)
})

it('discards a late check response after the expert edits the text', async () => {
  let resolve!: (value: unknown) => void
  api.getReviewChecks.mockReturnValue(new Promise(done => { resolve = done }))
  const wrapper = form()
  await wrapper.get('[data-action="check-comments"]').trigger('click')
  await wrapper.get('textarea[name="mainIssues"]').setValue('已经修改了问题描述')
  resolve(report)
  await flushPromises()
  expect(wrapper.find('input[data-check-code]').exists()).toBe(false)
  expect(wrapper.get('[data-action="submit-final-review"]').attributes('disabled')).toBeDefined()
})

it('shows unchecked history separately from a confirmed anonymous receipt', async () => {
  const { default: Summary } = await import('@/components/app/ReviewCheckSummary.vue')
  const wrapper = mount(Summary, { props: { summary: null } })
  expect(wrapper.text()).toContain('未检测')
  await wrapper.setProps({ summary: { rule_version: 'v1', codes: ['SHORT_OVERALL'], counts: { SHORT_OVERALL: 1 }, confirmed_at: '2026-10-13T00:00:00Z' } } as never)
  expect(wrapper.text()).toContain('总体评价偏短')
  expect(wrapper.text()).toContain('已由专家确认')
})


it.each(['strengths', 'evaluations.topicValue'])('restores and locates Unicode findings in %s', async (field) => {
  const text = '😀甲错词乙'
  api.getReviewChecks.mockResolvedValue({ ...report, findings: [{ ...report.findings[0], field }] })
  const wrapper = mount(ReviewFormPane, { attachTo: document.body, props: { locked: false,
    draft: { ...draft, strengths: text, evaluations: { topicValue: text } }, checkTarget: { kind: 'task', id: 'owned-a' } } })
  const input = wrapper.get<HTMLTextAreaElement>(`textarea[name="${field}"]`)
  expect(input.element.value).toBe(text)
  await wrapper.get('[data-action="check-comments"]').trigger('click')
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === '定位原文')!.trigger('click')
  expect(document.activeElement).toBe(input.element)
  expect(input.element.value.slice(input.element.selectionStart, input.element.selectionEnd)).toBe('错词')
})
