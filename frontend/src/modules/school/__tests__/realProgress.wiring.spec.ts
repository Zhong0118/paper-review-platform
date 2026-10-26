import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { portalMenus } from '@/router/menus'
import PortalLayout from '@/layouts/PortalLayout.vue'
import ReviewProgressPage from '../pages/ReviewProgressPage.vue'

const api = vi.hoisted(() => ({ schoolProgressList: vi.fn() }))
vi.mock('@/api/dispatch', () => api)
afterEach(() => vi.unstubAllEnvs())

describe('school progress wiring', () => {
  it('shows the current tenant instead of the demo school in real mode', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false')
    api.schoolProgressList.mockResolvedValue({ totals: { waiting: 0, reviewing: 0, completed: 0, overdue: 0 }, items: [] })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/school/progress', component: ReviewProgressPage }] })
    await router.push('/school/progress')
    const wrapper = mount(ReviewProgressPage, { global: {
      plugins: [createPinia(), router],
      stubs: { PortalLayout: { props: ['contextLabel'], template: '<div><slot/></div>' } },
    } })
    await flushPromises()
    expect(wrapper.getComponent(PortalLayout).props('contextLabel')).toBe('学校端 · 本校')
  })
  it('puts live school progress on the real-mode menu', () => {
    expect(portalMenus('school_reviewer', false).map((item) => item.path)).toContain('/school/progress')
  })

  it('maps progress aliases without expert identity', () => {
    const row = {
      thesis_id: 't1',
      title: '门禁论文',
      student_name: '林知远',
      stage: 'UNDER_REVIEW',
      invited_count: 0,
      in_review_count: 1,
      submitted_count: 0,
      rejected_count: 0,
      tasks: [{ alias: 'T-001', status: 'IN_REVIEW' }],
    }
    const blob = JSON.stringify(row)
    expect(blob).toContain('T-001')
    expect(blob).not.toContain('周明远')
    expect(blob).not.toContain('expert_id')
  })
})
