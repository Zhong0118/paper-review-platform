import { httpApi } from './request'

export interface LoginUser {
  id: string
  username: string | null
  display_name: string | null
  role: string
  tenant_id: string | null
  tenant_code: string | null
}

export interface LoginResult {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  user: LoginUser
}

export function loginWithPassword(username: string, password: string) {
  return httpApi.post<LoginResult>('/auth/login', { username, password })
}

export function logoutSession(refreshToken: string) {
  return httpApi.post('/auth/logout', { refresh_token: refreshToken })
}

export function fetchMe() {
  return httpApi.get<LoginUser>('/me')
}
