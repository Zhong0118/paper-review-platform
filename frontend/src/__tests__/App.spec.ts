import { describe, it, expect } from 'vitest'

import { mount } from '@vue/test-utils'
import App from '../App.vue'

describe('App', () => {
  it('renders routed content in a full-width main region', () => {
    const wrapper = mount(App, {
      global: {
        stubs: {
          RouterView: { template: '<main aria-label="页面内容">页面</main>' },
        },
      },
    })

    const root = wrapper.get('#app-root')
    const main = wrapper.get('main[aria-label="页面内容"]')

    expect(main.attributes('aria-label')).toBe('页面内容')
    expect(root.element.tagName).toBe('DIV')
    expect(root.classes().some((className) => className.startsWith('max-w-'))).toBe(false)
  })
})
