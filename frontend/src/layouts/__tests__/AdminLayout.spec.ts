import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AdminLayout from '../AdminLayout.vue'

describe('AdminLayout', () => {
  it('provides accessible navigation and an unrestricted content region', () => {
    const wrapper = mount(AdminLayout, {
      props: {
        variant: 'school',
        activePath: '/school/preparation',
        menuItems: [
          { label: '送审准备', path: '/school/preparation' },
          { label: '评审进度', path: '/school/progress' },
        ],
      },
      slots: {
        default: '<section>学校工作台</section>',
      },
      global: {
        stubs: {
          RouterLink: {
            props: ['to'],
            template: '<a :href="to"><slot /></a>',
          },
        },
      },
    })

    expect(wrapper.get('aside[aria-label="主导航"]').exists()).toBe(true)
    expect(wrapper.get('a[aria-current="page"]').text()).toBe('送审准备')
    expect(wrapper.get('main').text()).toContain('学校工作台')
    expect(wrapper.get('main').classes().some((name) => name.startsWith('max-w-'))).toBe(false)
  })
})
