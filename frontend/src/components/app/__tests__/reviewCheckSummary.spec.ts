import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ReviewCheckSummary from '../ReviewCheckSummary.vue'

describe('ReviewCheckSummary (F1 · A7 / A8)', () => {
  it('shows when the expert confirmed in Beijing time and keeps the rule id out of the text', () => {
    const wrapper = mount(ReviewCheckSummary, {
      props: {
        summary: {
          rule_version: 'review-checks-v2:pilot-single-v1:892b3554a90d4b36:84481475',
          codes: ['SHORT_OVERALL'],
          counts: { SHORT_OVERALL: 1 },
          confirmed_at: '2026-11-05T02:57:23Z',
        },
      },
    })
    expect(wrapper.text()).toContain('专家确认于 2026/11/5 10:57:23')
    expect(wrapper.text()).not.toContain('review-checks-v2')
    expect(wrapper.get('small').attributes('title')).toBe('规则 review-checks-v2:pilot-single-v1:892b3554a90d4b36:84481475')
  })
})
