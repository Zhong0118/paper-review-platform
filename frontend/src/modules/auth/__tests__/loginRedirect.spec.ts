import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, expect, it, vi } from 'vitest'

import LoginPage from '../pages/LoginPage.vue'
import { safeRedirect } from '../loginRedirect'

vi.mock('@/api/auth', () => ({
  loginWithPassword: vi.fn(async () => ({
    access_token: 'a', refresh_token: 'r', token_type: 'bearer', expires_in: 1800,
    user: { id: 'u1', username: 'school.wang', display_name: '王老师', role: 'school_reviewer', tenant_id: 't1', tenant_code: 'demo-univ' },
  })),
  logoutSession: vi.fn(),
  fetchMe: vi.fn(),
}))

const page = { template: '<div />' }
function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: LoginPage, meta: { roleCodes: [] } },
      { path: '/school/preparation', component: page, meta: { roleCodes: ['school_reviewer'] } },
      { path: '/student/dashboard', component: page, meta: { roleCodes: ['student'] } },
      { path: '/:pathMatch(.*)*', redirect: '/login' },
    ],
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  sessionStorage.clear()
})

it('accepts only an internal path the signed-in role may open', () => {
  const router = makeRouter()
  expect(safeRedirect(router, '/school/preparation?thesis=t1&view=verify', 'school_reviewer')).toBe('/school/preparation?thesis=t1&view=verify')
  expect(safeRedirect(router, '/student/dashboard', 'school_reviewer')).toBeNull()
  expect(safeRedirect(router, '//evil.example/x', 'school_reviewer')).toBeNull()
  expect(safeRedirect(router, 'https://evil.example/x', 'school_reviewer')).toBeNull()
  expect(safeRedirect(router, '/login?redirect=/x', 'school_reviewer')).toBeNull()
  expect(safeRedirect(router, '/no/such/page', 'school_reviewer')).toBeNull()
  expect(safeRedirect(router, ['/school/preparation'], 'school_reviewer')).toBeNull()
  expect(safeRedirect(router, undefined, 'school_reviewer')).toBeNull()
})

it('returns to the deep link after a password login, and falls back to the role home otherwise', async () => {
  const router = makeRouter()
  await router.push('/login?redirect=%2Fschool%2Fpreparation%3Fthesis%3Dt1')
  await router.isReady()
  const wrapper = mount(LoginPage, { props: { demoMode: false }, global: { plugins: [createPinia(), router] } })
  await wrapper.get('input[autocomplete="username"]').setValue('school.wang')
  await wrapper.get('input[autocomplete="current-password"]').setValue('fixture-only')
  await wrapper.get('#login-panel-platform').trigger('submit')
  await flushPromises()
  expect(router.currentRoute.value.fullPath).toBe('/school/preparation?thesis=t1')
})

it('ignores a redirect the role cannot open', async () => {
  const router = makeRouter()
  await router.push('/login?redirect=%2Fstudent%2Fdashboard')
  await router.isReady()
  const wrapper = mount(LoginPage, { props: { demoMode: false }, global: { plugins: [createPinia(), router] } })
  await wrapper.get('input[autocomplete="username"]').setValue('school.wang')
  await wrapper.get('input[autocomplete="current-password"]').setValue('fixture-only')
  await wrapper.get('#login-panel-platform').trigger('submit')
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/school/preparation')
})
