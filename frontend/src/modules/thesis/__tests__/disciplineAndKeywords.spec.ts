import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import DisciplineSelector from '../components/DisciplineSelector.vue'
import KeywordTagInput from '../components/KeywordTagInput.vue'

enableAutoUnmount(afterEach)

describe('discipline and keyword inputs', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('emits the selected discipline code and name as one value', async () => {
    const wrapper = mount(DisciplineSelector)

    await wrapper.get('[data-action="open-discipline"]').trigger('click')
    await wrapper.get('input[type="search"]').setValue('0812')
    await wrapper.get('button[data-discipline="0812"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([
      { code: '0812', name: '计算机科学与技术' },
    ])
  })

  it('opens as an overlay only after activation and closes with Escape', async () => {
    const wrapper = mount(DisciplineSelector, { attachTo: document.body })
    const control = wrapper.get('[data-action="open-discipline"]')

    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    await control.trigger('click')

    expect(wrapper.get('[role="listbox"]').isVisible()).toBe(true)
    expect(wrapper.get('.discipline-selector').classes()).toContain('is-open')
    expect(document.activeElement).toBe(wrapper.get('input[type="search"]').element)

    await wrapper.get('input[type="search"]').trigger('keydown', { key: 'Escape' })

    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    expect(document.activeElement).toBe(control.element)
  })

  it.each([
    ['0812', '0812'],
    ['计算机', '0812'],
  ])('filters the catalog with the query %s', async (query, expectedCode) => {
    const wrapper = mount(DisciplineSelector)

    await wrapper.get('[data-action="open-discipline"]').trigger('click')
    await wrapper.get('input[type="search"]').setValue(query)

    expect(wrapper.get(`button[data-discipline="${expectedCode}"]`).text()).toContain(
      '计算机科学与技术',
    )
  })

  it('shows an empty result and closes when clicking outside', async () => {
    const outside = document.createElement('button')
    document.body.append(outside)
    const wrapper = mount(DisciplineSelector, { attachTo: document.body })

    await wrapper.get('[data-action="open-discipline"]').trigger('click')
    await wrapper.get('input[type="search"]').setValue('不存在的专业')
    expect(wrapper.get('[data-empty="discipline"]').text()).toBe('没有匹配的专业')

    outside.click()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })

  it('uses arrow keys and Enter to select the active result', async () => {
    const wrapper = mount(DisciplineSelector)

    await wrapper.get('[data-action="open-discipline"]').trigger('click')
    const search = wrapper.get('input[type="search"]')
    await search.setValue('计算机')
    await search.trigger('keydown', { key: 'ArrowDown' })
    expect(search.attributes('aria-activedescendant')).toContain('0812')

    await search.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([
      { code: '0812', name: '计算机科学与技术' },
    ])
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })

  it('moves to the last result when ArrowUp starts keyboard navigation', async () => {
    const wrapper = mount(DisciplineSelector)

    await wrapper.get('[data-action="open-discipline"]').trigger('click')
    const search = wrapper.get('input[type="search"]')
    await search.trigger('keydown', { key: 'ArrowUp' })

    expect(search.attributes('aria-activedescendant')).toContain('1452')
  })

  it('echoes the selected value and places the desktop overlay where space is available', async () => {
    const wrapper = mount(DisciplineSelector, {
      attachTo: document.body,
      props: { modelValue: { code: '0812', name: '计算机科学与技术' } },
    })
    const control = wrapper.get('[data-action="open-discipline"]')
    vi.spyOn(control.element, 'getBoundingClientRect').mockReturnValue({
      bottom: 730,
      height: 42,
      left: 0,
      right: 320,
      top: 688,
      width: 320,
      x: 0,
      y: 688,
      toJSON: () => ({}),
    })

    expect(control.text()).toContain('0812')
    expect(control.text()).toContain('计算机科学与技术')

    await control.trigger('click')

    expect(wrapper.get('.discipline-selector__popover').attributes('data-placement')).toBe('top')
  })

  it('trims and deduplicates keyword tags', async () => {
    const wrapper = mount(KeywordTagInput, { props: { modelValue: ['知识图谱'] } })

    await wrapper.get('input').setValue(' 知识图谱；多模态推理 ')
    await wrapper.get('input').trigger('keydown.enter')

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual(['知识图谱', '多模态推理'])
  })

  it('removes an existing keyword tag', async () => {
    const wrapper = mount(KeywordTagInput, {
      props: { modelValue: ['知识图谱', '多模态推理'] },
    })

    await wrapper.get('button[data-remove-keyword="知识图谱"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['多模态推理']])
  })
})
