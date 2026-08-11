import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import { scenarioServiceKey } from '@/demo/serviceProvider'
import type { ScenarioService, StorageLike } from '@/demo/types'

import ExpertLibraryPage from '../pages/ExpertLibraryPage.vue'

enableAutoUnmount(afterEach)

function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

async function mountWorkbench(service: ScenarioService = createScenarioService({ demoMode: true })) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/platform/experts', component: ExpertLibraryPage },
      { path: '/platform/dispatch', component: { template: '<div>送审运营台</div>' } },
    ],
  })
  await router.push('/platform/experts')
  await router.isReady()
  const wrapper = mount(
    { template: '<RouterView />', components: { RouterView } },
    {
      attachTo: document.body,
      global: {
        plugins: [createPinia(), router],
        provide: { [scenarioServiceKey as symbol]: service },
      },
    },
  )
  await flushPromises()
  return { router, service, wrapper }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('platform expert library workbench', () => {
  it('lists profiles, filters, and pauses/resumes with confirmation', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const setStatusSpy = vi.spyOn(service, 'setExpertServiceStatus')
    const { wrapper } = await mountWorkbench(service)

    expect(wrapper.findAll('tr')).toHaveLength(4) // 3 fixture experts + header

    await wrapper.get('[data-filter="service-status"]').setValue('ACTIVE')
    expect(wrapper.findAll('tr')).toHaveLength(4) // 全部初始均为 ACTIVE

    await wrapper.get('[data-filter="service-status"]').setValue('')
    await wrapper.get('[data-filter="qualification"]').setValue('APPROVED')
    expect(wrapper.findAll('tr')).toHaveLength(3) // 顾远航 + 宋清和 + 表头

    await wrapper.get('[data-filter="qualification"]').setValue('')
    await wrapper.get('[data-action="pause-expert"]').trigger('click')
    await wrapper.get('[data-action="confirm-pause"]').trigger('click')
    await flushPromises()
    expect(setStatusSpy).toHaveBeenCalledWith(
      expect.any(String),
      'DISABLED',
      expect.any(String),
    )
  })

  it('renders the five statistics cards and the toolbar', async () => {
    const { wrapper } = await mountWorkbench()

    expect(wrapper.get('[data-stat="total"]').text()).toContain('3')
    expect(wrapper.get('[data-stat="dispatchable"]').text()).toContain('2')
    expect(wrapper.get('[data-stat="qualification-review"]').text()).toContain('1')
    expect(wrapper.get('[data-stat="expiring"]').text()).toContain('0')
    expect(wrapper.get('[data-stat="disabled"]').text()).toContain('0')

    expect(wrapper.get('[data-action="create-expert"]').exists()).toBe(true)
    expect(wrapper.get('[data-action="batch-import"]').exists()).toBe(true)
  })

  it('creates a new expert from the toolbar form and shows it in the library', async () => {
    const { wrapper } = await mountWorkbench()

    await wrapper.get('[data-action="create-expert"]').trigger('click')
    expect(wrapper.get('[data-expert-form]').exists()).toBe(true)

    await wrapper.get('[data-field="name"]').setValue('林晚晴')
    await wrapper.get('[data-field="unit"]').setValue('东江理工大学')
    await wrapper.get('[data-field="title"]').setValue('副教授')
    await wrapper.get('[data-field="discipline"]').setValue('软件工程')
    await wrapper.get('[data-field="research-tags"]').setValue('可信软件, 程序分析')
    await wrapper.get('[data-form-action="save-expert"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('林晚晴')
    expect(wrapper.findAll('tr')).toHaveLength(5)
    expect(wrapper.find('[data-expert-form]').exists()).toBe(false)
    expect(wrapper.text()).toContain('已新增专家')
  })

  it('requires a reason before a qualification rejection can be confirmed', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const reviewSpy = vi.spyOn(service, 'reviewExpertQualification')
    const { wrapper } = await mountWorkbench(service)

    await wrapper.get('[data-action="reject-qualification"]').trigger('click')

    const confirm = wrapper.get('[data-action="confirm-qualification-reject"]')
    expect(confirm.attributes('disabled')).toBeDefined()
    expect(reviewSpy).not.toHaveBeenCalled()

    await wrapper.get('textarea[name="qualificationReason"]').setValue('学科方向不符')
    expect(confirm.attributes('disabled')).toBeUndefined()

    await confirm.trigger('click')
    await flushPromises()
    expect(reviewSpy).toHaveBeenCalledWith(expect.any(String), 'REJECTED', '学科方向不符')
  })

  it('switches all six detail drawer tabs with projection data', async () => {
    const { wrapper } = await mountWorkbench()

    await wrapper.get('[data-action="view-profile"]').trigger('click')

    const tabs = ['basic', 'qualification', 'avoidance', 'history', 'fees', 'audit']
    for (const tab of tabs) {
      await wrapper.get(`[data-drawer-tab="${tab}"]`).trigger('click')
      expect(wrapper.get(`[data-drawer-panel="${tab}"]`).exists()).toBe(true)
    }

    expect(wrapper.get('[data-drawer-panel="basic"]').text()).toContain('周明远')
    expect(wrapper.get('[data-drawer-panel="qualification"]').text()).toContain('审核中')
    expect(wrapper.get('[data-drawer-panel="avoidance"]').text()).toContain('回避学校')
    expect(wrapper.get('[data-drawer-panel="history"]').text()).toContain('46')
    expect(wrapper.get('[data-drawer-panel="fees"]').text()).toContain('300')
    expect(wrapper.get('[data-drawer-panel="audit"]').text()).toContain('周明远')
  })

  it('renders profiles as mobile cards below the 900px breakpoint', async () => {
    vi.stubGlobal('innerWidth', 390)
    const { wrapper } = await mountWorkbench()

    const cards = wrapper.findAll('[data-expert-card]')
    expect(cards).toHaveLength(3)
    expect(wrapper.findAll('tr')).toHaveLength(0)
    expect(wrapper.find('.expert-library-table__desktop').exists()).toBe(false)
    expect(wrapper.find('.expert-library-table__mobile').exists()).toBe(true)
    expect(wrapper.get('[data-expert-card="expert-17"]').text()).toContain('周明远')
  })
})
