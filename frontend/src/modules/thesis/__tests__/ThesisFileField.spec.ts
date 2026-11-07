import '@/__tests__/demoMode'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ThesisFileField from '../components/ThesisFileField.vue'

function chooseFile(wrapper: ReturnType<typeof mount>, file: File) {
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
  return input.trigger('change')
}

describe('ThesisFileField', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('validates a PDF with visible progress and emits JSON-safe metadata only', async () => {
    const wrapper = mount(ThesisFileField, {
      props: { label: '原始论文', purpose: 'SCHOOL_ARCHIVE' },
    })

    await chooseFile(wrapper, new File(['paper body'], 'paper.pdf', { type: 'application/pdf' }))
    expect(wrapper.get('[data-file-progress]').text()).toContain('50%')

    await vi.runAllTimersAsync()

    const meta = wrapper.emitted('update:modelValue')?.at(-1)?.[0]
    expect(meta).toEqual(
      expect.objectContaining({
        name: 'paper.pdf',
        size: 10,
        mimeType: 'application/pdf',
        purpose: 'SCHOOL_ARCHIVE',
        validationStatus: 'VALID',
      }),
    )
    expect(Object.keys(meta as object).sort()).toEqual(
      ['id', 'mimeType', 'name', 'purpose', 'size', 'validationStatus'].sort(),
    )
    expect(JSON.stringify(meta)).not.toContain('paper body')
  })

  it('shows a failed validation, allows another selection, and deletes the selected metadata', async () => {
    const wrapper = mount(ThesisFileField, {
      props: { label: '原始论文', purpose: 'SCHOOL_ARCHIVE' },
    })

    await chooseFile(wrapper, new File(['not pdf'], 'spoofed.pdf', { type: 'application/msword' }))
    await vi.runAllTimersAsync()
    expect(wrapper.text()).toContain('文件校验失败，请重新选择 PDF')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    await chooseFile(wrapper, new File(['pdf'], 'retry.pdf', { type: 'application/pdf' }))
    await vi.runAllTimersAsync()
    expect(wrapper.text()).toContain('retry.pdf')

    await wrapper.get('[data-action="delete-file"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBeNull()
    expect(wrapper.find('[data-file-name]').exists()).toBe(false)
  })

  it('does not let a stale validation restore a file deleted while replacement is pending', async () => {
    const wrapper = mount(ThesisFileField, {
      props: {
        label: '原始论文',
        purpose: 'SCHOOL_ARCHIVE',
        modelValue: {
          id: 'existing',
          name: 'existing.pdf',
          size: 3,
          mimeType: 'application/pdf',
          purpose: 'SCHOOL_ARCHIVE',
          validationStatus: 'VALID',
        },
      },
    })

    await chooseFile(wrapper, new File(['new'], 'replacement.pdf', { type: 'application/pdf' }))
    await wrapper.get('[data-action="delete-file"]').trigger('click')
    await vi.runAllTimersAsync()

    expect(wrapper.find('[data-file-name]').exists()).toBe(false)
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBeNull()
  })

  it.each(['林知远-匿名版.pdf', '20260042.pdf', '论文致谢.pdf'])(
    'flags anonymous identity risk in %s without claiming body inspection',
    async (name) => {
      const wrapper = mount(ThesisFileField, {
        props: {
          label: '匿名版论文',
          purpose: 'EXPERT_REVIEW',
          identityTokens: ['林知远', '20260042'],
        },
      })

      await chooseFile(wrapper, new File(['pdf'], name, { type: 'application/pdf' }))
      await vi.runAllTimersAsync()

      expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual(
        expect.objectContaining({ validationStatus: 'REVIEW_REQUIRED' }),
      )
      expect(wrapper.text()).toContain('请检查文件名和正文中的身份线索')
      expect(wrapper.text()).toContain('正文尚未自动检测')
    },
  )
})
