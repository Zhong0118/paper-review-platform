import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LoginPage from '../pages/LoginPage.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('@/api/auth', () => ({
  loginWithPassword: vi.fn(async () => ({
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    token_type: 'bearer',
    expires_in: 1800,
    user: {
      id: 'u1',
      username: 'student.lin',
      display_name: '林知远',
      role: 'student',
      tenant_id: 't1',
      tenant_code: 'demo-univ',
    },
  })),
  logoutSession: vi.fn(),
  fetchMe: vi.fn(),
}))

describe('real login', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    sessionStorage.clear()
  })

  it('logs in with password API and stores session', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div />' } },
        { path: '/student/dashboard', component: { template: '<div>dashboard</div>' } },
      ],
    })
    await router.push('/')
    await router.isReady()
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(LoginPage, {
      props: { demoMode: false },
      global: { plugins: [pinia, router] },
    })

    await wrapper.get('input[autocomplete="username"]').setValue('student.lin')
    await wrapper.get('input[autocomplete="current-password"]').setValue('ChangeMe!dev-only')
    await wrapper.get('#login-panel-platform').trigger('submit')
    await flushPromises()

    expect(useAuthStore().user?.role).toBe('student')
    expect(sessionStorage.getItem('pr.access_token')).toBe('access-token')
    expect(router.currentRoute.value.path).toBe('/student/dashboard')
  })
})
