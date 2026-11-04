import '@/__tests__/demoMode'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, type RouteComponent } from 'vue-router'
import { describe, expect, it } from 'vitest'

import { appRoutes } from '@/router/routes'

async function mountRegisteredPage(pageId: string, path: string) {
  const route = appRoutes.find((item) => item.meta?.pageId === pageId)
  const loader = route?.component as (() => Promise<{ default: RouteComponent }>) | undefined
  if (!loader) throw new Error(`missing lazy page ${pageId}`)
  const component = (await loader()).default
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path, component }] })
  await router.push(path)
  await router.isReady()
  return mount(component, {
    global: {
      plugins: [createPinia(), router],
      stubs: { AppHeader: true },
    },
  })
}

describe('school management pages', () => {
  it('shows the activated demo batch rule snapshot as a non-default rule', async () => {
    const wrapper = await mountRegisteredPage('PAGE-023', '/school/batch-rules')

    expect(wrapper.text()).toContain('DEMO-2026-SPRING-v1')
    expect(wrapper.text()).toContain('目标专家数 1')
    expect(wrapper.text()).toContain('单篇任务费用 ¥300')
    expect(wrapper.text()).toContain('仅当前演示批次')
    expect(wrapper.findAll('[data-score-rule]')).toHaveLength(6)
  })

  it('shows submitted, processing, and resolved objections without expert identity', async () => {
    const wrapper = await mountRegisteredPage('PAGE-019', '/school/objections')

    expect(wrapper.findAll('[data-objection-status]')).toHaveLength(3)
    expect(wrapper.text()).toContain('已提交')
    expect(wrapper.text()).toContain('处理中')
    expect(wrapper.text()).toContain('已办结')
    expect(wrapper.text()).not.toContain('周明远')
  })
})
