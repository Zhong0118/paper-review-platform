import type { InternalAxiosRequestConfig } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'

const message = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('element-plus', () => ({ ElMessage: message }))

import http from '../request'
import { failureText } from '../failure'

const conflict = async () => ({ data: { code: 'VERSION_CONFLICT', message: '数据已变更' }, status: 409, statusText: 'Conflict', headers: {}, config: {} })

beforeEach(() => {
  setActivePinia(createPinia())
  message.error.mockReset()
})

async function fail(quiet?: boolean) {
  const adapter = async (config: InternalAxiosRequestConfig) => {
    const response = { ...(await conflict()), config }
    throw Object.assign(new Error('Request failed with status code 409'), { isAxiosError: true, response, config })
  }
  return http.get('/x', { adapter, quiet } as never).catch((error: unknown) => error)
}

it('shows the global message by default and skips it for a quiet request', async () => {
  await fail()
  expect(message.error).toHaveBeenCalledWith('数据已变更，请刷新后重试')
  message.error.mockReset()
  const error = await fail(true)
  expect(message.error).not.toHaveBeenCalled()
  expect(failureText(error, '请求失败')).toBe('数据已变更')
})
