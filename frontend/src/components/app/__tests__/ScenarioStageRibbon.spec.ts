import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ScenarioStageRibbon from '../ScenarioStageRibbon.vue'

describe('ScenarioStageRibbon', () => {
  it('shows thesis, task, and billing progress without merging their states', () => {
    const wrapper = mount(ScenarioStageRibbon, {
      props: {
        stage: 'UNDER_REVIEW',
        taskStatus: 'IN_REVIEW',
        billStatus: 'FROZEN',
      },
    })

    expect(wrapper.get('[data-stage="UNDER_REVIEW"]').text()).toContain('送审中')
    expect(wrapper.get('[data-task-status="IN_REVIEW"]').text()).toContain('评阅中')
    expect(wrapper.get('[data-bill-status="FROZEN"]').text()).toContain('额度已冻结')
  })
})
