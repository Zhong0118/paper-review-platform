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

async function mountLibrary(service: ScenarioService = createScenarioService({ demoMode: true })) {
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

describe('platform expert library (PAGE-006)', () => {
  it('lists qualification, service, load, acceptance, and on-time completion fields', async () => {
    const { wrapper } = await mountLibrary()

    // 专家档案列表渲染全部 3 条演示档案（fixture 专家库，非派单场景专家）
    expect(wrapper.findAll('[data-expert-profile]')).toHaveLength(3)

    // 表头按设计列展示：资格 / 服务状态 / 当前负载 / 历史接受率 / 按时完成率
    const header = wrapper.get('.expert-library-table thead')
    expect(header.text()).toContain('资格')
    expect(header.text()).toContain('服务状态')
    expect(header.text()).toContain('当前负载')
    expect(header.text()).toContain('历史接受率')
    expect(header.text()).toContain('按时完成率')

    // 行内投影值：资格标签、服务标签、负载/接受率/按时率数据来自服务投影
    const row = wrapper.get('[data-expert-profile="expert-17"]')
    expect(row.text()).toContain('周明远')
    expect(row.text()).toContain('资格审核中')
    expect(row.text()).toContain('可接单')
    expect(row.text()).toContain('2 项')
    expect(row.text()).toContain('94%')
    expect(row.text()).toContain('97%')
  })

  it('opens the dispatch workbench with the expert preselected from the library row', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const { router, wrapper } = await mountLibrary(service)

    // 行内「指派论文」入口由服务端允许动作驱动（SET_SERVICE_STATUS 专家可派单）
    await wrapper.get('[data-action="dispatch-expert"]').trigger('click')
    await flushPromises()

    // 跳转送审运营台并携带该专家 ID（跨页联动数据来自行投影，非测试自造）
    expect(router.currentRoute.value.path).toBe('/platform/dispatch')
    expect(router.currentRoute.value.query.expertId).toBe('expert-17')
    expect(wrapper.text()).toContain('送审运营台')
  })
})
