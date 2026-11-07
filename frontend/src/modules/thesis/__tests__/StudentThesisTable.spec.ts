import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { demoTheses } from '@/demo/fixtures'
import StudentThesisTable from '../components/StudentThesisTable.vue'

describe('StudentThesisTable', () => {
  it('renders multiple papers, source labels and actions projected per row', () => {
    const wrapper = mount(StudentThesisTable, { props: { rows: demoTheses } })

    expect(wrapper.findAll('tbody tr')).toHaveLength(3)
    expect(wrapper.text()).toContain('学校代传')
    expect(wrapper.text()).toContain('学校批量导入')
    expect(wrapper.get('tbody tr:first-child').text()).toContain('请修改后重新提交')
    expect(
      wrapper.get('[data-source="SCHOOL_MANUAL"]').element.closest('tr')?.textContent,
    ).toContain('学校可继续处理')
    expect(wrapper.findAll('[data-action="edit-thesis"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-action="view-result"]')).toHaveLength(1)
  })

  it('selects the whole thesis row without turning school-submitted records into editable data', async () => {
    const wrapper = mount(StudentThesisTable, {
      props: { rows: demoTheses, selectedThesisId: 'thesis-main' },
    })

    const schoolSubmittedRow = wrapper.get('[data-thesis-id="thesis-0031"]')
    expect(wrapper.get('[data-thesis-id="thesis-main"]').attributes('aria-selected')).toBe('true')
    expect(schoolSubmittedRow.text()).toContain('学校批量导入')
    expect(schoolSubmittedRow.find('[data-action="edit-thesis"]').exists()).toBe(false)

    await schoolSubmittedRow.trigger('click')

    expect(wrapper.emitted('select')).toEqual([['thesis-0031']])
  })
})
