import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it } from 'vitest'

import LoginPage from '../pages/LoginPage.vue'
import { useAuthStore } from '@/stores/auth'

describe('LoginPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('only presents persona shortcuts in demo mode', () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    const demo = mount(LoginPage, {
      props: { demoMode: true },
      global: { plugins: [createPinia(), router] },
    })
    const production = mount(LoginPage, {
      props: { demoMode: false },
      global: { plugins: [createPinia(), router] },
    })

    expect(demo.get('[aria-label="演示角色入口"]').exists()).toBe(true)
    expect(production.find('[aria-label="演示角色入口"]').exists()).toBe(false)
  })

  it('starts an expert demo session and enters the expert task page', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div />' } },
        { path: '/expert/tasks', component: { template: '<div>专家任务</div>' } },
      ],
    })
    await router.push('/')
    await router.isReady()
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(LoginPage, {
      props: { demoMode: true },
      global: { plugins: [pinia, router] },
    })

    await wrapper.get('button[data-demo-role="expert"]').trigger('click')
    await flushPromises()

    expect(useAuthStore().user?.role).toBe('expert')
    expect(router.currentRoute.value.path).toBe('/expert/tasks')
  })

  it('provides platform, school identity and invitation activation channels', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    const wrapper = mount(LoginPage, {
      props: { demoMode: false },
      global: { plugins: [createPinia(), router] },
    })

    expect(wrapper.get('[role="tablist"]').text()).toContain('平台账号')
    expect(wrapper.get('[role="tablist"]').text()).toContain('学校统一认证')
    expect(wrapper.get('[role="tablist"]').text()).toContain('激活受邀账号')

    await wrapper.get('[data-login-channel="school"]').trigger('click')
    const continueButton = wrapper.get('[data-action="continue-school-sso"]')
    expect(continueButton.attributes('disabled')).toBeDefined()

    await wrapper.get('input[name="school-code"]').setValue('10001')
    expect(continueButton.attributes('disabled')).toBeUndefined()

    await wrapper.get('#login-panel-school form').trigger('submit')
    expect(wrapper.get('[role="status"]').text()).toContain('真实学校统一身份认证尚未接入')
  })

  it('shows invitation details without pretending an account was created', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    const wrapper = mount(LoginPage, {
      props: { demoMode: false },
      global: { plugins: [createPinia(), router] },
    })

    await wrapper.get('[data-login-channel="activation"]').trigger('click')
    await wrapper.get('input[name="invitation-code"]').setValue('BJ-2026-EXPERT')
    await wrapper.get('#login-panel-activation form').trigger('submit')

    expect(wrapper.text()).toContain('评审专家')
    expect(wrapper.text()).toContain('百杰校审平台')
    expect(wrapper.text()).toContain('z***@example.edu.cn')

    await wrapper.get('input[autocomplete="new-password"]').setValue('demo-pass-2026')
    await wrapper.get('[data-action="activate-account"]').trigger('click')
    expect(wrapper.get('[role="status"]').text()).toContain('账号激活接口尚未接入')
  })
})
