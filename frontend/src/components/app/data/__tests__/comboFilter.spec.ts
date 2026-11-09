import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ComboFilter from '../ComboFilter.vue'

const options = [{ value: '0812', label: '计算机科学与技术' }]

describe('ComboFilter empty state (P1-2)', () => {
  it('shows an “all” placeholder like a value', () => {
    const wrapper = mount(ComboFilter, { props: { modelValue: null, label: '学科', placeholder: '全部学科', options } })
    const trigger = wrapper.get('[data-combo]')
    expect(trigger.text()).toBe('全部学科')
    expect(trigger.classes()).toContain('text-foreground')
  })
  it('falls back to the muted label without a placeholder', () => {
    const wrapper = mount(ComboFilter, { props: { modelValue: null, label: '学科', options } })
    const trigger = wrapper.get('[data-combo]')
    expect(trigger.text()).toBe('学科')
    expect(trigger.classes()).toContain('text-muted-foreground')
  })
  it('shows the picked option', () => {
    const wrapper = mount(ComboFilter, { props: { modelValue: '0812', label: '学科', placeholder: '全部学科', options } })
    expect(wrapper.get('[data-combo]').text()).toBe('计算机科学与技术')
  })
})
