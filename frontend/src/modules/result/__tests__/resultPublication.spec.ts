import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import { scenarioServiceKey } from '@/demo/serviceProvider'
import ResultProcessingPage from '../pages/ResultProcessingPage.vue'
import StudentResultPage from '../pages/StudentResultPage.vue'
import SupervisorResultPage from '../pages/SupervisorResultPage.vue'

async function mountPage(
  component: object,
  path: string,
  service: ReturnType<typeof createScenarioService>,
) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path, component }] })
  await router.push(path)
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

async function completeSingleExpertReview(service: ReturnType<typeof createScenarioService>) {
  await service.submitThesis()
  await service.confirmAnonymization()
  await service.confirmDispatch()
  await service.assignExperts()
  await service.acceptTask()
  await service.submitFinalReview({
    topicValue: 13,
    literatureTheory: 13,
    methodology: 17,
    innovation: 21,
    resultsWorkload: 13,
    writingStandards: 9,
    recommendation: '建议通过',
    strengths: '选题具有价值，研究路径完整。',
    issues: '对最新基线的比较仍需加强。',
    revisionAdvice: '补充消融实验与限制讨论。',
    overallComment: '论文结构完整，达到硕士学位论文要求。',
  })
}

describe('result publication', () => {
  it('keeps student results empty before publication', async () => {
    const service = createScenarioService()
    const studentBefore = await mountPage(StudentResultPage, '/student/results', service)

    expect(studentBefore.find('[data-result-row]').exists()).toBe(false)
    expect(studentBefore.text()).toContain('结果尚未发布')
    expect(studentBefore.findAll('[aria-label="流程进度"] > li')).toHaveLength(5)
    expect(studentBefore.find('[data-score-dimension]').exists()).toBe(false)
  })

  it('publishes anonymized results to school, student and supervisor', async () => {
    const service = createScenarioService()
    await completeSingleExpertReview(service)
    const school = await mountPage(ResultProcessingPage, '/school/results', service)
    expect(school.findAll('[data-result-row]')).toHaveLength(1)
    expect(school.get('[data-result-row]').text()).toContain('86')
    expect(school.text()).not.toContain('两份评阅意见')
    await school.get('button[data-action="publish-results"]').trigger('click')
    await flushPromises()

    expect(school.get('[data-result-row]').text()).toContain('专家 A')
    expect(school.text()).not.toContain('周明远')

    const student = await mountPage(StudentResultPage, '/student/results', service)
    const supervisor = await mountPage(SupervisorResultPage, '/supervisor/results', service)
    expect(student.get('[data-result-row]').text()).toContain('专家 A')
    expect(supervisor.get('[data-result-row]').text()).toContain('专家 A')
    expect(student.findAll('[data-result-row]')).toHaveLength(1)
    expect(student.text()).toContain('86.0')
    expect(student.findAll('[data-score-dimension]')).toHaveLength(6)
    expect(student.text()).toContain('2026-08-25 10:00')
    expect(`${student.text()}${supervisor.text()}`).not.toMatch(/周明远|138\d{8}|\w+@\w+/)
  })
})
