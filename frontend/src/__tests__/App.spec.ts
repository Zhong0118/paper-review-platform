import { describe, it, expect } from 'vitest'

import { mount } from '@vue/test-utils'
import App from '../App.vue'

describe('App', () => {
  it('renders a router-view shell', () => {
    const wrapper = mount(App, {
      global: {
        stubs: ['router-view'],
      },
    })
    expect(wrapper.find('router-view-stub').exists()).toBe(true)
  })
})
