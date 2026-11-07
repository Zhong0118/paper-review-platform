import { createPinia } from 'pinia'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

import type { ThesisDetail } from '@/api/theses'
import Page from '../SchoolPreparationPage.vue'

const source = { thesis_version_id: 'v-a', file_id: 'anon-a', file_sha256: 'x', detector_version: 'd1', terms_version: 12, title_status: 'FOUND' as const, uncertain: false, uncertain_pages: [] as number[], page_count: 12 }

export function thesis(id: string, extra: Partial<ThesisDetail> & { report?: Partial<ThesisDetail['anonymization']> } = {}): ThesisDetail {
  const { report, ...rest } = extra
  return {
    id,
    stage: 'PREPARING',
    version: 3,
    return_reason: null,
    allowed_actions: ['CONFIRM_ANONYMIZATION', 'REJECT_ANONYMIZATION'],
    recent_events: [],
    student: { name: `学生${id}`, student_no: `2026${id}`, supervisor_name: null, tenant_name: '示例大学', college_name: '信息学院' },
    current_version: {
      id: `v-${id}`, title: `论文${id}`, abstract: '', discipline_code: '0812', discipline_name: '计算机科学与技术', keywords: [], is_editable: false,
      files: [{ file_id: `orig-${id}`, purpose: 'original', filename: 'o.pdf' }, { file_id: `anon-${id}`, purpose: 'anonymous', filename: 'a.pdf' }],
    },
    anonymization: { auto_conclusion: 'PASS', manual_conclusion: null, findings: [], stale: false, source_metadata: { ...source, thesis_version_id: `v-${id}`, file_id: `anon-${id}` }, ...report },
    ...rest,
  }
}

export function httpError(status: number, code: string, message = '请求失败') {
  return Object.assign(new Error(message), { response: { status, data: { code, message } } })
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

export async function mountAt(url: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/school/preparation', component: Page },
      { path: '/:rest(.*)*', component: { render: () => null } },
    ],
  })
  await router.push(url)
  await router.isReady()
  const wrapper = mount(Page, { global: { plugins: [createPinia(), router] }, attachTo: document.body })
  await flushPromises()
  return { wrapper, router }
}

/** 对话框、抽屉经 Teleport 渲染到 body：按 document 查询（R2） */
export function inBody(selector: string) {
  const element = document.body.querySelector(selector)
  if (!element) throw new Error(`Unable to find ${selector} in document.body`)
  return new DOMWrapper(element)
}
