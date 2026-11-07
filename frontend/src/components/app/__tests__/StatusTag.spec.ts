import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import StatusTag from '../StatusTag.vue'

describe('StatusTag', () => {
  it('keeps the workflow state visible when the item is overdue', () => {
    const wrapper = mount(StatusTag, {
      props: {
        status: 'IN_REVIEW',
        overdue: true,
      },
    })

    expect(wrapper.get('[data-status="IN_REVIEW"]').text()).toContain('评阅中')
    expect(wrapper.get('[data-overdue="true"]').text()).toBe('已逾期')
  })

  it('uses the supplied label without losing the status code', () => {
    const wrapper = mount(StatusTag, {
      props: {
        status: 'REVIEW_REQUIRED',
        label: '需要人工复核',
      },
    })

    expect(wrapper.get('[data-status="REVIEW_REQUIRED"]').text()).toBe('需要人工复核')
    expect(wrapper.find('[data-overdue="true"]').exists()).toBe(false)
  })
})
