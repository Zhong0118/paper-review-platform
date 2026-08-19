import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import { scenarioServiceKey } from '@/demo/serviceProvider'
import PreparationListPage from '../pages/PreparationListPage.vue'

async function mountPage() {
  const service = createScenarioService()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/school/preparation', component: PreparationListPage }],
  })
  await router.push('/school/preparation')
  await router.isReady()
  const wrapper = mount(PreparationListPage, {
    global: {
      plugins: [createPinia(), router],
      provide: { [scenarioServiceKey as symbol]: service },
    },
  })
  await flushPromises()
  return { service, wrapper }
}

describe('school thesis intake', () => {
  it('submits a paper for a synced student without student confirmation', async () => {
    const { service, wrapper } = await mountPage()
    const beforeCount = (await service.listSchoolTheses()).length

    await wrapper.get('button[data-action="open-school-submission"]').trigger('click')
    await wrapper.get('button[data-action="confirm-school-submission"]').trigger('click')
    await flushPromises()

    const rows = await service.listSchoolTheses()
    expect(rows).toHaveLength(beforeCount + 1)
    expect(rows.at(-1)).toEqual(
      expect.objectContaining({ submissionSource: 'SCHOOL_MANUAL', stage: 'SUBMITTED' }),
    )
    expect(wrapper.text()).toContain('学校可直接提交，无需学生再次确认')
    expect(wrapper.text()).toContain('学校可继续处理')
  })

  it('shows four batch validation states without leaking expert identity', async () => {
    const { wrapper } = await mountPage()

    await wrapper.get('button[data-action="open-batch-preview"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[data-import-status]')).toHaveLength(4)
    expect(wrapper.text()).toContain('有效')
    expect(wrapper.text()).toContain('重复记录')
    expect(wrapper.text()).toContain('未知专业')
    expect(wrapper.text()).toContain('缺少文件')
    expect(wrapper.text()).toContain('演示数据，不执行真实 Excel 写入')
    expect(wrapper.text()).not.toContain('周明远')
  })
})
