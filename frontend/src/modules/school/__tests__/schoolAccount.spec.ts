import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import { scenarioServiceKey } from '@/demo/serviceProvider'

import SchoolAccountPage from '../pages/SchoolAccountPage.vue'

describe('school account page', () => {
  it('shows the frozen review bill without exposing expert identity', async () => {
    const service = createScenarioService()
    await service.submitThesis()
    await service.confirmAnonymization()
    await service.confirmDispatch()
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/school/account', component: SchoolAccountPage }],
    })
    await router.push('/school/account')
    await router.isReady()

    const wrapper = mount(SchoolAccountPage, {
      global: {
        plugins: [router],
        provide: { [scenarioServiceKey as symbol]: service },
        stubs: { AppHeader: true },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(wrapper.get('[data-account="available"]').text()).toContain('11,700')
    expect(wrapper.get('[data-account="frozen"]').text()).toContain('300')
    expect(wrapper.get('[data-bill-id="bill-hy-2026-0042"]').text()).toContain('额度已冻结')
    expect(wrapper.text()).toContain('HY-2026-0042')
    expect(wrapper.text()).not.toContain('周明远')
  })
})
