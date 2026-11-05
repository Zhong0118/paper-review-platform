import { httpApi, type RequestOptions } from './request'

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
  // 登录页在表单里原位说明失败原因，不再另弹全局提示
  return httpApi.post<LoginResult>('/auth/login', { username, password }, { quiet: true })
}

export function logoutSession(refreshToken: string) {
  return httpApi.post('/auth/logout', { refresh_token: refreshToken })
}

export function fetchMe() {
  return httpApi.get<LoginUser>('/me')
}

export interface Eligibility {
  eligible: boolean
  status: string
  student_no: string
  student_name: string
  supervisor_name: string | null
  degree_type: string | null
  tenant_name: string
  college_name: string
  batch_id: string
  batch_name: string
  deadline: string
}

export function fetchEligibility(options?: RequestOptions) {
  return httpApi.get<Eligibility>('/me/eligibility', options)
}
