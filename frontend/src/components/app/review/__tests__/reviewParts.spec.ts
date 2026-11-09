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
  it('draws one bar style, proportional and capped at 100%', () => {
    const wrapper = mount(ReviewOpinion, { props: { sections, scores } })
    const fills = wrapper.findAll('[data-score-fill]')
    expect(fills).toHaveLength(3)
    expect(fills[0]!.attributes('style')).toContain('width: 80%')
    expect(fills[1]!.attributes('style')).toContain('width: 100%')
    expect(fills[2]!.attributes('style')).toContain('width: 0%')
    for (const fill of fills) expect(fill.classes()).toContain('bg-primary')
    expect(wrapper.findAll('[data-score-row]')[0]!.text()).toContain('12 / 15')
  })
  it('shows score notes and the scores caption only when given', () => {
    const plain = mount(ReviewOpinion, { props: { sections, scores } })
    expect(plain.find('[data-score-note]').text()).toBe('超出满分只是测试')
    expect(plain.find('[data-scores-caption]').exists()).toBe(false)
    const captioned = mount(ReviewOpinion, { props: { sections, scores, scoresCaption: '只显示各项得分。' } })
    expect(captioned.get('[data-scores-caption]').text()).toBe('只显示各项得分。')
  })
})
