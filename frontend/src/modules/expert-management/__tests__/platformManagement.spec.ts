import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import { scenarioServiceKey } from '@/demo/serviceProvider'
import type { StorageLike } from '@/demo/types'

import CorrectionApprovalPage from '@/modules/expert-management/pages/CorrectionApprovalPage.vue'
import SettlementWorkbenchPage from '@/modules/finance/pages/SettlementWorkbenchPage.vue'

enableAutoUnmount(afterEach)

function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

async function mountPage(
  component: typeof CorrectionApprovalPage | typeof SettlementWorkbenchPage,
) {
  const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
  await service.loadPlatformScenario('CORRECTION_PENDING')
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component }],
  })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(component, {
    global: {
      plugins: [createPinia(), router],
      provide: { [scenarioServiceKey as symbol]: service },
    },
  })
  await flushPromises()
  return wrapper
}

describe('platform management workbenches', () => {
  it('reviews correction requests as immutable result versions', async () => {
    const wrapper = await mountPage(CorrectionApprovalPage)

    // 待审批更正申请列表可读；打开详情展示原评阅版本（只读 Diff）与版本历史
    expect(wrapper.findAll('[data-correction-request]').length).toBeGreaterThan(0)
    await wrapper.get('[data-correction-request] [data-action="open-correction-detail"]').trigger('click')
    expect(wrapper.text()).toContain('原评阅版本')
    expect(wrapper.text()).toContain('版本历史')
    // 版本不可被覆盖：新旧版本均只读保留
    expect(wrapper.text()).not.toContain('覆盖原结果')
  })

  it('keeps expert settlement separate from school quota', async () => {
    const wrapper = await mountPage(SettlementWorkbenchPage)

    // 结算工作台展示专家提现（可提现余额依据 + 线下付款回填），不混入学校配额
    expect(wrapper.text()).toContain('可提现余额')
    expect(wrapper.text()).toContain('线下付款回填')
    expect(wrapper.text()).toContain('¥ 300.00')
    expect(wrapper.text()).not.toContain('学校可用额度')
  })
})
