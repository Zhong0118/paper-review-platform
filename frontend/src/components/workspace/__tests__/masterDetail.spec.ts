import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

import MasterDetail from '../MasterDetail.vue'
import { useNarrow } from '../useNarrow'

const slots = { list: () => h('p', '清单内容'), default: () => h('p', '对象内容'), empty: () => h('p', '请选择') }
const mountMD = (props: { open: boolean; narrow: boolean }) =>
  mount(MasterDetail, { props: { ...props, listLabel: '清单', detailLabel: '对象' }, slots })

describe('MasterDetail', () => {
  it('shows list and detail side by side when wide', () => {
    const w = mountMD({ open: true, narrow: false })
    expect(w.get('[aria-label="清单"]').isVisible()).toBe(true)
    expect(w.text()).toContain('对象内容')
    expect(w.find('button').exists()).toBe(false)
  })

  it('shows the empty slot when wide and nothing is open', () => {
    const w = mountMD({ open: false, narrow: false })
    expect(w.text()).toContain('请选择')
    expect(w.text()).not.toContain('对象内容')
  })

  it('shows only the list when narrow and nothing is open', () => {
    const w = mountMD({ open: false, narrow: true })
    expect(w.get('[aria-label="清单"]').isVisible()).toBe(true)
    expect(w.text()).not.toContain('请选择')
    expect(w.find('[aria-label="对象"]').exists()).toBe(false)
  })

  it('shows only the detail with a back button when narrow and open', async () => {
    const w = mountMD({ open: true, narrow: true })
    expect(w.get('[aria-label="清单"]').isVisible()).toBe(false)
    expect(w.text()).toContain('对象内容')
    await w.get('button').trigger('click')
    expect(w.emitted('back')).toHaveLength(1)
    expect(w.get('button').text()).toContain('返回清单')
  })
})

describe('useNarrow', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('follows matchMedia changes and stops listening on unmount', async () => {
    let listener: (() => void) | undefined
    const media = {
      matches: false,
      addEventListener: vi.fn((_: string, fn: () => void) => (listener = fn)),
      removeEventListener: vi.fn(),
    }
    vi.stubGlobal('matchMedia', vi.fn(() => media))
    const Probe = defineComponent({
      setup() {
        const narrow = useNarrow()
        return () => h('span', narrow.value ? 'narrow' : 'wide')
      },
    })
    const w = mount(Probe)
    expect(w.text()).toBe('wide')
    media.matches = true
    listener?.()
    await nextTick()
    expect(w.text()).toBe('narrow')
    w.unmount()
    expect(media.removeEventListener).toHaveBeenCalledWith('change', listener)
  })
})
