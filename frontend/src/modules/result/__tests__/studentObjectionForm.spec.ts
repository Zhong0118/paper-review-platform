import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import StudentObjectionForm from '../components/StudentObjectionForm.vue'

describe('student objection form', () => {
  it('hides the attachment picker when the live API does not accept files', () => {
    const wrapper = mount(StudentObjectionForm, { props: { allowAttachments: false } })
    expect(wrapper.find('input[type="file"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('异议附件')
  })
})
