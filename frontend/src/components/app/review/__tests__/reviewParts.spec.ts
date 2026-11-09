import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ReviewOpinion from '../ReviewOpinion.vue'
import ReviewVerdict from '../ReviewVerdict.vue'

describe('ReviewVerdict (P1-1)', () => {
  it('shows outcome, total and the recommendation when given', () => {
    const wrapper = mount(ReviewVerdict, { props: { outcome: { code: 'PASS', label: '通过' }, total: 86, maxTotal: 100, recommendation: '建议通过' } })
    expect(wrapper.get('[data-outcome]').text()).toBe('通过')
    expect(wrapper.get('[data-outcome]').attributes('data-tone')).toBe('success')
    expect(wrapper.get('[data-total]').text()).toBe('86')
    expect(wrapper.text()).toContain('/ 100')
    expect(wrapper.text()).toContain('专家建议')
    expect(wrapper.text()).toContain('建议通过')
  })
  it('explains the revision band and maps fail to danger', () => {
    const revision = mount(ReviewVerdict, { props: { outcome: { code: 'REVISION_REQUIRED', label: '修改后通过' }, total: 70, maxTotal: 100 } })
    expect(revision.get('[data-outcome]').attributes('data-tone')).toBe('warning')
    expect(revision.text()).toContain('不代表已经验收修改稿')
    expect(revision.text()).not.toContain('专家建议')
    const fail = mount(ReviewVerdict, { props: { outcome: { code: 'FAIL', label: '不通过' }, total: 40, maxTotal: 100 } })
    expect(fail.get('[data-outcome]').attributes('data-tone')).toBe('danger')
  })
  it('shows the reviewer count only when given (G1-2)', () => {
    const without = mount(ReviewVerdict, { props: { outcome: { code: 'PASS', label: '通过' }, total: 80, maxTotal: 100 } })
    expect(without.find('[data-reviewer-count]').exists()).toBe(false)
    const withCount = mount(ReviewVerdict, { props: { outcome: { code: 'PASS', label: '通过' }, total: 80, maxTotal: 100, reviewerCount: 2 } })
    expect(withCount.get('[data-reviewer-count]').text()).toBe('2 位匿名专家')
  })
  it('uses a custom recommendation label and leaves out the badge without an outcome', () => {
    const wrapper = mount(ReviewVerdict, { props: { outcome: null, total: 50, maxTotal: 100, recommendation: '', recommendationLabel: '评阅建议' } })
    expect(wrapper.find('[data-outcome]').exists()).toBe(false)
    expect(wrapper.text()).toContain('评阅建议')
    expect(wrapper.text()).toContain('未填写')
  })
})

describe('ReviewOpinion (P1-1)', () => {
  const sections = [
    { key: 'overall', heading: '总体评价', text: '结构完整', missing: '未填写总体评价。' },
    { key: 'issues', heading: '主要问题', text: '   ', missing: '未填写主要问题。' },
    { key: 'advice', heading: '修改建议', text: '补充对照', missing: '未填写修改建议。' },
  ]
  const scores = [
    { key: 'a', label: '选题价值', score: 12, max: 15 },
    { key: 'b', label: '创新性', score: 30, max: 25, note: '超出满分只是测试' },
    { key: 'c', label: '空规则', score: 0, max: 0 },
  ]

  it('lists sections in order and boxes the missing ones', () => {
    const wrapper = mount(ReviewOpinion, { props: { sections, scores } })
    const heads = wrapper.findAll('[data-section] h4').map((h) => h.text())
    expect(heads).toEqual(['总体评价', '主要问题', '修改建议'])
    expect(wrapper.get('[data-section="issues"] [data-missing]').text()).toBe('未填写主要问题。')
    expect(wrapper.get('[data-advice]').text()).toContain('补充对照')
    expect(wrapper.find('[data-section="overall"] [data-missing]').exists()).toBe(false)
  })
  it('draws scores as a table without bars, after the sections by default and before them with scoresFirst (G1-1)', () => {
    const plainScores = scores.map(({ note: _note, ...rest }) => rest)
    const after = mount(ReviewOpinion, { props: { sections, scores: plainScores } })
    expect(after.html().indexOf('data-scores')).toBeGreaterThan(after.html().indexOf('data-section="advice"'))
    expect(after.get('[data-scores] h4').classes()).not.toContain('sr-only')
    const wrapper = mount(ReviewOpinion, { props: { sections, scores: plainScores, scoresFirst: true } })
    expect(wrapper.find('[data-score-fill]').exists()).toBe(false)
    const table = wrapper.get('[data-scores] table')
    expect(table.attributes('data-layout')).toBe('row')
    expect(table.findAll('thead th').map((t) => t.text())).toEqual(['选题价值', '创新性', '空规则'])
    expect(wrapper.get('[data-score-value="a"]').text()).toBe('12 / 15')
    expect(wrapper.get('[data-score-value="b"]').text()).toBe('30 / 25')
    const html = wrapper.html()
    expect(html.indexOf('data-scores')).toBeLessThan(html.indexOf('data-section="overall"'))
  })
  it('switches to a column table when any score has a note (G1-1)', () => {
    const wrapper = mount(ReviewOpinion, { props: { sections, scores } })
    const table = wrapper.get('[data-scores] table')
    expect(table.attributes('data-layout')).toBe('column')
    expect(table.findAll('thead th').map((t) => t.text())).toEqual(['维度', '得分', '分项评价'])
    expect(wrapper.get('[data-score-value="a"]').text()).toBe('12 / 15')
    expect(wrapper.findAll('tbody tr')).toHaveLength(3)
  })
  it('uses the column table for more than six dimensions (G1-1)', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ key: `k${i}`, label: `维度${i}`, score: i, max: 10 }))
    const wrapper = mount(ReviewOpinion, { props: { sections, scores: many } })
    expect(wrapper.get('[data-scores] table').attributes('data-layout')).toBe('column')
    expect(wrapper.get('[data-scores] thead').text()).not.toContain('分项评价')
  })
  it('shows score notes and the scores caption only when given', () => {
    const plain = mount(ReviewOpinion, { props: { sections, scores } })
    expect(plain.find('[data-score-note]').text()).toBe('超出满分只是测试')
    expect(plain.find('[data-scores-caption]').exists()).toBe(false)
    const captioned = mount(ReviewOpinion, { props: { sections, scores, scoresCaption: '只显示各项得分。' } })
    expect(captioned.get('[data-scores-caption]').text()).toBe('只显示各项得分。')
  })
})
