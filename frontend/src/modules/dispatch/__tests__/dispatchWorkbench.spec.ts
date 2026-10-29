import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import { scenarioServiceKey } from '@/demo/serviceProvider'
import DispatchWorkbenchPage from '../pages/DispatchWorkbenchPage.vue'

async function mountDispatch(service = createScenarioService()) {
  await service.submitThesis()
  await service.confirmAnonymization()
  await service.confirmDispatch()
  // 装载待派场景：候选专家包含 eligible / conflicted / secondary 三类行
  await service.loadPlatformScenario('PENDING_DISPATCH')
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/platform/dispatch', component: DispatchWorkbenchPage }],
  })
  await router.push('/platform/dispatch')
  await router.isReady()
  const wrapper = mount(DispatchWorkbenchPage, {
    global: {
      plugins: [createPinia(), router],
      stubs: { TransitionGroup: false },
      provide: { [scenarioServiceKey as symbol]: service },
    },
  })
  await flushPromises()
  return wrapper
}

describe('dispatch workbench', () => {
  it('blocks conflicts, shows read-only fee snapshot and creates tasks once', async () => {
    const service = createScenarioService()
    await service.submitThesis()
    await service.confirmAnonymization()
    await service.confirmDispatch()
    // 装载待派场景：候选专家包含 eligible / conflicted / secondary 三类行
    await service.loadPlatformScenario('PENDING_DISPATCH')
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/platform/dispatch', component: DispatchWorkbenchPage }],
    })
    await router.push('/platform/dispatch')
    await router.isReady()
    const wrapper = mount(DispatchWorkbenchPage, {
      global: {
        plugins: [createPinia(), router],
        stubs: { TransitionGroup: false },
        provide: { [scenarioServiceKey as symbol]: service },
      },
    })
    await flushPromises()

    expect(wrapper.get('h1').text()).toBe('送审运营台')
    expect(wrapper.findAll('[data-operations-queue]')).toHaveLength(10)
    expect(wrapper.get('[data-expert-id="expert-08"] input').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('0812 · 计算机科学与技术')
    expect(wrapper.text()).toContain('知识图谱')
    expect(wrapper.get('[data-fee-rule]').text()).toContain('¥ 300.00')
    expect(wrapper.text()).toContain('接单率')
    expect(wrapper.text()).toContain('按时完成率')
    expect(wrapper.find('input[data-field="fee"]').exists()).toBe(false)

    await wrapper.get('[data-expert="eligible"] input').setValue(true)
    await wrapper.get('[data-expert="secondary"] input').setValue(true)
    expect(wrapper.findAll('tbody input:checked')).toHaveLength(1)
    await wrapper.get('button[data-action="assign-experts"]').trigger('click')
    // 二次确认：确认对话框出现，指派在确认后生效
    await wrapper.get('[data-action="confirm-assign"]').trigger('click')
    await flushPromises()

    const snapshot = await service.loginAs('platform_reviewer')
    expect(snapshot.thesis.stage).toBe('UNDER_REVIEW')
    expect(snapshot.thesis.taskStatus).toBe('INVITED')
    expect(wrapper.get('button[data-action="assign-experts"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('已生成 1 个评审任务')
  })

  it('renders candidate experts as mobile cards below the 900px breakpoint', async () => {
    // 浏览器回归（Task 11 视觉验收）：390px 视口下候选专家宽表未卡片化，
    // 只能通过 76rem 宽表的容器内横向滚动查看；与专家库/任务列表的断点卡片一致。
    vi.stubGlobal('innerWidth', 390)
    const wrapper = await mountDispatch()

    expect(wrapper.findAll('tbody tr')).toHaveLength(0)
    expect(wrapper.findAll('[data-candidate-card]').length).toBeGreaterThan(0)
    const card = wrapper.get('[data-candidate-card="expert-26"]')
    expect(card.text()).toContain('陈知微')
    expect(card.text()).toContain('西湖工业大学')
    // 卡片视图保留选择与回避禁用：冲突候选在卡片上同样不可勾选
    expect(
      wrapper.get('[data-candidate-card="expert-08"] input').attributes('disabled'),
    ).toBeDefined()
  })
})
