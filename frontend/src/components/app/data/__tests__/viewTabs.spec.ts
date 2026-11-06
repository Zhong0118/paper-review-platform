import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ViewTabs from '../ViewTabs.vue'

const views = [
  { value: 'a', label: '待发布', count: 0 },
  { value: 'b', label: '更正待确认', count: 2 },
]

describe('ViewTabs size (F1 · A2)', () => {
  it('wraps by default and keeps the regular size', () => {
    const wrapper = mount(ViewTabs, { props: { modelValue: 'a', views, label: '视图' } })
    expect(wrapper.get('[data-view-tabs]').classes()).toContain('flex-wrap')
    expect(wrapper.get('[data-view="a"]').classes()).toContain('h-8')
  })
  it('stays on one row in the small size and scrolls instead of wrapping', () => {
    const wrapper = mount(ViewTabs, { props: { modelValue: 'b', views, label: '视图', size: 'sm' } })
    const group = wrapper.get('[data-view-tabs]')
    expect(group.classes()).toContain('flex-nowrap')
    expect(group.classes()).toContain('overflow-x-auto')
    expect(group.classes()).not.toContain('flex-wrap')
    const tab = wrapper.get('[data-view="b"]')
    expect(tab.classes()).toContain('h-7')
    expect(tab.classes()).toContain('shrink-0')
    expect(tab.attributes('aria-pressed')).toBe('true')
    expect(tab.text()).toContain('2')
  })
})
