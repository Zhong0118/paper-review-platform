import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import DisciplineSelector from '../components/DisciplineSelector.vue'

describe('server-owned discipline choices', () => {
  it('uses provided options and never falls back when the list is empty', async () => {
    const w = mount(DisciplineSelector, { props: { options: [] } })
    await w.get('[data-action="open-discipline"]').trigger('click')
    expect(w.findAll('[data-discipline]')).toHaveLength(0)
    await w.setProps({ options: [{ code:'0101', name:'哲学' }] })
    expect(w.findAll('[data-discipline]')).toHaveLength(1)
    await w.get('input[type="search"]').setValue('0101')
    await w.get('[data-discipline="0101"]').trigger('click')
    expect(w.emitted('update:modelValue')?.[0]).toEqual([{code:'0101',name:'哲学'}])
  })
})
