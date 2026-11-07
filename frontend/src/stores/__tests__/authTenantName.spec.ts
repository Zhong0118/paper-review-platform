import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  loginWithPassword: vi.fn(),
  logoutSession: vi.fn(),
  fetchMe: vi.fn(),
}))
vi.mock('@/api/auth', () => api)

import { useAuthStore } from '../auth'

const login = (tenant: string | null) => ({
  access_token: 'a',
  refresh_token: 'r',
  token_type: 'bearer',
  expires_in: 1800,
  user: { id: 'u1', username: 'school.wang', display_name: '王老师', role: 'school_reviewer', tenant_id: tenant, tenant_code: tenant ? 'demo-univ' : null },
})

describe('auth store school name (F1 · A1)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    sessionStorage.clear()
    vi.clearAllMocks()
  })

  it('reads the school name from /me after login and keeps it in the session', async () => {
    api.loginWithPassword.mockResolvedValue(login('t1'))
    api.fetchMe.mockResolvedValue({ tenant_name: '演示大学' })
    const auth = useAuthStore()
    await auth.loginWithPassword('school.wang', 'x')
    expect(api.fetchMe).toHaveBeenCalledWith({ quiet: true })
    expect(auth.user?.tenantName).toBe('演示大学')
    expect(JSON.parse(sessionStorage.getItem('pr.user')!).tenantName).toBe('演示大学')
  })

  it('still logs in and keeps only the code when /me fails', async () => {
    api.loginWithPassword.mockResolvedValue(login('t1'))
    api.fetchMe.mockRejectedValue(new Error('down'))
    const auth = useAuthStore()
    await auth.loginWithPassword('school.wang', 'x')
    expect(auth.accessToken).toBe('a')
    expect(auth.user?.tenantCode).toBe('demo-univ')
    expect(auth.user?.tenantName).toBeUndefined()
  })

  it('does not call /me for accounts without a school', async () => {
    api.loginWithPassword.mockResolvedValue(login(null))
    await useAuthStore().loginWithPassword('platform.chen', 'x')
    expect(api.fetchMe).not.toHaveBeenCalled()
  })
})
