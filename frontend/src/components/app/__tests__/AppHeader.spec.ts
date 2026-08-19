import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import { useAuthStore } from '@/stores/auth'
import AppHeader from '../AppHeader.vue'

describe('AppHeader demo role switch', () => {
  it('returns to role selection through SPA navigation for demo sessions', async () => {
    const pinia = createPinia(); setActivePinia(pinia)
    useAuthStore().loginAsDemo('school_reviewer')
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/school/results', component: { template: '<div />' } },
      { path: '/login', component: { template: '<div />' } },
    ] })
    await router.push('/school/results'); await router.isReady()
    const wrapper = mount(AppHeader, { props: { demoMode: true }, global: { plugins: [pinia, router] } })

    await wrapper.get('[data-action="switch-demo-role"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/login')
  })
})
