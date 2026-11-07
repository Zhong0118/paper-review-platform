import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import AppToaster from '../AppToaster.vue'
import { notices, notify } from '../notify'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  notices.splice(0)
  vi.useRealTimers()
})

it('shows one notice per message, closes on request and after five seconds', async () => {
  const wrapper = mount(AppToaster)
  notify.error('数据已变更，请刷新后重试')
  notify.error('数据已变更，请刷新后重试')
  notify.error('资源不存在或不可见')
  await nextTick()
  expect(wrapper.findAll('[data-notice]').map((item) => item.text())).toEqual(['数据已变更，请刷新后重试', '资源不存在或不可见'])
  expect(wrapper.get('[data-toaster]').attributes('aria-live')).toBe('polite')
  await wrapper.get('[aria-label="关闭提示"]').trigger('click')
  expect(wrapper.findAll('[data-notice]')).toHaveLength(1)
  vi.advanceTimersByTime(5000)
  await nextTick()
  expect(wrapper.findAll('[data-notice]')).toHaveLength(0)
})
