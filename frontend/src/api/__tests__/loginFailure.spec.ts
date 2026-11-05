/** 登录请求本身的 401（用户名或密码错误）不能触发“会话失效→整页跳回 /login”，否则登录页上的提示会被刷掉。 */
import type { InternalAxiosRequestConfig } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const message = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('element-plus', () => ({ ElMessage: message }))

import http from '../request'
import LoginPage from '@/modules/auth/pages/LoginPage.vue'
import { useAuthStore } from '@/stores/auth'

const unauthorized = (text: string) => async (config: InternalAxiosRequestConfig) => {
  const response = { data: { code: 'AUTH_REQUIRED', message: text }, status: 401, statusText: 'Unauthorized', headers: {}, config }
  throw Object.assign(new Error('Request failed with status code 401'), { isAxiosError: true, response, config })
}

beforeEach(() => {
  setActivePinia(createPinia())
  sessionStorage.clear()
  message.error.mockReset()
})

describe('login failure', () => {
  it('keeps the session handling for other 401s but not for the login request itself', async () => {
    const auth = useAuthStore()
    const clear = vi.spyOn(auth, 'clearSession')
    await http.post('/auth/login', {}, { adapter: unauthorized('用户名或密码错误') }).catch(() => undefined)
    expect(clear).not.toHaveBeenCalled()
    await http.get('/school-review/theses', { adapter: unauthorized('会话已失效') }).catch(() => undefined)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('shows the server message on the login page and stays there', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/login', component: { template: '<div />' } }, { path: '/:rest(.*)*', component: { template: '<div />' } }] })
    await router.push('/login')
    await router.isReady()
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    vi.spyOn(auth, 'loginWithPassword').mockImplementation(() => http.post('/auth/login', {}, { adapter: unauthorized('用户名或密码错误') }) as never)
    const wrapper = mount(LoginPage, { props: { demoMode: false }, global: { plugins: [pinia, router] } })
    await wrapper.get('input[autocomplete="username"]').setValue('school.wang')
    await wrapper.get('input[autocomplete="current-password"]').setValue('not-the-password')
    await wrapper.get('#login-panel-platform').trigger('submit')
    await flushPromises()
    expect(wrapper.get('.login-form__notice').text()).toBe('用户名或密码错误')
    expect(router.currentRoute.value.path).toBe('/login')
  })
})
