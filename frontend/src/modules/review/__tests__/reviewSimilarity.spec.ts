import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import ReviewCheckPanel from '@/components/app/ReviewCheckPanel.vue'
const api = vi.hoisted(() => ({ getReviewChecks: vi.fn() }))
vi.mock('@/api/reviewChecks', () => api)
enableAutoUnmount(afterEach)
const payload = { topicValue: 12, literatureTheory: 12, methodology: 16, innovation: 20, writingStandards: 8,
  resultsWorkload: 12, recommendation: '建议通过', strengths: '', overallComment: '相同历史评语', issues: '问题', revisionAdvice: '建议' }
const report = { payload_hash: 'a'.repeat(64), rule_version: 'v2:corpus-fingerprint', checked_at: '2026-10-13T00:00:00Z', status: 'COMPLETE',
  coverage: { dictionary_version: 'v2', dictionary_entries: 0, description: '规则提示' },
  similarity: { status: 'COMPLETE', hit_count: 2, max_similarity: 1, metric: 'character_3gram_jaccard', threshold: .85, rule_version: 'own-history-v1', fingerprint: 'b'.repeat(64), matches: [],
    coverage: { window_days: 365, limit: 200, examined: 200, truncated: true } },
  findings: [{ code: 'OWN_HISTORY_SIMILARITY', field: 'overallComment', start: 0, end: 6, severity: 'WARN', message: '本人历史相似片段', suggestion: null }] }
beforeEach(() => { vi.resetAllMocks(); api.getReviewChecks.mockResolvedValue(report) })
function panel() { return mount(ReviewCheckPanel, { props: { target: { kind: 'task', id: 'owned' }, payload } }) }
it('shows own-history coverage, metric and current text without source navigation', async () => {
  const wrapper = panel()
  await wrapper.get('[data-action="check-comments"]').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('本人历史评语范围内相似性提示')
  expect(wrapper.text()).toContain('365')
  expect(wrapper.text()).toContain('200')
  expect(wrapper.text()).toContain('超过上限')
  expect(wrapper.text()).toContain('Jaccard')
  expect(wrapper.find('a').exists()).toBe(false)
  expect(wrapper.find('mark').text()).toBe('相同历史评语')
  await wrapper.get('input[data-check-code="OWN_HISTORY_SIMILARITY"]').setValue(true)
  expect(wrapper.emitted('ack')!.at(-1)![0]).toMatchObject({ rule_version: 'v2:corpus-fingerprint', codes: ['OWN_HISTORY_SIMILARITY'] })
  await wrapper.setProps({ payload: { ...payload, overallComment: '修改后的评语' } })
  expect(wrapper.emitted('ack')!.at(-1)![0]).toBeNull()
})
it('distinguishes no history and insufficient text, never displaying a quality pass', async () => {
  api.getReviewChecks.mockResolvedValue({ ...report, findings: [], similarity: { ...report.similarity, status: 'NO_HISTORY', hit_count: 0, max_similarity: 0, coverage: { ...report.similarity.coverage, examined: 0, truncated: false } } })
  const wrapper = panel()
  await wrapper.get('[data-action="check-comments"]').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('没有可比较的本人历史评语')
  expect(wrapper.text()).not.toContain('全平台查重通过')
  api.getReviewChecks.mockResolvedValue({ ...report, findings: [], similarity: { ...report.similarity, status: 'INSUFFICIENT_TEXT' } })
  await wrapper.get('[data-action="check-comments"]').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('不足20个字符')
})
it('fails closed when similarity fails and allows retry', async () => {
  api.getReviewChecks.mockRejectedValueOnce(new Error('相似性检查暂不可用'))
  const wrapper = panel()
  await wrapper.get('[data-action="check-comments"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('相似性检查暂不可用')
  expect(wrapper.emitted('ack')!.at(-1)![0]).toBeNull()
  await wrapper.get('[data-action="check-comments"]').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('本人历史评语范围内相似性提示')
})
