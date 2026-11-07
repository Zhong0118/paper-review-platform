import '@/__tests__/demoMode'
import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import { scenarioServiceKey } from '@/demo/serviceProvider'
import ReviewProgressPage from '../pages/ReviewProgressPage.vue'

describe('school dispatch gate', () => {
  it('blocks failed anonymization and sends a passed paper without expert identity', async () => {
    const service = createScenarioService()
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/school/progress', component: ReviewProgressPage }],
    })
    await router.push('/school/progress')
    await router.isReady()
    const wrapper = mount(ReviewProgressPage, {
      global: {
        plugins: [createPinia(), router],
        provide: { [scenarioServiceKey as symbol]: service },
      },
    })
    await flushPromises()

    expect(wrapper.get('[data-anonymization="FAIL"] button').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-anonymization="REVIEW_REQUIRED"]').text()).toContain('人工复核后处理')
    expect(wrapper.text()).not.toContain('周明远')

    await wrapper.get('[data-anonymization="PASS"] button').trigger('click')
    await flushPromises()

    const snapshot = await service.loginAs('school_reviewer')
    expect(snapshot.thesis.stage).toBe('READY_FOR_DISPATCH')
    expect(snapshot.thesis.billStatus).toBe('FROZEN')
    expect((await service.getSchoolAccount()).frozenAmount).toBe(300)
    expect(wrapper.text()).toContain('已确认送出，等待平台派单')
    expect(wrapper.get('[data-stage="READY_FOR_DISPATCH"]').text()).toContain('待送审')
    expect(wrapper.get('[data-bill-status="FROZEN"]').text()).toContain('额度已冻结')
  })
})
